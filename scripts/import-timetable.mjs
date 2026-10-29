// Turns an airline timetable CSV (for example one made from the DGCA seasonal "airline-wise
// schedules") into public/data/timetable.json, the real-timetable format the game understands.
//
//   node scripts/import-timetable.mjs schedule.csv [public/data/timetable.json]
//
// CSV columns (header row required, any order):
//   airline  IATA code, e.g. 6E          flight  number, e.g. 5273 or "6E 5273"
//   dir      ARR (into Chennai) or DEP   city    other airport's IATA code, e.g. DEL
//   time     local time HH:MM            type    ICAO aircraft type, e.g. A20N
//   days     weekdays operated, 1 = Monday ... 7 = Sunday, e.g. 1234567 or 135
//
// Arrivals and departures are paired into rotations: for each airline and aircraft type, an arrival
// is matched with the earliest unmatched departure that leaves at least the type's minimum turn
// time later (within 8 hours) on a shared weekday. Arrivals left without a departure get one
// generated from the minimum turn time, so no aircraft is stranded.
import { readFile, writeFile } from 'node:fs/promises';
import { AIRCRAFT_TYPES } from '../src/sim/aircraftTypes.js';
import { DOMESTIC_DEST } from '../src/sim/airlines.js';

const [input, output = 'public/data/timetable.json'] = process.argv.slice(2);
if (!input) {
  console.error('Usage: node scripts/import-timetable.mjs schedule.csv [out.json]');
  process.exit(1);
}

const lines = (await readFile(input, 'utf8')).split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
const head = lines.shift().split(',').map((h) => h.trim().toLowerCase());
const col = (name) => {
  const i = head.indexOf(name);
  if (i < 0) throw new Error(`Missing column "${name}" (found: ${head.join(', ')})`);
  return i;
};
const [cAir, cFlt, cDir, cCity, cTime, cType, cDays] = ['airline', 'flight', 'dir', 'city', 'time', 'type', 'days'].map(col);

const domestic = new Set(DOMESTIC_DEST.map((d) => d[0]));
const minutes = (hhmm) => {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`bad time "${hhmm}"`);
  return Number(m[1]) * 60 + Number(m[2]);
};

// "5273", "6E 5273" and "6E5273" all mean number 5273; a bare number is never cut.
const flightNumber = (raw) => {
  const v = raw.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{2}\d{1,4}$/.test(v) && /[A-Z]/.test(v.slice(0, 2)) ? v.slice(2) : v;
};

const arr = [];
const dep = [];
let bad = 0;
for (const line of lines) {
  const f = line.split(',').map((x) => x.trim());
  try {
    const type = f[cType].toUpperCase();
    if (!AIRCRAFT_TYPES[type]) throw new Error(`unknown aircraft type ${type}`);
    const row = {
      airline: f[cAir].toUpperCase(),
      no: flightNumber(f[cFlt]),
      city: f[cCity].toUpperCase(),
      t: minutes(f[cTime]),
      type,
      days: f[cDays].replace(/\D/g, ''),
    };
    (f[cDir].toUpperCase().startsWith('A') ? arr : dep).push(row);
  } catch (err) {
    bad++;
    console.warn(`skipped "${line}": ${err.message}`);
  }
}

const used = new Set();
const out = [];
for (const a of arr.sort((p, q) => p.t - q.t)) {
  const turn = AIRCRAFT_TYPES[a.type].turnMin;
  let match = null;
  for (const d of dep) {
    if (used.has(d) || d.airline !== a.airline || d.type !== a.type) continue;
    const gap = (d.t - a.t + 1440) % 1440;
    if (gap < turn || gap > 480) continue;
    if (![...d.days].some((x) => a.days.includes(x))) continue;
    if (!match || gap < match.gap) match = { d, gap };
  }
  if (match) used.add(match.d);
  out.push({
    airline: a.airline,
    arrNo: `${a.airline} ${a.no}`,
    depNo: match ? `${a.airline} ${match.d.no}` : `${a.airline} ${Number(a.no) + 1}`,
    from: a.city,
    to: match ? match.d.city : a.city,
    type: a.type,
    intl: !domestic.has(a.city),
    sta: a.t,
    std: match ? match.d.t : (a.t + turn + 10) % 1440,
    days: match ? [...match.d.days].filter((x) => a.days.includes(x)).join('') : a.days,
    generatedDeparture: !match,
  });
}
await writeFile(output, JSON.stringify(out));
const paired = out.filter((r) => !r.generatedDeparture).length;
console.log(`${arr.length} arrivals, ${dep.length} departures → ${out.length} rotations (${paired} paired, ${out.length - paired} with a generated departure, ${dep.length - used.size} departures left over, ${bad} rows skipped)`);
console.log(`written to ${output}`);
