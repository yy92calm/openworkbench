# 决策台账闭环修复（记录 → 归因 → 再训练）

## 背景

宏观洞察的「决策台账 · 记录 → 归因 → 再训练」上线后观感上"没有效果"。
排查真实工作区（`~/Documents/Workbench`）与代码后，确认不是单点 bug，而是
闭环在三处断开：

1. **知识资产写不进去**：macOS Seatbelt / Linux bwrap 把 `.workbench` 整体
   设为写保护（`apps/desktop/src/main/sandbox/seatbelt.ts`、
   `apps/desktop/src/main/sandbox/bwrap.ts`），但复盘 prompt 要求 agent 用
   `write` 工具写 `.workbench/research/knowledge.md`
   （`packages/shared/src/macro.ts` 的 `buildReviewPrompt`）。
   实际工作区最近一次复盘报告正文就是写入失败的报错，`knowledge.md` 至今
   不存在。
2. **归因不会自动回填**：复盘只输出文字建议，不回写 `decisions.jsonl`；
   未归因决策必须手工逐条点「归因」，胜率长期为空。
3. **复盘缺少证据**：prompt 只带决策原文，不带决策后的行情/评分变化，
   模型无法判断当时论据是否成立。

另有一个事实：当前工作区 `decisions.jsonl` 为 0 条，所以台账本身也是空的；
本次同时要让「记录」之后整条链路可观测。

## 设计

### 1. 所有权：知识资产由主进程写

- 不再让 agent 写 `.workbench`。复盘 prompt 改为要求模型输出两个固定标记块
  （见下），由主进程解析并落盘。
- 新增 `saveKnowledgeDigest(markdown)`：校验非空、截断到 20,000 字符、
  原子写入 `.workbench/research/knowledge.md`，返回字符数。
- 标记块缺失或为空时**不覆盖**已有知识资产，避免一次失败把积累清空。

### 2. 复盘协议（严格、可失败即忽略）

复盘 prompt 末尾要求输出：

```text
<research-attributions>
[{"id":"<决策 id>","outcome":"hit|partial|miss","note":"一句话复盘"}]
</research-attributions>
<research-knowledge>
# 投研知识资产
...
</research-knowledge>
```

解析规则（`packages/shared` 纯函数 `parseResearchReview`）：

- 只接受本次 prompt 中列出的、状态仍为 `open` 的决策 id；未知 id、非法
  `outcome`、空 `note` 一律丢弃，单条说明截断到 500 字符。
- 同一 id 重复出现时后者覆盖前者。
- 标记块内容允许被 `json` / `markdown` 代码围栏包裹，解析前先剥离外层围栏。
- 知识块整体作为 `knowledge.md` 正文；标记块从人类可读报告中移除。
- 任一标记块缺失都不影响另一块；两块都缺失时只保存报告，不改台账/知识。
- 解析失败不抛错，返回空结果并保持现状（与 LLM Wiki 的"非法响应零写入"
  原则一致）。
- prompt 明确要求：证据不足或决策不足 2 个交易日时不要强行归因。

### 3. 决策后证据

新增主进程 `buildDecisionEvidence(decisions)`，对最多 10 条未归因决策生成
证据行：

- 轮动决策：按行业名匹配中证十大行业，附带当前评分/信号/较上一交易日、
  60 日收益与相对强度；再用日线计算「决策日至今」行业收益、沪深 300 同期
  收益与超额。
- 行业决策：按板块名匹配东财板块，附带实时涨跌、PE、主力净流入；对最多
  5 条决策拉取板块日线，计算「决策日至今」收益。
- 数据缺失时显式写「暂无决策后的行情数据」，不伪造结论。

证据通过 `formatReviewContext` 追加到每条未归因决策下方；稳定格式便于模型
引用，也便于人工核对。

### 4. 自动回填

- `captureMacroReport` 在 `review-weekly` 主题完成后读取最后一条 assistant
  文本，调用 `parseResearchReview`。
- 命中归因的决策由主进程统一写入 `reviewed` + `attribution`，`reviewedAt`
  使用本次完成时间；已归因的决策不会被覆盖。
- 知识块存在时调用 `saveKnowledgeDigest`。
- 报告落盘使用移除标记块后的正文；通知标题补充自动归因条数与知识资产是否
  更新（`pushBriefing` 仍保持原签名，只调整标题文案）。
- 广播 `research-updated`，页面收到后重新拉取台账与知识摘要。

### 5. 可观测性

- `MacroInsightsPage` 订阅 `research-updated`：复盘完成后，台账统计、归因率、
  知识资产字数无需手动刷新即可变化。
- 台账标题旁补充一句闭环说明：「复盘任务完成后会自动回填归因并更新知识
  资产」，避免用户以为仍需逐条手工归因。
- 台账原「交给对话解析」按钮改为「后台复盘并回填」：交互式会话的产出无法
  被自动解析，保留它只会造成"看起来跑了、实际没落盘"的错觉；后台任务的
  会话仍可从通知进入继续追问。
- 页面已有 KPI「知识资产」在文件生成后显示实际字数（原逻辑不变）。

### 6. 不改动的部分

- 轮动/行业评分仍是确定性规则，本次不让知识摘要直接改评分（按用户选择，
  信号校准留作后续独立方案）。
- 手工「归因 / 编辑 / 删除 / 导出 CSV」保持原样，自动回填只是补充路径；
  导出 CSV / 汇报文件顺带改用 `atomicWriteFile`（原先缺少 `writeFileSync`
  导入，运行时会抛 ReferenceError）。
- 知识摘要仍注入所有宏观模型 prompt（现有 `formatResearchContext` 路径）。

## 文件清单

| 文件 | 改动 |
| --- | --- |
| `packages/shared/src/macro.ts` | 复盘协议类型与解析、证据格式化、复盘 prompt 改写 |
| `apps/desktop/src/main/research.ts` | `saveKnowledgeDigest`、`applyReviewAttributions` |
| `apps/desktop/src/main/researchData.ts` | 纯函数批量归因合并 |
| `apps/desktop/src/main/researchEvidence.ts`（新增） | 决策后行情/评分证据 |
| `apps/desktop/src/main/ipc.ts` | 复盘完成解析、落盘、广播、通知文案 |
| `apps/desktop/src/preload/index.ts`、`renderer/electron.d.ts`、`renderer/lib/electron.ts` | `research-updated` 订阅 |
| `apps/desktop/src/renderer/app/routes/MacroInsightsPage.tsx` | 自动刷新与闭环说明 |
| 测试 | `macroPrompts.test.ts`、`researchData.test.ts` |

## 验证状态

- [x] 方案文档完成
- [x] `parseResearchReview` 单测：合法块、非法 id/outcome、重复 id、缺失块、
  代码围栏
- [x] 批量归因合并单测：只更新 open、已归因不覆盖
- [x] 主进程落盘单测：`knowledge.md` 写入、空内容不覆盖、归因幂等
- [x] 证据/复盘上下文格式化单测：决策 id、证据行、已归因列表
- [x] `pnpm format:check`、`pnpm lint`（0 error）、`pnpm test`（desktop 653 /
  sdk 3 / relay 22）、`pnpm md:check`、`pnpm build` 全部通过
- [ ] 真实复盘任务端到端（需 sidecar + 模型凭证，会产生真实调用）
