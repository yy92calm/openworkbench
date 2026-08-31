# Skills/Agents/MCP 管理页面增强

## 设计

### 概述

为 SkillsPage 增加 MCP 服务器展示标签页，并为 Skills 和 MCP 服务器增加启用/停用开关。Agent 保持只读展示不变。

### 当前状态

SkillsPage 目前有两个标签页：Agents 和 Skills，均为卡片列表展示，无交互开关。MCP 服务器信息未在 UI 中展示。

### 目标

1. 新增「MCP」标签页，列出所有 MCP 服务器及其连接状态
2. Skills 卡片增加启用/停用开关
3. MCP 卡片增加启用/停用开关

### 技术分析

**MCP 启用/停用**：SDK 已有 `addMcpServer(name, config)` 方法，通过 `PATCH /global/config` 更新配置。传入 `config.enabled: false` 即可停用，`config.enabled: true` 即可启用。需要新增 `toggleMcpServer(name, enabled)` 便捷方法。

**Skills 启用/停用**：当前 SDK 无对应 API。OpenCode 侧车是否支持运行时启用/停用 skill 需进一步确认。方案设计为：如果侧车不支持，则降级为仅展示状态，不提供开关。

### 界面设计

```text
┌──────────────────────────────────────────────────────────────┐
│  Agents & Skills                                             │
│                                                              │
│  ┌──────────┬──────────┬──────────┐                          │
│  │ Agents   │ Skills   │ MCP      │    ← 新增 MCP 标签       │
│  └──────────┴──────────┴──────────┘                          │
│                                                              │
│  ┌──────────────────────┐ ┌──────────────────────┐           │
│  │ ● wind           [开关]│ │ ○ juyuan          [开关]│       │
│  │   已连接               │ │   已停用               │       │
│  │   remote · MCP数据源   │ │   remote · MCP数据源   │       │
│  └──────────────────────┘ └──────────────────────┘           │
│                                                              │
│  ┌──────────────────────┐                                    │
│  │ ● etf            [开关]│                                   │
│  │   已连接               │                                   │
│  │   remote · MCP数据源   │                                   │
│  └──────────────────────┘                                    │
└──────────────────────────────────────────────────────────────┘
```

### 模块变更

#### 1. SDK：`packages/sdk/src/OpenCodeClient.ts`

新增方法：

```typescript
/** 启用或停用 MCP 服务器 */
async toggleMcpServer(name: string, enabled: boolean): Promise<void> {
  const servers = await this.listMcpServers();
  const server = servers.find((s) => s.name === name);
  if (!server?.config) throw new Error(`MCP server ${name} not found`);
  const config = { ...server.config, enabled };
  return this.addMcpServer(name, config);
}
```

#### 2. SDK：`packages/sdk/src/types.ts`

`SkillInfo` 增加可选字段：

```typescript
export interface SkillInfo {
  name: string;
  description: string;
  location?: string;
  enabled?: boolean;  // 新增
}
```

#### 3. 渲染进程：`apps/desktop/src/renderer/app/routes/SkillsPage.tsx`

- 新增 `mcp` 标签页
- 加载 MCP 服务器列表（通过 `useRuntimeStore` 或直接调用 SDK）
- Skills 卡片和 MCP 卡片增加开关组件
- 开关变更时调用对应 API

#### 4. 渲染进程：`apps/desktop/src/renderer/lib/runtime.ts`

- 新增 `mcpServers: McpServer[]` 状态
- 新增 `loadMcpServers()` 方法
- 新增 `toggleMcpServer(name, enabled)` 方法

### 实施计划

| # | 文件 | 操作 |
|---|------|------|
| 1 | `packages/sdk/src/OpenCodeClient.ts` | 新增 `toggleMcpServer` 方法 |
| 2 | `packages/sdk/src/types.ts` | `SkillInfo` 增加 `enabled` 字段 |
| 3 | `apps/desktop/src/renderer/lib/runtime.ts` | 新增 MCP 状态管理 |
| 4 | `apps/desktop/src/renderer/app/routes/SkillsPage.tsx` | 新增 MCP 标签页 + 开关 |

## 验证状态

| 验证项 | 状态 | 备注 |
|--------|------|------|
| 方案评审 | 已通过 | — |
| 代码实现 | 已完成 | SDK toggleSkill + runtime + UI 开关全部完成 |
| 单元测试 | 未开始 | — |
| 集成测试 | 未开始 | — |
