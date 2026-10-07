# Personal Agent 全方向优化方案

## 背景

基于 2026 年 Personal Agent 定义（长期记忆、主动行为、A2A 互操作、本地优先），对照当前 Workbench 架构的差距分析。P0（自动长期记忆）已完成，本文档覆盖剩余方向。

## 现状评估

| 能力 | 当前状态 | 差距 |
|------|----------|------|
| 长期记忆 | ✅ 自动提取 + importance + 时间衰减 + 访问计数 | — |
| 主动行为 | ✅ session.idle 触发 + 事件驱动引擎 + 通知推送 | — |
| A2A 互操作 | ❌ 无 | 无 agent card、无跨 agent task 协议 |
| Runtime 抽象 | ✅ OpenCodeClient implements AgentRuntime + factory + mock | — |
| 多 Agent 协作 | ⚠️ 有 subagent/task tool | 仅单实例内父子 session，无跨实例协作 |

## 优化方向

### P1: AgentRuntime 接口收紧

**问题**：`runtime.ts` 直接 `new OpenCodeClient()`，绕过了 `createAgentRuntime` factory。`OpenCodeClient` 没有 `implements AgentRuntime`。

**改动**：
1. `OpenCodeClient` 加上 `implements AgentRuntime`
2. `runtime.ts` 改用 `createAgentRuntime(kind, options)` factory
3. 写 mock runtime 用于 renderer 层测试

**文件**：
- `packages/sdk/src/OpenCodeClient.ts` — 加 implements
- `apps/desktop/src/renderer/lib/runtime.ts` — 改用 factory
- `packages/sdk/src/agent-runtime/mock.ts` — 新增 mock 实现

### P2: 主动行为增强

**问题**：scheduler 只支持 cron 触发，缺少事件驱动的主动行为。

**改动**：
1. **空闲时自动整理**：session.idle 时触发 auto-memory 提取（已有基础设施，需接入触发）
2. **事件驱动触发器**：新增 `EventTrigger` 类型，支持文件变更、消息到达等事件
3. **主动通知**：Agent 发现重要信息时主动推送通知到前端

**文件**：
- `apps/desktop/src/main/autoMemory.ts` — 接入 session.idle 触发
- `apps/desktop/src/main/proactive.ts` — 新增：主动行为引擎
- `apps/desktop/src/main/ipc.ts` — 注册触发器

### P3: 记忆增强

**问题**：当前只有关键词匹配召回，缺少语义相似度。

**改动**：
1. **重要性评分**：提取时由 Agent 评估 1-5 分，召回时加权
2. **时间衰减**：ephemeral 记忆随时间降低权重
3. **访问计数**：每次被召回时 +1，长期未访问的 ephemeral 记忆优先淘汰

**文件**：
- `packages/shared/src/index.ts` — ExtractedMemory 加 importance 字段
- `apps/desktop/src/main/autoMemory.ts` — 评分 + 衰减逻辑

### P4: A2A 互操作（阶段一：Agent Card）

**问题**：Agent 定义散落在 `.opencode/agents/*.md` 的 YAML frontmatter 中（name、description、model、tools、mcp），但无 TypeScript 类型、无枚举 API、无机器可读的能力描述。前端无法查询「有哪些 agent、各自能做什么」。

**改动**：

1. **AgentCard 类型定义**（`packages/shared/src/index.ts`）
   ```typescript
   interface AgentCard {
     name: string;              // agent ID（frontmatter name）
     description: string;       // 一行能力描述
     model?: string;            // 默认模型（如 glm-5.2）
     tools: string[];           // 可用工具（write、edit、bash 等）
     mcp: string[];             // 依赖的 MCP server
     skills: string[];          // 使用的 skill name
     version?: string;          // 可选版本号
   }
   ```

2. **Agent 解析器**（`apps/desktop/src/main/agentCard.ts`）
   - 扫描 `.opencode/agents/*.md`，解析 YAML frontmatter
   - 提取 tools、mcp、skills 列表（skills 从 markdown body 的「使用的技能」段落提取）
   - 返回 `AgentCard[]`

3. **本地注册表**（`apps/desktop/src/main/agentRegistry.ts`）
   - 维护可用 agent 列表（从 agentCard.ts 扫描结果缓存）
   - 监听 profile 变更（file watcher），自动刷新
   - 提供 `getAgent(name)`、`listAgents()`、`searchAgents(query)` API

4. **IPC 暴露**（`apps/desktop/src/main/ipc.ts`）
   ```typescript
   ipcMain.handle('agents-list', async () => listAgents());
   ipcMain.handle('agents-get', async (_e, name: string) => getAgent(name));
   ipcMain.handle('agents-search', async (_e, query: string) => searchAgents(query));
   ```

5. **Preload 桥接**（`apps/desktop/src/preload/index.ts`）
   ```typescript
   agentsList: () => ipcRenderer.invoke('agents-list'),
   agentsGet: (name: string) => ipcRenderer.invoke('agents-get', name),
   agentsSearch: (query: string) => ipcRenderer.invoke('agents-search', query),
   ```

**文件**：
- `packages/shared/src/index.ts` — 加 AgentCard 类型
- `apps/desktop/src/main/agentCard.ts` — 新增：解析 frontmatter
- `apps/desktop/src/main/agentRegistry.ts` — 新增：注册表 + 缓存
- `apps/desktop/src/main/ipc.ts` — 注册 agents-* handler
- `apps/desktop/src/preload/index.ts` — 暴露 agentsList/Get/Search
- `apps/desktop/src/renderer/electron.d.ts` — 类型声明

**验证**：
- 单元测试：解析 frontmatter → AgentCard
- 集成测试：IPC 调用 agents-list 返回非空数组
- 手动验证：前端设置页显示 agent 列表（可选 UI）

### P2.5: 主动行为增强（事件驱动）

**问题**：P2 实现了基础的主动行为引擎，但缺少具体的事件驱动场景。

**改动**：

1. **长时间任务完成通知**
   - 在 `runtime.ts` 中记录每个 turn 的开始时间
   - session.idle 时检查时长，超过 5 分钟则触发 `task.completed` 事件
   - 注册默认触发器，发送成功通知

2. **session.error 自动通知**
   - 在 error 事件处理中触发 `session.error` 事件
   - 注册默认触发器，发送警告通知

3. **会话自动标签**
   - 基于关键词匹配提取会话标签（代码、文档、测试、配置等）
   - session.idle 时自动提取并保存标签
   - 提供 IPC API 查询会话标签

4. **定期记忆整合**
   - 实现 `consolidateMemories()` 函数，基于标题相似度去重
   - 保留较新的记忆条目，删除重复项
   - 提供 IPC API 手动触发整合

5. **自动清理旧会话**
   - 新增 `sessionCleanup.ts` 模块
   - 可配置保留天数（默认 30 天）和最小保留数量（默认 10）
   - 提供 IPC API 手动触发清理

**文件**：
- `apps/desktop/src/renderer/lib/runtime.ts` — 记录 turn 开始时间、触发事件
- `apps/desktop/src/main/proactive.ts` — 注册默认触发器
- `apps/desktop/src/main/autoMemory.ts` — 添加标签提取、记忆整合
- `apps/desktop/src/main/sessionCleanup.ts` — 新增：会话清理模块
- `apps/desktop/src/main/ipc.ts` — 注册新 IPC handler
- `apps/desktop/src/preload/index.ts` — 暴露新 API
- `apps/desktop/src/renderer/electron.d.ts` — 类型声明

**验证**：
- 类型检查通过
- 单元测试通过（627 tests）
- 手动验证：长时间任务完成后收到通知

### P4.5: A2A Agent Card 增强

**问题**：P4 实现了基础的 Agent Card 解析和注册，但缺少高级搜索、智能推荐、运行时状态追踪和自动路由。

**改动**：

1. **AgentCard 类型增强**
   - 新增 `tags` 字段：用于分类和过滤（如 `['code', 'review']`）
   - 新增 `instructions` 字段：系统指令摘要
   - 新增 `enabled` 字段：是否启用（默认 true）
   - 新增 `priority` 字段：优先级（用于排序和推荐）

2. **搜索增强**
   - 支持按 tags/tools/mcp/skills 过滤
   - 支持模糊匹配（多词搜索、部分匹配）
   - 支持 enabledOnly 过滤

3. **Agent 选择建议**
   - 新增 `suggestAgent(query)` API
   - 基于输入文本推荐最匹配的 agent
   - 评分算法：priority*10, 短语匹配 +50, 词匹配 +10, tag 匹配 +20, tool/skill 匹配 +15

4. **Agent 运行时状态**
   - 新增 `agentStatus.ts` 模块
   - 追踪每个 agent 的 busy/idle 状态
   - 记录当前 session ID 和任务开始时间
   - 统计完成的任务数量
   - 提供 IPC API 查询状态

5. **Agent 间路由**
   - 新增 `agentRouter.ts` 模块
   - 基于意图分析自动选择最佳 agent
   - 支持 10 种意图类别（code/review/test/doc/debug/deploy/database/api/ui/security）
   - 提供 `routeMessage()` 和 `shouldSwitchAgent()` API
   - 返回推荐 agent、置信度、原因和备选方案

**文件**：
- `packages/shared/src/index.ts` — AgentCard 增强 + AgentStatus 类型
- `apps/desktop/src/main/agentCard.ts` — 解析新字段
- `apps/desktop/src/main/agentRegistry.ts` — 搜索增强 + suggestAgent
- `apps/desktop/src/main/agentStatus.ts` — 新增：运行时状态追踪
- `apps/desktop/src/main/agentRouter.ts` — 新增：智能路由
- `apps/desktop/src/main/ipc.ts` — 注册新 IPC handler
- `apps/desktop/src/preload/index.ts` — 暴露新 API
- `apps/desktop/src/renderer/electron.d.ts` — 类型声明

**验证**：
- 类型检查通过
- 手动验证：agents-search 支持过滤、agents-suggest 返回推荐、agents-route 分析意图

### P5: 跨实例 Agent 协作（阶段二）

**问题**：subagent 仅限单实例内父子 session。跨实例协作需要 agent 间能发现彼此、发送结构化 task、回传结果。

**方案选择**：

**方案 A：扩展 Room 协议**（推荐）
- 在现有 E2E room 中支持 agent 身份（agent peer）
- 新增 `room.message` kind：`task-request`、`task-result`、`task-progress`
- 优点：复用现有基础设施（room 管理、E2E 加密、文件传输）
- 缺点：room 系统复杂度增加

**方案 B：独立 A2A 协议**
- 在 relay 新增 `/api/a2a/*` HTTP 端点
- Agent 通过 HTTP 直接调用其他 agent 的 task API
- 优点：与 room 系统解耦
- 缺点：需新建认证、路由、消息持久化

**推荐方案 A**：room 已有 peer 管理、消息路由、文件传输，扩展成本更低。

**改动（方案 A）**：

1. **Room 协议扩展**（`relay/src/protocol.ts`）
   ```typescript
   // 扩展 RoomMember
   interface RoomMember {
     id: string;
     nickname?: string;
     pubKey?: string;
     agentCard?: AgentCard;  // 新增：agent 身份标识
   }

   // 扩展 RoomMessage.kind
   type RoomMessageKind = 'text' | 'audio' | 'file' | 'session-share'
     | 'task-request' | 'task-result' | 'task-progress';

   // 新增 task metadata
   interface RoomTaskMeta {
     taskId: string;           // UUID
     taskType: string;         // 如 'research'、'code-review'
     input: unknown;           // task 输入参数
     output?: unknown;         // task 输出（task-result 时）
     progress?: number;        // 0-100（task-progress 时）
     deadline?: number;        // 可选截止时间戳
     fromAgent?: string;       // 发起方 agent name
     toAgent?: string;         // 接收方 agent name
   }
   ```

2. **Room 支持 agent peer**（`relay/src/room.ts`）
   - `room.join` 时可选传入 `agentCard`
   - Agent peer 与普通 peer 共存，但标记为 agent 身份
   - 支持按 agent name 寻址（`toAgent` 字段）

3. **A2A 桥接层**（`apps/desktop/src/main/a2aBridge.ts`）
   - 监听 room 中的 `task-request` 消息
   - 根据 `toAgent` 匹配本地 agent（从 agentRegistry 查询）
   - 创建 session，发送 prompt，流式返回 `task-progress`
   - 完成后发送 `task-result`

4. **Task 协议客户端**（`packages/sdk/src/a2a/taskClient.ts`）
   - 提供 `sendTask(roomCode, toAgent, taskType, input)` API
   - 监听 `task-progress`、`task-result` 事件
   - 支持 timeout、cancel

**文件**：
- `relay/src/protocol.ts` — 扩展 RoomMember、RoomMessageKind、RoomTaskMeta
- `relay/src/room.ts` — 支持 agentCard、按 agent name 路由
- `apps/desktop/src/main/a2aBridge.ts` — 新增：task 监听 + 执行
- `packages/sdk/src/a2a/taskClient.ts` — 新增：task 发送 + 监听
- `apps/desktop/src/main/ipc.ts` — 注册 a2a-send-task handler
- `apps/desktop/src/preload/index.ts` — 暴露 a2aSendTask

**验证**：
- 单元测试：解析 task-request/task-result 消息
- 集成测试：两个 Workbench 实例通过 room 交换 task
- 手动验证：agent A 请求 agent B 执行 code-review，B 返回结果

## 实施优先级

| 优先级 | 方向 | 工作量 | 影响面 |
|--------|------|--------|--------|
| 1 | P1: Runtime 接口收紧 | 小 | 为后续功能打基础 |
| 2 | P3: 记忆增强 | 中 | 提升记忆质量 |
| 3 | P2: 主动行为 | 中 | 核心 Personal Agent 能力 |
| 4 | P4: Agent Card | 中 | A2A 基础设施 |
| 5 | P5: 跨实例协作 | 大 | 依赖 P4 |

## 验证状态

- [x] 方案文档完成
- [x] P1 实现
- [x] P2 实现
- [x] P2.5 实现（事件驱动增强）
- [x] P3 实现
- [x] P4 实现
- [ ] P5 实现（视时间）
