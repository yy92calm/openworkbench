# Changelog

本项目的版本维护约定见 AGENTS.md「工程规范 → 版本约定」：以根
`package.json` 的 `version` 为单一版本源，功能变更 bump patch，UI/交互大改
bump minor；发版时打 `v<version>` git tag 并将本条「Unreleased」归档为对应版本。

## [Unreleased]

### Added（工程底座）

- 统一格式化与 lint 门禁：prettier（`.prettierrc.toml`）、markdownlint
  （`.markdownlint-cli2.yaml`）、editorconfig；eslint 8 legacy → 9 flat config
  （`eslint.config.mjs`），覆盖全仓（apps / packages / relay / client）。
- 根聚合脚本：`format` / `format:check` / `lint` / `lint:fix` / `typecheck` /
  `test` / `md:check`（对称 check 对，CI 与本地同源）。
- GitHub Actions CI（`.github/workflows/ci.yml`）：路径感知 + 分 job，
  本地 actionlint 静态校验通过（真实运行待有远端后验证）。
- devcontainer（`.devcontainer/`）：Node 20 + pnpm 开发容器。
- packages/sdk 测试：基于 mockServer 的事件归一化与 session 生命周期测试。
- 存量清理：全仓 unused import / 死代码（`startApi` 等）、4 处延迟
  `require()` 改为顶层 import、`RoomsPage` 订阅 effect 依赖修正（onLeave ref）。

### Fixed

- 修复 2 个既有失败的 desktop 测试（SessionPage not-found、CommandPalette
  open）：jsdom 测试环境缺少 Electron preload 桥，AppShell 级测试挂载
  Sidebar 时订阅 IPC 事件崩溃。测试 setup 现提供 noop `window.electronAPI`
  stub（`on*` 返回退订函数，其余方法返回 resolved Promise）。
  desktop 测试 255/255 全绿。

### Docs

- AGENTS.md 新增「工程规范」节（格式化 / lint / CI / 测试 / 版本约定，含豁免说明）。
- 修正 scripts/README.md 中过时的 Tauri 描述。
