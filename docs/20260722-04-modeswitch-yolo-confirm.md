# ModeSwitch YOLO 危险确认

## 背景

`ModeSwitch` 提供「审核 / 自动 / YOLO」三档。YOLO 档通过 `setPermissionMode`
（`packages/sdk/src/OpenCodeClient.ts:627`）映射到：

```
bash/edit/write/skill/question/external_directory: allow
doom_loop: allow   ← 关闭死循环防护
```

这绕过了 OpenCode 的死循环（doom loop）安全防护，与 AGENTS.md 的安全红线
「never ship `full`」存在张力。

## 设计

### 范围

保留 YOLO 档（不删除能力），但在切换到 YOLO 时弹出二次确认，明确告知会关闭
死循环防护，增加摩擦。其余两档不变。

### 实现

1. `ModeSwitch` 新增本地状态 `pendingYolo`：用户点 YOLO 时，若当前非 YOLO，
   不直接 `onChange("yolo")`，而是 `setPendingYolo(true)` 弹出 `ConfirmDialog`。
2. 确认对话框复用 `@/components/ui/ConfirmDialog`，文案明确风险（关闭死循环防护），
   确认按钮使用 `bg-error`（已有样式）。
3. 确认 → `onChange("yolo")`；取消 → 关闭。从 YOLO 切回其他档无需确认。
4. 对话框 `confirmLabel` 用「我了解风险，切换到 YOLO」。

### 不做（避免过度工程）

- **不统一示例会话与实时会话布局**：`SessionPage`（示例，只读，独立 header +
  示例横幅）与 `LiveSessionPage`（实时，Topicbar + 右侧面板 tab）的布局差异是
  有意的功能差异（示例无需右侧面板交互），强行归一会给示例会话引入它不需要的
  交互，属过度归一，不做。
- 不改 SDK 的 `PermissionMode` 类型与三档映射（保留能力）。
- 不改其他两档（审核/自动）的行为。

## 验证状态

- [x] 切换到 YOLO 弹出二次确认；确认后才生效（`pendingYolo` 拦截 `onChange`）。
- [x] 从 YOLO 切回其他档无需确认（仅 `next === "yolo" && mode !== "yolo"` 时拦截）。
- [x] 取消确认时不改变档位（`onCancel` 只关闭对话框）。
- [x] `pnpm typecheck` 通过。
