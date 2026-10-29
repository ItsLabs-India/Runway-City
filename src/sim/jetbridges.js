// Working jet bridges (passenger boarding bridges). Each contact stand gets a bridge whose rotunda stands
// on the terminal facade; wide-body stands get a second one for the second door. A bridge drives from
// its parked position to the aircraft's left forward door while the "Jet bridge" task runs, stays docked
// through the turnaround, and drives back while the doors are being closed, so push-back can start.
// Pure geometry and timing (no DOM): the drawing reads it from World.jetBridgeSprites().
import { airframe } from './airframe.js';
import { closestOnPolyline } from '../map/geometry.js';

const MAX_REACH = 52; // metres from rotunda to cab: a long apron-drive bridge
const MIN_REACH = 9;
const PARK_LEN = 15; // parked: tunnel pulled in to this length

const unit = ([x, y]) => {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
};

// Where a door of a parked aircraft of `type` is, for a stand (nose gear on the stand point).
export function doorAt(stand, type, index, pose = null) {
  const f = airframe(type);
  const t = f.t;
  const h = pose ? pose.heading : Math.atan2(stand.dir[1], stand.dir[0]);
  const cx = pose ? pose.x : stand.x - Math.cos(h) * t.length * t.noseGear;
  const cy = pose ? pose.y : stand.y - Math.sin(h) * t.length * t.noseGear;
  const d = t.doors[Math.min(index, t.doors.length - 1)];
  const x = f.X(d);
  const y = -f.halfWidth(d); // left (port) side: passengers board on the left
  const c = Math.cos(h);
  const s = Math.sin(h);
  return { x: cx + x * c - y * s, y: cy + x * s + y * c, out: [s, -c], along: [c, s] };
}

// Nearest point on any terminal facade to p, within `max` metres.
function facade(terminals, p, max) {
  let best = null;
  for (const b of terminals) {
    const q = closestOnPolyline(p, [...b.polygon, b.polygon[0]]);
    if (q.dist <= max && (!best || q.dist < best.dist)) best = q;
  }
  return best;
}

export function buildJetBridges(map, stands) {
  const terminals = map.buildings.filter((b) => b.kind === 'terminal');
  const out = [];
  const make = (stand, index, refType, first = null) => {
    const door = doorAt(stand, refType, index);
    let rot = null;
    if (first) {
      // The second bridge stands beside the first, set back by the distance between the two doors.
      const d0 = doorAt(stand, refType, 0);
      const gap = Math.hypot(door.x - d0.x, door.y - d0.y);
      rot = [first.rotunda[0] - door.along[0] * gap, first.rotunda[1] - door.along[1] * gap];
    } else if (stand.bridge && index === 0) rot = [stand.bridge[0], stand.bridge[1]];
    else {
      const q = facade(terminals, [door.x, door.y], MAX_REACH + 6);
      if (q) {
        const toDoor = unit([door.x - q.x, door.y - q.y]);
        rot = [q.x + toDoor[0] * 4, q.y + toDoor[1] * 4]; // the rotunda stands just off the wall
      }
    }
    if (!rot) return null;
    const reach = Math.hypot(door.x - rot[0], door.y - rot[1]);
    if (reach > MAX_REACH || reach < MIN_REACH) return null;
    // Parked: pulled in and swung 30° towards the nose, clear of the arriving aircraft's wing.
    const toDoor = unit([door.x - rot[0], door.y - rot[1]]);
    const toNose = door.along;
    const cross = toDoor[0] * toNose[1] - toDoor[1] * toNose[0];
    const ang = Math.atan2(toDoor[1], toDoor[0]) + (cross > 0 ? 0.52 : -0.52);
    const park = [rot[0] + Math.cos(ang) * PARK_LEN, rot[1] + Math.sin(ang) * PARK_LEN];
    return { id: out.length, standId: stand.id, index, rotunda: rot, park, parkHeading: ang };
  };
  for (const s of stands) {
    if (!s.contact) continue;
    const a = make(s, 0, 'A20N');
    if (!a) continue;
    out.push(a);
    if (s.wideCapable) {
      const b = make(s, 1, 'B789', a);
      if (b && Math.hypot(b.rotunda[0] - a.rotunda[0], b.rotunda[1] - a.rotunda[1]) > 6) {
        b.id = out.length;
        out.push(b);
      }
    }
  }
  return out;
}

// How far out a bridge is (0 parked, 1 docked) and what it is doing, from the occupant's tasks.
export function bridgeExtension(f, index, t) {
  if (!f || f.phase !== 'atStand' || !f.tasks) return { e: 0, state: 'parked' };
  const af = airframe(f.type);
  if (index === 1 && (af.t.code !== 'E' || af.t.doors.length < 4)) return { e: 0, state: 'parked' };
  const connect = f.tasks.find((x) => x.id === 'connect');
  const close = f.tasks.find((x) => x.id === 'close');
  const prog = (task) => Math.max(0, Math.min(1, 1 - (task.end - t) / task.dur));
  if (close?.state === 'done') return { e: 0, state: 'parked' };
  if (close?.state === 'work') return { e: 1 - prog(close), state: 'retracting' };
  if (connect?.state === 'done') return { e: 1, state: 'docked' };
  if (connect?.state === 'work') return { e: prog(connect), state: 'docking' };
  return { e: 0, state: 'parked' };
}
