// The airport simulation. Owns the clock, flights, runway, stands, turnarounds, ground vehicles,
// events and money. Pure logic (no DOM) so it runs headless for tests.
import { AIRCRAFT_TYPES, GENERIC_TAILS } from './aircraftTypes.js';
import { buildSchedule } from './schedule.js';
import { TaxiGraph } from './taxiGraph.js';
import { buildStands, parkedPose, standBlocker, chooseStand, book, unbook } from './stands.js';
import { servicePositions, routeAround, dims, aircraftFootprint, partsOverlap } from './footprint.js';
import { SCENARIOS, RANDOM_EVENTS } from './scenarios.js';
import { runwayFrames, orientStands } from '../map/props.js';
import { seeded, closestOnPolyline, pointInPolygon } from '../map/geometry.js';
import { Weather } from './weather.js';
import { Ledger, TARIFFS } from './finance.js';
import { buildJetBridges, bridgeExtension, doorAt } from './jetbridges.js';
import { crewSprites } from './groundcrew.js';
import { sunAt, daylight, dayPhase } from './sky.js';
import { Terminals, PERKS } from './terminal.js';
import { PROJECTS, freshProjects } from './projects.js';

const KT = 0.5144;
const GLIDE = Math.tan((3 * Math.PI) / 180);
const VISIBLE_FINAL_M = 17000;
const TOUCHDOWN_M = 350;
const HOLD_SHORT_M = 90;
const RUNWAY_BAND_M = 75;
const TAXI_MAX = 12;
const TAXI_TURN = 5;
const ACCEL = 1;
const DECEL = 2;
const PUSH_SPEED = 1.4;
const LAT_ACCEL = 1.0; // m/s² sideways in taxi turns: v ≤ sqrt(LAT_ACCEL · R)
const VEHICLE_SPEED = 7;
const MAX_HOLDING_S = 40 * 60;
const SEP = { MM: 90, MH: 90, HM: 135, HH: 105 }; // seconds, leader + follower wake
const DEP_SEP = { M: 60, H: 120 };

export const DEFAULT_TRAFFIC_BOOST = 0.5; // "Traffic" option on a normal day: +50 % by default, up to +100 %
export const TRAFFIC_LEVELS = [0, 0.5]; // +100 % (1) works in the schedule but can still freeze the runway at line-up: not offered yet

export const GSE = {
  tug: { label: 'Baggage tugs + carts', price: 18e5, start: 8 },
  beltLoader: { label: 'Belt loaders', price: 35e5, start: 9 },
  fuel: { label: 'Fuel trucks', price: 90e5, start: 5 },
  catering: { label: 'Catering trucks', price: 60e5, start: 5 },
  van: { label: 'Cleaning vans', price: 12e5, start: 5 },
  water: { label: 'Water / waste trucks', price: 30e5, start: 3 },
  gpu: { label: 'Ground power units', price: 20e5, start: 9 },
  stairs: { label: 'Passenger stairs', price: 25e5, start: 10 },
  bus: { label: 'Apron buses', price: 120e5, start: 5 },
  pushback: { label: 'Push-back tugs', price: 150e5, start: 4 },
};
export const CREW = { label: 'Ramp crews (6 people)', hireCost: 3e5, dayCost: 6000, start: 10 };
const VEHICLE_DAY_COST = 1500;
const FIXED_OPEX_PER_DAY = 1.2e7; // terminal operations, utilities, maintenance, security support
const UDF = { dom: 410, intl: 625 };
const LANDING_PER_T = { dom: 320, intl: 640 };
const PARKING_PER_T_H = 12;

const VISIBLE = new Set(['final', 'goAround', 'landing', 'taxiIn', 'atStand', 'pushback', 'turning', 'taxiOut', 'holdShort', 'lineUp', 'takeoff']);
const DEPARTURE_QUEUE = new Set(['pushback', 'turning', 'taxiOut', 'holdShort', 'lineUp']);
const MAX_DEPARTURE_QUEUE = 9; // aircraft between push-back and take-off before the gate holds the next one
const GROUND = new Set(['taxiIn', 'taxiOut', 'pushback', 'turning', 'holdShort', 'lineUp']);

export const PHASE_LABEL = {
  scheduled: 'Scheduled', inbound: 'Inbound', holding: 'Holding', final: 'On final', goAround: 'Go-around',
  landing: 'Landing', taxiIn: 'Taxiing in', atStand: 'At stand', pushback: 'Push-back', turning: 'Push-back',
  taxiOut: 'Taxiing out', holdShort: 'Holding short', lineUp: 'Lining up', takeoff: 'Take-off', departed: 'Departed',
  diverted: 'Diverted', cancelled: 'Cancelled',
};

const freshDayWx = () => ({ rain: 0, storm: 0, lowVis: 0, ramp: 0, minVis: 99999, maxT: -99, minT: 99, maxWind: 0 });
const hhmmText = (t) => `${String(Math.floor((t % 86400) / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`;

export class World {
  constructor(map, { scenarioId = 'normal', startTime = Date.now(), timetable = null, weatherMode = 'random', trafficBoost = DEFAULT_TRAFFIC_BOOST } = {}) {
    this.map = map;
    // The Traffic option: extra flights on top of a normal day (0, 0.5 or 1). Other scenarios set their own level.
    this.trafficBoost = scenarioId === 'normal' ? trafficBoost : 0;
    this.timetable = timetable;
    this.scenarioId = scenarioId;
    this.scenario = SCENARIOS[scenarioId] ?? SCENARIOS.normal;
    const ist = new Date(startTime + 5.5 * 3600e3);
    this.daySeed = ist.getUTCFullYear() * 10000 + (ist.getUTCMonth() + 1) * 100 + ist.getUTCDate();
    this.t0 = ist.getUTCHours() * 3600 + ist.getUTCMinutes() * 60 + ist.getUTCSeconds();
    this.t = this.t0;
    this.rnd = seeded(this.daySeed + scenarioId.length * 977);
    // Wall-clock seconds of the start day's midnight, so the sun and the season follow the real date.
    this.clockEpoch = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) / 1000;
    const sw = this.scenario.weather ?? {};
    this.weatherMode = weatherMode;
    this.weather = new Weather({ seed: this.daySeed + 5, t0: this.t0, month: sw.month ?? ist.getUTCMonth(), mode: weatherMode, bias: sw.bias ?? {}, forced: sw.forced ?? [] });

    this.frame = runwayFrames(map.runways).find((f) => f.ref === '07/25');
    this.graph = new TaxiGraph(map);
    // Link each stand to the taxi network first; its direction is then its actual lead-in line,
    // so the paint, the parked aircraft and every taxi-in / push-back all agree.
    const oriented = orientStands(map);
    oriented.push(...this.#t3Stands(map, oriented));
    for (const s of oriented) {
      const link = this.graph.addStand(s);
      if (!link) continue;
      const e = this.graph.nodes[link.entry];
      const len = Math.hypot(s.x - e.x, s.y - e.y) || 1;
      s.dir = [(s.x - e.x) / len, (s.y - e.y) / len];
      s.leadIn = len;
    }
    for (let i = oriented.length - 1; i >= 0; i--) if (oriented[i].t3 && !this.graph.standNode.has(oriented[i].id)) oriented.splice(i, 1);
    this.stands = buildStands(oriented, map);
    for (const s of this.stands) {
      if (s.t3) {
        s.closed = true; // built, but closed and invisible until the Terminal 3 project completes
        s.locked = 't3';
      }
    }
    this.graph.buildCorridors();
    this.standById = new Map(this.stands.map((s) => [s.id, s]));
    this.bridges = buildJetBridges(map, this.stands);

    this.windBase = { ...this.scenario.wind }; // the scenario's (or the real) wind; the weather adds breezes, turbulence and gusts
    this.wind = { ...this.windBase, gust: null };
    this.lighting = { apron: 'auto', runway: 'auto', dark: null, rwyFaultUntil: -1 };
    this.lights = null;
    this.fx = { ground: 1, ramp: 1 }; // weather and light effects on taxi speed and on ramp work
    this.rampClosedUntil = -1;
    this.rampClosed = false;
    this.lowVisNow = false;
    this.nextEnv = 0;
    this.stepDt = 1;
    this.xwindCool = -1;
    this.windWarnUntil = -1;
    this.stormWarned = -1;
    this.dayWx = freshDayWx();
    this.ledger = new Ledger();
    this.tariff = 'standard';
    this.active = this.#bestRunway();
    this.#setupRunway();
    this.closures = [];
    this.edgeUse = new Map(); // taxi edge id -> Map(flight id -> direction)
    this.arrSlots = [];
    this.runwayUser = null; // flight id currently using the runway
    this.lastDeparture = { t: -1e9, wake: 'M' };
    this.mods = { lowVisUntil: -1, itUntil: -1, itFactor: 1, secUntil: -1 };

    // A busier day starts with an airport equipped for it: crews and vehicles scale with the Traffic option.
    const fleet = 1 + this.trafficBoost;
    this.pool = Object.fromEntries(Object.entries(GSE).map(([k, v]) => [k, { total: Math.round(v.start * fleet), busy: 0, broken: 0 }]));
    this.crews = { total: Math.round(CREW.start * fleet), busy: 0 };
    this.money = this.scenario.money;
    this.vehicles = [];
    this.nextVehicleId = 1;
    this.log = [];
    this.kpi = { arrivals: 0, departures: 0, onTime: 0, depDelaySum: 0, diversions: 0, cancellations: 0, goArounds: 0, revenue: 0, costs: 0, satisfaction: 80, conflictsIgnored: 0 };
    this.events = this.scenario.events.map((e) => ({ ...e, time: this.t0 + e.at * 60, done: false }));

    this.perks = [];
    this.projects = freshProjects();
    this.term = new Terminals(this);
    this.dayIndex = Math.floor(this.t0 / 86400);
    this.dayCauses = {};
    this.airDay = {}; // per-airline results of the current day: { code: { dep, onTime, delay, cancel, divert, pax } }
    this.pendingReport = null;
    this.reports = [];
    this.autoRunway = false;
    this.liveWeather = false;
    this.lastRunwayChange = -1e9;
    this.radio = []; // spoken ATC calls, filled only while the voice is switched on
    this.radioOn = false;

    this.flights = [];
    this.days = new Set();
    this.#ensureSchedule();
    this.#prewarm();
    this.term.initFlights();
    this.#environment(true);
    this.dayBase = { ...this.kpi };
    this.note('info', `${this.scenario.name}: ${this.scenario.brief}`);
  }

  // ---------------------------------------------------------------------------------------------
  // Main loop

  update(dt) {
    let remaining = dt;
    while (remaining > 0) {
      const step = Math.min(1, remaining);
      remaining -= step;
      this.t += step;
      this.#tick(step);
    }
  }

  #tick(dt) {
    this.#ensureSchedule();
    this.stepDt = dt;
    this.weather.update(this.t, dt);
    if (this.t >= this.nextEnv) {
      this.nextEnv = this.t + 20;
      this.#environment();
    }
    this.#runEvents(dt);
    this.closures = this.closures.filter((c) => c.to > this.t);
    for (const f of this.flights) this.#updateFlight(f, dt);
    this.#updateVehicles(dt);
    this.term.update(dt);
    this.#projectsTick();
    this.#dayCheck();
    this.#autoRunwayTick();
    this.#costs(dt);
    if (this.flights.length > 600) this.flights = this.flights.filter((f) => !['departed', 'diverted', 'cancelled'].includes(f.phase) || this.t - (f.doneAt ?? this.t) < 3600);
  }

  // ---------------------------------------------------------------------------------------------
  // Schedule

  #ensureSchedule() {
    const day = Math.floor(this.t / 86400);
    for (const d of [day, day + 1]) {
      if (this.days.has(d)) continue;
      this.days.add(d);
      const rotations = buildSchedule({ daySeed: this.daySeed, traffic: this.scenario.traffic, day: d, timetable: this.timetable, boost: this.trafficBoost });
      for (const r of rotations) {
        if (r.std < this.t0 - 600) continue; // already gone before the game started
        this.flights.push(this.#makeFlight(r));
      }
    }
  }

  #makeFlight(r) {
    const t = AIRCRAFT_TYPES[r.type];
    return {
      ...r,
      eta: r.sta + r.inboundDelay - 300, // touchdown about 5 min before on-block
      tail: GENERIC_TAILS[r.id % GENERIC_TAILS.length],
      phase: 'scheduled',
      x: 0, y: 0, heading: 0, alt: 0, speed: 0,
      standId: null, slot: null, path: null, s: 0, stops: [],
      tasks: null, crew: false, onBlock: null, offBlock: null,
      waiting: null, delayCause: r.inboundDelay > 15 * 60 ? 'Late inbound aircraft' : null,
      holdingSince: null, priority: false, blockedBy: null, blockedFor: 0, ghostUntil: 0,
      wake: t.wake, vApp: t.approachKt * KT, vRot: t.rotateKt * KT,
      gN: t.length * t.noseGear, wb: t.wheelbase, limit: 0,
    };
  }

  // Starts the game mid-day: aircraft already on stands are placed with their turnaround progressed.
  #prewarm() {
    let spread = 0;
    for (const f of this.flights) {
      if (f.phase !== 'scheduled') continue;
      const onBlock = f.sta + f.inboundDelay;
      if (onBlock <= this.t - 120 && f.std >= this.t + 300) {
        const stand = chooseStand(this.stands, f, onBlock - 600, Math.max(f.std, onBlock + 3600) + 900);
        if (stand) {
          this.#assign(f, stand, onBlock - 600, Math.max(f.std, onBlock + 3600) + 900);
          this.#parkAt(f, stand);
          f.onBlock = onBlock;
          this.#startTurnaround(f, this.t - onBlock);
          continue;
        }
      }
      // Flights that should already have landed but are not on a stand: drop the ones about to
      // leave, and feed the rest in as late arrivals over the first half hour instead of a burst.
      if (f.eta < this.t + 120) {
        if (f.std < this.t + 40 * 60) {
          f.phase = 'departed';
          f.doneAt = this.t;
        } else {
          f.eta = this.t + 120 + (spread++ % 15) * 120;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Runway geometry and control

  #setupRunway() {
    const ends = this.frame.ends;
    const other = Object.keys(ends).find((d) => d !== this.active);
    this.thr = ends[this.active];
    this.far = ends[other];
    const len = this.frame.length;
    this.u = [(this.far[0] - this.thr[0]) / len, (this.far[1] - this.thr[1]) / len];
    this.exits = this.graph.runwayExits('07/25', this.thr, this.far);
    this.depEntry = this.exits.find((e) => e.s > -20) ?? this.exits[0];
  }

  runwayHeading(designator) {
    const ends = this.frame.ends;
    const other = Object.keys(ends).find((d) => d !== designator);
    const [a, b] = [ends[designator], ends[other]];
    return ((Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI + 360) % 360;
  }

  windComponents(designator = this.active) {
    const diff = ((this.wind.from - this.runwayHeading(designator)) * Math.PI) / 180;
    return { head: this.wind.kt * Math.cos(diff), cross: Math.abs(this.wind.kt * Math.sin(diff)) };
  }

  #bestRunway() {
    return Object.keys(this.frame.ends).reduce((a, b) => (this.windComponents(a).head >= this.windComponents(b).head ? a : b));
  }

  #along(p) {
    return (p[0] - this.thr[0]) * this.u[0] + (p[1] - this.thr[1]) * this.u[1];
  }

  #offCentre(p) {
    return Math.abs((p[0] - this.thr[0]) * this.u[1] - (p[1] - this.thr[1]) * this.u[0]);
  }

  runwayClosed(at = this.t) {
    return this.closures.some((c) => c.from <= at && c.to > at);
  }

  // Visibility in metres now: the weather's, or the scripted smoke event's 800 m if that is worse.
  visibility() {
    return this.t < this.mods.lowVisUntil ? Math.min(800, this.weather.now.vis) : this.weather.now.vis;
  }

  #sepFactor() {
    const vis = this.visibility();
    const cat3 = this.projects.cat3.state === 'done';
    const lowVis = vis < 550 ? (cat3 ? 1.5 : 3) : vis < 1200 ? (cat3 ? 1.3 : 2) : 1;
    return lowVis * (1 + 0.12 * this.weather.now.rain) * (this.projects.rets.state === 'done' ? 0.8 : 1);
  }

  // Earliest landing time >= earliest that keeps wake separation with every booked slot and
  // avoids closures; extra spacing when departures are queueing (mixed-mode runway).
  #nextSlot(earliest, wake, ignoreId) {
    const f = this.#sepFactor();
    const queue = this.flights.filter((x) => x.phase === 'holdShort' || x.phase === 'taxiOut').length;
    const extra = queue >= 3 ? 50 : 0;
    const slots = this.arrSlots.filter((s) => s.id !== ignoreId);
    const ok = (c) => {
      if (this.closures.some((cl) => c > cl.from - 60 && c < cl.to)) return false;
      return slots.every((s) => (s.time <= c ? c - s.time >= SEP[s.wake + wake] * f + extra : s.time - c >= SEP[wake + s.wake] * f + extra));
    };
    const candidates = [earliest, ...slots.map((s) => s.time + (SEP[s.wake + wake] * f + extra)), ...this.closures.map((c) => c.to)]
      .filter((c) => c >= earliest)
      .sort((a, b) => a - b);
    for (const c of candidates) if (ok(c)) return c;
    return Math.max(earliest, ...slots.map((s) => s.time)) + 180 * f;
  }

  #bookSlot(f, earliest) {
    this.arrSlots = this.arrSlots.filter((s) => s.id !== f.id);
    f.slot = this.#nextSlot(earliest, f.wake, f.id);
    this.arrSlots.push({ id: f.id, time: f.slot, wake: f.wake });
    this.arrSlots.sort((a, b) => a.time - b.time);
  }

  #releaseSlot(f) {
    this.arrSlots = this.arrSlots.filter((s) => s.id !== f.id);
  }

  #nextArrivalTime() {
    const upcoming = this.arrSlots.find((s) => s.time >= this.t - 10);
    return upcoming ? upcoming.time : Infinity;
  }

  // ---------------------------------------------------------------------------------------------
  // Flight state machine

  #updateFlight(f, dt) {
    switch (f.phase) {
      case 'scheduled':
        if (this.t >= f.eta - 20 * 60) {
          f.phase = 'holding';
          f.holdingSince = this.t;
          this.#tryInbound(f);
        }
        break;
      case 'holding':
        if (this.t >= (f.nextTry ?? 0)) {
          f.nextTry = this.t + 30;
          this.#tryInbound(f);
        }
        if (f.phase === 'holding' && this.t - f.holdingSince > MAX_HOLDING_S) this.#divert(f, f.waiting ?? 'Holding too long');
        break;
      case 'inbound':
        if (this.t >= f.slot - VISIBLE_FINAL_M / f.vApp) {
          // Last stand check before committing to the approach: a late neighbour may still be parked.
          const stand = this.standById.get(f.standId);
          const to = Math.max(f.std + 1800, f.slot + AIRCRAFT_TYPES[f.type].turnMin * 60 + 1500);
          if (standBlocker(stand, f.type, f.slot, to, f.id)) {
            const alt = chooseStand(this.stands.filter((s) => s !== stand), f, f.slot, to);
            if (alt) {
              this.#assign(f, alt, f.slot - 300, to);
              this.note('info', `${f.arrNo} moved to stand ${alt.ref}: stand ${stand.ref} still blocked.`, { flight: f.id });
            } else {
              this.#goAround(f, `Stand ${stand.ref} still occupied`);
              break;
            }
          }
          f.phase = 'final';
          this.#mark(f, 'final');
          this.#say(f, true, `runway ${this.active}, wind ${String(this.wind.from).padStart(3, '0')} degrees ${this.wind.kt} knots, cleared to land`);
        }
        break;
      case 'final':
        this.#fly(f);
        break;
      case 'goAround':
        f.s += f.speed * dt;
        f.alt += 9 * dt;
        this.#placeOnRunwayLine(f, f.s);
        if (this.t - f.phaseSince > 70) {
          f.phase = 'inbound';
          this.#bookSlot(f, this.t + 6 * 60);
        }
        break;
      case 'landing':
        this.#roll(f, dt);
        break;
      case 'taxiIn':
        this.#move(f, dt, TAXI_MAX * this.fx.ground);
        // Vacated once the whole aircraft is past the runway edge.
        if (this.runwayUser === f.id && this.#offCentre([f.x, f.y]) > this.frame.width / 2 + AIRCRAFT_TYPES[f.type].length / 2) this.runwayUser = null;
        if (f.s >= f.limit - 0.3) this.#arriveAtStand(f);
        break;
      case 'atStand':
        this.#turnaround(f);
        break;
      case 'pushback':
        this.#move(f, dt, PUSH_SPEED, { reverse: true });
        if (f.s >= f.limit - 0.2) {
          if (f.pushFallback) {
            // Dead-end taxilane: the tug has to swing the aircraft round on the spot.
            f.phase = 'turning';
            f.phaseSince = this.t;
            f.turnFrom = f.heading;
            const first = this.graph.nodes[f.depRoute[1] ?? f.depRoute[0]];
            f.turnTo = Math.atan2(first.y - f.y, first.x - f.x);
          } else {
            this.#startTaxiOut(f);
          }
        }
        break;
      case 'turning': {
        const k = Math.min(1, (this.t - f.phaseSince) / 18);
        f.heading = f.turnFrom + angleDiff(f.turnFrom, f.turnTo) * k;
        if (k >= 1) this.#startTaxiOut(f);
        break;
      }
      case 'taxiOut':
        this.#move(f, dt, TAXI_MAX * this.fx.ground);
        if (f.s >= f.limit - 0.5) {
          f.phase = 'holdShort';
          f.speed = 0;
          f.queuedAt = this.t;
        }
        break;
      case 'holdShort':
        this.#tryLineUp(f);
        break;
      case 'lineUp':
        // Follow the lead-on curve onto the centreline; roll once both gears are on it.
        this.#move(f, dt, 8, { noBrake: true });
        if (f.s >= f.limit - 0.5) {
          f.phase = 'takeoff';
          this.#say(f, false, `runway ${this.active}, cleared for take-off`);
          f.heading = Math.atan2(this.u[1], this.u[0]);
          f.s = this.#along([f.x, f.y]);
        }
        break;
      case 'takeoff':
        this.#takeoff(f, dt);
        break;
      default:
        break;
    }
  }

  #tryInbound(f) {
    if (f.standId === null) {
      const from = f.eta - 300;
      const to = Math.max(f.std + 1800, f.eta + AIRCRAFT_TYPES[f.type].turnMin * 60 + 1500);
      const stand = chooseStand(this.stands, f, from, to);
      if (!stand) {
        f.waiting = 'No stand available';
        f.delayCause ??= 'No stand available';
        return;
      }
      this.#assign(f, stand, from, to);
    }
    f.waiting = null;
    this.#bookSlot(f, Math.max(this.t + 4 * 60, f.eta));
    if (f.slot - f.eta > 50 * 60) {
      this.#divert(f, this.runwayClosed(f.eta) ? 'Runway closed' : 'Arrival queue too long');
      return;
    }
    f.phase = 'inbound';
  }

  #assign(f, stand, from, to) {
    if (f.standId !== null) unbook(this.standById.get(f.standId), f.id);
    f.standId = stand.id;
    book(stand, f, from, to);
  }

  #fly(f) {
    const dist = (f.slot - this.t) * f.vApp;
    f.alt = Math.max(0, dist * GLIDE) + (dist > 0 ? 12 : 0);
    f.speed = f.vApp;
    f.s = TOUCHDOWN_M - dist;
    this.#placeOnRunwayLine(f, f.s);
    // A closed runway is known well out; occupancy is decided just before the threshold, by
    // when the previous arrival is normally turning off (as with a real landing clearance).
    if (dist < f.vApp * 30 && this.runwayClosed()) {
      this.#goAround(f, 'Runway closed');
      return;
    }
    if (dist < f.vApp * 8 && this.runwayUser !== f.id) {
      if (this.runwayUser !== null) {
        this.#goAround(f, 'Runway occupied');
        return;
      }
      this.runwayUser = f.id;
    }
    if (this.t >= f.slot) {
      f.phase = 'landing';
      this.#mark(f, 'landed');
      f.alt = 0;
      f.s = TOUCHDOWN_M;
      this.#releaseSlot(f);
      this.kpi.arrivals++;
      const fee = AIRCRAFT_TYPES[f.type].mtow * LANDING_PER_T[f.intl ? 'intl' : 'dom'];
      this.#earn(fee * TARIFFS[this.tariff].mult, 'landing', { airline: f.airline });
      // Choose the first exit we can reach at turn-off speed, with a route to the stand.
      const stop = TOUCHDOWN_M + (f.vApp ** 2 - 12 ** 2) / (2 * 2.3) + 40;
      const link = this.graph.standNode.get(f.standId);
      const options = [];
      for (const ex of this.exits) {
        if (ex.s < stop || options.length >= 4) continue;
        const prev = this.#runwayNeighbour(ex.node, -1);
        if (prev === null) continue;
        // Arriving along the runway: the route may only turn off at an angle the aircraft can make.
        const path = this.graph.findPath(ex.node, link.node, { ...this.#routeOptions(), prev });
        if (!path || path.length < 2) continue;
        // Only exits angled with the landing direction: a turn-off sharper than ~100° (an exit
        // built for the opposite direction) is not something an airliner can make.
        const nx = this.graph.nodes[path[1]];
        const en = this.graph.nodes[ex.node];
        const exitDir = unit([nx.x - en.x, nx.y - en.y]);
        if (exitDir[0] * this.u[0] + exitDir[1] * this.u[1] < -0.17) continue;
        options.push({ ex, path, prev, clear: !this.#routeConflict(f, this.#legsOf(path)) });
      }
      // The first exit with nobody coming the other way along the route, else the first exit.
      const pick = options.find((o) => o.clear) ?? options[0];
      if (pick) {
        f.exit = pick.ex;
        f.exitPath = pick.path;
        f.exitPrev = pick.prev;
        f.exitTurn = this.graph.filletArc(pick.prev, pick.ex.node, pick.path[1]).d;
        this.#registerRoute(f, pick.path);
      }
      if (!f.exit) this.#divert(f, 'No runway exit route');
    }
  }

  #placeOnRunwayLine(f, s) {
    f.x = this.thr[0] + this.u[0] * s;
    f.y = this.thr[1] + this.u[1] * s;
    f.heading = Math.atan2(this.u[1], this.u[0]);
  }

  #goAround(f, reason) {
    f.phase = 'goAround';
    f.phaseSince = this.t;
    f.speed = 75;
    this.#releaseSlot(f);
    if (this.runwayUser === f.id) this.runwayUser = null;
    this.kpi.goArounds++;
    this.note('warn', `${f.arrNo} go-around: ${reason}.`, { flight: f.id });
  }

  #roll(f, dt) {
    f.speed = Math.max(12, f.speed - 2.3 * dt);
    f.s += f.speed * dt;
    this.#placeOnRunwayLine(f, f.s);
    // Start following the lead-off line just before it curves away from the centreline.
    if (f.exit && f.s + f.gN >= f.exit.s - f.exitTurn - 6) {
      const L = AIRCRAFT_TYPES[f.type].length;
      const main = [this.thr[0] + this.u[0] * (f.s + f.gN - f.wb), this.thr[1] + this.u[1] * (f.s + f.gN - f.wb)];
      const nose = [this.thr[0] + this.u[0] * (f.s + f.gN), this.thr[1] + this.u[1] * (f.s + f.gN)];
      const pts = this.graph.smoothRoute(f.exitPath, { prev: f.exitPrev, start: [main, nose] });
      f.routeIds = f.exitPath;
      // The nose gear stops where the parked aircraft's nose gear will be.
      this.#setPath(f, pts, { trimEnd: (L / 2 - f.gN) + 4, startS: f.wb });
      f.stops = this.#crossingStops(f.path, 0, f.limit);
      this.#planJunctions(f, f.exitPath);
      f.phase = 'taxiIn';
      f.admitted = !this.#routeConflict(f, f.legs);
      f.standRef = this.standById.get(f.standId).ref;
    }
  }

  // Next runway node from `node` along the active direction (+1) or against it (-1).
  #runwayNeighbour(node, sign) {
    const here = this.#along([this.graph.nodes[node].x, this.graph.nodes[node].y]);
    let best = null;
    for (const id of this.graph.nodes[node].edges) {
      const e = this.graph.edges[id];
      if (e.kind !== 'runway' || e.ref !== '07/25') continue;
      const o = e.a === node ? e.b : e.a;
      const s = this.#along([this.graph.nodes[o].x, this.graph.nodes[o].y]);
      if ((s - here) * sign > 0.5 && (!best || Math.abs(s - here) < best.d)) best = { o, d: Math.abs(s - here) };
    }
    return best?.o ?? null;
  }

  #arriveAtStand(f) {
    this.#releaseRoute(f);
    const stand = this.standById.get(f.standId);
    this.#parkAt(f, stand);
    f.onBlock = this.t;
    if (this.runwayUser === f.id) this.runwayUser = null;
    this.#startTurnaround(f, 0);
  }

  #parkAt(f, stand) {
    const pose = parkedPose(stand, f.type);
    Object.assign(f, pose, { phase: 'atStand', speed: 0, alt: 0 });
    stand.occupant = f.id;
  }

  // ---------------------------------------------------------------------------------------------
  // Movement along paths, with conflict avoidance

  // Sets the line an aircraft follows. Positions along it (s) are for the leading gear: the nose
  // gear when taxiing forward, the main gear when pushed back.
  #setPath(f, pts, { trimEnd = 0, startS = 0 } = {}) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    f.path = { pts, cum, total: cum.at(-1) };
    f.limit = Math.max(startS, cum.at(-1) - trimEnd);
    f.s = startS;
  }

  // Point and direction at distance s; beyond either end the line is extended straight.
  #pointAt(path, s) {
    const { pts, cum } = path;
    if (pts.length < 2) return { x: pts[0][0], y: pts[0][1], dir: 0 };
    if (s <= 0) {
      const dir = dirOf(pts[0], pts[1]);
      return { x: pts[0][0] + Math.cos(dir) * s, y: pts[0][1] + Math.sin(dir) * s, dir };
    }
    if (s >= cum.at(-1)) {
      const dir = dirOf(pts.at(-2), pts.at(-1));
      const over = s - cum.at(-1);
      return { x: pts.at(-1)[0] + Math.cos(dir) * over, y: pts.at(-1)[1] + Math.sin(dir) * over, dir };
    }
    let lo = 1;
    let hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < s) lo = mid + 1;
      else hi = mid;
    }
    const i = lo;
    const seg = cum[i] - cum[i - 1] || 1;
    const k = (s - cum[i - 1]) / seg;
    return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k, dir: dirOf(pts[i - 1], pts[i]) };
  }

  // Turn radius of the line around s (Infinity on straights).
  #radiusAt(path, s) {
    const a = this.#pointAt(path, s - 5).dir;
    const b = this.#pointAt(path, s + 5).dir;
    const turn = Math.abs(angleDiff(a, b));
    return turn < 1e-3 ? Infinity : 10 / turn;
  }

  // Aircraft pose from its two gears on the line: the nose gear and the main gear both sit on
  // the line, the body points from main gear to nose gear (so it swings naturally in turns).
  #placeOnPath(f, reverse) {
    const lead = this.#pointAt(f.path, f.s);
    // Rigid body: the trailing gear is the point on the line exactly one wheelbase (straight
    // line) from the leading gear. Along a curve that is a little further back than one
    // wheelbase of path length.
    let st = f.s - f.wb;
    let trail = this.#pointAt(f.path, st);
    for (let i = 0; i < 8; i++) {
      const chord = Math.hypot(lead.x - trail.x, lead.y - trail.y);
      if (Math.abs(chord - f.wb) < 0.02) break;
      st -= f.wb - chord;
      trail = this.#pointAt(f.path, st);
    }
    const nose = reverse ? trail : lead;
    const main = reverse ? lead : trail;
    const h = Math.atan2(nose.y - main.y, nose.x - main.x);
    f.heading = h;
    f.x = nose.x - Math.cos(h) * f.gN;
    f.y = nose.y - Math.sin(h) * f.gN;
  }

  // Distance along a path to the vertex closest to `pt`.
  #sOfPoint(path, pt) {
    let best = 0;
    let bestD = Infinity;
    path.pts.forEach((q, i) => {
      const d = Math.hypot(q[0] - pt[0], q[1] - pt[1]);
      if (d < bestD) [bestD, best] = [d, path.cum[i]];
    });
    return best;
  }

  // Where a taxi route enters the active runway's strip (after `skip` m, before `upTo` m).
  #crossingStops(path, skip, upTo = path.total) {
    const stops = [];
    let inside = true;
    for (let s = 0; s <= upTo; s += 5) {
      const p = this.#pointAt(path, s);
      const near = this.#offCentre([p.x, p.y]) < RUNWAY_BAND_M && this.#along([p.x, p.y]) > -100 && this.#along([p.x, p.y]) < this.frame.length + 100;
      if (near && !inside && s > skip) stops.push({ at: Math.max(0, s - 20), cleared: false });
      inside = near;
    }
    return stops;
  }

  #move(f, dt, vmax, { reverse = false, noBrake = false } = {}) {
    const len = AIRCRAFT_TYPES[f.type].length;
    let target = vmax;
    if (!reverse) {
      // Slow for curves ahead: v ≤ sqrt(LAT_ACCEL · R), braking early enough to get there.
      for (let ahead = 0; ahead <= 70; ahead += 7) {
        const r = this.#radiusAt(f.path, f.s + ahead);
        if (r < 500) target = Math.min(target, Math.sqrt(Math.max(TAXI_TURN ** 2 * 0.5, LAT_ACCEL * r) + 2 * DECEL * ahead));
      }
      // Stop at uncleared runway crossings.
      const stop = f.stops.find((st) => !st.cleared && st.at >= f.s - 1);
      if (stop) {
        if (stop.at - f.s < 3 && this.#crossingClear(f)) {
          stop.cleared = true;
          this.runwayUser = f.id;
          f.crossing = true;
        } else {
          target = Math.min(target, Math.sqrt(Math.max(0, 2 * DECEL * (stop.at - f.s))));
          if (stop.at - f.s < 3) f.waiting = 'Waiting to cross the runway';
        }
      }
      // Junction holds: go on only if no corridor left on our route is occupied, or promised to a
      // cleared aircraft, in the other direction (route-wide clearance, so no head-on meetings).
      const j = this.#nextJunction(f);
      if (j && j.stopS - f.s < (f.speed ** 2) / (2 * DECEL) + 60) {
        // An aircraft still vacating the runway never stops on it: it always has priority.
        const vacating = this.runwayUser === f.id || this.#offCentre([f.x, f.y]) < RUNWAY_BAND_M;
        const opposing = vacating ? null : this.#routeConflict(f, this.#remainingLegs(f, j.enterS + 0.5));
        f.admitted = !opposing;
        f.waitFor = opposing?.id ?? null;
        f.junctionHold = Boolean(opposing) && j.stopS - f.s < 6;
        if (opposing) {
          target = Math.min(target, Math.sqrt(Math.max(0, 2 * DECEL * (j.stopS - f.s))));
          if (j.stopS - f.s < 4 && f.speed < 0.5) {
            f.waiting = `Giving way to ${opposing.phase === 'taxiIn' ? opposing.arrNo : opposing.depNo}`;
            f.giveWayFor = (f.giveWayFor ?? 0) + dt;
            // Standoff: the other aircraft is waiting on us too. One of us takes another way.
            const standoff = opposing.blockedBy === f.id || opposing.waitFor === f.id;
            if (standoff && f.giveWayFor > 15 && this.t > (f.nextReroute ?? 0)) {
              f.nextReroute = this.t + 45;
              if (!this.#rerouteAround(f, opposing, j)) this.#rerouteAround(opposing, f);
            }
            // Last resort (counted): after four minutes of standoff, go.
            if ((standoff || (f.giveWayFor > 240 && this.#inBlockCycle(f))) && f.giveWayFor > 240) {
              f.giveWayFor = 0;
              j.cleared = true;
              f.admitted = true;
              this.kpi.conflictsIgnored++;
              (this.overrides ??= []).push({ t: this.t, kind: 'junction', a: f.id, b: opposing.id, wa: f.waiting, wb: opposing.waiting });
            }
          }
        } else {
          j.cleared = true;
          f.giveWayFor = 0;
          if (f.waiting?.startsWith('Giving way')) f.waiting = null;
        }
      }
      if (f.crossing && this.#offCentre([f.x, f.y]) > RUNWAY_BAND_M + 10) {
        f.crossing = false;
        if (this.runwayUser === f.id) this.runwayUser = null;
      }
      // Keep clear of aircraft ahead.
      const blocker = this.t > f.ghostUntil ? this.#blocker(f, len) : null;
      if (blocker) {
        f.blockedBy = blocker.id;
        // Head-on standoff: the aircraft that gives way (not prioritised, or the younger one)
        // looks for another way round the other aircraft's route.

        f.blockedFor += dt;
        target = 0;
        f.waiting = `Holding for ${blocker.phase === 'taxiIn' ? blocker.arrNo : blocker.depNo}`;
        // Last-resort deadlock breaker: only for a cycle of aircraft each waiting on the next,
        // never for an ordinary queue behind a stopped or holding aircraft.
        if (f.blockedFor > (this.runwayUser === f.id ? 60 : 240) && this.#inBlockCycle(f)) {
          f.ghostUntil = this.t + 30;
          f.blockedFor = 0;
          this.kpi.conflictsIgnored++;
          (this.overrides ??= []).push({ t: this.t, kind: 'blocker', a: f.id, b: f.blockedBy, wa: f.waiting, wb: this.flights.find((x) => x.id === f.blockedBy)?.waiting });
        }
      } else {
        f.blockedBy = null;
        f.blockedFor = 0;
        if (f.waiting?.startsWith('Holding for')) f.waiting = null;
      }
    }
    // Brake for the end of this leg (stand stop bar, hold-short line...).
    if (!noBrake) target = Math.min(target, Math.sqrt(Math.max(0, 2 * DECEL * (f.limit - f.s))) + 0.3);
    f.speed = f.speed < target ? Math.min(target, f.speed + ACCEL * dt) : Math.max(target, f.speed - DECEL * dt);
    f.s = Math.min(f.limit, f.s + f.speed * dt);
    this.#placeOnPath(f, reverse);
  }

  #blocker(f, len) {
    const span = AIRCRAFT_TYPES[f.type].span;
    const look = (f.speed ** 2) / (2 * DECEL) + len / 2 + 30;
    const hx = Math.cos(f.heading);
    const hy = Math.sin(f.heading);
    let found = null;
    for (const g of this.flights) {
      if (g === f || !GROUND.has(g.phase)) continue;
      const dx = g.x - f.x;
      const dy = g.y - f.y;
      if (Math.hypot(dx, dy) > look + 90) continue;
      if (dx * hx + dy * hy <= 0) continue; // behind us
      const gt = AIRCRAFT_TYPES[g.type];
      const clearance = (span + gt.span) * 0.3 + 6;
      for (let s = 8; s <= look; s += 8) {
        const p = this.#pointAt(f.path, f.s + s);
        // An aircraft held at a junction only blocks traffic it would physically touch (wingtip
        // clearance); the heuristic margin is for moving aircraft, and applying it here made two
        // aircraft wait for each other.
        const held = g.speed < 0.5 && Boolean(g.junctionHold);
        const limitD = held ? (span + gt.span) * 0.5 + 3 : clearance + (len + gt.length) * 0.25;
        if (Math.hypot(p.x - g.x, p.y - g.y) < limitD) {
          // Two aircraft each waiting for the other at a crossing: the prioritised (or older)
          // one goes first — they cross, not collide. Head-on meetings are handled by re-routing.
          const headOn = Math.abs(angleDiff(f.heading, g.heading)) > 2.4;
          if (!headOn && g.blockedBy === f.id && (f.priority || (!g.priority && f.id < g.id))) return null;
          found = g;
          break;
        }
      }
      if (found) break;
    }
    return found;
  }

  // Traffic-flow planning: every taxi route is registered with its direction of travel, and new
  // routes pay a heavy penalty for using a taxiway against existing traffic (no head-on meetings).
  #routeOptions() {
    return {
      runwayCost: (e) => (e.ref === '07/25' ? 1e5 : 300),
      extraCost: (e, from) => {
        const use = this.edgeUse.get(e.id);
        if (!use || use.size === 0) return 0;
        const dir = e.a === from ? 1 : -1;
        for (const d of use.values()) if (d !== dir) return 5000;
        return 0;
      },
    };
  }

  #registerRoute(f, nodeIds) {
    this.#releaseRoute(f);
    f.routeEdges = [];
    for (let i = 1; i < nodeIds.length; i++) {
      const e = this.graph.edgeBetween(nodeIds[i - 1], nodeIds[i]);
      if (!e || e.kind !== 'taxi') continue;
      const dir = e.a === nodeIds[i - 1] ? 1 : -1;
      if (!this.edgeUse.has(e.id)) this.edgeUse.set(e.id, new Map());
      this.edgeUse.get(e.id).set(f.id, dir);
      f.routeEdges.push(e.id);
    }
  }

  #releaseRoute(f) {
    for (const id of f.routeEdges ?? []) this.edgeUse.get(id)?.delete(f.id);
    f.routeEdges = [];
  }

  // Junctions along the current route: where the aircraft enters each taxi corridor, the point
  // to hold at (before the turn's curve begins) and the direction it will travel.
  #planJunctions(f, ids) {
    const g = this.graph;
    f.junctions = [];
    f.corridorIds = ids;
    // Every taxi leg of the route with its corridor, direction and where it starts along the path.
    f.legs = [];
    const S = this.#nodeS(f.path, ids);
    for (let i = 0; i < ids.length - 1; i++) {
      const e = g.edgeBetween(ids[i], ids[i + 1]);
      if (!e || e.kind !== 'taxi') continue;
      f.legs.push({ s: i === 0 ? -Infinity : S[i], corr: e.corr, dir: e.corrDir * (e.a === ids[i] ? 1 : -1) });
    }
    for (let i = 1; i < ids.length - 1; i++) {
      const node = g.nodes[ids[i]];
      const e = g.edgeBetween(ids[i], ids[i + 1]);
      if (!e || e.kind !== 'taxi') continue;
      // A corridor boundary: a real taxiway junction, or a change of corridor (e.g. off a runway).
      const before = g.edgeBetween(ids[i - 1], ids[i]);
      if (g.junctionDegree(ids[i]) < 3 && before?.corr === e.corr) continue;
      if (before?.corr === e.corr) continue;
      const arc = g.filletArc(ids[i - 1], ids[i], ids[i + 1]);
      const enterS = S[i];
      const curveS = arc.d > 0.3 ? Math.min(enterS, this.#sOfPointBetween(f.path, arc.pts[0], S[i - 1], enterS)) : enterS;
      if (enterS < f.s + 1) continue;
      // Intermediate holding position: the nose stays 47.5 m short of the crossing taxiway's
      // centreline (ICAO code E), and short of where the turn's curve begins.
      const noseOverhang = (AIRCRAFT_TYPES[f.type].length / 2 - f.gN);
      const stopS = Math.min(curveS - 8, enterS - 47.5 - noseOverhang);
      f.junctions.push({ k: i, node: ids[i], enterS, stopS: Math.max(f.s, stopS), corr: e.corr, dir: e.corrDir * (e.a === ids[i] ? 1 : -1), cleared: false });
    }
  }

  // Distance along the path of each route node, in order. A route can pass through the same node
  // twice (taxiing round a loop to turn round), so each search starts where the previous node was.
  #nodeS(path, ids) {
    const g = this.graph;
    const out = [0];
    let from = 0;
    let k0 = 0;
    for (let i = 1; i < ids.length; i++) {
      const n = g.nodes[ids[i]];
      const span = (g.edgeBetween(ids[i - 1], ids[i])?.len ?? 100) + 140;
      while (k0 < path.pts.length - 1 && path.cum[k0 + 1] < from - 1) k0++;
      let best = from;
      let bd = Infinity;
      for (let k = k0; k < path.pts.length && path.cum[k] <= from + span; k++) {
        const d = Math.hypot(path.pts[k][0] - n.x, path.pts[k][1] - n.y);
        if (d < bd) [bd, best] = [d, path.cum[k]];
      }
      out.push(best);
      from = best;
    }
    return out;
  }

  // Distance of the path vertex nearest to pt, searched only between lo and hi.
  #sOfPointBetween(path, pt, lo, hi) {
    let best = hi;
    let bd = Infinity;
    for (let k = 0; k < path.pts.length; k++) {
      if (path.cum[k] < lo - 1) continue;
      if (path.cum[k] > hi + 1) break;
      const d = Math.hypot(path.pts[k][0] - pt[0], path.pts[k][1] - pt[1]);
      if (d < bd) [bd, best] = [d, path.cum[k]];
    }
    return best;
  }

  #nextJunction(f) {
    // An uncleared junction stays in force even if the aircraft rolls a little past its hold point.
    return f.junctions?.find((j) => !j.cleared && j.stopS < f.limit) ?? null;
  }

  // Corridor the aircraft's nose is in now: the last junction it passed, else its first edge.
  #corridorNow(f) {
    // Pushing back: it already holds the taxilane, in the direction it is about to taxi.
    if ((f.phase === 'pushback' || f.phase === 'turning') && f.depRoute?.length > 1) {
      const e = this.graph.edgeBetween(f.depRoute[0], f.depRoute[1]);
      return e?.kind === 'taxi' ? { corr: e.corr, dir: e.corrDir * (e.a === f.depRoute[0] ? 1 : -1) } : null;
    }
    if (!GROUND.has(f.phase) || !f.legs?.length) return null;
    let cur = f.legs[0];
    for (const leg of f.legs) if (leg.s <= f.s) cur = leg;
    return { corr: cur.corr, dir: cur.dir };
  }

  // Taxi legs (corridor + direction) of a route given as node ids.
  #legsOf(ids) {
    const legs = [];
    for (let i = 0; i < ids.length - 1; i++) {
      const e = this.graph.edgeBetween(ids[i], ids[i + 1]);
      if (e?.kind === 'taxi') legs.push({ s: -Infinity, corr: e.corr, dir: e.corrDir * (e.a === ids[i] ? 1 : -1) });
    }
    return legs;
  }

  // The legs still ahead of distance `fromS` (a pushing-back aircraft: its whole departure route).
  #remainingLegs(f, fromS) {
    if (f.phase === 'pushback' || f.phase === 'turning') return f.pendingLegs ?? [];
    if (!f.legs) return [];
    return f.legs.filter((leg, i) => !(f.legs[i + 1] && f.legs[i + 1].s <= fromS));
  }

  // Who we would meet head-on on these legs: an aircraft in one of them the other way, or a
  // cleared aircraft whose remaining route runs through one of them the other way.
  #routeConflict(f, legs) {
    if (!legs.length) return null;
    const mine = new Map();
    for (const l of legs) (mine.get(l.corr) ?? mine.set(l.corr, new Set()).get(l.corr)).add(l.dir);
    const clash = (l) => {
      const dirs = mine.get(l.corr);
      return Boolean(dirs) && (dirs.size > 1 || !dirs.has(l.dir));
    };
    for (const g of this.flights) {
      if (g === f || !GROUND.has(g.phase)) continue;
      if (g.blockedBy === f.id) continue; // queued right behind me: it cannot get ahead
      const now = this.#corridorNow(g);
      if (now && clash(now)) return g;
      if (!g.admitted) continue;
      for (const l of this.#remainingLegs(g, g.s)) if (clash(l)) return g;
    }
    return null;
  }

  // Re-plan the rest of a taxi route from a junction ahead (or the next node far enough ahead),
  // avoiding another aircraft's route and, at a junction hold, the opposed corridor.
  #rerouteAround(f, other, junction = null) {
    const ids = f.routeIds;
    if (!ids || ids.length < 3 || !['taxiIn', 'taxiOut'].includes(f.phase)) return false;
    let k = junction ? junction.k : -1;
    for (let i = 1; k < 0 && i < ids.length; i++) {
      const n = this.graph.nodes[ids[i]];
      // Far enough ahead that the new turn's curve starts in front of the nose gear.
      if (this.#sOfPoint(f.path, [n.x, n.y]) > f.s + 50) k = i;
    }
    if (k < 1) return false;
    const avoid = new Set(other.routeEdges ?? []);
    if (junction) for (const e of this.graph.edges) if (e.corr === junction.corr) avoid.add(e.id);
    const base = this.#routeOptions();
    const options = { ...base, prev: ids[k - 1], extraCost: (e, from) => (avoid.has(e.id) ? 1e5 : base.extraCost(e, from)) };
    const dest = f.phase === 'taxiIn' ? this.graph.standNode.get(f.standId).node : this.#runwayNeighbour(this.depEntry.node, 1);
    const path = dest === null ? null : this.graph.findPath(ids[k], dest, options);
    if (!path || path.some((n, i) => i > 0 && avoid.has(this.graph.edgeBetween(path[i - 1], n)?.id))) return false;
    const nose = [f.x + Math.cos(f.heading) * f.gN, f.y + Math.sin(f.heading) * f.gN];
    const main = [nose[0] - Math.cos(f.heading) * f.wb, nose[1] - Math.sin(f.heading) * f.wb];
    // Keep every route node between the nose gear and the re-route junction (their turns are
    // unchanged, so the aircraft stays on the painted lines); the first kept node is the first
    // whose turn curve has not started yet.
    let j0 = k;
    for (let i = 1; i < k; i++) {
      const arcStart = this.graph.filletArc(ids[i - 1], ids[i], ids[i + 1]).pts[0];
      if (this.#sOfPoint(f.path, arcStart) > f.s + 1) {
        j0 = i;
        break;
      }
    }
    const route = [...ids.slice(j0, k), ...path];
    const prev = ids[j0 - 1];
    // No silly detours: at most 1.5 km more than the rest of the current route.
    let newLen = 0;
    for (let i = 1; i < route.length; i++) newLen += this.graph.edgeBetween(route[i - 1], route[i])?.len ?? 0;
    if (newLen > f.limit - f.s + 1500) return false;
    // Keep the exact line ahead of the nose up to the first kept turn (e.g. the rest of a curve
    // the aircraft is in), so the new route continues on the painted lines.
    const keepTo = this.#sOfPoint(f.path, this.graph.filletArc(ids[j0 - 1], ids[j0], ids[j0 + 1]).pts[0]);
    const ahead = f.path.pts.filter((_, i) => f.path.cum[i] > f.s + 0.5 && f.path.cum[i] < keepTo - 0.5);
    if (f.phase === 'taxiIn') {
      this.#registerRoute(f, [prev, ...route]);
      const pts = this.graph.smoothRoute(route, { prev, start: [main, nose, ...ahead] });
      f.routeIds = route;
      this.#setPath(f, pts, { trimEnd: (AIRCRAFT_TYPES[f.type].length / 2 - f.gN) + 4, startS: f.wb });
      f.stops = this.#crossingStops(f.path, 0, f.limit);
      this.#planJunctions(f, [prev, ...route]);
    } else {
      const dep = route.at(-2) === this.depEntry.node ? route.slice(0, -1) : route;
      this.#registerRoute(f, [prev, ...dep]);
      f.depRoute = dep;
      f.pushFallback = true;
      f.replanPrev = prev;
      f.replanAhead = ahead;
      this.#planTaxiOut(f);
    }
    f.speed = 0;
    this.note('info', `${f.phase === 'taxiIn' ? f.arrNo : f.depNo} re-routed to give way to ${other.phase === 'taxiIn' ? other.arrNo : other.depNo}.`, { flight: f.id });
    return true;
  }

  // Waiting chain (blocked by, or giving way to) that loops back: a deadlock.
  // Does a chain of aircraft, each waiting for the next, come back round to f? Links: holding behind
  // an aircraft, giving way to one at a junction, waiting at the hold-short line for the aircraft that
  // is using the runway, and waiting in the departure queue for the aircraft at its front.
  #inBlockCycle(f) {
    const waitsOn = (x) => {
      // A blocker that has left the ground (or never was) is a stale link; do not let it hide the real wait.
      const b = x.blockedBy !== null && x.blockedBy !== undefined ? this.flights.find((y) => y.id === x.blockedBy) : null;
      if (b && GROUND.has(b.phase)) return b.id;
      if (x.waitFor !== null && x.waitFor !== undefined) return x.waitFor;
      if ((x.phase === 'holdShort' || x.phase === 'taxiOut') && this.runwayUser !== null && this.runwayUser !== x.id && x.waiting === 'Runway occupied') return this.runwayUser;
      // In the departure queue: waiting for the aircraft at the front of it.
      if (x.phase === 'holdShort' && x.waiting?.startsWith('Departure queue')) {
        const head = this.flights.filter((g) => g.phase === 'holdShort').sort((p, q) => (q.priority - p.priority) || (p.queuedAt - q.queuedAt))[0];
        if (head && head.id !== x.id) return head.id;
      }
      return null;
    };
    const seen = new Set([f.id]);
    let g = this.flights.find((x) => x.id === waitsOn(f));
    for (let i = 0; g && i < 30; i++) {
      const next = waitsOn(g);
      if (next === null) return false;
      if (seen.has(next)) return true;
      seen.add(g.id);
      g = this.flights.find((x) => x.id === next);
    }
    return false;
  }

  #crossingClear(f) {
    if (this.runwayUser !== null && this.runwayUser !== f.id) return false;
    return this.#nextArrivalTime() - this.t > 60;
  }

  // ---------------------------------------------------------------------------------------------
  // Turnaround

  #taskPlan(f) {
    const stand = this.standById.get(f.standId);
    const type = AIRCRAFT_TYPES[f.type];
    const k = type.seats / 186;
    const wide = type.code === 'E';
    const remote = !stand.contact || !this.bridges.some((b) => b.standId === stand.id); // no bridge reaches: stairs and buses
    const min = 60;
    return [
      { id: 'chocks', label: 'Chocks and cones', after: [], dur: 1 * min, spots: [], crew: true },
      { id: 'power', label: 'Ground power', after: ['chocks'], dur: 0.5 * min, spots: ['gpu'], keepUntil: 'close' },
      { id: 'connect', label: remote ? 'Stairs' : 'Jet bridge', after: ['chocks'], dur: 1.5 * min, spots: remote ? ['stairsFwd', 'stairsAft'] : [], keepUntil: 'close' },
      { id: 'deboard', label: 'Deboarding', after: ['connect'], dur: f.paxIn * 2.2, spots: remote ? ['bus'] : [] },
      { id: 'unload', label: 'Unload bags', after: ['chocks'], dur: (8 + 6 * k) * min, spots: ['beltAft', 'tugAft'], keepUntil: 'load' },
      { id: 'clean', label: 'Cleaning', after: ['deboard'], dur: (6 + 5 * k) * min, spots: ['cleaning'] },
      { id: 'cater', label: 'Catering', after: ['deboard'], dur: (6 + 6 * k) * min, spots: ['catering'] },
      { id: 'fuel', label: 'Refuelling', after: ['deboard'], dur: (10 + 8 * k) * min, spots: ['fuel'] },
      ...(wide || f.id % 3 === 0 ? [{ id: 'water', label: 'Water and waste', after: ['deboard'], dur: 6 * min, spots: ['water'] }] : []),
      { id: 'board', label: 'Boarding', after: ['clean', 'cater', 'fuel'], dur: f.paxOut * 3, spots: remote ? ['bus'] : [], board: true },
      { id: 'load', label: 'Load bags', after: ['unload'], dur: (8 + 6 * k) * min, spots: ['beltAft', 'tugAft'], lead: 14 * min },
      { id: 'close', label: 'Doors closed', after: ['board', 'load', 'power', 'connect', ...(wide || f.id % 3 === 0 ? ['water'] : [])], dur: 2 * min, spots: [] },
    ];
  }

  #startTurnaround(f, elapsed) {
    f.tasks = this.#taskPlan(f).map((t) => ({ ...t, state: 'wait', start: null, end: null, vehicleIds: [] }));
    f.cones = true;
    // Prewarm: complete tasks that would already be done `elapsed` seconds after on-block.
    if (elapsed > 0) {
      const finish = new Map();
      for (const task of f.tasks) {
        const ready = Math.max(0, ...task.after.map((a) => finish.get(a) ?? 0));
        const end = ready + task.dur;
        finish.set(task.id, end);
        if (end <= elapsed && task.id !== 'close') task.state = 'done';
      }
    }
  }

  #turnaround(f) {
    // A late aircraft keeps its stand (and its neighbours' wingtip space) booked until it leaves.
    const booking = this.standById.get(f.standId).bookings.find((b) => b.flightId === f.id);
    if (booking && booking.to < this.t + 600) booking.to = this.t + 600;
    if (!f.crew) {
      if (this.crews.busy < this.crews.total) {
        this.crews.busy++;
        f.crew = true;
      } else {
        f.waiting = 'No ramp crew free';
        f.delayCause ??= 'Ramp crew shortage';
        return;
      }
    }
    const byId = new Map(f.tasks.map((t) => [t.id, t]));
    const itFactor = this.t < this.mods.itUntil ? this.mods.itFactor : 1;
    const baseSpeed = (f.priority ? 0.85 : 1) * (this.perks.includes('ramp') ? 0.92 : 1);
    const standNow = this.standById.get(f.standId);
    const weatherSlow = this.fx.ramp * (standNow && this.darkAt(standNow.x, standNow.y) ? 1.25 : 1);
    const speedFor = (task) => baseSpeed * weatherSlow * (task.id === 'fuel' && this.projects.hydrant.state === 'done' ? 0.7 : 1);
    let waiting = null;
    for (const task of f.tasks) {
      if (task.state === 'done') continue;
      if (task.state === 'wait') {
        if (!task.after.every((a) => byId.get(a)?.state === 'done')) continue;
        const notBefore = task.board ? f.std - (task.dur + 8 * 60) : task.lead ? f.std - (task.dur + task.lead) : -Infinity;
        if (this.t < notBefore) continue;
        let boardInfo = null;
        if (task.board) {
          boardInfo = this.term.boardingReady(f);
          if (!boardInfo.ok) {
            waiting = boardInfo.reason;
            f.delayCause ??= boardInfo.cause;
            continue;
          }
        }
        // Reuse vehicles kept from an earlier task (e.g. belt loader from unload to load).
        const kept = this.vehicles.filter((v) => v.flightId === f.id && v.keepUntil === task.id && task.spots.includes(v.spot));
        const needed = task.spots.filter((sp) => !kept.some((v) => v.spot === sp));
        const kinds = needed.map((sp) => servicePositions(f.type)[sp].kind);
        const missing = kinds.find((k) => this.#free(k) < kinds.filter((x) => x === k).length);
        if (missing) {
          waiting = `Waiting for ${GSE[missing].label.toLowerCase()}`;
          f.delayCause ??= `${GSE[missing].label} shortage`;
          continue;
        }
        if (boardInfo) {
          this.term.startBoarding(f, boardInfo.board);
          this.#mark(f, 'board');
          task.dur = Math.max(60, boardInfo.board * 3);
        }
        task.state = needed.length ? 'driving' : 'work';
        task.start = this.t;
        for (const v of kept) {
          v.keepUntil = null;
          v.task = task.id;
          task.vehicleIds.push(v.id);
        }
        for (const sp of needed) task.vehicleIds.push(this.#dispatch(f, sp, task).id);
        if (task.state === 'work') task.end = this.t + task.dur * speedFor(task) * (task.board ? itFactor : 1);
      }
      if (task.state === 'driving') {
        const arrived = task.vehicleIds.every((id) => this.vehicles.find((v) => v.id === id)?.state === 'working');
        if (arrived) {
          task.state = 'work';
          task.end = this.t + task.dur * speedFor(task) * (task.board ? itFactor : 1);
        }
      }
      // Lightning within 5 NM: nobody works outdoors. Jet-bridge boarding goes on; bus boarding does not.
      if (task.state === 'work' && this.rampClosed && task.vehicleIds.length) {
        task.end += this.stepDt;
        waiting ??= 'Ramp closed: lightning';
        f.delayCause ??= 'Lightning: ramp closed';
      }
      if (task.state === 'work' && this.t >= task.end) {
        task.state = 'done';
        task.doneAt = this.t;
        for (const v of this.vehicles) {
          if (v.flightId !== f.id || !task.vehicleIds.includes(v.id)) continue;
          if (v.state !== 'working') continue;
          if (task.keepUntil && task.spots.includes(v.spot)) v.keepUntil = task.keepUntil;
          else this.#sendHome(v);
        }
        // Vehicles held for this task's completion (stairs, GPU) leave now.
        for (const v of this.vehicles) if (v.flightId === f.id && v.keepUntil === task.id && !task.spots.includes(v.spot)) this.#sendHome(v);
      }
    }
    f.waiting = waiting;
    if (byId.get('close').state === 'done') this.#requestPushback(f);
  }

  #free(kind) {
    const p = this.pool[kind];
    return p ? p.total - p.busy - p.broken : 0;
  }

  // Staging point (the stand's blue equipment box) in the aircraft's local frame.
  #staging(f) {
    const { L } = dims(f.type);
    const stand = this.standById.get(f.standId);
    return [L / 2 + 4 - 9, (stand.wideCapable ? 34 : 20) - 6];
  }

  #dispatch(f, spotName, task) {
    const spot = servicePositions(f.type)[spotName];
    const from = this.#staging(f);
    const route = routeAround(f.type, from, [spot.x, spot.y]);
    this.pool[spot.kind].busy++;
    const v = {
      id: this.nextVehicleId++, kind: spot.kind, flightId: f.id, spot: spotName, task: task.id,
      pieces: spot.pieces, route, s: 0, state: 'driveIn', keepUntil: null, local: true,
      x: 0, y: 0, heading: spot.h, fade: 0,
    };
    v.routeLen = routeLength(route);
    this.vehicles.push(v);
    return v;
  }

  #freezeAndSendHome(v, f) {
    const c = Math.cos(f.heading);
    const s = Math.sin(f.heading);
    const toWorld = ([x, y]) => [f.x + x * c - y * s, f.y + x * s + y * c];
    const here = v.wx !== undefined ? [v.wx, v.wy] : toWorld(v.route[0]);
    const local = v.state === 'working' ? [...v.route].reverse().slice(1) : [this.#staging(f)];
    v.route = [here, ...local.map(toWorld)];
    v.routeLen = routeLength(v.route);
    v.s = 0;
    v.state = 'driveOut';
    v.free = true;
    v.keepUntil = null;
  }

  #sendHome(v) {
    v.state = 'driveOut';
    v.route = [...v.route].reverse();
    v.routeLen = routeLength(v.route);
    v.s = 0;
    v.keepUntil = null;
  }

  #updateVehicles(dt) {
    for (const v of this.vehicles) {
      const f = this.flights.find((x) => x.id === v.flightId);
      if (!v.free && (v.state === 'driveIn' || v.state === 'driveOut')) {
        v.s = Math.min(v.routeLen, v.s + VEHICLE_SPEED * this.fx.ground * dt);
        if (v.s >= v.routeLen) {
          if (v.state === 'driveIn') v.state = 'working';
          else v.state = 'gone';
        }
      }
      if (v.attached && f) {
        // Push-back tug stays on the nose while pushing.
        const { L } = dims(f.type);
        v.wx = f.x + Math.cos(f.heading) * (L / 2 + 6.4);
        v.wy = f.y + Math.sin(f.heading) * (L / 2 + 6.4);
        v.wh = f.heading + Math.PI;
        continue;
      }
      if (v.free) {
        v.s = Math.min(v.routeLen, v.s + VEHICLE_SPEED * this.fx.ground * dt);
        const p = alongRoute(v.route, v.s);
        [v.wx, v.wy, v.wh] = [p.x, p.y, p.h];
        if (v.s >= v.routeLen) v.state = 'gone';
        continue;
      }
      if (!f) {
        v.state = 'gone';
        continue;
      }
      // Local route -> world pose using the parked aircraft's pose.
      const p = v.state === 'working' ? { x: v.route.at(-1)[0], y: v.route.at(-1)[1], h: v.heading } : alongRoute(v.route, v.s);
      const heading = v.state === 'working' ? servicePositions(f.type)[v.spot].h : p.h;
      const c = Math.cos(f.heading);
      const s = Math.sin(f.heading);
      v.wx = f.x + p.x * c - p.y * s;
      v.wy = f.y + p.x * s + p.y * c;
      v.wh = f.heading + heading;
    }
    for (const v of this.vehicles) if (v.state === 'gone' && this.pool[v.kind]) this.pool[v.kind].busy--;
    this.vehicles = this.vehicles.filter((v) => v.state !== 'gone');
  }

  // Jet bridges: rotunda, where the cab is now, which way it faces and what it is doing.
  jetBridgeSprites() {
    if (this.bridgesDirty) {
      this.bridges = buildJetBridges(this.map, this.stands);
      this.bridgesDirty = false;
    }
    const out = [];
    for (const b of this.bridges) {
      const st = this.standById.get(b.standId);
      if (!st || st.locked) continue;
      const f = st.occupant !== null ? this.flights.find((x) => x.id === st.occupant && x.phase === 'atStand') : null;
      const ext = bridgeExtension(f, b.index, this.t);
      let cab = b.park;
      let heading = b.parkHeading;
      let door = null;
      if (f && ext.e > 0) {
        door = doorAt(st, f.type, b.index, { x: f.x, y: f.y, heading: f.heading });
        const dock = [door.x + door.out[0] * 2.4, door.y + door.out[1] * 2.4];
        const dockH = Math.atan2(-door.out[1], -door.out[0]);
        const k = ext.e * ext.e * (3 - 2 * ext.e);
        cab = [b.park[0] + (dock[0] - b.park[0]) * k, b.park[1] + (dock[1] - b.park[1]) * k];
        let dh = dockH - b.parkHeading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        heading = b.parkHeading + dh * k;
      }
      out.push({ id: b.id, standId: b.standId, index: b.index, rotunda: b.rotunda, cab, heading, e: ext.e, state: ext.state, flightId: f?.id ?? null });
    }
    return out;
  }

  // People on the apron (ramp teams, marshallers, wing walkers, fuellers ...), for drawing.
  staffSprites() {
    return crewSprites(this);
  }

  // State of the jet bridges serving a flight, for the flight card.
  bridgesFor(f) {
    return this.jetBridgeSprites().filter((b) => b.standId === f.standId && (b.index === 0 || AIRCRAFT_TYPES[f.type].code === 'E'));
  }

  // World-space pieces of every visible vehicle (tug + carts trains included), for drawing.
  vehicleSprites() {
    const out = [];
    for (const v of this.vehicles) {
      if (v.wx === undefined) continue;
      const f = this.flights.find((x) => x.id === v.flightId);
      const lead = v.pieces[0];
      for (const piece of v.pieces) {
        // Offsets of trailing pieces relative to the lead, rotated with the vehicle.
        const ox = piece.x - lead.x;
        const oy = piece.y - lead.y;
        const baseH = f && v.state === 'working' && !v.attached ? f.heading + lead.h : v.wh;
        const rel = Math.atan2(oy, ox) - lead.h;
        const dist = Math.hypot(ox, oy);
        const task = f?.tasks?.find((x) => x.id === v.task);
        const work = v.state === 'working' && task?.state === 'work';
        const progress = !task ? 0 : task.state === 'done' ? 1 : work ? Math.max(0, Math.min(1, 1 - (task.end - this.t) / task.dur)) : 0;
        const index = v.pieces.indexOf(piece);
        const carts = v.pieces.length - 1;
        let fill = 0.85;
        if (piece.kind === 'cart' && (v.task === 'unload' || v.task === 'load')) {
          // Unloading fills the carts one after another; loading empties them.
          const k = Math.max(0, Math.min(1, progress * carts - (index - 1)));
          fill = v.task === 'unload' ? k : 1 - k;
        }
        out.push({
          kind: piece.kind, x: v.wx + Math.cos(baseH + rel) * dist, y: v.wy + Math.sin(baseH + rel) * dist, heading: v.wh + (piece.h - lead.h),
          seed: v.id * 7 + out.length, vehicleId: v.id, task: v.task, work, progress, fill,
          flow: work && v.task === 'unload' ? 'down' : work && v.task === 'load' ? 'up' : null,
          wide: f ? AIRCRAFT_TYPES[f.type].code === 'E' : false, moving: v.state === 'driveIn' || v.state === 'driveOut',
        });
      }
    }
    for (const f of this.flights) {
      if (f.phase !== 'atStand' || !f.cones) continue;
      const sp = servicePositions(f.type);
      const c = Math.cos(f.heading);
      const s = Math.sin(f.heading);
      for (const name of ['coneL', 'coneR', 'coneT']) out.push({ kind: 'cone', x: f.x + sp[name].x * c - sp[name].y * s, y: f.y + sp[name].x * s + sp[name].y * c, heading: 0 });
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Departure

  #requestPushback(f) {
    if (this.t < f.std - 60) {
      f.waiting = null;
      return;
    }
    // Gate holding: with the runway closed, aircraft wait on stand (engines off), not in a queue.
    if (this.runwayClosed() || this.closures.some((c) => c.from < this.t + 600 && c.to > this.t)) {
      f.waiting = 'Runway closed: holding at the gate';
      f.delayCause ??= 'Runway closed';
      return;
    }
    // Departure metering: when the taxiway queue to the runway is full, aircraft wait at the gate (engines
    // off) instead of piling up on the taxiways, where they would block arrivals and each other.
    const queued = this.flights.filter((x) => x !== f && DEPARTURE_QUEUE.has(x.phase)).length;
    if (queued >= MAX_DEPARTURE_QUEUE && !f.pushTug) {
      f.waiting = 'Taxiway queue full: holding at the gate';
      f.delayCause ??= 'Departure queue (runway capacity)';
      return;
    }
    let tug = this.vehicles.find((v) => v.flightId === f.id && v.spot === 'pushback');
    if (!tug) {
      if (this.#free('pushback') < 1) {
        f.waiting = 'Waiting for a push-back tug';
        f.delayCause ??= 'Push-back tug shortage';
        return;
      }
      tug = this.#dispatch(f, 'pushback', { id: 'push' });
    }
    if (tug.state !== 'working') {
      f.waiting = 'Push-back tug on its way';
      return;
    }
    // Plan the route out before pushing: lead-in back to the taxilane, then to the runway.
    const link = this.graph.standNode.get(f.standId);
    const entry = this.graph.nodes[link.entry];
    const path = this.#departureRoute(link.entry, link.node);
    if (!path) {
      f.waiting = 'No taxi route to the runway';
      return;
    }
    // Push-back clearance: nobody taxiing close to our taxilane entry.
    // ...and nobody whose next 500 m of route passes our taxilane (as ground control would hold a
    // push-back for an arrival that is about to come down that lane).
    const near = (x, y) => Math.hypot(x - entry.x, y - entry.y) < 85 + AIRCRAFT_TYPES[f.type].length / 2;
    // ...and route-wide: nobody occupying, or cleared along, any corridor of our way out in the
    // other direction (pushing into one would put us nose-to-nose with it).
    const outLegs = this.#legsOf(path);
    const conflict = this.#routeConflict(f, outLegs);
    const busy = conflict !== null || this.flights.some((g) => {
      if (g === f || !GROUND.has(g.phase)) return false;
      if (g.phase === 'pushback' || g.phase === 'turning') {
        const gl = this.graph.standNode.get(g.standId);
        if (gl && this.graph.nodes[gl.entry].edges.some((id) => outLegs.some((l) => l.corr === this.graph.edges[id].corr))) return true;
      }
      if (Math.hypot(g.x - entry.x, g.y - entry.y) < 110 + AIRCRAFT_TYPES[g.type].length) return true;
      if (!g.path || g.phase === 'pushback' || g.phase === 'turning') return false;
      for (let d = 0; d <= 500; d += 15) {
        const q = this.#pointAt(g.path, Math.min(g.limit, g.s + d));
        if (near(q.x, q.y)) return true;
      }
      return false;
    });
    if (busy) {
      f.waiting = 'Waiting for push-back clearance';
      return;
    }
    this.#registerRoute(f, path);
    f.pendingLegs = outLegs;
    f.admitted = true;

    // Off-block.
    f.offBlock = this.t;
    f.waiting = null;
    const stand = this.standById.get(f.standId);
    stand.occupant = null;
    unbook(stand, f.id);
    if (f.crew) {
      this.crews.busy--;
      f.crew = false;
    }
    f.cones = false;
    // Everything else drives back to the equipment box in map coordinates, so it does not move
    // with the aircraft once it starts pushing.
    for (const v of this.vehicles) if (v.flightId === f.id && v !== tug) this.#freezeAndSendHome(v, f);
    tug.attached = true;
    f.pushTug = tug.id;
    this.#planPushback(f, link, path);
    f.phase = 'pushback';
    this.#say(f, false, 'push-back approved, facing the taxiway');
    const hours = (this.t - (f.onBlock ?? this.t)) / 3600;
    if (hours > 2) this.#earn(AIRCRAFT_TYPES[f.type].mtow * PARKING_PER_T_H * (hours - 2) * TARIFFS[this.tariff].mult, 'parking', { airline: f.airline });
  }

  // Push-back path: tail-first back along the lead-in, round the painted lead-in curve onto the
  // taxilane on the side away from where we will taxi, until both gears are on the taxilane.
  #planPushback(f, link, route) {
    const g = this.graph;
    const E = link.entry;
    const S = link.node;
    const nose0 = [f.x + Math.cos(f.heading) * f.gN, f.y + Math.sin(f.heading) * f.gN];
    const e = g.nodes[E];
    f.depRoute = route;
    const n1 = g.nodes[route[1] ?? route[0]];
    const toN1 = unit([n1.x - e.x, n1.y - e.y]);
    let tail = null;
    for (const id of e.edges) {
      const edge = g.edges[id];
      if (edge.kind !== 'taxi') continue;
      const o = edge.a === E ? edge.b : edge.a;
      if (o === route[1]) continue;
      const d = unit([g.nodes[o].x - e.x, g.nodes[o].y - e.y]);
      const dot = d[0] * toN1[0] + d[1] * toN1[1];
      if (dot < -0.3 && (!tail || dot < tail.dot)) tail = { o, dot };
    }
    if (!tail) {
      // No taxilane behind us: straight back along the lead-in to the line, then swing round.
      f.pushFallback = true;
      const back = Math.hypot(e.x - nose0[0], e.y - nose0[1]);
      this.#setPath(f, [nose0, [e.x, e.y]], { startS: f.wb });
      f.limit = Math.max(f.wb, back);
      return;
    }
    f.pushFallback = false;
    // Follow the taxilane far enough for the nose gear to clear the curve.
    const arc = g.filletArc(S, E, tail.o);
    const need = arc.d + f.wb + 12;
    const chain = [E, tail.o];
    let acc = Math.hypot(g.nodes[tail.o].x - e.x, g.nodes[tail.o].y - e.y);
    while (acc < need && chain.length < 12) {
      const cur = g.nodes[chain.at(-1)];
      const prv = g.nodes[chain.at(-2)];
      const dir = unit([cur.x - prv.x, cur.y - prv.y]);
      let next = null;
      for (const id of cur.edges) {
        const edge = g.edges[id];
        if (edge.kind !== 'taxi') continue;
        const o = edge.a === cur.id ? edge.b : edge.a;
        if (chain.includes(o)) continue;
        const d = unit([g.nodes[o].x - cur.x, g.nodes[o].y - cur.y]);
        const dot = d[0] * dir[0] + d[1] * dir[1];
        if (dot > 0.8 && (!next || dot > next.dot)) next = { o, dot };
      }
      if (!next) break;
      chain.push(next.o);
      acc += Math.hypot(g.nodes[next.o].x - cur.x, g.nodes[next.o].y - cur.y);
    }
    const pts = g.smoothRoute(chain, { prev: S, start: [nose0] });
    this.#setPath(f, pts, { startS: f.wb });
    const arcEnd = this.#sOfPoint(f.path, arc.pts.at(-1));
    f.limit = Math.min(f.path.total, arcEnd + 10 + f.wb);
    f.pushChain = chain;
  }

  #startTaxiOut(f) {
    const tug = this.vehicles.find((v) => v.id === f.pushTug);
    if (tug) {
      // Tug unhooks and drives back to the stand's equipment box.
      tug.attached = false;
      tug.free = true;
      tug.state = 'driveOut';
      // Back up the now-empty stand's own lead-in line, then into its equipment box, so the tug
      // never cuts across a neighbouring aircraft.
      const stand = this.standById.get(f.standId);
      const [dx, dy] = stand.dir;
      const leadIn = [stand.x - dx * 25, stand.y - dy * 25];
      const box = [stand.x - dx * 9 - dy * 14, stand.y - dy * 9 + dx * 14];
      tug.route = [[tug.wx, tug.wy], leadIn, box];
      tug.routeLen = routeLength(tug.route);
      tug.s = 0;
    }
    this.#planTaxiOut(f);
    f.phase = 'taxiOut';
    f.speed = 0;
  }

  // From where push-back left us (both gears on the taxilane, facing the way out) along the
  // departure route, round the lead-on curve and onto the runway centreline.
  #planTaxiOut(f) {
    const g = this.graph;
    const L = AIRCRAFT_TYPES[f.type].length;
    let ids = [...f.depRoute];
    let prev = null;
    let start;
    if (f.pushFallback) {
      // The aircraft sits on the line facing its first leg: main gear behind, nose gear ahead.
      const nose = [f.x + Math.cos(f.heading) * f.gN, f.y + Math.sin(f.heading) * f.gN];
      start = [[nose[0] - Math.cos(f.heading) * f.wb, nose[1] - Math.sin(f.heading) * f.wb], nose, ...(f.replanAhead ?? [])];
      prev = f.replanPrev ?? null;
      f.replanPrev = null;
      f.replanAhead = null;
      // After the swing the nose gear is already out along the first leg: start the line at the
      // first turn still ahead of it, instead of driving the nose back to nodes it has passed.
      if (prev === null) {
        const e = g.nodes[ids[0]];
        const reach = Math.hypot(nose[0] - e.x, nose[1] - e.y);
        let sA = 0;
        while (ids.length > 2) {
          const [P, A, B] = ids;
          sA += Math.hypot(g.nodes[A].x - g.nodes[P].x, g.nodes[A].y - g.nodes[P].y);
          if (sA - g.filletArc(P, A, B).d > reach + 0.5) break;
          prev = P;
          ids = ids.slice(1);
        }
      }
    } else {
      const main = this.#pointAt(f.path, f.s);
      const nose = this.#pointAt(f.path, f.s - f.wb);
      // Which chain segment is the nose gear on? Route back through those chain nodes.
      const chain = f.pushChain;
      let k = 0;
      for (let i = 0; i < chain.length - 1; i++) {
        const a = g.nodes[chain[i]];
        const b = g.nodes[chain[i + 1]];
        const t = ((nose.x - a.x) * (b.x - a.x) + (nose.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1);
        if (t >= -0.01 && t <= 1.01) k = i;
      }
      ids = [...chain.slice(1, k + 1).reverse(), ...ids];
      prev = chain[k + 1];
      start = [[main.x, main.y], [nose.x, nose.y]];
    }
    // Two runway nodes beyond the entry so the lead-on curve ends on the centreline.
    const beforeEntry = ids.length >= 2 ? ids[ids.length - 2] : prev;
    const r1 = this.#runwayNeighbour(this.depEntry.node, 1);
    const r2 = r1 !== null ? this.#runwayNeighbour(r1, 1) : null;
    if (r1 !== null) ids.push(r1);
    if (r2 !== null) ids.push(r2);
    const pts = g.smoothRoute(ids, { prev, start });
    f.routeIds = ids;
    this.#setPath(f, pts, { startS: f.wb });
    // Hold-short: the nose stops at the line 90 m from the runway centreline.
    let sHold = f.path.total;
    for (let s = f.path.total; s > 0; s -= 2) {
      const p = this.#pointAt(f.path, s);
      if (this.#offCentre([p.x, p.y]) >= HOLD_SHORT_M) {
        sHold = s;
        break;
      }
    }
    f.holdStop = Math.max(f.wb, sHold - (L / 2 - f.gN) - 2);
    // Line-up ends when the main gear is past the lead-on curve, i.e. lined up.
    let lineEnd = f.path.total;
    if (r1 !== null && beforeEntry !== null && beforeEntry !== undefined) {
      const arc = g.filletArc(beforeEntry, this.depEntry.node, r1);
      lineEnd = this.#sOfPoint(f.path, arc.pts.at(-1)) + f.wb + 4;
    }
    f.lineEnd = Math.min(f.path.total, Math.max(lineEnd, f.holdStop + 1));
    f.limit = f.holdStop;
    f.stops = this.#crossingStops(f.path, 0, f.holdStop);
    this.#planJunctions(f, ids);
    f.admitted = true;
  }

  #tryLineUp(f) {
    const queue = this.flights.filter((g) => g.phase === 'holdShort').sort((a, b) => (b.priority - a.priority) || (a.queuedAt - b.queuedAt));
    if (queue[0] !== f) {
      f.waiting = `Departure queue: number ${queue.indexOf(f) + 1}`;
      return;
    }
    const sep = DEP_SEP[this.lastDeparture.wake] * this.#sepFactor();
    if (this.runwayClosed()) f.waiting = 'Runway closed';
    else if (this.runwayUser !== null) f.waiting = 'Runway occupied';
    else if (this.t - this.lastDeparture.t < sep) f.waiting = 'Wake separation';
    else if (this.#nextArrivalTime() - this.t < 100) f.waiting = 'Arrival on short final';
    else {
      f.waiting = null;
      this.runwayUser = f.id;
      this.#releaseRoute(f);
      f.limit = f.lineEnd;
      f.phase = 'lineUp';
      this.#say(f, false, `runway ${this.active}, line up`);
      return;
    }
    if (this.t - f.queuedAt > 600) f.delayCause ??= 'Runway congestion';
  }

  #takeoff(f, dt) {
    const accel = f.wake === 'H' ? 1.7 : 2.1;
    f.speed = Math.min(f.vRot * 1.35, f.speed + accel * dt);
    f.s += f.speed * dt;
    if (f.speed > f.vRot) f.alt += 9 * dt; // rotate, then climb
    this.#placeOnRunwayLine(f, f.s);
    if (f.alt > 120 && this.runwayUser === f.id) {
      this.runwayUser = null;
      this.lastDeparture = { t: this.t, wake: f.wake };
      this.#departed(f);
    }
    if (f.alt > 1200 || f.s > this.frame.length + 12000) {
      f.phase = 'departed';
      f.doneAt = this.t;
    }
  }

  #departed(f) {
    this.#mark(f, 'airborne');
    this.kpi.departures++;
    const delay = Math.max(0, (f.offBlock ?? this.t) - f.std);
    this.kpi.depDelaySum += delay;
    if (delay <= 15 * 60) this.kpi.onTime++;
    this.#satisfaction(delay <= 15 * 60 ? 0.12 : -Math.min(4, delay / 600));
    this.#earn((f.pax?.board ?? f.paxOut) * UDF[f.intl ? 'intl' : 'dom'] * TARIFFS[this.tariff].mult, 'udf', { airline: f.airline });
    f.depDelay = delay;
    this.#airStat(f.airline, { dep: 1, onTime: delay <= 15 * 60 ? 1 : 0, delay, pax: (f.pax?.board ?? f.paxOut) + f.paxIn });
    if (delay > 900 && f.delayCause) this.dayCauses[f.delayCause] = (this.dayCauses[f.delayCause] ?? 0) + 1;
  }

  // Remembers when a flight reached a milestone, for the flight details.
  #mark(f, key) {
    (f.times ??= {})[key] = this.t;
  }

  #airStat(code, add) {
    const a = (this.airDay[code] ??= { dep: 0, onTime: 0, delay: 0, cancel: 0, divert: 0, pax: 0 });
    for (const [k, v] of Object.entries(add)) a[k] += v;
  }

  #divert(f, reason) {
    f.phase = 'diverted';
    f.doneAt = this.t;
    f.waiting = reason;
    this.#releaseSlot(f);
    if (f.standId !== null) unbook(this.standById.get(f.standId), f.id);
    this.kpi.diversions++;
    this.#airStat(f.airline, { divert: 1 });
    this.#satisfaction(-3);
    this.note('critical', `${f.arrNo} from ${f.from} diverted to Bengaluru: ${reason}.`, { flight: f.id });
  }

  // ---------------------------------------------------------------------------------------------
  // Events

  #runEvents(dt) {
    for (const e of this.events) {
      if (e.done || this.t < e.time) continue;
      e.done = true;
      this.#apply(e);
    }
    for (const r of RANDOM_EVENTS) {
      if (r.night && !(this.lights?.amb < 0.3)) continue;
      if (this.rnd() < ((r.perHour * (r.type === 'gseBreakdown' && this.perks.includes('gse') ? 0.5 : 1)) / 3600) * dt) this.#apply({ ...r, random: true });
    }
  }

  #apply(e) {
    switch (e.type) {
      case 'notice':
        this.note('info', e.text);
        break;
      case 'wind':
        this.windBase = { from: e.from, kt: e.kt };
        this.wind = this.weather.windFor(this.t, this.windBase);
        this.note('warn', e.text);
        this.#checkWind();
        break;
      case 'lowVis':
        this.mods.lowVisUntil = this.t + e.minutes * 60;
        this.note('warn', e.text);
        this.#reslotAll();
        break;
      case 'runwayClosed':
      case 'birdStrike':
        this.closeRunway(e.minutes, e.text);
        break;
      case 'apronFault': {
        // Part of the apron goes dark: pick a stand and everything within 260 m of it.
        const open = this.stands.filter((x) => !x.locked);
        const st = open[Math.floor(this.rnd() * open.length)];
        this.lighting.dark = { x: st.x, y: st.y, r: 260, until: this.t + e.minutes * 60 };
        this.events.push({ type: 'lightRepair', time: this.lighting.dark.until, done: false });
        this.note('warn', `${e.text} (around stand ${st.ref})`);
        break;
      }
      case 'lightRepair':
        this.lighting.dark = null;
        this.note('info', 'Apron lighting repaired.');
        break;
      case 'rwyLightFault':
        this.lighting.rwyFaultUntil = this.t + e.minutes * 60;
        this.closeRunway(e.minutes, e.text);
        break;
      case 'securityAlert':
        this.mods.secUntil = this.t + e.minutes * 60;
        this.note('warn', e.text, { terminal: 'T1' });
        break;
      case 'itOutage':
        this.mods.itUntil = this.t + e.minutes * 60;
        this.mods.itFactor = e.factor;
        this.note('warn', e.text);
        break;
      case 'cancelWave': {
        let n = 0;
        for (const f of this.flights) {
          if (f.phase === 'scheduled' && f.eta < this.t + 4 * 3600 && this.rnd() < e.share) {
            f.phase = 'cancelled';
            f.doneAt = this.t;
            this.kpi.cancellations++;
            this.#airStat(f.airline, { cancel: 1 });
            n++;
          }
        }
        this.#satisfaction(-n * 0.3);
        this.note('critical', `${e.text} (${n} rotations cancelled)`);
        break;
      }
      case 'gseBreakdown': {
        const kinds = Object.keys(this.pool).filter((k) => this.pool[k].total - this.pool[k].broken > 1);
        const kind = kinds[Math.floor(this.rnd() * kinds.length)];
        this.pool[kind].broken++;
        this.events.push({ type: 'gseRepair', kind, time: this.t + e.minutes * 60, done: false });
        this.note('warn', `${e.text} (${GSE[kind].label.toLowerCase()})`);
        break;
      }
      case 'gseRepair':
        this.pool[e.kind].broken = Math.max(0, this.pool[e.kind].broken - 1);
        this.note('info', `${GSE[e.kind].label}: vehicle back in service.`);
        break;
      case 'medical': {
        const f = this.flights.find((x) => x.phase === 'inbound' && x.slot - this.t > 240);
        if (!f) break;
        f.priority = true;
        this.#bookSlot(f, this.t + 200);
        this.note('warn', `${e.text} ${f.arrNo} moved to the front of the arrival sequence.`, { flight: f.id });
        break;
      }
      default:
        break;
    }
  }

  #checkWind() {
    const { head, cross } = this.windComponents();
    if (head < -8) this.note('warn', `Tailwind ${Math.round(-head)} kt on runway ${this.active}: consider switching the runway direction.`, { runway: true });
    if (cross > 25) this.note('warn', `Crosswind ${Math.round(cross)} kt on runway ${this.active}: above limits for most aircraft.`, { runway: true });
  }

  #reslotAll() {
    const inbound = this.flights.filter((f) => f.phase === 'inbound').sort((a, b) => a.slot - b.slot);
    for (const f of inbound) this.#releaseSlot(f);
    for (const f of inbound) {
      this.#bookSlot(f, Math.max(f.eta, this.t + 4 * 60));
      if (f.slot - f.eta > 50 * 60) this.#divert(f, this.runwayClosed(f.slot - 3600) ? 'Runway closed' : 'Arrival queue too long');
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Money and reputation

  #earn(amount, cat = 'other', meta = null) {
    this.money += amount;
    this.kpi.revenue += amount;
    this.ledger.add('in', cat, amount, this.t, meta);
  }

  #spend(amount, cat = 'other', meta = null) {
    this.money -= amount;
    this.kpi.costs += amount;
    this.ledger.add('out', cat, amount, this.t, meta);
  }

  #costs(dt) {
    const vehicles = Object.values(this.pool).reduce((s, p) => s + p.total, 0);
    const k = dt / 86400;
    this.#spend(FIXED_OPEX_PER_DAY * k, 'fixed');
    this.#spend(this.term.dailyStaffCost() * k, 'staff');
    this.#spend(this.crews.total * CREW.dayCost * this.term.wageMul() * k, 'crews');
    this.#spend(vehicles * VEHICLE_DAY_COST * k, 'vehicles');
    this.#spend((this.lightingCostPerHour() / 3600) * dt, 'power');
    const sat = TARIFFS[this.tariff].satPerHour;
    if (sat) this.#satisfaction((sat * dt) / 3600);
  }

  #satisfaction(delta) {
    this.kpi.satisfaction = Math.max(0, Math.min(100, this.kpi.satisfaction + delta));
  }

  note(level, text, target = null) {
    this.log.unshift({ t: this.t, level, text, target });
    if (this.log.length > 80) this.log.pop();
  }

  // ---------------------------------------------------------------------------------------------
  // Player actions (each returns { ok, message })

  assignStand(flightId, standId) {
    const f = this.flights.find((x) => x.id === flightId);
    const stand = this.standById.get(standId);
    if (!f || !stand) return { ok: false, message: 'Not found' };
    if (!['scheduled', 'holding', 'inbound', 'final'].includes(f.phase)) return { ok: false, message: 'Stand can only be changed before landing' };
    const from = f.eta - 300;
    const to = Math.max(f.std + 1800, f.eta + AIRCRAFT_TYPES[f.type].turnMin * 60 + 1500);
    const why = standBlocker(stand, f.type, from, to, f.id);
    if (why) return { ok: false, message: why };
    this.#assign(f, stand, from, to);
    if (f.phase === 'holding') this.#tryInbound(f);
    return { ok: true, message: `${f.arrNo} will use stand ${stand.ref}` };
  }

  prioritise(flightId) {
    const f = this.flights.find((x) => x.id === flightId);
    if (!f || f.priority) return { ok: false, message: 'Already prioritised' };
    if (this.money < 5e4) return { ok: false, message: 'Not enough money' };
    this.#spend(5e4, 'priority', { label: `Priority handling for ${f.depNo}` });
    f.priority = true;
    return { ok: true, message: `${f.depNo} prioritised: extra hands on the turnaround, first in the departure queue (₹50,000)` };
  }

  cancelFlight(flightId) {
    const f = this.flights.find((x) => x.id === flightId);
    if (!f || !['scheduled', 'holding', 'inbound'].includes(f.phase)) return { ok: false, message: 'Can only cancel flights that have not reached final approach' };
    this.#releaseSlot(f);
    if (f.standId !== null) unbook(this.standById.get(f.standId), f.id);
    f.phase = 'cancelled';
    f.doneAt = this.t;
    this.kpi.cancellations++;
    this.#airStat(f.airline, { cancel: 1 });
    this.#satisfaction(-1.5);
    return { ok: true, message: `${f.arrNo} / ${f.depNo} cancelled` };
  }

  toggleStand(standId) {
    const s = this.standById.get(standId);
    if (!s) return { ok: false, message: 'Not found' };
    if (s.locked) return { ok: false, message: 'Not built yet: complete the Terminal 3 project' };
    if (!s.closed && s.occupant !== null) return { ok: false, message: 'An aircraft is parked there' };
    s.closed = !s.closed;
    if (s.closed) {
      // Flights booked here look for another stand.
      for (const b of [...s.bookings]) {
        const f = this.flights.find((x) => x.id === b.flightId);
        unbook(s, b.flightId);
        if (f && ['scheduled', 'holding', 'inbound', 'final'].includes(f.phase)) {
          f.standId = null;
          const alt = chooseStand(this.stands, f, f.eta - 300, Math.max(f.std + 1800, f.eta + 3600));
          if (alt) this.#assign(f, alt, f.eta - 300, Math.max(f.std + 1800, f.eta + 3600));
          else if (f.phase !== 'scheduled') {
            f.phase = 'holding';
            f.holdingSince = this.t;
            this.#releaseSlot(f);
          }
        }
      }
    }
    return { ok: true, message: `Stand ${s.ref} ${s.closed ? 'closed' : 'reopened'}` };
  }

  closeRunway(minutes, reason = 'Runway inspection') {
    this.closures.push({ from: this.t, to: this.t + minutes * 60, reason });
    this.note('critical', `${reason} (${minutes} min).`, { runway: true });
    for (const f of this.flights) if (f.phase === 'final' && f.slot - this.t < minutes * 60 + 60) this.#goAround(f, 'Runway closed');
    this.#reslotAll();
    return { ok: true, message: `Runway closed for ${minutes} min` };
  }

  reopenRunway() {
    if (!this.closures.length) return { ok: false, message: 'Runway is open' };
    this.closures = [];
    this.note('info', 'Runway reopened.', { runway: true });
    this.#reslotAll();
    return { ok: true, message: 'Runway reopened' };
  }

  switchRunway() {
    if (this.runwayUser !== null) return { ok: false, message: 'Runway in use: try again in a moment' };
    if (this.flights.some((f) => ['lineUp', 'takeoff', 'landing'].includes(f.phase))) return { ok: false, message: 'Runway in use' };
    this.active = Object.keys(this.frame.ends).find((d) => d !== this.active);
    this.#setupRunway();
    for (const f of this.flights) if (f.phase === 'final') this.#goAround(f, 'Runway direction change');
    this.#reslotAll();
    // Departures already taxiing re-plan from where they are.
    for (const f of this.flights.filter((x) => ['taxiOut', 'holdShort'].includes(x.phase))) this.#replanDeparture(f);
    const { head, cross } = this.windComponents();
    this.note('info', `Runway ${this.active} in use (headwind ${Math.round(head)} kt, crosswind ${Math.round(cross)} kt).`, { runway: true });
    return { ok: true, message: `Runway ${this.active} now active` };
  }

  // Route from `from` (facing away from `prev`) to the departure entry, checked all the way onto
  // the runway: the search goes one runway node further so the line-up turn is a legal one too.
  #departureRoute(from, prev) {
    const r1 = this.#runwayNeighbour(this.depEntry.node, 1);
    if (r1 !== null) {
      const path = this.graph.findPath(from, r1, { ...this.#routeOptions(), prev });
      if (path && path.at(-2) === this.depEntry.node) return path.slice(0, -1);
    }
    return this.graph.findPath(from, this.depEntry.node, { ...this.#routeOptions(), prev });
  }

  // After a runway direction change: re-route from where the aircraft is, along the lines.
  #replanDeparture(f) {
    const nose = [f.x + Math.cos(f.heading) * f.gN, f.y + Math.sin(f.heading) * f.gN];
    const start = this.graph.nearestNode(nose[0], nose[1], (n) => n.edges.some((id) => this.graph.edges[id].kind === 'taxi'));
    const path = this.#departureRoute(start.id, null);
    if (!path) return;
    this.#registerRoute(f, path);
    f.depRoute = path;
    f.pushFallback = true; // start from the aircraft's current gear positions
    this.#planTaxiOut(f);
    f.phase = 'taxiOut';
  }

  buyVehicles(kind, n) {
    const g = GSE[kind];
    if (!g) return { ok: false, message: 'Unknown vehicle' };
    const cost = g.price * n;
    if (this.money < cost) return { ok: false, message: 'Not enough money' };
    this.#spend(cost, 'equipment', { label: `Bought ${n} × ${g.label.toLowerCase()}` });
    this.pool[kind].total += n;
    return { ok: true, message: `Bought ${n} × ${g.label.toLowerCase()} (${formatINR(cost)})` };
  }

  sellVehicles(kind, n) {
    const p = this.pool[kind];
    const free = p.total - p.busy - p.broken;
    const k = Math.min(n, free);
    if (k <= 0) return { ok: false, message: 'None free to sell' };
    p.total -= k;
    this.#earn(GSE[kind].price * k * 0.5, 'sales', { label: `Sold ${k} × ${GSE[kind].label.toLowerCase()}` });
    return { ok: true, message: `Sold ${k} × ${GSE[kind].label.toLowerCase()} at half price` };
  }

  hireCrews(n) {
    const cost = CREW.hireCost * n;
    if (n > 0 && this.money < cost) return { ok: false, message: 'Not enough money' };
    if (n < 0 && this.crews.total + n < this.crews.busy) return { ok: false, message: 'Crews are busy' };
    if (n > 0) this.#spend(cost, 'hiring', { label: `Hired ${n} ramp crews` });
    this.crews.total += n;
    return { ok: true, message: n > 0 ? `Hired ${n} ramp crews (${formatINR(cost)})` : `Released ${-n} ramp crews` };
  }

  // ---------------------------------------------------------------------------------------------
  // Queries for the UI and renderer


  // ---------------------------------------------------------------------------------------------
  // Public helpers used by the terminal system, the UI and the live layer

  // Spacing multiplier now in force (rapid exits tighten it, low visibility widens it).
  get sepScale() {
    return this.#sepFactor();
  }

  // Radio call text: "IFLY one two three four, runway two five, cleared to land".
  #say(f, arriving, text) {
    if (!this.radioOn || this.radio.length > 6) return;
    const num = (arriving ? f.arrNo : f.depNo).split(' ')[1] ?? '';
    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
    const spell = (str) => str.replace(/\d/g, (d) => ` ${words[Number(d)]}`).replace(/\s+/g, ' ').trim();
    this.radio.push(`${f.callsign.toLowerCase()} ${spell(num)}, ${spell(text)}`);
  }

  income(amount, cat = 'other', meta = null) {
    this.#earn(amount, cat, meta);
  }

  pay(amount, cat = 'other', meta = null) {
    this.#spend(amount, cat, meta);
  }

  // Airport charges: discount / standard / premium.
  setTariff(id) {
    if (!TARIFFS[id]) return { ok: false, message: 'Unknown tariff' };
    this.tariff = id;
    return { ok: true, message: `Airport charges: ${TARIFFS[id].label} (${TARIFFS[id].text})` };
  }

  nudgeSatisfaction(delta) {
    this.#satisfaction(delta);
  }

  // Overall satisfaction: half flight punctuality and handling, half passenger queues.
  satisfaction() {
    const open = Object.values(this.term.list).filter((T) => T.open);
    const q = open.length ? open.reduce((s, T) => s + T.score, 0) / open.length : 100;
    return 0.5 * this.kpi.satisfaction + 0.5 * q;
  }

  // Every 20 seconds: wind, daylight, airfield lights, lightning rules, warnings and the day's weather log.
  #environment(silent = false) {
    const w = this.weather.now;
    const prev = this.lights;
    this.wind = this.weather.windFor(this.t, this.windBase);

    // Daylight: the sun, dimmed by cloud, rain and storm.
    const sun = sunAt(this.clockEpoch + this.t);
    const amb = Math.max(0.04, daylight(sun.el) * (1 - 0.35 * w.cloud - 0.25 * w.rain - 0.2 * w.storm));
    const L = this.lighting;
    const vis = this.visibility();
    const apron = L.apron === 'on' || (L.apron === 'auto' && amb < (prev?.apron ? 0.6 : 0.45));
    const taxi = apron || amb < 0.55 || vis < 2000;
    let step = 0;
    if (vis < 550) step = 5;
    else if (vis < 1200) step = 4;
    else if (amb < 0.3) step = w.rain > 0.3 ? 4 : 3;
    else if (amb < 0.6 || vis < 5000 || w.rain > 0.3) step = 2;
    if (typeof L.runway === 'number') step = Math.max(L.runway, amb < 0.3 || vis < 5000 ? 2 : 0);
    if (this.t < L.rwyFaultUntil) step = 0;
    this.lights = { amb, sunEl: sun.el, sunAz: sun.az, phase: dayPhase(sun.el, this.t), apron, taxi, terminal: amb < 0.6, rwyStep: step, night: amb < 0.3 };
    if (L.dark && this.t >= L.dark.until) L.dark = null;

    // Lightning: nobody works outdoors until ten minutes after the last strike.
    if (w.lightning) this.rampClosedUntil = this.t + 600;
    const closed = this.t < this.rampClosedUntil;
    if (closed !== this.rampClosed) {
      this.rampClosed = closed;
      if (!silent) this.note(closed ? 'warn' : 'info', closed ? 'Lightning within 5 NM: outdoor ramp work stopped (jet-bridge boarding continues).' : 'Lightning has passed: ramp work resumes.');
    }

    // What the weather and the light do to the work on the ground.
    const unlit = amb < 0.3 && !apron;
    this.fx = {
      ground: Math.max(0.55, 1 - 0.22 * w.rain - (vis < 800 ? 0.1 : 0) - (amb < 0.3 && !taxi ? 0.15 : 0)),
      ramp: 1 + 0.18 * w.rain + (unlit ? 0.3 : 0) + (this.wind.kt > 25 ? 0.1 : 0),
    };

    if (!silent) {
      if (prev && apron !== prev.apron) this.note('info', apron ? 'Light is fading: apron floodlights on.' : 'Daylight: apron floodlights off.');
      const low = vis < 1200;
      if (low !== this.lowVisNow) {
        this.lowVisNow = low;
        if (low) {
          this.note('warn', `Visibility ${Math.round(vis / 50) * 50} m: low-visibility procedures, landing spacing ${this.projects.cat3.state === 'done' ? '×1.3' : '×2'}.`);
        } else this.note('info', 'Visibility improving: normal spacing again.');
        this.#reslotAll();
      }
      // Warn about a thunderstorm half an hour ahead.
      const storm = this.weather.nextOf(this.t, ['storm'], 0.6);
      if (storm && this.stormWarned !== storm.t) {
        this.stormWarned = storm.t;
        this.note('warn', `Thunderstorm expected around ${hhmmText(storm.t)}: lightning will stop outdoor ramp work.`);
      }
      // Wind limits, at most every half hour.
      const { head, cross } = this.windComponents();
      if ((cross > 25 || head < -8) && this.t > this.windWarnUntil) {
        this.windWarnUntil = this.t + 1800;
        this.#checkWind();
      }
      if (cross > 33 && !this.runwayClosed() && this.t > this.xwindCool) {
        this.xwindCool = this.t + 1800;
        this.closeRunway(25, `Crosswind ${Math.round(cross)} kt: beyond limits, runway closed until it eases.`);
      }
    }
    this.lowVisNow = vis < 1200;

    // The day's weather log, for the report card.
    const d = this.dayWx;
    if (w.rain > 0.1) d.rain += 20;
    if (w.lightning) d.storm += 20;
    if (vis < 1200) d.lowVis += 20;
    if (this.rampClosed) d.ramp += 20;
    d.minVis = Math.min(d.minVis, Math.round(vis));
    d.maxT = Math.max(d.maxT, w.tempC);
    d.minT = Math.min(d.minT, w.tempC);
    d.maxWind = Math.max(d.maxWind, this.wind.gust ?? this.wind.kt);
  }

  // Is this point in the part of the apron that is dark because of a lighting fault?
  darkAt(x, y) {
    const d = this.lighting.dark;
    return Boolean(d) && this.t < d.until && Math.hypot(x - d.x, y - d.y) < d.r;
  }

  // Electricity for the airfield lights, rupees per hour.
  lightingCostPerHour() {
    const l = this.lights;
    if (!l) return 0;
    return (l.apron ? 3500 : 0) + (l.taxi ? 1500 : 0) + (l.terminal ? 2500 : 0) + l.rwyStep * 1500;
  }

  // Manual control of the lights: apron 'auto' | 'on' | 'off'; runway 'auto' or intensity step 1-5.
  setLighting(kind, value) {
    if (kind === 'apron' && ['auto', 'on', 'off'].includes(value)) this.lighting.apron = value;
    else if (kind === 'runway' && (value === 'auto' || (Number(value) >= 0 && Number(value) <= 5))) this.lighting.runway = value === 'auto' ? 'auto' : Number(value);
    else return { ok: false, message: 'Unknown lighting setting' };
    this.#environment(true);
    const note = kind === 'runway' && typeof this.lighting.runway === 'number' && this.lights.rwyStep > this.lighting.runway ? ' (raised to the minimum safe setting)' : '';
    return { ok: true, message: `${kind === 'apron' ? 'Apron lights' : 'Runway lights'}: ${value}${note}` };
  }

  setWeatherMode(mode) {
    if (!['random', 'calm'].includes(mode)) return { ok: false, message: 'Unknown weather mode' };
    this.weatherMode = mode;
    this.weather.setMode(mode, this.t);
    this.weather.update(this.t, 0);
    this.#environment(true);
    return { ok: true, message: mode === 'calm' ? 'Calm weather: no rain, fog or storms from now on' : 'Random weather: the seasons decide' };
  }

  // The sun now, for drawing.
  sun() {
    return sunAt(this.clockEpoch + this.t);
  }

  // Real or scripted wind: sets it, warns about limits, optionally lets the runway follow.
  setWind(from, kt) {
    this.windBase = { from: ((Math.round(from) % 360) + 360) % 360, kt: Math.max(0, Math.round(kt)) };
    this.wind = this.weather.windFor(this.t, this.windBase);
    this.#checkWind();
    this.#autoRunwayTick(true);
  }

  setAutoRunway(on) {
    this.autoRunway = Boolean(on);
    if (on) this.#autoRunwayTick(true);
    return { ok: true, message: on ? 'Runway direction now follows the wind' : 'Runway direction is manual' };
  }

  #autoRunwayTick(force = false) {
    if (!this.autoRunway || (!force && this.t < (this.nextAuto ?? 0))) return;
    this.nextAuto = this.t + 60;
    const best = this.#bestRunway();
    if (best === this.active || this.t - this.lastRunwayChange < 30 * 60) return;
    // Hysteresis: only change for a clear gain (4 kt more headwind).
    if (this.windComponents(best).head - this.windComponents(this.active).head < 4) return;
    if (this.switchRunway().ok) this.lastRunwayChange = this.t;
  }

  // ---- projects (career) ----------------------------------------------------------------------

  startProject(id) {
    const P = PROJECTS[id];
    const st = this.projects[id];
    if (!P || st.state !== 'idle') return { ok: false, message: 'Already started' };
    const missing = P.needs.find((n) => this.projects[n].state !== 'done');
    if (missing) return { ok: false, message: `Needs ${PROJECTS[missing].name} first` };
    if (this.money < P.cost) return { ok: false, message: 'Not enough money' };
    this.#spend(P.cost, 'projects', { label: `Project started: ${P.name}` });
    Object.assign(st, { state: 'building', startedAt: this.t, finishAt: this.t + P.hours * 3600 });
    this.note('info', `${P.name} started: ready in ${P.hours} hours.`);
    return { ok: true, message: `${P.name} started (${P.hours} h)` };
  }

  #projectsTick() {
    for (const [id, st] of Object.entries(this.projects)) {
      if (st.state === 'building' && this.t >= st.finishAt) {
        st.state = 'done';
        this.#finishProject(id);
      }
    }
  }

  #finishProject(id) {
    this.note('info', `${PROJECTS[id].name} complete: ${PROJECTS[id].effect}.`);
    if (id === 'hydrant') this.pool.fuel.total += 6;
    if (id === 't3') {
      this.term.unlock('T3');
      this.#openT3Stands();
    }
    if (id === 't5') this.term.unlock('T5');
  }

  // Terminal 3's frontage stands (created at start, locked): open them with 22 m jet bridges.
  #openT3Stands() {
    const site = this.map.zones.find((z) => z.kind === 'construction');
    const mine = this.stands.filter((s) => s.locked === 't3');
    for (const s of mine) {
      s.closed = false;
      s.locked = null;
      s.kind = 'mixed';
      s.contact = true;
      const e = closestOnPolyline([s.x, s.y], site.polygon);
      s.bridge = [e.x, e.y];
    }
    this.bridges = buildJetBridges(this.map, this.stands);
    this.note('info', `${mine.length} new stands with jet bridges open at Terminal 3.`);
  }

  // Candidate stands along the Terminal 3 site's apron-side frontage: 26 m from the building, 62 m
  // apart, skipping spots that coincide with existing stands.
  #t3Stands(map, existing) {
    const site = map.zones.find((z) => z.kind === 'construction');
    if (!site) return [];
    const poly = site.polygon.slice(0, -1);
    const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
    const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    let best = null;
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 90) return;
      const mx = (p[0] + q[0]) / 2;
      const my = (p[1] + q[1]) / 2;
      let nx = -(q[1] - p[1]) / len;
      let ny = (q[0] - p[0]) / len;
      if ((mx + nx * 5 - cx) * nx + (my + ny * 5 - cy) * ny < 0) [nx, ny] = [-nx, -ny];
      let near = Infinity;
      for (const t of map.taxiways) near = Math.min(near, closestOnPolyline([mx + nx * 70, my + ny * 70], t.points).dist);
      if (!best || near < best.near) best = { p, q, len, nx, ny, near };
    });
    if (!best) return [];
    const out = [];
    const ux = (best.q[0] - best.p[0]) / best.len;
    const uy = (best.q[1] - best.p[1]) / best.len;
    for (let d = 35; d <= best.len - 35 && out.length < 8; d += 62) {
      const x = best.p[0] + ux * d + best.nx * 26;
      const y = best.p[1] + uy * d + best.ny * 26;
      if (existing.some((s) => Math.hypot(s.x - x, s.y - y) < 48)) continue;
      out.push({ id: 9000 + out.length, ref: `T3-${out.length + 1}`, x, y, dir: [-best.nx, -best.ny], contact: true, t3: true });
    }
    return out;
  }

  // ---- day report card ------------------------------------------------------------------------

  #dayCheck() {
    const day = Math.floor(this.t / 86400);
    if (day > this.dayIndex) {
      this.dayIndex = day;
      this.#closeDay();
    }
  }

  #closeDay() {
    const k = this.kpi;
    const b = this.dayBase;
    const d = this.term.freshDay();
    const deps = k.departures - b.departures;
    const avg = (key) => (d.waitN[key] ? d.waitSum[key] / d.waitN[key] : 0);
    const date = new Date(this.daySeedDate() + (this.dayIndex - 1) * 86400e3);
    const report = {
      day: this.dayIndex,
      date: date.toISOString().slice(0, 10),
      scenario: this.scenario.name,
      arrivals: k.arrivals - b.arrivals,
      departures: deps,
      otp: deps ? (k.onTime - b.onTime) / deps : 1,
      avgDelayMin: deps ? (k.depDelaySum - b.depDelaySum) / deps / 60 : 0,
      diversions: k.diversions - b.diversions,
      cancellations: k.cancellations - b.cancellations,
      goArounds: k.goArounds - b.goArounds,
      missedPax: Math.round(d.missed),
      paxOut: Math.round(d.paxOut),
      paxIn: Math.round(d.paxIn),
      waits: { checkin: avg('checkin'), security: avg('security'), immigration: avg('immigration'), arrImm: avg('arrImm'), reclaim: avg('reclaim') },
      revenue: k.revenue - b.revenue,
      costs: k.costs - b.costs,
      retail: d.retail,
      satisfaction: this.satisfaction(),
      causes: Object.entries(this.dayCauses).sort((x, y) => y[1] - x[1]).slice(0, 4),
      finance: this.ledger.closeDay(),
      tariff: this.tariff,
      weather: { ...this.dayWx, season: this.weather.month, mode: this.weatherMode },
      airlines: Object.entries(this.airDay).map(([code, a]) => ({ code, ...a })).sort((x, y) => y.dep - x.dep),
      offer: this.#offerPerks(),
    };
    report.profit = report.revenue - report.costs;
    this.pendingReport = report;
    this.reports.push({ ...report, offer: null });
    if (this.reports.length > 14) this.reports.shift();
    this.dayBase = { ...k };
    this.dayCauses = {};
    this.airDay = {};
    this.dayWx = freshDayWx();
    this.note('info', `Day ${report.day} report is ready.`);
  }

  daySeedDate() {
    const s = String(this.daySeed);
    return Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  }

  #offerPerks() {
    const pool = Object.keys(PERKS).filter((id) => !this.perks.includes(id));
    const offer = [];
    while (offer.length < 3 && pool.length) offer.push(pool.splice(Math.floor(this.rnd() * pool.length), 1)[0]);
    return offer;
  }

  acknowledgeReport(perkId) {
    const r = this.pendingReport;
    if (!r) return { ok: false, message: 'No report' };
    if (perkId && r.offer.includes(perkId) && !this.perks.includes(perkId)) {
      this.perks.push(perkId);
      this.note('info', `Policy adopted: ${PERKS[perkId].label} (${PERKS[perkId].text}).`);
    }
    this.pendingReport = null;
    return { ok: true, message: perkId ? `${PERKS[perkId].label} adopted` : 'Report closed' };
  }

  // ---- save / load ----------------------------------------------------------------------------

  snapshot() {
    const stands = this.stands.map((s) => ({ id: s.id, locked: s.locked ?? null, closed: s.closed, occupant: s.occupant, bookings: s.bookings, contact: s.contact, kind: s.kind, bridge: s.bridge ?? null }));
    return structuredClone({
      v: 1, scenarioId: this.scenarioId, daySeed: this.daySeed, t0: this.t0, t: this.t, rng: this.rnd.getState(),
      wind: this.wind, active: this.active, closures: this.closures, arrSlots: this.arrSlots,
      edgeUse: [...this.edgeUse].map(([k, m]) => [k, [...m]]), runwayUser: this.runwayUser, lastDeparture: this.lastDeparture,
      mods: this.mods, pool: this.pool, crews: this.crews, money: this.money, vehicles: this.vehicles, nextVehicleId: this.nextVehicleId,
      log: this.log, kpi: this.kpi, events: this.events, flights: this.flights, days: [...this.days], stands,
      term: this.term.snapshot(), perks: this.perks, projects: this.projects, dayIndex: this.dayIndex, dayBase: this.dayBase,
      dayCauses: this.dayCauses, airDay: this.airDay, dayWx: this.dayWx, ledger: this.ledger.snapshot(), tariff: this.tariff, weather: this.weather.snapshot(), windBase: this.windBase, weatherMode: this.weatherMode, lighting: this.lighting, rampClosedUntil: this.rampClosedUntil, pendingReport: this.pendingReport, reports: this.reports,
      autoRunway: this.autoRunway, liveWeather: this.liveWeather, lastRunwayChange: this.lastRunwayChange, trafficBoost: this.trafficBoost,
    });
  }

  restore(snap) {
    const s = structuredClone(snap);
    if (s.v !== 1) throw new Error('Unsupported save version');
    Object.assign(this, {
      daySeed: s.daySeed, t0: s.t0, t: s.t, wind: s.wind, active: s.active, closures: s.closures, arrSlots: s.arrSlots,
      runwayUser: s.runwayUser, lastDeparture: s.lastDeparture, mods: s.mods, pool: s.pool, crews: s.crews, money: s.money,
      vehicles: s.vehicles, nextVehicleId: s.nextVehicleId, log: s.log, kpi: s.kpi, events: s.events, flights: s.flights,
      days: new Set(s.days), perks: s.perks, projects: s.projects, dayIndex: s.dayIndex, dayBase: s.dayBase,
      dayCauses: s.dayCauses, airDay: s.airDay ?? {}, dayWx: s.dayWx ?? freshDayWx(), ledger: Ledger.restore(s.ledger), tariff: s.tariff ?? 'standard', windBase: s.windBase ?? s.wind, weatherMode: s.weatherMode ?? 'random', lighting: s.lighting ?? { apron: 'auto', runway: 'auto', dark: null, rwyFaultUntil: -1 }, rampClosedUntil: s.rampClosedUntil ?? -1, pendingReport: s.pendingReport, reports: s.reports, autoRunway: s.autoRunway,
      liveWeather: s.liveWeather, lastRunwayChange: s.lastRunwayChange,
      trafficBoost: s.trafficBoost ?? 0, // saves from before the Traffic option keep their original level
    });
    if (s.weather) this.weather = Weather.restore(s.weather);
    this.weather.update(this.t, 0);
    this.nextEnv = 0;
    this.#environment(true);
    this.edgeUse = new Map(s.edgeUse.map(([k, m]) => [k, new Map(m)]));
    this.rnd.setState(s.rng);
    this.#setupRunway();
    for (const st of s.stands) {
      const stand = this.standById.get(st.id);
      if (!stand) continue;
      stand.locked = st.locked ?? null;
      stand.closed = st.closed;
      stand.occupant = st.occupant;
      stand.bookings = st.bookings;
      stand.contact = st.contact;
      stand.kind = st.kind;
      if (st.bridge) stand.bridge = st.bridge;
      else delete stand.bridge;
      this.bridgesDirty = true;
    }
    this.term.restore(s.term);
    return this;
  }

  visibleFlights() {
    return this.flights.filter((f) => VISIBLE.has(f.phase));
  }

  board() {
    const live = this.flights.filter((f) => !['cancelled'].includes(f.phase) || this.t - f.doneAt < 3600);
    const arrivals = live.filter((f) => ['scheduled', 'holding', 'inbound', 'final', 'goAround', 'landing', 'taxiIn'].includes(f.phase) || (f.onBlock && this.t - f.onBlock < 900) || ['diverted', 'cancelled'].includes(f.phase))
      .sort((a, b) => a.sta - b.sta).slice(0, 14);
    const departures = live.filter((f) => ['atStand', 'pushback', 'turning', 'taxiOut', 'holdShort', 'lineUp', 'takeoff'].includes(f.phase) || (f.phase === 'departed' && this.t - f.doneAt < 600))
      .sort((a, b) => a.std - b.std).slice(0, 14);
    return { arrivals, departures };
  }

  objectives() {
    const o = this.scenario.objectives;
    if (!o) return null;
    const otp = this.kpi.departures ? this.kpi.onTime / this.kpi.departures : 1;
    const list = [
      { label: `On-time departures ≥ ${Math.round(o.otp * 100)} %`, value: `${Math.round(otp * 100)} %`, ok: otp >= o.otp },
      { label: `Diversions ≤ ${o.maxDiversions}`, value: String(this.kpi.diversions), ok: this.kpi.diversions <= o.maxDiversions },
    ];
    if (o.maxSecWait) {
      const w = this.avgWait('security');
      list.push({ label: `Average security wait ≤ ${o.maxSecWait} min`, value: `${w.toFixed(0)} min`, ok: w <= o.maxSecWait });
    }
    for (const id of o.projects ?? []) {
      const st = this.projects[id].state;
      list.push({ label: `Complete: ${PROJECTS[id].name}`, value: st === 'done' ? 'Done' : st === 'building' ? 'Building' : 'Not started', ok: st === 'done' });
    }
    return list;
  }

  // Average queue wait (minutes) over the whole game for one process, all terminals.
  avgWait(key) {
    let sum = 0;
    let n = 0;
    for (const T of Object.values(this.term.list)) {
      const P = T.proc[key];
      if (P) {
        sum += P.sumWait;
        n += P.sumN;
      }
    }
    return n ? sum / n : 0;
  }

  // Overlap audit used by the headless test: parked aircraft and their vehicles.
  audit() {
    const parked = this.flights.filter((f) => f.phase === 'atStand');
    let aircraftClashes = 0;
    for (let i = 0; i < parked.length; i++) {
      for (let j = i + 1; j < parked.length; j++) {
        const a = parked[i];
        const b = parked[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) > 120) continue;
        if (partsOverlap(aircraftFootprint(a.type, a.x, a.y, a.heading), aircraftFootprint(b.type, b.x, b.y, b.heading))) aircraftClashes++;
      }
    }
    return { parked: parked.length, aircraftClashes };
  }
}

// ---- helpers ----

function unit([x, y]) {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

function dirOf(a, b) {
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function routeLength(route) {
  let len = 0;
  for (let i = 1; i < route.length; i++) len += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
  return len;
}

function alongRoute(route, s) {
  for (let i = 1; i < route.length; i++) {
    const seg = Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
    if (s <= seg || i === route.length - 1) {
      const k = seg ? Math.min(1, s / seg) : 1;
      return { x: route[i - 1][0] + (route[i][0] - route[i - 1][0]) * k, y: route[i - 1][1] + (route[i][1] - route[i - 1][1]) * k, h: Math.atan2(route[i][1] - route[i - 1][1], route[i][0] - route[i - 1][0]) };
    }
    s -= seg;
  }
  return { x: route[0][0], y: route[0][1], h: 0 };
}

export function formatINR(v) {
  if (!Number.isFinite(v)) return '∞';
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(1)} lakh`;
  return `${sign}₹${Math.round(a).toLocaleString('en-IN')}`;
}
