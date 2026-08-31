# 设置页内嵌配置对话方案

日期：2026-08-14，序号 02

## 背景

第一/二批已落地用户级 patch 覆盖层（`userData/opencode-user/patch.json`，RFC 6902）与 keyed renderer 注册表。现状下最终用户改配置只能手写 JSON（设置 → 个性化 → patch.json 编辑器），门槛高、易错、不直观。

目标：在设置页提供**内嵌对话**，用户用自然语言描述改动（"把默认模型换成 deepseek-r1"、"停用 etf 这个 MCP"），由 agent 生成 patch，经 main 进程硬校验后落到用户层。同时**限制 agent 的修改范围**，防止它越权写 base profile 或放宽权限。

### 架构约束（已核实，非推断）

1. **无法按会话指定 agent**：OpenCode SDK 的 `sendPrompt(sessionId, text)` POST `/session/:id/prompt_async`，请求体 `{parts:[...]}` 无 agent 字段；`runCommand` 的 `command` frontmatter 可带 `agent`，但那是斜杠命令模板，不适用自由对话。结论：**"专属受限 agent"在当前 runtime 下不能靠会话隔离实现**。
2. **agent 默认权限是 allow**：当前 profile `opencode.json` 里 `permission.*` 为 allow、`external_directory` 也 allow，配置对话的 agent 理论上能写任意路径。
3. 现有硬防线：`applyProfilePatch` 禁止改 `/instructions`、`permission` 只许收紧、`target` 仅 `opencode.json`；`writeUserPatch` 做结构校验；`applyUserOverlay`（部署时）再次校验并写 `deployed-manifest.json`。

### 范围判定（设计选型）

在"让用户对话改配置"与"限制 agent 范围"之间，不采用自欺式的前置隔离（约束 prompt 后宣称安全），而是采用**后置通道白名单 + 硬校验**，这是本约束下的稳妥解：

- agent 的修改**永不直接落盘**：它只产出结构化 patch（约定格式 `workbench:config-patch` 围栏块）。
- UI 只认这个围栏块，提取 JSON 后交给 main 进程**干跑校验**（复用 `applyProfilePatch`）。
- 校验通过才写 user 层；失败把原因回显到对话里（权限放宽 / instructions / JSON 语法，逐条人话）。
- 即使 agent 越权调 bash/write 写了别处，硬防线保证：base 每次启动被镜像覆盖（写不持久）、user 层写不进（`writeUserPatch` 结构校验 + 下一次 `applyUserOverlay` 全量重校验 + rootfs 外 manifest 留痕）。

## 设计

### 1. main 进程：新增 `profile-validate-patch` IPC

对给定 patch 文本做**保存前干跑**，返回逐条人类可读错误，不落盘、不改文件：

```ts
ipcMain.handle("profile-validate-patch", (_e, raw: string) => {
  try {
    const base = 从已部署 target 读 opencode.json（缺省 "{}"）;
    const ops = validateProfilePatch(base, raw); // 结构 + 干跑 applyProfilePatch
    return { ok: true, ops: ops.length };
  } catch (err) {
    return { ok: false, reasons: humanizePatchError(err) }; // 摸错分组
  }
});
```

`humanizePatchError`：把 `PatchPolicyError` 分成三类——权限放宽、instructions 禁改、目标文件不允许、JSON 语法 / 缺少字段。复用现有错误类型，不新增领域。

### 2. 设置页：内嵌配置对话面板

设置 → 个性化 新增「配置对话」卡片：

- 输入框（复用 Composer 风格，`textarea` + Enter 发送）。
- 发送时给 prompt 加**固定约束前缀**（注入对话，约束 agent 只产出 patch 围栏，不提文件操作）。
- 回复渲染复用 `MarkdownViewer`；回复内若出现 `workbench:config-patch` 围栏，UI 提取 JSON → 调 `profile-validate-patch`。
- 校验成功：显示"已保存，重启运行时生效"，并把文本写进现有 patch 编辑器（打通第一批 UI）。
- 校验失败：把 `reasons` 逐条以错误样式回显，且绝不落盘。
- 面板有显式文案声明边界："agent 只能生成配置差异，不能直接改文件；权限只能收紧"。

不建独立会话：直接复用当前主会话 `sendPrompt`（history 里有上下文，用户也看得到改动对话全过程）。约束前缀保证只产出 patch 块。

### 3. 对话约束前缀（prompt 侧限制）

```text
你正在帮助用户修改本应用的 OpenCode 配置。规则：
1. 只允许对 opencode.json 输出配置修改，且必须产出以下格式的 fenced code block：
   ```workbench:config-patch
   {"target":"opencode.json","patch":[ {"op":"replace","path":"/model","value":"<provider>/<model>"} ]}
   ```

1. patch 必须是 RFC 6902 操作。permission 只能收紧（allow→lower），不允许放宽容限。
2. 禁止修改 /instructions。禁止其他任何文件操作、bash、网络请求。
3. 若用户要求的内容不在白名单内（模型、MCP 增删改启停、外观类键），说明做不到并建议人工。

```text

白名单字段与 patch 校验列并行维护（model/provider/mcp/permission 收紧/ui 相关键）。

### 4. UI 偏好（沿用第二批）

对话改完只有 opencode.json 维度。theme/locale/expandThreadDetails 这类 UI 默认仍走 `interaction/ui.json`，不在对话范围。若用户对话提出 UI 偏好，约束前缀引导其改 profile 文件（打包者职责），不落 user 层。

### 5. 不做的事（显式排除）

- 不做"独立受限 agent 会话/沙箱"：运行时不支持会话级 agent，伪沙箱比没有更危险。
- 不做 agent 直接写 user 层：一切写路径经过 main 校验。
- 不做 renderer 热新增：新卡片类型仍需主仓库发版（受控声明式模型边界）。

## 验证状态

### 已完成的调研

- [x] OpenCodeClient 发送链路：`sendPrompt`（无 agent 字段）、`runCommand`（command 带 agent，但模板化）、`createSession`（目录作用域）。
- [x] 会话与 agent 关系：sidecar 按当前 agent 处理 prompt；agent 由 profile `agents/*.md` frontmatter 约束 model/tools/mcp。
- [x] 现有硬防线核对：`applyProfilePatch`（instructions 禁改 / permission 收紧 / target 限定）、`writeUserPatch`（结构校验）、`applyUserOverlay`（部署重校验 + manifest）。
- [x] 白名单字段范围：model / mcp / permission 收紧 / 等 patch 校验已覆盖键。
- [x] 设置页「个性化」现状：manifest 指纹 + patch 编辑器 + 渲染器清单展示（第一批/二批）。

### 实施记录（2026-08-14）

| 验收项 | 验证方式 | 状态 |
|--------|----------|------|
| `humanizePatchError` + `PatchRejection` | `packages/shared/src/patchOverlay.ts`：错误分四桶（permission / forbidden-path / syntax / target / unknown） | 已实施 |
| `profile-validate-patch` IPC | `profilePatch.ts:validateUserPatch` 干跑 `validateProfilePatch`，不落盘；ipc.ts 读取已部署 opencode.json 作 base；preload/d.ts/electron.ts/tauri.ts 全链路 | 已实施 |
| 对话约束前缀 | `runtime.ts:CONFIG_PROMPT_PREFIX`（只能产出 workbench:config-patch 围栏 / 禁止文件/bash/网络 / permission 仅收紧）+ `sendConfigPrompt` | 已实施 |
| fence 提取 | `renderers.tsx:extractConfigPatch`（取最后一个围栏、流式中未闭合返回 null） | 已实施 |
| 设置页「配置对话」卡片 | `SettingsPage.tsx:ConfigConversation`：输入 + 发送 + 订阅当前会话线程 → 提取 → main 干跑校验 → 成功镜像进 patch 编辑器 / 失败逐条回显，绝不落盘 | 已实施 |
| 单测 | `patchOverlay.test.ts` 新增 humanize 4 用例（22 总）；`renderers.test.tsx` 新增 extract 4 用例（9 总） | 已实施，全部通过 |
| 现有测试不退化 | `pnpm typecheck` 通过；`pnpm test` 34 文件 255 用例全过；本次改动 lint 0 新增错误（产线既有 4 个 no-require-imports error 非本次引入） | 通过 |

### 不包含范围

- 不做会话级专属 agent / 沙箱隔离。
- 不做复杂对话 UI（无历史折叠、无流式专用渲染，复用现有 MarkdownViewer）。
- 不做 UI 偏好的对话修改（走 `interaction/ui.json`）。
