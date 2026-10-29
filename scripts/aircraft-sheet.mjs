// Renders the aircraft viewer (aircraft.html) in your Chrome and saves screenshots, so every type
// can be inspected up close.  Usage: node scripts/aircraft-sheet.mjs [outDir]
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p));
const out = process.argv[2] ?? 'aircraft-sheets';
await mkdir(out, { recursive: true });
const server = await createServer({ server: { port: 4192, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const shots = [
  ['all-fleet', 'scale=2.6&cols=4'],
  ['liveries', 'airlines=1&scale=2.4&cols=5'],
  ['narrowbodies', 'type=A20N,B738,B38M,A21N&scale=5&cols=2'],
  ['widebodies', 'type=B788,B789,A359,A343,B77W&scale=3.4&cols=3'],
  ['turboprops', 'type=AT76,DH8D&scale=7&cols=2&moving=1'],
  ['a320-close', 'type=A20N&scale=14&cols=1'],
  ['b77w-close', 'type=B77W&scale=11&cols=1'],
  ['landing-config', 'type=A20N,B789,AT76&scale=6&cols=3&phase=final'],
  ['rollout', 'type=B38M,A359&scale=6&cols=2&phase=landing'],
];
for (const [name, query] of shots) {
  await page.goto(`http://localhost:4192/aircraft.html?${query}`);
  await page.waitForFunction(() => window.__done === true, null, { timeout: 15000 });
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
}
await browser.close();
await server.close();
console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'ok, no console errors');
console.log(`screenshots in ${out}`);
