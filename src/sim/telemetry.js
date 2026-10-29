// What a flight's instruments would read right now: speeds, altitude, vertical speed, heading, distance to go,
// thrust, configuration, fuel, transponder. Derived from the simulation state of the flight (pure, no DOM).
// Speeds in the sim are metres per second and heights metres; everything here is in aviation units.
import { AIRCRAFT_TYPES } from './aircraftTypes.js';
import { distanceKm } from './airlines.js';

const KT = 0.5144;
const FT = 0.3048;
const GLIDE = Math.tan((3 * Math.PI) / 180);
const TOUCHDOWN_M = 350;
export const FIELD_ELEVATION_FT = 52; // Chennai airport is 16 m above sea level

const LIVE = new Set(['final', 'goAround', 'landing', 'taxiIn', 'atStand', 'pushback', 'turning', 'taxiOut', 'holdShort', 'lineUp', 'takeoff']);
const TAXI = ['taxiIn', 'taxiOut', 'lineUp', 'holdShort'];

const flightNo = (f) => (['atStand', 'pushback', 'turning', 'taxiOut', 'holdShort', 'lineUp', 'takeoff', 'departed'].includes(f.phase) ? f.depNo : f.arrNo);

// Squawk code from the flight id: four octal digits, never an emergency code.
export function squawk(id) {
  const d = [1 + (id % 6), (id * 3 + 2) % 8, (id * 5 + 3) % 8, (id * 7 + 1) % 8];
  return d.join('');
}

export function telemetry(w, f) {
  const t = AIRCRAFT_TYPES[f.type];
  const base = { callsign: `${f.callsign} ${flightNo(f).replace(/^\D+\s*/, '')}`, squawk: squawk(f.id), type: t, engines: t.engines };
  if (!LIVE.has(f.phase)) {
    const notes = {
      scheduled: `Not yet on the way. Due at ${f.sta}`,
      holding: 'Holding for a stand or a landing slot',
      inbound: 'In the arrival sequence, not yet in range',
      departed: 'Has left the area',
      diverted: 'Diverted to another airport',
      cancelled: 'Cancelled',
    };
    return { ...base, live: false, note: notes[f.phase] ?? '', etaT: f.phase === 'inbound' ? f.slot : f.phase === 'scheduled' ? f.eta : null };
  }

  const phase = f.phase;
  const gs = f.speed / KT;
  const bearing = (((90 + (f.heading * 180) / Math.PI) % 360) + 360) % 360;
  const dir = ((w.wind.from - bearing) * Math.PI) / 180;
  const head = w.wind.kt * Math.cos(dir);
  const cross = w.wind.kt * Math.sin(dir);
  const flying = ['final', 'goAround', 'landing', 'takeoff'].includes(phase);
  const ias = flying ? Math.max(0, gs + head) : null;
  const aglFt = f.alt / FT;
  const mslFt = aglFt + FIELD_ELEVATION_FT;

  // Vertical speed: 3° glide on final, a steady climb after rotation and in a go-around.
  let vsFpm = 0;
  if (phase === 'final' && f.alt > 1) vsFpm = -((f.vApp * GLIDE) / FT) * 60;
  else if (phase === 'goAround') vsFpm = (9 / FT) * 60;
  else if (phase === 'takeoff' && f.speed > f.vRot) vsFpm = (9 / FT) * 60;

  // Distance still to go, or covered, with what it is measured to.
  let dist = null;
  let distLabel = '';
  let etaT = null;
  if (phase === 'final') {
    dist = Math.max(0, (f.slot - w.t) * f.vApp);
    distLabel = `to touchdown on ${w.active}`;
    etaT = f.slot;
  } else if (phase === 'goAround') {
    distLabel = 'going around: climbing out, then back round';
  } else if (phase === 'landing') {
    dist = Math.max(0, f.s - TOUCHDOWN_M);
    distLabel = 'rolled since touchdown';
  } else if (phase === 'takeoff') {
    dist = Math.max(0, f.s);
    distLabel = 'rolled on the runway';
  } else if (['taxiIn', 'taxiOut', 'pushback'].includes(phase) && f.path) {
    dist = Math.max(0, f.limit - f.s);
    distLabel = phase === 'taxiIn' ? 'to the stand' : phase === 'taxiOut' ? 'to the hold-short line' : 'of push-back to go';
  }

  // Configuration, matching what the aircraft drawing shows.
  const gearDown = !(phase === 'goAround' && f.alt > 30) && !(phase === 'takeoff' && f.alt > 15) && !(phase === 'final' && f.alt > 600);
  let flaps = 'UP';
  if (phase === 'final') flaps = f.alt > 300 ? 'CONF 3' : 'FULL';
  else if (phase === 'landing') flaps = 'FULL';
  else if (phase === 'goAround') flaps = 'CONF 3';
  else if (phase === 'takeoff') flaps = f.alt < 500 ? 'CONF 1+F' : 'UP';
  else if (['holdShort', 'lineUp'].includes(phase)) flaps = 'CONF 1+F (set)';
  const rolling = phase === 'landing' && f.alt <= 0.5 && f.speed > 24;

  // Thrust (N1, estimated from the phase) and engine state.
  let n1 = null;
  let engineNote = '';
  if (phase === 'atStand') engineNote = 'off, on ground power';
  else if (phase === 'pushback') engineNote = 'starting';
  else if (phase === 'turning') engineNote = 'starting';
  else if (phase === 'final') n1 = 52;
  else if (phase === 'goAround') n1 = 96;
  else if (phase === 'landing') n1 = rolling ? 62 : 26; // reverse thrust, then idle
  else if (phase === 'takeoff') n1 = f.speed > f.vRot ? 92 : Math.min(92, 40 + (f.speed / f.vRot) * 52);
  else if (TAXI.includes(phase)) n1 = f.speed < 1 ? 22 : 28 + Math.min(6, f.speed);
  const reverse = rolling;

  // Fuel on board (a tonne figure estimated from the aircraft and the route).
  const sector = distanceKm('MAA', f.to) ?? 1200;
  const arrFuel = 0.032 * t.mtow;
  const depFuel = 0.03 * t.mtow + sector * t.mtow * 0.00004 * (t.wake === 'H' ? 0.95 : 1);
  const fuelTask = f.tasks?.find((x) => x.id === 'fuel');
  let fuel = arrFuel;
  if (['pushback', 'turning', 'taxiOut', 'holdShort', 'lineUp', 'takeoff'].includes(phase) || fuelTask?.state === 'done') fuel = depFuel;
  else if (fuelTask?.state === 'work') fuel = arrFuel + (depFuel - arrFuel) * Math.max(0, Math.min(1, 1 - (fuelTask.end - w.t) / fuelTask.dur));
  if (phase === 'taxiOut') fuel -= 0.0004 * t.mtow * Math.max(0, (f.s ?? 0) / 100);
  if (phase === 'takeoff') fuel -= 0.003 * t.mtow;

  const lights = ['nav'];
  if (phase !== 'atStand') lights.push('beacon', 'strobe');
  if (['final', 'landing', 'takeoff', 'goAround'].includes(phase)) lights.push('landing');
  if (TAXI.includes(phase)) lights.push('taxi');

  return {
    ...base, live: true, phase, gs, ias, bearing, head, cross, aglFt, mslFt, vsFpm, dist, distLabel, etaT,
    gearDown, flaps, spoilers: rolling, reverse, n1, engineNote, fuel, lights, airborne: f.alt > 1,
    vApp: f.vApp / KT, vRot: f.vRot / KT, qnh: w.weather.now.qnh,
  };
}

// One sample for the speed / altitude trace of the selected flight.
export function sample(w, f) {
  const x = telemetry(w, f);
  return x.live ? { t: w.t, gs: x.gs, alt: x.mslFt } : null;
}
