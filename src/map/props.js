// Derives the world's detail props from the map data: runway frames, hold-short lines,
// stand orientation, parked aircraft, ground vehicles and rooftop units. All deterministic.
import { closestOnPolyline, closestOnSegment, polygonArea, bbox, pointInPolygon, seeded } from './geometry.js';

const HOLD_DISTANCE_M = 90; // ICAO runway-holding position for code 4 instrument runways
const NOSE_TO_BUILDING_MAX_M = 110;
const JET_BRIDGE_REACH_M = 35;

// Both thresholds of each runway ("07/25") from its OSM pieces. Heading: x east, y south, degrees true.
export function runwayFrames(runways) {
  const byRef = new Map();
  for (const r of runways) {
    if (r.stopway || !r.ref.includes('/')) continue;
    if (!byRef.has(r.ref)) byRef.set(r.ref, { ref: r.ref, width: r.width, points: [] });
    byRef.get(r.ref).points.push(...r.points);
  }
  const frames = [];
  for (const { ref, width, points } of byRef.values()) {
    let best = [points[0], points[0]];
    let bestD = 0;
    for (const a of points) {
      for (const b of points) {
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (d > bestD) [best, bestD] = [[a, b], d];
      }
    }
    const [lo, hi] = ref.split('/');
    const [a, b] = best;
    const headingAB = (Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI;
    const diff = Math.abs(((((headingAB - Number(lo) * 10) % 360) + 540) % 360) - 180);
    const [loEnd, hiEnd] = diff < 90 ? [a, b] : [b, a];
    frames.push({ ref, width, length: bestD, ends: { [lo]: loEnd, [hi]: hiEnd } });
  }
  return frames;
}

// Where each taxiway crosses the 90 m line either side of a runway centreline.
export function holdShortLines(taxiways, frames) {
  const holds = [];
  for (const rwy of frames) {
    const [a, b] = Object.values(rwy.ends);
    for (const twy of taxiways) {
      for (let i = 1; i < twy.points.length; i++) {
        const p = twy.points[i - 1];
        const q = twy.points[i];
        const dp = closestOnSegment(p, a, b);
        const dq = closestOnSegment(q, a, b);
        // Only where the taxiway actually approaches the runway alongside its length.
        if (dp.t <= 0.001 || dp.t >= 0.999 || dq.t <= 0.001 || dq.t >= 0.999) continue;
        if ((dp.dist - HOLD_DISTANCE_M) * (dq.dist - HOLD_DISTANCE_M) > 0) continue;
        const t = (HOLD_DISTANCE_M - dp.dist) / (dq.dist - dp.dist);
        const x = p[0] + (q[0] - p[0]) * t;
        const y = p[1] + (q[1] - p[1]) * t;
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        let dir = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
        if (dq.dist > dp.dist) dir = [-dir[0], -dir[1]]; // dir points towards the runway
        holds.push({ x, y, dir, width: twy.width, runway: rwy.ref, taxiway: twy.ref });
      }
    }
  }
  return holds;
}

// Nose direction for each stand: towards the terminal / jet bridge if close, else away from the taxilane.
// OSM also tags boarding-gate doors on the terminal facade as "gate" (e.g. T1's 101A–107B); real
// stands keep their nose ≥ ~15 m off the building, so points inside or within 10 m of one are dropped.
const GATE_DOOR_MAX_M = 10;
export function orientStands(map) {
  const edges = [...map.buildings.map((b) => b.polygon), ...map.jetBridges.map((j) => j.points)];
  const gateDoor = (p) => map.buildings.some((b) => pointInPolygon(p, b.polygon) || closestOnPolyline(p, b.polygon).dist < GATE_DOOR_MAX_M);
  // OSM draws jet bridges in either direction, so both ends count when matching them to stands.
  const bridgeEnds = map.jetBridges.flatMap((j) => [j.points[0], j.points.at(-1)]);
  return map.stands.filter((s) => !gateDoor([s.x, s.y])).map((s) => {
    const p = [s.x, s.y];
    let nearest = { dist: Infinity };
    for (const ring of edges) {
      const c = closestOnPolyline(p, ring);
      if (c.dist < nearest.dist) nearest = c;
    }
    let dir;
    if (nearest.dist < NOSE_TO_BUILDING_MAX_M) {
      dir = [nearest.x - s.x, nearest.y - s.y];
    } else {
      let twy = { dist: Infinity };
      for (const t of map.taxiways) {
        const c = closestOnPolyline(p, t.points);
        if (c.dist < twy.dist) twy = c;
      }
      dir = [s.x - twy.x, s.y - twy.y];
    }
    const len = Math.hypot(...dir) || 1;
    // A contact stand is one a jet bridge actually reaches.
    const contact = bridgeEnds.some(([x, y]) => Math.hypot(x - s.x, y - s.y) < JET_BRIDGE_REACH_M);
    return { ...s, dir: [dir[0] / len, dir[1] / len], contact };
  });
}

// Trees in green areas near the terminals and landside, never close to runways, taxiways or aprons.
export function trees(map, frames) {
  const field = map.aerodrome;
  if (!field) return [];
  const box = bbox(field);
  const landside = map.buildings.filter((b) => ['terminal', 'parking', 'train_station', 'default'].includes(b.kind));
  const rnd = seeded(20261029);
  const out = [];
  const step = 9;
  // Obstacles with their keep-out margin; a bounding-box test skips far-away ones cheaply.
  const withBox = (shape, margin, ring) => {
    const b = bbox(shape);
    return { shape, margin, ring, minX: b.minX - margin, minY: b.minY - margin, maxX: b.maxX + margin, maxY: b.maxY + margin };
  };
  const obstacles = [
    ...map.taxiways.map((t) => withBox(t.points, t.width / 2 + 45, false)),
    ...map.aprons.map((a) => withBox(a.polygon, 12, true)),
    ...map.buildings.map((b) => withBox(b.polygon, 6, true)),
    ...map.zones.filter((z) => z.kind === 'construction').map((z) => withBox(z.polygon, 0, true)),
  ];
  const clear = (p) => {
    for (const r of frames) {
      const [a, b] = Object.values(r.ends);
      if (closestOnSegment(p, a, b).dist < 160) return false;
    }
    for (const o of obstacles) {
      if (p[0] < o.minX || p[0] > o.maxX || p[1] < o.minY || p[1] > o.maxY) continue;
      if ((o.ring && pointInPolygon(p, o.shape)) || closestOnPolyline(p, o.shape).dist < o.margin) return false;
    }
    return true;
  };
  // Groves: random circles near landside buildings; trees are sampled only inside them.
  const near = landside.map((b) => {
    const bb = bbox(b.polygon);
    return { minX: bb.minX - 450, minY: bb.minY - 450, maxX: bb.maxX + 450, maxY: bb.maxY + 450 };
  });
  for (let g = 0; g < 400; g++) {
    const gx = box.minX + rnd() * (box.maxX - box.minX);
    const gy = box.minY + rnd() * (box.maxY - box.minY);
    const gr = 25 + rnd() * 60;
    if (!near.some((n) => gx > n.minX && gx < n.maxX && gy > n.minY && gy < n.maxY)) continue;
    for (let x = gx - gr; x < gx + gr; x += step) {
      for (let y = gy - gr; y < gy + gr; y += step) {
        const p = [x + (rnd() - 0.5) * step, y + (rnd() - 0.5) * step];
        if (Math.hypot(p[0] - gx, p[1] - gy) > gr || rnd() < 0.35) continue;
        if (!pointInPolygon(p, field) || !clear(p)) continue;
        out.push({ x: p[0], y: p[1], r: 2.8 + rnd() * 3.2, shade: Math.floor(rnd() * 3) });
      }
    }
  }
  return out;
}

// Cars parked in rows on the car-park decks.
export function parkedCars(buildings) {
  const out = [];
  for (const b of buildings.filter((b) => b.kind === 'parking')) {
    const rnd = seeded(b.id);
    let axis = [1, 0];
    let best = 0;
    for (let i = 1; i < b.polygon.length; i++) {
      const dx = b.polygon[i][0] - b.polygon[i - 1][0];
      const dy = b.polygon[i][1] - b.polygon[i - 1][1];
      const len = Math.hypot(dx, dy);
      if (len > best) [axis, best] = [[dx / len, dy / len], len];
    }
    const [nx, ny] = [-axis[1], axis[0]];
    const box = bbox(b.polygon);
    const [cx, cy] = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
    const reach = Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 2;
    // Double rows of 5 m bays either side of a 6 m aisle, repeating every 16 m.
    for (let o = -reach; o < reach; o += 16) {
      for (const lane of [2.5, 13.5]) {
        for (let t = -reach; t < reach; t += 2.6) {
          const x = cx + nx * (o + lane) + axis[0] * t;
          const y = cy + ny * (o + lane) + axis[1] * t;
          if (rnd() < 0.3) continue;
          if (!pointInPolygon([x, y], b.polygon) || closestOnPolyline([x, y], b.polygon).dist < 3) continue;
          out.push({ x, y, heading: Math.atan2(ny, nx), color: Math.floor(rnd() * 7) });
        }
      }
    }
  }
  return out;
}

// Floodlight masts around the apron edges.
export function floodlights(aprons) {
  const out = [];
  for (const a of aprons) {
    let carry = 0;
    for (let i = 1; i < a.polygon.length; i++) {
      const [ax, ay] = a.polygon[i - 1];
      const [bx, by] = a.polygon[i];
      const len = Math.hypot(bx - ax, by - ay);
      for (let d = 110 - carry; d < len; d += 110) out.push({ x: ax + ((bx - ax) * d) / len, y: ay + ((by - ay) * d) / len });
      carry = (carry + len) % 110;
    }
  }
  return out;
}

// Fire tenders parked on the apron side of each fire station; follow-me cars by the tower.
export function emergencyVehicles(map) {
  const out = [];
  for (const b of map.buildings.filter((b) => b.kind === 'fire_station' || b.kind === 'tower')) {
    const c = [(bbox(b.polygon).minX + bbox(b.polygon).maxX) / 2, (bbox(b.polygon).minY + bbox(b.polygon).maxY) / 2];
    let twy = { dist: Infinity };
    for (const t of map.taxiways) {
      const p = closestOnPolyline(c, t.points);
      if (p.dist < twy.dist) twy = p;
    }
    const len = Math.hypot(twy.x - c[0], twy.y - c[1]) || 1;
    const [dx, dy] = [(twy.x - c[0]) / len, (twy.y - c[1]) / len];
    const edge = closestOnPolyline([c[0] + dx * 200, c[1] + dy * 200], b.polygon);
    const [px, py] = [-dy, dx];
    const kind = b.kind === 'fire_station' ? 'fireTender' : 'followMe';
    const count = b.kind === 'fire_station' ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * (kind === 'fireTender' ? 6 : 4);
      out.push({ kind, x: edge.x + dx * 9 + px * off, y: edge.y + dy * 9 + py * off, heading: Math.atan2(dy, dx), seed: b.id + i });
    }
  }
  return out;
}

// Edge lights: white along runway edges every 60 m, blue along taxiway edges every 30 m.
export function edgeLights(map, frames) {
  const runway = [];
  for (const r of frames) {
    const [a, b] = Object.values(r.ends);
    const len = r.length;
    const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    for (let d = 0; d <= len; d += 60) {
      for (const side of [-1, 1]) runway.push([a[0] + ux * d - uy * side * (r.width / 2 + 1.5), a[1] + uy * d + ux * side * (r.width / 2 + 1.5)]);
    }
  }
  const taxi = [];
  for (const t of map.taxiways) {
    let carry = 15;
    for (let i = 1; i < t.points.length; i++) {
      const [ax, ay] = t.points[i - 1];
      const [bx, by] = t.points[i];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
      let d = carry;
      for (; d < len; d += 30) {
        for (const side of [-1, 1]) {
          const p = [ax + ux * d - uy * side * (t.width / 2 + 1), ay + uy * d + ux * side * (t.width / 2 + 1)];
          if (!frames.some((r) => closestOnSegment(p, ...Object.values(r.ends)).dist < r.width / 2 + 3)) taxi.push(p);
        }
      }
      carry = d - len;
    }
  }
  return { runway, taxi };
}

// Rooftop units (AC plant, vents) on larger buildings.
export function rooftopUnits(buildings) {
  const units = [];
  for (const b of buildings) {
    const area = polygonArea(b.polygon);
    if (area < 1200) continue;
    const rnd = seeded(b.id);
    const box = bbox(b.polygon);
    const count = Math.min(40, Math.floor(area / 1500));
    let tries = 0;
    let placed = 0;
    while (placed < count && tries++ < count * 6) {
      const x = box.minX + rnd() * (box.maxX - box.minX);
      const y = box.minY + rnd() * (box.maxY - box.minY);
      const w = 3 + rnd() * 5;
      const h = 2 + rnd() * 4;
      if (!pointInPolygon([x, y], b.polygon) || !pointInPolygon([x + w, y + h], b.polygon)) continue;
      units.push({ x, y, w, h, building: b.id });
      placed++;
    }
  }
  return units;
}
