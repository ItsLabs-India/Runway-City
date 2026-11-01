// Checks the time rules (sim/timing.js): every game and sim day starts at 06:00 whatever the real time is,
// every real flight runs, movement, ground services, stays and construction all keep their real durations on
// one clock, and the day's books and report run from 06:00 to 06:00.  Usage: npm run check:time
import { readFile } from 'node:fs/promises';
import { World } from '../src/sim/world.js';
import { SCENARIOS } from '../src/sim/scenarios.js';
import { AIRCRAFT_TYPES } from '../src/sim/aircraftTypes.js';
import { SERVICE_TIME, serviceTime, simDay, hoursIntoDay, gameStart, SPEEDS, DEFAULT_SPEED } from '../src/sim/timing.js';
import { buildSchedule } from '../src/sim/schedule.js';
import { PROJECTS } from '../src/sim/projects.js';

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

// The speeds, measured against real time: Normal (where the game opens) is 2×.
const dayMinutes = (label) => 86400 / SPEEDS.find((s) => s.label === label).value / 60;
ok('the speeds are Normal, 4×, 10×, 20× and 60×', SPEEDS.map((s) => s.label).join() === 'Normal,4×,10×,20×,60×' && SPEEDS.map((s) => s.value).join() === '2,4,10,20,60');
ok('one game minute takes 30 real seconds at Normal', near(60 / DEFAULT_SPEED, 30));
ok('a full day takes 12 hours at Normal and 24 minutes at 60×', near(dayMinutes('Normal'), 720) && near(dayMinutes('60×'), 24));
ok('the game opens at Normal', DEFAULT_SPEED === SPEEDS.find((s) => s.label === 'Normal').value);

// Real flights: nothing is thinned out of the timetable.
const realDay = buildSchedule({ daySeed: 20261029, traffic: SCENARIOS.normal.traffic, day: 0, boost: 0 });
ok('a normal day runs the real number of flights', SCENARIOS.normal.traffic === 1 && realDay.filter((r) => !r.service).length === 206, `${realDay.filter((r) => !r.service).length} passenger rotations + ${realDay.filter((r) => r.service).length} cargo and general aviation`);

// Work keeps its real duration on the clock.
ok('a 10-minute job takes 10 clock minutes', near(serviceTime(10), 10) && SERVICE_TIME === 1);
const w = new World(map, { scenarioId: 'normal', startTime: gameStart(Date.UTC(2026, 9, 29)), weatherMode: 'calm' });
const seen = new Map();
let midnightReport = false;
let reportAt = null;
let driftBad = 0;
let taxiFast = 0;
const taxiIn = [];
const taxiOut = [];
const landedAt = new Map();
const pushedAt = new Map();
const phaseOf = new Map();
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
    if (f.phase === 'taxiOut' && f.speed > 12.01) taxiFast++; // TAXI_MAX, about 23 kt
    if (phaseOf.get(f.id) !== f.phase) {
      phaseOf.set(f.id, f.phase);
      if (f.phase === 'landing') landedAt.set(f.id, w.t);
      if (f.phase === 'pushback') pushedAt.set(f.id, w.t);
      if (f.phase === 'atStand' && landedAt.has(f.id)) taxiIn.push((w.t - landedAt.get(f.id)) / 60);
      if (f.phase === 'takeoff' && pushedAt.has(f.id)) taxiOut.push((w.t - pushedAt.get(f.id)) / 60);
    }
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
ok('chocks take 1 min, the bridge or stairs 1.5, closing the doors 2 (1 for general aviation)', byId('chocks').length > 50 && byId('chocks').every((p) => near(p.dur0, 60)) && byId('connect').every((p) => near(p.dur0, 90)) && byId('close').every((p) => near(p.task.dur, 120) || near(p.task.dur, 60)), `${plans.length} tasks seen`);
const refuel = byId('fuel').filter((p) => !p.f.service);
ok('refuelling takes its real time', refuel.length > 50 && refuel.every((p) => near(p.dur0, (10 + 8 * (AIRCRAFT_TYPES[p.f.type].seats / 186)) * 60)), `${refuel.length} refuellings`);
const boards = byId('board').filter((p) => p.task.state === 'done' && p.f.pax?.board);
ok('boarding takes 3 s a passenger', boards.length > 50 && boards.every((p) => near(p.task.dur, Math.max(60, p.f.pax.board * 3))), `${boards.length} boardings`);
const sorted = ready.filter((r) => !r.f.service).map((r) => r.min).sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
ok('servicing fills most of the real ground time, so aircraft do not sit idle', sorted.length > 50 && median > 25 && median < 55, `median ${median?.toFixed(1)} min, ${sorted.length} flights`);
ok('flights still leave on their real schedule, not early', w.flights.filter((f) => f.offBlock).every((f) => f.offBlock >= f.std - 120), `${w.flights.filter((f) => f.offBlock).length} off blocks`);
ok('taxiing stays within its real speed limit', taxiFast === 0);
const medianOf = (list) => [...list].sort((x, y) => x - y)[Math.floor(list.length / 2)];
ok('landing to stand takes real time on the clock', medianOf(taxiIn) > 3 && medianOf(taxiIn) < 8, `median ${medianOf(taxiIn)?.toFixed(1)} min`);
ok('push-back to take-off takes real time on the clock', medianOf(taxiOut) > 4 && medianOf(taxiOut) < 12, `median ${medianOf(taxiOut)?.toFixed(1)} min`);

// The clock and the day.
ok('the clock advances exactly as far as the sim was stepped', driftBad === 0);
ok('no report at midnight; the day closes at 06:00 next morning', !midnightReport && near(reportAt, 30 * 3600, 2), `report at ${reportAt && (reportAt / 3600).toFixed(2)} h`);
const r = w.pendingReport;
ok('the first report is day 1, dated the start day', r?.day === 1 && r?.date === '2026-10-29', `day ${r?.day}, ${r?.date}`);
ok('the hours of the books add up to the day', r && near(r.finance.hours.reduce((a, h) => a + h.in, 0), Object.values(r.finance.in).reduce((a, b) => a + b, 0), 2));
ok('the first hour of the books is the first hour of the day', r && r.finance.hours[0].out > 0 && r.finance.hours[23].out > 0);

// Inspections: the runway closes for 15 minutes.
const c = new World(map, { scenarioId: 'normal', startTime: gameStart(Date.UTC(2026, 9, 29)), weatherMode: 'calm' });
c.closeRunway(serviceTime(15), 'Runway inspection ordered', '07/25');
c.update(14.9 * 60);
const during = c.runwayClosed(c.t, '07/25');
c.update(12);
ok('a runway inspection closes the runway for 15 minutes', during && !c.runwayClosed(c.t, '07/25'));

// Construction is on the same clock: a project and a terminal order take their stated time.
const d = new World(map, { scenarioId: 'normal', startTime: gameStart(Date.UTC(2026, 9, 29)), weatherMode: 'calm' });
d.money = 1e12;
d.startProject('t3');
ok('Terminal 3 takes 36 hours', near(d.projects.t3.finishAt - d.t, PROJECTS.t3.hours * 3600, 1) && near(d.projects.t3.finishAt - d.t, 36 * 3600, 1));
const order = d.term.previewPlan([{ kind: 'add', term: 'T1', proc: 'security', n: 4 }]);
ok('4 security lanes take 53 minutes, in the preview and the order alike', near(order.minutes, 53, 0.01));
const before = d.term.list.T1.builds.length;
d.term.applyPlan([{ kind: 'add', term: 'T1', proc: 'security', n: 4 }]);
const built = d.term.list.T1.builds[before];
ok('the order is due when the preview said', built && near(built.finishAt - d.t, 53 * 60, 1));
const lanes = d.term.list.T1.proc.security.positions;
d.update(52 * 60);
const early = d.term.list.T1.proc.security.positions;
d.update(2 * 60);
ok('the lanes open on time', early === lanes && d.term.list.T1.proc.security.positions === lanes + 4, `${lanes} → ${early} → ${d.term.list.T1.proc.security.positions}`);

// A saved game keeps all of this.
const a = new World(map, { scenarioId: 'normal', startTime: gameStart(Date.UTC(2026, 9, 29)), weatherMode: 'calm' });
a.update(23 * 3600);
const b = new World(map, { scenarioId: 'normal', startTime: gameStart(Date.UTC(2026, 9, 30)), weatherMode: 'calm' });
b.restore(a.snapshot());
a.update(2 * 3600);
b.update(2 * 3600);
ok('a restored game closes its day at the same moment', a.pendingReport?.day === 1 && b.pendingReport?.day === 1 && a.t === b.t);
process.exit(failed ? 1 : 0);
