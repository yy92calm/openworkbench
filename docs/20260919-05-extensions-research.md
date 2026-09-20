# 20260919-05 · 扩展专项调研报告（分级目录 / 下载更新 / 动态扩展）

日期：2026-09-19 · 状态：已完成
服务对象：`docs/20260919-04-workbuddy-runtime-port-revision.md`（C1/C4/C5 与安全项）

## 调研方法

- **实测**：以内置 sidecar（opencode **1.17.13**）启动 5 个受控实验实例
  （临时 XDG 目录 + 端口 43117/43118），验证技能发现、目录层级、热更新、
  `skills.paths`、项目级配置覆盖与两道环境变量开关；
- **官方文档**：sidecar 内置 `customize-opencode` 技能正文即 opencode 官方
  配置规范（含目录表、插件 API、权限 pattern、`{env:VAR}` 等），与实测互相
  印证；
- **符号检查**：二进制内 `skills/`、`agents/`、`commands/`、`plugins/`、
  `tools/list_changed`、`OPENCODE_*` 等关键串。

## 一、分级目录（原生层级与实测结论）

### 1.1 opencode 原生 scope（官方文档）

| 作用域 | 路径 | 合并规则 |
| --- | --- | --- |
| 全局配置 | `~/.config/opencode/opencode.json`（**不是** `~/.opencode/`） | 基础层 |
| 项目配置 | `./opencode.json` / `./opencode.jsonc` / `.opencode/opencode.json`（从 cwd 上溯到 worktree 根） | **深合并，项目覆盖全局** |
| 全局技能/agents/commands | `~/.config/opencode/skill(s)/`、`agent(s)/`、`command(s)/` | — |
| 项目技能/agents/commands | `.opencode/skill(s)/<name>/SKILL.md` 等 | 项目优先 |
| 外部技能（自动） | `~/.claude/skills/`、`~/.agents/skills/` | 可用 `OPENCODE_DISABLE_EXTERNAL_SKILLS` 关闭 |
| 插件（自动发现） | `.opencode/plugin/` 或 `.opencode/plugins/` 下的 `*.ts` / `*.js` | 启动即加载 |

### 1.2 实测结果（1.17.13）

1. **全局（XDG）技能发现**：向 `$XDG_CONFIG_HOME/opencode/skills/<name>/SKILL.md`
   放入技能，启动后 `debug skill` 与 `/api/skill` 均可列出 → ✅ 现有部署
   目录机制可靠。
2. **项目级技能发现**：在 **git 项目**目录下放 `.opencode/skills/<name>/SKILL.md`，
   启动后可列出；同目录若无 git（/tmp 下），project 被识别为 `global`，
   **不加载** `.opencode/` → 项目层依赖 worktree 识别（git）。
3. **`skills.paths` 生效**：配置 `"skills": {"paths": ["/abs/ext-skills"]}` 后，
   CLI `debug skill`（agent 实际目录）包含外部路径技能 → ✅ 可用；
   但 HTTP `/api/skill`（应用「技能」页所用端点）**不含**外部路径技能 →
   UI 展示需要在应用侧另行汇总扩展清单。
4. **热更新：不支持**。官方文档明确「Config is loaded once when opencode
   starts and is **not hot-reloaded**」；实测：热添加技能目录后等待 12s
   （含 `OPENCODE_EXPERIMENTAL_FILEWATCHER=true`）仍不出现 → **扩展增删改
   一律需要重启 sidecar**（或提示用户重启会话/应用）。
5. **agents / commands 没有 `paths` 等价配置**：只有技能支持外部路径；
   agent/command 扩展层仍需应用侧合并进部署目录。

### 1.3 两个安全发现（高优先级）

**发现 1：项目级配置可覆盖权限，而 agent 可写工作区。**

- 实测：工作区 `.opencode/opencode.json` 写 `{"permission":{"bash":"deny"}}`，
  resolved config 的 `permission.bash` = deny → **项目配置确实深合并并覆盖全局**；
- 推论：agent（有 workspace 写权限）可写 `.opencode/opencode.json` 把权限
  改宽（`"permission":"allow"`）、注入 MCP、禁用/改写模型等，**重启后生效**；
- 对立面同样成立：`.opencode/opencode.json` 也可被用来**收紧**（实验即此），
  但方向不可控。

**发现 2：项目级插件目录自动执行 JS。**

- 官方：`.opencode/plugin(s)/` 下的 `*.ts`/`*.js` 启动自动加载，插件钩子可
  改配置、改工具定义、注册工具、拦截权限（`permission.ask`）→ 与发现 1
  组合等于「写文件即获得代码执行」。

**对策（已实测有效）**：

- `OPENCODE_DISABLE_PROJECT_CONFIG=1`：实测项目配置被完全跳过
  （`permission.bash` 回到未设置）→ **sidecar 启动 env 默认加上**，工作区
  扩展层改由应用中介（见 1.4）；
- `OPENCODE_PERMISSION` env：实测可直接注入权限
  （`{"bash":"deny","external_directory":"ask"}` 生效）→ 可作为**防篡改的
  权限基线**（由应用在 spawn 时注入，agent 无法修改）；与项目/全局配置的
  优先级需在实施前补一次冲突实验。

### 1.4 对「三级扩展」方案的修订建议

```text
P2 内置   app-config/.opencode/...              打包固定
P1 用户   <userData>/extensions/                技能：skills.paths 指向（实测可用）
                                                agents/commands/mcp：应用侧合并进部署目录
P0 工作区 <workspace>/.workbench/extensions/    同上，但只在显式启用时并入；
                                                项目级 .opencode/ 一律禁用（安全）
```

- 技能层可用 `skills.paths` 避免文件复制，但 UI 列表需应用侧汇总；
- agent/command/mcp 仍走「部署层合并」（与 scheduler/browser-mcp 注入同
  模式），合并产物只写部署目录，不写回 profile；
- **禁用项目配置是前提**：否则工作区扩展层没有意义（opencode 会先加载
  任意 `.opencode/`，绕过应用审计）。

## 二、下载更新（远程扩展分发）

原方案（静态 index.json + zip + sha256 + 审计 + 只写用户层）保持不变，补充
本次核对：

1. **opencode 原生远程技能**：官方配置支持
   `"skills": {"urls": ["https://.../.well-known/skills/"]}`（远程技能列表）。
   与自建更新通道重叠，可作为「技能类扩展」的轻量替代；其请求协议与缓存
   行为未验证，列入待验证清单。**MCP/agents/commands 无原生远程机制**，
   仍需自建通道。
2. **本地能力核对（均具备，无需新依赖）**：
   - HTTP 拉取：主进程已有 `fetch` + `AbortSignal.timeout`（macro.ts 模式）；
   - 完整性：`node:crypto` createHash('sha256')；
   - 解包：`jszip` 已是 desktop 依赖（渲染层在用，主进程可直接用）；
   - 原子落盘：临时文件 + rename（relay `registry.ts` 已有同款模式）；
   - URL 白名单与开关：放部署配置（与扩展源固定打包者策略一致）。
3. **生效边界**：由「一.4」热更新结论决定——下载完成后**必须重启 sidecar**
   才生效；v1 流程为「拉取 → 校验 → 审计 → 落用户层 → 提示重启（一键）」，
   「热重载」不再作为 v1 目标。
4. **回滚**：只写用户层，删除即回退内置版；审计不过不落盘；离线/失败回退
   本地既有版本（与方案一致）。

## 三、动态扩展（插件 / 延迟工具）

### 3.1 插件机制确认（官方 + 符号）

- 配置：`"plugin": ["npm-spec", "pkg@1.2.3", "./local-plugin.ts", ["pkg", {opts}]]`；
- 自动发现：`.opencode/plugin(s)/` 下的 `*.ts`/`*.js`；
- 钩子（可用于扩展行为）：`config(cfg)`（改合并配置）、`tool: { my_tool }`
  （注册自定义工具）、`tool.definition`（改工具定义）、`tool.execute.before/after`、
  `permission.ask`、`chat.*`、`experimental.*` 等；
- 开关：`OPENCODE_PURE=1` / `--pure`（全部外部插件）、
  `OPENCODE_DISABLE_DEFAULT_PLUGINS=1`（默认插件）、`plugin` 显式列表可控。

**对方案的影响**：动态扩展不必只做目录合并——插件是 opencode 原生的一等
扩展点，且能改配置/工具。但它运行在 sidecar 进程内（JS 执行），安全等级
最低，**必须过安装审计**，且与 1.3 的「项目插件自动执行」风险同源。

### 3.2 延迟 MCP 工具（修订）

- MCP 协议侧：内置 SDK 含 `notifications/tools/list_changed` 处理与
  `autoRefresh` 选项（二进制符号确认）→ 协议能力具备；
- opencode 客户端是否对下游 MCP 启用 autoRefresh **未证实**（待运行时验证）；
- 备选实现路径（若自建延迟层）：
  1. **插件路径**：插件 `tool.definition` + 自定义工具实现「工具索引 +
     按需展开」，无需 MCP 代理进程；代价是插件代码执行与审计；
  2. **MCP 代理路径**（原方案）：应用自带 stdio MCP 代理，对上前置
     `tool_search`，命中后动态注册下游工具——独立进程、权限可控，但依赖
     opencode 刷新 `tools/list`；
- 决策建议：**先量化收益**（wind/juyuan/etf 三套 schema 的常驻 token 占用），
  再选路径；v1 不做。

### 3.3 对方案 C2 的微调

- `INDEX.md` 常驻清单仍由应用生成并注入 instructions；
- 额外：若启用用户层技能，`skills.paths` 与 INDEX.md 都指向
  `<userData>/extensions/skills`，两者内容由同一 manifest 目录生成，保持
  一致（索引里出现但未注册、或反之，都会造成模型困惑）。

## 四、对 `20260919-04` 方案的修订点

| # | 方案原设计 | 调研结论 → 修订 |
| --- | --- | --- |
| 1 | P0 工作区层用 `.workbench/extensions/` 合并 | 保留，但前提是 `OPENCODE_DISABLE_PROJECT_CONFIG=1`；项目级 `.opencode/` 一律禁用（安全发现 1/2） |
| 2 | 技能扩展靠应用合并目录 | 技能可优先用 `skills.paths`（实测可用，免复制）；agents/commands/mcp 仍需合并 |
| 3 | 「热重载」作为扩展能力 | 改为「重启生效」：官方明确不热重载，实测佐证；下载更新流程以「提示+一键重启」收尾 |
| 4 | 检索/`tools` 路径 | 与本次无关，维持 04 方案（opencode.db 索引） |
| 5 | 延迟 MCP 工具仅 MCP 代理一条路 | 增加「插件路径」备选，先量化收益再决策；协议侧 list_changed 能力已确认存在 |
| 6 | 权限模式配合（B2） | 增补：`OPENCODE_PERMISSION` env 可作为防篡改权限基线（实测可注入），优先级待冲突实验 |
| 7 | 安装审计 | 范围扩大：插件（Sidecar 内 JS 执行）与项目级 `.opencode/plugin` 都在审计/禁用范围内 |

## 五、待验证清单（实施前）

- [ ] `OPENCODE_PERMISSION` 与项目/全局配置的**优先级**（冲突实验）
- [ ] `skills.urls` 远程技能的请求协议、缓存与失败行为（1.17.13）
- [ ] opencode 对下游 MCP 是否启用 `autoRefresh`（`tools/list_changed` 实测）
- [ ] wind/juyuan/etf 三套 MCP schema 常驻 token 占用（延迟工具收益量化）
- [ ] 用户级 `extensions/skills` 在 `/api/skill` 缺失时的 UI 汇总方案

## 验证状态

本次已实测（2026-09-19，均以 1.17.13 受控实例完成）：

- [x] 全局/项目技能发现、项目识别依赖 git（/tmp 无 git 不加载）；
- [x] `skills.paths` 对 agent 生效、`/api/skill` 不含外部路径；
- [x] 热更新不支持（官方 + 实测 12s 无刷新，含 FILEWATCHER 实验开关）；
- [x] 项目级 `opencode.json` 覆盖全局权限（`bash: deny` 生效）；
- [x] `OPENCODE_DISABLE_PROJECT_CONFIG=1` 实测阻断项目配置；
- [x] `OPENCODE_PERMISSION` 实测注入权限；
- [x] 插件机制、权限 pattern 语法、`{env:VAR}` / `{file:path}`、目录表均以
      官方内置文档确认。

未实测项见「五、待验证清单」。
