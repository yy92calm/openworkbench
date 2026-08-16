# 会话分享：会话列表 + 空房 TTL + 输入框修复

## 背景

会话分享功能在联调中暴露三个问题：

1. **会话分享页没有"会话列表"**：用户只能选择"创建会话"或"加入会话"，看不到自己最近参与过的会话，每次都要重新输入邀请码。期望：本地保留最近会话，点列表条目直接进入。
2. **空房立即销毁**：当前 `relay/src/room.ts` 在最后一个成员离开时立即销毁房间，导致刷新页面、临时断网都会让会话不可恢复。期望：最后一个成员离开后保留 24 小时，期间任何成员重新加入则取消销毁。
3. **client 进入会话后看不到输入框**：`RoomChat` 根 div 用 `height: "100dvh"`，而它在 `<div className="tab-content">`（`flex:1; overflow-y:auto`）里，`100dvh` 比父容器实际可用高度更高（因为还有 DeviceBar 和 TabBar），导致 input bar 被推到 tab-content 滚动区域之外，看不见。

## 目标

- 会话分享页提供"最近会话"列表，列出本机参与过的会话；点击条目直接进入。
- relay 端空房保留 24h，新成员加入即取消销毁；过期后才真正销毁。
- client 端 RoomChat 不再使用 `100dvh`，输入框始终可见。

## 设计

### 1. 会话列表（client + desktop）

**存储**：localStorage，key `workbench.rooms.recent`，结构：

```typescript
interface RecentRoom {
  inviteCode: string;       // 6 位邀请码
  nickname: string;         // 我加入时用的昵称
  joinedAt: number;         // 首次加入时间戳（ms）
  lastVisitedAt: number;   // 最近一次进入时间戳（ms）
}
```

- 数组按 `lastVisitedAt` 倒序，最多保留 20 条。
- 写入时机：`createRoom` 成功后；`joinRoom` 成功后（即收到 `room.joined` 事件）。
- 清理时机：列表项提供"删除"按钮（仅清本地记录，不影响 relay 上的房间）。

**列表 UI**（client 端 `RoomsPage.tsx`）：

- `phase === "list"` 阶段，在"创建会话/加入会话"按钮下方新增"最近会话"区块。
- 每条目显示：邀请码（大号等宽字体）+ 上次访问时间（"刚刚 / N 分钟前 / N 小时前 / N 天前"）。
- 点击条目 → 直接 `setInviteCode(code); setPhase("in-room")`（走与"加入"相同的进入路径，但跳过校验）。
- 条目右侧"删除"小图标 → 从 localStorage 移除。

**desktop 端**（`apps/desktop/src/renderer/app/routes/RoomsPage.tsx`）：同步加上同样的列表，存储用同一 key `workbench.rooms.recent`（但 desktop 的 nickname 存在 `workbench.host.nickname`，不混用）。client 与 desktop 各自维护本机的列表。

**校验**：进入会话时不再预先调 `validateInvite`，直接 `setPhase("in-room")`。若会话已销毁，relay 会回 `room.error`，UI 显示错误提示并自动返回列表。

### 2. relay 空房 24h TTL

**改动文件**：`relay/src/room.ts`

**Room 接口扩展**：

```typescript
interface Room {
  id: string;
  inviteCode: string;
  members: Map<string, Member>;
  /** 最后一个成员离开的时间戳（ms）。null 表示当前有成员或房间未被创建为空过。 */
  emptySince: number | null;
}
```

**修改逻辑**：

- `createRoom()`：初始化 `emptySince: null`。
- `handleJoin()`：成功加入后 `room.emptySince = null`（取消销毁）。
- `removeMember()`：当 `members.size === 0` 时，**不再立即销毁**，改为 `room.emptySince = Date.now()`，并调度一个 setTimeout 在 24h 后真正销毁该房间。
- 新增 `destroyRoom(room)`：执行原来"销毁房间"的清理逻辑（删除 `rooms` / `roomsById` / 关联 files）。
- `destroyRoom` 在被调用前先检查：若 `emptySince` 已被重置为 null（表示有新成员加入），则跳过；若 `emptySince` 仍为旧值且超过 24h，则销毁。
- 启动时为空（重启即清空，与原设计一致）。

**定时器**：每个房间一个 `setTimeout(24h)`，回调内再次检查 `emptySince` 后销毁。房间销毁时若定时器未触发，先 `clearTimeout`。

### 3. RoomChat 输入框修复（client）

**改动文件**：`client/src/pages/RoomsPage.tsx`

- 根 div 从 `height: "100dvh"` 改为 `height: "100%"`。
- 父 `.tab-content` 已有 `flex:1`，能正确分配剩余高度。
- input bar 保持 `flex-shrink: 0`，messages 区 `flex:1; overflow-y:auto`，确保 input bar 永远可见。

## 涉及文件

| 文件 | 改动 |
| --- | --- |
| `relay/src/room.ts` | Room 加 `emptySince`；`removeMember` 改为标记空房并调度 24h 销毁；新增 `destroyRoom` |
| `client/src/pages/RoomsPage.tsx` | 加"最近会话"列表 UI + localStorage；根 div `100dvh → 100%` |
| `client/src/lib/roomConnection.ts` | 新增 `recordRecentRoom(inviteCode, nickname)` / `loadRecentRooms()` / `removeRecentRoom(code)` helper |
| `apps/desktop/src/renderer/app/routes/RoomsPage.tsx` | 同步加"最近会话"列表 |

## 验证状态

- [x] relay 重启后房间仍为空（重启不保留房间；已用重启 relay 验证 join 已销毁房间返回 `room.error`）
- [ ] 空房 24h 内被重新加入，不会销毁（逻辑已实现：`emptySince` + `destroyTimer` 复查；24h 时长需真机等待验证）
- [ ] 空房超过 24h，定时器触发销毁；后续 `validateInvite` 返回 `valid:false`（同上，需真机等待验证）
- [x] client 创建/加入会话后，列表出现该条目
- [x] client 进入会话后输入框可见
- [x] 点击列表条目能直接进入会话；删除条目不影响 relay
- [x] 进入已销毁房间（从最近列表）：relay 回 `room.error` → 显示错误 1.5s → 自动返回列表并展示错误（本次补齐）
