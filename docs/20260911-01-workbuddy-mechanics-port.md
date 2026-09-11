# WorkBuddy 三套技能完整移植方案（Office / 可视化 / 金融）— 完美版

日期：2026-09-11，序号 01
状态：已实施（v2 方案，2026-09-12 全部 10 步完成，见「验证状态」实施记录）
来源：桌面三套 WorkBuddy 源文件深读（办公插件、可视化技能、金融技能；结论已沉淀为记忆 id=9/10/11）
决策基线：**能 verbatim 复用的代码/文本一律原文搬入；只重写绑定宿主环境的入口层**（frontmatter、数据源路由、工具映射、权限）。

## 背景与目标

三套源文件里，真正"不能移植"的只有依赖宿主专有能力（Tencent 后端 / Ardot 画布 MCP / 付费生成端点 / editor_sdk 进程 / slidep CLI）的部分。其余——html_to_docx 29 个 py 的 Word 转换引擎、Excel recalc 校验闭环、16 个量化引擎、46 个金融方法论、Visualizer 规范原文——均为**自包含可运行**产物，可直接搬到本 profile。

目标：把三套中所有自包含产物一次性搬入 `app-config/.opencode/skills/`，入口 SKILL.md 改写为适配 OpenCode 格式 + 本 profile 的 wind/juyuan/etf MCP 与产物卡机制；只剔除依赖不存在宿主能力的模块，且逐项给出剔除理由。

## 范围判定（三分类）

### A. 完整 verbatim 复用（原文搬入，仅改 frontmatter 与绑定字段）

| 来源 | 产物 | 数量 | 落地 |
|---|---|---|---|
| tencent-docx | `skills/html-to-docx` 包（md/html→docx 引擎） | 29 py | `office-docx/scripts/html_to_docx/` |
| tencent-docx | `scripts/review_html.py`（HTML 5 维评审，含安全一票否决） | 1 py | `office-docx/scripts/` |
| tencent-docx | `skills/design-token`（build_tokens.py + 5 主题 token + 公文/学术国标） | 1 py + tokens | `office-docx/skills/design-token/` |
| tencent-docx | `skills/format-extract`（docx→语义化 html 提取，content-hash 隔离） | 1 py | `office-docx/skills/format-extract/` |
| tencent-docx | `skills/doc-typeset`（7 垂类模板 + 页面模型 @page 规则） | 模板 | `office-docx/skills/doc-typeset/` |
| tencent-docx | 三子代理（doc-writer/doc-formatter/doc-converter）、编排协议（pipeline-state 溯源、S1-S3 铁律）、critic-generator/deep-research 引擎协议 | md | `office-docx/references/` |
| tencent-docx | experts 体系（研报/工作汇报/论文/公文等 9 专家 + 路由表） | md | `office-docx/experts/` |
| sheetagent | `excel-generation` 的 recalc.py / soffice.py / extract.py / requirements.txt | 3 py + 1 | `xlsx-author/scripts/` |
| sheetagent | schema_principle.md + design_patterns 7 范式（plan/progress/stats/form_print/dashboard/calendar/model） | 8 md | `xlsx-author/references/` |
| tencent-local-office-edit | edsdk.py（渐进 schema 查询 / 端口发现 / 双行错误输出）——作为通用 MCP 封装范式文本 | 1 py | `office-routing/references/`（仅范式，不接 editor_sdk） |
| tencent-pptx | pptx2image.py / doc_image_extractor.py | 2 py | `pptx-author/scripts/` |
| wb-finance-skill | references/ 46 个五段式方法论 | 46 md | `finance-core/references/` |
| wb-finance-skill | scripts/price-action 7 + quant 6 + ib 2 + run_signal.py | 16 py | `finance-quant/scripts/` |
| wb-finance-skill | SKILL.md 红线/委派协议/时间口径/来源分级/三步匹配 + tdx-mcp 速查范式 | md | `finance-core/`（适配） |
| 可视化文件夹 | Visualizer设计系统规范(show_widget原文).md + design-router/SKILL.md 路由判据 + 复杂度/主题规范 | md | `visual-output-spec/references/` |

### B. 改写绑定层（必须人工适配）

1. **frontmatter 适配**：全部 skill 剥掉 CodeBuddy 专属字段（`disable-model-invocation`/`user-invocable`/`allowed-tools`/`when_to_use`/`description_en`），name≤64、description≤1024（lint-skills 预算）；长触发词 description 压缩成 OpenCode 的 name+description 双字段。
2. **数据源路由改写**：`agentic_search` / westock CLI / neodata / 通达信 MCP → 本 profile 的 `wind/juyuan/etf` MCP + WebSearch 兜底；保留"能力域内排他、降级必须显式告知、多源冲突列两个来源优先一手"的纪律条款。
3. **宿主工具映射**：`present_files` → 既有 write 工具 + 产物卡（规则已在 20260909-02 约定）；`read_me`/`show_widget` → 既有富围栏 + `visual-output-spec` 规范；ImageGen/VideoGen → 不上线（剔除生图引用）。
4. **服务端耦合清理**：neodata query.py（连 `copilot.tencent.com`）、westock index.js（混淆化连腾讯后端）、sheetagent mcp/*.mjs（连文档后端）**不搬**——保留其"缓存先行鉴权 + 重试上限 + 失败分类"范式入参考文本；run_signal.py 的 `--source westock` 路径改为空置（默认 `--source csv` 与 Python API），文件照搬并在 SKILL 注明。
5. **权限与免责**：适配本 profile 安全默认（手动审批、key 不入 provenance）；免责声明保留且与 AGENTS.md 现有条款合并。
6. **目录树结构调整**：WorkBuddy 插件内多子 skill 扁平化为 `skills/` 下独立库，符合本项目既有 skill 形态（与 dcf-model/xlsx-author 同级）。

### C. 依赖不存在，整模块剔除（附理由，非成本原因）

| 模块 | 剔除理由 |
|---|---|
| Ardot 画布全系（ardot-design-core/ui/poster/slides/design-to-code） | 依赖 Ardot MCP 画布服务器（宿主产品），本环境无画布形态 |
| Miora 全系（creative-core/image/video/brand-design） | 依赖腾讯付费生图/生视频端点与竞对鉴权，无可用通道 |
| design-router 全表 | 已并入 B2 数据路由纪律，无需单独实例 |
| geo-map / livestream-poster / buddy-* | 依赖宿主 ImageGen 与地图后端，无等价能力 |
| tencent-local-office-edit 的 editor_sdk 通道 | 依赖宿主持有编辑器进程，本环境以"写文件 + 产物卡"替代 |
| slidep CLI / SlideDSL 编译 | slidep 是宿主 Node CLI，源码不在源文件包内；PPT 侧保留 python-pptx 心里面提图/回读能力 |
| sheetagent 的 sheet-agent 子代理 + run_command 沙箱 | 绑定其 MCP 代理后端 |

## 现状对照（同 v1，保留）

| WorkBuddy 机制 | 本项目现状 | 差距 |
|---|---|---|
| 路由门卫 | 无，Office 任务靠模型自选 | 全缺 |
| Word 三阶段中间表示+评审 | 无 docx 产物链路 | 全缺（v1 曾误判为"无转换基建"，实际 html_to_docx 可搬） |
| Excel recalc 校验闭环 | xlsx-author 无公式重算验证 | 缺 recalc 脚本与门禁 |
| read_me 规范按需注入 | AGENTS.md 6 条常驻 | 缺"薄指针+详规"结构 |
| 流式渲染防闪屏约束 | 富围栏"完整可用才露出"，无生成侧约束 | 缺规范文件 |
| html 交付 JS 自检 | 20260909-02 无此条 | 缺 |
| sendPrompt 交互回路 | kv-card 纯展示 | 缺按钮→prompt 映射 |
| 金融总入口红线/委派/时间口径/来源分级 | 仅 4 行免责声明 | 缺 |
| 46 个方法论 | 19 个产物导向 skills，无"怎么想" | 缺 |
| 数据通道排他+降级告知 | wind/juyuan/etf 已配，无纪律 | 缺文本纪律 |

## 关键约束

1. AGENTS.md 前缀稳定篇幅克制：只减不增，新增一行指针即可。
2. `app-config/` 每次启动被 base 镜像覆盖，产物全落 profile，随部署镜像同步。
3. verbatim 移植的脚本依赖：html_to_docx 依赖（lxml/chardet 等，见其 requirements）需锁版本；recalc 依赖 LibreOffice 可探测降级（多级引擎照搬 recalc.py 原实现，缺 LibreOffice 走 formulas/static 不谎报 success）。
4. lint-skills 预算与 `pnpm lint`、`pnpm md:check` 全程绿。
5. 安全默认不变：手动审批、key 不入 provenance；**必须禁传带 key 的 URL 或 token 进 provenance/logs（顺带项：既有 opencode.json 的 url 内嵌明文 sk- key，另案处理）**。
6. 单测覆盖：recalc.py、run_signal.py、html_to_docx 有自含自测路径（extract_ib_numbers 纯 stdlib、signal engine 有 `--source csv` 自测），迁移后以其自带测试白盒跑一遍。
7. 版权与合规：内部参考用途，自包含产物原样搬入本 profile（本地桌面项目），不对外发布。不搬运任何 `.codebuddy-plugin/plugin.json` 与 .in_use 标记（无关运行）。

## 设计

### 第一部分：Office 生成（3 个 skill + 2 处增强）

#### 4.1 新 skill `office-routing`（路由门卫）

```text
app-config/.opencode/skills/office-routing/
├── SKILL.md                    # 触发：.xlsx/.pptx/.docx 生成或编辑请求，先于品类 skill 加载
└── references/rules.md         # 分流判据（片字可核）、file_id/编辑先读回纪律、源文件数组
```

分流表（一票判据）：

| 判据 | 走向 |
|---|---|
| 无源文件、从零产表 | xlsx-author（生成链路，完成后必过 recalc 门禁） |
| 有源文件的一切操作 | 编辑链路（先读回、禁重生成覆盖） |
| 确定性小编辑（改格/加粗/排序） | 编辑链路 |
| "美化/专业"抽象诉求（无源文件时） | 允许重排版 |
| 生成 .docx 报告/研报 | office-docx（md→html→docx 三阶段） |

铁律：创作链路交付后不承接编辑，编辑请求一律重新路由；重生成即覆盖。

#### 4.2 新 skill `office-docx`（Word 三阶段完整移植）

```text
app-config/.opencode/skills/office-docx/
├── SKILL.md                     # 编排：S1 doc-writer → S2 doc-formatter → S3 converter（本地 html_to_docx）
├── references/
│   ├── pipeline-state.md        # 溯源协议（输出/<id>/stage1~3、pipeline-state.yaml）
│   ├── doc-writer.md            # 三子代理相关（改写：专家路由表→对应的领域技能）
│   ├── critic-generator.md      # 评审引擎协议（强制否定配额、渐进 rubrics）
│   └── deep-research.md         # 研究引擎协议（Reflect 六问、事实五元组）
├── skills/
│   ├── html-to-docx/            # 29 py verbatim 全量（含 __main__、__init__、converter、css_resolver）
│   ├── design-token/            # verbatim：build_tokens.py + compiled tokens + rules（GB/T 公文/学术）
│   ├── format-extract/          # verbatim：run.py（docx→html+图片，content-hash 隔离）
│   └── doc-typeset/             # verbatim：7 垂类模板 + @page 页眉页脚规范
├── scripts/
│   ├── review_html.py           # verbatim：HTML 5 维评审（score≥80 且 SC01-06 一票否决）
│   └── requirements.txt         # lxml / chardet 等（锁版本）
└── experts/                     # 9 个专家参考（研报/公文/学术/商业文案等，未命中则不读）
```

SKILL.md 关键条款（改写绑定层）：

- 交付终态：S3 产出 .docx 后**必须**走 write 工具写入 workspace 触发产物卡（等效 present_files 强制预览）；最终文件唯一交付，中间 md/html 不暴露。
- 质量门禁：S3 交付前先 `review_html.py` 跑 HTML（score≥80 且安全维度全过）；本次为"生成=完成，校验通过才算完成"闭环。
- 创作/编辑分离：S1-S3 流水线不接编辑请求；后续编辑走读回不改原文件链路。

#### 4.3 xlsx-author 增强（recalc 闭环 verbatim）

```text
app-config/.opencode/skills/xlsx-author/
├── SKILL.md                     # 增「交付门禁」节（复刻 recalc 契约描述）
├── references/
│   ├── schema_principle.md      # verbatim：建表宪法（8 原型、10 类型→format、锚点、样例规模）
│   └── design_patterns/         # verbatim 7 范式（plan/progress/stats/form_print/dashboard/calendar/model）
└── scripts/
    ├── recalc.py                # verbatim：三层引擎（LO 宏+marker → formulas → static）、外链保护闸
    ├── soffice.py               # verbatim：跨平台 soffice 定位 + 沙箱 shim
    ├── extract.py               # verbatim：附件为 content.md+缩略图双轨
    └── requirements.txt
```

门禁条款：`status=success 且 total_errors=0` 才算完成；exit0≠通过（读 JSON）；外链检测到剥离缓存值时需 --force 且向用户显式说明；循环上限 3 次。

#### 4.4 pptx-author 增强（产物回读校验）

```text
app-config/.opencode/skills/pptx-author/
├── SKILL.md                     # 增「交付自检」节
└── scripts/
    ├── pptx2image.py            # verbatim：pptx→grid 图（300dpi 视觉校验）
    └── doc_image_extractor.py   # verbatim：docx/pptx/xlsx 提图
```

门禁：交付前用 pptx2image 出全册缩略图人工/视觉校对，图片为真实配图（高置信场景禁止 AI 生图替代）。

### 第二部分：可视化会话渲染纪律（1 个新 skill + 2 处增强）

#### 4.5 新 skill `visual-output-spec`（read_me 同构物，references 直接复用原文）

```text
app-config/.opencode/skills/visual-output-spec/
├── SKILL.md                     # 薄入口：格式选择三条 + 加载时机
└── references/
    ├── show-widget-spec.md      # verbatim：Visualizer设计系统规范全文（SVG viewBox/字体/色阶/复杂度/无障碍/禁渐变/禁注释/主题）
    ├── format-routing.md        # 内容形态→围栏路由：趋势→echarts、关系拓扑→svg、交互→html、声明式→a2ui、键值→kv-card
    ├── chart-quality.md         # verbatim html-report-style 提取：ECharts option 骨架/图/表可切换/双轴/空值不入图
    └── delivery-check.md        # 交付前 node --check + "图表能渲染才算完成"
```

SKILL.md 三条选择判据（常驻成本仅 description）：会话内即时讲解→围栏；可分享成品→write 落文件产物卡；两者都要→先围栏后文件。

#### 4.6 AGENTS.md「输出渲染约定」改指针

6 条压成 3 行 + 新增一行"产出 html/svg/a2ui 等富内容前，加载 visual-output-spec"。净效果系统提示变短，详规按需加载（= read_me 模式）。

#### 4.7 kv-card 交互回路（唯一渲染器代码改动）

`lib/renderers.tsx`：kv-card JSON 增可选 `actions:[{label,prompt}]` 按钮；点击预填到当前会话输入框（复用 runtime 现有发送通道前置入口），**不自动发送**，用户可改可取消。shared 类型与 relay/client 不动（后端忽略未知字段，向前兼容）。

### 第三部分：金融方法论完整移植（2 个新 skill）

#### 4.8 新 skill `finance-core`（总入口 + 46 references verbatim）

```text
app-config/.opencode/skills/finance-core/
├── SKILL.md                     # 改写：红线四条 + 检索纪律 + 时间口径 + 三步匹配 + 数据源路由（wind/juyuan/etf）
└── references/                  # 46 个五段式 verbatim 全量
    ├── management-assessment.md（管理层体检）
    ├── institutional-holding.md（机构持仓与拥挤度）
    ├── fund-flow.md（资金流）
    ├── quality-growth.md（质量增长）
    ├── peer-comparison.md（同业比选）
    ├── risk-stress.md（风险压力测试）
    ├── valuation-pricing.md（估值）
    ├── earnings-preview.md / earnings-review.md / announcement-impact.md
    ├── dividend-buyback.md / moat-quality.md / business-model.md
    ├── industry-chain.md / policy-impact.md / macro-transmission.md
    ├── market-state.md / market-mainline.md / theme-lifecycle.md / leader-game.md
    ├── sector-comparison.md / fund-flow.md
    ├── trade-plan.md / position-sizing.md / stop-discipline.md / portfolio-checkup.md / monitor-alert.md
    ├── breakout-patterns.md / price-action-tools.md / abnormal-detection.md
    ├── quant-factor-research.md / systematic-strategies.md / portfolio-optimization.md
    ├── options-strategies.md / fixed-income.md / forex-commodity.md / crypto-derivatives.md
    ├── ib-models.md / ib-deal-prep.md
    ├── event-catalyst.md / crisis-event.md / going-global.md
    ├── stock-first-look.md / stock-deep-research.md
    ├── daily-briefing.md
    └── html-report-style.md
```

SKILL.md 核心条款（改写绑定层，非复制）：

- 红线四条一票否决：禁止编造数据（缺失直说"数据源未覆盖"）；禁止核心概念混淆（净利润 vs 归母、同比 vs 环比、财年 vs 自然年）；数据自相矛盾必检；含买卖/仓位/操作判断的输出末尾强制固定免责声明（禁改写）。
- 检索纪律：行情/财务/宏观数字必须 wind/juyuan/etf MCP 动态获取并标"来源+时点"，记忆只能 sanity check；命中能力域禁 web_search；降级必须显式告知来源与非实时性；多源冲突列两来源、优先一手并显式标注分歧。
- 三步匹配协议：拆场景标签（复合必拆）→ 每标签一个核心 reference（最小充分集合）→ 输出前自检（方法论是否实际体现在答案、降级原因、免责声明、关键数字可追溯）。
- 委派协议：一句话意图（只给标的+大方向，不拆维度、不堆"全面/详细"）。
- 边界：finance-core 管"怎么想"，既有 19 skills 管"怎么做成产物"；references 只讲框架，数据走 MCP。

#### 4.9 新 skill `finance-quant`（算法引擎 verbatim）

```text
app-config/.opencode/skills/finance-quant/
├── SKILL.md                     # 薄入口：先读脚本 docstring 看输入约定再 Bash 执行；输出统一 JSON
└── scripts/
    ├── run_signal.py            # verbatim（改：默认 --source csv / Python API；--source westock 注为空置）
    ├── price-action/            # verbatim 7：candlestick_patterns / harmonic_patterns / ichimoku /
    │                            #   elliott_wave / chan_theory / basic_indicators / smart_money
    ├── quant/                   # verbatim 6：pair_trading / seasonality / volatility / factor_multi /
    │                            #   factor_fundamental / minute_data
    ├── ib/                      # verbatim 2：extract_ib_numbers（纯 stdlib）/ validate_dcf
    └── requirements.txt         # pandas / numpy / requests；特殊依赖注明回退检测（pyharmonics/czsc/smartmoneyconcepts）
```

SKILL.md 关键条款：

- "确定性计算交给脚本，判断留给模型"——涉及技术指标/量化/DCF 审核先找脚本，禁止模型凭记忆模拟计算。
- 统一契约：输出 stdout 一行 JSON（`{status, bars, latest_signal, ...}`）；`missing_dependency` 结构化返回 + 退出码，agent 按 JSON 处理缺库分支而非盲目预装。
- 数据源：脚本不自主取数（minute_data 为 OKX 例外，IB 数据来自用户提供文件/既有 MCP），输入按 `--source csv` / Python API 传数据。

#### 4.10 skill-creator 模板改五段式

`skills/skill-creator/SKILL.md` 写作模板替换为五段结构（何时参考/核心目标/分析步骤含内联阈值/建议骨架/避坑）。后续新建 skill 一律套此模板，不回填既有 19 个。

## 接入点汇总

| 文件 | 动作 |
|---|---|
| `app-config/.opencode/skills/office-routing/` | 新建 |
| `app-config/.opencode/skills/office-docx/` | 新建（含 html_to_docx 包 + 评审/提取/token/类型 全量搬入） |
| `app-config/.opencode/skills/xlsx-author/` | 增强（recalc/soffice/extract + schema/design_patterns + 门禁） |
| `app-config/.opencode/skills/pptx-author/` | 增强（pptx2image/doc_image_extractor + 自检） |
| `app-config/.opencode/skills/visual-output-spec/` | 新建（references 复用 Visualizer 原文） |
| `app-config/.opencode/skills/finance-core/` | 新建（46 方法论 verbatim + 入口） |
| `app-config/.opencode/skills/finance-quant/` | 新建（16 引擎 verbatim + 入口） |
| `app-config/.opencode/skills/skill-creator/SKILL.md` | 模板替换 |
| `app-config/.opencode/AGENTS.md` 输出渲染约定 | 改指针 |
| `apps/desktop/src/renderer/lib/renderers.tsx`（+ test） | kv-card actions |

不改：shared 类型、relay/client 协议、fold/runtime 事件链、packages/sdk。

## 实施步骤（每步可验证）

全部工作分 10 步，P0 为纯 profile 文本+脚本搬迁（无渲染层）；P1 为渲染器/模板；P2 为清扫。

**P0.0 预检**：`pnpm lint` / `pnpm md:check` / `pnpm typecheck` 绿底基线；`git status` 无残留改动（记录待处理的工作区改动清单，避免与搬迁混淆）。

1. [P0] `finance-core`：46 references verbatim 搬入 + SKILL.md 改写（红线/路由/时间口径）＋2 批提交（每批 23 个便于评审）；验收：`pnpm lint:skills` 过、description≤1024；问"茅台能不能看"验证来源+时点标注、免责声明、三步自检。
2. [P0] `finance-quant`：16 脚本 verbatim + requirements.txt + SKILL.md；验收：`python3 scripts/run_signal.py --engine pair_trading --source csv --input demo.csv` 输出 JSON schema 正确；无 pandas 时 missing_dependency 分支。
3. [P0] `xlsx-author` 增强：recalc/soffice/extract verbatim + schema_principle + design_patterns 7；验收：造含公式 xlsx，recalc 出 `status:success,total_errors:0`；无 LO 时自动降 formulas/static；exit0≠通过 读 JSON 断言。
4. [P0] `office-routing` + `pptx-author` 增强；验收：分流表跑 3 案；ppt 自检出图成功。
5. [P0] `visual-output-spec`（show-widget-spec verbatim）＋AGENTS.md 改指针；验收：`pnpm md:check` 过；重启 sidecar 新会话要求"画流程图"，观察加载 visual-output-spec 且 SVG 无渐变/注释。
6. [P1] `office-docx`：html_to_docx 29 py verbatim + review_html + design-token + format-extract + doc-typeset + references（三子代理/评审引擎/演进）+ experts；验收：`python -m html_to_docx` 自测样例 md→html→docx 成功，review_html 对好 html 输出 score≥80。
7. [P1] skill-creator 五段模板；验收：演练主题走通。
8. [P1] kv-card actions（renderers.tsx + vitest）；验收：按钮预填不自动发送；relay 版富文本不受影响。
9. [P2] 全 profile `pnpm lint:skills` + lint-skills.mjs 增强（reference 存在性/五段结构）；验收：全绿。
10. [P2] 清扫：删除多余空壳（若有未引用的 plugin.json/索引文案），`git status` 核对仅新增目标文件。

## 验证状态

已完成调研：

- [x] 三套源文件深读并交叉核验（记忆 id=10/11；含 7 处原总结与源码出入修正）
- [x] 可移植产物盘点：html_to_docx 29 py、excel-generation 3 py+8 md、finance 46 md+16 py、Visualizer 规范原文、pptx 2 py 均在磁盘可搬
- [x] 现状核对：富围栏/a2ui/产物卡/kv-card 链路、MCP（wind/juyuan/etf）、19 skills、lint-skills 预算、AGENTS.md 行数
- [x] 不可移植依赖盘点：Ardot MCP / Miora 端点 / editor_sdk / slidep / 腾讯后端均不在源文件内且本环境无等价

实施记录（2026-09-12，全部 10 步完成）：

| 步骤 | 结果 | 偏离与备注 |
|---|---|---|
| P0.0 预检 | lint / md:check / typecheck 基线绿；git 工作区既有 79 项用户 WIP 未触碰 | — |
| 1 finance-core | 45 references 搬入并清洗（9 文件 21 处宿主绑定词→wind/juyuan/etf MCP）；SKILL.md 红线/路由/三步协议；lint:skills 过 | tdx-mcp-quick-reference 不搬（记录不存在的通达信工具，搬入诱导误调用），故 45 非 46 |
| 2 finance-quant | 16 脚本搬入；13 引擎全冒烟（ok / missing_dependency 结构化降级 / pair 走 Python API 双标的）；ib 两脚本实测出正确 JSON | run_signal.py vcp 一处 pandas 3.x 兼容修复（np.array_split 切 DataFrame 产 ndarray）；--source westock 空置已在 SKILL.md 声明 |
| 3 xlsx-author | recalc/soffice/extract + schema_principle + 7 范式搬入；门禁/附件预处理/设计参考三节写入 | 降级链实测：本机无 LibreOffice 且 formulas 未装 → engine:"static" 如实报错不伪 success |
| 4 office-routing + pptx-author | 分流表（7 判据）+ 六铁律；pptx2image / doc_image_extractor 搬入冒烟过 | rules.md 并入 SKILL.md 单文件（避免多余实体） |
| 5 visual-output-spec + AGENTS.md | SKILL.md + 4 references（show-widget-spec 原文 171 行 verbatim）；AGENTS.md 约定 6 条→3 条+指针（109→103 行，净减） | 通道映射表写明 html 围栏差异（我们要求完整单文件，原规范禁 DOCTYPE 不适用） |
| 6 office-docx | 136 文件搬入；入口 SKILL.md（环境绑定映射表 + 流水线概览 + 门禁）；**review→convert 链路实测**：review_html 正确拦截 DT-05 缺 token、补齐后 passed/score100、html_to_docx 转出 37KB docx（托管 venv 机器上已有） | brief-compose 与 resolve_output_docx_path.py 补搬（被 P0 路由/协议引用）；保留 scripts/wb/local/ 原相对布局使协议路径零修改；generate-fillable-contract-html 无引用不搬；present_files 29 处由映射表覆盖不改原文 |
| 7 skill-creator | 五段模板节增量插入（不动 365 行主体）；模板与 45 个 references 实际结构核对一致 | 五段中"步骤"标题存在三种合法变体（分析步骤/主要内容/主要框架），模板已注明 |
| 8 kv-card actions | renderers.tsx（actions 提取/按钮行/标题逻辑兼容）+ 4 项测试；desktop 404 测试全绿 | 复用 useUiStore.setComposerDraft 既有草稿语义（追加+聚焦+不发送），零 prop 穿透、shared/relay 不动 |
| 9 lint-skills 增强 | references/scripts 路径存在性 + finance-core 五段标题检查；负向自测（注入坏指针被抓、清后恢复绿） | skill-creator 豁免路径检查（教学示例非真实指针）；五段检查只强制三个稳定标题 |
| 10 清扫 | `__pycache__` 清除；终局门禁全绿：lint / format:check / md:check / typecheck / test（404+22+3）/ lint:skills（25 skills） | 发现：app-config/ 整体在 .gitignore:57——profile 不入 git 为既有设计，移植技能仅存在于磁盘、随打包分发 |

## 风险与边界

- verbatim 脚本与原宿主耦合点：`run_signal --source westock`、neodata query、westock index.js 已被列入「范围判定 C/B」；确保搬迁后 profile 无残留指向这些宿主名字。
- 依赖锁定：html_to_docx 的 lxml/chardet、recalc 的 LibreOffice、因数引擎的 pyharmonics/czsc/smartmoneyconcepts 全部改 requirements 锁定版本并在 SKILL.md 声明回退路径。
- AGENTS.md 改动只减不增（6→3+1 指针），改后抽查既有富输出案例不回归。
- kv-card actions 严格"预填不发送"，agent 提供的 prompt 字段按纯文本处理。
- 版权合规：自包含产物原样搬入本本地桌面项目（内部参考），不对外分发；不搬运 `.codebuddy-plugin/plugin.json` 与 `.in_use` 标记。
