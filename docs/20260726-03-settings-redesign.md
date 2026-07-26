# 设置页面重新设计

## 背景

当前 `SettingsPage.tsx` 存在四类问题：

1. **布局单薄**：6 张卡片纵向平铺，无分组导航，项一多即混乱。
2. **功能缺口**：`DataFlowCard`（隐私数据流）已实现却未接入；缺「关于 / 检查更新 / 导出日志」等桌面 shell 基础项（`updater.ts`、`logging.ts:exportDebugLogs` 的能力够不到 UI）。
3. **已知 bug**：`SettingsPage.tsx` Language 选项有两个 `{ value: "zh-CN" }`（`中文` + `简体中文`），`key` 冲突且功能重复；「默认展开思考与工具」文案硬编码中文，未走 `t()`。
4. **主题不完整**：只有 light/dark，缺「跟随系统」（`initialTheme` 仅在首次启动读取系统偏好，保存后不再跟随）。

## 设计

### 布局：左侧分组导航 + 右侧内容

改为双栏：左侧 `w-52` 分组列表，右侧 `flex-1` 内容面板。窗口最小宽度 800，双栏可常驻不回退。分组：

| 分组 | 内容 |
|------|------|
| 通用 | 语言、主题（light / dark / 跟随系统）、默认展开思考与工具 |
| 运行时 | agent runtime 连接、运行时引擎（opencode / claude-code）、默认模型 |
| 工作区 | 工作区根目录、更改 / 打开 |
| 隐私与数据 | 接入既有 `DataFlowCard`（保留其英文文案，与架构强绑定，后续单独 i18n） |
| 关于 | 应用名（渠道）、应用标识、版本号、检查更新、导出日志 |

### 修复项

- **Language 去重**：移除重复的 `zh-CN` 项，`key` 用 `lang.value` 保证唯一。
- **i18n 一致**：所有新增与既有文案走 `t()`，补齐 `i18n.tsx` 的 `en` / `zh-CN` 两条目。
- **主题加 system**：
  - `Theme` 类型加 `"system"`；`initialTheme` 接受 `system`；`setTheme` 持久化 `system`。
  - `ThemeProvider` 解析 `system` → 实际 `light`/`dark`（读 `matchMedia`），并监听 `prefers-color-scheme` 变化实时切换；`document.documentElement.dataset.theme` 仍只写 `light`/`dark`，CSS 不变。
- **关于卡片的数据来源**：
  - 应用名 / 标识：复用既有 `channelName` / `appIdentifier` IPC。
  - 版本号：新增 `app-version` IPC（`main/ipc.ts` → `app.getVersion()`），经 preload / electron 封装到 renderer。
- **检查更新 / 导出日志**：`electron.d.ts` 已声明 `checkForUpdates` / `exportLogs`，在 `renderer/lib/electron.ts` 补封装后接入按钮。

### 不做

- 不改 provider / model / skills / permissions 的可编辑性（config-driven 设计意图）。
- 不对 `DataFlowCard` 文案做 i18n（文案与架构强绑定，单独迭代）。
- 不新增字体大小、紧凑模式等外观项（非本次目标）。
- 不改设置页路由（仍是 `/settings`）。

## 验证状态

- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 199/199 不回归。
- [x] `pnpm lint`：本次改动文件 0 error（`ipc.ts`/`scheduler.ts` 既存的 4 个 `require()` error 与本次无关）。
- [ ] 左导航切换五组内容正常；窄窗口不溢出。（待人工验证）
- [x] Language 仅一项 `zh-CN`（去重），切换中英文即时生效。
- [ ] 主题选「跟随系统」后，系统切换深浅色 app 实时跟随。（待人工验证）
- [ ] 「关于」显示应用名 / 标识 / 版本；「检查更新」「导出日志」可点。（待人工验证）
- [ ] DataFlowCard 在「隐私与数据」分组正确渲染。（待人工验证）
