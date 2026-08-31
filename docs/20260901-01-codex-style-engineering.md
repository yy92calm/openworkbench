# 借鉴 Codex 工程风格优化 Workbench 工程底座

## 背景

Workbench 的功能已较完整（desktop / relay / client 三项目），但工程基础设施
滞后：无 CI、无 devcontainer、无统一的格式化与 lint 门禁（eslint 仅 desktop 且为
8 legacy 格式，relay / client / packages 零 lint），根 package.json 脚本只转发
desktop，版本号全仓锁死 0.1.0 无 CHANGELOG，packages/sdk 零测试。

参考 OpenAI Codex 源码仓库（`~/Desktop/codex-main`）的工程风格，提炼可迁移到
TypeScript/Electron 项目的要素：

- **配置即文档**：配置文件（.bazelrc / .prettierrc 等）带动机注释，读者一眼知道每条配置为什么存在。
- **对称 check 任务对**：`fmt` / `fmt-check` 成对提供，本地执行与 CI 复用同一入口。
- **CI 合并门 + 路径感知**：PR 轻量检查、按变更路径只跑相关 job、fail-fast:false + 显式 timeout。
- **AGENTS.md 按子系统分节**：规则带出处、写明「何时可豁免」。
- **版本单一源**：CHANGELOG 外链式维护，版本约定写入项目规范。

## 目标

借鉴以上风格，为 Workbench 补齐工程底座，使：统一格式化与 lint 门禁覆盖全仓、
CI 配置就绪（本地静态校验）、开发容器可用、版本与变更记录有约定、sdk 核心逻辑有测试。

不改动三项目架构（relay / client 保持独立 workspace，AGENTS.md 架构护栏不变）。
不新增多余文档（除方案文档与 CHANGELOG）。全部改动不自动 git commit。

## 设计

### 阶段 1：工程底座 —— 统一格式化与 lint（配置即文档）

根级新增配置（均用支持注释的格式，带动机注释，仿 Codex `.bazelrc` 风格）：

| 文件 | 内容 |
| --- | --- |
| `.prettierrc.toml` | printWidth 100、proseWrap preserve（不重排中文文档段落）、单引号等与现有代码习惯一致 |
| `.prettierignore` | 排除 `node_modules/`、构建产物（`out/`、`dist/`）、`docs/` 中文方案文档（中文文档由 markdownlint 管理） |
| `.editorconfig` | 缩进 2 空格、utf-8、LF，覆盖 ts/tsx/js/json/md/yaml |
| `.markdownlint-cli2.yaml` | 仅放宽 MD013 行宽（对齐 prettier 的 100），其余规则默认 |
| `eslint.config.mjs` | eslint 9 flat config：@eslint/js + typescript-eslint + react-hooks/react-refresh + simple-import-sort |

- 删除 `apps/desktop/.eslintrc.cjs`（eslint 8 legacy），eslint 9 及插件装根 devDependencies。
- relay / client 是独立 workspace（自持 node_modules），但 eslint 配置从仓库根向上
  查找即可生效，无需改动它们的 workspace；统一从根目录跑 `eslint apps packages relay client scripts`。
- 存量修复：全仓 lint error 清零、import 排序 autofix、prettier 全仓代码文件一次性格式化
  （首次格式化 diff 较大属预期，一次到位）。
- 根 package.json 聚合脚本（对称 check 对）：

```jsonc
"format":        "prettier --write .",
"format:check":  "prettier --check .",
"lint":          "eslint .",
"lint:fix":      "eslint . --fix",
"typecheck":     "pnpm -r typecheck",          // 覆盖根 workspace 各包
"test":          "pnpm -r test",               // desktop + relay + sdk
```

`typecheck` / `test` 用 `pnpm -r` 聚合根 workspace 内所有包；relay 是独立 workspace，
在 `typecheck` / `test` 脚本中显式补跑 `pnpm --dir relay typecheck` 与
`pnpm --dir relay test`（同理 client 无 test 脚本，只补 typecheck）。

### 阶段 2：CI（仅本地配置 + actionlint 校验）

新增 `.github/workflows/ci.yml`，单文件合并门，注释写明策略（配置即文档）：

- **路径感知**：用 `dorny/paths-filter` 检测 desktop / relay / client / 根配置的变更，
  只触发相关 job（root 变更触发全部）。
- **job 划分**：repo-checks（markdownlint + prettier check + actionlint）、lint（eslint 全仓）、
  typecheck（desktop / relay / client 分 job）、test（desktop / relay / sdk 分 job）。
- **通用配置**：`fail-fast: false`、每个 job 显式 `timeout-minutes`、pnpm 9.4.0 +
  node 20 + pnpm store 缓存（composite action 或 step 复用）。
- 项目无 GitHub 远端，不推送；用 actionlint 本地静态校验 workflow 语法，真实运行
  留待有远端后验证。

### 阶段 3：devcontainer

新增 `.devcontainer/devcontainer.json` + `Dockerfile`：node 20 + pnpm + git + 常用工具，
post-create 执行 `pnpm install`（仿 Codex devcontainer 分层思路的轻量版）。

### 阶段 4：版本与 CHANGELOG 机制

- 新增根 `CHANGELOG.md`：外链式风格（记录 unreleased 变更条目，正式发布时归档）。
- AGENTS.md 增加「版本约定」：以根 package.json `version` 为单一版本源；功能变更
  bump patch、UI/交互大改 bump minor；发版时打 `v<version>` tag 并在 CHANGELOG 归档。

### 阶段 5：packages/sdk 补测试

- sdk 加 `vitest` devDependency（node 环境，无需 jsdom）。
- 利用现有 `packages/sdk/src/mockServer.ts`（OpenCode 协议 mock server）写核心测试：
  - `OpenCodeClient` 事件归一化：`message.part.updated` → `text.updated` / `tool.updated`。
  - session 创建与 `session.idle` / `session.error` 生命周期。
- `packages/shared` 若有可测纯函数则补 1-2 个测试（视内容而定，不硬凑）。

### 阶段 6：AGENTS.md 升级

- 新增「工程规范」节：格式化 / lint / CI / 测试 / 版本约定，每条写明适用场景与
  「何时可豁免」（仿 Codex AGENTS.md 风格，规则带出处不教条）。
- 修正 `scripts/README.md` 中过时的 Tauri 描述为 Electron（该文件与当前架构不符）。

## 涉及文件

| 文件 | 改动 |
| --- | --- |
| `.prettierrc.toml`、`.prettierignore`、`.editorconfig`、`.markdownlint-cli2.yaml` | 新增（根级） |
| `eslint.config.mjs` | 新增（eslint 9 flat） |
| `apps/desktop/.eslintrc.cjs` | 删除（迁移至根 flat config） |
| `package.json` | 聚合脚本 + devDependencies |
| `.github/workflows/ci.yml` | 新增 |
| `.devcontainer/devcontainer.json`、`.devcontainer/Dockerfile` | 新增 |
| `CHANGELOG.md` | 新增 |
| `packages/sdk/package.json` + 新增测试文件 | vitest + 测试 |
| `AGENTS.md` | 工程规范节 + 版本约定 |
| `scripts/README.md` | 修正 Tauri → Electron 描述 |
| 全仓 ts/tsx 代码 | prettier / eslint autofix 一次性格式化 |

## 验证状态

- [x] `pnpm format:check` 全仓零 diff
- [x] `pnpm lint` 全仓 0 error 0 warn
- [x] `pnpm typecheck`（desktop / relay / client / packages）全通过
- [x] `pnpm test`：desktop **255/255 全绿**（含此前 2 个既有失败测试——测试 setup
  补 `window.electronAPI` noop stub 后已修复，见下文）、relay 22 通过、sdk 3 通过
- [x] markdownlint 全仓通过（MD013 放宽 240 + tables 豁免；存量 264 处违规已一次性修复）
- [x] actionlint 校验 `ci.yml` 通过
- [ ] CI 真实运行（待有 GitHub 远端后验证）

### 实施中的额外发现与处理

- **eslint 9 迁移暴露存量问题**：移除 desktop 旧 eslint 8 配置后，全仓 lint 从 3592 个问题降到 0。
  除机械的 import 清理外，还修复了：`RoomsPage` 订阅 effect 的依赖缺失（onLeave 改为 ref 模式）、
  `TerminalPanel` effect 缺 `getTerminalTheme` 依赖、4 处延迟 `require()` 改为顶层 import
  （`./fetch` 的延迟加载保留并加豁免注释）、`packages/scheduler` 的 `startApi` 死函数删除
  （desktop 实际使用自己的 `scheduler.ts`，该包未被消费）。
- **sdk 包首次独立 typecheck 暴露类型漂移**：`AgentRuntimeEvent` 联合缺少
  session.updated / session.status / session.compacted 三个事件（OpenCodeClient 会发出，
  factory 的 no-cast 契约检查抓到了）；`ContentBlock` 联合中 `Record<string, any>` fallback
  破坏判别收窄；`declare module` shim 与真实 SDK 类型冲突（已删除，改用真实类型）；
  `shared/patchOverlay.ts` 的 `op.from` 访问需判别收窄。
- **mockServer 增强**：`DELETE /session/:id` 现在真正移除会话（此前静态返回），
  使 session 生命周期测试可验证删除语义。
- **2 个既有失败测试修复**（SessionPage not-found、CommandPalette open）：
  根因是 jsdom 测试环境缺少 Electron preload 桥——AppShell 级测试挂载 Sidebar
  时其 effect 直接访问 `window.electronAPI.onRelayRemoteSessionsChanged` 崩溃。
  在 `test/setup.ts` 增加 noop `window.electronAPI` Proxy stub（`on*` 返回退订
  函数、其余方法返回 resolved Promise），desktop 测试从 253+2 失败变为 255 全绿。
- **markdownlint 配置**：MD013 放宽到 240（中文长行）+ `tables: false`（表格不可断行）；
  排除 `release/`、`app-config/`、`DEPLOYMENT.local.md`、`.zcode/`。
