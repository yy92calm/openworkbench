# 上下文窗口精确化与 Token 展示去重

## 背景

当前界面在「上下文」方向存在三个数据可信度问题：

1. **上下文窗口硬编码**。`TokenUsage.tsx:57` 把窗口写成常量 `128_000`，而实际模型
   `huoshan/deepseek-v4-flash`（见 `app-config/.opencode/opencode.json`）的窗口可能不同。
   SDK 的 `listProviders()`（`packages/sdk/src/OpenCodeClient.ts:298`）解析 provider 时
   丢弃了 OpenCode 返回的 `limit` 字段，导致界面拿不到真实窗口。
2. **Token 信息重复展示**。`Topicbar.tsx:98` 顶部有一个 `~token` 小标签，
   `TokenUsage.tsx` 右侧面板又有一张环 + 条形图，两处用的是同一种 `chars/4` 估算，
   重复且口径不一致的风险。
3. **估算口径分散**。环、条形图、顶部标签各自计算，没有统一来源。

## 设计

### 范围

只做「数据可信度」修正，不改面板结构（结构重构属于方向 A）。具体三件事：

1. **SDK 读取真实上下文窗口**：扩展 `listProviders()` 的响应解析，保留 OpenCode model
   对象上的 `limit.context` 字段；在 `ProviderModelInfo` 增加 `contextLimit?: number`。
2. **窗口值随当前模型动态确定**：`TokenUsage` 不再写死常量，改用「当前模型对应窗口 →
   保守默认（128k）」的回退链。抽取一个共享的窗口解析函数。
3. **去重**：删除 `Topicbar.tsx` 顶部重复的 `~token` 标签（窗口环已在右侧面板呈现完整
   信息）。保留 Topicbar 的连接状态点与标题。

### 不做

- 不引入真实 tokenizer（工作量大，且本次目标是不展示误导性数据，不是精确计费）。
- 不改 `ContextPanel` 面板分区结构（方向 A 处理）。
- 不动 `ModeSwitch`、示例会话布局（方向 D 处理）。

## 验证状态

- [x] `listProviders()` 解析出的 model 含 `contextLimit` 字段（类型 + 解析）。
- [x] `TokenUsage` 在无窗口信息时回退到保守默认，有信息时使用真实值。
- [x] `Topicbar` 不再展示重复的 `~token` 标签。
- [x] 现有用例（`TokenUsage` 相关）通过；新增窗口解析逻辑有单测。
- [x] `pnpm typecheck` 通过；node 环境单测（`opencode-client.node.test.ts`）9/9 通过。

> 说明：renderer 组件测试因 jsdom 环境未加载（`document is not defined`）在改动前
> 即已失败，属既有问题，与本次改动无关，不在范围内。
