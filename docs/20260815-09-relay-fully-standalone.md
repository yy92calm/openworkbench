# 20260815-09 · relay 彻底独立（自建 workspace）

## 背景

`docs/20260815-06` 把 relay 迁到仓库顶层 `relay/`，但仍是 pnpm workspace 成员：
构建/测试依赖主仓库 `node_modules` 与 `@workbench/client`，管理界面源码（`apps/admin`）
也不在 relay 目录内。用户要求 relay **彻底独立**：relay 目录自身可
`pnpm install` + 构建 + 运行，不依赖主仓库。

## 现状（调研结论）

- `relay/src/*` 零仓库内 import，服务器源码自洽；仅 **devDependency**
  `@workbench/client`（测试/E2E 用客户端连接器）需要仓库 workspace。
- 依赖链：`relay → @workbench/client → @workbench/sdk → @workbench/shared`。
  - `sdk` 的 `@anthropic-ai/claude-agent-sdk` devDep 仅 desktop 侧用到，relay 不需要。
  - client 的 `packages/sdk`（`OpenCodeClient`）与 `packages/shared`（类型）是生产运行依赖。
- 管理界面源码 `apps/admin`（Vite+React，base `/relayadmin/`）不在 relay 目录内；
  其生产构建产物已提交于 `relay/admin-web/`。
- 仓库内**无任何其他包 import relay**（desktop 用自己的 `relayHost.ts`）。
- `scripts/deploy-relay.sh` 目前构建 `apps/remote`（Web 客户端）+ `apps/admin`，
  并上传到服务器；`apps/remote` 本地不存在。

## 设计

### 目标结构

```
relay/                          ← 彻底独立（自建 workspace）
├── pnpm-workspace.yaml         ← packages: ["."]
├── pnpm-lock.yaml              ← 独立 lockfile（新增，提交入库）
├── package.json                ← 根包 @workbench/relay（server）
├── src/  test/  e2e-account.mjs  repro.mjs  admin-web/  README.md  .gitignore
├── admin/                      ← apps/admin 迁入（vite+react，源码）
└── client/                     ← client/ + packages/sdk + packages/shared 迁入
    ├── src/  …（原 client 源码）
    ├── sdk/                    ← 原 packages/sdk
    └── shared/                 ← 原 packages/shared
```

- `relay/.gitignore` 追加：`admin/dist/`、`client/dist/`（构建产物不入库，
  `admin-web` 保持入库）。
- 主仓库 `pnpm-workspace.yaml` 中移除 `"relay"`；主仓库 `pnpm-lock.yaml`
  由 pnpm 自动更新（脱钩后 relay 不再出现在主 lock）。
- 主仓库删除 `apps/admin/`、`client/`、`packages/sdk/`、`packages/shared/`。

### 包元数据调整

| 包 | 调整 |
| --- | --- |
| `relay/package.json` | devDep `@workbench/client` 改 `workspace:*` → 仍指向 `./client`（自建 workspace 内解析）；脚本不变 |
| `relay/admin/package.json` | 同 `apps/admin`，name 改 `@workbench/admin`，dependsOn client/sdk（如引用）保持 rel = ../../../…，build 输出 `../admin-web` |
| `relay/client/package.json` | deps `@workbench/sdk` `workspace:*`（解析到 ./sdk）、`@workbench/shared`（如需要）；devDeps 保留 |
| `relay/client/sdk/package.json` | deps `@workbench/shared` `workspace:*`；移除 `@anthropic-ai/claude-agent-sdk` |
| `relay/client/shared/package.json` | 保留，无 @workbench devDep |
| `relay/client/vite.config.ts`、`relay/admin/vite.config.ts` | alias `@` 改相对解析（移除 `fileURLToPath` 对仓库路径依赖）；admin `base: "/relayadmin/"`、`outDir` 改 `../admin-web` |
| `relay/src/…`、`relay/test/…` | 无改动（本来就只 import `@workbench/client`，workspace 内解析） |

### client 依赖检查

```bash
grep -rn "from \"@workbench\|from '@workbench" relay/client/src/ relay/client/sdk/src/ relay/client/shared/src/
```
按结果调整，全部指向 `@workbench/sdk` / `@workbench/shared`（workspace 内）。

### deploy 脚本

`scripts/deploy-relay.sh` 构建改为 `cd relay/admin && pnpm build`（输出
`relay/admin-web`，随后 rsync）；删除对 `apps/admin` / `apps/remote` 的构建上传。
`apps/admin/dist` → `relay/admin-web`（rsync 源改 `relay/admin-web/`）。

### 工作流

```bash
cd relay && pnpm install        # 首次
pnpm --filter @workbench/admin build   # 或 cd admin && pnpm build
RELAY_AUTH_TOKEN=… pnpm serve   # 服务器
```

## 验证

- [x] `relay` 目录 `pnpm install` 成功（独立 `pnpm-lock.yaml`，106 包，不读主仓库）。
- [x] `relay/admin` 构建成功，产物 `relay/admin-web` 与现提交哈希一致（base `/relayadmin/`）。
- [x] `relay` typecheck 0 错；`relay` 单测 22/22 全绿（含 `/relayadmin` 静态托管用例）。
- [x] 本地起 relay（独立 node_modules），`/relayadmin` 200、CSS 200、admin 登录 API 200。

  ⚠️ E2E（`e2e-account.mjs`）在 Node 25 下因 `RelayHttpTransport` 既有 bug
  （`Response body object should not be disturbed or locked`，可见于主仓库同源码）
  未通过——与本次独立化无关，列为遗留问题。
- [x] 主仓库 `pnpm install` 更新成功（7 项目，`relay` 不在主 lock）；
      desktop typecheck 0 错 + 完整构建通过（relayHost 改用相对路径 import relay 协议类型）。

## 风险与注意

- 双份 node_modules（主仓库 + relay 独立）：磁盘翻倍，属预期。
- 与主仓库 `packages/shared` / `packages/sdk` 将有**源码副本**（relay/client/shared、
  relay/client/sdk），后续主仓库更新需手动同步到 relay 版本（注释提醒）。
- relay 副本的 client typecheck 沿用主仓库既有错误（`OpenCodeClient.ts:728`、
  `patchOverlay.ts:155`），非本次引入，未修。
- `apps/remote` 保留在主仓库（移动端 Web 客户端），但不被 relay 独立构建使用；
  deploy 脚本已不再构建/上传它（`RELAY_STATIC_DIR` 一并移除）。
- 遗留：relay e2e 的 transport bug（见上）。