// Sky, weather and light on the map: the colour of the day (sunrise, noon, dusk, night), cloud shadows,
// wet ground, fog, rain, lightning, and the airfield at night: apron floodlights, runway, approach and
// taxiway lights, terminal windows, and the lights of aircraft and vehicles.
//
// Lighting logic: the map is darkened by one "darkness" layer (colour and strength from the sun and the
// weather). Every light source then cuts a hole in that layer (a pool of light) and adds a glow on top,
// so lit places show their true colours and the rest stays in the dark. Which lights are on comes from the
// simulation (sim.lights), so the picture and the rules (crew speed, runway lights, faults) agree.
import { skyTint } from '../sim/sky.js';
import { AIRCRAFT_TYPES } from '../sim/aircraftTypes.js';
import { aircraftLights } from './sprites.js';

const mk = (w, h, draw) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'));
  return c;
};

// Soft round pool of light (white, alpha falling off to the edge).
const poolSprite = () => mk(128, 128, (c) => {
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
});

// Beam of light: apex at the middle of the left edge, widening and fading to the right.
const coneSprite = () => mk(128, 64, (c) => {
  const g = c.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(0, 29);
  c.lineTo(128, 0);
  c.lineTo(128, 64);
  c.lineTo(0, 35);
  c.closePath();
  c.fill();
});

const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const hash = (x, y, s) => {
  const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
};

// Which kinds of vehicle flash an amber beacon.
const BEACONS = new Set(['tug', 'pushback', 'fuel', 'fireTender', 'followMe', 'beltLoader', 'catering']);
// Eastern end distances of the approach lights per runway end (eAIP, metres).
const APPROACH = { '07': 900, 25: 510 };

export class Atmosphere {
  constructor() {
    this.dark = document.createElement('canvas');
    this.pool = poolSprite();
    this.cone = coneSprite();
    this.tints = new Map();
    this.clouds = new Map();
    this.drops = [];
    this.flash = 0;
    this.lastSimT = null;
    this.lastReal = performance.now() / 1000;
  }

  resize(w, h) {
    this.dark.width = w;
    this.dark.height = h;
    this.drops = [];
  }

  // A sprite filled with one colour (keeps its alpha shape).
  #tinted(sprite, name, color) {
    const key = `${name}${color}`;
    if (!this.tints.has(key)) {
      this.tints.set(key, mk(sprite.width, sprite.height, (c) => {
        c.drawImage(sprite, 0, 0);
        c.globalCompositeOperation = 'source-in';
        c.fillStyle = color;
        c.fillRect(0, 0, sprite.width, sprite.height);
      }));
    }
    return this.tints.get(key);
  }

  // Tile of cloud shadows for a cloud cover (value noise thresholded by cover, in 10 steps).
  #cloudTile(cover) {
    const bucket = Math.round(cover * 10);
    if (!this.clouds.has(bucket)) {
      const N = 128;
      const thr = 0.86 - (bucket / 10) * 0.72;
      this.clouds.set(bucket, mk(N, N, (c) => {
        const img = c.createImageData(N, N);
        const noise = (x, y, cell, seed) => {
          const gx = x / cell;
          const gy = y / cell;
          const x0 = Math.floor(gx);
          const y0 = Math.floor(gy);
          const fx = gx - x0;
          const fy = gy - y0;
          const sx = fx * fx * (3 - 2 * fx);
          const sy = fy * fy * (3 - 2 * fy);
          const g = N / cell;
          const h = (i, j) => hash(((i % g) + g) % g, ((j % g) + g) % g, seed);
          return lerp(lerp(h(x0, y0), h(x0 + 1, y0), sx), lerp(h(x0, y0 + 1), h(x0 + 1, y0 + 1), sx), sy);
        };
        for (let y = 0; y < N; y++) {
          for (let x = 0; x < N; x++) {
            const n = noise(x, y, 32, 1) * 0.6 + noise(x, y, 16, 2) * 0.3 + noise(x, y, 8, 3) * 0.1;
            const a = clamp((n - thr) / 0.18);
            const i = (y * N + x) * 4;
            img.data[i] = 24;
            img.data[i + 1] = 34;
            img.data[i + 2] = 50;
            img.data[i + 3] = Math.round(a * 255);
          }
        }
        c.putImageData(img, 0, 0);
      }));
    }
    return this.clouds.get(bucket);
  }

  // ---- ground weather: under the aircraft and vehicles ------------------------------------------------------
  // ctx has the identity transform; the static map has just been drawn.
  ground(ctx, camera, sim, dpr) {
    const w = sim.weather?.now;
    const L = sim.lights;
    if (!w || !L) return;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const s = camera.scale;
    const day = clamp(L.sunEl / 14);

    const vis = sim.visibility();
    const fog = Math.min(0.6, Math.pow(Math.max(0, 1 - vis / 7000), 1.4) * 0.75);

    // Drifting cloud shadows (by day): big soft patches, fading out under overcast sky, in fog and when zoomed far out.
    const patchy = 0.24 * day * clamp((s - 0.05) / 0.1) * clamp((0.92 - w.cloud) / 0.07) * (1 - Math.min(1, fog * 1.8));
    if (w.cloud > 0.12 && patchy > 0.01) {
      const px = 2600 * s * dpr; // one tile is 2.6 km wide
      const k = px / 128;
      const toward = ((sim.wind.from + 180) * Math.PI) / 180;
      const drift = sim.t * 2.4; // metres of drift per second, quicker than the real wind so it can be seen
      const ox = Math.sin(toward) * drift;
      const oy = -Math.cos(toward) * drift;
      const pat = ctx.createPattern(this.#cloudTile(w.cloud), 'repeat');
      pat.setTransform(new DOMMatrix().translate(((ox - camera.x) * s + camera.width / 2) * dpr, ((oy - camera.y) * s + camera.height / 2) * dpr).scale(k));
      ctx.save();
      ctx.globalAlpha = patchy * (0.6 + 0.4 * w.cloud);
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // Wet ground is darker and bluer.
    if (w.wet > 0.05) {
      ctx.fillStyle = `rgba(36,52,76,${0.16 * w.wet})`;
      ctx.fillRect(0, 0, W, H);
    }

    // Fog, haze and smoke: white by day, grey in the dark; strength from the visibility.
    if (fog > 0.01) {
      const lum = lerp(78, 214, clamp(L.amb * 1.4));
      ctx.fillStyle = `rgba(${lum},${lum + 5},${lum + 10},${fog})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (w.rain > 0.5) {
      ctx.fillStyle = `rgba(110,126,142,${0.07 * w.rain})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---- sky: over everything on the map ---------------------------------------------------------------------------
  // flights: visible aircraft; vehicles: sim.vehicleSprites(); data: the renderer's world data.
  sky(ctx, camera, sim, data, flights, vehicles, time, dpr) {
    const w = sim.weather?.now;
    const L = sim.lights;
    if (!w || !L) return;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const s = camera.scale;
    const view = camera.view(80);
    const inView = (x, y, m = 0) => x > view.minX - m && x < view.maxX + m && y > view.minY - m && y < view.maxY + m;

    const real = performance.now() / 1000;
    const dt = Math.min(0.1, real - this.lastReal);
    this.lastReal = real;
    const running = this.lastSimT !== sim.t;
    this.lastSimT = sim.t;

    // Lightning flashes, only while the game runs.
    if (running && w.lightning && Math.random() < dt * 0.28) this.flash = 1;
    else this.flash = Math.max(0, this.flash - dt * 3.5);
    if (running && this.flash > 0.3 && this.flash < 0.55 && Math.random() < 0.08) this.flash = 0.9; // a second flicker

    // Colour and strength of the darkness: the sun's tint plus dimming by cloud, storm and rain.
    const tint = skyTint(L.sunEl);
    const dayK = clamp(L.sunEl / 15);
    const wxDim = Math.min(0.5, 0.26 * w.cloud * dayK + 0.14 * w.storm + 0.1 * w.rain);
    let a = tint.a + (1 - tint.a) * wxDim;
    const grey = clamp(wxDim / Math.max(0.05, a + 0.001));
    const col = [lerp(tint.r, 72, grey), lerp(tint.g, 84, grey), lerp(tint.b, 100, grey)];
    a *= 1 - 0.85 * this.flash;

    const vis = sim.visibility();
    if (a > 0.012) this.#darkness(ctx, camera, sim, data, flights, vehicles, view, inView, time, dpr, a, col, L);

    // Lights shine on top of the darkness (added to the picture).
    const k = clamp(Math.max(a * 1.9, (1 - vis / 6000) * 0.8, L.rwyStep >= 2 ? 0.3 : 0));
    if (k > 0.05) this.#glows(ctx, camera, sim, data, flights, vehicles, view, inView, time, dpr, k, L, w);

    // Rain.
    if (w.rain > 0.04) this.#rain(ctx, sim, dt, running, w, L, dpr);

    // The flash itself.
    if (this.flash > 0.02) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(225,235,255,${0.5 * this.flash})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  #darkness(ctx, camera, sim, data, flights, vehicles, view, inView, time, dpr, a, col, L) {
    const W = this.dark.width;
    const H = this.dark.height;
    const d = this.dark.getContext('2d');
    const s = camera.scale;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = 'source-over';
    d.globalAlpha = 1;
    d.clearRect(0, 0, W, H);
    const rgb = `${Math.round(col[0])},${Math.round(col[1])},${Math.round(col[2])}`;
    d.fillStyle = `rgba(${rgb},${a})`;
    d.fillRect(0, 0, W, H);

    // Everything below cuts light out of the darkness.
    d.globalCompositeOperation = 'destination-out';
    camera.applyTo(d, dpr);
    const pool = (x, y, r, alpha = 1) => {
      d.globalAlpha = alpha;
      d.drawImage(this.pool, x - r, y - r, r * 2, r * 2);
    };
    const beam = (x, y, h, len, width, alpha = 1) => {
      d.save();
      d.globalAlpha = alpha;
      d.translate(x, y);
      d.rotate(h);
      d.drawImage(this.cone, 0, -width / 2, len, width);
      d.restore();
    };

    // Apron floodlights: an even wash over the apron plus a pool under each mast.
    if (L.apron) {
      d.globalAlpha = 0.58;
      d.fill(data.aprons);
      if (s > 0.12) {
        for (const p of data.floodPts) {
          if (!inView(p.x, p.y, 90) || sim.darkAt(p.x, p.y)) continue;
          pool(p.x, p.y, 80, 0.62);
        }
      }
    }
    // Terminal buildings glow from inside.
    if (L.terminal) {
      d.globalAlpha = 0.78;
      for (const b of data.buildings) if (b.kind === 'terminal' && inView(b.box.minX, b.box.minY, 400)) d.fill(b.path);
    }
    // Runway, taxiways: lit pavement.
    if (L.rwyStep > 0) {
      d.globalAlpha = 0.1 + 0.08 * L.rwyStep;
      d.lineCap = 'butt';
      for (const r of data.runways) {
        d.lineWidth = r.width + 24;
        d.stroke(r.path);
      }
    }
    if (L.taxi) {
      d.globalAlpha = 0.36;
      d.lineCap = 'round';
      for (const [width, path] of data.taxiways) {
        d.lineWidth = width + 14;
        d.stroke(path);
      }
    }
    // Aircraft: landing and taxi lights, and a glow round those parked.
    for (const f of flights) {
      if (!inView(f.x, f.y, 120)) continue;
      const len = AIRCRAFT_TYPES[f.type].length;
      const nose = [f.x + Math.cos(f.heading) * len * 0.42, f.y + Math.sin(f.heading) * len * 0.42];
      if (['final', 'landing', 'takeoff', 'goAround'].includes(f.phase)) beam(nose[0], nose[1], f.heading, 190, 80, 0.95);
      else if (['taxiIn', 'taxiOut', 'lineUp', 'holdShort'].includes(f.phase)) beam(nose[0], nose[1], f.heading, 70, 38, 0.9);
      else if (f.phase === 'atStand') pool(f.x, f.y, len * 0.62, 0.3);
    }
    // Vehicles: work lights and headlights.
    if (s > 0.35) {
      for (const v of vehicles) {
        if (v.kind === 'cone' || !inView(v.x, v.y, 30)) continue;
        pool(v.x, v.y, 11, 0.55);
        beam(v.x + Math.cos(v.heading) * 2, v.y + Math.sin(v.heading) * 2, v.heading, 24, 12, 0.7);
      }
    }
    // A lighting fault leaves its patch of apron in the dark again.
    const dark = sim.lighting.dark;
    d.globalCompositeOperation = 'source-over';
    d.globalAlpha = 1;
    if (dark && sim.t < dark.until && inView(dark.x, dark.y, dark.r)) {
      const g = d.createRadialGradient(dark.x, dark.y, dark.r * 0.5, dark.x, dark.y, dark.r);
      g.addColorStop(0, `rgba(${rgb},${Math.min(1, a * 1.05)})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      d.fillStyle = g;
      d.beginPath();
      d.arc(dark.x, dark.y, dark.r, 0, Math.PI * 2);
      d.fill();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.dark, 0, 0);
  }

  #glows(ctx, camera, sim, data, flights, vehicles, view, inView, time, dpr, k, L, w) {
    const s = camera.scale;
    const wet = 1 + 0.25 * (w.wet ?? 0);
    camera.applyTo(ctx, dpr);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    const dot = clamp(2.2 / s, 0.35, 40); // a light is about two pixels, but never bigger than a real fixture up close
    const glow = (x, y, r, color, alpha = 1) => {
      ctx.globalAlpha = alpha * k;
      const rr = Math.max(r, 3 / s) * wet;
      ctx.drawImage(this.#tinted(this.pool, 'p', color), x - rr, y - rr, rr * 2, rr * 2);
    };

    // Runway edge lights (white), taxiway edge lights (blue), taxiway centreline lights (green).
    if (s > 0.04) {
      if (L.rwyStep > 0) {
        ctx.globalAlpha = k * (0.35 + 0.13 * L.rwyStep);
        ctx.strokeStyle = '#fff1cf';
        ctx.lineWidth = dot;
        ctx.stroke(data.lights.runway);
      }
      if (L.taxi) {
        ctx.globalAlpha = k * 0.9;
        ctx.strokeStyle = '#4f94ff';
        ctx.lineWidth = dot * 0.9;
        ctx.stroke(data.lights.taxi);
        if (s > 0.2) {
          ctx.globalAlpha = k * 0.85;
          ctx.strokeStyle = '#3dff8a';
          ctx.lineWidth = Math.max(0.35, 1.8 / s);
          ctx.lineCap = 'butt';
          ctx.setLineDash([Math.max(0.5, 1.2 / Math.max(1, s / 2)), 14]);
          ctx.stroke(data.taxiCentre);
          ctx.setLineDash([]);
        }
      }
    }

    // Approach lights and threshold bars for the runway in use, with the flashing "rabbit".
    if (L.rwyStep > 0) {
      const des = sim.active;
      const frame = data.frames.find((f) => des in f.ends || String(des) in f.ends);
      if (frame) {
        const ends = Object.entries(frame.ends);
        const me = ends.find(([name]) => String(name) === String(des)) ?? ends[0];
        const other = ends.find(([name]) => name !== me[0]) ?? ends[1];
        const [ex, ey] = me[1];
        const [ox, oy] = other[1];
        const len = Math.hypot(ex - ox, ey - oy) || 1;
        const u = [(ex - ox) / len, (ey - oy) / len];
        const n = [-u[1], u[0]];
        const total = APPROACH[String(des)] ?? 510;
        const rabbit = (time * 2.2) % 1;
        const lights = [];
        for (let dist = 30; dist <= total; dist += 30) {
          const bar = dist % 150 === 0 ? 11 : 0; // crossbars every 150 m
          lights.push([ex + u[0] * dist, ey + u[1] * dist, dist]);
          for (let o = 3; o <= bar; o += 3) {
            lights.push([ex + u[0] * dist + n[0] * o, ey + u[1] * dist + n[1] * o, dist], [ex + u[0] * dist - n[0] * o, ey + u[1] * dist - n[1] * o, dist]);
          }
        }
        for (const [x, y, dist] of lights) {
          if (!inView(x, y, 40)) continue;
          const pulse = Math.abs((1 - dist / total) - rabbit) < 0.08 ? 1 : 0;
          glow(x, y, 2.8 + pulse * 5, '#fff3d6', 0.55 + pulse * 0.45);
        }
        // Threshold: green bar across the landing end, red across the far end.
        for (const [x, y, color] of [[ex, ey, '#3dff8a'], [ox, oy, '#ff3b30']]) {
          if (!inView(x, y, 60)) continue;
          ctx.globalAlpha = k * 0.9;
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1.4, 2.4 / s);
          ctx.beginPath();
          ctx.moveTo(x - n[0] * frame.width * 0.5, y - n[1] * frame.width * 0.5);
          ctx.lineTo(x + n[0] * frame.width * 0.5, y + n[1] * frame.width * 0.5);
          ctx.stroke();
        }
      }
    }

    // Floodlight lamps and the warm glow of the terminals.
    if (L.apron && s > 0.12) {
      for (const p of data.floodPts) if (inView(p.x, p.y, 20) && !sim.darkAt(p.x, p.y)) glow(p.x, p.y, 7, '#ffe9b0', 0.55);
    }
    if (L.terminal) {
      ctx.globalAlpha = k * 0.13;
      ctx.fillStyle = '#ffcf8a';
      for (const b of data.buildings) if (b.kind === 'terminal' && inView(b.box.minX, b.box.minY, 400)) ctx.fill(b.path);
    }

    // Aircraft lights: navigation, strobes, beacon, and the beams of landing and taxi lights.
    if (s > 0.12) {
      for (const f of flights) {
        if (!inView(f.x, f.y, 120)) continue;
        const moving = f.phase !== 'atStand';
        for (const l of aircraftLights(f, time, moving)) glow(l.x, l.y, l.r * 0.3, l.color, 0.85);
        const len = AIRCRAFT_TYPES[f.type].length;
        const nx = f.x + Math.cos(f.heading) * len * 0.42;
        const ny = f.y + Math.sin(f.heading) * len * 0.42;
        const landing = ['final', 'landing', 'takeoff', 'goAround'].includes(f.phase);
        const taxi = ['taxiIn', 'taxiOut', 'lineUp', 'holdShort'].includes(f.phase);
        if (landing || taxi) {
          ctx.save();
          ctx.translate(nx, ny);
          ctx.rotate(f.heading);
          ctx.globalAlpha = k * (landing ? 0.55 : 0.4);
          const lenB = landing ? 190 : 70;
          const wid = landing ? 80 : 38;
          ctx.drawImage(this.#tinted(this.cone, 'c', '#fff6dc'), 0, -wid / 2, lenB, wid);
          ctx.restore();
          glow(nx, ny, landing ? 9 : 5, '#fff6dc', 1);
        }
      }
    }
    // Vehicles: amber beacons that blink, white headlights.
    if (s > 0.35) {
      const blink = Math.floor(time * 2.6) % 2 === 0;
      for (const v of vehicles) {
        if (v.kind === 'cone' || !inView(v.x, v.y, 30)) continue;
        if (BEACONS.has(v.kind) && blink) glow(v.x, v.y, 3.6, '#ffae1a', 0.95);
        const hx = v.x + Math.cos(v.heading) * 2;
        const hy = v.y + Math.sin(v.heading) * 2;
        glow(hx, hy, 2.3, '#fffbe8', 0.8);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  #rain(ctx, sim, dt, running, w, L, dpr) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const want = Math.min(900, Math.round((w.rain * (W * H)) / (3600 * dpr * dpr)));
    while (this.drops.length < want) this.drops.push({ x: Math.random() * W, y: Math.random() * H, v: 0.8 + Math.random() * 0.7, l: 0.6 + Math.random() * 0.8 });
    if (this.drops.length > want) this.drops.length = want;
    // Slant with the wind: wind from `from` blows towards from + 180.
    const th = (sim.wind.from * Math.PI) / 180;
    const slant = Math.max(-0.7, Math.min(0.7, (-Math.sin(th) * (3 + sim.wind.kt * 0.5)) / 60));
    const speed = 1100 * dpr;
    const len = 22 * dpr * (0.6 + 0.6 * w.rain);
    const night = L.amb < 0.3;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeStyle = night ? 'rgba(170,190,220,0.3)' : 'rgba(210,225,242,0.38)';
    ctx.beginPath();
    for (const p of this.drops) {
      if (running) {
        p.y += speed * p.v * dt;
        p.x += speed * p.v * dt * slant;
        if (p.y > H) {
          p.y = -len;
          p.x = Math.random() * W;
        }
        if (p.x < -50) p.x = W;
        if (p.x > W + 50) p.x = 0;
      }
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - len * p.l * slant, p.y - len * p.l);
    }
    ctx.stroke();
  }
}
