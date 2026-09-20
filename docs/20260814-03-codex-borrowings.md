# Codex（openai/codex）可借鉴项落地方案

日期：2026-08-14，序号 03

## 背景

对照 `~/Desktop/codex-main`（OpenAI Codex CLI 全源码，Rust 核心）五路调研结论：配置层叠、插件/skills 生态、审批沙箱、app-server 协议、上下文与补丁。总判断：**Codex 最值得抄的是"约束与配置分离"的安全结构与"审批疲劳治理"的体验结构**，恰好补在 Workbench 已建成的 patch 覆盖层（01 号方案）与配置对话（02 号方案）的短板上。

本方案界定可落地项与约束项，并给出实施范围。所有出处 `文件:行` 均已在调研中核实（对照 `codex-rs/` 路径）。

### 约束项（本次不实施，记录为能力缺口或 backlog）

| 项 | 原因 | 去向 |
|----|------|------|
| 审批疲劳治理（规范化命令缓存 + 规则沉淀） | OpenCode sidecar 黑盒，permission ask 决策在其内部，Workbench 无钩子 | OpenCode 能力缺口；若 sidecar 未来暴露审批中间件再做 |
| 反向请求注册表 / 重连重放 / relay seq+ack+cursor | 属 relay 独立项目（自有 workspace） | relay backlog |
| 热重载（仅 user 层窄通道） | 依赖 OpenCode 是否有等价 reload API，未验证 | 先验证 runtime 能力再投入 |
| bwrap/seatbelt 包裹 sidecar | OpenCode 对外部沙箱兼容性未验证 | 中期评估 |
| hooks trusted_hash / MDM 全家桶 | 本地单用户场景过度设计 | 不做 |
| workspace 提权路径硬拦截（.opencode/AGENTS.md 只读） | agent 的 write/edit 工具在 sidecar 内执行，Workbench 无拦截点 | 降级为提示性防御（见 2.2）+ 部署完整性告警（见 2.3） |

## 设计

### 1. requirements 红线层（对偶于 patch 配置层）

Codex 把"可协商配置"与"不可协商约束"做成两套堆栈（`config/src/config_requirements.rs`、`constraint.rs`），红线违规走类型级校验器。Workbench 落法：

- **`requirements.json`** 放 user 层目录（`userData/opencode-user/requirements.json`，可选文件，由打包者/管理员下发），结构：

```jsonc
{
  "forbiddenPaths": ["/instructions", "/provider"],  // patch 永不可触碰
  "permissionCeiling": { "bash": "ask", "edit": "ask" }  // 每键最高允许档
}
```

- **语义**：`forbiddenPaths` / `allowedTargets` 违规 = **硬错**（拒绝 patch）；`permissionCeiling` 违规 = **硬错**（对齐"红线不可协商"，不做静默降级，避免"以为钳住了"的假安全感——Codex 的降级+warning 模型需要 UI 告警通道配合，当前没有）。
- 内置兜底（无 requirements.json 也生效）：`/instructions` 禁改、`target` 仅 `opencode.json`、`permission` 相对 base 只能收紧——维持第一批行为不变。
- `applyProfilePatch(base, spec, requirements?)` 加可选第三参；`requirements.json` 加载失败只 warn 不阻断（对齐 Codex 用户规则语法错误降级行为，`exec_policy.rs:628-643`）。
- validate 与 apply 两条路径都过闸（唯一入口：部署产物 + 干跑校验）。

### 2. 提权路径防御（降级为两层提示性防御）

agent 无法被 Workbench 拦截（约束项），落两层可控防御：

**2.1 patch 侧硬红线**：requirements 的 `forbiddenPaths` 默认含 `/permission`？不——patch 本身允许收紧 permission。设计为：`forbiddenPaths` 由管理员配置，打包者默认下发 `["/instructions"]`；`/provider`（API key 所在）建议列入默认。
默认出厂 requirements.json 随 profile 部署（`app-config/.opencode/interaction/` 旁不合适，放 user 层由 applyUserOverlay 保证不被 prune；出厂态 = app-private 目录预置）。

**2.2 审批卡片警示**：renderer 的 permission 请求卡片命中保护路径（`.opencode/`、`AGENTS.md`、`.git/`）时显示警示条（提示性防御，非硬边界）。

**2.3 部署完整性告警**：manifest 增加 `sourceChanged` 字段——本次部署的 base 指纹与上次 manifest.base 不一致时置 true 并 log warn，说明 `app-config/.opencode` 源被改动（开发机场景 agent 可写 app-config）。运行时篡改本身不持久（镜像语义天然覆盖），该告警针对"源侧被改"需要人审的场景。

### 3. CAS 基线哈希（validate→write 的 TOCTOU 防护）

Codex apply_patch 失败时诚实标注 `exact=false`（`apply-patch/src/lib.rs:470-520`）。Workbench 落法：

- `profile-validate-patch` 返回 `{ok:true, ops, baseHash}`（校验时所读 base 的 `contentHash`）。
- `profile-write-patch` 接受可选 `expectedBaseHash`；写入前重读 base 比对，不一致返回 `{ok:false, error:"stale"}`——不硬覆盖（校验到保存之间配置可能被用户手改/重启重部署）。
- UI：配置对话校验成功后自动带哈希保存；编辑器手改路径不带哈希（保持现行为），提示语义由 UI 文案区分。

### 4. per-key origins 反查（"这个值谁说的"）

Codex 每键记录胜出层（`config/src/fingerprint.rs` 的 `origins()`）。Workbench 落法：

- 新增 `profile-explain-config` IPC：读部署后 opencode.json + user patch.json，重放 patch，返回：

```ts
{ merged: object, origins: Record<string, "base" | "patch">, patchApplied: boolean }
```

- origins 以 patch 各 op 的 JSON Pointer 顶层键为准（`/model` → `model: "patch"`；未命中的顶层键为 `"base"`）。
- 「个性化」面板新增「生效来源」卡：逐键显示 base/patch，形成"patch 为什么不生效"的排障闭环。

### 5. skills 目录预算 lint（数字分身直接受益）

Codex 常驻技能目录预算 = 上下文 2%、description ≤1024、name ≤64（`skills/src/parser.rs`、`ext/skills/src/render.rs`）。Workbench 落法：

- `scripts/dev/lint-skills.mjs`：扫描 `app-config/.opencode/skills/*/SKILL.md` frontmatter，校验 name ≤64、description 存在且 ≤1024；违规清单输出，exit 1。接 `package.json` script `lint:skills`。
- 只 lint 告警，不静默改写（description 是触发语义载体）。

### 6. 渐进披露提示契约 + 配置对话 marker

- **契约**（译自 `ext/skills/src/catalog_prompt.rs`，内嵌本方案，供数字分身 AGENTS.md 引用，不另开文档）：

> 技能使用规则：用户点名技能或任务明显匹配其描述时，本轮必须使用该技能；技能不跨轮携带。使用前必须完整读完 SKILL.md 再行动；禁止把阅读技能委派给 subagent；按技能内 routing 只读相关 references；优先执行 scripts 而非重抄代码；使用后在回复中声明所用技能。

- **marker**：`sendConfigPrompt` 的约束前缀与用户原文用 `<workbench:config-request>...</workbench:config-request>` 包裹——注入内容自带可识别标记（对齐 `context-fragments` 的 marker 模式），未来 UI 过滤/审计可据此区分"配置请求轮"与真实用户输入。约定为软协议，仅用于展示分类，不做安全决策。

### 7. 不做的事（显式排除）

- 不做 OpenCode sidecar 内部的审批缓存/沙箱（黑盒，无钩子）。
- 不改 relay（独立项目）。
- 不引入降级+警告模型（无 UI 告警通道前，静默降级 = 假安全感）。
- 不新增独立文档文件（契约内嵌本方案）。

## 验证状态

### 已完成的调研

- [x] 五路调研完成（配置层叠 / 插件 skills / 审批沙箱 / app-server / 上下文补丁），关键结论均带 `codex-rs/` 出处。
- [x] 约束项逐条核实归因（OpenCode 黑盒 / relay 项目边界 / 未验证能力），不做伪实现。

### 实施记录（2026-08-14 第四批）

| 验收项 | 验证方式 | 状态 |
|--------|----------|------|
| requirements 红线层 | `patchOverlay.ts`：`ProfileRequirements`（forbiddenPaths / permissionCeiling）+ `applyProfilePatch`/`validateProfilePatch` 可选第三参；forbiddenPaths 与 ceiling 违规 = 硬错；ceiling 只约束 patch 设置的键（不溯及继承的 base 值，宽 base 走 sourceChanged 告警）；`humanizePatchError` ceiling 归 permission 桶 | 已实施 |
| requirements 读取 | `profilePatch.ts:readRequirements`：读 user 层 `requirements.json`，坏文件降级为空 + 不阻断；RESERVED 集合防止它被镜像为覆盖文件 | 已实施 |
| validate→write CAS | validate 返回 `baseHash`；`writeUserPatchChecked` 对 live base 复核哈希，不一致返回 `{ok:false, stale:true}`；UI 对话生成路径带哈希保存，stale 时提示重新校验；编辑器手改路径不带哈希（保持原行为） | 已实施 |
| explainConfig IPC | `profile-explain-config`：重放 patch 得 per-key origins（base/patch）+ patchApplied；patch 对当前 base 无效时诚实报告 base-only 而非假装生效；「个性化」新增「生效来源」卡 | 已实施 |
| 部署完整性告警 | manifest 加 `sourceChanged`（与上次 manifest.base 比对），告警条展示 + log warn | 已实施 |
| 审批卡片保护路径警示 | `PermissionCard` resources 命中 `.opencode/`、`.git/`、`AGENTS.md` 时显示警示条（提示性防御，非硬边界——sidecar 内写路径无法拦截） | 已实施 |
| skills lint | `scripts/dev/lint-skills.mjs`（name ≤64 / description ≤1024 / frontmatter 完整性）+ `pnpm lint:skills`；现有 profile 20 个 skills 全过 | 已实施 |
| marker 约定 | `sendConfigPrompt` 用 `<workbench:config-request>` 包裹用户原文（软协议，展示分类用） | 已实施 |
| 现有测试不退化 | `pnpm typecheck` 通过（desktop/sdk/relay/client）；`pnpm test` 全量通过（desktop 48 文件 381 用例 + sdk 3 + relay 22）；改动文件 lint 0 错误 | 通过 |

新增单测 5 例：forbiddenPaths 拒绝 / ceiling 超限拒绝与贴线通过 / ceiling 不溯及未触碰的继承键 / ceiling 违规归 permission 桶。

### 约束项落点备忘（本次未实施，归因已核实）

- 审批缓存与规则沉淀：需 OpenCode 暴露审批中间件，当前 sidecar 黑盒。
- workspace 提权硬拦截：agent 的 write/edit 在 sidecar 内执行，Workbench 无拦截点；现有护栏 = 镜像语义（篡改不持久）+ patch 红线 + 审批警示条。
- 反向请求注册表 / relay 可靠性（seq+ack+cursor）：归 relay 项目 backlog。
- 热重载：待验证 OpenCode reload API 后再评估。
