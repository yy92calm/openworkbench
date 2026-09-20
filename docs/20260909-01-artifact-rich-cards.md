# 会话产物富卡片与富围栏补强方案

日期：2026-09-09，序号 01

## 背景

会话渲染富文本的前一半已落地：`docs/20260906-01-rich-fence-rendering.md` 让 ` ```html / ```svg / ```echarts ` 围栏在 chat 路径渲染为活内容（沙箱 iframe / 可视图 / echarts 图表，懒加载约 1MB 的 echarts）。该方案明确留了两个尾巴：

1. **document 变体**（本地 .md 报告预览）不解析富围栏，报告里的图表仍是一段代码。
2. **会话输出产物卡片**（本方案主增量）：agent 用 write/edit 产出的文件目前只有 `ArtifactCard` 单行卡——图标 + 文件名 + 类型徽章 + 两行纯文本预览。figure（截图/图）看不到图、csv 看不到表、html 看不到页面，必须点 Open 跳 inspector 才知道内容是什么。

目标：产物卡片按类型内联富预览（图可见、表可见、HTML 可见），同时补上 document 变体的富围栏解析。不改变点击行为（仍进 inspector）、不改存储与复制语义。

## 设计

### 1. 产物卡富预览（ArtifactCard 内联）

新增 `ArtifactPreview` 子组件，按扩展名分流（判定抽为纯函数 `artifactPreviewPlan` 放 `lib/artifacts.ts`，可单测）：

| 类型 | 预览形式 | 数据来源 |
|------|----------|----------|
| figure（png/jpg/jpeg/gif/webp） | 内联缩略图（`max-h-56` object-contain，深浅主题通用底色） | `readArtifact` binary → data URI；block.content 已带文本时忽略（二进制必读盘） |
| figure（svg） | `<img>` data URI | 同上 |
| table（csv/tsv） | 迷你表（前 5 行 × 前 6 列）+ 「N 行 × M 列」徽章 | `readArtifact` 文本 + `parseTableFile` |
| report（html） | 沙箱 iframe live 预览（`h-[320px]`，`sandbox="allow-scripts"` + srcDoc，安全语义与 0906 方案一致） | block.content 优先，否则 `readArtifact` 文本 |
| script / notebook / model / data / report(md等) | 维持现状（两行文本预览） | 不读盘 |

约束：

- **容量保护**：预览读取上限 2MB，超限显示「文件过大，点击查看」不读盘，防长会话卡顿。
- **懒加载 + 静默降级**：预览挂载才读文件；读取/解析失败一律退回现状文本卡，不阻塞列表、不出错误弹窗。
- block.content 已带内容（write/edit 事件携带）时直接用，避免二次 IO。
- 点击行为、Open 徽章、复制语义全部不变。

### 2. document 变体启用富围栏（0906 遗留项）

- `MarkdownViewer` 的 `splitRichFences` 分支条件从 `variant === 'chat'` 放宽为两种变体都拆分；`FencePreview` 增加 `variant` prop，围栏降级为代码块时用对应变体样式（原实现写死 chat）。
- 报告视图中 ` ```echarts / ```html / ```svg ` 与 chat 同语义（同一状态机：未闭合隐藏、闭合校验、失败退代码块）。

### 3. 不做的事（显式排除）

- 不新增围栏语言（mermaid / csv 围栏等不在本次点名范围）。
- 不改 fold/runtime 引擎与 shared 类型（沿用 0906 的"渲染层内自洽"定位）。
- 不做产物卡批量操作/多选/下载增强。
- relay / client 不动。

## 验证状态

### 已完成的调研

- [x] 0906 方案与 `fences.ts` / `FencePreview.tsx` 现状核对：chat 路径已接入，document 变体显式排除。
- [x] 产物链路核对：`ArtifactCard`（单行卡）、`BlockList` artifact 分支、`readArtifact`（binary base64 / utf8）、`previewUrl`、`parseTableFile`（csv/tsv 解析已有带测试的实现）。
- [x] echarts 依赖已在（^6.1.0，懒加载先例在 `FencePreview.EchartsPreview`）。

### 实施记录

| 验收项 | 验证方式 | 状态 |
|--------|----------|------|
| `artifactPreviewPlan` 纯函数 + 单测 | `lib/artifacts.ts`：figure(png/jpg/jpeg/gif/webp)→image、figure(svg)→svg、table(csv/tsv)→table、report(html)→html，其余 null；大小写不敏感；新增 6 用例 | 已实施，25/25 通过 |
| ArtifactCard 富预览 | `ArtifactPreview` 子组件：image/svg 缩略图（data URI，base64 上限 4MB）、csv/tsv 迷你表（前 5 行 × 6 列 + 维度徽章）、html 沙箱 iframe（320px）；读取/解析失败与超限一律静默退回文本卡；有 inline content 时零 IO；点击/Open/复制行为不变 | 已实施 |
| document 变体富围栏 | `MarkdownViewer` 两种变体都走 `splitRichFences`；`FencePreview` 加 `variant` prop，降级代码块按变体取样式；原「document 保持代码块」用例按新语义反转 + 新增 echarts document 用例 | 已实施，8/8 通过 |
| 现有测试不退化 | `pnpm typecheck` 通过；`pnpm test` 全量通过（desktop 48 文件 388 用例 + relay 22）；改动文件 lint 0 错误 0 警告 | 通过 |

安全语义沿用 0906 方案：HTML 只进不透明源沙箱 iframe（`sandbox="allow-scripts"` + srcDoc）、svg 只走 `<img>`、csv 只做文本解析，无任何回连应用代码的通道。

### 增量一（2026-09-09，产物表触发缺口）

排查「产物表格没出现」：产物卡只在 `write/edit/create/str_replace_editor/apply_patch` 工具成功时生成（`artifacts.ts:WRITE_TOOLS`）；agent 用 bash/python 落盘或直接输出 ` ```csv ` 代码块时两者都不触发。修复：

| 项 | 实现 | 状态 |
|----|------|------|
| csv/tsv 围栏富渲染 | `RICH_FENCE_LANGUAGES` 加 `csv`/`tsv`；`FencePreview` 新增分支（先 `parseTableFile` 校验，失败退代码块，维持 0906 状态机） | 已实施 |
| MiniTable 共用组件 | 从 ArtifactCard 抽出 `components/thread/MiniTable.tsx`，产物卡与 csv 围栏共用（前 5 行 × 6 列 + 维度徽章） | 已实施 |
| prompt 约定补强 | AGENTS.md 约定第 4 条明确「必须用 write 工具写文件，bash 重定向/heredoc/python 落盘不出产物卡」 | 已实施（详见 20260909-02） |
| 测试 | fences 3 用例（csv 拆分/tsv/流式隐藏）+ MarkdownViewer 2 用例（csv 渲染/非法退代码块） | 已实施，全量 393 用例通过 |
