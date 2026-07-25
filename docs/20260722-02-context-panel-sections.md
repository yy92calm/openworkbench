# 上下文面板分区重构

## 背景

`ContextPanel.tsx` 标题是「上下文」，但只渲染了 `<TokenUsage />`（Token 估算环 + 条形图）。
用户点进「上下文」Tab，期望看到"当前会话塞进了哪些内容"，结果只有一张占比图——名不副实。

方向 C 已让窗口环数据可信。本方向（A）让面板结构名副其实：分区展示"模型现在到底看得到什么"。

## 设计

### 分区结构

`ContextPanel` 由单一 `TokenUsage` 扩展为三个分区（自上而下）：

1. **上下文窗口**（保留）：TokenUsage 的环 + 分类条形图。改动后数据可信（方向 C）。
2. **自动上下文**（新增，只读）：列出当前 `.opencode/` profile 自动注入到每个会话的项，
   让用户知道"模型默认能看到哪些能力"。包括：
   - 指令文件（`opencode.json` 的 `instructions`，如 AGENTS.md）—— 展示条目数 + 名称。
   - Skills（store 里的 `skills`）—— 名称 + 描述。
   - Agents（store 里的 `agents`）—— 名称 + 描述。
   - MCP 服务（store 里的 `mcpServers`）—— 名称 + 连接状态。
   这些数据 store 里已具备（`loadCatalog` / `loadMcpServers`），无需新接口。
3. **会话信息**（保留/整合）：TokenUsage 顶部的会话/模型/消息数，提到分区标题层级。

### 不做（划清边界）

- **注入文件的可视化与管理**：Composer 附加的 workspace 文件目前只存组件 local state，
  发送后拼成文本，store 无留存。要让"注入文件"成为可逐个移除的上下文项，需先把 @ 引用
  结构化进 store 与 `sendPrompt`，属**方向 B**。本方向不预先实现，避免耦合。
- **压缩（compaction）状态展示**：OpenCode 的 `message.updated.info` 带 token/cost 字段，
  但当前 SDK 未消费；真实感知需要扩展事件归一化，工作量大且偏离"让面板名副其实"的核心价值，
  暂不做（可作为后续增量）。
- 不改 Composer、不改 WorkspaceChip。

### 实现要点

- `ContextPanel` 改为分区布局（可复用 `Section` 小组件：标题 + 内容），保持现有视觉风格
  （`text-muted` 标签、`bg-surface-2` 分隔）。
- `TokenUsage` 保留为独立组件，被 ContextPanel 引用；会话信息块保持在其内部。
- 自动上下文分区直接读 `useRuntimeStore` 的 `skills/agents/mcpServers/commands`，
  空列表显示"无"，不制造假数据。
- 数据来源均为既有 store 字段，不改 runtime.ts 的数据流。

## 验证状态

- [x] `ContextPanel` 渲染分区结构（窗口环 + 自动上下文）。
- [x] 自动上下文分区正确读取 store 的 skills/agents/mcpServers。
- [x] 空数据时不报错、不制造假数据（显示提示文案）。
- [x] `pnpm typecheck` 通过。
