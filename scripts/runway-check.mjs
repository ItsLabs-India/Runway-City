// Checks the two-runway system: both runways land traffic, wide-bodies stay on 07/25, the crossing interlock
// holds, roles and directions can change mid-day without stranding anyone, and a save restores it all.
// Usage: npm run check:runways
import { readFile } from 'node:fs/promises';
import { World, RUNWAY_PLANS } from '../src/sim/world.js';
import { AIRCRAFT_TYPES } from '../src/sim/aircraftTypes.js';

const map = JSON.parse(await readFile(new URL('../public/data/maa-map.json', import.meta.url), 'utf8'));
const start = Date.UTC(2026, 9, 29, 0, 30);
let failed = 0;
const ok = (name, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (!pass) failed++;
};
const make = (plan, extra = {}) => {
  const w = new World(map, { scenarioId: 'normal', startTime: start, weatherMode: 'calm', ...extra });
  w.setRunwayPlan(plan);
  return w;
};

// Watches a world for a while: runway use, interlock, stranded aircraft.
function watch(w, hours) {
  const out = { wide12: 0, both: 0, landed: {}, took: {}, lastDep: w.t, stuck: 0 };
  let deps = w.kpi.departures;
  const seen = new Set();
  for (let i = 0; i < hours * 3600; i++) {
    w.update(1);
    for (const f of w.flights) {
      if (f.phase === 'landing' && !seen.has(`L${f.id}`)) {
        seen.add(`L${f.id}`);
        const ref = w.runwayOf(f).ref;
        out.landed[ref] = (out.landed[ref] ?? 0) + 1;
        if (ref === '12/30' && AIRCRAFT_TYPES[f.type].code === 'E') out.wide12++;
      }
      if (f.phase === 'takeoff' && !seen.has(`T${f.id}`)) {
        seen.add(`T${f.id}`);
        const ref = w.runwayOf(f).ref;
        out.took[ref] = (out.took[ref] ?? 0) + 1;
        if (ref === '12/30' && AIRCRAFT_TYPES[f.type].code === 'E') out.wide12++;
      }
    }
    // Interlock: two movements that pass the crossing never at the same time.
    const st = w.runwayState();
    const moving = st.filter((r) => r.user && ((r.user.phase === 'landing' && r.usesCrossingArr) || (r.user.phase === 'takeoff' && r.usesCrossingDep)));
    if (moving.length === 2) out.both++;
    const waiting = w.flights.some((f) => f.phase === 'taxiOut' || f.phase === 'holdShort');
    if (w.kpi.departures !== deps || !waiting) {
      deps = w.kpi.departures;
      out.lastDep = w.t;
    }
    out.stuck = Math.max(out.stuck, w.t - out.lastDep);
  }
  return out;
}

// ---- dual landing --------------------------------------------------------------------------------------------
const a = make('dualLand');
const ra = watch(a, 12);
ok('dual landing uses both runways for landings', (ra.landed['07/25'] ?? 0) > 5 && (ra.landed['12/30'] ?? 0) > 5, JSON.stringify(ra.landed));
ok('take-offs stay on 07/25 in dual landing', !ra.took['12/30'], JSON.stringify(ra.took));
ok('wide-bodies never use 12/30', ra.wide12 === 0);
ok('traffic keeps flowing', ra.stuck < 3600, `longest wait with no departure ${Math.round(ra.stuck / 60)} min`);

// ---- every plan runs ----------------------------------------------------------------------------------------------
for (const id of Object.keys(RUNWAY_PLANS)) {
  if (id === 'dualLand') continue;
  const w = make(id);
  const r = watch(w, 6);
  const shape = { single: !r.landed['12/30'] && !r.took['12/30'], segregated: (r.landed['12/30'] ?? 0) > (r.landed['07/25'] ?? 0), dualMixed: (r.took['12/30'] ?? 0) > 0 }[id];
  ok(`plan ${id} does what it says`, shape && r.wide12 === 0 && r.stuck < 3600 && w.kpi.departures > 10, `land ${JSON.stringify(r.landed)} take-off ${JSON.stringify(r.took)}, ${w.kpi.diversions} diverted`);
}

// ---- the interlock ----------------------------------------------------------------------------------------------
const c = make('dualMixed');
if (c.main.active !== '25') c.switchRunway('07/25');
if (c.second.active !== '30') c.switchRunway('12/30');
const rc = watch(c, 8);
ok('25 + 30: nothing passes the crossing at the same time', rc.both === 0 && (rc.landed['12/30'] ?? 0) + (rc.took['12/30'] ?? 0) > 0, `${rc.both} overlaps; land ${JSON.stringify(rc.landed)}`);
ok('25 + 30 keeps moving', rc.stuck < 3600, `longest wait ${Math.round(rc.stuck / 60)} min`);

// ---- changing things mid-day --------------------------------------------------------------------------------------
const d = make('dualMixed');
d.update(3 * 3600);
const noLast = d.setRunwayMode('07/25', 'off');
ok('07/25 cannot be taken out of use', !noLast.ok, noLast.message);
d.setRunwayMode('07/25', 'dep');
const noLand = d.setRunwayMode('12/30', 'dep');
ok('something must always land', !noLand.ok, noLand.message);
d.setRunwayPlan('single');
ok('switching plan moves arrivals off 12/30', d.second.arrSlots.length === 0 || d.flights.every((f) => f.phase !== 'inbound' || d.runwayOf(f) === d.main));
d.update(30 * 60);
const rd = watch(d, 3);
ok('after going back to one runway nobody is stranded', rd.stuck < 3600 && !rd.landed['12/30'], `longest wait ${Math.round(rd.stuck / 60)} min`);
d.setRunwayPlan('dualLand');
let sw = d.switchRunway('12/30');
for (let i = 0; i < 600 && !sw.ok; i++) {
  d.update(5);
  sw = d.switchRunway('12/30');
}
ok('12/30 can change direction', sw.ok && d.second.active === '30', sw.message);
const closed = d.closeRunway(15, 'Check', '12/30');
ok('a runway closes on its own', closed.ok && d.runwayClosed(d.t, '12/30') && !d.runwayClosed(d.t, '07/25'));
d.reopenRunway('12/30');

// ---- saving ------------------------------------------------------------------------------------------------------------
const e = make('dualMixed');
e.update(2 * 3600);
const snap = e.snapshot();
const f = make('single');
f.restore(snap);
e.update(3600);
f.update(3600);
const sig = (w) => JSON.stringify([w.money, w.kpi.departures, w.kpi.arrivals, w.runways.map((R) => [R.active, R.mode, R.landings, R.takeoffs, R.user])]);
ok('a saved game restores both runways exactly', sig(e) === sig(f) && e.runwayPlan === f.runwayPlan);
const old = structuredClone(snap);
delete old.runways;
Object.assign(old, { active: '25', closures: [], arrSlots: [], runwayUser: null, lastDeparture: { t: -1e9, wake: 'M' } });
const g = make('dualLand');
g.restore(old);
ok('a save from before the second runway keeps it out of use', g.second.mode === 'off' && g.main.active === '25');

// ---- the taxiway queue on a new game's default plan: one busy day --------------------------------------------
const q = new World(map, { scenarioId: 'normal', startTime: start, weatherMode: 'calm' });
ok('a new game uses both runways for landing and take-off', q.runwayPlan === 'dualMixed' && q.main.mode === 'both' && q.second.mode === 'both');
const rolls = {};
const seenRoll = new Set();
let shortRoll = 0;
let stoppedMin = 0;
let longQueueMin = 0;
for (let i = 0; i < 24 * 3600; i++) {
  q.update(1);
  let queued = 0;
  for (const f of q.flights) {
    if ((f.phase === 'taxiOut' || f.phase === 'holdShort') && f.speed < 0.5) queued++;
    if (f.phase !== 'takeoff' || seenRoll.has(f.id)) continue;
    seenRoll.add(f.id);
    // A take-off roll starts at least the wake spacing after the last aircraft got airborne.
    const R = q.runwayOf(f);
    if (R.lastDeparture.t > 0 && R.lastDeparture.t !== rolls[R.ref] && q.t - R.lastDeparture.t < (R.lastDeparture.wake === 'H' ? 120 : 60) - 1.5) shortRoll++;
    rolls[R.ref] = R.lastDeparture.t;
  }
  stoppedMin += queued / 60;
  if (queued >= 4) longQueueMin += 1 / 60;
}
ok('take-off rolls keep wake spacing', shortRoll === 0, `${shortRoll} too close, ${seenRoll.size} take-offs`);
ok('departures spend little time stopped on the taxiways', stoppedMin < 650 && longQueueMin < 20, `${Math.round(stoppedMin)} aircraft-minutes a day, ${Math.round(longQueueMin)} min with 4 or more waiting`);

// A landing booked for the moment a closed runway reopens lands instead of going around.
const cl = new World(map, { scenarioId: 'normal', startTime: start, weatherMode: 'calm' });
cl.setRunwayPlan('single');
cl.update(2 * 3600);
while (cl.flights.filter((f) => f.phase === 'inbound').length < 2) cl.update(60); // wait for some landings to be booked
cl.closeRunway(10, 'Test closure', '07/25');
const closedTo = cl.main.closures.at(-1).to;
const ga0 = cl.kpi.goArounds;
const settled = cl.flights.filter((f) => f.phase === 'inbound' && f.slot >= closedTo);
cl.update(16 * 60);
const reopened = settled.filter((f) => f.phase === 'goAround' || f.phase === 'holding').length;
ok('landings booked after a closure do not go around because of it', settled.length > 0 && reopened === 0, `${settled.length} booked, ${cl.kpi.goArounds - ga0} go-arounds in all`);
process.exit(failed ? 1 : 0);
