# Workbench 用户级 Patch 覆盖层方案

日期：2026-08-14，序号 01

## 背景

参考 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT，开发者预览，41.3k stars）的插件生态设计。
Harness 基于 Cordis 框架，以「一切皆插件」为架构：模型适配器、工具注册表、会话日志、agent 主循环全部是插件，没有特权核心；
一个运行中的 harness 是由启动时叠加的分层插件树组成的——**bundle（出厂层）、profile patch、home 层 patch、命令行 overlay**，
上层按行 id 精确替换或插入下层配置，`--dump-config` 输出最终树。

对照 Workbench 现状，核心矛盾有三点：

1. **全镜像 + 修剪**：`apps/desktop/src/main/syncDir.ts` 每次 sidecar 启动把 `app-config/.opencode` 整体镜像到 app 私有配置目录，目标里任何不存在的增量都被删除（syncDir.ts:14-19 prune）。用户在应用使用期间的任何个性化修改（模型、MCP、提示词、UI 偏好）下次启动即被抹掉。
2. **API key 硬编码在 profile**：`app-config/.opencode/opencode.json` 内含 apiKey 明文，随镜像直接 deploy，与项目自身 guardrail「API keys 不随导出项目流出」冲突。
3. **无配置来源审计**：没有任何「这份配置是哪个层、哪个版本产生」的痕迹，与项目合规文化不符。

本方案不引入 Cordis 插件树，只借鉴其**「层叠可覆盖」的配置哲学**：Workbench 的 agent 运行时是 OpenCode sidecar，加载不可改，因此把「多层合成一份最终配置」放在部署阶段完成。

## 设计

### 1. 三层配置模型

| 层 | 来源 | 位置 | 可写 | 生命周期 |
|----|------|------|------|----------|
| Base（出厂） | `app-config/.opencode` | packager 仓库 | 否（只读镜像） | 随应用版本 |
| User（用户层） | 用户偏好 | app 私有配置目录 `user/` 子目录 | 是 | 持久 |
| Runtime overlay | 会话内临时 | 内存 | 是 | 随会话 |

部署顺序：**base 镜像 → user 覆盖 → 写最终配置**。OpenCode 仍只读到一个合并后的目录，行为不变。

### 2. User 层形态：覆盖声明 `user/patch.json`

采用 RFC 6902 JSON Patch 语义，声明指向 base 文件：

```jsonc
{
  "target": "opencode.json",
  "patch": [
    { "op": "replace", "path": "/model", "value": "ali/deepseek-r1" },
    { "op": "add", "path": "/mcp/xxdata",
      "value": { "type": "remote", "url": "…", "enabled": true } },
    { "op": "remove", "path": "/mcp/etf" }
  ]
}
```

部署时：读 base → 顺序应用 patch → 校验 → 写合并结果。**确定性、可 diff、可回滚、可审计**。

选择 RFC 6902 而非「深合并」的理由：深合并对数组等语义无统一定义，版本间行为易漂移；RFC 6902 操作原子、语义固定。

### 3. 权限收敛（安全红线）

`permission` 字段**禁止扩展到比 base 更宽松**。patch 引擎对白名单键做策略约束：

| 键 | 规则 |
|----|------|
| `model` / `provider` / `mcp` | user 胜出 |
| `permission` | 只允许收紧（base allow → user deny 有效；反向拒绝） |
| `instructions` / `agents/*` / 关键 skill | 默认不可 patch，除非 base 显式开放对应开关 |

### 4. 不破坏现有镜像逻辑

`syncDir.ts` 保持原样管理 base；新增部署三步：base 镜像 → 应用 `user/patch.json` → 校验。镜像照旧修剪 base 侧；只有 `user/` 目录被明确排除在 prune 之外。

### 5. 审计与指纹

每次部署落一份 `deployed-manifest.json`：base 指纹 + patch 指纹 + 合并后的 opencode.json 摘要。应用设置页显示「当前层：base vX + user patch vY」，与 script-run 审计风格一致。

### 6. 交互层：数据驱动进 patch，代码能力用 keyed renderer

交互面按「数据驱动」与「代码能力」两类分别处理：

#### 数据驱动（进 patch 层，零新代码）

这些本质是「值」，与 model/MCP 是同一回事，直接扩展进 `user/patch.json`：

- 主题/外观：颜色、字体、密度
- 面板可见性与布局：tab 显隐、sidebar 顺序、默认展开态
- 渲染偏好：markdown 高亮开关、图表默认类型（接入现有 `chartPalette`/`tableChart`）

落地方案：UI 初值来源顺序改为 `patch → 内置默认`，设置页改动写回 user 层，同走 manifest，可审计回滚。

#### 代码能力（keyed renderer 注册表）

例如让 Thread 对某 agent 的输出渲染专用卡片（合规结果卡、财务表格卡），而非通用 markdown。这类是组件，patch 文件表达不了。参考 Harness 的 `ConversationNodeDefinition` + keyed renderer：

```ts
type ChatNodeRenderer = { type: string; component: React.FC<Props> }
registry: { "markdown": MarkdownRenderer, "table": TableRenderer, ... }
```

扩展路径：

1. profile 声明 `interaction/` 渲染器清单（type 名 + 渲染源）
2. 部署时随 `.opencode` 一起同步，renderer 以「轻量声明格式」（HTML 模板 / 受限 DSL）下发
3. UI 注册表按 key 加载；不支持的 type 退化到 markdown 渲染，不白屏

**关键取舍**：不引入「profile 里塞 React 源码再编译」。renderer 做受控声明式子集，复杂交互仍在主仓库内开发、profile 只做开关与参数，避免破坏「前端 / 桌面壳 / agent 运行时解耦」的架构红线。

### 7. 实施阶段与范围

第一批（config patch 管道，验证链路）：

- `packages/shared` 加合并引擎（base merge + patch apply + 权限策略校验），纯函数可单测
- main 进程 deploy 插入一步；先只放 `opencode.json` 单一目标
- agent / skill 文件级覆盖走 user 目录同名文件
- 设置页加「个性化」面板 + manifest 展示

第二批（交互层）：

- keyed renderer 注册表 + profile 渲染清单
- patch 驱动主题 / 布局 / 渲染默认值

快捷键与命令面板联动**不在本期范围**，延后实施。

### 8. 待决项

- **renderer 目标用户**：是仅内部使用（数字分身项目 + Workbench），还是需要第三方上传渲染器？决定 renderer 采用「受控声明式」还是「开放沙箱」，安全模型完全不同。本方案暂按「受控声明式」设计。

## 验证状态

### 已完成的调研

- [x] DeepSeek Harness 仓库通读：README / architecture.md / adding-a-package cookbook，提取 profile/bundle/patch 分层、seam 三件套、keyed renderer 机制。
- [x] Electron 模块化对比：进程边界（main/renderer/preload）vs 插件合成（Cordis 服务树），确认本项目「Electron 壳 + sidecar」是进程隔离的解耦路线。
- [x] 本项目现状核对：`syncDir.ts`（全镜像 + 修剪）、`app-config/.opencode/opencode.json`（MCP/模型/权限结构）、`app-config/.opencode/AGENTS.md`（Agent 与技能清单）、渲染层目录结构（settings / thread / sidebar / code-viewer / tableChart 等）。
- [x] 范围确认：快捷键/命令面板联动剔除出本期方案。

### 实施记录

#### 2026-08-14 第一批（config patch 管道）

本轮实施范围：第一批全部 + 设置页「个性化」面板。二批（keyed renderer）未实施。

| 验收项 | 验证方式 | 状态 |
|--------|----------|------|
| merge 引擎 | `packages/shared/src/patchOverlay.ts`：`contentHash`（FNV-1a）/ RFC 6902 全操作 applyOp / `applyProfilePatch`（instructions 禁改、permission 只许收紧、非 opencode.json 目标拒绝）/ `validateProfilePatch` 干跑校验 | 已实施 |
| merge 引擎单测 | `src/main/patchOverlay.test.ts` 13 用例：模型替换 / MCP 增删 / move / permission 放宽拒绝（ask→allow、deny→ask）/ 收紧通过 / instructions 拒绝 / 非法目标拒绝 / 输入不可变 / 校验函数 | 已实施，13/13 通过 |
| deploy 接入 | `src/main/profilePatch.ts`：user 层 `userData/opencode-user/`（镜像目标之外，天然免被 syncDir prune）；`applyUserOverlay` = user 文件覆盖 → patch.json 应用 → manifest 落盘；`server.ts:deployBundledProfile` 在 syncDir 之后、applyUserProviderConfig 之前注入 | 已实施 |
| 设置页「个性化」面板 | 新增 profile tab + `ProfileSection`：manifest 指纹展示（base/patch/merged/时间/文件覆盖）+ patch.json 编辑器（store 草稿持久化，写入前经 IPC 结构校验） | 已实施 |
| IPC 与桥接 | `ipc.ts` 注册 `profile-manifest` / `profile-write-patch`（错误以 `{ok,error}` 返回）；preload、electron.d.ts、`electron.ts`、`tauri.ts` 全链路补齐 | 已实施 |
| 现有测试不退化 | `pnpm typecheck` 通过；`pnpm test` 32 文件 234 用例全过；改动文件 lint 0 error | 通过 |

#### 2026-08-14 第二批（交互层：keyed renderer + UI 偏好 patch）

| 验收项 | 验证方式 | 状态 |
|--------|----------|------|
| interaction 结构类型 | `packages/shared/src/interaction.ts`：`RendererManifest` / `UiDefaults` / `InteractionConfig`；`parseRenderersJson`（丢弃无 type 项、容忍坏输入）、`parseUiDefaultsJson`（仅白名单键 + 类型校验） | 已实施 |
| interaction 解析单测 | `patchOverlay.test.ts` 新增 5 用例：合法清单 / 非法项丢弃 / 空输入容错 / UI 白名单 / 类型错误忽略 | 已实施，全部通过 |
| main 读取已部署 interaction | `profilePatch.ts:readInteractionConfig(target)`：读 `target/interaction/renderers.json` + `ui.json`，坏文件降级为空；`server.ts` 导出 `deployedProfileDir()` 复用目标路径 | 已实施 |
| IPC 桥接 | `ipc.ts` 注册 `profile-interaction`；preload、electron.d.ts、`electron.ts`、`tauri.ts` 全链路补齐（web 构建返回空配置） | 已实施 |
| keyed renderer 注册表 | `renderers.tsx`：`renderWorkbenchFence(type, raw, enabled)` 按注册表分派，内置 `kv-card`（受控声明式，仅应用内置组件；profile 只开关不载代码）；未知/未启用 type 返回 null 退化 | 已实施 |
| MarkdownViewer 接线 | code 分支拦截 `workbench:<type>` fence；未匹配退化普通代码块；同时修复 hljs 对未知语言标签抛 `Unknown language` 使线程崩溃的既有缺陷（try/catch → highlightAuto） | 已实施 |
| UI 偏好 patch | `store.ts:initInteraction()` 按「用户 localStorage > profile ui.json > 内置默认」应用 theme/locale/expandThreadDetails；`runtime.ts:bootstrap` 启动异步加载不阻塞运行时 | 已实施 |
| 设置页展示 | 「个性化」页新增「启用渲染器」卡（list 渲染）+ ui 默认值展示 | 已实施 |
| 示例 manifest | `app-config/.opencode/interaction/renderers.json`（启用 kv-card）+ `ui.json`（expandThreadDetails 默认）随 profile 自动部署 | 已实施 |
| 单测 | `renderers.test.tsx` 5 用例（未注册退化 / 扁平对象 / 数组行 / 单键标题 / 坏 JSON 兜底）；`MarkdownViewer.test.tsx` 3 用例（分派 / 未启用退化 / 未知 type） | 已实施，全部通过 |
| 现有测试不退化 | `pnpm typecheck` 通过；`pnpm test` 34 文件 247 用例全过；本次改动文件 lint 0 error（产线既有 4 个 no-require-imports error 与 ModelsSection unused warning 非本次引入） | 通过 |

待后续：renderer 开放给第三方时的沙箱安全模型（暂按受控声明式）。

### 不包含范围

- 不引入 Cordis 或任何插件框架运行时。
- 不实现运行态热替换（需重启 sidecar 生效）。
- 不引入 profile 内 React 源码编译。
- 快捷键 / 命令面板联动本期不做。
