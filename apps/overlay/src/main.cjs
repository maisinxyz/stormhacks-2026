// @ts-check
// Fetch desktop overlay: a transparent, click-through, always-on-top window over the primary display
// that hosts apps/web/overlay.html (the real splat pet). The page tells us when the cursor is over
// the pet or its own UI (setInteractive) so everything else on screen stays usable.
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, net, protocol, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DEV_URL = process.env.OVERLAY_URL || 'http://localhost:5174/overlay.html';
const PROD = app.isPackaged || process.env.OVERLAY_PROD === '1';
const API_BASE = process.env.FETCH_API || 'http://localhost:3001';
const DESK_URL = process.env.DESK_URL || 'http://localhost:5173';
const WEB_DIST = process.env.OVERLAY_DIST || path.resolve(__dirname, '../../web/dist');
// Server routes the page calls with same-origin relative URLs (mirrors the vite dev proxy).
const API_PREFIXES = ['/session', '/agent', '/pets', '/assets', '/uploads', '/gen', '/voice', '/mode', '/notifications', '/auth', '/connectors'];

// Production: serve the built web app from app://overlay/ and proxy API routes to the server,
// so the page's absolute paths (/assets, /bundles) and relative API calls work exactly like in dev.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

/** @type {BrowserWindow | null} */ let win = null;
/** @type {Tray | null} */ let tray = null;
let interactive = false;

function serveApp() {
  protocol.handle('app', async req => {
    const u = new URL(req.url);
    if (API_PREFIXES.some(p => u.pathname === p || u.pathname.startsWith(p + '/'))) {
      const init = { method: req.method, headers: req.headers, body: req.body, duplex: 'half' };
      return net.fetch(API_BASE + u.pathname + u.search, /** @type {any} */ (init));
    }
    const file = path.normalize(path.join(WEB_DIST, decodeURIComponent(u.pathname)));
    if (!file.startsWith(WEB_DIST) || !fs.existsSync(file)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea; // above the taskbar
  win = new BrowserWindow({
    ...area,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false, // never steal focus; flipped on only while a text box needs typing
    show: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.once('ready-to-show', () => win?.showInactive());
  win.webContents.on('console-message', e => {
    if (e.level === 'error' || e.level === 'warning' || process.env.OVERLAY_DEBUG) console.log(`[page:${e.level}] ${e.message}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => console.error('[overlay] renderer gone', d.reason));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => console.error('[overlay] load failed', code, desc, url));
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.loadURL(PROD ? 'app://overlay/overlay.html' : DEV_URL);
  screen.on('display-metrics-changed', () => win?.setBounds(screen.getPrimaryDisplay().workArea));
  if (process.env.OVERLAY_CAPTURE) captureForDebug(process.env.OVERLAY_CAPTURE);
}

/** @param {string} url */
function openExternal(url) {
  try { if (new URL(url).protocol === 'https:') shell.openExternal(url); } catch { /* ignore bad urls */ }
}

/** focus: true = take keyboard focus (a text box opened), false = give it up, undefined = leave as is. @param {boolean} on @param {boolean} [focus] */
function setInteractive(on, focus) {
  if (!win) return;
  if (on !== interactive) { interactive = on; win.setIgnoreMouseEvents(!on, { forward: true }); }
  if (focus === true) {
    // A transparent overlay starts non-focusable and click-through. Re-enable
    // both at the native window level before asking the renderer to focus its
    // input; otherwise the visible form cannot receive keyboard events.
    win.setIgnoreMouseEvents(false, { forward: true });
    win.setFocusable(true);
    if (!win.isVisible()) win.show();
    win.focus();
    win.webContents.focus();
    win.webContents.executeJavaScript("document.getElementById('task-input')?.focus()", true).catch(() => {});
  }
  else if (focus === false) { win.setFocusable(false); win.blur(); }
}

function trayIcon() {
  // 16x16 orange paw-ish dot, drawn in code so the package needs no binary assets.
  const s = 16, buf = Buffer.alloc(s * s * 4);
  const blobs = [[8, 10, 4.2], [4, 5, 1.9], [8, 3.5, 1.9], [12, 5, 1.9]];
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const hit = blobs.some(([cx, cy, r]) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r);
    buf.set(hit ? [0x2b, 0x8c, 0xf2, 0xff] : [0, 0, 0, 0], (y * s + x) * 4); // BGRA
  }
  return nativeImage.createFromBitmap(buf, { width: s, height: s });
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Fetch pet');
  const toggle = () => { if (!win) return; if (win.isVisible()) win.hide(); else win.showInactive(); rebuild(); };
  const rebuild = () => tray?.setContextMenu(Menu.buildFromTemplate([
    { label: win?.isVisible() ? 'Hide pet' : 'Show pet', click: toggle },
    { label: 'Open desk', click: () => shell.openExternal(DESK_URL) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  rebuild();
  tray.on('click', toggle);
}

/** Debug: OVERLAY_CAPTURE=<dir> saves PNGs of the window (and runs a few intents) to prove it renders. */
function captureForDebug(/** @type {string} */ dir) {
  fs.mkdirSync(dir, { recursive: true });
  const shot = async (/** @type {string} */ name) => {
    const img = await win?.webContents.capturePage();
    if (!img) return;
    fs.writeFileSync(path.join(dir, name), img.toPNG());
    console.log('[overlay] captured', path.join(dir, name), img.getSize());
  };
  const js = (/** @type {string} */ code) => win?.webContents.executeJavaScript(code).catch(e => console.error('[overlay] js', e));
  win?.webContents.once('did-finish-load', async () => {
    const wait = (/** @type {number} */ ms) => new Promise(r => setTimeout(r, ms));
    await wait(9000);
    console.log('[overlay] state', JSON.stringify(await js('window.__overlay?.debug()')));
    await shot('overlay-1-idle.png');
    await js("window.__overlay?.intent('sit')"); await wait(2500); await shot('overlay-2-sit.png');
    await js("window.__overlay?.intent('fetch_ball')"); await wait(1500); await shot('overlay-3-fetch.png');
    await js("window.__overlay?.openMenuAtPet()"); await wait(500); await shot('overlay-4-menu.png');
    await js("window.__overlay?.say('Woof! Want me to fetch something?')"); await wait(400); await shot('overlay-5-say.png');
    console.log('[overlay] state', JSON.stringify(await js('window.__overlay?.debug()')));
    if (process.env.OVERLAY_CAPTURE_QUIT) app.quit();
  });
}

ipcMain.on('overlay:interactive', (_e, on, focus) => setInteractive(!!on, typeof focus === 'boolean' ? focus : undefined));
ipcMain.on('overlay:open-external', (_e, url) => typeof url === 'string' && openExternal(url));

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(() => {
    if (PROD) serveApp();
    createWindow();
    createTray();
  });
  app.on('window-all-closed', () => app.quit());
}
