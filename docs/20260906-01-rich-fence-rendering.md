# 20260906-01 会话富围栏渲染（html / svg / echarts）

## 背景与目标

会话线程目前把 agent 回复里的 ` ```html `、` ```svg `、` ```echarts ` 等围栏一律当作普通代码块展示（仅高亮）。本方案让这些**常见富内容围栏**在聊天流中渲染为活内容：html → 沙箱 iframe 预览、svg → 可视图、echarts → 由 option JSON 驱动的图表；markdown 本体能力保持不变。四种格式与既有 ` ```a2ui `（声明式组件流）并存，互不干扰。

定位说明：这是「会话渲染格式增强」的第三步——第一步普通 markdown（现状），第二步 A2UI 组件流（docs/20260903-01，跨块状态、engine 单例），本方案为一次性、块内、纯内容渲染，无跨块状态，因此**不进 fold/runtime 引擎，不进 shared 类型**，渲染层内自洽。

范围决策：

- 接入通道：沿用文本围栏约定，新增语言集合 `html / svg / echarts`。
- 生效范围：`MarkdownViewer` **chat 变体**（会话线程 agent 消息为主；RoomsPage 会话分享摘要卡同走 chat 变体、内容同为 agent 产物，一并生效）。**document 变体**（本地 .md 文件预览）保持代码块现状，不动。relay / client / shared 类型均不改。

## 现状与关键事实

- 渲染链路：`runtime.ts` fold 出 `AgentMessageBlock.markdown`（存原始文本，A2UI 围栏已在 fold 阶段被抽取，**不会**出现在这里）→ `BlockList` agent 分支 → `AgentMessage` → `MarkdownViewer`（react-markdown + remark-gfm + hljs CodeBlock + `workbench:` 键控渲染缝）。
- 流式语义：`text.updated` 全量 upsert，每次 token 更新整条 markdown 重进 `MarkdownViewer`（现有 memo 仅到消息粒度）。a2ui 已有先例：**围栏内容按「完整可用」才露出**，未闭合一律隐藏，防中途畸形内容闪烁/泄漏。
- `workbench:<type>` 缝是「packager 门控的键控渲染」，依赖 manifest 开关；本方案走**应用内建、默认开启**的格式渲染（AgentMessage 内容不经过 packager 门控更简单直接），需要门控时可日后并入同一机制。
- 安全检查：index.html 无 CSP；本地 HTML 文件预览先例在 `FilePreviewInspector`（iframe + `sandbox="allow-scripts"`，src 指向本地文件服务器 URL）。本方案的 html 内容来自模型，需 srcdoc + 更严 sandbox，见 §4。
- 主题：`ThemeProvider` 把 resolved 主题写到 `document.documentElement.dataset.theme`（light/warm/cool/dark/black）。echarts 明暗配色依赖此值。
- 构建：electron-vite 渲染层单入口无 CSP；echarts（≈1MB min）宜**动态 import** 懒加载，不拖慢启动。file:// 下加载产物 chunk 是 electron-vite 标准路径，构建后按 §验证 抽查产物即可。
- 复制语义：`AgentMessage` 的复制按钮复制 `block.markdown`（含围栏原文），本方案不改存储与复制行为，仅改显示层。

## 设计

### 1. 围栏约定（agent → 聊天流）

回复中出现一个或多个 fenced code block，info string 精确为 `html` / `svg` / `echarts`：

````text
页面效果如下，直接可交互：

```html
<!doctype html>
<html><body><button onclick="...">点我</button></body></html>
```

```echarts
{
  "title": { "text": "近 30 日" },
  "xAxis": { "data": ["1", "2", "3"] },
  "series": [{ "type": "line", "data": [3, 7, 5] }]
}
```
````

解析规则（与 a2ui parser 同构，全部显式化）：

- 开围栏：某整行 trim 后恰为 ` ```html `（语言在启用集合内）；收围栏：整行 trim 后恰为 ` ``` `。正文内出现单独 ` ``` ` 行即提前闭合（与 markdown 语义一致）。
- 同一消息可多个围栏，按出现顺序编号、逐个独立渲染；开围栏前的正文与闭围栏后的正文按原位置保留。
- 未闭合围栏（流式中/被截断）：开围栏行到文本末尾**整体从显示文本隐藏**，不露出半截内容；`MarkdownViewer` 的 `streaming` 信号与消息结束（timestamp 落地）区分两种情况。
- 非启用语言的围栏（` ```js ` 等）完全不受影响，仍走原 CodeBlock 路径。

### 2. 纯函数解析模块 `lib/fences.ts`

```ts
export type FenceSegment =
  | { kind: 'md'; text: string }
  | { kind: 'fence'; index: number; language: string; content: string; closed: boolean };

/** 按启用语言集合切分富围栏；md 分段按原位保留围栏外的正文。无状态，每次全量重算。 */
export function splitRichFences(markdown: string, languages: readonly string[]): FenceSegment[]
```

无 DOM 依赖，Node/jsdom 均可测；不缓存（与 fold 全量 upsert 同构）。

### 3. 渲染状态机（每围栏一个）

| 状态 | 判定 | 渲染 |
| --- | --- | --- |
| 生成中 | `!closed && streaming` | 占位卡片：语言 chip + 「生成中…」脉搏动画，不显示内容 |
| 完成-有效 | `closed` 且内容校验通过 | 各格式渲染器（下表） |
| 完成-无效 | `closed` 且校验失败（svg/echarts） | 回退 CodeBlock（原样展示 + 复制） |
| 终止-未闭合 | `!closed && !streaming`（模型被截断） | 回退 CodeBlock（露出已生成部分，可复制） |

统一卡片外壳（复用既有视觉语言，同 CodeBlock/A2uiSurfaceCard 风格）：

- 头部：语言 chip（mono 大写）+ 复制按钮（复制围栏正文）+ 内容已替换提示，**不**提供「查看源码」内嵌切换（v1 从简）。
- html/svg 主体容器 `bg-white`（网页/图普遍按白底设计），echarts 用透明底随主题。

### 4. 各格式渲染器

**html → 沙箱 iframe**。`<iframe sandbox="allow-scripts" srcDoc={content}>`：无 `allow-same-origin`（opaque origin，脚本摸不到应用窗口）、无 `allow-top-navigation` /
`allow-popups` / `allow-forms` / `allow-downloads`；脚本可跑（页面要交互）、出不去。内容一律不改写（完整文档或 fragment 均可）。高度固定
`h-[420px]`，内容超高在 iframe 内滚动；不做高度自测量（opaque origin 无法读内容尺寸）。

**svg → 图片渲染**。`DOMParser` 校验（根元素为 `svg`，剥离 `<?xml?>` 序言）→ `<img src={data:image/svg+xml;charset=utf-8,…encodeURIComponent}>`。img 上下文里 SVG 内嵌脚本**不执行**（image 文档语义），无需额外净化；`<style>` 等样式正常。校验失败走 CodeBlock 回退。

**echarts → option JSON 图表**。内容为 ECharts option（严格 `JSON.parse`——不允许函数/注释，格式约定见附录）。渲染：

- `const { init } = await import('echarts')`（懒加载独立 chunk，首屏不受影响）；
- `init(container, darkTheme ? 'dark' : undefined)`（内置 dark 主题）→ `setOption(option, { notMerge: true })`；`backgroundColor` 若无则由主题兜底、外层卡片透明；
- `ResizeObserver` 随容器宽度 `chart.resize()`；卸载 `dispose()`；同一围栏内容变化（全量 upsert 回改）则重建/重设。
- 明暗判定：渲染时读 `document.documentElement.dataset.theme`；主题切换导致组件重渲染时（订阅 uiStore theme）重走 init。
- 无效 JSON → CodeBlock 回退；空 option → 同上。

### 5. MarkdownViewer 接线

`MarkdownViewer`（chat 变体）body 改造为「分段渲染」：

```text
children ──useMemo──> splitRichFences(children, ['html','svg','echarts'])
   ├─ md 分段  → <MarkdownChunk>（memo by text；内含 ReactMarkdown + workbench: 缝 + CodeBlock）
   └─ fence 分段 → <FencePreview>（§3 状态机 + §4 渲染器）
```

- `CodeBlock` 自 `MarkdownViewer.tsx` 拆出为 `components/markdown-viewer/CodeBlock.tsx`（MarkdownViewer 与 FencePreview 共用回退路径，避免循环依赖；行为、样式零改动）。
- `MarkdownChunk` memo 化后：流式 token 更新时，**首个富围栏之前的 md 段不再整段重解析**（围栏后正文仍在流的仅尾段重解析），顺带消掉一个已知浪费；无富围栏消息退化为单段全量解析，与现状一致。
- document 变体不做切分，走原单段路径，行为不变。
- a2ui 不在此列（fold 已抽取）；`workbench:` 缝在 md 段内原样保留。

### 6. 安全模型

内容全部来自模型输出（可能被提示注入诱导），默认不可信，四条防线：

1. 渲染代码全部内建于应用（如同 workbench: 缝与 a2ui 的本地 catalog 原则），不执行模型代码；
2. html 只进 `sandbox="allow-scripts"` iframe，opaque origin 且禁止导航/弹窗/表单/下载；
3. svg 只经 `<img>`（脚本不执行），不注入 DOM；
4. echarts 只解析声明式 option JSON，无求值路径。

无任何「内容 → 应用代码」通道（与 A2UI v1 同边界：不注册 action 回传）。

### 7. 依赖与文件

- `apps/desktop` dependencies 新增 `echarts`（^5.x，renderer 侧，动态 import）。
- 新增：`lib/fences.ts`（纯切分）、`components/markdown-viewer/CodeBlock.tsx`（拆出）、`components/markdown-viewer/FencePreview.tsx`（外壳 + html/svg/echarts 三渲染器）。
- 改动：`components/markdown-viewer/MarkdownViewer.tsx`（分段渲染 + 拆 CodeBlock）。
- shared / runtime / preload / IPC / relay / client：零改动。

### 8. 不做的事

- mermaid / vega / katex 等其他格式：v1 不做（mermaid 渲染库体积与错误面大，如需可经本架构加语言 + 渲染器各一文件，单独评估）。
- 代码/预览切换、iframes 高度自测、「在浏览器打开」按钮。
- packager profile 门控（`workbench:` manifest 模式）与 settings 开关。
- 非 chat 变体（md 文件预览）、历史消息的既有复制内容。

## 验证状态

### 单元测试（全部通过）

| 用例 | 结果 |
| --- | --- |
| fences：无围栏透传、单/多围栏、围栏行从 md 摘除、未闭合尾隐藏、闭合后正文露出、非启用语言不动（含其他围栏内嵌富围栏行按 markdown 无嵌套语义处理）、收围栏行提前闭合、空格缩进围栏、空行/尾换行精确性、序号稳定 | `lib/fences.test.ts` 10 用例 ✅ |
| FencePreview：html 闭合 → iframe（sandbox/srcdoc 属性断言）、svg 有效 → img data uri、xml 序言剥离、svg/echarts 无效 → CodeBlock 回退、未闭合+streaming → 占位卡、未闭合+结束 → CodeBlock、echarts 有效 → mock echarts 收到 option 且只 init 一次 | `markdown-viewer/FencePreview.test.tsx` 8 用例 ✅ |
| MarkdownViewer：chat 含 html 围栏 → iframe 且围栏原文不可见、js 围栏仍为代码块、流式中未闭合围栏隐藏并显示占位卡、document 变体围栏仍为代码块（另含既有 workbench 缝 3 例） | `markdown-viewer/MarkdownViewer.test.tsx` 7 用例 ✅ |

### 门禁与构建

1. `pnpm format` / `pnpm lint` / `pnpm typecheck` 通过（sdk/desktop/relay/client，无 warning）
2. `pnpm test`：desktop 45 文件 349 用例全过 ✅；sdk 3 例 ✅；relay 22 例 ✅
3. `pnpm md:check` 0 errors
4. `pnpm --filter @workbench/desktop build` 成功；产物抽查确认 echarts 独立 chunk
   （`index-*.js`，经 `__vitePreload(() => import(...))` 懒加载，首次图表围栏才拉取，路径相对、file:// 可加载）
5. 手动视觉验证（未执行，同 a2ui 文档第 6 条）：`pnpm dev` 会话线程内让模型输出含 §1 示例围栏的回复，
   或经 devtools 向 agent 块注入文本，观察卡片渲染、暗色主题图表配色与流式占位行为
6. 回归：普通 markdown、A2UI 卡片、workbench: 缝、md 文件预览——由既有全量用例与上方新用例覆盖

## 附录：给 packager 的模型提示词约定（非本应用代码）

在 `app-config/.opencode/agent/*.md` 说明：

> 需要展示网页、图片或图表时用 fenced code block 输出，info string 精确为 `html` / `svg` /
> `echarts`（本应用会把它们渲染成可交互预览，其余语言仍是普通代码块）。
>
> - `html`：完整或片段网页均可，脚本可在沙箱内运行，但无法访问页面外任何数据；请内联全部样式与脚本。
> - `svg`：纯 SVG 标记，自含样式；图表/示意图优先用它。
> - `echarts`：严格 JSON 的 ECharts option（不接受函数、注释、尾逗号），推荐一次性输出完整闭合内容。
