import { cp, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const webDist = join(root, 'apps/web/dist')
const deskDist = join(root, 'apps/desk/dist')

// Vercel serves the Desk as the primary app. Play is a second Vite entry point,
// so copy its HTML and shared assets into the same static output without
// replacing Desk's index.html.
await mkdir(deskDist, { recursive: true })
for (const file of ['camera.html', 'overlay.html']) await cp(join(webDist, file), join(deskDist, file))
for (const directory of ['assets', 'bundles']) await cp(join(webDist, directory), join(deskDist, directory), { recursive: true, force: true })
