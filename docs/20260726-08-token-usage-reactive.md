# 上下文面板 token 显示 0 修复

## 背景

右侧「上下文」面板的 token 用量与百分比一直显示 0，即使会话已有内容。`TokenUsage` 从当前 thread 的 blocks 估算 token（chars/4），但 thread 通过 `useRuntimeStore((s) => s.threads)` 整体订阅后在渲染中计算，再经 `useMemo([thread])` 缓存。该 selector/缓存组合下，thread 变化未必触发 `countBlocks` 重算，导致估算恒为初始值 0。

`OpenCodeClient` 的 `text.updated` 已确认是全量累积（`acc.text += d.delta` 后 emit 全量），agent 文本不缺，故根因在响应式而非数据。

## 设计

- `TokenUsage` 改为**直接订阅 thread 对象**：`useRuntimeStore((s) => s.currentId ? s.threads[s.currentId] : s.threads[DRAFT_KEY])`。Zustand 精确追踪 thread 引用，thread 变化即重渲染。
- 去掉对 `threads` 的整体订阅，减少无关重渲染。
- `estimates` / `totals` 去掉 `useMemo`，每次渲染直接计算，彻底避免依赖比较导致的缓存命中不更新（blocks 规模小，开销可忽略）。
- `countBlocks` / `estimateTokens` / `resolveContextWindow` 逻辑不变。
- `contextWindow` 的 `useMemo` 保留（依赖 `defaultModel`/`providers`，变化少）。

## 验证状态

- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 199/199 不回归。
- [x] `pnpm lint` 改动文件 0 error。
- [ ] 有对话的会话切到「上下文」tab，token 数与百分比随对话增长。（待人工验证）
