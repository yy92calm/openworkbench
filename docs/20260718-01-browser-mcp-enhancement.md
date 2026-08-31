# 浏览器 MCP 增强方案：对话驱动右侧边栏内嵌浏览器

## 设计

### 现状

项目已有一个浏览器 MCP 服务器（`browser-mcp-server.ts`），通过 stdio JSON-RPC 暴露 5 个工具：

| 工具 | 说明 |
|------|------|
| `browser_navigate` | 导航到 URL |
| `browser_get_content` | HTTP 获取页面纯文本（非 webview 内容） |
| `browser_execute_js` | 发送脚本到浏览器执行（结果不返回） |
| `browser_get_url` | 返回空字符串（占位） |
| `browser_get_title` | 返回固定字符串"浏览器"（占位） |

**关键缺陷：**

1. **无法打开面板** — Agent 使用浏览器工具时，右侧面板不会自动打开，用户必须手动点击"浏览器"标签
2. **内容不来自 webview** — `browser_get_content` 走 HTTP 直接请求 URL，无法获取需要 JS 渲染、认证或单页应用的内容，也看不到 webview 中实际渲染的页面
3. **无交互能力** — 无法点击、输入、滚动、截图
4. **JS 执行无结果** — `browser_execute_js` 只发送脚本，结果丢失

### 目标

让 AI Agent 能通过 MCP 工具完整操作右侧边栏的内嵌浏览器，包括：

- 自动打开/关闭浏览器面板
- 导航、前进、后退、刷新
- 获取 webview 实际渲染的页面内容
- 点击元素、输入文本、滚动
- 截图获取视觉反馈
- 执行 JS 并获取返回值

### 架构

```text
Agent → MCP Server (stdio JSON-RPC)
  → HTTP API (127.0.0.1:43921, 请求-响应模式)
    → Main Process
      → IPC "browser:command" → Renderer → <webview>
      → Renderer 通过 IPC "browser:command-response" 回传结果
      → Main Process 解析 pending request
    → HTTP 响应
  → MCP Server 返回 Agent
```

**新增 IPC 通道：**

| 通道 | 方向 | 说明 |
|------|------|------|
| `browser:command` | Main → Renderer | 携带 `requestId` 的命令，支持面板控制、导航、交互 |
| `browser:command-response` | Renderer → Main | 回传执行结果，Main Process 通过 `ipcMain.handle` 处理 |
| `browser:panel` | Main → Renderer | 面板开/关指令，LiveSessionPage 监听 |

### 新增 MCP 工具

| 工具 | 参数 | 说明 |
|------|------|------|
| `browser_open` | `url?` | 打开浏览器面板，可选导航到 URL |
| `browser_close` | — | 关闭浏览器面板 |
| `browser_back` | — | 后退 |
| `browser_forward` | — | 前进 |
| `browser_refresh` | — | 刷新 |
| `browser_click` | `selector` | 点击 CSS 选择器匹配的元素 |
| `browser_click_at` | `x`, `y` | 在页面坐标点击 |
| `browser_type` | `selector`, `text` | 向输入框输入文本 |
| `browser_select` | `selector`, `value` | 选择下拉框选项 |
| `browser_hover` | `selector` | 悬停到元素上 |
| `browser_scroll` | `x?`, `y?` | 滚动页面 |
| `browser_screenshot` | — | 截取 webview 截图，返回 base64 data URL |
| `browser_get_html` | — | 获取 webview 当前页面的完整 HTML |
| `browser_wait_for_navigation` | `timeout?` | 等待页面加载完成 |

### 修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `apps/desktop/src/main/browser-mcp-server.ts` | 新增工具定义和 handler |
| `apps/desktop/src/main/ipc.ts` | 增强 `startBrowserApi`，请求-响应模式，pending 队列 |
| `apps/desktop/src/renderer/components/inspector/BrowserPanel.tsx` | 响应回传、截图、交互执行 |
| `apps/desktop/src/renderer/app/routes/LiveSessionPage.tsx` | 监听 `browser:panel` IPC 控制面板 |
| `apps/desktop/src/preload/index.ts` | 新增 `browser:command-response` invoke 通道 |

### 不需要修改的文件

- `apps/desktop/src/main/index.ts` — 已调用 `startBrowserApi()` 和 `deployBundledProfile()`
- `apps/desktop/src/main/browser.ts` — `deployBrowserProfile()` 逻辑不变
- `apps/desktop/src/main/server.ts` — 已调用 `deployBrowserProfile()`
- `apps/desktop/src/renderer/components/inspector/WorkbenchDock.tsx` — 接口不变

### 数据流示例：browser_click

```text
1. Agent 调用 browser_click({ selector: "#submit-btn" })
2. MCP Server → POST /browser/click { requestId, selector }
3. Main Process 创建 pending entry，发送 IPC → Renderer
4. Renderer 收到 browser:command { requestId, cmd: "click", selector: "#submit-btn" }
5. BrowserPanel 执行 webview.executeJavaScript(`
     document.querySelector("#submit-btn").click();
     "ok";
   `)
6. Renderer 调用 window.electronAPI.invoke("browser:command-response", requestId, "ok")
7. Main Process 解析 pending，HTTP 响应返回结果
8. MCP Server 返回 Agent
```

## 验证状态

### 验证方法

1. **构建验证**：`pnpm build` 无类型和编译错误
2. **功能验证清单**：
   - [ ] Agent 调用 `browser_open` 后右侧面板自动打开并切换到浏览器标签
   - [ ] Agent 调用 `browser_navigate` 后 webview 导航到目标 URL
   - [ ] Agent 调用 `browser_get_content` 返回 webview 实际渲染的文本内容
   - [ ] Agent 调用 `browser_screenshot` 返回 base64 截图
   - [ ] Agent 调用 `browser_click` 触发页面元素点击
   - [ ] Agent 调用 `browser_type` 在输入框中填入文本
   - [ ] Agent 调用 `browser_scroll` 页面滚动
   - [ ] Agent 调用 `browser_execute_js` 返回执行结果
   - [ ] Agent 调用 `browser_close` 关闭右侧面板
   - [ ] 所有工具调用超时处理正常（10s 超时）

### 已知限制

- `<webview>` 的 `capturePage()` 返回 NativeImage，经 `.toDataURL()` 转为 base64，截图质量为系统默认
- 点击/输入等交互基于 `document.querySelector`，不支持 Shadow DOM 穿透（默认 mode: closed 的 shadow root 不可访问）
- 跨域 iframe 内的元素无法通过 `executeJavaScript` 操作
