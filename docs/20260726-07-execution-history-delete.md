# 任务执行历史支持删除

## 背景

定时任务的执行历史（`ExecutionRecord`）目前只读，无法删除，记录持续累积（上限 200 条）。需要支持删除单条记录与清空，并且执行记录与会话保持独立--删除会话不影响执行记录，删除执行记录不影响会话。

## 设计

### 后端（`main/scheduler.ts` + `main/ipc.ts`）

`CronEngine` 新增两个方法（操作 electron-store `workbench.scheduler` scope 的 `executions` key）：

- `deleteExecution(id)`：按记录 id 删除单条。
- `clearHistory(taskId?)`：无参清空全部；传 `taskId` 只清空该任务的记录。

IPC 新增两个 handler：

- `scheduler:delete-execution` (id)
- `scheduler:clear-history` (taskId?)

执行记录存于 electron-store，与会话（opencode 侧）完全独立。`runtime.ts:deleteSession` 不触碰 scheduler store，删除会话不会联动删除执行记录；反之亦然。本次明确保持该独立性，不加任何联动。

### 前端

- `preload/index.ts` / `electron.d.ts` / `renderer/lib/electron.ts` / `renderer/lib/tauri.ts`：补 `schedulerDeleteExecution` / `schedulerClearHistory` 封装。
- `ExecutionHistory.tsx`：
  - 每行操作列在「查看对话」旁加「删除」按钮（`Trash2` 图标），点击弹 `ConfirmDialog` 确认后删除单条。
  - 顶部右侧加「清空」按钮：带 `taskId` 时为「清空该任务记录」，不带时为「清空全部」，弹确认后调用 `schedulerClearHistory`。
  - 删除 / 清空后重新拉取历史刷新。
  - 文案沿用中文。

### 不做

- 不扩展 MCP HTTP API / scheduler skill（用户未要求 MCP 删除历史）。
- 不改执行记录上限（200）。
- 不联动会话删除（明确保持独立）。

## 验证状态

- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 199/199 不回归。
- [x] `pnpm lint` 改动文件 0 新 error（`ipc.ts`/`scheduler.ts` 既存的 `require()` error 与本次无关）。
- [ ] 单条记录可删除；清空按钮可清空（全部 / 按任务）。（待人工验证）
- [ ] 删除会话后，执行记录仍在；删除执行记录后会话不受影响。（待人工验证）
