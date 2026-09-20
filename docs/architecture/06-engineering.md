# 06 · 工程底座

> 所属：架构现状系列 · [返回索引](./README.md)

## 1. 仓库布局与 workspace

```text
open-ai-workbench/
├── app-config/.opencode/     # 打包者 profile（本地、不进 git，随包分发）
├── apps/desktop/             # Electron + React 桌面壳
├── packages/                 # sdk / shared / browser-mcp / scheduler / terminal / ui
├── runtime/kernel/           # Python/R 桥（历史目录，主进程实现见 apps/desktop）
├── scripts/                  # dev 脚本 + deploy-relay.sh
├── relay/                    # 独立项目（自建 workspace：. + admin）
├── client/                   # 独立项目（自建 workspace：. + sdk + shared）
└── docs/                     # 方案文档（日期命名）+ architecture/（本系列）
```

三个 workspace 各自持有 `pnpm-lock.yaml`；根 workspace 只含 `apps/*` 与
`packages/*`。relay 与 client 源码不参与根 workspace 的构建，但根脚本会
分别进入它们执行 typecheck / test。

## 2. 质量门禁

根 `package.json` 的脚本是唯一真源，CI 调用同一组脚本：

| 命令 | 内容 | 配置 |
| --- | --- | --- |
| `pnpm format` / `format:check` | prettier 全仓（`docs/**/*.md` 豁免） | `.prettierrc.toml`、`.prettierignore` |
| `pnpm md:check` | markdownlint（MD013 放宽 240、表格豁免；`app-config/`、构建产物、`.zcode/` 排除） | `.markdownlint-cli2.yaml` |
| `pnpm lint` / `lint:fix` | eslint 9 flat，覆盖全仓（含 relay/client） | `eslint.config.mjs` |
| `pnpm typecheck` | `pnpm -r typecheck` + relay + client | 各包 tsconfig |
| `pnpm test` | `pnpm -r test` + relay test | vitest |
| `pnpm lint:skills` | skill 结构检查（SKILL.md 引用的 references/scripts 是否存在等） | `scripts/dev/lint-skills.mjs` |

CI（`.github/workflows/ci.yml`）为路径感知的分 job：格式/lint、desktop +
packages typecheck/test、relay、client 各自独立执行。

**注意**：`apps/desktop` 的 `typecheck` 是 `tsc --noEmit`，而它的 tsconfig 是
solution-style（`files: []` + references），不会检查 `src/main`/`src/renderer`；
实测该命令空跑退出 0。这是当前工程底座最大的漏洞，详见
[差异清单](./07-doc-code-gaps.md)。

## 3. 测试现状

| 范围 | 方式 | 覆盖重点 |
| --- | --- | --- |
| `apps/desktop` | vitest + jsdom | 渲染组件/页面、runtime store、消息轮次、artifact、表格/CSV/PPTX、折叠分组、滚动记忆、主进程纯函数（redact/schedulerGuards/snapshot/patchOverlay/relayHost keep-awake） |
| `packages/sdk` | vitest（node） | 基于 `mockServer.ts` 的事件归一化与 session 生命周期 |
| `relay` | vitest | 转发/并发/SSE/502、账号鉴权与隔离、设备列表、持久化、CLI、热重载踢连接、静态托管、admin API（22 用例） |
| `client` | 无单测 | 依赖 build/typecheck |

jsdom 环境在 `apps/desktop/src/renderer/test/setup.ts` 提供
`window.electronAPI` 的 noop stub（`on*` 返回退订函数，其余方法 resolve
undefined），使 AppShell 级组件可挂载；需要断言具体调用的测试自行覆盖该
属性或 `vi.spyOn`。

## 4. 版本约定

- 单一版本源：根 `package.json` 的 `version`；所有 workspace 包保持同号。
- 修 bug bump patch，UI/协议变更 bump minor；同 commit 更新 `CHANGELOG.md`
  的 Unreleased 段；发版时归档到对应版本并打 `v<version>` tag。
- sidecar 版本由 `scripts/dev/fetch-opencode.sh` 固定；DB 迁移指纹用
  `opencode --version`。

## 5. 脚本与部署

| 脚本 | 用途 |
| --- | --- |
| `scripts/dev/fetch-opencode.sh` | 拉取固定版本 opencode sidecar |
| `scripts/dev/fetch-whisper.sh`、`fetch-uv.sh` | 拉取 whisper 二进制 / uv |
| `scripts/dev/build-channel.sh`、`dev-channel.sh` | 渠道构建/开发 |
| `scripts/dev/sandbox-smoke-*.sh` | macOS/Linux 沙箱冒烟 |
| `scripts/deploy-relay.sh` | 构建 admin → 上传 relay → systemd 启动 |
| `apps/desktop/scripts/package-mac.sh` | typecheck + build + electron-builder --mac |
| `apps/desktop/scripts/mcp_scheduler.mjs` | 调度器 MCP server |
| `apps/desktop/scripts/rename-mcp.mjs` | 构建后处理浏览器 MCP 产物名 |

## 6. 文档约定

- 方案文档放 `docs/`，命名 `YYYYMMDD-NN-描述.md`，必须含「设计」「验证状态」
  两章；历史方案保留原样，不回改（结论与现状冲突时以代码与本系列为准）。
- 本系列放 `docs/architecture/`，只描述现状；修改代码时同步更新对应篇。
- 讨论语言为中文，代码与代码内注释保持英文；本系列默认简体中文。

## 7. 文件速查

| 主题 | 文件 |
| --- | --- |
| 门禁脚本 | 根 `package.json`、`.github/workflows/ci.yml` |
| 格式化/lint 配置 | `.prettierrc.toml`、`.prettierignore`、`.markdownlint-cli2.yaml`、`eslint.config.mjs`、`.editorconfig` |
| 版本 | 根 `package.json`、`CHANGELOG.md` |
| 开发脚本 | `scripts/dev/*`、`apps/desktop/scripts/*` |
