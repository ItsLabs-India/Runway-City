// Windows desktop build: the same game in an Electron window. Pages are served from a private
// app:// origin (so saves in IndexedDB / localStorage keep the same origin on every launch), and
// /api/* is answered in-process by the same proxy code that runs on Cloudflare (worker/index.js),
// so real weather and Live Watch work without a server.
import { app, BrowserWindow, protocol, shell, net } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import worker from '../worker/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const ORIGIN = 'app://runway';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit(); // one window: two would fight over the same save

function handle(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return worker.fetch(new Request(`http://localhost${url.pathname}${url.search}`, { method: request.method }));
  // Static file from dist/, never outside it.
  const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
  // Optional files (timetable.json, logos) may be missing: a plain 404, as on the web.
  if (!file.startsWith(ROOT) || !existsSync(file)) return new Response('Not found', { status: 404 });
  return net.fetch(pathToFileURL(file).toString());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 360,
    minHeight: 480,
    backgroundColor: '#0f1720',
    autoHideMenuBar: true,
    title: 'Runway City',
    icon: path.join(ROOT, '..', 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.maximize();
  // Links such as the data credits open in the normal browser, not inside the game.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
  win.loadURL(`${ORIGIN}/index.html`);
  if (process.env.RC_SMOKE) smoke(win);
  return win;
}

// RC_SMOKE=1: boot, check the game and the /api proxy, print one JSON line, quit (exit 1 on failure).
function smoke(win) {
  win.webContents.once('did-finish-load', async () => {
    let r = { ok: false };
    try {
      for (let i = 0; i < 60 && !r.ok; i++) {
        await new Promise((d) => setTimeout(d, 500));
        r = await win.webContents.executeJavaScript(
          "(async () => ({ ok: Boolean(window.__runway?.world), flights: window.__runway?.world?.flights.length ?? 0, api: (await fetch('api/health').then((x) => x.status).catch(() => 0)) }))()",
        );
      }
    } catch (e) {
      r = { ok: false, error: String(e) };
    }
    console.log(`RC_SMOKE ${JSON.stringify(r)}`);
    app.exit(r.ok && r.api === 200 ? 0 : 1);
  });
}

app.whenReady().then(() => {
  protocol.handle('app', handle);
  const win = createWindow();
  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });
});

app.on('window-all-closed', () => app.quit());
