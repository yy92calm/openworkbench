# 隐私文案更新 + 侧边栏图标与标题

## 背景

1. **隐私文案过时**：`DataFlowCard` 文案未反映当前项目能力——只提 Python kernel + Jupyter，漏了终端、Python/R 内核、定时任务、浏览器 MCP 抓取等，与实际数据流向不符。
2. **侧边栏图标偏小、缺项目名**：logo `h-[14px]`、导航图标 `size={14}`、设置图标 `size={13}` 偏小；顶部仅有 logo 无文字，辨识度低。

## 设计

### 1. 隐私文案更新（i18n `settings.dataFlow.*`）

| 词条 | 更新点 |
|------|--------|
| `local2` | 「Python kernel + Jupyter」-> 「Python/R 内核 + 终端 shell」 |
| `local3` | 加入「定时任务记录」 |
| `sent2` | 说明定时任务触发的轮次也会发送 |
| `footnote` | 点名「网页抓取」等 MCP 可能自行联网 |

其余词条（`local1`/`local4`/`sent1`/`sent3`/标题）不变。

### 2. 侧边栏（`Sidebar.tsx`）

- logo `h-[14px]` -> `h-[18px]`，旁加 `Workbench` 文字标题（`font-serif`）。
- 导航图标 `size={14}` -> `size={16}`（Plus / CalendarClock / FolderTree）。
- 设置图标 `size={13}` -> `size={16}`。
- 折叠按钮 `size={14}` -> `size={16}`（PanelLeft / PanelLeftClose）。
- 历史搜索按钮 `size={11}` -> `size={13}`（X / Search）。

### 不做

- 不改侧边栏布局结构、导航项数量。
- 不改 `DataFlowCard` 组件结构（仅文案）。
- 不动态读取渠道名，`Workbench` 文字硬编码（与 README 品牌名一致）。

## 验证状态

- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 199/199 不回归。
- [x] `pnpm lint` 改动文件 0 error（`Sidebar.tsx` 的 `rows` useMemo warning 为既存问题，与本次无关）。
- [ ] 隐私文案提及终端 / 定时任务 / MCP 抓取。（待人工验证）
- [ ] 侧边栏 logo 旁显示 Workbench，图标更大更清晰。（待人工验证）
