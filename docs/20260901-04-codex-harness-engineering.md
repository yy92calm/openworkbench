# Codex 工程模式落地（上下文审计 / 安全脱敏 / 定时预算）

## 背景

对标 OpenAI Codex Core 的工程模式（见 `~/Documents/Workbench/harness-optimization-guide.md`），
Workbench 作为 OpenCode sidecar 的外壳，其可借鉴点在**壳层工程**而非 sidecar 内部逻辑。
本方案选取三条高价值、可独立测试的改造：上下文压缩审计快照（Codex 双历史）、
provenance 敏感信息脱敏（Codex「密钥不进日志」铁律）、定时任务每日运行上限（Codex 预算护栏）。

其余候选（子代理树视图、TTFT、反馈闭环、fork 会话、sidecar 自愈、启动预热等）列入
「后续路线」，本次不实现。

## 设计

### 1. Provenance 敏感信息脱敏（`apps/desktop/src/main/provenance.ts`）

**目标**：`recordProvenance` 落盘的 `input`/`output` 可能包含 API key、token、密码等敏感值
（AGENTS.md 明确要求「API keys 不进入 provenance/logs」）。

- 新增纯函数 `redactSensitive(value: unknown): unknown`：
  - 遍历任意嵌套 object/array。
  - 当**键名**匹配 `/token|secret|password|authorization|api[_ -]?key|access[_ -]?key/i` 时，
    值整体替换为 `"[REDACTED]"`。
  - 字符串值若含内联 `sk-...`/`Bearer ...` 模式，替换为 `[REDACTED]`。
  - 保持 JSON 结构（除敏感键外原样保留）。
- `recordProvenance` 写入前对 `input`、`output` 调用脱敏。
- 纯函数无 Node/Electron 依赖 → 独立单测。

### 2. 上下文压缩审计快照（新增 `apps/desktop/src/main/snapshot.ts`）

**目标**：对标 Codex `review_history`（压缩只改模型历史、原始证据保留）。每次 sidecar
触发 `session.compacted` 时，把当前会话 transcript 快照落盘，形成可审计的压缩边界。

- 新增主进程模块 `snapshot.ts`：
  - `writeCompactionSnapshot(dir, { sessionId, historyVersion, messages, triggeredAt })`：
    写 `.workbench/compaction-snapshots/{sessionId}-{historyVersion}.json`；
    超过 `SNAPSHOT_CAP`（20）时按时间清理最旧的同会话快照。
  - `historyVersion` 由渲染层按「每个会话本地计数」维护（sidecar 不暴露该字段）。
- IPC：新增 `write-compaction-snapshot` handler。
- preload + `electron.d.ts`：新增 `writeCompactionSnapshot(payload)`。
- 渲染层 `runtime.ts`：`applyEvent` 中 `session.compacted` 分支（已有 UI 提示）追加：
  `client.getMessages(sessionId) → window.electronAPI.writeCompactionSnapshot(...)`，
  fire-and-forget，失败仅打日志，不影响会话。
- 快照文件与 provenance JSONL 同目录（`.workbench/`），互为补充：provenance 记工具调用，
  快照记压缩边界时的完整对话。

### 3. 定时任务每日运行上限（`apps/desktop/src/main/scheduler.ts`）

**目标**：无人值守定时任务缺少预算护栏（Codex `rollout_budget` 的壳层对应）。给任务加
「每日最大运行次数」，超限跳过并记录 `skipped`，防止异常循环烧钱。

- `ScheduledTask` / `CreateTaskInput` / `UpdateTaskInput` 增加可选 `maxRunsPerDay?: number`。
- `executeTask` 开头守卫：
  - 纯函数 `countTodayRuns(records, taskId, now)`：统计今天（本地日期）已完成的触发次数
    （含 `running`/`completed`/`failed`，不含 `skipped`）。
  - `maxRunsPerDay` 存在且 `todayRuns >= maxRunsPerDay` → 记录 `status: 'skipped'`、
    `error: 'daily run limit reached'` 的执行记录并返回，不调用 `onFire`。
- `ExecutionRecord.status` 增加 `'skipped'`；`ExecutionHistory.tsx` STATUS_MAP 加对应文案。
- `TaskForm.tsx` 增加可选数字输入（0 = 不限，留空 = 不限）。
- 守卫逻辑抽成纯函数 → 独立单测（mock `getStore`）。

## 涉及文件

| 文件 | 改动 |
| --- | --- |
| `apps/desktop/src/main/redact.ts` | 新增：`redactSensitive` 纯函数（脱敏核心，无依赖） |
| `apps/desktop/src/main/provenance.ts` | 写入前对 `input`/`output` 调 `redactSensitive` |
| `apps/desktop/src/main/redact.test.ts` | 新增：脱敏用例（6） |
| `apps/desktop/src/main/snapshot.ts` | 新增：压缩快照写盘 + 按版本清理（cap 20） |
| `apps/desktop/src/main/snapshot.test.ts` | 新增：写盘/空载荷/上限/多会话用例（4） |
| `apps/desktop/src/main/ipc.ts` | 新增 `write-compaction-snapshot` handler |
| `apps/desktop/src/preload/index.ts` | 暴露 `writeCompactionSnapshot` |
| `apps/desktop/src/renderer/electron.d.ts` | 类型更新 |
| `apps/desktop/src/renderer/lib/runtime.ts` | `session.compacted` 时抓取并落盘快照（每会话版本计数） |
| `apps/desktop/src/main/schedulerGuards.ts` | 新增：`countTodayRuns` / `shouldSkipDueToDailyLimit` 纯函数 |
| `apps/desktop/src/main/schedulerGuards.test.ts` | 新增：每日上限守卫用例（8） |
| `apps/desktop/src/main/scheduler.ts` | `maxRunsPerDay` + `executeTask` 守卫 + `skipped` 状态 + `touchTaskRun` |
| `apps/desktop/src/renderer/lib/electron.ts` | 渲染层类型同步（maxRunsPerDay / skipped） |
| `apps/desktop/src/renderer/components/scheduler/ExecutionHistory.tsx` | `skipped` 文案「已跳过」 |
| `apps/desktop/src/renderer/components/scheduler/TaskForm.tsx` | 每日最大运行次数输入 |
| `apps/desktop/scripts/mcp_scheduler.mjs` | create/update 工具 schema 增加 `maxRunsPerDay` |

## 验证状态

- [x] `pnpm format:check` 通过
- [x] `pnpm lint` 通过
- [x] `pnpm typecheck` 通过（desktop）
- [x] `pnpm test` 通过（desktop 280 + relay 22 + sdk）
- [x] `pnpm md:check` 通过（68 文件 0 错误）
- [ ] 手动：触发长对话自动压缩 → `.workbench/compaction-snapshots/` 出现快照

## 后续路线（本次不实现）

- 子代理树视图（`parentId` 数据已在，缺 UI 聚合）
- TTFT 首 token 延迟指标 + UI 展示
- 消息 👍/👎 反馈写入 provenance
- fork 会话（复制上下文开新分支）
- sidecar 崩溃 watchdog 自动重启 + 「上次任务被中断」标记
- 启动时预热 `/event` 连接 + `/config` 健康检查
- 上下文占比按 `cacheReadTokens` 修正活动上下文
