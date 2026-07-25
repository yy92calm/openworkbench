# @fafawork/browser-mcp

Electron 内嵌浏览器自动化插件，提供完整的 MCP 工具集，让 AI agent 通过对话操作侧边栏浏览器。

## 架构

```
opencode agent → MCP Server (stdio) → HTTP API (127.0.0.1:43921) → 主进程 → webview.webContents
```

主进程通过 `webContents.fromId()` 直接操作 `<webview>`，无需 IPC 中转。

## 集成方式

### 1. 安装

```bash
pnpm add @fafawork/browser-mcp
```

### 2. 主进程

```typescript
import { createBrowserMcp } from "@fafawork/browser-mcp";

const browser = createBrowserMcp({
  workspaceDir: () => "/path/to/workspace",
  port: 43921,
  logger: console,
});

app.whenReady().then(() => {
  browser.start();   // HTTP API + IPC + download handler
  browser.deploy(xdgConfigPath); // 注册 MCP server 到 opencode.json
});
```

### 3. Preload

```typescript
import { browserMcpPreload } from "@fafawork/browser-mcp/preload";
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  ...browserMcpPreload,
  on: (channel, cb) => {
    const handler = (_e, ...args) => cb(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});
```

### 4. Renderer

```tsx
import { BrowserPanel } from "@fafawork/browser-mcp/panel";

<BrowserPanel url={url} onUrlChange={setUrl} onClose={handleClose} />
```

### 5. webview 注册

当 `<webview>` 挂载时，调用 `browser:setup-webview` 注册 webContents ID：

```tsx
useEffect(() => {
  const wv = webviewRef.current;
  if (!wv) return;
  const onDidAttach = () => {
    window.electronAPI.invoke("browser:setup-webview", wv.getWebContentsId());
  };
  wv.addEventListener("did-attach", onDidAttach);
  onDidAttach();
  return () => wv.removeEventListener("did-attach", onDidAttach);
}, []);
```

## MCP 工具列表（24个）

| 类别 | 工具 |
|------|------|
| 面板 | browser_open, browser_close |
| 导航 | browser_navigate, browser_back, browser_forward, browser_refresh |
| 读取 | browser_get_content, browser_get_html, browser_get_url, browser_get_title, browser_screenshot |
| 交互 | browser_click, browser_click_at, browser_type, browser_select, browser_hover, browser_scroll |
| 文件 | browser_upload, browser_download |
| JS | browser_execute_js |
| 录制 | browser_record_save, browser_record_list, browser_record_delete, browser_replay |

## 构建产物

- `src/main/browser-mcp-server.mjs` — 独立 MCP server 脚本，被 opencode 作为子进程启动
- 构建时需要将 `.ts` 编译为 `.mjs`（ESM 格式）
