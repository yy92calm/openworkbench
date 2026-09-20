# 工作块合并组纳入短输出方案

日期：2026-09-09，序号 03

## 背景

会话渲染的折叠合并现状：连续的思考（reasoning）+ 工具调用（tool-call）已由 `BlockList.prepareItems` 合并为 `StepGroup`（默认折叠、摘要行、流式/完成/失败标记），单卡折叠跟随 `expandThreadDetails` 设置。

剩余缺口：**工具之间的短 agent 文本会打断分组**。`prepareItems` 的 run 连续条件只认 `reasoning | tool-call`，一条夹在工具之间的短说明（如「让我查一下财务数据…」）就把一个工作流切成分离的三段（组、短文本、组），刷屏且破坏合并语义。`status-line` 块同理被排除。

目标：短输出纳入合并组——「思考 → 工具 → 短文本 → 工具 → 思考」合并为一个组，摘要行仍一行，展开才见明细。

## 设计

1. **归组条件扩展**（`prepareItems`）：run 连续条件从 `reasoning | tool-call` 扩展为 `reasoning | tool-call | status-line | 短 agent`。
2. **短输出判定**（新纯函数 `lib/threadGroups.ts`，可单测）：
   - agent 块且 `markdown` 长度 ≤ 200 字符（`SHORT_OUTPUT_LIMIT`）；
   - 且不含结构性 markdown：代码围栏 ```、行首标题 #、表格行 |——含任一即视为正式内容，不归组（宁可漏收，不可误吞正式回答）；
   - user / 长 agent / artifact / figure / table 等照旧作为打断点。
3. **组内渲染**：短 agent 走现有 `renderBlock`（正常消息样式）；`isStreaming` 判定扩展：组内存在无 timestamp 的 agent 块也算流式。
4. 摘要行、折叠默认值、设置联动（`expandThreadDetails`）全部维持现状，不新增设置项。
5. run.length < 2 仍不组（单个短文本/单个工具保持原样）。

不做：不合并跨 turn 的块（turn-divider / user 永远打断）；不给短输出加单独计数徽标（摘要保持简洁）。

## 验证状态

### 已完成的调研

- [x] `prepareItems` / `StepGroup` / `ReasoningInline` 现状核对：分组、摘要、状态标记、设置联动齐全，短 agent 与 status-line 被排除是唯一缺口。
- [x] 短输出阈值与结构字符防护确定（200 字符 + ``` / # / | 三类结构字符排除）。

### 实施记录

| 验收项 | 验证方式 | 状态 |
|--------|----------|------|
| `threadGroups.ts` 纯函数 + 单测 | `SHORT_OUTPUT_LIMIT`(200) / `isShortAgentOutput`（长度 + ``` / # / \| 结构排除）/ `isGroupableWorkBlock` / `groupIsStreaming`；7 用例覆盖短文本、结构排除、非 agent 拒绝、user/artifact/长文打断、三种流式形态 | 已实施，7/7 通过 |
| `prepareItems` 归组扩展 | run 连续条件改用 `isGroupableWorkBlock`；短文本与 status-line 不再打断 reasoning+tool run；user / 长 agent / 表格 / 产物仍打断；run < 2 不组 | 已实施 |
| StepGroup 流式判定 | 改用 `groupIsStreaming`：运行中工具 / streaming 思考 / 无 timestamp 短 agent 三种形态 | 已实施 |
| 现有测试不退化 | `pnpm typecheck` 通过；`pnpm test` 全量通过（desktop 49 文件 400 用例 + relay 22）；改动文件 lint 0 错误 | 通过 |
