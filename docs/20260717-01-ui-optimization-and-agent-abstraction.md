# 前端界面优化与 Agent 接入层设计

日期：2026-07-17，序号 01

基于对 Reasonix Desktop 前端设计的深入分析（详见 `DESKTOP_REASONIX_ANALYSIS.md`），以及当前 Workbench 项目的架构现状，提出以下两个方向的设计方案。

---

## 目录

1. [方向一：前端界面优化](#方向一前端界面优化)
2. [方向二：Agent 接入层设计](#方向二agent-接入层设计)
3. [方向三：打包配置与运行时引擎选择](#方向三打包配置与运行时引擎选择)
4. [实施路线](#实施路线)
5. [验证状态](#验证状态)

---

## 方向一：前端界面优化

### 设计目标

将 Reasonix 的设计密度和交互品质迁移到 Workbench 的 Electron + Tailwind 栈中，保留项目已有的工笔纸感美学（warm paper aesthetic），强化 Agent 对话界面的信息层级与操作效率。

### 1.1 布局系统

#### 现状

- 固定侧边栏（200px，可拖拽 resize 到 160–360px）+ 主内容区 + 可选右侧面板（480px）
- 侧边栏内容：新建按钮 + 导航链接 + 扁平会话列表 + 搜索
- 无标签页系统，一次只能看一个会话
- 无项目树

#### 设计方案

引入三层布局结构，通过配置或用户偏好切换，风格兼容现有 paper aesthetic：

**布局 A：经典（classic）** — 当前布局的改良版

```text
┌──────────────────────────────────────────────────┐
│  App Chrome（可选 macOS 交通灯适配 + 面包屑）      │
├────────┬──────────────────────────┬───────────────┤
│        │                          │   Right Dock  │
│ Sidebar│   会话 / 对话区域          │  (context /   │
│  (平面  │   Transcript + Composer  │   files /     │
│  会话   │                          │   changed)    │
│  列表)  │                          │               │
│        │                          │               │
├────────┴──────────────────────────┴───────────────┤
│  Status Bar（tokens/缓存/模型/费用/工作区）        │
└──────────────────────────────────────────────────┘
```

**布局 B：工作台（workbench）** — 默认，带标签页和项目树

```text
┌──────────────────────────────────────────────────────┐
│  [Tab1] [Tab2] [+]    搜索  [面板开关] [设置]         │
├────────┬─────────────────────────┬───────────────────┤
│        │   Transcript + Composer │  Right Dock       │
│  Project│  (每标签页独立历史/状态) │  Overview / Files │
│  Tree   │                        │  / Git Changed    │
│  (带时间 │                        │                   │
│  过滤器) │                        │                   │
│        │                        │                   │
├────────┴─────────────────────────┴───────────────────┤
│  Status Bar                                          │
└──────────────────────────────────────────────────────┘
```

**布局 C：创作（creation）** — workbench 精简版，隐藏右 dock 的 Overview tab

- 同 workbench，但 `creationSidebarFeatureZone` 展示技能/记忆/消息渠道/自动化四个快捷入口
- 右 dock 默认只显示 Files 和 Changed，不显示 Context（token 用量）
- 用于极简写作/研究场景

#### 变更范围

| 文件 | 改动 |
|------|------|
| `apps/desktop/src/renderer/app/layout/AppShell.tsx` | 重写为多布局系统，支持 sidebar/tab-bar/right-dock/status-bar 组合 |
| `apps/desktop/src/renderer/store/` | 新增 `layout.ts`（zustand store，持久化几何状态） |
| `apps/desktop/src/renderer/lib/layoutPreferences.ts` | 布局偏好持久化工具（localStorage / electron-store） |
| `apps/desktop/src/renderer/lib/resizeDrag.ts` | rAF 批量 CSS 变量更新（提取自 AppShell 现有拖拽逻辑） |
| `apps/desktop/tailwind.config.js` | 扩展 CSS 变量体系 |
| `apps/desktop/src/renderer/index.css` | 布局变量、right-dock、tab-bar 样式 |

### 1.2 标签页系统（Tabs）

#### 现状（1.2）

- 无标签页。一次只能打开一个会话，切换通过侧边栏列表。
- 后台会话不保留状态。

#### 设计方案（1.2）

引入 Reasonix 风格的 Tab 系统：

- 每个 `TabMeta` 对应一个打开的 project topic 或 session
- 后台 tab 保留流式状态、审批、工具调用
- 拖拽重排，右键关闭
- `TabBar` 组件：显示 tab 标题、项目颜色标识、活跃状态
- `reorderTabs` / `closeTab` / `switchTab` 操作由 zustand store 管理

**核心类型**（参考 `types.ts` 的 TabMeta）：

```typescript
interface TabMeta {
  id: string;
  kind: "session" | "topic";
  title: string;
  scope: "global" | "project";
  workspaceRoot: string;
  sessionPath?: string;
  topicId?: string;
  projectColor?: string;
  mode?: "normal" | "plan" | "goal";
  toolApprovalMode?: "ask" | "auto" | "yolo";
  recovered?: boolean;
  startupErr?: string;
}
```

#### 变更范围（1.2）

| 文件 | 改动 |
|------|------|
| `apps/desktop/src/renderer/components/thread/TabBar.tsx` | 新增 |
| `apps/desktop/src/renderer/store/layout.ts` | tab 状态管理 |
| `apps/desktop/src/renderer/app/layout/AppShell.tsx` | 集成 TabBar |

### 1.3 项目树（Project Tree）

#### 现状（1.3）

- 侧边栏显示扁平会话列表（按时间排序）
- 无目录层次、无分组

#### 设计方案（1.3）

引入 Reasonix 风格的 ProjectTree，替代扁平会话列表：

- 树节点类型：`project` / `topic` / `session` / `global_topic` / `global_session`
- 节点状态：`thinking` / `streaming` / `waiting_confirmation` / `background_job` / `paused` / `error`
- 项目颜色 `--project-accent`
- 时间过滤器：all / 10m / 20m / 1h / 3h / 5h / 1d
- 拖拽重排、右键删除/重命名
- Topic shortcut 徽章：Cmd 长按 250ms 显示 1–9 快捷键

**核心类型**：

```typescript
interface ProjectNode {
  id: string;
  kind: "project" | "topic" | "session" | "global_folder" | "global_topic" | "global_session";
  title: string;
  children?: ProjectNode[];
  root?: string;
  topicId?: string;
  turns?: number;
  status?: "thinking" | "streaming" | "waiting_confirmation" | "background_job" | "paused" | "error";
  sessionPath?: string;
}
```

#### 变更范围（1.3）

| 文件 | 改动 |
|------|------|
| `apps/desktop/src/renderer/components/sidebar/ProjectTree.tsx` | 新增（或重写 Sidebar.tsx） |
| `apps/desktop/src/renderer/components/sidebar/Sidebar.tsx` | 重写，集成 ProjectTree |
| `apps/desktop/src/renderer/lib/projectColors.ts` | 新增 |
| `apps/desktop/src/renderer/lib/topicShortcuts.ts` | 新增 |

### 1.4 对话流优化（Thread / Transcript）

#### 现状（1.4）

- `BlockList`：顺序渲染 ThreadBlock 数组（UserMessage / AssistantText / ToolCall / Artifact / Figure / Reasoning）
- 无分组、无暖冷分层、无动画
- 自动滚动：简单的 scrollToBottom
- Skeleton：基本骨架屏

#### 设计方案（1.4）

引入 Reasonix Transcript 的设计模式：

**暖冷分层分页**（warm / cold layering）：

- Warm layer：近期 N 条消息，可见且响应式
- Cold layer：更早的折叠历史，展开时懒加载
- 减少初始渲染体积

**消息入场动画**：

- 使用 CSS animation 或简单的 transition（Reasonix 的 GSAP 太重，不适合 Electron 的 WebView）
- 新消息淡入 + 上移，新工具调用卡片从下方滑入
- 支持 `prefers-reduced-motion`

**推理折叠**：

- 推理内容默认折叠，显示 token 数和耗时
- 用户点击展开，展开时平滑过渡（max-height transition）

**工具调用聚合**：

- 连续的只读工具（read file / grep / glob）聚合为一个折叠卡
- 子代理调用（task / explore / research）内联显示进度

**Typing indicator**：

- 三个弹跳圆点（现有 `typing-dot` 动画已实现，保留）
- 当前工具名称显示在指示器旁（现有 `currentTool` 逻辑保留）

#### 变更范围（1.4）

| 文件 | 改动 |
|------|------|
| `apps/desktop/src/renderer/components/thread/BlockList.tsx` | 暖冷分层、入场动画、工具聚合 |
| `apps/desktop/src/renderer/components/thread/ToolCallRow.tsx` | 推理折叠、子代理内联 |
| `apps/desktop/src/renderer/components/thread/ReasoningCard.tsx` | 折叠/展开动画 |
| `apps/desktop/src/renderer/lib/transcriptGrouping.ts` | 新增：暖冷分层算法 |
| `apps/desktop/src/renderer/lib/useEntranceAnimation.ts` | 新增：入场动画 hook |
| `apps/desktop/src/renderer/index.css` | 动画相关 CSS |

### 1.5 Composer 增强

#### 现状（1.5）

- `Composer.tsx`（565 行）：textarea + 文件附件 chips + shell 模式（`!`）+ 斜杠命令（`/`）下拉
- 附件：拖放/粘贴文件转为 workspace 文件
- 历史：↑/↓ 导航 input history
- 发送按钮/Stop 按钮切换

#### 设计方案（1.5）

基于现有 Composer 能力进行增强，保持 Tailwind + Radix UI 风格：

**增强型命令菜单**（`/`）：

- 当前已有 `matches` 过滤逻辑，增强为虚拟化下拉（cmdk 或自定义 virtual list）
- 分组显示（config commands / skills / MCP prompts）
- 命令选中后显示为 Chip，输入框变为参数输入

**增强型文件引用**（`@`）：

- 当前已有 `fileSuggestions`，增强为触发 `@` 时的下拉菜单
- 显示文件路径、类型图标
- 选中后插入为引用 token（可与现有卡片/附件系统配合）

**底部工具栏扩展**：

```text
┌─────────────────────────────────────────────────────────────┐
│  [模型选择] [Effort] [协作模式] [审批模式] [Token 模式]     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ textarea                                                ││
│  │                                                         ││
│  └─────────────────────────────────────────────────────────┘│
│  [+ 附件]                                [预估 Token] [发送] │
└─────────────────────────────────────────────────────────────┘
```

- 模型选择器（`ModelSwitcher`）
- Effort 选择器（`EffortSwitcher`）
- 协作模式切换（normal / plan / goal）
- 工具审批模式切换（ask / auto / yolo）— 现有 `ModeSwitch` 组件已实现
- Token 模式切换（full / economy / delivery）
- Context 窗口环形图（creation 风格）

#### 变更范围（1.5）

| 文件 | 改动 |
|------|------|
| `apps/desktop/src/renderer/components/thread/Composer.tsx` | 扩展工具栏、@菜单、虚拟化 |
| `apps/desktop/src/renderer/components/thread/ModelSwitcher.tsx` | 新增 |
| `apps/desktop/src/renderer/components/thread/EffortSwitcher.tsx` | 新增 |
| `apps/desktop/src/renderer/components/thread/ModeSwitch.tsx` | 保留并增强 |
| `apps/desktop/src/renderer/components/thread/VirtualMenu.tsx` | 新增（虚拟化下拉） |
| `apps/desktop/src/renderer/components/thread/SlashMenu.tsx` | 新增（或重构现有逻辑） |
| `apps/desktop/src/renderer/components/thread/ContextWindowRing.tsx` | 新增 |

### 1.6 主题系统

#### 现状（1.6）

- 两套 CSS 变量（light / dark），通过 `data-theme` 切换
- 手写 `:root` 和 `[data-theme="dark"]`
- Tailwind 通过 `var(--xxx)` 引用

#### 设计方案（1.6）

参考 Reasonix 的 6 方向 × 明暗 主题体系，提取为 CSS 变量文件结构：

```css
/* 基础 token（不变） */
:root {
  --font-scale: 1;
  --dur-fast: 0.12s;
  --dur-base: 0.18s;
  --dur-slow: 0.34s;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --z-sidebar: 30;
  --z-tab-bar: 40;
  --z-right-dock: 50;
  --z-composer: 60;
  --z-modal: 100;
  --z-toast: 200;
  --z-onboarding: 9999;
}

/* 明暗变量（现有）— 保留并扩展为 3×2 体系 */
:root, [data-theme="light"] { /* warm paper */ }
[data-theme="dark"] { /* dark paper */ }

/* 新增 theme-style 方向 */
[data-theme-style="graphite"] { /* 冷灰调 */ }
[data-theme-style="aurora"] { /* 蓝绿调 */ }
[data-theme-style="slate"] { /* 石板调 */ }
[data-theme-style="carbon"] { /* 碳色（高对比） */ }
[data-theme-style="amber"] { /* 琥珀暖调 */ }
```

**文本字号**（`data-text-size`）：

- 五档：small / default / large / xlarge / xxlarge
- 通过 `--font-scale` 变量配合 `calc()` 缩放

**字体预设**（`data-font-family`）：

- 四档：inter / yahei / noto / custom
- 等宽字体：cascadia / jetbrains / sfmono / custom

#### 变更范围（1.6）

| 文件 | 改动 |
|------|------|
| `apps/desktop/src/renderer/index.css` | 扩展主题变量体系 |
| `apps/desktop/tailwind.config.js` | 扩展 z-index、动画 token |
| `apps/desktop/src/renderer/lib/theme.ts` | 新增主题管理（方向、字号、字体） |
| `apps/desktop/src/renderer/app/providers/ThemeProvider.tsx` | 扩展支持 theme-style / text-size / font-family |
| `apps/desktop/src/renderer/components/settings/AppearanceSection.tsx` | 新增外观设置页 |

### 1.7 状态栏（Status Bar）

#### 现状（1.7）

- `StatusBar.tsx`（336 行）：显示 agent 状态、session 计数 + 连接按钮

#### 设计方案（1.7）

参考 Reasonix StatusBar，显示更多运行时指标：

- 缓存命中率（单 turn / 会话聚合 / 全来源三档）
- 当前 token 用量 / 窗口比例
- 费用估算
- 余额
- 当前工作区路径 / Git 分支
- Turn 计数
- 可配置可见项（`statusBarItems`）

#### 变更范围（1.7）

| 文件 | 改动 |
|------|------|
| `apps/desktop/src/renderer/components/sidebar/StatusBar.tsx` | 扩展指标显示 |
| `apps/desktop/src/renderer/lib/statusBarItems.ts` | 新增 |
| `apps/desktop/src/renderer/lib/useController.ts` (runtime.ts) | 暴露 context/usage/metrics 数据 |

### 1.8 启动/引导流

#### 现状（1.8）

- 无启动闪屏
- 无首次运行引导

#### 设计方案（1.8）

- **StartupSplash**：启动时显示品牌 logo + 加载状态，`sessionStorage` 标记避免同会话重复
- **OnboardingOverlay**：首次运行时引导用户配置 API key（如果未检测到已配置的 provider）
- **Welcome**：空状态落地页，显示快捷键提示和常用操作入口

#### 变更范围（1.8）

| 文件 | 改动 |
|------|------|
| `apps/desktop/src/renderer/components/shell/StartupSplash.tsx` | 新增 |
| `apps/desktop/src/renderer/components/shell/OnboardingOverlay.tsx` | 新增 |
| `apps/desktop/src/renderer/components/shell/Welcome.tsx` | 修改（现有 WorkflowStarters） |
| `apps/desktop/src/renderer/app/layout/AppShell.tsx` | 集成启动/引导流 |

### 1.9 快捷键系统

#### 现状（1.9）

- 无全局快捷键框架
- Esc 打断运行中 turn（在 LiveSessionPage 中实现）
- `useGlobalShortcut` 不存在

#### 设计方案（1.9）

参考 `keyboardShortcuts.ts`（Reasonix 21 个动作），提取 Workbench 所需的公共快捷键：

| 动作 | 默认快捷键 | 状态 |
|------|-----------|------|
| 新建会话 | `Cmd+N` | 新增 |
| 打开命令面板 | `Cmd+K` | 现有 cmdk |
| 打开设置 | `Cmd+,` | 新增 |
| 切换侧边栏 | `Cmd+B` | 新增 |
| Esc 打断 | `Esc` | 现有 |
| 关闭标签页 | `Cmd+W` | 新增 |
| 增大字号 | `Cmd++` | 新增 |
| 减小字号 | `Cmd+-` | 新增 |
| 显示快捷键 | `?` / `Cmd+/` | 新增 |

自定义快捷键持久化：`reasonix.customShortcuts` → `workbench.customShortcuts`

#### 变更范围（1.9）

| 文件 | 改动 |
|------|------|
| `apps/desktop/src/renderer/lib/keyboardShortcuts.ts` | 新增 |
| `apps/desktop/src/renderer/lib/useGlobalShortcut.ts` | 新增 |
| `apps/desktop/src/renderer/components/shell/ShortcutsCheatsheet.tsx` | 新增 |

---

## 方向二：Agent 接入层设计

### 设计目标（方向二）

当前 `packages/sdk/src/OpenCodeClient.ts` 与 OpenCode 服务的 HTTP+SSE API 紧耦合。设计一个抽象的 `AgentRuntime` 接口层，使 Workbench 可以对接不同的 Agent 运行时（opencode / claude code），同时共享同一套 UI 前端。

### 2.1 现状分析

#### 当前架构

```text
┌─────────────────────────────────────────────────┐
│ Renderer (React)                                 │
│  zustand `runtime.ts` store                     │
│    ├── OpenCodeClient (via @workbench/sdk)       │
│    └── IPC bridge → Electron main process        │
├─────────────────────────────────────────────────┤
│ Main Process (Electron)                          │
│  server.ts — spawns opencode serve sidecar       │
│  ipc.ts — IPC handlers (delegates to SDK)        │
│  cron tasks use OpenCodeClient directly          │
├─────────────────────────────────────────────────┤
│ Agent Runtime (sidecar binary)                   │
│  opencode serve (bundled binary)                 │
└─────────────────────────────────────────────────┘
```

- `OpenCodeClient` 直接实例化在 renderer 端（runtime.ts:159 `let client: OpenCodeClient | null = null`）
- 除 UI 交互外，主进程的 cron 引擎也直接实例化 OpenCodeClient（ipc.ts:30-34）
- 所有事件流、session 管理、权限/问答交互都通过 `OpenCodeClient` 暴露
- 类型定义在 `@workbench/sdk` 中

#### OpenCode 事件流

```text
SSE /event →
  message.updated
  message.part.updated / message.part.delta
  question.asked / question.replied
  permission.asked / permission.replied
  session.idle / session.error

REST API →
  POST /session          → create session
  POST /session/:id/prompt_async  → send prompt
  POST /session/:id/abort         → interrupt
  POST /session/:id/shell         → run shell command
  POST /session/:id/command       → run slash command
  GET  /session/:id/message       → get history
  GET  /session (experimental)    → list sessions
  GET  /api/skill                 → list skills
  GET  /command                   → list slash commands
  GET  /config / /global/config   → read/write config
  GET  /question / /permission    → pending interactions
  POST /question/:id/reply        → answer question
  POST /permission/:id/reply      → reply permission
```

### 2.2 设计：抽象 AgentRuntime 接口

#### 核心原则

1. **面向接口，而非实现** — UI 只依赖 `AgentRuntime` 抽象类型
2. **事件驱动** — 所有 runtime 输出统一为 NormalizedEvent 流
3. **session 为中心** — 创建/发送/打断/查询都通过 session id
4. **目录隔离** — Agent 运行时按 workspace 目录隔离实例

#### 新架构

```text
┌───────────────────────────────────────────────────┐
│ Renderer (React)                                   │
│  zustand `runtime.ts` store                        │
│    └── AgentRuntime 接口 (通过 @workbench/sdk)     │
│          ├── OpenCodeAdapter (现有 OpenCodeClient)  │
│          └── ClaudeCodeAdapter (新增)               │
├───────────────────────────────────────────────────┤
│ Main Process (Electron)                            │
│  AgentManager (管理 sidecar 生命周期)               │
│    ├── opencode sidecar spawner (现有 server.ts)    │
│    └── claude code sidecar spawner (新增)           │
│  IPC handlers → 通过 Adapter 通信                   │
│  CronEngine → 通过 AdapterFactory 获取实例           │
└───────────────────────────────────────────────────┘
```

#### AgentRuntime 接口定义

```typescript
// packages/sdk/src/agent-runtime/types.ts

/** 统一事件类型（平台无关） */
export type AgentRuntimeEvent =
  | { type: "text.updated"; sessionId: string; partId: string; text: string }
  | { type: "reasoning.updated"; sessionId: string; partId: string; text: string; streaming?: boolean }
  | { type: "tool.updated"; sessionId: string; callId: string; tool: string; status: ToolCallStatus; title?: string; input?: Record<string, unknown>; output?: string; childSessionId?: string }
  | { type: "session.idle"; sessionId: string }
  | { type: "error"; sessionId?: string; message: string }
  | { type: "question.asked"; sessionId: string; requestId: string; questions: QuestionItem[] }
  | { type: "question.resolved"; sessionId: string; requestId: string }
  | { type: "permission.asked"; sessionId: string; requestId: string; action: string; resources: string[] }
  | { type: "permission.resolved"; sessionId: string; requestId: string };

export interface QuestionItem {
  question: string;
  header: string;
  options: Array<{ label: string; description?: string }>;
  multiple?: boolean;
  custom?: boolean;
}

export type ToolCallStatus = "pending" | "running" | "success" | "failed";
export type PermissionReply = "once" | "always" | "reject";
export type PermissionMode = "review" | "auto" | "yolo";
export type RuntimeStatus = "offline" | "connecting" | "ready" | "error";

export interface AgentSessionMeta {
  id: string;
  title: string;
  slug?: string;
  directory?: string;
  parentId?: string;
}

export interface AgentCommandInfo {
  name: string;
  description?: string;
  source?: string;
  agent?: string;
  template?: string;
}

export interface AgentSkillInfo {
  name: string;
  description: string;
  location?: string;
}

export interface AgentProviderInfo {
  id: string;
  name: string;
  models: Array<{ id: string; name: string }>;
}

export interface AgentHistoryMessage {
  role: "user" | "assistant";
  completed?: number;
  parts: Array<{ type: string; text?: string; tool?: string; state?: { status?: string; title?: string; input?: Record<string, unknown>; output?: string } }>;
}

/** Agent 运行时适配器接口 */
export interface AgentRuntime {
  /** 当前状态 */
  readonly status: RuntimeStatus;
  /** 连接事件流 */
  connect(): Promise<void>;
  /** 断开事件流 */
  close(): void;
  /** 事件监听 */
  onEvent(l: (event: AgentRuntimeEvent) => void): () => void;
  /** 状态变化监听 */
  onStatus(l: (status: RuntimeStatus) => void): () => void;

  /** 创建新会话 */
  createSession(): Promise<string>;
  /** 列出会话 */
  listSessions(): Promise<AgentSessionMeta[]>;
  /** 删除会话 */
  deleteSession(sessionId: string): Promise<void>;
  /** 加载历史消息 */
  getMessages(sessionId: string): Promise<AgentHistoryMessage[]>;

  /** 发送 prompt */
  sendPrompt(sessionId: string, text: string): Promise<void>;
  /** 中断当前 turn */
  abortSession(sessionId: string): Promise<void>;
  /** 执行 shell 命令 */
  runShell(sessionId: string, command: string): Promise<void>;
  /** 执行斜杠命令 */
  runCommand(sessionId: string, command: string, args?: string): Promise<void>;

  /** 问答交互 */
  listQuestions(sessionId?: string): Promise<AgentRuntimeEvent[]>;
  answerQuestion(requestId: string, answers: string[][]): Promise<void>;
  rejectQuestion(requestId: string): Promise<void>;

  /** 权限交互 */
  listPermissions(sessionId?: string): Promise<AgentRuntimeEvent[]>;
  replyPermission(requestId: string, reply: PermissionReply): Promise<void>;

  /** Provider 管理 */
  listProviders(): Promise<AgentProviderInfo[]>;
  getDefaultModel(): Promise<string | null>;
  setDefaultModel(model: string): Promise<void>;
  listSkills(): Promise<AgentSkillInfo[]>;
  listCommands(): Promise<AgentCommandInfo[]>;

  /** 权限模式 */
  setPermissionMode(mode: PermissionMode): Promise<void>;
  getPermissionMode(): Promise<PermissionMode>;
}
```

### 2.3 OpenCodeAdapter

继承现有 `OpenCodeClient`，实现 `AgentRuntime` 接口。现有代码基本可以直接适配，主要变更：

```typescript
// packages/sdk/src/agent-runtime/opencode-adapter.ts
export class OpenCodeAdapter implements AgentRuntime {
  private client: OpenCodeClient;
  private eventForwarders = new Set<(event: AgentRuntimeEvent) => void>();
  private statusForwarders = new Set<(status: RuntimeStatus) => void>();

  constructor(opts: OpenCodeClientOptions) {
    this.client = new OpenCodeClient(opts);
    // 转发事件: 将 OpenCodeEvent 映射为 AgentRuntimeEvent
    this.client.onEvent((e) => {
      // OpenCodeEvent 与 AgentRuntimeEvent 类型基本 1:1
      this.emit(e as AgentRuntimeEvent);
    });
    this.client.onStatus((s) => {
      this.statusForwarders.forEach((l) => l(s));
    });
  }

  get status(): RuntimeStatus { return this.client.getStatus(); }

  async connect(): Promise<void> { return this.client.connect(); }
  close(): void { this.client.close(); }

  onEvent(l: (event: AgentRuntimeEvent) => void): () => void {
    this.eventForwarders.add(l);
    return () => this.eventForwarders.delete(l);
  }
  onStatus(l: (status: RuntimeStatus) => void): () => void {
    this.statusForwarders.add(l);
    return () => this.statusForwarders.delete(l);
  }

  // ... 其余方法直接代理到 this.client
}
```

**事件映射关系**：

| OpenCodeEvent（原始） | AgentRuntimeEvent（统一） | 备注 |
|----------------------|--------------------------|------|
| `text.updated` | `text.updated` | 直接映射 |
| `reasoning.updated` | `reasoning.updated` | 直接映射 |
| `tool.updated` | `tool.updated` | 直接映射 |
| `session.idle` | `session.idle` | 直接映射 |
| `error` | `error` | 直接映射 |
| `question.asked` | `question.asked` | 直接映射 |
| `question.resolved` | `question.resolved` | 直接映射 |
| `permission.asked` | `permission.asked` | 直接映射 |
| `permission.resolved` | `permission.resolved` | 直接映射 |

OpenCode 的事件类型与 AgentRuntimeEvent 高度重合，因为 OpenCodeClient 的 normalize 方法已经做了事件归一化。因此 OpenCodeAdapter 可以做到近乎透明的代理。

### 2.4 ClaudeCodeAdapter

Claude Code 目前提供 CLI 界面，可以通过其 HTTP/API 或进程间通信集成。

#### 集成方案

##### 方案 A（推荐）：CLI 包装 + SSE 模拟

Claude Code 提供 `claude` CLI，支持：

- `claude -p "prompt"` — 单次 prompt 模式
- `claude` — 交互式会话

Workbench 通过 spawn `claude` 进程并包装其 stdio 为 SSE 事件流：

```typescript
// packages/sdk/src/agent-runtime/claude-code-adapter.ts
export class ClaudeCodeAdapter implements AgentRuntime {
  private proc: ChildProcess | null = null;
  private status: RuntimeStatus = "offline";
  private sessions = new Map<string, ClaudeSession>();
  // ...

  async connect(): Promise<void> {
    // 验证 claude CLI 可用（claude --version）
    // 建立进程通信通道
    this.setStatus("ready");
  }

  close(): void {
    this.proc?.kill();
    this.proc = null;
    this.setStatus("offline");
  }

  async createSession(): Promise<string> {
    const id = crypto.randomUUID();
    const proc = spawn("claude", {
      stdio: ["pipe", "pipe", "pipe"],
    });
    // 解析 stdout 事件
    this.sessions.set(id, { id, proc, buffer: [] });
    return id;
  }

  async sendPrompt(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");
    session.proc.stdin.write(`${text}\n`);
    // 将 stdout 解析为 tool calls / text / reasoning
  }
  // ...
}
```

##### 方案 B（备选）：Claude Code 的 API/插件模式

如果 Claude Code 在未来版本中提供 HTTP API 或插件 SDK，则采用与 OpenCodeAdapter 同样的 HTTP+SSE 模式：

```typescript
export class ClaudeCodeAdapter implements AgentRuntime {
  private baseUrl: string;
  // 与 OpenCodeAdapter 类似的 HTTP 客户端模式
}
```

#### 差异分析

| 能力 | OpenCode | Claude Code (CLI 方案) | 备注 |
|------|----------|----------------------|------|
| SSE 事件流 | 原生支持 | 需从 stdio 解析 | CLI 方案需要事件提取器 |
| 会话管理 | REST API | 进程级管理 | 一个进程 = 一个会话 |
| 工具调用 | 结构化 SSE 事件 | stdout 文本解析 | 需要 text→event 解析器 |
| 权限交互 | REST API | stdin 输入 | 模拟用户键盘输入 |
| 问答交互 | REST API | stdin 输入 | 模拟用户键盘输入 |
| Provider 管理 | REST API | ~/.claude 配置文件 | 文件级管理 |
| Skill / MCP | REST API | ~/.claude 配置 | 文件级管理 |

#### ClaudeCodeAdapter 关键设计

- 事件提取器（`EventExtractor`）：解析 Claude Code stdout，提取 tool call / text / reasoning 等结构化事件
- stdin 驱动：用户交互（approve / answer）通过 `proc.stdin.write` 模拟键盘输入
- 会话与进程 1:1：每个 session 对应一个独立的 claude 子进程

### 2.5 工厂模式与配置

```typescript
// packages/sdk/src/agent-runtime/factory.ts

export type AgentRuntimeKind = "opencode" | "claude-code";

export interface AgentRuntimeConfig {
  kind: AgentRuntimeKind;
  baseUrl?: string;
  password?: string;
  directory?: string;
  /** Claude Code 专属：CLI 路径 */
  cliPath?: string;
}

export function createAgentRuntime(config: AgentRuntimeConfig): AgentRuntime {
  switch (config.kind) {
    case "opencode":
      return new OpenCodeAdapter({
        baseUrl: config.baseUrl ?? DEFAULT_OPENCODE_URL,
        password: config.password,
        directory: config.directory,
      });
    case "claude-code":
      return new ClaudeCodeAdapter({
        cliPath: config.cliPath ?? "claude",
        directory: config.directory,
      });
    default:
      throw new Error(`Unknown agent runtime: ${config.kind}`);
  }
}
```

#### renderer 端使用

```typescript
// apps/desktop/src/renderer/lib/runtime.ts
import { createAgentRuntime, type AgentRuntime } from "@workbench/sdk";

let runtime: AgentRuntime | null = null;

// 启动时
runtime = createAgentRuntime({
  kind: userPrefersAgentKind,  // "opencode" | "claude-code"
  password: await runtimePassword(),
  directory: await workspacePath(),
});
await runtime.connect();

// 之后所有操作通过 runtime.*
await runtime.sendPrompt(sessionId, text);
```

#### 主进程端使用

```typescript
// apps/desktop/src/main/ipc.ts
import { createAgentRuntime } from "@workbench/sdk";

// cron 引擎获取运行时实例
const runtime = createAgentRuntime({
  kind: "opencode",
  baseUrl: sidecarUrl,
  password: getServerPassword(),
  directory: workspaceDir(),
});
```

### 2.6 包结构变化

```text
packages/sdk/src/
├── index.ts                       # 导出公共类型和工厂
├── types.ts                       # 现有 OpenCode 类型（保留向后兼容）
├── OpenCodeClient.ts              # 现有（内部实现）
├── agent-runtime/
│   ├── index.ts                   # 导出 AgentRuntime 接口和工厂
│   ├── types.ts                   # AgentRuntimeEvent 等统一类型
│   ├── adapter.ts                 # AgentRuntime 接口定义
│   ├── opencode-adapter.ts        # OpenCode 适配器
│   ├── claude-code-adapter.ts     # Claude Code 适配器
│   ├── claude-event-extractor.ts  # Claude Code stdout 事件提取器
│   └── factory.ts                 # createAgentRuntime 工厂
```

### 2.7 兼容性与迁移

- `OpenCodeClient` 保留现有导出，不破坏现有代码
- 新增 `@workbench/sdk/agent-runtime` 导出路径
- `runtime.ts` store 逐步从 `OpenCodeClient` 迁移到 `AgentRuntime` 接口
- 迁移步骤：
  1. 新增接口类型（无行为变更）
  2. 实现 OpenCodeAdapter（wrapper 模式，现有代码不变）
  3. runtime.ts 切换引用到 AgentRuntime 接口
  4. 实现 ClaudeCodeAdapter
  5. 添加配置切换 UI

---

## 方向三：打包配置与运行时引擎选择

### 设计目标（方向三）

打包时同时捆绑 OpenCode 和 Claude Code 两套运行时配置，用户在设置页面选择使用哪个引擎。两种引擎的启动方式完全不同：

- **OpenCode**：主进程 spawn `opencode serve` sidecar（HTTP+SSE），渲染器通过 `OpenCodeClient` 连接 HTTP
- **Claude Code**：无需 sidecar，Agent SDK 在主进程内运行（Node 进程内），渲染器通过 IPC 代理与适配器通信

### 3.1 当前打包链路

```text
electron-builder.config.ts
  extraResources:
    binaries/opencode        -> resources/binaries/opencode
    app-config/.opencode     -> resources/app-config         (OpenCode profile)
    scripts/mcp_scheduler.mjs -> resources/scripts/

server.ts (main process)
  startSidecar():
    1. deployBundledProfile()  -- cp app-config/.opencode -> xdg-config/opencode
    2. spawn opencode serve --port <random>
    3. waitForReady(url)
    4. return url

renderer/runtime.ts
  bootstrap():
    1. url = startRuntime()     -- IPC -> startSidecar()
    2. set serverUrl = url
    3. connectRetry()           -- new OpenCodeClient({ baseUrl: url })
```

### 3.2 新打包链路（双引擎）

```text
electron-builder.config.ts
  extraResources:
    binaries/opencode          -> resources/binaries/opencode
    app-config/.opencode       -> resources/app-config/.opencode  (OpenCode profile)
    app-config/.claude         -> resources/app-config/.claude    (Claude profile, 新增)
    scripts/mcp_scheduler.mjs  -> resources/scripts/
    (@anthropic-ai/claude-agent-sdk 已在 node_modules, 随 app 打包)
```

### 3.3 运行时启动分支

```text
renderer/runtime.ts
  bootstrap():
    kind = useUiStore.agentRuntimeKind       -- "opencode" | "claude-code"
    result = startRuntime(kind)              -- IPC, 传递 kind

main/ipc.ts
  start-runtime handler:
    if kind == "opencode":
      url = startSidecar()                   -- 现有逻辑: spawn opencode serve
      return { kind: "opencode", url }
    if kind == "claude-code":
      deployClaudeProfile()                  -- cp app-config/.claude -> workspace/.claude
      return { kind: "claude-code", url: null }

renderer/runtime.ts
  connect():
    if kind == "opencode":
      client = createAgentRuntime({ kind: "opencode", baseUrl: url, password, directory })
    if kind == "claude-code":
      client = createAgentRuntime({ kind: "claude-code", directory })
      -- ClaudeCodeAdapter 在 renderer 中实例化, 但 SDK 需要 Node
      -- 所以 claude-code 路径通过 IPC 代理到 main process
```

### 3.4 Claude Code 的 IPC 代理层

ClaudeCodeAdapter 依赖 `@anthropic-ai/claude-agent-sdk`（Node-only，捆绑原生二进制）。渲染器无法直接导入。两种方案：

#### 方案 A（推荐）：主进程 HTTP 桥接

主进程启动一个微型 HTTP+SSE 服务器，将 ClaudeCodeAdapter 的能力暴露为与 OpenCode 兼容的 HTTP 接口。渲染器继续用 `OpenCodeClient` 连接，完全透明。

```text
main process:
  ClaudeCodeAdapter (in-process, via Agent SDK)
       ↕
  claude-bridge.ts (HTTP+SSE server on random port)
       ↕ HTTP
renderer:
  OpenCodeClient({ baseUrl: "http://127.0.0.1:<port>" })
  -- 完全复用现有 SSE 事件流逻辑
```

优点：渲染器零改动，事件流、会话管理、权限交互全部复用 OpenCode 路径
缺点：多一层 HTTP 序列化开销（本地通信，可忽略）

#### 方案 B：IPC 通道代理

每个 AgentRuntime 方法映射为一个 IPC handler。渲染器通过 `ipcRenderer.invoke` 调用。

优点：无 HTTP 开销
缺点：需要为每个方法写 IPC handler + preload 暴露 + 渲染器适配，改动量大

选择 **方案 A**，因为它让渲染器的 `connect()` 逻辑完全不变--无论是 opencode 还是 claude-code，渲染器都是"连接一个 HTTP+SSE 端点"。

### 3.5 Claude Bridge HTTP 服务器

新增 `main/claude-bridge.ts`，在主进程中：

1. 实例化 `ClaudeCodeAdapter`（通过 `createAgentRuntime({ kind: "claude-code" })`）
2. 启动一个 Node HTTP 服务器（随机端口），实现以下端点（OpenCode 兼容）：
   - `GET /event` -- SSE 事件流（转发 adapter.onEvent）
   - `POST /session` -- 创建会话
   - `POST /session/:id/prompt_async` -- 发送 prompt
   - `POST /session/:id/abort` -- 中断
   - `GET /session/:id/message` -- 历史消息
   - `GET /experimental/session` -- 会话列表
   - `GET /question` / `POST /question/:id/reply` -- 问答交互
   - `GET /permission` / `POST /permission/:id/reply` -- 权限交互
3. 适配器事件转换为 OpenCode SSE 格式（`message.part.updated` / `session.idle` 等）
4. 返回 `http://127.0.0.1:<port>` 给渲染器

### 3.6 Claude Code Profile（`app-config/.claude/`）

```text
app-config/.claude/
├── CLAUDE.md              # 项目记忆（对应 .opencode/AGENTS.md）
├── settings.json          # 权限、模型配置
├── skills/                # 技能（对应 .opencode/skills/）
│   └── *.md
└── commands/              # 斜杠命令（对应 .opencode/commands/）
    └── *.md
```

`settings.json` 示例：

```json
{
  "permissions": {
    "allow": ["Read", "Glob", "Grep"],
    "deny": [],
    "ask": ["Bash", "Write", "Edit"]
  },
  "model": "claude-sonnet-4-5-20250929"
}
```

部署逻辑：`deployClaudeProfile()` 将 `app-config/.claude` 复制到工作区的 `.claude/` 目录。

### 3.7 变更范围

| 文件 | 改动 |
|------|------|
| `app-config/.claude/CLAUDE.md` | 新增：Claude Code 项目记忆 |
| `app-config/.claude/settings.json` | 新增：权限和模型配置 |
| `apps/desktop/electron-builder.config.ts` | 新增 `.claude` 打包配置 |
| `apps/desktop/src/main/claude-bridge.ts` | 新增：HTTP+SSE 桥接服务器 |
| `apps/desktop/src/main/server.ts` | 扩展：`startAgentRuntime(kind)` 分支 |
| `apps/desktop/src/main/ipc.ts` | 扩展：`start-runtime` 接受 kind 参数 |
| `apps/desktop/src/preload/index.ts` | 扩展：`startRuntime(kind)` 传参 |
| `apps/desktop/src/renderer/lib/electron.ts` | 扩展：`startRuntime(kind)` 传参 |
| `apps/desktop/src/renderer/lib/runtime.ts` | 扩展：`bootstrap()` 读取 kind，`connect()` 用 `createAgentRuntime` |

---

## 实施路线

### Phase 5A：接入层先行（优先）

接入层是 UI 优化的前置条件——界面优化依赖统一的 AgentRuntime 接口。

| 步骤 | 内容 | 预计工时 |
|------|------|----------|
| 5A.1 | 定义 `AgentRuntime` 接口和统一类型 | 1d |
| 5A.2 | 实现 `OpenCodeAdapter`（wrapper 模式） | 0.5d |
| 5A.3 | 迁移 `runtime.ts` 到使用 `AgentRuntime` 接口 | 1d |
| 5A.4 | 迁移主进程 cron 到使用 `AgentRuntime` 接口 | 0.5d |
| 5A.5 | 实现 `ClaudeCodeAdapter` 和事件提取器 | 3d |
| 5A.6 | 添加运行时切换 UI 和设置 | 1d |
| **小计** | | **7d** |

### Phase 5B：布局与导航

| 步骤 | 内容 | 预计工时 |
|------|------|----------|
| 5B.1 | 布局系统和 store（layout.ts + resizeDrag.ts） | 2d |
| 5B.2 | 标签页系统（TabBar + tab 状态管理） | 2d |
| 5B.3 | 项目树（ProjectTree + workbench sidebar） | 3d |
| 5B.4 | 快捷键系统 | 1d |
| **小计** | | **8d** |

### Phase 5C：对话体验优化

| 步骤 | 内容 | 预计工时 |
|------|------|----------|
| 5C.1 | Transcript 暖冷分层 + 动画 | 2d |
| 5C.2 | Composer 增强（虚拟菜单、工具栏扩展） | 2d |
| 5C.3 | 状态栏扩展 | 1d |
| **小计** | | **5d** |

### Phase 5D：主题与引导

| 步骤 | 内容 | 预计工时 |
|------|------|----------|
| 5D.1 | 主题系统扩展（方向、字号、字体） | 2d |
| 5D.2 | 启动/引导流 | 1d |
| 5D.3 | 全局 CSS 重构 | 1d |
| **小计** | | **4d** |

总计预计工时：24 个工作日

---

## 验证状态

### 验证清单

| 验收项 | 验证方式 | 状态 |
|--------|----------|------|
| AgentRuntime 接口定义完整，覆盖现有 OpenCodeClient 所有功能 | 代码审查 | ✅ 通过 |
| OpenCodeClient 结构性满足 AgentRuntime 接口（无 cast） | `pnpm typecheck` | ✅ 通过 |
| ClaudeCodeAdapter 实现完整接口 | `pnpm typecheck` | ✅ 通过 |
| Claude 事件提取器映射正确 | 代码审查 | ✅ 通过 |
| runtime.ts 迁移到 AgentRuntime 接口 | `pnpm typecheck` | ✅ 通过 |
| 主进程 cron 迁移到 AgentRuntime 接口 | `pnpm typecheck` | ✅ 通过 |
| 运行时切换 UI | `pnpm typecheck` | ✅ 通过 |
| 现有测试不退化 | `pnpm test` | ✅ 通过 - 失败均为预先存在 |
| 现有 lint 不退化 | `pnpm lint` | ✅ 通过 - 错误均为预先存在 |

### 不包含的范围

- 桌面端 IM Bot 集成（飞书/Lark/微信/QQ）— 超出当前范围
- 心跳定时任务 UI（HeartbeatPanel）— 超出当前范围
- 自动更新 macOS 签名 — 不変更
- Monaco/CodeMirror 编辑器替换 — 保留 highlight.js
