# 会话分享：创建者离开启动 24h 倒计时

## 背景

当前 relay 的房间销毁时机是「**最后一个成员**离开后 24h」(`relay/src/room.ts` 的
`removeMember` 在 `members.size === 0` 时启动 TTL)。用户反馈：房间是创建者的，
**创建者离开不应销毁**——确切策略为：创建者离开即启动 24h 倒计时（无论房间内是否
还有成员），倒计时显示在聊天空间顶部；创建者重新加入则取消倒计时，房间继续存活。

## 目标

- 创建者离开 → 启动 24h 倒计时，房间内所有成员可见（聊天空间顶部）。
- 创建者重新加入 → 取消倒计时，房间继续存活。
- 倒计时到期 → 房间销毁，剩余成员收到明确通知并返回列表。
- 普通成员离开不再影响房间生命周期（创建者在则房间永存）。
- 客户端（client + desktop）显示倒计时（实时刷新），收到销毁通知后自动返回列表。

## 设计

### 1. 生命周期语义变更（relay/src/room.ts）

`Room` 接口变更：

```typescript
interface Room {
  id: string;
  inviteCode: string;
  members: Map<string, Member>;
  emptySince: number | null;        // 保留（兼容旧逻辑判断）
  destroyTimer: ReturnType<typeof setTimeout> | null;
  /** 倒计时截止时间戳（ms）。null = 无倒计时（创建者在场）。 */
  destroyExpiresAt: number | null;
  enforceViewOnce: boolean;
  creatorMemberId: string | null;
}
```

**触发与取消**：

| 事件 | 行为 |
|---|---|
| 创建者离开（`removeMember`，`member.id === room.creatorMemberId`） | 若 `destroyTimer` 未启动：`destroyExpiresAt = Date.now() + EMPTY_TTL_MS`，调度定时器；向房间广播 `room.destroy-countdown` |
| 创建者重新加入（`handleJoin`，`room.creatorMemberId === null` 且原创建者回来） | 取消定时器，`destroyExpiresAt = null`；广播 `room.destroy-countdown { expiresAt: null }` |
| 普通成员离开/加入 | 不影响倒计时（不启动、不取消、不重置） |
| 倒计时到期 | 复查 `destroyExpiresAt` 未变 → 销毁房间，向剩余成员广播 `room.destroyed` |

**创建者识别**：创建者 = 首个 join 的成员，`creatorMemberId` 记录其 memberId。
创建者离开后该字段保留（房间仍在倒计时存续期内），原创建者凭 memberId 重新 join
即视为「创建者回来」，取消倒计时。

**与旧逻辑的兼容**：原「最后一个成员离开启动 TTL」逻辑废弃，改为「创建者离开启动」。
若房间在创建者离开后仍有成员，倒计时到期时房间销毁，剩余成员被踢出（收到
`room.destroyed`）。

### 2. 协议扩展（relay / client / desktop 三处同步）

`relay/src/protocol.ts`（同步到 `client/src/protocol.ts`、
`apps/desktop/src/main/relay-protocol.ts`）：

```typescript
// RoomJoined 增加字段：当前倒计时截止时间戳（ms），null = 无倒计时
interface RoomJoined {
  type: "room.joined";
  roomId: string;
  inviteCode: string;
  members: RoomMember[];
  enforceViewOnce: boolean;
  isCreator: boolean;
  destroyExpiresAt: number | null;   // 新增
}

/** Relay → 房间全员：倒计时状态变更。expiresAt = null 表示已取消。 */
export interface RoomDestroyCountdown {
  type: "room.destroy-countdown";
  expiresAt: number | null;
}

/** Relay → 房间全员：房间已销毁（倒计时到期）。 */
export interface RoomDestroyed {
  type: "room.destroyed";
}
```

加入 `RelayMessage` 联合类型。

### 3. client / desktop UI

#### roomConnection.ts / roomPeer.ts

- `joinRoom` 回包（`room.joined`）携带 `destroyExpiresAt` → 分发到事件 `joined`。
- 新增事件分发：`room.destroy-countdown` → `{ type: "destroy-countdown", expiresAt }`；
  `room.destroyed` → `{ type: "destroyed" }`。

#### RoomsPage.tsx（client + desktop）

- RoomChat state 增加 `destroyExpiresAt: number | null`。
- 顶部（房间 header 下方）倒计时条：`destroyExpiresAt !== null` 时显示
  「⚠️ 创建者已离开，房间将在 HH:MM:SS 后销毁」；每秒 tick 刷新剩余时间；
  `expiresAt` 过去 → 隐藏（等待 destroyed 事件）。
- 收到 `destroy-countdown` → 更新 `destroyExpiresAt`（含 null 取消）。
- 收到 `destroyed` → 复用「自动返回列表」路径：显示错误/提示后
  `onLeave("房间已销毁")` 返回列表（与 20260816-03 的自动返回逻辑一致）。

### 4. 兼容性

- 旧版客户端不识别 `destroy-countdown` / `destroyed` 事件 → 落入 onRoomEvent 的
  default 分支忽略，房间照常使用（只是看不到倒计时、销毁时无自动返回）。
- `RoomJoined.destroyExpiresAt` 缺失时客户端按 null 处理（无倒计时），行为不变。

## 涉及文件

| 文件 | 改动 |
| --- | --- |
| `relay/src/room.ts` | Room 加 `destroyExpiresAt`；`removeMember` 改为创建者离开触发倒计时；`handleJoin` 创建者回来取消；新增 `handleDestroyed` 广播；`destroyRoom` 通知剩余成员 |
| `relay/src/protocol.ts` | `RoomJoined` 加字段；新增 `RoomDestroyCountdown` / `RoomDestroyed` |
| `client/src/protocol.ts` | 同步协议 |
| `client/src/lib/roomConnection.ts` | `joined` 事件带 `destroyExpiresAt`；分发两个新事件 |
| `client/src/pages/RoomsPage.tsx` | 倒计时条 UI + 每秒 tick；`destroyed` 自动返回列表 |
| `apps/desktop/src/main/relay-protocol.ts` | 同步协议 |
| `apps/desktop/src/main/roomPeer.ts` | 同 client roomConnection 改动 |
| `apps/desktop/src/renderer/app/routes/RoomsPage.tsx` | 同 client RoomsPage 改动 |

## 验证状态

- [x] relay typecheck + 既有测试通过（22 个）
- [x] client / desktop typecheck + build 通过
- [x] 双标签页浏览器验证：
  - [x] 创建者离开（退出按钮）→ 成员端顶部出现倒计时条，时间逐秒递减（23:59:58 → 23:59:51）
  - [x] 创建者重新加入 → 成员端倒计时条消失，创建者恢复 isCreator（🔓 开关回来）
  - [x] 普通成员离开 → 无倒计时（创建者仍在场）
  - [ ] 倒计时期间新成员加入 → 能看到当前倒计时（逻辑：`RoomJoined.destroyExpiresAt` 携带；需真机验证）
  - [ ] 手动触发销毁（缩短 TTL 或直接删房间）→ 成员收到提示并自动返回列表（`room.destroyed` 路径已实现；24h 时长需真机等待验证）
