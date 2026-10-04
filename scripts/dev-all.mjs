import { spawn } from 'node:child_process'
import net from 'node:net'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const apps = [
  { name: 'Play', port: 5174, cwd: resolve(root, 'apps/web') },
  { name: 'Desk', port: 5173, cwd: resolve(root, 'apps/desk') },
]

const isPortOpen = (port) => new Promise((resolvePort) => {
  const socket = net.createConnection({ host: '127.0.0.1', port })
  socket.once('connect', () => { socket.destroy(); resolvePort(true) })
  socket.once('error', () => resolvePort(false))
})

const children = []
for (const app of apps) {
  if (await isPortOpen(app.port)) {
    console.log(`${app.name} is already running on http://localhost:${app.port}; reusing it.`)
    continue
  }
  children.push(spawn(npm, ['run', 'dev'], { cwd: app.cwd, stdio: 'inherit', shell: process.platform === 'win32' })) // shell: Node 24 on Windows refuses to spawn .cmd directly (EINVAL)
}

let shuttingDown = false
const shutdown = (code = 0) => {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 100)
}

for (const child of children) child.on('exit', (code) => { if (!shuttingDown && code) shutdown(code) })
process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())
