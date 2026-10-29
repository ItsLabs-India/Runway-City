import { Camera2D } from './map/camera.js';
import { MapRenderer } from './map/renderer.js';
import { bbox } from './map/geometry.js';
import { World } from './sim/world.js';
import { standBlocker } from './sim/stands.js';
import { AIRCRAFT_TYPES } from './sim/aircraftTypes.js';
import { SCENARIOS } from './sim/scenarios.js';
import { fmtCr } from './sim/terminal.js';
import { createHud } from './ui/hud.js';
import { createLineIndex, gearDeviation } from './sim/lineCheck.js';
import { saveSlot, loadSlot, describe, decode, downloadSave } from './persist.js';
import { fetchWeather, LiveTraffic } from './live/live.js';
import { Radio } from './audio.js';
import { loadLogos } from './logos.js';
import './style.css';

// Named views; ?view=terminals etc. opens on one (handy for testing). scale = px per metre.
const VIEWS = {
  terminals: { x: -800, y: 1230, scale: 0.9 },
  runway25: { x: 1250, y: -150, scale: 1.3 },
  stands: { x: -700, y: 1180, scale: 3 },
  gate: { x: -722, y: 1135, scale: 8 },
};
const SPEEDS = new Set([0, 1, 5, 20, 60]);
const DAILY = ['normal', 'festival', 'bhogi', 'cyclone', 'outage'];
const AUTOSAVE_MS = 20_000;

const canvas = document.getElementById('map');
const map = await (await fetch(`${import.meta.env.BASE_URL}data/maa-map.json`)).json();
const params = new URLSearchParams(location.search);
// Optional real timetable (see scripts/import-timetable.mjs); without it the game builds a realistic day.
const timetable = await fetch(`${import.meta.env.BASE_URL}data/timetable.json`)
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);

await loadLogos(import.meta.env.BASE_URL);

const field = bbox(map.aerodrome);
const camera = new Camera2D(canvas, {
  minScale: 0.03,
  maxScale: 25,
  bounds: { minX: field.minX - 3000, minY: field.minY - 3000, maxX: field.maxX + 3000, maxY: field.maxY + 3000 },
});

let world = null;
let renderer = null;
let selection = null; // { type: 'flight' | 'stand' | 'runway' | 'info', id?, info? }
let standPick = null; // { flightId, valid: Map(standId -> reason | null) }
let speed = params.has('speed') && SPEEDS.has(Number(params.get('speed'))) ? Number(params.get('speed')) : 1;
let speedBeforeModal = 1;
let weatherTimer = null;
let lastSave = 0;
const radio = new Radio();
const traffic = new LiveTraffic(map.meta.ref);
const ui = { boardView: 'board', group: 'none', agroup: 'group', airline: null, term: 'T1', plan: [], planMode: false, voice: false, live: { trafficOn: false, traffic: '', weather: '' }, ghosts: [] };

const hud = createHud(document.getElementById('hud'), {
  onSpeed: (s) => {
    speed = s;
    refresh();
  },
  onZoom: (factor) => camera.zoomAt(factor),
  onHome: () => camera.setView(homeView()),
  onRefresh: () => refresh(),
  onSelect: (sel, centre) => select(sel, centre),
  onJump: (target) => {
    if (target.flight !== undefined) select({ type: 'flight', id: target.flight }, true);
    else if (target.runway) select({ type: 'runway' }, true);
    else if (target.terminal) openTerminal(target.terminal);
  },
  onAction: (action, arg) => act(action, arg),
});

// ---- starting, saving, loading ---------------------------------------------------------------

// ?time=HH:MM starts the day at that IST time (default: the real time now).
function startTime(scenarioId) {
  let m = /^(\d{1,2}):(\d{2})$/.exec(params.get('time') ?? '');
  const hour = SCENARIOS[scenarioId]?.startHour; // scenarios such as the night shift start at a set time
  if (!m && hour !== undefined) m = [null, String(hour), '00'];
  if (!m) return Date.now();
  const now = new Date(Date.now() + 5.5 * 3600e3);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(m[1]), Number(m[2])) - 5.5 * 3600e3;
}

// Random weather (the seasons decide) or calm weather, remembered between visits.
function weatherPref() {
  try {
    return localStorage.getItem('rc-weather') === 'calm' ? 'calm' : 'random';
  } catch {
    return 'random';
  }
}

function dailyId() {
  const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  let h = 0;
  for (const c of day) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return DAILY[h % DAILY.length];
}

function start(scenarioId, snap = null) {
  stopLive();
  world = new World(map, { scenarioId, startTime: startTime(scenarioId), timetable: Array.isArray(timetable) ? timetable : null, weatherMode: weatherPref() });
  if (snap) world.restore(snap);
  world.radioOn = ui.voice;
  renderer = new MapRenderer(canvas, map, world.stands, world.graph);
  renderer.resize();
  selection = null;
  standPick = null;
  ui.plan = [];
  ui.planMode = false;
  hud.banner(null);
  hud.hideModal();
  hud.credits();
  if (!snap) hud.toast(`${SCENARIOS[scenarioId].name}: ${SCENARIOS[scenarioId].brief}`);
  else hud.toast('Game loaded');
  if (world.liveWeather) startWeather();
  if (params.has('warm') && !snap) world.update(Math.min(4 * 3600, Number(params.get('warm')) || 0));
  refresh();
}

async function autosave(force = false) {
  if (!world || (!force && performance.now() - lastSave < AUTOSAVE_MS / 2)) return;
  lastSave = performance.now();
  try {
    await saveSlot('auto', { meta: describe(world), snap: world.snapshot() });
  } catch {
    /* private window or blocked storage: the game still works, it just cannot save */
  }
}

async function savedMeta() {
  try {
    return (await loadSlot('auto'))?.meta ?? null;
  } catch {
    return null;
  }
}

async function openMenu(canClose) {
  hud.showMenu({ saved: await savedMeta(), current: world?.scenarioId, daily: dailyId(), canClose, weatherMode: world?.weatherMode ?? weatherPref() });
}

async function importFile(file) {
  try {
    const data = decode(await file.text());
    start(data.snap.scenarioId, data.snap);
  } catch (err) {
    hud.toast(`Could not load that file: ${err.message}`, false);
  }
}

// ---- live data --------------------------------------------------------------------------------

function startWeather() {
  clearInterval(weatherTimer);
  const pull = async () => {
    try {
      const w = await fetchWeather();
      world.setWind(w.from, w.kt);
      ui.live.weather = w.source;
    } catch {
      ui.live.weather = 'unavailable: using simulated weather';
    }
    hud.credits(creditsFor());
    refresh();
  };
  pull();
  weatherTimer = setInterval(pull, 10 * 60 * 1000);
}

function stopLive() {
  clearInterval(weatherTimer);
  traffic.stop();
  ui.live = { trafficOn: false, traffic: '', weather: '' };
  ui.ghosts = [];
}

const creditsFor = () => [world?.liveWeather ? 'Weather: Open-Meteo / NOAA AWC' : '', ui.live.trafficOn ? 'Live aircraft: <a href="https://adsb.fi" target="_blank" rel="noopener">adsb.fi</a>' : ''].filter(Boolean);

// ---- views and selection ----------------------------------------------------------------------

function homeView() {
  const scale = Math.min(camera.width / (field.maxX - field.minX), camera.height / (field.maxY - field.minY)) * 0.92;
  return { x: (field.minX + field.maxX) / 2, y: (field.minY + field.maxY) / 2, scale };
}

function select(sel, centre = false) {
  selection = sel;
  if (centre && sel && window.innerWidth <= 760) hud.openTab(null); // phones: the selection card replaces the panel
  if (centre && sel?.type === 'flight') {
    const f = world.flights.find((x) => x.id === sel.id);
    if (f && world.visibleFlights().includes(f)) camera.setView({ x: f.x, y: f.y, scale: Math.max(camera.scale, 1.6) });
    else if (f?.standId !== null && f?.standId !== undefined) {
      const st = world.standById.get(f.standId);
      camera.setView({ x: st.x, y: st.y, scale: Math.max(camera.scale, 1.6) });
    }
  }
  if (centre && sel?.type === 'runway') camera.setView({ x: (world.frame.ends['07'][0] + world.frame.ends['25'][0]) / 2, y: (world.frame.ends['07'][1] + world.frame.ends['25'][1]) / 2, scale: 0.35 });
  refresh();
}

function openTerminal(id) {
  ui.term = id;
  hud.openTab('term');
}

// ---- actions ----------------------------------------------------------------------------------

function stage(ops) {
  if (ui.planMode) {
    ui.plan.push(...ops);
    hud.toast(`${ops.length} change${ops.length > 1 ? 's' : ''} added to the plan`);
    return;
  }
  const r = world.term.applyPlan(ops);
  hud.toast(r.message, r.ok);
}

function act(action, arg) {
  const report = (r) => r && hud.toast(r.message, r.ok);
  switch (action) {
    // menu and saving
    case 'menu':
      return openMenu(Boolean(world));
    case 'closeMenu':
      return hud.hideModal();
    case 'scenario':
      return start(arg);
    case 'continue': {
      loadSlot('auto').then((rec) => (rec ? start(rec.snap.scenarioId, rec.snap) : hud.toast('No saved game found', false))).catch(() => hud.toast('Could not read the saved game', false));
      return undefined;
    }
    case 'saveNow':
      autosave(true).then(() => hud.toast('Game saved'));
      return undefined;
    case 'exportSave':
      return downloadSave(world.snapshot(), describe(world));
    case 'import':
      return importFile(arg);
    case 'perk': {
      report(world.acknowledgeReport(arg || null));
      hud.hideModal();
      speed = speedBeforeModal || 1;
      return refresh();
    }
    case 'copyResult': {
      const r = world.pendingReport;
      const text = `Runway City MAA · ${r.date} · ${r.scenario} · ${Math.round(r.otp * 100)} % on time · ☺ ${Math.round(r.satisfaction)} · profit ${fmtCr(r.profit)}`;
      navigator.clipboard?.writeText(text).then(() => hud.toast('Result copied'), () => hud.toast(text));
      return undefined;
    }
    // flights, stands, runway
    case 'follow': {
      const f = world.flights.find((x) => x.id === Number(arg));
      if (!f || !world.visibleFlights().includes(f)) return hud.toast('Not on the map yet', false);
      camera.following = camera.following === f ? null : f;
      if (camera.following && camera.scale < 1.5) camera.scale = 2;
      break;
    }
    case 'prioritise':
      report(world.prioritise(Number(arg)));
      break;
    case 'cancelFlight':
      report(world.cancelFlight(Number(arg)));
      break;
    case 'pickStand': {
      const f = world.flights.find((x) => x.id === Number(arg));
      const from = f.eta - 300;
      const to = Math.max(f.std + 1800, f.eta + AIRCRAFT_TYPES[f.type].turnMin * 60 + 1500);
      standPick = { flightId: f.id, valid: new Map(world.stands.map((s) => [s.id, standBlocker(s, f.type, from, to, f.id)])) };
      hud.banner(`Choose a stand for ${f.arrNo} (${f.type}): green rings are free and fit`);
      break;
    }
    case 'cancelPick':
      standPick = null;
      hud.banner(null);
      break;
    case 'toggleStand':
      report(world.toggleStand(Number(arg)));
      break;
    case 'switchRunway':
      report(world.switchRunway());
      break;
    case 'inspectRunway':
      report(world.closeRunway(15, 'Runway inspection ordered'));
      break;
    case 'reopenRunway':
      report(world.reopenRunway());
      break;
    // fleets and crews
    case 'buy': {
      const [kind, n] = arg.split(':');
      report(world.buyVehicles(kind, Number(n)));
      break;
    }
    case 'sell': {
      const [kind, n] = arg.split(':');
      report(world.sellVehicles(kind, Number(n)));
      break;
    }
    case 'hire': {
      const [who, n] = arg.split(':');
      report(who === 'crew' ? world.hireCrews(Number(n)) : world.term.hire(who, Number(n)));
      break;
    }
    // weather and lighting
    case 'openTab':
      hud.openTab(arg);
      break;
    case 'weatherMode':
      report(world.setWeatherMode(arg));
      try {
        localStorage.setItem('rc-weather', arg);
      } catch {
        // private mode: the choice just is not remembered
      }
      break;
    case 'lighting': {
      const [kind, value] = arg.split(':');
      report(world.setLighting(kind, value));
      break;
    }
    // flight board and airlines
    case 'boardView':
      ui.boardView = arg;
      break;
    case 'boardGroup':
      ui.group = arg;
      break;
    case 'airlineGroup':
      ui.agroup = arg;
      break;
    case 'boardAirline':
      ui.airline = arg || null;
      if (arg) ui.boardView = 'board';
      break;
    // terminals
    case 'term':
      ui.term = arg;
      break;
    case 'shift':
      report(world.term.setShift(arg));
      break;
    case 'dial': {
      const [t, k, d] = arg.split(':');
      report(world.term.setDial(t, k, d));
      break;
    }
    case 'add': {
      const [term, proc, n] = arg.split(':');
      stage([{ kind: 'add', term, proc, n: Number(n) }]);
      break;
    }
    case 'tier': {
      const [term, proc] = arg.split(':');
      stage([{ kind: 'tier', term, proc }]);
      break;
    }
    case 'retail': {
      const [term, n] = arg.split(':');
      stage([{ kind: 'retail', term, n: Number(n) }]);
      break;
    }
    case 'upgradeAll': {
      const ops = world.term.upgradeAllOps(arg);
      if (ops.length) stage(ops);
      else hud.toast('Everything is already on the best technology', false);
      break;
    }
    case 'planMode':
      ui.planMode = !ui.planMode;
      if (!ui.planMode) ui.plan = [];
      break;
    case 'clearPlan':
      ui.plan = [];
      break;
    case 'buildPlan': {
      const r = world.term.applyPlan(ui.plan);
      hud.toast(r.message, r.ok);
      if (r.ok) ui.plan = [];
      break;
    }
    case 'copyLayout': {
      const code = world.term.layoutCode(arg);
      const input = document.querySelector('#layoutCode');
      if (input) input.value = code;
      navigator.clipboard?.writeText(code).then(() => hud.toast('Layout code copied: paste it into another terminal'), () => hud.toast('Layout code is in the box: copy it from there'));
      break;
    }
    case 'applyLayout': {
      const code = document.querySelector('#layoutCode')?.value.trim() ?? '';
      const r = world.term.layoutOps(arg, code);
      if (!r.ok) hud.toast(r.message, false);
      else if (!r.ops.length) hud.toast('That terminal already matches this layout', false);
      else stage(r.ops);
      break;
    }
    // projects
    case 'project':
      report(world.startProject(arg));
      break;
    // real world
    case 'liveWeather':
      world.liveWeather = !world.liveWeather;
      if (world.liveWeather) startWeather();
      else {
        clearInterval(weatherTimer);
        ui.live.weather = '';
        hud.credits(creditsFor());
      }
      break;
    case 'autoRunway':
      report(world.setAutoRunway(!world.autoRunway));
      break;
    case 'liveTraffic':
      ui.live.trafficOn = !ui.live.trafficOn;
      if (ui.live.trafficOn) {
        traffic.start((status, n) => {
          ui.live.traffic = status === 'live' ? `${n} real aircraft tracked` : status === 'unavailable' ? 'feed unavailable (needs the /api proxy)' : 'connecting';
          hud.credits(creditsFor());
        });
      } else {
        traffic.stop();
        ui.live.traffic = '';
      }
      hud.credits(creditsFor());
      break;
    case 'voice':
      ui.voice = radio.enable(!ui.voice);
      world.radioOn = ui.voice;
      if (!radio.supported) hud.toast('This browser has no speech synthesis', false);
      break;
    default:
      break;
  }
  return refresh();
}

camera.onClick = (sx, sy) => {
  if (!world || hud.modalKind) return;
  const hit = renderer.pick(camera, sx, sy, world);
  if (standPick) {
    if (hit?.type === 'stand') {
      const r = world.assignStand(standPick.flightId, hit.id);
      hud.toast(r.message, r.ok);
      if (r.ok) {
        standPick = null;
        hud.banner(null);
      }
    }
    refresh();
    return;
  }
  const t = hit?.type === 'info' && /^Terminal (\d)/.exec(hit.info.title);
  if (t) return openTerminal(`T${t[1]}`);
  return select(hit);
};

const TAB_KEYS = { f: 'board', t: 'term', p: 'proj', o: 'ops', l: 'log' };
window.addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    if (standPick) act('cancelPick');
    else if (hud.modalKind === 'menu' && world) hud.hideModal();
    else if (selection) select(null);
    else if (hud.tab) hud.openTab(null);
    return;
  }
  if (hud.modalKind) return;
  if (k === ' ' && e.target === document.body) {
    e.preventDefault();
    speed = speed === 0 ? 1 : 0;
    refresh();
  } else if (/^[1-5]$/.test(k)) {
    speed = [0, 1, 5, 20, 60][Number(k) - 1];
    refresh();
  } else if (TAB_KEYS[k]) hud.openTab(hud.tab === TAB_KEYS[k] ? null : TAB_KEYS[k]);
});

document.addEventListener('visibilitychange', () => document.hidden && autosave(true));
window.addEventListener('pagehide', () => autosave(true));

function refresh() {
  if (world) hud.update(world, selection, speed, ui);
}

function resize() {
  renderer?.resize();
}
window.addEventListener('resize', resize);

// ---- boot --------------------------------------------------------------------------------------

camera.setView(VIEWS[params.get('view')] ?? homeView());
const scenario = params.get('scenario');
if (scenario && SCENARIOS[scenario]) start(scenario);
else {
  start('normal');
  openMenu(false);
}
if (params.has('panel')) hud.openTab(params.get('panel'));
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

// ---- the loop ----------------------------------------------------------------------------------

let last = performance.now();
let uiTimer = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (world) {
    const modal = hud.modalKind !== null;
    if (world.pendingReport && !modal) {
      speedBeforeModal = speed || 1;
      speed = 0;
      hud.showReport(world.pendingReport);
    } else if (!modal) {
      world.update(dt * speed);
    }
    if (world.radio.length && speed <= 5) radio.say(world.radio.shift());
    else if (world.radio.length) world.radio.length = 0;
    if (camera.following && !world.visibleFlights().includes(camera.following)) camera.following = null;
    camera.update(dt);
    ui.ghosts = traffic.status === 'live' ? traffic.ghosts() : [];
    renderer.draw(camera, world, { selected: selection, standPick, ghosts: ui.ghosts });
    uiTimer += dt;
    if (uiTimer > 0.25) {
      uiTimer = 0;
      refresh();
    }
    if (performance.now() - lastSave > AUTOSAVE_MS && speed > 0 && !modal) autosave();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Inspection hook for automated browser tests (scripts/inspect.mjs, scripts/ui-test.mjs).
let lineIndex = null;
window.__runway = {
  get world() {
    return world;
  },
  camera,
  ui,
  hud,
  act,
  start,
  traffic,
  frames: 0,
  setSpeed(s) {
    speed = s;
  },
  follow(id) {
    const f = world.flights.find((x) => x.id === id);
    camera.following = f ?? null;
    if (f) camera.setView({ x: f.x, y: f.y, scale: 3.2 });
    camera.following = f ?? null;
  },
  deviation() {
    lineIndex ??= createLineIndex(world.graph);
    return world.flights
      .filter((f) => ['taxiIn', 'taxiOut', 'pushback', 'lineUp', 'holdShort'].includes(f.phase))
      .map((f) => ({ id: f.id, phase: f.phase, ...gearDeviation(lineIndex, f) }));
  },
};
(function countFrames() {
  window.__runway.frames++;
  requestAnimationFrame(countFrames);
})();
