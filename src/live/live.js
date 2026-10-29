// Live layer: real wind (Open-Meteo directly, METAR through the proxy when available) and real
// aircraft positions near Chennai ("Live Watch", through the proxy). Everything is optional: if a
// feed is unreachable the game carries on with its own simulated weather and traffic.
import { airlineFromCallsign } from '../sim/brands.js';
const BASE = import.meta.env?.VITE_API_BASE ?? '';
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast?latitude=12.99&longitude=80.17&current=wind_speed_10m,wind_direction_10m,visibility&wind_speed_unit=kn&timezone=Asia%2FKolkata';

const TYPE_MAP = [
  [/^(A21N|A321)/, 'A21N'], [/^(A20N|A320|A319|A318|A19N)/, 'A20N'], [/^(B38M|B39M|B37M)/, 'B38M'], [/^B73/, 'B738'],
  [/^(AT7|ATR)/, 'AT76'], [/^(DH8D|DH8|Q400|E1|E7|CRJ)/, 'DH8D'],
  [/^(B77|B74)/, 'B77W'], [/^B788/, 'B788'], [/^(B78|B76)/, 'B789'], [/^(A35)/, 'A359'], [/^(A33|A34|A38)/, 'A343'],
];
export const ghostType = (t) => TYPE_MAP.find(([re]) => re.test(t ?? ''))?.[1] ?? 'A20N';

export async function fetchWeather() {
  try {
    const res = await fetch(`${BASE}/api/metar`);
    if (res.ok) {
      const m = await res.json();
      if (m.wind && typeof m.wind.from === 'number') return { from: m.wind.from, kt: m.wind.kt, source: `VOMM METAR ${m.raw}` };
    }
  } catch {
    /* no proxy: fall through to Open-Meteo */
  }
  const res = await fetch(OPEN_METEO);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const c = (await res.json()).current;
  return { from: c.wind_direction_10m, kt: c.wind_speed_10m, source: 'Open-Meteo' };
}

export class LiveTraffic {
  constructor(ref) {
    this.ref = ref;
    this.mPerLat = 110574;
    this.mPerLon = 111320 * Math.cos((ref.lat * Math.PI) / 180);
    this.timer = null;
    this.items = new Map(); // hex -> { ...aircraft, x, y, at }
    this.status = 'off';
    this.attribution = '';
  }

  toLocal(lat, lon) {
    return [(lon - this.ref.lon) * this.mPerLon, -(lat - this.ref.lat) * this.mPerLat];
  }

  start(onStatus) {
    this.stop();
    this.status = 'connecting';
    const poll = async () => {
      try {
        const res = await fetch(`${BASE}/api/traffic`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        const now = performance.now();
        const seen = new Set();
        for (const a of data.aircraft ?? []) {
          const [x, y] = this.toLocal(a.lat, a.lon);
          this.items.set(a.hex, { ...a, x, y, at: now - a.age * 1000 });
          seen.add(a.hex);
        }
        for (const hex of this.items.keys()) if (!seen.has(hex) && now - this.items.get(hex).at > 90_000) this.items.delete(hex);
        this.attribution = data.attribution ?? '';
        this.status = 'live';
      } catch {
        this.status = 'unavailable';
      }
      onStatus?.(this.status, this.items.size);
    };
    poll();
    this.timer = setInterval(poll, 5000);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.items.clear();
    this.status = 'off';
  }

  // Positions advanced along each aircraft's track since its last report. Ground aircraft and
  // very old reports are held still / faded rather than extrapolated.
  ghosts(now = performance.now()) {
    const out = [];
    for (const a of this.items.values()) {
      const age = (now - a.at) / 1000;
      if (age > 90) continue;
      const v = a.gnd && a.gs < 3 ? 0 : a.gs * 0.5144 * Math.min(age, 20);
      const h = (a.trk * Math.PI) / 180;
      out.push({
        hex: a.hex, callsign: a.call || a.hex, airline: airlineFromCallsign(a.call), type: ghostType(a.type), realType: a.type, alt: a.alt, gs: a.gs, gnd: a.gnd,
        x: a.x + Math.sin(h) * v, y: a.y - Math.cos(h) * v,
        heading: h - Math.PI / 2, opacity: age > 45 ? 0.35 : 0.8,
      });
    }
    return out;
  }
}
