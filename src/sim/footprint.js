// Collision geometry: aircraft and vehicle footprints, convex-polygon overlap (separating axis
// theorem), collision-free service positions and vehicle routes around a parked aircraft.
// Local aircraft frame: +x towards the nose, +y towards the right (starboard) wing, metres.
import { AIRCRAFT_TYPES } from './aircraftTypes.js';
import { airframe, hull } from './airframe.js';

// Vehicle sizes (length, width) — must match the drawings in map/sprites.js.
export const VEHICLE_SIZE = {
  tug: [3.4, 1.9], cart: [3.2, 1.7], beltLoader: [8, 2.1], fuel: [10.5, 2.6], catering: [8.4, 2.5],
  water: [6.5, 2.2], gpu: [2.6, 1.6], pushback: [6.6, 3], stairs: [8, 2.4], bus: [13.5, 2.9], van: [5, 2],
  followMe: [4.6, 1.9], fireTender: [12, 3],
};

// Key dimensions, from the same airframe geometry the sprites are drawn from.
export function dims(code) {
  const f = airframe(code);
  const { t, L, S, r } = f;
  const sweep = Math.tan((t.wing.sweep * Math.PI) / 180);
  const rootLE = f.wing.xRoot;
  const rootChord = t.wing.rootChord;
  return { t, L, S, r, sweep, rootLE, rootChord, tipChord: t.wing.tipChord, tipLE: f.wing.le(S) };
}

const footprintCache = new Map();

// Convex parts of an aircraft in its local frame: fuselage, wing pieces, tailplanes and engine pods.
export function localFootprint(code) {
  if (footprintCache.has(code)) return footprintCache.get(code);
  const f = airframe(code);
  const right = f.profile.filter((_, i) => i % 3 === 0 || i === f.profile.length - 1);
  const parts = [hull([...right, ...right.map(([x, y]) => [x, -y])])];
  for (const s of [-1, 1]) {
    for (const piece of f.wing.pieces) parts.push(piece.map(([x, y]) => [x, s * y]));
    parts.push(hull(f.stab.outline.map(([x, y]) => [x, s * y])));
  }
  for (const e of f.engines) {
    parts.push([[e.x, e.y - e.r], [e.x, e.y + e.r], [e.x - e.len, e.y + e.r], [e.x - e.len, e.y - e.r]]);
  }
  footprintCache.set(code, parts);
  return parts;
}

export function toWorld(parts, x, y, heading) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return parts.map((poly) => poly.map(([px, py]) => [x + px * c - py * s, y + px * s + py * c]));
}

export function aircraftFootprint(code, x, y, heading) {
  return toWorld(localFootprint(code), x, y, heading);
}

export function rectPolygon(cx, cy, heading, length, width) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const hl = length / 2;
  const hw = width / 2;
  return [[hl, -hw], [hl, hw], [-hl, hw], [-hl, -hw]].map(([px, py]) => [cx + px * c - py * s, cy + px * s + py * c]);
}

export function vehiclePolygon(kind, x, y, heading, pad = 0) {
  const [l, w] = VEHICLE_SIZE[kind] ?? [3, 2];
  return rectPolygon(x, y, heading, l + pad * 2, w + pad * 2);
}

// Separating axis theorem for two convex polygons.
export function convexOverlap(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const nx = y1 - y2;
      const ny = x2 - x1;
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const [x, y] of a) {
        const p = x * nx + y * ny;
        if (p < minA) minA = p;
        if (p > maxA) maxA = p;
      }
      for (const [x, y] of b) {
        const p = x * nx + y * ny;
        if (p < minB) minB = p;
        if (p > maxB) maxB = p;
      }
      if (maxA < minB || maxB < minA) return false;
    }
  }
  return true;
}

export const partsOverlap = (partsA, partsB) => partsA.some((a) => partsB.some((b) => convexOverlap(a, b)));

// Grows a convex polygon by `m` metres (vertices pushed out from the centroid).
export function inflate(poly, m) {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * m, y + (dy / len) * m];
  });
}

function segmentsCross([ax, ay], [bx, by], [cx, cy], [dx, dy]) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function insideConvex([px, py], poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
    if (cross !== 0) {
      if (sign === 0) sign = Math.sign(cross);
      else if (Math.sign(cross) !== sign) return false;
    }
  }
  return true;
}

export function segmentHitsPolygon(a, b, poly) {
  if (insideConvex(a, poly) || insideConvex(b, poly)) return true;
  for (let i = 0; i < poly.length; i++) if (segmentsCross(a, b, poly[i], poly[(i + 1) % poly.length])) return true;
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return insideConvex(mid, poly);
}

// --- Turnaround service positions --------------------------------------------------------------

// Desired spots per service (local frame): position, heading and the direction to slide if blocked.
function serviceTemplate(code) {
  const { L, S, r, rootLE, sweep } = dims(code);
  const wide = AIRCRAFT_TYPES[code].code === 'E';
  const aftDoor = -L * 0.25;
  const fwdHold = L * 0.27;
  return {
    beltAft: { kind: 'beltLoader', x: aftDoor, y: r + 3.3, h: -Math.PI / 2 + 0.45, push: [0, 1] },
    tugAft: { kind: 'tug', x: aftDoor + 2, y: r + 11.5, h: 0, push: [0, 1], carts: wide ? 4 : 3 }, // carts trail aft
    beltFwd: { kind: 'beltLoader', x: fwdHold, y: r + 3.3, h: -Math.PI / 2 - 0.45, push: [0, 1] },
    fuel: { kind: 'fuel', x: rootLE + 3, y: r + 8, h: 0, push: [0.3, 1] }, // ahead of the wing, away from the taxilane behind
    catering: { kind: 'catering', x: L * 0.38, y: r + 4.6, h: -Math.PI / 2, push: [0.4, 1] },
    water: { kind: 'water', x: -L * 0.42, y: -(r + 3.6), h: Math.PI / 2, push: [-0.3, -1] },
    gpu: { kind: 'gpu', x: L * 0.44, y: r + 2.4, h: 0, push: [0.5, 1] },
    stairsFwd: { kind: 'stairs', x: L * 0.36, y: -(r + 4.4), h: Math.PI / 2, push: [0, -1] },
    stairsAft: { kind: 'stairs', x: -L * 0.31, y: -(r + 4.4), h: Math.PI / 2, push: [0, -1] },
    bus: { kind: 'bus', x: L * 0.2, y: -(r + 13), h: 0, push: [0.3, -1] },
    cleaning: { kind: 'van', x: L * 0.05, y: -(r + 5.5), h: 0, push: [0.6, -1] },
    pushback: { kind: 'pushback', x: L / 2 + 6.4, y: 0, h: Math.PI, push: [1, 0] },
    // Cones (no collision needed): wingtips and tail.
    coneL: { kind: 'cone', x: rootLE - S * sweep - 2, y: -(S + 1.5), h: 0 },
    coneR: { kind: 'cone', x: rootLE - S * sweep - 2, y: S + 1.5, h: 0 },
    coneT: { kind: 'cone', x: -L / 2 - 2, y: 0, h: 0 },
  };
}

const serviceCache = new Map();

// Collision-free spots for every service vehicle around a parked aircraft (local frame).
// A train (tug + carts) is placed as one piece. Spots never overlap the aircraft or each other.
export function servicePositions(code) {
  if (serviceCache.has(code)) return serviceCache.get(code);
  const body = localFootprint(code).map((p) => inflate(p, 0.4));
  const placed = [];
  const spots = {};
  for (const [name, s] of Object.entries(serviceTemplate(code))) {
    if (s.kind === 'cone') {
      spots[name] = { kind: 'cone', x: s.x, y: s.y, h: s.h, pieces: [{ kind: 'cone', x: s.x, y: s.y, h: s.h }] };
      continue;
    }
    const len = Math.hypot(...s.push) || 1;
    const [px, py] = [s.push[0] / len, s.push[1] / len];
    let found = null;
    for (let step = 0; step <= 80; step++) {
      const ox = s.x + px * step * 0.5;
      const oy = s.y + py * step * 0.5;
      const pieces = [{ kind: s.kind, x: ox, y: oy, h: s.h }];
      for (let i = 0; i < (s.carts ?? 0); i++) {
        const back = 3.4 / 2 + 1.9 + i * 3.8; // behind the tug, 0.6 m drawbar gaps
        pieces.push({ kind: 'cart', x: ox - Math.cos(s.h) * back, y: oy - Math.sin(s.h) * back, h: s.h });
      }
      const polys = pieces.map((p) => vehiclePolygon(p.kind, p.x, p.y, p.h, 0.3));
      const blocked = polys.some((poly) => body.some((b) => convexOverlap(poly, b)) || placed.some((q) => convexOverlap(poly, q)));
      if (!blocked) {
        found = { kind: s.kind, x: ox, y: oy, h: s.h, pieces };
        placed.push(...polys);
        break;
      }
    }
    spots[name] = found ?? { kind: s.kind, x: s.x + px * 40, y: s.y + py * 40, h: s.h, pieces: [{ kind: s.kind, x: s.x + px * 40, y: s.y + py * 40, h: s.h }] };
  }
  serviceCache.set(code, spots);
  return spots;
}

// Route for a vehicle from `from` to `to` (local frame) that drives around the aircraft:
// a tiny visibility graph over corner waypoints, shortest path by Dijkstra.
export function routeAround(code, from, to) {
  const { L, S, r } = dims(code);
  const obstacles = localFootprint(code).map((p) => inflate(p, 1.6));
  const corners = [];
  for (const sy of [-1, 1]) {
    corners.push([L / 2 + 9, sy * (r + 7)], [L / 2 + 9, sy * (S + 8)], [-L / 2 - 9, sy * (S + 8)], [-L / 2 - 9, sy * (r + 8)], [0, sy * (S + 8)]);
  }
  const nodes = [from, to, ...corners];
  const clear = (a, b) => !obstacles.some((o) => segmentHitsPolygon(a, b, o));
  const dist = nodes.map(() => Infinity);
  const prev = nodes.map(() => -1);
  const done = nodes.map(() => false);
  dist[0] = 0;
  for (let iter = 0; iter < nodes.length; iter++) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = true;
    if (u === 1) break;
    for (let v = 0; v < nodes.length; v++) {
      if (done[v]) continue;
      // The start and goal spots may touch the aircraft; only the middle of a leg must be clear.
      const a = nodes[u];
      const b = nodes[v];
      const shrinkA = u <= 1 ? lerp(a, b, 0.08) : a;
      const shrinkB = v <= 1 ? lerp(b, a, 0.08) : b;
      if (!clear(shrinkA, shrinkB)) continue;
      const d = dist[u] + Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d < dist[v]) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  if (dist[1] === Infinity) return [from, to];
  const path = [];
  for (let v = 1; v >= 0; v = prev[v]) path.unshift(nodes[v]);
  return path;
}

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
