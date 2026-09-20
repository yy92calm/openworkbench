# 20260906-02 上下文面板：请求报文按轮次组织与摘要净化

## 背景与目标

上下文面板（`ContextPanel` → `TokenUsage`）底部的「请求报文」列表是面板里唯一的会话历史视图，当前问题：

- **摘要未经净化**：`markdown.slice(0, 80)` 直接截断——流式正文里的代码围栏会被拦腰截断成孤立的 ` ``` `、标题/加粗符号、表格管道符原样露出，预览观感差、信息量低。
- **粒度不是「报文」粒度**：把每个 tool-call 块平铺成一条独立「消息」，与真实请求（一轮 = 用户消息 + AI 回复 + 其间工具调用）不符；长工具密集会话里列表被工具行淹没，用户/AI 内容反而难找。

目标（用户已确认范围）：**摘要净化 + 按轮次组织**——工具调用折叠进所属轮次，列表读起来像报文结构。不做：点击跳转定位、时间戳/排序改造（未选）。

## 设计

### 1. 轮次划分（纯函数，可测）

轮次边界 = `user` 块。规则：

- `user` 块 → 开启新轮次；`agent` 块归入当前轮次（同轮多个 agent 文本块按出现顺序 `\n` 拼接为一条「AI 摘要」）；
- `tool-call` 块归入当前轮次（首个 user 之前的零散块并入隐式首轮，兜底不丢数据）；
- `reasoning` 等其余块忽略（与现状一致：它们不是发往模型的报文正文）。

```ts
export interface TurnEntry {
  /** 原始文本，渲染时净化（净化器保持单测覆盖） */
  user?: string;
  agent?: string;
  tools: { name: string }[];
}
export function buildTurns(blocks: ReadonlyArray<ThreadBlock>): TurnEntry[]
```

### 2. 摘要净化管线（纯函数，可测）

`cleanSummary(raw): string`——只删语法、不改语义：

- fenced code block 整体删除（含 info 串，如 ` ```html ` 富围栏与 ` ```a2ui `，后者虽在 fold 已抽但兜底）；
- 残留的孤立围栏标记行（未闭合 ` ``` ` 等）删除；
- 标题 `#`、引用 `>`、列表标记 `-`/`*`/数字、分隔线、加粗/斜体/删除线符号删除，保留文字；
- 链接 `[文字](url)` 保留文字、图片 `![alt](url)` 用 alt、行内代码 `` `x` `` 取 x；
- 表格：分隔行（纯 `-`/`|`）删除，单元格分隔 `|` 转 ` · `；
- 空白折叠为单空格、去首尾；长度上限（展示行 CSS ellipsis，title 悬停给全文）。
- **全空回退**：净化后为空但原文非空（纯代码/图表围栏），返回「（代码/图表内容，详见对话）」占位，避免出现空白行。

### 3. 列表 UI 组织（TokenUsage 内部改造）

- 数据源：`messages` 平铺数组改为 `buildTurns(thread.blocks)` 的轮次数组（useMemo 依赖 blocks）。
- 每轮渲染：`用户` 行（chip 用户色 + 净化摘要）→ `AI` 行（chip AI 色 + 净化摘要）；有工具的轮次在 AI 行下渲染一行
  「含 N 次工具调用」折叠头（ChevronRight，展开旋转 90°），展开显示工具名子行（缩进、更小字号）；
  轮次间以细分隔线分组，延续现有 chip/字号/配色。
- 折叠默认收起；展开状态以轮次序号为键（轮次只增不减，键稳定）。
- 会话信息卡的「消息数」改为「轮次」，值 = 轮次数（与列表的组织语义一致）。
- 空会话提示沿用原判定。

### 4. 不做

- 点击跳转/定位消息、时间戳展示、倒序或自动滚底（用户未选，留待后续）。
- 每轮真实 token 用量（thread 无该数据，需消费 API 事件，另行评估）。
- 共享/示例等非会话场景（TokenUsage 只在上下文面板使用）。

## 验证状态

### 单元测试（全部通过）

| 用例 | 结果 |
| --- | --- |
| turns：user 开轮、同轮多 agent 拼接、tool 归属当前轮、reasoning 忽略、首个 user 前碎片并入首轮、空 blocks、隐式轮兜底 | `lib/messageTurns.test.ts` 7 用例 ✅ |
| cleanSummary：代码围栏整体删除、孤立围栏标记、富围栏（html/echarts）、行内代码/粗斜体/删除线、链接保文字、图片取 alt、表格分隔行与管道符、空白折叠、纯代码回退占位 | `lib/messageTurns.test.ts` 同文件 9 用例 ✅ |
| TokenUsage：轮次行渲染（用户/AI chip 与净化文本、无 markdown 符号残留）、工具折叠收起默认隐藏、点击展开显示工具名、「轮次」计数正确、空会话提示 | `components/inspector/TokenUsage.test.tsx` 4 用例 ✅ |

### 门禁与构建

1. `pnpm format` / `pnpm lint` / `pnpm typecheck` 通过（无 warning）
2. `pnpm test`：desktop 全量 + sdk + relay 通过，无回归
3. `pnpm md:check` 0 errors
4. 手动视觉验证（待执行）：`pnpm dev` 打开会话 → 上下文面板查看「请求报文」分组与工具折叠、流式中摘要变化
