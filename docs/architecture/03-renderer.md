# 03 · 渲染层（apps/desktop/src/renderer）

> 所属：架构现状系列 · [返回索引](./README.md)

## 1. 入口与路由

入口 `main.tsx`：polyfills → `I18nProvider` → `ThemeProvider` →
`RouterProvider`，HashRouter（`app/router.tsx`）：

| 路径 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 重定向 `/live` | |
| `/live`、`/live/:sessionId` | `LiveSessionPage` | 核心会话页（含右 dock） |
| `/example/:sessionId` | `SessionPage` | mock 示例会话 |
| `/skills` | `SkillsPage` | skills / agents / MCP 目录 |
| `/macro` | `MacroInsightsPage` | 宏观洞察：汇报概览（结论句「建议超配 / 低配 + 较上一交易日变化」+ 5 KPI + 导出菜单）+ 后台简报（自动生成报告：查看 / 复制 / 在对话中打开 / 重新生成）+ 轮动模型 + 行业模型 + 决策台账；数据底座折叠、研究操作悬停显现（模型区只有「重新生成 + 交给对话解析」），汇报摘要可复制 / 导出 / 打印 |
| `/tasks` | `TasksPage` | 调度器任务与执行历史 |
| `/files` | `FilesPage` | 工作区文件浏览 |
| `/rooms` | `RoomsPage` | relay 房间聊天/分享 |
| `/settings` | `SettingsPage` | 含配置对话 |
| `*` | `NotFound` | |

`AppShell`（`app/layout/AppShell.tsx`）首次挂载调用
`useRuntimeStore.getState().bootstrap()` 启动运行时并连接；全局拦截
`http(s)` 链接转 `openExternal`；布局为 侧栏 + 主区 + 底部状态栏，并挂
`CommandPalette` 与 `Toaster`。

## 2. 状态管理（zustand）

| Store | 文件 | 关键状态 | 持久化 |
| --- | --- | --- | --- |
| `useUiStore` | `lib/store.ts` | 主题、locale、主区 tabs、`composerDraft`、侧栏宽度/折叠、`expandThreadDetails`、`agentRuntimeKind` | localStorage（tabs 除外，内存态） |
| `useRuntimeStore` | `lib/runtime.ts` | 连接状态、sessions、`threads: Record<id, Thread>`、questions/permissions、workspace、permissionMode、panes、runningSessions 等 | 服务器 URL 等少量写 localStorage；线程内存态 |
| `useInteractionStore` | `lib/store.ts` | profile 渲染器清单 `renderers`、`uiDefaults` | 由 profile 读取，用户覆盖存 localStorage |

`Thread = { blocks: ThreadBlock[], index, consecutiveTools, loaded }`；
`ThreadBlock` 共 11 种：`user` / `agent` / `step-summary` / `tool-call` /
`table` / `figure` / `artifact` / `running-jobs` / `status-line` /
`turn-divider` / `reasoning`（`packages/shared/src/index.ts`）。

`useRuntimeStore` 的模块级单例 `client: AgentRuntime | null` 是全应用唯一的
sidecar 连接；Settings 的配置对话通过 `getClient()` 复用。

## 3. 与主进程的通信

- 桥：preload `window.electronAPI`；渲染层统一封装在 `lib/electron.ts`
  （所有调用 catch 降级）；`lib/tauri.ts` 只是兼容别名（历史命名）。
- **agent 会话事件不走 IPC**：由 `lib/runtime.ts` 里的 `OpenCodeClient`
  直连 sidecar HTTP+SSE。
- 事件订阅：`relay-status-changed`、`relay-remote-sessions-changed`、
  `room-event`、`terminal:data|exit:<id>`、`browser:panel`、
  `macro-dashboard-updated`、`macro-notification`。
- invoke 域：runtime / workspace / artifact / kernel / provenance / profile /
  scheduler / relay / room / logging / updater / whisper / browser。
  （完整通道表见 [01-desktop-shell](./01-desktop-shell.md) 第 4 节。）

## 4. 会话渲染管线

```text
sidecar SSE
  → OpenCodeClient.normalize()：text.updated(全量) / reasoning.updated /
    tool.updated / session.idle / session.updated / session.status / …
  → runtime.connect() 合并层：
      · text/reasoning 写入 streamPending，RAF + 50ms 频控 flush（≈20fps）
      · session.updated 1s 定时合并
      · 其余事件先 flush 文本再 applyEvent（保证顺序）
  → applyEvent()：question/permission 进全局瞬态数组；compaction 触发快照；
    A2UI 先 feedText；最后 foldEvent()
  → foldEvent()（纯 reducer）：按 key 幂等 upsert
      text:<partId> · reasoning:<partId> · tool:<callId> · artifact:<path>
  → threads[sid].blocks → BlockList → MarkdownViewer
```

- **文本全量 upsert**：SDK 发全量文本、reducer 同 key 原地替换，因此重连/
  重放幂等。
- **工具行**：`tool.updated` 过滤 `question/permission/todo`；标题回退链
  `title → command → filePath → tool`；成功写文件时派生 artifact 块
  （`deriveArtifact`，按 `artifact:<path>` 去重）并记录 provenance。
- **展示分层**：`BlockList.prepareItems` 把连续可归组块
  （reasoning / tool-call / status-line / 短 agent 输出，阈值 200 字且非
  结构化内容）合并为 `StepGroup`；超出 `warmCount=40` 的旧消息折叠为
  「展开更早历史」。
- **历史加载** `openSession()`：切工作区（必要时重连）→ 恢复挂起的
  questions/permissions → `getMessages` → A2UI `ingestHistory` →
  `historyToThread` 重建 blocks（slash 命令反向还原为 `/name`，远端消息标
  `remote:true`，`!` shell 轮次还原为内联输出）。
- **一致性兜底** `reconcileRunning()`：对仍持 running 锁的会话拉取历史，
  服务端 `turnIsOver` 为真时解锁并用完整历史替换线程（补回 SSE 重连窗口
  丢失的 `session.idle`）。
- **状态错误**：`session.status retry` 渲染为红色「模型调用失败…」状态行；
  无 sessionId 的 error 进顶部横幅。

## 5. 富输出体系

| 通道 | 识别 | 渲染 | 文件 |
| --- | --- | --- | --- |
| rich fence | 围栏语言 ∈ `html/svg/echarts/csv/tsv` | html→sandbox iframe（`allow-scripts`，opaque origin）；svg→data URI `<img>`；echarts→懒加载实例；csv/tsv→MiniTable；流式未闭合→「正在生成预览」占位，截断→代码块回退 | `lib/fences.ts`、`components/markdown-viewer/FencePreview.tsx` |
| A2UI | 围栏语言恰为 `a2ui`，正文为 A2UI JSON 消息流 | `a2uiEngine` 按 part 精确一次投喂（历史用合成键幂等回放），Lit `<a2ui-surface>` 卡片 | `lib/a2ui/{parser,engine}.ts`、`components/thread/A2uiSurfaceCard.tsx` |
| 产物卡 | 写类工具成功（`write/edit/create/str_replace_editor/apply_patch`，jupyter 特判） | 按扩展名分 7 类，figure/table/report 走富预览，其余两行卡；正文路径引用生成 chip | `lib/artifacts.ts`、`components/thread/ArtifactCard.tsx` |
| `workbench:` 缝 | 围栏语言 `workbench:<type>` 且在 profile 渲染器清单中启用 | 内置 `kv-card`（支持 `actions` 按钮预填 prompt，不自动发送）；`config-patch` 供设置页配置对话 | `lib/renderers.tsx`、`packages/shared/src/interaction.ts` |

- ANSI 只在展示层净化（`lib/ansi.ts`），存储保持原样。
- prompt 侧的富输出约定写在打包 profile 的 `AGENTS.md` 与
  `visual-output-spec` skill（格式选择三判据、通道映射、交付门禁），不属于
  应用代码。

## 6. 上下文面板与右 dock

- `ContextPanel` = `TokenUsage` + `AutoContext`：
  - `TokenUsage` 优先使用真实 API token（`session.updated` 心跳），无数据时
    回退字符数/4 估算；上下文窗口优先 provider 的 `contextLimit`，回退
    128k；环形阈值 70% / 90% 换色；「请求报文」用 `buildTurns` 按轮次组织，
    摘要经 `cleanSummary` 净化（去围栏/标记，保留内容）。
  - `AutoContext` 分组展示 Agents / Skills / MCP（只读）。
- dock 面板（`WorkbenchDock`）：context / browser / terminal / files 互斥；
  TerminalPanel 常驻挂载保状态；BrowserPanel 首次打开才挂载。
- 文件预览在主区 file tab（`FilePreviewTab`），`InspectorShell` 按
  variant 分发：artifact（版本/执行日志/环境/消息）、notebook、pdf、通用文件
  （html/pdf/图片、csv 表格↔图表、docx/xlsx/pptx 懒加载、md/json 代码视图），
  并可展开 `ProvenancePanel`。

## 7. 交互功能

- **主区 Tab**（`lib/store.ts` + `components/thread/TabBar.tsx`）：会话
  **单实例复用**——所有会话共用一个 session tab，切换即替换；file tab 按
  `artifact.path` 去重，可后台打开（`activate=false`）。关闭 tab 不删会话。
- **滚动记忆**（`lib/scrollMemory.ts`）：模块级 Map 记录
  `chat:<sessionId>`、`artifact:<title>:<tab>` 等偏移，草稿转正时会迁移键。
- **@ 引用**（`components/thread/Composer.tsx` + `lib/useWorkspaceFiles.ts`）：
  候选为工作区根目录（懒加载）与线程内 artifact 路径合并；发送时文件仍走
  「复制进工作区 + 文本提示」路径，不改 prompt parts 协议。
- **Composer**：`/` 命令（来自运行时目录）、`!` shell 模式（内联 bash 输出）、
  输入历史（localStorage，100 条）、长粘贴转文件、离线 STT 录音、IME 保护。
- **命令面板**（`⌘/Ctrl+K` 或非输入态 `/`）：新建会话、工作流起始 prompt、
  打开笔记本、技能、设置、主题。注意「打开笔记本」跳转的 `/notebooks`
  当前无对应路由（见[差异清单](./07-doc-code-gaps.md)）。

## 8. 文件速查

| 主题 | 文件 |
| --- | --- |
| 路由/布局 | `app/router.tsx`、`app/layout/AppShell.tsx`、`app/providers/ThemeProvider.tsx` |
| 运行时状态机 | `lib/runtime.ts` |
| UI 状态 | `lib/store.ts` |
| 渲染管线 | `lib/runtime.ts`（foldEvent/historyToThread/reconcileRunning）、`lib/threadGroups.ts`、`lib/messageTurns.ts` |
| 富输出 | `lib/fences.ts`、`lib/a2ui/*`、`lib/artifacts.ts`、`lib/renderers.tsx`、`components/markdown-viewer/*` |
| 会话组件 | `components/thread/*`（BlockList/StepGroup/AgentMessage/TabBar/Composer/DecisionSurface） |
| 面板 | `components/inspector/*` |
