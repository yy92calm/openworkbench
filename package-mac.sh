#!/usr/bin/env bash
# Workbench macOS 打包脚本
# 流程: 清理依赖与产物 -> 重装依赖 -> 准备 sidecar -> 类型检查 -> 构建 -> 打包
# 用法: ./package-mac.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

step() { printf "\n[%s] %s\n" "$1" "$2"; }
note() { printf "  %s\n" "$1"; }

step "1/6" "清理依赖与构建产物"
# 删除所有 node_modules（根 + 各 workspace 包，含 pnpm 虚拟存储 .pnpm）
find . -name node_modules -type d -prune -exec rm -rf {} + 2>/dev/null || true
# 删除构建产物与上一次的打包输出，避免增量残留
rm -rf apps/desktop/out apps/desktop/release
rm -rf packages/*/dist
note "已清理 node_modules / out / release / dist"

step "2/6" "重新安装依赖"
pnpm install
# relay / client 是独立 workspace（有自己的 lockfile），主 pnpm install 不覆盖；
# 清理步骤删除了它们的 node_modules，typecheck 需要它们就位。
(cd relay && pnpm install)
(cd client && pnpm install)
note "依赖安装完成"

step "3/6" "准备 OpenCode sidecar"
if [ -x "apps/desktop/binaries/opencode" ]; then
  note "sidecar 已存在，跳过下载"
else
  bash scripts/dev/fetch-opencode.sh
  note "sidecar 下载完成"
fi

step "4/6" "类型检查"
pnpm typecheck
note "类型检查通过"

step "5/6" "构建应用"
pnpm build
note "构建完成"

step "6/6" "打包 macOS 安装包"
pnpm --filter @workbench/desktop package:mac

# 清除 macOS 隔离属性，否则捆绑的 sidecar 二进制无法执行
APP_PATH="apps/desktop/release/mac-arm64/Workbench.app"
[ -d "$APP_PATH" ] || APP_PATH="apps/desktop/release/mac/Workbench.app"
if [ -d "$APP_PATH" ]; then
  xattr -cr "$APP_PATH" 2>/dev/null || true
  note "已清除隔离属性: $APP_PATH"
else
  note "未找到 .app，请手动执行: xattr -cr <path-to-Workbench.app>"
fi

step "完成" "macOS 打包结束"
echo "输出目录: apps/desktop/release/"
ls -lh apps/desktop/release/ 2>/dev/null || true
