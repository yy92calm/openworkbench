# 富输出触发约定（prompt 侧）方案

日期：2026-09-09，序号 02

## 背景

0906/0909 两批把渲染通道建齐了（` ```html / ```echarts / ```svg ` 富围栏、`workbench:` 键控缝、产物卡富预览），但通道是**被动的**：模型不知道这些约定存在，实际会话中几乎不会主动输出对应语法，「很难触发」。

修复方式不是改渲染层，而是在 profile 的 `AGENTS.md` 里加一节紧凑的**输出渲染约定**，让 agent 在合适场景主动选择富格式。

约束：`AGENTS.md` 注入每个会话的系统提示（性能方案 A1 要求前缀稳定、篇幅克制），新增内容必须短、稳定、无时效性。

## 设计

在 `app-config/.opencode/AGENTS.md` 的「使用方式」之后新增一节「输出渲染约定」，规则：

1. 数据图表：先一句结论，再输出 ` ```echarts ` 围栏（内容为单个 option JSON 对象，数据必须来自真实查询，禁止编造）；围栏语言行必须精确为 ```echarts，不带附加修饰。
2. 独立网页 / 仪表盘 / 可交互报告：` ```html ` 完整单文件（内联 CSS/JS）。
3. 矢量示意图 / 流程图：` ```svg `。
4. 数据表：小表（约 ≤10 行）用 markdown 表格；大表写入 workspace 的 csv/tsv 文件（会话自动出现表格产物卡，可打开全量）。
5. 图片 / 成品文件：直接写入 workspace 文件，会话自动出现产物卡（图片/HTML 内联预览）。
6. 键值摘要卡：` ```workbench:kv-card `（JSON），适合风险摘要、候选对比等结构化小结。

不新增文档文件；本节即约定全文。

## 验证状态

### 已完成的调研

- [x] 渲染通道核对：`RICH_FENCE_LANGUAGES`（html/svg/echarts）chat+document 双变体生效；`workbench:kv-card` 已在 `interaction/renderers.json` 启用；产物卡富预览按扩展名自动分流。
- [x] AGENTS.md 现状核对：95 行，instructions 注入系统提示，新增节控制在 15 行内。

### 实施记录

| 验收项 | 验证方式 | 状态 |
|--------|----------|------|
| AGENTS.md 增「输出渲染约定」节 | 内容 ≤15 行、无时效性表述；markdownlint 不涉（app-config 在排除清单） | 待实施 |
| 生效验证 | 重启 sidecar（syncDir 重新镜像）后新会话按约定输出富格式 | 待实施 |

### 增量（2026-09-09）：write 工具强制条款

排查发现产物卡只认 `write/edit` 等写工具（`WRITE_TOOLS`），agent 习惯用 bash 重定向或 python 脚本落盘，产物卡不触发。约定第 4 条已补：**必须用 write 工具写文件，bash 重定向 / heredoc / python 落盘不会出现产物卡**。csv/tsv 代码块的直接渲染见 20260909-01 增量一。
