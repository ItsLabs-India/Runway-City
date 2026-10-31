// Runway control: the plan for both runways, and one card per runway with its direction, role, state and
// traffic. Pure functions of the World; buttons carry data-action as everywhere else.
import { RUNWAY_MODES, RUNWAY_PLANS } from '../sim/world.js';
import { serviceTime } from '../sim/timing.js';
import { esc } from '../logos.js';

const hhmm = (t) => `${String(Math.floor((t % 86400) / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`;

// One line about what the runway is doing right now.
function stateLine(st) {
  if (st.mode === 'off') return '<span class="muted">Not in use: aircraft taxi across it freely</span>';
  if (st.closed) return `<span class="bad">Closed until ${hhmm(st.closure.to)}: ${esc(st.closure.reason)}</span>`;
  if (st.user) {
    const verb = { final: 'on short final', landing: 'landing', taxiIn: st.user.crossing ? 'crossing' : 'vacating', taxiOut: 'crossing', lineUp: 'lining up', takeoff: 'taking off' }[st.user.phase] ?? 'on the runway';
    return `<span class="warn">Occupied: ${esc(st.user.phase === 'takeoff' || st.user.phase === 'lineUp' ? st.user.depNo : st.user.arrNo)} ${verb}</span>`;
  }
  return '<span class="ok">Free</span>';
}

export function runwayCard(st) {
  const dirs = [st.active, st.other].sort().map((d) => `<button ${d === st.active ? 'class="on" disabled' : `data-action="switchRunway" data-arg="${st.ref}"`} title="${d === st.active ? `Runway ${d} in use` : `Switch to runway ${d}`}">${d}</button>`).join('');
  const modes = Object.entries(RUNWAY_MODES)
    .filter(([id]) => id !== 'off' || !st.wideBodies)
    .map(([id, label]) => `<button data-action="runwayMode" data-arg="${st.ref}:${id}" class="${st.mode === id ? 'on' : ''}" aria-pressed="${st.mode === id}">${label}</button>`).join('');
  const landing = st.mode === 'both' || st.mode === 'arr';
  const lifting = st.mode === 'both' || st.mode === 'dep';
  const next = st.next.map((f) => `${esc(f.arrNo)} ${hhmm(f.slot)}`).join(', ');
  const rules = [];
  if (!st.wideBodies) rules.push('Narrow-bodies and turboprops only');
  if (st.displaced) rules.push(`threshold displaced ${st.displaced} m`);
  if (st.mode !== 'off') {
    if (landing && st.usesCrossingArr) rules.push('landings interlock with the other runway');
    if (lifting && st.usesCrossingDep) rules.push('take-offs interlock with the other runway');
  }
  return `<div class="rwcard ${st.mode === 'off' ? 'off' : ''} ${st.closed ? 'closed' : ''}">
    <div class="rwhead"><b>${esc(st.ref)}</b><small>${Math.round(st.length).toLocaleString('en-IN')} m</small><div class="seg rwdir" role="group" aria-label="Direction of ${esc(st.ref)}">${dirs}</div></div>
    <div class="seg rwmodes" role="group" aria-label="Role of ${esc(st.ref)}">${modes}</div>
    <p class="rwstate">${stateLine(st)}</p>
    ${st.mode !== 'off' ? `<div class="kpis fd-grid">
      <span>Wind on ${esc(st.active)} <b>${st.head >= 0 ? `${Math.round(st.head)} kt head` : `${Math.round(-st.head)} kt tail`}, ${Math.round(st.cross)} kt cross</b></span>
      <span>Last hour <b>${st.lastHour} movements</b></span>
      <span>Today <b>${st.landings} landings, ${st.takeoffs} take-offs</b></span>
      <span>Waiting <b>${st.queue} to take off, ${st.crossing} to cross</b></span>
    </div>
    ${landing ? `<p class="fine">Next landings: ${next || 'none booked'}</p>` : ''}` : ''}
    ${rules.length ? `<p class="muted fine">${rules.join(' · ')}</p>` : ''}
    ${st.mode !== 'off' ? `<div class="row-actions">${st.closed ? `<button data-action="reopenRunway" data-arg="${st.ref}">Reopen</button>` : `<button data-action="inspectRunway" data-arg="${st.ref}">Close ${serviceTime(15)} min (inspection)</button>`}</div>` : ''}
  </div>`;
}

// The whole control: plan buttons, then a card per runway.
export function runwayControl(w) {
  const plans = Object.entries(RUNWAY_PLANS).map(([id, p]) => `<button data-action="runwayPlan" data-arg="${id}" class="${w.runwayPlan === id ? 'on' : ''}" aria-pressed="${w.runwayPlan === id}" title="${esc(p.text)}">${esc(p.label)}</button>`).join('');
  const current = RUNWAY_PLANS[w.runwayPlan];
  return `<div class="seg rwplans" role="group" aria-label="Runway plan">${plans}</div>
    <p class="muted fine">${current ? esc(current.text) : 'Custom plan'}. The runways meet just past the 30 end: landings on 07 and 12 stop short of that point and run at the same time; 25 and 30 traffic takes turns with the other runway.</p>
    ${w.runwayState().map(runwayCard).join('')}`;
}

// Card for one runway, from clicking it on the map.
export function runwayPanelFor(w, ref) {
  if (!ref) return `<button class="x" data-close aria-label="Close">×</button><h2>Runway control</h2>${runwayControl(w)}`;
  const st = w.runwayState().find((x) => x.ref === ref) ?? w.runwayState()[0];
  return `<button class="x" data-close aria-label="Close">×</button><h2>Runway ${esc(st.ref)}</h2><p class="sub">${esc(RUNWAY_MODES[st.mode])}${st.mode !== 'off' ? ` · ${esc(st.active)} in use` : ''}</p>${runwayCard(st)}`;
}
