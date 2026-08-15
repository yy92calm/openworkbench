# 打包产物不进入 git

日期：2026-08-15

## 背景

用户要求打包生成的 JS 不放入 git。现状核查结果：

- git 已追踪的 JS 文件均为源码/配置文件（`tailwind.config.js`、`postcss.config.js`、
  `.eslintrc.cjs`、`scripts/*.mjs`、`packages/scheduler/src/main/mcp-server.mjs`），
  无任何打包产物被追踪。
- 标准构建输出目录已被 `.gitignore` 覆盖：`dist/`、`apps/desktop/out/`、
  `apps/desktop/release/`、sidecar 二进制目录。
- 隐患：`apps/desktop/index-DBS5go2H.js`（3.4MB，Vite 构建的哈希命名 bundle）
  散落在 `apps/desktop/` 根目录，未被任何 `.gitignore` 规则覆盖，
  也没有任何源码引用它；`git add .` 会将其误提交。
  同类产物还包括 `*-*.js` / `*-*.css` 形式的哈希命名 chunk
  （如 `docx-preview-*.js`、`xlsx-*.js`）。

## 设计

只改 `.gitignore`，新增一条规则覆盖 `apps/desktop/` 根目录下的哈希命名构建产物：

```gitignore
# Stray hashed build artifacts from one-off vite builds (e.g. index-*.js, xlsx-*.css)
apps/desktop/*-*.js
apps/desktop/*-*.css
```

模式选择理由：

- `*-*.js` 只匹配「文件名含连字符」的哈希产物，不会误伤
  `tailwind.config.js`、`postcss.config.js` 等已追踪/合法文件（它们无连字符）。
- 不动现有目录级规则（`dist/`、`out/`、`release/`），改动最小。

散落的 `index-DBS5go2H.js` 文件本身：确认无源码引用后由用户决定是否删除，
本次仅保证它不会进入 git。

## 验证状态

- [x] `git check-ignore -v apps/desktop/index-DBS5go2H.js` 命中新规则
- [x] `git status` 中该文件不再显示为未追踪
- [x] 已追踪文件不受影响（gitignore 对已追踪文件无效，且模式本身不匹配合法文件）
