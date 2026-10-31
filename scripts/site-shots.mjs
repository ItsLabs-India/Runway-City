// Takes the screenshots for the marketing page (site/images) from the real game, in your Chrome: one
// unattended day, photographed as it goes. Store-facing images carry no airline names or colours (CLAUDE.md
// section 5), so every flight is repainted as a generic operator before each picture.
// Usage: npm run site:shots
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { preview } from 'vite';
import { chromium } from 'playwright-core';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p));
const PORT = 4182;
const OUT = 'site/images';
const TERMINALS = { x: -740, y: 1110 };
await mkdir(OUT, { recursive: true });

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.addInitScript(() => {
  localStorage.setItem('rc-weather', 'calm');
  localStorage.removeItem('rc-tab');
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// Code '' draws a plain map tag; the panels need a code for their badges.
const paint = (code) => page.evaluate((c) => {
  for (const f of window.__runway.world.flights) {
    const n = 100 + (f.id % 8900);
    Object.assign(f, { airline: c, airlineName: 'Generic Air', callsign: 'RUNWAY', arrNo: `RC ${n}`, depNo: `RC ${n + 1}` });
  }
}, code);
const runUntil = (hour) => page.evaluate((h) => {
  const w = window.__runway.world;
  w.update(Math.max(0, h * 3600 - w.t));
}, hour);
const view = (v) => page.evaluate((x) => window.__runway.camera.setView(x), v);
const hud = (on) => page.evaluate((show) => { document.getElementById('hud').style.display = show ? '' : 'none'; }, on);
const shot = async (name) => {
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 84 });
  console.log(name);
};
// A parked aircraft on a jet-bridge stand with the most vehicles working around it.
const busiest = () => page.evaluate(() => {
  const w = window.__runway.world;
  const working = (f) => w.vehicles.filter((v) => v.flightId === f.id && v.state === 'working').length;
  const parked = w.flights.filter((f) => f.phase === 'atStand' && w.bridges.some((b) => b.standId === f.standId));
  const best = parked.sort((a, b) => working(b) - working(a))[0];
  return { x: best.x, y: best.y, working: working(best) };
});

await page.goto(`http://localhost:${PORT}/?scenario=normal&speed=0`);
await page.waitForFunction(() => window.__runway?.world, null, { timeout: 30000 });
await page.addStyleTag({ content: '.toasts, .hint, [data-hint] { display: none !important; }' });

// The whole airfield in the morning.
await runUntil(8.6);
await paint('');
await view({ x: 0, y: 330, scale: 0.34 });
await shot('airfield');

// One turnaround, close up, and the same aircraft's flight card.
await runUntil(9.4);
await paint('');
const near = await busiest();
console.log('turnaround: vehicles working', near.working);
await hud(false);
await view({ x: near.x, y: near.y, scale: 5.5 });
await shot('turnaround');
await paint('RC');
await hud(true);
await view({ x: near.x - 130, y: near.y, scale: 3.4 });
await page.waitForTimeout(500);
const at = await page.evaluate(({ x, y }) => window.__runway.camera.worldToScreen(x, y), near);
await page.mouse.click(at[0], at[1]);
await shot('flight');
await page.keyboard.press('Escape');

// Terminals: queues, staff and quick building.
await runUntil(11.5);
await paint('RC');
await view({ ...TERMINALS, scale: 1 });
await page.keyboard.press('t');
await shot('terminals');
await page.keyboard.press('Escape');

// A storm crossing the airfield, then clear skies again.
await runUntil(15.2);
await page.evaluate(() => {
  const w = window.__runway.world;
  w.weather.spells = [{ type: 'storm', start: w.t - 3600, end: w.t + 7200, scale: 1, seed: 3 }];
  w.weather.update(w.t, 0);
  w.update(45);
});
await paint('');
await hud(false);
await view({ ...TERMINALS, scale: 1.6 });
await shot('storm');
await page.evaluate(() => {
  const w = window.__runway.world;
  w.weather.spells = [{ type: 'clear', start: w.t - 3600, end: w.t + 40 * 3600, scale: 1, seed: 5 }];
  w.weather.update(w.t, 0);
});

// The floodlit apron at night: the page's main picture.
await runUntil(19);
await paint('');
await view({ ...TERMINALS, scale: 1.6 });
await shot('night');

console.log('page errors:', errors.length, errors.slice(0, 3));
await browser.close();
await server.close();
process.exit(errors.length ? 1 : 0);
