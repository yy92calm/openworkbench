# 设置页两项优化

## 背景

重新设计后的设置页有两处待优化：

1. **展开折叠开关位置不当**：「默认展开思考与工具」开关当前在「通用 > 外观」卡片，但它属于 agent 输出显示偏好，放在「运行时」分组更贴合语义。
2. **隐私卡片不友好**：「隐私与数据」分组接入的 `DataFlowCard` 文案全英文硬编码，且表述偏技术化（provenance records、content-addressed、owner-only），对中文用户不友好。

## 设计

### 1. 展开折叠开关移至运行时分组

- 从「通用 > 外观」卡片移除展开折叠开关，外观卡片只保留主题（light / dark / system）。
- 在「运行时」分组末尾新增「对话显示」卡片，放置展开折叠开关（复用既有 `settings.expandDetails` / `expandDetailsHint` 词条，新增 `settings.display` / `settings.displayHint` 两个标题词条）。

### 2. DataFlowCard 重构

- 全部文案走 `useI18n` + `t()`，补齐中英词条（`settings.dataFlow.*`）。
- 文案友好化：短句、口语、安心感；去掉 provenance records / content-addressed / owner-only 等术语，改为「可追溯记录」「仅你可读的文件」等说法。
- 保留两栏结构（本机 / 发送）与图标；保留关键英文短语 `Stays on this machine` / `Sent to your model provider` / `no model configured` 以最小化测试改动。
- 卡片标题改为「数据流向」，与分组标题「隐私与数据」区分。
- `workspace` 仍就地拼接到本机首项末尾（不走插值）。

### 不做

- 不改两栏布局结构。
- 不改 `DataFlowCard` 接收的 props（`model`、`workspace`）。
- 不改其他分组。

## 验证状态

- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 199/199 不回归（同步更新 `DataFlowCard.test.tsx` 用 `I18nProvider` 包裹）。
- [x] `pnpm lint` 改动文件 0 error。
- [x] 展开折叠开关出现在「运行时 > 对话显示」，「通用 > 外观」不再有。
- [ ] 隐私卡片中英文切换正确，文案友好。（待人工验证）
