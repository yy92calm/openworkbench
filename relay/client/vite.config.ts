import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": r("./src"),
      "@workbench/sdk": r("./sdk/src/index.ts"),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});