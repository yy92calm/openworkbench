# 对话信息展示与预览优化

## 设计

### 概述

当前对话界面存在较多信息缺失：工具调用不显示输入输出、错误信息不可见、工件无内容预览、步骤摘要未生成、流式无进度指示等。本次优化聚焦于提升信息密度和可读性，让用户无需展开即可了解关键信息，同时支持按需查看详情。

### 当前问题清单

| 问题 | 严重度 | 说明 |
|------|--------|------|
| 工具调用无输入输出 | 高 | `inputSummary`/`outputSummary` 字段定义但从未填充和渲染 |
| 工具调用无错误信息 | 高 | 失败时只有状态图标，错误原因不可见 |
| 工具调用无可展开详情 | 中 | 单行展示，无法查看完整参数和输出 |
| 工具调用无 meta 信息 | 中 | 耗时、行数、文件大小等元数据从未填充 |
| 工件无内容预览 | 中 | 卡片只显示文件名和类型，无内容摘要 |
| 步骤摘要从未生成 | 低 | `StepSummaryBlock` 组件存在但从未被创建 |
| 数据表格从未生成 | 低 | `DataTableBlock` 组件存在但从未被创建 |
| 流式无进度指示 | 低 | 代理输出时无光标动画或「正在输入」提示 |
| 代理消息无元数据 | 低 | 不显示模型名称、token 用量、延迟 |

### 优化范围

本次聚焦前三项高优先级问题，中低优先级留待后续迭代。

#### 1. 工具调用行增强

##### 输入摘要（inputSummary）

在 `foldEvent()` 中从 `event.input` 提取关键信息，格式化为一行摘要：

| 工具 | 摘要格式 |
|------|----------|
| `bash` | `$ {command}`（截断到 80 字符） |
| `write` / `edit` | `{filepath}` |
| `read` | `{filepath}`（含 offset/limit） |
| `question` | 跳过（由 InteractionPrompt 处理） |
| `task` | `{subagent_type}: {description}` |
| 其他 | `{tool_name}` |

##### 输出摘要（outputSummary）

在 `foldEvent()` 中从 `event.output` 提取关键信息：

| 工具 | 摘要格式 |
|------|----------|
| `bash` | 首行输出（截断到 120 字符） |
| `write` / `edit` | `{lines} 行写入` |
| `read` | `{lines} 行读取` |
| `task` | `{subagent_session_id}` |
| 其他 | 首行输出（截断到 80 字符） |

##### Meta 信息

在 `foldEvent()` 中计算并填充 `meta` 字段：

| 场景 | 格式 |
|------|------|
| 工具执行完成 | `{elapsed}`（如 `2.3s`） |
| bash 输出 | `{lines} 行` |
| write 文件 | `{size}`（如 `12KB`） |

##### 错误信息展示

当 `status === "failed"` 时，在 `ToolCallRow` 中显示红色错误摘要（从 `outputSummary` 中提取错误信息首行）。

##### 可展开详情

失败或需要关注的工具调用行，点击可展开显示完整输入/输出（`<pre>` 块）。

#### 2. 工件卡片增强

##### 内容预览

当 `ArtifactBlock.content` 存在时，在卡片中显示前 2 行的文本预览（等宽字体，灰色）。

##### 文件元数据

在卡片底部显示 `language` 标签（如果存在）和文件大小。

#### 3. 步骤摘要生成

在 `foldEvent()` 中，当检测到连续的 `tool-call` 块达到 3 个以上时，自动在它们之前插入 `StepSummaryBlock`，显示步骤计数和摘要文本。

### 界面设计

#### 工具调用行（增强后）

```text
┌──────────────────────────────────────────────────────────────┐
│  ✓ Wrote report.md                          2.3s · 156 行   │
│    $ python analyze.py --input data.csv                     │
│    Analysis complete. Generated 3 charts and 1 report.      │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  ✗ Run build script                         1.2s             │
│    $ npm run build                                          │
│    Error: Module not found: @workbench/shared              │
│    [点击展开完整错误]                                         │
└──────────────────────────────────────────────────────────────┘
```

#### 工件卡片（增强后）

```text
┌──────────────────────────────────────┐
│  📄 report.md                       │
│  artifact · via write               │
│  ┌──────────────────────────────────┐│
│  │ # 市场分析报告                   ││
│  │ 2026年Q2市场回顾与展望...        ││
│  └──────────────────────────────────┘│
│  markdown · 12KB                    │
│                          [Open]     │
└──────────────────────────────────────┘
```

### 模块变更

#### 1. `runtime.ts` — `foldEvent()` 增强

- 从 `event.input` 提取 `inputSummary`
- 从 `event.output` 提取 `outputSummary`
- 计算 `meta`（耗时、行数、大小）
- 失败时在 `outputSummary` 中包含错误信息
- 连续 3+ 工具调用时插入 `StepSummaryBlock`

#### 2. `ToolCallRow.tsx` — 增强渲染

- 渲染 `inputSummary`（灰色小字，bash 命令用等宽字体）
- 渲染 `outputSummary`（正常/错误颜色）
- 渲染 `meta`（右侧灰色小字）
- 失败状态显示红色错误摘要
- 失败/警告状态支持点击展开完整输入输出

#### 3. `ArtifactCard.tsx` — 增强渲染

- 当 `content` 存在时显示前 2 行文本预览
- 显示 `language` 和文件大小

#### 4. `StepSummaryRow.tsx` — 无需改动

组件已存在，只需在 `foldEvent()` 中创建对应的块。

### 实施计划

| # | 文件 | 操作 |
|---|------|------|
| 1 | `apps/desktop/src/renderer/lib/runtime.ts` | `foldEvent()` 中填充 `inputSummary`/`outputSummary`/`meta`，生成 `StepSummaryBlock` |
| 2 | `apps/desktop/src/renderer/components/thread/ToolCallRow.tsx` | 渲染 input/output/meta/错误信息，支持展开详情 |
| 3 | `apps/desktop/src/renderer/components/thread/ArtifactCard.tsx` | 增加内容预览和元数据展示 |

## 验证状态

| 验证项 | 状态 | 备注 |
|--------|------|------|
| 方案评审 | 已通过 | — |
| 代码实现 | 已完成 | runtime.ts + ToolCallRow + ArtifactCard |
| 类型检查 | 已通过 | tsc --noEmit 无错误 |
| 功能验证 | 未开始 | 需实际对话测试 |
