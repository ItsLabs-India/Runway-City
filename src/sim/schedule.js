// Generates a realistic day of rotations at MAA (one aircraft: arrival → turnaround → departure).
// Deterministic per day seed. Times are seconds since IST midnight of day 0.
import { AIRCRAFT_TYPES } from './aircraftTypes.js';
import { DOMESTIC_AIRLINES, FOREIGN_AIRLINES, DOMESTIC_DEST } from './airlines.js';
import { seeded } from '../map/geometry.js';

const REAL_DAILY_DEPARTURES = 206; // summer 2026 count from the research notes

// Relative domestic arrivals by IST hour: quiet 00–05, banks in the morning and evening.
const DOMESTIC_HOURLY = [1, 0.5, 0.3, 0.3, 0.6, 2.2, 4.2, 5, 5.2, 5, 4.6, 4.2, 3.8, 3.6, 3.8, 4.2, 4.6, 5, 5.2, 5.4, 5.2, 4.6, 3.4, 2];

// `boost` is the Traffic option: 0.5 = half as many flights again as the scenario's own level, 1 = double.
export function buildSchedule({ daySeed = 1, traffic = 0.7, rush = 1, day = 0, timetable = null, boost = 0 } = {}) {
  const rnd = seeded(daySeed * 7919 + day * 104729);
  if (timetable?.length) return fromTimetable({ daySeed, day, timetable, traffic, rush, rnd, boost });
  const pick = (weights) => {
    const total = weights.reduce((a, w) => a + w, 0);
    let r = rnd() * total;
    for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) <= 0) return i;
    return weights.length - 1;
  };
  const usedNumbers = new Set();
  const flightNumber = (code, lo, hi) => {
    for (let i = 0; i < 50; i++) {
      const n = lo + 2 * Math.floor(rnd() * ((hi - lo) / 2)); // even; the departure takes n + 1
      const key = `${code}${n}`;
      if (!usedNumbers.has(key)) {
        usedNumbers.add(key);
        return n;
      }
    }
    return lo + Math.floor(rnd() * 9000);
  };
  const base = day * 86400;
  const rotations = [];
  let id = day * 10000;

  // Foreign airlines: fixed banks, wide-bodies and narrow-bodies from the Gulf and Asia.
  for (const a of FOREIGN_AIRLINES) {
    for (let k = 0; k < Math.round(a.perDay * (1 + boost)); k++) {
      if (rnd() > Math.min(1, traffic * rush + 0.25)) continue;
      const t = AIRCRAFT_TYPES[a.type];
      const sta = base + Math.round((a.banks[k % a.banks.length] + (rnd() - 0.5) * 0.3) * 3600);
      const ground = (t.turnMin + 20 + rnd() * 30) * 60;
      const num = flightNumber(a.code, 100, 600);
      const dest = a.dest[k % a.dest.length];
      rotations.push(makeRotation(++id, a, a.type, true, dest, num, sta, sta + ground, rnd));
    }
  }

  // Domestic carriers: hourly profile, fleet mix, some international legs for IndiGo / Air India Express.
  const target = Math.round(REAL_DAILY_DEPARTURES * traffic * rush * (1 + boost)) - rotations.length;
  for (let i = 0; i < target; i++) {
    const a = DOMESTIC_AIRLINES[pick(DOMESTIC_AIRLINES.map((x) => x.weight))];
    const intl = a.intl.length > 0 && rnd() < a.intlShare;
    const types = Object.keys(a.fleet);
    let type = types[pick(types.map((k) => a.fleet[k]))];
    let dest;
    if (intl) {
      dest = a.intl[Math.floor(rnd() * a.intl.length)];
      if (AIRCRAFT_TYPES[type].props) type = 'A21N';
    } else {
      const pool = AIRCRAFT_TYPES[type].props ? DOMESTIC_DEST.filter((d) => d[3]) : AIRCRAFT_TYPES[type].code === 'E' ? DOMESTIC_DEST.filter((d) => d[2] >= 6) : DOMESTIC_DEST; // widebodies fly the trunk routes
      dest = pool[pick(pool.map((d) => d[2]))][0];
    }
    const hour = intl ? [0, 1, 2, 3, 4, 20, 21, 22, 23, 9][Math.floor(rnd() * 10)] : pick(DOMESTIC_HOURLY);
    const sta = base + Math.round((hour + rnd()) * 3600);
    const t = AIRCRAFT_TYPES[type];
    const ground = (t.turnMin + 3 + rnd() * 22) * 60; // low-cost carriers turn fast
    const num = flightNumber(a.code, 100, 7800);
    rotations.push(makeRotation(++id, a, type, intl, dest, num, sta, sta + ground, rnd));
  }
  rotations.sort((p, q) => p.sta - q.sta);
  return rotations;
}

// A real timetable (public/data/timetable.json, made with scripts/import-timetable.mjs): every row
// is one rotation with its own flight numbers, valid on the weekdays listed in `days` (1 = Monday).
function fromTimetable({ daySeed, day, timetable, traffic, rush, rnd, boost }) {
  const date = new Date(Date.UTC(Math.floor(daySeed / 10000), (Math.floor(daySeed / 100) % 100) - 1, daySeed % 100) + day * 86400e3);
  const weekday = String(date.getUTCDay() || 7);
  const known = [...DOMESTIC_AIRLINES, ...FOREIGN_AIRLINES];
  const base = day * 86400;
  const keep = Math.min(1, traffic * rush); // scenarios thin the timetable out or leave it whole
  const out = [];
  let id = day * 10000;
  for (const r of timetable) {
    if (!r.days.includes(weekday) || (keep < 1 && rnd() > keep)) continue;
    const airline = known.find((a) => a.code === r.airline) ?? { code: r.airline, name: r.airline, callsign: r.airline };
    const sta = base + r.sta * 60;
    const std = base + (r.std < r.sta ? r.std + 1440 : r.std) * 60;
    const rot = makeRotation(++id, airline, r.type, r.intl, r.from, 0, sta, std, rnd);
    Object.assign(rot, { arrNo: r.arrNo, depNo: r.depNo, to: r.to ?? r.from });
    out.push(rot);
    // Extra sections for the Traffic option: copies a little earlier or later, with their own flight numbers.
    for (let c = 1; c <= Math.ceil(boost); c++) {
      if (rnd() >= Math.min(1, boost - (c - 1))) continue;
      const shift = Math.round((rnd() - 0.5) * 80) * 60;
      const extra = makeRotation(++id, airline, r.type, r.intl, r.from, 0, sta + shift, std + shift, rnd);
      const bump = (no) => no.replace(/\d+$/, (n) => String(Number(n) + 2000 * c));
      Object.assign(extra, { arrNo: bump(r.arrNo), depNo: bump(r.depNo), to: r.to ?? r.from });
      out.push(extra);
    }
  }
  return out.sort((p, q) => p.sta - q.sta);
}

function makeRotation(id, airline, type, intl, dest, num, sta, std, rnd) {
  const t = AIRCRAFT_TYPES[type];
  const load = 0.74 + rnd() * 0.22;
  // Some flights start late: most a few minutes, a few by much more.
  const late = rnd() < 0.55 ? 0 : rnd() < 0.8 ? rnd() * 12 * 60 : 12 * 60 + rnd() * 35 * 60;
  return {
    id,
    airline: airline.code,
    airlineName: airline.name,
    callsign: airline.callsign,
    type,
    intl,
    arrNo: `${airline.code} ${num}`,
    depNo: `${airline.code} ${num + 1}`,
    from: dest,
    to: dest,
    sta,
    std,
    inboundDelay: Math.round(late),
    paxIn: Math.round(t.seats * load),
    paxOut: Math.round(t.seats * (0.72 + rnd() * 0.25)),
  };
}
