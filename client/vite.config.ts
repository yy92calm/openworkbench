import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': r('./src'),
      '@workbench/sdk': r('./sdk/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
