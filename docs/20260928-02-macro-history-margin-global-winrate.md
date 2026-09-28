# 20260928-02 · 宏观洞察 v5：轮动历史时序 + 资金面 + 全球市场 + 台账胜率

## 背景与需求

承接 20260923-03（顶部 CEO 标签视图）之后的下一轮宏观洞察迭代。用户在四
个候选方向中确认**全部实施**：

1. **轮动历史时序化**：`RotationHistoryStore` 已持久化 60 个交易日 × 每
   行业评分，但 UI 只消费「较上一交易日」的单日 delta，时序数据沉睡；
2. **资金面数据源**：接入融资融券（两融）余额与融资净买入，补全轮动模
   型的资金维度（北向净买入 2024-08 起停止实时披露，改用披露良好的两融）；
3. **全球宏观维度**：道指 / 日经 / COMEX 黄金 / 布伦特原油 / WTI 原油
   接入，与已有恒生 / 标普 / 纳指 / 美债 10Y 形成全球一屏；
4. **决策台账胜率统计**：归因数据（hit / partial / miss）已在
   decisions.jsonl，但无命中率汇总展示。

## 事实底座（本轮代码与接口实测）

| 事实 | 来源 |
| --- | --- |
| `RotationHistoryStore` 存 60 交易日 `days: Record<日期, Record<secid, score>>`，fetch 时先取 previous 再 record 当日 | `src/main/rotationHistory.ts` L15-71 |
| 信号阈值写死于 `computeRotation`：score≥67 超配、≤33 低配 | `packages/shared/src/macro.ts` L521-528 |
| `MacroSourceId` 现有 7 源；`INDEX_SECIDS` 含恒生/标普/纳指（在「市场行情」区显示） | `src/main/macro.ts` L63-73 |
| 全球 secid 实测可用：道指 `100.DJIA`、日经 `100.N225`、COMEX 黄金 `101.GC00Y`（4191）、布油 `112.B00Y`（98.84）、NYMEX `102.CL00Y`（94.09）；ulist 对无效 secid 部分返回 | 本轮 curl |
| VIX 恐慌指数在东财无官方行情（搜索仅返回 VIXY / VXX ETF），放弃 | 本轮 curl |
| 全球品种日 K 接口可用（`push2his` kline，SPX/GC00Y/B00Y/N225 均返回） | 本轮 curl |
| 两融接口 `RPTA_RZRQ_LSHJ` 可用：字段 `RZRQYE`（两融余额 2.637 万亿）、`RZYE`（融资余额）、`RQYE`（融券余额）、`RZJME`（融资净买入）、`RZYEZB`（占流通市值比）、`DIM_DATE` | 本轮 curl |
| 台账胜率无汇总：DecisionLedger 头部只有「共 N · 已归因 M（R%）」；报告仅有归因率行 | 本轮读码 |
| `openIndexDialog` 在 klines 缺失时自动走 `secid` 按需加载（`macro-series` IPC） | `MacroInsightsPage.tsx` L430-444 |
| 解析函数测试在 `src/main/macroData.test.ts`；shared 纯函数测试在 `renderer/lib/macroPrompts.test.ts`（28 例） | 本轮读码 |

## 设计

### A. 轮动历史时序化

- **shared**：
  - `RotationRow` / `SwIndustryRow` 增加 `scoreHistory: number[]`（升序、
    最多 20 个、含当日新分）；
  - 提取 `SIGNAL_THRESHOLDS = { over: 67, under: 33 }` 为导出常量，
    `computeRotation` 与新 `signalOf(score)` 共用（口径单源）；
  - 新纯函数 `attachScoreHistory(rows, days, asOf, limit = 20)`：对每行取
    日期 ≤ asOf 的最近 limit-1 个历史评分 + 当日分数组序列（asOf 当日已
    record 时以当日分数为准，去重）；
  - `MacroSignalView` 增加 `flips: string[]`；新纯函数
    `buildSignalFlips(days, rows, asOf, lookback = 5)`：每行业取最近
    lookback+1 日评分 → 每日信号 → 首尾信号不同则输出
    「中证金融 中性→超配」式片段（仅信号非空行业）。
- **main**：`RotationHistoryStore` 增加 `days()` 只读访问；
  `fetchIndustries` / `fetchSw` 在 record 前组装 `attachScoreHistory`，并
  将 `buildSignalFlips` 结果并入 snapshot（挂在 rotation 行上即可推导，
  不新增顶层字段——flips 由渲染层从 rows + `snapshot.signalFlips` 组装；
  为保持纯函数简单，新增 `MacroSnapshotData.signalFlips: string[]`）。
- **UI**：
  - `RotationTable` 网格增加「近 20 日」列（评分与信号之间）：20 点
    polyline mini-spark（SVG，首尾差 tone 着色）；
  - 顶部信号区在 change 行下渲染 flips（一行 muted，无则省略）。

### B. 资金面数据源（两融）

- **shared**：`MacroSourceId` 增加 `'margin'`；新类型
  `MacroMarginPoint { date: string; balance: number | null; netBuy: number | null }`
  （balance = 两融余额，netBuy = 融资净买入，单位元）；`MacroSnapshotData`
  增加 `margin: MacroMarginPoint[]`（升序，60 条）；`SOURCE_LABELS` 增
  `margin: '资金面（两融）'`；`emptyMacroSnapshot` 补空态。
- **main**：`MARGIN_URL`（`RPTA_RZRQ_LSHJ`，pageSize 60，dim_date 倒序取
  后 reverse）；`macroData.ts` 增加 `parseMargin`；fetch 分组增加
  `['margin', …]`；`buildMacroContextLines` 增加两融两行（最新余额亿元 +
  5 日变化 + 当日净买入）。
- **UI**：数据底座新增「资金面」Section（两卡：两融余额、融资净买入），
  点击卡片弹走势 dialog（复用 IndicatorDialog，series 由 margin 序列
  映射）；「引用本组」走 buildIndicatorLine。

### C. 全球市场

- **shared**：`MacroSourceId` 增加 `'global'`；`MacroSnapshotData` 增加
  `global: MacroQuote[]`；导出 `GLOBAL_SECIDS`（恒生/标普/纳指/道指/日
  经/黄金/布油/NYMEX 共 8）与 `GLOBAL_NAMES` 规范名（「布伦特原油当月
  连续」→「布伦特原油」等）；`applyCanonicalIndexNames` 扩展覆盖全球名；
  `SOURCE_LABELS` 增 `global: '全球市场'`。
- **main**：`INDEX_SECIDS` 移除恒生/标普/纳指（「市场行情」变纯 A 股 6
  卡）；新增 `fetchGlobal`（ulist 一次请求 8 secid + canonical 名；解析
  为空抛错）。全球 K 线不预取——卡片点击时经既有 `secid` 按需加载路径
  拉 120 日走势。
- **UI**：「市场行情」Section 之后新增「全球市场」Section（8 张
  IndicatorCard，openIndexDialog 复用）。
- **prompt**：`buildMacroContextLines` 增加标普/纳指/恒生/黄金/布油 5 行
  （美元口径，标注「全球输入」语境已由名称自明）。

### D. 台账胜率统计

- **shared**：新纯函数
  `researchStats(decisions): { total; open; reviewed; hit; partial; miss; winRate: number | null }`
  （winRate = hit / reviewed × 100，partial 不折算、单列展示；reviewed
  为 0 时 null）；`formatResearchContext` 头部增加一行统计（模型可感知自
  身历史胜率）；`buildMacroReportMarkdown` 关键指标表增加「胜率」行。
- **UI**：KPI「决策台账」格 value 变为 `N 条 · 胜率 M%`（null 时仅
  `N 条`）；`DecisionLedger` 头部统计行追加「命中 X · 部分 Y · 偏离 Z」。

## 文件清单

| 文件 | 动作 |
| --- | --- |
| `packages/shared/src/macro.ts` | 类型（RotationRow.scoreHistory、margin、global、signalFlips）+ SIGNAL_THRESHOLDS + 4 个纯函数 + prompt 扩展 |
| `packages/shared/src/index.ts` | 新导出 |
| `apps/desktop/src/main/macroData.ts` | `parseMargin` |
| `apps/desktop/src/main/macro.ts` | GLOBAL/MARGIN fetch、INDEX_SECIDS 调整、rotation 组装 scoreHistory/flips |
| `apps/desktop/src/main/rotationHistory.ts` | `days()` 只读访问 |
| `apps/desktop/src/renderer/app/routes/MacroInsightsPage.tsx` | 全球/资金面 Section、flips 行、KPI 胜率 |
| `apps/desktop/src/renderer/components/macro/RotationTable.tsx` | 近 20 日 spark 列 |
| `apps/desktop/src/renderer/components/macro/DecisionLedger.tsx` | 头部命中统计 |
| `apps/desktop/src/{main/macroData.test.ts, renderer/lib/macroPrompts.test.ts}` | 新增用例 |
| `CHANGELOG.md`、`docs/architecture/05-capabilities.md`、本文档 | 同步 |

## 验证状态

方案阶段（2026-09-28）：

- [x] 四项需求确认与数据源实测（两融 / 全球 secid / 全球日 K 全部 curl
      验证可用；VIX 无官方行情，放弃并记录）。
- [x] 现状代码核对（rotationHistory 能力、信号阈值、sourceId 体系、
      openIndexDialog 按需加载路径、测试布局）。

实施（2026-09-28 完成，GUI 冒烟待用户验证）：

- [x] A. shared 类型 + 纯函数 + 单测（attachScoreHistory /
      buildSignalFlips / signalOf 阈值单源）。
- [x] B. main：fetchGlobal / fetchMargin / parseMargin + macroData 单测。
- [x] C. main：rotation 组装 scoreHistory 与 signalFlips。
- [x] D. UI：全球与资金面 Section、RotationTable spark 列、顶部 flips
      行、KPI / 台账胜率。
- [x] E. 报告与导出：markdown 胜率行、buildMacroContextLines 两融 + 全球。
- [x] F. 门禁：desktop 全部测试绿（512/512，含新增 14 例）、lint /
      typecheck / format:check / md:check（104 文件 0 错误）绿。
- [ ] GUI 人工冒烟：轮动 spark 与翻转行、全球 8 卡与点击走势、两融卡片
      与走势、胜率展示。

## 风险与边界

- **两融日频披露**：T+1 早间公布前日数据，页面标注日期，不做实时假设；
- **全球行情时区**：美股 / 商品为上一交易日收盘（东财已换算为同屏口
  径），卡片 sub 显示行情源日期，弹窗走势标注区间；
- **历史冷启动**：scoreHistory / flips 首日为空数组（spark 显示「—」，
  flips 省略行），不影响既有列；
- **snapshot 兼容**：新字段对旧缓存（macro-cache.json）为 undefined，渲
  染层按空态处理（与既有 `scoreDelta ?? null` 同一模式）；
- **申万表不新增 spark**（本轮 surgical 范围：主模型中证十行业先落
  地，申万行已有收盘走势弹窗）；signals 阈值常量化不动行为。
