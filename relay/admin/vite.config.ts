import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The admin UI is served from the relay at /relayadmin/. Build with a base path
// so asset URLs are absolute under that prefix.
export default defineConfig({
  plugins: [react()],
  base: "/relayadmin/",
  resolve: {
    alias: {
      "@": r("./src"),
    },
  },
  build: {
    outDir: "../admin-web",
    sourcemap: false,
  },
});