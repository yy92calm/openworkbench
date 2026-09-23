# 05 · 能力模块

> 所属：架构现状系列 · [返回索引](./README.md)

本文覆盖主进程除核心壳与远端之外的能力域。

## 1. 定时任务（scheduler）

- **存储**：electron-store scope `workbench.scheduler`，`tasks`（数组）与
  `executions`（unshift 追加，上限 200 条）。
- **引擎** `CronEngine`（`croner` 驱动）：`start/stop/reload/addTask/
  removeTask/updateTask/toggleTask/fireNow/listTasks/getHistory/
  deleteExecution/clearHistory`；`addTask` 会先用 `new Cron(expr).nextRun()`
  校验表达式合法性。
- **触发链路**（opencode 模式，`ipc.ts` 注入 fire 回调）：新建 session →
  监听 `session.idle`（10 分钟超时兜底）→ `sendPrompt(task.prompt)`。
  任务的 `agent`/`model` 字段被存储但**触发时未使用**。
- **每日预算守卫** `schedulerGuards.ts`：按本地日统计
  `running/completed/failed`（排除 skipped），达到 `maxRunsPerDay` 时跳过。
  纯函数本身正确，但调用方传参不匹配导致**运行时永不生效**——见
  [差异清单](./07-doc-code-gaps.md)。
- **内部 HTTP API**：`127.0.0.1:随机端口`，Basic `user:<sidecar 密码>`；
  端点覆盖任务 CRUD、toggle、fire、history。供 MCP 脚本回调。
- **MCP 桥**：`apps/desktop/scripts/mcp_scheduler.mjs` 零依赖 stdio JSON-RPC，
  暴露 `scheduler_list/create/update/delete/toggle/fire_now/history`。
  `startSidecar()` 时把 `mcp.scheduler` 注入 opencode.json。
- **渲染层**：9 个 `scheduler:*` IPC；**没有主进程→渲染层推送事件**，UI 靠
  手动刷新（历史方案中的 `scheduler:event` 未实现）。
- `packages/scheduler` 是一份未接入主应用的独立实现（无引用），见第 8 节。

## 2. 终端（terminal）

- `terminal.ts:registerTerminalHandlers()`：node-pty 会话表
  `Map<id, {pty}>`，天然多会话；创建参数 `type` 被忽略（无 SSH 实现），
  `shellName` 可选；cwd 为 `$HOME`，env 全量 + `LANG/LC_ALL`。
- IPC：`terminal:create/write/resize/close`；输出事件按会话
  `terminal:data:<id>`、`terminal:exit:<id>` 推给聚焦窗口。
- 渲染层 `TerminalPanel` + xterm.js：多标签、复制粘贴、搜索 addon、字号
  持久化；面板常驻挂载保状态。
- 终端 PTY **不受沙箱约束**（沙箱只包装 sidecar 与 kernel spawn）。

## 3. 代码内核（kernel）

- 语义是**一次性子进程执行**，不是持久 REPL：`kernelExecute(code, language,
  notebook)` 以 `language:notebook` 为 key，`spawn(cmd, ['-c', code])`，
  累积 stdout/stderr，进程退出即从表里删除（`python3` 有命令名特判）。
- spawn 经 `wrapSpawn` 沙箱包装（与 sidecar 同一策略）；cwd 为当前工作区，
  PATH 用增强后的环境。
- `kernelReset` kill 对应 key；退出时 `killAllKernels`。渲染层切换工作区会
  Reset，CodeBlock 的 Run 按钮与 Notebook 面板触发执行。
- README 所称「per-notebook 持久 kernel」与实际不符，见
  [差异清单](./07-doc-code-gaps.md)。

## 4. 浏览器 MCP（@fafawork/browser-mcp）

- 主进程插件 `createBrowserMcp({workspaceDir, port: 43921})`：
  - 注册 IPC `browser:setup-webview`（记录 webview 的 webContents id）与
    `browser:record-*`（录制/回放/保存/列表）；
  - 监听 `will-download`，下载落到 `<workspace>/downloads`；
  - 启动本地 HTTP API `127.0.0.1:43921`（**无鉴权**，见差异清单）。
- **控制方式**：主进程用 `webContents.fromId(webviewWcId)` 直接驱动 webview
  （navigate/click/type/screenshot/execute-js 等，15s 超时），不再走早期方案
  的渲染层请求-响应 IPC 队列（BrowserPanel 中仍保留死监听）。
- **MCP server**（stdio JSON-RPC，24 个工具）：`browser_open/close/navigate/
  back/forward/refresh/get_content/get_html/get_url/get_title/execute_js/
  click/click_at/type/select/hover/scroll/screenshot/record_*/replay/upload/
  download`；除 open/close 外每步先打开面板并等待 webview 挂载。
- **录制/回放**：录制步骤保存到 `<workspace>/browser-recordings/*.json`。
- `deploy()` 把 `mcp.browser = {type:'local', command:['node', scriptPath]}`
  合并进 opencode.json（asar 路径会剥掉 asar 段）。
- 面板：主进程发 `browser:panel` 事件，渲染层打开/关闭右 dock。

## 5. 离线语音

- STT（主进程 `whisper.ts`）：`isWhisperAvailable()` 检查
  `binaries/whisper/whisper-cli(.exe)` 与 `ggml-tiny-q5_1.bin`；
  `transcribeWav()` 写临时 WAV → spawn whisper-cli → 过滤元数据行 →
  清理临时文件。IPC：`whisper-available`、`whisper-transcribe`。
- TTS 不在主进程，由渲染层使用浏览器 `speechSynthesis`。
- 打包配置已把 `whisper/**` 加入 extraResources。

## 6. 预览服务与工作区文件

- `preview_server.ts`：随机端口的本地静态服务，路径内嵌 token；root 限定在
  workspace/base 之内；退出时停止。
- `artifact_file.ts`：工作区文件读/开/解析/保存/列举/写；`resolveUnderRoot`
  做前缀校验防目录逃逸；预览读取上限 `PREVIEW_CAP = 25MB`；`open-url` 仅
  允许 http(s)。渲染层在 4MB（base64 data URI）处另有上限并静默降级。

## 7. 日志与更新

- `logging.ts`：electron-log 统一日志；`export-logs` IPC 导出。
- `updater.ts`：electron-updater，`UPDATER_ENABLED = CHANNEL !== 'dev'`；
  设置页 `check-for-updates` 触发。

## 8. 宏观洞察（macro · AI 投研）

侧边栏「宏观洞察」，定位为以「轮动模型 + 行业模型」为核心的 AI 投研系统，
全部数据能力在主进程：

- `macroData.ts`：公开接口纯解析（指数行情、日 K、宏观报表、中美国债
  收益率、基金排行文本、行业板块列表含板块 PE、板块成分股、申万指数实时
  行情与分析日报），输入容错。
- `macroStore`（`macro.ts`）：按 indices / yields / macro / fx / funds /
  industries / sw 七组并行抓取；内存快照 + `userData/macro-cache.json`
  磁盘缓存（冷启动秒开）；5 分钟 TTL、并发去重、按需历史（`macro-series`）
  与行业详情（`macro-industry`，成分股 PE/PB 中位数 + 板块 PE 分位 + 120 日
  走势）；启动预取（不阻塞）。行业指数与基金指数使用 shared 规范名映射
  （东财 `f14` 原值如「800材料」不直接上屏）。
- 申万行业（`sw` 源）：申万宏源研究所官网公开接口（免 key，与 akshare
  同源）——`index_publish/current/` 实时行情 + `index_analysis_report` 逐日
  分析（收盘 / 涨跌幅 / 换手率 / PE / PB / 股息率 / 成交额占比 / 流通市值，
  单次范围查询约 31×100 行）；分析日报对当日存在发布滞后，以「覆盖 ≥ 28 家
  的最新日期」为截止日；复用 `computeRotation` 在申万一级行业内做百分位
  评分（口径与中证轮动一致），行情用实时、估值 / 评分用截止日；分析数据
  缓存 1 小时（失败回退陈旧缓存）。
- 抓取网络层：走 Electron `net.fetch`（Chromium 栈：系统代理、缺失中间证书
  自动补链——申万官网只发 leaf 证书），瞬时失败自动重试（3 次、退避；1MB
  级响应 2 次），错误信息带底层原因（如 `UND_ERR_SOCKET`）。
- 轮动模型：中证十大行业指数 60 日 K → `computeRotation`（shared 纯函数，
  0.45×相对强度 + 0.35×动量 + 0.20×趋势，行业内百分位；≥67 超配、≤33
  低配）；历史不足的行评分为 null（界面显示「数据不足」，不伪造分数）；
  板块资金流 TOP10 作为信号补充；年化波动 ≥45% 标注「高波动」（仅提示，
  不参与评分）。
- 轮动评分历史：`rotationHistory.ts` 以**行情最新交易日**为键把评分记入
  `userData/macro-rotation-history.json`（同日合并、保留 60 日），刷新时
  附加 `scoreDelta`（较上一交易日），供表格、摘要句与 prompt 使用。
- 行业模型：东财细分行业（约 496 个，按市值取 TOP100 并做多级命名去重）
  以**全板块热力图**呈现（squarified treemap：面积 = 总市值，红涨绿跌、
  深浅随幅度；市值缺失给可见小方块）；点击方块按需拉取成分股 TOP20 估值
  与 120 日历史并在弹窗中展示（板块 PE 为 TOP100 板块截面百分位，仅正 PE，
  越高越贵）。
- 投研闭环（`research.ts`）：决策台账
  `<workspace>/.workbench/research/decisions.jsonl`（记录 → 归因 → 编辑 /
  删除，可导出 CSV 到工作区）；知识资产
  `<workspace>/.workbench/research/knowledge.md`（由 agent 在复盘会话中
  沉淀）；后台生成报告 `<workspace>/.workbench/research/reports/`
  （`YYYYMMDD-HHmm-<theme>.md` + `index.json` 索引，正文取会话最终答复）；
  三类模型 prompt 自动注入最近决策与知识摘要，轮动日报 / 周报另注入申万
  一级行业快照（评分排序 + 估值 + 成交占比）。
- `macroNotify.ts`：两类通知——每日简报（后台任务完成，点击跳生成会话）
  与异动提醒（上证/沪深300 单日 |涨跌幅| ≥1.5%、中债 10Y 变动 ≥5bp、
  USDCNH ≥0.3%），同指标同方向 4 小时去重，列表持久化上限 50 条。
- 定时任务：首次启动一次性自动开通轮动日报（工作日 08:30）/ 轮动周报
  （周一 09:00）/ 复盘周报（周五 16:00）；触发时实时刷新数据并注入研究
  上下文，完成后落盘报告 + 推送简报；用户可在任务页调整 / 停用 / 删除
  （删除不复活）。
- 渲染层：`/macro` 页面（汇报概览：超配 / 低配行业标签 + 5 格 KPI；后台
  简报区：每个主题展示最近报告，可查看 / 复制 / 在对话中打开 / 重新生成；
  轮动评分表 + **申万一级行业全景**（31 行：实时行情 / 估值 / 评分，行点击
  看 100 日走势与明细，可引用到对话或交给对话解析）+ 行业模型（全板块
  热力图：面积 = 市值、红涨绿跌，点击弹窗看估值 / 走势 / 成分股）+ 决策
  台账，数据底座折叠）；界面动作只有「重新生成（后台任务立即跑一次）」与
  「交给对话解析（带上下文开新会话）」，其余研究操作（记录 / 筛选 / 归因 /
  引用等）默认隐藏、悬停显现，阅读态只保留刷新 / 导出 / 通知；汇报摘要可
  复制到剪贴板、导出 Markdown 到 `<workspace>/.workbench/research/`、打印
  （打印藏非打印元素、自动切浅色主题）；红涨绿跌（`rise`/`fall` 语义色）；
  通知经 `macro-notification` 推送 + 侧栏未读红点。

## 9. packages 目录现状

| 包 | 状态 |
| --- | --- |
| `@fafawork/browser-mcp` | 使用中（主进程插件 + MCP server + 面板） |
| `@workbench/sdk`、`@workbench/shared` | 使用中 |
| `@fafawork/scheduler` | **未接入**：desktop 用自研 `src/main/scheduler.ts`；包内引用只指向自身 |
| `@fafawork/terminal` | **未接入**：desktop 直接使用 `node-pty` |
| `@workbench/ui` | 占位（仅 README） |

## 10. 文件速查

| 主题 | 文件 |
| --- | --- |
| 调度器 | `apps/desktop/src/main/{scheduler.ts,schedulerGuards.ts}`、`apps/desktop/scripts/mcp_scheduler.mjs`、`renderer/app/routes/TasksPage.tsx` |
| 终端 | `apps/desktop/src/main/terminal.ts`、`renderer/components/inspector/TerminalPanel.tsx` |
| 内核 | `apps/desktop/src/main/kernel.ts`、`renderer/components/notebook/*` |
| 浏览器 MCP | `packages/browser-mcp/src/{main,renderer}/`、`apps/desktop/src/main/browser-mcp-server.ts` |
| 语音 | `apps/desktop/src/main/whisper.ts`、`renderer/lib/stt.ts` |
| 宏观洞察 | `apps/desktop/src/main/{macro,macroData,macroNotify,rotationHistory,research,researchData}.ts`、`packages/shared/src/macro.ts`、`renderer/app/routes/MacroInsightsPage.tsx`、`renderer/components/macro/*` |
| 文件/预览 | `apps/desktop/src/main/{artifact_file.ts,preview_server.ts}`、`renderer/components/inspector/*` |
