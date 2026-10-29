// Weather for Chennai: a seeded sequence of weather "spells" (clear, rain, thunderstorm, fog ...) chosen with
// the real seasons in mind (north-east monsoon October to December, south-west monsoon June to
// September, thunderstorms in the hot afternoons of March to May, mist and haze on winter mornings),
// blended smoothly into each other. Pure and deterministic (own random generator, saved with the game),
// so the forecast is exact and a restored game sees the same weather. No DOM.
import { seeded } from '../map/geometry.js';

// Properties of each kind of spell. vis in metres, ceil = cloud base in feet.
export const SPELLS = {
  clear:    { label: 'Clear',          cloud: 0.04, rain: 0,    storm: 0, vis: 10000, ceil: 99999, mins: [180, 420] },
  fair:     { label: 'Few clouds',     cloud: 0.25, rain: 0,    storm: 0, vis: 10000, ceil: 4500,  mins: [120, 300] },
  cloudy:   { label: 'Cloudy',         cloud: 0.6,  rain: 0,    storm: 0, vis: 9000,  ceil: 2800,  mins: [90, 240] },
  overcast: { label: 'Overcast',       cloud: 0.92, rain: 0,    storm: 0, vis: 7000,  ceil: 1500,  mins: [90, 240] },
  haze:     { label: 'Haze',           cloud: 0.2,  rain: 0,    storm: 0, vis: 4500,  ceil: 99999, mins: [120, 300] },
  mist:     { label: 'Mist',           cloud: 0.3,  rain: 0,    storm: 0, vis: 2500,  ceil: 99999, mins: [60, 150] },
  fog:      { label: 'Fog',            cloud: 0.4,  rain: 0,    storm: 0, vis: 600,   ceil: 200,   mins: [60, 180] },
  smoke:    { label: 'Smoke haze',     cloud: 0.2,  rain: 0,    storm: 0, vis: 800,   ceil: 99999, mins: [120, 180] },
  drizzle:  { label: 'Drizzle',        cloud: 0.85, rain: 0.2,  storm: 0, vis: 5000,  ceil: 1200,  mins: [40, 120] },
  rain:     { label: 'Rain',           cloud: 0.95, rain: 0.55, storm: 0, vis: 3500,  ceil: 1000,  mins: [40, 150] },
  heavy:    { label: 'Heavy rain',     cloud: 1,    rain: 1,    storm: 0, vis: 1500,  ceil: 600,   mins: [30, 90] },
  storm:    { label: 'Thunderstorm',   cloud: 1,    rain: 0.85, storm: 1, vis: 2000,  ceil: 800,   mins: [20, 50] },
};

// Mean daily maximum and minimum temperature (°C) by month.
const TEMPS = [[30, 21], [32, 22], [34, 24], [36, 26], [38, 28], [37, 27], [35, 26], [35, 26], [34, 25], [32, 24], [30, 23], [29, 21]];

// How likely each spell is in each season (relative weights).
const SEASON = {
  winter: { clear: 40, fair: 25, haze: 14, cloudy: 8, mist: 5, fog: 3, drizzle: 3, rain: 2 },
  summer: { clear: 30, fair: 28, haze: 14, cloudy: 10, storm: 9, rain: 5, overcast: 4 },
  swMonsoon: { fair: 22, cloudy: 26, clear: 10, drizzle: 12, rain: 14, storm: 6, overcast: 8 },
  neMonsoon: { cloudy: 18, overcast: 15, fair: 12, clear: 6, drizzle: 12, rain: 20, heavy: 8, storm: 6 },
};
export const seasonOf = (month) => (month <= 1 ? 'winter' : month <= 4 ? 'summer' : month <= 8 ? 'swMonsoon' : month <= 10 ? 'neMonsoon' : 'winter');
export const SEASON_LABEL = { winter: 'Winter', summer: 'Hot season', swMonsoon: 'South-west monsoon', neMonsoon: 'North-east monsoon' };

// What tends to follow what.
const AFTER = {
  drizzle: { rain: 2, cloudy: 1.5, overcast: 1.5 },
  rain: { heavy: 2, drizzle: 1.5, cloudy: 1.5, storm: 1.4 },
  heavy: { rain: 3, storm: 1.5, drizzle: 1.5 },
  storm: { rain: 2.5, cloudy: 1.5, overcast: 1.5, clear: 0.4 },
  fog: { haze: 2.5, mist: 1.5, clear: 1.5, fair: 1.5 },
  mist: { haze: 2, fog: 1.2, clear: 1.5 },
  smoke: { haze: 3, clear: 1.5 },
  cloudy: { overcast: 1.5, drizzle: 1.3, fair: 1.3 },
  overcast: { drizzle: 2, rain: 2 },
};

const CALM = ['clear', 'fair', 'cloudy', 'haze'];
const BLEND_MIN = { fog: 40, smoke: 30, storm: 12, heavy: 18 };

const smooth = (x) => {
  const k = Math.max(0, Math.min(1, x));
  return k * k * (3 - 2 * k);
};
const lerp = (a, b, k) => a + (b - a) * k;
const hash = (i) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
// Smooth value noise in 0..1.
const noise = (x) => {
  const i = Math.floor(x);
  return lerp(hash(i), hash(i + 1), smooth(x - i));
};

export class Weather {
  // opts: { seed, t0 (game seconds), month (0-11), mode 'random' | 'calm', bias {type: multiplier}, forced [{type, at (minutes after t0), minutes}] }
  constructor({ seed, t0, month, mode = 'random', bias = {}, forced = [] }) {
    this.seed = seed;
    this.month = month;
    this.mode = mode;
    this.bias = bias;
    this.rnd = seeded(seed * 31 + 17);
    this.spells = [];
    this.wet = 0;
    this.t0 = t0;
    this._first(t0, forced);
    this.ensure(t0 + 6 * 3600);
    this.now = this.at(t0);
  }

  // ---- generating the spells ---------------------------------------------------------------------

  _weights(prev, hour) {
    const base = { ...SEASON[seasonOf(this.month)] };
    const out = {};
    const wet = this.month >= 9 || (this.month >= 5 && this.month <= 8);
    for (const [type, w0] of Object.entries(base)) {
      if (this.mode === 'calm' && !CALM.includes(type)) continue;
      let w = w0 * (this.bias[type] ?? 1);
      if (type === 'storm') w *= wet ? (hour >= 15 || hour < 2 ? 1.5 : 0.9) : hour >= 13 && hour < 22 ? 2.5 : 0.4;
      if ((type === 'fog' || type === 'mist') && hour >= 9) w = 0;
      if (type === 'fog' && hour < 2) w *= 0.5;
      if (type === 'haze' && hour >= 6 && hour < 11) w *= 1.4;
      if (prev) {
        if (type === prev) w *= 0.15;
        w *= AFTER[prev]?.[type] ?? 1;
      }
      out[type] = w;
    }
    if (this.mode === 'calm') for (const t of CALM) out[t] ??= 1;
    return out;
  }

  _pick(prev, t) {
    const hour = Math.floor((t % 86400) / 3600);
    const w = this._weights(prev, hour);
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    let r = this.rnd() * total;
    for (const [type, wt] of Object.entries(w)) {
      r -= wt;
      if (r <= 0) return type;
    }
    return 'clear';
  }

  _spell(type, start, minutes) {
    const [lo, hi] = SPELLS[type].mins;
    const mins = minutes ?? lo + this.rnd() * (hi - lo);
    return { type, start, end: start + mins * 60, scale: 0.8 + this.rnd() * 0.35, seed: Math.floor(this.rnd() * 1e6) };
  }

  _first(t0, forced) {
    let t = t0 - Math.floor(this.rnd() * 50) * 60; // we start part-way through a spell
    let prev = null;
    for (const f of [...forced].sort((a, b) => a.at - b.at)) {
      const at = t0 + f.at * 60;
      while (t < at - 600) {
        const s = this._spell(this._pick(prev, t), t);
        s.end = Math.min(s.end, at);
        this.spells.push(s);
        t = s.end;
        prev = s.type;
      }
      const sp = this._spell(f.type, t, f.minutes);
      sp.end = Math.max(t + 600, at + f.minutes * 60);
      this.spells.push(sp);
      t = sp.end;
      prev = f.type;
    }
    if (!this.spells.length) this.spells.push(this._spell(this._pick(null, t), t));
  }

  ensure(horizon) {
    let t = this.spells.length ? this.spells.at(-1).end : this.t0;
    let prev = this.spells.at(-1)?.type ?? null;
    while (t < horizon) {
      const s = this._spell(this._pick(prev, t), t);
      this.spells.push(s);
      t = s.end;
      prev = s.type;
    }
  }

  // ---- the weather at a time ------------------------------------------------------------------------

  _index(t) {
    let i = this.spells.length - 1;
    while (i > 0 && this.spells[i].start > t) i--;
    return i;
  }

  // Weather state at time t (no memory of recent rain; that is `wet`).
  at(t) {
    this.ensure(t + 3 * 3600);
    const i = this._index(t);
    const cur = this.spells[i];
    const prev = this.spells[Math.max(0, i - 1)];
    const A = SPELLS[prev.type];
    const B = SPELLS[cur.type];
    const k = i === 0 ? 1 : smooth((t - cur.start) / ((BLEND_MIN[cur.type] ?? 25) * 60));
    const wob = noise(t / 780 + cur.seed);
    const rain = lerp(A.rain * prev.scale, B.rain * cur.scale, k) * (0.6 + 0.8 * wob);
    const storm = lerp(A.storm, B.storm, k) * (0.55 + 0.45 * noise(t / 400 + cur.seed * 3));
    const cloud = Math.min(1, lerp(A.cloud, B.cloud, k) + (noise(t / 1500 + cur.seed) - 0.5) * 0.12);
    const vis = Math.max(150, lerp(A.vis, B.vis, k) * (cur.type === 'fog' || cur.type === 'smoke' ? 0.75 + 0.5 * wob : 1) * (1 - 0.3 * Math.min(1, rain)));
    const ceil = lerp(Math.min(A.ceil, 30000), Math.min(B.ceil, 30000), k);
    const type = k < 0.5 ? prev.type : cur.type;
    // Temperature: warmest at 14:30, coolest at 05:30; cloud and rain cool the day.
    const [tmax, tmin] = TEMPS[this.month];
    const h = (t % 86400) / 3600;
    const dayK = h >= 5.5 && h <= 14.5 ? (1 - Math.cos(((h - 5.5) / 9) * Math.PI)) / 2 : 1 - (1 - Math.cos((((h < 5.5 ? h + 24 : h) - 14.5) / 15) * Math.PI)) / 2;
    const cool = (3.5 * cloud + 4 * Math.min(1, rain)) * (0.3 + 0.7 * dayK);
    const tempC = tmin + (tmax - tmin) * dayK - cool;
    const spread = Math.max(0.4, 10 * (1 - 0.9 * Math.max(Math.min(1, rain * 1.5), cloud * 0.6, type === 'fog' ? 1 : 0)));
    return {
      type, label: SPELLS[type].label, cloud, rain: Math.min(1, rain), storm: Math.min(1, storm), vis, ceil,
      lightning: storm > 0.62, tempC, dewC: tempC - spread,
      qnh: Math.round(1009 - 5 * Math.min(1, rain) - 3 * storm + (noise(t / 5000) - 0.5) * 3),
      until: cur.end, next: this.spells[i + 1]?.type ?? null,
    };
  }

  // Advance the memory of rain (wet ground) and refresh the current weather. Call every tick.
  update(t, dt) {
    const w = this.at(t);
    this.wet = Math.max(0, Math.min(1, this.wet + (w.rain * dt) / 600 - (w.rain < 0.05 ? (dt / 7200) * (1 + (1 - w.cloud)) : 0)));
    this.now = { ...w, wet: this.wet };
    return this.now;
  }

  // Hour-by-hour outlook (the sequence of spells is fixed, so the forecast is exact).
  forecast(t, hours = 12) {
    const out = [];
    for (let h = 1; h <= hours; h++) {
      const w = this.at(t + h * 3600);
      out.push({ t: t + h * 3600, type: w.type, label: w.label, rain: w.rain, storm: w.storm, vis: w.vis, tempC: w.tempC, cloud: w.cloud });
    }
    return out;
  }

  // First time after t when the weather turns into one of `types` (within `hours`), or null.
  nextOf(t, types, hours = 3) {
    for (const sp of this.spells) {
      if (types.includes(sp.type) && sp.start > t && sp.start < t + hours * 3600) return { t: sp.start, type: sp.type, label: SPELLS[sp.type].label };
    }
    return null;
  }

  // ---- wind ---------------------------------------------------------------------------------------------

  // Actual wind from the scenario's / real base wind plus the sea breeze (east in the afternoon), the land
  // breeze (west before dawn), turbulence, and rain and storm gusts. Returns { from, kt, gust }.
  windFor(t, base) {
    const w = this.now ?? this.at(t);
    const h = (t % 86400) / 3600;
    const toVec = (from, kt) => [-kt * Math.sin((from * Math.PI) / 180), -kt * Math.cos((from * Math.PI) / 180)];
    const [bx, by] = toVec(base.from, base.kt);
    const calm = 1 - Math.min(1, w.rain + w.storm * 0.5);
    const sea = Math.max(0, Math.sin(((h - 9.5) / 11) * Math.PI)) * 6 * calm; // 10:00-20:00
    const land = Math.max(0, Math.cos(((h - 4) / 8) * Math.PI)) * (h > 0 && h < 9 ? 3 : 0) * calm;
    const [sx, sy] = toVec(105, sea);
    const [lx, ly] = toVec(270, land);
    const amp = 0.6 + 0.1 * base.kt + 4 * w.rain + 7 * w.storm;
    const tx = (noise(t / 420 + 11) - 0.5) * 2 * amp;
    const ty = (noise(t / 420 + 57) - 0.5) * 2 * amp;
    const x = bx + sx + lx + tx;
    const y = by + sy + ly + ty;
    const kt = Math.hypot(x, y);
    const from = ((Math.atan2(-x, -y) * 180) / Math.PI + 360) % 360;
    const gust = Math.round(kt + 3 + 0.25 * kt + 14 * w.storm * (0.4 + noise(t / 90)) + 6 * w.rain);
    return { from: Math.round(from), kt: Math.round(kt), gust: gust - kt >= 8 || w.storm > 0.3 ? gust : null };
  }

  // ---- METAR-style text ----------------------------------------------------------------------------------

  metar(t, wind) {
    const w = this.now ?? this.at(t);
    const utc = new Date((t - 19800) * 1000);
    const p2 = (n) => String(n).padStart(2, '0');
    const wx = w.storm > 0.45 ? 'TSRA' : w.rain > 0.7 ? '+RA' : w.rain > 0.3 ? 'RA' : w.rain > 0.08 ? '-DZ' : w.type === 'fog' ? 'FG' : w.type === 'mist' ? 'BR' : w.type === 'smoke' ? 'FU' : w.type === 'haze' ? 'HZ' : '';
    const vis = w.vis >= 10000 ? '9999' : String(Math.round(w.vis / 100) * 100).padStart(4, '0');
    const layer = (cover, ft) => `${cover}${String(Math.round(Math.min(ft, 30000) / 100)).padStart(3, '0')}`;
    const sky = w.cloud < 0.1 ? 'SKC' : w.cloud < 0.3 ? layer('FEW', w.ceil * 1.4) : w.cloud < 0.55 ? layer('SCT', w.ceil) : w.cloud < 0.85 ? layer('BKN', w.ceil) : layer('OVC', w.ceil);
    const dir = String((Math.round(wind.from / 10) * 10) % 360 || 360).padStart(3, '0');
    const windText = `${dir}${p2(wind.kt)}${wind.gust ? `G${p2(wind.gust)}` : ''}KT`;
    return `VOMM ${p2(utc.getUTCDate())}${p2(utc.getUTCHours())}${p2(utc.getUTCMinutes())}Z ${windText} ${vis}${wx ? ` ${wx}` : ''} ${sky}${w.storm > 0.45 ? ' CB' : ''} ${p2(Math.round(w.tempC))}/${p2(Math.round(w.dewC))} Q${w.qnh}`;
  }

  // ---- save / load -----------------------------------------------------------------------------------------

  snapshot() {
    return { seed: this.seed, month: this.month, mode: this.mode, bias: this.bias, t0: this.t0, spells: this.spells, wet: this.wet, rng: this.rnd.getState() };
  }

  static restore(s) {
    const w = Object.create(Weather.prototype);
    Object.assign(w, { seed: s.seed, month: s.month, mode: s.mode, bias: s.bias, t0: s.t0, spells: s.spells, wet: s.wet });
    w.rnd = seeded(s.seed * 31 + 17);
    w.rnd.setState(s.rng);
    return w;
  }

  // Switch between random weather and calm weather; the spells already planned for the next hour stay.
  setMode(mode, t) {
    this.mode = mode;
    const i = this._index(t);
    this.spells.length = i + 1; // keep the current spell, plan the rest again
    this.ensure(t + 6 * 3600);
  }
}
