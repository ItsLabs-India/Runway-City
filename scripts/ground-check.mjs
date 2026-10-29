// Checks the apron operations headlessly: jet bridges dock to the door and are back before push-back,
// ground staff appear for each job, bags move in the right direction, and nothing breaks over a day.
// Usage: npm run check:ground
import { readFile } from 'node:fs/promises';
import { World } from '../src/sim/world.js';
import { doorAt } from '../src/sim/jetbridges.js';

const map = JSON.parse(await readFile(new URL('../public/data/maa-map.json', import.meta.url), 'utf8'));
const w = new World(map, { scenarioId: 'normal', startTime: Date.UTC(2026, 9, 29, 0, 30), weatherMode: 'calm' });
let failed = 0;
const ok = (name, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (!pass) failed++;
};

const contact = w.stands.filter((s) => s.contact && !s.locked);
ok('a working jet bridge for (almost) every contact stand', w.bridges.filter((b) => b.index === 0).length >= contact.length - 1, `${w.bridges.length} bridges for ${contact.length} contact stands`);
ok('wide-body stands get a second bridge', w.bridges.some((b) => b.index === 1));

let worstGap = 0;
let pushWithBridge = 0;
let docked = 0;
const roles = new Set();
let wrongFlow = 0;
let fillOk = true;
for (let i = 0; i < 24 * 3600; i++) {
  w.update(1);
  if (i % 20) continue;
  for (const b of w.jetBridgeSprites()) {
    if (b.state !== 'docked') continue;
    docked++;
    const st = w.standById.get(b.standId);
    const f = w.flights.find((x) => x.id === b.flightId);
    const door = doorAt(st, f.type, b.index, { x: f.x, y: f.y, heading: f.heading });
    worstGap = Math.max(worstGap, Math.abs(Math.hypot(b.cab[0] - door.x, b.cab[1] - door.y) - 2.4));
  }
  // No aircraft may push back while one of its bridges is still out.
  for (const f of w.flights) {
    if (f.phase !== 'pushback') continue;
    if (w.jetBridgeSprites().some((b) => b.standId === f.standId && b.e > 0.01)) pushWithBridge++;
  }
  for (const p of w.staffSprites()) roles.add(p.role);
  for (const v of w.vehicleSprites()) {
    if (v.kind === 'beltLoader' && v.flow && ((v.task === 'unload' && v.flow !== 'down') || (v.task === 'load' && v.flow !== 'up'))) wrongFlow++;
    if (v.kind === 'cart' && !(v.fill >= 0 && v.fill <= 1)) fillOk = false;
  }
}
ok('docked bridges meet the door', docked > 100 && worstGap < 0.5, `${docked} docked samples, worst gap ${worstGap.toFixed(2)} m`);
ok('no push-back with a bridge still attached', pushWithBridge === 0, `${pushWithBridge}`);
const need = ['lead', 'bags', 'fuel', 'catering', 'headset', 'walker'];
ok('ground staff appear for each job', need.every((r) => roles.has(r)), [...roles].join(', '));
ok('bags go down the belt when unloading and up when loading', wrongFlow === 0);
ok('carts fill and empty within 0..1', fillOk);
process.exit(failed ? 1 : 0);
