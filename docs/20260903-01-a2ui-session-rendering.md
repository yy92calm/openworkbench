# 20260903-01 会话渲染支持 A2UI（Agent-Driven Interfaces）

## 背景与目标

A2UI（[a2ui.org](https://a2ui.org/)，Google 牵头的 Apache-2.0 标准）让 agent 以声明式 JSON 消息流描述 UI：`{version:"v0.9", createSurface|updateComponents|updateDataModel|deleteSurface}`。客户端用**本地 catalog 组件**渲染（不是执行 agent 代码），因此天然安全、可流式渐进渲染。

目标：在本应用（Electron + React 18 桌面端）的**会话线程**里渲染 agent 通过约定文本围栏输出的 A2UI 消息流，形成可交互的 UI 卡片。

范围决策（已与用户确认）：

- 接入通道：**文本围栏解析**——agent 在回复中以 ` ```a2ui ` 代码围栏输出 A2UI JSON 消息流，桌面端解析并渲染；不引入 MCP/A2A 通道。
- 渲染范围：**仅桌面端会话线程**（`LiveSessionPage` → `BlockList`），不改 relay/client/示例会话页。

## 现状

会话渲染数据流（详见 AGENTS.md 仓库地图）：

```text
opencode serve (1.17.13 侧车，SSE)
  → packages/sdk OpenCodeClient 归一化事件（text.updated 全量 upsert，partId 稳定）
  → renderer/lib/runtime.ts:
      直播: c.onEvent → 帧合并 streamPending → applyEvent(sessionId) → foldEvent() → threads[sid] (runtime.ts:962)
      历史: openSession → client.getMessages → historyToThread(messages) → threads[id] (runtime.ts:1253)
  → ThreadBlock[]（shared 类型，agent 块 = {kind:'agent', markdown}）
  → BlockList.renderBlock('agent') → AgentMessage → MarkdownViewer
```

关键事实：

- `text.updated` 是**全量文本 upsert**（同 partId 反复携带完整文本），现有 fold 按 partId 幂等替换，天然支持「每次增量重算」。
- opencode 1.17.13 二进制**无原生 a2ui part 类型**（已用 strings 检查），A2UI 只能走文本。
- `@a2ui/react` 要求 **react ^19.2.7**，本应用是 React 18.3.1 —— 不能直接用官方 React 渲染器。
- `@a2ui/web_core`（协议/状态/DataContext，无框架依赖）+ `@a2ui/lit`（官方 Lit 渲染器，自定义元素 `<a2ui-surface>`，basicCatalog 自带 18 个组件：Text/Column/Row/Button/TextField/Chart 等）无 React 版本限制。

## 设计

### 1. 围栏格式约定（agent → 桌面端）

agent 回复文本中出现一个或多个 fenced code block，info string 恰为 `a2ui`，正文为 A2UI v0.9 消息流（可多个 JSON 值，逐个流式产出）。
**createSurface 的 `catalogId` 必须是真实 catalog id**：内置引擎持有官方 basic catalog，
id 为 `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json`；id 错误的消息会被引擎静默丢弃：

````text
图表如下：

```a2ui
{"version":"v0.9","createSurface":{"surfaceId":"price-chart","catalogId":"https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}
{"version":"v0.9","updateComponents":{"surfaceId":"price-chart","components":[{"id":"root","component":"Column","children":["t1"]},{"id":"t1","component":"Text","text":"**价格走势**"}]}}
{"version":"v0.9","updateDataModel":{"surfaceId":"price-chart","data":{"title":"近 30 日"}}}
```
````

（以上消息已用官方 schema 逐条验证通过。）basic catalog 常用组件属性（已对官方 zod schema 实测核实）：

| 组件 | 关键属性 |
| --- | --- |
| Text | `text`、`variant`、`weight`、`accessibility` |
| Column / Row | `children`、`justify`、`align`、`weight` |
| Button | `child`、`action`、`variant`、`checks` |
| Card | `child` |
| TextField / Slider / CheckBox / ChoicePicker | `label`、`value` + 校验族（`checks`/`isValid` 等） |
| Tabs | `tabs` |
| Image / Icon | `url`+`description` / `name` |

解析规则（v1 从简，全部显式化）：

- 仅精确匹配整行 ` ```a2ui `（trim 后）开围栏、整行 ` ``` ` 收围栏；其余围栏（` ```json` 等）不处理。
- 每个围栏正文按「增量 JSON 值解析」：跳过空白，尝试解析下一个完整 JSON 值，成功则消费、失败（未流完/畸形）则停止——支持多行格式化 JSON 与逐 token 流式。
- **清洗后的 markdown**：围栏整块（含标记行）从渲染文本中移除；尚未闭合的围栏（流式中）从其开围栏行到文本末尾一并隐藏，闭合后才露出后续正文。
- 畸形围栏（关闭后仍解析不出值）静默丢弃：UI 不出现、原文不展示（防泄漏裸 JSON；不弹错误，保持线程干净）。

### 2. 新增纯函数解析模块

`apps/desktop/src/renderer/lib/a2ui/parser.ts`（无 DOM 依赖，Node/jsdom 均可测）：

```ts
export interface A2uiParseResult { markdown: string; messages: unknown[] }
/** 提取 a2ui 围栏：markdown = 去掉围栏后的文本；messages = 当前所有已完整 JSON 值（按出现顺序） */
export function extractA2ui(text: string): A2uiParseResult
```

不缓存、无状态——每次 `text.updated` 全量重算（与 foldEvent 的全量 upsert 语义同构）。

### 3. 会话级 A2UI 引擎（renderer 单例）

`apps/desktop/src/renderer/lib/a2ui/engine.ts`：`Map<sessionId, Entry>`，Entry 持有：

- `processor: MessageProcessor`（`@a2ui/web_core/v0_9`，catalog 用 `@a2ui/lit/v0_9` 的 `basicCatalog`——Lit 渲染器需要组件实现/`tagName`）；
- 每个 part 的已投喂计数（**精确一次、只增**）与文本指纹（全量 upsert 重放/重连时跳过重复）；
- surface 归属表 `surfaceId → 首个 createSurface 所在 partKey`。

API：

```ts
feedText(sessionId, partKey, text)   // 解析 → 只投喂新增的完整消息 → 认领新 surface
ingestHistory(sessionId, HistoryMessage[]) // 历史加载路径，与 historyToThread 同一套 partKey 公式
claimedSurfaces(sessionId, partKey): { id, surface }[]  // 该块应挂载的 surface
dropSession(sessionId)               // 会话删除时释放（见 §8）
```

**为什么引擎在 React 之外**：A2UI 协议允许后文更新前文的 surface（`updateComponents` 引用旧 surfaceId）。跨块状态必须共享，不能每块自建 processor。引擎按 `createSurface` 消息的**首次出现认领归属**：后续块引用已存在 surface 时不再重复挂卡（新消息只更新旧卡）。

**流式**：围栏 JSON 值逐个完成 → 每次 `text.updated` 增量投喂 → 卡片随 `createSurface` 完成即出现，组件/数据随后续消息渐进补齐（Lit 内部按信号订阅，DOM 级更新，不经过 React 重渲）。

### 4. 类型与 fold 改造

`packages/shared` `AgentMessageBlock` 增加（均为可选，向后兼容）：

```ts
export interface AgentMessageBlock {
  kind: 'agent';
  markdown: string;      // 清洗后（a2ui 围栏已移除）
  timestamp?: number;
  /** 直播: opencode partId；历史: 确定性合成键 h{消息序}-p{part序}。用于把引擎认领的 surface 挂到本块。 */
  a2uiPartKey?: string;
}
```

- `foldEvent` `text.updated` 分支：`markdown = extractA2ui(event.text).markdown`，块带 `a2uiPartKey: event.partId`（runtime.ts:1502）。
- `historyToThread`：agent text part 同用 `extractA2ui` 清洗，`a2uiPartKey = histKey(mi, pi)`（mi/pi 在循环内自然可得）。

引擎投喂点（都拿到原始全量文本，先投喂后提交，保证渲染时 surface 已存在）：

- 直播：`applyEvent` 内 `text.updated` 分支、fold 之前（runtime.ts:962 附近）；
- 历史：`openSession` / 重连恢复两处 `historyToThread` 调用点（runtime.ts:1253、1350），取同一份 `messages` 调 `ingestHistory`——引擎按 part 指纹/计数天然幂等，重复调用安全。

### 5. 渲染

- `components/thread/A2uiSurfaceCard.tsx`：React 包装官方 Lit 元素——`useState(() => new A2uiSurface())` + ref 挂载到普通 div，属性赋 `.surface`（React 18 不需要 React 19，也不引入自定义 JSX 类型）。卡片外层用应用既有 tokens 做轻容器（圆角描边面板），Lit 组件自身样式走 shadow DOM，互不污染。
- `BlockList`：`BlockHandlers` 增加 `sessionId?: string`（可选项，测试与示例页不受影响）；`renderBlock` 的 `agent` 分支在 `AgentMessage` 下方挂 `<A2uiSurfaceCard>` 列表：`engine.claimedSurfaces(sessionId, block.a2uiPartKey)`。历史/示例块无 `a2uiPartKey` → 空列表，行为不变。
- `LiveSessionPage` 组装 handlers 处传入 `sessionId`（~:418，`currentId` 即当前会话）。

### 6. 交互（v1 边界）

- 客户端 catalog 自带函数/表达式（如按钮调本地函数、表单、滑块、标签页）由官方渲染器原生支持，开箱即用。
- **回传 agent 的 action（按钮点击 → 发给模型）v1 不做**：`MessageProcessor` 不注册 `actionHandler`。原因：文本围栏通道下 action 需要反向注入会话（SDK 有 `sendPrompt` 可做，但 action→提示词映射是另一个语义决策）。文档记录为后续项（候选：action 序列化为一条定向用户消息；或补 MCP 通道）。

### 7. 依赖

`apps/desktop` 新增 dependencies：

- `@a2ui/web_core`（^0.10.7，协议/状态/DataContext；zod3 为其自身 dependency，嵌套安装）
- `@a2ui/lit`（^0.10.4，渲染器，自带 basic catalog 组件实现）
- `@a2ui/markdown-it`（^0.1.1）+ `@lit/context`（^1.1.6）——Text 组件经 lit context 注入 markdown 渲染服务，`A2uiSurfaceCard` 用 `ContextProvider` 提供
- `zod`（^4.4.3，**direct**）——修复依赖解析：装 a2ui 后 pnpm 把 `claude-agent-sdk`（peer 要求 zod ^4）解析到了新出现的 zod3 变体；显式声明 zod4 后其 peer 解析回到 zod@4.4.3 变体（a2ui 各包自带的 zod3 不受影响）

不升级 React、不引入 React19 渲染器；均为 renderer 侧依赖，由 electron-vite 打包（已实测构建通过）。

### 8. 生命周期与不做的事

- `dropSession` 挂在 runtime 删除会话处（若无删除会话入口则暂不清理——引擎条目与会话数量同阶，内存可忽略，文档留注）。
- 不做：MCP/A2A 通道、action 回传、React19 升级、`@a2ui/react`、非 desktop 工程（relay/client）、catalog 定制与主题切换（Lit basic 自带配色，与深浅色主题对齐留作后续）。

## 验证状态

### 单元测试（全部通过）

| 用例 | 结果 |
| --- | --- |
| parser：单/多围栏、正文保留、围栏整块隐藏、未闭合尾围栏隐藏、闭合后露出、流式逐消息、多行格式化 JSON、垃圾正文静默丢弃、≤3 空格缩进、非精确 info 串不触发、正文含 ``` 不误闭合 | `lib/a2ui/parser.test.ts` 13 用例 ✅ |
| engine：认领归属、同文本重放精确一次、流式只投新消息、跨块重复 createSurface 不重复挂卡、认领顺序、deleteSurface 释放 + 重建重新认领、垃圾输入安全、history 合成键幂等 | `lib/a2ui/engine.test.ts` 8 用例 ✅ |
| foldEvent / historyToThread：围栏清洗 + partKey（仅含围栏块）、无围栏文本形状不变、流式隐藏 | `lib/runtime.test.ts` 增 5 用例 ✅ |
| BlockList：带 sessionId 与已认领 surface 时挂出 `<a2ui-surface>`；无 sessionId 不挂（示例/静态线程） | `components/thread/BlockList.test.tsx` 4 用例 ✅（jsdom 实测 lit 元素可挂载） |

### 门禁与构建

1. `pnpm format` ✅　`pnpm lint` ✅（无 warning）　`pnpm typecheck` ✅（sdk/desktop/relay/client 全部通过）
2. `pnpm test`：desktop 42 文件 323 用例全过 ✅；sdk ✅；relay 22 用例全过 ✅（原 1 例 `reuses a live
   connection…` 时序 flake 已修复：test helper 缺真实 transport 的「同参复用」语义，见
   `relay/test/helpers/relay-guest.ts`）
3. `pnpm md:check` ✅ 0 errors（本文件与 `plans/沙盒机制实现方案.md` 的超长行/围栏语言问题均已修复）
4. `pnpm --filter @workbench/desktop build` ✅（electron-vite 打包成功，a2ui 代码进 renderer bundle）
5. 协议实测：官方 MessageProcessor + lit basicCatalog 逐条验证 createSurface/updateComponents/updateDataModel/重复 createSurface（抛错）/deleteSurface 行为与文档一致；catalog id 为完整 URL（非 `"basic"`），常用组件属性表见 §1
6. 手动视觉验证（未执行）：`pnpm dev` 会话线程内用 devtools 控制台执行 `a2uiEngine.feedText(当前sessionId, 'manual', '<§1 示例围栏>')` 观察卡片渲染——真实模型默认不产 a2ui，需 packager 按文末附录在 `.opencode` profile 提示词中约定输出格式
7. 回归：普通 markdown 会话渲染、历史重载、重连 upsert 不重复——由既有全量用例（323 条）与 engine 幂等用例覆盖

## 附录：给 packager 的模型提示词约定（非本应用代码）

在 `app-config/.opencode/agent/*.md` 的 agent 指令中说明：

> 需要展示结构化交互界面（卡片、表单、列表、操作按钮等）时，用 ` ```a2ui ` 围栏输出 A2UI v0.9
> JSON 消息流，每行一个 JSON 消息。顺序为：先 `createSurface`（`catalogId` 固定为
> `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json`，`surfaceId` 需在当前会话内唯一），
> 随后 `updateComponents`（组件树必须以 `id:"root"` 为根）与 `updateDataModel` 可各发多次。
> 常用组件：`Column`/`Row`（`children` 引用子组件 id）、`Text`（`text` 支持 markdown）、
> `Button`（`child` + `action`）、`Card`、`Divider`、`List`。客户端组件允许列表仅限上述
> basic catalog；不在列表内的组件与错误 schema 会被静默丢弃。
