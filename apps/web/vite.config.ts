import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Server (apps/server, :3001) routes proxied so pages like overlay.html can use same-origin relative URLs.
// SSE (/agent/runs/:id/events, /notifications/stream) streams through http-proxy unbuffered.
const API = process.env.FETCH_API ?? 'http://localhost:3001';
const proxy = Object.fromEntries(['/session', '/agent', '/pets', '/assets', '/uploads', '/gen', '/voice', '/mode', '/notifications', '/auth', '/connectors']
  .map(p => [p, { target: API, changeOrigin: false }]));

// `pnpm dev:phone` = HTTPS on the LAN: phones need a secure context for camera, mic and motion sensors.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'phone' ? [basicSsl()] : [],
  server: { port: 5174, strictPort: true, proxy },
  build: { rollupOptions: { input: {
    main: resolve(process.cwd(), 'index.html'),
    camera: resolve(process.cwd(), 'camera.html'),
    overlay: resolve(process.cwd(), 'overlay.html'),
  } } },
}));
