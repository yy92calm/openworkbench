# 20260923-02 · 宏观洞察数据源异常修复（网络层）

## 背景与需求

用户反馈页面底部出现：`部分数据源异常：indices: fetch failed；fx: fetch
failed；industries: 行业指数解析为空；sw: fetch failed`。需要定位并修复。

## 诊断（实测证据）

| # | 现象 | 证据 | 结论 |
| --- | --- | --- | --- |
| 1 | `sw: fetch failed`（Node fetch：`UNABLE_TO_VERIFY_LEAF_SIGNATURE`） | `openssl s_client` 显示申万官网**只发 leaf 证书**（`Verify return code 21`），浏览器/Chromium 走 AIA 自动补链，Node 的 fetch 直接拒绝 | **真 bug**：改用 Electron `net.fetch`（Chromium 网络栈，系统代理 + AIA 补链） |
| 2 | `indices / fx: fetch failed`，`industries: 行业指数解析为空` | `curl` 对 `push2.eastmoney.com` 三连测：200 → 200 → `Empty reply from server`；`push2his`、`datacenter-web` 正常；`ulist` 正常、`clist` 6/6 空回复 | **间歇性丢连接**（网络路径/服务端）：加自动重试；`clist`（板块列表）为端点级封锁，见 #3 |
| 3 | 板块列表（`clist/get`）持续性空回复 | `curl` 与 Electron `net.fetch` 各 3 次全部 `ERR_EMPTY_RESPONSE`；改编码 / 排序 / 备用主机（delay）均失败；而 `ulist`、`kline` 正常 | 端点级封锁（疑似出口 IP 被 WAF 拦）；应用侧只能**显式提示**并等待恢复，或后续换源 |
| 4 | 报错信息只有 `fetch failed` | undici 把原因放在 `err.cause`（如 `UND_ERR_SOCKET`），原实现只取 `err.message` | 增强错误信息（带底层原因），页面一眼能判断是网络还是解析问题 |

## 设计

1. **网络层切换**（`main/macro.ts`）：
   - `rawFetch`：Electron 内用 `net.fetch`（Chromium 栈：系统代理、证书链补全、
     与浏览器一致），非 Electron 环境回退全局 `fetch`；
   - `fetchText`：瞬时失败**自动重试**（默认 3 次、500ms/1000ms 退避），
     HTTP 状态错误不重试；申万分析大响应（约 1MB）最多 2 次以限制时延；
   - `fetchErrorText`：错误信息附带 `cause`（code/message），例如
     `fetch failed：other side closed (UND_ERR_SOCKET)`。
2. **界面提示**（`MacroInsightsPage`）：板块列表为空且 `industries` 已就绪时，
   行业模型区显示「板块列表数据源暂不可用（东财板块接口异常）；行情与轮动
   数据不受影响，稍后自动重试」，不再停留在「加载中」。

## 验证状态

诊断（2026-09-23）：

- [x] 缓存快照与逐源状态核对（4 个失败源 + 成功源对比）。
- [x] 证书链、DNS（Clash fake-IP）、push2 三连测、clist 变体与备用主机、
      Electron `net.fetch` 探针（8 组）全部实测。

实施（2026-09-23）：

- [x] `net.fetch` + 重试 + 错误信息增强落地；
- [x] dev 通道实跑验证：**7/7 数据源 ready**（含 `sw` 31 个行业、轮动 10、
      指数 9、K线 2）——申万与行情类全部恢复；
- [x] 板块列表（`clist`）当前仍被封锁 → 界面显式提示；待出口恢复后自动
      装载（重试已就位）。
- [ ] GUI 人工冒烟：恢复后热力图自动出现；未恢复时提示文案准确。

## 风险与边界

- 板块列表依赖东财 `clist` 端点：若出口 IP 持续被拦，需要换网络/节点，或
  后续评估备用板块源（记录为待办）；
- `net.fetch` 与浏览器同栈：会遵循系统代理（本环境为 Clash），对国内直连
  场景与之前一致（不额外引入代理依赖）；
- 重试只针对网络类失败；HTTP 4xx/5xx 不重试，避免放大对端压力。
