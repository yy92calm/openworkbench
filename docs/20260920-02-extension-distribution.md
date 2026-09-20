# 20260920-02 · 扩展分发（静态源 + 客户端下载 skill / agent）

## 背景与需求

需求：构思「服务端放置、客户端下载」的扩展分发模式——打包者把 skill / agent
放在服务端，Workbench 客户端拉取、校验、安装、生效。

经确认的边界：

1. **服务端形态**：仅独立静态源（nginx / 对象存储 / CDN，无服务端逻辑，
   不做 relay 集成）；
2. **分发类型**：skills、agents、commands、MCP 配置片段（插件与 tools/ 不做）；
3. **信任策略**：ed25519 签名 + sha256 + 结构审计，**审计通过后自动启用**。

承接文档：`docs/20260919-04`（C1 三级加载、C5 远程更新、B3 key 治理）、
`docs/20260919-05`（技术事实调研）。本文档把两者细化到可直接实施。

## 事实底座

第一轮（引用 `docs/20260919-05` 实测结论）与本轮（代码核对）合并如下：

| 事实 | 来源 | 对本设计的影响 |
| --- | --- | --- |
| sidecar 1.17.13 不热重载，配置启动时加载一次 | 05 官方 + 实测 | 安装后必须重启 sidecar；流程收尾「提示 + 一键重启」 |
| 技能支持 `skills.paths`（对 agent 生效，`/api/skill` 不含） | 05 实测 | 可用但需 UI 另行汇总；本设计统一走部署目录合并 |
| agents / commands / mcp 无外部路径机制 | 05 调研 | 只能合并进部署层 |
| 项目级 `.opencode/` 可覆盖权限、插件自动执行 | 05 实测 | sidecar 启动已加 `OPENCODE_DISABLE_PROJECT_CONFIG=1`；分发配置放应用固定文件 |
| 本地能力：`fetch` + 超时、`node:crypto`、`jszip`、tmp+rename 原子写 | 05 核对 | 客户端零新依赖；ed25519 用 `node:crypto` |
| 部署管线：`deployBundledProfile()` 用 `syncDir` **镜像 + 剪除**，再 `applyUserOverlay` / `applyUserProviderConfig` | 本轮 `server.ts` | 扩展文件**每次启动必须重新合并**，不能持久化进部署目录 |
| MCP 注入先例：`deploySchedulerProfile()` read-merge-write 部署 `opencode.json` | 本轮 `scheduler.ts` | 扩展 MCP 合并直接复用同模式 |
| MCP 两种形态：`remote{url}` / `local{command,environment}` | 本轮 profile 实测 | 片段格式按这两类定义，键白名单收紧 |
| 存量教训：profile 内 wind/juyuan/etf 的 remote URL 内嵌 `sk-` 明文 | 本轮核对（属 04 B3 治理对象） | **扩展包一律禁止**任何凭据，含 URL 内嵌 |
| 版本来源缺口：应用没有 sidecar 版本常量（仅 `fetch-opencode.sh` 固定 1.17.13） | 本轮核对 | 兼容校验需运行时 `opencode --version` 探测（缓存）或跳过并告警 |
| `startSidecar()` 调用序：deployBundledProfile → deploySchedulerProfile → browserMcp.deploy → spawn | 本轮 `server.ts` | 扩展合并插在 deployBundledProfile 之后、平台注入之前（平台注入最后覆盖） |

## 设计

### 1. 总体架构

```text
发布侧（打包者机器）                服务端：静态托管                     客户端（Workbench desktop）
extensions-src/<id>/…              <base-url>/                        main/extensions/
  manifest.json                      index.json   ← 唯一可变文件        ├─ config：源/公钥/白名单（打包者固定）
  skill/ agents/ commands/ mcp/      packs/<id>-<version>.zip（不可变）  ├─ verify：sha256 + ed25519
publish CLI                        （历史版本保留，供固定与回滚）          ├─ audit：结构/权限/密钥扫描（fatal/warning）
  build → zip → sha256 → sign     无动态逻辑、无鉴权                     ├─ install：原子落用户层 + state 台账
  → index.json（签名）                                                  ├─ updater：调度/下载/比对/退避
                                                                       └─ deploy：合并进部署层 + INDEX.md
```

- 服务端只有两类文件：**不可变的包**与**签名清单** `index.json`；除 index 外
  只增不改，CDN 天然友好。
- 客户端只认「打包者固定的公钥 + 白名单 URL」；两者都随应用分发，工作区与
  用户配置不可改写（项目级配置已禁用）。
- 应用自身**从不执行**下载内容：只做校验、解码、复制与配置合并；执行发生在
  sidecar（受权限闸门与 OS 沙箱约束）。

### 2. 包格式（一个 zip = 一个扩展包）

```text
manifest.json                                      # 包根，必填
skill/<name>/SKILL.md + references/ + scripts/     # kind 含 skill
agents/<name>.md                                   # kind 含 agent
commands/<name>.md                                 # kind 含 command
mcp/<name>.json                                    # kind 含 mcp（单条目片段）
```

```jsonc
// manifest.json
{
  "schema": 1,
  "id": "finance-core",              // [a-z0-9-]{2,40}
  "version": "1.2.0",                // 严格 semver
  "name": "金融核心方法论",
  "description": "≤200 字，用于 INDEX.md 与设置页",
  "kind": ["skill", "agent"],        // 每个目录必须在 kind 中声明，反之亦然
  "sidecar": ">=1.17 <2",            // sidecar 兼容区间（极简 range 语法）
  "app": ">=0.1.0",                  // 应用版本区间
  "publisher": "workbench-pack",     // 展示用
  "permissions": {                   // 声明式，审计时与实际内容比对
    "exec": true,                    // 含脚本或 local MCP
    "network": ["fund.eastmoney.com"] // 脚本可能外联的域名
  }
}
```

**MCP 片段**（`mcp/<name>.json`，文件名即合并键）：

```jsonc
// remote：只允许透明 URL，禁止任何凭据
{ "type": "remote", "url": "https://host/path", "enabled": true }
// local：命令数组 + 仅 {env:VAR} 占位
{ "type": "local", "command": ["node", "scripts/x.mjs"],
  "environment": { "TOKEN": "{env:TOKEN}" }, "enabled": true }
```

- 键白名单：`type / url / command / environment / enabled / headers` 之外一律
  拒绝；`type` 仅 `remote | local`。
- **风险声明**：`local` 片段等价于「sidecar 启动即执行的进程」；自动启用即
  等于打包者签名的代码自动执行。因此：`permissions.exec` 必须为 true；设置页
  展示将执行的命令；审计生成该命令清单。
- `{env:VAR}` 的实际注入依赖 `docs/20260919-04` B3（secrets.env / env 注入，
  **尚未实施**）：在 B3 落地前，分发 MCP 片段应避免需要密钥的服务；打包者若
  把值直接写进 profile 属于不推荐路径（与 04 B3 冲突）。

**包级硬约束**：压缩包 ≤20MB；解压总量 ≤100MB 且 ≤20× 压缩包（防 zip bomb）；
文件数 ≤500；仅允许扩展名 `.md .json .txt .csv .yaml .yml .py .sh .js .ts
.png .jpg .webp`（`.svg` 因可携带脚本被拒）；拒绝符号链接、`..`、绝对路径、
盘符、反斜杠、Windows 保留名（CON/PRN/AUX/NUL/COM1…）与尾随点/空格；拒绝
**大小写冲突**（macOS 大小写不敏感）与 **Unicode 归一化冲突**（NFC/NFD）。

### 3. index.json（签名清单）

```jsonc
{
  "schema": 1,
  "channel": "stable",               // v1 单渠道
  "generatedAt": "2026-09-20T…",
  "generator": "workbench-ext-cli/0.1.0",
  "keyId": "workbench-2026",         // 标识签名密钥（轮换用）
  "packs": [
    {
      "id": "finance-core",
      "version": "1.2.0",
      "name": "金融核心方法论",
      "description": "…",
      "kind": ["skill", "agent"],
      "url": "packs/finance-core-1.2.0.zip",
      "sha256": "…", "size": 123456,
      "sidecar": ">=1.17 <2", "app": ">=0.1.0",
      "publisher": "workbench-pack",
      "permissions": { "exec": true, "network": ["fund.eastmoney.com"] }
    }
  ],
  "signature": "base64(ed25519(规范化 JSON（去掉 signature 字段）))"
}
```

- **规范化规则**（`canonicalJson()` 放 shared，发布侧与客户端同一实现）：递归
  键排序、无空白、数组保序、字符串标准 JSON 转义；数值只允许整数（size），
  由 CLI 保证。
- **签名**：ed25519；客户端配置里 `publicKeys: [主, 备]` 数组，任一命中即通过
  （支持灰度轮换：先加备钥、再用备钥签名、最后移除旧钥）；`keyId` 仅用于
  诊断展示。
- index 只索引每个 id 的**最新版本**；历史包保留在 `packs/`，回滚直接指向旧
  版本（v1 提供「回滚到上一版本」）。
- 校验顺序：**签名 → schema → id/版本合法性 → 兼容区间 → 逐包 sha256/大小**；
  任一层失败即拒绝。HTTPS 只是传输层，不作为信任来源。
- 包文件不单独签名：index 里的 sha256 已把内容钉死（TUF-lite 思路），替换包
  必然哈希失配。

### 4. 发布侧（publisher CLI）

`scripts/dev/publish-extensions.mjs`（Node，零新依赖）：

1. 输入 `extensions-src/<id>/`（manifest.json 必填）；
2. 校验：manifest schema、目录与 `kind` 一致、结构检查（复用并扩展
   `scripts/dev/lint-skills.mjs`：frontmatter name/description 预算、引用文件
   存在性）、密钥与外联扫描（与客户端审计同一实现，shared 纯函数）；
3. 打 zip（固定文件顺序与 mtime、排除 `.DS_Store/node_modules/.git`）；
4. sha256 / size → 更新 `dist/index.json`（替换该 id）→ 签名 → 原子写；
5. 自检：index 引用的包存在、哈希匹配、`--verify` 可离线验签；
6. 输出 `dist/`（index.json + packs/）；上传由打包者自选（rsync / s3 cp…）；
7. 密钥：`--keygen` 生成 `~/.workbench-ext/signing.key`（PKCS8 PEM，0600），
   打印 SPKI base64 公钥供客户端配置；`--key <path>` 指定；
8. 其它开关：`--dry-run`（只校验与打印）、`--out <dir>`、`--channel`
   （预留给未来多渠道）。
9. **可复现**：同输入两次打包 sha256 必须一致（单测固定）。

### 5. 客户端（desktop main · 新增 `main/extensions/`）

```text
<userData>/extensions/
├── state.json                     # 台账（见下）
├── <id>/<version>/…               # 解包内容（用户层 P1）
├── quarantine/<id>/<version>/     # 审计 fatal 的隔离区（不部署）
├── packs/<id>-<version>.zip       # 下载缓存
└── INDEX.md                       # 生成物：每扩展 1–2 行，供 instructions 注入
```

**配置**（打包者固定，随 profile 镜像到应用私有目录；缺失即功能休眠）：
`app-config/.opencode/extensions.json` →

```jsonc
{
  "sources": ["https://ext.example.com"],   // 白名单，多源取首个可用
  "enabled": true,
  "channel": "stable",
  "autoUpdate": true,
  "checkIntervalMinutes": 60,
  "publicKeys": ["base64(spki)"],           // 支持轮换的主/备公钥
  "allowKinds": ["skill", "agent", "command", "mcp"]
}
```

**state.json**：

```jsonc
{
  "schema": 1,
  "installed": {
    "finance-core": {
      "activeVersion": "1.2.0",
      "versions": ["1.1.0", "1.2.0"],       // 磁盘保留（最多两个）
      "sha256": "…", "source": "https://…",
      "installedAt": "…", "updatedAt": "…",
      "audit": "passed",                     // passed | passed-with-warnings
      "warnings": ["network 声明之外出现 api.example.com"]
    }
  },
  "skipped": { "x": { "version": "1.3.0", "reason": "sidecar-incompatible", "at": "…" } },
  "quarantine": [{ "id": "y", "version": "1.0.0", "reason": "secret-in-package", "at": "…" }],
  "lastCheckAt": "…", "lastError": "…"
}
```

**更新流程**（启动后延迟 30s + 每 60 分钟 + 设置页手动；单飞，同一时刻一次
检查）：

1. `GET <base>/index.json?ts=…`（缓存击穿；支持 ETag 时带 `If-None-Match`，
   304 即视为无变化）→ 验签 → 逐包与 state 比对（版本、sha256）；
2. 新版本且 `sidecar` / `app` 区间满足 → 下载（并发 ≤2、单包超时 60s）→
   sha256/大小校验 → 审计；
3. 通过 → 解包到 `extensions/<id>/<version>/`（tmp+rename），更新 state
   （activeVersion 切换、保留上一版本）；fatal → 移入 quarantine；
   warning → 部署 + 记录；签名失败 → 丢弃并记录 lastError；
4. **自动启用**（已确认策略）：部署层合并 + 重生成 INDEX.md + toast「扩展已
   更新（N 个），重启 sidecar 生效」（一键重启；用户可稍后）；
5. 失败降级：断网/源不可用 → 保持现状，指数退避（60 → 120 → 240 → 360 分钟
   封顶，成功即复位；手动检查绕过退避）；兼容不符 → 记入 `skipped`（同
   (id, version) 不重复提示）；
6. **sidecar 版本探测**：启动时 `execFile(sidecarBinaryPath(), ['--version'])`
   （3s 超时，进程内缓存）；探测失败 → 跳过兼容检查并记 warning（不阻塞）。

**部署层合并**（`deployExtensions()`，插入 `startSidecar()` 的
`deployBundledProfile()` 之后、平台注入（scheduler / browser-mcp）之前）：

1. 按 state 的 `activeVersion` 将 `skill/ agents/ commands/` 复制进
   `deployedProfileDir()`（`syncDir` 镜像语义决定必须每次启动重做）；
2. `mcp/*.json` read-merge-write 进部署 `opencode.json`（沿用
   `deploySchedulerProfile` 模式）；
3. 生成 `<userData>/extensions/INDEX.md`（name + 描述），并以**幂等**方式
   维护 `instructions` 数组：先移除历史 INDEX.md 绝对路径，再在非空时追加
   当前路径（避免重启累积重复项）；
4. 覆盖告警：扩展文件与内置同名时记录覆盖清单（品牌上：P2 内置 < P1 用户
   扩展；用户 overlay 与本合并的相对顺序单独说明，见「风险」）。

**设置页「扩展」区**：已装列表（名称 / id / activeVersion / 类型 / 来源 /
状态：已启用 · 待重启 · 有警告 · 已隔离）、检查更新（显示 lastCheckAt 与
lastError）、回滚到上一版本（切换 activeVersion）、卸载（删版本目录 + state
条目 → 下次启动回退内置版）、重启 sidecar（一键）。新 IPC：
`extensions-status`、`extensions-check`、`extensions-remove`、
`extensions-rollback`。

**保留与清理**：每个 id 最多保留 2 个版本目录（active + 上一版）；quarantine
保留 30 天；下载缓存与版本目录同步清理；`<userData>/extensions` 总量超过
200MB 时驱逐最久未用的非 active 版本。

### 6. 审计规则（fatal / warning 分级）

| 级别 | 规则 |
| --- | --- |
| fatal | zip 路径穿越（`..`/绝对/盘符/反斜杠）、符号链接、大小写或 NFD/NFC 冲突、扩展名不在白名单、文件数/大小/压缩比超限、Windows 保留名、manifest schema 非法、`id/version` 非法、目录与 `kind` 不一致、`exec=false` 但有脚本/local MCP、ffmpeg 式二进制内容（非白名单扩展名）、任何明文凭据（`sk-` / Bearer / JWT / `://user:pass@`）、MCP 键越界、MCP URL 含凭据、`environment` 值不是 `{env:VAR}` |
| warning | 外联域名超出 `permissions.network` 声明、描述超预算、单文件 >5MB、`publisher` 缺失、frontmatter description 缺失 |

- fatal → quarantine（不部署、不合并），设置页可见原因；
- warning → 正常部署并记入 state，设置页展示。

### 7. 安全模型（边界必须显式）

- 信任链：**内置公钥（publicKeys）→ index 签名 → 包 sha256 → manifest**；
  工作区与用户不可改写配置（项目配置已禁用 + 配置随包分发）。
- 自动启用 = 信任「打包者 + 源」；审计是启发式，**不是沙箱**：技能脚本与
  local MCP 仍在既有权限闸门（bash / external_directory ask，04 B2 的
  `OPENCODE_PERMISSION` 基线）与 OS 沙箱下运行。
- 静态源无鉴权：URL 泄露即任何人可下载 —— 因此**包内不得有密钥**（fatal
  强制）；需要定向分发/鉴权时走 relay 托管（index 格式与客户端逻辑不变，
  只增加鉴权与管理面，未来可平滑升级，不在本方案）。
- 密钥轮换：`publicKeys` 支持主备并存；轮换步骤 = 发布备钥 → 客户端升级 →
  用备钥签名 → 移除旧钥。
- 应用自身零执行：只做校验、解包、复制、配置合并；所有下载内容仅在 sidecar
  加载（受沙箱与权限约束）。

### 8. 文件清单

| 文件 | 动作 |
| --- | --- |
| `packages/shared/src/extensions.ts` | 新增：manifest / index 类型、`canonicalJson`、schema 校验、极简 semver range、审计纯函数（发布侧与客户端共用） |
| `apps/desktop/src/main/extensions/verify.ts` | 新增：sha256 / ed25519 验签 |
| `apps/desktop/src/main/extensions/audit.ts` | 新增：zip 结构 + 权限 + 密钥扫描（调用 shared 纯函数） |
| `apps/desktop/src/main/extensions/install.ts` | 新增：原子安装、state 台账、隔离区、版本裁剪与清理 |
| `apps/desktop/src/main/extensions/updater.ts` | 新增：调度、ETag/退避、下载、比对、版本探测 |
| `apps/desktop/src/main/extensions/deploy.ts` | 新增：合并进部署层、MCP 合并、INDEX.md 与 instructions 幂等维护 |
| `apps/desktop/src/main/server.ts` | 修改：`startSidecar()` 调用序中插入 `deployExtensions()` |
| `apps/desktop/src/main/{ipc.ts,index.ts}` | 修改：4 个 IPC；启动调度 updater |
| `apps/desktop/src/preload/index.ts`、`renderer/electron.d.ts`、`renderer/lib/electron.ts` | 修改：桥接 |
| `renderer/app/routes/SettingsPage.tsx` | 修改：扩展面板（列表 / 检查 / 回滚 / 卸载 / 重启） |
| `scripts/dev/publish-extensions.mjs` | 新增：校验 → zip → sha256 → 签名 → index → 自检；`--keygen/--verify/--dry-run` |
| `docs/architecture/{01,02,05}`、`CHANGELOG.md` | 同步 |

模块边界（可测性）：`verify / audit / install / updater / deploy` 均通过参数
接收「配置 + 路径」，不直接 import `electron.app`；`index.ts` 负责注入真实
路径。单测可完全离线运行。

### 9. 测试

- shared：`canonicalJson` 固定向量（嵌套/Unicode/整数）跨实现一致；manifest /
  index schema 校验（缺字段、非法 id/版本、kind 不匹配）；极简 semver range
  边界（`>=1.17 <2`、`^` 不支持并报错）；审计纯函数全规则表驱动（fatal /
  warning 各一例）。
- main：verify 正反例；install 原子性（中断清理）、state 往返与 schema 迁移、
  版本裁剪与 200MB 驱逐；updater 端到端（本地 `http.createServer` 假源：
  有新版 / 无变化 / 304 / 断网 / 验签失败 / 兼容不符 / 退避序列）；
  deploy 幂等（重复执行不产生重复 instructions、不残留旧版本文件）。
- 发布侧：zip 可复现（同输入两次同 sha256）；index 签名 → 客户端验签往返；
  `--verify` 检出被篡改的包。
- 门禁沿用：`pnpm test` / `lint` / `format:check` / `md:check` / build /
  typecheck 基线（9 / 46）。

## 实施步骤

1. **格式与发布侧**：`shared/extensions.ts`（类型 / canonicalJson / 校验 /
   审计纯函数）+ `publish-extensions.mjs`（keygen / 可复现 zip / 签名 index /
   verify）→ 本地静态目录产出样例源 + 单测；
2. **客户端校验与安装**：verify / audit / install / state + 单测（假源，
   离线）；
3. **更新与生效**：updater（调度 / 退避 / 版本探测）、4 个 IPC、设置页扩展
   面板、`deployExtensions()` 接入 `startSidecar()`、INDEX.md 幂等注入；
4. **收尾**：安全复核（公钥固定、白名单、fatal 清单、无执行面）、架构文档与
   CHANGELOG、真实静态源冒烟（本机 `python -m http.server`）、打包冒烟。

## 验证状态

方案阶段（2026-09-20，第一轮）：

- [x] 边界确认：仅独立静态源；分发 skills / agents / commands / MCP 片段；
      签名 + 审计通过后自动启用。
- [x] 承接事实核对（`docs/20260919-05`）：不热重载、`skills.paths` 行为、
      agents / commands / mcp 需部署层合并、项目级配置已禁用、jszip /
      crypto / 原子写齐备。

方案阶段（2026-09-20，第二轮打磨 · 代码核对）：

- [x] 集成点精确定位：`deployBundledProfile` 的 `syncDir` 镜像 + 剪除语义
      （扩展必须每次启动重合并）、`deploySchedulerProfile` 的 MCP
      read-merge-write 先例、`startSidecar()` 插入位置（profile 之后、平台
      注入之前）。
- [x] MCP 片段格式按现有两种真实形态（remote/local）定义，键白名单与
      `permissions.exec` 约束成形；发现并规避存量 URL 内嵌 `sk-` 教训。
- [x] sidecar 版本来源缺口确认：改为运行时 `--version` 探测（缓存 + 失败
      降级告警）。
- [x] 细化：index 签名与密钥轮换（`publicKeys` 主备）、state schema、
      保留/清理策略、审计 fatal/warning 分级、退避与 ETag、跨平台约束
      （大小写/NFD/保留名）、可测性边界（模块不依赖 electron）。

实施（待做）：

- [ ] 步骤 1：shared 类型/校验/审计纯函数 + 发布 CLI（keygen、可复现 zip、
      签名 index、verify）。
- [ ] 步骤 2：客户端 verify / audit / install / state + 单测。
- [ ] 步骤 3：updater + IPC + 设置页扩展面板 + 部署合并与 INDEX.md。
- [ ] 步骤 4：安全复核 + 文档 + 真实静态源冒烟 + 门禁。
- [ ] GUI 人工冒烟：检查更新 / 自动启用 / 重启提示 / 回滚 / 卸载 / 隔离
      可见。

## 风险与边界

| 风险 | 对策 |
| --- | --- |
| 静态源无鉴权，URL 泄露即可下载 | 包内禁止密钥（fatal）；定向分发需求走 relay（格式不变，可平滑升级） |
| local MCP = 启动即执行的进程 | `permissions.exec` 强制声明 + 设置页展示命令；自动启用等于信任打包者；执行仍在权限闸门/沙箱内 |
| 审计为启发式，无法证明脚本安全 | 明确「审计 ≠ 沙箱」；fatal/warning 分级；执行走权限闸门与 OS 沙箱 |
| 签名私钥泄露 | 发布机 0600；`publicKeys` 主备灰度轮换；泄露后立即轮换并发版 |
| 无热重载，更新未即生效 | 安装后提示一键重启 sidecar；用户决定时机，避免打断会话 |
| `syncDir` 镜像会剪除扩展文件 | 合并放在每次 `startSidecar()` 的部署序列内重做，不持久化进部署目录 |
| 用户 overlay 与扩展合并的先后 | 现行顺序：overlay 在 profile 部署内完成后才合并扩展，**扩展优先于 overlay**（同名时）；如后续要求 overlay 优先，需把扩展合并提前到 overlay 之前（管线小改，评估后再做） |
| `{env:VAR}` 注入依赖 04 B3（未实施） | B3 落地前分发 MCP 片段避开密钥服务；打包者不得把值硬编码进包（fatal） |
| 恶意/劣质包占资源 | 包/解压/数量/压缩比上限 + 版本保留与总量驱逐 + 隔离区定期清理 |
| 跨平台文件系统差异 | 拒绝大小写与 Unicode 归一化冲突、Windows 保留名；不使用符号链接与可执行位 |
| 兼容区间解析复杂度 | 极简 range（`>=a <b` 组合），不引入 semver 依赖；未知语法直接拒绝并告警 |
