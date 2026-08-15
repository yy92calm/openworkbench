# 20260815-07 · 客户端连接注册链路检查与修复

## 检查范围

desktop 端 RelayHost 注册、relay 服务端注册/校验、remote 端 transport 连接、
管理台设备列表——整条「客户端连接注册」链路。

## 发现的问题

### P1 · 桌面端自动连接会生成一次性随机 deviceId（设备分身）

`apps/desktop/src/main/index.ts` 启动自动连接：
```ts
deviceId: relayCfg.deviceId ?? randomUUID(),
token: relayCfg.token ?? randomUUID(),
```

- 当 store 里 `relay.enabled = true` 但缺 `deviceId`（旧版本数据 / 手动清 store），
  每次启动生成**新随机 deviceId** → 中继把每个随机 id 都注册为独立设备，
  管理台/客户端设备列表堆积垃圾设备（`f47ac10b-…`）。
- `token` 缺失时生成随机 token，该 token 不在任何账号注册表 → 握手被 4001 拒绝，
  用户会困惑「我明明开了远程却连不上」，且状态显示 error。

**修复**：自动连接时 `deviceId`/`token` 缺失 → **不自动连接**，保持 off；
等待用户在设置页手动配置（UI 按钮在 deviceId 为空时本就禁用，逻辑对齐）。

### P2 · RelayHttpTransport.connect() 缓存已连设备的参数

`RelayHttpTransport.connect()`:
```ts
connect(relayUrl, deviceId, token) {
  if (this.opened) return this.opened;  // 无视新参数
}
```
同一实例复用且换 device/token 时，会连到旧参数。当前 remote 每次新建实例，
线上未触发，但属防御性隐患。

**修复**：记录已连参数 (url/device/token)，参数变化时重建连接。

### P3 · 中继不清理「已注册但久未上线」的设备（低优先级）

`registry.devices` 只增不减（除管理台手动删除）。host 换了 deviceId 后旧 id 永久残留。
属设计权衡（保留历史设备让管理台可见），暂不改；管理台已提供删除。

## 修复清单

| 文件 | 修复 |
| --- | --- |
| `apps/desktop/src/main/index.ts` | 自动连接缺 deviceId/token → 不连接 |
| `relay/src/RelayHttpTransport.ts` | connect 参数变化时重建连接 |

## 验证

- [x] desktop typecheck 通过（自动连接逻辑修复后）。
- [x] relay 单测 21/21（新增「不同参数重建连接」「同参数复用」2 个 transport 用例）、E2E PASS。
- [x] relay typecheck 通过；remote typecheck + build 通过（transport 改动影响 remote）。