import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@workbench/sdk", "@workbench/shared", "@fafawork/browser-mcp"] })],
    resolve: {
      alias: {
        "@fafawork/browser-mcp/mcp-server": r("../../packages/browser-mcp/src/main/browser-mcp-server.ts"),
        "@fafawork/browser-mcp/preload": r("../../packages/browser-mcp/src/preload.ts"),
        "@fafawork/browser-mcp": r("../../packages/browser-mcp/src/main/index.ts"),
      },
    },
    build: {
      rollupOptions: {
        external: ["electron-store", "electron-log", "electron-updater", "electron-context-menu", "electron-window-state", "@anthropic-ai/claude-agent-sdk", "node-pty"],
        input: {
          index: r("./src/main/index.ts"),
          "browser-mcp-server": r("./src/main/browser-mcp-server.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@fafawork/browser-mcp"] })],
    resolve: {
      alias: {
        "@fafawork/browser-mcp/preload": r("../../packages/browser-mcp/src/preload.ts"),
      },
    },
  },
  renderer: {
    root: r("./src/renderer"),
    plugins: [react()],
    resolve: {
      alias: {
        "@": r("./src/renderer"),
        "@workbench/shared": r("../../packages/shared/src/index.ts"),
        "@workbench/sdk": r("../../packages/sdk/src/index.ts"),
        "@workbench/sdk/mock-server": r("../../packages/sdk/src/mockServer.ts"),
        "@fafawork/browser-mcp/panel": r("../../packages/browser-mcp/src/renderer/BrowserPanel.tsx"),
      },
    },
    build: {
      rollupOptions: {
        input: r("./src/renderer/index.html"),
      },
    },
  },
});
