// Stand model: which aircraft each stand can take (fit checks against buildings, jet bridges and
// the apron), terminal preference, and time bookings with neighbour-footprint conflicts.
import { AIRCRAFT_TYPES } from './aircraftTypes.js';
import { aircraftFootprint, rectPolygon, convexOverlap, partsOverlap, servicePositions, vehiclePolygon } from './footprint.js';
import { pointInPolygon, closestOnPolyline } from '../map/geometry.js';

const NOSE_GAP_M = 4; // nose stop point to nose
const NEIGHBOUR_RADIUS_M = 160;

export function parkedPose(stand, type) {
  const L = AIRCRAFT_TYPES[type].length;
  return {
    x: stand.x - stand.dir[0] * (L / 2 + NOSE_GAP_M),
    y: stand.y - stand.dir[1] * (L / 2 + NOSE_GAP_M),
    heading: Math.atan2(stand.dir[1], stand.dir[0]),
  };
}

function crossesPolygon(convex, poly) {
  for (const p of convex) if (pointInPolygon(p, poly)) return true;
  for (const p of poly) if (pointInPolygon(p, convex)) return true;
  for (let i = 0; i < convex.length; i++) {
    const a = convex[i];
    const b = convex[(i + 1) % convex.length];
    for (let j = 0; j < poly.length; j++) {
      const c = poly[j];
      const d = poly[(j + 1) % poly.length];
      const d1 = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0]);
      const d2 = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]);
      const d3 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const d4 = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
      if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    }
  }
  return false;
}

const boxOf = (pts) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
};
const boxesTouch = (a, b, m = 0) => a.minX - m <= b.maxX && a.maxX + m >= b.minX && a.minY - m <= b.maxY && a.maxY + m >= b.minY;

export function buildStands(orientedStands, map) {
  const terminals = map.buildings.filter((b) => b.kind === 'terminal');
  const buildingBoxes = map.buildings.map((b) => ({ b, box: boxOf(b.polygon) }));
  const apronBoxes = map.aprons.map((a) => ({ a, box: boxOf(a.polygon) }));
  const bridges = map.jetBridges.flatMap((j) =>
    j.points.slice(1).map((p, i) => {
      const a = j.points[i];
      return rectPolygon((a[0] + p[0]) / 2, (a[1] + p[1]) / 2, Math.atan2(p[1] - a[1], p[0] - a[0]), Math.hypot(p[0] - a[0], p[1] - a[1]), 4);
    }),
  );
  const stands = orientedStands.map((s) => {
    let terminal = null;
    let best = Infinity;
    for (const t of terminals) {
      const d = pointInPolygon([s.x, s.y], t.polygon) ? 0 : closestOnPolyline([s.x, s.y], t.polygon).dist;
      if (d < best) [best, terminal] = [d, t];
    }
    const kind = best < 220 && terminal ? (/international/i.test(terminal.name) ? 'intl' : 'dom') : 'remote';
    const fits = {};
    const footprints = {};
    const service = {};
    for (const type of Object.keys(AIRCRAFT_TYPES)) {
      const pose = parkedPose(s, type);
      const parts = aircraftFootprint(type, pose.x, pose.y, pose.heading);
      footprints[type] = parts;
      // Every turnaround vehicle spot (trains included), in map coordinates.
      const c = Math.cos(pose.heading);
      const sn = Math.sin(pose.heading);
      service[type] = Object.values(servicePositions(type))
        .filter((sp) => sp.kind !== 'cone')
        .flatMap((sp) => sp.pieces)
        .map((p) => vehiclePolygon(p.kind, pose.x + p.x * c - p.y * sn, pose.y + p.x * sn + p.y * c, pose.heading + p.h, 0.3));
      const here = { minX: pose.x, minY: pose.y, maxX: pose.x, maxY: pose.y };
      const onApron = apronBoxes.some(({ a, box }) => boxesTouch(box, here, 25) && (pointInPolygon([pose.x, pose.y], a.polygon) || closestOnPolyline([pose.x, pose.y], a.polygon).dist < 25));
      const partBoxes = parts.map(boxOf);
      const hitsBuilding = parts.some((p, i) => buildingBoxes.some(({ b, box }) => boxesTouch(box, partBoxes[i]) && crossesPolygon(p, b.polygon)));
      const hitsBridge = parts.slice(1).some((p) => bridges.some((b) => convexOverlap(p, b))); // fuselage nose may meet its bridge
      // The lead-in must be long enough that the parked tail stays clear of the taxilane.
      const longEnough = (s.leadIn ?? Infinity) >= AIRCRAFT_TYPES[type].length * 0.75 + 8;
      fits[type] = onApron && !hitsBuilding && !hitsBridge && longEnough;
    }
    return { ...s, terminal: terminal?.name ?? '', kind, fits, footprints, service, bookings: [], closed: false, occupant: null };
  });
  for (const s of stands) {
    s.neighbours = stands.filter((o) => o !== s && Math.hypot(o.x - s.x, o.y - s.y) < NEIGHBOUR_RADIUS_M);
  }
  // Wide-body capable: a 777 here would not clash with A320s on every neighbouring stand.
  for (const s of stands) {
    s.wideCapable = s.fits.B77W && s.neighbours.every((n) => !n.fits.A20N || !partsOverlap(s.footprints.B77W, n.footprints.A20N));
    s.wide = s.wideCapable;
  }
  return stands;
}

const overlapsTime = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

// Can `type` use `stand` from t0 to t1? Returns null if yes, otherwise the reason.
export function standBlocker(stand, type, t0, t1, ignoreFlightId = null) {
  if (stand.closed) return 'Stand closed';
  if (!stand.fits[type]) return `${AIRCRAFT_TYPES[type].name} does not fit here`;
  if (stand.bookings.some((b) => b.flightId !== ignoreFlightId && overlapsTime(t0, t1, b.from, b.to))) return 'Stand already booked';
  for (const n of stand.neighbours) {
    for (const b of n.bookings) {
      if (b.flightId === ignoreFlightId || !overlapsTime(t0, t1, b.from, b.to)) continue;
      if (partsOverlap(stand.footprints[type], n.footprints[b.type])) return `Wingtip clash with stand ${n.ref}`;
      // Turnaround vehicles of one stand may not end up under the other stand's aircraft.
      if (partsOverlap(stand.service[type], n.footprints[b.type]) || partsOverlap(stand.footprints[type], n.service[b.type])) {
        return `Service area clash with stand ${n.ref}`;
      }
    }
  }
  return null;
}

export function book(stand, flight, from, to) {
  stand.bookings.push({ flightId: flight.id, type: flight.type, from, to });
}

export function unbook(stand, flightId) {
  stand.bookings = stand.bookings.filter((b) => b.flightId !== flightId);
}

// Best stand for a flight: prefers a contact stand at the right terminal, then any terminal stand,
// then remote. Returns null if nothing fits.
export function chooseStand(stands, flight, from, to) {
  let best = null;
  for (const s of stands) {
    if (standBlocker(s, flight.type, from, to)) continue;
    let score = 0;
    const wantKind = flight.intl ? 'intl' : 'dom';
    const suits = s.kind === wantKind || s.kind === 'mixed';
    if (suits) score += 60;
    if (s.contact && suits) score += 80;
    if (s.kind === 'remote') score -= 20;
    if (AIRCRAFT_TYPES[flight.type].code === 'C' && s.wideCapable) score -= 25; // keep big stands for big aircraft
    if (!best || score > best.score) best = { s, score };
  }
  return best?.s ?? null;
}
