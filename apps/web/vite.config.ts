import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: { port: 5174, strictPort: true },
  build: { rollupOptions: { input: { main: resolve(process.cwd(), 'index.html'), camera: resolve(process.cwd(), 'camera.html') } } },
});
