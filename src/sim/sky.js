// The sun over Chennai: elevation and azimuth from the date and time (NOAA solar position
// approximation, accurate to well under a degree), sunrise and sunset, how much daylight there is
// and the colour of the sky tint. Pure functions, no DOM.
//
// Game time `t` is seconds on the IST wall clock (the day starts at t % 86400 = 0), so UTC is t - 19800.
const RAD = Math.PI / 180;
export const MAA = { lat: 12.9941, lon: 80.1709 };
const IST_S = 19800;

// Sun position: elevation above the horizon and compass azimuth (0 = north, 90 = east), degrees.
export function sunAt(t) {
  const jd = (t - IST_S) / 86400 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const ha = ((gmst * 15 + MAA.lon) * RAD) - ra;
  const lat = MAA.lat * RAD;
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) + Math.PI;
  return { el: el / RAD, az: ((az / RAD) % 360 + 360) % 360 };
}

const dayCache = new Map();

// Sunrise and sunset (seconds into the day, IST) for the day containing t.
export function sunTimes(t) {
  const day = Math.floor(t / 86400);
  if (dayCache.has(day)) return dayCache.get(day);
  let rise = null;
  let set = null;
  let prev = sunAt(day * 86400).el;
  for (let m = 1; m <= 1440; m++) {
    const el = sunAt(day * 86400 + m * 60).el;
    if (prev < -0.833 && el >= -0.833 && rise === null) rise = m * 60;
    if (prev >= -0.833 && el < -0.833 && set === null) set = m * 60;
    prev = el;
  }
  const out = { rise, set };
  dayCache.set(day, out);
  if (dayCache.size > 8) dayCache.delete(dayCache.keys().next().value);
  return out;
}

const smooth = (a, b, x) => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

// Daylight 0..1 from the sun's elevation: full light above 10°, darkness below -12°, with a
// little moon and city glow so the night is never black.
export const daylight = (el) => 0.05 + 0.95 * smooth(-12, 10, el);

// Sky tint over the map: [elevation, r, g, b, alpha] stops from full day to deep night.
const TINT = [
  [12, 255, 255, 255, 0], [6, 255, 214, 170, 0.05], [0, 255, 158, 84, 0.16], [-4, 150, 96, 118, 0.30],
  [-8, 48, 58, 112, 0.46], [-14, 10, 18, 48, 0.64],
];

export function skyTint(el) {
  if (el >= TINT[0][0]) return { r: 255, g: 255, b: 255, a: 0 };
  if (el <= TINT.at(-1)[0]) return { r: TINT.at(-1)[1], g: TINT.at(-1)[2], b: TINT.at(-1)[3], a: TINT.at(-1)[4] };
  for (let i = 1; i < TINT.length; i++) {
    const [e1, ...c1] = TINT[i - 1];
    const [e2, ...c2] = TINT[i];
    if (el <= e1 && el >= e2) {
      const k = (e1 - el) / (e1 - e2);
      return { r: c1[0] + (c2[0] - c1[0]) * k, g: c1[1] + (c2[1] - c1[1]) * k, b: c1[2] + (c2[2] - c1[2]) * k, a: c1[3] + (c2[3] - c1[3]) * k };
    }
  }
  return { r: 255, g: 255, b: 255, a: 0 };
}

// Name of the part of the day, for the clock and the panels.
export function dayPhase(el, t) {
  const morning = (t % 86400) < 43200;
  if (el > 6) return 'Day';
  if (el > -6) return morning ? 'Sunrise' : 'Sunset';
  if (el > -12) return morning ? 'Dawn' : 'Dusk';
  return 'Night';
}

// How much of the sunlight reaches the ground directly (0..1), from the weather: thin cloud lets it
// through, overcast, rain and fog scatter it, so shadows soften and disappear.
export function directSun(w) {
  if (!w) return 1;
  const cloud = 1 - 0.95 * smooth(0.45, 0.95, w.cloud ?? 0);
  const rain = 1 - smooth(0, 0.35, w.rain ?? 0);
  const fog = smooth(600, 4000, w.vis ?? 10000);
  return cloud * rain * fog;
}

// The one shadow rule everything uses. The point of an object h metres up falls (ux, uy) * h from the
// point below it: away from the sun (azimuth az), longer the lower the sun. x east, y south. alpha:
// how strong the shadow is (none at night, fading at sunrise and sunset and in dull weather).
export function sunShadow(sun) {
  if (sun.el <= 0) return { ux: 0, uy: 0, alpha: 0 };
  // Capped at twice the height (sun about 27° up): lower still, the direction keeps turning but the
  // shadow does not run away from what casts it, and it fades instead.
  const perMetre = Math.min(2, 1 / Math.tan(Math.max(sun.el, 3.5) * RAD));
  const away = (sun.az + 180) * RAD;
  return { ux: Math.sin(away) * perMetre, uy: -Math.cos(away) * perMetre, alpha: smooth(0, 14, sun.el) * (sun.clear ?? 1) };
}

// Shadow cast by the top of a thing `h` metres tall.
export function shadowOf(sun, h = 10) {
  const s = sunShadow(sun);
  return { dx: s.ux * h, dy: s.uy * h, alpha: s.alpha };
}
