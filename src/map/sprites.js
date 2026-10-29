// Top-down vector drawings of aircraft and ground vehicles, in metres, nose / front along +x.
// Original artwork in a clean top-down management-game style; detail is added as you zoom in.
// Aircraft shapes come from src/sim/airframe.js (real dimensions), the same geometry the
// simulation uses for collisions.
import { airframe } from '../sim/airframe.js';
import { brandOf, BRANDS } from '../sim/brands.js';

const geometryCache = new Map();

const poly = (path, pts) => {
  path.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
  path.closePath();
};
const mirrorY = (pts, s) => pts.map(([x, y]) => [x, y * s]);

// Paths for one aircraft type, built once from its real dimensions.
function aircraftGeometry(code) {
  if (geometryCache.has(code)) return geometryCache.get(code);
  const f = airframe(code);
  const { t, L, S, r, X, halfWidth: hw } = f;
  const { wing, stab } = f;
  const { le, te, chord, y0, kinkY } = wing;
  const props = Boolean(t.props);
  const spanFrac = (fr) => y0 + fr * (S - y0);

  // Fuselage: nose → tail along the right side and back along the left.
  const body = new Path2D();
  body.moveTo(f.profile[0][0], 0);
  for (const [x, y] of f.profile) body.lineTo(x, y);
  for (let i = f.profile.length - 1; i >= 0; i--) body.lineTo(f.profile[i][0], -f.profile[i][1]);
  body.closePath();

  // Radome: the darker nose cap.
  const radome = new Path2D();
  const cap = f.profile.slice(0, 5);
  radome.moveTo(cap[0][0], 0);
  for (const [x, y] of cap) radome.lineTo(x, y);
  for (let i = cap.length - 1; i >= 0; i--) radome.lineTo(cap[i][0], -cap[i][1]);
  radome.closePath();

  // Wings, panel lines, track fairings and wingtip devices.
  const wings = new Path2D();
  const leading = new Path2D();
  const flapLines = new Path2D();
  const slatLines = new Path2D();
  const spoilerLines = new Path2D();
  const spoilerPanels = new Path2D();
  const tracks = new Path2D();
  const tipDevice = new Path2D();
  const hinge = (y) => le(y) - 0.72 * chord(y);
  const flapEdges = props
    ? [y0 * 1.12, spanFrac(0.3), spanFrac(0.62), spanFrac(0.95)]
    : [y0 * 1.12, kinkY, spanFrac(0.7), spanFrac(0.96)];
  const spoilerY0 = spanFrac(0.3);
  const spoilerY1 = spanFrac(0.72);
  const pods = Array.isArray(t.nacelle.y) ? t.nacelle.y : [t.nacelle.y];
  for (const side of [-1, 1]) {
    poly(wings, mirrorY(wing.outline, side));
    leading.moveTo(le(y0), side * y0);
    leading.lineTo(le(S), side * S);
    // Trailing-edge hinge line and the ribs between flap and aileron segments.
    flapLines.moveTo(hinge(flapEdges[0]), side * flapEdges[0]);
    for (const y of flapEdges.slice(1)) flapLines.lineTo(hinge(y), side * y);
    for (const y of flapEdges) {
      flapLines.moveTo(hinge(y), side * y);
      flapLines.lineTo(te(y), side * y);
    }
    if (!props) {
      // Flap-track fairings under the flaps.
      for (const y of [flapEdges[1], (flapEdges[0] + flapEdges[1]) / 2, (flapEdges[1] + flapEdges[2]) / 2, flapEdges[2]]) {
        const rx = Math.max(0.5, L * 0.0165);
        tracks.moveTo(te(y) - L * 0.009 + rx, side * y); // own subpath: otherwise a line joins the ellipses
        tracks.ellipse(te(y) - L * 0.009, side * y, rx, 0.17, 0, 0, Math.PI * 2);
      }
      // Leading-edge slats, broken at the engine pylons.
      const segs = [];
      let a = y0 * 1.2;
      for (const py of pods) {
        segs.push([a, py - t.nacelle.d * 0.35]);
        a = py + t.nacelle.d * 0.35;
      }
      segs.push([a, S * 0.965]);
      for (const [ya, yb] of segs) {
        slatLines.moveTo(le(ya) - 0.13 * chord(ya), side * ya);
        slatLines.lineTo(le(yb) - 0.13 * chord(yb), side * yb);
        for (const y of [ya, yb]) {
          slatLines.moveTo(le(y), side * y);
          slatLines.lineTo(le(y) - 0.13 * chord(y), side * y);
        }
      }
      // Spoilers: five panels ahead of the flaps.
      const front = (y) => le(y) - 0.5 * chord(y);
      const back = (y) => le(y) - 0.69 * chord(y);
      spoilerLines.moveTo(front(spoilerY0), side * spoilerY0);
      spoilerLines.lineTo(front(spoilerY1), side * spoilerY1);
      for (let i = 0; i <= 5; i++) {
        const y = spoilerY0 + ((spoilerY1 - spoilerY0) * i) / 5;
        spoilerLines.moveTo(front(y), side * y);
        spoilerLines.lineTo(back(y), side * y);
      }
      for (let i = 0; i < 5; i++) {
        const ya = spoilerY0 + ((spoilerY1 - spoilerY0) * i) / 5;
        const yb = spoilerY0 + ((spoilerY1 - spoilerY0) * (i + 1)) / 5;
        poly(spoilerPanels, mirrorY([[front(ya), ya], [front(yb), yb], [back(yb), yb], [back(ya), ya]], side));
      }
    }
    // Winglets and wingtip devices stay inside the quoted span.
    const tip = t.wing.tip;
    if (tip && tip.kind !== 'raked') {
      const c = tip.chord ?? 1.5;
      const xFront = le(S) + (tip.kind === 'split' ? 0.7 : 0.25);
      poly(tipDevice, mirrorY([[xFront, S - 0.42], [xFront - c, S - 0.3], [xFront - c * 1.05, S], [xFront + 0.1, S]], side));
    }
  }
  // Wing-body fairing: the oval bulge where the wing meets the fuselage.
  const fairing = new Path2D();
  fairing.ellipse((le(y0) + te(y0)) / 2 - 0.2, 0, t.wing.rootChord * 0.6, r * 1.14, 0, 0, Math.PI * 2);

  // Horizontal tail with elevators, and the vertical fin seen from above.
  const stabPath = new Path2D();
  const elevators = new Path2D();
  const elevHinge = (y) => stab.le(y) - 0.64 * stab.chord(y);
  for (const side of [-1, 1]) {
    poly(stabPath, mirrorY(stab.outline, side));
    const ya = stab.y0 * 1.15;
    const yb = stab.half * 0.97;
    elevators.moveTo(elevHinge(ya), side * ya);
    elevators.lineTo(elevHinge(yb), side * yb);
    for (const y of [ya, (ya + yb) / 2, yb]) {
      elevators.moveTo(elevHinge(y), side * y);
      elevators.lineTo(stab.le(y) - stab.chord(y), side * y);
    }
  }
  const finChord = f.fin.le - f.fin.te;
  const finW = props ? 0.34 : Math.max(0.3, r * 0.2);
  const fin = new Path2D();
  poly(fin, [
    [f.fin.le, 0], [f.fin.le - finChord * 0.12, finW], [f.fin.te + finChord * 0.1, finW * 0.75], [f.fin.te, finW * 0.5],
    [f.fin.te, -finW * 0.5], [f.fin.te + finChord * 0.1, -finW * 0.75], [f.fin.le - finChord * 0.12, -finW],
  ]);
  const finRear = new Path2D();
  poly(finRear, [[f.fin.le - finChord * 0.52, 0], [f.fin.le - finChord * 0.52, finW * 0.86], [f.fin.te + finChord * 0.1, finW * 0.75], [f.fin.te, finW * 0.5], [f.fin.te, -finW * 0.5], [f.fin.te + finChord * 0.1, -finW * 0.75], [f.fin.le - finChord * 0.52, -finW * 0.86]]);
  const rearX = X(L - t.tailCone * 1.5);
  const finRib = new Path2D();
  finRib.moveTo(f.fin.le - finChord * 0.62, 0);
  finRib.lineTo(f.fin.te, 0);

  // Cockpit windscreen, doors, overwing exits, window rows, fuselage seams and the livery cheatline.
  const d1 = t.nose * 0.56;
  const d2 = t.nose * 0.74;
  const cockpit = new Path2D();
  poly(cockpit, [[X(d1), -hw(d1) * 0.72], [X(d2), -hw(d2) * 0.52], [X(d2), hw(d2) * 0.52], [X(d1), hw(d1) * 0.72]]);
  const cockpitPost = new Path2D();
  cockpitPost.moveTo(X(d1), 0);
  cockpitPost.lineTo(X(d2), 0);
  for (const k of [-0.72, 0.72]) {
    cockpitPost.moveTo(X(d1), hw(d1) * 0.72 * k);
    cockpitPost.lineTo(X(d2), hw(d2) * 0.52 * k);
  }
  const doors = new Path2D();
  for (const d of t.doors) for (const side of [-1, 1]) doors.rect(X(d) - 0.6, side > 0 ? r - 0.3 : -r, 1.2, 0.3);
  const exits = new Path2D();
  for (const d of t.exits) for (const side of [-1, 1]) exits.rect(X(d) - 0.35, side > 0 ? r - 0.26 : -r, 0.7, 0.26);
  const windows = new Path2D();
  const wFrom = X(t.doors[0] + 1.6);
  const wTo = X(t.doors.at(-1) - 1.6);
  for (const side of [-1, 1]) {
    windows.moveTo(wFrom, side * r * 0.84);
    windows.lineTo(wTo, side * r * 0.84);
  }
  const seams = new Path2D();
  const barrel = L < 45 ? 3.4 : 5.2;
  for (let d = t.nose + barrel; d < L - t.tailCone; d += barrel) {
    seams.moveTo(X(d), -hw(d) * 0.97);
    seams.lineTo(X(d), hw(d) * 0.97);
  }
  const cheat = new Path2D();
  for (const side of [-1, 1]) {
    cheat.moveTo(X(t.nose * 0.55), side * hw(t.nose * 0.55) * 0.86);
    cheat.lineTo(X(t.nose), side * r * 0.9);
    cheat.lineTo(X(L - t.tailCone * 0.55), side * hw(L - t.tailCone * 0.55) * 0.9);
  }

  // Wingtip light positions (port red, starboard green).
  const tips = [-1, 1].map((side) => [le(S) - chord(S) * 0.5, side * (S - 0.12), side]);
  const g = {
    f, L, S, r, props, body, radome, wings, leading, flapLines, slatLines, spoilerLines, spoilerPanels, tracks, tipDevice, fairing,
    stabPath, elevators, fin, finRear, rearX, finRib, cockpit, cockpitPost, doors, exits, windows, seams, cheat, tips,
    engines: f.engines, nacelle: t.nacelle, tTail: f.fin.tTail, flapCache: new Map(),
  };
  geometryCache.set(code, g);
  return g;
}

// Extended flaps and slats (landing and take-off configuration) as filled panels past the trailing
// and leading edges. `ext` is 0..1 of full extension.
function flapPanels(g, ext) {
  const key = Math.round(ext * 10);
  if (g.flapCache.has(key)) return g.flapCache.get(key);
  const { f, props, S } = g;
  const { le, te, chord, y0, kinkY } = f.wing;
  const flaps = new Path2D();
  const slats = new Path2D();
  const yEnd = y0 + (props ? 0.62 : 0.7) * (S - y0);
  const yStart = y0 * 1.12;
  const hinge = (y) => le(y) - 0.72 * chord(y);
  const aft = (y) => ext * 0.17 * chord(y);
  for (const side of [-1, 1]) {
    const segs = props || kinkY === null ? [[yStart, yEnd]] : [[yStart, kinkY], [kinkY, yEnd]];
    for (const [ya, yb] of segs) {
      poly(flaps, mirrorY([[hinge(ya), ya], [te(ya) - aft(ya), ya], [te(yb) - aft(yb), yb], [hinge(yb), yb]], side));
    }
    if (!props) {
      const y1 = y0 * 1.25;
      const y2 = S * 0.95;
      poly(slats, mirrorY([[le(y1), y1], [le(y1) + ext * 0.06 * chord(y1), y1], [le(y2) + ext * 0.06 * chord(y2), y2], [le(y2), y2]], side));
    }
  }
  const out = { flaps, slats };
  g.flapCache.set(key, out);
  return out;
}

// Flaps, slats and spoilers follow the flight phase: out for landing and take-off, spoilers up
// during the landing roll.
function configuration(a, alt) {
  switch (a.phase) {
    case 'final': return { flaps: 1, spoilers: false };
    case 'landing': return { flaps: 1, spoilers: alt <= 0.5 && (a.speed ?? 0) > 24 };
    case 'goAround': return { flaps: 0.6, spoilers: false };
    case 'takeoff': return { flaps: alt < 500 ? 0.55 : 0, spoilers: false };
    default: return { flaps: 0, spoilers: false };
  }
}

// alt (metres) lifts the aircraft off its shadow; scale is px per metre; time drives blinking lights.
// Colours for each part of the aircraft: the real airline's livery, or one neutral colour.
function liveryOf(a) {
  if (a.airline && BRANDS[a.airline]) return brandOf(a.airline).livery;
  const c = a.tail ?? '#3d6fa8';
  return { fin: c, stripe: c, engine: c, tips: c };
}

// Where an aircraft's lights are, in the world: wingtip navigation lights, tail light, beacon, strobes.
export function aircraftLights(a, time, moving) {
  const g = aircraftGeometry(a.type);
  const c = Math.cos(a.heading);
  const s = Math.sin(a.heading);
  const at = (x, y) => [a.x + x * c - y * s, a.y + x * s + y * c];
  const out = [];
  const strobe = moving && (time * 1.1) % 1 < 0.1;
  for (const [x, y, side] of g.tips) {
    const [wx, wy] = at(x, y);
    out.push({ x: wx, y: wy, color: strobe ? '#ffffff' : side < 0 ? '#ff2a22' : '#25d25a', r: strobe ? 10 : 5 });
  }
  const [tx, ty] = at(-g.L / 2 + 0.2, 0);
  out.push({ x: tx, y: ty, color: '#ffffff', r: 4 });
  if (moving && Math.floor(time * 1.2) % 2 === 0) {
    const [bx, by] = at(g.f.X(g.L * 0.45), 0);
    out.push({ x: bx, y: by, color: '#ff3b30', r: 9 });
  }
  return out;
}

export function drawAircraft(ctx, a, scale, { alt = 0, selected = false, time = 0, moving = false, shadow = null } = {}) {
  const g = aircraftGeometry(a.type);
  const lv = liveryOf(a);
  const hair = 1 / scale;
  const detail = scale > 1.2;
  const fine = scale > 3;
    ctx.save();
  ctx.translate(a.x, a.y);

  // Ground shadow, offset with altitude towards the south-east (sun in the north-west).
  // With a `shadow` ({ dx, dy, alpha } from the sun) it falls away from the sun and fades at night.
  const sh = shadow ?? { dx: 1.4, dy: 1.4, alpha: 1 };
  const dirLen = Math.hypot(sh.dx, sh.dy) || 1;
  ctx.save();
  ctx.translate(sh.dx + (sh.dx / dirLen) * alt * 0.35, sh.dy + (sh.dy / dirLen) * alt * 0.35);
  ctx.rotate(a.heading);
  ctx.fillStyle = sh.alpha <= 0.02 ? 'rgba(0,0,0,0)' : alt > 0 ? `rgba(0,0,0,${0.14 * sh.alpha})` : `rgba(20,25,20,${0.24 * sh.alpha})`;
  ctx.fill(g.wings);
  ctx.fill(g.stabPath);
  ctx.fill(g.body);
  ctx.fill(g.fin);
  for (const e of g.engines) {
    roundRect(ctx, e.x - e.len, e.y - e.r, e.len, e.r * 2, e.r * 0.6);
    ctx.fill();
  }
  ctx.restore();

  ctx.rotate(a.heading);
  const lift = 1 + Math.min(alt, 600) / 2400;
  ctx.scale(lift, lift);
  ctx.lineJoin = 'round';
  const outline = Math.max(0.2, hair * 0.8);
  const cfg = configuration(a, alt);

  // Jet engines hang under the wing: only the inlet end shows ahead of the leading edge.
  if (!g.props) for (const e of g.engines) drawJetEngine(ctx, e, g.nacelle, lv.engine, detail, fine, hair);

  // Extended slats and flaps sit behind the wing so the wing outline stays crisp over them.
  if (cfg.flaps > 0 && detail) {
    const p = flapPanels(g, cfg.flaps);
    ctx.fillStyle = '#dde2e7';
    ctx.strokeStyle = '#4f5964';
    ctx.lineWidth = Math.max(0.12, hair * 0.7);
    ctx.fill(p.flaps);
    ctx.stroke(p.flaps);
    ctx.fill(p.slats);
    ctx.stroke(p.slats);
  }

  // Wings and tailplane: light metal with a darker trailing edge.
  if (!g.tTail) {
    ctx.fillStyle = '#d3d9df';
    ctx.fill(g.stabPath);
  }
  ctx.fillStyle = '#e1e5e9';
  ctx.fill(g.wings);
  ctx.strokeStyle = '#5f6873';
  ctx.lineWidth = outline;
  ctx.stroke(g.wings);
  if (!g.tTail) ctx.stroke(g.stabPath);
  ctx.fillStyle = '#e4e8ec';
  ctx.fill(g.fairing);
  if (detail) {
    ctx.strokeStyle = 'rgba(95,104,115,0.62)';
    ctx.lineWidth = Math.max(0.1, hair * 0.55);
    ctx.stroke(g.flapLines);
    if (!g.tTail) ctx.stroke(g.elevators);
    ctx.stroke(g.slatLines);
    if (cfg.spoilers) {
      ctx.fillStyle = 'rgba(120,130,142,0.55)';
      ctx.fill(g.spoilerPanels);
    }
    ctx.stroke(g.spoilerLines);
    ctx.fillStyle = 'rgba(176,185,194,0.9)';
    ctx.fill(g.tracks);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 0.2;
    ctx.stroke(g.leading);
    ctx.fillStyle = lv.tips;
    ctx.globalAlpha = 0.9;
    ctx.fill(g.tipDevice);
    ctx.globalAlpha = 1;
  }

  // Turboprop nacelles sit on top of the wing and run past its trailing edge.
  if (g.props) for (const e of g.engines) drawPropEngine(ctx, e, g.nacelle, lv.engine, detail, scale, moving);

  // Fuselage: cylinder shading across its width.
  const bodyGrad = ctx.createLinearGradient(0, -g.r, 0, g.r);
  bodyGrad.addColorStop(0, '#bfc7cf');
  bodyGrad.addColorStop(0.3, '#fbfcfd');
  bodyGrad.addColorStop(0.62, '#f2f4f6');
  bodyGrad.addColorStop(1, '#aab3bc');
  ctx.fillStyle = bodyGrad;
  ctx.fill(g.body);
  ctx.strokeStyle = '#5a6470';
  ctx.lineWidth = outline;
  ctx.stroke(g.body);

  // Rear fuselage in the livery colour (airlines that paint the tail cone), then the tail fin: one or
  // two colours. T-tail aircraft carry the tailplane on top of it.
  if (lv.rear && detail) {
    ctx.save();
    ctx.clip(g.body);
    ctx.fillStyle = lv.fin;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(-g.L / 2 - 1, -g.r - 1, g.rearX + g.L / 2 + 1, g.r * 2 + 2);
    ctx.restore();
  }
  ctx.fillStyle = lv.fin;
  ctx.fill(g.fin);
  if (lv.fin2) {
    ctx.fillStyle = lv.fin2;
    ctx.fill(g.finRear);
  }
  if (detail) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 0.14;
    ctx.stroke(g.finRib);
  }
  if (g.tTail) {
    ctx.fillStyle = '#d7dce1';
    ctx.fill(g.stabPath);
    ctx.strokeStyle = '#5f6873';
    ctx.lineWidth = outline;
    ctx.stroke(g.stabPath);
    if (detail) {
      ctx.strokeStyle = 'rgba(95,104,115,0.62)';
      ctx.lineWidth = Math.max(0.1, hair * 0.55);
      ctx.stroke(g.elevators);
    }
  }

  if (detail) {
    ctx.fillStyle = '#b4bcc4';
    ctx.fill(g.radome);
    // Cheatline in the livery colour along the window line.
    ctx.strokeStyle = lv.stripe;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = Math.max(0.25, g.r * 0.17);
    ctx.stroke(g.cheat);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#2d3844';
    ctx.fill(g.cockpit);
    ctx.strokeStyle = 'rgba(160,185,210,0.55)';
    ctx.lineWidth = 0.1;
    ctx.stroke(g.cockpitPost);
    ctx.fillStyle = 'rgba(70,80,92,0.6)';
    ctx.fill(g.doors);
    ctx.fill(g.exits);
    // Antennas and the APU exhaust in the tail cone.
    ctx.fillStyle = '#6b7480';
    ctx.fillRect(g.f.X(g.f.t.doors[0] + 4), -0.15, 0.5, 0.3);
    ctx.fillRect(g.f.X(g.L * 0.55), -0.15, 0.5, 0.3);
    ctx.fillStyle = '#4b535c';
    dot(ctx, -g.L / 2 + 0.25, 0, Math.max(0.12, g.f.t.tailEnd * 0.4));
  }
  if (fine) {
    ctx.strokeStyle = 'rgba(70,84,102,0.55)';
    ctx.lineWidth = 0.28;
    ctx.setLineDash([0.42, 0.22]);
    ctx.stroke(g.windows);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(95,104,115,0.2)';
    ctx.lineWidth = 0.07;
    ctx.stroke(g.seams);
  }

  // Lights, only when zoomed in enough for them to read as lights (capped in metres, so they
  // never grow into blobs when zoomed out).
  const light = (r) => Math.min(1.6, Math.max(r, hair * 1.5));
  if (scale > 0.6) {
    // Wingtip navigation lights: red on the left (port), green on the right (starboard); white
    // strobes flash while the aircraft is moving.
    const strobe = moving && (time * 1.1) % 1 < 0.1;
    for (const [x, y, side] of g.tips) {
      ctx.fillStyle = strobe ? '#ffffff' : side < 0 ? '#e0312b' : '#22b14c';
      dot(ctx, x, y, light(strobe ? 0.45 : 0.28));
    }
    ctx.fillStyle = '#ffffff';
    dot(ctx, -g.L / 2 + 0.2, 0, light(0.3)); // tail light
  }
  // Anti-collision beacon on the fuselage: blinks while the aircraft is moving.
  const beaconOn = moving && Math.floor(time * 1.2) % 2 === 0;
  const bx = g.f.X(g.L * 0.45);
  if (scale > 0.6 || beaconOn) {
    ctx.fillStyle = beaconOn ? '#ff3b30' : '#9b2d2a';
    dot(ctx, bx, 0, beaconOn ? Math.max(0.4, hair * 2) : light(0.25));
    if (beaconOn) {
      ctx.fillStyle = 'rgba(255,59,48,0.25)';
      dot(ctx, bx, 0, Math.max(0.9, hair * 5));
    }
  }

  if (selected) {
    ctx.strokeStyle = '#f2c230';
    ctx.lineWidth = Math.max(1, hair * 2.5);
    ctx.setLineDash([hair * 6, hair * 4]);
    ctx.beginPath();
    ctx.arc(0, 0, g.L * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

// Jet engine pod: the inlet end ahead of the wing, with bright lip, livery band and (for newer
// engines) the serrated exhaust edge, which sits under the wing.
function drawJetEngine(ctx, e, n, accent, detail, fine, hair) {
  const { x, y, len, r } = e;
  const grad = ctx.createLinearGradient(0, y - r, 0, y + r);
  grad.addColorStop(0, '#79828c');
  grad.addColorStop(0.42, '#e4e8ec');
  grad.addColorStop(1, '#68717b');
  ctx.fillStyle = grad;
  roundRect(ctx, x - len, y - r, len, r * 2, r * 0.8);
  ctx.fill();
  ctx.strokeStyle = '#4f5862';
  ctx.lineWidth = Math.max(0.15, hair * 0.7);
  ctx.stroke();
  // Inlet lip: bright rim, then the dark fan face seen edge-on.
  ctx.fillStyle = '#f4f6f8';
  ctx.fillRect(x - r * 0.22, y - r * 0.86, r * 0.22, r * 1.72);
  ctx.fillStyle = '#2b3138';
  ctx.fillRect(x - r * 0.1, y - r * 0.7, r * 0.1, r * 1.4);
  if (detail) {
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x - len * 0.3, y - r, len * 0.1, r * 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(70,80,92,0.5)';
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.moveTo(x - len * 0.55, y - r);
    ctx.lineTo(x - len * 0.55, y + r);
    ctx.stroke();
  }
  if (fine && n.chevrons) {
    ctx.fillStyle = '#505a64';
    ctx.beginPath();
    const teeth = 10;
    for (let i = 0; i < teeth; i++) {
      const ya = y - r + (i / teeth) * r * 2;
      ctx.moveTo(x - len, ya);
      ctx.lineTo(x - len - 0.28, ya + (r * 2) / teeth / 2);
      ctx.lineTo(x - len, ya + (r * 2) / teeth);
    }
    ctx.fill();
  }
}

// Turboprop: slim nacelle with spinner and the propeller seen edge-on (a blurred disc when turning).
function drawPropEngine(ctx, e, n, accent, detail, scale, moving) {
  const { x, y, len, r } = e;
  const grad = ctx.createLinearGradient(0, y - r, 0, y + r);
  grad.addColorStop(0, '#7c858f');
  grad.addColorStop(0.45, '#dde2e6');
  grad.addColorStop(1, '#69727c');
  ctx.fillStyle = grad;
  roundRect(ctx, x - len, y - r, len, r * 2, r * 0.75);
  ctx.fill();
  ctx.strokeStyle = '#4f5862';
  ctx.lineWidth = Math.max(0.15, 0.7 / scale);
  ctx.stroke();
  if (detail) {
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x - len * 0.62, y - r, len * 0.07, r * 2);
    ctx.globalAlpha = 1;
    // Exhaust stubs on each side near the front of the nacelle.
    ctx.fillStyle = '#444b53';
    ctx.fillRect(x - len * 0.44, y - r - 0.12, 0.5, 0.14);
    ctx.fillRect(x - len * 0.44, y + r - 0.02, 0.5, 0.14);
  }
  const R = n.prop / 2;
  const px = x + 0.45;
  ctx.fillStyle = '#3c434b';
  ctx.beginPath();
  ctx.moveTo(px - 0.1, y - r * 0.5);
  ctx.quadraticCurveTo(px + 0.7, y, px - 0.1, y + r * 0.5);
  ctx.closePath();
  ctx.fill(); // spinner
  if (moving) {
    ctx.fillStyle = 'rgba(46,52,58,0.16)';
    ctx.beginPath();
    ctx.ellipse(px + 0.12, y, 0.22, R, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,46,52,0.4)';
    ctx.lineWidth = 0.16;
    ctx.beginPath();
    ctx.moveTo(px + 0.12, y - R);
    ctx.lineTo(px + 0.12, y + R);
    ctx.stroke();
  } else if (detail) {
    // Parked: blades at rest. Edge-on they project to different lengths across the disc.
    const spin = 0.35 + (y > 0 ? 0.5 : 0);
    ctx.strokeStyle = '#2e343a';
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    const blades = n.blades ?? 6;
    for (let i = 0; i < blades; i++) {
      const ang = spin + (i * Math.PI * 2) / blades;
      ctx.moveTo(px + 0.1, y);
      ctx.lineTo(px + 0.1, y + Math.sin(ang) * R);
    }
    ctx.stroke();
  }
}

// --- Ground vehicles ------------------------------------------------------------------------------

const SUITCASES = ['#2f4f7f', '#8c2f39', '#2d6a4f', '#3a3a3a', '#7f5a2f', '#5b3f8c', '#a17d2c', '#4a5d6b'];
const CAR_COLOURS = ['#e9ecef', '#b9bfc6', '#2f3337', '#8e1f24', '#2c4f7c', '#6c757d', '#d8c9a6'];

// Each draws in local metres with the vehicle's front towards +x, centred on (0, 0).
const VEHICLES = {
  tug(ctx, v, d) {
    shadowBox(ctx, 3.4, 1.9);
    wheels(ctx, d, [[-1, -0.95], [1, -0.95], [-1, 0.95], [1, 0.95]], 0.7, 0.32);
    body(ctx, -1.7, -0.95, 3.4, 1.9, '#e4b62c', 0.4);
    if (d) {
      ctx.fillStyle = '#c99c18';
      ctx.fillRect(0.6, -0.8, 1, 1.6); // engine hood
      ctx.fillStyle = '#2c3137';
      ctx.fillRect(-0.9, -0.6, 0.8, 1.2); // seat
      ctx.strokeStyle = '#2c3137';
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.arc(0.15, 0, 0.32, 0, Math.PI * 2); // steering wheel
      ctx.stroke();
      ctx.fillRect(-2.1, -0.12, 0.45, 0.24); // tow hitch
    }
  },
  cart(ctx, v, d) {
    shadowBox(ctx, 3.2, 1.7);
    wheels(ctx, d, [[-1.1, -0.85], [1.1, -0.85], [-1.1, 0.85], [1.1, 0.85]], 0.6, 0.28);
    body(ctx, -1.6, -0.85, 3.2, 1.7, '#7d8690', 0.15);
    ctx.fillStyle = '#5d656e';
    ctx.fillRect(-1.45, -0.7, 2.9, 1.4);
    if (d) {
      // Bags in the cart, colours fixed per cart.
      let s = (v.seed ?? 1) * 9301;
      for (let i = 0; i < 6; i++) {
        s = (s * 16807) % 2147483647;
        ctx.fillStyle = SUITCASES[s % SUITCASES.length];
        ctx.fillRect(-1.35 + (i % 3) * 0.95, -0.6 + Math.floor(i / 3) * 0.62, 0.8, 0.5);
      }
      ctx.fillStyle = '#3a4048';
      ctx.fillRect(1.6, -0.08, 0.8, 0.16); // drawbar
    }
  },
  beltLoader(ctx, v, d) {
    shadowBox(ctx, 8, 2.1);
    wheels(ctx, d, [[-2.8, -1], [2.2, -1], [-2.8, 1], [2.2, 1]], 0.8, 0.3);
    body(ctx, -4, -1.05, 8, 2.1, '#8f979f', 0.3);
    ctx.fillStyle = '#26292d';
    ctx.fillRect(-3.8, -0.5, 7.4, 1); // belt
    if (d) {
      ctx.strokeStyle = '#4a4f55';
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      for (let x = -3.6; x < 3.6; x += 0.5) {
        ctx.moveTo(x, -0.5);
        ctx.lineTo(x, 0.5);
      }
      ctx.stroke();
      ctx.fillStyle = '#e4b62c';
      ctx.fillRect(-4, -1.05, 8, 0.2); // side rails
      ctx.fillRect(-4, 0.85, 8, 0.2);
      ctx.fillStyle = '#2c3137';
      ctx.fillRect(-1.2, 0.55, 0.9, 0.45); // driver seat on the side
    }
  },
  fuel(ctx, v, d) {
    shadowBox(ctx, 10.5, 2.6);
    wheels(ctx, d, [[-3.8, -1.3], [-2.6, -1.3], [3.2, -1.3], [-3.8, 1.3], [-2.6, 1.3], [3.2, 1.3]], 1, 0.35);
    cab(ctx, 5.25, 3.2, 2.6, '#c63b2f', d);
    const g = ctx.createLinearGradient(0, -1.25, 0, 1.25);
    g.addColorStop(0, '#c7ccd1');
    g.addColorStop(0.45, '#ffffff');
    g.addColorStop(1, '#b3b9c0');
    ctx.fillStyle = g;
    roundRect(ctx, -5.2, -1.25, 7.3, 2.5, 1);
    ctx.fill();
    if (d) {
      ctx.strokeStyle = 'rgba(90,98,106,0.6)';
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      for (const x of [-3.3, -1.4, 0.5]) {
        ctx.moveTo(x, -1.2);
        ctx.lineTo(x, 1.2);
      }
      ctx.stroke();
      ctx.fillStyle = '#8b939b';
      ctx.fillRect(-4.9, -0.18, 6.6, 0.36); // top walkway
      ctx.fillStyle = '#d9a21b';
      ctx.fillRect(-0.4, 0.75, 0.8, 0.4); // hazard placard
      ctx.fillStyle = '#2c3137';
      dot(ctx, -5.5, 0, 0.45); // hose reel
    }
  },
  catering(ctx, v, d) {
    shadowBox(ctx, 8.4, 2.5);
    wheels(ctx, d, [[-2.6, -1.25], [2.8, -1.25], [-2.6, 1.25], [2.8, 1.25]], 0.9, 0.33);
    cab(ctx, 4.2, 2.4, 2.5, '#2f6fa3', d);
    body(ctx, -4.2, -1.25, 5.8, 2.5, '#f4f5f6', 0.3);
    if (d) {
      ctx.fillStyle = '#c9cfd5';
      ctx.fillRect(-3.4, -0.6, 1.6, 1.2); // roof cooling unit
      ctx.fillStyle = '#e4b62c';
      ctx.fillRect(-4.6, -1.25, 0.4, 2.5); // front platform rail (towards the aircraft door)
    }
  },
  water(ctx, v, d) {
    shadowBox(ctx, 6.5, 2.2);
    wheels(ctx, d, [[-1.8, -1.1], [2, -1.1], [-1.8, 1.1], [2, 1.1]], 0.8, 0.3);
    cab(ctx, 3.25, 2, 2.2, '#3a7d44', d);
    const g = ctx.createLinearGradient(0, -1, 0, 1);
    g.addColorStop(0, '#9fb7c9');
    g.addColorStop(0.5, '#e8f1f7');
    g.addColorStop(1, '#8aa3b6');
    ctx.fillStyle = g;
    roundRect(ctx, -3.2, -1, 4.4, 2, 0.9);
    ctx.fill();
  },
  gpu(ctx, v, d) {
    shadowBox(ctx, 2.6, 1.6);
    wheels(ctx, d, [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]], 0.5, 0.25);
    body(ctx, -1.3, -0.8, 2.6, 1.6, '#e4b62c', 0.2);
    if (d) {
      ctx.fillStyle = '#3a3f45';
      ctx.fillRect(-0.9, -0.5, 1.2, 1); // vent grille
      ctx.strokeStyle = '#2c3137';
      ctx.lineWidth = 0.1;
      ctx.beginPath();
      ctx.moveTo(1.3, 0);
      ctx.quadraticCurveTo(2.4, 0.9, 3.2, 0.2); // power cable
      ctx.stroke();
    }
  },
  pushback(ctx, v, d) {
    shadowBox(ctx, 6.6, 3);
    wheels(ctx, d, [[-2.1, -1.5], [2.1, -1.5], [-2.1, 1.5], [2.1, 1.5]], 1.1, 0.4);
    body(ctx, -3.3, -1.5, 6.6, 3, '#e4b62c', 0.5);
    if (d) {
      ctx.fillStyle = '#c99c18';
      ctx.fillRect(-2.6, -1.1, 3.4, 2.2);
      ctx.fillStyle = '#2b3440';
      ctx.fillRect(1.2, -1.3, 1.5, 1.1); // offset cab
      ctx.fillStyle = '#3a4048';
      ctx.fillRect(-6.5, -0.12, 3.2, 0.24); // tow bar to the nose gear
    }
  },
  stairs(ctx, v, d) {
    shadowBox(ctx, 8, 2.4);
    wheels(ctx, d, [[-2.4, -1.2], [2.4, -1.2], [-2.4, 1.2], [2.4, 1.2]], 0.8, 0.3);
    cab(ctx, 4, 2, 2.4, '#e9ecef', d);
    body(ctx, -4, -1.1, 6, 2.2, '#c3c9cf', 0.2);
    if (d) {
      ctx.strokeStyle = '#7a828b';
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      for (let x = -3.8; x < 1.8; x += 0.45) {
        ctx.moveTo(x, -0.9);
        ctx.lineTo(x, 0.9);
      }
      ctx.stroke();
      ctx.fillStyle = '#e4b62c';
      ctx.fillRect(-4, -1.1, 6, 0.15);
      ctx.fillRect(-4, 0.95, 6, 0.15);
      ctx.fillStyle = '#9aa2aa';
      ctx.fillRect(-4.6, -1.1, 0.8, 2.2); // top platform at the door
    }
  },
  bus(ctx, v, d) {
    shadowBox(ctx, 13.5, 2.9);
    body(ctx, -6.75, -1.45, 13.5, 2.9, '#2f7fbf', 0.6);
    ctx.fillStyle = '#e9eef2';
    ctx.fillRect(-6.4, -1.2, 12.8, 2.4); // white roof
    if (d) {
      ctx.fillStyle = '#9fb2c2';
      ctx.fillRect(-4.5, -0.7, 2.2, 1.4); // roof AC units
      ctx.fillRect(1, -0.7, 2.2, 1.4);
      ctx.fillStyle = '#26323e';
      ctx.fillRect(6.2, -1.3, 0.45, 2.6); // windscreen
      ctx.fillStyle = '#1f5f8f';
      for (const x of [-4.6, -0.6, 3.4]) ctx.fillRect(x, 1.2, 1.4, 0.25); // doors on the right side
    }
  },
  followMe(ctx, v, d) {
    shadowBox(ctx, 4.6, 1.9);
    body(ctx, -2.3, -0.95, 4.6, 1.9, '#f2c230', 0.6);
    ctx.fillStyle = '#26323e';
    ctx.fillRect(0.6, -0.8, 0.7, 1.6); // windscreen
    ctx.fillRect(-1.6, -0.8, 0.5, 1.6);
    if (d) {
      // Chequered roof sign and the light bar.
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#1d1d1d' : '#ffffff';
        ctx.fillRect(-1 + i * 0.4, -0.4 + j * 0.4, 0.4, 0.4);
      }
      ctx.fillStyle = '#ff9f0a';
      ctx.fillRect(-0.15, -0.8, 0.3, 1.6);
    }
  },
  fireTender(ctx, v, d) {
    shadowBox(ctx, 12, 3);
    wheels(ctx, d, [[-3.8, -1.5], [-1.6, -1.5], [3.4, -1.5], [-3.8, 1.5], [-1.6, 1.5], [3.4, 1.5]], 1.2, 0.45);
    body(ctx, -6, -1.5, 12, 3, '#c9302c', 0.5);
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(-5.5, -1.2, 8, 2.4); // roof
    if (d) {
      ctx.fillStyle = '#26323e';
      ctx.fillRect(4.8, -1.3, 0.6, 2.6);
      ctx.fillStyle = '#9aa2aa';
      dot(ctx, 3, 0, 0.6); // roof monitor (foam turret)
      ctx.fillRect(3, -0.15, 2.4, 0.3);
      ctx.fillStyle = '#4da3ff';
      ctx.fillRect(4.2, -1.2, 0.3, 0.8); // light bar
      ctx.fillStyle = '#ff3b30';
      ctx.fillRect(4.2, 0.4, 0.3, 0.8);
      ctx.fillStyle = '#e4b62c';
      ctx.fillRect(-6, -1.5, 12, 0.18);
      ctx.fillRect(-6, 1.32, 12, 0.18);
    }
  },
  van(ctx, v, d) {
    shadowBox(ctx, 5, 2);
    body(ctx, -2.5, -1, 5, 2, '#f1f3f5', 0.5);
    ctx.fillStyle = '#26323e';
    ctx.fillRect(1.6, -0.85, 0.6, 1.7);
    if (d) {
      ctx.fillStyle = '#ff9f0a';
      ctx.fillRect(0.9, -0.5, 0.3, 1); // beacon
    }
  },
  cone(ctx, v, d, scale) {
    const r = Math.max(0.35, 0.9 / scale);
    ctx.fillStyle = '#ff7a1a';
    dot(ctx, 0, 0, r);
    if (d) {
      ctx.fillStyle = '#ffffff';
      dot(ctx, 0, 0, r * 0.45);
    }
  },
};

export function drawVehicle(ctx, v, scale) {
  const draw = VEHICLES[v.kind];
  if (!draw) return;
  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.rotate(v.heading);
  draw(ctx, v, scale > 2.5, scale);
  ctx.restore();
}

// Cars on car-park decks: simple shaded body with windscreen.
export function drawCar(ctx, c) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.heading);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(-2.15, -0.85, 4.5, 1.85);
  ctx.fillStyle = CAR_COLOURS[c.color];
  roundRect(ctx, -2.25, -0.9, 4.5, 1.8, 0.5);
  ctx.fill();
  ctx.fillStyle = 'rgba(30,40,50,0.75)';
  ctx.fillRect(0.7, -0.75, 0.75, 1.5);
  ctx.fillRect(-1.6, -0.7, 0.5, 1.4);
  ctx.restore();
}

// --- helpers ---

function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

function body(ctx, x, y, w, h, colour, radius) {
  ctx.fillStyle = colour;
  roundRect(ctx, x, y, w, h, radius);
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,35,40,0.55)';
  ctx.lineWidth = 0.12;
  ctx.stroke();
}

// Driver's cab at the front of a truck: from frontX - len to frontX, with a dark windscreen.
function cab(ctx, frontX, len, width, colour, detail) {
  body(ctx, frontX - len, -width / 2, len, width, colour, 0.35);
  ctx.fillStyle = '#26323e';
  ctx.fillRect(frontX - Math.min(0.9, len * 0.35), -width / 2 + 0.2, 0.55, width - 0.4);
  if (detail) {
    ctx.fillStyle = '#2c3137';
    ctx.fillRect(frontX - len * 0.4, -width / 2 - 0.25, 0.25, 0.25); // mirrors
    ctx.fillRect(frontX - len * 0.4, width / 2, 0.25, 0.25);
  }
}

function shadowBox(ctx, l, w) {
  ctx.fillStyle = 'rgba(20,25,20,0.22)';
  ctx.fillRect(-l / 2 + 0.45, -w / 2 + 0.45, l, w);
}

function wheels(ctx, detail, positions, length, width) {
  if (!detail) return;
  ctx.fillStyle = '#1f2327';
  for (const [x, y] of positions) ctx.fillRect(x - length / 2, y - width / 2 - Math.sign(y) * 0.05, length, width);
}
