# 内置 LLM Wiki（Personal Agent 强化）

## 背景

Personal Agent 目前有三块与「长期上下文」相关的能力：

- **自动长期记忆**：会话 idle 时抽取结构化记忆，存到 `<userData>/knowledge`（`auto-memory` 分类），新会话按关键词召回并注入。
- **知识库**：用户手写的 Markdown 条目，`@` 引用后整篇发给模型。
- **主题洞察 / 工作流模式**：对会话标签做统计，不形成可积累的知识页面。

这些能力都是「一条一条的记录」：记忆之间没有链接，也不会随着会话增多被重新组织。本次引入 Karpathy 式的 **LLM Wiki**：由 LLM 把会话与自动记忆编译成互相链接的 Markdown 页面，并持续增量维护索引、反向链接和日志。人只读，不手工编辑——保证页面始终是 LLM 对全部素材的一致视图。

## 范围（已确认的决策）

| 维度 | 决策 |
| --- | --- |
| 素材来源 | 会话记录 + 自动长期记忆（不含手写知识库、工作区文件、网页） |
| 更新触发 | 手动「立即编译」+ 每日后台批量（24h 到期检查） |
| 写入模型 | LLM 独占写；UI 只读（无编辑器、无删除按钮） |
| 界面入口 | 右侧 dock 新增「Wiki」页签（Topicbar + WorkbenchDock） |

非目标：

- 不做向量检索（沿用关键词评分，与 auto-memory 一致）。
- 不做用户手工编辑、页面版本历史、导出。
- 不引入新的模型/Provider 配置；编译复用 OpenCode sidecar 当前配置。

## 设计

### 1. 数据流

```text
会话 (sidecar /session + /message) ─┐
                                    ├─→ 增量筛选 ─→ 一次 LLM 编译 ─→ 页面 upsert
自动记忆 (<userData>/knowledge) ────┘        (JSON 协议)          │
                                                                  ├─→ index.json（元数据）
                                                                  ├─→ index.md（人读索引）
                                                                  ├─→ log.md（追加日志）
                                                                  └─→ state.json（已处理指纹）

新会话首条消息 ─→ wikiRecall(query) ─→ 摘要 + 正文片段注入 prompt（并展示 wiki-recall 卡片）
```

编译是「全量视角、增量输入」：每次只把新素材交给 LLM，但 prompt 里同时给出**现有页面目录**（slug/title/summary/tags），让 LLM 决定新建页面还是合并进已有页面。索引与反向链接由应用确定性地重建，不交给 LLM。

### 2. 存储布局

根目录：`<userData>/wiki/`

```text
wiki/
  pages/<slug>.md     # 页面：YAML frontmatter + Markdown 正文
  index.json          # 元数据索引（可按页面扫描重建的派生数据）
  index.md            # 自动生成的人读目录（按标签分组）
  log.md              # 追加式编译日志
  state.json          # 上次编译时间 + 素材指纹
```

页面格式：

```markdown
---
title: OpenCode Sidecar 端口策略
summary: 应用如何为 sidecar 选择并持久化端口
tags: ["opencode", "sidecar"]
sources: ["session:ses_xxx", "memory:kb-20261004-..."]
created: 2026-10-19T08:00:00.000Z
updated: 2026-10-19T08:00:00.000Z
---

正文，使用 [[other-page-slug]] 互相链接。
```

约束：

- `slug` 只允许 `[a-z0-9][a-z0-9-]{0,63}`，直接作为文件名，拒绝路径穿越。
- `title` / `summary` / `content` 非空；正文单页上限 12000 字符。
- `sources` 只能引用本次或历史真实出现过的素材 ID。
- `index.json` 损坏按派生数据重建（对齐 `knowledge.ts` 的自愈策略）；所有写入走 `atomicWriteFile`。

`state.json`：

```json
{
  "lastCompiledAt": "2026-10-19T08:00:00.000Z",
  "lastCheckedAt": "2026-10-19T08:00:00.000Z",
  "sources": {
    "session:ses_xxx": { "fingerprint": "1750000000000:42", "compiledAt": "..." },
    "memory:kb-...": { "fingerprint": "2026-10-18T...", "compiledAt": "..." }
  }
}
```

指纹：会话 = `updatedAt:messageCount`；记忆 = `updated` 时间戳。条目按 `compiledAt` 保留最近 500 个，防止状态文件无限增长。`lastCheckedAt` 记录最近一次**执行检查**（即使没有新素材或响应不可用），每日调度以它判断 24h 周期；`lastCompiledAt` 只在真正写入页面时推进。

### 3. 素材收集与成本上限

- **记忆**：`knowledge.listEntries()` 过滤 `category === 'auto-memory'`，按 `updated` 倒序取最多 40 条，每条正文截断 1500 字符。
- **会话**：`client.listSessions()`，跳过 `parentId`（子 agent 会话）与当前编译用的临时会话；按 `updatedAt` 倒序取最多 10 条；每条 `getMessages()` 后仅保留非 synthetic 的文本，截断 4000 字符；少于 2 个 user turn 的会话跳过。
- 单次 prompt 总素材文本硬上限 48000 字符，超出从最旧的开始丢弃。
- 文件存在但指纹未变 → 不进入本次输入。全部已处理且非 `force` 时直接返回 `no-new-sources`，不调用 LLM。
- 单次最多接受 6 个页面 upsert；超出的丢弃并在结果中记录。

### 4. 编译协议

一次 LLM 调用，输出严格 JSON（允许被 ```json 围栏包裹）：

```json
{
  "pages": [
    {
      "slug": "opencode-sidecar-port",
      "title": "OpenCode Sidecar 端口策略",
      "summary": "应用如何为 sidecar 选择并持久化端口",
      "tags": ["opencode", "sidecar"],
      "content": "…… [[another-page]] ……",
      "sources": ["session:ses_xxx"]
    }
  ]
}
```

Prompt 要求：

- 只输出 JSON，不输出解释。
- 优先更新现有页面（复用目录中的 slug）；只有主题确实不同才新建。
- 页面应独立可读，包含背景、结论、关键决策；用 `[[slug]]` 链接相关页面。
- 不编造素材中没有的事实；`sources` 只能使用给定素材 ID。

解析与落盘：

1. 去除代码围栏，取第一个 `{` 到最后一个 `}`；`JSON.parse` 失败 → 返回错误，**不写任何文件**（已处理指纹也不推进，下次重试）。
2. 逐页校验；非法页面跳过并记录；合法页面去重（同 slug 后者覆盖前者）。
3. 对每个合法页面：存在则保留 `created`，更新其余字段；不存在则新建。
4. 确定性重建 `index.json`（扫描 `pages/*.md`）、`index.md`（按 tags 分组 + 链接）、反向链接（解析正文 `[[...]]`）。
5. 追加 `log.md`：`- <ISO> trigger=<manual|daily> pages=<n> sources=<n> pages_touched=<slugs>`。
6. 更新 `state.json`：推进本次实际送入 LLM 的素材指纹；即使 LLM 返回空 `pages` 也推进（避免每天重复烧 token）。
7. 触发 `wiki.compiled` 主动事件（供通知/后续自动化）。

LLM 调用方式复用 auto-memory/scheduler 的主进程模式：`createAgentRuntime({kind:'opencode'})` → `connect()` 重试 → `createSession()` → `sendPrompt()` → 等待 `session.idle`（5 分钟超时）→ `getMessages()` 取最后一条 assistant 文本 → `deleteSession()` 清理。渲染进程不直连模型。

### 5. 召回与注入

`recallWiki(dir, query, limit=3)`：对 `title + summary + tags + content` 做关键词评分（复用轻量 tokenize 逻辑），得分 > 0 的页面按分数、再按 `updated` 排序；返回：

```ts
{ context: string; pages: { slug; title; summary }[] }
```

`context` 形如：

```markdown
# LLM Wiki
以下是过往会话编译出的、与当前任务相关的 Wiki 页面：

## <title>
- 摘要: <summary>
- 来源: session:xxx, memory:yyy
<正文前 1500 字符>
```

新会话首条消息发送时，在现有 `autoMemoryRecall` 之后调用 `wikiRecall`，把结果追加到 `memoryPrefix`，并新增 `wiki-recall` 会话块（只读折叠卡片，可点击打开右侧 Wiki 页签）。召回失败不得阻塞发送。

### 6. Lint（确定性，无 LLM）

`lintWiki(dir)` 返回 `{ checkedAt, pages, issues[] }`：

| kind | level | 说明 |
| --- | --- | --- |
| `broken-link` | error | `[[slug]]` 指向不存在的页面 |
| `orphan-page` | warn | 没有任何入链 |
| `empty-page` | error | 正文去空白后 < 20 字符 |
| `missing-summary` | warn | summary 为空 |
| `duplicate-title` | warn | 多页标题相同 |
| `index-drift` | warn | `index.json` 与页面扫描结果不一致（下次编译自动修复） |
| `unreadable-page` | error | 页面文件无法解析或 slug 非法 |

### 7. 调度

- 手动：Wiki dock 的「立即编译」按钮 → `wiki-compile` IPC。
- 每日：`startWikiDailyCompile()` 在 app ready 后启动。启动 2 分钟后做首次检查，此后每 30 分钟检查一次；条件为「sidecar URL 可用」且「`lastCheckedAt` 距今 ≥ 24h」且无正在进行的编译。检查完成后 `lastCheckedAt` 推进（有写入时 `lastCompiledAt` 同时推进），天然实现每日一次。
- 并发保护：模块级 `compiling` 标志；手动与每日同时触发时，后到者收到 `already-running`。
- sidecar 未启动时跳过，不排队、不阻塞启动。

### 8. IPC 与 UI

新增通道（preload + `electron.d.ts` + `lib/electron.ts` + `lib/tauri.ts` 再导出）：

| 通道 | 返回 |
| --- | --- |
| `wiki-list` | `WikiPageMeta[]` |
| `wiki-get` | `WikiPage` |
| `wiki-compile` | `WikiCompileResult` |
| `wiki-status` | `WikiStatus` |
| `wiki-lint` | `WikiLintReport` |
| `wiki-search` | `WikiPageMeta[]`（按相关度排序） |
| `wiki-recall` | `{ context, pages }` |

右侧 dock：

- `Topicbar` 六页签 → 七页签，新增 `wiki`（`Library` 图标）。
- `WorkbenchDock` 渲染 `WikiDockPanel`。
- `WikiDockPanel`：顶部显示页数 / 上次编译时间 / 「立即编译」/「检查」；搜索框；左列页面列表（180px）；右侧 Markdown 只读详情 + tags + sources；Lint 结果折叠区。编译中显示 spinner，完成后 toast 并刷新列表。

### 9. 文件清单

新增：

- `apps/desktop/src/main/wiki.ts` — 存储、解析、编译、检索、lint、每日调度
- `apps/desktop/src/main/wiki.test.ts` — 单元测试（注入 fake LLM）
- `apps/desktop/src/renderer/components/inspector/WikiDockPanel.tsx`
- `apps/desktop/src/renderer/components/thread/WikiRecallCard.tsx`

修改：

- `packages/shared/src/index.ts` — Wiki 类型 + `wiki-recall` 块
- `apps/desktop/src/main/ipc.ts` — 7 个 handler
- `apps/desktop/src/main/index.ts` — 启动每日调度
- `apps/desktop/src/preload/index.ts` — 暴露 API
- `apps/desktop/src/renderer/electron.d.ts`、`lib/electron.ts`、`lib/tauri.ts` — 类型与包装
- `apps/desktop/src/renderer/lib/runtime.ts` — 新会话召回注入
- `apps/desktop/src/renderer/components/thread/Topicbar.tsx`、`BlockList.tsx`、`app/routes/LiveSessionPage.tsx`、`components/inspector/WorkbenchDock.tsx` — 页签与块渲染
- `packages/sdk/src/agent-runtime/types.ts` — 补 `createdAt/updatedAt`（`listSessions` 已返回）
- `docs/architecture/05-capabilities.md`、`CHANGELOG.md` — 能力与变更记录

## 验证状态

已完成的验证（2026-10-19）：

- [x] `wiki.test.ts` 14 项：页面 upsert / created 保留 / 非法 JSON 不写盘 / 指纹增量 / 索引重建与反向链接 / 搜索召回 / 断链与索引漂移 lint / 空页面处理 / 自动记忆素材筛选
- [x] `pnpm test`：desktop 641 项 + relay 22 项全部通过
- [x] `pnpm format:check`、`pnpm lint`（0 error，仅 1 条既有未使用变量 warning）、`pnpm md:check`（0 error）
- [x] `pnpm build`：main/preload/renderer 产物构建成功
- [x] 真实类型检查：`tsc --noEmit -p tsconfig.node.json` 与 `tsconfig.web.json` 中新增/修改的 wiki 相关文件无错误。仓库本身存在一批与本功能无关的既有类型错误（如 `electron.vite.config.ts` 的 rollupOptions、`autoMemory.ts` 的 Meta/Entry 类型混用），不在本次范围内。
- [x] 失败路径（单元测试覆盖）：LLM 返回非 JSON → 不写页面且下次重试；无新素材 → 不调用 LLM；无 sidecar → IPC 返回 `no-runtime`；并发编译 → `already-running`

尚未在真实窗口验证（需要本地 sidecar + 模型凭证，且会产生真实调用）：

- [ ] 手动编译：>2 轮会话 + 自动记忆 → 生成页面；再次编译返回 `no-new-sources`
- [ ] 每日批：`lastCheckedAt` 超 24h 且 sidecar 可用时自动编译；sidecar 未启动时静默跳过
- [ ] Wiki 页签：列表 / 详情 / 搜索 / lint / 编译按钮在真实窗口可用
- [ ] 新会话注入：召回页面进入 prompt，`wiki-recall` 卡片展示，点击打开 Wiki 页签
