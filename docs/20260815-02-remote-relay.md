# 远程连接方案：App 连接本机 Workbench

日期：2026-08-15
状态：方案待确认，未实施

## 背景

用户希望手机/平板上的 **App** 跨网络连接本机 Workbench，具备**完整会话操作**
能力（新建会话、发 prompt、看流式回复、查看产物）。已确认的技术选型：

- 中继层：**自建 WebSocket 中继**（部署在用户公网服务器 `http://43.133.82.137`）
- 客户端形态：**Web App / PWA**，同时**做成 Electron 可加载模块**（同一套代码，
  浏览器托管与 Electron 加载两种形态），传输层**同时支持 ws:// 与 wss://**

## 现状

当前连接链（已核实代码）：

```
渲染进程 UI ──IPC──> Electron 主进程 ──HTTP+SSE──> OpenCode sidecar (127.0.0.1:随机端口)
```

- sidecar 只绑定 `127.0.0.1`（`apps/desktop/src/main/server.ts:344`），端口随机，
  密码每次启动生成（`OPENCODE_SERVER_PASSWORD`）。
- `OpenCodeClient`（`packages/sdk`）支持注入 `fetchImpl`；注入后自动走
  streaming-fetch 读 SSE（`OpenCodeClient.ts:113`），无需 EventSource。该 client
  是纯浏览器可用代码（渲染进程已在用），客户端可直接复用。
- 渲染进程 `connect()` 从 store 取 `serverUrl` + `password` 构造 client
  （`runtime.ts:622-635`）。

结论：**对外没有任何连接入口**，外部设备无法直连 sidecar；但 SDK 的
`fetchImpl` 注入点为远程 transport 预留了天然扩展位。

## 候选方案对比（中继层）

| 方案 | 部署 | 代码改动 | 设备配对 | 明文风险 | 备注 |
|---|---|---|---|---|---|
| **A. 自建 WS 中继（已选）** | 公网机跑一个 Node 进程（WS 转发 + 静态托管客户端） | host 加 relay 客户端；新增客户端应用 | deviceId + token | 无 TLS 时明文，可配 wss | 无第三方依赖，符合 local-first |
| B. frp 反向代理 | 公网机跑 frps + host 跑 frpc | 客户端几乎零代码，但托管 UI 仍需服务器 | 仅 sidecar 密码 | 端口直通明文 | 第三方二进制，公网端口常开 |
| C. cloudflare quick tunnel | 无需公网 IP | 零 | 无 | TLS 加密 | 依赖外部服务 |

## 设计（自建 WebSocket 中继 + 可加载客户端）

### 总体架构

```
公网服务器 43.133.82.137
┌──────────────────────────────────────────────┐
│  relay-server (Node)                         │
│  ├─ HTTP(S) 静态托管客户端构建产物            │
│  ├─ WS/WSS 中继  Map<deviceId, hostSocket>   │
│  └─ 可选 TLS（--tls-cert/--tls-key）         │
│     纯内存透传，不落盘、不记内容              │
└──────▲──────────────────────────────▲────────┘
       │ 出站 WS/WSS 长连接            │ 两种加载形态
┌──────┴──────┐          ┌────────────┴──────────┐
│ Host 电脑   │          │ 客户端（同一套代码）    │
│ Workbench   │          │ 形态1: Web/PWA 浏览器  │
│ desktop     │          │ 形态2: Electron 加载   │
└─────────────┘          └───────────────────────┘
```

- **Host**（本机 desktop）：sidecar 启动后，主进程建立到中继的出站 WS/WSS，
  注册 `deviceId + token`。收到中继转来的 HTTP 请求 → 转发到本地
  `127.0.0.1:<port>` → 响应（含 SSE 流）逐块经 WS 推回。
- **客户端**：一份代码两种加载形态：
  - **形态 1 · Web/PWA**：构建产物托管在中继服务器，手机/平板浏览器访问，
    可添加到主屏幕；
  - **形态 2 · Electron 可加载模块**：同一构建产物由 Electron 壳加载
    （`loadFile` 本地构建产物），作为桌面客户端连远程 Host。

### 传输层：ws 与 wss 双支持

- `RelayHttpTransport` 使用标准 WebSocket API，**原生支持 ws:// 与 wss://**，
  由配置的中继地址决定（浏览器与 Electron 渲染进程均原生支持 wss）。
- 浏览器页面协议约束：https 页面只能连 wss（浏览器安全策略）；Electron 形态
  不受此限制（显式配置 wss 即可）。
- 中继服务器：提供 `--tls-cert/--tls-key`（或环境变量）启用 TLS；未配置时
  退回 http/ws。**自签证书场景**：手机浏览器无法信任自签 wss，但 Electron
  客户端可通过 `session.setCertificateVerifyProc` 放行自签证书 —— 这正是
  Electron 形态的主要价值：无域名证书时也能用加密通道。
- Host 侧出站连接跟随同一协议配置（ws/wss 均可，默认与客户端一致）。

### 中继协议（WS 文本消息，JSON）

```
App → Relay → Host:
  { id, method, path, headers?, body? }        // HTTP 请求
Host → Relay → App:
  { id, status, headers }                      // 响应头
  { id, chunk }                                // 响应体分块（SSE 也走这个）
  { id, done }                                 // 结束
```

- `id` 为请求唯一标识，支持并发多请求。
- 心跳：每 30s ping，60s 无响应剔除连接，Host 端指数退避重连。
- 中继只做字节转发，不解析业务内容。

### 鉴权与配对

- 中继服务器配置 `RELAY_AUTH_TOKEN`（部署时设定）。
- Host 连接携带 `?role=host&device=<deviceId>&token=<auth>`；
  客户端连接携带 `?role=guest&device=<deviceId>&token=<auth>`。
- 只有 token 相同且 device 存在的 host/guest 才能配对；不匹配即断开。
- 配对码流程（二期）：Host 生成一次性配对码，客户端输入后向中继换取访问 token。

### 客户端功能范围（一期）

- 会话列表 / 新建会话 / 删除会话
- 发送 prompt、查看流式回复与 reasoning
- 工具调用展示（tool call 行、shell 输出）
- 产物（artifact）查看入口
- 响应式 UI（Web 形态移动端优先；Electron 形态桌面窗口复用同一布局）
- 连接配置：中继地址（ws:// 或 wss://）、deviceId、token；Electron 形态
  增加「放行自签证书」开关

### 安全边界

- API key 始终只存在 Host 本机（sidecar 持有），客户端操作经由 Host 的
  sidecar 执行，key 不发送给客户端，也不经过中继。
- 中继不落盘、不记录内容，只记录连接/断开事件。
- 传输：配置 TLS 后公网段为 wss 加密；未配置时明文（已知限制，明确提示）。
- PWA 的 Service Worker 在 http 下不可用（Chrome 限制），不影响使用；
  https/wss 部署后自动获得。

### 改动范围

1. `packages/relay/`（新包）
   - `server.ts` — 中继服务器（WS/WSS 转发 + 静态托管 + 可选 TLS）
   - `protocol.ts` — 共享消息类型
   - `RelayHttpTransport.ts` — fetch polyfill（WS/WSS → HTTP 语义）
2. 客户端应用（新，目录名实施时定，如 `apps/remote/`）
   - 前端：React + Vite，会话 UI + `OpenCodeClient` + `RelayHttpTransport`
   - Web 构建产物供中继服务器托管（形态 1）
   - Electron 壳（main + preload）：加载同一构建产物（形态 2），
     自签证书放行开关，`loadFile` 本地构建产物
3. `apps/desktop/src/main/relayHost.ts`（新）— Host 侧中继客户端，生命周期挂在
   sidecar 之后，复用 `server.ts` 的 `getServerUrl()`/`getServerPassword()`
4. `apps/desktop/src/main/ipc.ts` + `preload` — 新增远程连接 IPC（启停/状态）
5. `apps/desktop/src/renderer/app/routes/SettingsPage.tsx` — 「远程访问」卡片：
   中继地址、deviceId、token、开关
6. `scripts/` — 中继服务器部署脚本（上传到公网机 + systemd 单元示例）

### 实施步骤

1. `packages/relay`：协议类型 + 中继服务器（ws + wss + 静态托管）+ 单测
   （路由、断开清理、并发 id、TLS 开关）
2. `relayHost.ts`：本地 mock sidecar + 中继联调，验证请求转发与 SSE 流回传
3. 客户端最小会话 UI + `RelayHttpTransport` 联调（同机：host 起 sidecar +
   relay host，浏览器打开本地中继页面连接）
4. Electron 壳加载同一构建产物，验证自签 wss 连接
5. 桌面端设置页 UI + 远程开关
6. 部署中继到 `43.133.82.137`（http 先行，可选 TLS），手机真机跨网络验证

## 验证状态

- [x] 确认 `OpenCodeClient` 支持 `fetchImpl` 注入（`OpenCodeClient.ts:79-81`）
- [x] 确认注入后走 streaming-fetch 路径，EventSource 不阻塞（`OpenCodeClient.ts:113`）
- [x] 确认 SDK 纯浏览器可用（渲染进程已在用，无 Node 依赖泄漏到该路径）
- [x] `packages/relay` 单测 8/8 通过（请求转发、POST body、鉴权透传、SSE 分块、
      并发路由、无 host 502、错误 token 拒绝、静态托管 + SPA 回退）
- [x] `packages/relay` typecheck 通过
- [x] 同机端到端联调通过：OpenCodeClient 经中继完成
      连接（SSE）→ 建会话 → 发 prompt → 流式文本 → 工具调用 → idle
- [x] 桌面端：relayHost + IPC + 设置页「远程访问」卡片实现，typecheck 通过
- [x] 桌面端测试 255/255 通过（无回归）
- [x] `apps/remote` Web 客户端构建通过（1579 模块，177KB/gzip 55KB）
- [x] 部署脚本 + systemd 单元示例 + relay README
- [ ] wss/TLS 握手联调（本地自签证书）——代码路径已就绪，待真机验证
- [ ] Electron 壳加载验证（`apps/remote/electron`，自签证书放行开关）
- [ ] 公网真机验证（部署到 43.133.82.137 后手机/Electron 连接）

## 已知遗留

- `packages/sdk` 的 `claude-code-adapter.ts` 存在预存在的类型错误
  （`@anthropic-ai/claude-agent-sdk` 版本类型不匹配）。桌面端 typecheck
  （根 tsconfig `files: []`）与运行时构建均不受影响；remote 的 typecheck
  会暴露这些错误（remote 自身代码零错误）。按「surgical 原则」未在本任务内修复。
