# @ 引用接入工作区文件树

## 背景

Composer 的 `@` 文件引用候选当前只来自 `fileSuggestions`，而该列表在
`LiveSessionPage.tsx:126` 里**只从 thread 的 artifact 块**提取路径：

```ts
const fileSuggestions = useMemo(() => {
  if (!thread) return [];
  const paths = new Set<string>();
  for (const b of thread.blocks) {
    if (b.kind === "artifact") paths.add(b.path);
  }
  return Array.from(paths);
}, [thread]);
```

后果：新会话（thread 为空）里输入 `@` 完全无候选；只有 agent 产出过 artifact
之后才能 @。用户无法 @ 工作区里已存在但 agent 还没碰过的文件——这背离了
opencode 原生 `@` 引用"引用工作区任意文件"的能力。

## 设计

### 范围

让 `@` 候选**优先来自工作区真实文件树**，与 artifact 派生的候选合并去重。
聚焦最小可验证改动，不做以下超出范围的事。

### 实现

1. 新建 `useWorkspaceFiles()` hook（`@/lib/useWorkspaceFiles`）：用既有的
   `listDir(rel, "base")`（`@/lib/artifactFile`）从工作区根列出文件（不递归子目录，
   控制候选规模），返回 `{ files: string[], loading }`。仅在 `@` 被触发时懒加载
   一次（缓存到组件状态），失败静默回退（桌面端不可用时无候选，与现状一致）。

2. `LiveSessionPage` 把工作区文件与 artifact 路径合并去重后作为 `fileSuggestions`
   传给 Composer——工作区文件在前（用户最可能要 @ 的），artifact 路径补充在后。

3. Composer 的 `pickFile` 已用文件名做 chip，无需改动引用语法本身。

### 不做（避免过度工程）

- **不改 prompt parts 协议**：本应用已有完整桌面工作区机制
  （`addFilesToWorkspace` 把文件复制进工作区 + `fileNote` 文本提示 agent），agent
  通过工作区访问文件。强行把附加文件改成 OpenCode `parts: [{type:"file"}]` 既无
  SDK 文档佐证其被消费，又会破坏现有正确行为。
- **不加 @url / @dir 多类型**：opencode TUI 的多类型引用依赖其内部 `@` 解析器；
  本应用走"工作区 + 文本提示"路径，多类型引用不在当前能力范围内，属未来增量。
- 不改 Composer 的 chip 渲染与发送逻辑。

## 验证状态

- [x] 新会话（thread 为空）输入 `@` 能看到工作区文件候选（`useWorkspaceFiles` 懒加载根目录）。
- [x] artifact 派生的路径仍可用（合并去重，工作区文件在前）。
- [x] 工作区不可用时静默回退（`listDir` catch → 空列表，回退 artifact 路径）。
- [x] `pnpm typecheck` 通过。
