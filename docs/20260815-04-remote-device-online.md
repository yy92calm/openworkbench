# 20260815-04 · 设备列表在线标记

## 背景

远程访问的账号注册表已经在 `20260815-03` 落地：desktop 上线即注册设备，
app 端令牌登录后可看到账号名下设备列表。当前列表只显示 deviceId，
区分不了哪些设备在线——选中一台已关机的 desktop 连接会拿到 502。

需求：**设备列表标注在线/离线**，在线设备优先显示。

## 设计

### 1. 协议：device-list 携带在线状态

`RelayDeviceList.devices` 从 `string[]` 改为 `RelayDeviceInfo[]`：

```ts
interface RelayDeviceInfo {
  device: string;
  online: boolean;
}
```

在线判定在中继侧完成：`hosts` 表里存在 `账号token|device` 的活跃 socket 即为在线。
注册表（`registry.ts`）**不感知在线状态**——它只保存持久化的设备归属，
在线信息是运行时状态，由 server 在应答 `list-devices` 时实时计算，避免把瞬态写进磁盘。

### 2. 服务端

`handleGuestMessage` 的 `list-devices` 分支：

```ts
const devices = this.registry.listDevices(token).map((d) => ({
  device: d,
  online: this.hosts.has(`${token}|${d}`),
}));
```

顺序沿用注册表的字典序（保持稳定输出）。

### 3. 客户端（apps/remote）

- `listDevices` 的返回类型改为 `RelayDeviceInfo[]`。
- 设备选择器：每台设备显示「在线/离线」标记（圆点 + 文字），**在线优先排序，
  离线置灰**；离线设备仍可选择（desktop 之后上线时连接自然可用）。
- 自动选中逻辑收紧：仅当列表只有一台**在线**设备时才自动选中，
  避免误选离线设备。

### 4. 变更范围

| 文件 | 变更 |
| --- | --- |
| `packages/relay/src/protocol.ts` | `RelayDeviceInfo`；`RelayDeviceList.devices` 类型 |
| `packages/relay/src/server.ts` | list-devices 应答附 online |
| `packages/relay/src/RelayHttpTransport.ts` | `listAccountDevices` 返回 `RelayDeviceInfo[]`；导出类型 |
| `packages/relay/src/index.ts` | 导出 `RelayDeviceInfo` |
| `apps/remote/src/lib/connection.ts` | `listDevices` 返回类型 |
| `apps/remote/src/pages/ConnectPage.tsx` | 在线标记 UI + 排序 + 自动选中规则 |
| `packages/relay/test/relay.test.ts` | 用例适配 + 新增在线/离线用例 |
| `packages/relay/e2e-account.mjs` | 设备断言适配新结构 |
| `packages/relay/README.md` | 客户端说明补一句在线标记 |

桌面端无改动（不消费设备列表）。

## 验证状态

- [x] `packages/relay` 单测 15/15：原有用例适配新结构；`device-list` 携带 online 状态
      （host 未连 → offline，host 在线 → online），E2E 断言设备在线才可配对。
- [x] `pnpm --filter @workbench/relay e2e` 账号全链路 PASS。
- [x] `apps/remote` 生产构建通过、类型检查本次改动 0 错误（仅剩 sdk/shared 既有遗留错误）。
