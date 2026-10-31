// Checks the time rules (sim/timing.js): every game and sim day starts at 06:00 whatever the real time is,
// ground services take 30 % of their real time on the game clock, movement stays at real speed, and the
// day's books and report run from 06:00 to 06:00.  Usage: npm run check:time
import { readFile } from 'node:fs/promises';
import { World } from '../src/sim/world.js';
import { SCENARIOS } from '../src/sim/scenarios.js';
import { AIRCRAFT_TYPES } from '../src/sim/aircraftTypes.js';
import { SERVICE_TIME, serviceTime, simDay, hoursIntoDay, gameStart } from '../src/sim/timing.js';

const map = JSON.parse(await readFile(new URL('../public/data/maa-map.json', import.meta.url), 'utf8'));
let failed = 0;
const ok = (name, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (!pass) failed++;
};
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// The start: at any real time of day, in every scenario.
const atHour = (h) => Date.UTC(2026, 9, 29, h, 17) - 5.5 * 3600e3;
const istStart = (now) => {
  const ist = new Date(gameStart(now) + 5.5 * 3600e3);
  return [ist.getUTCDate(), ist.getUTCHours(), ist.getUTCMinutes()];
};
ok('a game begun at any real time starts at 06:00 that day', [0, 5, 6, 13, 23].every((h) => istStart(atHour(h)).join() === '29,6,0'));
ok('no scenario sets its own start time', Object.values(SCENARIOS).every((s) => s.startHour === undefined));
const noArgs = new World(map, { weatherMode: 'calm' });
ok('a new World starts at 06:00 by default', noArgs.t === 6 * 3600 && simDay(noArgs.t) === 0, `t = ${noArgs.t}`);
ok('the day runs from 06:00', simDay(6 * 3600 - 1) === -1 && simDay(30 * 3600 - 1) === 0 && simDay(30 * 3600) === 1 && near(hoursIntoDay(6 * 3600), 0) && near(hoursIntoDay(5.5 * 3600), 23.5));

// The service factor.
ok('a 10-minute job takes 3 minutes', near(serviceTime(10), 3) && SERVICE_TIME === 0.3);
const w = new World(map, { scenarioId: 'normal', startTime: gameStart(Date.UTC(2026, 9, 29)), weatherMode: 'calm' });
const seen = new Map();
let midnightReport = false;
let reportAt = null;
let driftBad = 0;
let taxiFast = 0;
const ready = [];
const start = w.t;
const prev = new Map();
for (let i = 0; i < 25 * 3600 && reportAt === null; i++) {
  w.update(1);
  if (Math.floor(w.t) === 86400 && w.pendingReport) midnightReport = true;
  if (w.pendingReport) {
    reportAt = w.t;
    break;
  }
  if (Math.abs(w.t - start - (i + 1)) > 1e-6) driftBad++;
  for (const f of w.flights) {
    if (f.phase === 'taxiOut' && f.speed > 12.01) taxiFast++; // TAXI_MAX, about 23 kt: movement is not compressed
    if (!f.tasks) continue;
    for (const task of f.tasks) if (!seen.has(`${f.id}.${task.id}`)) seen.set(`${f.id}.${task.id}`, { f, task, dur0: task.dur });
    const last = prev.get(f.id);
    const allButWaiting = f.tasks.filter((x) => !x.board && !x.lead && x.id !== 'close');
    if (!last && f.onBlock && allButWaiting.every((x) => x.state === 'done')) {
      prev.set(f.id, true);
      ready.push({ f, min: (w.t - f.onBlock) / 60 });
    }
  }
}
const plans = [...seen.values()];
const byId = (id) => plans.filter((p) => p.task.id === id);
ok('chocks take 18 s, the bridge or stairs 27 s, closing the doors 36 s', byId('chocks').length > 50 && byId('chocks').every((p) => near(p.dur0, 18)) && byId('connect').every((p) => near(p.dur0, 27)) && byId('close').every((p) => near(p.task.dur, 36) || near(p.task.dur, 18)), `${plans.length} tasks seen`);
const refuel = byId('fuel').filter((p) => !p.f.service);
ok('refuelling takes 30 % of its real time', refuel.length > 50 && refuel.every((p) => near(p.dur0, 0.3 * (10 + 8 * (AIRCRAFT_TYPES[p.f.type].seats / 186)) * 60)), `${refuel.length} refuellings`);
const boards = byId('board').filter((p) => p.task.state === 'done' && p.f.pax?.board);
ok('boarding takes 0.9 s a passenger (real: 3 s)', boards.length > 50 && boards.every((p) => near(p.task.dur, Math.max(18, p.f.pax.board * 0.9))), `${boards.length} boardings`);
const sorted = ready.filter((r) => !r.f.service).map((r) => r.min).sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
ok('an aircraft is serviced within about a quarter of an hour of arriving', sorted.length > 50 && median < 15, `median ${median?.toFixed(1)} min, ${sorted.length} flights`);
ok('flights still leave on their real schedule, not early', w.flights.filter((f) => f.offBlock).every((f) => f.offBlock >= f.std - 120), `${w.flights.filter((f) => f.offBlock).length} off blocks`);
ok('aircraft taxi at real speed', taxiFast === 0);

// The clock and the day.
ok('the clock advances exactly as far as the sim was stepped', driftBad === 0);
ok('no report at midnight; the day closes at 06:00 next morning', !midnightReport && near(reportAt, 30 * 3600, 2), `report at ${reportAt && (reportAt / 3600).toFixed(2)} h`);
const r = w.pendingReport;
ok('the first report is day 1, dated the start day', r?.day === 1 && r?.date === '2026-10-29', `day ${r?.day}, ${r?.date}`);
ok('the hours of the books add up to the day', r && near(r.finance.hours.reduce((a, h) => a + h.in, 0), Object.values(r.finance.in).reduce((a, b) => a + b, 0), 2));
ok('the first hour of the books is the first hour of the day', r && r.finance.hours[0].out > 0 && r.finance.hours[23].out > 0);

// Inspections: the runway closes for 30 % of 15 minutes.
const c = new World(map, { scenarioId: 'normal', startTime: gameStart(Date.UTC(2026, 9, 29)), weatherMode: 'calm' });
c.closeRunway(serviceTime(15), 'Runway inspection ordered', '07/25');
c.update(4.4 * 60);
const during = c.runwayClosed(c.t, '07/25');
c.update(12);
ok('a runway inspection closes the runway for 4.5 minutes', during && !c.runwayClosed(c.t, '07/25'));

// A saved game keeps all of this.
const a = new World(map, { scenarioId: 'normal', startTime: gameStart(Date.UTC(2026, 9, 29)), weatherMode: 'calm' });
a.update(23 * 3600);
const b = new World(map, { scenarioId: 'normal', startTime: gameStart(Date.UTC(2026, 9, 30)), weatherMode: 'calm' });
b.restore(a.snapshot());
a.update(2 * 3600);
b.update(2 * 3600);
ok('a restored game closes its day at the same moment', a.pendingReport?.day === 1 && b.pendingReport?.day === 1 && a.t === b.t);
process.exit(failed ? 1 : 0);
