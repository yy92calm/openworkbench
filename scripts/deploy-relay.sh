#!/usr/bin/env bash
# 部署 relay 服务器（自包含）到公网机。
#
# 用法:
#   RELAY_AUTH_TOKEN=你的令牌 ./scripts/deploy-relay.sh [user@host] [remote-dir]
#
# 默认: root@43.133.82.137  →  /opt/workbench-relay
# 服务器需要: node >= 20, pnpm, systemd。
# 多账号: 设 RELAY_ADMIN_TOKENS="t1,t2" 启动时预置账号；部署后用管理 CLI 增删：
#   ssh root@HOST "cd /opt/workbench-relay/relay && RELAY_DATA_DIR=/opt/workbench-relay/data pnpm exec tsx src/admin.ts add --token T --note 名字"
# relay 目录自包含：管理界面源码在 relay/admin（构建产物输出到 relay/admin-web，
# 已入库），Web 客户端不在 relay 部署范围内。
set -euo pipefail

SERVER="${1:-root@43.133.82.137}"
REMOTE_DIR="${2:-/opt/workbench-relay}"
TOKEN="${RELAY_AUTH_TOKEN:?请设置 RELAY_AUTH_TOKEN 环境变量}"
ADMIN_TOKENS="${RELAY_ADMIN_TOKENS:-}"
# 管理界面密码：未设置则用服务端默认 test@123
ADMIN_PASSWORD="${RELAY_ADMIN_PASSWORD:-}"

cd "$(dirname "$0")/.."

echo "==> 构建管理界面 (relay/admin → relay/admin-web)"
(cd relay/admin && pnpm build)

echo "==> 上传 relay（源码 + admin-web 构建产物）→ $SERVER:$REMOTE_DIR"
ssh "$SERVER" "mkdir -p '$REMOTE_DIR/relay' '$REMOTE_DIR/admin-web'"
rsync -az --delete relay/ "$SERVER:$REMOTE_DIR/relay/"
rsync -az --delete relay/admin-web/ "$SERVER:$REMOTE_DIR/admin-web/"

echo "==> 服务器安装依赖"
# 全量安装：启动命令用 tsx（devDependency），--prod 会漏掉它
ssh "$SERVER" "cd '$REMOTE_DIR/relay' && pnpm install"

echo "==> 写入 systemd 单元"
ssh "$SERVER" "cat > /etc/systemd/system/workbench-relay.service <<'UNIT'
[Unit]
Description=Workbench relay server
After=network.target

[Service]
WorkingDirectory=$REMOTE_DIR/relay
Environment=RELAY_AUTH_TOKEN=$TOKEN
Environment=RELAY_PORT=12960
Environment=RELAY_DATA_DIR=$REMOTE_DIR/data
$( [ -n "$ADMIN_PASSWORD" ] && echo "Environment=RELAY_ADMIN_PASSWORD=$ADMIN_PASSWORD" )
Environment=RELAY_ADMIN_STATIC_DIR=$REMOTE_DIR/admin-web
$( [ -n "$ADMIN_TOKENS" ] && echo "Environment=RELAY_ADMIN_TOKENS=$ADMIN_TOKENS" )
ExecStart=$(which node) $(which pnpm) exec tsx src/cli.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT"

echo "==> 启动服务"
ssh "$SERVER" "systemctl daemon-reload && systemctl enable --now workbench-relay && systemctl --no-pager status workbench-relay --lines=5"

echo "==> 完成。客户端地址: http://$SERVER:12960  中继地址: ws://$SERVER:12960"
