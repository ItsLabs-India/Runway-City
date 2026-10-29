// Ground staff on the apron: who is where and doing what, derived from each flight's turnaround tasks and
// the service vehicles. A ramp team (one "crew" in the simulation) is a lead plus baggage handlers; drivers
// stay in their vehicles, and fuellers, GPU and catering staff work beside their trucks. On push-back a
// headset operator walks by the nose and two wing walkers watch the wingtips; on a remote stand a
// marshaller with wands brings the aircraft in. Pure (no DOM): positions follow the game clock.
import { AIRCRAFT_TYPES } from './aircraftTypes.js';
import { airframe } from './airframe.js';

export const ROLES = {
  lead: { label: 'Ramp lead', vest: '#ffd21a', hat: '#ffffff' },
  bags: { label: 'Baggage handler', vest: '#ff7a1a', hat: '#f2f2f2' },
  marshal: { label: 'Marshaller', vest: '#ff7a1a', hat: '#ffd21a' },
  walker: { label: 'Wing walker', vest: '#c8ff1a', hat: '#ffffff' },
  headset: { label: 'Headset operator', vest: '#ffd21a', hat: '#ffffff' },
  fuel: { label: 'Fueller', vest: '#e33b2f', hat: '#ffffff' },
  gpu: { label: 'Ground power', vest: '#ff7a1a', hat: '#f2f2f2' },
  catering: { label: 'Catering', vest: '#2f6fd6', hat: '#2f6fd6' },
  cleaner: { label: 'Cleaner', vest: '#7a5bd6', hat: '#7a5bd6' },
};

// Team size per crew: wide-bodies need more baggage handlers.
export const teamSize = (type) => (AIRCRAFT_TYPES[type].code === 'E' ? 6 : 4);

const tri = (x) => {
  const k = ((x % 1) + 1) % 1;
  return k < 0.5 ? k * 2 : 2 - k * 2;
};

export function crewSprites(w) {
  const out = [];
  const t = w.t;
  const add = (p) => out.push(p);
  for (const f of w.flights) {
    if (!['atStand', 'pushback', 'turning', 'taxiIn'].includes(f.phase)) continue;
    const type = AIRCRAFT_TYPES[f.type];
    const af = airframe(f.type);
    const c = Math.cos(f.heading);
    const s = Math.sin(f.heading);
    const world = (x, y) => [f.x + x * c - y * s, f.y + x * s + y * c];
    const gN = type.length * type.noseGear;

    // Arrival: a marshaller on a remote stand, waving the aircraft in.
    if (f.phase === 'taxiIn' && f.standId !== null) {
      const st = w.standById.get(f.standId);
      if (st && !st.contact && f.path && f.limit - f.s < 220) {
        const ahead = type.length * (0.5 - type.noseGear) + 14;
        const left = Math.max(0, f.limit - f.s);
        add({ role: 'marshal', x: st.x + st.dir[0] * ahead, y: st.y + st.dir[1] * ahead, heading: Math.atan2(-st.dir[1], -st.dir[0]), anim: 'wave', rate: left < 15 ? 0.6 : 1.4, flightId: f.id });
      }
      continue;
    }

    // Push-back: headset operator at the nose, wing walkers at the tips.
    if (f.phase === 'pushback' || f.phase === 'turning') {
      const [hx, hy] = world(gN - 1, -(af.r + 2.6));
      add({ role: 'headset', x: hx, y: hy, heading: f.heading + Math.PI, anim: 'walk', flightId: f.id });
      const tipX = af.wing.le(af.S) - af.wing.chord(af.S) * 0.5;
      for (const side of [-1, 1]) {
        const [wx, wy] = world(tipX, side * (af.S + 2.5));
        add({ role: 'walker', x: wx, y: wy, heading: f.heading + Math.PI, anim: 'walk', flightId: f.id });
      }
      continue;
    }

    if (!f.tasks) continue;
    const task = (id) => f.tasks.find((x) => x.id === id);
    const working = (id) => task(id)?.state === 'work';

    // Ramp lead: chocks the nose gear, then stands by the nose with the paperwork.
    if (f.crew) {
      if (working('chocks')) {
        const [x, y] = world(gN + 0.7, 0.9);
        add({ role: 'lead', x, y, heading: f.heading + Math.PI, anim: 'work', flightId: f.id });
      } else {
        const [x, y] = world(type.length / 2 + 2.5, af.r + 3.5);
        add({ role: 'lead', x, y, heading: f.heading - Math.PI / 2, anim: working('close') ? 'work' : 'stand', flightId: f.id });
      }
    }

    // Vehicles of this flight that are at work.
    for (const v of w.vehicles) {
      if (v.flightId !== f.id || v.state !== 'working' || v.wx === undefined) continue;
      const vt = task(v.task);
      const active = vt?.state === 'work';
      const vc = Math.cos(v.wh);
      const vs = Math.sin(v.wh);
      const at = (x, y) => [v.wx + x * vc - y * vs, v.wy + x * vs + y * vc];
      if (v.kind === 'beltLoader' && f.crew) {
        // One handler at the foot of the belt, one or two carrying bags between the carts and the belt.
        const foot = at(-4.6, 0.6);
        add({ role: 'bags', x: foot[0], y: foot[1], heading: v.wh, anim: active ? 'work' : 'stand', flightId: f.id });
        const train = w.vehicles.find((x) => x.flightId === f.id && x.kind === 'tug' && x.state === 'working' && x.spot === (v.spot === 'beltAft' ? 'tugAft' : 'tugFwd'));
        const carts = train ? cartPositions(w, f, train) : [];
        const handlers = teamSize(f.type) - 2;
        for (let i = 0; i < Math.min(handlers, 2); i++) {
          const cart = carts[i % Math.max(1, carts.length)];
          const from = at(-4.2, -0.9 + i * 1.8);
          const to = cart ?? at(-7, -1.5 + i * 3);
          if (!active) {
            add({ role: 'bags', x: from[0], y: from[1], heading: v.wh + Math.PI, anim: 'stand', flightId: f.id });
            continue;
          }
          const k = tri(t / 9 + i * 0.37);
          const goingOut = ((t / 9 + i * 0.37) % 1) < 0.5;
          const x = from[0] + (to[0] - from[0]) * k;
          const y = from[1] + (to[1] - from[1]) * k;
          const dir = goingOut ? Math.atan2(to[1] - from[1], to[0] - from[0]) : Math.atan2(from[1] - to[1], from[0] - to[0]);
          // Unloading: bags are carried from the belt to the carts; loading: from the carts to the belt.
          const carrying = vt.id === 'unload' ? goingOut : !goingOut;
          add({ role: 'bags', x, y, heading: dir, anim: 'walk', carry: carrying, flightId: f.id });
        }
      } else if (v.kind === 'fuel' && active) {
        const [x, y] = at(-5.8, 1.9);
        add({ role: 'fuel', x, y, heading: v.wh + Math.PI / 2, anim: 'work', flightId: f.id });
      } else if (v.kind === 'gpu' && active) {
        const [x, y] = at(0, 1.6);
        add({ role: 'gpu', x, y, heading: v.wh + Math.PI / 2, anim: 'work', flightId: f.id });
      } else if (v.kind === 'catering' && active) {
        const [x, y] = at(-4.8, -1.8);
        add({ role: 'catering', x, y, heading: v.wh, anim: 'work', flightId: f.id });
      } else if (v.kind === 'van' && active) {
        // Cleaners walk between their van and the forward door.
        const [dx, dy] = world(af.X(type.doors[0]), -(af.r + 1.5));
        const from = at(0, -1.5);
        for (let i = 0; i < 2; i++) {
          const k = tri(t / 14 + i * 0.5);
          add({ role: 'cleaner', x: from[0] + (dx - from[0]) * k, y: from[1] + (dy - from[1]) * k, heading: Math.atan2(dy - from[1], dx - from[0]) + (((t / 14 + i * 0.5) % 1) < 0.5 ? 0 : Math.PI), anim: 'walk', flightId: f.id });
        }
      }
    }
  }
  return out;
}

// World positions of the carts of a tug train (the pieces after the tug).
function cartPositions(w, f, v) {
  const out = [];
  const lead = v.pieces[0];
  const baseH = f.heading + lead.h;
  for (const piece of v.pieces.slice(1)) {
    const ox = piece.x - lead.x;
    const oy = piece.y - lead.y;
    const rel = Math.atan2(oy, ox) - lead.h;
    const dist = Math.hypot(ox, oy);
    out.push([v.wx + Math.cos(baseH + rel) * dist, v.wy + Math.sin(baseH + rel) * dist]);
  }
  return out;
}

// Bags on this flight: arriving, departing, and how many have moved so far.
export function bagCounts(f, t) {
  const bagsIn = Math.round(f.paxIn * 1.15);
  const bagsOut = Math.round(f.paxOut * 1.2);
  const prog = (task) => (!task ? 0 : task.state === 'done' ? 1 : task.state === 'work' ? Math.max(0, Math.min(1, 1 - (task.end - t) / task.dur)) : 0);
  const unload = f.tasks?.find((x) => x.id === 'unload');
  const load = f.tasks?.find((x) => x.id === 'load');
  return { bagsIn, bagsOut, unloaded: Math.round(bagsIn * prog(unload)), loaded: Math.round(bagsOut * prog(load)) };
}
