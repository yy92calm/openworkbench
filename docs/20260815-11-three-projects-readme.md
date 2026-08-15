# 三项目整体方案 README（Workbench / relay / client）

> 覆盖本仓库三个相互独立的项目：桌面端 Workbench（host）、中继服务
> （relay）、远端客户端（client）。三者代码互不 import，只通过
> WebSocket/HTTP 协议通信；**协议定义三份副本，改动需手动同步**。

## 1. 总体架构

```
┌────────────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  桌面端 Workbench (host) │      │  relay 中继服务   │      │  client 远端客户端 │
│  apps/desktop/         │      │  relay/          │      │  client/         │
│                        │      │                 │      │                  │
│  · Electron + React    │      │  · WS 转发       │      │  · React PWA     │
│  · opencode sidecar    │◄────►│  · 账号/设备注册  │◄────►│  · 会话/流式/文件 │
│  · relayHost 出站 WS   │  WS  │  · admin 管理端  │  WS  │  · 自动重连       │
└────────────────────────┘      └─────────────────┘      └─────────────────┘
       host 主动连 relay           公网/内网可部署           guest 主动连 relay
```

- **host（桌面端）**：唯一持有 API key 与 sidecar 密码；所有远端请求由
  relayHost 转发到本地 opencode sidecar，密钥永不经过 relay。
- **relay（中继）**：纯内存转发 + 账号注册表持久化；不落盘请求内容。
- **client（客户端）**：手机/另一台电脑经 relay 驱动桌面端，可看会话、
  发消息、传文件。

## 2. 项目结构与自洽

| 项目 | 位置 | 自建 workspace | 依赖 |
| --- | --- | --- | --- |
| Workbench | `apps/desktop/` + `packages/*` | 主仓库 pnpm workspace | `@workbench/sdk`、`@workbench/shared` |
| relay | `relay/` | 独立（`relay/pnpm-workspace.yaml` + 锁文件） | 仅 `ws` + Node 内置 |
| client | `client/` | 独立（含 `sdk/`、`shared/` 副本） | 自持 sdk/shared |

- `relay/` 完全自包含：服务器 + `admin/` 管理端源码（构建产物进
  `admin-web`，已入库）+ 测试/调试用本地 guest 桩。
- 主仓库与 client 各自持有 `packages/sdk` / `client/sdk` 副本（字节级
  一致），修改需手动同步。
- `relay/` 的测试与 e2e 不再依赖 `@workbench/client`（用
  `relay/test/helpers/relay-guest.ts` 本地桩）。

## 3. 通信协议（三副本）

协议文件（内容必须一致，改动三处同步）：

| 项目 | 文件 |
| --- | --- |
| relay（权威定义） | `relay/src/protocol.ts` |
| client | `client/src/protocol.ts` |
| desktop host | `apps/desktop/src/main/relay-protocol.ts` |

消息类型：

- **`request`**（guest → host，经 relay 转发）：HTTP 语义的
  `{ id, method, path, headers?, body? }`，body 为 UTF-8 文本。
- **`head` / `chunk` / `done`**（host → guest）：响应状态行、流式块、结束。
  204/205/304 与已锁定流用空 body 响应。
- **`list-devices` / `device-list`**：guest 控制面查询账号下设备及在线状态。
- **`cancel`**（relay → host）：guest 断开（或 relay 心跳超时踢掉）时通知
  host 用 AbortController 取消对应 sidecar fetch，防止连接泄漏。

连接参数：`?role=host|guest&token=<账号令牌>[&device=<设备ID>]`。

## 4. 关键机制

### 4.1 设备注册与登录
- host 以 `role=host` 连接时，`token|device` 自动注册（幂等）；同 key 新
  连接顶掉旧连接。
- guest 先以无 device 的控制连接 `list-devices` 拉设备列表（在线优先），
  选择后配对。

### 4.2 会话与流式
- 会话列表：`GET /experimental/session`（全工作区）；历史消息：
  `GET /session/:id/message`。
- 运行状态：`GET /session/status`（`busy` / `idle` / `retry`），客户端
  8s 轮询显示「运行中/失败」徽标。
- 实时流式：`client.connect()` 建立 `/event` SSE 长连接，`text.updated` /
  `reasoning.updated` / `tool.updated` / `session.idle` / `session.status`
  事件驱动渲染；SDK 对断流做指数退避自动重连（1s→15s）。
- 模型失败（如配额耗尽）：`session.status {type:"retry", message, next}`
  在两端展示——桌面端 thread 红色错误行、客户端错误横幅 + 列表「失败」
  徽标。

### 4.3 文件传输
- 客户端上传：`POST /__relay/write-file`（host 内置端点，base64 → 写入
  host 工作区），返回绝对路径。
- 消息引用：SDK `sendPromptWithFiles` 以 opencode `FilePartInput` 引用
  已落盘路径（`url` 必填、`source.text` 为 `{value,start,end}`）。
- 下载/浏览：`GET /file`、`GET /file/content`（sidecar 原生，经 relay 转发）。
- 消息来源：远端发送的 text part 带 `metadata: {source:"remote"}`，桌面端
  显示「远端客户端」标签。

### 4.4 连接稳定（三层防护）
1. **relay 心跳**：30s ping/pong，超时 terminate 并 `cancel` 通知 host。
2. **client transport 重连**：relay WS 断线指数退避重连（1s→30s），重建
   transport + client + SSE，成功后通知 UI 刷新。
3. **SDK SSE 自愈**：`/event` 流意外断开自动重开；`close()` 停止。
4. **UI 提示**：离线横幅「主机离线，正在自动重连…」；列表/详情自动刷新。

## 5. 部署与运行

### relay（中继服务）
```bash
cd relay && pnpm install          # 独立 workspace
pnpm test                         # 22 单测
pnpm --filter @workbench/admin build   # 或 cd admin && pnpm build（产物 → admin-web）
RELAY_AUTH_TOKEN=xxx RELAY_PORT=8080 RELAY_ADMIN_PASSWORD=test@123 \
RELAY_DATA_DIR=/data RELAY_ADMIN_STATIC_DIR=relay/admin-web pnpm serve
```
- 生产部署：`RELAY_AUTH_TOKEN=xxx ./scripts/deploy-relay.sh user@host`
- 管理界面：`http://<host>:<port>/relayadmin`（默认密码 `test@123`）
- 本地示例：`ws://127.0.0.1:12960`，令牌 `relay-master-secret`

### client（远端客户端）
```bash
cd client && pnpm install && pnpm dev    # 开发（默认 5173）
pnpm build                               # 生产构建
```
浏览器打开后填中继地址 + 账号令牌 → 选设备 → 看会话/发消息/传附件。

### 桌面端 Workbench（host）
```bash
bash apps/desktop/scripts/package-mac.sh   # typecheck + build + electron-builder --mac
```
- sidecar 指纹用 `opencode --version`（仅版本升级才清会话库）。
- 打包版在「设置 → 远程访问」填 relay 地址 + 设备 ID + 账号令牌。

## 6. 已知限制与注意事项

- **协议三副本需手动同步**：改协议（含 `cancel`、`write-file` 等）务必
  同步 `relay/src/protocol.ts`、`client/src/protocol.ts`、
  `apps/desktop/src/main/relay-protocol.ts`。
- **sdk/shared 双副本**：`packages/sdk` 与 `client/sdk`（含 shared）内容
  需手动同步；改 SDK 事件/类型时两处都要改。
- **模型配额**：ali/qwen MaaS 周配额耗尽时模型不产文本（08-19 重置），
  链路本身正常，两端会显示 retry 错误。
- **IAB 内嵌浏览器**：ZCode in-app browser 的 WebSocket 与 streaming
  fetch 均可用，但页面长时间挂起时点击偶发超时（真实 Chrome 无此问题）。
- **relay e2e**（`relay/e2e-account.ts`）在 Node 25 下有既有 transport bug
  （`Response body disturbed`），未修，单测已覆盖同逻辑。

## 7. 关键验证状态（本轮）

- [x] relay 22 单测全绿；client/desktop typecheck + build 通过。
- [x] 端到端：listSessions / getMessages / createSession / sendPrompt /
      `/file` / `/file/content` / `/session/status` 经 relay 全部 200。
- [x] 流式：SSE `text.updated` 增量 + `session.idle`（Node 与浏览器一致）。
- [x] 连接稳定：cancel 机制下 8 轮开/断零泄漏；host 重启自动重连。
- [x] 文件：上传写 host 工作区、file part 历史回显、远端来源标签。
- [x] 配额错误：两端均显示 retry 原因与恢复时间。
