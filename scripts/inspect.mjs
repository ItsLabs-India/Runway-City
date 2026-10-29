// Real-time browser inspection with Playwright (drives the locally installed Chrome).
// Runs each scenario live at 30x, samples how far every moving aircraft's gears are from the
// painted lines, checks overlaps, FPS and console errors, and captures follow-camera close-ups
// of runway exits, stand lead-ins, push-backs and line-ups.
//
// Usage: npm run build && node scripts/inspect.mjs [outDir] [scenario,scenario] (SECONDS=40)
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
const outDir = process.argv[2] ?? 'inspect-output';
const scenarios = (process.argv[3] ?? 'normal,festival,bhogi,cyclone,outage,sandbox').split(',');
const SECONDS = Number(process.env.SECONDS ?? 40);
const SHOTS = [
  { name: 'exit', test: 'f.phase === "taxiIn" && f.s < 160' },
  { name: 'lead-in', test: 'f.phase === "taxiIn" && f.limit - f.s < 110 && f.limit - f.s > 20' },
  { name: 'pushback', test: 'f.phase === "pushback" && f.s > f.wb + 15' },
  { name: 'line-up', test: 'f.phase === "lineUp"' },
];

await mkdir(outDir, { recursive: true });
const server = await preview({ preview: { port: 4180, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];

for (const scenario of scenarios) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://localhost:4180/?scenario=${scenario}&speed=30&warm=900&time=${process.env.TIME ?? '07:00'}`);
  await page.waitForFunction(() => window.__runway?.world, null, { timeout: 30000 });

  const stats = { samples: 0, over1m: 0, maxNose: 0, maxMain: 0, clashes: 0, maxMoving: 0 };
  const captured = new Set();
  const t0 = Date.now();
  const f0 = await page.evaluate(() => window.__runway.frames);
  while (Date.now() - t0 < SECONDS * 1000) {
    await page.waitForTimeout(400);
    const snap = await page.evaluate(() => ({ dev: window.__runway.deviation(), audit: window.__runway.world.audit() }));
    stats.clashes += snap.audit.aircraftClashes;
    stats.maxMoving = Math.max(stats.maxMoving, snap.dev.length);
    for (const d of snap.dev) {
      stats.samples++;
      stats.maxNose = Math.max(stats.maxNose, d.nose);
      stats.maxMain = Math.max(stats.maxMain, d.main);
      if (Math.max(d.nose, d.main) > 1) stats.over1m++;
    }
    // Close-ups: follow an aircraft at a key moment, slow down, take a picture.
    for (const shot of SHOTS) {
      if (captured.has(shot.name)) continue;
      const id = await page.evaluate(`(() => { const f = window.__runway.world.flights.find((f) => ${shot.test}); return f ? f.id : null; })()`);
      if (id === null) continue;
      captured.add(shot.name);
      await page.evaluate((fid) => {
        window.__runway.setSpeed(2);
        window.__runway.follow(fid);
      }, id);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${outDir}/${scenario}-${shot.name}.png` });
      await page.evaluate(() => {
        window.__runway.camera.following = null;
        window.__runway.setSpeed(30);
      });
    }
  }
  const fps = ((await page.evaluate(() => window.__runway.frames)) - f0) / ((Date.now() - t0) / 1000);
  await page.evaluate(() => window.__runway.camera.setView({ x: -400, y: 300, scale: 0.18 }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/${scenario}-overview.png` });
  results.push({ scenario, ...stats, fps: Math.round(fps), shots: [...captured].join(','), errors: errors.slice(0, 3) });
  await page.close();
}

await browser.close();
server.httpServer.close();
console.table(results.map((r) => ({
  scenario: r.scenario,
  'gear samples': r.samples,
  '> 1 m off line': r.over1m,
  'worst nose (m)': r.maxNose.toFixed(2),
  'worst main (m)': r.maxMain.toFixed(2),
  'aircraft clashes': r.clashes,
  'moving peak': r.maxMoving,
  fps: r.fps,
  'close-ups': r.shots,
  errors: r.errors.length,
})));
for (const r of results) if (r.errors.length) console.log(`${r.scenario} errors:`, r.errors);
