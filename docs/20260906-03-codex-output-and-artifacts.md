# 20260906-03 对标 Codex：输出与产物内容优化

## 背景与目标

用户要求「按 codex-main 的代码优化输出以及产物内容」，范围覆盖四个方向：
会话富内容输出渲染、文件产物卡/预览内容、工具与 shell 输出处理、以及上述之外的相关差异。
本轮先对 codex-main（`~/Desktop/codex-main`，Rust 单体仓）做了定向代码勘查，
把它的约定映射到本应用（opencode sidecar + React 壳层），只落地**可验证的真差异**；
已对齐的部分在文档中写明依据，不做重复劳动。

## codex-main 勘查结论（证据）

| 主题 | codex-main 行为（文件） | 本应用现状 |
| --- | --- | --- |
| 富内容/输出结构 | 消息文本是纯文本（无 markdown 字段）；reasoning 与正文严格分离（`MessagePhase::Commentary/FinalAnswer`、reasoning summary 分段流式，`protocol/src/models.rs`、`core/src/stream_events_utils.rs`）；展示前剥离隐藏标记（`strip_hidden_assistant_markup`） | 正文走 markdown 富渲染（fences/a2ui/工作台缝已剥离隐藏标记），reasoning 独立折叠块——结构与 codex 同构，已对齐 |
| 工具输出截断 | 捕获上限 1 MiB、仅存头部；交互路径 head+tail 中间省略标记 `"... N bytes omitted ..."`；给模型的正文带 `Exit code` / `Wall time` / `Total output lines` 头（`core/src/exec.rs`、`core/src/unified_exec/`、`core/src/tools/mod.rs`） | 截断与头信息在 sidecar（opencode）完成；壳层按行数/字节数做摘要（`extractMeta`/`extractOutputSummary`）——职责在 sidecar，壳层已显示行数与耗时，基本对齐 |
| ANSI | **存储原样、展示层处理**：`ansi-escape` 仅在渲染时把转义转成样式文本（`tui`），不落库（`codex-rs/ansi-escape/src/lib.rs` 及全仓 grep 无存储层 strip） | 壳层个别纯文本展示位直接输出原始字符串，若含转义序列会露出 `[31m` 类乱码——**本轮落地展示层净化** |
| 产物（artifacts） | `artifact_type` 分类法：presentation/document/spreadsheet/pdf + `output_format` 白名单（`core-plugins/src/artifact_operation.rs`），产物元数据随 `CommandExecutionItem.plugin_id/script_path` 到达消费端 | 产物卡（ArtifactCard/Figure/引用 chip）与 FilePreview 已覆盖 html/svg/office/csv/pdf 预览与下载——能力对齐；codex 该机制绑定其 marketplace 技能运行，无壳层可移植面 |

结论：四个方向里「富内容输出渲染」与「产物卡」两轴在前几轮方案（20260903-01 A2UI、
20260906-01 富围栏、20260906-02 报文轮次）已主体落地；codex 侧没有可再迁移的 React/壳层行为。
本轮落地的是勘查发现的**真实展示层差异：ANSI 净化**，并把对齐结论固化进文档。

## 设计

### ANSI 展示层净化（codex `ansi-escape` 精神的壳层版）

codex 原则：**存储不动、展示时处理**。本应用没有终端级渲染器来消费转义序列的纯文本位，
若原始输出含 ANSI（如工具输出被原样带进历史、本地 kernel 运行结果），会显示 `[31m` 乱码。
做法与 codex 完全一致——不在写入侧改数据（provenance 等保持原样），只在展示组件里剥离。

- 新增纯函数 `stripAnsi(text: string): string`（`lib/ansi.ts`，无依赖，可单测）：
  - CSI 序列 `\x1b\[[0-9;?]*[ -/]*[@-~]`（颜色/光标/擦除等全部 SGR 与 CSI）；
  - OSC 序列 `\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)`（标题等）；
  - 其他单字符转义（`\x1b[()][0-9A-Z]` 字符集选择等），不误伤正文 UTF-8。
- 落地展示位（仅「原始输出文本」类位置，均可能携带转义）：
  1. `ToolCallRow`：展开详情 Input/Output `<pre>` 与折叠错误预览（模型工具输出摘要原样来自事件）；
  2. `MarkdownViewer/CodeBlock`：Run 按钮的本地 kernel 执行结果（`formatExecResult` 输出）；
  3. `ProvenancePanel`：`record.content` 正文（记录自工具输出/生成代码，可能含颜色转义）。
- 不在写入侧脱敏/剥离：provenance JSONL、会话存储保持不变（与 codex 存储原样一致，也避免破坏已有脱敏与审计语义）。

### 已对齐（不做，留档依据）

- 富内容输出渲染：fences（html/svg/echarts）与 A2UI 已在渲染层剥离/替换隐藏内容（等同 codex
  `strip_hidden_assistant_markup` 的用途）；reasoning 独立折叠不混入正文。
- 工具输出摘要/行数/耗时 meta 与错误色：壳层已按 opencode 数据提供（codex 的
  `Exit code/Wall time/Total lines` 头信息在 sidecar 层职责内，壳层不重复造）。
- 产物识别分类法：codex 绑定 marketplace 技能运行时（mjs 脚本 + 归因），对 opencode/壳层不可移植；
  我们的产物卡与预览类型已覆盖其分类法对应的文件类型。

## 验证状态

### 单元测试（全部通过）

| 用例 | 结果 |
| --- | --- |
| stripAnsi：SGR 颜色序列、光标/擦除 CSI、OSC 标题、字符集转义、无转义文本原样、多行混合正文不误删 | `lib/ansi.test.ts` 6 用例 ✅ |
| ToolCallRow：含 ANSI 的 outputSummary 渲染为净化文本、无转义时原样 | `components/thread/ToolCallRow.test.tsx` 增 2 用例 ✅ |

### 门禁与构建

1. `pnpm format` / `pnpm lint` / `pnpm typecheck` 通过（无 warning）
2. `pnpm test`：desktop 全量 + sdk + relay 通过，无回归
3. `pnpm md:check` 0 errors
4. 手动视觉验证（待执行）：`pnpm dev` 用带 ANSI 颜色的脚本输出经工具/本地 Run 走一遍，确认不再出现 `[31m` 乱码
