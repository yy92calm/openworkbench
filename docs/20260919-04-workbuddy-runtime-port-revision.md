# 20260919-04 · WorkBuddy 运行时移植（修订版：记忆 + 安全闸门 + 动态扩展）

日期：2026-09-19 · 状态：待评审
前置：`docs/20260919-02-workbuddy-memory-and-permission-port.md`（v4，待评审）、
`docs/20260911-01`（技能内容移植，已实施）

本版是**基于代码事实核对后的修订**：目标不变（跨会话记忆、安全闸门、动态
扩展），但修正了原方案中与当前代码不符的数据源、落点与优先级。文末附
「与前置方案的差异」清单。

## 一、目标（不变）

为 workbench 补齐 WorkBuddy 运行时三大能力，全部本地实现，不破坏
「配置驱动、本地优先、锁定式应用」定位：

1. **跨会话记忆**：用户级规则 + 工作区经验，按需注入，不膨胀上下文；
2. **安全闸门**：权限分层与 key 治理，让 README 的「危险命令需审批」有
   配置事实支撑；
3. **动态扩展**：三级加载（内置 → 用户 → 工作区）+ manifest 清单 + 安装
   审计 + 可选远程更新。

## 二、事实核对（决定本版设计）

以下均已对当前代码/实测核对：

| 事实 | 结论 | 对设计的影响 |
| --- | --- | --- |
| 会话存储 | 内置 sidecar（**1.17.13**）数据目录为 `opencode.db`（SQLite + WAL），**不是 JSONL**；`server.ts:migrateStaleDatabase` 在管理该库 | search_history 的索引源改为 SQLite（见 A3） |
| instructions | 部署配置里是**数组** `["AGENTS.md"]` | 记忆/清单可直接 append，无需改结构（见 A1） |
| redact | `redact.ts` 已覆盖 `sk-…`、Bearer、JWT 且有单测 | 只需新增「URL 内嵌凭据」模式（见 B3） |
| key 明文 | `opencode.json` 实测 4 处 `sk-`（DeepSeek + wind/juyuan/etf），`{env:VAR}` 0 处 | 占位符化 + env 注入（见 B3） |
| 自定义工具 | `app-config/.opencode/tools/` 目录存在但为空，1.17.13 支持度未证实 | 检索工具优先走 MCP 通道（已验证路径），tools/ 作为备选（见 A4） |
| 权限模式开关 | 应用有 review/auto/yolo 三档，运行时会 PATCH sidecar 的 global permission | profile 收紧只保证默认态，需同步调整 auto 档（见 B2） |
| 配置不可写 | `app-config/` 被 .gitignore 且每次启动被镜像覆盖 | 记忆/扩展不能放 profile（与前置方案一致） |

## 三、设计

### A. 记忆：两级 + 检索

```text
用户级（跨工作区）   <userData>/memory/MEMORY.md
                     ↑ 部署层条件注入：存在且非空时 append 到 opencode.json 的 instructions 数组
                     ↑ 上限 4000 字符，超限在写入侧裁剪，不静默截断
工作区级（随工作区） <workspace>/.workbench/memory/
                     ├── YYYY-MM-DD.md  每日日志，append-only
                     └── MEMORY.md      30 天前日志蒸馏，上限 3000 字符
检索                <userData>/memory/search.db（FTS5，独立库）
                     ← 增量索引 opencode.db（只读，redact 后入库）
                     ← search_history 工具（MCP 通道）
```

#### A1 注入方式（修订）

- 部署层在生成部署配置时，将 `instructions` 组为
  `["AGENTS.md", "<绝对路径>/memory/MEMORY.md", "<绝对路径>/extensions/INDEX.md"]`，
  只对存在且非空的文件追加；
- 工作区记忆不进全局 instructions：由打包者 AGENTS.md 增加**读侧指针
  净增 ≤1 行**（例：`工作区经验见 .workbench/memory/MEMORY.md（存在时先读）`）；
- 写入纪律：用户级仅存跨工作区强制规则与用户偏好；工作区级在实质工作完成
  后写当日纪要；就地 Edit，不追加重复段。

#### A2 用户级记忆的写路径（新增，原方案未覆盖）

安全默认下 agent 只能访问当前工作区，而用户级记忆在 userData——直接写会命中
`external_directory` 审批。两种落地，按步骤 1 调研结果二选一：

- **首选**：若 1.17.13 的 permission 支持路径级 pattern，则对用户级记忆目录
  单独放行写、其余 external_directory 仍 ask；
- **兜底**：应用侧「提升」（promote）——agent 只写工作区
  `.workbench/memory/global.md`，部署层在下次启动时合并/提升到用户级
  MEMORY.md。该兜底完全走既有镜像管线，无权限例外。

#### A3 检索（修订：数据源 = opencode.db）

- 索引器直读 `opencode.db`（**只读连接**，容忍 WAL），逐会话提取消息文本，
  经 `redactSensitive` 后写入独立 FTS5 库；游标按会话记录已索引到的最大
  消息时间/序号；
- 表结构在版本间可能漂移：加 schema 指纹守卫（复用 `migrateStaleDatabase`
  思路），指纹不匹配时降级为「重建索引」而非报错；
- 备选实现（若表结构不可接受）：走 sidecar HTTP API 全量拉取重建，慢但无
  schema 耦合——步骤 1 决定；
- 索引库落应用私有目录，绝不进 provenance、不随包分发。

#### A4 工具形态（修订）

- `search_history` 走**应用自带 stdio MCP server**（与 `browser-mcp` /
  `mcp_scheduler` 同形态，已被验证），暴露：
  `{ 入参: 自然语言 + 可选时间范围 } → { 会话 id + 时间 + 摘录 ≤3 条 + 会话路径 }`，
  零命中显式返回，不编造；
- 若步骤 1 证实 profile `tools/` 机制可用且更轻，再切换；本版不依赖它。

### B. 安全闸门

> 扩展专项调研（`docs/20260919-05`）新增两条：① sidecar 启动 env 增加
> `OPENCODE_DISABLE_PROJECT_CONFIG=1`（实测阻断工作区 `.opencode/` 配置与
> 插件，堵住「agent 写文件 → 重启提权/执行代码」路径）；② 权限基线可用
> `OPENCODE_PERMISSION` env 注入（实测生效，防篡改，优先级待冲突实验）。

#### B1 权限分层（默认态）

| 权限项 | 现值 | 目标值 |
| --- | --- | --- |
| bash | allow | 危险模式 ask（灰度，见 D1），其余 allow |
| external_directory | allow | ask（用户级记忆目录按 A2 单独处理） |
| edit / write | allow | allow（限 workspace 内） |
| skill / question | allow | 不变 |
| doom_loop | deny | 不变 |

危险 bash 清单：`rm -rf`、`sudo`、`curl … | sh`、`git push --force`、
全局安装类。D1 灰度：先全 ask 观察一周调用面，再按清单放行。

#### B2 与运行时模式开关配合（新增）

`setPermissionMode` 三档调整：

- `review`：维持现状（bash/edit/write/external_directory 全 ask）；
- `auto`：**改为「危险 bash 模式 ask + 常规 allow」**，与 profile 默认态一致，
  避免切档即穿闸；
- `yolo`：不变（全 allow + 二次确认），确认文案明确「将绕过安全闸门」。

#### B3 key 治理（修订）

1. `opencode.json` 中 4 处 `sk-` 改 `{env:VAR}`（步骤 1 验证 1.17.13 支持度；
   不支持则**部署层渲染兜底**：profile 源码保留占位符，部署产物写注入值）；
2. 实际值存 `<userData>/secrets.env`（0600）或 OS keychain；sidecar 启动 env
   注入（沿用 `server.ts` 组装 env 的位置），独立于 profile；
3. `redact.ts` **只新增**「URL 内嵌凭据」掩码（`://user:pass@`）与单测；
   `sk-`/Bearer/JWT 已实现，不重复；
4. 验收：重启后 DeepSeek 对话正常；`rm -rf` 弹审批、常规 bash 不弹；
   provenance.jsonl 无明文凭据。

### C. 动态扩展

#### C1 三级加载（与前置方案一致，按调研修订）

> 技能层可用 `skills.paths`（实测对 agent 生效，`/api/skill` 不含，UI 需
> 应用侧汇总）；agents/commands/mcp 仍走部署层合并；**前提是禁用项目级
> `.opencode/`**（安全发现，见 `docs/20260919-05` 一.3）。

```text
P2 内置   app-config/.opencode/...            打包固定
P1 用户   <userData>/extensions/              运行时可增删
P0 工作区 <workspace>/.workbench/extensions/  项目级临时
部署层按 P2→P1→P0 合并，同名高优先覆盖低优先；mcp 片段合并进部署产物
opencode.json，不写回 profile。
```

#### C2 manifest 与常驻最小化（微调）

- `manifest.json`：`name / version / description(触发描述 ≤1024) / kind
  (skill|agent|extension) / permissions / compat(sidecar 版本)`；
- 清单注入不依赖 AGENTS.md：部署层生成 `<userData>/extensions/INDEX.md`
  （每扩展 1–2 行：name + 一句话触发描述），随 A1 的 instructions 追加机制
  一起注入；全文命中后才加载（OpenCode 原生技能加载即此模式）。

#### C3 热更新与审计

- manifest 或文件变更 → 重新合并部署 + 提示重启 sidecar（1.17.13 是否支持
  热重载未证实，v1 默认「重启生效」，提供一键重启）；
- 安装审计（基础版）：核验 manifest permissions 与实际行为（脚本外联、读
  路径越界），未过审 → 不注入 + 日志 + 隔离标记；v1 不做扩展市场 UI。

#### C4 MCP 延迟工具（修订：改为应用侧代理）

- 「SDK 层代理」不可行：桌面 SDK 只是 sidecar 的客户端，无法拦截工具注册；
- 可行形态：应用自带 **stdio MCP 代理**（新包或复用 browser-mcp 模式），
  持有 wind/juyuan/etf 下游连接，对上只暴露 `tool_search`，命中后动态
  注册下游工具；
- 前提验证（步骤 1）：① 1.17.13 是否在会话中刷新 `tools/list`；② 三套 MCP
  全量 schema 的 token 占用。两项任一不满足 → 不做或降级为「启动时按需启用
  哪些 MCP」。

#### C5 远程更新（P2，与前置方案一致）

- 静态 HTTP 扩展源 `index.json`（name/version/sha256/url/kind/compat/
  permissions 摘要）+ zip 包；
- 流程：拉 index → 版本比对 → 下载 → sha256 → 复用 C3 审计 → 落**用户层**
  → 热重载/重启提示；
- 边界：只写用户层（删文件即回滚到内置版）；URL 白名单由打包配置固定；
  离线回退本地版本；mcp 密钥不入 index 与包（仍走 `{env:VAR}`）。

## 四、实施步骤（重排）

| 步 | 优先级 | 动作 | 验收 |
| --- | --- | --- | --- |
| 1 | P0 | 事实调研（1 天）：1.17.13 的 permission 路径 pattern、`{env:VAR}`、`tools/` 支持度、MCP `tools/list` 动态性、`opencode.db` 表结构、MCP schema token 占用 | 事实清单：定 A2/A3/C4 的实现选择 |
| 2 | P0 | 安全闸门：permission 分层 + B2 模式开关配合 + key 占位符化 + env 注入 + redact URL 模式 + 单测 | `rm -rf` 弹审批、常规 bash 不弹；重启后 DeepSeek 正常；provenance 无明文 |
| 3 | P1 | 记忆注入：部署层条件 append instructions（用户级 + INDEX.md）+ 工作区记忆目录 + AGENTS.md 指针 + A2 写路径 | 跨会话记住显式规则；空文件不注入；无权限例外（或例外最小化） |
| 4 | P1 | 检索：opencode.db 只读索引器（schema 指纹守卫）+ FTS5 + `search_history` MCP server | 问「上次讨论 X 的结论」返回带路径摘录；零命中显式返回 |
| 5 | P1 | 扩展层：三级合并 + manifest 解析 + INDEX.md 注入 + 基础审计隔离 | 拷入/删除扩展即生效（重启后）；未过审不注入 |
| 6 | P2 | MCP 延迟工具代理（步骤 1 两项均达标才做） | 会话启动上下文无全量 schema；`tool_search` 命中后可调用 |
| 7 | P2 | 远程更新：index.json + 版本比对 + sha256 + 审计落盘 | 断网回退；篡改被拦；新版本生效；删用户层回滚 |
| 8 | P2 | 全量门禁 + 打包验证 | lint / typecheck / test / md:check 全绿；打包冒烟 |

## 五、验证状态

方案阶段（2026-09-19，已完成）：

- [x] 代码事实核对 7 项（见「二、事实核对」），修正了原方案的会话存储、
      redact 范围、MCP 代理落点、模式开关交互与版本口径；
- [x] 覆盖原方案两项待拍板：D1 保留灰度策略；D2 改为「MCP 通道优先、
      tools/ 备选」；
- [x] A2 新增用户级记忆写路径问题与兜底（promote），原方案未覆盖。

实施阶段（待做）：

- [ ] 步骤 1 事实清单：**扩展相关已完成**（见 `docs/20260919-05` 验证状态）；
      剩余 `opencode.db` 表结构与 MCP schema token 占用
- [ ] 步骤 2–5 验收（P0/P1）
- [ ] 步骤 6–8（P2）
- [ ] GUI/打包冒烟

扩展专项调研（2026-09-19，已完成，详见 `docs/20260919-05`）：

- [x] 分级目录：全局/项目 scope、技能发现、`skills.paths`、热更新结论；
- [x] 下载更新：本地能力核对（fetch/sha256/JSZip/原子写）+ 重启生效边界；
- [x] 动态扩展：插件机制与钩子、MCP `tools/list_changed` 协议能力、
      延迟工具两条路径的取舍建议；
- [x] 安全发现与对策实测：项目配置覆盖权限 + 项目插件自动执行 →
      `OPENCODE_DISABLE_PROJECT_CONFIG=1`（实测阻断）、`OPENCODE_PERMISSION`
      （实测可注入）。

## 六、风险与边界

| 风险 | 对策 |
| --- | --- |
| opencode.db 表结构漂移 | schema 指纹守卫 + 重建索引；备选 API 全量重建 |
| bash 收紧打断既有自动化 | D1 灰度：先全 ask 观察一周，再按清单放行 |
| 用户级记忆写路径触发审批 | A2 路径级放行（若支持）或 promote 兜底 |
| MCP `tools/list` 不刷新 | C4 前提验证；不满足则不做，保持现状 |
| 扩展清单膨胀挤占上下文 | 每扩展 ≤2 行 + 总量上限，纳入 lint-skills 检查 |
| 恶意/劣质扩展 | manifest 审计 + 隔离 + 内置层兜底 |
| 索引/记忆属敏感本地数据 | 落应用私有目录；只索引 redact 后内容；不进 provenance、不随包分发 |
| 远程更新被劫持 | URL 白名单 + sha256 + 审计门禁；离线回退本地版本 |

## 附：与前置方案（20260919-02 v4）的差异

| # | 原方案 | 本版修订 |
| --- | --- | --- |
| 1 | 索引会话 JSONL（mtime 游标） | 索引 `opencode.db`（SQLite 只读 + 指纹守卫），JSONL 假设不成立 |
| 2 | redact 新增 `sk-` 掩码 | 已有 `sk-`/Bearer/JWT；只新增 URL 内嵌凭据模式 |
| 3 | 「SDK 层懒加载代理」 | 改为应用侧 stdio MCP 代理；并增加两项前提验证 |
| 4 | 检索工具优先 profile `tools/` | MCP 通道优先（已验证），`tools/` 备选 |
| 5 | 未提权限模式开关 | 新增 B2：auto 档保留危险 bash ask，yolo 文案明确绕过 |
| 6 | 未提用户级记忆写路径 | 新增 A2：路径级放行 / promote 兜底 |
| 7 | OpenCode 1.0.0 beta 口径 | 按内置 sidecar **1.17.13** 调研与验收 |
| 8 | instructions 合并描述含糊 | 明确为数组 append（含 INDEX.md），工作区记忆走读侧指针 |
