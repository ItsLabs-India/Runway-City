// Soundscape: wind, rain, thunder, aircraft, ground vehicles, road traffic and terminal crowds, all
// synthesised live with the Web Audio API (no audio files, nothing licensed). The listener is the middle
// of the screen, so the closer you zoom in on something the louder it gets; zoomed right out you only
// hear the weather. Sound never touches the simulation: it only reads `world` and the camera.
import { AIRCRAFT_TYPES } from './sim/aircraftTypes.js';

const SPEED_OF_SOUND = 343;
const KT = 0.5144;
const UPDATE_S = 0.05; // parameters are retuned 20 times a second, not every frame
const FT = 0.3048;
const VOICES = { aircraft: 4, vehicle: 6 };

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (v, lo, hi) => {
  const k = clamp((v - lo) / (hi - lo));
  return k * k * (3 - 2 * k);
};

// ---- vehicle sound profiles ---------------------------------------------------------------------
// f0: engine idle pitch (Hz), rev: extra pitch when driving, loud: relative level, tone: electrical hum (Hz,
// ground power is a real 400 Hz), work: noise bandpass while working (pumps, conveyors), rattle: cart noise.
const VEHICLE_SOUND = {
  tug: { f0: 62, rev: 38, loud: 0.8, work: 0, rattle: 0.9 },
  beltLoader: { f0: 74, rev: 30, loud: 0.8, tone: 190, work: 1300 },
  fuel: { f0: 42, rev: 26, loud: 1.0, work: 520 },
  catering: { f0: 46, rev: 26, loud: 0.95, tone: 330, work: 0 },
  van: { f0: 84, rev: 36, loud: 0.6, work: 0 },
  water: { f0: 44, rev: 26, loud: 0.95, work: 650 },
  gpu: { f0: 52, rev: 0, loud: 0.75, tone: 400, work: 0, hum: true },
  stairs: { f0: 66, rev: 30, loud: 0.65, work: 0 },
  bus: { f0: 38, rev: 24, loud: 1.1, work: 0 },
  pushback: { f0: 32, rev: 20, loud: 1.4, work: 0, beep: true },
  default: { f0: 55, rev: 28, loud: 0.8, work: 0 },
};

export class Soundscape {
  constructor(map) {
    this.ctx = null;
    this.on = false;
    this.volume = 0.7;
    this.supported = typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined';
    this.clock = 0;
    this.nextThunder = 0;
    this.nextCar = 0;
    this.nextChime = 30;
    this.roadGrid = buildRoadGrid(map.roads);
    this.terminals = (map.buildings ?? []).filter((b) => b.kind === 'terminal').map((b) => ({ poly: b.polygon, box: boxOf(b.polygon) }));
    this.env = { road: 0, crowd: 0 };
    this.envClock = 0;
    this.stats = { aircraft: 0, vehicles: 0, wind: 0, rain: 0, road: 0, crowd: 0 };
  }

  // ---- switching on and off ---------------------------------------------------------------------

  // Must be called from a user gesture the first time (browsers refuse sound before that).
  enable(on) {
    this.on = Boolean(on) && this.supported;
    if (this.on) this.#build();
    if (this.ctx) {
      if (this.on) this.ctx.resume?.();
      this.#ramp(this.master.gain, this.on ? this.volume * 0.55 : 0, 0.15);
      if (!this.on) setTimeout(() => !this.on && this.ctx?.suspend?.(), 400);
    }
    return this.on;
  }

  setVolume(v) {
    this.volume = clamp(v);
    if (this.ctx && this.on) this.#ramp(this.master.gain, this.volume * 0.55, 0.1);
  }

  // Autoplay rules: resume the context on the first tap / key press after load.
  resume() {
    if (this.on && this.ctx?.state === 'suspended') this.ctx.resume?.();
  }

  #ramp(param, v, tc = 0.1) {
    param.setTargetAtTime(v, this.ctx.currentTime, tc);
  }

  // ---- graph ------------------------------------------------------------------------------------

  #build() {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? window.webkitAudioContext;
    const ctx = (this.ctx = new Ctx({ latencyHint: 'interactive' }));
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    this.master.connect(comp).connect(ctx.destination);

    // Two seconds of white noise and of brown noise (deep rumble) are shared by every voice.
    const len = ctx.sampleRate * 3;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.white.getChannelData(0);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      b[i] = last * 3.5;
    }

    this.#buildWeather();
    this.#buildPlaces();
    this.aircraft = Array.from({ length: VOICES.aircraft }, () => this.#aircraftVoice());
    this.vehicles = Array.from({ length: VOICES.vehicle }, () => this.#vehicleVoice());
  }

  noise(buf) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(0, Math.random() * 2);
    return s;
  }

  osc(type, hz) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    o.start();
    return o;
  }

  filter(type, hz, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    return f;
  }

  gain(v = 0) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  #buildWeather() {
    // Wind: a low body that gets brighter with speed, and a thin whistle for the gusts.
    this.windBody = { lp: this.filter('lowpass', 300), g: this.gain() };
    this.noise(this.brown).connect(this.windBody.lp).connect(this.windBody.g).connect(this.master);
    this.windWhistle = { bp: this.filter('bandpass', 700, 5), g: this.gain() };
    this.noise(this.white).connect(this.windWhistle.bp).connect(this.windWhistle.g).connect(this.master);

    // Rain: hiss on the apron, a lower drumming on roofs and aircraft, with a slow wobble in the downpour.
    this.rainHiss = { hp: this.filter('highpass', 1400), lp: this.filter('lowpass', 8000), g: this.gain() };
    this.noise(this.white).connect(this.rainHiss.hp).connect(this.rainHiss.lp).connect(this.rainHiss.g).connect(this.master);
    this.rainDrum = { bp: this.filter('bandpass', 420, 0.8), g: this.gain() };
    this.noise(this.white).connect(this.rainDrum.bp).connect(this.rainDrum.g).connect(this.master);
    const wob = this.osc('sine', 0.23);
    const depth = this.gain(0.0);
    wob.connect(depth);
    this.rainWobble = depth;
    depth.connect(this.rainDrum.g.gain);
    this.thunderOut = this.gain(1);
    this.thunderOut.connect(this.master);
  }

  #buildPlaces() {
    // Road traffic: a steady low roar plus single cars swishing past.
    this.road = { lp: this.filter('lowpass', 520), g: this.gain() };
    this.noise(this.brown).connect(this.road.lp).connect(this.road.g).connect(this.master);
    // Terminal crowd: murmur.
    this.crowd = { bp: this.filter('bandpass', 520, 0.9), lp: this.filter('lowpass', 1500), g: this.gain() };
    this.noise(this.white).connect(this.crowd.bp).connect(this.crowd.lp).connect(this.crowd.g).connect(this.master);
    const slow = this.osc('sine', 0.11);
    const d = this.gain(0.0);
    slow.connect(d).connect(this.crowd.g.gain);
    this.crowdSlow = d;
  }

  #aircraftVoice() {
    const out = this.gain();
    const lp = this.filter('lowpass', 6000, 0.5);
    const pan = this.ctx.createStereoPanner();
    out.connect(lp).connect(pan).connect(this.master);
    const v = { id: null, level: 0, idleFor: 0, out, lp, pan };
    v.jet = { bp: this.filter('bandpass', 900, 0.6), g: this.gain() };
    this.noise(this.white).connect(v.jet.bp).connect(v.jet.g).connect(out);
    v.rumble = { lp: this.filter('lowpass', 480), g: this.gain() };
    this.noise(this.brown).connect(v.rumble.lp).connect(v.rumble.g).connect(out);
    v.whineG = this.gain();
    v.whineA = this.osc('sine', 3000);
    v.whineB = this.osc('triangle', 4300);
    v.whineA.connect(v.whineG);
    v.whineB.connect(v.whineG);
    v.whineG.connect(out);
    v.propLp = this.filter('lowpass', 780, 0.6);
    v.propG = this.gain();
    v.propA = this.osc('sawtooth', 100);
    v.propB = this.osc('sawtooth', 101.4); // the two propellers beat against each other
    v.propA.connect(v.propLp);
    v.propB.connect(v.propLp);
    v.propLp.connect(v.propG).connect(out);
    return v;
  }

  #vehicleVoice() {
    const out = this.gain();
    const lp = this.filter('lowpass', 5000, 0.5);
    const pan = this.ctx.createStereoPanner();
    out.connect(lp).connect(pan).connect(this.master);
    const v = { id: null, level: 0, idleFor: 0, out, lp, pan, kind: null };
    v.engLp = this.filter('lowpass', 420, 0.8);
    v.engG = this.gain();
    v.eng = this.osc('sawtooth', 50);
    v.eng2 = this.osc('square', 25);
    v.eng.connect(v.engLp);
    v.eng2.connect(v.engLp);
    v.engLp.connect(v.engG).connect(out);
    v.rumble = { lp: this.filter('lowpass', 260), g: this.gain() };
    this.noise(this.brown).connect(v.rumble.lp).connect(v.rumble.g).connect(out);
    v.toneG = this.gain();
    v.tone = this.osc('sine', 400);
    v.tone.connect(v.toneG).connect(out);
    v.mech = { bp: this.filter('bandpass', 900, 1.2), g: this.gain() };
    this.noise(this.white).connect(v.mech.bp).connect(v.mech.g).connect(out);
    // Reversing beeper of the push-back tug: 1 kHz, on for 0.4 s of every 0.8 s.
    v.beepG = this.gain();
    v.beepGate = this.gain();
    const beep = this.osc('square', 1000);
    const gate = this.osc('square', 1.25);
    const gateShape = this.ctx.createGain();
    gateShape.gain.value = 0.5;
    gate.connect(gateShape).connect(v.beepGate.gain);
    v.beepGate.gain.value = 0.5;
    beep.connect(v.beepGate).connect(v.beepG).connect(out);
    return v;
  }

  // ---- per-frame update -------------------------------------------------------------------------

  // world: the game world; cam: Camera2D; ghosts: Live Watch aircraft; speed: game speed; paused: a menu is open
  update(dt, cam, world, { ghosts = [], speed = 1, paused = false } = {}) {
    if (!this.on || !this.ctx || this.ctx.state !== 'running' || !world) return;
    this.clock += dt;
    if (this.clock - (this.last ?? -1) < UPDATE_S) return;
    const step = this.clock - (this.last ?? this.clock - UPDATE_S);
    this.last = this.clock;

    const live = !paused && speed > 0;
    // At 20x and 60x the traffic would just be a smear, so it fades out; weather always stays.
    const traffic = live ? (speed <= 5 ? 1 : speed <= 20 ? 0.25 : 0) : 0;
    const zoom = {
      weather: 0.3 + 0.7 * smooth(cam.scale, 0.1, 1.2),
      place: smooth(cam.scale, 0.5, 1.8),
    };
    this.#weather(world, zoom, live, step, speed);
    this.#places(cam, world, zoom, step, traffic);
    this.#traffic(cam, world, ghosts, traffic);
  }

  #weather(world, zoom, live, dt, speed) {
    const w = world.weather?.now ?? { rain: 0, storm: 0, lightning: false };
    const duck = live ? 1 : 0.4;
    const kt = world.wind?.kt ?? 0;
    const gust = Math.max(0, (world.wind?.gust ?? kt) - kt);
    const wind = clamp(kt / 35) ** 1.15;
    this.stats.wind = wind;
    this.#ramp(this.windBody.g.gain, (0.04 + 0.5 * wind) * zoom.weather * duck, 0.4);
    this.#ramp(this.windBody.lp.frequency, 220 + 1500 * wind, 0.4);
    this.#ramp(this.windWhistle.g.gain, (0.01 + 0.09 * clamp((kt + gust * 2) / 40) ** 2) * zoom.weather * duck, 0.5);
    this.#ramp(this.windWhistle.bp.frequency, 500 + 700 * wind + gust * 18, 0.6);

    const rain = clamp(w.rain);
    this.stats.rain = rain;
    this.#ramp(this.rainHiss.g.gain, 0.32 * rain ** 0.8 * zoom.weather * duck, 0.5);
    this.#ramp(this.rainDrum.g.gain, 0.2 * rain ** 0.9 * zoom.weather * duck * (0.5 + 0.5 * zoom.place), 0.5);
    this.#ramp(this.rainWobble.gain, 0.05 * rain, 0.5);

    // Thunder every so often while the weather says lightning is within range.
    if (w.lightning && live && speed <= 20) {
      this.nextThunder -= dt;
      if (this.nextThunder <= 0) {
        this.thunder(0.5 + 0.5 * clamp(w.storm));
        this.nextThunder = 9 + Math.random() * 26;
      }
    } else this.nextThunder = Math.min(this.nextThunder, 4 + Math.random() * 6);
  }

  // A crack followed by a long low rumble.
  thunder(strength = 1) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + 0.05 + Math.random() * 0.8; // light is faster than sound
    const n = this.ctx.createBufferSource();
    n.buffer = this.brown;
    const lp = this.filter('lowpass', 1400);
    const g = this.gain(0);
    n.connect(lp).connect(g).connect(this.thunderOut);
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(70, t + 4.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9 * strength, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.35 * strength, t + 0.7);
    // distant rolling: two later bumps
    g.gain.linearRampToValueAtTime(0.5 * strength, t + 1.5);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 5.5);
    n.start(t, Math.random() * 2);
    n.stop(t + 5.8);
    n.onended = () => g.disconnect();
  }

  #places(cam, world, zoom, dt, traffic) {
    this.envClock += dt;
    if (this.envClock > 0.25) {
      this.envClock = 0;
      this.env.road = roadLoudness(this.roadGrid, cam.x, cam.y);
      this.env.crowd = this.#inTerminal(cam.x, cam.y) ? 1 : 0;
    }
    const road = this.env.road * zoom.place;
    this.stats.road = road;
    this.#ramp(this.road.g.gain, 0.34 * road, 0.4);
    this.#ramp(this.road.lp.frequency, 380 + 400 * road, 0.4);

    const crowd = this.env.crowd * zoom.place;
    this.stats.crowd = crowd;
    this.#ramp(this.crowd.g.gain, 0.2 * crowd, 0.5);
    this.#ramp(this.crowdSlow.gain, 0.05 * crowd, 0.5);

    // Single cars passing on a nearby road.
    if (road > 0.12 && traffic > 0) {
      this.nextCar -= dt;
      if (this.nextCar <= 0) {
        this.#carPass(road);
        this.nextCar = (1.2 + Math.random() * 3.5) / (0.4 + road);
      }
    }
    // Terminal announcement chime.
    if (crowd > 0.6) {
      this.nextChime -= dt;
      if (this.nextChime <= 0) {
        this.#chime();
        this.nextChime = 40 + Math.random() * 50;
      }
    }
  }

  #inTerminal(x, y) {
    for (const t of this.terminals) {
      const b = t.box;
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
      if (inside(t.poly, x, y)) return true;
    }
    return false;
  }

  #carPass(road) {
    const t = this.ctx.currentTime;
    const dur = 1.6 + Math.random() * 1.2;
    const src = this.ctx.createBufferSource();
    src.buffer = this.white;
    const bp = this.filter('bandpass', 400, 1.1);
    const g = this.gain(0);
    const pan = this.ctx.createStereoPanner();
    const dir = Math.random() < 0.5 ? -1 : 1;
    pan.pan.setValueAtTime(-0.8 * dir, t);
    pan.pan.linearRampToValueAtTime(0.8 * dir, t + dur);
    src.connect(bp).connect(g).connect(pan).connect(this.master);
    bp.frequency.setValueAtTime(380, t);
    bp.frequency.linearRampToValueAtTime(900, t + dur * 0.5); // pitch of the pass-by
    bp.frequency.linearRampToValueAtTime(420, t + dur);
    const peak = 0.25 * road;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + dur * 0.5);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.1);
    src.onended = () => pan.disconnect();
  }

  #chime() {
    const t = this.ctx.currentTime;
    const g = this.gain(0);
    g.connect(this.master);
    for (const [i, hz] of [659.3, 523.3].entries()) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz;
      const e = this.ctx.createGain();
      e.gain.setValueAtTime(0, t + i * 0.55);
      e.gain.linearRampToValueAtTime(0.12, t + i * 0.55 + 0.03);
      e.gain.exponentialRampToValueAtTime(0.0005, t + i * 0.55 + 1.3);
      o.connect(e).connect(g);
      o.start(t + i * 0.55);
      o.stop(t + i * 0.55 + 1.4);
    }
    setTimeout(() => g.disconnect(), 2500);
  }

  // ---- aircraft and vehicles ----------------------------------------------------------------------

  #traffic(cam, world, ghosts, traffic) {
    const halfW = cam.width / 2;
    const reach = Math.max(cam.width, cam.height) * 0.62; // px from the screen centre at which a source fades out
    const planes = [];
    const vehicles = [];

    // The listener is whatever you look at; the aircraft you follow is always heard clearly.
    const heard = (x, y, extraM = 0) => {
      const dx = (x - cam.x) * cam.scale;
      const dy = (y - cam.y) * cam.scale;
      const d = Math.hypot(dx, dy, extraM * cam.scale);
      return { prox: clamp(1 - d / reach) ** 1.6, pan: clamp(dx / halfW, -1, 1) * 0.85, dx: x - cam.x, dy: y - cam.y };
    };
    const aircraftZoom = smooth(cam.scale, 0.1, 1.1);

    for (const f of world.visibleFlights()) {
      const s = aircraftState(f);
      if (!s) continue;
      const h = heard(f.x, f.y, f.alt);
      const follow = cam.following === f ? 1 : 0;
      const boost = Math.max(h.prox, follow * 0.9);
      const loud = s.loud * aircraftZoom * boost * traffic;
      if (loud > 0.002) planes.push({ id: f.id, loud, pan: h.pan, s, h, vel: velocity(f.heading, f.speed), type: f.type });
    }
    for (const g of ghosts) {
      const altM = (g.alt ?? 0) * FT;
      const v = (g.gs ?? 0) * KT;
      const s = ghostState(g);
      const h = heard(g.x, g.y, altM * 1.2);
      const loud = s.loud * aircraftZoom * h.prox * 0.75 * traffic;
      if (loud > 0.002) planes.push({ id: `g${g.hex}`, loud, pan: h.pan, s, h, vel: velocity(g.heading, v), type: g.type });
    }
    this.#assign(this.aircraft, planes, (voice, p) => this.#tuneAircraft(voice, p));
    this.stats.aircraft = this.aircraft.filter((v) => v.id !== null && v.level > 0.002).length;

    const vehicleZoom = smooth(cam.scale, 0.6, 2.8);
    if (vehicleZoom > 0.01) {
      const planeById = new Map(world.flights.map((f) => [f.id, f]));
      for (const v of world.vehicles) {
        if (v.wx === undefined || v.state === 'gone') continue;
        const fl = planeById.get(v.flightId);
        const prof = VEHICLE_SOUND[v.kind] ?? VEHICLE_SOUND.default;
        const driving = v.attached ? (fl?.speed ?? 0) > 0.1 : v.state === 'driveIn' || v.state === 'driveOut';
        const working = v.state === 'working' && !v.attached;
        const h = heard(v.wx, v.wy);
        const loud = prof.loud * vehicleZoom * h.prox * traffic;
        if (loud > 0.002) vehicles.push({ id: v.id, loud, pan: h.pan, prof, v, driving, working, kind: v.kind });
      }
    }
    this.#assign(this.vehicles, vehicles, (voice, p) => this.#tuneVehicle(voice, p));
    this.stats.vehicles = this.vehicles.filter((v) => v.id !== null && v.level > 0.002).length;
  }

  // Keeps the loudest N sources on the voice slots. A slot is only handed to a new source once it has
  // faded to silence, so voices never jump from one sound to another with a click.
  #assign(slots, sources, tune) {
    sources.sort((a, b) => b.loud - a.loud);
    const wanted = sources.slice(0, slots.length);
    const byId = new Map(wanted.map((s) => [s.id, s]));
    for (const slot of slots) {
      const src = slot.id !== null ? byId.get(slot.id) : null;
      if (src) {
        byId.delete(slot.id);
        tune(slot, src);
        slot.idleFor = 0;
      } else if (slot.id !== null) {
        slot.level = 0;
        this.#ramp(slot.out.gain, 0, 0.06);
        slot.idleFor += UPDATE_S;
        if (slot.idleFor > 0.4) slot.id = null;
      }
    }
    for (const src of byId.values()) {
      const slot = slots.find((s) => s.id === null);
      if (!slot) break;
      slot.id = src.id;
      slot.idleFor = 0;
      slot.out.gain.setValueAtTime(0, this.ctx.currentTime);
      tune(slot, src, true);
    }
  }

  #tuneAircraft(v, p) {
    const { s } = p;
    const spec = AIRCRAFT_TYPES[p.type];
    const size = clamp((spec?.length ?? 38) / 38, 0.55, 1.9);
    const T = clamp(s.thrust);
    // Doppler: how fast the aircraft is moving towards (+) or away from (-) the middle of the screen.
    const dist = Math.hypot(p.h.dx, p.h.dy) || 1;
    const closing = -(p.vel[0] * p.h.dx + p.vel[1] * p.h.dy) / dist;
    const dopp = clamp(SPEED_OF_SOUND / (SPEED_OF_SOUND - closing), 0.85, 1.18);
    const prop = spec?.props ? 1 : 0;
    const jet = 1 - prop * 0.85;
    const tc = 0.12;

    v.level = p.loud;
    this.#ramp(v.out.gain, p.loud * 0.9, tc);
    this.#ramp(v.pan.pan, p.pan, tc);
    this.#ramp(v.lp.frequency, 700 + 7000 * clamp(p.loud * 3), 0.2);
    this.#ramp(v.jet.g.gain, 0.8 * T ** 1.4 * jet, tc);
    this.#ramp(v.jet.bp.frequency, ((420 + 2400 * T) * dopp) / Math.sqrt(size), tc);
    this.#ramp(v.rumble.g.gain, 1.2 * T ** 1.1 * (0.5 + 0.5 * size) * (prop ? 0.5 : 1), tc);
    this.#ramp(v.whineG.gain, (0.04 + 0.16 * T) * jet * (s.apu ? 2.2 : 1), tc);
    this.#ramp(v.whineA.frequency, ((s.apu ? 2900 : 1700 + 3200 * T) * dopp) / size ** 0.3, tc);
    this.#ramp(v.whineB.frequency, ((s.apu ? 4400 : 2600 + 3900 * T) * dopp) / size ** 0.3, tc);
    this.#ramp(v.propG.gain, prop * (0.2 + 0.45 * T), tc);
    this.#ramp(v.propA.frequency, (68 + 52 * T) * dopp, tc);
    this.#ramp(v.propB.frequency, (68 + 52 * T) * dopp + 1.4 + 1.2 * T, tc);
    this.#ramp(v.propLp.frequency, 500 + 700 * T, tc);
  }

  #tuneVehicle(v, p) {
    const { prof } = p;
    if (v.kind !== p.kind) {
      v.kind = p.kind;
      // the engine character differs per vehicle: a deep square undertone for big diesels
      v.eng.frequency.setValueAtTime(prof.f0, this.ctx.currentTime);
    }
    const tc = 0.1;
    const run = p.driving ? 1 : 0;
    const strain = p.prof.beep && p.driving ? 1 : 0; // pushing an aircraft
    const hz = prof.f0 + prof.rev * run * (1 + 0.4 * strain);
    v.level = p.loud;
    this.#ramp(v.out.gain, p.loud * 0.9, tc);
    this.#ramp(v.pan.pan, p.pan, tc);
    this.#ramp(v.lp.frequency, 600 + 5500 * clamp(p.loud * 3.5), 0.2);
    this.#ramp(v.eng.frequency, hz, 0.25);
    this.#ramp(v.eng2.frequency, hz / 2, 0.25);
    this.#ramp(v.engLp.frequency, 260 + 240 * run, 0.2);
    this.#ramp(v.engG.gain, prof.hum ? 0.12 : 0.22 + 0.2 * run, tc);
    this.#ramp(v.rumble.g.gain, prof.hum ? 0.1 : 0.55 + 0.35 * run, tc);
    this.#ramp(v.toneG.gain, prof.tone ? (prof.hum ? 0.28 : p.working || run ? 0.07 : 0.025) : 0, tc);
    if (prof.tone) this.#ramp(v.tone.frequency, prof.tone * (1 + 0.04 * run), 0.2);
    // rattle of the baggage carts while moving, pumps / conveyors while working
    const mech = (prof.rattle ?? 0) * run * 0.22 + (prof.work && p.working ? 0.26 : 0);
    this.#ramp(v.mech.g.gain, mech, tc);
    this.#ramp(v.mech.bp.frequency, prof.work && p.working ? prof.work : 1500 + 700 * run, 0.15);
    this.#ramp(v.beepG.gain, prof.beep && p.v.attached ? 0.08 : 0, 0.05);
  }
}

// ---- what each aircraft sounds like ------------------------------------------------------------------
// thrust 0..1 (engine power), loud: how far its sound carries.
function aircraftState(f) {
  const v = f.vRot || 70;
  switch (f.phase) {
    case 'takeoff': {
      const roll = clamp(f.speed / v);
      const climb = clamp(f.alt / 1400);
      return { thrust: 0.55 + 0.45 * roll - 0.12 * climb, loud: 1.7 };
    }
    case 'lineUp': return { thrust: 0.14, loud: 0.55 };
    case 'holdShort': return { thrust: 0.1, loud: 0.45 };
    case 'goAround': return { thrust: 1, loud: 1.5 };
    case 'final': return { thrust: 0.34, loud: 0.9 };
    case 'landing': {
      // reverse thrust and spoilers right after touchdown, then idle
      if (f.alt > 0.5) return { thrust: 0.34, loud: 1.0 };
      const k = clamp((f.speed - 25) / Math.max(10, (f.vApp ?? 70) - 25));
      return { thrust: 0.2 + 0.6 * k, loud: 1.1 + 0.5 * k };
    }
    case 'taxiIn':
    case 'taxiOut': return { thrust: 0.1 + 0.16 * clamp(f.speed / 12), loud: 0.6 };
    case 'turning': return { thrust: 0.1, loud: 0.5 };
    case 'pushback': return { thrust: 0.05, loud: 0.4, apu: true };
    case 'atStand': return { thrust: 0.03, loud: 0.3, apu: true };
    default: return null;
  }
}

function ghostState(g) {
  const gs = clamp((g.gs ?? 0) / 160);
  if (g.gnd) return { thrust: 0.08 + 0.15 * clamp((g.gs ?? 0) / 25), loud: 0.5 };
  const climbing = (g.alt ?? 0) < 6000;
  return { thrust: climbing ? 0.4 + 0.3 * gs : 0.3, loud: 1.0 };
}

const velocity = (heading, speed) => [Math.cos(heading) * speed, Math.sin(heading) * speed];

// ---- map helpers -----------------------------------------------------------------------------------------

const ROAD_WEIGHT = { trunk: 1, motorway: 1, primary: 0.9, secondary: 0.6, tertiary: 0.35 };
const CELL = 60; // metres

// Coarse grid of how busy the road through each 60 m cell is. Residential and service roads stay silent.
function buildRoadGrid(roads) {
  const grid = new Map();
  for (const r of roads ?? []) {
    const wgt = ROAD_WEIGHT[r.kind];
    if (!wgt || r.tunnel) continue;
    for (let i = 0; i < r.points.length - 1; i++) {
      const [ax, ay] = r.points[i];
      const [bx, by] = r.points[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / CELL));
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n;
        const y = ay + ((by - ay) * k) / n;
        const key = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
        if ((grid.get(key) ?? 0) < wgt) grid.set(key, wgt);
      }
    }
  }
  return grid;
}

// 0..1: how close and busy the nearest main road is to a point (full within ~120 m of a trunk road).
function roadLoudness(grid, x, y) {
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  let best = 0;
  for (let i = -5; i <= 5; i++) {
    for (let j = -5; j <= 5; j++) {
      const w = grid.get(`${cx + i},${cy + j}`);
      if (!w) continue;
      const d = Math.hypot(i, j) * CELL;
      best = Math.max(best, w * clamp(1 - Math.max(0, d - 60) / 240));
    }
  }
  return best;
}

function boxOf(poly) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of poly) {
    b.minX = Math.min(b.minX, x);
    b.maxX = Math.max(b.maxX, x);
    b.minY = Math.min(b.minY, y);
    b.maxY = Math.max(b.maxY, y);
  }
  return b;
}

function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
