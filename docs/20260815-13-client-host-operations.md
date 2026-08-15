# Client 直达桌面端操作方案

> 扩展 remote client：在原会话页之上加底部 Tab 导航，新增「任务」「文件」
> 「设置」三个页面，让远端用户直接操作桌面端的工作区、定时任务和配置。
> 这些功能不走 sidecar HTTP API，而是通过 RelayHost 拦截 `/__host/*`
> 路径，直接调用桌面端 main process 的函数。

## 背景

当前 client（`client/`）只有会话相关功能：连接设备、会话列表/创建/删除、
会话内发消息。这些请求通过 `RelayHttpTransport` 经 relay 转发到桌面端
sidecar 的 OpenCode HTTP API。

桌面端 main process 还有一批 IPC API（`scheduler:*`、`set-workspace`、
`list-dir`、`read-artifact`、`relay-status` 等），它们操作的是 Electron
本地资源（文件系统、electron-store、cron 引擎），sidecar 无法触达。
client 要用这些功能，必须让 RelayHost 在转发到 sidecar 之前拦截请求，
直接调用 main process 的函数。

## 设计

### 协议扩展

复用现有 `/__relay/write-file` 的拦截先例（[relayHost.ts](../../apps/desktop/src/main/relayHost.ts) 的 `handleWriteFile`），
新增 `/__host/*` 路径前缀。RelayHost 在 `handleMessage` 中，遇到
`msg.path` 以 `/__host/` 开头时，不转发到 sidecar，而是路由到对应的
main process 函数，返回 JSON。

**不改动 relay 服务器**：relay 仍是透明字节转发器，`/__host/*` 对它而言
就是普通的 HTTP 路径。**不改动 sidecar**：这些路径从不到达 sidecar。

### 路由表

REST 风格，路径参数用 `:id` 表示。响应统一为 JSON。

#### 工作区 / 文件夹

| 路径 | 方法 | 调用 | 入参 | 返回 |
| --- | --- | --- | --- | --- |
| `/__host/workspace` | GET | `workspaceDir()` + `baseWorkspaceDir()` | — | `{ current, base }` |
| `/__host/workspace` | PUT | `setWorkspace(path)` | `{ path }` | `{ path }` |
| `/__host/workspace/dated` | POST | `newDatedWorkspace(name)` | `{ name }` | `{ path }` |
| `/__host/workspace/list` | GET | `artifactFile.listDir(rel, root)` | query: `rel`, `root` | `{ name, is_dir, is_file, size }[]` |
| `/__host/artifact` | GET | `artifactFile.readArtifact(path)` | query: `path`, `root` | `{ content, binary }` |
| `/__host/notebooks` | GET | `artifactFile.listNotebooks(root)` | query: `root` | `{ name, path, modified }[]` |

#### 定时任务

| 路径 | 方法 | 调用 | 入参 | 返回 |
| --- | --- | --- | --- | --- |
| `/__host/scheduler/tasks` | GET | `cronEngine.listTasks()` | — | `ScheduledTask[]` |
| `/__host/scheduler/tasks` | POST | `cronEngine.addTask(body)` | `CreateTaskInput` | `ScheduledTask` |
| `/__host/scheduler/tasks/:id` | PATCH | `cronEngine.updateTask(id, body)` | `UpdateTaskInput` | `ScheduledTask \| null` |
| `/__host/scheduler/tasks/:id` | DELETE | `cronEngine.removeTask(id)` | — | `{ ok: true }` |
| `/__host/scheduler/tasks/:id/toggle` | POST | `cronEngine.toggleTask(id, body.enabled)` | `{ enabled }` | `ScheduledTask \| null` |
| `/__host/scheduler/tasks/:id/fire` | POST | `cronEngine.fireNow(id)` | — | `ExecutionRecord \| null` |
| `/__host/scheduler/history` | GET | `cronEngine.getHistory(taskId, limit)` | query: `taskId`, `limit` | `ExecutionRecord[]` |
| `/__host/scheduler/history/:execId` | DELETE | `cronEngine.deleteExecution(execId)` | — | `{ ok: true }` |
| `/__host/scheduler/history` | DELETE | `cronEngine.clearHistory(taskId)` | query: `taskId` | `{ ok: true }` |

#### 设置 / 配置

| 路径 | 方法 | 调用 | 入参 | 返回 |
| --- | --- | --- | --- | --- |
| `/__host/relay/status` | GET | `relayHost.getStatus()` + store 读取 | — | `{ status, config: { enabled, relayUrl, deviceId, tokenSet } }` |
| `/__host/profile/manifest` | GET | profile manifest 读取 | — | `unknown` |

### 鉴权

复用现有 relay 鉴权：guest 必须带正确 token 才能连上 relay，relay 只
转发已认证连接的消息。host 侧 `handleMessage` 已在已认证 WS 上运行，
无需额外校验。

### 数据流

```
client Tab 点击
  │
  ▼
HostClient.fetch("/__host/scheduler/tasks")
  │
  ▼
RelayHttpTransport → relay (透明转发) → host WebSocket
  │
  ▼
RelayHost.handleMessage(msg)
  │  msg.path = "/__host/scheduler/tasks"
  ▼
handleHostApi(ws, msg)         ← 新增拦截分支
  │  解析路径 → 路由到 cronEngine.listTasks()
  ▼
响应 head(200) + chunk(JSON) + done
  │
  ▼
client 收到 JSON → 渲染页面
```

### Host 侧实现

在 [relayHost.ts](../../apps/desktop/src/main/relayHost.ts) 中新增 `handleHostApi` 方法，
在 `handleMessage` 的拦截链里加在 `/__relay/write-file` 之后、sidecar 转发之前：

```typescript
if (msg.path.startsWith("/__host/")) {
  await this.handleHostApi(ws, msg);
  return;
}
```

`handleHostApi` 内部用一个简单的路由匹配（基于 `method` + 路径正则），
调用对应的 main process 函数，把结果序列化为 JSON 通过 `head/chunk/done`
发回。错误返回 `{ error }` + 对应 status。

依赖的 main process 模块都已 export，直接 import：
- `cronEngine` from `./scheduler`
- `artifactFile` from `./artifact_file`（`import * as`）
- `workspaceDir`, `baseWorkspaceDir`, `setWorkspace`, `newDatedWorkspace` from `./server`
- `relayHost` 自身的 `getStatus()` + `getStore` 读 relay 配置

### Client 端结构

**设计原则**：视觉风格和信息架构与桌面端一致（同样的页面划分、同样的
字段、同样的状态展示、同样的 Tailwind token），但**交互模式偏 App**
（client 主要在手机/平板上用，不适合桌面端的左右分栏、hover 按钮、
宽表格等交互）。

具体差异：

| 维度 | 桌面端 | client（App 风格） |
| --- | --- | --- |
| 导航 | 左侧 Sidebar | 底部 Tab Bar |
| 文件浏览 | 左右分栏（目录树 + 预览并排） | 栈式导航（点文件夹进入下一级，点文件全屏预览，返回键回退） |
| 任务列表 | 卡片 + hover 按钮组 | 卡片 + 点击展开操作（底部 action sheet） |
| 执行历史 | 宽表格 | 卡片列表（每条记录一张小卡） |
| 表单 | 居中弹窗 | 全屏页面（移动端键盘友好） |
| 确认操作 | 居中 ConfirmDialog | 底部 action sheet 或全屏确认页 |
| 触控目标 | 28-32px | ≥ 44px（iOS HIG） |

```
client/sdk/src/hostClient.ts         新增：封装 /__host/* 调用
client/sdk/src/types.ts              新增：ScheduledTask/ExecutionRecord/DirEntry 等类型镜像
client/src/lib/connection.ts         暴露 getHostClient()
client/src/lib/electronShim.ts       新增：把桌面端 electron API 调用映射到 HostClient
client/src/App.tsx                   改为底部 Tab 导航 + 栈式路由
client/src/pages/SessionsPage.tsx    现有：会话列表（改为 Tab 之一）
client/src/pages/TasksPage.tsx       App 风格任务列表（卡片 + 展开操作）
client/src/pages/TaskFormPage.tsx    全屏表单页（新建/编辑）
client/src/pages/HistoryPage.tsx     全屏执行历史（卡片列表）
client/src/pages/FilesPage.tsx       App 风格目录浏览（栈式导航）
client/src/pages/FilePreviewPage.tsx 全屏文件预览
client/src/pages/SettingsPage.tsx    relay 状态卡片（紧凑表单）
client/src/components/scheduler/     任务卡片组件（App 适配版）
client/src/components/ActionSheet.tsx 底部操作菜单组件
client/src/styles.css                Tab 导航 + App 风格样式 + 桌面端 token
```

**复用策略**：复制桌面端的类型定义和 HostClient 调用逻辑，但组件
重新实现为 App 风格（不机械复制桌面端组件文件）。视觉 token
（`bg-surface` / `text-muted` / `border-border` / `accent` 等）和
图标库（lucide-react）与桌面端一致，保证品牌感统一。

#### HostClient

复用 `RelayHttpTransport.fetchImpl`，封装一层 typed 方法：

```typescript
export class HostClient {
  constructor(private fetch: (url: string, init?: RequestInit) => Promise<Response>) {}

  // Workspace
  getWorkspace(): Promise<{ current: string; base: string }> { ... }
  setWorkspace(path: string): Promise<{ path: string }> { ... }
  newDatedWorkspace(name: string): Promise<{ path: string }> { ... }
  listDir(rel: string, root?: string): Promise<DirEntry[]> { ... }
  readArtifact(path: string, root?: string): Promise<{ content: string; binary: boolean } | null> { ... }

  // Scheduler
  listTasks(): Promise<ScheduledTask[]> { ... }
  createTask(input: CreateTaskInput): Promise<ScheduledTask> { ... }
  updateTask(id: string, patch: UpdateTaskInput): Promise<ScheduledTask | null> { ... }
  deleteTask(id: string): Promise<void> { ... }
  toggleTask(id: string, enabled: boolean): Promise<ScheduledTask | null> { ... }
  fireNow(id: string): Promise<ExecutionRecord | null> { ... }
  getHistory(taskId?: string, limit?: number): Promise<ExecutionRecord[]> { ... }

  // Settings
  getRelayStatus(): Promise<{ status: string; config: {...} }> { ... }
}
```

类型定义复用 `packages/shared`（如果已 export）或在 `hostClient.ts` 本地
定义一份镜像类型（client 是独立 workspace，不 import 桌面端代码）。

#### Tab 导航

App.tsx 改造为底部 Tab（移动端友好，桌面端是左侧 Sidebar 但 web 端
窄屏更适合底部 Tab）。视觉与桌面端 token 一致：

```
┌─────────────────────────┐
│                         │
│   (当前 Tab 的页面内容)   │  ← 桌面端主区相同布局
│                         │
├─────────────────────────┤
│ [会话] [任务] [文件] [设置] │  ← 底部固定 Tab Bar
└─────────────────────────┘
```

- 4 个 Tab：会话（现有）、任务（新）、文件（新）、设置（新）
- 选中态用 accent 色 + 顶部小条（与桌面端 Sidebar 选中条一致）
- 移动端 PWA 友好，Tab 高度 ≥ 44px

#### TasksPage（App 风格）

任务列表页，信息与桌面端一致但交互 App 化：

- 顶部标题栏：「定时任务」+ 右上角 `+` 图标按钮（新建）
- 任务卡片：状态点 + 名称 + humanCron + enabled 开关（右滑可露出删除）
  - 点击卡片 → 展开内嵌区域：上次/下次执行时间 + prompt 预览（mono）+ agent + tags
  - 展开后底部按钮组：立即执行 / 编辑 / 历史（三个 ≥44px 触控按钮）
- 空状态：「还没有定时任务，点击 + 创建第一个」
- 每 15 秒自动刷新
- toast 提示（触发成功/失败）

#### TaskFormPage（全屏表单）

新建/编辑任务的全屏页面（从右侧滑入），移动端键盘友好：

- 顶部导航栏：`<` 返回 + 标题（新建/编辑）+ 右上角保存
- 表单字段（垂直堆叠，每个字段 ≥44px 触控区）：
  - 名称（text input）
  - 执行计划（picker：预设计划 or 自定义 cron）
  - cron 输入（mono，带 humanCron 预览）
  - 提示词（textarea，自动撑高）
  - Agent（picker）
  - 模型（text input）
  - 标签（text input，逗号分隔）
- 保存后返回列表页 + toast

#### HistoryPage（全屏执行历史）

从任务卡片展开的「历史」按钮进入，全屏卡片列表：

- 顶部导航栏：`<` 返回 + 任务名
- 卡片列表（每条记录一张卡）：触发时间 + 状态徽标 + 耗时
  - 失败记录：展开显示 error 文本
  - 有 sessionId：显示「查看对话」按钮（跳转到会话页）
- 右上角「清空」按钮（带确认 action sheet）

#### FilesPage（App 风格栈式导航）

目录浏览，点文件夹进入下一级，点文件全屏预览：

- 顶部导航栏：
  - 根目录：标题「文件」+ 当前 base 路径
  - 子目录：`<` 返回上级 + 面包屑（可点击跳转）
- 列表项（全宽，≥48px 高度）：
  - 文件夹：Folder 图标（accent）+ 名称 + `>` 箭头
  - 文件：类型图标 + 名称 + 大小
- 空状态：「此文件夹为空」
- 点击文件夹 → push 新目录到导航栈
- 点击文件 → 进入 FilePreviewPage

#### FilePreviewPage（全屏预览）

- 顶部导航栏：`<` 返回 + 文件名
- 内容区：
  - 文本/代码：滚动显示内容（等宽字体）
  - 图片：`<img>` 居中 + 可缩放
  - 其他类型：「该文件类型暂不支持预览」
- 不支持编辑（只读）

#### SettingsPage（紧凑卡片）

relay 状态卡片，与桌面端 RemoteCard 信息一致但更紧凑：

- 卡片头：RadioTower 图标 + 标题 + 状态徽标（点 + 文字）
- relayUrl 输入框（mono）
- deviceId（带复制按钮）+ token 输入框（password）
- 连接/断开按钮（全宽 ≥44px）
- 状态枚举：off / connecting / connected / error
- 由于 client 本身是远端，这里的"断开"含义是：让桌面端 host 断开与 relay 的连接

### 改动清单

| 项目 | 文件 | 改动 |
| --- | --- | --- |
| host | `apps/desktop/src/main/relayHost.ts` | 新增 `handleHostApi()` 拦截 `/__host/*`，路由到 cronEngine/workspace/artifactFile |
| host | `apps/desktop/src/main/ipc.ts` | （可能）导出 `cronEngine` 实例（如未导出） |
| client | `client/sdk/src/hostClient.ts` | 新增 HostClient，封装 `/__host/*` 调用 |
| client | `client/sdk/src/types.ts` | 新增类型镜像（ScheduledTask/ExecutionRecord/DirEntry/CreateTaskInput/UpdateTaskInput） |
| client | `client/src/lib/electronShim.ts` | 新增：把 `schedulerList` 等调用映射到 HostClient |
| client | `client/src/lib/connection.ts` | 暴露 `getHostClient()` |
| client | `client/src/App.tsx` | 改为底部 Tab 导航 + 栈式路由 |
| client | `client/src/pages/TasksPage.tsx` | App 风格任务列表（卡片 + 展开） |
| client | `client/src/pages/TaskFormPage.tsx` | 全屏表单页（新建/编辑） |
| client | `client/src/pages/HistoryPage.tsx` | 全屏执行历史（卡片列表） |
| client | `client/src/pages/FilesPage.tsx` | App 风格目录浏览（栈式导航） |
| client | `client/src/pages/FilePreviewPage.tsx` | 全屏文件预览 |
| client | `client/src/pages/SettingsPage.tsx` | 紧凑 relay 状态卡片 |
| client | `client/src/components/ActionSheet.tsx` | 底部操作菜单组件 |
| client | `client/src/components/TaskCard.tsx` | App 适配版任务卡片 |
| client | `client/src/styles.css` | Tab 导航 + App 样式 + 桌面端 token |

### 边界与不做的事

- **不改动 relay 服务器**：`/__host/*` 是 host 侧拦截，relay 透明转发
- **不改动 sidecar**：这些路径不转发到 sidecar
- **不实现文件写入/上传**：本期文件功能只读（浏览 + 预览），避免远端误写。
  写入能力留待后续迭代（已有 `/__relay/write-file` 可复用）
- **不实现 provider/model 修改**：设置页只展示，不修改（修改走桌面端 UI）
- **写操作确认**：切换工作区、删除任务等有副作用的操作，client UI 加确认弹窗
- **历史会话标记**：上一方案（`20260815-12-remote-session-badge.md`）的
  远端会话徽标与本方案独立，互不影响

### 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| `/__host/*` 路径与未来 sidecar 路径冲突 | `__host` 前缀带双下划线，sidecar 不会用这种命名 |
| 远端误删任务/切错工作区 | 所有写操作加确认弹窗；删除任务返回前再次确认 |
| main process 函数抛异常 | `handleHostApi` 全 try/catch，异常返回 500 + `{ error }` |
| client 类型与 host 不同步 | 类型镜像放 `client/sdk/src/types.ts`，注释标明「与 host 同步」 |
| 移动端 Tab 误触 | Tab 高度 ≥ 44px，间距充足 |

## 验证状态

- [ ] host: `handleHostApi` 拦截 `/__host/*` 并路由到对应函数
- [ ] host: 工作区 API（GET/PUT workspace, POST dated, list, read, notebooks）
- [ ] host: 定时任务 API（CRUD + toggle + fire + history）
- [ ] host: 设置 API（relay status）
- [ ] host: 错误处理（异常 → 500 + `{ error }`）
- [ ] client: `HostClient` 封装所有 `/__host/*` 调用
- [ ] client: App.tsx 改为底部 Tab 导航
- [ ] client: TasksPage（列表/创建/编辑/删除/启停/历史）
- [ ] client: FilesPage（工作区信息/切换/目录浏览/文件预览）
- [ ] client: SettingsPage（relay 状态展示）
- [ ] client: 写操作确认弹窗
- [ ] TypeScript 编译通过（host + client 两个 workspace）
- [ ] 运行时验证：远端创建任务后桌面端可见
- [ ] 运行时验证：远端切换工作区后会话列表刷新
- [ ] 运行时验证：远端浏览文件内容正确
