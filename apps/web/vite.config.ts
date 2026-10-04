import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

// `pnpm dev:phone` = HTTPS on the LAN: phones need a secure context for camera, mic and motion sensors.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'phone' ? [basicSsl()] : [],
  build: { rollupOptions: { input: { main: 'index.html', camera: 'camera.html' } } },
}));
