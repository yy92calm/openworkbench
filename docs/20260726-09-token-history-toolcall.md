# 上下文 token 估算修复（历史会话 tool-call 无摘要）

## 背景

上下文面板 token 仍显示 0（消息数 10）。根因：`historyToThread` 生成的 tool-call block **未设** `inputSummary`/`outputSummary`（仅 `foldEvent` 的 live 路径设置），而 `countBlocks` 用这俩字段估算 token，导致历史会话的 tool-call 贡献 0。若会话以工具调用为主（user/agent 文本少），总 token 恒为 0。

## 设计

- `historyToThread` 的 tool-call block 加 `inputSummary`/`outputSummary`，复用 `foldEvent` 同款的 `extractInputSummary`/`extractOutputSummary`，使历史会话与 live 估算一致；userShell 的 outputSummary 仍优先用完整 output。
- `countBlocks` 的 tool-call 额外计入 `title.length`（保底，工具标题总有值），避免任何 tool-call 漏算。
- user/agent/reasoning 逻辑不变。

## 验证状态

- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 199/199 不回归。
- [x] `pnpm lint` 改动文件 0 error。
- [ ] 历史会话（含工具调用）切到「上下文」tab，token 数 > 0 且随工具/文本增长。（待人工验证）
