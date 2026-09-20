# 20260919-06 · 宏观洞察第四轮优化（数据质量 · 台账 · 模型 · 汇报展示）

## 背景与需求

「宏观洞察」已完成三轮（看板 `docs/20260918-01`、轮动 + 行业模型
`docs/20260919-01`、汇报视图 `docs/20260919-03`）。本轮继续优化，经确认的
方向：

1. **数据质量修复**：轮动表行业名混用、评分降级失真、弹窗异步竞态等；
2. **决策台账增强**：筛选 / 编辑 / 删除 / 导出，提升闭环可用性；
3. **模型层增强**：轮动评分变动（较上一交易日）、高波动提示；行业模型
   估值分位（板块截面对比）；
4. **汇报展示优化（面向领导检查）**：概览摘要可复制 / 可导出 / 可打印，
   KPI 与排版细节；
5. **数据异步获取、界面渐进展示**：延续「快照秒回 + 后台刷新 + 分区推送」
   的既有原则，新增能力一律遵守。

## 现状问题（均为 2026-09-19 缓存实测 / 代码核对所得，非推断）

| # | 问题 | 证据 |
| --- | --- | --- |
| 1 | 轮动行业名混用两套命名 | 缓存快照中：`中证能源 / 中证金融` 与 `800材料 / 800工业 / 800可选 / 800通信 / 800公用` 同表出现；基金指数名为「基金指数」而非「上证基金指数」（东财 `f14` 原样透传） |
| 2 | 评分降级失真 | `computeRotation` 对缺失值用 `percentileRank = 0.5` 占位；行业 K 线或沪深300 K 线缺失时仍产出貌似正常的分数与「中性」信号（单测 `macroPrompts.test.ts` 甚至固定了该行为：`score 40 / neutral`） |
| 3 | 弹窗异步竞态 | `MacroInsightsPage.openDialog` 以 `title` 判断回填、`dialogLoading` 为全局布尔：连续打开两个指标时可能错标 loading / 回填到错误目标 |
| 4 | 台账功能单薄 | 仅列表 + 归因；无筛选/排序/编辑/删除/导出；全部条目直接铺在页面上，条目增长后无容器限制 |
| 5 | 模型层无变化视角 | 轮动表只有当期分数；无「较上一交易日变化」；`vol60` 仅显示数字、无风险标注；行业模型无板块间估值对比 |
| 6 | 汇报证据不可带走 | 概览区无复制/导出/打印能力；领导检查只能看屏 |

## 设计

### 1. 数据质量修复

#### 1.1 规范名映射（shared + main）

`packages/shared/src/macro.ts` 新增两张固定映射（secid → 展示名）：

- 中证十大行业指数：`中证能源 / 中证材料 / 中证工业 / 中证可选 / 中证消费
  / 中证医药 / 中证金融 / 中证信息 / 中证通信 / 中证公用`（`1.000928`–`1.000937`）；
- 基金指数：`上证基金指数`（`1.000011`）、`深证 ETF`（`0.399306`）。

新增纯函数 `applyCanonicalIndexNames(quotes: MacroQuote[]): MacroQuote[]`：
按 secid 命中映射时覆盖 `name`，未命中回退数据源原值（接口变更不丢数据）。
`fetchIndustries` / `fetchFunds` 解析后调用，快照、表格、prompt 全部使用
规范名（prompt 由快照生成，自动生效）。

#### 1.2 评分降级显式化（shared + renderer + prompt）

类型语义收紧（`RotationRow`）：

- `trend: boolean | null`（收盘不足 20 根 K 线时为 null，不再默认 false）；
- `score: number | null`、`signal: RotationSignal | null`（`ret60 / rs60 /
  trend` 任一缺失即 null）；
- 新增 `scoreDelta: number | null`（较上一交易日的评分变化，见 3.1）。

`computeRotation`：可评分行按分数降序，不可评分行置底（保持原相对顺序），
不再用 0.5 占位伪造分数。渲染层：不可评分行「评分 —」、信号徽标灰色
「数据不足」、趋势列「—」；prompt 中该行标注「历史数据不足，未参与评分」。
单测同步更新（原「score 40 / neutral」用例改为 null 语义）。

#### 1.3 板块 PE 字段（main + shared）

`BOARDS_URL` 字段增加 `f9`（板块 PE）；`MacroBoard` 新增 `pe: number | null`。
实测（2026-09-19）：`f9` 有效（电子 69.2、银行 7.26）；板块级 `f23`（PB）与
`f115` 返回 `"-"`，**不采用**（PB 继续用成分股中位数口径）。

#### 1.4 弹窗异步竞态修复（renderer）

`openDialog` 改为携带自增 token：异步回填与 loading 状态只认当前 token，
过期响应直接丢弃；loading 从全局布尔改为随弹窗目标存储。

### 2. 决策台账增强

#### 2.1 筛选 / 排序（renderer，纯前端）

工具栏：模型（全部 / 轮动 / 行业）× 状态（全部 / 待归因 / 已归因）× 关键字
（匹配标的 / 论据 / 归因说明）。排序保持时间倒序（台账天然时序）。列表容器
`max-h` + 滚动，表头统计行显示「显示 X / 共 Y」。

#### 2.2 编辑 / 删除（main + renderer）

- `researchData.ts` 新增纯函数 `updateDecision(list, id, patch)`（仅
  target / stance / thesis）与 `removeDecision(list, id)`；
- `research.ts` 新增 `updateDecision` / `deleteDecision`（IO）；
- 新 IPC：`research-update-decision`、`research-delete-decision`；
- `RecordDecisionDialog` 增加 `existing?` 编辑模式（预填立场与论据，按钮
  「保存修改」）；删除走既有 `ConfirmDialog`（应用内确认，`window.confirm`
  在桌面 webview 不可靠）。

#### 2.3 导出 CSV（main）

`researchData.ts` 新增 `decisionsToCsv(list)`（RFC 4180 引号转义，含 BOM 头
便于 Excel 打开中文）；`research.ts` 的 `exportDecisionsCsv()` 写入
`<workspace>/.workbench/research/decisions.csv` 并返回相对路径。新 IPC：
`research-export`。台账工具栏「导出 CSV」→ toast 显示落盘路径。导出文件
位于工作区，天然是可被 agent 继续处理的知识资产。

### 3. 模型层增强

#### 3.1 轮动评分变动（较上一交易日）

新增 `main/rotationHistory.ts`（纯函数 + 薄 IO）：

- 文件 `<userData>/macro-rotation-history.json`，结构
  `{ days: { 'YYYY-MM-DD': { [secid]: score } } }`，保留最近 60 个交易日；
- 日期键取**行情数据的最新交易日**（沪深300 K 线最后日期，缺失时回退当天），
  保证周末/节假日刷新不会伪造「新的一天」；
- 流程：refresh 计算出轮动表 → 读前一交易日分值（同日覆盖不产生增量）→
  `attachRotationDeltas(rows, prev)`（shared 纯函数）→ 记录当日分值 → 落盘。

渲染：评分列旁小徽标 `+8 / -5`（A 股红涨绿跌语义色）；概览摘要句追加
「较上一交易日，评分提升最多：X +N」；prompt 的评分行注入
「较上一交易日 ±N」，日报模板因此天然获得「信号变化」素材。

#### 3.2 高波动提示（renderer + prompt 口径）

`vol60 ≥ 45%`（年化 60 日波动）行内标注「高波动」徽标；阈值写进轮动区
说明文字（与评分公式并列披露）。阈值只做展示提示，不参与评分。

#### 3.3 行业估值分位（shared + main + renderer）

- shared 新增 `boardPePercentile(boards, pe): number | null`：板块 PE 在
  **按市值 TOP100 板块**截面中的分位（仅正 PE，越高越贵）；
- `macroStore.getIndustry` 在详情中附带 `pePercentile`（基于当前快照板块
  列表计算），`MacroIndustryDetail` 新增该字段；
- 行业面板 KPI 增加「板块 PE」「PE 分位」（含口径脚注）；行业 prompt 注入
  板块 PE 与分位，供 agent 在定价分析中引用。

### 4. 汇报展示（面向领导检查）

#### 4.1 摘要句与汇报 Markdown（shared 纯函数）

- `buildMacroSummarySentence(snapshot, decisions, digest)` 从页面迁至 shared
  （含 3.1 的变动提及），页面与导出共用同一口径；
- 新增 `buildMacroReportMarkdown(snapshot, decisions, digest)`：标题 + 生成
  时间 + 摘要句 + KPI 表 + 六步闭环数字 + 轮动十行表（含较上一交易日）+
  台账统计与最近 5 条 + 数据源状态 + 免责声明。

#### 4.2 三个出口（renderer + main）

| 出口 | 行为 |
| --- | --- |
| 复制汇报摘要 | `navigator.clipboard.writeText(markdown)`，toast 提示（便于粘贴到 IM / 文档） |
| 导出 Markdown | 新 IPC `macro-export-report(内容)` → 写入 `<workspace>/.workbench/research/macro-report-YYYYMMDD-HHmm.md`（主进程清洗文件名），toast 显示路径 |
| 打印 | `window.print()` + 「打印友好」CSS；打印前临时把 `data-theme` 切到 light，`afterprint` 恢复（深色主题打印耗墨且可读性差） |

打印 CSS（`index.css`）：`@media print` 下隐藏非打印元素（`body *` 可见性
折叠 + 页面根 `data-print-root` 恢复显示并展开为静态全高、放开滚动容器），
按钮与输入类元素不参与打印。导出内容不新增敏感信息（公开数据 + 台账文本，
无路径、无凭据）。

#### 4.3 KPI 与排版细节

- KPI 数值字号与行距微调（13 寸屏可读性），数值统一 `tabular-nums`；
- 概览操作区新增「复制摘要 / 导出 / 打印」三个按钮（`print-hide`）；
- 轮动表在窄屏可横向滚动（`overflow-x-auto` 最小宽度保护）。

### 5. 异步获取与渐进展示（贯穿原则）

现状已具备：主进程快照 + 5 分钟 TTL + 按数据源分组并行刷新 + 每次
`update()` 推送（`macro-dashboard-updated`）+ 渲染层 `seq` 防乱序。本轮：

- 新增能力全部挂在既有刷新链路（板块 PE 随 `industries` 组、评分变动在
  轮动计算内完成），**不新增阻塞渲染的同步请求**；
- 行业详情/导出等按需操作保持「点击 → loading 态 → 完成后局部渲染」；
- 分区无数据（首次安装）时骨架下补「正在获取…」文案；有旧数据时保持
  「旧数据 + 更新中」降级（不闪断）；
- 概览「数据时效」KPI 保持 `就绪/总数` 实时口径，刷新中显示「刷新中」。

### 6. 文件清单

| 文件 | 动作 |
| --- | --- |
| `packages/shared/src/macro.ts` | 扩展：规范名映射 + `applyCanonicalIndexNames`；`RotationRow` 类型收紧 + `scoreDelta`；`MacroBoard.pe`；`MacroIndustryDetail.pePercentile`；`boardPePercentile`、`attachRotationDeltas`、`buildMacroSummarySentence`、`buildMacroReportMarkdown`、`digestCharCount`；prompt 注入变动/降级/分位 |
| `main/macro.ts` | 规范名应用；boards `f9`；轮动历史接入与 delta 附加；`getIndustry` 附带 PE 分位 |
| `main/rotationHistory.ts` + `.test.ts` | 新增：历史解析 / 同日覆盖 / 裁剪 / 前值查找 + 薄 IO |
| `main/macroData.ts` + `.test.ts` | 扩展：`parseBoards` 解析 `f9` |
| `main/researchData.ts` + `.test.ts` | 扩展：`updateDecision` / `removeDecision` / `decisionsToCsv` |
| `main/research.ts` | 扩展：更新 / 删除 / CSV 导出（IO） |
| `main/ipc.ts` | 新增 4 通道：`research-update-decision`、`research-delete-decision`、`research-export`、`macro-export-report` |
| `preload/index.ts`、`renderer/electron.d.ts`、`renderer/lib/electron.ts` | 桥接 4 个新方法 |
| `renderer/components/macro/RotationTable.tsx` | 评分变动徽标、高波动标注、降级行显示、横向滚动 |
| `renderer/components/macro/IndustryPanel.tsx` | 板块 PE / PE 分位 KPI 与口径脚注 |
| `renderer/components/macro/DecisionLedger.tsx` | 筛选工具栏、滚动容器、编辑 / 删除 / 导出入口 |
| `renderer/components/macro/RecordDecisionDialog.tsx` | 编辑模式（`existing`） |
| `renderer/app/routes/MacroInsightsPage.tsx` | 弹窗 token 化；摘要句与导出改走 shared；复制 / 导出 / 打印按钮；数据分区渐进文案 |
| `renderer/index.css` | `@media print` 打印样式 |
| 文档 | 本方案 + `docs/architecture/{01,03,05}` 同步 + CHANGELOG |

### 7. 测试

- shared（`macroPrompts.test.ts` 扩展）：`computeRotation` 降级语义（null）；
  `applyCanonicalIndexNames` 命中/回退；`boardPePercentile`（正负值/缺失）；
  `attachRotationDeltas`（无前值 / 部分命中 / 不可评分行）；摘要句与汇报
  Markdown（含缺数据降级）；prompt 注入变动与降级标注。
- main：`rotationHistory`（同日覆盖、前值查找、60 日裁剪、坏文件容错）；
  `researchData`（更新 / 删除 / CSV 转义与 BOM）；`parseBoards` PE 解析。
- renderer：台账筛选为纯前端逻辑，随组件不单测（与既有页面口径一致）；
  既有 447 用例保持全绿。
- 门禁：`pnpm test`、`lint`、`format:check`、`md:check`、desktop build、
  node/web typecheck 基线错误数不变。

## 实施步骤

1. **shared 类型与纯函数**：映射、类型收紧、分位 / 变动 / 摘要 / 汇报
   函数、prompt 注入；扩展单测；验证 `macroPrompts.test.ts`。
2. **主进程**：`rotationHistory` 模块 + 测试；boards `f9`；research 更新 /
   删除 / 导出 + 测试；IPC 与桥接；真实网络冒烟（板块 PE、历史文件）。
3. **渲染层**：轮动表 / 行业面板 / 台账 / 弹窗 / 页面导出打印 / 打印 CSS；
   竞态修复。
4. **收尾**：架构文档与 CHANGELOG；全量门禁；GUI 人工冒烟（打印、导出、
   13 寸布局）标注待人工确认项。

## 验证状态

方案阶段（2026-09-19）：

- [x] 现状问题以缓存实测 + 代码核对确认（6 项，均有证据）。
- [x] 数据源实测：板块列表 `f9`（PE）可用；板块级 `f23/f115` 返回 `"-"`，
      按设计不采用。

实施（2026-09-19）：

- [x] 第 1 步：shared 扩展（规范名映射 + `applyCanonicalIndexNames`、
      `RotationRow` 收紧为可空评分 / 可空趋势 + `scoreDelta`、`MacroBoard.pe`、
      `MacroIndustryDetail.pePercentile`、`attachRotationDeltas`、
      `boardPePercentile`、摘要句与汇报 Markdown 构建）；
      `macroPrompts.test.ts` 由 8 → 21 用例，全部通过。
- [x] 第 2 步：`rotationHistory`（8 用例：同日合并、60 日裁剪、前值查找、
      坏文件容错、文件 round-trip）；`parseBoards` 解析 `f9`（macroData
      17 用例）；research 更新 / 删除 / CSV（10 用例）；4 个新 IPC 与
      preload / electron.d.ts / lib/electron.ts 桥接。
- [x] 第 3 步：轮动表（变化徽标、高波动标注、数据不足、横向滚动）、行业
      面板（板块 PE / 分位）、台账（筛选 / 编辑 / 删除 / 导出 CSV）、页面
      （复制 / 导出 / 打印、弹窗 token 化、渐进获取文案）；打印 CSS +
      打印自动切浅色主题。
- [x] 缓存兼容：旧快照缺失 `pe / scoreDelta` 字段时按 null 处理（渲染与
      prompt 均不会出现 `undefined`）。
- [x] 门禁：desktop 54 文件 / 470 用例、packages/sdk 3、relay 22 全绿；
      `pnpm lint` / `format:check` / `md:check` 全绿；desktop build 通过；
      node / web typecheck 基线错误数不变（9 / 46），新增代码 0 错误。
- [x] 网络冒烟：板块列表 `f9` 实测（电子 69.2、银行 7.26）；规范名映射与
      线上返回逐条核对（`1.000929` 原始名「800材料」等）。
- [ ] GUI 人工冒烟：复制摘要 / 导出 Markdown（检查工作区落盘文件）/ 打印
      分页与配色、台账筛选编辑删除、轮动变动徽标首日无值次日有值、
      13 寸屏无溢出。

## 风险与边界

- 板块 PE 为东财口径（f9，可能为动态 PE 且含负值口径差异）；仅正 PE 参与
  分位，界面标注「市值 TOP100 板块截面」以免过度解读。
- 评分变动依赖本机历史文件：首次运行（或清理 userData）时无前值，显示
  “—”属预期；跨机器不共享。
- 高波动阈值 45% 是展示提示，不参与评分；口径随界面披露，变更需走方案
  评审（与评分公式同规则）。
- 打印样式依赖可见性折叠方案，五套主题下的打印配色需 GUI 确认；打印内容
  与页面一致，不含导出文件。
- 台账编辑/删除直接改 workspace JSONL（单用户桌面场景，无并发锁）——与
  既有归因回写同一风险面；删除有应用内确认，不提供批量删除。
- CSV 导出覆盖同名文件（导出即最新全量快照），路径随 toast 提示。
