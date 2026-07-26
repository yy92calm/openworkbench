# 侧边栏布局修复

## 背景

两个侧边栏相关的布局 bug：

1. **折叠后无法展开**：点折叠按钮后侧边栏收起，但再点展开按钮无反应，侧边栏回不来。
2. **交通灯与新会话栏重叠**：macOS 左上角红黄绿按钮（关闭/最小化/放大）与侧边栏顶部
   的"新会话"那一栏视觉重叠。

## 设计

### 折叠后无法展开

`AppShell` 用内联 style 设 `--sidebar-width: ${sidebarWidth}px`，优先级高于 CSS class
`.layout--sidebar-collapsed { --sidebar-width: 0px }`。折叠时 CSS class 想把列宽设 0，
但被内联的 `sidebarWidth`（如 200px）覆盖，侧边栏列仍占位（透明、`pointer-events:none`），
展开触发按钮落在透明占位区上、难以点到，表现为"无法展开"。

修复：`layoutStyle` 在 `sidebarCollapsed` 时内联设 `0px`，让侧边栏列真正收起到 0 宽，
展开按钮（`absolute left-0`）落在最左边缘可正常点击。

```ts
const layoutStyle = useMemo(
  () => ({ "--sidebar-width": sidebarCollapsed ? "0px" : `${sidebarWidth}px` }) as React.CSSProperties,
  [sidebarWidth, sidebarCollapsed],
);
```

### 交通灯与新会话栏重叠

macOS 窗口 `titleBarStyle: "hidden"` + `trafficLightPosition: { x: 14, y: 14 }`，
交通灯占 y 14-28。侧边栏顶部 `drag-region`（给交通灯留白）仅 `h-8`（32px），
紧随其后的 logo 行与新会话行离交通灯太近，视觉重叠。

修复：`Sidebar` 顶部 `drag-region` 从 `h-8`（32px）增高到 `h-10`（40px），logo 与
新会话行整体下移，与交通灯充分分隔。

## 验证状态

- [x] 侧边栏折叠后点展开按钮能正常展开。
- [x] macOS 交通灯与侧边栏"新会话"栏不再重叠。
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 199/199 不回归。
