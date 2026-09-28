# 20260928-01 · agents 门禁增强与风格统一

## 背景与需求

承接 2026-09-28 的 27 个子代理文件 UTF-8 损坏修复（正文按确定性对照表重建，
frontmatter 字节级保留）。用户确认两项后续优化：

1. **门禁增强**：`scripts/check_opencode.py` 增加 UTF-8 完整性检查与技能
   引用存在性校验，防止「批量写入静默损坏近一月未发现」再次发生；
2. **agents 风格统一**：消除 9 月重写遗留的三处风格分裂。

## 事实底座（本轮代码核对）

| 事实 | 来源 |
| --- | --- |
| 现有门禁 `check_opencode.py` 校验 opencode.json / agents frontmatter（name、model）/ mcp 引用 / skills / commands，基线 115 项全绿 | 本轮执行 |
| 该脚本用 `read_text()` 读文件且无捕获——损坏文件会直接抛 UnicodeDecodeError 崩溃（traceback 而非清单式报错）；无 UTF-8 完整性专项检查 | 本轮读码 |
| 技能节标题两派并存：`## 使用的技能`（12 个：9 个父代理 + pitch-agent.md + pitch 2 个子代理）vs `## 使用技能`（13 个：损坏重建的子代理，忠实于损坏残留措辞） | 本轮 grep 统计 |
| 引用行分隔符两派：全角 `｜`（27 个重建文件，与 7 月版一致）vs 半角 `\|`（pitch 3 个子代理） | 本轮字节核对 |
| 调用方式句式两派：`完成 <角色> 环节后`（空格式，27 个 + 7 月版）vs `完成<角色>环节后`（紧凑式，pitch 3 个） | 本轮核对 |
| 技能节存在 **16 个无效引用**（引用的技能在 `skills/` 目录不存在）：子代理 4 个（`model-update`、`morning-note`、`client-review`、`returns-analysis`）；父代理 6 个文件共 12 个（`gl-reconciliation`、`break-tracing`、`accrual-analysis`、`kyc-document-parsing`、`rules-engine-evaluation`、`compliance-screening`、`portfolio-rebalance`、`client-report`、`rollforward-preparation`、`variance-commentary`、`statement-audit`、`nav-reconciliation`、`distribution-validation`、`valuation-analysis`、`portfolio-monitoring`） | 本轮脚本核对（`skills/` 共 25 个技能） |
| 这些无效名称源自 WorkBuddy 移植（20260911-01）：源项目技能库未全量搬入，正文引用残留 | 方案文档 + 本轮推断 |

## 设计

### 1. 风格统一标准（三处，各选定一个基准）

| 维度 | 统一标准 | 理由 | 改动量 |
| --- | --- | --- | --- |
| 技能节标题 | `## 使用的技能` | 父代理 + pitch 完好样本的原生风格；重建文件的「使用技能」是损坏重写残留措辞 | 13 个重建文件改标题 |
| 引用行分隔符 | 全角 `｜` | 36 个文件 + 7 月版基线多数派 | pitch 3 个子代理改（每文件 3 处） |
| 调用句式 | `完成 <角色> 环节后`（空格式） | 27 个文件 + 7 月版的连续基线；重建时已按此生成 | pitch 3 个子代理改（每文件 1 处） |

### 2. 无效技能引用清理（数据一致性修复）

规则：agents 技能节引用的技能必须在 `skills/` 目录存在（与现有「frontmatter
的 mcp 引用必须在 opencode.json 定义」规则同构）。清理方式为**删除无效引用**，
不做技能目录补齐（不引入超出需求的新产物）。删除后技能节为空的文件移除整节。

清理清单（16 处，删除后保留项）：

| 文件 | 删除 | 保留 |
| --- | --- | --- |
| earnings-reviewer-model-updater | `model-update` | （节移除） |
| earnings-reviewer-note-writer | `morning-note` | `xlsx-author` |
| gl-reconciler | `gl-reconciliation` · `break-tracing` · `accrual-analysis` | `xlsx-author` |
| kyc-screener | `kyc-document-parsing` · `rules-engine-evaluation` · `compliance-screening` | （节移除） |
| meeting-prep-agent-pack-writer | `client-review` | `pptx-author` |
| meeting-prep-agent | `client-review` · `portfolio-rebalance` · `client-report` | `pptx-author` |
| month-end-closer | `accrual-analysis` · `rollforward-preparation` · `variance-commentary` | `xlsx-author` |
| statement-auditor | `statement-audit` · `nav-reconciliation` · `distribution-validation` | `xlsx-author` |
| valuation-reviewer-valuation-runner | `returns-analysis` | （节移除） |
| valuation-reviewer | `valuation-analysis` · `portfolio-monitoring` · `returns-analysis` | `xlsx-author` · `pptx-author` |

> 被删名称的完整清单保留在本文档中，可随时按此恢复或指导后续技能补齐。

### 3. 门禁增强（`scripts/check_opencode.py`）

新增两条规则，保留现有全部规则：

1. **UTF-8 完整性**：所有受检文件（agents / skills / commands / opencode.json）
   逐个 `read_bytes()` + 严格 `decode('utf-8')`；失败记为
   `<file>: UTF-8 解码失败（疑似批量写入损坏）`。这同时消除现状中
   `read_text()` 无捕获导致的 traceback 崩溃——所有文件读取统一走带捕获的
   安全读取函数。
2. **技能引用存在性**：agents 技能节（统一标题后单一样式）条目中的
   `` `skill` `` 引用必须对应 `skills/<name>/` 目录；缺失记为
   `<file>: 技能引用 '<name>' 在 skills/ 目录不存在`。

脚本风格沿用现状：单文件、无第三方依赖、错误清单输出、exit 0/1。

## 实施步骤

1. 风格统一：13 个重建文件改技能节标题；pitch 3 个子代理改分隔符与句式；
2. 无效引用清理：按上表删除 16 处，3 个文件移除空节；
3. 门禁增强：check_opencode.py 新增 2 条规则 + 安全读取；
4. 验证：check_opencode.py 全绿（115+ 新增项）+ 风格统计归一
   （`## 使用的技能` 40 内唯一标题、分隔符/句式无两派）+ 全文件 UTF-8 复验；
5. 更新本文档验证状态。

## 验证状态

方案阶段（2026-09-28）：

- [x] 事实核对：三处风格分裂、16 个无效引用、门禁脚本现状（见「事实底座」）。
- [x] 设计确认：统一标准、清理清单、门禁规则（本文档「设计」章节，用户
      通过选项确认方向后按最小改动原则定标）。

实施（2026-09-28 完成）：

- [x] 步骤 1：风格统一——13 个重建文件改标题为「## 使用的技能」；pitch 3
      个子代理分隔符半角 `|` → 全角 `｜`（9 处）、调用句式紧凑式 → 空格式
      （3 处）、`Task  工具`/`Task 工具 调用` 多余空格归一（2 处，pitch 系
      原有瑕疵，与 27 个重建基线对齐）。
- [x] 步骤 2：无效引用清理——16 处全部删除；3 个文件（model-updater、
      valuation-runner、kyc-screener）技能节清空后整节移除。
- [x] 步骤 3：check_opencode.py 增强——docstring 补第 5/6 条、新增
      `read_utf8()` 安全读取（清单式报错替代 traceback 崩溃）、opencode/
      agents/skills/commands 全部受检文件走安全读取、agents 循环新增技能
      引用存在性检查。
- [x] 步骤 4：验证全部通过——
      门禁 115 项全绿（exit 0）；风格归一（22 个「## 使用的技能」唯一标题、
      半角分隔符 0 残留、紧凑句式 0 残留、无效技能引用 0 残留）；全 40 个
      agent 文件 UTF-8 复验 0 损坏。
- [x] 负例测试（门禁有效性证明）——注入 `E7 90 3F` 坏字节：报
      `UTF-8 解码失败（疑似批量写入损坏）@offset 54` 且 exit 1（清单式，
      非崩溃）；注入 `ghost-skill` 无效引用：报
      `技能引用 'ghost-skill' 在 skills/ 目录不存在` 且 exit 1；恢复后
      115 项全绿。
