# 20260923-03 · 宏观洞察顶部：少字 + 行业标签（CEO 视图）

## 背景与需求

用户反馈：**顶部不需要太多字，按行业显示就行**。经确认：

1. 去掉定位语（「轮动模型回答…数据 → 信号 → …」长句）；
2. 结论从句子改为「超配 / 低配」**行业标签**两行（chip）；
3. KPI 保留但**去掉副文案**；
4. 标签口径用**中证十行业**（与轮动模型一致）。

## 现状（代码核对）

顶部依次为：标题 + 徽标 → 定位语（11px 两行长句）→ 结论句
（「建议超配：…；建议低配：…」）→ 变化句 → 5 格 KPI（每格 label + value +
sub 三层文字）。文字密度对 CEO 偏高。

## 设计

1. **shared 纯函数 `buildMacroSignalView(snapshot)`**：返回
   - `over` / `under`：超配、低配行业名单（评分降序、全量不截断）；
   - `change`：`较上一交易日：X 走强、Y 走弱。`（无变化为 null）。
   `buildMacroConclusion`（导出汇报用的句子）改为基于该视图组装，行为不变
   （既有测试原样通过）。
2. **页面顶部**：
   - 删除定位语；徽标已承载定位（「AI 投研系统 · 轮动模型 × 行业模型」）；
   - 两行标签：`[超配] 中证信息 中证电子 …` / `[低配] 中证金融 …`
     （信号色 pill + 中性 chip；无信号显示「暂无」）；
   - 变化保持一行 11px muted（无则省略）；
   - KPI 5 格保留，`Kpi` 组件移除 `sub` 层（归因率在台账统计行、刷新中在
     标题行、知识资产路径在简报区，均不丢失）。
3. 导出 / 复制 / 打印仍用完整句子与 KPI 表（`buildMacroReportMarkdown`），
   不受顶部展示变化影响。

## 文件清单

| 文件 | 动作 |
| --- | --- |
| `packages/shared/src/{macro,index}.ts` | `MacroSignalView` + `buildMacroSignalView`；`buildMacroConclusion` 复用 |
| `renderer/lib/macroPrompts.test.ts` | 视图函数 2 例（名单 / 变化 / 空数据） |
| `renderer/app/routes/MacroInsightsPage.tsx` | 去定位语、标签行、KPI 去 sub、清理无用变量 |
| `CHANGELOG.md`、`docs/architecture/{03,05}`、本文档 | 同步 |

## 验证状态

方案阶段（2026-09-23）：

- [x] 现状与口径确认（去定位语、标签行、KPI 去副文案、中证口径）。

实施（2026-09-23）：

- [x] `buildMacroSignalView` 落地（`buildMacroConclusion` 改为复用，原断言
      不变）；单测 28 例通过（新增 2 例）。
- [x] 顶部改造：定位语删除；超配 / 低配标签两行；变化一行；KPI 去 sub；
      无用变量清理。
- [x] 门禁：desktop 55 文件 / 498 用例全绿；lint / format:check / md:check
      全绿；build 通过；web 基线 46、node 基线 8 不变。
- [ ] GUI 人工冒烟：顶部两行标签与计数、变化行、KPI 五格无副文案。

## 风险与边界

- 文字减少但信息不丢：名单在标签、计数在「轮动信号」KPI、变化一行保留、
  导出报告仍是完整句子 + KPI 表；
- 标签口径为中证十行业（评分模型）；申万一级全景仍在独立区块展示。
