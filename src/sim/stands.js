// Stand model: which aircraft each stand can take (fit checks against buildings, jet bridges and
// the apron), terminal preference, and time bookings with neighbour-footprint conflicts.
import { AIRCRAFT_TYPES } from './aircraftTypes.js';
import { aircraftFootprint, rectPolygon, convexOverlap, partsOverlap, servicePositions, vehiclePolygon } from './footprint.js';
import { pointInPolygon, closestOnPolyline } from '../map/geometry.js';

const NOSE_GAP_M = 4; // nose stop point to nose
const NEIGHBOUR_RADIUS_M = 160;
// ICAO code C taxilane centreline to object: every parked aircraft (tail included) stays this far from
// every taxi line, so a narrow-body can always pass it. Wider aircraft are kept off lines next to
// occupied stands by the router (`World` wingtip rule).
export const TAXI_CLEAR_M = 24.5;
const OFF_APRON_MAX = 0.02; // share of the outline allowed past the (hand-drawn) OSM apron edge

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

// Points every ~1.5 m around a polygon, for "is all of it inside / how close does it come" tests.
export function outlinePoints(poly, step = 1.5) {
  return poly.flatMap((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / step));
    return Array.from({ length: n }, (_, k) => [p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
  });
}

export function segmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Smallest distance from a set of points to a set of segments ({ a, b, box }), only looking at
// segments whose box is within `reach` of the points.
export function clearance(points, segments, reach = 60) {
  const box = boxOf(points);
  let best = Infinity;
  for (const s of segments) {
    if (!boxesTouch(box, s.box, reach)) continue;
    for (const p of points) best = Math.min(best, segmentDistance(p, s.a, s.b));
  }
  return best;
}

// taxiLines: every taxiway / taxilane centreline segment, [[ax, ay], [bx, by]].
export function buildStands(orientedStands, map, taxiLines = []) {
  // The cargo terminal is tagged a terminal in OSM, but no passenger goes there.
  const isCargo = (b) => /cargo/i.test(b.name ?? '');
  const terminals = map.buildings.filter((b) => b.kind === 'terminal' && !isCargo(b));
  const cargoTerminals = map.buildings.filter((b) => b.kind === 'terminal' && isCargo(b));
  const buildingBoxes = map.buildings.map((b) => ({ b, box: boxOf(b.polygon) }));
  const apronAreas = map.aprons.map((a) => ({ poly: a.polygon, box: boxOf(a.polygon) }));
  const grassAreas = (map.grass ?? []).map((g) => ({ poly: g, box: boxOf(g) }));
  const lines = taxiLines.map(([a, b]) => ({ a, b, box: boxOf([a, b]) }));
  const inAny = (p, list) => list.some((o) => p[0] >= o.box.minX && p[0] <= o.box.maxX && p[1] >= o.box.minY && p[1] <= o.box.maxY && pointInPolygon(p, o.poly));
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
    const cargoDist = Math.min(Infinity, ...cargoTerminals.map((t) => (pointInPolygon([s.x, s.y], t.polygon) ? 0 : closestOnPolyline([s.x, s.y], t.polygon).dist)));
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
      // The whole aircraft (not just its centre) must stand on apron, never on grass. Terminal 3 stands
      // are exempt: the project paves its own apron.
      const outline = parts.flatMap((p) => outlinePoints(p));
      const offApron = s.t3 ? 0 : outline.filter((p) => !inAny(p, apronAreas)).length / outline.length;
      const onGrass = !s.t3 && outline.some((p) => inAny(p, grassAreas));
      const partBoxes = parts.map(boxOf);
      const hitsBuilding = parts.some((p, i) => buildingBoxes.some(({ b, box }) => boxesTouch(box, partBoxes[i]) && crossesPolygon(p, b.polygon)));
      const hitsBridge = parts.slice(1).some((p) => bridges.some((b) => convexOverlap(p, b))); // fuselage nose may meet its bridge
      // Wings, nose and tail stay clear of every taxi line (its own taxilane included).
      const clear = clearance(outline, lines) >= TAXI_CLEAR_M;
      fits[type] = offApron <= OFF_APRON_MAX && !onGrass && !hitsBuilding && !hitsBridge && clear;
    }
    const usable = Object.values(fits).some(Boolean);
    return { ...s, terminal: terminal?.name ?? '', kind, cargoDist, fits, footprints, service, usable, bookings: [], closed: !usable, occupant: null };
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
      // One of the two could not push back past the other, whichever way it turned.
      if (stand.pushBlocksOf?.(type).has(`${n.id}:${b.type}`) || n.pushBlocksOf?.(b.type).has(`${stand.id}:${type}`)) return `Push-back clash with stand ${n.ref}`;
      // A wide-body could not taxi in or out past the other without its wing sweeping over it.
      if (stand.accessBlocked?.(type, n.id, b.type) || n.accessBlocked?.(b.type, stand.id, type)) return `Taxilane next to stand ${n.ref} too narrow while it is occupied`;
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
// then remote. Freighters go to the stands nearest the cargo terminal and general aviation to the
// smallest remote stand; neither takes a jet-bridge stand. Returns null if nothing fits.
export function chooseStand(stands, flight, from, to) {
  let best = null;
  const size = (s) => Object.values(s.fits).filter(Boolean).length; // how many types fit: bigger stand
  for (const s of stands) {
    if (standBlocker(s, flight.type, from, to)) continue;
    if (flight.service === 'cargo' || flight.service === 'ga') {
      let score = s.contact ? -200 : 0;
      if (flight.service === 'cargo') score -= Math.min(s.cargoDist, 3000) / 20; // 1 point per 20 m from the cargo terminal
      else score += (s.kind === 'remote' ? 40 : 0) - size(s) * 6;
      if (!best || score > best.score) best = { s, score };
      continue;
    }
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
