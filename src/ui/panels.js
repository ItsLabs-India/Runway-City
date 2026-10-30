// HTML for the side panels and the selection panel. Pure functions of the World and a small UI
// state object; every button carries data-action / data-arg and is handled in main.js.
import { GSE, CREW, PHASE_LABEL, formatINR } from '../sim/world.js';
import { AIRCRAFT_TYPES } from '../sim/aircraftTypes.js';
import { cityName } from '../sim/airlines.js';
import { PROJECTS } from '../sim/projects.js';
import { brandOf } from '../sim/brands.js';
import { badge } from '../logos.js';
import { weatherPanel } from './weatherUi.js';
import { financePanel } from './financeUi.js';
import { flightDetails } from './flightDetails.js';
import { ROLES } from '../sim/groundcrew.js';
import { airlinesView, airlineLine, boardControls, groupedRows, nameOf } from './airlines.js';
import { PROCESSES, PROC_ORDER, DIALS, DEPTS, SHIFTS, PERKS, TERMINAL_DEFS, fmtCr } from '../sim/terminal.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function hhmm(t) {
  if (!Number.isFinite(t)) return '--:--';
  const d = ((Math.floor(t) % 86400) + 86400) % 86400;
  return `${String(Math.floor(d / 3600)).padStart(2, '0')}:${String(Math.floor((d % 3600) / 60)).padStart(2, '0')}`;
}

export function clock(t) {
  const d = ((Math.floor(t) % 86400) + 86400) % 86400;
  return `Day ${Math.floor(t / 86400) + 1} · ${hhmm(t)}:${String(d % 60).padStart(2, '0')} IST`;
}

export function panel(tab, w, ui) {
  if (tab === 'board') return boardPanel(w, ui);
  if (tab === 'term') return terminalsPanel(w, ui);
  if (tab === 'proj') return projectsPanel(w);
  if (tab === 'ops') return opsPanel(w, ui);
  if (tab === 'fin') return financePanel(w);
  return logPanel(w);
}

// ---- flight board -----------------------------------------------------------------------------

function boardPanel(w, ui) {
  const view = ui.boardView ?? 'board';
  const tabs = `<div class="seg" role="tablist">${[['board', 'Flight board'], ['airlines', 'Airlines']].map(([id, label]) => `<button role="tab" data-action="boardView" data-arg="${id}" class="${view === id ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  if (view === 'airlines') return tabs + airlinesView(w, ui);
  const only = ui.airline ?? null;
  const by = ui.group ?? 'none';
  const { arrivals: allArr, departures: allDep } = w.board();
  const arrivals = allArr.filter((f) => !only || f.airline === only);
  const departures = allDep.filter((f) => !only || f.airline === only);
  const row = (f, arr) => {
    const sched = arr ? f.sta : f.std;
    const est = arr ? (f.slot ? f.slot + 300 : f.sta + f.inboundDelay) : f.offBlock ?? Math.max(f.std, w.t);
    const late = est - sched > 5 * 60;
    const stand = f.standId !== null ? w.standById.get(f.standId)?.ref : '–';
    return `<tr data-row="${f.id}" class="${f.phase}" tabindex="0">
      <td>${hhmm(sched)}${late ? ` <i>${hhmm(est)}</i>` : ''}</td>
      <td class="fl">${badge(f.airline, 'sm')} <b>${esc(arr ? f.arrNo : f.depNo)}</b>${f.service ? ` <small class="svc ${f.service}">${f.service === 'cargo' ? 'Cargo' : 'GA'}</small>` : ''}</td>
      <td>${esc(cityName(arr ? f.from : f.to))}</td>
      <td>${f.type}</td><td>${esc(stand ?? '–')}</td>
      <td class="st">${esc(statusText(f, arr))}</td></tr>`;
  };
  const head = (to) => `<tr><th>Time</th><th>Flight</th><th>${to}</th><th>Type</th><th>Stand</th><th>Status</th></tr>`;
  const none = (title) => `<h3>${title}</h3><p class="muted">No ${only ? `${esc(brandOf(only).name)} ` : ''}flights.</p>`;
  const table = (title, list, arr, to) => (list.length ? `<h3>${title}</h3><table class="fids">${head(to)}${groupedRows(list, by, (f) => row(f, arr))}</table>` : none(title));
  return `${tabs}${boardControls(ui)}${table('Arrivals', arrivals, true, 'From')}${table('Departures', departures, false, 'To')}`;
}

function statusText(f, arr) {
  if (f.phase === 'diverted') return 'Diverted';
  if (f.phase === 'cancelled') return 'Cancelled';
  if (arr) {
    if (f.phase === 'scheduled') return f.inboundDelay > 600 ? 'Delayed' : 'Scheduled';
    if (f.phase === 'holding') return f.waiting ? `Holding: ${f.waiting}` : 'Holding';
    if (['inbound', 'final'].includes(f.phase)) return `Landing ${hhmm(f.slot)}`;
    if (['landing', 'taxiIn'].includes(f.phase)) return 'Landed';
    return 'On stand';
  }
  if (f.phase === 'atStand') return f.waiting ?? (f.tasks?.find((t) => t.id === 'board' && t.state === 'work') ? 'Boarding' : 'Turnaround');
  if (f.phase === 'departed') return 'Departed';
  return f.waiting ?? PHASE_LABEL[f.phase];
}

// ---- terminals ---------------------------------------------------------------------------------

const STEPS = { checkin: [4, 8, 16], security: [1, 2, 4], immigration: [4, 8, 16], arrImm: [4, 8, 16], reclaim: [1, 2] };
const waitClass = (m, opt) => (m < opt * 0.8 ? 'ok' : m < opt * 1.6 ? 'mid' : 'bad');

function chart(demand, capacity) {
  const max = Math.max(capacity, ...demand, 1) * 1.08;
  const bars = demand.map((d, i) => {
    const h = Math.max(0.5, (d / max) * 26);
    return `<rect x="${i * 14 + 1}" y="${28 - h}" width="11" height="${h}" class="${d > capacity ? 'over' : 'fit'}"/>`;
  }).join('');
  const y = 28 - (capacity / max) * 26;
  return `<svg class="chart" viewBox="0 0 168 30" role="img" aria-label="Expected passengers per hour for the next 12 hours against capacity">${bars}<line x1="0" x2="168" y1="${y}" y2="${y}"/></svg>`;
}

function terminalAirlines(w, id) {
  const codes = [...new Set(w.flights.filter((f) => !['departed', 'cancelled', 'diverted'].includes(f.phase) && w.term.termFor(f) === id).map((f) => f.airline))];
  return codes.map((c) => badge(c, 'sm')).join(' ') || '<span class="muted">none scheduled</span>';
}

function terminalsPanel(w, ui) {
  const L = w.term.list;
  const T = L[ui.term] ?? L.T1;
  const plan = ui.planMode ? w.term.previewPlan(ui.plan) : null;
  const tabs = Object.values(L).map((t) => `<button data-action="term" data-arg="${t.id}" class="${t.id === T.id ? 'on' : ''}" ${t.open ? '' : 'title="Locked: complete its project first"'}>${t.open ? '' : '🔒 '}${t.short ?? t.id}</button>`).join('');
  const shifts = Object.entries(SHIFTS).map(([id, s]) => `<button data-action="shift" data-arg="${id}" class="${w.term.shift === id ? 'on' : ''}">${esc(s.label)}</button>`).join('');
  const staff = Object.entries(DEPTS).map(([id, d]) => {
    const n = w.term.dutyNow?.[id];
    const short = n && n.need > n.duty;
    return `<tr class="${short ? 'short' : ''}"><td>${esc(d.label)}</td><td>${w.term.staff[id]}</td><td>${n ? `${n.duty} on duty · ${n.need} wanted` : '–'}</td>
      <td class="buy"><button data-action="hire" data-arg="${id}:10" title="${fmtCr(d.hire * 10)} to hire, ${fmtCr(d.wage * 10)} per day">+10</button><button data-action="hire" data-arg="${id}:25">+25</button><button data-action="hire" data-arg="${id}:-10">−10</button></td></tr>`;
  }).join('');
  const bulk = ['checkin', 'security', 'immigration', 'reclaim'].map((k) => {
    const next = Math.min(...Object.values(L).filter((t) => t.open && t.proc[k]).map((t) => t.proc[k].tier)) + 1;
    return next > 2 ? '' : `<button data-action="upgradeAll" data-arg="${k}" title="Upgrade every open terminal to this technology">All ${PROCESSES[k].label.toLowerCase()} → ${esc(PROCESSES[k].tiers[next].toLowerCase())}</button>`;
  }).join('');

  let body;
  if (!T.open) {
    const pr = PROJECTS[T.locked];
    body = `<p class="muted">${esc(T.name)} is not open yet. ${pr ? `Complete <b>${esc(pr.name)}</b> in the Projects tab.` : ''}</p>`;
  } else {
    const built = T.builds.map((b) => `<li>${b.kind === 'add' ? `+${b.n} ${esc(PROCESSES[b.proc].unit)}${b.n > 1 ? 's' : ''} (${esc(PROCESSES[b.proc].label.toLowerCase())})` : b.kind === 'tier' ? `${esc(PROCESSES[b.proc].label)} upgrade` : `+${b.n} retail pod${b.n > 1 ? 's' : ''}`} · ready ${hhmm(b.finishAt)}</li>`).join('');
    const procs = Object.entries(T.proc).map(([key, P]) => {
      const def = PROCESSES[key];
      const wait = w.term.estWait(T, key);
      const rate = w.term.rate(T, key);
      const dial = Object.entries(DIALS).map(([id, label]) => `<button data-action="dial" data-arg="${T.id}:${key}:${id}" class="${P.dial === id ? 'on' : ''}">${label}</button>`).join('');
      const adds = STEPS[key].map((n) => `<button data-action="add" data-arg="${T.id}:${key}:${n}" title="${fmtCr(n * def.addCost)}, ready in ${25 + 7 * n} min">+${n}</button>`).join('');
      const nextTier = P.tier < 2 ? `<button data-action="tier" data-arg="${T.id}:${key}" title="Upgrades all ${P.positions} ${def.unit}s">→ ${esc(def.tiers[P.tier + 1])} (${fmtCr(P.positions * def.upCost[P.tier + 1])})</button>` : '<span class="muted">best technology</span>';
      return `<div class="proc">
        <div class="proc-h"><b>${esc(def.label)}</b><small>${esc(def.tiers[P.tier])}</small><span class="wait ${waitClass(wait, def.opt)}">${wait < 1 ? '<1' : Math.round(wait)} min</span></div>
        <div class="proc-b"><span>${P.open}/${P.positions} ${def.unit}s open${P.short > 0 ? ` <i class="bad">(${P.short} short of staff)</i>` : ''}</span><span>${Math.round(P.qn)} waiting</span><span>${Math.round(P.positions * rate)}/h capacity</span></div>
        ${chart(w.term.forecast(T.id, key, 12), P.positions * rate)}
        <div class="proc-a"><span class="lbl">Staffing</span>${dial}</div>
        <div class="proc-a"><span class="lbl">Add ${def.unit}s</span>${adds}<span class="gap"></span>${nextTier}</div>
      </div>`;
    }).join('');
    const pods = [2, 4].map((n) => `<button data-action="retail" data-arg="${T.id}:${n}" title="${fmtCr(n * 5e5)}">+${n}</button>`).join('');
    body = `<div class="term-h"><b>${esc(T.name)}</b> <span class="wait ${T.score > 85 ? 'ok' : T.score > 65 ? 'mid' : 'bad'}">service ${Math.round(T.score)} %</span>
      <span class="muted">${Math.round(T.airside)} passengers airside · retail ${T.retail.pods}/${T.retail.cap} pods</span> ${pods}</div>
      <p class="airl"><span class="lbl">Airlines here</span> ${terminalAirlines(w, T.id)}</p>
      ${procs}
      ${built ? `<h3>Under construction</h3><ul class="builds">${built}</ul>` : ''}
      <h3>Layout code <small>(copy it, then stamp it onto another terminal)</small></h3>
      <div class="row-actions"><button data-action="copyLayout" data-arg="${T.id}">Copy ${esc(T.short ?? T.id)} layout code</button>
        <input id="layoutCode" type="text" placeholder="Paste a layout code" aria-label="Layout code" autocomplete="off"><button data-action="applyLayout" data-arg="${T.id}">Apply to ${esc(T.short ?? T.id)}</button></div>`;
  }

  const planBox = ui.planMode ? `<div class="plan"><h3>Plan <small>(nothing is built until you press Build all)</small></h3>
    ${plan.items.length ? `<ul>${plan.items.map((i) => `<li class="${i.ok ? '' : 'bad'}">${describeOp(i.op, w)} ${i.ok ? `· ${fmtCr(i.cost)}` : `· ${esc(i.why)}`}</li>`).join('')}</ul>
      <p>Total <b>${fmtCr(plan.cost)}</b> · ready in <b>${Math.round(plan.minutes)} min</b> · you have ${fmtCr(w.money)}</p>
      <div class="row-actions"><button data-action="buildPlan" ${plan.ok ? '' : 'disabled'}>Build all</button><button data-action="clearPlan">Clear</button></div>` : '<p class="muted">Use the +, → and bulk-upgrade buttons to stage changes.</p>'}</div>` : '';

  return `<div class="row-actions"><button data-action="planMode" class="${ui.planMode ? 'on' : ''}" aria-pressed="${ui.planMode}">Plan mode ${ui.planMode ? 'on' : 'off'}</button>${shifts}</div>
    ${planBox}
    <h3>Staff <small>(shifts: ${esc(SHIFTS[w.term.shift].label)})</small></h3><table class="fleet">${staff}</table>
    ${bulk ? `<h3>Upgrade planner</h3><div class="row-actions">${bulk}</div>` : ''}
    <div class="seg term-tabs">${tabs}</div>${body}`;
}

export function describeOp(op, w) {
  const T = w.term.list[op.term];
  if (op.kind === 'retail') return `${T.short} +${op.n} retail pods`;
  const def = PROCESSES[op.proc];
  if (op.kind === 'add') return `${T.short} +${op.n} ${def.label.toLowerCase()} ${def.unit}s`;
  if (op.kind === 'tier') return `${T.short} ${def.label.toLowerCase()} → ${def.tiers[op.to ?? T.proc[op.proc].tier + 1].toLowerCase()}`;
  return `${T.short} ${op.kind}`;
}

// ---- projects ----------------------------------------------------------------------------------

function projectsPanel(w) {
  const cards = Object.entries(PROJECTS).map(([id, p]) => {
    const st = w.projects[id];
    const needs = p.needs.filter((n) => w.projects[n].state !== 'done');
    const pct = st.state === 'building' ? Math.min(100, ((w.t - st.startedAt) / (st.finishAt - st.startedAt)) * 100) : st.state === 'done' ? 100 : 0;
    const action = st.state === 'idle'
      ? `<button data-action="project" data-arg="${id}" ${needs.length ? 'disabled' : ''}>Start · ${fmtCr(p.cost)} · ${p.hours} h</button>${needs.length ? `<span class="muted">needs ${esc(PROJECTS[needs[0]].name)}</span>` : ''}`
      : st.state === 'building' ? `<span>Ready at ${hhmm(st.finishAt)} (${Math.round(pct)} %)</span>` : '<span class="ok">Complete</span>';
    return `<div class="card-p ${st.state}"><b>${esc(p.name)}</b><p>${esc(p.story)}</p><p class="eff">${esc(p.effect)}</p><i class="bar-p" style="--p:${pct}%"></i><div class="row-actions">${action}</div></div>`;
  }).join('');
  const perks = w.perks.length ? `<h3>Policies adopted</h3><ul class="obj">${w.perks.map((id) => `<li class="ok">✔ ${esc(PERKS[id].label)} <b>${esc(PERKS[id].text)}</b></li>`).join('')}</ul>` : '';
  return `<p class="muted">Costs and build times are scaled for play: a real terminal takes years. Money: <b>${formatINR(w.money)}</b>.</p>${cards}${perks}`;
}

// ---- operations --------------------------------------------------------------------------------

// Who is out on the apron right now, by job.
function staffNow(w) {
  const count = {};
  for (const p of w.staffSprites()) count[p.role] = (count[p.role] ?? 0) + 1;
  const parts = Object.entries(count).sort((a, b) => b[1] - a[1]).map(([role, n]) => `<span class="chip2 on"><i class="vest" style="--v:${ROLES[role]?.vest ?? '#999'}"></i>${n} ${esc((ROLES[role]?.label ?? role).toLowerCase())}${n > 1 ? 's' : ''}</span>`);
  const bridges = w.jetBridgeSprites();
  const docked = bridges.filter((b) => b.state === 'docked').length;
  const moving = bridges.filter((b) => b.state === 'docking' || b.state === 'retracting').length;
  return `<p class="muted fine">On the apron now:</p><div class="chips2">${parts.join('') || '<span class="muted">nobody</span>'}</div>
    <p class="muted fine">Jet bridges: ${docked} docked, ${moving} moving, ${bridges.length - docked - moving} parked of ${bridges.length}.</p>`;
}

function opsPanel(w, ui) {
  const k = w.kpi;
  const objectives = w.objectives();
  const fleet = Object.entries(GSE).map(([kind, g]) => {
    const p = w.pool[kind];
    const free = p.total - p.busy - p.broken;
    return `<tr class="${free <= 0 ? 'short' : ''}"><td>${esc(g.label)}</td><td>${p.busy}/${p.total}${p.broken ? ` <i>(${p.broken} broken)</i>` : ''}</td>
      <td class="buy"><button data-action="buy" data-arg="${kind}:1" title="${formatINR(g.price)} each">+1</button><button data-action="buy" data-arg="${kind}:5" title="${formatINR(g.price * 5)}">+5</button><button data-action="sell" data-arg="${kind}:1" title="Sell one at half price">−1</button></td></tr>`;
  }).join('');
  const other = Object.keys(w.frame.ends).find((d) => d !== w.active);
  const live = ui.live ?? {};
  const toggle = (action, on, label, note = '') => `<button data-action="${action}" class="${on ? 'on' : ''}" aria-pressed="${Boolean(on)}">${label}: ${on ? 'on' : 'off'}</button>${note ? `<small class="muted">${esc(note)}</small>` : ''}`;
  return `
    ${weatherPanel(w)}
    ${objectives ? `<h3>Objectives</h3><ul class="obj">${objectives.map((o) => `<li class="${o.ok ? 'ok' : 'bad'}">${o.ok ? '✔' : '✖'} ${esc(o.label)} <b>${esc(o.value)}</b></li>`).join('')}</ul>` : ''}
    <h3>Today</h3>
    <div class="kpis">
      <span>Arrivals <b>${k.arrivals}</b></span><span>Departures <b>${k.departures}</b></span>
      <span>Avg delay <b>${k.departures ? Math.round(k.depDelaySum / k.departures / 60) : 0} min</b></span>
      <span>Go-arounds <b>${k.goArounds}</b></span><span>Diversions <b>${k.diversions}</b></span><span>Cancelled <b>${k.cancellations}</b></span>
      <span>Revenue <b>${formatINR(k.revenue)}</b></span><span>Costs <b>${formatINR(k.costs)}</b></span>
      <span>Avg security wait <b>${w.avgWait('security').toFixed(1)} min</b></span><span>Satisfaction <b>${Math.round(w.satisfaction())}</b></span>
    </div>
    <h3>Runway ${w.active}</h3>
    <div class="row-actions">
      <button data-action="switchRunway">Switch to ${other}</button>
      ${w.runwayClosed() ? '<button data-action="reopenRunway">Reopen runway</button>' : '<button data-action="inspectRunway">Close 15 min (inspection)</button>'}
    </div>
    <h3>Real world</h3>
    <div class="row-actions">
      ${toggle('liveWeather', w.liveWeather, 'Real weather', live.weather ?? 'Open-Meteo, METAR when available')}
      <small class="muted">Real weather and Live Watch follow the real clock: they match the game exactly at 1× speed.</small>
      ${toggle('autoRunway', w.autoRunway, 'Runway follows wind')}
      ${toggle('liveTraffic', live.trafficOn, 'Live Watch', live.traffic ?? 'real aircraft near Chennai (needs the proxy)')}
      ${toggle('voice', ui.voice, 'ATC voice')}
      ${toggle('sound', ui.sound, 'Sound', 'wind, rain, aircraft and vehicles: zoom in to hear them')}
    </div>
    <h3>Ground crews</h3>
    <table class="fleet"><tr class="${w.crews.busy >= w.crews.total ? 'short' : ''}"><td>${esc(CREW.label)}</td><td>${w.crews.busy}/${w.crews.total}</td>
      <td class="buy"><button data-action="hire" data-arg="crew:5" title="${formatINR(CREW.hireCost * 5)} to hire, ${formatINR(CREW.dayCost)} per crew per day">+5</button><button data-action="hire" data-arg="crew:-1">−1</button></td></tr></table>
    ${staffNow(w)}
    <h3>Ground equipment <small>(in use / owned)</small></h3>
    <table class="fleet">${fleet}</table>`;
}

function logPanel(w) {
  if (!w.log.length) return '<p class="muted">No alerts yet.</p>';
  return `<ul class="log">${w.log.map((l) => `
    <li class="${l.level}"><time>${hhmm(l.t)}</time> ${esc(l.text)}
      ${l.target ? `<button data-jump='${JSON.stringify(l.target)}'>Show</button>` : ''}</li>`).join('')}</ul>`;
}

// ---- selection panel ---------------------------------------------------------------------------

export function selectionPanel(w, sel, ui = null) {
  if (sel.type === 'flight') return flightPanel(w, sel.id, ui);
  if (sel.type === 'stand') return standPanel(w, sel.id);
  if (sel.type === 'runway') return runwayPanel(w);
  if (sel.type === 'info') return `<button class="x" data-close aria-label="Close">×</button><h2>${esc(sel.info.title)}</h2>${sel.info.lines.map((l) => `<p>${esc(l)}</p>`).join('')}`;
  return '';
}

function flightPanel(w, id, ui) {
  const f = w.flights.find((x) => x.id === id);
  if (!f) return '';
  const canChangeStand = ['scheduled', 'holding', 'inbound', 'final'].includes(f.phase);
  const canCancel = ['scheduled', 'holding', 'inbound'].includes(f.phase);
  return `
    <button class="x" data-close aria-label="Close">×</button>
    <h2 class="fh">${badge(f.airline, 'lg')} ${esc(f.arrNo)} / ${esc(f.depNo)}</h2>
    <p class="sub"><b>${esc(nameOf(f))}</b> · ${esc(f.intl ? 'international' : 'domestic')}${f.service === 'cargo' ? ' · cargo' : f.service === 'ga' ? ' · general aviation' : ''}</p>
    <p class="muted">${airlineLine(f.airline)}</p>
    ${flightDetails(w, f, ui)}
    <div class="row-actions">
      <button data-action="follow" data-arg="${f.id}">🎥 Follow</button>
      ${!f.priority && !['departed', 'diverted', 'cancelled'].includes(f.phase) ? `<button data-action="prioritise" data-arg="${f.id}" title="₹50,000: faster turnaround, first in the departure queue">⚡ Prioritise</button>` : ''}
      ${canChangeStand ? `<button data-action="pickStand" data-arg="${f.id}">Change stand</button>` : ''}
      ${canCancel ? `<button data-action="cancelFlight" data-arg="${f.id}" class="danger">Cancel</button>` : ''}
    </div>`;
}

function standPanel(w, id) {
  const s = w.standById.get(id);
  if (!s) return '';
  const occupant = s.occupant !== null ? w.flights.find((f) => f.id === s.occupant) : null;
  const next = s.bookings.filter((b) => b.flightId !== s.occupant).sort((a, b) => a.from - b.from)[0];
  const nextFlight = next ? w.flights.find((f) => f.id === next.flightId) : null;
  const sizes = Object.keys(AIRCRAFT_TYPES).filter((t) => s.fits[t]).map((t) => AIRCRAFT_TYPES[t].name.replace(/^(Airbus|Boeing|De Havilland) /, ''));
  const kind = { dom: 'Domestic terminal', intl: 'International terminal', mixed: 'Terminal 3 (domestic and international)', remote: 'Remote apron' }[s.kind];
  return `
    <button class="x" data-close aria-label="Close">×</button>
    <h2>Stand ${esc(s.ref)}</h2>
    <p class="sub">${kind} · ${s.contact ? 'Jet bridge' : 'Bus boarding'}${s.wideCapable ? ' · Wide-body capable' : ''}</p>
    <p>${s.closed ? '<b class="bad">Closed</b>' : occupant ? `Occupied by ${badge(occupant.airline, 'sm')} <b>${esc(occupant.depNo)}</b> (${occupant.type})` : 'Free'}</p>
    ${nextFlight ? `<p>Next: ${badge(nextFlight.airline, 'sm')} ${esc(nextFlight.arrNo)} (${nextFlight.type}) around ${hhmm(next.from + 300)}</p>` : ''}
    <p class="muted">Fits: ${sizes.length === Object.keys(AIRCRAFT_TYPES).length ? `all ${sizes.length} aircraft types` : sizes.length ? sizes.join(', ') : 'nothing (no mapped apron here)'}</p>
    <div class="row-actions"><button data-action="toggleStand" data-arg="${s.id}">${s.closed ? 'Reopen stand' : 'Close stand'}</button></div>`;
}

function runwayPanel(w) {
  const { head, cross } = w.windComponents();
  const arrivals = w.flights.filter((f) => ['inbound', 'final'].includes(f.phase)).sort((a, b) => a.slot - b.slot).slice(0, 5);
  const queue = w.flights.filter((f) => f.phase === 'holdShort').length;
  const closure = w.closures[0];
  const other = Object.keys(w.frame.ends).find((d) => d !== w.active);
  return `
    <button class="x" data-close aria-label="Close">×</button>
    <h2>Runway 07/25 · ${w.active} in use</h2>
    <p class="sub">3,661 m × 45 m · ILS CAT I both ends</p>
    <p>Wind ${String(w.wind.from).padStart(3, '0')}° at ${w.wind.kt} kt · headwind ${Math.round(head)} kt · crosswind ${Math.round(cross)} kt</p>
    ${closure ? `<p class="warn">Closed until ${hhmm(closure.to)}: ${esc(closure.reason)}</p>` : ''}
    <p>Departure queue: <b>${queue}</b> · Next landings: ${arrivals.map((f) => `${esc(f.arrNo)} ${hhmm(f.slot)}`).join(', ') || 'none'}</p>
    <div class="row-actions">
      <button data-action="switchRunway">Switch to ${other}</button>
      ${closure ? '<button data-action="reopenRunway">Reopen</button>' : '<button data-action="inspectRunway">Close 15 min</button>'}
    </div>`;
}

export { TERMINAL_DEFS, PROC_ORDER };
