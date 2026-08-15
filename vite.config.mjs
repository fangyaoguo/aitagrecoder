import { defineConfig } from 'vite';
import path from 'node:path';

const root = import.meta.dirname;

// 渲染进程构建:src/renderer -> dist/renderer
export default defineConfig({
  root: path.resolve(root, 'src/renderer'),
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(root, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome120',
    minify: 'esbuild',
  },
});
