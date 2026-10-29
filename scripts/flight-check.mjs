// Checks the flight details: renders every flight in every phase over a 24 h run without error, the
// sections come in order, and the recorded milestone times of each flight are in order.  npm run check:flights
import { readFile } from 'node:fs/promises';
import { World } from '../src/sim/world.js';
import { flightDetails } from '../src/ui/flightDetails.js';

const map = JSON.parse(await readFile(new URL('../public/data/maa-map.json', import.meta.url), 'utf8'));
const w = new World(map, { scenarioId: 'normal', startTime: Date.UTC(2026, 9, 29, 0, 30), weatherMode: 'calm' });
const ORDER = ['Status', 'Route', 'Timeline', 'Aircraft', 'Stand and turnaround', 'Passengers', 'Conditions'];
const phases = new Set();
let rendered = 0;
let badOrder = 0;
let badTimes = 0;
const seq = ['final', 'landed', 'onBlock', 'board', 'offBlock', 'airborne'];
for (let i = 0; i < 24 * 3600; i++) {
  w.update(1);
  if (i % 900 !== 0) continue;
  for (const f of w.flights) {
    const html = flightDetails(w, f);
    rendered++;
    phases.add(f.phase);
    const heads = [...html.matchAll(/<h4>([^<]+)<\/h4>/g)].map((m) => m[1]);
    if (heads.join('|') !== ORDER.join('|')) badOrder++;
    if (/undefined|NaN|\[object/.test(html)) badTimes++;
  }
}
// Milestones of every flight that completed its day must be in time order.
let unordered = 0;
let complete = 0;
for (const f of w.flights) {
  const t = f.times ?? {};
  const list = [t.final, t.landed, f.onBlock, t.board, f.offBlock, t.airborne].filter((x) => x !== undefined && x !== null);
  if (f.phase === 'departed' && f.times?.landed && t.airborne) complete++;
  for (let i = 1; i < list.length; i++) if (list[i] < list[i - 1] - 1) unordered++;
}
// The rarer states: cancelled, diverted, holding and go-around cards render too.
let rare = 0;
for (const phase of ['cancelled', 'diverted', 'holding', 'goAround']) {
  const f = { ...w.flights.find((x) => x.phase === 'scheduled') ?? w.flights[0], phase };
  if (!/Status/.test(flightDetails(w, f))) rare++;
}
const ok = (name, pass, detail = '') => console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
ok('every flight renders in every phase', rendered > 500 && badTimes === 0, `${rendered} cards, phases ${[...phases].join(', ')}`);
ok('sections always come in the same order', badOrder === 0);
ok('cancelled, diverted, holding and go-around cards render', rare === 0);
ok('flight milestones are in time order', unordered === 0 && complete > 20, `${complete} flights with a full record`);
process.exit(rare || badOrder || badTimes || unordered || complete <= 20 ? 1 : 0);
