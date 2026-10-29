// Headless check of the terminal / passenger system and of save-load determinism.
// Usage: node scripts/term-check.mjs [scenario] [hours]
import { readFile } from 'node:fs/promises';
import { World, formatINR } from '../src/sim/world.js';
import { PROCESSES } from '../src/sim/terminal.js';

const scenario = process.argv[2] ?? 'normal';
const hours = Number(process.argv[3] ?? 24);
const map = JSON.parse(await readFile(new URL('../public/data/maa-map.json', import.meta.url), 'utf8'));
const start = Date.UTC(2026, 9, 29, 0, 30);

// 1. Save/load determinism: run A for 3 h, snapshot, restore into B, run both 3 more hours.
{
  const a = new World(map, { scenarioId: scenario, startTime: start, weatherMode: 'calm' });
  a.update(3 * 3600);
  const snap = a.snapshot();
  const b = new World(map, { scenarioId: scenario, startTime: start + 999999, weatherMode: 'calm' });
  b.restore(snap);
  for (let i = 0; i < 3 * 3600; i++) {
    a.update(1);
    b.update(1);
  }
  const sig = (w) => JSON.stringify([w.t, w.money, w.kpi, w.flights.map((f) => [f.id, f.phase, Math.round(f.x), Math.round(f.y)]), w.term.snapshot().list.T1.proc.security.qn.toFixed(3), w.log.length]);
  console.log(`SAVE/LOAD: states after +3 h ${sig(a) === sig(b) ? 'IDENTICAL' : 'DIFFER'} (money ${formatINR(a.money)} vs ${formatINR(b.money)}, ${a.kpi.departures}/${b.kpi.departures} departures)`);
  const json = JSON.stringify(snap, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? { __n: String(v) } : v));
  console.log(`  snapshot size ${(json.length / 1e6).toFixed(2)} MB`);
}

// 2. Passenger system over a day.
const w = new World(map, { scenarioId: scenario, startTime: start, weatherMode: 'calm' });
const peak = {};
let nan = 0;
for (let i = 0; i < hours * 3600; i++) {
  w.update(1);
  if (i % 60) continue;
  for (const T of Object.values(w.term.list)) {
    if (!T.open) continue;
    for (const key of Object.keys(T.proc)) {
      const wait = w.term.estWait(T, key);
      const k = `${T.short ?? T.id}.${key}`;
      peak[k] = Math.max(peak[k] ?? 0, wait);
      if (!Number.isFinite(T.proc[key].qn) || T.proc[key].qn < -1e-6) nan++;
    }
  }
}
const rows = [];
for (const T of Object.values(w.term.list)) {
  if (!T.open) continue;
  for (const [key, P] of Object.entries(T.proc)) {
    rows.push({ area: `${T.id} ${PROCESSES[key].label}`, positions: `${P.positions}`, avgWaitMin: (P.sumN ? P.sumWait / P.sumN : 0).toFixed(1), peakEstWaitMin: peak[`${T.short ?? T.id}.${key}`]?.toFixed(0) ?? '-', served: Math.round(P.sumN) });
  }
}
console.table(rows);
const k = w.kpi;
const missed = w.flights.reduce((s, f) => s + (f.pax?.missed ?? 0), 0);
console.log(`departures ${k.departures} · on-time ${k.departures ? Math.round((k.onTime / k.departures) * 100) : 0}% · missed pax ${missed} · satisfaction ${Math.round(w.satisfaction())} (flights ${Math.round(k.satisfaction)}, queues ${Math.round(Object.values(w.term.list).filter((T) => T.open).reduce((s, T) => s + T.score, 0) / 3)}) · invalid queues ${nan}`);
console.log(`revenue ${formatINR(k.revenue)} · costs ${formatINR(k.costs)} · staff/day ${formatINR(w.term.dailyStaffCost())}`);
const causes = {};
for (const f of w.flights) if (f.delayCause && (f.depDelay ?? 0) > 900) causes[f.delayCause] = (causes[f.delayCause] ?? 0) + 1;
console.log('delay causes:', causes);
console.log('report pending:', w.pendingReport ? `day ${w.pendingReport.day} OTP ${Math.round(w.pendingReport.otp * 100)}% offers ${w.pendingReport.offer}` : 'none');

// 3. Do the player's levers really change outcomes?
const verdicts = [];
const verdict = (name, ok, detail) => verdicts.push(`${ok ? 'PASS' : 'FAIL'}  ${name} (${detail})`);
const run = (setup, hrs = 14) => {
  const x = new World(map, { scenarioId: 'festival', startTime: start, weatherMode: 'calm' });
  setup(x);
  x.update(hrs * 3600);
  const missedPax = x.flights.reduce((a, f) => a + (f.pax?.missed ?? 0), 0);
  return { w: x, sec: x.avgWait('security'), otp: x.kpi.departures ? x.kpi.onTime / x.kpi.departures : 1, missed: missedPax, sat: x.satisfaction() };
};
const base = run(() => {});
const starved = run((x) => { x.term.staff.security = 40; });
verdict('too few security staff → long queues and missed flights', starved.sec > base.sec + 5 && starved.missed > base.missed, `avg wait ${base.sec.toFixed(1)} → ${starved.sec.toFixed(1)} min, missed ${base.missed} → ${starved.missed}`);
const lean = run((x) => { for (const T of Object.values(x.term.list)) if (T.proc.security) T.proc.security.dial = 'lean'; });
verdict('Lean staffing queues longer than Auto', lean.sec > base.sec, `${base.sec.toFixed(1)} → ${lean.sec.toFixed(1)} min`);
const peakShift = run((x) => { x.term.staff.security = 150; x.term.shift = 'even'; });
const dayShift = run((x) => { x.term.staff.security = 150; x.term.shift = 'day'; });
verdict('shift template changes who is on duty at night', Math.abs(peakShift.sec - dayShift.sec) > 0.3, `even ${peakShift.sec.toFixed(1)} vs day-heavy ${dayShift.sec.toFixed(1)} min`);
const rets = new World(map, { scenarioId: 'normal', startTime: start, weatherMode: 'calm' });
const before = rets.sepScale;
rets.money = 1e11;
rets.startProject('rets');
rets.update(13 * 3600);
verdict('rapid-exit taxiways tighten runway spacing 20 %', Math.abs(before - 1) < 1e-9 && Math.abs(rets.sepScale - 0.8) < 1e-9, `${before} → ${rets.sepScale}`);
const cat = new World(map, { scenarioId: 'bhogi', startTime: start, weatherMode: 'calm' });
cat.mods.lowVisUntil = 1e12;
const lowVis = cat.sepScale;
cat.money = 1e11;
cat.startProject('cat3');
cat.update(11 * 3600);
cat.mods.lowVisUntil = 1e12;
verdict('CAT-III cuts low-visibility spacing from 2× to 1.3×', Math.abs(lowVis - 2) < 1e-9 && Math.abs(cat.sepScale - 1.3) < 1e-9, `${lowVis} → ${cat.sepScale}`);
const sell = run((x) => { x.term.applyPlan([{ kind: 'add', term: 'T1', proc: 'security', n: 4 }]); }, 14);
verdict('building 4 more T1 lanes lowers T1 queue waits', sell.sec <= base.sec + 0.05, `${base.sec.toFixed(2)} → ${sell.sec.toFixed(2)} min`);
console.log(`\nLEVER TESTS\n${verdicts.join('\n')}`);
