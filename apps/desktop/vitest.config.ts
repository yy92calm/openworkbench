import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // jsdom defaults to about:blank, whose origin disables Storage - so
    // localStorage/sessionStorage exist as empty objects without getItem.
    // A real origin gives us a working Web Storage implementation.
    environmentOptions: {
      jsdom: { url: "http://localhost:3000/" },
    },
    setupFiles: ["./src/renderer/test/setup.ts"],
    // File-level `// @vitest-environment node` (e.g. the OpenCode integration
    // test) overrides this per file.
  },
  resolve: {
    alias: {
      // Longest paths first: "@workbench/sdk" would otherwise prefix-match
      // "@workbench/sdk/mock-server" and rewrite it to a broken path.
      "@workbench/sdk/mock-server": r("../../packages/sdk/src/mockServer.ts"),
      "@workbench/sdk": r("../../packages/sdk/src/index.ts"),
      "@workbench/shared": r("../../packages/shared/src/index.ts"),
      "@fafawork/browser-mcp/panel": r("../../packages/browser-mcp/src/renderer/BrowserPanel.tsx"),
      "@": r("./src/renderer"),
    },
  },
});
