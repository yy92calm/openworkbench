# OC Manager 可借鉴项落地方案

日期：2026-09-30，序号 01

## 背景

对照 `~/Desktop/OpenCode-Client`（OC Manager，Go 1.25 + Wails v3 + 原生 JS，约 9.2k 行 Go / 25 个前端模块）逐文件调研，梳理可移植到 Workbench 的能力。

总判断：**OC Manager 的长处在「面向用户的功能密度」，Workbench 的长处在架构、安全与运行时抽象**。因此本方案吸收的几乎全部是前者——用户每天摸得到的具体功能；反向的（沙箱、运行时适配器、relay 可靠性）本就领先，不作为吸收项。git 面板与文件编辑（写）按决定暂缓，见「约束项」。

本次范围为**纯调研与方案设计，不改代码**（遵循「先方案文档、再改代码」流程）。

出处说明：正文所有 `文件:行` 均在本次调研中实际读取核实（OC Manager 侧相对仓库根；Workbench 侧相对 `apps/desktop/src/`）。调研中同时修正了 OC Manager 文档的三处不实描述，见「验证状态」。

### 约束项（本次不实施）

| 项 | 原因 | 去向 |
|----|------|------|
| Git 面板 | 用户决定暂缓 | backlog；接口设计参考 `service/filebrowser/git_changes.go`（全文件 diff / 大仓库缓冲两条细节值得留档） |
| 文件编辑（写盘） | 用户决定暂缓；且必须先接入 `main/sandbox/policy.ts` 才安全 | backlog；下文第 3 项的「写」能力一并归入此项 |
| 知识库 → 资产转化（skill/command/rule/AGENTS.md） | 目标目录 `app-config/.opencode/` 由打包者拥有，运行时写入与镜像部署语义冲突（`server.ts:213-231` 每次启动 syncDir 会 prune） | backlog；须先确定写入目标（user 层或工作区 `.opencode/`）并过 patch 覆盖层 |
| 内嵌 Web 服务（复用同一份渲染层给浏览器） | 与已有 relay + client 定位重叠，且那套方案能力更强（房间、E2E、设备配对） | backlog；边界待厘清，详见第 9 项 |
| 统一 RPC 单入口（`AppCall` switch 全量分发） | 与 Electron 的 channel / preload 类型安全惯例冲突 | 降级为「channel 常量表」，见第 9 项 |

## 设计

### 1. 知识库（vault + 索引自愈 + `@` 引用）

**OC Manager 的做法**：条目以 `<程序目录>/vault/*.md` 存储（`service/knowledge/dir.go:16` `VaultDir`，不可写时回落 `UserConfigDir/oc-manager/vault`，:59 用建删 `.write-probe` 探测可写性）；
YAML frontmatter 存 `title/summary/category/tags/created/updated/converted`，**ID 不入 frontmatter** 而用文件名（`frontmatter.go:16` `RenderMarkdown`、:36 `ParseMarkdown`，
:57 用 `strings.Cut` 首次冒号切分，使值内冒号可往返）。索引 `index.json` 只存元数据（正文置空），**读取失败即扫 `*.md` 重建并落盘**（`index.go:24-59`），且单个文件损坏只跳过不阻断整体（:47-50）。
分类是嵌套树 `Children []KnowledgeCategory`（`categories.go:22`，无层级与数量校验）。`Save` 强制「标题 / 说明 / 内容」三要素非空且一行都不写（`store.go:99-108`），ID 走 `validID`（:222）
拒绝 `/ \ : * ? " < > |` 与 `..`，防路径穿越。

`@` 引用链路：输入框 `@` 触发 `knowledge-ref.js:78-90` → `openKbPalette`（:96）→ 选中加胶囊（`addRefChip` :315，携带 `dataset.kbRef`）；发送前 `collectKnowledgeRefs`（:363）
逐条 `KnowledgeGet` 取**全文**（:378），在 `session.js:1079-1084` 作为**同一 user message 内的独立 text part** 追加：`【知识库引用：${title}】\n${content}`，
随 `POST /session/{id}/prompt_async`（:1087/:1106）发出；发送失败保留胶囊（:1114-1115）。

**Workbench 落法**：

- 存储根**不照搬 `<程序目录>`**——打包后 exeDir 位于只读的 `.app` 内容内，且违背本仓 app-private 约定。落 `<userData>/knowledge/`（与 `runtime/`、`opencode-user/` 同级，`main/index.ts:82` 已设定 userData 根）。
- 照搬「元数据索引 + 损坏自愈 + 单文件损坏不阻断」三点，这是该设计真正的价值所在。
- 新增 `main/knowledge.ts`（存储 + 索引）与 IPC：`knowledge-list` / `knowledge-get` / `knowledge-save` / `knowledge-delete` / `knowledge-categories-save`，
  按 `main/ipc.ts:135-137` 的简单形态登记；同步补 `preload/index.ts`、`renderer/electron.d.ts`、`renderer/lib/electron.ts`、`renderer/lib/tauri.ts` 四处（本仓新增 IPC 的固定四处改点）。
- UI：新增路由 `/knowledge`（`renderer/app/router.tsx:20-21` 旁）与侧边栏入口（`components/sidebar/Sidebar.tsx`）。**分类简化为「`a/b` 路径的扁平列表」**（层级由前缀隐含），交互为
  输入框 + datalist，而非目标的嵌套树右键增删改（分类 CRUD 不在验收范围内）。
- `@` 引用接入现有 Composer：`fileSuggestions`（`components/thread/Composer.tsx:81-82`）目前是纯字符串数组，需扩为带 `kind` 的候选；:161-176 的 `fileMatches` 合并第二来源；
  :193-199 `pickFile` 与 :311-331 键盘逻辑复用。**注入形态要对齐本仓现状**——`Composer.tsx:276-277` 现在把附件拼成一句 `Files added to the workspace: …`，
  知识库引用应走并列的新段落（如 `Knowledge entries referenced: …`），**不要伪装成工作区文件**，以免混淆 agent 的文件语义。
- 沙箱：知识库读写发生在主进程，不受 sidecar 沙箱约束；但仍须复用 `main/artifact_file.ts:28-34` `resolveUnderRoot` 的根目录收敛式校验（`startsWith(base)` + `allowCreate`），拒绝越界。

### 2. 技能来源目录与软链接管理

**OC Manager 的做法**：`Manager` 结构体定义在 `config/skill/scanner.go:13`（仅 `globalDir` 一个字段，**并无文档所称的 `manager.go`**）。扫描深度 `maxScanDepth = 2`（:45）；`ScanMultipleDirs`（:100）
以**相对路径**为聚合键（:114），**冲突判定 = 同键命中多个来源**（:128），`Enableable = !conflict`（:136）。启停即软链接：`ToggleSkill`（`linker.go:31`）先删旧链再建新链；`GetManagedLinks`（:111-162）
**只清理目标落在已登记来源目录下的链接**，因此不会误删用户手放的目录。来源注册表 `skill-config.json` 落在 `<程序目录>/configs/skill-schemes/`（`source.go:38`），**损坏时改名 `.corrupt-<时间戳>` 后降级为空**（:60-62）。
「方案」就是一份技能名 JSON 数组；`ApplySkillScheme`（`scheme.go:10`）先 `ClearManagedLinks` 再逐个 `LinkSkill`，跳过 `Missing` 与 `Conflicts`（:25-32）。

**Workbench 落法**：

- **落链目标不能是部署目录**（实施时修正，见「与计划的偏差」1）：`<userData>/runtime/xdg-config/opencode/skills` 是 `app-config` 的镜像，`deployBundledProfile` 的 `syncDir` 每次启动都会 prune，链接必然丢失；打包后 `app-config` 源只读，写进去也无效。
  正确形态是 **userData 注册表 + 每次部署后物化**：注册表落 `<userData>/skills/`（`config.json` + `schemes/`），`server.ts` 在 `applyUserOverlay` 之后调用 `materializeUserSkills` 把启用的技能重新链上去。
- 好消息：`server.ts:81-93` `sandboxPathsFor` 已把 `runtime/xdg-config` 列为可写根，物化目标在 sidecar 沙箱内可写，无策略冲突。
- 新建 `main/symlink.ts`（本仓现无任何软链接工具，仅 `syncDir.ts:27` 提及「软链按原样复制」）。macOS 直接 `fs.symlink`；Windows 回退 `mklink /J` 目录联接以免管理员权限（照 `symlink.go:38-52`）。**删除路径照抄 `symlink.go:60` 的克制**：Unix 分支只忽略 `ENOENT`、不用递归删除，让权限与非空目录错误暴露出来。
- 方案（scheme）保存 / 一键切换成本低、价值明确，建议同期做；「多来源扫描 + 冲突检测」次之。
- 现状差距：`SkillsPage.tsx:12-22` 只读 catalog（走 SDK `listSkills`，`OpenCodeClient.ts:290`），无任何软链接或写入 `app-config/.opencode` 的行为。

### 3. 项目级配置总览（只读）

**OC Manager 的做法**：`service/projectconfig/project_config.go` 管理五类——`coreConfig` / `agentsMd` / `skills` / `commands` / `rules`（类别是 `resolveProjectFilePath` :211-220
的**内联字符串字面量**，非常量）；`GetProjectConfigSummary`（:21）扫描汇总，另有 list / read / save / create / delete（:44/:72/:88/:111/:150）。`CreateProjectEntry` 拒绝含 `..`、`/`、`\` 的名称（:117）；
`DeleteProjectEntry` 用 `symlink.Remove` 后 `os.RemoveAll`，**拒删非空目录**（:174）。

**Workbench 落法**：

- 本项**只做只读总览 + Markdown 预览**，写能力明确归入「文件编辑」批次（约束项）。
- 复用面很大：`routes/FilesPage.tsx` + `inspector/FileBrowserPanel.tsx` 的树形浏览、`inspector/FilePreviewInspector.tsx` 的 Markdown/代码预览、
  `components/inspector/WorkbenchDock.tsx` 的 `files` 页签都可复用；`app-config/.opencode/` 下 `agents/`（约 40 个）、`commands/`（约 50 个）、`skills/`（26 个）、`AGENTS.md`、`opencode.json`、
  `sandbox.json`、`interaction/` 即为五类的实际内容。
- 与既有能力的分工：`profilePatch` 覆盖层 + 配置对话负责「改配置」，本视图负责「看现状」，不与 `profile-explain-config` 的「生效来源」卡重叠。

### 4. 托盘 + 全局快捷键 + 单实例完善

**OC Manager 的做法**：单实例用 Wails 原生选项 `SingleInstance{UniqueID, OnSecondInstanceLaunch}`（`main.go:36-45`，二次启动 `window.Show()+Focus()`）。
托盘 `app.SystemTray.New()` + `SetIcon` + **`AttachWindow(win)`**（左键显隐因此免费获得）+ 右键菜单「显示主窗口 / 退出」（`tray.go:26-43`）。
关闭驻留靠拦截关闭钩子：`win.RegisterHook(events.Common.WindowClosing, …)` → `event.Cancel()` + `win.Hide()`，用 `quitting atomic.Bool`（:19）放行真正的退出（:48-54）。
全局快捷键 `app.GlobalShortcut.Register("Shift+X", toggle)`（`main.go:68-79`），以 `window.IsVisible()` 决定 `Hide()` 或 `Show()+Focus()`。

**Workbench 落法**：

- 单实例**已有**：`main/index.ts:34-45` 的 `requestSingleInstanceLock()` + `second-instance` 恢复聚焦，无需改动。
- 托盘新建 `main/tray.ts`（Electron `Tray` + `nativeImage`）；需新增托盘图标资源（当前无）。左键 toggle，右键「显示主窗口 / 退出」。
- 关闭驻留要在 `main/windows.ts:19-53` 的 BrowserWindow 上加 `close` 拦截 → `preventDefault()` + `hide()`，用 `app.isQuitting` 标志放行。注意 `index.ts:47-72` 已有 shutdown hooks，须确保真退出路径不被误拦。
- 配套已就绪：`windows.ts:57` 现有「隐藏 / 最小化时不保存窗口状态」的跳过逻辑，正好避免驻留托盘时把隐藏态窗口尺寸写进 `windowState`。
- 全局快捷键 `globalShortcut.register('Shift+X', toggle)`；**必须处理注册失败**（按键被其他应用占用）并回落到设置项提示，而非静默失效。
- 平台：macOS 即菜单栏图标。Linux 托盘依赖 AppIndicator，**本批不承诺**，留 TODO。

### 5. 多会话 Tab 并行

**OC Manager 的做法**：`store.openTabs` 为 `[{sessionID, title}]`（`chat/state.js:41`），另有按会话的 `tabCacheVersion` / `tabRenderedVersion` / `tabScrollPositions` /
`tabExpandedParts` 四张表（:45-51）。`openSessionTab`（`chat/tabs.js:75`）**按 sessionID 去重**；每个会话在 `#ocMessagesPool` 内独占一个 `.oc-messages-tab` 容器，
切 tab 只切 `display`（`activateTabContainer` :100-111，注释自称「切换零成本」），`switchTab`（:134）顺带还原该会话的展开态（:168）。关闭时 `removeChild` 容器并 `delete` 四张表的对应项（`closeSessionTab` :190-203），
靠这点释放内存。

**Workbench 落法**：

- **本项最大优势：per-session 状态已经齐备**。`renderer/lib/runtime.ts:87` `threads: Record<sessionId, Thread>`、:110 `panes: Record<sessionId, PaneState>` 均以 sessionId 为键；
  滚动位置也早已按会话记忆——`lib/scrollMemory.ts:32` `useScrollMemory` 在 `LiveSessionPage.tsx:242` 的键就是 `chat:${currentId ?? DRAFT_KEY}`。
- 因此改动集中在 `lib/store.ts`：`openSessionTab`（:150-166）中的 `tabs.find(t => t.kind === 'session')` 改为 `t.kind === 'session' && t.sessionId === sessionId`（**按会话去重**而非全局唯一），无匹配时新建；`closeTab`（:176-186）与 `activateTab`（:187）逻辑基本可留。
- 调用点几乎不改：`components/thread/TabBar.tsx:31-37`、`Sidebar.tsx:301-302`、`LiveSessionPage.tsx:79-87` 的 `openSessionTab` 语义在新规则下自然成立。
- 需补：`closeTab` 时清理 `threads` / `panes` 中该会话的条目与 `scrollMemory` 的对应键（OC Manager 靠「关闭即释放」控制内存，Workbench 需补齐这一步）。

### 6. 健壮性工具（原子写 / JSONC / 软链 / 命令封装）

**OC Manager 的做法**：`internal/fileutil/fileutil.go:26` `AtomicWriteRaw` 在同目录建临时文件（保证同文件系统）→ `Write` → `Chmod` → **`Sync()` fsync 文件** → `Rename`（**未 fsync 父目录**，属未做尽之处）。
:61 `ValidateJSONC` 与 :74 `StripComments` 是单遍扫描，字符串字面量内的 `//` 不误剥、并处理 `\` 转义。`internal/executil/executil.go:11` 统一封装 `exec.Command` 并 `SetHideWindow`（`hide_windows.go:11`
设 `HideWindow`，`hide_other.go:8` 空实现）；:18 `RunGit` 设 `cmd.Dir` 后 `CombinedOutput`，错误里带输出。**注意：executil 全程无超时**（无 `CommandContext`），这是**不要照抄**的点。

**Workbench 落法**：

- 本仓**目前没有原子写工具**（`apps/desktop/src/main` 内无 `renameSync` / `fsync` 用法），而多处直接 `writeFileSync`：`macro*.ts`（userData 下的 `macro-cache.json`、`macro-rotation-history.json`）、
  `snapshot.ts:39`、`provenance.ts:35`、`main/index.ts` 的 settings 落盘等。新增 `main/atomicWrite.ts`（同目录 temp + fsync + rename），**优先替换「配置 / 索引」类小文件**；`provenance.jsonl` 是追加式，
  不适用。
- JSONC 工具：本仓有 JSONC 场景（`opencode.json` 及 patch 覆盖层）。**先核实 `packages/shared/src/patchOverlay.ts` 是否已具备等价能力**，有则复用，无则移植 `StripComments`。
- 跨平台软链工具：见第 2 项 `main/symlink.ts`。
- 命令封装：本仓若引入统一 runner，**必须带超时 / AbortSignal**（对齐 `process.go` 侧调用方自带超时的做法，而非 `executil` 的无超时）。
- 「坏文件改名 `.corrupt-<时间戳>` 后降级为空」（`source.go:60-62`）是很好的模式，建议推广到本仓所有 JSON 状态文件（settings / scheduler / macro 缓存），取代当前的「解析失败即静默重建」。

### 7. SSE 心跳与背压

**OC Manager 的做法**：消费端心跳在 `service/web/frontend_web.go:159-172`——每 15 秒发 `: heartbeat` 注释行（EventSource 自动忽略），防止空闲连接被浏览器 / TCP keepalive / 中间代理判定超时切断。
生产端在 `service/opencode/sse.go`：`StartOpenCodeEvents`（:64）拉 `GET /global/event`（:80），Scanner 缓冲提到 **100 MB**（:99），只转发 `data:` 行（:102-106），**扇出到桌面与浏览器两路**（:104-105，
桌面侧经 `DesktopEmitter` 接口解耦，nil 即纯 Web 模式）。订阅者各持 **256** 容量缓冲（:56）；`broadcastBrowserSSE`（:148）**非阻塞 select，满则丢最旧一条、发 `sse-lagged`（:60）并 close 通道逼客户端重连**（:164-168）；
事件名为 `oc-event` / `oc-event-error` / `sse-lagged`，格式见 `FormatBrowserSSE`（:173）。

**Workbench 落法**：

- 心跳：Workbench 是 sidecar SSE 的**消费端**（`packages/sdk/src/OpenCodeClient.ts` 用 `EventSource`），心跳节奏由 sidecar 决定，本仓无法直接吸收生产端做法。可吸收的是**转发链路**——`main/relayHost.ts` 与浏览器 MCP 若存在长连接转发，应补心跳。
- 背压：**「明确告知滞后」优于静默丢弃**——满缓冲时丢最旧 + 发 `sse-lagged` + 主动断开逼重连，这套语义值得移植到本仓任一处「SSE/WS 转发给多个消费者」的地方。
- 待核实：本仓 sidecar SSE 现有是否已有心跳与超时重连（见「验证状态 · 待核实项」）；若无，应先补这条，比抄格式更实际。

### 8. OpenCode sidecar 版本检测

**OC Manager 的做法**：`app.go:707` `CheckOpenCodeVersion(currentVersion)` 请求 GitHub Releases `https://api.github.com/repos/anomalyco/opencode/releases/latest`（:710），
取 `tag_name`（:723-725），两侧去 `v` 前缀后字符串比较（:731-734）；返回 `model.VersionCheckResult{CurrentVersion, LatestVersion, IsLatest, Error}`（`model/types.go:249`）。
当前版本来自 sidecar 健康接口 `GET /global/health` 的 `version` 字段（`process.go:385-398`）。

**Workbench 落法**：

- 当前版本**已经拿得到**：`server.ts:172-211` `migrateStaleDatabase` 已执行 `opencode --version` 并把结果写入 `<userData>/runtime/sidecar-fingerprint.txt`（用于二进制版本变化时清库）。直接复用该值，无需新增探测。
- 只差「查最新版 + 比较」：新增 `checkSidecarVersion` IPC + `SettingsPage.tsx` 一处卡片。**必须与现有 Electron 应用级 updater（`main/updater.ts:9-25`）明确分开命名与文案**，避免用户把「Workbench 应用更新」和「opencode 引擎更新」混为一谈。
- 需 fail soft：打包环境可能离线或访问不了 `api.github.com`，失败只提示「无法检查」而非报错。

### 9. 统一 RPC 面的收口（降级项）

**OC Manager 的做法**：`app_dispatcher.go` 单入口 `AppCall(method, args)` + 一个约 80 分支的 switch，配 `decodeArgs`（:471-481）按位置解参并在参数数量不足时报错；Web 端因此只需 `/api/app-call` 一个路由（`service/web/frontend_web.go:132`）。

**Workbench 落法**：

- **不改成单入口**：`main/ipc.ts:131` 的 `registerIpcHandlers()` 现有 99 个 `ipcMain.handle(...)` 字面量。单入口会牺牲 Electron 的 channel 显式性与 preload / `.d.ts` 的类型安全，得不偿失。
- 只吸收两点：(i) 建立 **channel 常量表** + 薄封装 `handle(channel, fn)`，消除字符串在本仓四处（main / preload / `lib/electron.ts` / `electron.d.ts`）各自硬编码的漂移风险；(ii) `decodeArgs` 式「按位置解参 + 数量校验」在 `main/relayHost.ts:365-486` 的 `/__host/*` 路由此处已部分存在，可提取为共享 helper。
- 内嵌 Web 服务（约束项）**不建议重做**：`relayHost.ts:228-238` 现为 WS 传输（`connect()` :162-189）且无 HTTP 监听，与 relay/client 的既有分工重叠；若未来要做「本机浏览器打开」，应作为 relay 的一个可选本机入口来设计，而不是并行开第二套前端。

### 10. 待办分组与子任务面板

**OC Manager 的做法**：`chat/sidepanel.js:24` `extractTodos()` 倒序扫消息，取 `todowrite` 工具的 `state.input.todos`，分「进行中 / 已完成」两组（:44 `renderTodos`）；
`extractSubtaskSummaries()`（:95）扫最近 200 条消息里的 `task` 工具 part，取 `state.metadata` 的 `sessionId` / `description` / `agent` / `model` / `interrupted` 与 `state.time`，
渲染成带状态徽标的卡片（:175 `renderSubtaskPanel`），点击开详情弹窗（:271 `openSubtaskModal`）加载子会话消息。

**Workbench 落法**：**不反转既有的显示决策，只补数据出口**。Workbench 刻意不把 `todo*` 工具行显示在会话流里（`runtime.ts:1585` 与 :1753 两处丢弃，并有测试
`drops opaque todo tool rows from the conversation` 守着），理由充分——它们是「N todos」这类无内容噪音。因此：

- **捕获**：`Thread` 增加 `todos: ThreadTodo[]`。实时路径在 `foldEvent` 之前从 `event.input` 取；历史重建路径在 `historyToThread` 跳过 todo 行时顺手收集并随返回值带出
  （两个调用点都是 `{ ...historyToThread(...), loaded: true }`，字段自动落到线程上）。
- **派生**（`renderer/lib/threadTasks.ts`，纯函数）：`isTodoTool` / `parseTodos`（**无 todos 时返回 `null` 表示「保持上一次」**，而不是清空）/ `groupTodos`（cancelled 计入已完成）/
  `subtasksOf`（取带 `childSessionId` 的 tool-call 块）。
- **呈现**：dock 新增「任务」页签（`components/inspector/TasksPanel.tsx`；`Topicbar` 的 TABS 与 `WorkbenchDock` 的 tab 联合各加一项）。待办按进行中 / 已完成分组
  （进行中带 spinner、已完成划线），子任务卡片显示标题与状态，点击打开该子会话。
- 与目标的差异：不做独立详情弹窗——子会话本身就是 Workbench 的一个会话，打开它即可，比弹窗少一条消息渲染路径。

### 11. 实施批次与依赖

| 批次 | 内容 | 依赖 | 结果 |
|------|------|------|------|
| 一 | 多会话 Tab 并行（第 5 项）、托盘 + 快捷键 + 单实例完善（第 4 项）、原子写与坏文件降级（第 6 项）、sidecar 版本检测（第 8 项） | 无 | 已实施 |
| 二 | 知识库：存储 + 索引自愈 + 分类 + UI + `@` 引用（第 1 项） | 原子写工具（第一批） | 已实施 |
| 三 | 技能来源目录 + 冲突检测 + 方案切换（第 2 项）、项目配置只读总览（第 3 项） | 软链工具（随第 2 项新建） | 已实施（技能启用的落点改设计，见偏差 1） |
| 四 | SSE 心跳 / 背压（第 7 项）、channel 常量表（第 9 项） | 待核实项结论 | 调研后**未产生代码改动**，结论见「待核实项」 |
| 五 | 待办分组与子任务面板（第 10 项）、Windows 分支实现 | 无 | 已实施（第 10 项是复核时补上的，见偏差 9） |

## 验证状态

### 已完成的调研

- [x] OC Manager 逐文件读取核实：知识库（store / index / frontmatter / categories / convert / dir）、技能（scanner / source / scheme / linker / parser）、项目配置（project_config）、
  桌面壳（main.go / tray.go）、sidecar（process / api / sse）、工具（fileutil / symlink / executil）、版本检测、前端（tabs / cache / knowledge-ref / sidepanel）。
- [x] Workbench 侧接入点逐条定位：IPC 四处改点、`lib/store.ts` 的 Tab 模型、`lib/runtime.ts` 的 per-session 字典、`lib/scrollMemory.ts`、Composer 的 `@` 链路、`SkillsPage`、sandbox 策略与可写根、既有写盘路径、
  `SettingsPage` 结构、`relayHost` 路由、`app-config/.opencode` 布局、sidecar 二进制与 userData 布局、`index.ts` 的单实例处理。
- [x] 修正 OC Manager 文档的**三处不实描述**：
  - `doc/技术方案.md` 引用的 `doc/modules/*.md`、`doc/项目架构深度分析.md` **均不存在**；README 截图文件名与 `doc/image/` 实际内容亦不符——其文档已滞后于代码，不可作为事实来源。
  - README 称「手机端默认 30 条」——代码中**无 `30` 该常量**：首屏 `limit=20`（`chat/session.js:476`），加载更早为 `limit=200&before=<cursor>`（:358-371，游标为 `{id,time}` 的 base64url，:345）。
  - README 称知识库引用作为「独立上下文」交给 AI——实现上是**同一 user message 内的一个独立 text part**（`chat/session.js:1079-1084`），既非独立 system prompt，也非独立 API 字段。
- [x] 修正技术方案文档所称的 `config/skill/manager.go` **不存在**：`Manager` 结构体实际定义在 `config/skill/scanner.go:13`，且只有 `globalDir` 一个字段。
- [x] 核实 Workbench 缺口（**改动前的快照**；其中「无托盘 / 无全局快捷键」已由本方案的批次一填补，其余仍成立）：`src/main` 当时无 `Tray`、无 `globalShortcut`（仅有 `index.ts` 的单实例锁）；
  renderer 无任何 git 写操作调用；`src/main` 无通用「写任意调用方指定路径」的 IPC（既有写盘均收敛于工作区或部署目录）；`packages/ui` 仅剩 README。
- [x] 核实 Workbench 优势项（不作为吸收项）：per-session 状态（`runtime.ts:87/110`）与按会话的滚动记忆（`scrollMemory.ts:32` + `LiveSessionPage.tsx:242`）**已具备**；sidecar 版本号已被 `sidecar-fingerprint.txt` 记录。

### 实施记录（2026-09-30）

批次一至三全部实施，批次四按结论不改代码。逐项验收：

| 验收项 | 验证方式 | 状态 |
|--------|----------|------|
| 多会话 Tab 并行 | `lib/store.ts` 按 sessionId 去重（草稿 tab 唯一）；`TabBar` 为会话 tab 增加关闭并调用 `dropSessionState` 释放 threads/panes/scroll；`store.test.ts` 10 例（含「同一会话复用」「草稿 tab 转换」「未激活草稿不被占用」） | 已实施 |
| 托盘 + 全局快捷键 | 新增 `main/lifecycle.ts`、`main/tray.ts`；`windows.ts` 拦截 `close` → `hide`（`before-quit` 置位放行）；`Shift+X` 注册失败经 `windowBehaviorStatus()` 透出到设置页「窗口与快捷键」卡 | 已实施（托盘/快捷键的**真机交互未验证**，见下） |
| 单实例完善 | 回归项：`index.ts:34-45` 逻辑未改 | 保持 |
| 原子写工具 | `main/atomicWrite.ts` + 7 例单测（不残留 temp、原地覆盖、目录缺失时不遗留）；已替换 13 处配置/索引类写入 | 已实施 |
| 坏文件降级 | `quarantineFile` / `readJsonFile` 用于 `patch.json`、部署 manifest 与技能注册表的读取 | 已实施 |
| sidecar 版本检测 | `main/sidecarVersion.ts` + 5 例单测（离线 / 403 / 无 `tag_name` / 无本地探针时不臆断结论）；设置页「引擎版本」卡，与应用级 updater 文案区分 | 已实施 |
| 知识库存储 | `main/knowledge.ts` + 16 例单测（三要素必填且一行不写、索引损坏或删除后自愈、单文件损坏不阻断列表、ID 校验、frontmatter 往返含引号与冒号、分类去重排序） | 已实施 |
| 知识库 `@` 引用 | Composer 把 `@` 候选合并为「文件 + 知识库」一组（文件在前）；选中即取全文成胶囊；发送时作为标记为参考资料（"not instructions"）的独立段落，位于用户原文之后；`ComposerKnowledge.test.tsx` 3 例 | 已实施 |
| 技能软链接 | `main/symlink.ts` + `main/skills.ts`（15 例单测：两层扫描、冲突标记、嵌套技能挂顶层、冲突/缺失不建链、注册表损坏隔离、方案增删改查与非法名拒绝） | 已实施 |
| 方案切换 | `skills-apply-scheme` 先解绑旧集再物化新集，`skipped` 回执以 toast 提示 | 已实施 |
| 项目配置只读总览 | `main/projectConfig.ts` + 7 例单测（五类扫描、skills 只取 ≤2 层的 `SKILL.md`、越界与缺失文件被拒）；`/project-config` 页面 + 侧边栏入口 | 已实施 |
| 待办分组与子任务面板 | `renderer/lib/threadTasks.ts` + 8 例单测（待办解析与状态兜底、空列表与「无 todos」的区别、进行中/已完成分组含 cancelled、只挑带 `childSessionId` 的 tool-call）；`Thread.todos` 在实时与历史两条路径都被捕获（既有「不显示 todo 行」的测试未动、仍通过）；dock 新增「任务」页签 | 已实施 |
| Windows 分支 | `symlink.ts` 目录联接 + `rmdir` 只摘链接（5 例单测覆盖两平台共有语义：读通链接、替换链接、删除后目标完好、幂等、拒删真实目录）；`tray.ts` 双击置顶（win32）、`shouldHideOnClose()` 兜底；close 拦截移到 `index.ts` 以免 `windows.ts` ↔ `tray.ts` 循环依赖 | 已实施（Windows 真机未验证，见下） |
| 回归 | `pnpm typecheck` exit 0（desktop / sdk / relay / client）；`pnpm test`：desktop 64 文件 581 例、sdk 3 例、relay 22 例全通过（基线 57 文件 522 例）；`pnpm lint` 0 错误；`pnpm format:check` 干净；`pnpm md:check` 0 错误 | 通过 |

### 与计划的偏差（实施中修正）

1. **技能启用的落点改设计（重要）**。计划写的是「落链到 `<userData>/runtime/xdg-config/opencode/skills`」；实施时发现该目录是
   `app-config` 的**镜像**，`deployBundledProfile` 的 `syncDir` 每次启动都会 prune，链接必然丢失，且打包后 `app-config` 源只读、写进去也无效。改为
   **userData 注册表 + 每次部署后物化**（`server.ts` 的 `materializeUserSkills`，紧随 `applyUserOverlay`），与既有的 user 覆盖层同形；注册表落 `<userData>/skills/`（比计划里的 `opencode-user/` 更自描述）。
2. **知识库分类模型简化**。目标是嵌套 `Children[]` 树；本仓改为「`a/b` 路径字符串的扁平列表」，层级由前缀隐含，UI 只需一个 select + datalist。分类的右键增删改**未做**（不在验收表内）。
3. **未引入 JSONC 剥离工具**。全仓除文档与 lockfile 外没有任何 JSONC 消费者，按「无消费者不引入」跳过 `StripComments`；原子写工具照做。
4. **隔离只用于用户自撰文件**。派生缓存（知识库索引、macro 缓存、快照、轮动历史、通知）仍是「损坏即重建 / 降级为空」——那才是它们的正确语义；只有 `patch.json`、部署 manifest、技能注册表这类用户数据才改名 `.corrupt-<时间戳>`。
5. **项目配置总览指向已部署镜像**而非 `app-config/.opencode` 源：前者是运行中的生效配置，更符合「配置总览」的语义。
6. **技能来源面板受 `connected` 门控**：面板挂在 `SkillsPage` 的 tab 内，而 tab 栏仅在 runtime 连接时渲染，因此未连接时无法管理来源目录。属已知不便，未在本批重构页面结构。
7. **批次四两项均未改代码**：SSE 见「待核实项」结论；channel 名集中化被认为需要改动 190+ 处字面量、风险大于收益，改为**给 IPC 桥加类型安全网**
   （`preload/index.ts` 把桥对象标注为 `ElectronAPI`，漏实现即编译失败），并以它验证了当前桥接层与渲染层契约一致。
8. **顺手修复一处既有 lint 错误**：`renderer/lib/macroPrompts.test.ts` 的 import 排序（纯顺序调整，无行为变化）。该错误在本方案开始前就存在，会让 `pnpm lint` 无法通过。
9. **补上被漏掉的一项（复核时发现）**：口头调研总结里列过「子任务面板 / 待办分组」，但它**没有进入本方案的 10 个设计条目**，因此首轮实施时被漏掉。复核对照两侧代码时发现并补齐为第 10 项（见下）。
10. **Windows 分支从「排除」改为「实现」**：原本写的是「Windows 分支留 TODO，不引入不可验证的代码路径」，现已实现（目录联接 + 托盘双击约定 + `shouldHideOnClose` 兜底），
    但**仍未在 Windows 上运行过**——实现完整、验证缺失，措辞与 `symlink.ts` 的注释都按此改正。

### 未覆盖的验证

- 托盘、全局快捷键、关闭驻留、多会话 Tab 的真实交互**未在跑起来的应用里点击验证**（本次改动只在 jsdom + 类型/单测层面验证）。需要一次人工冒烟：关闭窗口→进程驻留、`Shift+X` 显隐、连开两个会话 tab 后切换与关闭、设置页两张新卡片、任务面板。
- **Windows 分支已实现但完全未验证**：`symlink.ts` 的目录联接与 `rmdir` 删除、`tray.ts` 的双击约定、`shouldHideOnClose()` 的兜底，都只在本机（macOS）通过了类型检查与 POSIX 路径的单测；Windows 上的实际行为没有跑过。`symlink.test.ts` 的 5 例（读通链接、替换链接、删除后目标完好、幂等、拒删真实目录）覆盖的是两平台共有的语义，Windows 专属分支未被覆盖。

### 待核实项（结论）

- **SSE 心跳与重连**：`packages/sdk/src/OpenCodeClient.ts` 的 `es.onerror` 在已打开时置 `connecting` 并依赖 `EventSource` 自动重连，**消费侧已有重连**；心跳由 sidecar 产生、本仓无法生成，故第 7 项无改动。可吸收的「告知滞后」语义（满缓冲丢最旧 + 显式告警 + 断开逼重连）本仓当前无多消费者转发链路，记录为 backlog。
- **JSONC**：`packages/shared/src/patchOverlay.ts` 及全仓均无注释剥离能力，且无消费者 → 不引入。
- **多会话跨工作区**：不存在隐含假设——`runtime.ts:1231` 的 `openSession` 会按会话自己的目录 `setWorkspace` 并重连事件流，因此跨工作区切换 tab 已自动跟随；代价是该切换会触发一次 sidecar 重连。

## 显式排除（不照抄的部分）

- **不照抄 `project_config.go:236-238` 的路径收敛**：它是纯字符串前缀比较（`strings.HasPrefix(absClean, absBase)`），**缺少分隔符边界检查**，`/base-evil` 会通过 `/base` 的校验。本仓若要实现同类校验，
  用 `path.relative()` 且结果不以 `..` 开头（或 `resolve` 后补 `path.sep`），即 `artifact_file.ts:28-34` 现用的思路。
- **不照抄 `executil` 的无超时命令封装**：本仓任何统一 runner 必须带超时 / AbortSignal。
- **不采用「程序目录下写数据」**（`<exeDir>/vault`、`<exeDir>/configs/skill-schemes/`）：打包后该目录不可写，且违反本仓 app-private 约定；对应数据一律落 `<userData>` 或工作区。
- **Windows 分支照做，但不声称已验证**：托盘走 Electron 的跨平台 `Tray`（Windows 侧补上「双击置顶」的交互约定），软链接在 Windows 走 Node 的目录联接（`symlinkSync(..., 'junction')`，免管理员权限），删除用 `rmdir` 只摘链接、绝不递归进目标；
  另外 `shouldHideOnClose()` 保证「隐藏后无路可回」的组合（Windows 且托盘与全局快捷键都没生效）不做关闭拦截。这些路径实现完整、**未在 Windows 真机跑过**，见「未覆盖的验证」。
- **不改 relay / client**：独立项目，通过 WS/HTTP 协议通信，本次不触碰（协议三份副本手工同步的既有债不在本方案范围内）。
- **不新增独立文档**：本方案自包含，不按条目拆分多份文档。
