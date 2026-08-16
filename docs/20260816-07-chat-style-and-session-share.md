# 会话分享：聊天工具风格 UI + 真正的会话分享（/ 命令）

## 背景

1. 当前 client 会话分享页是「表单式」列表（昵称输入 + 两个按钮 + 最近会话 + 说明文字），
   不像聊天工具；用户希望界面更接近微信/Telegram 的会话列表 + 聊天窗口。
2. 目前「会话分享」只能发文本/语音/文件，无法把**历史 agent 会话**（SessionsPage 里的
   对话记录）分享给房间成员。用户希望：输入 `/` 弹出历史会话选择器，选中后把会话过程
   **压缩**成一条消息发到房间，接收方**展开查看**。

## 目标

- 列表页改为聊天工具风格的会话列表（头像、名称、时间、操作），聊天页保持气泡样式并微调。
- 输入框输入 `/` → 弹出历史会话选择器（复用 `listSessions`）。
- 选中会话 → 拉取消息（`getMessages`）→ 压缩为摘要文本 → 以新消息类型 `session-share`
  发到房间。
- 接收方渲染为可展开卡片：默认显示标题 + 「展开查看」，点击展开显示压缩内容。
- client + desktop 两端一致，协议三端同步（relay / client / desktop）。

## 设计

### 1. 协议扩展（三端同步）

`relay/src/protocol.ts`（同步 `client/src/protocol.ts`、
`apps/desktop/src/main/relay-protocol.ts`）：

```typescript
// RoomMessage / RoomMessageRouted 的 kind 扩展
kind?: "text" | "audio" | "file" | "session-share";

// RoomMessageMeta 扩展（仅 session-share 使用）
export interface RoomMessageMeta {
  filename?: string;
  size?: number;
  mime?: string;
  duration?: number;
  /** kind="session-share"：被分享会话的标题。 */
  sessionTitle?: string;
  /** kind="session-share"：被分享会话的 id。 */
  sessionId?: string;
}
```

`ct` 字段携带压缩后的会话内容文本（与 text 消息相同的 base64 明文编码，
E2E 加密延后后一并替换）。

### 2. 压缩格式（client 端 `compressSessionMessages`）

`client/src/lib/roomShare.ts`（新）导出：

```typescript
export interface SessionSharePayload {
  title: string;
  sessionId: string;
  summary: string; // 压缩后的 markdown 文本
}

/** 把 HistoryMessage[] 压缩为摘要文本：
 *  - 只取 text 类型 part；
 *  - 用户消息标注 "**用户**"，助手消息标注 "**助手**"；
 *  - 每条截断 150 字符，超过加 "…"；
 *  - 最多保留最近 30 条。 */
export function compressSession(title: string, sessionId: string, messages: HistoryMessage[]): SessionSharePayload;
```

desktop 端复制同逻辑（`apps/desktop/src/renderer/lib/roomShare.ts`），
因 desktop 与 client 是独立 workspace（不自持 sdk/shared 副本）。

### 3. client 端

#### roomConnection.ts

- `sendSessionShare(payload: SessionSharePayload): string`
  - 与 `sendMessage` 相同结构，`kind: "session-share"`，
    `ct = btoa(unescape(encodeURIComponent(payload.summary)))`，
    `meta = { sessionTitle, sessionId }`。

#### RoomsPage.tsx

**列表页改造成聊天工具风格**：

```
header: 「会话分享」标题
最近会话列表（聊天列表项）：
  ┌────────────────────────────────┐
  │ (首字符头像) 会话 ZZDFZZ    刚刚 │
  │              说明/时间         │  ×
  └────────────────────────────────┘
底部操作栏（固定）：[＋ 创建会话] [加入会话]
```

- 每项：圆形头像（邀请码首字符）+ 会话名（邀请码等宽大字）+ 相对时间 + 删除按钮。
- 昵称输入改为头部右侧小设置入口（点击弹底部 sheet 改昵称），不占列表主区域。
- 保留提示文案（收进列表底部小字或移除——精简为两行）。

**聊天页**：

- 保持气泡 + 昵称 + 时间布局，微调：输入栏上移分隔线、消息间距。
- 输入框 `/` 交互：
  - `onChange` 检测输入以 `/` 开头 → 显示「分享历史会话」浮层（覆盖在输入栏上方）。
  - 浮层调用 `listSessions()`（需已连接设备；未连接时提示先选设备），列出
    标题 + 更新时间，点击条目：
    1. `getMessages(sessionId)` → `compressSession(...)` → `sendSessionShare(...)`
    2. 本地追加一条 `kind: "session-share"` 消息
    3. 清空输入，关闭浮层
  - 输入 `/` 后继续输入其他字符（非选择）→ 浮层关闭，走普通文本。
- 渲染：`MessageContent` 增加 `kind === "session-share"` 分支：
  - 卡片：`📎 会话分享：{sessionTitle}` + `{summary 前 80 字符}…` + 「展开查看」按钮。
  - 点击切换展开/收起，展开显示完整 summary（等宽/引用样式）。

### 4. desktop 端

- `apps/desktop/src/main/roomPeer.ts`：`sendSessionShare(payload)`（同 client）。
- `apps/desktop/src/renderer/app/routes/RoomsPage.tsx`：与 client 相同的
  列表改造 + `/` 浮层 + 卡片渲染；会话列表/消息通过 renderer 已有 API
  （`listSessions` / `getMessages` 的 IPC）获取。
- 若 renderer 尚无对应 IPC，在 `electron.ts`/`ipc.ts` 补 `session-list` / `session-messages`。

### 5. 兼容性

- 旧客户端收到 `session-share` 消息：kind 未知 → 落入 text 分支渲染摘要文本
  （内容本身是 markdown 文本，可读），不报错。
- 新客户端收到旧消息：不受影响。

## 涉及文件

| 文件 | 改动 |
| --- | --- |
| `relay/src/protocol.ts` | kind 扩展 + meta 字段 |
| `client/src/protocol.ts` / `apps/desktop/src/main/relay-protocol.ts` | 同步协议 |
| `client/src/lib/roomShare.ts`（新） | `compressSession` |
| `client/src/lib/roomConnection.ts` | `sendSessionShare` |
| `client/src/pages/RoomsPage.tsx` | 列表页改造 + `/` 浮层 + 卡片渲染 |
| `client/src/styles.css` | 列表项 / 浮层 / 卡片样式 |
| `apps/desktop/src/main/roomPeer.ts` | `sendSessionShare` |
| `apps/desktop/src/renderer/lib/roomShare.ts`（新） | 同 client |
| `apps/desktop/src/renderer/app/routes/RoomsPage.tsx` | 同 client |
| `apps/desktop/src/renderer/lib/electron.ts` / `ipc.ts` | 按需补 session 列表/消息 IPC |

## 验证状态

- [x] relay / client / desktop typecheck + build 通过（relay 22 测试通过）
- [x] 双标签页浏览器验证：
  - [x] 列表页为聊天工具风格（圆形头像、相对时间、底部操作栏、昵称 chip）
  - [x] 输入 `/` 弹出「分享历史会话」浮层（本地无在线 host 时显示「暂无历史会话」）
  - [x] 接收方看到 session-share 卡片（标题 + 「展开查看」），点击展开显示完整压缩内容（模拟 peer 发送验证）
  - [ ] 选中历史会话后真实发送（需 host 在线提供 listSessions/getMessages，真机验证）
  - [ ] 未选设备时 `/` 浮层提示先选择设备（代码路径已实现，真机验证）
