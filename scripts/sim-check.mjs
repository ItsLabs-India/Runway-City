// Headless check: runs the simulation for N hours and audits overlaps, stuck flights and KPIs.
// Usage: node scripts/sim-check.mjs [scenario] [hours]
import { readFile } from 'node:fs/promises';
import { World, formatINR } from '../src/sim/world.js';
import { aircraftFootprint, vehiclePolygon, convexOverlap, partsOverlap } from '../src/sim/footprint.js';
import { AIRCRAFT_TYPES } from '../src/sim/aircraftTypes.js';
import { createLineIndex, gearDeviation } from '../src/sim/lineCheck.js';

const scenario = process.argv[2] ?? 'normal';
const hours = Number(process.argv[3] ?? 24);
const map = JSON.parse(await readFile(new URL('../public/data/maa-map.json', import.meta.url), 'utf8'));

const started = performance.now();
// Start at 06:00 IST on a fixed date so runs are repeatable.
const world = new World(map, { scenarioId: scenario, startTime: Date.UTC(2026, 9, 29, 0, 30) });
console.log(`init ${Math.round(performance.now() - started)} ms · ${world.flights.length} rotations · runway ${world.active}`);

const counts = { aircraftClash: 0, vehicleOnAircraft: 0, groundProximity: 0, maxGround: 0, maxParked: 0, maxVehicles: 0 };
const stuck = new Map();
const GROUND = ['taxiIn', 'taxiOut', 'pushback', 'turning', 'holdShort', 'lineUp'];
const clashLog = [];
// Line following: gear distance from the painted lines, sampled every 10 s for moving aircraft.
const lines = createLineIndex(world.graph);
const dev = { samples: 0, over1m: 0, max: 0, maxWhere: '', byPhase: {} };

const steps = hours * 3600;
for (let i = 0; i < steps; i++) {
  world.update(1);
  if (i % 10 === 0) {
    for (const f of world.flights) {
      if (!['taxiIn', 'taxiOut', 'pushback', 'lineUp', 'holdShort'].includes(f.phase)) continue;
      const d = gearDeviation(lines, f);
      const worst = Math.max(d.nose, d.main);
      dev.samples++;
      if (worst > 1) dev.over1m++;
      dev.byPhase[f.phase] = Math.max(dev.byPhase[f.phase] ?? 0, worst);
      if (worst > dev.max) [dev.max, dev.maxWhere] = [worst, `${f.depNo} ${f.phase} nose ${d.nose.toFixed(2)} m main ${d.main.toFixed(2)} m`];
    }
  }
  if (i % 60 !== 0) continue;
  const parked = world.flights.filter((f) => f.phase === 'atStand');
  const ground = world.flights.filter((f) => GROUND.includes(f.phase));
  counts.maxGround = Math.max(counts.maxGround, ground.length);
  counts.maxParked = Math.max(counts.maxParked, parked.length);
  counts.maxVehicles = Math.max(counts.maxVehicles, world.vehicles.length);
  const audit = world.audit();
  counts.aircraftClash += audit.aircraftClashes;

  // Parked/working vehicles must not overlap any parked aircraft.
  const prints = parked.map((f) => ({ f, parts: aircraftFootprint(f.type, f.x, f.y, f.heading) }));
  for (const v of world.vehicleSprites()) {
    if (v.kind === 'cone') continue;
    const veh = world.vehicles.find((x) => x.id === v.vehicleId);
    if (!veh || veh.state !== 'working' || veh.attached) continue;
    const poly = vehiclePolygon(v.kind, v.x, v.y, v.heading);
    for (const p of prints) {
      if (Math.hypot(p.f.x - v.x, p.f.y - v.y) > 90) continue;
      if (p.parts.some((part) => convexOverlap(poly, part))) {
        counts.vehicleOnAircraft++;
        if (clashLog.length < 5) clashLog.push(`${v.kind} on ${p.f.type} (${p.f.id === veh.flightId ? 'own' : 'neighbour'})`);
      }
    }
  }
  // Moving aircraft too close to each other.
  for (let a = 0; a < ground.length; a++) {
    for (let b = a + 1; b < ground.length; b++) {
      const fa = ground[a];
      const fb = ground[b];
      if (Math.hypot(fa.x - fb.x, fa.y - fb.y) > 100) continue;
      if (partsOverlap(aircraftFootprint(fa.type, fa.x, fa.y, fa.heading), aircraftFootprint(fb.type, fb.x, fb.y, fb.heading))) counts.groundProximity++;
    }
  }
  // Stuck detection: on the ground, not moving, same phase for 45 min.
  for (const f of ground) {
    const key = f.id;
    const prev = stuck.get(key);
    if (!prev || prev.phase !== f.phase || Math.hypot(prev.x - f.x, prev.y - f.y) > 2) stuck.set(key, { phase: f.phase, x: f.x, y: f.y, since: world.t, waiting: f.waiting });
    else prev.waiting = f.waiting;
  }
}

const stuckList = [...stuck.entries()]
  .map(([id, s]) => ({ id, ...s, f: world.flights.find((f) => f.id === id) }))
  .filter((s) => s.f && s.f.phase === s.phase && GROUND.includes(s.f.phase) && world.t - s.since > 45 * 60);

const k = world.kpi;
const phases = {};
for (const f of world.flights) phases[f.phase] = (phases[f.phase] ?? 0) + 1;
console.log(`ran ${hours} h in ${((performance.now() - started) / 1000).toFixed(1)} s`);
console.log('phases', phases);
console.log(`arrivals ${k.arrivals} · departures ${k.departures} · on-time ${k.departures ? Math.round((k.onTime / k.departures) * 100) : 0}% · avg dep delay ${k.departures ? Math.round(k.depDelaySum / k.departures / 60) : 0} min`);
console.log(`diversions ${k.diversions} · cancellations ${k.cancellations} · go-arounds ${k.goArounds} · conflict overrides ${k.conflictsIgnored} · satisfaction ${Math.round(k.satisfaction)}`);
console.log(`revenue ${formatINR(k.revenue)} · costs ${formatINR(k.costs)} · money ${formatINR(world.money)}`);
console.log(`peaks: ${counts.maxGround} taxiing, ${counts.maxParked} parked, ${counts.maxVehicles} vehicles`);
console.log(`OVERLAPS (sampled each minute): parked aircraft ${counts.aircraftClash}, vehicle on aircraft ${counts.vehicleOnAircraft}, taxiing aircraft ${counts.groundProximity}`);
if (clashLog.length) console.log('examples:', clashLog.join('; '));
console.log(
  `stuck on the ground > 45 min: ${stuckList.length}`,
  stuckList.slice(0, 6).map((s) => `#${s.id} ${s.f.arrNo}/${s.f.depNo} now ${s.f.phase} s=${Math.round(s.f.s)}/${Math.round(s.f.path?.total ?? 0)} for ${Math.round((world.t - s.since) / 60)} min "${s.f.waiting}"`).join(' | '),
);
console.log(`LINE FOLLOWING (${lines.segments} painted segments): ${dev.samples} samples, ${dev.over1m} with a gear > 1 m off a line, worst ${dev.max.toFixed(2)} m (${dev.maxWhere})`);
console.log('  worst by phase (m):', Object.fromEntries(Object.entries(dev.byPhase).map(([k, v]) => [k, Number(v.toFixed(2))])));
const delays = {};
for (const f of world.flights) if (f.delayCause && (f.depDelay ?? 0) > 900) delays[f.delayCause] = (delays[f.delayCause] ?? 0) + 1;
console.log('delay causes (dep delay > 15 min):', delays);
console.log('last log:', world.log.slice(0, 6).map((l) => l.text).join(' | '));
