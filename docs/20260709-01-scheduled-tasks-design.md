# 定时任务方案设计

## 设计

### 概述

为 Workbench 桌面端增加轻量级定时任务系统。用户通过 TasksPage 界面配置周期性 Agent 提示词，同时 OpenCode Agent 也可通过自然语言对话创建和管理定时任务。任务触发时，Electron 主进程中的 cron 引擎自动发起 Agent 会话执行。

### 设计原则

- **最小依赖**：使用 `croner`（零依赖、TypeScript 原生、14KB），不引入重型平台。
- **复用现有架构**：不新增侧车服务。调度引擎在主进程运行，UI 在渲染进程，Agent 执行通过现有 `@workbench/sdk`。
- **配置驱动**：Agent 侧调度能力以 skill 形式放在 `app-config/.opencode/`，与项目打包者控制配置的模型一致。
- **本地优先**：所有调度数据存储在 `electron-store`（userData 下的 JSON 文件），无云端依赖。

### 架构

```text
┌─────────────────────────────────────────────────────────────────────┐
│  Electron 主进程                                                     │
│                                                                     │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐  │
│  │ scheduler.ts         │    │ store.ts (scope: scheduler)      │  │
│  │  - CronEngine 类     │◀──▶│  - tasks: ScheduledTask[]        │  │
│  │  - start/stop/reload │    │  - executions: ExecutionRecord[] │  │
│  │  - croner 实例       │    └──────────────────────────────────┘  │
│  │  - 调度器指令常量     │                                          │
│  │  - deployScheduler-  │                                          │
│  │    Profile()         │                                          │
│  └────────┬─────────────┘                                          │
│           │ 触发时                                                  │
│           ▼                                                        │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐  │
│  │ OpenCodeClient       │───▶│  OpenCode 侧车                   │  │
│  │ (HTTP + SSE)         │    │  sendPrompt(task.prompt)          │  │
│  └──────────────────────┘    │  ← 运行时注入的 scheduler skill  │  │
│                              │     (非 app-config，代码生成)     │  │
│                              └──────────────────────────────────┘  │
│                                                                     │
│  server.ts: deployBundledProfile() → deploySchedulerProfile()       │
│                                                                     │
│  IPC 通道:                                                          │
│  scheduler:list / create / update / delete / toggle / history       │
│  scheduler:fire-now（手动触发）                                      │
│  scheduler:on-execution（主进程 → 渲染进程推送）                      │
└─────────────────────────────────────────────────────────────────────┘
         │ IPC
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  渲染进程                                                            │
│                                                                     │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐  │
│  │ TasksPage.tsx        │    │ Agent 对话（LiveSession）          │  │
│  │  - 任务列表 + CRUD   │    │  "每天早上8点帮我查XX基金净值"      │  │
│  │  - Cron 表达式构建器  │    │  → @scheduler skill              │  │
│  │  - 执行历史          │    │  → scheduler:create IPC          │  │
│  └──────────────────────┘    └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 数据模型

#### ScheduledTask

```typescript
interface ScheduledTask {
  id: string;               // UUID v4
  name: string;             // 人类可读标签
  cron: string;             // Cron 表达式（如 "0 8 * * 1-5"）
  prompt: string;           // 发送给 Agent 的提示词
  agent?: string;           // 可选指定 Agent（如 "market-researcher"）
  model?: string;           // 可选指定模型
  enabled: boolean;         // 开关，无需删除即可停用
  createdAt: string;        // ISO 8601
  updatedAt: string;        // ISO 8601
  lastRunAt?: string;       // ISO 8601
  nextRunAt?: string;       // ISO 8601（由 croner 计算）
  tags?: string[];          // UI 中用于筛选
}
```

#### ExecutionRecord

```typescript
interface ExecutionRecord {
  id: string;               // UUID v4
  taskId: string;           // 关联 ScheduledTask
  taskName: string;         // 冗余字段，便于展示
  triggeredAt: string;      // ISO 8601
  status: "running" | "completed" | "failed" | "timeout";
  sessionId?: string;       // OpenCode 会话 ID
  error?: string;           // 失败时的错误信息
  durationMs?: number;      // 执行耗时
  completedAt?: string;     // ISO 8601
}
```

### 模块设计

#### 1. 主进程：`apps/desktop/src/main/scheduler.ts`

新增模块。职责如下：

- `CronEngine` 类，封装 `croner`：
  - `start()`：从 store 加载所有启用的任务，创建 croner 实例
  - `stop()`：停止所有 croner 实例
  - `reload()`：停止全部，从 store 重新加载，重新启动
  - `addTask(task)`：校验、持久化到 store、调度
  - `removeTask(id)`：取消调度、从 store 删除
  - `updateTask(id, patch)`：更新 store、重新加载
  - `toggleTask(id, enabled)`：启停，不删除
  - `fireNow(id)`：立即执行一次任务
  - `getHistory(taskId?, limit?)`：查询执行记录
- cron 触发时：使用任务的 prompt（及可选的 agent/model）调用 `OpenCodeClient.sendPrompt()`。记录执行开始。通过 SSE 监听会话完成/失败，更新执行记录。
- 应用退出时：`stop()` 所有 croner。

依赖：

- `croner`（npm）—— `import { Cron } from "croner"`
- `electron-store`（项目已有）—— scope 为 `"workbench.scheduler"`
- `@workbench/sdk` —— `OpenCodeClient` 用于触发 Agent 会话

### 2. IPC 通道：`apps/desktop/src/main/ipc.ts`

新增 handler：

```typescript
// 调度器 CURD
ipcMain.handle("scheduler:list", () => scheduler.listTasks());
ipcMain.handle("scheduler:create", (_e, task: CreateTaskInput) => scheduler.addTask(task));
ipcMain.handle("scheduler:update", (_e, id: string, patch: UpdateTaskInput) => scheduler.updateTask(id, patch));
ipcMain.handle("scheduler:delete", (_e, id: string) => scheduler.removeTask(id));
ipcMain.handle("scheduler:toggle", (_e, id: string, enabled: boolean) => scheduler.toggleTask(id, enabled));
ipcMain.handle("scheduler:fire-now", (_e, id: string) => scheduler.fireNow(id));
ipcMain.handle("scheduler:history", (_e, taskId?: string, limit?: number) => scheduler.getHistory(taskId, limit));

// 主进程向渲染进程推送事件
// 通过 webContents.send() 发送执行状态更新
```

### 3. 预加载桥接：`apps/desktop/src/preload/index.ts`

新增：

```typescript
// 调度器
schedulerList: () => ipcRenderer.invoke("scheduler:list"),
schedulerCreate: (task: CreateTaskInput) => ipcRenderer.invoke("scheduler:create", task),
schedulerUpdate: (id: string, patch: UpdateTaskInput) => ipcRenderer.invoke("scheduler:update", id, patch),
schedulerDelete: (id: string) => ipcRenderer.invoke("scheduler:delete", id),
schedulerToggle: (id: string, enabled: boolean) => ipcRenderer.invoke("scheduler:toggle", id, enabled),
schedulerFireNow: (id: string) => ipcRenderer.invoke("scheduler:fire-now", id),
schedulerHistory: (taskId?: string, limit?: number) => ipcRenderer.invoke("scheduler:history", taskId, limit),
onSchedulerEvent: (callback: (event: SchedulerEvent) => void) => {
  const handler = (_e: unknown, event: SchedulerEvent) => callback(event);
  ipcRenderer.on("scheduler:event", handler);
  return () => ipcRenderer.removeListener("scheduler:event", handler);
},
```

### 4. 渲染进程：`apps/desktop/src/renderer/app/routes/TasksPage.tsx`

替换占位页面，实现完整管理界面：

**布局：**

- 头部：标题 + 「新建任务」按钮
- 任务列表：卡片展示名称、cron（人类可读）、下次执行、上次执行状态、启用开关
- 点击卡片 → 展开详情（prompt、agent、model、执行历史）
- 「新建任务」按钮 → 弹窗/抽屉表单

**Cron 构建器：**

- 预设下拉：每小时、每天早上8点、工作日早上9点、每周一、每月1号、自定义
- 自定义模式：可视化 cron 表达式构建器（5 个字段：分、时、日、月、周）
- 表达式下方显示人类可读预览

**表单字段：**

- 名称（文本输入）
- Cron 表达式（预设选择器 + 自定义构建器）
- 提示词（文本域，必填）
- Agent（可选下拉，选项来自 `useRuntimeStore.agents`）
- 模型（可选下拉，选项来自 `useRuntimeStore.providers`）
- 标签（可选，逗号分隔）

**执行历史：**

- 每个任务的历史表格：触发时间、状态徽章、耗时、会话链接
- 全局历史视图（所有任务）

### 5. Agent 集成：MCP Server + 运行时注入（非 app-config）

`app-config/` 由用户手动替换，因此调度器的 skill 和 command 不能放在 `app-config/` 中。改为在应用代码中定义，每次启动时由主进程写入运行时配置目录。

**核心问题：** 仅注入 SKILL.md 只能给 Agent 提供说明，无法提供可调用的工具。Agent 尝试使用 OpenCode 内置 scheduler 时会遇到 DB schema 兼容问题。

**解决方案：** 提供一个独立的 MCP Server，向 Agent 暴露 `scheduler_*` 系列工具。Agent 通过 MCP 协议直接调用，完全不依赖 OpenCode 内置调度功能。

**架构：**

```text
Agent (OpenCode sidecar)
  │ MCP protocol (stdio)
  ▼
mcp_scheduler.mjs  ←── 零依赖 Node.js 脚本
  │ HTTP (JSON + Basic Auth)
  ▼
Electron 主进程 Scheduler API (127.0.0.1:随机端口)
  │
  ▼
CronEngine (croner + electron-store)
```

**实现要点：**

1. **`apps/desktop/scripts/mcp_scheduler.mjs`** — 独立 MCP Server 脚本
   - 零依赖，直接实现 JSON-RPC 2.0 over stdio
   - 暴露 7 个工具：`scheduler_list/create/update/delete/toggle/fire_now/history`
   - 通过 HTTP 代理到 Electron 主进程的 Scheduler API
   - 通过环境变量 `SCHEDULER_API_URL` 和 `SCHEDULER_API_TOKEN` 获取连接信息

2. **`scheduler.ts` 新增 Scheduler HTTP API**
   - 在 `127.0.0.1` 随机端口启动轻量 HTTP 服务
   - 提供 RESTful 端点：`GET/POST /api/scheduler/tasks`, `PATCH/DELETE /api/scheduler/tasks/:id`, `POST /api/scheduler/tasks/:id/fire`, `GET /api/scheduler/history`
   - 使用与 OpenCode sidecar 相同的 Basic Auth 密码

3. **`deploySchedulerProfile()` 更新**
   - 接受 `mcpScriptPath` 和 `apiInfo` 参数
   - 将 MCP Server 配置写入 `opencode.json` 的 `mcp` 字段
   - 更新 SKILL.md 明确指引 Agent 使用 MCP 工具而非 OpenCode 内置调度

4. **`electron-builder.config.ts`**
   - `extraResources` 新增 `scripts/mcp_scheduler.mjs` 打包项

### 6. 界面状态

### 空状态

无任务时，显示当前占位内容，附带引导：「创建你的第一个定时任务」。

### 列表视图

```text
┌──────────────────────────────────────────────────────────────┐
│  定时任务                                      [+ 新建任务]   │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ ● 每日市场简报           08:00  周一至周五    [开关]     ││
│  │   上次执行：2小时前 · 已完成 · 12秒                       ││
│  │   下次执行：明天 08:00                                     ││
│  └──────────────────────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────────────────────┐│
│  │ ○ 周度净值报告           09:00  每周一        [开关]     ││
│  │   上次执行：6天前 · 已完成 · 45秒                         ││
│  │   下次执行：3天后 09:00                                    ││
│  └──────────────────────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────────────────────┐│
│  │ ● 基金风险预警           每30分钟           [开关]       ││
│  │   上次执行：18分钟前 · 失败 · 错误：超时                   ││
│  │   下次执行：12分钟后                                       ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

### 新建/编辑弹窗

```text
┌─────────────────────────────────────────────┐
│  新建定时任务                           [X]  │
│                                              │
│  名称           [每日市场简报            ]   │
│                                              │
│  执行计划       [每天早上8点  ▾]            │
│  Cron: 0 8 * * 1-5                           │
│  → 每周一至周五 08:00 执行                     │
│                                              │
│  提示词         [                           ]│
│                 [查询今日市场热点，生成      ]│
│                 [简报并保存到 workspace      ]│
│                                              │
│  Agent（可选）  [market-researcher  ▾]       │
│  模型（可选）   [默认                ▾]       │
│  标签（可选）   [市场, 日报             ]     │
│                                              │
│                              [取消] [保存]   │
└─────────────────────────────────────────────┘
```

### 执行历史

```text
┌──────────────────────────────────────────────────────────────┐
│  执行历史 — 每日市场简报                                     │
│                                                              │
│  触发时间           状态      耗时    会话                    │
│  ─────────────────────────────────────────────────────────── │
│  2026-07-09 08:00  已完成    12秒    #abc123 →               │
│  2026-07-08 08:00  已完成    14秒    #def456 →               │
│  2026-07-07 08:00  失败       2秒    —                       │
│    错误：MCP wind 连接超时                                    │
│  2026-07-04 08:00  已完成    11秒    #ghi789 →               │
└──────────────────────────────────────────────────────────────┘
```

### 实施计划

### 第一阶段：核心引擎（主进程）

| # | 文件 | 操作 |
|---|------|------|
| 1 | `apps/desktop/package.json` | 添加 `croner` 依赖 |
| 2 | `apps/desktop/src/main/scheduler.ts` | 创建 `CronEngine` 类 + 调度器指令字符串常量 + `deploySchedulerProfile()` |
| 3 | `apps/desktop/src/main/ipc.ts` | 添加 7 个调度器 IPC handler |
| 4 | `apps/desktop/src/main/server.ts` | `startSidecar()` 中调用 `deploySchedulerProfile()` |
| 5 | `apps/desktop/src/main/index.ts` | 应用启动时启动调度器，退出时停止 |

### 第二阶段：预加载 + 渲染进程桥接

| # | 文件 | 操作 |
|---|------|------|
| 6 | `apps/desktop/src/preload/index.ts` | 添加调度器 API 方法 + 事件监听 |
| 7 | `apps/desktop/src/renderer/lib/electron.ts` | 添加带类型的包装函数 |
| 8 | `packages/shared/src/index.ts` | 添加 `ScheduledTask`、`ExecutionRecord` 类型 |

### 第三阶段：TasksPage 界面

| # | 文件 | 操作 |
|---|------|------|
| 9 | `apps/desktop/src/renderer/app/routes/TasksPage.tsx` | 替换占位页面为完整 UI |
| 10 | `apps/desktop/src/renderer/components/scheduler/TaskCard.tsx` | 任务卡片组件 |
| 11 | `apps/desktop/src/renderer/components/scheduler/TaskForm.tsx` | 新建/编辑表单弹窗 |
| 12 | `apps/desktop/src/renderer/components/scheduler/CronBuilder.tsx` | Cron 表达式构建器 |
| 13 | `apps/desktop/src/renderer/components/scheduler/ExecutionHistory.tsx` | 历史记录表格 |

### 第四阶段：打磨

| # | 任务 |
|---|------|
| 14 | 错误处理：无效 cron 表达式、执行失败告警 |
| 16 | 任务执行时 Toast 通知 |
| 17 | 侧边栏显示活跃任务数量徽章 |
| 18 | 测试：调度器引擎单元测试、TasksPage 组件测试 |

### 依赖

| 包名 | 用途 | 大小 | 协议 |
|------|------|------|------|
| `croner` | Cron 解析 + 调度 | ~14KB | MIT |
| `uuid` | 任务/执行记录 ID 生成 | ~4KB | MIT |

两个包均为 Electron 应用常用依赖，无需原生模块。

### 方案对比

| 维度 | croner（选用） | n8n 侧车 | Windmill 侧车 | BullMQ |
|------|---------------|----------|---------------|--------|
| 包体积 | ~14KB | ~500MB+ | ~300MB+ | ~200KB + Redis |
| 安装复杂度 | `npm install` | Docker/Node 服务 | Docker/Rust | Docker/Redis |
| UI 集成 | 原生 React | iframe（风格割裂） | iframe（风格割裂） | 无 |
| Agent 对话 | 通过 OpenCode skill | 通过 n8n AI 节点 | 通过 Windmill AI Chat | 无 |
| 离线支持 | 支持 | 支持 | 支持 | 不支持（需 Redis） |
| 架构匹配度 | 同进程 | 新侧车 | 新侧车 | 新服务 |

croner 方案零运维开销，与现有 UI 和 Agent 模式完全融合。n8n、Windmill、Kestra 等重型平台更适合独立服务端部署，不适合嵌入桌面应用。

## 验证状态

| 验证项 | 状态 | 备注 |
|--------|------|------|
| 方案评审 | 已通过 | 确认 croner + MCP Server + 运行时注入方案 |
| 代码实现 | 进行中 | 第一至三阶段已完成，MCP Server 已实现，第四阶段待实施 |
| TypeScript 编译 | 已通过 | `tsc --noEmit` 无错误 |
| MCP Server 独立运行 | 已通过 | `initialize` + `tools/list` 响应正常 |
| 单元测试 | 未开始 | — |
| 集成测试 | 未开始 | — |
| 用户验收 | 未开始 | — |
