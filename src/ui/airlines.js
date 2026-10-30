// Airline views for the side panel: grouped airlines with today's results, and the board's group /
// filter controls. Pure functions of the World and the UI state.
import { BRANDS, brandOf, groupBy, KIND_LABEL } from '../sim/brands.js';
import { badge, esc } from '../logos.js';

const pct = (x) => `${Math.round(x * 100)} %`;

// Freighters and general aviation show their operator (e.g. "Qatar Airways Cargo"), not the airline brand.
export const nameOf = (f) => (f.service ? f.airlineName : BRANDS[f.airline] ? BRANDS[f.airline].name : f.airlineName);

export function airlineLine(code) {
  const b = brandOf(code);
  return `${esc(b.group)}${b.alliance ? ` · ${esc(b.alliance)}` : ''} · ${esc(KIND_LABEL[b.kind])}`;
}

// Controls above the flight board: grouping and the active airline filter.
export function boardControls(ui) {
  const by = ui.group ?? 'none';
  const groupBtns = [['none', 'No grouping'], ['group', 'By group'], ['alliance', 'By alliance']]
    .map(([id, label]) => `<button data-action="boardGroup" data-arg="${id}" class="${by === id ? 'on' : ''}">${label}</button>`).join('');
  const only = ui.airline ?? null;
  const filter = only
    ? `<span class="chip">${badge(only, 'sm')} ${esc(brandOf(only).name)} <button data-action="boardAirline" data-arg="" aria-label="Show all airlines">×</button></span>`
    : '';
  return `<div class="seg sub">${groupBtns}${filter}</div>`;
}

// Rows of a board table, optionally split under group headers. `row(f)` renders one flight.
export function groupedRows(rows, by, row, columns = 6) {
  if (by === 'none') return rows.map(row).join('');
  return groupBy([...new Set(rows.map((f) => f.airline))], by).map((g) => {
    const mine = rows.filter((f) => g.codes.includes(f.airline));
    return `<tr class="grp"><td colspan="${columns}">${esc(g.name)} <small>${mine.length}</small></td></tr>${mine.map(row).join('')}`;
  }).join('');
}

// Every airline flying today, grouped by owner, alliance, business model or region, with its results.
export function airlinesView(w, ui) {
  const by = ui.agroup ?? 'group';
  const status = new Map();
  for (const f of w.flights) {
    const a = status.get(f.airline) ?? { upcoming: 0, active: 0 };
    if (f.phase === 'scheduled') a.upcoming++;
    else if (!['departed', 'cancelled', 'diverted'].includes(f.phase)) a.active++;
    status.set(f.airline, a);
  }
  const stat = (code) => w.airDay[code] ?? { dep: 0, onTime: 0, delay: 0, cancel: 0, divert: 0, pax: 0 };
  const codes = [...status.keys()].sort((x, y) => stat(y).dep - stat(x).dep || brandOf(x).name.localeCompare(brandOf(y).name));
  const modes = [['group', 'Group'], ['alliance', 'Alliance'], ['kind', 'Type'], ['region', 'Region']]
    .map(([id, label]) => `<button data-action="airlineGroup" data-arg="${id}" class="${by === id ? 'on' : ''}">${label}</button>`).join('');
  const groups = groupBy(codes, by).map((g) => {
    const dep = g.codes.reduce((n, c) => n + stat(c).dep, 0);
    const ok = g.codes.reduce((n, c) => n + stat(c).onTime, 0);
    const rows = g.codes.map((c) => {
      const b = brandOf(c);
      const st = stat(c);
      const s = status.get(c);
      const q = st.dep ? st.onTime / st.dep : 1;
      const result = st.dep
        ? `${st.dep} departed · <b class="${q >= 0.85 ? 'ok' : q >= 0.65 ? 'mid' : 'bad'}">${pct(q)}</b> on time · avg delay ${Math.round(st.delay / st.dep / 60)} min${st.cancel ? ` · ${st.cancel} cancelled` : ''}${st.divert ? ` · ${st.divert} diverted` : ''}`
        : 'no departures yet today';
      return `<button class="alrow" data-action="boardAirline" data-arg="${c}" title="Show ${esc(b.name)} on the flight board">
        ${badge(c, 'md')}
        <span class="alname"><b>${esc(b.name)}</b><small>${esc(KIND_LABEL[b.kind])} · ${esc(b.region)}${b.alliance ? ` · ${esc(b.alliance)}` : ''}</small></span>
        <span class="alstat"><span>${result}</span><small>${s.active} active · ${s.upcoming} to come</small></span>
      </button>`;
    }).join('');
    return `<section class="algroup"><h4>${esc(g.name)} <small>${g.codes.length} airline${g.codes.length > 1 ? 's' : ''}${dep ? ` · ${dep} departures · ${pct(ok / dep)} on time` : ''}</small></h4>${rows}</section>`;
  }).join('');
  return `<div class="seg sub"><span class="lbl">Group by</span>${modes}</div>${groups || '<p class="muted">No airlines scheduled.</p>'}
    <p class="muted fine">Brand colours and groups are approximate. Official logos are not bundled: put them in public/data/logos/ to show them here.</p>`;
}

// Day report: results by corporate group and by airline.
export function reportAirlines(airlines) {
  const rows = airlines.filter((a) => a.dep > 0 || a.cancel > 0);
  if (!rows.length) return '';
  const groups = groupBy(rows.map((a) => a.code), 'group').map((g) => {
    const list = rows.filter((a) => g.codes.includes(a.code));
    const dep = list.reduce((n, a) => n + a.dep, 0);
    const ok = list.reduce((n, a) => n + a.onTime, 0);
    const lines = list.map((a) => {
      const q = a.dep ? a.onTime / a.dep : 0;
      return `<li>${badge(a.code, 'sm')} ${esc(brandOf(a.code).name)} <b class="${q >= 0.85 ? 'ok' : q >= 0.65 ? 'mid' : 'bad'}">${a.dep ? pct(q) : '–'}</b> <small>${a.dep} dep${a.cancel ? ` · ${a.cancel} cancelled` : ''}</small></li>`;
    }).join('');
    return `<div class="rgroup"><h4>${esc(g.name)} <small>${dep ? `${pct(ok / dep)} on time` : ''}</small></h4><ul class="obj">${lines}</ul></div>`;
  }).join('');
  const ranked = rows.filter((a) => a.dep >= 3).map((a) => ({ ...a, q: a.onTime / a.dep })).sort((x, y) => y.q - x.q);
  const best = ranked[0];
  const worst = ranked.length > 1 ? ranked.at(-1) : null;
  const note = best ? `<p class="muted">Most punctual: <b>${esc(brandOf(best.code).name)}</b> (${pct(best.q)})${worst ? `. Least punctual: <b>${esc(brandOf(worst.code).name)}</b> (${pct(worst.q)})` : ''}.</p>` : '';
  return `<h3>Airlines</h3>${note}<div class="rgroups">${groups}</div>`;
}
