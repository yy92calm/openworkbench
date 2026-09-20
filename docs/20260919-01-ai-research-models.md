# 20260919-01 · 宏观洞察升级：轮动模型 + 行业模型（AI 投研系统）

## 背景与需求

现有「宏观洞察」是数据分析看板 + 通用主题卡的组合。新需求将其升级为
**以「轮动模型 + 行业模型」为核心的 AI 投研分析系统**：

- 以「轮动模型」系统化回答「何时配什么行业」；以「行业模型」系统化回答
  「行业内如何定价」；两类模型成为投研人员专业展业的能力标准。
- 嵌入统一的 AI 分析平台，形成「数据 → 信号 → 模型 → 决策 → 归因 →
  再训练」的自增强闭环，推动投研决策从「个人经验驱动」转向
  「组织知识资产 + 系统化决策驱动」。
- 色彩规范：**A 股红涨绿跌**（覆盖宏观洞察页内所有涨跌标识与走势线）。

经确认的边界：侧栏保留「宏观洞察」名称；行业全集 = 中证十大行业指数
（轮动）+ 东财细分行业（行业模型，市值 TOP100 可搜索）；闭环 v1 做完整
（决策台账 + 归因回填 + 知识资产摘要注入后续 prompt）。

## 调研结论（数据源实测，2026-09-19）

| 数据 | 接口 | 实测 |
| --- | --- | --- |
| 中证十大行业指数 | `push2` ulist / kline，`secid` = `1.000928`–`1.000937` | 能源/材料/工业/可选/消费/医药/金融/信息/通信/公用共 10 个，行情与日 K 均可用 |
| 东财行业板块（涨跌/换手/资金流/市值） | `push2.eastmoney.com/api/qt/clist/get?fs=m:90+t:2`，`fid` 取 `f20`（市值）或 `f62`（资金流），`fields=f3,f8,f12,f14,f20,f62` | 单一列表共 496 个板块；`pz` 上限 100（按市值或资金流取 TOP100 一页足够） |
| 板块成分股（行业内定价） | `…clist/get?fs=b:<BK代码>&fid=f20&fields=f9,f20,f23,f115` | 返回成分股 PE（f9/f115）与 PB（f23），按市值排序；银行板块 42 只验证通过 |
| 板块日 K | `push2his…kline/get?secid=90.<BK代码>` | 可用（60/120 日动量与走势） |

注意事项：

- 同一行业存在多级命名（如「银行」「银行Ⅱ」「国有大型银行Ⅲ」），按市值
  近似去重、优先保留无 Ⅰ/Ⅱ/Ⅲ 后缀的条目。
- 中证十大行业指数无公开成分股接口（不用于行业模型，仅用于轮动排名）。
- 板块成分股估值拉取为**按需**（选中行业时一次性请求），不进看板刷新。

## 设计

### 1. 色彩规范（A 股红涨绿跌）

- Tailwind 增加语义色 `rise`（红，涨）与 `fall`（绿，跌），取自图表状态色
  （critical 红 / good 绿），与既有 `ok/error` 语义解耦。
- 应用范围：宏观洞察页内所有涨跌标识、迷你走势线、榜单收益、轮动评分表 —
  涨 = rise，跌 = fall。其余界面（任务状态等）不受影响。

### 2. 信息架构（页面三层的定位）

```text
宏观洞察（侧栏保持不变）
├── ① 数据层（现有四分区：市场行情 / 利率与汇率 / 宏观景气 / 基金市场）
│       定位：模型输入。界面与既有实现一致。
├── ② 模型层
│   ├── 轮动模型 · 何时配什么行业
│   │     中证十大行业评分表（动量/相对强度/趋势/波动 → 综合分 → 超配/低配）
│   │     + 东财细分行业资金流 TOP10（信号补充）
│   │     动作：生成轮动周报 / 设为工作日任务 / 逐行「记录决策」
│   └── 行业模型 · 行业内如何定价
│         行业搜索（东财市值 TOP100，去重）→ 行业详情：行情 + 120 日走势
│         + 成分股 PE/PB 中位数 + 市值 TOP10 成分股
│         动作：生成行业定价分析 / 记录决策
└── ③ 闭环层
    决策台账（记录 → 归因 → 复盘与再训练）
```

页面头部增加定位副标题与「数据 → 信号 → 模型 → 决策 → 归因 → 再训练」
闭环步骤条（只读说明，锚点定位三段）。

### 3. 数据层扩展（主进程）

`macroData.ts` 新增纯解析：

- `parseBoards(raw)`：东财板块列表 → `MacroBoard[]`（code/name/涨跌/换手/
  主力净流入/总市值），并按市值近似去重（同市值 ±0.1% 保留无后缀名）。
- `parseConstituents(raw)`：成分股列表 → `MacroConstituent[]`（代码/名称/
  价格/涨跌/PE/PB/市值）。

`macro.ts` 扩展：

- 新数据源 `industries`：
  - 中证十大行业指数行情 + 60 日 K（11 个并行请求，含沪深300）；
  - 东财板块 TOP100（按市值，一页）+ 资金流 TOP10（从同一列表本地排序）。
- 快照新增：`data.rotation: RotationRow[]`（刷新时由纯函数 `computeRotation`
  计算）、`data.boards: MacroBoard[]`。
- 按需接口 `getIndustry(board)`：板块行情 + 120 日 K + 成分股 TOP20 →
  `MacroIndustryDetail`（含 PE/PB 中位数，排除负值/缺失；缓存 5 分钟）。
- 新 IPC：`macro-industry`（入参板块代码）。

### 4. 轮动模型（信号定义，透明可复核）

`computeRotation(industries, hs300)`（shared 纯函数）：

| 信号 | 定义 |
| --- | --- |
| `ret60` | 近 60 个交易日收益率 |
| `rs60` | `ret60` − 沪深300 同期收益（相对强度） |
| `trend` | 收盘价是否高于 20 日均线（1/0） |
| `vol60` | 60 日年化波动（辅助展示，不参与评分） |

综合分 = `100 × (0.45×rankPct(rs60) + 0.35×rankPct(ret60) + 0.20×trend)`；
10 个行业内部百分位排名。评分 ≥ 67 为「超配」，≤ 33 为「低配」，其余
「中性」。**公式在界面脚注展示**，口径可被团队复核——这是「能力标准」的
前提。

`buildRotationPrompt(snapshot, research)`：注入评分表 + 宏观快照
（利率/PMI/汇率）+ 最近决策与知识资产摘要，要求 agent 用
finance-core/equity-research 方法论输出周报，并给出可执行的行业配置建议。

### 5. 行业模型（行业内定价）

行业详情面板（选中东财板块后）：

- 行情条：板块涨跌、换手、主力净流入、总市值；
- 120 日走势（内置 SVG）；
- 估值：成分股（市值 TOP20）PE/PB 中位数、负值剔除说明；
- 成分股 TOP10 表：名称/代码/市值/涨跌/PE/PB。

`buildIndustryPrompt(detail, snapshot, research)`：注入上述数据 + 定价三要素
框架（盈利 / 估值 / 情绪），要求输出「定价结论 → 数据依据 → 估值区间与
风险」；并提示更新知识资产。

### 6. 闭环：决策台账 → 归因 → 再训练

**存储**（工作区文件，天然属于组织知识资产，可被 agent 读取/版本化）：

- 决策台账：`<workspace>/.workbench/research/decisions.jsonl`（追加式
  JSONL；归因回填时按 id 重写该行）。
- 知识资产：`<workspace>/.workbench/research/knowledge.md`（由 agent 在
  「复盘与再训练」会话中沉淀；应用只读取摘要注入 prompt）。

**决策记录**：`{id, model: 'rotation'|'industry', target, stance:
'overweight'|'neutral'|'underweight'|'watch', thesis, sessionId?, createdAt,
status: 'open'|'reviewed', attribution?: {outcome: 'hit'|'partial'|'miss',
note, reviewedAt}}`。

**归因**：台账行内「归因」→ outcome + 复盘说明 → 状态改 reviewed。

**再训练**：`buildReviewPrompt(research)` 生成「复盘与再训练」会话：注入
未归因决策、已归因决策与知识资产摘要，要求 agent ① 逐条复盘偏差原因；
② 用 write 工具更新 `.workbench/research/knowledge.md`（新增/修订条目）。
此后所有模型 prompt 自动附带知识资产摘要与最近决策 → 闭环成立。

**prompt 注入规则**（`formatResearchContext`）：最近 5 条未归因决策 +
最近 3 条已归因决策 + 知识资产摘要（截断 4000 字符）。

**主进程新模块** `research.ts`（workspace 读写，纯逻辑与 IO 分离）：
`listDecisions / addDecision / attributeDecision / readKnowledgeDigest`。
新 IPC：`research-decisions`、`research-add-decision`、`research-attribute`、
`research-digest`。

### 7. 定时任务与主题卡调整

- 删除通用主题卡（6 张），由模型区动作替代。
- `MacroThemeId` 重定义为三个模型模板：
  `rotation-daily`（工作日 08:30 轮动日报）、`rotation-weekly`（周一 08:30
  轮动周报）、`review-weekly`（周五 16:30 复盘与再训练）。
- 调度器 fire 回调：读取 `macroStore` 快照 + research 上下文 → 动态生成
  prompt；未知/旧 theme id 回退到任务自身存储的 prompt（向后兼容）。
- 「设为工作日任务」按钮位于轮动模型区；行业模型 v1 不做定时任务。

### 8. 文件清单

| 文件 | 动作 |
| --- | --- |
| `packages/shared/src/macro.ts` | 扩展：RotationRow / MacroBoard / MacroIndustryDetail / 决策与归因类型；`computeRotation`、`formatResearchContext`、`buildRotationPrompt`、`buildIndustryPrompt`、`buildReviewPrompt`；`MacroThemeId` 重定义 |
| `main/macroData.ts` + test | 新增 `parseBoards`（含去重）、`parseConstituents` 与 fixture 测试 |
| `main/macro.ts` | 扩展：industries 数据源、rotation 计算、boards、`getIndustry` 按需缓存 |
| `main/research.ts` + test | 新增：决策台账与知识摘要（JSONL 解析/合并纯函数 + workspace IO） |
| `main/ipc.ts` | 新增 `macro-industry`、`research-*` 通道；调度器 fire 注入 research |
| `renderer/lib/components` | 新增 `RotationTable`、`IndustryPanel`、`DecisionLedger` 及两个小对话框 |
| `renderer/app/routes/MacroInsightsPage.tsx` | 重构：定位头部 + 闭环步骤条 + 模型层 + 台账 |
| `renderer/components/macro/{IndicatorCard,NotificationsMenu}.tsx` | 涨跌色改为 rise/fall |
| `tailwind.config.*` / `index.css` | 新增 `rise` / `fall` 语义色 |
| `renderer/lib/{electron.ts,electron.d.ts}`、`preload/index.ts` | 桥接新通道 |
| 文档 | 本方案 + `docs/architecture/{01,03,05}` 同步 + CHANGELOG |

### 9. 测试

- `shared`：`computeRotation`（fixture 十行业 + 边界：全跌、均线穿越、
  数据不足）、三个 prompt builder（含 research 注入与截断）、主题 id 合法性。
- `main`：`parseBoards` 去重、`parseConstituents` 估值缺失处理、
  research JSONL 解析/追加/归因合并（纯函数）。
- 现有 434 用例保持全绿；构建、typecheck（node/web 分别，基线错误数不变）。

## 实施步骤

1. **规范与共用逻辑**：红涨绿跌色 token；shared 类型与纯函数（rotation、
   prompts、research 类型）+ 单测。
2. **主进程**：industries 数据源与板块/行业详情；research 模块与 IPC；
   调度器三模板 + 兼容回退；单测与真实网络冒烟。
3. **渲染层**：页面重构（闭环步骤条、轮动表、行业面板、决策台账）、
   rise/fall 应用、桥接；`pnpm md:check`、全量测试、构建。
4. **收尾**：架构文档与 CHANGELOG 同步；`pnpm dev` GUI 冒烟（人工）。

## 验证状态

方案阶段（2026-09-19）：

- [x] 需求边界确认（命名 / 行业全集 / 闭环深度）。
- [x] 行业数据源实测：中证十大行业指数、东财板块 TOP100、成分股估值、
      板块日 K 全部可用。
- [x] 板块命名多级重复的处理策略（市值近似去重 + 无后缀优先）。

实施（2026-09-19）：

- [x] 第 1 步：`rise`/`fall` 语义色接入五个主题；shared 新增
      `computeRotation`、三类 prompt builder、research 上下文格式化与类型；
- [x] 第 2 步：`industries` 数据源（十大行业行情 + 60 日 K + 板块 TOP100 +
      去重 + 轮动计算）；`macro-industry` 按需详情（成分股 PE/PB 中位数、
      120 日走势，5 分钟缓存）；`research.ts` 决策台账与知识摘要 + 4 个
      IPC；调度器三模板（轮动日报/周报、复盘周报）动态 prompt + 未知 id
      回退任务自身 prompt。
- [x] 第 3 步：页面重构（闭环步骤条、轮动评分表、行业面板、决策台账、
      红涨绿跌）；`RecordDecisionDialog` / `DecisionLedger` / `RotationTable`
      / `IndustryPanel` 新组件；桥接 5 个新通道。
- [x] 单测：宏观相关 43 个用例通过（含 `computeRotation` 排序与降级、
      纪要去重、research JSONL 解析/归因合并）；全量 53 文件 / 447 用例
      通过。
- [x] typecheck：`tsconfig.node.json` / `tsconfig.web.json` 基线错误数不变
      （9 / 46），本次新增代码 0 错误。
- [x] 构建：`pnpm --filter @workbench/desktop build` 通过；`pnpm lint` /
      `pnpm md:check` / `pnpm format:check` 全绿。
- [x] 真实网络冒烟：十大行业行情 + 60 日 K、板块 100 行（市值近似去重后
      91）、资金流 TOP3（电子 198.5 亿等）、银行板块成分股 PE 中位 6.285 /
      PB 中位 0.64、板块 120 日 K —— 全部符合预期。
- [ ] GUI 人工冒烟：看板、轮动表、行业面板、记录/归因/复盘三步闭环、
      每日任务创建。
- [ ] 旧任务回退：代码路径已实现（未知 theme id 保留任务自身 prompt），
      待有旧任务时人工确认。

## 风险与边界

- 板块估值按需拉取只取 TOP20 成分股，PE/PB 中位数为近似口径（界面标注
  「TOP20 成分股中位数」）；银行等低估值行业负值/缺失剔除逻辑需在测试固定。
- 轮动评分是透明规则模型（非 ML），定位是「能力标准的载体」——口径变更
  需走方案文档评审，不在运行时配置。
- decisions.jsonl 与 knowledge.md 在工作区内，agent 可写；应用只追加/回写
  台账行，不做并发锁（单用户桌面场景）。
- 旧主题卡删除后，旧任务 id 回退到任务自身 prompt，不丢任务。
