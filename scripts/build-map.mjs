// Converts the raw OSM extracts into one compact top-down game map: public/data/maa-map.json.
// Coordinates are local metres around the airport reference point, as [x, y] with
// x = metres east and y = metres south (so north is up on screen).
import { readFile, writeFile } from 'node:fs/promises';

const REF = { lat: 12.9941, lon: 80.1709 }; // MAA aerodrome reference point (approx.)
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON = 111_320 * Math.cos((REF.lat * Math.PI) / 180);

// Facts the OSM data lacks, from the AAI eAIP (AD 2 VOMM, Oct 2026 edition).
const RUNWAY_FACTS = {
  displacedThresholds: { 12: 780 }, // metres
  ils: ['07', '25'],
};

const round = (v) => Math.round(v * 10) / 10;
const toXY = ({ lat, lon }) => [round((lon - REF.lon) * M_PER_DEG_LON), round(-(lat - REF.lat) * M_PER_DEG_LAT)];

const load = async (name) =>
  JSON.parse(await readFile(new URL(`../data/raw/${name}`, import.meta.url), 'utf8')).elements;

const aeroway = await load('osm_aeroway.json');
const landside = await load('osm_landside.json');
const surroundings = await load('osm_surroundings.json');

const ways = (els) => els.filter((e) => e.type === 'way' && e.geometry?.length > 1);
const line = (w, tolerance = 0) => simplify(w.geometry.map(toXY), tolerance);
const isClosed = (w) => w.nodes?.[0] === w.nodes?.[w.nodes.length - 1];
const num = (v, fallback) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : fallback);

const map = {
  meta: {
    name: 'Chennai International Airport (MAA / VOMM)',
    ref: REF,
    attribution: '© OpenStreetMap contributors (ODbL)',
    builtAt: new Date().toISOString(),
    runwayFacts: RUNWAY_FACTS,
  },
  aerodrome: null,
  grass: [],
  water: [],
  waterways: [],
  roads: [],
  railways: [],
  runways: [],
  taxiways: [],
  aprons: [],
  buildings: [],
  jetBridges: [],
  stands: [],
  holdingPoints: [],
  windsocks: [],
  zones: [],
};

// --- Airside -----------------------------------------------------------------------------------
for (const w of ways(aeroway)) {
  const t = w.tags ?? {};
  switch (t.aeroway) {
    case 'aerodrome':
      map.aerodrome = line(w);
      break;
    case 'runway':
      map.runways.push({ id: w.id, ref: t.ref ?? '', width: num(t.width, 45), points: line(w) });
      break;
    case 'stopway':
      map.runways.push({ id: w.id, ref: 'stopway', width: num(t.width, 45), points: line(w), stopway: true });
      break;
    case 'taxiway':
      map.taxiways.push({ id: w.id, ref: t.ref ?? t.name ?? '', width: num(t.width, 23), points: line(w) });
      break;
    case 'apron':
      if (isClosed(w)) map.aprons.push({ id: w.id, polygon: line(w) });
      break;
    case 'jet_bridge':
      map.jetBridges.push({ id: w.id, points: line(w) });
      break;
  }
}

for (const n of aeroway.filter((e) => e.type === 'node')) {
  const t = n.tags ?? {};
  const [x, y] = toXY(n);
  if (t.aeroway === 'gate' || t.aeroway === 'parking_position') {
    map.stands.push({ id: n.id, ref: (t.ref ?? '').replace(/^Bay\s*/i, ''), x, y });
  }
  if (t.aeroway === 'holding_position') map.holdingPoints.push({ id: n.id, ref: t.ref ?? '', x, y });
  if (t.aeroway === 'windsock') map.windsocks.push({ x, y });
}

// --- Buildings: heights are estimates per kind (OSM has none); used for 2D drop shadows ----------
const HEIGHTS = { terminal: 24, hangar: 18, tower: 48, fire_station: 9, parking: 22, train_station: 12, default: 8 };
const seen = new Set();
for (const w of ways([...aeroway, ...landside])) {
  const t = w.tags ?? {};
  if (!t.building || !isClosed(w) || seen.has(w.id)) continue;
  seen.add(w.id);
  const kind =
    t.aeroway === 'terminal' ? 'terminal'
    : t.aeroway === 'hangar' ? 'hangar'
    : t.aeroway === 'tower' ? 'tower'
    : t.amenity === 'fire_station' ? 'fire_station'
    : t.amenity === 'parking' ? 'parking'
    : t.building === 'train_station' ? 'train_station'
    : 'default';
  const levels = num(t['building:levels'], null);
  map.buildings.push({
    id: w.id,
    kind,
    name: t.name ?? '',
    height: num(t.height, levels ? levels * 3.5 : HEIGHTS[kind]),
    polygon: line(w),
  });
}

// Zones: defence enclaves (no-build), construction sites (T3); infield grass.
for (const w of ways(landside)) {
  const t = w.tags ?? {};
  if (!isClosed(w)) continue;
  if (t.landuse === 'military') map.zones.push({ id: w.id, kind: 'military', name: t.name ?? 'Defence enclave', polygon: line(w) });
  if (t.landuse === 'construction') map.zones.push({ id: w.id, kind: 'construction', name: t.name ?? 'Construction site', polygon: line(w) });
  if (t.landuse === 'grass') map.grass.push(line(w, 1));
}

// --- Surroundings: roads, rail, rivers and lakes ------------------------------------------------
const ROAD_WIDTH = {
  motorway: 24, trunk: 22, primary: 18, secondary: 14, tertiary: 11,
  motorway_link: 9, trunk_link: 9, primary_link: 9, secondary_link: 8,
  unclassified: 7, residential: 6, service: 5,
};
for (const w of ways(surroundings)) {
  const t = w.tags ?? {};
  if (t.highway && ROAD_WIDTH[t.highway]) {
    // Service roads are only kept near the airport; elsewhere they are driveways and clutter.
    const pts = line(w, t.highway === 'residential' || t.highway === 'service' ? 2 : 1);
    if (t.highway === 'service' && !pts.some(([x, y]) => Math.abs(x) < 3500 && Math.abs(y) < 3000)) continue;
    map.roads.push({
      kind: t.highway.replace('_link', ''),
      width: num(t.width, ROAD_WIDTH[t.highway]),
      name: t.name ?? '',
      bridge: t.bridge === 'yes',
      tunnel: t.tunnel === 'yes',
      points: pts,
    });
  } else if (t.railway) {
    map.railways.push({ kind: t.railway, bridge: t.bridge === 'yes', tunnel: t.tunnel === 'yes', name: t.name ?? '', points: line(w, 1) });
  } else if (t.waterway) {
    map.waterways.push({ kind: t.waterway, name: t.name ?? '', width: { river: 40, canal: 14, stream: 6, drain: 4 }[t.waterway], points: line(w, 1) });
  } else if ((t.natural === 'water' || t.water) && isClosed(w)) {
    map.water.push({ name: t.name ?? '', polygon: line(w, 1) });
  }
}
for (const r of surroundings.filter((e) => e.type === 'relation' && e.tags?.natural === 'water')) {
  for (const m of r.members ?? []) {
    if (m.role === 'outer' && m.geometry?.length > 2) map.water.push({ name: r.tags.name ?? '', polygon: simplify(m.geometry.map(toXY), 1) });
  }
}

// Airport grounds beyond the OSM boundary (a game decision, not real data): north-west of the runway 12
// end, so the approach has airport land under it. The curve leaves the OSM boundary at its first point and
// rejoins it at its last, and keeps just south of Manapakkam Main Road. Minor streets inside are removed.
const GROUND_EXTENSIONS = [
  [[-1434, -1573], [-1562, -1693], [-1718, -1782], [-1896, -1835], [-2030, -1842], [-2100, -1820], [-2160, -1778], [-2240, -1765], [-2290, -1750], [-2275, -1705], [-2196, -1605], [-2151, -1505], [-2149, -1427], [-2062, -1405], [-2009, -1410]],
];
const KEEP_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary']);

function smoothCurve(points, rounds = 3) {
  let pts = points;
  for (let k = 0; k < rounds; k++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    next.push(pts.at(-1));
    pts = next;
  }
  return pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}

const insidePolygon = ([x, y], poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

for (const curve of GROUND_EXTENSIONS) {
  const ring = map.aerodrome;
  const nearest = (p) => ring.reduce((best, q, i) => (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(ring[best][0] - p[0], ring[best][1] - p[1]) ? i : best), 0);
  const from = nearest(curve[0]);
  const to = nearest(curve.at(-1));
  const smooth = smoothCurve([ring[from], ...curve.slice(1, -1), ring[to]]);
  const added = [...smooth, ...ring.slice(from + 1, to).reverse()];
  map.aerodrome = [...ring.slice(0, from), ...smooth, ...ring.slice(to + 1)];
  const roads = [];
  for (const r of map.roads) {
    if (KEEP_ROADS.has(r.kind) || !r.points.some((p) => insidePolygon(p, added))) {
      roads.push(r);
      continue;
    }
    let run = [];
    for (const p of r.points) {
      if (insidePolygon(p, added)) {
        if (run.length > 1) roads.push({ ...r, points: run });
        run = [];
      } else run.push(p);
    }
    if (run.length > 1) roads.push({ ...r, points: run });
  }
  map.roads = roads;
}

const out = new URL('../public/data/maa-map.json', import.meta.url);
const json = JSON.stringify(map);
await writeFile(out, json);
console.log(
  `maa-map.json (${(json.length / 1e6).toFixed(2)} MB): ${map.runways.length} runways, ${map.taxiways.length} taxiways, ` +
    `${map.aprons.length} aprons, ${map.buildings.length} buildings, ${map.stands.length} stands, ` +
    `${map.roads.length} roads, ${map.railways.length} rail lines, ${map.waterways.length} waterways, ${map.water.length} water areas`,
);

// Douglas–Peucker line simplification (tolerance in metres; 0 = keep all points).
function simplify(points, tolerance) {
  if (tolerance <= 0 || points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance(points[i], points[a], points[b]);
      if (d > maxD) [maxD, idx] = [d, i];
    }
    if (maxD > tolerance) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function segmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
