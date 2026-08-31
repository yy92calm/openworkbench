# 文件预览支持更多类型

## 设计

### 概述

当前文件预览支持 pdf、图片、html、csv/tsv、markdown、docx/xlsx/pptx 和代码文本。需要扩展支持 JSON 树形视图、音视频播放、更多代码语言高亮等。

### 当前支持类型

| 类型 | 扩展名 | 渲染方式 |
|------|--------|----------|
| HTML | .html .htm | iframe |
| PDF | .pdf | iframe（原生 PDF 查看器） |
| 图片 | .png .jpg .jpeg .gif .webp .svg | img 标签 |
| 表格 | .csv .tsv | TablePreview + TableChart |
| Markdown | .md .markdown | MarkdownViewer |
| Office | .docx .xlsx .pptx | DocxView / XlsxView / PptxView |
| 代码/文本 | 其他 | CodeViewer（语法高亮） |

### 新增类型

#### 1. JSON 树形视图

JSON 文件当前作为纯文本用 CodeViewer 展示。新增 `JsonView` 组件，支持折叠/展开节点、语法着色。

- 扩展名：`.json`
- 渲染：可折叠树形结构，key 和 value 不同颜色，数组显示长度，字符串显示首行预览
- 实现：纯 React 组件，解析 JSON 后递归渲染

#### 2. 音视频播放

音频和视频文件通过本地文件服务器提供 URL，使用 HTML5 `<audio>` / `<video>` 标签播放。

- 音频扩展名：`.mp3` `.wav` `.ogg` `.flac` `.aac` `.m4a`
- 视频扩展名：`.mp4` `.webm` `.mov` `.avi`
- 渲染：`<audio controls>` 或 `<video controls>` 标签，通过本地文件服务器 URL
- 实现：新增 `audio` 和 `video` PreviewKind，在 FilePreviewInspector 中增加对应渲染分支

#### 3. 代码语言映射扩展

`EXT_LANG` 当前仅映射了 py/r/jl/sh/tex/md。补充更多常见扩展名到语言映射，提升 CodeViewer 语法高亮覆盖。

```typescript
const EXT_LANG: Record<string, string> = {
  py: "python", r: "r", jl: "julia", sh: "bash",
  tex: "latex", md: "markdown",
  // 新增
  js: "javascript", ts: "typescript", jsx: "jsx", tsx: "tsx",
  json: "json", yaml: "yaml", yml: "yaml", xml: "xml",
  sql: "sql", css: "css", scss: "scss", html: "html",
  go: "go", rs: "rust", java: "java", c: "c", cpp: "cpp",
  toml: "toml", ini: "ini", cfg: "ini",
  log: "plaintext", txt: "plaintext",
};
```

### 模块变更

#### 1. `lib/artifacts.ts` — 扩展 PreviewKind 和语言映射

- `PreviewKind` 新增 `"json"`、`"audio"`、`"video"`
- `previewKind()` 新增对应扩展名映射
- `EXT_LANG` 补充常见语言映射
- `REF_EXTS` 新增音视频扩展名

#### 2. `components/inspector/JsonView.tsx` — 新建

- 递归渲染 JSON 树形结构
- 支持折叠/展开节点
- key 用蓝色，string 用绿色，number 用橙色，boolean/null 用灰色
- 数组显示 `[N items]` 折叠提示

#### 3. `components/inspector/FilePreviewInspector.tsx` — 扩展渲染

- `Body` 组件新增 `json` 分支：调用 `JsonView`
- `Body` 组件新增 `audio` 分支：`<audio controls>` 标签
- `Body` 组件新增 `video` 分支：`<video controls>` 标签
- `needsUrl` 增加 `audio` 和 `video` 类型

### 界面设计

#### JSON 树形视图

```text
┌──────────────────────────────────────────┐
│  ▼ {                             3 keys  │
│    name: "market-report"                  │
│    version: 2                             │
│    ▶ metrics: [3 items]                   │
│  }                                       │
└──────────────────────────────────────────┘
```

#### 音频播放器

```text
┌──────────────────────────────────────────┐
│  ▶ ───●────────────────────── 02:34      │
│  ♫ 音量                                  │
└──────────────────────────────────────────┘
```

### 实施计划

| # | 文件 | 操作 |
|---|------|------|
| 1 | `lib/artifacts.ts` | 扩展 PreviewKind、previewKind、EXT_LANG、REF_EXTS |
| 2 | `components/inspector/JsonView.tsx` | 新建 JSON 树形视图组件 |
| 3 | `components/inspector/FilePreviewInspector.tsx` | 新增 json/audio/video 渲染分支 |

## 验证状态

| 验证项 | 状态 | 备注 |
|--------|------|------|
| 方案评审 | 已通过 | — |
| 代码实现 | 已完成 | artifacts.ts + JsonView + FilePreviewInspector |
| 类型检查 | 已通过 | tsc --noEmit 无错误 |
| 单元测试 | 已通过 | 新增 7 个测试（JSON×3、audio、video、previewUrl mock）|
| Bug 修复 | 已修复 | JSON/audio/video 渲染分支原被错误嵌套在 `if (kind === "markdown")` 块内导致死代码，已提升为独立 if-return 分支 |
