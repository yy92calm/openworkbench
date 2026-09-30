# 交互与渲染层可借鉴项落地方案（含 Tab 页交互）

日期：2026-09-30，序号 02

## 背景

上一份方案（`docs/20260930-01`）按「功能」维度吸收了 OC Manager 的知识库、技能来源、多会话 Tab、托盘等能力。
本方案换一个维度：**交互与渲染**（渲染管线、折叠、滚动、键盘、会话内检索）以及 **Tab 页交互**。

总判断：**OC Manager 的渲染管线整体弱于 Workbench，不应照抄**——它每帧同步 `marked.parse`、无语法高亮、无虚拟化，数量一变就整段 `innerHTML` 重建。
但它有两块比 Workbench 完整：**按会话保存 UI 状态**（展开态地图）与**会话内文本检索**。
Tab 交互则是**两边都缺**，属于通用习惯的补课，不是从 OC 抄。

调研中在 Workbench 侧发现两个既有问题（与对比无关，但真实存在），一并列入。

出处说明：OC Manager 侧出处来自逐文件读取（`frontend/dist/`、`css/style.css`）；Workbench 侧的关键结论我自己复核过三条——
**冷历史展开态跨会话残留**、**快捷键面板不可达**、**不存在任何 Tab 快捷键**，其余来自代码检索；未复核的部分在「待核实项」中标注。

## 约束项（本批不做）

| 项 | 原因 | 去向 |
|----|------|------|
| Tab 拖拽排序 | 中等成本、低收益（并行会话数量少），且与「会话 tab 前插、文件 tab 后置」的既有排序约定冲突 | backlog |
| Tab 跨重启持久化 | `store.ts:81-83` 明确写「in-memory：重启清空，与 per-session pane 记忆一致」，是有意设计 | 不改（如需另作决策） |
| 窄宽度下 dock 抽屉化 | OC 在 ≤800px 用左抽屉替代（`style.css:5033-5066`）；Workbench 的移动端由 relay + `client/` 承担，桌面 dock 在 `lg` 以下隐藏是既有取向 | 不改 |
| 检索命中时展开全部折叠 | 会破坏折叠语义，并与冷/热折叠打架 | 只做临时显形（设计 6） |

## 设计

### 1. 冷历史展开态按会话（修跨会话残留）

**Workbench 现状（已复核）**：`BlockList` 的冷历史展开是组件内 `useState(false)`（`components/thread/BlockList.tsx:207`），
而 `<BlockList>` 在 `routes/LiveSessionPage.tsx:441` **没有 `key`**，`app/layout/AppShell.tsx:124` 的 `<Outlet />` 也没有 `key`。
因此切换会话不会重挂载组件 → **该状态跨会话残留**：在 A 会话点开「展开更早历史（N 条）」，切到同样有冷历史的 B 会话会直接呈展开态。
既不是「按会话记住」，也不是「重置」。

**OC Manager 的做法**：展开态存在 `store.tabExpandedParts[sessionID]` 这张 per-tab 地图里，`switchTab` 时从目标会话取回（`chat/tabs.js:168`），
是「按会话记住并恢复」。

**落法**：把冷历史展开做成 per-session，与既有的 `threads` / `panes` / `scrollMemory` 同层——`BlockList` 改为受控
（新增 `coldExpanded` 与 `onColdExpandedChange`），状态落在 `Thread`（`lib/runtime.ts`）上，并在 `dropSessionState` 里一并释放。
最小退路：给 `<BlockList>` 加 `key={currentId ?? DRAFT_KEY}`，一行修掉残留，但「切走再回来」不恢复展开态（不如上面的模型完整）。

### 2. Tab 快捷键、中键关闭与 tab 语义（a11y）

**Workbench 现状（已复核）**：**不存在任何 Tab 快捷键**——全仓的修饰键处理只有 `components/command-palette/CommandPalette.tsx:36` 的 `Cmd/Ctrl+K`、
该文件的 `/`，以及 `components/inspector/TerminalPanel.tsx:151-181` 的终端内按键。也没有中键关闭。
`TabBar` / `Topicbar` 没有 `role="tablist"` / `role="tab"` / `aria-selected`。

**OC Manager 的做法**：也没有 tab 切换键（只有 `main.js:140-158` 的 Enter/Ctrl+Enter、命令面板的 ↑↓、`search.js:42-54` 的 Ctrl+F），
所以这一项**不是从 OC 抄**，而是补通用习惯。

**落法（实施时修正）**：新增 `Cmd/Ctrl+1..9` 切到第 n 个 tab、`Ctrl+Tab` / `Ctrl+Shift+Tab` 前后循环。
集中放在 `TabBar` 的全局监听里（用 `onActivate`，与点击同一条路径），并处理冲突：终端聚焦时不拦截（`TerminalPanel` 自己处理按键）。
中键关闭：`onAuxClick` 且 `button === 1` 时走既有 `onClose`。a11y：`TabBar` / `Topicbar` 加
`role="tablist"` / `role="tab"` / `aria-selected`。
**`Cmd+W` 不再绑定**：macOS 默认应用菜单持有它（系统「关闭窗口」role），渲染层收不到该键；抢占需要整体替换应用菜单，
而那份菜单同时承载 `Cmd+C/V` 等 Edit role，代价过高（见待核实项结论）。

### 3. 后台会话提醒（跑完 / 卡住）

**Workbench 现状**：`components/thread/TabBar.tsx:64,80-85` 只显示 `runningSessions[sessionId]` 的脉冲点，
**后台会话「本轮结束」或「卡在提问/审批」时没有任何信号**。多会话并行时，用户无法知道哪个 tab 在等自己。

**OC Manager 的做法**：也没有（`store.sessionStatuses` 只驱动发送按钮，tab 上无角标）。所以这是**在两边之上的改进**。

**落法**：派生一个 per-session 的 attention 状态，取值全部来自已有数据——`runtime.ts` 的 `questions` / `permissions`
（工作区级、带 `sessionId`）中属于该会话的未决项，以及「非当前会话且刚结束一轮」。在 tab 上渲染成角标
（待处理用强调色、已完成用中性色），点进去后清除。

### 4. 运行中工具的实时耗时

**OC Manager 的做法**：`chat/render.js:125` 用 `setInterval(..., 200)` 刷新 `.oc-tool-duration[data-live-start]` 的文字，
重渲染后用 data 属性重新定位。

**Workbench 现状**：运行中的工具行只有 pulse + spinner（`BlockList.tsx:344-359`），`ToolCallBlock.meta` 只承载完成后的时长。

**落法**：运行中的工具行按开始时间计时显示（用一个共享的 1s tick，不需要 200ms）。
需要一个「开始时刻」字段——若事件不携带，就在前端首次见到该块为 running 时记录。

### 5. 待处理请求的可见性与来源标注

**OC Manager 的做法**：权限请求是**队列 + 单模态**：`pendingQueue` + `currentPermission`，按 id 去重，
沿 `parentID` 链（深度 ≤10、按会话缓存）判断来源，子代理发起的标成「子任务权限」，回答后出队推进
（`chat/permission.js:16-17,33,91-170`）。

**Workbench 现状**：`components/thread/DecisionSurface.tsx` 是**单槽**（question > permission > composer），一次只显示一个，
**没有「还有 N 个待处理」的提示**；但 `runtime.ts` 已经维护 `sessionParents`，标注来源的条件是现成的。

**落法**：在决策卡片上显示「待处理 n / 共 m」并可前后切换；来源是子代理时加标注。
不引入队列式模态（单槽是有意的展示模型），只把「后面还排着队」这件事说出来。

### 6. 会话内文本检索

**OC Manager 的做法**：完整的检索闭环——`chat/search.js:81` 用 `createTreeWalker` 遍历文本节点并把命中包进 `<mark>`
（200ms 防抖，`:60`）；上下跳转时把命中滚到视口约 1/3 处（`:153`）；命中内容若被折叠隐藏，则**临时展开祖先并打标记**（`:177`），
离开时再收回（`:191`，并参考 `store.expandedParts` / `defaultExpanded` 决定是否保留）。
此外还有用户消息导航（`userNavIndex`，`:247-340`）与「到顶时加载更早」的联动。

**Workbench 现状**：只有 `components/thread/JumpBar.tsx:16-69` 的用户消息圆点（hover 预览、点击滚到位），
**没有文本检索、不支持键盘**。长会话里这是真空。

**落法**：`Ctrl/Cmd+F` 唤起检索条 → 命中高亮 + 上一个/下一个 + 计数；命中落在冷历史或折叠的 `StepGroup` 内时，
用一条**「临时显形」通道**展开并在离开检索时收回。这是本方案里唯一需要新设计的机制，工作量最大，故单列一个批次。

### 7. 为 block 提供稳定身份键

**OC Manager 的做法**：`chat/render.js:240-252` 用「新 part 列表是否为旧列表的前缀延伸」决定「只 append 新节点」还是
`replaceChildren` 全量替换——这是无虚拟 DOM 时代的手工优化，**不建议照抄**。

**Workbench 现状**：`BlockList` 用数组下标做 React key（`BlockList.tsx:242,252`），而每次流式 flush 都会替换
`threads[sid].blocks` 的数组身份（`runtime.ts:1001-1026`），因此整段 warm 尾巴每帧都要 reconcile；
块内组件状态（例如提问卡片正在选择中的答案）也依赖 key 稳定才不会被重挂载。

**落法**：`foldEvent` 的 `index` 里本来就有身份键（`text:<partId>`、`reasoning:<partId>`、`tool:<callId>`、`artifact:<path>`），
把它作为 block 的 `key` 透出，用作 React key。收益：未变兄弟直接跳过、`StepGroup` / `MarkdownViewer` 的 memo 更容易命中、
块内交互状态不被重挂载。既有折叠行为的测试可以守住改动风险。

### 8. 快捷键面板（既有 UI 缺陷）

**Workbench 现状（已复核）**：`components/thread/Topicbar.tsx:37` 声明了 `showShortcuts`，但**只有 `setShowShortcuts(false)` 被调用**
（onClose），没有任何地方把它置 `true` → `ShortcutsCheatsheet` 是**不可达的死 UI**。
而且它列出的键多半不存在：`ShortcutsCheatsheet.tsx:8-37` 写了 `Cmd+B`、`Cmd+−`、`Cmd+0`，全仓只有 `Cmd+K`（外加终端内的字体键）真正绑定。

**落法**：二选一——接一个入口（例如 `Cmd+/`，与多数应用一致）并**把不存在的快捷键删掉**，或直接移除该面板。
倾向前者：一个能打开且内容真实的快捷键表，正好是本方案（大量新增快捷键）的配套。这属于修坏 UI，不算新功能。

### 9. 实施批次与依赖（批次一、二已实施；批次三未开始）

| 批次 | 内容 | 依赖 | 理由 |
|------|------|------|------|
| 一 | 冷历史展开态按会话（第 1 项）、快捷键面板修复（第 8 项）、block 身份键（第 7 项） | 无 | 前两项是修既有缺陷；第 7 项是后续交互状态稳定性的地基 |
| 二 | Tab 快捷键 + 中键 + a11y（第 2 项）、后台会话提醒（第 3 项）、运行中实时耗时（第 4 项）、待处理请求可见性（第 5 项） | 第 7 项 | 体感提升明显，逐个都小 |
| 三 | 会话内文本检索（第 6 项） | 第 7 项 + 「临时显形」机制设计 | 唯一需要新机制的一项，工作量最大 |

## 验证状态

### 已完成的调研

- [x] OC Manager 前端逐文件读取：渲染管线（`chat/render.js` 的 `renderMessages` / `renderPart` / `replaceChildren` 分支 /
  `restoreScroll` / 滚动动画）、键盘与命令（`main.js:140-158`、`cmd-palette.js`、`search.js`）、权限与 SSE
  （`permission.js`、`events.js`）、Tab 与移动端（`tabs.js`、`mobile.js`）、CSS 交互（`style.css`）。
- [x] Workbench 侧交互/渲染盘点：TabBar / Topicbar / WorkbenchDock / BlockList / MarkdownViewer / CodeBlock /
  FencePreview / JumpBar / CommandPalette / ShortcutsCheatsheet / scrollMemory / runtime 的折叠与节流。
- [x] **我亲自复核的三条关键结论**：
  - 冷历史展开态跨会话残留——`BlockList.tsx:207` 为组件内 state，`LiveSessionPage.tsx:441` 与 `AppShell.tsx:124` 均无 `key`，切会话不重挂载。
  - 快捷键面板不可达——全仓只有 `setShowShortcuts(false)`。
  - 无任何 Tab 快捷键——修饰键处理只存在于 `CommandPalette.tsx:36` 与 `TerminalPanel.tsx:151-181`。
- [x] 结论性判断：OC 的 prefix-append 增量渲染与「滚动时跳过渲染」**不适用**于本仓（React key 化与既有 20fps 节流已覆盖，照抄反而有害），已列入「显式排除」。

### 实施记录（批次一、二已实施；批次三未开始）

| 验收项 | 验证方式 | 状态 |
|--------|----------|------|
| 冷历史展开态按会话（第 1 项） | `Thread.coldExpanded` + `setColdExpanded`；`BlockList` 改为受控（无 store 的示例会话仍用本地态）。`runtime.store.test.ts` 2 例：草稿与另一会话互不影响、切回保持、关闭 tab 释放 | 已实施 |
| 快捷键面板（第 8 项） | 抬到 UI store，`AppShell` 全局监听 `Cmd/Ctrl+/` 开关；命令面板新增「键盘快捷键」入口（可发现）；删掉从未绑定的 `Cmd+−/0`，`Cmd+B`（侧边栏）与 `Cmd+/` 改为真实绑定 | 已实施 |
| block 身份键（第 7 项） | `ThreadBlock` 的 agent/reasoning/tool-call/artifact 增加 `id?`，`foldEvent` 与 `historyToThread` 分别写入；`blockKey()` 作为 React key（DOM 锚点仍是 `block-<index>`，JumpBar 不受影响） | 已实施 |
| Tab 快捷键 / 中键 / a11y（第 2 项） | `Cmd/Ctrl+1..9` 切 tab、`Ctrl+Tab` / `Ctrl+Shift+Tab` 循环、中键关闭；`TabBar`/`Topicbar` 加 `role="tablist"/"tab"/"aria-selected"`。**`Cmd+W` 未绑定**（见待核实项结论） | 已实施 |
| 后台会话提醒（第 3 项） | 新增 `finishedUnseen`（`session.idle` 时且非当前会话、且非子会话才置位；`openSession` 清除），与 `questions`/`permissions` 经 `rootSessionOf` 归并后驱动 tab 上的单点状态灯（运行中/待回复/已完成）。`runtime.store.test.ts` 2 例 | 已实施 |
| 运行中实时耗时（第 4 项） | `ToolCallBlock.startedAt`（首次 running 记录、后续沿用）+ `useElapsed`（1s tick）+ `formatElapsed`；顺带删掉 `ToolCallRow` 里读不存在字段 `block.duration` 的死分支 | 已实施 |
| 待处理请求可见性（第 5 项） | 决策卡上方显示「另有 N 个请求在排队」（>1 时）；**来源标注本已存在**（`LiveSessionPage` 的 `requestOrigin` 会点名子代理） | 已实施 |
| 会话内检索（第 6 项） | 未开始 | **待实施** |
| 回归 | `pnpm test`：desktop 64 文件 585 例、sdk 3 例、relay 22 例全通过；`pnpm lint` / `format:check` / `md:check` 全绿。类型检查见下（本仓 desktop 的 `pnpm typecheck` 是**空转的**） | 见下 |

### 实施中发现的关键问题：desktop 的 typecheck 一直空转

`apps/desktop/tsconfig.json` 是 `{ "files": [], "references": [node, web] }`，而 `typecheck` 脚本是 `tsc --noEmit`
——**不带 `-b` 时 project references 不会被跟进，`files: []` 意味着一个文件都不检查**。也就是说：

- 本仓 `pnpm typecheck` 对 desktop 应用一直**什么都没验证**（sdk / relay / client 各自的 tsconfig 有真实 include，不受影响）。
- 用真实配置跑一次（`npx tsc --noEmit -p tsconfig.web.json`）立刻暴露 **32 个既有类型错误**，遍布 18 个文件，其中包括真缺陷：
  - `messageTurns.ts:39` 读 `block.tool`、`ToolCallRow.tsx:97` 读 `block.duration` —— 这两个字段在 `ToolCallBlock` 上根本不存在，前者是死逻辑，后者是永不显示的死 UI（本次顺带删掉了后者）。
  - `lib/electron.ts` 调用了 `ElectronAPI` 未声明的 6 个方法（`roomPickFile` 等）；`lib/tauri.ts` 引用了不存在的 `JupyterStatus`。
  - `a2ui/engine.ts` 两处访问 `private processMessage`；`FencePreview` 两处联合类型未收窄；`InspectorShell` 的 `'code'` 不是 `ArtifactKind`。
- 本次新增/改动**没有引入类型错误**：已用真实配置逐文件核对，改动文件全部干净（顺带修掉了自己引入的 4 处：`rootSessionOf` 调用参数、`blockKey` 的联合类型取值、`TokenUsage` 测试夹具缺字段）。
- 结论：本次所有「类型检查通过」的表述在**这个脚本修好之前都不成立**，真实保障来自 585 个测试与 lint。是否修好这个闸门（把脚本改成 `tsc -b` 或显式 `-p`，并清掉 32 个既有错误）需要单独决策——修好会让 CI 立刻变红，直到那批错误清完。

### 待核实项（结论）

- **`Cmd+W` 不能占用**：`src/main` 没有 `setApplicationMenu`，macOS 用的是 Electron 默认菜单，`Cmd+W` 是系统「关闭窗口」role，渲染层收不到该键。要抢占就得整体替换应用菜单，而那份默认菜单同时承载 `Cmd+C/V` 等 Edit role，风险远超收益 → **不绑定**，关闭 tab 用中键或 ✕。
- **`questions` / `permissions` 带 `sessionId`**：`packages/sdk/src/agent-runtime/types.ts:111` 起两个事件都有该字段 → 后台提醒可派生（已实施）。
- **`tool.updated` 无开始时间**：`ToolUpdatedEvent`（`types.ts:35-49`）没有时间字段 → 由前端在首次见到 `running` 时记录（已实施）。
- **`StepGroup` 的逐块折叠维持现状**：它的默认值来自全局偏好 `expandThreadDetails`（刻意的），逐块的临时展开是瞬态；本轮**不做 per-session**。若日后发现跨会话残留造成困扰，再按第 1 项的模型收进去。
- **检索的「临时显形」通道**：仍未设计（批次三未开始）。

## 显式排除（不照抄的部分）

- **不照抄 prefix-append 增量渲染**（`chat/render.js:240-252`）：那是无虚拟 DOM 的手工优化，React 用稳定 key 即可达到同样效果（见设计 7）。
- **不照抄「用户滚动时跳过渲染」**（`chat/render.js:209` + `main.js:204-206`）：它依赖全量重建 DOM 才需要这招；
  本仓已是 20fps 节流 + memo（`runtime.ts:799-814`），再加一层只会让流式更新无谓延迟。
- **不做 tab 拖拽排序与跨重启持久化**：理由见「约束项」。
- **不引入队列式权限模态**：本仓的单槽 `DecisionSurface` 是有意的展示模型，只补「还有多少」的可见性（设计 5）。
- **不改 relay / client**：独立项目，移动端交互由它们承担。
