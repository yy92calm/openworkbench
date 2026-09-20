# 01 · 桌面壳与主进程（apps/desktop）

> 所属：架构现状系列 · [返回索引](./README.md)

## 1. 进程模型

Electron 三个隔离进程，依赖单向流动：

```text
renderer（React，src/renderer）
  → preload（contextBridge，src/preload/index.ts）
  → main（Electron 主进程，src/main）
  → packages/sdk
  → opencode sidecar（HTTP + SSE，本地随机端口）
```

- 主窗口 `windows.ts` 的 `webPreferences`：`contextIsolation: true`、
  `nodeIntegration: false`、`sandbox: false`、`webviewTag: true`。窗口状态由
  `electron-window-state` 持久化。
- 渲染层与 agent 的**会话事件不走 IPC**：SSE 直连 sidecar；IPC 只承担桌面
  集成能力（sidecar 生命周期、文件、内核、profile、调度、relay、房间、终端）。
- `index.ts` 单实例锁 + `second-instance` 聚焦已有窗口；`userData` 路径按
  渠道（`APP_IDS[CHANNEL]`）隔离。

## 2. 启动与退出

启动顺序（`index.ts` 的 `app.whenReady()`）：

1. 设置 `userData` 路径 → `registerIpcHandlers()`（含终端 handler 注册）
2. `getBrowserMcp().start()`（浏览器 MCP 的 IPC + 下载监听 + 本地 HTTP API）
3. `deployBundledProfile()`（详见 [02](./02-config-and-security.md)）
4. 若 store 中 relay 配置完整（`enabled && deviceId && token`），自动
   `relayHost.start(...)`；缺字段则不连接，等设置页保存
5. `startPreviewServer()` → `setupAutoUpdater()` → `createMainWindow()`

退出清理在 `before-quit` / `will-quit` / `SIGINT` / `SIGTERM` 四处同构执行：
`cronEngine.stop()` → `stopSidecar()` → `stopSchedulerApi()` → `killAllKernels()`
→ `stopPreviewServer()`。`relayHost` / `roomPeer` 不做显式停止，WS 随进程退出
断开。

## 3. 主进程模块

### 外壳基础模块

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| 生命周期 | `index.ts` | 启动/退出编排、relay 自动连接 |
| 渠道常量 | `constants.ts` | dev/beta/prod 命名与 ID |
| 窗口 | `windows.ts` | 主窗口创建与状态持久化、dock 图标 |
| IPC 注册 | `ipc.ts` | 83 个 `ipcMain.handle`（见第 4 节） |
| KV 存储 | `store.ts` | electron-store 按 scope 缓存 |
| 日志 | `logging.ts` | electron-log 统一日志与导出 |
| Shell 环境 | `shell_env.ts` | PATH 增强、shell/工具探测 |
| 自动更新 | `updater.ts` | electron-updater（dev 渠道禁用） |
| 桥接 | `../preload/index.ts` | contextBridge 暴露面 |

### 能力模块

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| Sidecar 运行时 | `server.ts` | 拉起/停止 `opencode serve`、profile 部署、workspace 解析、沙箱包装 |
| 工作区文件 | `artifact_file.ts` | 文件读写、artifact 解析、目录列举、预览上限 25MB |
| 代码内核 | `kernel.ts` | Python/R 一次性子进程执行 |
| 终端 | `terminal.ts` | node-pty 多会话（renderer 侧 xterm） |
| 调度器 | `scheduler.ts` + `schedulerGuards.ts` | CronEngine + 本地 HTTP API + MCP 桥 |
| 溯源/快照 | `provenance.ts` + `snapshot.ts` + `redact.ts` | provenance JSONL、压缩快照、敏感值脱敏 |
| 预览服务 | `preview_server.ts` | 带 token 的本地静态文件服务 |
| 网页抓取 | `browser.ts` | HTTP 抓页 + HTML 转文本（`browser:fetch`） |
| 浏览器 MCP | `browser-mcp-server.ts` | 构建期 shim，指向 `@fafawork/browser-mcp/mcp-server` |
| 远端 | `relayHost.ts` + `roomPeer.ts` + `relay-protocol.ts` | host 转发、房间 peer、协议本地副本 |
| 宏观洞察 | `macro.ts` + `macroData.ts` + `macroNotify.ts` + `rotationHistory.ts` + `research.ts` | 公开行情/宏观/行业数据、快照缓存与推送、轮动评分与评分历史、决策台账与通知 |
| 语音 | `whisper.ts` | whisper.cpp STT（TTS 在渲染层） |
| 沙箱 | `sandbox/`（manager/bwrap/seatbelt/policy/types） | OS 级执行隔离 |
| Profile 覆盖 | `profilePatch.ts` + `syncDir.ts` | 用户覆盖层与增量镜像 |

## 4. IPC 面

`preload/index.ts` 通过 `contextBridge.exposeInMainWorld('electronAPI', api)`
暴露：`browserMcpPreload` 展开项 + 按域显式方法（runtime / workspace /
artifact / kernel / provenance / snapshot / preview / tools / shell / store /
profile / relay / room / logging / updater / scheduler / browser / whisper /
window）。

注意两点：

- preload 还暴露了两个**泛化通道** `on(channel, cb)` 与 `invoke(channel, ...)`，
  渲染层可触达任意已注册的 `ipcMain.handle`；通道白名单在 renderer 侧而非
  preload 侧。安全边界依赖 `contextIsolation: true` 与渲染层代码可信。
- 终端 handler 在 `terminal.ts` 的 `registerTerminalHandlers()` 注册，浏览器
  MCP 的 `browser:*` handler 在 `packages/browser-mcp` 内注册，均不在 `ipc.ts`。

`ipc.ts` 通道分类（代表项）：

| 域 | 通道 |
| --- | --- |
| App 元信息 | `channel-name`、`app-identifier`、`app-version` |
| Runtime | `start-runtime`、`restart-runtime`、`stop-runtime`、`runtime-password`、`server-url`、`sandbox-status` |
| Workspace | `workspace-path`、`workspace-base`、`set-workspace`、`set-workspace-base`、`new-dated-workspace`、`pick-folder` |
| 文件/artifact | `read-artifact`、`resolve-artifact`、`save-text-file`、`list-dir`、`write-workspace-file`、`add-files-to-workspace`、`add-text-to-workspace`、`list-notebooks`、`preview-url` |
| Kernel | `kernel-execute`、`kernel-reset` |
| 溯源 | `record-provenance`、`list-provenance`、`read-env-lockfile`、`write-compaction-snapshot` |
| Profile | `profile-manifest`、`profile-interaction`、`profile-explain-config`、`profile-validate-patch`、`profile-write-patch` |
| 调度器 | `scheduler:list/create/update/delete/toggle/fire-now/history/delete-execution/clear-history` |
| Relay | `relay-status`、`relay-start`、`relay-stop`、`relay-set-keep-awake`、`relay-remote-sessions` |
| 宏观洞察 | `macro-dashboard`、`macro-series`、`macro-industry`、`macro-notifications`、`macro-notifications-read`、`macro-export-report`、`macro-reports`、`macro-report-read`、`macro-regenerate` |
| 投研闭环 | `research-decisions`、`research-add-decision`、`research-attribute`、`research-update-decision`、`research-delete-decision`、`research-export`、`research-digest` |
| Room | `room-create/validate/join/leave/send/send-file/upload-file/upload-blob/download-file/pick-file/save-dialog/viewed/set-view-once/send-session-share/status` |
| 其他 | `store-*`、`log-debug`、`log-event`、`export-logs`、`check-for-updates`、`detect-tools`、`open-path`、`open-url` |

主进程 → 渲染层的推送事件：`relay-status-changed`、
`relay-remote-sessions-changed`、`room-event`、`browser:panel`、
`macro-dashboard-updated`、`macro-notification`、`macro-reports-updated`、
`terminal:data:<id>`、`terminal:exit:<id>`。

## 5. Sidecar 启动链路

`server.ts` 的 `startSidecar()`：

1. 取空闲端口，建 `runtime/{xdg-config,xdg-data,xdg-cache,xdg-state}` 四目录
2. `deployBundledProfile()`（镜像 + 用户覆盖 + patch + provider 配置）
3. `startSchedulerApi(密码)` → `deploySchedulerProfile(...)` → `getBrowserMcp().deploy(...)`
   （把调度器 skill/command 与两个 MCP server 注入 opencode.json）
4. 组装 env：`OPENCODE_SERVER_PASSWORD`（每进程生成一次 UUID）、四个 XDG 变量、
   `HOME`、增强 PATH
5. `migrateStaleDatabase()`：用 `opencode --version` 指纹判断 schema 失配，
   失配时删除 `opencode.db*`（仅版本升级才清会话库）
6. `wrapSpawn()` 按沙箱策略包装；`spawn` 后 `waitForReady(url, 15s)` 轮询

sidecar 密码由 `getServerPassword()` 单例生成，同时用于 sidecar Basic auth、
调度器 API Basic auth 和 relayHost 转发注入。

### 工作区解析

用文件而非 store：`runtime/active-workspace.txt`（当前工作区）与
`runtime/base-workspace.txt`（基准目录），默认基准为 `~/Documents/Workbench`。
切换工作区会触发渲染层 `kernelReset` 与 SSE 重连。

## 6. SDK 与运行时接入（packages/sdk）

- **唯一边界**：`OpenCodeClient`（`src/OpenCodeClient.ts`）实现 REST + SSE
  客户端；`agent-runtime/` 定义 `AgentRuntime` 接口与跨后端归一化事件。
- **事件归一化** `normalize()`：把 sidecar 原始 SSE 映射为 12 种统一事件——
  `text.updated`（全量文本，非增量）、`reasoning.updated`、`tool.updated`
  （含 task 子会话 `childSessionId`）、`session.idle`、`session.updated`
  （token/cost）、`session.status`（busy/idle/retry）、`session.compacted`、
  `error`、`question.*`、`permission.*`。兼容 V1/V2 事件名与双字段命名。
- **连接两条路径**：浏览器/WKWebView 优先 `EventSource`（认证走
  `?auth_token=base64(user:pass)`，因为 EventSource 不能设 header）；Node/测试
  路径用流式 `fetch` + `readStream`。浏览器侧依赖 EventSource 自动重连；
  渲染层另有 `connectRetry(120 次，前 8 次 250ms，之后 1s)` 兜底（见
  [03-renderer](./03-renderer.md)）。
- **后端抽象**：`createAgentRuntime({kind})` 工厂支持 `opencode` 与
  `claude-code`（动态 import `@anthropic-ai/claude-agent-sdk`）。实际接线：
  - 主进程调度器使用工厂创建 opencode client（连接重试 5 次）；
  - 渲染层仍直接 `new OpenCodeClient`（`runtime.ts:749`）；
  - `ClaudeCodeAdapter` 多个方法为 stub（`answerQuestion` 抛错、
    `listSkills/listCommands/listMcpServers` 返回空），且渲染层对
    `claude-code` 只提示「手动连接」。**Claude Code 后端当前不可对话**，
    详见[差异清单](./07-doc-code-gaps.md)。
- `index.ts` 只导出类型（避免渲染层打包进 Node-only 适配器）；
  `@workbench/sdk/agent-runtime` 仅供主进程导入。

## 7. 文件速查

| 主题 | 文件 |
| --- | --- |
| 启动/退出 | `apps/desktop/src/main/index.ts` |
| IPC | `apps/desktop/src/main/ipc.ts`、`apps/desktop/src/preload/index.ts` |
| Sidecar/部署 | `apps/desktop/src/main/server.ts` |
| SDK | `packages/sdk/src/{OpenCodeClient.ts,types.ts,agent-runtime/*}` |
| 窗口/存储 | `apps/desktop/src/main/{windows.ts,store.ts}` |
