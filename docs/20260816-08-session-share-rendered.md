# 会话分享：分享内容渲染为 markdown

## 背景

20260816-07 的 `session-share` 卡片展开后直接用 `<pre>` 展示压缩摘要的原始
markdown 文本（`# 标题`、`**用户**` 等标记符号可见）。用户希望分享的会话
**渲染后**展示——标题、加粗、列表等格式生效，阅读体验接近真实聊天。

## 目标

- 卡片展开区用 markdown 渲染器替换 `<pre>` 原始文本。
- 复用两端现有组件：client 用 `MarkdownView`（`client/src/components/MarkdownView.tsx`），
  desktop 用 `MarkdownViewer`（`apps/desktop/src/renderer/components/markdown-viewer/`）。
- 样式适配卡片场景（浅色背景、紧凑间距、等宽不再强制）。

## 设计

### client（`client/src/pages/RoomsPage.tsx`）

- `SessionShareCard` 展开区：`<pre className="room-msg-share-body">{msg.text}</pre>`
  → `<div className="room-msg-share-body"><MarkdownView>{msg.text}</MarkdownView></div>`。
- `import { MarkdownView } from "@/components/MarkdownView"`。
- `.room-msg-share-body` 样式调整：去掉 `font-family: mono` / `white-space: pre-wrap`，
  改为普通文本容器 + 内边距；markdown 的标题/加粗样式沿用 `.md-*` 类（已有全局样式）。

### desktop（`apps/desktop/src/renderer/app/routes/RoomsPage.tsx`）

- `SessionShareCard` 展开区：`<pre>` → `<MarkdownViewer variant="chat" className="max-h-80 overflow-y-auto border-t border-border bg-bg px-3 py-2 text-xs">{msg.text}</MarkdownViewer>`。
- `import { MarkdownViewer } from "@/components/markdown-viewer/MarkdownViewer"`。

### 兼容性

纯渲染层改动；协议、压缩格式、消息内容不变。

## 涉及文件

| 文件 | 改动 |
| --- | --- |
| `client/src/pages/RoomsPage.tsx` | 展开区换 `MarkdownView` |
| `client/src/styles.css` | `.room-msg-share-body` 样式调整 |
| `apps/desktop/src/renderer/app/routes/RoomsPage.tsx` | 展开区换 `MarkdownViewer` |

## 验证状态

- [x] client / desktop typecheck + build 通过
- [x] 浏览器验证：展开分享卡片，标题渲染为 h1、加粗生效、列表渲染为 li（`#`/`**`/`-` 原始标记不再显示）
