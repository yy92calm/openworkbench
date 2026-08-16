# Client 登录解耦设备选择

## 背景

当前 client 登录是**强制两步**：

1. 输入 relay URL + token → 点「登录并查看设备」→ `listDevices` 验证 token
2. **必须**选设备 → 点「连接」→ `connect()` 在 `deviceId` 为空时直接抛 `"请先选择设备"`

[App.tsx:96](file:///Users/davidyang/Desktop/open-ai-workbench/client/src/App.tsx#L96) 用 `getClient()` 判断渲染主界面，没选设备就进不去 TabBar。会话分享、设置等不依赖设备的功能也被挡在门外。

## 目标

- 登录后即可进入主界面，**不强制选设备**
- 不选设备也能用：会话分享、设置（账号部分）
- 选设备后才能用：会话、任务、文件、设置（host 状态部分）
- 在所有 tab 可见的位置显示当前设备状态，并提供入口切换/选择设备

## 设计

### 状态机

引入两层状态，替代原来的「已连接/未连接」二元判断：

| 状态 | 判断条件 | 可用功能 |
|---|---|---|
| 未登录 | `loadConfig() === null` | 仅登录页 |
| 已登录、未选设备 | `cfg !== null && !getClient()` | 会话分享、设置（账号部分）；设备栏 CTA |
| 已登录、已选设备 | `getClient() !== null` | 全部功能 |

`connection.ts` 新增 `isLoggedIn()` 判断「已登录」（cfg 不为 null，不要求 deviceId）。`isConnected()` 保留原语义（已连到设备）。

### ConnectPage 简化为单步登录

[ConnectPage.tsx](file:///Users/davidyang/Desktop/open-ai-workbench/client/src/pages/ConnectPage.tsx) 删除设备选择 UI（`showPicker` 分支），流程改为：

1. 输入 relayUrl + token
2. 点「登录」→ `listDevices(relayUrl, token)` 验证 token
3. 成功 → `saveConfig({ relayUrl, token, deviceId: "" })` → `onConnected()`
4. 失败 → 显示错误

`useEffect` 自动恢复逻辑保留：若有 cfg 且 `deviceId` 非空，直接 `connect()` 跳过登录页（保持现有行为）；若 `deviceId` 为空，只恢复登录态，不调 `connect()`。

### App.tsx 渲染条件

```diff
- if (!ready) return <ConnectPage ... />;
- if (!getClient()) return null;
+ if (!ready) return <ConnectPage ... />;        // ready = 已登录
+ // getClient() 可能为 null（未选设备），仍渲染主界面 + DeviceBar
```

主界面结构：
```
app-shell
├── DeviceBar            (全局顶部，常驻)
└── tab-content          (tab 根页 / 栈顶页)
└── TabBar               (底部)
```

### DeviceBar 全局组件

新增 `client/src/components/DeviceBar.tsx`：

- **未选设备**：显示红色「未选择设备」+ 「点击选择」按钮，点击触发设备选择 sheet
- **已选设备**：显示设备 ID（截断）+ 在线状态点（绿/灰），点击触发设备选择 sheet
- **连接中**：显示「连接中…」+ spinner

组件内部不直接管理设备列表（避免每个 tab 实例都拉一次），通过 `connection.ts` 的 `listDevices` + 本组件 state 实现。

### 设备选择交互：底部 sheet

参考用户偏好（app-style + 底部 sheet），把 SessionsPage 现有的 modal 设备列表改造为底部 sheet 样式，提取为独立组件 `DeviceSheet.tsx`，供 DeviceBar 调用。

```
DeviceSheet
├── backdrop
└── sheet (底部上滑)
    ├── header: 标题「选择设备」 + 关闭按钮
    ├── 设备列表（在线优先，按 device id 排序）
    │   └── 单项: radio + device id + 在线/离线徽标
    ├── 刷新按钮
    └── 空列表提示: "该账号还没有注册任何设备"
```

选设备后：调 `connect({relayUrl, deviceId, token})` → 成功关闭 sheet → DeviceBar 更新状态。失败显示错误，sheet 保持打开。

### SessionsPage 移除内嵌切换 UI

SessionsPage 现有 header 里的「切换设备」按钮和 modal 切换器删除，统一由 DeviceBar 触发 DeviceSheet。`openSwitch()` / `switching` / `devices` / `chosen` 等相关 state 也删除。

### 各 tab 在「未选设备」时的表现

| Tab | 未选设备时 | 已选设备时 |
|---|---|---|
| 会话 | 显示空状态卡片「请先选择设备」+ 按钮（触发 DeviceSheet） | 现状 |
| 任务 | 显示空状态卡片「请先选择设备」 | 现状 |
| 文件 | 显示空状态卡片「请先选择设备」 | 现状 |
| 会话分享 | 照常可用（不依赖设备） | 照常 |
| 设置 | 显示账号卡片；host 状态卡片显示「未选择设备」 | 现状 |

新增一个共用空状态组件 `DeviceRequiredCard.tsx`，包含说明文字 + 「选择设备」按钮（触发全局 DeviceSheet 的事件）。

通过事件总线让 DeviceRequiredCard 触发 DeviceBar 打开 sheet：
- `connection.ts` 新增 `openDeviceSheet()` / `onOpenDeviceSheet(cb)` 简单事件订阅
- DeviceBar 在 mount 时订阅 `onOpenDeviceSheet`，收到事件就 `setSheetOpen(true)`
- DeviceRequiredCard 点击按钮调 `openDeviceSheet()`

### connection.ts API 改动

```ts
// 新增
export function isLoggedIn(): boolean;          // cfg !== null
export function openDeviceSheet(): void;        // 触发全局 sheet
export function onOpenDeviceSheet(cb: () => void): () => void;

// 修改
export async function connect(c: ConnectionConfig): Promise<OpenCodeClient>;
  // 删除 `if (!c.deviceId) throw new Error("请先选择设备");`
  // 在登录态调用时，deviceId 为空就抛 "请先选择设备"（保留语义，只在主动选设备时触发）

// 保留
export function isConnected(): boolean;         // client !== null
export function getClient(): OpenCodeClient | null;
```

### App.tsx 自动恢复逻辑

```ts
useEffect(() => {
  if (isConnected()) { setReady(true); return; }
  const cfg = loadConfig();
  if (!cfg) { setTrying(false); return; }
  if (cfg.deviceId) {
    // 上次选过设备，尝试恢复连接
    connect(cfg).then(() => setReady(true)).catch(() => setReady(true)).finally(() => setTrying(false));
    // 注意：即使连接失败也 setReady(true)，进入主界面让用户重选
  } else {
    // 已登录但未选设备
    setReady(true);
    setTrying(false);
  }
}, []);
```

## 涉及文件

新增：
- `client/src/components/DeviceBar.tsx`
- `client/src/components/DeviceSheet.tsx`
- `client/src/components/DeviceRequiredCard.tsx`

修改：
- `client/src/lib/connection.ts` —— `isLoggedIn` / `openDeviceSheet` / `onOpenDeviceSheet` / `connect` 调整
- `client/src/App.tsx` —— 渲染条件 + 嵌入 DeviceBar
- `client/src/pages/ConnectPage.tsx` —— 删除设备选择 UI
- `client/src/pages/SessionsPage.tsx` —— 移除内嵌切换 UI，未选设备时显示 DeviceRequiredCard
- `client/src/pages/TasksPage.tsx` —— 未选设备时显示 DeviceRequiredCard
- `client/src/pages/FilesPage.tsx` —— 未选设备时显示 DeviceRequiredCard
- `client/src/pages/SettingsPage.tsx` —— host 状态卡片在未选设备时显示提示
- `client/src/styles.css` —— DeviceBar / DeviceSheet / DeviceRequiredCard 样式

## 验证状态

- [x] typecheck 通过（client；desktop 本次改动相关文件无新增错误）
- [x] vite build 通过（client + desktop）
- [x] 部署到远端，浏览器验证：
  - [x] 登录页只有 relayUrl + token 两个字段
  - [x] 登录后进入主界面，DeviceBar 显示「未选择设备」
  - [x] 切到「会话分享」tab，能创建会话（不选设备也可用）
  - [x] 切到「设置」tab，账号卡片显示，host 状态卡片显示「未选择设备」
  - [x] 点 DeviceBar 或「会话」tab 的 CTA，弹出底部 sheet 选设备
  - [ ] 选设备后，会话/任务/文件 tab 可用（本地无在线 host，连接保持「连接中」为预期；需真机验证）
  - [ ] 关闭 app 重新打开，自动恢复登录态；若上次选过设备，尝试自动重连（需真机验证）
