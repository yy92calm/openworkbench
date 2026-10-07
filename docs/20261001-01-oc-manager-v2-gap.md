# OC Manager v2 分支交互差异分析 —— 可吸收项盘点

日期：2026-10-01，序号 01

## 背景

`~/Desktop/OpenCode-Client` 的 `opencode-v2` 分支相对 `main` 领先 27 个 commit、改动 66 个文件。
这不是一次增量迭代，而是 **OpenCode 服务端 API 的整体换代**（路径前缀、响应信封、事件流、进程模型全面变化）。

OC Manager 为接 v2 写了一个 832 行的防腐层 `frontend/dist/core/v2compat.js`，把 v2 事件翻译回 v1 形状。
Workbench 当前仍走 v1（`packages/sdk` 的 `OpenCodeClient` 全部按 v1 形状消费），
因此**整体接 v2 不在本轮范围**——那是下一次 API 升级的大工程。

本轮盘点：**v2 分支里那些「与 API 形状无关、纯交互/界面层」的改进，有哪些值得单独吸收？**
工程层面的改进（版本检测 fail-safe、配置无损往返、能力标记驱动隐藏等）已在上一轮评估，结论是不吸收。

出处说明：正文所有 `文件:行` 均在 OC Manager `opencode-v2` 分支 `84a9e4a` 实际读取核实。

## Workbench 已有的交互能力

先盘点 Workbench 已经具备、不需要从 OC Manager 吸收的交互能力，避免重复劳动：

| # | 能力 | Workbench 实现位置 |
|---|------|-------------------|
| 1 | 自动滚到底 + 接近底部检测 | `LiveSessionPage.tsx:271-297`（`scrollToBottom`、`distFromBottom`） |
| 2 | 「滚到底」浮动按钮 | `LiveSessionPage.tsx`（`showScrollBtn` 状态） |
| 3 | 每个 Tab 独立记忆滚动位置 | React 组件卸载/重建天然保持 |
| 4 | 多会话 Tab + 快捷键切换 | `store.ts` + Tab 组件 |
| 5 | 侧栏宽度持久化 | `store.ts`（`SIDEBAR_KEY` localStorage） |
| 6 | 侧栏折叠/展开持久化 | `store.ts`（`SIDEBAR_COLLAPSED_KEY`） |
| 7 | 命令面板（Cmd+K） | `CommandPalette` 组件 |
| 8 | 工具调用耗时显示 | `ToolCallRow.tsx`（elapsed time） |
| 9 | 会话级 token 聚合 | `TokenUsage.tsx`（inspector 面板，总 input/output/cost） |
| 10 | 主题切换持久化 | `store.ts`（`THEME_KEY`） |
| 11 | Inspector 面板开关持久化 | `store.ts`（`inspectorOpen`） |
| 12 | 详情展开/折叠状态 | `store.ts`（`expandDetails`） |

## 建议吸收的交互改进（核实结论：均不需要实施）

三项候选项经深入核实后，结论均为**不需要实施**——要么 v1 API 不支持，要么 Workbench 已有等价方案。

### ① 向上滚动加载历史消息（分页加载）—— 已有替代方案

**OC Manager 的做法**（`frontend/dist/chat/session.js:460-518`）：cursor 分页，每次 `limit=200`，
滚动触发加载更早消息，cache correction 保持滚动位置。

**核实结论**：v1 API 的 `GET /session/:id/message` 不支持 cursor/limit 参数
（`OpenCodeClient.ts:262-268` 返回完整数组，整个 SDK 无任何分页抽象）。
真正的分页加载需要 v2 服务端支持。

**但 Workbench 已有等价方案**：`BlockList` 的 cold/warm split（`BlockList.tsx:202-249`）：

- `warmCount=40`：长会话只渲染最近 40 条 block；
- 更早的内容折叠在「展开更早历史（N 条）」按钮后面；
- `coldExpanded` 按会话持久化在 `Thread` 对象上（`runtime.ts:75`）；
- 点击按钮后展开全部冷历史。

这在**渲染层**解决了长会话的性能问题（不会一次渲染上千个 DOM 节点）。
数据仍然全量加载到内存，但对用户感知而言，效果与分页加载等价——
打开长会话时只看到最近的内容，想看更早的才展开。

**结论**：不吸收。等 v2 接入后再考虑真正的服务端分页。

### ② 每条消息内联 token 统计 —— v1 API 不支持

**OC Manager 的做法**（`frontend/dist/chat/render.js:199-234`）：每条 assistant 消息底部显示 token footer。

**核实结论**：v1 API **不返回 per-message token 数据**。通过代码核实（无需运行时验证）：

- `HistoryMessage` 类型（`packages/sdk/src/types.ts:216-239`）只有 `role`、`completed`、`parts` 三个字段，无 token；
- `getMessages` 的响应类型（`OpenCodeClient.ts:262-277`）只提取 `info.role` 和 `info.time.completed`；
- `SessionMeta`（`types.ts:161-185`）的 token 字段明确标注为 session 级聚合（"Total input tokens consumed by this session"）；
- SSE 事件 `session.updated`（`OpenCodeClient.ts:860-884`）携带 token 数据，但也是 session 级聚合；
- `ThreadBlock` 联合类型（`packages/shared/src/index.ts:136-280`）的所有成员均无 token 字段。

Token 数据在 v1 中只存在于 session 级别（`listSessions` + `session.updated`），无法拆分到每条消息。

**结论**：无法实现。需要 v2 服务端在 message 响应中增加 per-message token 字段。

### ③ 步骤分隔线（Step dividers）—— 已实现

**OC Manager 的做法**（`frontend/dist/chat/render.js:683-699`）：在工具调用轮次之间插入分隔线。

**核实结论**：Workbench **已经实现**了 turn divider：

- `TurnDividerBlock` 类型（`packages/shared/src/index.ts:269-271`）；
- `TurnDivider` 组件（`apps/desktop/src/renderer/components/thread/TurnDivider.tsx`）渲染灰色细线 + 居中文字；
- `runtime.ts:320` 和 `runtime.ts:1795` 在每个 user message 前插入 `turn-divider` block；
- 测试用例验证了此行为（`runtime.test.ts:346-347`、`runtime.store.test.ts:220-223`）。

OC Manager 的分隔线额外显示 token 统计和时间戳，但这依赖 per-message token 数据（②），v1 无法支持。
Workbench 的 turn divider 目前只显示可选的 `label` 文字，视觉上已经起到了区分轮次的作用。

**结论**：已实现，不需要吸收。

## 验证状态

### 已核实

- OC Manager `opencode-v2` 分支相对 `main` 领先 27 commit、66 文件改动。
- `session.js:460-518` 的 cursor 分页加载、`:1420-1450` 的滚动触发、`:612-641` 的 cache correction 均已读取源码确认。
- `render.js:199-234` 的 per-message token footer、`:683-699` 的 step divider 均已读取源码确认。
- `render.js:207` 的 cache correction 逻辑（`input + cache.read` = 真实 input）已确认。
- `style.css:1956, :1966, :2006, :2017` 的 token 显示样式已确认。
- Workbench 的 `OpenCodeClient.ts:262-268` 的 `getMessages` 无分页参数，一次性加载全部消息。
- Workbench 已有 12 项交互能力（见上表），均已在对应文件核实。
- **v1 `HistoryMessage` 不携带 per-message token 统计**（代码核实，无需运行时验证）：
  - `HistoryMessage` 类型（`packages/sdk/src/types.ts:216-239`）只有 `role`、`completed`、`parts`；
  - `SessionMeta`（`types.ts:161-185`）的 token 字段为 session 级聚合；
  - SSE `session.updated` 事件（`OpenCodeClient.ts:860-884`）携带 session 级 token；
  - `ThreadBlock` 联合类型（`packages/shared/src/index.ts:136-280`）所有成员均无 token 字段。
- **v1 API 不支持 cursor 分页**：整个 SDK 无任何 `cursor`/`limit`/`pagination` 抽象，
  所有端点均为 flat GET 返回完整数组。
- **Workbench 已实现 turn divider**：
  - `TurnDividerBlock`（`packages/shared/src/index.ts:269-271`）+ `TurnDivider` 组件；
  - `runtime.ts:320` 和 `runtime.ts:1795` 在每个 user message 前插入 turn-divider；
  - 测试用例验证（`runtime.test.ts:346-347`、`runtime.store.test.ts:220-223`）。
- **Workbench 已实现 cold/warm split**：
  - `BlockList.tsx:202-249`，`warmCount=40`，长会话只渲染最近 40 条；
  - `coldExpanded` 按会话持久化（`runtime.ts:75, :1486-1490`）。

### 明确不吸收的项

| 项 | 原因 |
|----|------|
| ① 向上滚动分页加载 | v1 API 不支持 cursor 分页；Workbench 已有 cold/warm split 等价方案 |
| ② 每条消息内联 token 统计 | v1 API 无 per-message token 数据，无法实现 |
| ③ 步骤分隔线 | Workbench 已实现（`TurnDividerBlock` + `TurnDivider` 组件） |
| v2 防腐层（`v2compat.js` 832 行） | Workbench 还没决定何时接 v2；接的时候也应当由 `packages/sdk` 的适配器层承担 |
| v2 守护进程生命周期 | Workbench 当前是 sidecar 模式，与守护进程模型不兼容 |
| 版本检测 fail-safe / sameMajor 守门 | 工程层面改进，上轮已评估不吸收 |
| 配置无损往返（Extra 模式） | 工程层面改进，上轮已评估不吸收 |
| 能力标记驱动隐藏 | 工程层面改进，上轮已评估不吸收 |
| 项目树重建 single-flight + tombstone | 储备项，等 v2 接入时若观察到闪烁再做 |
| 凭据多 key 面板 | 前置条件（safeStorage）未完成，本轮不做 |
| 会话导出/导入/移动 | 依赖 v2 服务端支持 |
| Worktree / Branch 面板 | 已明确暂缓 |
| Terminal 面板 | Workbench 已有 `packages/terminal` |
| 命令面板 | Workbench 已有 `CommandPalette` |

### 既有发现（前轮文档已记录，本轮未变）

- `apps/desktop/tsconfig.json` 的 `files: []` + references 结构导致 `tsc --noEmit`（不带 `-b`）是空操作，
  typecheck 门禁形同虚设。完整检查需用 `tsc --noEmit -p tsconfig.web.json`，会暴露约 32 个预存类型错误。
  修复会让 CI 变红，需单独排期。
- **Provider key 明文存储**：Workbench 当前把 provider API key 明文写在 `app-config/.opencode/config.json`，
  没有使用 Electron `safeStorage` 或系统 keychain。这是安全隐患，需单独排期修复。
