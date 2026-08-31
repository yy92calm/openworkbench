# 20260815-06 · 中继完全独立（仓库内独立目录）

## 背景

`packages/relay` 目前是主仓库 workspace 里的一个成员包，与 `apps/desktop`、
`apps/remote` 通过 `@workbench/relay` workspace 引用耦合。用户希望中继
「完全独立出来」，已确认选择**仓库内独立目录**：中继拥有自洽的目录结构、
独立构建/启动/部署与文档，但保留在同一 git 仓库与 pnpm workspace 里（代价低、便于开发依赖）。

## 现状耦合点

| 依赖方 | 引用内容 | 位置 |
| --- | --- | --- |
| `apps/desktop/src/main/relayHost.ts` | `RelayMessage` 类型（仅类型） | `@workbench/relay` |
| `apps/desktop/package.json` | `"@workbench/relay": "workspace:*"` | dependencies |
| `apps/remote/src/lib/connection.ts` | `RelayHttpTransport` / `listAccountDevices` / `RelayDeviceInfo` | `@workbench/relay/transport` |
| `apps/remote/package.json` | `"@workbench/relay": "workspace:*"` | dependencies |
| `apps/remote/vite.config.ts` | alias → `packages/relay/src/RelayHttpTransport.ts` | alias |
| `apps/admin` | 无（纯静态托管，不走 workspace） | — |
| `scripts/deploy-relay.sh` | 部署 `packages/relay/` | rsync 源 |

## 目标结构

```text
relay/                          ← 仓库顶层独立目录（替代 packages/relay）
├── package.json                ← 自洽；scripts: serve/admin/test/e2e
├── README.md                   ← 独立文档（已有，随目录搬）
├── src/                        ← server + registry + protocol + transport + cli + admin
├── test/relay.test.ts
├── e2e-account.mjs
├── web/                        ← 远程客户端生产构建（由 deploy 构建后生成）
└── admin-web/                  ← 管理界面生产构建
```

`apps/remote`、`apps/desktop` 保留在 `apps/`，但不再依赖 `packages/relay`。

## 实施步骤

### 1. 目录迁移

- 移动 `packages/relay/*` → `relay/*`（git mv 或 mv + 提交后删除 packages/relay）。
- relay 保持为 workspace 成员无需改 `pnpm-workspace.yaml`（`packages/*` 之外），
  但若要从 workspace 完全脱钩——见决策。

### 2. 解耦 workspace 引用

关键决策：**desktop/remote 只消费 relay 的「协议类型 + transport」（客户端侧）**，
它们不该依赖整个 relay server。拆分：

- 把 `protocol.ts` + `RelayHttpTransport.ts` 抽出为独立客户端包 `relay/client/`
  （或作为 relay 包内独立 export 的 `./client` 子路径）。
- `apps/remote` 与 `apps/desktop` 改引用客户端包，不再依赖完整 relay server。

为最小改动并保持「独立目录」语义，采用第二种：relay 包内 `exports` 增加
`"./client"` 指向 `src/client.ts`（聚合 transport + protocol 类型），
`apps/desktop/package.json` 与 `apps/remote/package.json` 的依赖改为
`"@workbench/relay": "workspace:*"` + import 从 `@workbench/relay/client` 走。

### 3. 构建与部署

- deploy 脚本改为 `rsync relay/`（顶层）+ 构建 `apps/remote`、`apps/admin` 并上传。
- relay 目录拥有独立 `serve`/`test`/`e2e` 脚本，可从仓库根 `relay/` 直接运行。

### 4. 文档

- relay/README.md 搬至新目录，头部注明「独立组件」。
- 主仓库 README 或 docs 索引补一行指向。

## 验证状态

- [x] 移动后 `relay/` 顶层独立目录；`pnpm-workspace.yaml` 加入 `"relay"`；
      `@workbench/relay` 包名不变，desktop/remote 的 `workspace:*` 依赖继续生效
      （node_modules 链接指向顶层 `relay/`）。
- [x] relay 包新增 `./client` 出口（聚合协议类型 + transport）；desktop `relayHost.ts`
      与 remote `connection.ts` / vite / tsconfig 全部改走 `@workbench/relay/client`，
      remote 的 alias 从 `packages/relay/...` 更新为 `relay/src/client.ts`。
- [x] relay E2E 从相对路径 `../sdk/...` 改为依赖 `@workbench/sdk`（devDependency，
      仅开发期；运行时 relay 仍只依赖 `ws` + Node 内置模块，保持独立）。
- [x] relay 增加 `typecheck` 脚本（typescript devDep）+ `.gitignore`（`.e2e-data/`）。
- [x] 验证：relay 单测 19/19、E2E PASS、relay typecheck 0 错；
      desktop typecheck 通过；remote typecheck（本次 0 新错）+ build 通过；
      admin build 通过；deploy 脚本 `bash -n` 通过。
