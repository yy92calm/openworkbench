# 20260815-08 · 中继管理后端：/relayadmin 路径 + 固定密码

## 需求

中继管理后端与服务同端口，独立路径 `http://<host>:8080/relayadmin`，
输入固定密码 `test@123` 后才能查看。

## 决策

- **路径**：替换 `/admin` → 仅 `/relayadmin`（旧 `/admin` 返回 404）。
- **密码**：默认固定 `test@123`；设 `RELAY_ADMIN_PASSWORD` 时可覆盖。
- **管理 API** 保持 `/api/admin/*`（登录后会话 cookie 鉴权），仅路径独立。

## 改动

| 文件 | 改动 |
| --- | --- |
| `apps/admin/vite.config.ts` | 构建 base `/admin/` → `/relayadmin/` |
| `apps/admin/dist` 产物 | asset 引用改为 `/relayadmin/assets/...` |
| `relay/src/server.ts` | 静态路由 `/admin` → `/relayadmin`；密码默认 `DEFAULT_ADMIN_PASSWORD = "test@123"` |
| `relay/src/cli.ts` | 注释更新 |
| `scripts/deploy-relay.sh` | 始终构建/上传 admin + 配 `RELAY_ADMIN_STATIC_DIR`；`RELAY_ADMIN_PASSWORD` 可选覆盖默认密码 |
| `relay/README.md` | 路径 `/relayadmin` + 默认密码说明 |
| `relay/test/relay.test.ts` | 静态测试改 `/relayadmin`；新增默认密码 test@123 用例 |

## 验证

- [x] relay 单测 22/22（新增默认密码 test@123 登录成功、错密码 401；`/relayadmin` 托管 + SPA 回退、旧 `/admin` 404）。
- [x] 真实中继 smoke test：`/relayadmin` 返回管理页、`/relayadmin/assets/*` 200、错密码 401、`test@123` 登录成功取账号列表、旧 `/admin` 404。
- [x] admin/remote build 通过、remote typecheck 0 错、relay typecheck 0 错、deploy 脚本语法 OK、E2E PASS。
