# Workbench relay — 部署与使用

简体中文。中继服务器 + 远程客户端让手机/另一台电脑经公网连接桌面端 Workbench。

## 账号模型

- **令牌即账号**：每个用户/每个使用方持有一个**账号令牌**（token），由管理员通过
  管理 CLI 创建并分发。中继按令牌区分账号。
- **设备注册**：桌面端以 `?role=host&device=<deviceId>&token=<账号令牌>` 连接时，
  该 `deviceId` 自动注册到该账号名下（幂等）。桌面端的 deviceId 持久化在本机，
  **版本升级不变**。
- **客户端登录**：客户端先只填令牌 → 拉取该账号已注册的设备列表（**带在线/离线标记，
  在线设备排在前面**）→ 选择一台设备 → 建立配对。不同账号即使使用相同的 deviceId 也互不串扰（路由按「账号|设备」复合键）。

## 架构

```
公网机 (relay-server: WS 转发 + 账号注册 + 静态托管 Web 客户端)
   ▲ 出站 WS            ▲ 浏览器 / Electron
桌面端 Workbench    手机 / 电脑 (Web App 或 Electron 壳)
```

- 桌面端与客户端都**主动出站**连接中继，无需开放本机端口、无需 NAT 配置。
- 中继是纯内存转发：不落盘请求内容，只持久化账号注册表（token → 设备列表）。
- API key 只存在于桌面端本机（sidecar 持有），客户端操作经桌面端执行，密钥不经过中继。

## 一、部署中继到公网机

```bash
RELAY_AUTH_TOKEN=你的强随机令牌 ./scripts/deploy-relay.sh root@43.133.82.137
```

脚本会：构建 Web 客户端 → 上传 relay 源码与构建产物 → 安装依赖 →
写入并启动 systemd 服务（`workbench-relay`，端口 8080）。

> 单一账号模式：`RELAY_AUTH_TOKEN` 本身就是第一个账号的令牌（向后兼容）。
> 多账号模式：在服务端用管理 CLI 添加更多账号（见下）。

服务器要求：node >= 20、pnpm、systemd。如你的服务器有防火墙，放行 8080/tcp。

### 账号管理（多账号）

先给 systemd 单元配置 `RELAY_DATA_DIR`（账号注册表的持久化目录）与
`RELAY_ADMIN_STATIC_DIR`（管理界面构建产物目录）。管理界面密码固定为
`test@123`，如需覆盖可设 `RELAY_ADMIN_PASSWORD`：

```ini
# /etc/systemd/system/workbench-relay.service
Environment=RELAY_DATA_DIR=/opt/workbench-relay/data
Environment=RELAY_ADMIN_PASSWORD=test@123        # 可选，默认 test@123
Environment=RELAY_ADMIN_STATIC_DIR=/opt/workbench-relay/admin-web
```

重启服务后：
- **管理界面**（推荐）：浏览器打开 `http://<中继>:8080/relayadmin`，输入
  密码（默认 `test@123`）登录后可可视化管理账号令牌、查看各账号设备及其
  在线状态、新增/删除账号与设备。
- **管理 CLI**：增删账号同样可通过 CLI（与运行中的中继共用同一账号文件）：

```bash
cd /opt/workbench-relay/relay
# 添加账号（token 即用户的登录凭证）
RELAY_DATA_DIR=/opt/workbench-relay/data pnpm exec tsx src/admin.ts add --token <新账号令牌> --note "用户名或备注"
# 查看所有账号及其已注册设备数量
RELAY_DATA_DIR=/opt/workbench-relay/data pnpm exec tsx src/admin.ts list
# 删除账号（同时删除其设备列表）
RELAY_DATA_DIR=/opt/workbench-relay/data pnpm exec tsx src/admin.ts remove --token <令牌>
```

也可以在 systemd 单元里用 `RELAY_ADMIN_TOKENS`（逗号分隔）在启动时预置账号。

## 二、桌面端开启远程访问

设置 → 远程访问：
1. 中继地址填 `ws://43.133.82.137:8080`
2. 设备 ID 自动生成（升级不变，会出现在客户端的设备列表里）
3. 账号令牌：填入你**自己的账号令牌**（不是共享值）
4. 点击「保存并连接」，状态变为「已连接」——设备随即注册到该账号下

## 三、客户端连接

- **手机 / 电脑浏览器**：打开 `http://43.133.82.137:8080` → 填入中继地址 + 账号令牌 →
  「登录并查看设备」→ 选中一台设备 → 连接。可「添加到主屏幕」获得 App 体验。
- **Electron 壳**（可选）：
  ```bash
  cd apps/remote/electron && pnpm install && pnpm start
  ```
  自签证书的 wss 中继需显式开启：
  ```bash
  RELAY_ALLOW_SELF_SIGNED=1 pnpm start
  ```

## 四、TLS（可选，推荐）

有域名 + 证书后，给中继启用 https/wss（客户端地址改为 `https://...`，
连接地址改 `wss://...`）：

```ini
# /etc/systemd/system/workbench-relay.service
Environment=RELAY_TLS_CERT=/etc/ssl/fullchain.pem
Environment=RELAY_TLS_KEY=/etc/ssl/privkey.pem
```

无域名时，Electron 壳可配合自签证书走加密通道（见上）。

## 五、开发与测试

```bash
# relay 包单测（协议/转发/账号鉴权/设备注册/持久化/静态托管）
pnpm --filter @workbench/relay test

# 本机端到端：relay + mock sidecar + OpenCodeClient（见仓库根 relay/）
cd relay && pnpm tsx e2e-account.mjs   # 已由 vitest 覆盖

# 本地起中继（开发）
RELAY_AUTH_TOKEN=dev pnpm --filter @workbench/relay serve
```

## 安全边界

- 中继只在**账号注册表里有该令牌**时接受连接（错误令牌在握手阶段即被拒绝）。
- guest 只能配对**自己账号**下注册过的设备；不同账号即使 deviceId 相同也隔离。
- 桌面端转发时注入本机 sidecar 密码，客户端永远不知道它。
- 未配 TLS 时公网段为明文，会话内容可被网络中间人看到——生产使用请配置 TLS。