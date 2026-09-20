# Changelog

本项目的版本维护约定见 AGENTS.md「工程规范 → 版本约定」：以根
`package.json` 的 `version` 为单一版本源，功能变更 bump patch，UI/交互大改
bump minor；发版时打 `v<version>` git tag 并将本条「Unreleased」归档为对应版本。

## [Unreleased]

### Added（宏观洞察，方案 docs/20260918-01、docs/20260919-01）

- 侧边栏新增「宏观洞察」：主进程抓取公开行情/宏观/基金/行业数据（东方财富、
  天天基金），快照内存 + 磁盘缓存、5 分钟 TTL、后台刷新推送；渲染层看板
  首屏零等待，支持详情弹窗（内置 SVG 走势）、指标引用到对话。
- 以「轮动模型 + 行业模型」为核心：轮动模型输出中证十大行业评分表
  （0.45×相对强度 + 0.35×动量 + 0.20×趋势，口径界面公示）与资金流热度，
  一键生成轮动周报；行业模型支持东财细分行业搜索，展示行情、120 日走势、
  成分股 PE/PB 中位数与龙头 TOP10，一键生成行业定价分析。
- 投研闭环：决策台账（工作区 `.workbench/research/decisions.jsonl`）→ 归因
  回填 → 复盘与再训练（知识资产 `knowledge.md` 摘要自动注入后续模型
  prompt）；定时任务模板为轮动日报（工作日 08:30）/ 轮动周报 / 复盘周报。
- A 股红涨绿跌：新增 rise/fall 语义色并应用于页面全部涨跌标识。
- 汇报视图（方案 docs/20260919-03）：顶部汇报概览（定位、一句话动态摘要、
  6 格 KPI、六步闭环实时数字），模型区前置、数据底座后置；台账带统计头。
- 通知：每日简报就绪（点击跳会话）与指标异动（指数 ±1.5%、中债 10Y
  5bp、USDCNH 0.3%，同向 4 小时去重），toast + 侧栏未读红点。
- 第四轮优化（方案 docs/20260919-06）：轮动行业名统一为规范名（中证能源…
  中证公用、上证基金指数），历史不足的行显式「数据不足」，不再用占位分数
  伪造信号；轮动评分历史（`userData`，交易日为键）输出「较上一交易日」
  变化，年化波动 ≥45% 标注高波动（仅提示）；行业模型新增板块 PE 与市值
  TOP100 板块估值分位；决策台账支持筛选 / 编辑 / 删除 / 导出 CSV；汇报
  支持复制摘要、导出 Markdown 到工作区与打印（自动切浅色主题、隐藏操作
  控件）；板块列表解析增加 `f9`（PE）字段。
- 信息降噪（方案 docs/20260920-01）：概览去重——摘要句只留轮动信号与评分
  提升者，原 6 格 KPI + 六步闭环条合并为 5 格 KPI；操作区 7 按钮收纳为
  「刷新 + 导出菜单（复制/导出/打印）+ 通知」；数据底座整块折叠（折叠行
  显示就绪源数与关键指数摘要）；轮动口径下沉为表下脚注、资金流 TOP10 折叠
  为一行前三名；行业面板 KPI 7 → 5；台账筛选器收纳进「筛选」按钮。打印与
  导出内容不受折叠状态影响。
- CEO 阅读化（方案 docs/20260920-03）：顶部结论句改为直接结论——「建议
  超配 / 建议低配」全量名单（不再截断、不再以模型术语开头）+「较上一
  交易日」走强 / 走弱各一名；研究操作默认隐藏、悬停显现（引用核心指标、
  生成轮动周报、设为工作日任务、记录决策、生成行业定价分析、筛选、导出
  CSV、复盘与再训练、台账行内归因 / 编辑 / 删除），阅读态页面只保留
  刷新 / 导出 / 通知。
- 生成归后台、界面回归查看（方案 docs/20260920-04）：首次启动一次性自动
  开通三个宏观任务——轮动日报（工作日 08:30）/ 轮动周报（周一 09:00）/
  复盘周报（周五 16:00），此后删除 / 停用 / 改期都不被覆盖；任务完成后取
  会话最终答复落盘为工作区报告（`.workbench/research/reports/`，md + 索引
  json）并推简报通知；页面新增「后台简报 · 自动生成」区（查看 / 复制 /
  在对话中打开 / 立即生成 / 重新生成）；模型区动作收敛为「重新生成（后台
  任务立即跑一次）+ 交给对话解析（带上下文开新会话）」；移除「设为工作日
  任务」与页面直接生成按钮；顺带修复每日限额守卫的 `taskId` 传参（原先
  守卫不生效、任务可能同日重复触发）与同 id 任务重复排程。

### Added（WorkBuddy 三套机制移植，方案 docs/20260911-01）

- profile（app-config，注意其在 .gitignore 中、随打包分发）新增 6 个技能：
  finance-core（45 个五段式方法论 + 红线/检索纪律总入口）、finance-quant
  （16 个算法引擎，run_signal 统一 JSON 契约）、office-routing（Office 路由
  门卫）、office-docx（Word md→html→docx 三阶段，含 html_to_docx 引擎全量与
  html-review 评审门禁）、visual-output-spec（富内容规范，含 Visualizer 设计
  宪法原文）；xlsx-author / pptx-author 增强（recalc 重算交付门禁、缩略图
  回读自检）。AGENTS.md「输出渲染约定」改薄指针，详规按需加载。
- kv-card 支持 `actions` 按钮：点击把 prompt 预填到会话输入框（复用
  composerDraft 语义，追加 + 聚焦，不自动发送）。
- lint-skills.mjs 结构检查：SKILL.md 提及的 references/scripts 路径存在性 +
  finance-core 五段模板标题完整性（skill-creator 教学示例豁免）。

### Added（工程底座）

- 统一格式化与 lint 门禁：prettier（`.prettierrc.toml`）、markdownlint
  （`.markdownlint-cli2.yaml`）、editorconfig；eslint 8 legacy → 9 flat config
  （`eslint.config.mjs`），覆盖全仓（apps / packages / relay / client）。
- 根聚合脚本：`format` / `format:check` / `lint` / `lint:fix` / `typecheck` /
  `test` / `md:check`（对称 check 对，CI 与本地同源）。
- GitHub Actions CI（`.github/workflows/ci.yml`）：路径感知 + 分 job，
  本地 actionlint 静态校验通过（真实运行待有远端后验证）。
- devcontainer（`.devcontainer/`）：Node 20 + pnpm 开发容器。
- packages/sdk 测试：基于 mockServer 的事件归一化与 session 生命周期测试。
- 存量清理：全仓 unused import / 死代码（`startApi` 等）、4 处延迟
  `require()` 改为顶层 import、`RoomsPage` 订阅 effect 依赖修正（onLeave ref）。

### Fixed

- run_signal.py vcp 引擎 pandas 3.x 兼容（np.array_split 直接切 DataFrame
  产出 ndarray 导致列访问崩溃，改为切索引再 iloc）。
- 修复 2 个既有失败的 desktop 测试（SessionPage not-found、CommandPalette
  open）：jsdom 测试环境缺少 Electron preload 桥，AppShell 级测试挂载
  Sidebar 时订阅 IPC 事件崩溃。测试 setup 现提供 noop `window.electronAPI`
  stub（`on*` 返回退订函数，其余方法返回 resolved Promise）。
  desktop 测试 255/255 全绿。

### Docs

- AGENTS.md 新增「工程规范」节（格式化 / lint / CI / 测试 / 版本约定，含豁免说明）。
- 修正 scripts/README.md 中过时的 Tauri 描述。
