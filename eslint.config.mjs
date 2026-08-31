// ESLint 9 flat config（全仓统一门禁）。
//
// 动机说明（配置即文档，仿 openai/codex 的 .bazelrc 风格）：
// - 配置放仓库根：relay / client 虽是独立 workspace（自持 node_modules），
//   eslint 按目录向上查找配置，从根跑 `eslint .` 即可覆盖全仓，无需改动其 workspace。
// - simple-import-sort：统一 import 顺序（内置分组：node 内置 / 第三方 / 相对路径），
//   此前 import 排序靠人工，无自动化约束。
// - @typescript-eslint/no-unused-vars 为 warn（非 error）：对齐 desktop 旧配置行为，
//   避免一次升级引入大量行为突变。
// - react-hooks / react-refresh 按文件类型应用：desktop 与 client 均为 React 应用，
//   packages/browser-mcp 含 React 组件，统一覆盖。

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      '**/coverage/**',
      // 构建产物（与 .gitignore 保持一致）：electron-builder 输出、vite 一次性散列产物。
      // relay/admin-web 入库是部署需要（服务端静态托管），但无需 lint。
      '**/release/**',
      'apps/desktop/*-*.js',
      'apps/desktop/*-*.css',
      'relay/admin-web/**',
      '**/*.d.ts',
      '.devcontainer/**',
      '.github/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // JS 脚本（.mjs / .cjs）运行于 Node：提供 Node 全局，避免 no-undef 误报。
    // TS 文件的 no-undef 由 typescript-eslint 关闭（TS 编译器负责类型与全局检查）。
    files: ['**/*.mjs', '**/*.cjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // react-hooks 规则（rules-of-hooks error / exhaustive-deps warn 与旧配置一致）。
    // react-refresh 的 only-export-components 不启用：旧配置未开启该规则，且仓库
    // 组件文件混合导出常量/工具函数是既有风格，启用只会产生噪音。
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
);
