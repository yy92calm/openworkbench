# 04 · 远程访问与房间（relay / client / host）

> 所属：架构现状系列 · [返回索引](./README.md)

## 1. 三项目边界

| 项目 | 位置 | workspace | 说明 |
| --- | --- | --- | --- |
| Workbench（host） | `apps/desktop/` + `packages/*` | 根 pnpm workspace | 唯一持有 API key 与 sidecar 密码 |
| relay（中继） | `relay/` | 自建（`.` + `admin`） | 纯内存转发 + 账号注册表持久化 |
| client（远端） | `client/` | 自建（`.` + `sdk` + `shared`） | 手机/另一台电脑经 relay 驱动 host |

三者代码零跨项目 import，只通过 WS/HTTP 通信。

### 协议三副本

| 项目 | 文件 |
| --- | --- |
| relay（权威） | `relay/src/protocol.ts` |
| client | `client/src/protocol.ts` |
| desktop host | `apps/desktop/src/main/relay-protocol.ts` |

当前三份的**类型与函数一致**，差异只在注释（relay 版比另两份多两句关于房间
倒计时的说明）。协议变更需三处手动同步。

### sdk / shared 双副本现状

`packages/sdk` 与 `client/sdk` 已**实质分叉**，不是字节级一致：

- `client/sdk` 独有 `HostClient`（封装 `/__host/*`）、`uploadAttachment`、
  `sendPromptWithFiles`（远端消息带 `metadata.source = "remote"`）；
- `packages/sdk` 独有 `agent-runtime` 整套类型与工厂、测试与 `mockServer`。

修改 SDK 事件或类型时需两侧核对。

## 2. relay 服务器

入口 `relay/src/server.ts`（`RelayServer`），核心组件还有 `registry.ts`
（账号注册表）与 `room.ts`（房间管理器）。

### 连接角色与握手

`WebSocketServer` 的 `verifyClient` 在 HTTP upgrade 阶段解析
`?role=host|guest|peer&token=&device=`，未知 token 直接 401；连接后再以
`close(4001)` 兜底。路由主键是复合键 `token|device`，账号间完全隔离。

| 角色 | 行为 |
| --- | --- |
| `host` | 必须有 `device`（否则 4004）；`registry.registerDevice` 幂等注册；同 key 新连接顶掉旧连接并 `failPending(502)` |
| `guest` | 无 `device` = 控制连接（只能 `list-devices`）；有 device 但未注册 → 4003 |
| `peer` | 交给房间管理器，靠 `room.join` 消息进房，不做设备配对 |

### 请求转发与 cancel

- 消息：`request {id, method, path, headers?, body?}` → host 回
  `head {status, headers}` → `chunk*`（流式）→ `done`。
- `pending: Map<requestId, {guest, host}>` 全局表；host 不在线时回 502 + done。
- guest 断开或心跳超时：`dropGuest()` 删除其 pending 并向 host 发
  `cancel {id}`；host 用 `AbortController` 取消对应 sidecar fetch。
- host 断开：`failPending(502)` 回 guest 错误头并同样清理。

### 心跳

- host/guest：30s ping/pong，check-then-ping，超时 terminate 并清理连接表。
- peer：180s（3 分钟）心跳，连续两个周期无响应约 6 分钟才移除（房间成员
  存在幽灵窗口）。

### 账号注册表与持久化

`AccountRegistry` 内存为唯一真源；配置了 `RELAY_DATA_DIR` 时每次变更原子写
`accounts.json`（tmp + rename），并 `watch` 目录热重载：管理员改文件后运行中
的 relay 立即生效，且在线的已删账号连接会被踢掉。启动时 `RELAY_AUTH_TOKEN`
与 `RELAY_ADMIN_TOKENS` 作为种子账号幂等写入。管理 CLI：
`pnpm --filter @workbench/relay admin add|list|remove --token ...`。

### HTTP 端点

| 路径 | 用途 |
| --- | --- |
| `/api/admin/*` | 管理 API：登录/登出、账号增删、设备删除；会话 Cookie `admin_session`（HttpOnly + SameSite=Strict，24h） |
| `/api/rooms*` | 房间 HTTP：创建、校验邀请码、上传/下载文件（CORS `*`） |
| `/relayadmin*` | 管理端静态页（`RELAY_ADMIN_STATIC_DIR`，SPA 回退） |
| 其余 | client 构建产物静态托管（SPA 回退）；`/api/*` 未匹配 404 |

管理密码默认 `test@123`（`RELAY_ADMIN_PASSWORD` 可覆盖）。**没有**
Origin/Referer 校验（历史文档声称有）。

### 房间与文件存储

房间、成员、消息、上传文件全部在内存（文件单个上限 50MB，`RoomManager.files`）；
relay 重启即全部消失。唯一落盘的是账号注册表。

## 3. host 侧（apps/desktop/src/main）

### relayHost

- 出站 WS 连接 relay（`role=host&token&device`）；断线指数退避重连
  1s → 30s（上限），状态四态 `off/connecting/connected/error` 经
  `relay-status-changed` 推给渲染层。
- `handleMessage` 顺序：
  1. `cancel` → abort 对应 pending fetch；
  2. `/__relay/write-file` → 写文件端点（见下）；
  3. `/__host/*` → 直接调用主进程函数（不经 sidecar）；
  4. 其余 → 转发到本地 sidecar：取 `getServerUrl()`，**覆盖注入 Basic
     凭据**（`base64("opencode:" + sidecar 密码)`），把响应按
     `head/chunk/done` 回流；空 URL 回 503。
- `POST /session` 的响应会额外缓冲解析出 session id，记录到
  electron-store 的远端会话集，渲染层据此显示「远端」徽标。
- keep-awake：`powerSaveBlocker('prevent-display-sleep')` 随配置启停。
- `/__relay/write-file`：body `{filename, base64}`；`basename()` 防路径穿越；
  写入当前工作区，返回绝对路径供客户端构造 opencode `FilePartInput`。
- `/__host/*` API：workspace 读写/列举/dated 新建、artifact 读取、notebooks、
  调度器全量操作、relay 状态查询。client 侧由 `HostClient` 封装。

### roomPeer

- 独立 `role=peer` WS（与 host 请求通道隔离）；单例，IPC 族 `room-*`。
- 断线指数退避重连，重连时携带 `creatorId` 恢复创建者身份（历史文档称
  host 不自动回房，实际会）。
- 房间事件经 `room-event` 广播给所有窗口；文件下载落
  `os.tmpdir()/workbench-rooms`。

## 4. client

- **登录**：`ConnectPage` 只填 relay 地址 + 账号令牌 →
  `listDevices()`（临时无 device 控制连接发 `list-devices`）验证令牌 →
  保存配置进入主界面；不强制先选设备。
- **设备配对**：`DeviceBar`/`DeviceSheet` 拉设备列表（在线优先），仅在
  唯一在线设备时自动选中；`connect()` 建 transport + `OpenCodeClient`，
  后台无限重试打开 `/event`（host 离线不阻塞登录）。
- **重连**：`RelayHttpTransport` 的 `fetchImpl` 把 HTTP 语义请求打成
  `request` 消息，用 `ReadableStream` 还原 `Response`；`onDisconnect` 触发
  1s→30s 退避重连，成功后重建 transport + client + SSE。
- **会话**：列表走 SDK（优先 `/experimental/session`，回退 `/session`），
  每 8s 轮询 `/session/status` 显示运行中/失败徽标；会话页处理统一事件做
  流式渲染，发送走 `sendPromptWithFiles`（附件先 POST
  `http://relay/__relay/write-file` 由 host 落盘）。
- **文件/任务页**：经 `HostClient` 调 `/__host/workspace/list`、
  `/__host/artifact`、`/__host/notebooks`、调度器路由。

## 5. 房间（跨账号分享/群聊）

- **创建**：HTTP `POST /api/rooms?token=` → 6 位邀请码；创建者默认不开启
  强制阅后即焚，进房后可切换。
- **加入**：独立 peer WS，`room.join {inviteCode, nickname, pubKey?,
  enforceViewOnce?, creatorId?}`；成员 id 随机分配，与账号解耦。
- **消息**：发送方为每个成员构造密文条目 `{to, nonce, ct}`，relay 按收件人
  只路由对应一份；**当前 `ct` 是 base64 明文占位**，协议注释描述的 E2E
  （X25519 + XChaCha20-Poly1305）未实现。
- **阅后即焚**：房间级开关仅创建者可切；单条开关非强制时可用；接收方点击
  查看后回执并从列表移除（真焚），发送方收到回执显示「✓ 已查看」。
- **TTL**：创建者离开启动 24h 销毁倒计时（广播 `destroy-countdown`），
  创建者带 `creatorId` 重入则取消；到期广播 `destroyed` 并清空房间与文件。
- **昵称**：client 存 localStorage（默认「匿名用户」），host 默认 `Host`。
- **会话分享**：`/` 触发会话选择器 → `compressSession`（只取文本 part、
  最近 30 条、每条截 150 字）生成 markdown → `kind: 'session-share'`
  消息，两端渲染折叠卡片。

## 6. 连接稳定三层

| 层 | 机制 |
| --- | --- |
| relay 心跳 | 30s ping/pong（peer 180s）；超时 terminate + cancel，无连接泄漏 |
| client transport | WS 断线指数退避重连 1s→30s，重建 transport + client + SSE |
| SDK SSE | `/event` 流意外断开自动重开 1s→15s；`close()` 停止 |
| UI | 离线横幅 + 列表/详情自动刷新；设备状态轮询 |

桌面端另有渲染层 `connectRetry`（120 次）覆盖本地 sidecar 启动窗口
（见 [03-renderer](./03-renderer.md)）。

## 7. 已知边界

- 协议三副本靠手动同步；sdk/shared 双副本已分叉。
- 房间消息未加密（base64 占位）、无持久化、relay 重启即清；无 room 单测。
- 未配 TLS 时公网段明文（README 已提示）；管理密码默认值需部署时修改。
- relay 单测覆盖转发/鉴权/持久化/管理端，不含房间、cancel、心跳。
- 详细差异与风险见[差异清单](./07-doc-code-gaps.md)。

## 8. 文件速查

| 主题 | 文件 |
| --- | --- |
| relay | `relay/src/{server.ts,registry.ts,room.ts,protocol.ts,admin.ts,cli.ts}`、`relay/admin/`、`relay/test/` |
| host | `apps/desktop/src/main/{relayHost.ts,roomPeer.ts,relay-protocol.ts}`、`renderer/app/routes/RoomsPage.tsx`、`renderer/lib/roomShare.ts` |
| client | `client/src/{RelayHttpTransport.ts,protocol.ts}`、`client/src/lib/{connection,roomConnection,roomShare}.ts`、`client/sdk/src/{hostClient.ts,OpenCodeClient.ts}` |
