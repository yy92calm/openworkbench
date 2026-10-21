# 宏观面板 · 行业/板块报告弹窗（查看 + 实时生成）

## 背景

宏观洞察页目前只有三个「主题报告」（轮动日报 / 轮动周报 / 复盘与再训练）由后台任务
生成并落盘，单个行业或板块没有自己的报告：

- 东财板块（热力图）点开是「定价明细」弹窗，唯一的模型入口是「交给对话解析」——它
  跳转到会话页，产出留在对话里，不落盘、不可回看。
- 申万一级行业行点开是明细弹窗，同样只有「引用到对话 / 交给对话解析」。
- 中证十行业（轮动表）行完全不可点击，只有 hover 的「记录决策」。

需求：每个行业/板块都能点击弹窗，弹窗里给两个按钮——「查看」直接看该标的最近一份
报告，「生成」在弹窗内实时生成并预览生成过程。

## 设计

### 1. 标的口径（三类）

| kind | 含义 | 入口 | 标识 |
| --- | --- | --- | --- |
| `board` | 东财板块（如 电子 BK0448） | 行业热力图 → 定价明细弹窗 | `code` |
| `sw` | 申万一级行业（如 电子 801080） | 申万表格行 → 明细弹窗 | `code` |
| `csi` | 中证十大行业指数（轮动表行） | 轮动表格行 → 新增报告弹窗 | `secid` |

统一类型 `MacroReportSubject { kind, code, name }`；`subjectKey(kind, code)` 作为唯一键。

### 2. 落盘：与主题报告同目录，索引按家族分别裁剪

仍写 `<workspace>/.workbench/research/reports/`（主进程独占写，`.workbench` 对 agent
写保护）：

- `MacroReportMeta` 的 `themeId` 改为可选，新增可选 `subject`；一条报告必属于且只属于
  一个家族（主题 or 标的）。
- 标的报告文件名 `YYYYMMDD-HHmm-<kind>-<slug>.md`，`slug` 由 code 小写并把非字母数字
  折成 `-`（`BK0448` → `bk0448`，`2.931052` → `2-931052`）。
- `isReportFile` 放宽到 `/^[0-9]{8}-[0-9]{4}-[a-z0-9-]+\.md$/`：仍不含 `/`、`..`、
  大写与扩展名以外的点，路径穿越防护不变。
- 索引仍是单个 `index.json`，但裁剪改为纯函数 `pruneReports(list, caps)`：主题报告保留
  最近 50 条、标的报告保留最近 200 条。**分家族上限是必须的**——否则一批标的报告会
  把主题报告挤出索引，「后台简报」区会退化成「尚未生成」。
- `latestReportsPerTheme` 忽略没有 `themeId` 的条目；新增 `latestSubjectReport(list, subject)`。
- `macro-reports` IPC 仍只返回主题报告（页面既有用法不变），标的报告走新 IPC 按需查。

### 3. 生成链路：渲染层跑真实会话，主进程负责落盘

「弹窗显示生成过程」= 复用现成的会话流式渲染，不新造一套事件转发：

1. 点「生成」→ `useRuntimeStore.startDraft()` + `sendPrompt(prompt)`，拿到真实 `sessionId`。
   会话照常出现在侧边栏，自动记忆 / Wiki 召回照常注入。
2. 弹窗内用 `BlockList` 渲染 `threads[sessionId].blocks`（推理、工具调用、流式正文），
   `runningSessions[sessionId]` 驱动「生成中」状态。
3. 会话 idle（running 标记消失）→ 调 IPC `macro-subject-report-capture(subject, sessionId)`：
   主进程用一次性 client（与 `auto-memory-extract`、Wiki 日批同一套写法）`getMessages`
   取最后一条 assistant 文本（复用 `messageText` 过滤 synthetic part），写盘 + 更新索引 +
   广播 `macro-reports-updated`，返回 meta。
4. 弹窗切到结果态：渲染 markdown，提供「复制全文」「在对话中打开」。

**捕获为什么放主进程**：渲染层的 thread 状态会被关闭的标签页丢弃
（`dropSessionState`），页面刷新也会丢；从 sidecar 读消息才是权威副本，且与后台任务的
`captureMacroReport` 口径完全一致。

生成状态挂在页面级 hook（`useSubjectReports`）而不是弹窗组件里：弹窗关闭不中断生成，
idle 后照样落盘；同一标的生成中时「生成」按钮禁用，避免并发重复跑。

失败路径：`sendPrompt` 返回 null（未连接 / 已有发送在途）→ toast 提示，不进入生成态；
捕获返回 null（会话没有正文）→ 结果态显示「未取到报告正文」，不写空文件。

### 4. Prompt

- `board`：复用现有 `buildIndustryPrompt(detail, snapshot, research)`（盈利/估值/情绪三要素）。
- `sw` / `csi`：新增 shared `buildSwReportPrompt(row, snapshot, research)` 与
  `buildRotationReportPrompt(row, snapshot, research)`，共用私有 `subjectReportBody`：
  指标行直接从行数据取（申万带实时行情 + 截止日估值，中证带评分走势），输出结构按轮动
  视角组织（配置结论 → 信号依据 → 风险与失效条件 → 跟踪指标），篇幅 400–700 字。
- 两者都追加一条硬约束：**直接输出报告正文，不要调用写文件工具**（`.workbench` 写保护，
  报告由应用落盘），避免模型把正文写进工作区文件而弹窗里拿到空回答。

### 5. UI

- 新增 `SubjectReportPanel`：三态（待生成 / 生成中 / 结果），待生成态就是用户要的
  「查看」「生成」两个按钮，并在按钮旁显示最近报告时间与字数（有没有报告一眼可见）。
- `IndustryDialog`、`SwIndustryDialog` 在既有明细下方内嵌该 panel；原有「记录决策」
  「交给对话解析」「引用到对话」入口全部保留。
- `RotationTable` 行新增点击 → `SubjectReportDialog`（弹窗壳 + panel）；行内「记录决策」
  按钮 `stopPropagation` 不变。
- 「查看」读取最近报告后在 panel 内渲染，不再套第二层弹窗。

### 6. 不改动的部分

- 后台三个主题任务的调度、通知、复盘闭环（归因回填 / 知识资产）完全不动。
- 评分与信号仍是确定性规则，标的报告不反写任何模型状态。
- 「后台简报 · 自动生成」区仍只列主题报告。

## 文件清单

| 文件 | 改动 |
| --- | --- |
| `packages/shared/src/macro.ts` | `MacroReportSubject` / `subjectKey` / `asReportSubject`、meta 字段、两条标的报告 prompt |
| `apps/desktop/src/main/researchData.ts` | `subjectReportFileName`、`reportSlug`、`pruneReports`、`latestSubjectReport`、`isReportFile` 放宽 |
| `apps/desktop/src/main/research.ts` | `saveSubjectReport`、`readSubjectReport`、两家族共用的 `writeReport` |
| `apps/desktop/src/main/ipc.ts` | 捕获会话正文并落盘的两个 handler |
| `apps/desktop/src/preload/index.ts`、`renderer/electron.d.ts`、`renderer/lib/electron.ts` | 新 IPC 接线 |
| `apps/desktop/src/renderer/lib/useSubjectReports.ts`（新增） | 生成状态机 + idle 捕获 |
| `apps/desktop/src/renderer/components/macro/SubjectReportPanel.tsx`（新增） | 查看 / 生成 / 实时预览 / 结果 |
| `apps/desktop/src/renderer/components/macro/SubjectReportDialog.tsx`（新增） | 轮动行的弹窗壳 |
| `IndustryDialog.tsx`、`SwIndustryTable.tsx`、`RotationTable.tsx`、`MacroInsightsPage.tsx` | 入口接线 |
| 测试 | `researchData.test.ts`、`research.test.ts`、`macroPrompts.test.ts`、`SubjectReportPanel.test.tsx`（新增） |

## 验证状态

- [x] 方案文档完成
- [x] 命名/裁剪/查询纯函数单测：slug 归一、`isReportFile` 拒绝穿越、家族上限互不挤占、
      取最近一份标的报告
- [x] prompt 单测：申万 / 中证两条口径含行业名、指标行与「不要写文件」约束
- [x] 主进程落盘单测：标的报告写入 `reports/`、索引含 `subject`、主题报告不被挤掉
- [x] 面板组件单测：无报告时「查看」禁用、查看渲染正文并可跳转会话、生成 → 实时预览 →
      idle 捕获 → 结果态、运行时未就绪 / prompt 为空时不启动
- [x] `pnpm format:check`、`pnpm lint`（0 error）、`pnpm test`（desktop 673 / sdk 3 /
      relay 22）、`pnpm md:check`、`pnpm build` 与两个真实 tsconfig 的 `tsc --noEmit`
      通过（仅剩仓库既有的无关错误）
- [ ] 真实端到端（点电子 → 生成 → 弹窗实时预览 → 落盘 → 查看）需 sidecar + 模型凭证，
      由用户在打包版本上验证
