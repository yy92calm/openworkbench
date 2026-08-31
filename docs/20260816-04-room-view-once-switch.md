# 会话分享：阅后即焚房间级开关 + 真焚 + 已读状态

## 背景

当前"阅后即焚"是**每条消息级**开关，由发送者点 🔒 按钮临时决定，且"焚"不彻底——接收方查看后仅在发送方标记"已查看"，接收方列表里仍保留那条消息。

用户需求：

1. 改为**房间级开关**，由创建者控制；创建者开启后整个会话内所有消息强制阅后即焚，普通成员的 🔒 切换按钮被禁用/隐藏。
2. 接收方查看后**立即从接收方列表移除**（真焚）；发送方仍保留"已查看"占位。
3. 开关**关闭**时：消息直接显示（默认查看），但发送方也要看到"已读"状态标记。

## 目标

- relay `Room` 增加 `enforceViewOnce: boolean`，由创建者在创建时指定，并支持中途切换。
- 创建者切换 → relay 广播 `room.view-once-changed` → 所有成员实时响应。
- 开启时：UI 强制 viewOnce；接收方查看后立即从列表移除（真焚），发送方保留"已查看"占位。
- 关闭时：消息直接显示；接收方查看后回执 `room.message-viewed`，发送方标记"已读"。

## 设计

### 1. 协议扩展（relay/src/protocol.ts + 三端同步）

#### 新增字段

```typescript
interface RoomJoin {
  type: "room.join";
  inviteCode: string;
  nickname?: string;
  pubKey?: string;
  // 新增：仅创建者首次 join 时携带；为 true 则房间 enforceViewOnce=true
  enforceViewOnce?: boolean;
}

interface RoomJoined {
  type: "room.joined";
  roomId: string;
  inviteCode: string;
  members: RoomMember[];
  // 新增：当前房间的强制阅后即焚状态
  enforceViewOnce: boolean;
  // 新增：当前成员是否为房间创建者（拥有切换开关的权限）
  isCreator: boolean;
}
```

#### 新增事件

```typescript
/** 创建者 → relay：切换房间 enforceViewOnce 状态。 */
export interface RoomSetViewOnce {
  type: "room.set-view-once";
  enforce: boolean;
}

/** relay → 房间全员：enforceViewOnce 已切换。 */
export interface RoomViewOnceChanged {
  type: "room.view-once-changed";
  enforce: boolean;
}
```

加入 `RelayMessage` 联合类型。

### 2. relay 房间逻辑（relay/src/room.ts）

#### Room 接口扩展

```typescript
interface Room {
  id: string;
  inviteCode: string;
  members: Map<string, Member>;
  emptySince: number | null;
  destroyTimer: ReturnType<typeof setTimeout> | null;
  // 新增
  enforceViewOnce: boolean;
  creatorMemberId: string | null;  // 创建者 = 第一个 join 的人
}
```

- `createRoom()` 仍是 HTTP API，返回邀请码；不在此指定 enforceViewOnce（保持创建者通过 join 携带）。
- `handleJoin()`：
  - 若 `room.creatorMemberId === null` 且 `state.member` 是首个加入者 → 设为创建者；若 `msg.enforceViewOnce === true` 则 `room.enforceViewOnce = true`。
  - 后续 join 忽略 `msg.enforceViewOnce` 字段（只有创建者首次 join 生效）。
  - `RoomJoined` 回包中带 `enforceViewOnce` 和 `isCreator`。
- 新增 `handleSetViewOnce(ws, msg)`：
  - 校验 `state.member.id === room.creatorMemberId`，否则发 `room.error` "only creator can toggle"。
  - 更新 `room.enforceViewOnce = msg.enforce`。
  - 广播 `room.view-once-changed` 给房间所有成员（含创建者自己，用于 UI 状态同步）。

### 3. client / desktop UI 调整

#### RoomsPage.tsx（两套保持一致）

- RoomChat 接收 `RoomJoined` 时记录 `enforceViewOnce` 和 `isCreator` 到 state。
- 接收 `room.view-once-changed` 事件 → 更新 `enforceViewOnce` state。
- 输入区：
  - `enforceViewOnce === true`：🔒 按钮隐藏/禁用（强制开启），所有发送调用强制 `viewOnce: true`。
  - `enforceViewOnce === false`：保留现有 🔒 按钮（用户仍可单条切）。
- 房间头部新增"阅后即焚"开关（仅 `isCreator === true` 可见可点）：
  - Toggle 组件，显示当前 `enforceViewOnce` 状态。
  - 点击 → 调 `roomSetViewOnce(!enforceViewOnce)`。
- 消息渲染：
  - `enforceViewOnce === false` 且 `viewOnce === false`（普通消息）：
    - 接收方：直接显示消息内容。
    - **新增**：接收方首次渲染该消息时（或在 viewport 可见时）调 `replyViewed(messageId)`，发送方收到后 UI 标记"已读"。
    - 发送方：UI 显示"未读"→"已读"状态标记（灰色小字）。
  - `viewOnce === true`（房间开启时强制或发送者手动）：
    - 接收方：显示"🔒 阅后即焚消息 — 点击查看"。点击后：
      1. 解码并展示内容
      2. 立即调 `replyViewed(messageId)`
      3. **从接收方 messages state 中移除该条**（真焚）
      4. 关闭查看弹层
    - 发送方：收到 `message-viewed` 后把消息标记为"已查看"占位（保留条目，显示"✓ 已查看"）。

### 4. 已读状态去重

- 接收方对每条消息只回执一次 `room.message-viewed`：用 `Set<messageId>` 记录已回执的 id。
- 发送方收到回执后用 `messageId` 去重，避免重复标记。

### 5. 兼容性

- 旧版客户端（未携带 `enforceViewOnce`）join 时，relay 把 `enforceViewOnce` 默认为 `false`，行为与现在一致。
- 旧版客户端收到 `RoomJoined` 多出的 `enforceViewOnce` / `isCreator` 字段会忽略（JSON 解析不报错）。
- 旧版客户端不识别 `room.view-once-changed` 事件，会在 onRoomEvent 的 switch 里落入 default 分支忽略——但会导致旧客户端与房间状态不一致。建议在部署文档里提示"创建者与成员都需更新到新版本"。

## 涉及文件

| 文件 | 改动 |
| --- | --- |
| `relay/src/protocol.ts` | `RoomJoin` / `RoomJoined` 加字段；新增 `RoomSetViewOnce` / `RoomViewOnceChanged` |
| `relay/src/room.ts` | `Room` 加 `enforceViewOnce` / `creatorMemberId`；`handleJoin` 初始化创建者；新增 `handleSetViewOnce` |
| `client/src/protocol.ts` | 同步协议字段与新事件类型 |
| `client/src/lib/roomConnection.ts` | `joinRoom` 携带 `enforceViewOnce`（仅创建者首次）；新增 `roomSetViewOnce()`；事件分发 `view-once-changed`；消息已读回执去重 |
| `client/src/pages/RoomsPage.tsx` | 房间头加创建者开关；强制 viewOnce；真焚逻辑；普通消息已读回执 |
| `apps/desktop/src/main/relay-protocol.ts` | 同步协议 |
| `apps/desktop/src/main/roomPeer.ts` | 同 client 侧 roomConnection 改动 |
| `apps/desktop/src/main/ipc.ts` | 新增 `room-set-view-once` IPC |
| `apps/desktop/src/renderer/lib/electron.ts` | 暴露 `roomSetViewOnce` |
| `apps/desktop/src/renderer/app/routes/RoomsPage.tsx` | 同 client 侧 RoomsPage 改动 |

## 验证状态

- [x] 创建者创建房间后，房内切换「阅后即焚」开关 → 房间内所有消息都是 viewOnce（浏览器双标签页验证）
- [x] 创建者中途切换开关 → 所有成员实时收到 `view-once-changed`，UI 立即响应（成员端 placeholder 与 🔒 按钮同步）
- [x] 非创建者看不到/无法操作开关（成员端无开关 UI；relay 侧有 `creatorMemberId` 校验回 `room.error`）
- [x] 接收方查看 viewOnce 消息 → 立即从其列表移除（真焚）；发送方显示"已查看"（双标签页验证）
- [x] 房间关闭模式 → 普通消息直接显示；接收方查看后发送方显示"已读"（双标签页验证）
- [x] 接收方刷新页面/重连 → 已读回执不会重复发送（client 端 `ackedRef` 去重；desktop 端 viewOnce 回执去重本次补齐）
