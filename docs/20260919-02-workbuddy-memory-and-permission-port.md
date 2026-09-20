# WorkBuddy 机制移植：本地记忆系统 + 安全闸门 + 动态加载扩展

日期：2026-09-19，序号 02 · 版本 v4（增补扩展远程更新）
状态：待评审
前置：20260911-01（技能内容移植，已实施）；本文只覆盖运行时平台层

---

## 一页概览

**一句话**：为 workbench 补齐 WorkBuddy 运行时的两大 P0 能力——跨会话记忆与安全闸门，全部本地实现，不破「配置驱动、本地优先」定位。

| # | 交付物 | 解决什么 |
|---|---|---|
| 1 | 用户级 MEMORY.md（部署层条件注入） | agent 跨会话失忆 |
| 2 | 工作区记忆目录（日志 + 蒸馏） | 项目级经验不沉淀 |
| 3 | search_history 工具（SQLite FTS5） | 本地会话数据沉睡、无检索 |
| 4 | permission 分层收紧 | 配置全 allow，与 README「默认手动审批」宣称不符 |
| 5 | key 占位符化 + redact 兜底 | DeepSeek apiKey 与 3 个 MCP url 内嵌明文 sk- |
| 6 | 动态加载扩展 + 远程更新（P1，见 2.3） | 扩展增删/更新需重打包；MCP schema 常驻上下文；agent/skill/mcp 无法远端分发 |

**待拍板（2 项）**：

- D1 bash 收紧方式：建议「先灰度一周全 ask 观察调用面，再按危险清单放行」；替代方案是直接按清单收紧。
- D2 search_history 形态：优先 OpenCode 自定义工具（profile `tools/`），1.0.0 beta 不支持则退 stdio MCP——留待步骤 1 调研结论，不需现在定。

---

## 1. 问题与事实依据

| 问题 | 已核实的事实 |
|---|---|
| 零持久记忆 | 仅会话 JSONL + provenance；跨会话上下文全靠重述 |
| 权限与宣称不符 | `opencode.json` permission 六项全 `"allow"`，仅 `doom_loop: deny` |
| key 明文 | DeepSeek provider apiKey、wind/juyuan/etf 三个 MCP url 内嵌 sk- |
| 约束条件 | `app-config/` 启动被镜像覆盖且整体 .gitignore → 记忆不可放 profile 内；AGENTS.md 只减不增 |

## 2. 设计

### 2.1 记忆：WorkBuddy 三级 → 本地两级 + 检索

```text
用户级（跨工作区）          <app private data>/memory/MEMORY.md
                              ↑ 部署层条件合并进 instructions（存在且非空才注入）
工作区级（随工作区走）      <workspace>/.workbench/memory/
                              ├── YYYY-MM-DD.md   每日日志，append-only
                              └── MEMORY.md       30 天前日志蒸馏，上限 3000 字符
检索（等效 conversation_search）  SQLite FTS5 ← 增量索引本地会话 JSONL（mtime 游标）
                              ↓ search_history 工具
```

**要点**：

| 项 | 规则 |
|---|---|
| 用户级注入 | 启动部署层合并；上限 4000 字符，超限由写入方裁剪，不静默截断 |
| 工作区注入 | AGENTS.md 净增 ≤1 行读侧指针 |
| 写入纪律 | 仅存跨工作区强制规则与用户偏好（用户级）/ 实质工作完成后的当日纪要（工作区）；就地 Edit 更新 |
| 检索契约 | 入参自然语言 + 可选时间范围；出参按相关度返回会话 id + 时间 + 摘录 ≤3 条 + 会话路径；零命中显式返回，不编造 |

### 2.2 安全：permission 分层 + key 治理

**permission 对照**（目标：让 README 的「危险命令运行前需审批」有配置事实支撑）：

| 权限项 | 现值 | 目标值 | 依据 |
|---|---|---|---|
| read | allow | allow（不变） | 读取不落盘不外发 |
| edit / write | allow | allow（限 workspace 内） | 既有工作流依赖产物卡 |
| external_directory | allow | **ask** | workspace 外读写一律审批（对齐 WorkBuddy 个人目录保护） |
| bash | allow | **危险模式 ask，其余 allow**（见 D1） | deny/ask 清单：`rm -rf`、`sudo`、`curl … \| sh`、`git push --force`、全局安装类 |
| skill / question / doom_loop | allow/deny | 不变 | |

**key 治理三步**：

1. apiKey 与 MCP url 的 sk- 段改 `{env:VAR}`（OpenCode 原生支持；不支持的字段由部署层渲染，配置模板化兜底，不引入新组件）；
2. secrets 存本地 env 文件或 OS keychain，部署层启动时注入，独立于 profile 目录；
3. `redact.ts` 增 `sk-[A-Za-z0-9]{16,}` 与 url 内嵌凭据两个掩码模式，防残留泄漏进 provenance/logs。

### 2.3 动态加载扩展（P1）

WorkBuddy 核心机制——**渐进式披露 + 延迟加载 + 插件清单**——移植为 workbench 的运行时扩展层，同时服务 AgentMVP「OpenCode 动态加载专家/插件」目标。

**三层加载与优先级**（启动部署层合并，高优先覆盖低优先）：

```text
P2 内置  app-config/.opencode/...            打包固定，不可运行时变更
P1 用户  <app private data>/extensions/      运行时可增删：skills/ agents/ mcp/
P0 工作区 <workspace>/.workbench/extensions/ 项目级临时扩展
```

**扩展包形态**（对齐 WorkBuddy plugin manifest）：

```text
<extension>/
├── manifest.json    # name / version / description(触发描述≤1024) / kind(skill|agent|extension) / permissions 声明 / compat(sidecar 版本)
└── ...              # SKILL.md / agent md / mcp 配置片段，目录结构同 profile
```

**四个机制**：

| 机制 | 设计 |
|---|---|
| 常驻最小化 | 系统提示词只放扩展清单（name + 一句话触发描述，每扩展 1-2 行）；全文（SKILL.md/agent 定义）命中后才注入——OpenCode 原生技能加载即此模式，扩展层沿用 |
| 延迟工具 | MCP 工具 schema 不常驻：SDK 层懒加载代理，启动只注入「工具名 + 一句话描述」索引，新增 `tool_search` 命中后挂载 schema（wind/juyuan/etf 每套数十工具，收益最大） |
| 热更新 | manifest 变更触发部署层重合并 + sidecar 热重载（或提示重启会话）；安装=拷入扩展目录，或经扩展源自动拉取（见下） |
| 安装审计 | 对齐 WorkBuddy skills-sec-audit：manifest 的 permissions 声明与实际行为核验（脚本外联/读路径越界），未过审的扩展标记隔离不注入 |

**远程更新通道（可选层，覆盖 agent / skill / mcp 三类扩展）**：

- **扩展源**：打包者运营的静态 HTTP 端点（内网 nginx / OSS 即可），根为 `index.json`：扩展元数据数组（name / latest version / sha256 / 包 url / kind / compat / permissions 摘要），扩展包为 zip/tar，目录结构同上。
- **更新流程**：启动时（或手动触发）拉 index → 与本地 manifest 比对版本 → 下载增量 → sha256 校验 → 审计门禁（复用安装审计）→ 落用户扩展目录 → 热重载。
- **落盘层级绑定**：下载**只写用户层** `<app private data>/extensions/`。同名扩展按合并优先级用户层覆盖内置层——远程更新借此可升级已打包扩展而无需重构建；回滚 = 删用户层文件，内置版即恢复。工作区层下载永不写入，仅手动放置（同名时优先级最高，可临时压制远端版本做本地试验）。
- **安全约束**：扩展源 URL 白名单由打包配置固定（契合「配置驱动」定位）；校验/审计不过不落盘；拉取失败或离线回退本地既有版本；内置层永远兜底。
- **MCP 特别条款**：mcp 配置片段的 key 不入 index 与扩展包，仍走 `{env:VAR}` 部署层注入。

**边界**：不做用户侧扩展市场 UI（锁定式专用应用定位）；远程更新是打包者 → 用户的**单向拉取分发**，非双向市场；内置层永远兜底，扩展层损坏不影响启动。

## 3. 实施步骤

| 步 | 优先级 | 动作 | 验收 |
|---|---|---|---|
| 1 | P0 | 半天调研：会话 JSONL 存储路径；OpenCode 1.0.0 beta 的 permission pattern / {env:VAR} / 自定义工具支持度 | 事实清单，定 D2 |
| 2 | P0 | permission 分层 + key 占位符化 + 部署层 env 渲染 | `rm -rf` 弹审批、正常 bash 不弹；重启后 DeepSeek 对话正常 |
| 3 | P0 | redact 兜底模式 + 单测 | 含 sk- 的写调用在 provenance.jsonl 中为掩码 |
| 4 | P1 | search_history：FTS5 索引器 + 工具暴露 | 问「上次讨论 X 的结论」返回带路径摘录的正确会话 |
| 5 | P1 | 记忆读写：instructions 条件合并 + AGENTS.md 指针 + 写入纪律 | 跨会话记住显式规则；空工作区不注入空 instructions |
| 6 | P1 | 扩展层：三级目录合并 + manifest 解析 + 清单常驻注入 | 拷入一个 skill 扩展 → 新会话清单可见 → 命中后全文加载；删除即消失 |
| 7 | P1 | 延迟工具：MCP schema 懒加载代理 + tool_search | 会话启动上下文中无 wind/juyuan/etf 全量 schema；tool_search 命中后工具可正常调用 |
| 8 | P2 | 安装审计：manifest permissions 核验 + 隔离标记 | 含未声明外联脚本的扩展被标记隔离、不注入 |
| 9 | P2 | 远程更新：扩展源 index.json + 拉取比对 + sha256 + 审计落盘 | 断网回退本地版本；篡改包被 sha256 拦截；新版本扩展热重载生效 |
| 10 | P2 | 全量门禁 | lint / typecheck / test / md:check 全绿 |

## 4. 风险与边界

| 风险 | 对策 |
|---|---|
| bash 收紧打断既有自动化 | D1 灰度：先全 ask 观察一周，再按清单放行 |
| FTS5 索引含会话正文 | 索引库落应用私有目录；只索引 redact 后内容 |
| 记忆文件属敏感本地数据 | 不进 provenance、不随打包分发、不走上传通道 |
| `{env:VAR}` 个别字段不支持 | 部署层渲染兜底，无新组件 |
| 扩展清单膨胀挤占常驻上下文 | 每扩展 ≤2 行 + 总量上限，纳入 lint-skills 检查 |
| 恶意/劣质扩展 | 安装审计 + permissions 声明核验，未过审隔离；内置层兜底 |
| 扩展源不可用 / 被劫持 | URL 白名单 + sha256 完整性 + 审计门禁三道闸；拉取失败回退本地缓存 |

## 附：与 WorkBuddy 机制映射

| WorkBuddy 机制 | 本方案等效实现 |
|---|---|
| 云端画像（只读自动注入） | 不移植——本地优先，无服务端 |
| 用户级 MEMORY.md | `<app private data>/memory/MEMORY.md` + instructions 条件合并 |
| 工作区日志 + 蒸馏 | `.workbench/memory/` 日日清 + 30 天蒸馏 |
| conversation_search（服务端） | search_history（本地 FTS5） |
| 个人目录保护 / 危险命令审批 | external_directory ask + bash 危险模式 ask |
| key 不入 provenance | key 占位符化 + redact 双保险 |
| 渐进式披露（技能薄入口） | 扩展层清单常驻 + 命中后全文注入（OpenCode 原生沿用） |
| 延迟工具 / ToolSearch | MCP schema 懒加载代理 + tool_search |
| 插件清单 plugin.json / 四级存储 | manifest.json + 三级加载（内置 → 用户 → 工作区） |
| 市场 / 插件缓存 / 版本管理 | 扩展源 index.json + 本地缓存 + 版本比对（单向拉取，无 UI） |
| skills-sec-audit 安装审计 | manifest permissions 核验 + 隔离标记 + 拉取后审计门禁 |
| 专家系统 / 市场 UI | 不移植——锁定式应用，扩展由打包者分发或用户手动放置 |
