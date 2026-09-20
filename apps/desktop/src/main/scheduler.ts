import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

import type { MacroThemeId } from '@workbench/shared';
import { buildMacroPrompt } from '@workbench/shared';
import { Cron } from 'croner';

import { getLogger } from './logging';
import { shouldSkipDueToDailyLimit } from './schedulerGuards';
import { getStore } from './store';

const STORE_SCOPE = 'workbench.scheduler';

export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  agent?: string;
  model?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
  tags?: string[];
  /** Optional budget guard: skip firing once today's run count reaches this. */
  maxRunsPerDay?: number;
  /** Macro insight task: the fire path rebuilds the prompt from live data. */
  macroTheme?: MacroThemeId;
}

export interface CreateTaskInput {
  name: string;
  cron: string;
  prompt: string;
  agent?: string;
  model?: string;
  tags?: string[];
  maxRunsPerDay?: number;
  macroTheme?: MacroThemeId;
}

export interface UpdateTaskInput {
  name?: string;
  cron?: string;
  prompt?: string;
  agent?: string;
  model?: string;
  tags?: string[];
  maxRunsPerDay?: number;
  macroTheme?: MacroThemeId;
}

export interface ExecutionRecord {
  id: string;
  taskId: string;
  taskName: string;
  triggeredAt: string;
  status: 'running' | 'completed' | 'failed' | 'timeout' | 'skipped';
  sessionId?: string;
  error?: string;
  durationMs?: number;
  completedAt?: string;
}

export const SCHEDULER_SKILL = `# 定时任务技能

通过 MCP 工具管理定时任务。所有操作通过 scheduler_* 工具完成，不要使用 OpenCode 内置的调度功能。

## 可用工具

- **scheduler_list** — 列出所有定时任务
- **scheduler_create** — 创建新任务（必填: name, cron, prompt；可选: agent, model, tags）
- **scheduler_update** — 更新已有任务（必填: id；可选: name, cron, prompt, agent, model, tags）
- **scheduler_delete** — 删除任务（必填: id）
- **scheduler_toggle** — 启用或停用任务（必填: id, enabled）
- **scheduler_fire_now** — 立即执行任务（必填: id）
- **scheduler_history** — 查看执行历史（可选: taskId, limit）

## Cron 表达式

使用标准 5 字段 cron 语法：分 时 日 月 周

| 表达式 | 含义 |
|--------|------|
| \`0 8 * * *\` | 每天 08:00 |
| \`0 9 * * 1-5\` | 工作日 09:00 |
| \`*/30 * * * *\` | 每 30 分钟 |
| \`0 8 1 * *\` | 每月 1 号 08:00 |
| \`0 8 * * 1\` | 每周一 08:00 |

## 示例

用户："每天早上8点帮我查一下XX基金的净值变化"
→ 调用 scheduler_create({ name: "每日XX基金净值", cron: "0 8 * * *", prompt: "查询XX基金最新净值并与前一日比较" })

用户："暂停市场周报任务"
→ 先调用 scheduler_list 找到任务 id，再调用 scheduler_toggle({ id: "...", enabled: false })

## 重要提示

- 创建任务时必须同时提供 name、cron、prompt 三个必填字段
- 如果用户没有指定精确时间，主动询问或使用合理默认值
- 不要使用 OpenCode 内置的调度功能，始终使用上述 MCP 工具
`;

export const SCHEDULER_COMMAND = `# /scheduler — 管理定时任务

用法：/scheduler [list|create|delete|toggle|history|fire]

/scheduler list — 查看所有定时任务
/scheduler create — 创建新的定时任务
/scheduler delete <id> — 删除任务
/scheduler toggle <id> — 启用/停用任务
/scheduler history — 查看执行历史
/scheduler fire <id> — 立即执行任务
`;

export interface SchedulerApiInfo {
  url: string;
  password: string;
}

export function deploySchedulerProfile(
  xdgConfigHome: string,
  mcpScriptPath: string,
  apiInfo: SchedulerApiInfo,
): void {
  const opencodeDir = join(xdgConfigHome, 'opencode');
  const skillsDir = join(opencodeDir, 'skills', 'scheduler');
  const commandsDir = join(opencodeDir, 'commands');
  mkdirSync(skillsDir, { recursive: true });
  mkdirSync(commandsDir, { recursive: true });
  writeFileSync(join(skillsDir, 'SKILL.md'), SCHEDULER_SKILL);
  writeFileSync(join(commandsDir, 'scheduler.md'), SCHEDULER_COMMAND);

  // Write MCP server config into opencode.json (merge with existing)
  const configPath = join(opencodeDir, 'opencode.json');
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    /* start fresh if missing */
  }

  const mcpSection = (config.mcp ?? {}) as Record<string, unknown>;
  mcpSection['scheduler'] = {
    type: 'local',
    command: ['node', mcpScriptPath],
    enabled: true,
    environment: {
      SCHEDULER_API_URL: apiInfo.url,
      SCHEDULER_API_TOKEN: apiInfo.password,
    },
  };
  config.mcp = mcpSection;
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

type FireCallback = (task: ScheduledTask) => Promise<string>;

export class CronEngine {
  private jobs = new Map<string, Cron>();
  private onFire: FireCallback | null = null;

  setFireCallback(cb: FireCallback): void {
    this.onFire = cb;
  }

  /** True once the runtime connected and the fire callback is wired. */
  canFire(): boolean {
    return this.onFire !== null;
  }

  start(): void {
    const tasks = this.listTasks().filter((t) => t.enabled);
    for (const task of tasks) {
      this.scheduleOne(task);
    }
  }

  stop(): void {
    for (const [id, cron] of this.jobs) {
      cron.stop();
      this.jobs.delete(id);
    }
  }

  reload(): void {
    this.stop();
    this.start();
  }

  addTask(input: CreateTaskInput): ScheduledTask {
    const task = this.buildTask(input);
    const tasks = this.listTasks();
    tasks.push(task);
    this.saveTasks(tasks);

    this.scheduleOne(task);
    getLogger().info(`[scheduler] task created: ${task.name} (${task.id})`);
    return task;
  }

  /**
   * Create the task only when no task for the same macro theme exists.
   * Does not schedule: persisted tasks are scheduled by start() when the
   * runtime connects; provisioning happens before that on purpose.
   */
  ensureTask(input: CreateTaskInput): ScheduledTask {
    if (input.macroTheme) {
      const existing = this.listTasks().find((t) => t.macroTheme === input.macroTheme);
      if (existing) return existing;
    }
    const task = this.buildTask(input);
    const tasks = this.listTasks();
    tasks.push(task);
    this.saveTasks(tasks);
    getLogger().info(`[scheduler] task ensured: ${task.name} (${task.id})`);
    return task;
  }

  private buildTask(input: CreateTaskInput): ScheduledTask {
    const now = new Date().toISOString();
    const task: ScheduledTask = {
      id: randomUUID(),
      name: input.name,
      cron: input.cron,
      prompt: input.prompt,
      agent: input.agent,
      model: input.model,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      tags: input.tags,
      maxRunsPerDay: input.maxRunsPerDay,
      macroTheme: input.macroTheme,
    };

    // Validate cron expression and compute next run
    try {
      const cron = new Cron(input.cron);
      const next = cron.nextRun();
      task.nextRunAt = next?.toISOString() ?? undefined;
      cron.stop(); // don't keep this instance — scheduleOne creates the real one
    } catch (err) {
      getLogger().error(
        `[scheduler] invalid cron expression "${input.cron}": ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new Error(`Invalid cron expression: ${input.cron}`);
    }

    return task;
  }

  removeTask(id: string): void {
    this.unscheduleOne(id);
    const tasks = this.listTasks().filter((t) => t.id !== id);
    this.saveTasks(tasks);
  }

  updateTask(id: string, patch: UpdateTaskInput): ScheduledTask | null {
    const tasks = this.listTasks();
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) return null;

    const task = tasks[idx];
    if (patch.name !== undefined) task.name = patch.name;
    if (patch.cron !== undefined) task.cron = patch.cron;
    if (patch.prompt !== undefined) task.prompt = patch.prompt;
    if (patch.agent !== undefined) task.agent = patch.agent;
    if (patch.model !== undefined) task.model = patch.model;
    if (patch.tags !== undefined) task.tags = patch.tags;
    if (patch.maxRunsPerDay !== undefined) task.maxRunsPerDay = patch.maxRunsPerDay;
    if (patch.macroTheme !== undefined) task.macroTheme = patch.macroTheme;
    task.updatedAt = new Date().toISOString();

    try {
      const next = new Cron(task.cron).nextRun();
      task.nextRunAt = next?.toISOString() ?? undefined;
    } catch {
      task.nextRunAt = undefined;
    }

    tasks[idx] = task;
    this.saveTasks(tasks);

    this.unscheduleOne(id);
    if (task.enabled) this.scheduleOne(task);

    return task;
  }

  toggleTask(id: string, enabled: boolean): ScheduledTask | null {
    const tasks = this.listTasks();
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) return null;

    tasks[idx].enabled = enabled;
    tasks[idx].updatedAt = new Date().toISOString();
    this.saveTasks(tasks);

    if (enabled) {
      this.scheduleOne(tasks[idx]);
    } else {
      this.unscheduleOne(id);
    }

    return tasks[idx];
  }

  async fireNow(id: string): Promise<ExecutionRecord | null> {
    const log = getLogger();
    const tasks = this.listTasks();
    const task = tasks.find((t) => t.id === id);
    if (!task) {
      log.warn(`[scheduler] fireNow: task ${id} not found`);
      return null;
    }
    if (!this.onFire) {
      log.warn(`[scheduler] fireNow: no fire callback set (runtime not started?)`);
      return null;
    }

    log.info(`[scheduler] fireNow: executing task ${task.name} (${task.id})`);
    return this.executeTask(task);
  }

  listTasks(): ScheduledTask[] {
    const store = getStore(STORE_SCOPE);
    const raw = store.get('tasks');
    if (!Array.isArray(raw)) return [];
    return raw as ScheduledTask[];
  }

  getHistory(taskId?: string, limit = 50): ExecutionRecord[] {
    const store = getStore(STORE_SCOPE);
    const raw = store.get('executions');
    if (!Array.isArray(raw)) return [];
    let records = raw as ExecutionRecord[];
    if (taskId) records = records.filter((r) => r.taskId === taskId);
    return records.slice(0, limit);
  }

  deleteExecution(id: string): void {
    const store = getStore(STORE_SCOPE);
    const raw = store.get('executions');
    const records: ExecutionRecord[] = Array.isArray(raw) ? raw : [];
    store.set(
      'executions',
      records.filter((r) => r.id !== id),
    );
  }

  clearHistory(taskId?: string): void {
    const store = getStore(STORE_SCOPE);
    if (taskId) {
      const raw = store.get('executions');
      const records: ExecutionRecord[] = Array.isArray(raw) ? raw : [];
      store.set(
        'executions',
        records.filter((r) => r.taskId !== taskId),
      );
    } else {
      store.set('executions', []);
    }
  }

  private saveTasks(tasks: ScheduledTask[]): void {
    const store = getStore(STORE_SCOPE);
    store.set('tasks', tasks);
  }

  private saveExecution(record: ExecutionRecord): void {
    const store = getStore(STORE_SCOPE);
    const raw = store.get('executions');
    const records: ExecutionRecord[] = Array.isArray(raw) ? raw : [];
    records.unshift(record);
    if (records.length > 200) records.length = 200;
    store.set('executions', records);
  }

  private updateExecution(id: string, patch: Partial<ExecutionRecord>): void {
    const store = getStore(STORE_SCOPE);
    const raw = store.get('executions');
    const records: ExecutionRecord[] = Array.isArray(raw) ? raw : [];
    const idx = records.findIndex((r) => r.id === id);
    if (idx !== -1) Object.assign(records[idx], patch);
    store.set('executions', records);
  }

  private scheduleOne(task: ScheduledTask): void {
    // Idempotent: start() may see tasks that addTask/ensureTask already knew
    // about; doubling a job would fire the same task twice.
    this.unscheduleOne(task.id);
    try {
      const cron = new Cron(task.cron, async () => {
        const log = getLogger();
        log.info(`[scheduler] cron fired: ${task.name} (${task.id})`);
        await this.executeTask(task);
      });
      this.jobs.set(task.id, cron);
      const next = cron.nextRun();
      if (next) {
        task.nextRunAt = next.toISOString();
      }
    } catch (err) {
      const log = getLogger();
      log.error(`[scheduler] invalid cron for task ${task.name}: ${task.cron}`, err);
    }
  }

  private unscheduleOne(id: string): void {
    const cron = this.jobs.get(id);
    if (cron) {
      cron.stop();
      this.jobs.delete(id);
    }
  }

  private async executeTask(task: ScheduledTask): Promise<ExecutionRecord> {
    const record: ExecutionRecord = {
      id: randomUUID(),
      taskId: task.id,
      taskName: task.name,
      triggeredAt: new Date().toISOString(),
      status: 'running',
    };

    // Budget guard: an unattended task that hits its daily limit must not fire
    // (avoids runaway token/cost loops on a mis-configured cron).
    if (
      shouldSkipDueToDailyLimit(
        { taskId: task.id, maxRunsPerDay: task.maxRunsPerDay },
        this.getHistory(task.id, 200),
      )
    ) {
      record.status = 'skipped';
      record.error = 'daily run limit reached';
      record.durationMs = 0;
      record.completedAt = new Date().toISOString();
      this.saveExecution(record);
      this.updateExecution(record.id, record);
      this.touchTaskRun(task.id, record.triggeredAt);
      return record;
    }

    this.saveExecution(record);

    const startedAt = Date.now();
    try {
      const sessionId = await this.onFire?.(task);
      if (sessionId) record.sessionId = sessionId;
      record.status = 'completed';
    } catch (err) {
      record.status = 'failed';
      record.error = err instanceof Error ? err.message : String(err);
    }
    record.durationMs = Date.now() - startedAt;
    record.completedAt = new Date().toISOString();
    this.updateExecution(record.id, record);

    this.touchTaskRun(task.id, record.triggeredAt);

    return record;
  }

  /** Refresh a task's lastRunAt/nextRunAt after an execution attempt. */
  private touchTaskRun(taskId: string, triggeredAt: string): void {
    const tasks = this.listTasks();
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return;
    tasks[idx].lastRunAt = triggeredAt;
    try {
      const next = new Cron(tasks[idx].cron).nextRun();
      tasks[idx].nextRunAt = next?.toISOString() ?? undefined;
    } catch {
      /* keep existing */
    }
    this.saveTasks(tasks);
  }
}

export const cronEngine = new CronEngine();

// ── Default macro insight tasks (provisioned once, then user-managed) ────

/** Daily before the open, weekly on Monday morning, review after Friday close. */
export const DEFAULT_MACRO_TASKS: readonly CreateTaskInput[] = [
  {
    name: '宏观洞察 · 轮动日报',
    cron: '30 8 * * 1-5',
    prompt: buildMacroPrompt('rotation-daily', null, null),
    macroTheme: 'rotation-daily',
    tags: ['macro'],
    maxRunsPerDay: 1,
  },
  {
    name: '宏观洞察 · 轮动周报',
    cron: '0 9 * * 1',
    prompt: buildMacroPrompt('rotation-weekly', null, null),
    macroTheme: 'rotation-weekly',
    tags: ['macro'],
    maxRunsPerDay: 1,
  },
  {
    name: '宏观洞察 · 复盘周报',
    cron: '0 16 * * 5',
    prompt: buildMacroPrompt('review-weekly', null, null),
    macroTheme: 'review-weekly',
    tags: ['macro'],
    maxRunsPerDay: 1,
  },
];

/** The default template for one theme (used by provisioning + regenerate). */
export function defaultMacroTask(themeId: MacroThemeId): CreateTaskInput {
  const input = DEFAULT_MACRO_TASKS.find((t) => t.macroTheme === themeId);
  if (!input) throw new Error(`Unknown macro theme: ${themeId}`);
  return input;
}

/**
 * Provision the default macro tasks once per install: create the missing ones
 * and remember it. Later user changes (delete / disable / re-schedule) are
 * never overwritten — a deleted task stays deleted across restarts.
 */
export function ensureMacroTasks(): void {
  const store = getStore(STORE_SCOPE);
  if (store.get('macroProvisioned')) return;
  for (const input of DEFAULT_MACRO_TASKS) cronEngine.ensureTask(input);
  store.set('macroProvisioned', true);
  getLogger().info('[scheduler] default macro tasks provisioned');
}

// ── Internal HTTP API for the MCP server ─────────────────────────────────

let schedulerApiServer: Server | null = null;
let schedulerApiInfo: SchedulerApiInfo | null = null;

function parseBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c: Buffer) => (data += c.toString()));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : undefined);
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function startSchedulerApi(password: string): Promise<SchedulerApiInfo> {
  // Idempotent: if already running, return existing info
  if (schedulerApiServer && schedulerApiInfo) return schedulerApiInfo;

  const server = createServer(async (req, res) => {
    // Auth check
    const auth = req.headers.authorization ?? '';
    const expected = 'Basic ' + Buffer.from(`user:${password}`).toString('base64');
    if (auth !== expected) {
      json(res, 401, { error: 'unauthorized' });
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const log = getLogger();

    try {
      // GET /api/scheduler/tasks
      if (req.method === 'GET' && path === '/api/scheduler/tasks') {
        json(res, 200, cronEngine.listTasks());
        return;
      }

      // POST /api/scheduler/tasks
      if (req.method === 'POST' && path === '/api/scheduler/tasks') {
        const body = (await parseBody(req)) as CreateTaskInput;
        log.info(`[scheduler-api] POST create task: ${JSON.stringify(body)}`);
        const task = cronEngine.addTask(body);
        log.info(`[scheduler-api] created task: ${task.name} (${task.id})`);
        json(res, 201, task);
        return;
      }

      // GET /api/scheduler/history
      if (req.method === 'GET' && path === '/api/scheduler/history') {
        const taskId = url.searchParams.get('taskId') ?? undefined;
        const limit = Number(url.searchParams.get('limit') ?? 50);
        json(res, 200, cronEngine.getHistory(taskId, limit));
        return;
      }

      // Match /api/scheduler/tasks/:id(/fire)
      const taskMatch = path.match(/^\/api\/scheduler\/tasks\/([^/]+)(\/fire)?$/);
      if (taskMatch) {
        const id = taskMatch[1];
        const isFire = !!taskMatch[2];

        if (req.method === 'PATCH' && !isFire) {
          const body = (await parseBody(req)) as UpdateTaskInput & { enabled?: boolean };
          const { enabled, ...patch } = body;
          let result;
          if (enabled !== undefined) {
            result = cronEngine.toggleTask(id, enabled);
          }
          if (Object.keys(patch).length > 0) {
            result = cronEngine.updateTask(id, patch);
          }
          if (!result) {
            json(res, 404, { error: 'task not found' });
            return;
          }
          json(res, 200, result);
          return;
        }

        if (req.method === 'DELETE' && !isFire) {
          cronEngine.removeTask(id);
          json(res, 200, { ok: true });
          return;
        }

        if (req.method === 'POST' && isFire) {
          const record = await cronEngine.fireNow(id);
          if (!record) {
            json(res, 404, { error: 'task not found' });
            return;
          }
          json(res, 200, record);
          return;
        }
      }

      json(res, 404, { error: 'not found' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`[scheduler-api] error: ${msg}`);
      json(res, 500, { error: msg });
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (typeof addr !== 'object' || !addr) {
        server.close();
        reject(new Error('failed to bind'));
        return;
      }
      const url = `http://127.0.0.1:${addr.port}`;
      schedulerApiServer = server;
      schedulerApiInfo = { url, password };
      getLogger().info(`[scheduler-api] listening at ${url}`);
      resolve(schedulerApiInfo);
    });
  });
}

export function stopSchedulerApi(): void {
  if (schedulerApiServer) {
    schedulerApiServer.close();
    schedulerApiServer = null;
    schedulerApiInfo = null;
  }
}
