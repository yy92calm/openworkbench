# 主动性增强方案（P2.6）

## 背景

基于现有基础设施（proactive 事件引擎、macroNotify 宏观预警、autoMemory 记忆系统、agentRouter 智能路由），进一步增强系统的主动行为能力。

## 优化方向

### 1. 宏观信号主动预警

**现状**：`macroNotify.ts` 已实现 `detectAlerts()` 和 `handleRefreshAlerts()`，但仅在宏观面板刷新时触发，缺少与 proactive 事件引擎的集成。

**改动**：
- 在 `handleRefreshAlerts()` 中，当检测到新的 alert 时，触发 proactive 事件 `macro.alert`
- 注册默认触发器，将宏观预警推送到 proactive 通知系统
- 新增轮动信号变化检测（rotation signal 阈值突破）

**文件**：
- `apps/desktop/src/main/macroNotify.ts` — 集成 proactive 事件触发
- `apps/desktop/src/main/proactive.ts` — 注册宏观预警默认触发器

### 2. 决策跟踪回访

**现状**：`research.ts` 管理 research decisions，但缺少决策结果的自动跟踪和回访。

**改动**：
- 新增 `decisionFollowup.ts` 模块
- 定期检查未回访的决策（超过 7 天），生成回访提醒
- 对比决策时的 market snapshot 与当前数据，评估决策效果
- 通过 proactive 通知推送回访提醒

**文件**：
- `apps/desktop/src/main/decisionFollowup.ts` — 新增：决策跟踪模块
- `apps/desktop/src/main/proactive.ts` — 注册决策回访触发器
- `apps/desktop/src/main/ipc.ts` — 暴露决策回访 API

### 3. 跨会话知识聚合

**现状**：`autoMemory.ts` 提取单会话记忆，`consolidateMemories()` 基于标题相似度去重，但缺少跨会话的主题关联和聚合。

**改动**：
- 新增 `sessionInsights.ts` 模块
- 基于 session tags 和记忆内容，识别跨会话的主题模式
- 当检测到多个会话围绕同一主题（≥3 次），生成主题摘要
- 通过 proactive 通知推送主题洞察

**文件**：
- `apps/desktop/src/main/sessionInsights.ts` — 新增：跨会话洞察
- `apps/desktop/src/main/proactive.ts` — 注册主题洞察触发器
- `apps/desktop/src/main/ipc.ts` — 暴露洞察 API

### 4. 工作流模式识别

**现状**：用户频繁执行相同操作序列（如：查宏观→做决策→写记录），但系统不会主动推荐自动化。

**改动**：
- 新增 `workflowPatterns.ts` 模块
- 记录用户的操作序列（session 创建、tool 调用、macro 查询等）
- 识别重复出现的模式（≥3 次相同序列）
- 主动推荐「一键执行」或创建快捷方式

**文件**：
- `apps/desktop/src/main/workflowPatterns.ts` — 新增：工作流模式识别
- `apps/desktop/src/main/proactive.ts` — 注册模式识别触发器
- `apps/desktop/src/main/ipc.ts` — 暴露模式识别 API

### 5. 知识库缺口检测

**现状**：`autoMemory.ts` 的 `autoMemoryRecall()` 基于关键词匹配召回记忆，但不会主动提示未召回的相关内容。

**改动**：
- 在 `autoMemoryRecall()` 中，除了返回匹配的记忆，还返回「可能相关但未召回」的条目数量
- 当存在未召回的相关内容（≥3 条）时，通过 proactive 通知提示用户
- 提供 IPC API 查看这些「可能相关」的条目

**文件**：
- `apps/desktop/src/main/autoMemory.ts` — 增强召回，返回未召回的相关内容计数
- `apps/desktop/src/main/proactive.ts` — 注册知识缺口触发器
- `apps/desktop/src/main/ipc.ts` — 暴露知识缺口 API

## 验证

- 类型检查通过
- 单元测试通过
- 手动验证：宏观信号变化时收到 proactive 通知、决策回访提醒正常推送
