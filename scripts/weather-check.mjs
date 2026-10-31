// Checks the weather, daylight and lighting rules headlessly.  Usage: npm run check:weather
//  - the sun: sunrise and sunset in Chennai are plausible for every season
//  - the climate: rain, fog and storms follow the seasons; calm mode has none
//  - determinism: the same seed gives the same weather, and a save restores it exactly
//  - lighting logic: floodlights on at night and off at noon, runway lights follow darkness and visibility
//  - rules: lightning stops ramp work then lifts, rain slows taxiing, a lighting fault slows work, low visibility widens spacing
import { readFile } from 'node:fs/promises';
import { World } from '../src/sim/world.js';
import { Weather, seasonOf } from '../src/sim/weather.js';
import { sunTimes, shadowOf, directSun } from '../src/sim/sky.js';
import { AIRCRAFT_TYPES } from '../src/sim/aircraftTypes.js';

const map = JSON.parse(await readFile(new URL('../public/data/maa-map.json', import.meta.url), 'utf8'));
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failed++;
};
const hhmm = (s) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;

// ---- the sun ---------------------------------------------------------------------------------------
const real = { 0: [6.35, 6.75, 17.9, 18.2], 5: [5.2, 5.8, 18.3, 18.7], 11: [6.0, 6.4, 17.5, 17.9] }; // month: [rise from, to, set from, to] hours
for (const [m, [r0, r1, s0, s1]] of Object.entries(real)) {
  const st = sunTimes(Date.UTC(2026, Number(m), 15) / 1000);
  check(`sunrise and sunset, month ${Number(m) + 1}`, st.rise / 3600 >= r0 && st.rise / 3600 <= r1 && st.set / 3600 >= s0 && st.set / 3600 <= s1, `${hhmm(st.rise)} / ${hhmm(st.set)}`);
}

// ---- the climate -----------------------------------------------------------------------------------
const t0 = Date.UTC(2026, 9, 29) / 1000;
const share = (month, mode = 'random') => {
  let rain = 0;
  let fog = 0;
  let storm = 0;
  let n = 0;
  for (let d = 0; d < 40; d++) {
    const w = new Weather({ seed: 20260000 + d * 7, t0: t0 + d * 86400, month, mode });
    for (let h = 0; h < 24; h++) {
      const x = w.at(t0 + d * 86400 + h * 3600);
      n++;
      if (x.rain > 0.1) rain++;
      if (x.type === 'fog' || x.type === 'mist') fog++;
      if (x.lightning) storm++;
    }
  }
  return { rain: rain / n, fog: fog / n, storm: storm / n };
};
const winter = share(0);
const ne = share(10);
const sw = share(7);
check('north-east monsoon is the wettest season', ne.rain > sw.rain && sw.rain > winter.rain, `${(ne.rain * 100).toFixed(0)} % / ${(sw.rain * 100).toFixed(0)} % / ${(winter.rain * 100).toFixed(0)} %`);
check('fog and mist only happen in winter', share(6).fog === 0 && share(3).fog === 0 && winter.fog > 0, `winter ${(winter.fog * 100).toFixed(1)} %`);
check('thunderstorms happen in the hot season', share(4).storm > 0);
const calm = share(10, 'calm');
check('calm mode has no rain, fog or storms', calm.rain === 0 && calm.fog === 0 && calm.storm === 0);

// ---- determinism and saving ----------------------------------------------------------------------------
const a = new Weather({ seed: 99, t0, month: 10 });
const b = new Weather({ seed: 99, t0, month: 10 });
check('same seed gives the same weather', JSON.stringify(a.at(t0 + 30000)) === JSON.stringify(b.at(t0 + 30000)));
const c = Weather.restore(JSON.parse(JSON.stringify(a.snapshot())));
check('a saved weather restores exactly', JSON.stringify(c.at(t0 + 50000)) === JSON.stringify(a.at(t0 + 50000)));

// ---- lighting logic ---------------------------------------------------------------------------------------
const world = (hour, mode = 'calm', scenarioId = 'normal') => new World(map, { scenarioId, startTime: Date.UTC(2026, 9, 29, hour, 0) - 5.5 * 3600e3, weatherMode: mode });
const noon = world(12);
const night = world(23);
check('apron floodlights off at noon, on at night', !noon.lights.apron && night.lights.apron);
check('runway lights off by day in clear air, on at night', noon.lights.rwyStep === 0 && night.lights.rwyStep >= 3, `noon ${noon.lights.rwyStep}, night ${night.lights.rwyStep}`);
check('night is dark and noon is bright', night.lights.amb < 0.1 && noon.lights.amb > 0.9, `${night.lights.amb.toFixed(2)} / ${noon.lights.amb.toFixed(2)}`);
night.setLighting('runway', 1);
check('runway lights cannot be dimmed below the safe minimum in the dark', night.lights.rwyStep >= 2);
night.setLighting('apron', 'off');
check('apron lights can be switched off, and then ramp work is slower', !night.lights.apron && night.fx.ramp > 1.25, `ramp ×${night.fx.ramp.toFixed(2)}`);
const costOn = world(23).lightingCostPerHour();
check('lighting costs money at night, none-ish by day', costOn > noon.lightingCostPerHour(), `${costOn} vs ${noon.lightingCostPerHour()} rupees/h`);

// ---- rules ------------------------------------------------------------------------------------------------------
const w = world(12, 'random');
const force = (type, hoursAhead = 10) => {
  w.weather.spells = [{ type, start: w.t - 3600, end: w.t + hoursAhead * 3600, scale: 1, seed: 11 }];
  w.weather.update(w.t, 0);
  w.nextEnv = 0;
  w.update(30);
};
force('clear');
const dry = w.sepScale;
const groundDry = w.fx.ground;
force('heavy');
check('heavy rain slows taxiing and widens landing spacing', w.fx.ground < groundDry - 0.1 && w.sepScale > dry, `taxi ×${w.fx.ground.toFixed(2)}, spacing ×${w.sepScale.toFixed(2)}`);
force('fog');
check('fog brings low-visibility procedures', w.visibility() < 1200 && w.sepScale >= 1.9, `${Math.round(w.visibility())} m, spacing ×${w.sepScale.toFixed(1)}`);
force('storm');
check('thunderstorm closes the ramp', w.rampClosed === true);
force('clear');
w.update(900);
check('the ramp reopens ten minutes after the last lightning', w.rampClosed === false);
w.lighting.dark = { x: w.stands[0].x, y: w.stands[0].y, r: 260, until: w.t + 3600 };
check('a lighting fault darkens the apron around its centre', w.darkAt(w.stands[0].x, w.stands[0].y) && !w.darkAt(w.stands[0].x + 900, w.stands[0].y));

// ---- a saved game keeps the weather ------------------------------------------------------------------------------
const day = world(6, 'random');
day.update(4 * 3600);
const snap = day.snapshot();
const again = world(6, 'random');
again.restore(snap);
day.update(3600);
again.update(3600);
check('save and load: weather, lights and wind identical an hour later', JSON.stringify([day.weather.now, day.lights, day.wind]) === JSON.stringify([again.weather.now, again.lights, again.wind]));

// ---- shadows follow the sun and the weather --------------------------------------------------------------------
const sunE = shadowOf({ el: 30, az: 90 }, 10);
const sunS = shadowOf({ el: 30, az: 180 }, 10);
check('a shadow falls away from the sun (sun east: west; sun south: north; y is south)', sunE.dx < -1 && Math.abs(sunE.dy) < 0.01 && sunS.dy < -1 && Math.abs(sunS.dx) < 0.01);
check('a low sun makes longer shadows', Math.abs(shadowOf({ el: 15, az: 90 }, 10).dx) > Math.abs(shadowOf({ el: 70, az: 90 }, 10).dx) * 3);
check('a shadow grows with height, so low parts stay near the aircraft', Math.abs(shadowOf({ el: 30, az: 90 }, 12).dx / shadowOf({ el: 30, az: 90 }, 4).dx - 3) < 1e-6);
check('no shadow at night', shadowOf({ el: -5, az: 90 }, 10).alpha === 0);
check('clear sky gives full shadows; rain, overcast and fog take them away', directSun({ cloud: 0.04, rain: 0, vis: 10000 }) === 1 && directSun({ cloud: 0.9, rain: 0.5, vis: 3000 }) < 0.05 && directSun({ cloud: 0.95, rain: 0, vis: 7000 }) < 0.1 && directSun({ cloud: 0.3, rain: 0, vis: 500 }) < 0.05);
check('every aircraft type has a real height for its shadow', Object.values(AIRCRAFT_TYPES).every((t) => t.height > 3 && t.height < 25));

console.log(failed ? `\n${failed} check(s) failed` : '\nall weather checks passed');
process.exit(failed ? 1 : 0);
