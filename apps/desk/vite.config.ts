import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev proxy: the desk calls the Fetch server (apps/server, :3001) with relative URLs. http-proxy pipes responses
// unbuffered, so SSE (/agent/runs/:id/events) streams. The browser Origin (localhost:5173) is kept; the server allows it.
const SERVER = process.env.FETCH_SERVER_URL ?? 'http://localhost:3001'
const routes = ['/session', '/agent', '/pets', '/assets', '/uploads', '/gen', '/voice', '/mode', '/notifications', '/auth', '/connectors', '/health']

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: Object.fromEntries(routes.map((route) => [route, { target: SERVER }])) },
})
