# 20260815-10 · 三项目彻底拆分（Workbench / relay / client 互不依赖）

## 背景

用户明确三个独立项目：1) 原有 Workbench（桌面端 host），2) relay 中继服务，
3) 客户端连接。三者代码相互独立，只通过服务接口（WebSocket/HTTP）连接。
上一轮（20260815-09）把 client 迁入 `relay/client/` 且 relay 测试依赖
`@workbench/client`、desktop 跨项目 import relay/client——均违背该原则，本次纠正。

## 现状（调研结论）

- relay 对 `@workbench/client` 的引用：`relay/test/relay.test.ts`、
  `relay/e2e-account.mjs`、`relay/repro.mjs`（均用 `RelayHttpTransport` /
  `listAccountDevices`，作为 guest 客户端连接器测试中继转发）。
- `relay/src/protocol.ts` 与 `relay/client/src/protocol.ts` **内容完全一致**
  （diff 为空）——协议已是 relay 服务器侧唯一真源（90 行）。
- desktop `relayHost.ts:2` import `../../../../relay/client/src/protocol`
  （跨项目 import relay 源码，违背原则）。
- desktop 依赖 `@workbench/sdk`、`@workbench/shared`（主仓库 `packages/`，
  属 Workbench 项目自身组件，合法）。
- `relay/` 当前自建 workspace：根 + `admin/` + `client/`（含 sdk/shared 副本）。

## 设计

### 目标结构（三项目各持一份协议，代码零 import）

```
apps/desktop/ + packages/    ← 项目1 Workbench（桌端 host，协议类型在本地）
relay/                       ← 项目2 中继（服务器；协议 = src/protocol.ts）
client/                      ← 项目3 客户端（顶层；协议 = src/protocol.ts 自持）
```

原则：**协议类型每个项目各持一份**（relay 服务器、client、desktop 三处），
代码之间不互相 import，只按协议契约（消息结构）通信。协议有变更时三处
手动同步（文档注明）。

### 1. relay 去 client 依赖

- 建 `relay/test/helpers/relay-guest.ts`：本地 guest 测试桩，用 `ws` 直连
  relay（复用 `startFakeHost` 同风格），实现 `makeGuestTransport()`（返回
  `{ connect, fetchImpl }`，基于 `ReadableStream` 返回 `Response`）
  与 `listAccountDevices()`。协议用 `../src/protocol`。
- `relay/test/relay.test.ts`：`import` 从 `@workbench/client` 改为
  `./helpers/relay-guest`；`makeGuest()`、list 用例改调本地桩。
- `relay/e2e-account.mjs`、`relay/repro.mjs`：同样改本地桩。
- 删除 `relay/package.json` 的 `@workbench/client` devDep。

### 2. client 恢复顶层独立

- `relay/client/` → 顶层 `client/`（含 `sdk/`、`shared/` 副本），
  `package.json` 恢复独立，保留自己的 `src/protocol.ts`。
- 若 relay 不再依赖 client，则 client 的 `@workbench/sdk`、`@workbench/shared`
  解析到 `./sdk`、`./shared`。
- `relay/.gitignore` 移除 `client/dist/`（client 离开 relay）。

### 3. desktop 协议类型自持

- `apps/desktop/src/main/relayHost.ts`：改为本地协议类型（从 relay 复制
  `RelayMessage` 相关接口到 desktop，如 `apps/desktop/src/main/relay-protocol.ts`），
  不再 import relay/client。desktop 依赖 `@workbench/sdk`、`@workbench/shared` 不变。

### 4. relay workspace

- `relay/pnpm-workspace.yaml` 移除 `client`、`client/sdk`、`client/shared`，
  保留 `.` + `admin`。

### 5. deploy/文档

- `scripts/deploy-relay.sh` 不变（构建 `relay/admin`）。
- `relay/README.md`、`AGENTS.md`（仓库地图）更新：client 为独立顶层项目。

## 验证

- [x] relay 独立 `pnpm install` + `pnpm test` 22/22 全绿（本地 guest 桩，不含
      `@workbench/client`）。typecheck 0 错。
- [ ] relay e2e 用本地桩能跑（Node 25 的 Response bug 另计，同文档 09；
      已改 `.ts` + 本地桩，待单独验证）。
- [x] `client/` 顶层独立（自建 workspace `./sdk` `./shared`）`pnpm install` +
      `pnpm build` 通过（typecheck 报的 patchOverlay 旧错与文档 09 同源，非本次引入）。
- [x] desktop typecheck + build 通过（relayHost 用本地 `relay-protocol.ts`）。
- [x] 三项目协议自持：relay `src/protocol.ts`、client `src/protocol.ts`、
      desktop `relay-protocol.ts`；无 `@workbench/client` 跨项目 import 残留
      （仅 3 处注释/包名声明）。