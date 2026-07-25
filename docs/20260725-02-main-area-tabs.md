# 主区多 Tab 交互重构

## 背景

当前主区是路由驱动的单页：`/live` 渲染 `LiveSessionPage`（单会话），文件预览在右侧
dock 的 `InspectorShell`（一次只开一个 artifact，`PaneState.artifact` 单值）。

用户要求改为统一多 Tab：
1. 文件预览移到主区，顶部 tab，开几个文件几个 tab。
2. 会话也在主区，顶部 tab；多会话同时活跃（agent 并行）。
3. 右侧 dock 保留（终端/浏览器/上下文/文件浏览器）。

确认事项：统一 tab 栏（会话+文件混合，类似 VSCode 编辑器 tab）；dock 保留但移除其中的
文件预览；多会话同时活跃。

## 设计

### Tab 模型

主区顶部一个 `TabBar`，每个 tab 是一个"视图"：

```ts
type Tab =
  | { id: string; kind: "session"; sessionId: string | null; title: string }   // null = draft
  | { id: string; kind: "file"; artifact: ArtifactBlock; title: string };
```

- 状态存 `useUiStore`（in-memory，重启清空，与 `PaneState` 一致）：`tabs: Tab[]`、
  `activeTabId: string | null`。
- actions：`openSessionTab(sessionId)`、`openFileTab(artifact)`、`closeTab(id)`、
  `activateTab(id)`。
- 去重：session tab 按 `sessionId` 去重；file tab 按 `artifact.path` 去重；激活已存在则
  不新建。

### 会话 Tab

- 侧边栏点会话 -> `openSessionTab(id)`（而非直接 navigate）。
- 新建会话 -> `openSessionTab(null)`（draft tab）。
- **多会话活跃**：agent 事件流是全局的（`client.onEvent` 按 `sessionId` 分发到
  `threads`），`runningSessions` 记录在跑的会话。tab 切换只换 `currentId`，不中断 agent。
- **渲染策略（简化版）**：同时只渲染 active 会话 tab 的 `LiveSessionView`（单实例，
  按 `currentId` 渲染）。非 active 会话 tab 不挂载 DOM。切回时 `thread` 已在 store
  （loaded），内容不丢；滚动位置由 `scrollMemory`（per session）恢复。
  - 这满足"多会话同时活跃"（agent 后台跑，`runningSessions` 持续），同时避免多会话 DOM
    并存的复杂度与性能开销。
- composer 文本：当前是单一 draft。切走会话切回会丢未发送文本。本阶段把 draft 文本
  纳入 per-session（`drafts: Record<sessionId, string>`），切回恢复。**阶段一含此项**。

### 文件 Tab

- `openArtifact(artifact)` 改为 `openFileTab(artifact)`：开/激活 file tab，而非设
  `PaneState.artifact`。
- 文件预览组件 `InspectorShell`（+ `fileInspectorFromBlock`）从 dock 移到主区 file tab
  内容区。
- 多文件：每个 artifact 一个 tab，按 `artifact.path` 去重。

### Dock 变更

- 保留 `context`/`browser`/`terminal`/`files` 四个 tab（`Topicbar` + `WorkbenchDock` 不变）。
- 移除 `WorkbenchDock` 里的 artifact inspector 分支（`showArtifact`），文件预览不再走 dock。
- `PaneState.artifact` 字段废弃（保留以避免破坏 store 结构，但不再驱动 dock 渲染）。

### 路由协同

- 路由仍保留 `/live`、`/live/:id`、`/example/:id` 等用于深链接与刷新。
- **不自动开 tab**：进入 `/live(/:id)` 路由不再自动开 session tab--历史会话不默认
  占据 tab 栏。tab 只在用户主动操作时出现：侧边栏点会话（`Sidebar` 调
  `openSessionTab`）、新建会话（`startNew` 开 draft tab）。
- draft tab 在首条消息创建会话后，由 `afterTurn` 转为该会话 tab（更新已存在 tab 的
  `sessionId`，不是新开）。
- 会话 tab 激活时同步 URL（`TabBar` -> `navigate`），便于深链接。
- `example`（demo）会话本阶段仍走原 `SessionPage` 路由（不纳入 tab），留作阶段二。

### 组件拆分

- 新 `TabBar`：顶部 tab 栏（会话/文件混合，关闭按钮、激活态、运行指示）。
- `LiveSessionPage` 拆出 `LiveSessionView`：单会话渲染主体（对话 + composer + 右侧 dock），
  接收 `sessionId`。`LiveSessionPage` 退化为 tab 容器 + 路由协同。
- `FilePreviewTab`：包装 `InspectorShell`，作为 file tab 内容。

### 不做（边界）

- example/demo 会话纳入 tab（阶段二）。
- tab 拖拽排序、固定 tab（后续）。
- tab 跨重启持久化（in-memory）。
- 多会话 DOM 并存（多 `LiveSessionView` 同时挂载 hidden）--当前用单实例切换，足够满足
  "agent 后台并行"；若后续要"切走保留 composer 焦点/实时流可见"再升级。

### 分阶段实现

- **阶段一（本次）**：
  1. `useUiStore` 加 tab 状态 + actions。
  2. `TabBar` 组件。
  3. 文件预览 tab（`openFileTab` + `FilePreviewTab`，dock 移除 artifact 分支）。
  4. 会话 tab（`openSessionTab`，`LiveSessionView` 拆分，单实例切换，draft per-session）。
  5. 路由协同（`/live(/:id)` -> 开/激活会话 tab）。
- **阶段二（后续）**：example 会话 tab、tab 拖拽、多视图并存。

## 验证状态

- [ ] TabBar 渲染会话/文件混合 tab，切换/关闭正常。（待手动运行验证）
- [ ] 文件预览在主区 tab 打开，多文件切换，dock 不再显示 artifact。（待手动运行验证）
- [ ] 多会话 tab 切换，agent 后台继续运行（`runningSessions` 不中断）。（待手动运行验证）
- [ ] composer 文本切走切回保留（per-session draft）。（未实现，见下）
- [ ] 路由 `/live/:id` 深链接打开对应会话 tab。
- [ ] dock 的终端/浏览器/上下文/文件浏览器不受影响。
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 不回归（199/199）。
- [x] `pnpm build` 通过。

### 已知限制（本次未做）
- **composer 文本切走切回不保留**：当前 composer 文本是单一 draft，会话 tab 切换不
  保留各会话未发送文本。要支持需把 draft 纳入 per-session（`drafts: Record<sessionId,
  string>`）并改 `Composer`。留作后续增量。
- **WorkbenchDock 的 artifact 分支保留但休眠**：`openArtifact` 已全部改为 `openFileTab`，
  `PaneState.artifact` 不再被设置，dock 的 artifact inspector 不会触发；分支代码未删以
  降低风险，后续可清理。
- **example/demo 会话不纳入 tab**：仍走 `/example/:id` 的 `SessionPage` 路由（阶段二）。
