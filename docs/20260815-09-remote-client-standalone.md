# 20260815-09 · 客户端连接器独立：三组件相互解耦

## 背景

项目演进为三个相互独立的组件，用户明确要求**三者相互独立**：

1. **workbench 桌面端**（`apps/desktop`）— 被控制的宿主
2. **relay 中继服务**（`relay/`）— 只做消息转发/鉴权/设备注册
3. **客户端连接器**（`client/`）— Web 页面，连接中继、控制桌面端

此前客户端（transport + 协议 + 远程页面）住在 `relay/` 包内，`apps/remote`
页面通过 `@workbench/relay/client` 引用，耦合严重。本次把客户端整块搬出为
独立目录 `client/`，relay 只保留服务端。

## 三组件依赖边界（现状）

| 组件 | 目录 | 运行时依赖 | 说明 |
| --- | --- | --- | --- |
| 桌面端 | `apps/desktop` | `@workbench/client`（仅类型）、`@workbench/sdk`、`@workbench/shared` | 不依赖 relay；relayHost 只取 `RelayMessage` 类型 |
| 中继 | `relay/` | `ws` | src/ 零依赖其他组件；devDependency 仅测试用 |
| 客户端 | `client/` | `@workbench/sdk` | 自含 transport+协议+页面，不依赖 relay |

代码层已做交叉 import 检查：desktop 无 `@workbench/relay`、client 无
`@workbench/relay`、relay/src 无 `@workbench/client` / `@workbench/sdk`。

## 结构

```text
client/                         ← 客户端连接器独立目录
├── package.json                ← @workbench/client；exports "." → src/client.ts
├── tsconfig.json               ← DOM + React；paths 仅 @/ 与 @workbench/sdk
├── vite.config.ts              ← alias @/ 与 @workbench/sdk；optimizeDeps exclude
├── index.html
├── public/manifest.webmanifest
└── src/
    ├── client.ts               ← 聚合导出（transport + listAccountDevices + 协议类型）
    ├── protocol.ts             ← 线协议契约（两端各有拷贝，见「契约重复」）
    ├── RelayHttpTransport.ts   ← fetch→WebSocket 隧道（仅客户端）
    ├── lib/connection.ts       ← 连接/登录/设备选择逻辑
    ├── App.tsx / main.tsx / styles.css
    └── pages/                  ← ConnectPage / SessionsPage / SessionPage

relay/                          ← 中继服务（瘦身后只留服务端）
├── src/server.ts / registry.ts / admin.ts / cli.ts / index.ts
├── src/protocol.ts             ← 服务端保留（parseConnectionParams + RelayMessage）
└── test/relay.test.ts          ← 引用 @workbench/client 模拟客户端
```

## 关键改动

| 文件 | 改动 |
| --- | --- |
| `client/`（新建） | 「apps/remote + relay 客户端侧」迁移进独立目录；传输层/协议/页面自含 |
| `apps/remote/`（删除） | 代码全部迁入 client/，消除双份维护 |
| `relay/src/RelayHttpTransport.ts` `client.ts`（删除） | 客户端传输层搬走 |
| `relay/src/index.ts` | 只导出服务端（server/registry/protocol） |
| `relay/package.json` | exports 移除 `./client` `./transport`；devDep 加 `@workbench/client` |
| `apps/desktop/src/main/relayHost.ts` | `@workbench/relay/client` → `@workbench/client`（仅类型） |
| `apps/desktop/package.json` | `@workbench/relay` → `@workbench/client` |
| `relay/test/relay.test.ts` `e2e-account.mjs` `repro.mjs` | transport 改引 `@workbench/client`（测试模拟客户端） |
| `pnpm-workspace.yaml` | 加 `"client"` |

## 验证

- [x] relay 单测 22/22、relay typecheck 0 错（客户端 transport 从 `@workbench/client` 引用）。
- [x] client `pnpm build` 通过；client dev 本地起服务正常（`http://localhost:5533/`）。
- [x] desktop typecheck：无 relay/client 相关错误（SDK/shared 存量错不计）。
- [x] 三组件交叉 import 检查：desktop 无 relay 依赖、client 无 relay 依赖、relay/src 无 client/sdk 依赖。

## 本地独立起服务

```bash
cd client && pnpm dev        # 开发：http://localhost:5533/
cd client && pnpm build && pnpm preview   # 产物 + 本地预览
```

浏览器打开后填入中继地址 `ws://43.133.82.137:12959` + 账号 token 即可看到
桌面端在线设备并配对控制。

## 说明与风险

- **协议契约重复**：`protocol.ts` 两端（relay/ 与 client/）各持一份。这是「完全
  独立」的代价——改协议需同步两处。若想消除，可后续抽独立 `protocol` 包，
  但会重新引入耦合，当前按三组件独立优先。
- **vite dev 的 optimizeDeps.exclude**：SDK 的 agent-runtime 动态 import
  `@anthropic-ai/claude-agent-sdk`（Node-only），vite 预构建会追到 Node 内置
  `https` 报错。client 是浏览器端，已在 vite.config 排除该依赖。
- **Node 25 下 e2e 的 `new Response(stream)` 兼容问题**：relay 的 e2e 模拟
  client 在 Node 25（undici）下跑，SSE 长连接场景偶发 `Response body disturbed`
  （浏览器无此问题）。与迁移无关，transport 放回原路径同样触发；属环境缺陷，
  不影响浏览器端真实使用，E2E 验证时注意。

## 后续建议（非本次）

- `docs/20260815-06` 与本文档描述的 `apps/remote` → `client/` 迁移可合并阅读。
- 沉睡的 `repro.mjs`（Node 25 排查脚本）保留在 relay/ 作参考，未进部署。
