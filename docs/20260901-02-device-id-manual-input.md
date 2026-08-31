# 设置页设备 ID 支持手动输入

## 背景

desktop 设置页「远程访问」卡片中的**设备 ID**（deviceId）目前是只读展示：
首次连接时主进程用 `randomUUID()` 生成并持久化（electron-store `relay` key），
此后不可修改。随机 UUID 无法辨识，客户端（手机/网页）的设备列表里只能看到
一串乱码；且换机/重装后 ID 变化，客户端需要重新选择设备。

用户希望**支持手动输入修改设备 ID**（如起一个可识别的名字）。

## 目标

- desktop 设置页的设备 ID 从只读文本改为可编辑输入框。
- 修改后重新连接即生效（主进程无需改动：`relay-start` IPC 已接受
  `input.deviceId` 并持久化，`relayHost.start()` 会断开旧连接并用新配置重连）。
- client 端不改：client 的 deviceId 表示「所选 host 设备」，来自设备列表选择，
  手动输入无意义（只读展示保留）。

## 设计

### 1. RemoteCard（`apps/desktop/src/renderer/components/settings/RemoteCard.tsx`）

- 设备 ID 的只读 `span`（含复制按钮）改为**可编辑 input**，样式复用
  relayUrl 输入框（`h-9 rounded-input border ... font-mono`），复制按钮移到
  input 右侧（与只读态一致）。
- 连接逻辑不变：`connect()` 已把 `deviceId` state 传给 `relayStart`，主进程
  `input.deviceId?.trim() || existing?.deviceId || randomUUID()` 会保存新值；
  输入为空时回退旧值（不产生空设备 ID）。
- 已连接状态下修改：input 保持可编辑，连接按钮被「断开」按钮替代——在
  input 下方加一行小字提示「修改设备 ID 后需断开并重新连接生效」，避免用户
  以为修改已生效。

### 2. i18n（`apps/desktop/src/renderer/lib/i18n.tsx`）

- `settings.remote.deviceId` 文案更新：英文 `Device ID (editable; reconnect to apply)`、
  中文 `设备 ID（可修改，重新连接后生效）`。
- 新增 `settings.remote.deviceIdHint`：`Reconnect to apply changes` /
  `修改后断开并重新连接生效`。

### 3. 测试（新增 `RemoteCard.test.tsx`）

- mock `window.electronAPI.relayStatus` 返回固定 config → 渲染后显示该 deviceId。
- 修改输入框 → 点击连接 → `relayStart` 收到新 deviceId（替换 setup 的 noop
  stub 为 spy 对象，测试后恢复）。

## 涉及文件

| 文件 | 改动 |
| --- | --- |
| `apps/desktop/src/renderer/components/settings/RemoteCard.tsx` | 设备 ID 只读 → 可编辑 input + 提示 |
| `apps/desktop/src/renderer/lib/i18n.tsx` | deviceId 文案更新 + 新增 hint 文案 |
| `apps/desktop/src/renderer/components/settings/RemoteCard.test.tsx` | 新增 |

## 验证状态

- [x] desktop typecheck / lint / format 通过
- [x] RemoteCard 测试 2/2 通过 + 全量测试 257/257 不回归
- [x] mac 打包成功（DMG），改动进包
- [ ] 手动验证：修改设备 ID → 保存并连接 → 客户端设备列表显示新 ID（待真机验证）
