# 思考与工具合并折叠 + 流式显示优化

## 背景

此前对话里的"思考过程"（reasoning）与"工具调用"（tool-call）各自独立成卡，
默认展开，占用大量纵向空间；连续多个工具虽在 ≥3 时合并，但思考与工具不合并，
一轮回合的步骤散落。流式过程中思考进度又被折叠态藏住，看不到进展。

目标：思考过程与工具调用**合并成一个折叠组**，默认折叠；增加设置项控制默认展开；
优化流式过程中的可见性与反馈。

## 设计

### 合并折叠（StepGroup）

`BlockList` 的 `prepareItems` 把**连续的 reasoning + tool-call 块**合并成一个
`StepGroup`（替代原仅 tool-call 的 `ToolGroup`，run 长度 ≥2 才成组，单个块仍单独显示）：

- 折叠态：摘要"思考过程 · N 个工具"，带完成（绿勾）/失败（红叉）/流式（脉冲点）标记。
- 展开态：reasoning 文本**内联直接显示**（`ReasoningInline`，不再嵌套折叠），工具行用
  `ToolCallRow`/`ShellCard`（各自仍可点开看输入输出详情）。

### 设置项（默认展开）

`useUiStore` 加 `expandThreadDetails`（默认 `false`＝折叠，持久化 `localStorage`），
`SettingsPage` 外观区加"默认展开思考与工具"开关。

- `StepGroup`/`ReasoningCard`/`ToolCallRow`/`ShellCard` 的初始展开态读该设置。
- 各组件加 `useEffect` 监听 `expandThreadDetails`，设置变化时**即时重置**展开态
  （而非仅影响新渲染的块），让开关立刻生效。

### 流式显示

- **StepGroup 不自动展开**：严格按设置；流式时只在折叠态显示脉冲点 + 旋转图标指示
  "工作中"，不强制展开（用户可手动展开看思考全文）。
- `ReasoningInline`：流式时紫色渐变动画线 + "思考中…"标签 + 旋转图标；完成后回
  静态"思考过程"。
- `AgentMessage`：流式中的回复末尾显示闪烁光标（以 `!timestamp` 判定流式态），完成后消失。
- `ToolCallRow`：运行中边框改为 accent 高亮（`border-accent/30`），更醒目。

### 不做

- 单个 reasoning / 单个 tool（run 长度 1）仍单独显示，不强行成组。
- 不做流式自动展开（用户明确要默认折叠）。
- 不做 per-card 手动展开状态的持久化（设置是全局默认，手动切换随组件卸载丢失）。

## 验证状态

- [x] 思考 + 工具默认合并折叠；展开后思考内联 + 工具行。
- [x] 设置页"默认展开思考与工具"开关即时生效（开=展开，关=折叠）。
- [x] 流式时折叠态有"工作中"脉冲指示，不强制展开。
- [x] AgentMessage 流式光标；ToolCallRow running 边框高亮。
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 199/199 不回归。
- [x] 所改文件 `eslint` 0 error。
