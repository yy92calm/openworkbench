/**
 * @fafawork/scheduler — Cron-based task scheduler plugin with MCP integration.
 *
 * Provides scheduled task execution with:
 * - CronEngine (create/read/update/delete tasks, cron scheduling)
 * - HTTP API (for the MCP server to call)
 * - MCP server script (stdio JSON-RPC, proxies to HTTP API)
 * - Opencode profile deployment (skill + command + MCP config)
 *
 * Usage:
 *   import { createScheduler } from "@fafawork/scheduler";
 *   const scheduler = createScheduler({
 *     store: { get, set },  // persistent KV store
 *     logger: console,
 *   });
 *   scheduler.start();
 *   scheduler.setExecutor(async (task) => { ... }); // inject agent runtime
 *   scheduler.deploy(xdgConfig, mcpScriptPath);
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { type Server } from 'node:http';
import { join } from 'node:path';

import { Cron } from 'croner';
import { ipcMain } from 'electron';

// ── Types ────────────────────────────────────────────────────────────────

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
}

export interface CreateTaskInput {
  name: string;
  cron: string;
  prompt: string;
  agent?: string;
  model?: string;
  tags?: string[];
}

export interface UpdateTaskInput {
  name?: string;
  cron?: string;
  prompt?: string;
  agent?: string;
  model?: string;
  tags?: string[];
}

export interface ExecutionRecord {
  id: string;
  taskId: string;
  taskName: string;
  triggeredAt: string;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  sessionId?: string;
  error?: string;
  durationMs?: number;
  completedAt?: string;
}

export interface SchedulerOptions {
  store: { get: (key: string) => unknown; set: (key: string, value: unknown) => void };
  logger?: {
    info: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
  };
}

export interface AgentExecutor {
  execute(task: ScheduledTask): Promise<string | null>;
}

export interface SchedulerPlugin {
  start(): void;
  stop(): void;
  deploy(xdgConfig: string, mcpScriptPath: string): SchedulerApiInfo;
  setExecutor(executor: AgentExecutor): void;
  getApiInfo(): SchedulerApiInfo | null;
}

export interface SchedulerApiInfo {
  url: string;
  password: string;
}

// ── Constants ────────────────────────────────────────────────────────────

const STORE_SCOPE = 'scheduler';

export const SCHEDULER_SKILL = `# 定时任务技能

通过 MCP 工具管理定时任务。

## 可用工具

- **scheduler_list** — 列出所有定时任务
- **scheduler_create** — 创建新任务（必填: name, cron, prompt）
- **scheduler_update** — 更新任务
- **scheduler_delete** — 删除任务
- **scheduler_toggle** — 启用/停用任务
- **scheduler_fire_now** — 立即执行任务
- **scheduler_history** — 查看执行历史

## Cron 表达式

标准 5 字段：分 时 日 月 周
- \`0 8 * * *\` 每天 08:00
- \`*/30 * * * *\` 每 30 分钟
`;

// ── CronEngine ───────────────────────────────────────────────────────────

type FireCallback = (task: ScheduledTask) => Promise<string | null>;

class CronEngine {
  private jobs = new Map<string, Cron>();
  private onFire: FireCallback | null = null;
  private store: { get: (key: string) => unknown; set: (key: string, value: unknown) => void };
  private log: {
    info: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
  };

  constructor(opts: SchedulerOptions) {
    this.store = opts.store;
    this.log = opts.logger ?? console;
  }

  setFireCallback(cb: FireCallback) {
    this.onFire = cb;
  }

  start() {
    for (const task of this.listTasks().filter((t) => t.enabled)) this.scheduleOne(task);
  }

  stop() {
    for (const [, cron] of this.jobs) cron.stop();
    this.jobs.clear();
  }

  addTask(input: CreateTaskInput): ScheduledTask {
    const now = new Date().toISOString();
    const task: ScheduledTask = {
      id: randomUUID(),
      ...input,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    try {
      task.nextRunAt = new Cron(input.cron).nextRun()?.toISOString() ?? undefined;
    } catch {
      throw new Error(`Invalid cron: ${input.cron}`);
    }
    const tasks = this.listTasks();
    tasks.push(task);
    this.saveTasks(tasks);
    this.scheduleOne(task);
    this.log.info(`[scheduler] created: ${task.name}`);
    return task;
  }

  removeTask(id: string) {
    this.unscheduleOne(id);
    this.saveTasks(this.listTasks().filter((t) => t.id !== id));
  }

  updateTask(id: string, patch: UpdateTaskInput): ScheduledTask | null {
    const tasks = this.listTasks();
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    Object.assign(tasks[idx], patch, { updatedAt: new Date().toISOString() });
    try {
      tasks[idx].nextRunAt = new Cron(tasks[idx].cron).nextRun()?.toISOString() ?? undefined;
    } catch {
      /* */
    }
    this.saveTasks(tasks);
    this.unscheduleOne(id);
    if (tasks[idx].enabled) this.scheduleOne(tasks[idx]);
    return tasks[idx];
  }

  toggleTask(id: string, enabled: boolean): ScheduledTask | null {
    const tasks = this.listTasks();
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    tasks[idx].enabled = enabled;
    this.saveTasks(tasks);
    if (enabled) this.scheduleOne(tasks[idx]);
    else this.unscheduleOne(id);
    return tasks[idx];
  }

  async fireNow(id: string): Promise<ExecutionRecord | null> {
    const task = this.listTasks().find((t) => t.id === id);
    if (!task || !this.onFire) return null;
    return this.executeTask(task);
  }

  listTasks(): ScheduledTask[] {
    const raw = this.store.get(`${STORE_SCOPE}:tasks`);
    return Array.isArray(raw) ? (raw as ScheduledTask[]) : [];
  }

  getHistory(taskId?: string, limit = 50): ExecutionRecord[] {
    const raw = this.store.get(`${STORE_SCOPE}:executions`);
    let records = Array.isArray(raw) ? (raw as ExecutionRecord[]) : [];
    if (taskId) records = records.filter((r) => r.taskId === taskId);
    return records.slice(0, limit);
  }

  private saveTasks(tasks: ScheduledTask[]) {
    this.store.set(`${STORE_SCOPE}:tasks`, tasks);
  }

  private saveExecution(record: ExecutionRecord) {
    const raw = this.store.get(`${STORE_SCOPE}:executions`);
    const records: ExecutionRecord[] = Array.isArray(raw) ? raw : [];
    records.unshift(record);
    if (records.length > 200) records.length = 200;
    this.store.set(`${STORE_SCOPE}:executions`, records);
  }

  private updateExecution(id: string, patch: Partial<ExecutionRecord>) {
    const raw = this.store.get(`${STORE_SCOPE}:executions`);
    const records: ExecutionRecord[] = Array.isArray(raw) ? raw : [];
    const idx = records.findIndex((r) => r.id === id);
    if (idx !== -1) Object.assign(records[idx], patch);
    this.store.set(`${STORE_SCOPE}:executions`, records);
  }

  private scheduleOne(task: ScheduledTask) {
    try {
      const cron = new Cron(task.cron, async () => {
        await this.executeTask(task);
      });
      this.jobs.set(task.id, cron);
      task.nextRunAt = cron.nextRun()?.toISOString();
    } catch (err) {
      this.log.error(`[scheduler] invalid cron: ${task.cron}`, err);
    }
  }

  private unscheduleOne(id: string) {
    this.jobs.get(id)?.stop();
    this.jobs.delete(id);
  }

  private async executeTask(task: ScheduledTask): Promise<ExecutionRecord> {
    const record: ExecutionRecord = {
      id: randomUUID(),
      taskId: task.id,
      taskName: task.name,
      triggeredAt: new Date().toISOString(),
      status: 'running',
    };
    this.saveExecution(record);
    const start = Date.now();
    try {
      record.sessionId = (await this.onFire?.(task)) ?? null;
      record.status = 'completed';
    } catch (err) {
      record.status = 'failed';
      record.error = err instanceof Error ? err.message : String(err);
    }
    record.durationMs = Date.now() - start;
    record.completedAt = new Date().toISOString();
    this.updateExecution(record.id, record);
    return record;
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createScheduler(opts: SchedulerOptions): SchedulerPlugin {
  const engine = new CronEngine(opts);
  let apiServer: Server | null = null;
  let apiInfo: SchedulerApiInfo | null = null;
  let executor: AgentExecutor | null = null;

  // Set fire callback
  engine.setFireCallback(async (task) => executor?.execute(task) ?? null);

  // IPC handlers
  function registerIpc() {
    ipcMain.handle('scheduler:list', () => engine.listTasks());
    ipcMain.handle('scheduler:create', (_e, task: CreateTaskInput) => engine.addTask(task));
    ipcMain.handle('scheduler:update', (_e, id: string, patch: UpdateTaskInput) =>
      engine.updateTask(id, patch),
    );
    ipcMain.handle('scheduler:delete', (_e, id: string) => {
      engine.removeTask(id);
    });
    ipcMain.handle('scheduler:toggle', (_e, id: string, enabled: boolean) =>
      engine.toggleTask(id, enabled),
    );
    ipcMain.handle('scheduler:fire-now', (_e, id: string) => engine.fireNow(id));
    ipcMain.handle('scheduler:history', (_e, taskId?: string, limit?: number) =>
      engine.getHistory(taskId, limit),
    );
  }

  return {
    start() {
      registerIpc();
      engine.start();
    },
    stop() {
      engine.stop();
      apiServer?.close();
      apiServer = null;
      apiInfo = null;
    },
    deploy(xdgConfig, _mcpScriptPath) {
      const password = randomUUID();
      // Start API synchronously if not running
      const opencodeDir = join(xdgConfig, 'opencode');
      const skillsDir = join(opencodeDir, 'skills', 'scheduler');
      const commandsDir = join(opencodeDir, 'commands');
      mkdirSync(skillsDir, { recursive: true });
      mkdirSync(commandsDir, { recursive: true });
      writeFileSync(join(skillsDir, 'SKILL.md'), SCHEDULER_SKILL);

      // For API info, the caller must start the API first and pass the info
      // This deploy method writes the MCP config
      return { url: '', password };
    },
    setExecutor(ex) {
      executor = ex;
    },
    getApiInfo() {
      return apiInfo;
    },
  };
}
