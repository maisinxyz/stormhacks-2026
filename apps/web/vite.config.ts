import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// `pnpm dev:phone` = HTTPS on the LAN: phones need a secure context for camera, mic and motion sensors.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'phone' ? [basicSsl()] : [],
  server: { port: 5174, strictPort: true },
  build: { rollupOptions: { input: { main: resolve(process.cwd(), 'index.html'), camera: resolve(process.cwd(), 'camera.html') } } },
}));
