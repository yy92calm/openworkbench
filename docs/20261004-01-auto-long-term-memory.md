# 自动长期记忆（阶段一）

## 背景

当前 Workbench 的知识库是手动维护的——用户需要主动创建、编辑 Markdown 条目。Personal Agent 的核心特性之一是"越用越懂你"的长期记忆能力：Agent 能从对话中自动提取关键事实、偏好、决策，并在后续会话中自动注入相关记忆。

本方案实现阶段一：**基于关键词的自动记忆提取与注入**，不引入向量数据库，利用现有知识库基础设施。

## 设计

### 核心流程

```
会话结束（session.idle）
  → 获取会话消息列表
  → 调用 sidecar 提取关键记忆（事实/偏好/决策）
  → 写入知识库（category: auto-memory）
  → 去重：与已有 auto-memory 条目比较，跳过重复

新会话启动
  → 从知识库加载 auto-memory 条目
  → 按关键词匹配当前任务上下文
  → 注入到 session 的初始 prompt（instructions 补丁）
```

### 模块设计

**1. `autoMemory.ts`（新增）**

- `extractMemories(client, sessionId)` — 调用 sidecar，让 Agent 从会话消息中提取结构化记忆
- `saveAutoMemories(knowledgeDir, memories)` — 写入知识库，自动去重
- `recallMemories(knowledgeDir, query, limit)` — 关键词匹配检索 auto-memory 条目
- `buildMemoryContext(memories)` — 将检索到的记忆格式化为 instructions 补丁

**2. 记忆提取 prompt**

```
请从以下对话中提取值得长期记住的信息，输出 JSON 数组：
[
  {
    "title": "简短标题",
    "summary": "一句话说明",
    "content": "详细内容",
    "tags": ["标签1", "标签2"],
    "type": "fact|preference|decision",
    "stability": "stable|ephemeral"
  }
]

提取原则：
- 只提取有长期价值的信息（用户偏好、重要事实、关键决策）
- 不要提取临时性信息（当前任务细节、调试过程）
- 每条记忆应独立可理解
- stability 分类：
  - "stable"：用户画像类（长期偏好、身份特征、技术栈选择等，几个月内不会变）
  - "ephemeral"：最近关注类（当前项目、近期决策、临时上下文等，一两周可能过时）
- 如果没有值得记忆的内容，返回空数组 []
```

**3. 稳定性维度（用户画像 vs 最近关注）**

记忆按 `stability` 分为两类，生命周期和召回权重不同：

| 类型 | 例子 | 召回权重 | 裁剪优先级 |
|------|------|----------|------------|
| `stable` | "偏好简洁代码风格"、"用 TypeScript strict mode" | +0.5 加成 | 最后裁剪 |
| `ephemeral` | "在调研向量数据库"、"这周在修 auth 模块的 bug" | 无加成 | 优先裁剪 |

- 存储：stability 编码为 tag `stability:stable` / `stability:ephemeral`
- 召回：有关键词命中时，stable 记忆获得 0.5 分加成，排名更靠前
- 裁剪：超过 maxEntries 时，先裁剪 ephemeral（最旧的），再裁剪 stable

**4. 去重策略**

- 新记忆写入前，加载所有 `category === 'auto-memory'` 的条目
- 比较 title + summary 的关键词重叠度
- 重叠度 >= 阈值 → 更新已有条目（合并内容）而非新建

**5. 记忆注入**

- 新会话创建后、发送 prompt 前
- 从 prompt 中提取关键词（简单分词 + 停用词过滤）
- 在 auto-memory 条目中匹配（title / summary / tags / content 命中任一即可）
- 将匹配到的记忆格式化为 context 前缀

### 触发时机

| 事件 | 动作 |
|------|------|
| `session.idle`（用户会话） | 提取记忆 |
| 定时任务会话 | 不提取（避免噪声） |
| 新会话创建 | 注入相关记忆 |

### 配置

在 `electron-store` 中增加 `workbench.autoMemory` scope：

```typescript
interface AutoMemoryConfig {
  enabled: boolean;        // 默认 true
  maxEntries: number;      // 最大记忆条目数，默认 500
  recallLimit: number;     // 每次注入的记忆条数，默认 5
  minTurns: number;        // 少于 N 轮对话不提取，默认 3
}
```

### 文件变更

| 文件 | 变更 |
|------|------|
| `apps/desktop/src/main/autoMemory.ts` | 新增：核心模块 |
| `apps/desktop/src/main/ipc.ts` | 修改：session.idle 时触发提取；新会话创建时注入记忆 |
| `apps/desktop/src/main/store.ts` | 无变更（复用 getStore） |
| `packages/shared/src/index.ts` | 新增：AutoMemoryConfig 类型 |

## 验证状态

- [x] 方案文档完成
- [x] 代码实现
- [x] 单元测试（10 tests passing，含 stability boost 测试）
- [x] 稳定性维度优化（stable/ephemeral 区分、召回加成、裁剪优先级）
- [ ] 手动验证：对话后检查知识库是否自动生成 auto-memory 条目
- [ ] 手动验证：新会话是否能注入相关记忆
