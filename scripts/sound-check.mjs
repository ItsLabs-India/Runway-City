// Checks the soundscape in a real browser: silent when zoomed out, voices appear when you zoom in on
// aircraft and vehicles, weather sounds follow the weather, and the output is audible and finite.
// Usage: npm run build && node scripts/sound-check.mjs
import { existsSync } from 'node:fs';
import { preview } from 'vite';
import { chromium } from 'playwright-core';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p));
const PORT = 4183;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
};

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

async function boot(query) {
  await page.goto(`http://localhost:${PORT}/?${query}`);
  await page.waitForFunction(() => window.__runway?.world, null, { timeout: 30000 });
  await page.mouse.click(700, 450); // the first tap switches sound on
  await page.waitForFunction(() => window.__runway.sound.ctx?.state === 'running', null, { timeout: 8000 });
}
const stats = () => page.evaluate(() => ({ ...window.__runway.sound.stats }));
const rms = () =>
  page.evaluate(async () => {
    const s = window.__runway.sound;
    s.analyser ??= (() => {
      const a = s.ctx.createAnalyser();
      a.fftSize = 2048;
      s.master.connect(a);
      return a;
    })();
    await new Promise((r) => setTimeout(r, 400));
    const d = new Float32Array(s.analyser.fftSize);
    s.analyser.getFloatTimeDomainData(d);
    let sum = 0;
    for (const v of d) {
      if (!Number.isFinite(v)) return NaN;
      sum += v * v;
    }
    return Math.sqrt(sum / d.length);
  });
const wait = (ms) => page.waitForTimeout(ms);

// ---- calm day, aircraft and vehicles ------------------------------------------------------------------
await boot('scenario=normal&time=07:00&warm=900&speed=1');
check('sound switches on after the first tap', await page.evaluate(() => window.__runway.ui.sound === true));
check('speaker button shows the state', (await page.textContent('[data-sound]')) === '🔊');

await page.evaluate(() => window.__runway.camera.setView({ x: 0, y: 0, scale: 0.06 }));
await wait(500);
let s = await stats();
check('zoomed right out: no aircraft or vehicle voices', s.aircraft === 0 && s.vehicles === 0, JSON.stringify(s));

// Find a moving aircraft and zoom in on it.
const target = await page.evaluate(() => {
  const w = window.__runway.world;
  const f = w.visibleFlights().find((x) => ['taxiOut', 'taxiIn', 'takeoff', 'landing'].includes(x.phase)) ?? w.visibleFlights().find((x) => x.phase === 'atStand');
  return f ? { id: f.id, phase: f.phase } : null;
});
check('there is an aircraft to listen to', target, JSON.stringify(target));
if (target) {
  await page.evaluate((id) => window.__runway.follow(id), target.id);
  await wait(800);
  s = await stats();
  check('zoomed in on an aircraft: an aircraft voice is playing', s.aircraft >= 1, JSON.stringify(s));
  const level = await rms();
  check('output is audible and finite', level > 0.0005 && Number.isFinite(level), `rms ${level.toFixed(4)}`);
}

// Zoom onto a stand with a turnaround in progress to hear the vehicles.
const stand = await page.evaluate(() => {
  const w = window.__runway.world;
  const v = w.vehicles.find((x) => x.wx !== undefined && x.state === 'working');
  return v ? { x: v.wx, y: v.wy } : null;
});
check('turnaround vehicles exist', stand);
if (stand) {
  await page.evaluate((p) => window.__runway.camera.setView({ x: p.x, y: p.y, scale: 4 }), stand);
  await wait(800);
  s = await stats();
  check('zoomed in on vehicles: vehicle voices are playing', s.vehicles >= 1, JSON.stringify(s));
  await page.evaluate(() => window.__runway.camera.setView({ x: window.__runway.camera.x, y: window.__runway.camera.y, scale: 0.15 }));
  await wait(900);
  s = await stats();
  check('zooming out silences the vehicles again', s.vehicles === 0, JSON.stringify(s));
}

// ---- terminal, road ---------------------------------------------------------------------------------------
const places = await page.evaluate(() => {
  const m = window.__runway.sound;
  const t = m.terminals[0];
  const c = t ? [(t.box.minX + t.box.maxX) / 2, (t.box.minY + t.box.maxY) / 2] : null;
  let road = null;
  for (const [key, w] of m.roadGrid) if (w >= 0.9) { const [i, j] = key.split(',').map(Number); road = [i * 60 + 30, j * 60 + 30]; break; }
  return { terminal: c && m.terminals.some((x) => x.box.minX <= c[0] && c[0] <= x.box.maxX) ? c : null, road };
});
if (places.terminal) {
  await page.evaluate((c) => window.__runway.camera.setView({ x: c[0], y: c[1], scale: 2 }), places.terminal);
  await wait(900);
  s = await stats();
  check('inside a terminal the crowd murmur is on or the road is heard', s.crowd > 0 || s.road > 0, JSON.stringify(s));
}
if (places.road) {
  await page.evaluate((c) => window.__runway.camera.setView({ x: c[0], y: c[1], scale: 2 }), places.road);
  await wait(900);
  s = await stats();
  check('next to a main road the traffic is heard', s.road > 0.2, JSON.stringify(s));
}

// ---- mute ---------------------------------------------------------------------------------------------------
await page.keyboard.press('m');
await wait(300);
check('M mutes', await page.evaluate(() => window.__runway.ui.sound === false && window.__runway.sound.on === false));
await page.keyboard.press('m');
await wait(300);
check('M unmutes', await page.evaluate(() => window.__runway.ui.sound === true));

// ---- weather ------------------------------------------------------------------------------------------------
await page.evaluate(() => {
  const w = window.__runway.world;
  // a spell of heavy rain and strong wind, as the weather model would produce
  w.weather.update = function () { this.now = { ...this.now, rain: 0.9, storm: 0.9, lightning: true, wet: 1 }; return this.now; };
  w.weather.update();
  w.wind = { from: 250, kt: 28, gust: 40 };
  window.__runway.camera.setView({ x: 0, y: 0, scale: 1 });
});
await wait(900);
s = await stats();
check('rain is heard when it rains', s.rain > 0.5, JSON.stringify(s));
check('wind is heard when it blows', s.wind > 0.4, JSON.stringify(s));
check('output stays finite in a storm', Number.isFinite(await rms()));

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
await server.close();
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} sound check(s) FAILED` : `\nall ${results.length} sound checks passed`);
process.exit(failed ? 1 : 0);
