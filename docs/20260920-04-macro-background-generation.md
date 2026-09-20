# 20260920-04 · 宏观洞察：生成归后台，界面回归查看

## 背景与需求

用户反馈：**界面重点是查看数据；内容生成应由后台服务承担；界面操作收敛为
「再次触发生成」和「交给对话进一步解析」**。经确认的口径：

1. 后台生成的分析（日报 / 周报等）**落盘为工作区报告**，页面展示
   「最近生成 + 时间」并可查看 / 复制；简报通知仍可跳会话；
2. 模型区动作收敛为两个次级动作：**「重新生成」**（后台任务立即跑一次）
   与 **「交给对话解析」**（带上下文开新会话）；
3. **自动开通三个默认宏观任务**（轮动日报 / 轮动周报 / 复盘周报），可在
   「任务」页关闭或调整。

## 现状核对（代码）

| # | 现状 | 问题 |
| --- | --- | --- |
| 1 | 「生成轮动周报 / 生成行业定价分析 / 复盘与再训练」由页面按钮直接拉起前台会话 | 生成入口在界面；结果只存在于会话，页面无法查看 |
| 2 | 「设为工作日任务」需用户手动创建 | 后台生成默认不开通，依赖界面操作 |
| 3 | 调度器 `macroTheme` 任务跑完只推简报通知 + 会话 | 结果不落盘；页面无生成状态可看 |
| 4 | 渲染层只订阅 `macro-dashboard-updated` / `macro-notification` | 报告落盘后页面不会自动更新 |
| 5 | `CronEngine.scheduleOne` 覆盖同 id job 但不停止旧 job | `start()` 与 `addTask()` 叠加时会重复触发（自动开通会常态化触发该路径） |
| 6 | `shouldSkipDueToDailyLimit(task, …)` 传入 `ScheduledTask`（字段为 `id`），守卫读取 `taskId` | 每日限额守卫实际不生效；默认任务依赖它防同日重复触发（顺带修复） |

## 设计

### 1. 后台任务自动开通（一次性，用户后续完全接管）

- `scheduler.ts` 新增默认模板与 `ensureMacroTasks()`（`app.whenReady()` 调用）：

  | 主题 | 名称 | 默认 cron |
  | --- | --- | --- |
  | `rotation-daily` | 宏观洞察 · 轮动日报 | `30 8 * * 1-5`（工作日盘前） |
  | `rotation-weekly` | 宏观洞察 · 轮动周报 | `0 9 * * 1`（周一开盘前） |
  | `review-weekly` | 宏观洞察 · 复盘周报 | `0 16 * * 5`（周五收盘后） |

- 开通语义：electron-store 记 `macroProvisioned` 标记，**每次安装只开通一次**；
  之后用户在任务页删除 / 停用 / 改 cron 均不会被覆盖（不会复活）。
- `CronEngine` 增加 `ensureTask(input)`：按 `macroTheme` 幂等（存在即返回，
  不存在则创建但**不排程**——排程统一由运行时启动的 `start()` 负责）；
  `scheduleOne` 先停止同 id 旧 job（幂等修复，见现状 #5）。
- 默认任务的 prompt 用 `buildMacroPrompt(theme, null, null)` 兜底；触发时
  仍按现有路径用实时数据重建。

### 2. 生成结果落盘（后台 → 工作区报告）

- 目录：`<workspace>/.workbench/research/reports/`
  - 正文：`YYYYMMDD-HHmm-<themeId>.md`（会话最终答复 Markdown）；
  - 索引：`index.json`（`MacroReportMeta[]`：themeId / file / createdAt /
    chars / sessionId，上限 100 条，不删除历史文件）。
- 落盘时机：调度器 fire 回调 `session.idle` 之后取最后一条 assistant 消息
  → `saveMacroReport()` → 广播 `macro-reports-updated`；随后照旧推送简报
  通知（点击进会话）。
- IPC（主进程 → 渲染层）：

  | 通道 | 作用 |
  | --- | --- |
  | `macro-reports` | 每个主题的最新一份报告元数据 |
  | `macro-report-read` | 按文件名读取正文（正则校验，防路径穿越） |
  | `macro-regenerate` | 按主题找到 / 补齐任务并**立即后台执行**，立即返回（不阻塞界面） |
  | `macro-reports-updated`（广播） | 报告落盘后页面自动刷新列表 |

- shared 新增 `MacroReportMeta`；纯函数（文件名、索引序列化 / 解析、每主题
  取最新）落在 `researchData.ts`，IO 落在 `research.ts`（与决策台账同构）。

### 3. 页面（查看优先；操作只有两类）

- 新增「**后台简报 · 自动生成**」区（概览之下、模型之上；`order-2`）：
  每个主题一行，展示最近生成时间 / 字数，或「尚未生成」+ 计划说明；
  - 行点击 → 弹窗查看（MarkdownViewer 渲染）、复制；
  - 弹窗内「在对话中打开」→ 跳生成会话（进一步追问）；
  - hover 次要操作：「复制」「重新生成」（页面动作 2 类原则）。
- 模型区动作收敛（悬停显现，沿用现页面模式）：

  | 区域 | 重新生成（后台） | 交给对话解析（新会话） |
  | --- | --- | --- |
  | 轮动模型 | 轮动日报 | `buildRotationPrompt` |
  | 行业模型 | —（按需；数据随选择自动拉取） | `buildIndustryPrompt`（选中板块） |
  | 决策台账 | 复盘周报 | `buildReviewPrompt` |

- 移除：「设为工作日任务」按钮（改自动开通）、「生成轮动周报」「生成行业
  定价分析」「复盘与再训练」按钮语义（并入上表两个动作）。
- 数据查看部分（概览 / KPI / 轮动表 / 行业面板 / 台账 / 数据底座 / 刷新）
  保持不变。

### 4. 文件清单

| 文件 | 动作 |
| --- | --- |
| `packages/shared/src/{macro,index}.ts` | 新增 `MacroReportMeta` 并导出 |
| `main/scheduler.ts` | 默认任务模板、`ensureTask`、`ensureMacroTasks`、`scheduleOne` 幂等 |
| `main/scheduler.test.ts` | 新增：幂等开通 / 默认任务 cron 合法性（mock store） |
| `main/researchData.ts` | 报告文件名 / 索引解析 / 每主题最新（纯函数）+ 测试 |
| `main/research.ts` | 报告落盘 / 列表 / 读取（IO） |
| `main/ipc.ts` | fire 回调捕获最终答复落盘 + 三个新通道 + 广播 |
| `main/index.ts` | `app.whenReady()` 调 `ensureMacroTasks()` |
| `preload/index.ts`、`renderer/electron.d.ts`、`renderer/lib/electron.ts` | 桥接新通道 / 事件 |
| `renderer/lib/useMacroReports.ts` | 新增：报告列表 hook（读取 + 订阅） |
| `renderer/components/macro/ReportSection.tsx` | 新增：后台简报区 + 查看弹窗 |
| `renderer/app/routes/MacroInsightsPage.tsx` | 接入简报区、重排 order、动作收敛、移除旧按钮 |
| `renderer/components/macro/{IndustryPanel,DecisionLedger}.tsx` | 动作收敛（交给对话解析 / 重新生成） |
| `docs/architecture/{01-desktop-shell,03-renderer,05-capabilities}.md`、`CHANGELOG.md`、本文档 | 同步 |

### 5. 测试

- 单测：报告文件名 / 索引解析 / 每主题最新（纯函数）；`ensureTask` 幂等、
  默认任务 cron 可被 croner 解析；门禁：desktop 全量测试、`pnpm lint` /
  `format:check` / `md:check`、desktop build、web typecheck 基线 46 不变。
- GUI 人工冒烟：首次启动任务页出现 3 个宏观任务；点「立即生成」后通知 +
  「后台简报」区出现最新报告并可查看；运行中删除任务后重启不复活。

## 实施步骤

1. shared 类型 + researchData 纯函数与测试；
2. research 落盘 IO + scheduler 幂等开通与测试；
3. ipc 捕获 / 新通道 / 广播 + index.ts 接线；
4. preload / electron 桥 + useMacroReports + ReportSection；
5. 页面与模型区动作收敛；
6. 文档同步 + 全量门禁 + GUI 冒烟标注待人工。

## 验证状态

方案阶段（2026-09-20）：

- [x] 现状以代码核对（5 项，见上表）。
- [x] 口径确认：落盘报告页面可看；模型区「重新生成 + 对话解析」；自动
      开通三个任务。

实施（2026-09-20）：

- [x] 第 1 步：shared 新增 `MacroReportMeta`；`researchData.ts` 报告纯函数
      （文件名 / 文件名白名单 / 索引解析 / 每主题最新）；单测 14 用例通过。
- [x] 第 2 步：`research.ts` 报告落盘（`reports/` + `index.json`，上限 100
      条、不删历史文件）；`scheduler.ts` 默认三任务 + `ensureTask`（按主题
      幂等、不排程）+ `ensureMacroTasks`（一次性开通）+ `scheduleOne` 幂等；
      顺带修复每日限额守卫传参（`taskId: task.id`）；scheduler 单测 6 用例
      通过（含「同日第二次触发被跳过」）。
- [x] 第 3 步：fire 回调 `session.idle` 后取最终 assistant 文本落盘并广播
      `macro-reports-updated`；新增 `macro-reports` / `macro-report-read` /
      `macro-regenerate`（立即返回，删除过的任务只重建为停用再执行一次）；
      `app.whenReady()` 调 `ensureMacroTasks()`。
- [x] 第 4 步：preload / `electron.d.ts` / `lib/electron.ts` 桥接 +
      `useMacroReports` + `ReportSection`（查看弹窗 Markdown 渲染 / 复制 /
      在对话中打开 / 立即生成 / 重新生成）。
- [x] 第 5 步：模型区动作收敛为「重新生成 + 交给对话解析」，移除「设为工作日
      任务」与页面直接生成按钮；简报区插入为 `order-2`。
- [x] 门禁：desktop 55 文件 / 483 用例全绿；`pnpm lint` / `format:check` /
      `md:check` 全绿；desktop build 通过；web typecheck 基线 46 不变，
      node typecheck 修复后基线 8（均为既有错误，无新增）。
- [ ] GUI 人工冒烟：首次启动任务页出现 3 个宏观任务且可改期 / 停用 / 删除；
      「立即生成」后收到简报通知、报告区出现最新报告且可查看 / 复制 /
      在对话中打开；任务删除后重启不复活。

## 风险与边界

- 「重新生成」为后台执行且**不等待**：界面立即返回「已触发」提示，完成时
  以简报通知 + 报告区更新体现；运行未启动时提示失败，不静默。
- 页面只展示每主题**最新一份**报告；历史报告文件保留在
  `.workbench/research/reports/`，可按需扩展列表。
- 行业模型没有周期任务（分析对象是所选板块，无法预先计划），其「生成」
  由「交给对话解析」承担——符合「界面触发生成或交给对话」的总原则。
- 自动开通仅一次；删除任务后不复活——简报区的「重新生成 / 立即生成」只按需
  补跑一次（若任务已被删除，会重建一个默认停用的任务并立即执行，需要在
  任务页手动启用才会恢复排程）。
- 报告正文取会话最终答复；若模型多轮输出，取最后一条 assistant 文本。
