// Top-down 2D map renderer (Canvas 2D). The static airport is drawn to a cached layer that is
// only redrawn when the camera moves; moving traffic is drawn on top every frame.
import {
  runwayFrames, holdShortLines, rooftopUnits,
  trees, parkedCars, floodlights, emergencyVehicles, edgeLights,
} from './props.js';
import { drawAircraft, drawVehicle, drawCar } from './sprites.js';
import { bbox, overlaps, polygonArea, centroid, polylineLength, alongPolyline } from './geometry.js';
import { AIRCRAFT_TYPES } from '../sim/aircraftTypes.js';
import { brandOf, onColour } from '../sim/brands.js';
import { logoImage } from '../logos.js';
import { Atmosphere } from './atmosphere.js';
import { shadowOf } from '../sim/sky.js';

const C = {
  land: '#ebe6da',
  water: '#a7cde4',
  waterEdge: '#8fbad6',
  aerodrome: '#bfcd96',
  grass: '#b2c487',
  fence: '#6f7a5a',
  apron: '#cfccc3',
  apronJoint: 'rgba(120,116,105,0.35)',
  shoulder: '#c4c7b4',
  taxiway: '#565a60',
  taxiEdge: '#e2bf35',
  taxiLine: '#f0c83a',
  runway: '#3b3e44',
  runwayShoulder: '#a9ad9a',
  paint: '#f5f5f0',
  stopway: '#64686d',
  jetBridge: '#a9b1bb',
  jetBridgeEdge: '#59616b',
  shadow: 'rgba(40,45,35,0.22)',
  roofUnit: '#a3a9b0',
  label: '#24303c',
};

const ROOFS = {
  terminal: '#e9eef3',
  hangar: '#cdd2d8',
  tower: '#f2efe8',
  fire_station: '#d9534f',
  parking: '#c4beb3',
  train_station: '#d9cfbe',
  default: '#dad3c5',
};

const ROAD_STYLE = {
  motorway: { fill: '#f1c46f', casing: '#c4954a', minScale: 0 },
  trunk: { fill: '#f3cd7f', casing: '#c79b52', minScale: 0 },
  primary: { fill: '#f8dc9b', casing: '#c9a96a', minScale: 0 },
  secondary: { fill: '#fbecbe', casing: '#cdb98a', minScale: 0.03 },
  tertiary: { fill: '#ffffff', casing: '#c9c1b0', minScale: 0.05 },
  unclassified: { fill: '#ffffff', casing: '#cfc8b8', minScale: 0.1 },
  residential: { fill: '#ffffff', casing: '#d3ccbd', minScale: 0.12 },
  service: { fill: '#f7f5f0', casing: '#d3ccbd', minScale: 0.3 },
};
const ROAD_ORDER = ['service', 'residential', 'unclassified', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway'];
const CHUNK_M = 1000;

// eAIP approach lighting lengths per runway end (metres).
const APPROACH_LIGHTS = { '07': 900, 25: 510 };

export class MapRenderer {
  // `stands` come from the simulation, so paint and props match where aircraft really park.
  constructor(canvas, map, stands, graph) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = map;
    this.layer = document.createElement('canvas');
    this.layerKey = '';
    this.hit = document.createElement('canvas').getContext('2d');
    this.standsAll = stands;
    this.graph = graph;
    this.lockedCount = stands.filter((s) => s.locked).length;
    this.atmos = new Atmosphere();
    this.sun = { el: 60, az: 180 };
    this.world = this.#build();
  }

  // Stands that are locked (Terminal 3 before it is built) have no paint, label or pick target.
  #build() {
    const hide = new Set(this.standsAll.filter((s) => s.locked).map((s) => s.id));
    return buildWorld(this.map, this.standsAll.filter((s) => !s.locked), this.graph, hide);
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.canvas.clientWidth * this.dpr);
    this.canvas.height = Math.round(this.canvas.clientHeight * this.dpr);
    this.layer.width = this.canvas.width;
    this.layer.height = this.canvas.height;
    this.layerKey = '';
    this.atmos.resize(this.canvas.width, this.canvas.height);
  }

  // sim: the World; ui: { selected: {type,id}, standPick: {valid: Map(standId -> reason|null)} }
  draw(camera, sim, ui = {}) {
    this.t3 = sim.projects.t3.state;
    const locked = this.standsAll.filter((s) => s.locked).length;
    if (locked !== this.lockedCount) {
      this.lockedCount = locked;
      this.world = this.#build();
      this.layerKey = '';
    }
    this.sun = sim.sun();
    const sunKey = this.sun.el <= 0 ? 'n' : `${Math.round(this.sun.az / 4)}:${Math.round(this.sun.el / 4)}`;
    const key = `${camera.x.toFixed(2)},${camera.y.toFixed(2)},${camera.scale.toFixed(5)},${this.canvas.width}x${this.canvas.height},${this.t3},${sunKey}`;
    if (key !== this.layerKey) {
      this.#drawStatic(camera);
      this.layerKey = key;
    }
    const ctx = this.ctx;
    const s = camera.scale;
    const view = camera.view(60);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layer, 0, 0);
    this.atmos.ground(ctx, camera, sim, this.dpr); // cloud shadows, wet ground, fog
    camera.applyTo(ctx, this.dpr);
    const shadow = shadowOf(this.sun, 12);
    const vehicles = s > 0.3 ? sim.vehicleSprites() : [];

    const flights = sim.visibleFlights();
    const selectedFlight = ui.selected?.type === 'flight' ? sim.flights.find((f) => f.id === ui.selected.id) : null;
    const time = performance.now() / 1000;

    if (ui.heat !== false) this.#drawTerminalHeat(ctx, sim, camera);
    this.#drawStandStatus(ctx, sim, ui, camera);
    if (sim.runwayClosed()) this.#drawRunwayClosed(ctx, camera);

    // Layering, bottom to top: ground vehicles, aircraft on the ground, jet bridges (elevated,
    // they meet the aircraft door), aircraft in the air.
    if (s > 0.5) {
      for (const v of vehicles) {
        if ((v.kind === 'cone' && s < 1.2) || !inView(v, view, 15)) continue;
        drawVehicle(ctx, v, s);
      }
    }
    const ground = flights.filter((f) => f.alt <= 0.5);
    const air = flights.filter((f) => f.alt > 0.5);
    for (const f of ground) {
      if (!inView(f, view, 80)) continue;
      drawAircraft(ctx, f, s, { selected: f === selectedFlight, moving: f.phase !== 'atStand', time, shadow });
    }
    this.#drawJetBridges(ctx, sim);
    for (const f of air) drawAircraft(ctx, f, s, { alt: f.alt, selected: f === selectedFlight, moving: true, time, shadow });

    // Real aircraft from the live feed: translucent, with a dashed outline and their callsign.
    if (ui.ghosts?.length) {
      ctx.save();
      for (const g of ui.ghosts) {
        if (!inView(g, view, 100)) continue;
        ctx.globalAlpha = g.opacity;
        drawAircraft(ctx, { ...g, tail: '#7a8794' }, s, { alt: g.gnd ? 0 : Math.min(g.alt * 0.3048, 600), moving: !g.gnd, time, shadow });
      }
      ctx.restore();
    }

    // Night, weather and lights over everything on the map.
    this.atmos.sky(ctx, camera, sim, this.world, flights.filter((f) => f.alt >= 0), vehicles, time, this.dpr);
    camera.applyTo(ctx, this.dpr);

    // Route of the selected flight.
    if (selectedFlight?.path && ['taxiIn', 'taxiOut', 'pushback', 'lineUp'].includes(selectedFlight.phase)) {
      ctx.strokeStyle = 'rgba(242,194,48,0.85)';
      ctx.lineWidth = Math.max(1.5, 3 / s);
      ctx.setLineDash([8 / s, 6 / s]);
      ctx.beginPath();
      const pts = selectedFlight.path.pts;
      ctx.moveTo(selectedFlight.x, selectedFlight.y);
      for (let i = 1; i < pts.length; i++) if (selectedFlight.path.cum[i] > selectedFlight.s) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (ui.ghosts?.length && s > 0.25) {
      for (const g of ui.ghosts) {
        const [sx, sy] = camera.worldToScreen(g.x, g.y);
        if (sx < -50 || sy < -50 || sx > camera.width + 50 || sy > camera.height + 50) continue;
        airTag(ctx, g.airline, `${g.callsign} ${g.gnd ? '' : `${Math.round(g.alt / 100) * 100} ft`}`.trim(), sx + 14, sy + 14, '#9fb2c4');
      }
    }
    if (s > 0.35) {
      for (const f of flights) {
        if (f.phase === 'atStand' && s < 1.5 && f !== selectedFlight) continue;
        const [sx, sy] = camera.worldToScreen(f.x, f.y);
        if (sx < -50 || sy < -50 || sx > camera.width + 50 || sy > camera.height + 50) continue;
        const outbound = ['atStand', 'pushback', 'turning', 'taxiOut', 'holdShort', 'lineUp', 'takeoff'].includes(f.phase);
        airTag(ctx, f.airline, outbound ? f.depNo : f.arrNo, sx + 14, sy - 14, f.waiting ? '#ff9f43' : '#f2c230', s > 1.4 ? brandOf(f.airline).short : '');
      }
    }
    drawScaleBar(ctx, camera);
  }

  #drawJetBridges(ctx, sim) {
    const w = this.world;
    // Bridges added by the Terminal 3 project.
    ctx.lineCap = 'butt';
    for (const st of sim.stands) {
      if (!st.bridge) continue;
      const nx = st.x - st.dir[0] * 2;
      const ny = st.y - st.dir[1] * 2;
      ctx.strokeStyle = C.jetBridgeEdge;
      ctx.lineWidth = 4.6;
      ctx.beginPath();
      ctx.moveTo(st.bridge[0], st.bridge[1]);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      ctx.strokeStyle = C.jetBridge;
      ctx.lineWidth = 3.4;
      ctx.stroke();
      ctx.fillStyle = C.jetBridgeEdge;
      ctx.beginPath();
      ctx.arc(st.bridge[0], st.bridge[1], 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(nx - 2.2, ny - 2.2, 4.4, 4.4);
    }
    ctx.lineCap = 'butt';
    ctx.strokeStyle = C.jetBridgeEdge;
    ctx.lineWidth = 4.6;
    ctx.stroke(w.jetBridges);
    ctx.strokeStyle = C.jetBridge;
    ctx.lineWidth = 3.4;
    ctx.stroke(w.jetBridges);
    ctx.fillStyle = C.jetBridgeEdge;
    ctx.fill(w.rotundas);
  }

  // Closed stands get a red cross; the selected flight's stand a yellow ring; in stand-picking
  // mode every stand shows green (usable) or red (not).
  // Terminal buildings tinted by their worst queue wait: green under 8 min, amber under 15, red.
  #drawTerminalHeat(ctx, sim, camera) {
    const codes = { 'Terminal 1': 'T1', 'Terminal 4': 'T4', 'Terminal 2': 'T2' };
    for (const b of this.world.buildings) {
      if (b.kind !== 'terminal') continue;
      const code = Object.entries(codes).find(([n]) => b.name?.startsWith(n))?.[1];
      const T = code && sim.term.list[code];
      if (!T?.open) continue;
      const wait = sim.term.worstWait(T);
      ctx.fillStyle = wait < 8 ? 'rgba(52,199,89,0.22)' : wait < 15 ? 'rgba(255,159,10,0.38)' : 'rgba(255,59,48,0.5)';
      ctx.fill(b.path);
    }
    if (sim.projects.t3.state === 'done' && sim.term.list.T3.open) {
      const wait = sim.term.worstWait(sim.term.list.T3);
      ctx.fillStyle = wait < 8 ? 'rgba(52,199,89,0.22)' : wait < 15 ? 'rgba(255,159,10,0.38)' : 'rgba(255,59,48,0.5)';
      const site = this.world.zones.find((z) => z.kind === 'construction');
      if (site) ctx.fill(site.path);
    }
  }

  #drawStandStatus(ctx, sim, ui, camera) {
    const s = camera.scale;
    const ring = (x, y, r, colour, width) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    };
    for (const st of sim.stands) {
      if (st.locked) continue;
      if (st.closed) {
        const r = 10;
        ctx.strokeStyle = '#d93025';
        ctx.lineWidth = Math.max(1.5, 2.5 / s);
        ctx.beginPath();
        ctx.moveTo(st.x - r, st.y - r);
        ctx.lineTo(st.x + r, st.y + r);
        ctx.moveTo(st.x + r, st.y - r);
        ctx.lineTo(st.x - r, st.y + r);
        ctx.stroke();
      }
      if (ui.standPick) {
        const ok = !ui.standPick.valid.get(st.id);
        ring(st.x, st.y, Math.max(7, 9 / s), ok ? 'rgba(52,199,89,0.95)' : 'rgba(217,48,37,0.5)', Math.max(1.2, 2.5 / s));
      }
    }
    const sel = ui.selected;
    const standId = sel?.type === 'stand' ? sel.id : sel?.type === 'flight' ? sim.flights.find((f) => f.id === sel.id)?.standId : null;
    const st = standId !== null && standId !== undefined ? sim.standById.get(standId) : null;
    if (st) ring(st.x, st.y, Math.max(12, 14 / s), '#f2c230', Math.max(1.5, 3 / s));
  }

  #drawRunwayClosed(ctx, camera) {
    const s = camera.scale;
    for (const frame of this.world.frames) {
      if (frame.ref !== '07/25') continue;
      for (const end of Object.values(frame.ends)) {
        const r = 22;
        ctx.strokeStyle = '#d93025';
        ctx.lineWidth = Math.max(4, 6 / s);
        ctx.beginPath();
        ctx.moveTo(end[0] - r, end[1] - r);
        ctx.lineTo(end[0] + r, end[1] + r);
        ctx.moveTo(end[0] + r, end[1] - r);
        ctx.lineTo(end[0] - r, end[1] + r);
        ctx.stroke();
      }
    }
  }

  // What is under a screen point: { type: 'flight' | 'stand' | 'runway' | 'info', ... } or null.
  pick(camera, sx, sy, sim) {
    const [x, y] = camera.screenToWorld(sx, sy);
    const slack = 8 / camera.scale;
    for (const f of sim.visibleFlights()) {
      if (Math.hypot(f.x - x, f.y - y) < AIRCRAFT_TYPES[f.type].length / 2 + slack) return { type: 'flight', id: f.id };
    }
    const h = this.hit;
    h.setTransform(1, 0, 0, 1, 0, 0);
    for (const st of sim.stands) {
      if (!st.locked && Math.hypot(st.x - x, st.y - y) < Math.max(12, slack)) return { type: 'stand', id: st.id };
    }
    for (const f of this.world.features) {
      if (!f.box || (x >= f.box.minX - slack && x <= f.box.maxX + slack && y >= f.box.minY - slack && y <= f.box.maxY + slack)) {
        let inside;
        if (f.stroke) {
          h.lineWidth = f.stroke + slack;
          inside = h.isPointInStroke(f.path, x, y);
        } else {
          inside = h.isPointInPath(f.path, x, y);
        }
        if (inside) return f.runway ? { type: 'runway' } : { type: 'info', info: f.info };
      }
    }
    return null;
  }

  #drawStatic(camera) {
    const ctx = this.layer.getContext('2d');
    const w = this.world;
    const s = camera.scale;
    const px = 1 / s; // one screen pixel in metres
    const view = camera.view(40);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.land;
    ctx.fillRect(0, 0, this.layer.width, this.layer.height);
    camera.applyTo(ctx, this.dpr);
    ctx.lineJoin = 'round';

    // Water.
    ctx.fillStyle = C.water;
    ctx.fill(w.water);
    ctx.lineCap = 'round';
    for (const [width, path] of w.waterways) {
      ctx.strokeStyle = C.water;
      ctx.lineWidth = Math.max(width, 1.2 * px);
      ctx.stroke(path);
    }

    // Roads: casings first, then fills, minor to major, only the visible chunks.
    const chunks = w.roadChunks.filter((c) => overlaps(c.box, view));
    for (const pass of ['casing', 'fill']) {
      for (const kind of ROAD_ORDER) {
        const style = ROAD_STYLE[kind];
        if (s < style.minScale) continue;
        ctx.strokeStyle = style[pass];
        for (const c of chunks) {
          const group = c.kinds.get(kind);
          if (!group) continue;
          const base = Math.max(group.width, (pass === 'casing' ? 1.6 : 0.8) * px);
          ctx.lineWidth = pass === 'casing' ? base + Math.max(1.5, 1.2 * px) : base;
          ctx.stroke(group.path);
        }
      }
    }

    // Rail: suburban rail grey with sleepers, metro (elevated) purple.
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#8c9096';
    ctx.lineWidth = Math.max(3, 1.5 * px);
    ctx.stroke(w.rail.rail);
    if (s > 0.25) {
      ctx.strokeStyle = '#f4f2ec';
      ctx.lineWidth = Math.max(1.2, 0.6 * px);
      ctx.setLineDash([10, 10]);
      ctx.stroke(w.rail.rail);
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = '#7a69ad';
    ctx.lineWidth = Math.max(5, 2 * px);
    ctx.stroke(w.rail.metro);

    // Airfield ground.
    ctx.fillStyle = C.aerodrome;
    ctx.fill(w.aerodrome);
    ctx.fillStyle = s > 0.6 ? w.mowPattern(ctx) : C.grass;
    ctx.fill(w.grass);
    ctx.strokeStyle = C.fence;
    ctx.lineWidth = Math.max(1, 1.2 * px);
    ctx.setLineDash([6 * Math.max(1, px), 4 * Math.max(1, px)]);
    ctx.stroke(w.aerodrome);
    ctx.setLineDash([]);

    // Zones: hatched no-build enclaves and the T3 construction site.
    for (const z of w.zones) {
      if (z.kind === 'construction' && this.t3 === 'done') {
        ctx.fillStyle = C.shadow;
        ctx.save();
        ctx.translate(11, 11);
        ctx.fill(z.path);
        ctx.restore();
        ctx.fillStyle = ROOFS.terminal;
        ctx.fill(z.path);
        ctx.save();
        ctx.clip(z.path);
        ctx.strokeStyle = 'rgba(150,190,220,0.75)';
        ctx.lineWidth = 3.5;
        ctx.stroke(w.hatch(z.box, 16));
        ctx.restore();
        ctx.strokeStyle = '#7b828b';
        ctx.lineWidth = Math.max(0.4, 0.9 * px);
        ctx.stroke(z.path);
        continue;
      }
      ctx.fillStyle = z.kind === 'military' ? 'rgba(192,80,77,0.16)' : 'rgba(232,145,58,0.28)';
      ctx.fill(z.path);
      ctx.save();
      ctx.clip(z.path);
      ctx.strokeStyle = z.kind === 'military' ? 'rgba(170,60,58,0.35)' : 'rgba(200,110,30,0.45)';
      ctx.lineWidth = Math.max(1.5, px);
      ctx.stroke(w.hatch(z.box, z.kind === 'military' ? 40 : 18));
      ctx.restore();
      ctx.strokeStyle = z.kind === 'military' ? '#b0504d' : '#d07a2a';
      ctx.lineWidth = Math.max(1.5, 1.5 * px);
      ctx.setLineDash([8 * Math.max(1, px), 5 * Math.max(1, px)]);
      ctx.stroke(z.path);
      ctx.setLineDash([]);
    }

    // Aprons with concrete slab joints when zoomed in.
    ctx.fillStyle = C.apron;
    ctx.fill(w.aprons);
    if (s > 1.2) {
      ctx.save();
      ctx.clip(w.aprons);
      ctx.strokeStyle = C.apronJoint;
      ctx.lineWidth = px;
      ctx.stroke(w.slabGrid(view));
      ctx.restore();
    }

    // Shoulders, then taxiway edge paint, asphalt and centrelines; runways on top.
    ctx.lineCap = 'round';
    ctx.strokeStyle = C.shoulder;
    for (const [width, path] of w.taxiways) {
      ctx.lineWidth = width + 12;
      ctx.stroke(path);
    }
    ctx.lineCap = 'butt';
    ctx.strokeStyle = C.runwayShoulder;
    for (const r of w.runways) {
      ctx.lineWidth = r.width + 15;
      ctx.stroke(r.path);
    }
    for (const st of w.stopways) drawStopway(ctx, st, px);
    ctx.lineCap = 'round';
    if (s > 0.5) {
      ctx.strokeStyle = C.taxiEdge;
      for (const [width, path] of w.taxiways) {
        ctx.lineWidth = width + 0.6;
        ctx.stroke(path);
      }
    }
    ctx.strokeStyle = C.taxiway;
    for (const [width, path] of w.taxiways) {
      ctx.lineWidth = s > 0.5 ? width - 0.9 : width;
      ctx.stroke(path);
    }
    // Taxi centrelines at real width (0.3 m, never thinner than a pixel). These are exactly the
    // lines aircraft follow; lines over runway pavement are covered by the runway below.
    ctx.lineCap = 'round';
    ctx.strokeStyle = C.taxiLine;
    ctx.lineWidth = Math.max(0.3, px);
    ctx.stroke(w.taxiCentre);

    ctx.lineCap = 'butt';
    ctx.strokeStyle = C.runway;
    for (const r of w.runways) {
      ctx.lineWidth = r.width;
      ctx.stroke(r.path);
    }
    for (const frame of w.frames) drawRunwayMarkings(ctx, frame, this.map.meta.runwayFacts, s);
    for (const frame of w.frames) drawApproachLights(ctx, frame, px);
    for (const hold of w.holds) drawHoldShort(ctx, hold, s);
    // Yellow lead-off / lead-on curves between runway centreline and taxiways, over the runway.
    ctx.strokeStyle = C.taxiLine;
    ctx.lineWidth = Math.max(0.3, px);
    ctx.stroke(w.leadOff);

    // Edge lights: white along runways, blue along taxiways.
    if (s > 0.45) {
      ctx.fillStyle = '#fffbe6';
      ctx.fill(w.lights.runway);
      ctx.fillStyle = '#3d7bff';
      ctx.fill(w.lights.taxi);
    }

    // Stand paint: red envelope lines, blue equipment boxes, yellow-black no-parking hatching,
    // yellow lead-in lines with T stop bars.
    if (s > 0.45) {
      ctx.lineCap = 'butt';
      if (s > 1.6) {
        // Close-up only: at mid zoom these read as clutter.
        ctx.lineWidth = Math.max(0.3, 0.8 * px);
        ctx.strokeStyle = 'rgba(200,55,45,0.85)';
        ctx.stroke(w.standPaint.red);
        ctx.strokeStyle = '#2f7fd0';
        ctx.stroke(w.standPaint.blue);
      }
      if (s > 0.9) {
        ctx.save();
        ctx.clip(w.standPaint.hatchBoxes);
        ctx.fillStyle = '#e8c12f';
        ctx.fill(w.standPaint.hatchBoxes);
        ctx.strokeStyle = '#26292d';
        ctx.lineWidth = 0.9;
        ctx.stroke(w.hatch(w.standPaint.hatchBox, 2.4));
        ctx.restore();
      }
      ctx.strokeStyle = C.taxiLine;
      ctx.lineWidth = Math.max(0.4, 0.8 * px);
      ctx.stroke(w.standLines);
    }
    if (s > 0.25) {
      ctx.fillStyle = '#7d858d';
      ctx.fill(w.floodlights.base);
      if (s > 1) {
        ctx.fillStyle = '#f5f1d6';
        ctx.fill(w.floodlights.lamps);
      }
    }

    // Jet bridges are drawn in the moving layer, above parked aircraft.

    // Buildings: shadows, roofs, roof detail, outlines.
    ctx.fillStyle = C.shadow;
    for (const b of w.buildings) {
      if (!overlaps(b.box, view)) continue;
      const sh = shadowOf(this.sun, Math.max(4, b.height));
      if (sh.alpha < 0.03) continue;
      ctx.save();
      ctx.globalAlpha = sh.alpha;
      ctx.translate(sh.dx, sh.dy);
      ctx.fill(b.path);
      ctx.restore();
    }
    for (const b of w.buildings) {
      if (!overlaps(b.box, view)) continue;
      ctx.fillStyle = ROOFS[b.kind] ?? ROOFS.default;
      ctx.fill(b.path);
      if (s > 0.35 && b.detail) {
        ctx.save();
        ctx.clip(b.path);
        drawRoofDetail(ctx, b, px);
        ctx.restore();
      }
      ctx.strokeStyle = '#7b828b';
      ctx.lineWidth = Math.max(0.4, 0.9 * px);
      ctx.stroke(b.path);
    }
    if (s > 0.35) {
      for (const u of w.roofUnits) {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(u.x + 0.8, u.y + 0.8, u.w, u.h);
        ctx.fillStyle = C.roofUnit;
        ctx.fillRect(u.x, u.y, u.w, u.h);
      }
    }

    // Cars on the car-park decks.
    if (s > 0.6) for (const c of w.cars) if (inView(c, view)) drawCar(ctx, c);

    // Trees: shadows, then canopies in three greens, then highlights.
    if (s > 0.06) {
      ctx.fillStyle = 'rgba(30,45,20,0.28)';
      ctx.fill(w.trees.shadow);
      ['#5f8a3e', '#6f9a45', '#4f7a36'].forEach((colour, i) => {
        ctx.fillStyle = colour;
        ctx.fill(w.trees.canopy[i]);
      });
      if (s > 0.5) {
        ctx.fillStyle = 'rgba(190,220,140,0.35)';
        ctx.fill(w.trees.highlight);
      }
    }

    // Fire tenders and follow-me cars parked at their stations (static props).
    if (s > 0.5) for (const v of w.vehicles) if (inView(v, view, 15)) drawVehicle(ctx, v, s);
    for (const sock of w.windsocks) drawWindsock(ctx, sock, px);

    // Labels in screen space.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawLabels(ctx, camera, this.t3 === 'done' ? w.labels.map((l) => (l.zoneKind === 'construction' ? { ...l, text: 'Terminal 3', style: 'terminal' } : l)) : w.labels);
  }
}

// --- World construction (once) -------------------------------------------------------------------

function buildWorld(map, stands, graph, hide = null) {
  const frames = runwayFrames(map.runways);
  const holds = holdShortLines(map.taxiways, frames);

  const polyPath = (points, path = new Path2D()) => {
    points.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
    return path;
  };
  const ringPath = (points, path = new Path2D()) => {
    polyPath(points, path);
    path.closePath();
    return path;
  };

  const features = []; // for click picking, most specific first
  const water = new Path2D();
  for (const lake of map.water) {
    ringPath(lake.polygon, water);
    if (lake.name) features.push({ path: ringPath(lake.polygon), box: bbox(lake.polygon), info: { title: lake.name, lines: ['Lake / water body'] }, late: true });
  }
  const waterways = new Map();
  for (const ww of map.waterways) {
    if (!waterways.has(ww.width)) waterways.set(ww.width, new Path2D());
    polyPath(ww.points, waterways.get(ww.width));
    if (ww.name) features.push({ path: polyPath(ww.points), stroke: ww.width, box: bbox(ww.points), info: { title: ww.name, lines: [ww.kind === 'river' ? 'River' : 'Canal / stream'] }, late: true });
  }

  const roadChunks = new Map();
  for (const r of map.roads) {
    const box = bbox(r.points);
    const key = `${Math.floor(box.minX / CHUNK_M)},${Math.floor(box.minY / CHUNK_M)}`;
    if (!roadChunks.has(key)) roadChunks.set(key, { box: { ...box }, kinds: new Map() });
    const chunk = roadChunks.get(key);
    Object.assign(chunk.box, {
      minX: Math.min(chunk.box.minX, box.minX), minY: Math.min(chunk.box.minY, box.minY),
      maxX: Math.max(chunk.box.maxX, box.maxX), maxY: Math.max(chunk.box.maxY, box.maxY),
    });
    if (!chunk.kinds.has(r.kind)) chunk.kinds.set(r.kind, { width: r.width, path: new Path2D() });
    polyPath(r.points, chunk.kinds.get(r.kind).path);
    if (r.name && ['motorway', 'trunk', 'primary', 'secondary'].includes(r.kind)) {
      features.push({ path: polyPath(r.points), stroke: r.width, box, info: { title: r.name, lines: [`${r.kind[0].toUpperCase()}${r.kind.slice(1)} road`] }, late: true });
    }
  }

  const rail = { rail: new Path2D(), metro: new Path2D() };
  for (const r of map.railways) polyPath(r.points, r.kind === 'rail' ? rail.rail : rail.metro);

  const aprons = new Path2D();
  for (const a of map.aprons) {
    ringPath(a.polygon, aprons);
    features.push({ path: ringPath(a.polygon), box: bbox(a.polygon), info: { title: 'Apron', lines: ['Aircraft parking area'] }, late: true });
  }
  const grass = new Path2D();
  for (const g of map.grass) ringPath(g, grass);

  const taxiways = new Map();
  for (const t of map.taxiways) {
    if (!taxiways.has(t.width)) taxiways.set(t.width, new Path2D());
    polyPath(t.points, taxiways.get(t.width));
    features.push({ path: polyPath(t.points), stroke: t.width, box: bbox(t.points), info: { title: t.ref ? `Taxiway ${t.ref}` : 'Taxiway', lines: [`Width ${t.width} m`] } });
  }

  // Painted taxi lines come from the simulation's taxi network: straight centrelines, curves at
  // every junction and bend, stand lead-ins — the same geometry the aircraft steer along.
  const paint = graph.paintLines(hide);
  const taxiCentre = new Path2D();
  const leadOff = new Path2D();
  for (const [a, b] of paint.straight) {
    taxiCentre.moveTo(a[0], a[1]);
    taxiCentre.lineTo(b[0], b[1]);
  }
  for (const arc of paint.arcs) polyPath(arc.pts, arc.runway ? leadOff : taxiCentre);

  const runways = [];
  const stopways = [];
  for (const r of map.runways) {
    const path = polyPath(r.points);
    if (r.stopway) {
      const frame = frames.find((f) => Object.values(f.ends).some(([ex, ey]) => r.points.some(([x, y]) => Math.hypot(x - ex, y - ey) < 5)));
      const end = frame && Object.values(frame.ends).find(([ex, ey]) => r.points.some(([x, y]) => Math.hypot(x - ex, y - ey) < 5));
      stopways.push({ points: r.points, width: r.width, end });
      features.unshift({ path, stroke: r.width, box: bbox(r.points), info: { title: 'Stopway', lines: ['Overrun area beyond the runway end'] } });
    } else {
      runways.push({ path, width: r.width });
      const frame = frames.find((f) => f.ref === r.ref);
      features.unshift({
        path, stroke: r.width, box: bbox(r.points), runway: r.ref === '07/25',
        info: { title: `Runway ${r.ref}`, lines: [`${Math.round(frame?.length ?? 0)} m × ${r.width} m`, r.ref === '07/25' ? 'Main runway · ILS CAT I both ends' : 'Secondary runway · Code C · crosses the Adyar river'] },
      });
    }
  }

  // Stand paint, in each stand's frame: f = towards the nose stop, r = to the right.
  const standLines = new Path2D();
  const standPaint = { red: new Path2D(), blue: new Path2D(), hatchBoxes: new Path2D(), hatchBox: null };
  const hatchPts = [];
  for (const s of stands) {
    const [fx, fy] = s.dir;
    const [rx, ry] = [-fy, fx];
    const at = (along, side) => [s.x + fx * along + rx * side, s.y + fy * along + ry * side];
    const seg = (path, a, b) => {
      path.moveTo(...a);
      path.lineTo(...b);
    };
    const half = s.wide ? 34 : 20;
    const depth = s.wide ? 64 : 40; // envelope sides stop short of the taxilane
    seg(standLines, at(0, -3), at(0, 3)); // stop bar
    for (const back of [6, 12]) seg(standLines, at(-back, -1.5), at(-back, 1.5)); // stop marks for smaller types
    if (s.contact) {
      // Envelope sides only on contact stands, where the stand direction is reliable.
      seg(standPaint.red, at(4, -half), at(-depth, -half));
      seg(standPaint.red, at(4, half), at(-depth, half));
    }
    // Blue equipment staging box beside the nose on the right.
    const box = [at(-3, half - 1), at(-3, half - 11), at(-15, half - 11), at(-15, half - 1)];
    standPaint.blue.moveTo(...box[0]);
    for (const p of box.slice(1)) standPaint.blue.lineTo(...p);
    standPaint.blue.closePath();
    if (s.contact) {
      // No-parking hatching between the nose and the terminal (jet bridge swing area).
      const hb = [at(3, -6), at(3, 6), at(13, 6), at(13, -6)];
      standPaint.hatchBoxes.moveTo(...hb[0]);
      for (const p of hb.slice(1)) standPaint.hatchBoxes.lineTo(...p);
      standPaint.hatchBoxes.closePath();
      hatchPts.push(...hb);
    }
  }
  standPaint.hatchBox = hatchPts.length ? bbox(hatchPts) : { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  // Lights, trees, floodlights.
  const lightPts = edgeLights(map, frames);
  const lights = { runway: new Path2D(), taxi: new Path2D() };
  for (const [x, y] of lightPts.runway) lights.runway.rect(x - 0.8, y - 0.8, 1.6, 1.6);
  for (const [x, y] of lightPts.taxi) lights.taxi.rect(x - 0.6, y - 0.6, 1.2, 1.2);
  const treeList = trees(map, frames);
  const treePaths = { shadow: new Path2D(), canopy: [new Path2D(), new Path2D(), new Path2D()], highlight: new Path2D() };
  for (const t of treeList) {
    circle(treePaths.shadow, t.x + t.r * 0.45, t.y + t.r * 0.45, t.r);
    circle(treePaths.canopy[t.shade], t.x, t.y, t.r);
    circle(treePaths.highlight, t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.45);
  }
  const floods = { base: new Path2D(), lamps: new Path2D() };
  const floodPts = floodlights(map.aprons);
  for (const f of floodPts) {
    circle(floods.base, f.x, f.y, 1.4);
    floods.lamps.rect(f.x - 1.6, f.y - 0.5, 3.2, 1);
  }

  const jetBridges = new Path2D();
  const rotundas = new Path2D();
  for (const jb of map.jetBridges) {
    polyPath(jb.points, jetBridges);
    const [x, y] = jb.points[0];
    rotundas.moveTo(x + 3, y);
    rotundas.arc(x, y, 3, 0, Math.PI * 2);
    const [ex, ey] = jb.points.at(-1);
    rotundas.rect(ex - 2.2, ey - 2.2, 4.4, 4.4);
    features.unshift({ path: polyPath(jb.points), stroke: 4, box: bbox(jb.points), info: { title: 'Jet bridge', lines: ['Contact stand boarding'] } });
  }

  const buildings = map.buildings.map((b) => {
    const path = ringPath(b.polygon);
    const area = polygonArea(b.polygon);
    const box = bbox(b.polygon);
    features.unshift({ path, box, info: { title: b.name || buildingLabel(b.kind), lines: [buildingLabel(b.kind), `~${Math.round(area).toLocaleString('en-IN')} m² footprint`] } });
    return { ...b, path, box, area, detail: area > 1500 ? roofDetailPaths(b, box) : null };
  });

  const zones = map.zones.map((z) => {
    const path = ringPath(z.polygon);
    features.push({ path, box: bbox(z.polygon), info: { title: z.name, lines: z.kind === 'military' ? ['Defence enclave', 'No-build zone'] : ['Under construction', 'Terminal 3 (T2 phase 2) site'] } });
    return { ...z, path, box: bbox(z.polygon) };
  });

  // Aerodrome boundary last among fills so it is the fallback pick.
  const aerodrome = map.aerodrome ? ringPath(map.aerodrome) : new Path2D();

  const labels = [];
  for (const b of buildings) {
    if (b.kind === 'terminal') labels.push({ at: centroid(b.polygon), text: b.name || 'Terminal', style: 'terminal', minScale: 0.07 });
    else if (b.kind === 'tower') labels.push({ at: centroid(b.polygon), text: 'ATC Tower', style: 'building', minScale: 0.3 });
    else if (b.name) labels.push({ at: centroid(b.polygon), text: b.name, style: 'building', minScale: 0.5 });
  }
  for (const t of map.taxiways) {
    if (!t.ref || polylineLength(t.points) < 120) continue;
    const mid = alongPolyline(t.points, polylineLength(t.points) / 2);
    labels.push({ at: [mid.x, mid.y], text: t.ref, style: 'taxiway', minScale: 0.35 });
  }
  for (const s of stands) labels.push({ at: [s.x - s.dir[0] * 74, s.y - s.dir[1] * 74], text: s.ref, style: 'stand', minScale: 1.0 });
  for (const z of map.zones) labels.push({ at: centroid(z.polygon), text: z.name, style: 'zone', minScale: 0.12, zoneKind: z.kind });
  const named = new Set();
  for (const ww of map.waterways) {
    if (ww.kind !== 'river' || named.has(ww.name) || ww.points.length < 10) continue;
    named.add(ww.name);
    const mid = alongPolyline(ww.points, polylineLength(ww.points) / 2);
    labels.push({ at: [mid.x, mid.y], text: ww.name, style: 'water', minScale: 0.06 });
  }
  for (const lake of map.water) {
    if (lake.name && polygonArea(lake.polygon) > 60_000) labels.push({ at: centroid(lake.polygon), text: lake.name, style: 'water', minScale: 0.12 });
  }

  let mow = null;
  return {
    frames, stands, holds,
    roofUnits: rooftopUnits(map.buildings),
    water, waterways, roadChunks: [...roadChunks.values()], rail,
    aerodrome, grass, aprons, zones, taxiways, taxiCentre, leadOff, runways, stopways,
    standLines, standPaint, jetBridges, rotundas, buildings, labels,
    lights, floodPts, trees: treePaths, floodlights: floods, cars: parkedCars(map.buildings),
    vehicles: emergencyVehicles(map),
    windsocks: map.windsocks,
    features: [...features.filter((f) => !f.late), ...features.filter((f) => f.late)],
    mowPattern(ctx) {
      if (!mow) {
        const tile = document.createElement('canvas');
        tile.width = tile.height = 32;
        const t = tile.getContext('2d');
        t.fillStyle = C.grass;
        t.fillRect(0, 0, 32, 32);
        t.fillStyle = 'rgba(255,255,255,0.07)';
        t.fillRect(0, 0, 32, 16);
        mow = ctx.createPattern(tile, 'repeat');
        mow.setTransform(new DOMMatrix().rotate(-21).scale(0.75)); // 12 m mowing stripes, along 07/25
      }
      return mow;
    },
    hatch(box, spacing) {
      const p = new Path2D();
      const size = box.maxX - box.minX + box.maxY - box.minY;
      for (let d = -size; d < size; d += spacing) {
        p.moveTo(box.minX + d, box.minY);
        p.lineTo(box.minX + d + size, box.minY + size);
      }
      return p;
    },
    slabGrid(view) {
      const p = new Path2D();
      const step = 7.5;
      for (let x = Math.floor(view.minX / step) * step; x < view.maxX; x += step) {
        p.moveTo(x, view.minY);
        p.lineTo(x, view.maxY);
      }
      for (let y = Math.floor(view.minY / step) * step; y < view.maxY; y += step) {
        p.moveTo(view.minX, y);
        p.lineTo(view.maxX, y);
      }
      return p;
    },
  };
}

function buildingLabel(kind) {
  return {
    terminal: 'Passenger terminal',
    hangar: 'Hangar',
    tower: 'Air traffic control tower',
    fire_station: 'Airport fire station',
    parking: 'Multi-level car park',
    train_station: 'Rail station',
  }[kind] ?? 'Building';
}

// Skylight strips for terminals, ridge lines for hangars, parking-bay lines for car parks.
function roofDetailPaths(b, box) {
  // Main axis = direction of the longest polygon edge.
  let best = [1, 0];
  let bestLen = 0;
  for (let i = 1; i < b.polygon.length; i++) {
    const dx = b.polygon[i][0] - b.polygon[i - 1][0];
    const dy = b.polygon[i][1] - b.polygon[i - 1][1];
    const len = Math.hypot(dx, dy);
    if (len > bestLen) [best, bestLen] = [[dx / len, dy / len], len];
  }
  const spacing = { terminal: 16, hangar: 3, parking: 2.6 }[b.kind] ?? 0;
  if (!spacing) return null;
  const [ax, ay] = best;
  const [nx, ny] = [-ay, ax];
  const [cx, cy] = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
  const reach = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
  const path = new Path2D();
  for (let o = -reach / 2; o < reach / 2; o += spacing) {
    path.moveTo(cx + nx * o - ax * reach, cy + ny * o - ay * reach);
    path.lineTo(cx + nx * o + ax * reach, cy + ny * o + ay * reach);
  }
  return { path, kind: b.kind };
}

function drawRoofDetail(ctx, b, px) {
  const d = b.detail;
  if (d.kind === 'terminal') {
    ctx.strokeStyle = 'rgba(150,190,220,0.75)';
    ctx.lineWidth = 3.5;
  } else if (d.kind === 'hangar') {
    if (px > 0.6) return;
    ctx.strokeStyle = 'rgba(110,118,128,0.35)';
    ctx.lineWidth = Math.max(0.25, 0.6 * px);
  } else {
    if (px > 0.5) return;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 0.15;
  }
  ctx.stroke(d.path);
  // Parapet: a lighter band just inside the edge.
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 2.4;
  ctx.stroke(b.path);
}

// --- Runway paint, lights and signs ---------------------------------------------------------------

function drawRunwayMarkings(ctx, frame, facts, scale) {
  const ends = Object.entries(frame.ends);
  const W = frame.width;
  const L = frame.length;
  const displaced = facts?.displacedThresholds ?? {};
  ctx.fillStyle = C.paint;

  ends.forEach(([designator, end], i) => {
    const other = ends[1 - i][1];
    const ux = (other[0] - end[0]) / L;
    const uy = (other[1] - end[1]) / L;
    ctx.save();
    ctx.translate(end[0], end[1]);
    ctx.rotate(Math.atan2(uy, ux)); // local +x runs down the runway from this threshold
    const base = displaced[designator] ?? 0;

    if (base > 0) {
      // Displaced threshold: arrows along the centreline and a transverse bar.
      for (let x = 30; x < base - 40; x += 60) arrow(ctx, x, 0, 20, 1.8);
      ctx.fillRect(base - 1.8, -W / 2 + 1, 1.8, W - 2);
    }
    // Threshold "piano keys".
    for (const side of [-1, 1]) {
      for (let k = 0; k < 6; k++) ctx.fillRect(base + 6, side * (2.7 + k * 3.6) - 0.9, 30, 1.8);
    }
    // Designator, readable when approaching.
    ctx.save();
    ctx.translate(base + 54, 0);
    ctx.rotate(Math.PI / 2);
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(designator, 0, 0);
    ctx.restore();
    // Touchdown zone bars and the aiming point.
    if (scale > 0.15) {
      for (const [at, bars] of [[150, 3], [300, 3], [550, 2], [700, 2], [850, 1]]) {
        for (const side of [-1, 1]) {
          for (let b = 0; b < bars; b++) ctx.fillRect(base + at, side * (9 + b * 3.3) - 0.9, 22.5, 1.8);
        }
      }
      for (const side of [-1, 1]) ctx.fillRect(base + 400, side > 0 ? 9 : -16, 50, 7);
    }
    ctx.restore();
  });

  // Centreline dashes and edge lines, once per runway.
  const [[d0, e0], [d1, e1]] = ends;
  const ux = (e1[0] - e0[0]) / L;
  const uy = (e1[1] - e0[1]) / L;
  ctx.save();
  ctx.translate(e0[0], e0[1]);
  ctx.rotate(Math.atan2(uy, ux));
  const start = (displaced[d0] ?? 0) + 72;
  const stop = L - (displaced[d1] ?? 0) - 72;
  if (scale > 0.12) for (let x = start; x < stop - 30; x += 50) ctx.fillRect(x, -0.45, 30, 0.9);
  ctx.fillRect(0, -W / 2 + 0.5, L, 0.9);
  ctx.fillRect(0, W / 2 - 1.4, L, 0.9);
  ctx.restore();
}

function arrow(ctx, x, y, length, width) {
  ctx.fillRect(x, y - width / 2, length * 0.7, width);
  ctx.beginPath();
  ctx.moveTo(x + length, y);
  ctx.lineTo(x + length * 0.65, y - width * 2);
  ctx.lineTo(x + length * 0.65, y + width * 2);
  ctx.closePath();
  ctx.fill();
}

function drawApproachLights(ctx, frame, px) {
  const ends = Object.entries(frame.ends);
  ends.forEach(([designator, end], i) => {
    const length = APPROACH_LIGHTS[designator];
    if (!length) return;
    const other = ends[1 - i][1];
    const ux = (end[0] - other[0]) / frame.length; // outward, away from the runway
    const uy = (end[1] - other[1]) / frame.length;
    ctx.save();
    ctx.translate(end[0], end[1]);
    ctx.rotate(Math.atan2(uy, ux));
    ctx.fillStyle = '#5b6168';
    const bar = Math.max(1.2, 1.2 * px);
    for (let x = 30; x <= length; x += 30) ctx.fillRect(x - bar / 2, -2, bar, 4);
    if (length >= 300) ctx.fillRect(300 - bar / 2, -15, bar, 30);
    ctx.fillStyle = '#7fbf6a'; // green threshold lights
    ctx.fillRect(-1, -frame.width / 2, 2, frame.width);
    ctx.restore();
  });
}

function drawHoldShort(ctx, hold, scale) {
  const W = hold.width;
  ctx.save();
  ctx.translate(hold.x, hold.y);
  ctx.rotate(Math.atan2(hold.dir[1], hold.dir[0])); // +x points towards the runway
  ctx.fillStyle = C.taxiEdge;
  if (scale < 0.7) {
    ctx.fillRect(-1, -W / 2, 2.4, W);
  } else {
    ctx.fillRect(-1.6, -W / 2, 0.5, W);
    ctx.fillRect(-0.8, -W / 2, 0.5, W);
    for (const x of [0, 0.8]) for (let y = -W / 2; y < W / 2; y += 2) ctx.fillRect(x, y, 0.5, 1.1);
  }
  if (scale > 2.2) {
    // Runway-holding sign: red with white runway designators.
    ctx.translate(-2, W / 2 + 4);
    ctx.rotate(-Math.atan2(hold.dir[1], hold.dir[0]));
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(-4.5, -1.3, 9, 2.6);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 1.8px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(hold.runway.replace('/', '-'), 0, 0.1);
  }
  ctx.restore();
}

function drawStopway(ctx, st, px) {
  ctx.lineCap = 'butt';
  ctx.strokeStyle = C.stopway;
  ctx.lineWidth = st.width;
  ctx.beginPath();
  st.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  if (!st.end || px > 2) return;
  // Yellow chevrons pointing at the runway.
  const far = st.points.reduce((a, p) => (Math.hypot(p[0] - st.end[0], p[1] - st.end[1]) > Math.hypot(a[0] - st.end[0], a[1] - st.end[1]) ? p : a));
  const len = Math.hypot(far[0] - st.end[0], far[1] - st.end[1]);
  ctx.save();
  ctx.translate(st.end[0], st.end[1]);
  ctx.rotate(Math.atan2(far[1] - st.end[1], far[0] - st.end[0]));
  ctx.strokeStyle = C.taxiEdge;
  ctx.lineWidth = 1.5;
  for (let x = 15; x < len - 5; x += 30) {
    ctx.beginPath();
    ctx.moveTo(x + 12, -st.width / 2 + 2);
    ctx.lineTo(x, 0);
    ctx.lineTo(x + 12, st.width / 2 - 2);
    ctx.stroke();
  }
  ctx.restore();
}

// Windsock pointing downwind for the demo wind (from 190°).
function drawWindsock(ctx, sock, px) {
  const downwind = ((190 + 180 - 90) * Math.PI) / 180; // canvas angle: 0 = east, y down
  ctx.save();
  ctx.translate(sock.x, sock.y);
  ctx.rotate(downwind);
  const s = Math.max(1, 1.5 * px);
  ctx.fillStyle = '#e8701f';
  ctx.beginPath();
  ctx.moveTo(0, -1.8 * s);
  ctx.lineTo(7 * s, -0.8 * s);
  ctx.lineTo(7 * s, 0.8 * s);
  ctx.lineTo(0, 1.8 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(2.4 * s, -1.5 * s, 1.4 * s, 3 * s);
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(0, 0, 0.8 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// --- Screen-space overlays ------------------------------------------------------------------------

const LABEL_STYLES = {
  terminal: { font: '600 13px system-ui, sans-serif', color: '#1f2a36', halo: 'rgba(255,255,255,0.9)' },
  building: { font: '500 11px system-ui, sans-serif', color: '#34404c', halo: 'rgba(255,255,255,0.85)' },
  zone: { font: 'italic 600 11px system-ui, sans-serif', color: '#8a3b2f', halo: 'rgba(255,255,255,0.8)' },
  water: { font: 'italic 500 12px system-ui, sans-serif', color: '#2f6f99', halo: 'rgba(255,255,255,0.7)' },
  stand: { font: '700 10px system-ui, sans-serif', color: '#7a5b00', halo: 'rgba(255,240,190,0.85)' },
  taxiway: { font: '700 11px system-ui, sans-serif', sign: true },
};

function drawLabels(ctx, camera, labels) {
  const taken = [];
  const free = (r) => !taken.some((t) => r.x < t.x + t.w && r.x + r.w > t.x && r.y < t.y + t.h && r.y + r.h > t.y);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of labels) {
    if (camera.scale < l.minScale) continue;
    const [sx, sy] = camera.worldToScreen(l.at[0], l.at[1]);
    if (sx < -100 || sy < -30 || sx > camera.width + 100 || sy > camera.height + 30) continue;
    const st = LABEL_STYLES[l.style];
    ctx.font = st.font;
    const w = ctx.measureText(l.text).width + (st.sign ? 8 : 4);
    const rect = { x: sx - w / 2, y: sy - 9, w, h: 18 };
    if (!free(rect)) continue;
    taken.push(rect);
    if (st.sign) {
      // Taxiway location sign: yellow text on black.
      ctx.fillStyle = '#1b1b1b';
      ctx.fillRect(rect.x, sy - 8, w, 16);
      ctx.strokeStyle = '#f0c83a';
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.x + 0.5, sy - 7.5, w - 1, 15);
      ctx.fillStyle = '#f0c83a';
      ctx.fillText(l.text, sx, sy + 0.5);
    } else {
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = st.halo;
      ctx.strokeText(l.text, sx, sy);
      ctx.fillStyle = st.color;
      ctx.fillText(l.text, sx, sy);
    }
  }
}

// Flight tag with the airline's badge (official logo if supplied, otherwise its colours and code).
function airTag(ctx, code, text, x, y, colour = '#f2c230', extra = '') {
  if (!code) return tag(ctx, text, x, y, colour);
  const b = brandOf(code);
  const label = extra ? `${text} · ${extra}` : text;
  ctx.font = '600 11px system-ui, sans-serif';
  const chip = 24;
  const w = ctx.measureText(label).width + 10;
  const img = logoImage(code);
  ctx.fillStyle = img ? '#ffffff' : b.primary;
  ctx.fillRect(x, y - 9, chip, 18);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (img) {
    const k = Math.min((chip - 4) / img.naturalWidth, 14 / img.naturalHeight);
    ctx.drawImage(img, x + chip / 2 - (img.naturalWidth * k) / 2, y - (img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
  } else {
    ctx.fillStyle = onColour(b.primary);
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.fillText(code, x + chip / 2, y + 0.5);
    ctx.font = '600 11px system-ui, sans-serif';
  }
  ctx.fillStyle = 'rgba(18,24,33,0.85)';
  ctx.fillRect(x + chip, y - 9, w, 18);
  ctx.fillStyle = colour;
  ctx.textAlign = 'left';
  ctx.fillText(label, x + chip + 5, y + 0.5);
}

function tag(ctx, text, x, y, colour = '#f2c230') {
  ctx.font = '600 11px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = 'rgba(18,24,33,0.85)';
  ctx.fillRect(x, y - 9, w, 18);
  ctx.fillStyle = colour;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 5, y + 0.5);
}

function drawScaleBar(ctx, camera) {
  const target = 120 / camera.scale; // metres in ~120 px
  const pow = 10 ** Math.floor(Math.log10(target));
  const metres = [1, 2, 5, 10].map((m) => m * pow).filter((m) => m <= target).at(-1);
  const px = metres * camera.scale;
  const x = 16;
  const y = camera.height - 40;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(x - 6, y - 22, px + 70, 32);
  ctx.fillStyle = '#24303c';
  ctx.fillRect(x, y, px, 3);
  ctx.fillRect(x, y - 5, 2, 8);
  ctx.fillRect(x + px - 2, y - 5, 2, 8);
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(metres >= 1000 ? `${metres / 1000} km` : `${metres} m`, x, y - 8);
  // North arrow.
  const nx = x + px + 40;
  ctx.beginPath();
  ctx.moveTo(nx, y - 16);
  ctx.lineTo(nx + 6, y + 2);
  ctx.lineTo(nx, y - 3);
  ctx.lineTo(nx - 6, y + 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillText('N', nx + 9, y - 6);
}


function circle(path, x, y, r) {
  path.moveTo(x + r, y);
  path.arc(x, y, r, 0, Math.PI * 2);
}

const inView = (p, view, margin = 5) =>
  p.x > view.minX - margin && p.x < view.maxX + margin && p.y > view.minY - margin && p.y < view.maxY + margin;
