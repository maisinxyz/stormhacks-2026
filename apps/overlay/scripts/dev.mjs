// Starts the web vite server (unless it's already up or --no-web) and then Electron on the overlay page.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import { resolve } from 'node:path';

const here = import.meta.dirname;
const webDir = resolve(here, '../../web');
const port = Number(new URL(process.env.OVERLAY_URL ?? 'http://localhost:5174').port || 5174);

const isPortOpen = () => new Promise(done => {
  const s = net.createConnection({ host: 'localhost', port, autoSelectFamily: true }); // vite may bind ::1 only
  s.once('connect', () => { s.destroy(); done(true); });
  s.once('error', () => done(false));
});

/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
let shuttingDown = false;
const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 100);
};
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

if (!process.argv.includes('--no-web') && !(await isPortOpen())) {
  // via the shell: Windows can't spawn npm.cmd directly on Node >= 20
  const web = spawn('npm run dev', { cwd: webDir, stdio: 'inherit', shell: true });
  web.on('exit', code => { if (!shuttingDown) shutdown(code ?? 0); });
  children.push(web);
}
for (let i = 0; !(await isPortOpen()); i++) {
  if (i === 120) { console.error(`[overlay] nothing listening on :${port} after 60s`); shutdown(1); }
  await new Promise(r => setTimeout(r, 500));
}

// require('electron') returns the binary path (and downloads it on first use if the install script was skipped).
const electron = createRequire(import.meta.url)('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // set by some editor terminals; it would make electron.exe behave as plain node
const app = spawn(electron, ['.'], { cwd: resolve(here, '..'), stdio: 'inherit', env });
children.push(app);
app.on('exit', code => shutdown(code ?? 0));
