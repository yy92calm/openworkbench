# 20260918-01 · 宏观洞察（侧边栏金融功能）

## 背景与需求

应用当前是基于金融 profile 的桌面工作台，侧边栏导航为「新建 / 任务 / 技能 /
会话分享」。新增需求：在侧边栏增加**面向金融基金方向**的功能「宏观洞察」。

经确认的需求边界：

1. **形态**：主题页 + 看板混合——上半部分为宏观/基金数据看板，下半部分为
   洞察主题卡片，点卡片一键让 agent 生成分析并进入会话。
2. **数据来源**：免费公开 API，由主进程抓取并缓存（渲染层不直连外网）。
3. **范围**：宏观 + 基金并重。

## 调研结论（数据源实测）

以下接口已于 2026-09-18 在本机逐条实测（curl），返回格式与字段映射均确认：

| 数据 | 接口 | 关键字段 |
| --- | --- | --- |
| 指数行情 | `push2.eastmoney.com/api/qt/ulist.np/get?secids=…&fields=f2,f3,f4,f12,f13,f14&fltt=2` | f2 价格 / f3 涨跌幅 / f4 涨跌额 / f12 代码 / f14 名称 |
| 日 K（指数/汇率/基金指数通用） | `push2his.eastmoney.com/api/qt/stock/kline/get?secid=…&fields1=f1,f2&fields2=f51,f53&klt=101&lmt=N` | `klines:["日期,收盘",…]`；实测 `1.000300`、`133.USDCNH`、`1.000011` 均可用 |
| CPI / PPI / PMI / GDP | `datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_ECONOMY_{CPI,PPI,PMI,GDP}&columns=ALL&sortColumns=REPORT_DATE&sortTypes=-1` | `NATIONAL_SAME`（CPI 同比）/ `BASE_SAME`（PPI）/ `MAKE_INDEX`、`NMAKE_INDEX`（PMI）/ `SUM_SAME`（GDP 累计同比） |
| 中美国债收益率 | `datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_WEB_TREASURYYIELD` | 见下方字段映射表 |
| 货币供应 | `…reportName=RPT_ECONOMY_CURRENCY_SUPPLY` | `BASIC_CURRENCY`/`CURRENCY`/`FREE_CASH` 及各 `*_SAME` 同比（**字段语义实施时对照官方页面 JS 再确认**） |
| 离岸人民币 | `push2.eastmoney.com/api/qt/stock/get?secid=133.USDCNH&fields=f43,f57,f58&fltt=2` | f43 价格（实测 6.6996） |
| 基金指数 | 上证基金指数 `secid=1.000011`、深证 ETF `secid=0.399306`（行情 + 日 K 接口同上） | 实测 7104.65 / 1792.59 |
| 基金排行 | `fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&sc=1nzf&st=desc&pi=1&pn=N&…`（需 `Referer: https://fund.eastmoney.com/`） | JS 文本 `var rankData={datas:["代码,名称,…,近1年涨幅,…",…]}` |

国债收益率字段映射（取自东财官方页面 `zmgzsyl.js` 的图表配置）：

| 字段 | 含义 |
| --- | --- |
| `EMM00588704` / `EMM00166462` / `EMM00166466` / `EMM00166469` | 中债 2Y / 5Y / 10Y / 30Y |
| `EMM01276014` | 中债 10Y-2Y 利差 |
| `EMG00001306` / `EMG00001308` / `EMG00001310` / `EMG00001312` | 美债 2Y / 5Y / 10Y / 30Y |
| `EMG01339436` | 美债 10Y-2Y 利差 |

已排除的候选（不采用，避免实现期返工）：SHIBOR（中国货币网接口只返回配置
无数据行）、LPR/社融（东财 reportName 不存在）、中证偏股基金指数 930950
（东财 push2 无此 secid，用上证基金指数替代）。

补充：收益率与宏观报表支持 `columns` 选择与 `pageSize` 多行返回——弹窗历史
所需的多期数据与最新值**同一次请求**取回（一次请求，增量成本为零）。

## 设计

### 总体结构

```text
侧边栏「宏观洞察」→ 路由 /macro → MacroInsightsPage
   ├─ 看板区（4 个分区，数据由主进程抓取）
   │    市场行情 / 利率与汇率 / 宏观景气 / 基金市场
   │    指标卡点击 → 详情弹窗（走势 + 口径 + 来源）
   │    指标卡「引用」/ 分区头「引用本组」→ 预填会话输入框
   ├─ 洞察主题区（6 张主题卡）
   │    ├─「生成洞察」→ startDraft() + sendPrompt(快照 + 主题指令) → /live/:id
   │    ├─「引用到对话」→ setComposerDraft(prompt) → /live（不发送）
   │    └─「设为每日任务」→ schedulerCreate(macroTheme) → 触发时动态 prompt
   └─ 通知（铃铛未读点 + toast + 列表）
        每日简报就绪 / 指标异动 → 点击跳会话或打开对应弹窗
```

### 数据层（主进程）

新增 `apps/desktop/src/main/macro.ts` 与 `macroData.ts`：

- `macroData.ts`：**纯解析函数**（指数行情、K 线、宏观行、收益率行、基金排行
  文本），输入为接口原始字符串，输出归一化结构；全部容错，解析失败返回空数组。
- `macro.ts`：按数据源分组抓取（`fetch` + 10s 超时 + UA；天天基金附
  `Referer`），并发去重（in-flight promise 复用）；每个数据源独立
  try/catch——**部分失败不影响其余数据**。
- DTO 类型放 `packages/shared/src/macro.ts`（main/renderer 共用，符合
  shared 的「共享领域类型」定位）。

### 获取与展示的划分（界面永不等待）

原则：**抓取在后台，展示永远渲染「当前已知」**；渲染层调用的 IPC 只读取
主进程快照，微秒级返回，绝不等待网络。

```text
主进程 MacroStore（唯一数据源）
  ├─ 内存快照 + userData/macro-cache.json（上次成功数据，冷启动秒开）
  ├─ 启动预取：index.ts whenReady 后 void refresh()（fire-and-forget）
  ├─ 页面请求 macro-dashboard → 立即返回当前快照（不触网）
  │     若数据过期且无进行中的抓取 → 后台触发 refresh()（不阻塞本次返回）
  └─ refresh 按数据源分组并行，每组完成即推送 macro-dashboard-updated
渲染层
  ├─ 挂载立即渲染快照（有磁盘缓存 → 首屏直接有数）
  ├─ 订阅 macro-dashboard-updated → 按分区替换（不整页刷新、不闪烁）
  └─ 刷新按钮 → force refresh（fire-and-forget），等待期间显示「更新中」
```

快照结构：

```ts
interface MacroSnapshot {
  seq: number;                    // 单调递增，渲染层防旧覆盖（乱序保护）
  fetchedAt: string | null;       // 上次成功抓取时间
  refreshing: boolean;            // 是否有抓取进行中
  sources: Record<SourceId, {
    status: 'idle' | 'loading' | 'ready' | 'error';
    error?: string;
    fetchedAt?: string;
  }>;
  data: { indices; klines; yields; macro; fx; funds };
  errors: string[];               // 汇总（页脚提示）
}
```

分区状态 → 渲染映射：

| 状态 | 无旧数据（或首次运行） | 有旧数据 |
| --- | --- | --- |
| `loading` | 分区骨架卡 | 旧数据 + 小「更新中」指示 |
| `ready` | 数据卡 | 数据卡（更新为最新） |
| `error` | 分区空态「数据源暂不可用」 | 旧数据 + 角标「上次更新 HH:mm」 |

因此：

- 正常用户（有磁盘缓存）打开页面**首屏即数据**，网络只负责后台刷新；
- 只有「首次安装且无缓存」才会短暂看到骨架，且骨架只出现在未完成的分区，
  其余分区照常可用；
- 断网/接口失败不产生阻塞态，只降级为「旧数据 + 提示」。

刷新触发点：启动预取 → 页面请求时若过期 → 手动刷新；主进程不设常驻定时器
（避免无谓的后台请求）。并发去重，同一时刻最多一次刷新。

IPC 与推送清单：

| 通道 | 方向 | 说明 |
| --- | --- | --- |
| `macro-dashboard` | renderer → main | 入参 `{force?}`；**同步返回快照**（微秒级），`force` 时后台刷新并在完成时推送 |
| `macro-series` | renderer → main | 按需历史（`{secid, days}`，指数/汇率/基金指数），store 内 5 分钟缓存 |
| `macro-notifications` | renderer → main | 通知列表 + 未读数 |
| `macro-notifications-read` | renderer → main | 全部已读 / 单条已读 |
| `macro-dashboard-updated` | main → renderer | 刷新完成（静默更新看板） |
| `macro-notification` | main → renderer | 新通知（briefing / alert） |

preload 暴露对应方法与 `onMacroDashboard` / `onMacroNotification` 订阅；
渲染层 `useMacroDashboard()` hook：先订阅、再取一次快照；用 `seq` 比较
丢弃乱序的旧推送。

### 数据划分与展示形态

**三层数据形态**：

| 层 | 展示位 | 内容 | 数据来源 |
| --- | --- | --- | --- |
| 快照 | 看板卡片 | 最新值 + 涨跌 | dashboard 快照（已有设计） |
| 历史 | 指标详情弹窗 | 走势图：指数/汇率/基金指数近 120 日 K；收益率/宏观近 60 期 | 收益率/宏观随快照一次取回；指数类按需 `macro-series` 拉取 |
| 明细 | 指标详情弹窗 | 口径说明、数据来源、更新时间 | 静态元数据（`shared/macro.ts`） |

**看板 4 个分区**：

| 分区 | 内容 |
| --- | --- |
| 市场行情 | 上证、深证成指、沪深300、中证500、创业板指、科创50、恒生、标普500、纳指100（价格 + 涨跌幅）；沪深300 迷你走势 |
| 利率与汇率 | 中债 2/5/10/30Y、10Y-2Y 利差、美债 10Y、USDCNH |
| 宏观景气 | CPI 同比、PPI 同比、制造业 PMI、非制造业 PMI、GDP 累计同比（M2 同比待字段核实后补） |
| 基金市场 | 上证基金指数（含迷你走势）、深证 ETF、近 1 年涨幅 Top5 基金 |

**点击交互统一规则**：

| 元素 | 单击行为 |
| --- | --- |
| 指标卡 | 打开详情弹窗（沿用 ConfirmDialog 的 overlay 模式；走势图为内置 SVG 轻量绘制，不引入图表库初始化成本） |
| 弹窗底部动作 | 「引用到对话」「就此生成洞察」（与主题卡同机制） |
| 基金排行条目 | 引用到对话（`代码 名称 近1年涨幅 x%`） |
| 看板分区头 | 「引用本组」批量预填该分区指标 |
| 主题卡 | 三按钮（见「与会话输入框的联动」） |

- 弹窗打开时才按需拉指数类历史（`macro-series {secid, days}`），store 内
  缓存 5 分钟；收益率/宏观历史直接取快照中已带的多期数据，不额外请求。
- 弹窗关闭不丢页面状态（看板、滚动位置保持）。

### 消息通知（推送）

与「数据更新推送」区分——`macro-dashboard-updated` 是看板的静默刷新，不算
通知；只有下面两类进入通知中心：

| 类型 | 触发 | 载荷 | 点击行为 |
| --- | --- | --- | --- |
| `briefing` | 宏观定时任务 fire 完成、会话创建成功 | themeId / sessionId / title | 跳 `/live/:id` 看生成的简报 |
| `alert` | 刷新后指标越过异动阈值 | 指标名 / 数值 / 变化 | 打开宏观页并高亮该指标 |

- 默认阈值：主要指数单次刷新 |涨跌幅| ≥ 1.5%；中债 10Y 较上次刷新变动
  ≥ 5bp；USDCNH ≥ 0.3%。同指标同方向 4 小时内不重复提醒。
- 承载：主进程 `macroNotify`（内存 + `userData/macro-notifications.json`，
  上限 50 条，含未读状态）；渲染层 `useMacroStore` 维护未读计数。
- 呈现：侧边栏「宏观洞察」NavRow 未读红点 + toast（点击直达）+ 页面铃铛
  列表（全部已读 / 单条点击已读）。
- 系统级通知（Electron Notification）v1 不做，载荷保留 `system?: boolean`
  字段，后续可在设置页加开关。

页面状态：加载骨架 → 数据（含「更新于 HH:mm」+ 刷新按钮）→ 部分失败显示
分区空态并在页脚提示数据源错误；全部失败时看板整体显示「数据源暂不可用」，
**主题卡仍可用**（prompt 降级为不带快照的通用分析指令）。

### 洞察主题（v1 六张卡）

利率与流动性 / 通胀与增长 / 汇率与外部环境 / 政策与监管动态 /
基金市场温度 / 估值与风格轮动（宏观与基金并重）。

- 每张卡：图标、标题、一句话描述、关联面板指标、`prompt` 模板。
- `buildMacroPrompt(theme, snapshot)`：把当前看板数值注入 prompt（缺失数据
  自动省略），并要求 agent 使用 `finance-core` / `equity-research` 等
  profile 技能输出结构化洞察。**该函数放 `packages/shared/src/macro.ts`**，
  渲染层与主进程（定时任务触发）共用。
- 点卡片主按钮「生成洞察」：`startDraft()` → `sendPrompt(prompt)` →
  `navigate('/live/' + id)`（复用 CommandPalette `runWorkflow` 的既有模式）。

### 与会话输入框的联动（v1）

复用两条现有通道，**不新增机制**：

| 入口 | 行为 | 机制 |
| --- | --- | --- |
| 主题卡「生成洞察」 | 新建会话直接发送，结果流式展示 | `startDraft` + `sendPrompt` + `navigate('/live/:id')` |
| 主题卡「引用到对话」 | 预填输入框（追加 + 聚焦，不发送），用户编辑后自己发 | `setComposerDraft(prompt)` + `navigate('/live')`（同 kv-card actions / Reproduce 语义） |
| 指标卡「引用」 | 追加单行数据，如 `沪深300 4507.39（+1.06%，2026-09-18）` | 同上 |
| 看板「引用核心指标」 | 批量追加关键指标若干行，供用户自由组合提问 | 同上 |

说明：引用型不自动发送（human in the loop）；`composerDraft` 由 Composer
消费后自动清空，文本追加在用户已输入内容之后。

### 与定时任务的联动（v1）

主题卡提供「设为每日任务」：确认框展示任务名与时间，确认后创建调度任务
（默认工作日 08:30，`30 8 * * 1-5`，`maxRunsPerDay:1`，可在任务页调整）。

关键设计：**定时任务触发时动态生成 prompt**，而不是固化创建时的旧快照。

- `ScheduledTask` / `CreateTaskInput` 增加可选字段 `macroTheme?: MacroThemeId`；
- 主进程 fire 回调中，若任务带 `macroTheme`：先 `await refreshMacro()`
  （等待一次实时刷新，失败则退回最近缓存），再用最新快照
  `buildMacroPrompt(theme, snapshot)` 生成 prompt 发送；
- 这样「每日宏观简报」每次触发的都是当日数据，数据获取同样走
  `macroStore` 的缓存/去重逻辑，不重复请求。
- 任务触发并创建会话后，推送 `briefing` 通知（见「消息通知」），侧栏红点
  与 toast 让用户知道简报已就绪。

### 前端文件

| 文件 | 动作 |
| --- | --- |
| `packages/shared/src/macro.ts` | 新增：DTO 类型 + 主题与指标元数据（标题/口径/来源/关联关系）+ `buildMacroPrompt` / `buildIndicatorLine`（纯函数，主进程与渲染层共用） |
| `main/macroData.ts` + `.test.ts` | 新增：接口原始数据 → 归一化结构的纯解析函数 + fixture 测试 |
| `main/macro.ts` | 新增：MacroStore（抓取/快照/磁盘缓存/去重/过期/按需历史/推送） |
| `main/macroNotify.ts` + `.test.ts` | 新增：阈值判断、去重、通知列表与未读状态（纯逻辑可测） |
| `main/scheduler.ts` | 修改：`ScheduledTask` / `CreateTaskInput` 加 `macroTheme?` 字段 |
| `main/ipc.ts` | 修改：注册 macro 五个通道；fire 回调支持 macroTheme 动态 prompt 与 briefing 通知 |
| `renderer/app/routes/MacroInsightsPage.tsx` | 新增：页面组装（分区、主题区、通知入口） |
| `renderer/components/macro/{IndicatorCard,IndicatorDialog,ThemeCard,NotificationsMenu}.tsx` | 新增：卡片/详情弹窗/主题卡/通知列表 |
| `renderer/lib/macroStore.ts` | 新增：渲染层通知与未读计数（zustand，侧栏红点共用） |
| `renderer/lib/useMacroDashboard.ts` | 新增：快照 hook（先订阅、首次读取缓存、`seq` 防乱序） |
| `renderer/lib/toast.ts`、`components/ui/Toaster.tsx` | 修改：toast 支持点击动作（通知点击直达） |
| `renderer/app/layout/AppShell.tsx` | 修改：订阅 macro-notification、加载未读、toast 跳转 |
| `renderer/lib/macroPrompts.test.ts` | 新增：引用型/主题 prompt 组装测试（import shared 函数） |
| `renderer/app/router.tsx` | 修改：加 `/macro` 路由 |
| `renderer/components/sidebar/Sidebar.tsx` | 修改：加 NavRow（图标 `LineChart`，位于「任务」与「技能」之间）+ 未读红点 |
| `renderer/lib/i18n.tsx` | 修改：加 `sidebar.macro` 键（en / zh-CN） |
| `renderer/electron.d.ts`、`preload/index.ts`、`renderer/lib/electron.ts` | 修改：桥接 4 个 invoke 通道 + 2 个推送订阅 |

页面文案沿用现有页面风格（中文硬编码），仅侧边栏标签走 i18n。

### 安全、性能与合规

- 所有外网请求只发生在**主进程**，渲染层通过 IPC 取数；不新增权限、
  不进沙箱；仅将上次快照与通知列表写入 `userData/`（公开行情数据，无凭据、
  无用户内容）。
- 不引入新依赖（使用内置 `fetch`）。
- 页面底部固定声明：「数据来自公开接口，可能存在延迟或误差，仅供研究参考，
  不构成投资建议。」
- 接口为免费公开接口、无官方 SLA：解析全部容错，失败降级；天天基金排行为
  JS 文本非 JSON，单独解析器 + fixture 测试。

### 测试

- `main/macroData.test.ts`：五类解析函数的 fixture 测试（含畸形输入）。
- `main/macroStore` 纯逻辑测试：快照合并、`seq` 单调递增、过期判断
  （TTL）、按需历史缓存、磁盘缓存 round-trip。
- `main/macroNotify.test.ts`：阈值判断、同指标同方向去重、未读计数与上限。
- `renderer/lib/macroPrompts.test.ts`：主题 prompt / 指标行组装（含数据缺失
  降级与字段顺序）。
- 页面本身不新增挂载测试（与 TasksPage/RoomsPage 现状一致）；定时任务的
  动态 prompt 分支通过上述纯函数覆盖，fire 链路沿用现有手动冒烟。

## 实施步骤

1. **数据层与共用逻辑**：shared 类型 + 主题/指标元数据 + prompt 函数 →
   `macroData.ts` + 纯解析单测 → `macroStore`（快照/缓存/去重/过期/`seq`/
   按需历史）→ `macroNotify`（阈值/去重/通知列表）→ IPC 与两类推送 → 启动
   预取接入 `index.ts` → scheduler `macroTheme` 动态 prompt 与 briefing
   通知；验证：`pnpm --filter @workbench/desktop test`。
2. **桥接**：preload / electron.d.ts / lib/electron.ts（4 个 invoke + 2 个
   订阅）；验证：对 `tsconfig.node.json`、`tsconfig.web.json` 分别执行 tsc
   （绕开已知的 `tsc --noEmit` 空转问题）。
3. **UI 与联动**：页面 + 指标卡/详情弹窗 + 主题卡三按钮 + 通知菜单与侧栏
   红点 + 定时任务确认框 + 路由 + i18n；验证：`pnpm md:check`、相关单测、
   `pnpm dev` 手动冒烟（有缓存秒开、冷启动骨架、刷新不阻塞、部分失败降级、
   生成洞察进会话、引用到对话预填、设为每日任务、弹窗走势、通知点击跳转）。

## 验证状态

方案阶段（2026-09-18）与实施（2026-09-19）：

- [x] 需求边界确认（形态/数据源/范围）。
- [x] 7 组公开接口连通性与返回格式实测（见「调研结论」）。
- [x] 国债收益率字段映射来源确认（东财官方页面 JS）。
- [x] 交互模式与现有代码模式对齐（`startDraft + sendPrompt + navigate`）。
- [x] 获取/展示异步划分：快照秒回 + 推送更新 + 磁盘缓存。
- [x] 联动范围确认：基础引用（生成洞察 / 引用到对话 / 指标引用）+ 设为每日任务。
- [x] 弹窗历史数据能力实测：指数/汇率/基金指数 K 线、收益率多期历史均可用。
- [x] 划分与通知设计确认（4 分区 × 3 层；briefing/alert 两类通知）。
- [x] 实施第 1 步：新增单测 30 个全部通过（macroData 13、macroNotify 10、
      macroPrompts 7）；解析、快照合并、`seq` 防乱序、通知去重均覆盖。
- [x] 实施第 2 步：`tsconfig.node.json` / `tsconfig.web.json` 分别 typecheck，
      **新增代码 0 错误**（存量错误 9 / 46 个与本次无关，已在差异清单记录；
      `pnpm typecheck` 空转问题依旧）。
- [x] 实施第 3 步：`pnpm --filter @workbench/desktop build` 通过；全量测试
      52 文件 / 434 用例通过。
- [x] 真实网络冒烟（2026-09-19）：9 指数行情、沪深300 60 日 K、60 期收益率、
      4 组宏观报表 ×24 期、汇率、2 个基金指数、5 条基金排行全部正常。
- [x] 合规文案：页面已含「数据来自公开接口，可能存在延迟或误差；仅供研究参考，
      不构成投资建议」，最终措辞待打包者确认。
- [ ] GUI 人工冒烟（打开页面看板、详情弹窗、三处引用、设为每日任务、通知
      红点与点击跳转）需在 `pnpm dev` 桌面环境中确认。
- [ ] 货币供应（M2 同比）字段语义核实——本次未上该指标（与方案一致）。

## 风险与边界

- 免费接口无官方承诺，路径/字段可能变更 → 解析容错 + `errors[]` 降级，
  后续可在 `macroData.ts` 单点修复。
- 本机网络环境（代理/防火墙）可能导致接口不可达 → 主题卡不依赖数据，
  看板给出明确空态；定时任务触发时若刷新失败，退回最近缓存并在 prompt 中
  标注数据时间，不让任务直接失败。
- 多用户并发刷新由主进程单飞去重；TTL 5 分钟，避免高频请求。
- 通知只说两件事（简报就绪 / 指标异动）：阈值保守、同向 4 小时去重、
  列表上限 50，避免打扰；系统级通知 v1 不做。
- v1 不做历史对比；磁盘只缓存**上次成功快照**与通知列表用于冷启动。
