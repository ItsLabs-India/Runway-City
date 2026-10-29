// Small data proxy for Runway City. Browsers cannot call these feeds directly (no CORS headers),
// and the free feeds allow roughly one request per second, so this worker fetches each feed on a
// short timer, trims it to what the game needs and caches the result for every player.
//
//   GET /api/traffic  live aircraft around Chennai (adsb.fi open data; military and privacy-flagged
//                     aircraft are removed)
//   GET /api/metar    current VOMM METAR (NOAA Aviation Weather Center)
//   GET /api/health
//
// Runs on Cloudflare Workers (free plan is enough) and, for local development, inside the Vite
// dev server (see vite.config.js).
const CHENNAI = { lat: 12.9941, lon: 80.1709, radiusNm: 40 };
const UA = 'runway-city/0.1 (non-commercial fan project)';
const memory = new Map(); // fallback cache when the Workers Cache API is not available

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...extra },
  });

async function cached(request, ttl, produce) {
  const key = new Request(new URL(request.url).origin + new URL(request.url).pathname);
  const store = typeof caches !== 'undefined' ? caches.default : null;
  if (store) {
    const hit = await store.match(key);
    if (hit) return hit;
  } else {
    const hit = memory.get(key.url);
    if (hit && hit.until > Date.now()) return hit.res.clone();
  }
  let res;
  try {
    res = await produce();
  } catch (err) {
    return json({ error: 'upstream unavailable', detail: String(err.message ?? err) }, 502, { 'cache-control': 'no-store' });
  }
  const out = new Response(res.body, { status: res.status, headers: { ...Object.fromEntries(res.headers), 'cache-control': `public, max-age=${ttl}` } });
  if (res.status === 200) {
    if (store) await store.put(key, out.clone());
    else memory.set(key.url, { until: Date.now() + ttl * 1000, res: out.clone() });
  }
  return out;
}

// A slow upstream feed must not hang the game: give up after a few seconds.
const upstream = (url) => fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(6000) });

async function traffic() {
  const url = `https://opendata.adsb.fi/api/v3/lat/${CHENNAI.lat}/lon/${CHENNAI.lon}/dist/${CHENNAI.radiusNm}`;
  const up = await upstream(url).catch(() => null);
  if (!up) return json({ error: 'adsb.fi did not answer in time' }, 504);
  if (!up.ok) return json({ error: `adsb.fi returned ${up.status}` }, 502);
  const data = await up.json();
  const aircraft = [];
  for (const a of data.ac ?? []) {
    if (typeof a.lat !== 'number' || typeof a.lon !== 'number') continue;
    // dbFlags: 1 military, 2 interesting, 4 PIA (privacy), 8 LADD (limited display). Not shown.
    if ((a.dbFlags ?? 0) & (1 | 4 | 8)) continue;
    const ground = a.alt_baro === 'ground';
    aircraft.push({
      hex: a.hex,
      call: (a.flight ?? '').trim(),
      type: a.t ?? '',
      lat: Math.round(a.lat * 1e5) / 1e5,
      lon: Math.round(a.lon * 1e5) / 1e5,
      alt: ground ? 0 : Math.round(a.alt_baro ?? a.alt_geom ?? 0),
      gs: Math.round(a.gs ?? 0),
      trk: Math.round(a.track ?? a.true_heading ?? 0),
      gnd: ground,
      age: Math.round((a.seen_pos ?? a.seen ?? 0) * 10) / 10,
    });
  }
  return json({ ts: data.now ?? Date.now(), source: 'adsb.fi', attribution: 'Live aircraft data: adsb.fi (non-commercial use)', aircraft });
}

async function metar() {
  const up = await upstream('https://aviationweather.gov/api/data/metar?ids=VOMM&format=json').catch(() => null);
  if (!up) return json({ error: 'AWC did not answer in time' }, 504);
  if (!up.ok) return json({ error: `AWC returned ${up.status}` }, 502);
  const [m] = await up.json();
  if (!m) return json({ error: 'no METAR' }, 502);
  return json({
    station: 'VOMM',
    raw: m.rawOb,
    observed: m.obsTime ? m.obsTime * 1000 : null,
    wind: { from: typeof m.wdir === 'number' ? m.wdir : null, kt: m.wspd ?? 0, gust: m.wgst ?? null, variable: m.wdir === 'VRB' },
    visibility: m.visib ?? null,
    temp: m.temp ?? null,
    source: 'NOAA Aviation Weather Center',
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET', 'access-control-max-age': '86400' } });
    }
    if (url.pathname === '/api/traffic') return cached(request, 4, traffic);
    if (url.pathname === '/api/metar') return cached(request, 120, metar);
    if (url.pathname === '/api/health') return json({ ok: true });
    return json({ error: 'not found' }, 404);
  },
};
