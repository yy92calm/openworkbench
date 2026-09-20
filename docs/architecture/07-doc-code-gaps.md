# 07 · 文档 ↔ 代码差异与风险清单

> 所属：架构现状系列 · [返回索引](./README.md)

核实日期：2026-09-18。方法：逐文件源码核对 + 抽样运行验证；每条给出现状、
证据（文件:行号）、影响与建议。**修复后请删除对应条目，并把结论并入对应
架构篇。**

## 一、功能性缺口

### 1. 定时任务每日预算守卫永不生效

- 现状：`executeTask` 调用 `shouldSkipDueToDailyLimit(task, history)`，而守卫
  期望 `{taskId, maxRunsPerDay}`；`ScheduledTask` 只有 `id`，运行时
  `task.taskId === undefined`，按 taskId 过滤的历史计数恒为 0。
- 证据：`apps/desktop/src/main/scheduler.ts:397`、`schedulerGuards.ts:22-42`、
  `scheduler.ts:20-30`（任务字段）。
- 影响：`maxRunsPerDay` 护栏完全失效，配错 cron 的无人值守任务可无限触发
  （token/成本风险）。
- 建议：传 `task.id`（或统一守卫签名），并补调用侧单测。

### 2. desktop 的 typecheck 空跑

- 现状：`apps/desktop/package.json` 的 `typecheck` 是 `tsc --noEmit`，而
  tsconfig 是 solution-style（`files: []` + references）；实测退出码 0，
  且第 1 条的真实类型错误未被发现。
- 证据：`apps/desktop/package.json:15`、`apps/desktop/tsconfig.json`；
  实测 `pnpm typecheck` → `exit=0`。
- 影响：CI 对 desktop 主/渲染层源码没有任何类型保障。
- 建议：改为 `tsc -b`，或分别 `-p tsconfig.node.json` / `-p tsconfig.web.json`。

### 3. 保持唤醒开关运行时失效

- 现状：主进程 handler（`relay-set-keep-awake`）、状态返回字段与
  `electron.d.ts` 类型都齐备，但 preload 未暴露 `relaySetKeepAwake`。
- 证据：`apps/desktop/src/preload/index.ts:96-110`（无该键）、
  `renderer/electron.d.ts:115`、`renderer/components/settings/RemoteCard.tsx:69`、
  `main/ipc.ts:170-174`。
- 影响：设置页切换「保持唤醒」时报 `is not a function`；测试使用 mock 未
  暴露该问题。`relayStart` 的 preload 类型也未包含 `keepAwake`（运行时因对象
  透传恰好生效，类型不诚实）。
- 建议：preload 暴露方法并补全 `relayStart` 入参类型。

### 4. provenance 写入与读取结构不一致，列表恒空

- 现状：写入记录形如 `{sessionId, callId, tool, input:{content,log}, output:null}`；
  读取 `listProvenance(path)` 却按 `r.path === path || r.input?.path === path`
  过滤。记录里两个字段都不存在，过滤结果为空。
- 证据：`apps/desktop/src/main/provenance.ts:20-48`、
  `renderer/lib/provenance.ts:44-52`（调用侧把 `input.path` 传给了 `callId`）。
- 影响：artifact 检查器的版本/复现面板取不到任何历史记录。
- 建议：统一记录 schema（写入补 `path` 字段，或读取改按 callId），并与
  `@workbench/shared` 的 `ProvenanceRecord` 对齐。

### 5. restart-runtime 后调度器仍持有旧客户端

- 现状：`restart-runtime` 只执行 `stopSidecar()` + `startAgentRuntime()`；
  cron 的 fire 回调闭包在**首次** `start-runtime` 时注入，重启后仍指向旧的
  sidecar URL。
- 证据：`apps/desktop/src/main/ipc.ts:365-370` 与 `ipc.ts:86-126`。
- 影响：重启运行时后定时任务可能连到已关闭端口，直到用户再次触发
  `start-runtime`。
- 建议：抽出「连接 + 注入 fire 回调」的公共函数，restart 后重建。

### 6. Claude Code 后端当前不可对话

- 现状：渲染层仍直接 `new OpenCodeClient`（不经工厂）；`ClaudeCodeAdapter`
  的 `answerQuestion/rejectQuestion` 抛「not yet supported」，
  `listQuestions/listPermissions/listSkills/listCommands/listMcpServers` 返回空；
  渲染层对 `claude-code` 只显示「手动连接」提示。主进程仅部署 `.claude`
  profile，不启动常驻进程。
- 证据：`renderer/lib/runtime.ts:749`、
  `packages/sdk/src/agent-runtime/claude-code-adapter.ts:232-304`、
  `main/server.ts:295-306`。
- 影响：设置中的后端选择只影响 profile 部署，对话功能不生效。
- 建议：接通渲染层工厂调用与事件桥（或暂时从 UI 隐藏该选项）。

### 7. packages/scheduler 与 packages/terminal 未接入

- 现状：desktop 的依赖中没有 `@fafawork/scheduler` / `@fafawork/terminal`；
  两包源码只被自身引用，主应用分别使用 `src/main/scheduler.ts` 与直接
  `node-pty`。
- 证据：`apps/desktop/package.json` 依赖列表；两包内 grep 无外部引用。
- 影响：双实现并存，维护成本与误导风险。
- 建议：删除或正式接入（产品决策）。

## 二、安全与策略

### 8. 房间「E2E 加密」未实现

- 现状：协议注释声称消息端到端加密、relay 无法解密；实现是 base64 明文
  占位（`nonce` 为空，代码内 TODO）；文件走 relay HTTP 上传，同样明文可读。
- 证据：`relay/src/protocol.ts:13,81`、`apps/desktop/src/main/roomPeer.ts:308-316`、
  `client/src/lib/roomConnection.ts`（`btoa` 编码）。
- 影响：relay 可见全部房间内容（含会话分享摘要与上传文件）。
- 建议：实现真正的密钥协商与加密，或在 UI/文档中明确「非 E2E」。

### 9. 浏览器 MCP 的 HTTP API 无鉴权

- 现状：`127.0.0.1:43921` 固定端口，handler 不校验任何凭据；工具集包含
  `execute-js`、`screenshot`、`upload`、`download` 等。
- 证据：`packages/browser-mcp/src/main/index.ts:440` 及同文件 HTTP 路由。
- 影响：本机任意进程可驱动内嵌浏览器、截屏、读写工作区文件。
- 建议：仿照调度器 API 加随机 token + 请求校验。

### 10. 用户覆盖层可绕过 patch 的收紧策略；requirements.json 未提供

- 现状：用户目录的顶层 `opencode.json` 会先整体覆盖 base，patch 校验再以
  **覆盖后的文件**为 base 做「只能收紧」判断；除 `sandbox.json` 外没有策略
  校验。管理红线 `requirements.json` 仓库中不存在，需管理员手放。
- 证据：`apps/desktop/src/main/profilePatch.ts:99-127`、`:157-171`；
  repo 内 `find -name requirements.json` 无结果。
- 影响：本地用户可放宽 permission、改写 instructions；默认没有硬防线。
- 建议：对 `opencode.json`/`AGENTS.md` 等敏感文件的覆盖也走策略校验，或
  在打包文档中把 `requirements.json` 作为必交件。

### 11. 打包 profile 携带 apiKey

- 现状：`app-config/.opencode/opencode.json` 含 `apiKey` 字段（本地文件、
  `.gitignore` 排除），该文件作为 extraResources 随安装包分发，并复制到
  部署目录。
- 证据：profile 字段检查（不展示值）；`server.ts` 部署链路。
- 影响：安装包使用者可提取密钥；与 README「provider key 存在 app 私有配置
  目录」的表述存在偏差（安装包资源不是私有目录）。
- 建议：打包者改用设置页 provider 配置（electron-store）或安装后注入；
  如必须内置，需接受可被提取的风险。

## 三、文档滞后与描述偏差

### 12. kernel 不是持久内核

- README（中英文）称「持久 per-notebook kernel」；实际 `kernelExecute` 每次
  执行 spawn 一次性子进程，退出即从表里删除。
- 证据：`apps/desktop/src/main/kernel.ts:19-83`。
- 建议：修正 README 表述，或实现真正的持久 kernel。

### 13. 压缩快照目录与方案文档不符

- 文档 20260901-04 称写 `.workbench/compaction-snapshots/`；实际写在
  `<workspace>/compaction-snapshots/`（与 provenance 不同目录）。
- 证据：`apps/desktop/src/main/snapshot.ts:8,34`、`main/ipc.ts:471`。

### 14. 调度器事件推送未实现

- 文档 20260709-01 设计了 `scheduler:event` 主进程推送与 preload
  `onSchedulerEvent`；代码中不存在，UI 只能手动拉取。
- 证据：`apps/desktop/src`、`packages/*/src` grep 无命中。

### 15. 上下文面板没有 instructions 分组

- 文档 20260722-02 声称自动上下文包含指令文件（AGENTS.md 等）；实际
  `AutoContext` 只有 Agents / Skills / MCP 三组。
- 证据：`renderer/components/inspector/AutoContext.tsx:35-51`。

### 16. sdk/shared 双副本已分叉

- 文档 20260815-11 称 `packages/sdk` 与 `client/sdk`「字节级一致」；实际
  client 独有 `HostClient`/`uploadAttachment`/`sendPromptWithFiles`，主仓独有
  `agent-runtime` 整套类型与测试。shared 也有小幅差异。
- 证据：两侧 `sdk/src` 目录比对。

### 17. relay e2e 脚本路径失效

- `relay/package.json` 的 `e2e` 指向 `e2e-account.mjs`，仓库中只有
  `e2e-account.ts`（且 Node 25 下有已知 transport bug）。
- 证据：`relay/package.json:18`、`relay/e2e-account.ts`。
- 说明：`relay/README.md` 中的同名命令已在本轮文档整理中修正为 `.ts`。

### 18. 命令面板「打开笔记本」无对应路由

- `CommandPalette` 执行 `navigate('/notebooks')`，但路由表没有该路径，会落到
  `NotFound`。
- 证据：`renderer/components/command-palette/CommandPalette.tsx:93-97`、
  `app/router.tsx`。

### 19. relay 管理端文档与实现不一致

- 文档 20260815-05 称管理 API 校验 Origin/Referer、Cookie 名为
  `workbench_admin`；实际无 Origin 校验，Cookie 为 `admin_session`。
- 证据：`relay/src/server.ts:538-553`、grep 无 Origin 校验逻辑。

### 20. 协议注释漂移与注释与实现不符

- relay 版 `RoomJoined` 注释比 client/desktop 副本多两句；`message-viewed`
  协议注释称只转发给原发送者，实际广播给除查看者外的所有成员。
- 证据：三份 `protocol.ts` diff；`relay/src/room.ts` 的 viewed 广播逻辑。

## 四、设计取舍（非缺陷，部署时需知晓）

- relay 不落盘请求与房间内容：重启后房间、成员、消息、上传文件全部消失。
- 未配 TLS 时公网段明文；管理端默认密码 `test@123`；`/api/rooms*` CORS 为 `*`。
- peer 心跳 180s，成员离线后存在约 6 分钟的幽灵窗口；房间消息无 ack。
- relay 单测覆盖转发/鉴权/持久化/管理端，但房间、cancel、心跳无自动化用例；
  host 侧 relayHost 转发与 Host API 也无自动化用例。
- `relay/e2e-account.ts` 在 Node 25 下有已知 `Response body disturbed` 问题
  （文档多处记录，未修；单测覆盖同逻辑）。

## 五、核实方式说明

- 结构性结论：逐文件阅读 `apps/desktop/src`、`packages/*/src`、`relay/src`、
  `client/src` 源码。
- 抽样运行：`pnpm --filter @workbench/desktop typecheck`（验证第 2 条）。
- 结构比对：三份 `protocol.ts` diff、两份 `sdk/src` 目录比对、grep 关键字
  命中检查（scheduler:event、requirements.json、auth 等）。
