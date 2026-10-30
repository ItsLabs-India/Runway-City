// Airframe geometry derived from the real dimensions in aircraftTypes.js. Pure numbers (no DOM),
// shared by the drawing (map/sprites.js) and the collision footprints (footprint.js), so the
// aircraft you see is exactly the aircraft the simulation collides.
// Local frame: +x towards the nose, +y towards the right (starboard) wing, metres, origin at the
// middle of the fuselage.
import { AIRCRAFT_TYPES } from './aircraftTypes.js';

const RAD = Math.PI / 180;
const lerp = (a, b, f) => a + (b - a) * f;

// Convex hull (monotone chain) so every collision part is convex whatever the planform.
export function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const cache = new Map();

export function airframe(code) {
  if (cache.has(code)) return cache.get(code);
  const t = AIRCRAFT_TYPES[code];
  const L = t.length;
  const S = t.span / 2;
  const r = t.width / 2;
  const X = (d) => L / 2 - d; // distance from the nose tip → local x

  // ---- Fuselage outline: round nose, parallel barrel, tapering tail cone -------------------------
  const halfWidth = (d) => {
    if (d <= 0 || d >= L) return d <= 0 ? 0 : t.tailEnd;
    if (d < t.nose) {
      const u = d / t.nose;
      return r * Math.pow(1 - (1 - u) * (1 - u), 0.7);
    }
    const tailStart = L - t.tailCone;
    if (d <= tailStart) return r;
    const v = (d - tailStart) / t.tailCone;
    return t.tailEnd + (r - t.tailEnd) * (1 - Math.pow(v, 1.5));
  };
  const stations = [];
  for (let i = 0; i <= 14; i++) stations.push((i / 14) * t.nose);
  stations.push(t.nose + 0.01, L - t.tailCone);
  for (let i = 1; i <= 14; i++) stations.push(L - t.tailCone + (i / 14) * t.tailCone);
  const profile = stations.map((d) => [X(d), halfWidth(d)]); // nose → tail, right side (+y)

  // ---- Wing --------------------------------------------------------------------------------------
  const w = t.wing;
  const tanS = Math.tan(w.sweep * RAD);
  const y0 = r * 0.9; // wing roots start just inside the fuselage side
  const xRoot = X(w.root);
  const rakeY = w.rake ? S * (1 - w.rake.frac) : S + 1;
  const tanR = w.rake ? Math.tan((w.sweep + w.rake.extra) * RAD) : tanS;
  const kinkY = w.kinkChord ? y0 + w.kink * (S - y0) : null;
  const le = (y) => (y <= rakeY ? xRoot - (y - y0) * tanS : xRoot - (rakeY - y0) * tanS - (y - rakeY) * tanR);
  const chord = (y) => {
    if (kinkY === null) return lerp(w.rootChord, w.tipChord, (y - y0) / (S - y0));
    return y <= kinkY ? lerp(w.rootChord, w.kinkChord, (y - y0) / (kinkY - y0)) : lerp(w.kinkChord, w.tipChord, (y - kinkY) / (S - kinkY));
  };
  const te = (y) => le(y) - chord(y);
  // Planform outline for the right wing, leading edge root → tip then trailing edge tip → root.
  const wingOutline = [[le(y0), y0]];
  if (w.rake) wingOutline.push([le(rakeY), rakeY]);
  wingOutline.push([le(S), S], [te(S), S]);
  if (w.rake) wingOutline.push([te(rakeY), rakeY]);
  if (kinkY !== null) wingOutline.push([te(kinkY), kinkY]);
  wingOutline.push([te(y0), y0]);
  // Convex pieces for collision: inboard of the kink, then outboard.
  const wingPieces = kinkY === null
    ? [hull(wingOutline)]
    : [
      hull([[le(y0), y0], [le(kinkY), kinkY], [te(kinkY), kinkY], [te(y0), y0]]),
      hull([[le(kinkY), kinkY], [le(S), S], [te(S), S], [te(kinkY), kinkY]]),
    ];

  // ---- Tail --------------------------------------------------------------------------------------
  const st = t.stab;
  const stabLE0 = X(st.root);
  const stabY0 = Math.max(halfWidth(st.root + st.rootChord * 0.5), 0.3);
  const stabHalf = st.span / 2;
  const stabTan = Math.tan(st.sweep * RAD);
  const stabLE = (y) => stabLE0 - (y - stabY0) * stabTan;
  const stabChord = (y) => lerp(st.rootChord, st.tipChord, (y - stabY0) / (stabHalf - stabY0));
  const stabOutline = [[stabLE(stabY0), stabY0], [stabLE(stabHalf), stabHalf], [stabLE(stabHalf) - st.tipChord, stabHalf], [stabLE0 - st.rootChord, stabY0]];

  // ---- Engines -----------------------------------------------------------------------------------
  const n = t.nacelle;
  const engines = [];
  for (const y of Array.isArray(n.y) ? n.y : [n.y]) {
    for (const side of [-1, 1]) {
      // Under-wing pods: the inlet face sits `fwd` metres ahead of the wing leading edge (larger x =
      // nearer the nose). Rear-fuselage pods (business jets): the inlet is `x` metres from the nose.
      engines.push({ x: n.rear ? X(n.x) : le(y) + n.fwd, y: side * y, side, len: n.len, r: n.d / 2, rear: Boolean(n.rear) });
    }
  }

  const frame = {
    t, L, S, r, X, halfWidth, profile,
    wing: { le, te, chord, y0, kinkY, rakeY, xRoot, outline: wingOutline, pieces: wingPieces },
    stab: { le: stabLE, chord: stabChord, y0: stabY0, half: stabHalf, outline: stabOutline, xRoot: stabLE0 },
    fin: { le: X(t.fin.le), te: X(t.fin.te), tTail: Boolean(t.fin.tTail) },
    engines,
  };
  cache.set(code, frame);
  return frame;
}
