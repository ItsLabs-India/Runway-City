// Regression check for ground deadlocks found on 2026-10-30: chains of aircraft each waiting for the
// next, closed through the departure queue, the hold-short line and the arrival still vacating the
// runway, so every later arrival went around and diverted. Replays that day for two days, several
// times with the start shifted by a few seconds (deadlocks depend on exact timing), and checks traffic
// keeps flowing.  Usage: npm run check:gridlock [offset seconds ...]
import { readFile } from 'node:fs/promises';
import { World } from '../src/sim/world.js';

const map = JSON.parse(await readFile(new URL('../public/data/maa-map.json', import.meta.url), 'utf8'));
const start = Date.UTC(2026, 9, 30, 7, 0) - 5.5 * 3600e3;
const offsets = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [0, 1, 5];
let failed = 0;
for (const off of offsets) {
  const w = new World(map, { scenarioId: 'normal', startTime: start });
  w.update(600 + off);
  w.update(3 * 3600);
  w.update(1200);
  w.weather.spells = [{ type: 'storm', start: w.t - 3600, end: w.t + 7200, scale: 1, seed: 3 }];
  w.weather.update(w.t, 0);
  w.update(40);
  w.weather.spells = [{ type: 'clear', start: w.t - 3600, end: w.t + 40 * 3600, scale: 1, seed: 5 }];
  w.weather.update(w.t, 0);
  w.update(1300);
  w.money = 100e7;
  w.startProject('hydrant');
  w.update(9 * 3600);
  w.startProject('t3');
  // Longest time an aircraft was ready to go (taxiing out or at the hold-short line) without any departure.
  let longest = 0;
  let last = w.t;
  let deps = w.kpi.departures;
  for (let i = 0; i < 37 * 3600; i++) {
    w.update(1);
    const waiting = w.flights.some((f) => f.phase === 'taxiOut' || f.phase === 'holdShort');
    if (w.kpi.departures !== deps || !waiting) {
      deps = w.kpi.departures;
      last = w.t;
    }
    longest = Math.max(longest, w.t - last);
    if (longest > 3 * 3600) break; // stuck for good: no need to run on
  }
  const day2 = w.reports.find((r) => r.day === 2);
  const pass = day2 && day2.departures > 100 && day2.diversions < 5 && longest < 3600;
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  start +${off} s: traffic keeps flowing (day 2: ${day2?.departures ?? '–'} departures, ${day2?.diversions ?? '–'} diversions; longest wait with no departure ${Math.round(longest / 60)} min; ${w.kpi.conflictsIgnored} deadlock overrides)`);
}
process.exit(failed ? 1 : 0);
