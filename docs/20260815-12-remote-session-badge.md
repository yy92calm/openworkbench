# 远端会话标识方案

> 在侧边栏 SessionRow 上为通过 relay 远端创建的会话显示「远端」文字徽标，
> 让用户一眼区分本地会话与远端会话。

## 背景

当前桌面端的会话列表无法区分哪些是远端 guest 通过 relay 创建的。无论
本地点击「新会话」还是远端 client 发 `POST /session`，最终都打到同一个
sidecar，[SessionMeta](../../packages/sdk/src/types.ts) 类型没有来源字段，
[SessionRow](../../apps/desktop/src/renderer/components/sidebar/Sidebar.tsx)
只显示状态点 + 标题 + token/cost。

## 设计

### 数据流

```
guest POST /session  →  relayHost.handleMessage()
                         │
                         ├─ 转发到 sidecar（透明，不改变现有行为）
                         ├─ 缓冲响应 body，解析 { id } 提取 sessionId
                         ├─ 加入 remoteSessionIds 集合
                         ├─ 持久化到 electron-store（relay.remoteSessionIds）
                         └─ 通知 renderer（IPC 事件 relay-remote-sessions-changed）
                                                    │
                                                    ▼
                         renderer store.remoteSessionIds: Set<string>
                                                    │
                                                    ▼
                         SessionRow 检查 has(id) → 显示「远端」徽标
```

### 拦截点

在 [relayHost.ts](../../apps/desktop/src/main/relayHost.ts) 的
`handleMessage` 方法中，当检测到 `msg.method === "POST"` 且
`msg.path` 匹配 `/session`（含 `?directory=` 查询参数）时，在流式转发
响应的同时缓冲 body 文本。`POST /session` 的响应是小 JSON
`{ id: "..." }`，缓冲开销可忽略。响应转发完成后尝试解析 id，成功则记录。

**不改变现有转发行为**——只是额外读取了已经流过的 body 文本。

### 持久化

`remoteSessionIds` 存入 electron-store 的 `relay.remoteSessionIds` 字段
（字符串数组）。RelayHost 启动时加载，新增时写入。会话删除时不主动清理
（集合中残留已删除的 id 无害——该 id 不会出现在会话列表里）。

### 改动清单

| 文件 | 改动 |
| --- | --- |
| `apps/desktop/src/main/relayHost.ts` | 增加 `remoteSessionIds` 集合 + `recordRemoteSession()` + 加载/保存 + `getRemoteSessionIds()` |
| `apps/desktop/src/main/ipc.ts` | 增加 IPC handler `relay-remote-sessions`；relayHost 记录新会话后向所有窗口发送 `relay-remote-sessions-changed` 事件 |
| `apps/desktop/src/preload/index.ts` | 暴露 `relayRemoteSessions()` + `onRemoteSessionsChanged(cb)` |
| `apps/desktop/src/renderer/lib/runtime.ts` | store 增加 `remoteSessionIds: Set<string>`；`connect()` 后加载 |
| `apps/desktop/src/renderer/components/sidebar/Sidebar.tsx` | SessionRow 检查 `remoteSessionIds.has(row.id)`，显示「远端」徽标 |

### 视觉样式

参考现有 Example 徽标的样式，在 SessionRow 标题行右侧加一个紧凑的
「远端」文字徽标：

```tsx
{isRemote && (
  <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[11px] uppercase tracking-wide text-muted ring-1 ring-border">
    远端
  </span>
)}
```

与 Example 徽标视觉一致，但文字不同，用户可一眼区分。

### 边界情况

- **历史会话**：不回溯。部署前创建的远端会话不会被标记（用户已确认接受）。
- **会话删除**：不从集合中移除。残留 id 无害。
- **RelayHost 重启**：从 electron-store 加载，已标记的会话保持标记。
- **非 session 创建的 POST**：只匹配 `POST /session`，不影响其他请求。

## 验证状态

- [x] relayHost 拦截 POST /session 并提取 sessionId
- [x] sessionId 持久化到 electron-store（workbench.relay.remoteSessionIds）
- [x] IPC 暴露 remoteSessionIds 给 renderer（relay-remote-sessions）
- [x] renderer store 加载 remoteSessionIds（connect 后 + IPC 变更事件）
- [x] SessionRow 显示「远端」徽标（accent 色调，区别于 Example 徽标）
- [x] TypeScript 编译通过（tsc --noEmit 无错误）
- [ ] 本地创建的会话不显示徽标（需运行时验证）
- [ ] 远端 guest 创建会话后徽标实时出现（需运行时验证）
- [ ] relayHost 重启后已标记会话保持标记（需运行时验证）
