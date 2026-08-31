# 远程访问保持唤醒（防睡眠）

## 背景

远程访问（relay host）连接期间，如果系统进入睡眠：WS 连接中断、客户端请求
无法转发，远程访问实际失效。当前没有任何防休眠实现（`powerSaveBlocker` 未使用）。

需求：远程访问支持「保持唤醒」设置——连接期间阻止系统睡眠，保证客户端随时可达。

## 目标

- 设置页「远程访问」卡片新增「保持唤醒」开关（默认关闭，避免静默耗电）。
- 开关**即时生效**（已连接时切换无需重连）；连接期间持有系统唤醒锁，断开即释放。
- 主进程用 Electron 标准 API `powerSaveBlocker`（`prevent-display-sleep` 模式）。

## 设计

### 1. 主进程 `relayHost.ts`

- `RelayHostConfig` 增加 `keepAwake: boolean`。
- 新增私有字段 `powerSaveBlockerId: number | null`，方法：

```ts
private applyKeepAwake(): void {
  if (this.config?.keepAwake && this.powerSaveBlockerId === null) {
    this.powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
  } else if ((!this.config?.keepAwake) && this.powerSaveBlockerId !== null) {
    powerSaveBlocker.stop(this.powerSaveBlockerId);
    this.powerSaveBlockerId = null;
  }
}
```

- `start(config)`：`stop()` 已先释放旧 blocker → 设置 config 后调 `applyKeepAwake()`。
- `stop()`：释放 blocker（`powerSaveBlockerId` 置 null）。
- 新增 `setKeepAwake(on: boolean)`：更新 `this.config.keepAwake` + `applyKeepAwake()`，
  供 IPC 即时切换；不重连。

### 2. IPC `ipc.ts`

- `relay-start`：`keepAwake: !!input.keepAwake` 并入 config 持久化。
- 新增 `relay-set-keep-awake` handler：`(e, on: boolean) => relayHost.setKeepAwake(on)`。
- `relay-status`：config 增加 `keepAwake: !!cfg?.keepAwake`（UI 开关回显）。

### 3. 类型 `electron.d.ts`

- `relay-status` 返回的 config 类型增加 `keepAwake: boolean`。
- 新增 `relaySetKeepAwake: (on: boolean) => Promise<void>`。

### 4. 设置页 `RemoteCard.tsx`

- 新增 state `keepAwake`，`load()` 时从 config 读取。
- 连接按钮行上方加开关行（复用 SettingsPage 既有 switch 样式）：
  `设置.remote.keepAwake` 文案 + toggle；`onChange` 先本地更新再
  `await window.electronAPI.relaySetKeepAwake(v)`（即时生效）。
- `connect()` 提交 `keepAwake`（首连时一并生效）。

### 5. i18n `i18n.tsx`

- 新增 `settings.remote.keepAwake`：英文 `Keep awake while connected (prevents system sleep)`、
  中文 `保持唤醒（连接期间阻止系统睡眠）`。

### 6. 测试

- `RemoteCard.test.tsx` 补用例：切换开关 → `relaySetKeepAwake(true)` 被调用；
  `relay-status` 返回 `keepAwake: true` 时开关回显为开。
- 主进程 `relayHost` 的 blocker 生命周期：`vi.mock('electron')` 后验证
  `start({keepAwake:true})` 调 `powerSaveBlocker.start`、`stop()` 调 `stop`、
  `setKeepAwake(false)` 释放锁。（若 mock 复杂度超出预期，则仅保留 UI 层测试 +
  人工验证，并在验证状态注明。）

## 涉及文件

| 文件 | 改动 |
| --- | --- |
| `apps/desktop/src/main/relayHost.ts` | config 加 keepAwake + blocker 生命周期 + setKeepAwake |
| `apps/desktop/src/main/ipc.ts` | relay-start 透传 keepAwake、relay-status 返回、新增 relay-set-keep-awake |
| `apps/desktop/src/renderer/electron.d.ts` | 类型更新 |
| `apps/desktop/src/renderer/components/settings/RemoteCard.tsx` | 开关 UI + 交互 |
| `apps/desktop/src/renderer/lib/i18n.tsx` | keepAwake 文案 |
| `apps/desktop/src/renderer/components/settings/RemoteCard.test.tsx` | 开关用例 |

## 验证状态

- [x] desktop typecheck / lint / format 通过
- [x] relayHost 测试 4/4（blocker 持有/释放/即时切换/不重复持有）+ RemoteCard 开关测试 + 全量测试 262/262 不回归
- [x] mac 打包成功，改动进包（whisper 资源确认在包内）
- [ ] 手动验证：开启开关连接后系统不再自动睡眠；断开后恢复（待真机验证）
