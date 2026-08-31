# 方案：参考 Reasonix 交互风格优化对话 UI

## 背景

参考 [DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix) 桌面端的对话交互风格，对 Workbench 的聊天 UI 进行优化。重点改进：

- 用户消息的气泡样式（右对齐 + 强调色背景）
- 助手消息的层次感（reasoning 折叠、工具卡片）
- Composer 的运行状态反馈
- 对话区域宽度和间距

## 设计

### 1. CSS 变量体系丰富

在 `index.css` 中增加以下语义变量：

**Dark 主题新增：**

```text
--bg-elev:       提升表面（用于卡片、气泡）
--fg-dim:        次要文字
--fg-faint:      辅助文字
--border-soft:   柔和边框
--chat-user-bg:  用户气泡背景（accent 混合）
--chat-user-border: 用户气泡边框
--chat-user-shadow: 用户气泡阴影
```

**Light 主题同步适配。**

### 2. 用户消息 → 右对齐气泡

`atoms.tsx` 的 `UserMessage` 改为：

- 外层 `flex + justify-end`（右对齐）
- 内层气泡：`bg` 使用 `--chat-user-bg`，圆角 14px，边框，柔和阴影
- 文字 `font-weight: 450`，`line-height: 1.65`

### 3. 助手消息优化

- 增加与上方元素的间距（`gap: 8px`）
- Markdown 前后增加呼吸空间

### 4. ToolCallRow 可折叠卡片

- 头部：图标 + 工具名 + 状态指示（折叠/展开）
- 默认折叠，点击展开查看详情
- 折叠态高度紧凑，展开态显示完整内容

### 5. Composer 运行状态条

- 当 `working=true` 时，顶部显示状态条：脉冲点 + "Agent is working..."
- 卡片边框颜色在运行时变为强调色

### 6. 对话区域加宽

- `max-width` 从 `760px` → `940px`
- 内边距从 `px-8` → `px-8`（保持）

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/renderer/index.css` | 新增 CSS 变量 |
| `src/renderer/components/thread/atoms.tsx` | UserMessage / AgentMessage 样式 |
| `src/renderer/components/thread/ToolCallRow.tsx` | 可折叠卡片 |
| `src/renderer/components/thread/Composer.tsx` | 运行状态条 |
| `src/renderer/components/thread/ThreadView.tsx` | 内容宽度 |
| `src/renderer/app/routes/LiveSessionPage.tsx` | 内容宽度 |
| `tailwind.config.js` | 新增颜色映射 |

## 验证状态

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm build` 通过
- [ ] 视觉检查：用户消息右对齐气泡、助手消息层次清晰
- [ ] 视觉检查：ToolCallRow 可折叠
- [ ] 视觉检查：Composer 运行状态条正常显示
