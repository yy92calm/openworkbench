# Relay 跨账号群聊通知方案

> 在 relay 上新增「房间（room）」概念：任一 client 生成邀请码，其他 client
> 凭码加入同一房间，房间内的消息由 relay 在内存中路由给所有在线成员。
> 消息**完全不经过 host / sidecar**，**不写入任何持久化存储**——这是与
> OpenCode 会话历史的根本区别。适用于多人协作中的临时通知、状态广播、
> 求助等场景。

## 背景

当前 relay 是「账号隔离的设备转发层」：
- `accounts` Map：`token → Set<device>`，不同 token 完全隔离
- relay 只做 host/guest 之间的字节转发，自身不存储消息内容
- 所有持久化都在 host 侧（OpenCode sidecar 写 JSONL 会话历史）

跨账号通信意味着 relay 需要新增「跨账号路由能力」。但用户明确要求消息
**不保留在历史记录里**——这正好与 relay 现状契合：只要消息不走 sidecar
HTTP API，就不会进会话历史。所以本方案的核心是：**在 relay 上开辟一条
独立于 host/sidecar 的纯内存消息通道**。

## 设计

### 角色与数据流

```
client A (token-A)          host (token-H)          client B (token-B)
     │                            │                        │
     │  1. WS 连接 relay（role=peer, invite=<code>）        │
     │ ────────────────────────────────────────────────────▶│
     │                            │                        │
     │  2. relay 校验邀请码，把 A/H/B 加入同一 room          │
     │                            │                        │
     │  3. 任一成员发消息 → relay 内存路由 → 其他成员收到    │
     │ ◀───────────────────────────────────────────────────▶│
     │                            │                        │
     │  4. 任一方断开，relay 从 room 移除；消息不补发        │
```

**host 也作为 room 成员**：host 用独立的 `role=peer` 连接进 room，
与它的 `role=host` 请求转发通道完全隔离。详见「host 加入 room」。

**关键约束**：
- 消息**只走 relay 内存**，不落盘，不经过 host
- **新加入成员看不到加入前的历史消息**——加入时刻起才能收到新消息
- **离线期间发的消息永久丢失**——重新上线后不会补发，因为 relay 根本没存
- **页面刷新后看不到刷新前的消息**——client 端也不持久化，且 E2E 密钥已销毁
- 房间在所有成员退出后自动销毁

> 这三条是"完全不保留"的直接代价。如果业务上不能接受，需要重新评估
> 是否做离线存储（与方案核心原则冲突，不建议）。

### 成员退出与异常处理

peer 连接比 host/guest 更脆弱——client 可能在地铁里、锁屏、切换
WiFi、进电梯。退出判定必须覆盖以下场景：

| 场景 | 触发信号 | relay 行为 |
| --- | --- | --- |
| **主动退出** | client 发 `room.leave` 后 `ws.close(1000)` | 同步移除成员，广播 `room.member-left` |
| **页面关闭/刷新** | 浏览器触发 `ws.close(1001)` 或直接 `terminate` | 同上 |
| **网络瞬断**（切 WiFi、进电梯） | TCP 未立即感知，ping/pong 超时 | 心跳 2 个周期后 terminate，再移除 |
| **休眠/合盖** | 系统挂起，TCP 不发 FIN | 同上，心跳超时清理 |
| **进程崩溃** | 无 FIN，无 RST | 同上 |
| **relay 重启** | 所有 WS 断开 | client 侧检测到 close 后自动重连，重新 `room.join` |
| **client 重连但 ID 变化** | 重新 join 时 relay 分配新 `Member.id` | 旧 ID 自然超时清理；其他成员看到「旧成员离开 + 新成员加入」 |

#### 心跳策略

peer 连接**不能复用** relay 现有 `pingAll()` 的 30s 周期——那会影响
host/guest 的断开检测（host 断开后 client 要等 6 分钟才知道，请求会
卡死）。peer 用**独立的心跳周期**：

| 连接类型 | 心跳周期 | 断开检测耗时 | 理由 |
| --- | --- | --- | --- |
| host / guest | 30s（现有） | 60-90s | 请求转发要快速感知断开 |
| peer | 3min | 6-7min | 群聊场景容忍慢检测；降低 relay 负载 |

**peer 心跳实现**：

在 `pingAll()` 中按连接角色分流：
- host/guest：保持现有 30s 逻辑
- peer：每 6 个周期（≈3min）才 ping 一次，连续 2 次无 pong 才 terminate

**为什么 peer 可以 3 分钟**：
- 群聊是通知场景，不是实时通话——6 分钟才发现"某人离开了"可接受
- 消息发不到离线成员本来就会丢（无离线存储），早晚发现区别不大
- peer 数量可能远多于 host/guest（一个 relay 可能几十个 room × 多人），3 分钟周期显著降低 relay CPU 与带宽

**代价**：
- 幽灵成员最多存活 6-7 分钟（期间发的消息对该成员无效）
- 其他成员在这 6-7 分钟内仍以为对方在线
- 如果未来发现幽灵问题严重，可缩短到 1-2 分钟

#### client 端重连

client 侧（[connection.ts](../../client/src/lib/connection.ts) 现有逻辑）检测到
WS close 后自动重连，重连成功后重新发 `room.join`：

| 情况 | 行为 |
| --- | --- |
| 短暂断开（< 5s） | 重连 → `room.join` → relay 分配新 `Member.id` → 其他成员收到 `member-left` + `member-joined` |
| 长时间断开 | 同上；但**断开期间其他成员发的消息永久丢失**，relay 没存，重连后不补发 |
| 邀请码已失效（room 销毁） | `room.join` 返回 `room.error: "room not found"` → client UI 提示「房间已解散」 |

**Member.id 不复用**——每次 join 都分配新 ID。这简化了状态机：relay
不需要维护「同一个 client 的多次连接」。代价是其他成员会看到"某人
离开后又加入"，但这是"完全不持久化"的必然结果。

#### relay 重启的容错

relay 重启会清空所有 room（内存数据结构）。client 侧需要处理：

1. 检测 WS close（relay 重启会断开所有连接）
2. 自动重连（现有逻辑）
3. 重连后重新 `room.join`——但邀请码已失效（room 没了）
4. client UI 提示「房间已解散，需重新创建或加入」

**不做 relay 持久化**——与"relay 纯转发"原则一致。relay 重启 = 所有
room 解散，这是已知代价。

#### 防止「幽灵成员」

如果一个 client 网络极差（ping/pong 都发不出但 TCP 没断开），可能
出现「relay 认为还在，但消息发不到」的幽灵状态。缓解：

- **发送方 ack**：发送 `room.message` 后等待所有在线成员的 `message-received`
  回执（非阅后即焚场景）。超时未收到回执的成员标记为「疑似离线」
- **但这会增加复杂度**，**默认不做**——心跳超时已经足够清理幽灵成员
- 如果未来发现幽灵问题严重，再加 ack 机制

### 邀请码与房间生命周期

| 阶段 | 行为 |
| --- | --- |
| 生成 | 任一 client 调用 `POST /__relay/rooms` 生成邀请码（6-8 位随机字符串） |
| 加入 | 其他 client 用 `?role=peer&invite=<code>` 连接 relay WS |
| 多人 | 同一邀请码可被多人使用，形成群聊（无人数硬上限，建议 ≤50） |
| 退出 | client 主动断开或心跳超时，relay 从 room 移除该成员（详见下方「成员退出与异常处理」） |
| 销毁 | room 最后一个成员退出后，relay 删除 room 与邀请码 |

邀请码**不过期**——只要 room 还活着就能用；room 销毁后邀请码失效。
生成者无特权（不能踢人、不能关闭房间），简化模型。

### 协议扩展

#### 1. HTTP 接口（client → relay）

| 路径 | 方法 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- | --- |
| `POST /__relay/rooms` | POST | `{ name?: string }` | `{ inviteCode, roomId }` | 生成新房间 |
| `GET /__relay/rooms/:code` | GET | — | `{ valid, memberCount }` | 校验邀请码（加入前探测） |

这些接口直接由 relay 处理，**不转发到 host**。

#### 2. WS 消息（client ↔ relay）

新增 `role=peer` 连接类型，query 参数 `?role=peer&invite=<code>`。

```typescript
// client → relay
{ type: "room.join", inviteCode: string, nickname?: string }
{ type: "room.message", text: string }
{ type: "room.leave" }

// relay → client
{ type: "room.joined", roomId: string, inviteCode: string, members: Member[] }
{ type: "room.member-joined", member: Member }
{ type: "room.member-left", memberId: string }
{ type: "room.message", from: Member, text: string, at: number }
{ type: "room.error", message: string }
```

`Member = { id: string, nickname?: string, pubKey?: string }`，`id` 由 relay
分配（随机），**不暴露 token、device 等账号信息**。`pubKey` 是该成员的
E2E 加密公钥（见下文）。

### E2E 加密（端到端）

**目标**：relay 作为中转节点也无法解密消息内容，只有房间内的成员能读。
消息**仍然不持久化**——加密只保护传输与内存暂存期间不被 relay 窥探。

#### 密钥协商

采用 **X3DH-lite**（简化版 X25519 + 一次性预共享）：

| 步骤 | 行为 |
| --- | --- |
| 1. 创建房间 | 创建者生成 X25519 静态密钥对 `(sk_A, pk_A)`，公钥随邀请码一起返回 |
| 2. 加入房间 | 加入者生成 `(sk_B, pk_B)`，`room.join` 时携带 `pk_B` |
| 3. 广播公钥 | relay 把新成员的 `pk_B` 广播给现有成员；把现有成员的公钥列表回给新成员 |
| 4. 派生会话密钥 | 每个成员对房间内每个其他成员执行 X25519 DH：`K_ij = X25519(sk_i, pk_j)`，用 HKDF-SHA256 派生 per-pair 密钥 |
| 5. 消息加密 | 发送者对每个接收者用其 `K_ij` 通过 XChaCha20-Poly1305 加密同一明文，生成 N 份密文（N = 房间成员数 - 1） |

**为什么不复用一个房间级共享密钥**：
- 共享密钥要求所有成员都参与 DH 轮换，新成员加入时需要全员重新协商
- per-pair 密钥支持成员动态进出——新成员加入只需自己与现有成员各做一次 DH

#### 消息格式

```typescript
// client → relay（密文）
{
  type: "room.message",
  ciphertexts: Array<{ to: string; nonce: string; ct: string }>,
  at: number,
}
// relay → client（按 to 字段路由，只发对应成员的那一份）
{
  type: "room.message",
  from: Member,
  nonce: string,
  ct: string,
  at: number,
}
```

- relay 只看到 `from` + 一组 `{ to, nonce, ct }`，无法解密 `ct`
- relay 按 `to` 字段把对应密文分发给目标成员
- 接收者用 `K_ji = X25519(sk_j, pk_i)` 解密

#### 加密库

Web Crypto API 原生支持 ECDH（P-256），但 X25519 + XChaCha20 在浏览器
中需要 `libsodium-wrappers`（约 130KB gzip）。建议用 `@noble/curves`
的 X25519 + `@noble/ciphers` 的 XChaCha20-Poly1305，tree-shake 后约 30KB。

#### 密钥生命周期

- 密钥对**仅在内存**，页面刷新即销毁（与"不保存"原则一致）
- 刷新后重新加入房间，生成新密钥对——**看不到刷新前的消息**（因为旧密钥没了）
- relay 不存储任何公钥——成员退出后其公钥从房间广播列表移除

#### 阅后即焚（view-once）

**目标**：消息在接收方查看一次后立即从 UI 与内存中销毁，发送方收到
查看回执后也从自己 UI 移除。**relay 侧本就不存消息**，所以阅后即焚
只影响 client 端的 UI 状态。

**协议扩展**：

```typescript
// 发送方在 room.message 上加 viewOnce 标记
{ type: "room.message", ciphertexts: [...], viewOnce: true, at: number }

// 接收方查看后回执
{ type: "room.message-viewed", messageId: string }
// relay 转发给发送方；发送方收到后从自己 UI 删除该消息
```

`messageId` 由发送方生成（UUID），随密文一起发。

**client 端 UX**：

1. **未查看状态**：消息以卡片形式显示「 🔒 阅后即焚消息 - 点击查看」
2. **查看动作**：点击 → 解密 → 全屏模态展示文本 → 关闭即销毁
3. **销毁范围**：
   - 从 React state 中移除（`messages.filter(m => m.id !== id)`）
   - 解密后的明文**不写入任何变量**——只在模态组件的局部 state 中短暂存在
   - 模态关闭时局部 state 自动 GC
4. **发送方回执**：收到 `message-viewed` 后从自己 messages 列表移除

**防复制措施（软性阻碍，非绝对）**：

| 措施 | 实现 | 有效性 |
| --- | --- | --- |
| 禁止文本选择 | CSS `user-select: none` on 模态 | 阻止鼠标选择，不阻止截屏 |
| 拦截 copy 事件 | `addEventListener('copy', e => e.preventDefault())` | 阻止 Ctrl+C，不阻止截屏 |
| 拦截 context menu | `oncontextmenu = e => e.preventDefault()` | 阻止右键菜单，不阻止截屏 |
| 防截屏 API | 浏览器无此能力 | 无法实现 |
| 水印 | 模态背景显示查看者 `Member.id` 后 4 位 | 物理拍摄后可追溯泄露源 |

**关键现实约束**：

> **浏览器环境无法实现真正的"阅后即焚"**。用户可以：
> - 截屏（PrintScreen / 系统截图工具）
> - 拍照（手机拍摄屏幕）
> - 录屏
> - 开发者工具在销毁前抓取 DOM
>
> 本方案的阅后即焚只能保证：
> - 消息**不持久化**（刷新即丢，与"不保存"原则一致）
> - 查看**后**从 UI 移除（无法反复查看）
> - 阻止**常规复制操作**（鼠标选择、Ctrl+C、右键）
>
> 它防的是"无意留存"和"懒人翻历史"，**防不了"有意留存"**。
> 需要在 UI 上明确告知用户这一点。

**与 E2E 加密的关系**：

- E2E 加密保护**传输与 relay 侧**——relay 看不到明文
- 阅后即焚保护**client 侧查看后**——明文从 UI 与内存移除
- 两者正交，可叠加：一条消息可以 `viewOnce: true` 且走 E2E 加密

### 安全性

| 风险 | 缓解 |
| --- | --- |
| 邀请码被爆破 | 6-8 位 base32，熵约 30-40 bit；relay 限速（同 IP 10 次/分钟） |
| 账号信息泄露 | `Member.id` 是 relay 随机分配，与 token/device 无关联 |
| 消息被 host 截获 | 消息流完全独立于 host WS，host 看不到 room 消息 |
| 消息被 relay 窥探 | E2E 加密——relay 只看到密文与路由元数据，无法解密 |
| 消息留存 | relay 只在内存中暂存「待路由」密文，路由完成立即释放；不写日志 |
| 阅后即焚消息被留存 | client 端查看后立即从 UI 与内存移除；阻止常规复制；但浏览器无法防截屏/拍照 |
| 中间人替换公钥 | 邀请码本身作为带外预共享——创建者拿到 `pk_A` 时与邀请码绑定，加入者用同一邀请码即为信任锚 |
| 恶意邀请码滥用 | 邀请码与 room 绑定，room 销毁即失效；生成者可主动 leave 触发销毁 |

### host 加入 room

host 也可以作为 room 的成员参与聊天——这样 workbench 桌面端用户能
直接与远程 client 用户在同一个房间里沟通，不需要切换设备。

#### 连接方式

host 用**独立的 `role=peer` 连接**进 room，与它已有的 `role=host`
请求转发通道完全隔离：

| 连接 | 用途 | 协议 |
| --- | --- | --- |
| `role=host`（现有） | client → host 的 OpenCode HTTP 请求转发 | host WS，不走 room 协议 |
| `role=peer`（新增） | host 作为 room 成员收发消息 | peer WS，与 client 完全对等 |

**为什么不复用 host WS**：
- host WS 是请求-响应模型（client 发 HTTP 请求，host 返回响应），混入
  room 的广播消息会让协议变复杂
- 隔离后，host 端的 room 逻辑可以独立演进，不影响请求转发稳定性
- 多一条 WS 连接的代价可忽略

#### host 端实现

在 [relayHost.ts](../../apps/desktop/src/main/relayHost.ts) 之外新增
`roomPeer.ts`，管理 host 的 peer 连接：

- 复用 host 现有的 relay 配置（`relayUrl`、`token`、`deviceId`）
- host 启动时不自动进 room——用户在 UI 上主动「加入房间」才连接
- host 端同样生成 X25519 密钥对，参与 E2E 加密
- host 端消息**不写 OpenCode 会话历史**——room 消息与 agent 会话完全隔离

#### host 端 UI

在 workbench 桌面端新增「房间」入口（侧边栏或顶部栏图标）：

1. **房间列表**：显示已加入的房间 + 「创建房间」「加入房间」
2. **房间页**：消息列表 + 输入框（与 client 端 UI 对称）
3. **创建/加入**：与 client 端流程一致

**与 client 端 UI 的差异**：
- host 端是 Electron 原生窗口，不受浏览器限制——但仍不做持久化
  （与"完全不保留"原则一致）
- host 端可以拖拽文件到输入框，但**只显示文件名**——文件传输仍走
  `/__host/deliveries`（见 [20260815-15](./20260815-15-host-to-client-offline-files.md)），
  不通过 room 传文件内容

#### host 离线的影响

host 离线时：
- 它在 room 里的成员身份超时清理（与 client 一样的 3 分钟心跳逻辑）
- 期间其他成员发的消息 host **永久收不到**（无离线存储）
- host 重新上线后需要手动重新加入房间（不自动重连进 room）

**为什么不自动重连进 room**：
- host 重启可能是用户主动行为（切换工作区、重启应用）
- 自动重连可能让用户困惑"为什么又进了一个房间"
- 用户主动重新加入更符合预期

#### 与 OpenCode 会话的关系

| 维度 | room 消息 | OpenCode 会话 |
| --- | --- | --- |
| 存储 | 不持久化 | JSONL 持久化 |
| 通道 | peer WS（role=peer） | host WS（role=host）转发到 sidecar |
| 参与方 | host 用户 + 多个 client 用户 | host 用户 + agent |
| agent 可见性 | 不可见 | 可见 |

**room 消息不会注入 agent 会话**——这是"不污染历史"的核心保证。
如果未来想让 agent 看到 room 消息（如"把这条通知总结进会话"），
需要用户显式操作（如点击「发送到会话」按钮），由 host 端主动调
`sendPrompt` 把内容发给 agent——这是显式行为，不是自动注入。

### client 端 UI

新增「通知」Tab（第 5 个 Tab），栈式路由：

1. **房间列表页**：显示已加入的房间 + 「创建房间」「加入房间」按钮
2. **房间页**：消息列表（仅当前会话可见，刷新即清空）+ 输入框
3. **创建房间页**：可选填名称 → 生成邀请码 → 显示可复制的邀请码
4. **加入房间页**：输入邀请码 → 校验 → 加入

**关键 UX 决策**：
- 消息列表**不持久化**——client 端也不存 localStorage，刷新页面即清空
- **新成员加入时，UI 顶部显示「你已加入房间，仅能看到加入后的新消息」提示**——避免用户困惑"为什么没有历史"
- **重连后若期间有消息丢失，不提示"X 条未读"**——因为根本不知道有多少条
- 不显示已读/未读，不做消息回执（简化）
- 昵称在加入时一次性填写，可空（默认「匿名用户」）

### 不做的事

- **不做离线消息存储**：离线成员、新加入成员、刷新页面的用户都看不到历史消息，这是"完全不保留"的代价
- **不做文件传输**：只支持文本消息，文件仍走 host 侧 sidecar
- **不做与 OpenCode 会话的打通**：room 消息不会注入到任何 agent 会话

## 验证状态

**状态：未实施**

### 待验证项

- [ ] relay `room` 数据结构设计是否足够（成员列表 + 邀请码映射 + 公钥广播）
- [ ] WS 心跳复用现有 `pingAll` 逻辑是否可行（peer 连接也需要心跳）
- [ ] peer 3 分钟心跳周期下，6-7 分钟的离线检测延迟在真实移动网络下是否可接受
- [ ] relay 重启后 client 的「房间已解散」提示 UX 是否清晰
- [ ] Member.id 不复用导致「离开又加入」的 UX 是否会让其他成员困惑
- [ ] client 端「完全不持久化」的 UX 是否可接受（刷新即丢消息与密钥）
- [ ] 邀请码熵与限速策略是否足够防爆破
- [ ] 与现有 host/guest 连接的隔离是否彻底（不互相干扰）
- [ ] `@noble/curves` + `@noble/ciphers` 在 Vite 构建下的体积与兼容性
- [ ] per-pair 密钥方案在成员频繁进出时的密钥管理开销
- [ ] 阅后即焚的 `message-viewed` 回执在接收方查看后立即断线的处理（发送方收不到回执，消息是否留在发送方 UI）
- [ ] host 端 `roomPeer.ts` 与 `relayHost.ts` 的代码隔离是否彻底（不互相干扰请求转发）
- [ ] host 端 room UI 在 Electron 桌面壳中的入口位置（侧边栏 vs 顶部栏）
- [ ] host 不自动重连进 room 的 UX 是否可接受（用户需手动重新加入）

### 实施前置条件

- 确认多人协作场景的真实需求强度（是否值得加第 5 个 Tab）
- 确认「无离线消息」是否可接受（如果不能接受，则需要 relay 内存暂存 + TTL，复杂度上升）
- 确认 E2E 加密的 UX 代价可接受（刷新页面后看不到刷新前消息——即使消息本身还在路由中）
- 确认 host 端是否真的需要参与 room（还是只需要 client 之间的通信）
