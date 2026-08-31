# Workbench 全方面性能优化方案

日期：2026-08-08，序号 01

## 背景

参考 [DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix)（MIT，
单个 Go 二进制，33k stars）的工程实践，对照 Workbench 当前架构，整理一份覆盖
**运行时（模型/token）与前端（渲染/启动）两个层面**的完整性能优化方案。

Reasonix 的全部优化围绕一个核心命题展开：**让一次长会话的成本与延迟可预测**。
它通过「前缀缓存稳定性」把每个 turn 的输入前缀（系统提示 + 工具定义 + 记忆）
保持字节级稳定，从而让 DeepSeek 的自动前缀缓存持续命中。前缀缓存命中意味着
每个后续 turn 不再为系统提示部分重复计费，首 token 延迟显著下降。

Workbench 的运行时是 OpenCode sidecar，通过 HTTP + SSE 通信。Reasonix 的
缓存理念同样适用，但 Workbench 的前端（Electron + React）还有独立的性能面。

本方案分两个层面：**运行时与成本层**（A），**前端渲染层**（B），外加
**启动路径**（C）与**打包分发**（D）。每项标注收益、风险与优先级。

## 设计

### A. 运行时与成本层（模型 / token）

#### A1. 系统提示前缀稳定性

##### 现状

- `app-config/.opencode/opencode.json` 的 `instructions: ["AGENTS.md"]` 把整个
  AGENTS.md 注入每个会话的系统提示。该文件既是项目说明又承载了 10 个 Agent 的
  使用文档、MCP 对照表、权限与技能说明，篇幅约 8 KB。
- Workbench 每次启动 `deployBundledProfile()`（server.ts:147）先 `rmSync` 整个
  目标目录再 `cpSync` 重部署，且 `applyUserProviderConfig()`（server.ts:165）
  每次重写 opencode.json 的 provider 段。
- 客户端 SDK 的 `sendPrompt`（OpenCodeClient.ts:535）每次直接 POST，不对
  输入做任何结构化分层。

##### 差距与原因

Reasonix 明确要求「前缀永不中途变更，动态内容放到 turn 尾部」。AGENTS.md 越
大、越常被改动，前缀缓存越容易失效。此外每次重启重写 opencode.json 会让
provider 的 `limit` 等字段短暂缺失，间接影响模型选择路径的稳定性。

##### 方案

1. **AGENTS.md 瘦身**：把稳定不变的「项目结构、Agent 列表、安全提示」保留在
   AGENTS.md；把「MCP 查询对照表、Skills 分层细节」这类长而稳定的内容移到
   独立文件（如 `docs/mcp-guide.md`），AGENTS.md 只保留一行 `@docs/mcp-guide.md`
   引用（OpenCode 支持该语法，且引用文件解析结果同样进入前缀）。目标是让
   AGENTS.md 本体降到最短、最稳定。
2. **区分稳定与动态内容**：动态内容（当前任务、上下文摘要）不写进 AGENTS.md，
   而是随用户 prompt 追加在消息尾部——这正是 Reasonix 的「turn tail」做法。
3. **opencode.json 增量更新**：`applyUserProviderConfig` 改为先读现有 JSON、
   只 patch `provider` 与 `model` 键，避免整体重写导致其他键丢失。

**验证**：`/event` 流中检查首个 turn 与后续 turn 的输入 token 中
`cache_read` 命中比例；用 SDK `listProviders` 的 `contextLimit` 结合 UI
会话 token 统计（已有 `cacheReadTokens` 字段）做一个缓存命中率观测。

#### A2. 上下文压缩（compaction）分级

##### 现状（A2）

- `opencode.json` 已开 `compaction.prune: true`，是 OpenCode 内置的简单剪枝，
  无分级阈值。

##### Reasonix 做法（对照）

Reasonix 把上下文维护分成四级：

| 阈值 | 行为 |
|------|------|
| `< 60%` 窗口 | 不动，仅提示 |
| `>= 60%` | 过时工具结果归档 + 缩短（带 head/tail 标记） |
| `>= 80%` | 过时工具结果归档 + 修剪为短占位符 |
| `>= 90%` | 强制折叠（即使经济性不允许） |

关键纪律：**snip/prune 永不删除消息**（assistant `tool_calls` 与 tool 结果保持
配对），只折叠 assistant/tool 工作，用户 turn 与历史摘要保留原文，原始内容
归档到 JSONL 以便追溯。

##### 方案（A2）

1. 在 `app-config/.opencode/opencode.json` 明确写出 `compaction` 的阈值配置
   （OpenCode 支持则配置，不支持则记录期望值并确认 sidecar 行为）。
2. 保留归档：确认 OpenCode 的剪枝原始内容是否落盘可追溯；若不可，评估在
   SDK 层对 `message.part.updated` 的 tool 输出做本地归档（参考本项目已有的
   provenance 机制，runtime.ts 的 `recordProvenance`）。
3. 观测：会话窗口比例达到阈值时，UI 提示「即将压缩」，压缩后标记一次
   cache-reset 点（这是唯一允许前缀变化的时刻）。

**验证**：长会话跑到 60%/80% 阈值时行为符合预期；压缩后会话可继续且关键
事实（用户明文表述）不被折叠丢失。

#### A3. 工具 schema 收缩（MCP 按需启用）

##### 现状（A3）

- `opencode.json` 的 `mcp` 段一次性启用 wind / juyuan / etf 三个远程 MCP，
  每个都带大量工具定义。所有工具 schema 进入系统提示前缀，前缀越长，
  缓存计算量越大，首 token 延迟越高。

##### Reasonix 做法（对照）（A3）

- Reasonix 默认（Token Economy）只暴露 9 个核心工具，其余工具通过
  `connect_tool_source` **按需连接**；工具 schema 稳定前缀在会话中不改变。
- 工具 schema 契约文档化（`TOOL_CONTRACT.md`），用测试锁定「文档描述的
  表面 == 实际注册的 schema」，防止无意识变更破坏缓存。

##### 方案（A3）

1. 按 Agent 最小化启用 MCP：在 `AGENTS.md` 或各 Agent 定义中明确「数据源
   按任务选择」，MCP 服务器默认不全部开启，进入对应任务时通过斜杠命令或
   配置启用。最低成本做法：把 wind / juyuan / etf 从 `enabled: true` 改为按
   会话启用的模式（若 OpenCode 支持会话级 MCP 开关）。
2. 工具契约测试：为本项目内置 Agent 与 MCP 工具写一份「工具清单契约测试」，
   断言工具集合的变化会被 CI 捕获（参考 Reasonix 的
   `TestBuiltinToolContractDocumentation`）。

**验证**：开启全量 MCP 与仅开所需 MCP 时，首个 turn 的输入 token 对比；
`listProviders` 报告的 `contextLimit` 与工具数目的关系。

#### A4. 双模型（planner + executor）的缓存隔离

##### 现状（A4）

- Workbench 每次会话单模型，无 planner/executor 分工。

##### Reasonix 做法（对照）（A4）

- Reasonix 支持双模型协作，但把 planner 与 executor 放在**独立的会话**中，
  各自前缀保持缓存稳定——绝不在一段共享对话里切换模型（那样会破坏前缀）。

##### 方案（A4）

- 本方案**不引入**双模型（超出当前需要，Workbench 以配置驱动为主）。但记录
  这一约束：若未来在 Workbench 增加「研究型 / 执行型」分工，必须用独立会话
  而非切换同一会话的模型。

**验证**：文档级约束，无代码验证。

#### A5. 记忆与指令分层

##### 现状（A5）

- 无记忆层。AGENTS.md 是唯一指令来源，会话内产生的持久事实没有独立存储。

##### Reasonix 做法（对照）（A5）

- 指令（必须每 turn 在）：AGENTS.md / CLAUDE.md，进入稳定前缀，保持短。
- 事实（可能过时）：memory 文件，不进入前缀，每次 turn 用 BM25 从原始用户
  消息召回，追加到**用户 turn 尾部**（低权威后缀）。绝不 mutate 系统提示。

##### 方案（A5）

1. 短期：不新增记忆系统。把「项目事实」（如工作流约定）留在 AGENTS.md，
   但遵循 A1 的瘦身原则。
2. 中期（可选）：若 Workbench 需要持久记忆，参考本项目的 `精炼知识库`
   实践，用文件 + 检索，而非塞进系统提示。

**验证**：无代码验证，属架构纪律。

### B. 前端渲染层

#### B1. 流式渲染帧合并（rAF 节流）

##### 现状（B1）

- SSE 每个 token 触发一次 `text.updated`（OpenCodeClient.ts:769），`runtime.ts`
  的 `onEvent` 每次 `set()` 更新 zustand store（runtime.ts:700-721），
  `BlockList` 因此全量重渲染。
- `BlockList.tsx:140` 的 `useMemo(() => prepareItems(blocks), [blocks])` 依赖
  `blocks` 数组引用，每次 token 更新引用即变，`prepareItems` 与整棵列表重算。
- `MarkdownViewer`（MarkdownViewer.tsx:132）无 memo，每个 token 都整段重跑
  react-markdown 解析。

##### 方案（B1）

1. **SDK 层节流**：在 `OpenCodeClient.emit` 前按 session 对 `text.updated` /
   `reasoning.updated` 做 rAF（约 60fps）合并：同一 partId 的连续 delta 在
   一帧内只发出最后一个累积文本。实现一个 `throttleByAnimationFrame` 包装。
   需要确保「流式结束兜底」——`session.idle` 时 flush 所有挂起帧，避免最后
   一个 token 丢失。
2. **store 层批处理**：`runtime.ts` 的 `onEvent` 已做一次 set；在 SDK 层节流
   后，store 自然降低到 ≤60 次/s。对 `session.updated`（token/cost 实时更新）
   同样节流到 1 Hz，避免每 token 全量 map 会话列表。
3. **MarkdownViewer memo + 分块**：
   - `React.memo(MarkdownViewer, (a, b) => a.children === b.children)`。
   - 渲染期间不解析：流式时把 markdown 按段落切块，仅重渲染新增段落（若
     react-markdown 无法增量，则至少用 memo 短路未变化的部分）。
4. **高亮缓存**：`CodeBlock`（MarkdownViewer.tsx:76-78）每次 `highlight` 全量
   重跑。改为：
   - `useMemo` 按 `language + code` 缓存高亮结果；
   - 流式中代码块未闭合时**不渲染高亮**，等 `\n\`\`\`` 闭合后再高亮一次；
   - `hljs.highlightAuto` 非常昂贵，优先 `hljs.highlight(lang, code)`，仅当
     language 未知才 `auto`。

**验证**：跑长流式会话，DevTools Performance 面板确认渲染帧率（target
60fps、无明显长任务）；对比节流前后同一会话的 render 次数。

#### B2. 长会话列表虚拟化 / 暖冷分层

##### 现状（B2）

- `BlockList` 顺序渲染全部 block，无虚拟化。单会话 100+ block 时首渲染与
  更新成本线性增长。

##### 方案（B2）

1. 引入 `react-window` 或自实现简单窗口：只渲染视口内的 block（约 ±3 行
   缓冲区）。block 高度可预估（文本行数与宽度相关），用
   `estimatedRowHeight + dynamic measurement`。
2. 若虚拟化改动过大，先做**暖冷分层**：最近 N 条（如 40）消息正常渲染，
   更早的消息折叠为「展开更早历史」占位，点击后渲染（等价于懒加载）。
   这个与既有 `StepGroup` 折叠逻辑互补。

**验证**：构造 200 block 会话，滚动流畅（无卡顿）、内存占用下降。

#### B3. 会话列表（侧边栏）渲染优化

##### 现状（B3）

- `Sidebar.tsx:62-65` 每次 `sessions` 变化全量 `map` 出所有 `SessionRow`；
  `refreshSessions`（runtime.ts:847）每次会话列表变化都全量 `set`。
- 会话多了以后每新增一条都重渲染全部行。

##### 方案（B3）

1. `SessionRow` 用 `React.memo`，仅当自身 `row.id`/`isRunning`/`meta` 变化时
   重渲染。
2. `refreshSessions` 时对 `sessions` 做浅比较：`set` 前对比新旧数组元素引用，
   无变化则跳过 `set`（`session.updated` 的 token 更新会改 `SessionMeta`，
   需要把 token 更新与会话列表更新分开，避免列表刷新）。
3. 侧边栏渲染不阻塞首帧：列表项数量大时用 `requestIdleCallback` 分批渲染。

**验证**：200+ 会话时侧边栏滚动与切换无卡顿。

#### B4. 自动滚动优化

##### 现状（B4）

- `LiveSessionPage.tsx:235-236` 用 `smooth` 滚动到最底；`blockCount` 变化时
  触发（258-263）。每次 token 更新若块数变化会反复 smooth，且每次 `setState`
  触发 `scrollToBottom` 使用 `smooth` 累积视觉延迟。

##### 方案（B4）

1. 只在「新 block 出现」时滚动，`text.updated` 更新已有 block 时不滚（已有
   block 内容增长时视口已经在底部则顺其自然）。
2. 流式中用「滚动到锚点」替代反复 `smooth`：监听新 block 插入，一次 scroll；
   用户滚离底部时不强制滚动（已有 `nearBottomRef` 逻辑，保留）。
3. `scrollToBottom` 的 `smooth` 改 `auto`（流式中即时跟随），用户手动点按钮
   时保留 smooth。

**验证**：流式期间滚动跟随平滑、无抖动；手动上滑后不被拽回底部。

### C. 启动路径

#### C1. Profile 部署增量更新

##### 现状（C1）

- `deployBundledProfile`（server.ts:147-159）每次 `rmSync` + `cpSync` 整个
  profile 目录。profile 含 AGENTS.md、agents/、skills/、commands/、docs/ 等，
  文件多，且每次改动全量复制。

##### 方案（C1）

- 改为**增量同步**：对比源目录与目标目录的 mtime/size，只复制变更文件；
  删除源中已不存在的目标文件（mirror 语义）。可用一个小型 `syncDir(src, dst)`
  函数实现，避免引入依赖。

**验证**：重复启动时 sidecar 就绪时间下降（对比日志中 deploy 耗时）。

#### C2. 启动加载并行化

##### 现状（C2）

- `loadCatalog`（runtime.ts:494-515）串行：先 `listSkills`（空时重试 4 次，
  每次 400ms 睡），再 agents / defaultModel / commands，最后
  `loadMcpServers` + `loadProviders`（这两个是 `void` 并行）。
- skills 的空重试等待会阻塞整个目录加载路径。

##### 方案（C2）

1. `listSkills` 的空重试不应阻塞其余目录加载：把 skills 空重试与
   agents/commands/defaultModel 并行发起（`Promise.all`）。
2. `loadCatalog` 与 `refreshSessions`、`reconcileRunning` 之间保证
   `currentId` 的首屏会话切换不被 catalog 阻塞（现在已 `void` 调用，保持）。

**验证**：冷启动到「会话可见」的时间缩短；skills 空重试期间 UI 不白屏。

### D. 打包与分发

#### D1. 依赖与体积

##### 现状（D1）

- Electron 应用打包体积主要受 `node_modules` 与 sidecar 二进制影响。
  渲染层依赖 react-markdown / highlight.js 等，属必要。
- 打包配置见 `apps/desktop/electron-builder.config.ts`。

##### Reasonix 做法（对照）（D1）

- Reasonix 强调「单静态二进制、标准库优先、依赖极简」。对 Electron 应用
  而言对应的是：**只打包实际用到的依赖，禁用 tree-shaking 死角，压缩资源**。

##### 方案（D1）

1. `electron-builder` 的 `files` 白名单收紧：确认 `node_modules` 只含生产依赖，
  排除 devDependencies 与测试文件（若当前 `files` 用了 `**/*` 则收窄）。
2. 启用 Vite 构建压缩（当前 renderer 用 Vite，检查 build 配置是否已开
   `build.minify` 与 `assetsInlineLimit`）。
3. 移除未使用的大依赖：核对 `apps/desktop/package.json` 中是否有未引用的
   包（例如只用于测试的依赖不应进入打包）。

**验证**：`pnpm build` 后检查 asar 内 `node_modules` 清单与总体积；启动耗时
对比。

#### D2. 单二进制 sidecar 拉取与缓存

##### 现状（D2）

- `scripts/dev/fetch-opencode.sh` 负责下载 OpenCode 二进制，AGENTS.md 要求
  pin 版本。若每次都重新下载则慢。

##### 方案（D2）

- 确认脚本带缓存（校验已下载的二进制指纹后跳过下载）；若无缓存，增加
  「已存在且指纹匹配则跳过」的逻辑。

**验证**：重复执行 fetch 脚本第二次明显更快。

### E. 观测与可验证性（贯穿所有层的横向）

Reasonix 的关键工程纪律是「性能特性落地时在最终边界写效果测试」——断言
「实际到达 provider 请求的内容」。Workbench 对应的观测点：

1. **缓存命中观测**：会话列表已带 `cacheReadTokens` / `cacheWriteTokens`
   （SDK 已解析，OpenCodeClient.ts:238-241）。在 StatusBar 或右侧面板展示
   「缓存命中率 = read / (read + write)」，让缓存失效可被直观察觉（对应
   Reasonix 的「缓存命中率是关键可观测信号」）。
2. **契约测试**：工具清单（A3）、前缀内容（A1 的 AGENTS.md 结构）各加一个
   快照测试，防止未来改动无意识破坏缓存稳定性。
3. **性能基线**：为流式渲染（B1）、滚动（B4）各留一个可重复的手动验收步骤
   而非脆弱的自动 benchmark。

## 实施路线

按「收益高 / 风险低 / 改动小」排序，共 4 个阶段：

| 阶段 | 内容 | 预计工时 |
|------|------|----------|
| P1：流式渲染节流 + 高亮缓存（B1） | SDK rAF 节流、store 批处理、Markdown memo、CodeBlock 缓存 | 1.5d |
| P2：渲染与滚动（B2/B3/B4） | 会话列表 memo、自动滚动修正、暖冷分层（若虚拟化过大先折叠历史） | 2d |
| P3：运行时与成本（A1/A2/A3） | AGENTS.md 瘦身、opencode.json 增量 patch、MCP 按需启用、compaction 配置明确 | 1d |
| P4：启动与打包（C/D） | profile 增量同步、loadCatalog 并行化、打包白名单收紧 | 1d |

总计预计约 5.5 个工作日。

## 验证状态

### 已完成的调研

- [x] Reasonix 性能体系（SPEC.md / SESSION_MEMORY_RETRIEVAL.md / TOOL_CONTRACT.md / REASONIX.md）通读并提取关键做法。
- [x] 本项目各层现状核对：`runtime.ts`（SSE 事件折叠）、`OpenCodeClient.ts`（事件归一化与文本累积）、`BlockList.tsx`（渲染）、`MarkdownViewer.tsx`（高亮）、`LiveSessionPage.tsx`（滚动）、`server.ts`（profile 部署）、`store.ts`（UI store）、`opencode.json`（配置）。

### 实施记录（2026-08-08 第一轮）

本轮实施范围：P4（C/D）全部 + P3 的 A1.3/A3 约束确认。P1/P2 未在本轮实施。

| 验收项 | 验证方式 | 状态 |
|--------|----------|------|
| P4-C1：profile 增量部署 | `deployBundledProfile` 改为 `syncDir`（mtime/size 增量 + mirror 修剪），重复部署跳过未变文件 | 已实施，类型检查通过 |
| P4-C2：loadCatalog 并行化 | skills 空重试改为后台不阻塞，agents/defaultModel/commands 用 `Promise.all` 并行 | 已实施，类型检查通过 |
| P4-D2：sidecar 拉取缓存 | `fetch-opencode.sh` 增加「目标二进制已存在则跳过下载」，`force` 参数强制重下 | 已实施，`bash -n` 通过 |
| P4-D1：依赖清理 | 移除未使用的 `xterm@^5.3.0`（仅 `@xterm/xterm` v6 被引用）；renderer 已默认开启 Vite 压缩；`files` 白名单暂不收紧（当前默认仅含生产依赖，收紧有打包风险） | 已实施 |
| P3-A1.3：opencode.json 增量 patch | 核对现有 `applyUserProviderConfig` 已是「先读全量 JSON、只 patch provider/model」，无需改动 | 核对完成，无需改动 |
| P3-A3：MCP 按需启用 | OpenCode 仅有全局 MCP 配置、无会话级开关，关闭会破坏所有 Agent 首步数据查询，记录为约束不实施 | 约束记录 |
| P4-C1 单测：syncDir 增量同步 | 抽出纯 fs 模块 `src/main/syncDir.ts`，新增 `syncDir.test.ts` 6 用例（全量复制 / 幂等 / mirror 修剪 / 新增传播 / 符号链接 / 异常路径） | 已实施，6/6 通过 |
| B1.2 流式刷新频率门控 | runtime.ts 流式 flush 由 rAF(60fps) 加 50ms 最小间隔门控（≈20fps），长文本每帧 markdown 解析成本降 3 倍；`session.idle` 等非流式事件直接 flush 兜底，最后 token 不丢 | 已实施 |
| B1.3 AgentMessage memo | `atoms.tsx` 中 AgentMessage 用 `React.memo`，未变化的块跳过函数体与 artifact ref 扫描重跑 | 已实施 |
| A2 压缩可观测 | OpenCode 压缩完成时发 `session.compacted` 事件（wire: `{type, properties:{sessionID}}`，源码 compaction.ts:547）。SDK 新增该事件类型并在 normalize 转发；runtime `foldEvent` 在会话线程插入「上下文已压缩（cache 已重置）」status-line，标记 cache-reset 点。新增单测 1 例 | 已实施 |
| 现有测试不退化 | `pnpm typecheck` 通过；`pnpm test` 31 文件 217 用例全过；lint 新增文件 0 error | 通过 |

### 不包含范围

- 不引入双模型 planner/executor（A4 仅记录约束，不实现）。
- 不引入向量数据库或重记忆系统（A5 中期选项）。
- 不重写渲染框架（不做 React 到其它框架迁移）。
- 不引入大型虚拟化库之外的第三方依赖（B2 优先自实现窗口或懒加载）。
- 不改变 OpenCode sidecar 本身（所有改动在 Workbench 应用层与配置层）。
