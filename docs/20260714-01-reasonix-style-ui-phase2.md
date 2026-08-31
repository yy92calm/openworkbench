# 方案：Reasonix 风格二期 — 对话 UI 深度优化

## 背景

一期 Reasonix 风格优化（20260709-05）已完成基础改造：用户气泡右对齐、ToolCallRow 可折叠卡片、Composer 运行状态条、对话区域加宽至 940px。

二期在此基础上继续打磨细节，重点提升：

- 思考过程卡片的视觉品质（渐变边框、深色主题适配）
- Agent 消息的辨识度（左侧 accent 线条）
- 工作中指示器的精致度（打字动画替代 spinner）
- 工具调用分组的信息密度（进度摘要）
- 分隔线的精致感
- ShellCard 终端风格增强

## 设计

### 1. ReasoningCard 视觉升级

- 流式态：左侧 2px 渐变竖线（purple → transparent），替代全边框高亮
- 折叠态：默认折叠（已完成思考后），流式时自动展开
- 深色主题：purple 色调调整为更柔和的 violet-400/violet-500
- 展开内容区：改用 `text-text-dim` + 适度行高，提升长文本可读性

### 2. AgentMessage 左侧 accent 线条

- 在 agent 消息左侧添加 2px 宽 accent 色竖线（高度与内容齐平）
- 仅在非流式态显示，流式态不显示（避免干扰打字动画）
- 竖线与文字间距 12px，形成清晰的"agent 区域"视觉锚点

### 3. WorkingIndicator 打字动画

- 替换 LiveSessionPage 底部的 Loader2 spinner
- 使用三个圆点的波浪动画（bounce delay）
- 右侧保留当前工具名称显示
- 整体更紧凑、更贴近 Reasonix 风格

### 4. ToolGroup 进度摘要

- 折叠态头部显示完成进度：`✓ 3/5 工具调用`
- 全部完成时图标变为 Check（绿色）
- 有失败时图标变为 X（红色），摘要显示 `✗ 2/5 工具调用`

### 5. TurnDivider 精致化

- 线条使用 `border-soft` 而非 `border`，更轻柔
- 标签文字增加左右小 padding，增加呼吸感
- 整体 py 从 `py-2` 调整为 `py-3`，增加纵向呼吸

### 6. ShellCard 终端风格增强

- 头部增加终端标题栏效果：左侧红黄绿三点 + 命令文本
- 展开区域使用更深的背景色（模拟终端）
- 成功态底部增加淡绿色渐变条

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/renderer/components/thread/ReasoningCard.tsx` | 渐变竖线、深色适配、折叠逻辑 |
| `src/renderer/components/thread/atoms.tsx` | AgentMessage 左侧 accent 线条 |
| `src/renderer/app/routes/LiveSessionPage.tsx` | WorkingIndicator 打字动画 |
| `src/renderer/components/thread/BlockList.tsx` | ToolGroup 进度摘要 |
| `src/renderer/components/thread/TurnDivider.tsx` | 精致分隔线 |
| `src/renderer/components/thread/ShellCard.tsx` | 终端风格增强 |
| `src/renderer/index.css` | 新增动画 keyframes |

## 验证状态

- [x] `pnpm typecheck` 通过
- [x] `pnpm build` 通过
- [ ] 视觉检查：ReasoningCard 渐变竖线 + 深色主题
- [ ] 视觉检查：AgentMessage 左侧 accent 线条
- [ ] 视觉检查：WorkingIndicator 打字动画
- [ ] 视觉检查：ToolGroup 进度摘要
- [ ] 视觉检查：TurnDivider 精致分隔线
- [ ] 视觉检查：ShellCard 终端风格
