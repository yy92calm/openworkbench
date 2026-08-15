import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": r("./src"),
      "@workbench/sdk": r("../packages/sdk/src/index.ts"),
    },
  },
  optimizeDeps: {
    // The SDK's agent-runtime dynamically imports @anthropic-ai/claude-agent-sdk
    // (a Node-only dependency used by the Electron main process). It is never
    // needed by this browser client, but vite's dep scanner would still chase
    // it (and its Node builtins like `https`) during pre-bundling — exclude it.
    exclude: ["@anthropic-ai/claude-agent-sdk"],
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});