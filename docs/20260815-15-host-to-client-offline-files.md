# Host → Client 离线文件投递方案

> 当前 client → host 的文件传输已经能跑通（client 上传附件 → relay → host
> 工作区文件）。但反方向「host → client」的文件投递**完全缺失**：host 只能
> 在 OpenCode 会话里产出附件（FilePart），client 连接时能下载，但**client
> 离线时 host 无法主动推送文件**，文件会"卡在"会话历史里等 client 上线后
> 手动翻找。本方案设计一个 host 侧的「待投递文件队列」，client 上线后
> 拉取并下载，**不污染会话历史**。

## 背景

### 现状

| 方向 | 通道 | 离线行为 |
| --- | --- | --- |
| client → host | `client.sendPromptWithFiles()` + `/__relay/write-file` | host 在线即写入工作区；host 离线时 client 发送失败 |
| host → client（会话内） | sidecar 会话的 FilePart | client 离线时文件随会话 JSONL 持久化，client 上线后翻历史能下载 |
| host → client（会话外） | **无** | host 主动想给 client 一个文件（如导出报告、生成的图表），没有通道 |

### 问题

host 端主动产出的文件（agent 生成、用户拖拽、定时任务输出）想投递给
client 时，当前只能：
1. 把文件路径塞进会话消息——污染会话历史
2. 等待 client 在线时通过 relay 实时推送——但 client 经常不在线

需要一条「会话外」的文件投递通道，支持离线累积。

## 设计

### 角色

- **生产者**：host（main process，包括 agent 产物、用户主动投递、定时任务输出）
- **中转**：relay（仅在在线时透传；**不承担离线存储**）
- **消费者**：client（在线时拉取；本地下载后即丢弃元数据）

### 存储位置选择

| 方案 | 优点 | 缺点 | 选用 |
| --- | --- | --- | --- |
| relay 内存暂存 | 统一在中转节点 | relay 重启即丢；relay 变重；与"relay 纯转发"原则冲突 | ✗ |
| relay SQLite | 持久化；离线可靠 | relay 从纯转发器变成存储节点；需要清理 TTL 逻辑 | ✗ |
| **host 本地磁盘** | 文件本来就在 host 侧；host 在线即可投递；不增加 relay 复杂度 | host 离线时 client 拉不到（但 host 离线时本来也没文件可投递） | ✓ |

**结论**：离线文件队列存在 **host 本地**，relay 只做在线透传。这与 relay
现有架构一致——relay 不存任何业务数据，所有持久化都在 host。

### 数据结构

host 侧新增 `pending_deliveries.json`（electron-store）：

```typescript
interface PendingDelivery {
  id: string;               // UUID
  /** Absolute path on host. File stays in place; only metadata is queued. */
  filePath: string;
  filename: string;
  size: number;
  mime: string;
  /** Source: who produced this file. */
  source: "agent" | "user" | "scheduler" | "manual";
  /** Optional context: which session/task produced it. */
  sessionId?: string;
  taskId?: string;
  /** Epoch ms when queued. Used for display ordering + TTL cleanup. */
  createdAt: number;
  /** Set when client confirms download. Used for GC; not for re-delivery. */
  deliveredAt?: number;
}
```

**关键决策**：
- 文件**本身不复制**——只存路径，避免大文件双份占用磁盘
- 元数据**保留到 client 确认下载后**才标记 `deliveredAt`，之后由 GC 清理
- **TTL 默认 7 天**：超过 7 天未投递的元数据自动清理（文件本身不动，只是不再主动推送）

### 协议扩展

#### Host API（client → host via relay）

新增 `/__host/deliveries/*` 路由，由 `relayHost.handleHostApi` 拦截：

| 路径 | 方法 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- | --- |
| `/__host/deliveries` | GET | `?since=<ms>` | `PendingDelivery[]` | 拉取待投递列表（可选增量） |
| `/__host/deliveries/:id/content` | GET | — | `binary stream` | 下载文件内容（流式） |
| `/__host/deliveries/:id/ack` | POST | — | `{ ok: true }` | 确认已下载，标记 deliveredAt |
| `/__host/deliveries/:id` | DELETE | — | `{ ok: true }` | 主动丢弃（不下载） |

#### Host 侧 IPC（renderer → main）

新增 IPC 让 renderer / 定时任务把文件加入队列：

| IPC channel | 入参 | 说明 |
| --- | --- | --- |
| `deliveries:enqueue` | `Omit<PendingDelivery, "id" \| "createdAt" \| "deliveredAt">` | 加入待投递队列 |
| `deliveries:list` | — | 列出所有待投递（renderer 用） |
| `deliveries:remove` | `id` | 删除单条 |

#### 投递触发点

| 触发源 | 行为 |
| --- | --- |
| Agent 产出文件 | 在 `artifact_file` 写入后，若文件匹配投递规则（如 `.report/`、`.export/` 目录），自动入队 |
| 用户主动投递 | renderer 的「投递到远程」按钮，调用 `deliveries:enqueue` |
| 定时任务输出 | cronEngine 执行完成后，若产出文件，自动入队 |
| 会话内附件（可选） | 会话产出的 FilePart 可选入队——但这会与"不污染历史"冲突，默认关闭 |

### client 端 UI

在 client 的「文件」Tab 新增「待接收」入口：

1. **待接收列表页**（栈式路由 `deliveries`）：
   - 卡片列表：filename / size / source / 时间
   - 每张卡片两个按钮：「下载」「丢弃」
   - 下载调用 `/__host/deliveries/:id/content` → Blob → 浏览器下载
   - 下载成功后自动调 `/ack`，卡片消失

2. **Tab 角标**：当有待接收文件时，「文件」Tab 显示数字角标
3. **在线时自动拉取**：连接成功后立即 `GET /__host/deliveries`，之后每 30s 轮询

**不做的事**：
- 不做实时推送（WS event）——轮询足够简单可靠
- 不做断点续传——文件通常不大（报告、图表），整文件下载即可
- 不在 client 端持久化元数据——拉取后只在内存，关页面即丢

### 安全性

| 风险 | 缓解 |
| --- | --- |
| 文件路径穿越 | `:id/content` 不直接接 path，只接 id；host 查表得到 path 后 `resolve` + `startsWith(workspace)` 校验 |
| 未授权访问 | 复用 relay 现有鉴权（token + device 配对），只有配对的 client 能调 `/__host/*` |
| 大文件 OOM | `/content` 用流式响应（HTTP chunked），host 侧 `createReadStream` + pipe，不一次性读入内存 |
| 元数据膨胀 | TTL 7 天 + deliveredAt 后 GC；host 启动时清理过期项 |
| 文件被删后仍入队 | `/content` 读取时 `existsSync` 校验，不存在则返回 410 Gone + 自动清理元数据 |

### 不做的事

- **不做 client → host 的离线文件投递**：client 离线时本来就没文件可发；client 在线时直接走 `sendPromptWithFiles` 即可
- **不做 E2E 加密**：文件传输走现有 relay TLS（wss://）+ host 鉴权，不额外加密
- **不做投递失败重试**：下载失败 client 端自己重试；元数据不自动清理直到 ack 或 TTL
- **不打通会话历史**：投递队列与 OpenCode 会话完全独立，不互相引用

## 验证状态

**状态：未实施**

### 待验证项

- [ ] `pending_deliveries.json` 与现有 electron-store schema 的共存方式
- [ ] 流式响应在 relay WS 协议下的实现（现有 head/chunk/done 协议是否够用）
- [ ] agent 产出文件自动入队的规则如何配置（目录白名单？文件类型？）
- [ ] TTL 7 天是否合理（太短可能漏投递，太长可能堆积）
- [ ] client 端轮询 30s 是否合理（实时性 vs relay 负载）

### 实施前置条件

- 确认 host → client 的文件投递场景频率（agent 产出文件是否真的需要主动推）
- 确认「不打通会话历史」可接受（用户是否期望在会话里也能看到投递记录）
- 确认 client 端是否愿意接受轮询（如果需要实时，需要加 WS event 推送）
