# 20260815-03 · 远程访问按账号区分，令牌登录 + 设备注册

## 背景

当前远程中继（`packages/relay`）是**单一共享令牌**模型：服务端只有一个
`RELAY_AUTH_TOKEN`，host 与 guest 凭同一令牌连接，`deviceId` 只是路由键，
不区分账号，也没有“账号下有哪些设备”的概念。

需求：**按账号区分** ——

- 用户登录后获得**账号令牌**（token），这是账号凭据本身；
- 每个客户端（桌面端）有自己稳定的 `deviceId`，**版本升级不会变**；
- 根据令牌能看到该账号下注册了哪些 `deviceId`（设备列表），供客户端选择配对。

## 设计

### 1. 账号模型：令牌即账号

中继维护一个**账号注册表**（token → 账号记录 { note?, deviceIds: string[] }）。

- 令牌在开通账号时由管理员通过管理 CLI 创建并分发给用户（“用户登录后获取 token”）。
- 连接鉴权从“一个全局令牌”改为“令牌必须在注册表中”，否则握手拒绝（401/4001）。
- 兼容旧用法：`RELAY_ADMIN_TOKENS`（逗号分隔）与 `RELAY_AUTH_TOKEN` 作为启动种子，
  自动写入注册表（幂等），保证单账号模式与既有开发流程不破坏。

### 2. 设备注册：host 首连即注册

host 以 `?role=host&device=<id>&token=<t>` 连接，鉴权通过后把该 `deviceId` 加入
该账号的设备列表（幂等，重复连接不产生重复项）。因为桌面端把 `deviceId` 持久化在
electron-store（`apps/desktop` 已是现状），**升级不变**，所以设备列表跨版本稳定。

### 3. 客户端登录流程：令牌登录 → 设备列表 → 选择配对

guest 连接时 `device` 参数可选：

- **带 device**：`?role=guest&device=<id>&token=<t>` —— 校验该 device 属于该账号，
  属于才允许配对（否则 4003 拒绝）；随后按现有协议转发 HTTP 请求。
- **不带 device**：作为“控制连接”，可发送 `list-devices` 消息查询该账号的
  已注册设备列表，收到 `device-list` 后关闭。

客户端流程：

1. 用户只填令牌 → `listAccountDevices(relayUrl, token)` 拉取设备列表；
2. 从列表选中一台设备（或自动选上次记住的 deviceId）；
3. 以 `connect(relayUrl, deviceId, token)` 打开数据连接进入会话页。

选中/登录信息保存在客户端 localStorage（`workbench.remote.config`），重进自动配对。

### 4. 账号隔离

- 路由主键从裸 `deviceId` 改为复合键 `账号token|deviceId`，不同账号可用相同 deviceId，
  互不串扰（`hosts` / `guestDevice` 两表同步改造）。
- guest 只允许配对**自己账号**下注册过的 device。控制连接也只返回自己账号的设备列表。
- 中继依旧不解析 payload、不落请求内容，仅新增对控制消息与注册表的处理。

### 5. 持久化与管理 CLI

- 指定 `RELAY_DATA_DIR` 时，账号注册表持久化为
  `<RELAY_DATA_DIR>/accounts.json`（变更即写，内存为唯一真源，文件用于重启恢复）；
  未指定则纯内存（开发模式，重启丢设备列表）。
- 管理 CLI（`packages/relay/src/admin.ts`）：
  - `pnpm --filter @workbench/relay admin add --token <t> [--note <note>]`
  - `pnpm --filter @workbench/relay admin list`
  - `pnpm --filter @workbench/relay admin remove --token <t>`
  - 通过 `RELAY_DATA_DIR` 读取/写入同一账号文件（与运行中的中继一致）。

### 6. 协议变更（packages/relay/src/protocol.ts）

新增两个控制消息（沿用现有 JSON 帧）：

```ts
interface RelayListDevices { type: "list-devices"; id: string; }
interface RelayDeviceList { type: "device-list"; id: string; devices: string[]; }
```

`RelayConnectionParams` 的 `device` 变为可选（guest 控制连接可省略）。

`packages/relay/src/RelayHttpTransport.ts` 新增导出（浏览器安全，同在 transport 子路径）：

```ts
function listAccountDevices(relayUrl: string, token: string, opts?): Promise<string[]>
```

### 7. 变更范围

| 文件 | 变更 |
| --- | --- |
| `packages/relay/src/protocol.ts` | 控制消息类型；`device` 可选 |
| `packages/relay/src/registry.ts`（新） | 账号注册表：校验/注册/列表/持久化 |
| `packages/relay/src/server.ts` | 按账号鉴权 + 设备注册 + 复合键路由 + 控制消息 |
| `packages/relay/src/admin.ts`（新） | 管理 CLI |
| `packages/relay/src/index.ts` | 导出 registry/admin 类型与工具 |
| `packages/relay/src/RelayHttpTransport.ts` | `listAccountDevices` |
| `packages/relay/src/cli.ts` | 读取 `RELAY_DATA_DIR` / `RELAY_ADMIN_TOKENS` |
| `packages/relay/test/relay.test.ts` | 按账号用例 |
| `apps/remote/src/pages/ConnectPage.tsx` 等 | 令牌登录 → 设备选择 |
| `apps/desktop`（relayHost/i18n/RemoteCard） | 文案“账号令牌”；deviceId 语义不变 |
| `scripts/deploy-relay.sh` / `packages/relay/README.md` | 部署与使用说明 |

## 验证状态

- [x] `packages/relay` 单测 15/15：注册表鉴权（未注册令牌拒绝）、host 连接自动注册设备、
      设备列表查询、guest 跨账号配对拒绝、复合键隔离（同 deviceId 不同账号不串台）、
      持久化读写、admin 删除后不复活、**热重载（CLI 删账号，运行中中继立即踢掉该账号连接）**、
      `device-list` 时序、旧用例（转发/SSE 流式/静态托管）全绿。
- [x] OpenCodeClient 经中继账号全链路 E2E（`pnpm --filter @workbench/relay e2e`）：
      登录 → 设备列表 → 配对 → 流式 text.updated → tool.updated → session.idle → PASS。
- [x] `apps/remote` 类型检查（仅剩 sdk/shared 既有遗留错误，本次改动 0 错误）+ 生产构建通过。
- [x] `apps/desktop` 类型检查 + 既有 255 测试通过。

> 未验证项（需真实机器/用户操作，与上一轮一致）：公网部署后真实手机/电脑连接、
> wss 自签证书链路、升级保留 deviceId 的端到端确认（桌面端持久化逻辑已覆盖）。