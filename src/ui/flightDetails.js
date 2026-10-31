// Flight details, in the order a flight lives: status, route, timeline from approach to take-off, aircraft,
// stand and turnaround, passengers, conditions. Pure functions of the World; used by the selection panel.
import { PHASE_LABEL } from '../sim/world.js';
import { AIRCRAFT_TYPES } from '../sim/aircraftTypes.js';
import { cityName, distanceKm } from '../sim/airlines.js';
import { registration } from '../sim/brands.js';
import { esc } from '../logos.js';
import { telemetry } from '../sim/telemetry.js';
import { bagCounts, teamSize } from '../sim/groundcrew.js';
import { dial, compass, spark } from './instruments.js';

const hhmm = (t) => `${String(Math.floor((t % 86400) / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`;
const km = (m) => (m >= 10000 ? '10+ km' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 50) * 50} m`);
const dur = (mins) => (mins >= 60 ? `${Math.floor(mins / 60)} h ${String(Math.round(mins % 60)).padStart(2, '0')} min` : `${Math.round(mins)} min`);

const FINISHED = ['departed', 'diverted', 'cancelled'];

// Typical block time for a leg: cruise speed plus climb, descent and taxi.
const legMinutes = (kmDist, props) => Math.round((kmDist / (props ? 480 : 800)) * 60 + 25);

function leg(flightNo, from, to, props, note = '') {
  const d = distanceKm(from, to);
  return `<div class="leg"><b>${esc(flightNo)}</b>
    <span class="rt"><em>${esc(from)}</em><small>${esc(cityName(from))}</small></span><span class="rarrow">${d ? `✈ ${Math.round(d).toLocaleString('en-IN')} km` : '✈'}</span>
    <span class="rt"><em>${esc(to)}</em><small>${esc(cityName(to))}</small></span>
    ${d ? `<small class="legnote">about ${dur(legMinutes(d, props))} in the air and on the ground${note}</small>` : ''}</div>`;
}

// The ordered steps with planned, estimated and actual times.
function steps(w, f) {
  const task = (id) => f.tasks?.find((t) => t.id === id);
  const tm = f.times ?? {};
  const arrEst = f.slot ? f.slot : f.sta - 300 + (f.inboundDelay ?? 0);
  const list = [
    { key: 'final', label: 'On final approach', plan: null, actual: tm.final ?? null, est: arrEst - 150 },
    { key: 'landed', label: 'Landed', plan: f.sta - 300, actual: tm.landed ?? null, est: arrEst },
    { key: 'onBlock', label: 'On block at the stand', plan: f.sta, actual: f.onBlock ?? null, est: arrEst + 300 },
    ...(f.service === 'cargo'
      ? [{ key: 'unload', label: 'Cargo unloaded', plan: null, actual: task('unload')?.doneAt ?? null, est: null }, { key: 'load', label: 'Cargo loaded', plan: null, actual: task('load')?.doneAt ?? null, est: null }]
      : f.service === 'ga'
        ? [{ key: 'handling', label: 'Passengers to the GA lounge', plan: null, actual: task('handling')?.doneAt ?? null, est: null }]
        : [{ key: 'deboard', label: 'Passengers off', plan: null, actual: task('deboard')?.doneAt ?? null, est: null }, { key: 'board', label: 'Boarding starts', plan: null, actual: tm.board ?? null, est: null }]),
    { key: 'close', label: 'Doors closed', plan: null, actual: task('close')?.doneAt ?? null, est: null },
    { key: 'offBlock', label: 'Pushed back (off block)', plan: f.std, actual: f.offBlock ?? null, est: Math.max(f.std, w.t) },
    { key: 'airborne', label: 'Airborne', plan: f.std + 12 * 60, actual: tm.airborne ?? null, est: Math.max(f.std, w.t) + 12 * 60 },
  ];
  // A step is done if it has a time, or if a later step does (flights that were already on a stand at the start).
  let last = -1;
  list.forEach((s, i) => {
    if (s.actual !== null) last = i;
  });
  if (FINISHED.includes(f.phase) && f.phase === 'departed') last = list.length - 1;
  let nowIndex = -1;
  list.forEach((s, i) => {
    s.done = i <= last;
    if (!s.done && nowIndex < 0 && !FINISHED.includes(f.phase)) nowIndex = i;
  });
  if (nowIndex >= 0) list[nowIndex].now = true;
  return list;
}

function timeline(w, f) {
  const rows = steps(w, f).map((s) => {
    const when = s.actual ?? (s.done ? null : s.est);
    const delta = s.plan !== null && when !== null ? Math.round((when - s.plan) / 60) : null;
    const cls = s.done ? 'done' : s.now ? 'now' : 'next';
    const dtxt = delta !== null && Math.abs(delta) >= 2 ? `<small class="${delta > 14 ? 'bad' : delta > 4 ? 'mid' : 'ok'}">${delta > 0 ? '+' : ''}${delta} min</small>` : '';
    return `<li class="${cls}"><i></i><span class="lb">${esc(s.label)}</span><span class="tm">${s.plan !== null ? `<small>plan ${hhmm(s.plan)}</small>` : ''}<b>${when !== null ? `${s.actual === null ? '~' : ''}${hhmm(when)}` : s.done ? 'done' : '–'}</b>${dtxt}</span></li>`;
  }).join('');
  return `<ol class="tline">${rows}</ol>`;
}

function turnaround(w, f) {
  if (!f.tasks) return '';
  const rows = f.tasks.map((task) => {
    const pct = task.state === 'done' ? 100 : task.state === 'work' ? Math.max(0, Math.min(100, Math.round((1 - (task.end - w.t) / task.dur) * 100))) : 0;
    const icon = { done: '✔', work: '●', driving: '→', wait: '○' }[task.state];
    const times = task.doneAt ? `${task.start ? hhmm(task.start) : ''}–${hhmm(task.doneAt)}` : task.start && task.state !== 'wait' ? `from ${hhmm(task.start)}` : '';
    return `<li class="${task.state}"><span>${icon} ${esc(task.label)}${times ? ` <small>${times}</small>` : ''}</span><i style="--p:${pct}%"></i></li>`;
  }).join('');
  return `<ul class="tasks">${rows}</ul>`;
}

// Jet bridges, ramp team and bags for the stand section.
function groundLines(w, f, stand) {
  if (!stand) return '';
  const lines = [];
  if (stand.contact) {
    const bridges = w.bridgesFor(f);
    const words = { parked: 'parked', docking: 'driving out to the door', docked: 'docked', retracting: 'driving back' };
    if (bridges.length) {
      lines.push(`Jet bridge${bridges.length > 1 ? 's' : ''} ${bridges.map((b) => `<b>${b.index + 1}L</b> ${words[b.state]}`).join(' · ')}`);
    } else lines.push('No jet bridge reaches this stand: <b>stairs and buses</b>');
  } else lines.push('Remote stand: <b>stairs and buses</b>');
  if (f.phase === 'atStand' || f.tasks) {
    lines.push(f.crew ? `Ramp team <b>${teamSize(f.type)} people</b> (lead and ${teamSize(f.type) - 1} baggage handlers)` : f.phase === 'atStand' ? '<span class="warn">No ramp team free yet</span>' : 'Ramp team released');
    const b = bagCounts(f, w.t);
    lines.push(`Bags off <b>${b.unloaded}/${b.bagsIn}</b> · bags on <b>${b.loaded}/${b.bagsOut}</b>${AIRCRAFT_TYPES[f.type].code === 'E' ? ' (in ULD containers)' : ''}`);
  }
  return lines.map((l) => `<p>${l}</p>`).join('');
}

function passengers(w, f) {
  const t = AIRCRAFT_TYPES[f.type];
  if (f.service === 'cargo') {
    const cap = t.freightT ?? 0;
    return `<div class="kpis fd-grid"><span>Cargo in <b>${f.cargoIn ?? 0} t</b></span><span>Cargo out <b>${f.cargoOut ?? 0} t</b></span><span>Max payload <b>${cap} t</b></span><span>Load factor <b>${cap ? Math.round(((f.cargoOut ?? 0) / cap) * 100) : 0} %</b></span></div>
      <p class="muted fine">Freighter: no passengers. Handled at the cargo terminal (₹ per tonne in and out).</p>`;
  }
  if (f.service === 'ga') {
    return `<div class="kpis fd-grid"><span>On board in <b>${f.aboardIn ?? 0}</b></span><span>On board out <b>${f.aboardOut ?? 0}</b></span><span>Seats <b>${t.seats}</b></span><span>Handled at <b>GA lounge</b></span></div>
      <p class="muted fine">Private / charter flight: passengers skip the terminals, the operator's own agent handles it.</p>`;
  }
  const p = f.pax;
  const lf = Math.round((f.paxOut / t.seats) * 100);
  let bar = '';
  if (p && p.out > 0) {
    const pct = Math.max(0, Math.min(100, Math.round((p.done / Math.max(1, f.paxOut)) * 100)));
    const T = w.term.list[p.term];
    bar = `<p>Departing passengers through security at ${esc(T?.short ?? p.term)}: <b>${Math.round(p.done)}/${f.paxOut}</b></p><div class="pbar"><i style="--p:${pct}%"></i></div>`;
    if (p.board !== null) bar += `<p>Boarded <b>${Math.round(p.board)}</b>${p.missed ? ` · <span class="warn">${p.missed} missed the flight</span>` : ''}</p>`;
  }
  return `<div class="kpis fd-grid"><span>Arriving <b>${f.paxIn}</b></span><span>Departing <b>${f.paxOut}</b></span><span>Seats <b>${t.seats}</b></span><span>Load factor <b>${lf} %</b></span></div>${bar}`;
}

function conditions(w, f) {
  const x = w.weather.now;
  const RW = w.runwayOf(f);
  const { head, cross } = w.windComponents(RW.active);
  const lines = [
    `Runway <b>${esc(RW.active)}</b> · headwind ${Math.round(head)} kt, crosswind ${Math.round(cross)} kt`,
    `Weather <b>${esc(x.label)}</b>, ${Math.round(x.tempC)} °C, visibility ${km(w.visibility())}${w.rampClosed ? ' · <span class="warn">ramp closed (lightning)</span>' : ''}`,
    `Light <b>${esc(w.lights.phase)}</b>${w.lights.night ? ' · apron lights ' + (w.lights.apron ? 'on' : 'off') : ''}`,
  ];
  if (f.delayCause && (f.depDelay ?? 0) > 0) lines.push(`Delay cause <b>${esc(f.delayCause)}</b>`);
  else if (f.delayCause) lines.push(`Delay cause so far <b>${esc(f.delayCause)}</b>`);
  return lines.map((l) => `<p>${l}</p>`).join('');
}

const num = (n) => Math.round(n).toLocaleString('en-IN');

// Live flight data: instruments, readouts, configuration and the recent history.
function liveData(w, f, ui) {
  const x = telemetry(w, f);
  if (!x.live) {
    const due = f.phase === 'scheduled' ? ` · due ${hhmm(f.sta)}` : f.phase === 'inbound' && x.etaT ? ` · landing about ${hhmm(x.etaT)}` : '';
    return `<p class="muted">${esc(x.note)}${due}</p><div class="kpis fd-grid"><span>Callsign <b>${esc(x.callsign)}</b></span><span>Squawk <b>${x.squawk}</b></span></div>`;
  }
  const heavy = x.type.wake === 'H';
  const vs = Math.round(x.vsFpm / 50) * 50;
  const dials = [
    dial({ value: x.gs, min: 0, max: heavy ? 250 : 200, step: 10, major: heavy ? 50 : 50, label: x.ias === null ? 'Ground speed' : 'Speed', unit: 'KT', text: `${num(x.gs)} kt` }),
    dial({ value: x.mslFt, min: 0, max: 4000, from: -135, to: 135, step: 250, major: 1000, label: 'Altitude', unit: 'FT', text: `${num(x.mslFt)} ft` }),
    dial({ value: vs, min: -2000, max: 2000, from: -150, to: 150, step: 250, major: 1000, label: 'Vertical speed', unit: 'FPM', text: `${vs > 0 ? '+' : ''}${num(vs)}`, tone: vs < -1200 ? 'warn' : '' }),
    compass(x.bearing),
  ].join('');
  const dist = x.dist === null ? null : x.dist >= 3000 ? `${(x.dist / 1852).toFixed(1)} NM` : `${num(x.dist)} m`;
  const headTxt = `${Math.abs(Math.round(x.head))} kt ${x.head >= 0 ? 'headwind' : 'tailwind'}, ${Math.abs(Math.round(x.cross))} kt crosswind`;
  const chip = (on, label) => `<span class="chip2 ${on ? 'on' : ''}">${label}</span>`;
  const trace = ui?.trace?.id === f.id ? ui.trace.pts : null;
  const lightsOn = (k) => x.lights.includes(k);
  return `<div class="inst-row">${dials}</div>
    <div class="kpis fd-grid">
      <span>Ground speed <b>${num(x.gs)} kt</b></span><span>Airspeed <b>${x.ias === null ? '–' : `${num(x.ias)} kt`}</b></span>
      <span>Altitude <b>${num(x.mslFt)} ft</b></span><span>Above ground <b>${num(x.aglFt)} ft</b></span>
      <span>Altimeter setting <b>QNH ${x.qnh}</b></span><span>Vertical speed <b>${vs > 0 ? '+' : ''}${num(vs)} fpm</b></span>
      <span>Heading <b>${String(Math.round(x.bearing) % 360).padStart(3, '0')}°</b></span><span>Wind on the aircraft <b>${esc(headTxt)}</b></span>
      ${dist !== null ? `<span>Distance <b>${dist}</b><small>${esc(x.distLabel)}</small></span>` : x.distLabel ? `<span>Status <b>${esc(x.distLabel)}</b></span>` : ''}
      ${x.etaT ? `<span>Touchdown <b>${hhmm(x.etaT)}</b></span>` : ''}
      <span>Thrust ${x.n1 === null ? '' : '(estimate)'} <b>${x.n1 === null ? esc(x.engineNote || 'idle') : `N1 ${Math.round(x.n1)} %${x.reverse ? ' reverse' : ''}`}</b></span>
      <span>Fuel on board (est.) <b>${x.fuel.toFixed(1)} t</b></span>
      <span>Callsign <b>${esc(x.callsign)}</b></span><span>Squawk <b>${x.squawk}</b></span>
    </div>
    <div class="chips2">${chip(x.gearDown, `Gear ${x.gearDown ? 'down' : 'up'}`)}${chip(x.flaps !== 'UP', `Flaps ${esc(x.flaps)}`)}${chip(x.spoilers, 'Spoilers')}${chip(x.reverse, 'Reverse')}${chip(lightsOn('landing'), 'Landing lights')}${chip(lightsOn('taxi'), 'Taxi light')}${chip(lightsOn('beacon'), 'Beacon')}${chip(lightsOn('strobe'), 'Strobes')}</div>
    <p class="muted fine">Reference speeds: approach ${num(x.vApp)} kt · V1 ${num(x.vRot - 5)} · rotate ${num(x.vRot)} · V2 ${num(x.vRot + 10)} kt. Thrust and fuel are estimates.</p>
    ${trace && trace.length > 1 ? `<div class="traces"><div><small>Speed, last minutes</small>${spark(trace, 'gs', { unit: 'kt' })}</div><div><small>Altitude, last minutes</small>${spark(trace, 'alt', { unit: 'ft' })}</div></div>` : ''}`;
}

// Everything between the header and the action buttons of the flight card.
export function flightDetails(w, f, ui = null) {
  const t = AIRCRAFT_TYPES[f.type];
  const stand = f.standId !== null ? w.standById.get(f.standId) : null;
  const term = w.term.list[w.term.termFor(f)];
  const delayNow = FINISHED.includes(f.phase) ? 0 : Math.round(((f.phase === 'scheduled' || f.phase === 'holding' || f.phase === 'inbound') ? f.inboundDelay ?? 0 : Math.max(0, (f.offBlock ?? w.t) - f.std)) / 60);
  const next = steps(w, f).find((s) => s.now);
  const status = `<div class="fd-status"><span class="pill ${f.phase}">${esc(PHASE_LABEL[f.phase])}</span>${delayNow >= 5 ? `<span class="pill late">${delayNow} min late</span>` : ''}${f.priority ? '<span class="pill prio">Priority</span>' : ''}
    ${next ? `<small>Next: ${esc(next.label.toLowerCase())}${next.est ? ` about ${hhmm(next.est)}` : ''}</small>` : ''}</div>
    ${f.waiting ? `<p class="warn">⏳ ${esc(f.waiting)}</p>` : ''}`;

  const route = `${leg(f.arrNo, f.from, 'MAA', t.props)}${leg(f.depNo, 'MAA', f.to, t.props)}<p class="muted fine">${f.intl ? 'International' : 'Domestic'} ${f.service === 'cargo' ? 'cargo' : f.service === 'ga' ? 'general-aviation' : ''} rotation · ${AIRCRAFT_TYPES[f.type].turnMin} min scheduled turnaround</p>`;
  const aircraft = `<div class="kpis fd-grid"><span>Type <b>${esc(t.name)}</b></span><span>Registration <b title="Made up for the simulation">${esc(f.registration ?? registration(f.airline, f.id))}</b></span>
    <span>Engines <b>${t.engines}× ${esc(t.engineModel)}</b></span><span>Wake <b>${t.wake === 'H' ? 'Heavy' : t.wake === 'L' ? 'Light' : 'Medium'}</b></span>
    <span>Size <b>${t.length} × ${t.span} m</b></span><span>Max weight <b>${t.mtow} t</b></span></div>`;
  const ground = `<div class="kpis fd-grid"><span>Stand <b>${stand ? esc(stand.ref) : '–'}</b></span><span>${f.service === 'cargo' ? 'Cargo' : 'Boarding'} <b>${!stand ? '–' : f.service === 'cargo' ? 'pallets by loader' : f.service === 'ga' ? 'walk / car' : stand.contact ? 'jet bridge' : 'bus, remote'}</b></span>
    <span>Terminal <b>${esc(f.service === 'cargo' ? 'Cargo Terminal' : f.service === 'ga' ? 'GA lounge' : term?.name ?? '–')}</b></span><span>Stand size <b>${t.code === 'E' ? 'wide-body' : t.code === 'B' ? 'business / light' : 'narrow-body'}</b></span></div>${groundLines(w, f, stand)}${turnaround(w, f)}`;

  const sec = (title, body) => `<section class="fd-sec"><h4>${title}</h4>${body}</section>`;
  // Reference sections fold away; the player's choice is remembered while the card refreshes.
  const fold = (title, body, open) => `<details class="fd-sec" ${sectionOpen.get(title) ?? open ? 'open' : ''}><summary data-sec="${title}"><h4>${title}</h4></summary>${body}</details>`;
  const moving = !['atStand', 'scheduled', 'departed', 'cancelled', 'diverted'].includes(f.phase);
  return [
    sec('Status', status),
    sec('Route', route),
    sec('Timeline', timeline(w, f)),
    sec('Stand and turnaround', ground),
    sec('Passengers', passengers(w, f)),
    fold('Live data', liveData(w, f, ui), moving),
    fold('Aircraft', aircraft, false),
    fold('Conditions', conditions(w, f), false),
  ].join('');
}

const sectionOpen = new Map();
export const setSectionOpen = (title, open) => sectionOpen.set(title, open);
