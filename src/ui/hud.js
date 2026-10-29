// HTML game interface: top bar, side panel, selection panel, toasts, menu and day report.
// Re-rendered a few times a second from the World; markup is only replaced when it changed, and
// never while the player is typing in a field.
import { formatINR } from '../sim/world.js';
import { reportAirlines } from './airlines.js';
import { weatherChip, reportWeather } from './weatherUi.js';
import { SCENARIOS } from '../sim/scenarios.js';
import { PERKS, PROCESSES, fmtCr } from '../sim/terminal.js';
import { panel, selectionPanel, clock, esc } from './panels.js';

const SPEEDS = [0, 1, 5, 20, 60];
const TABS = [['board', 'Flights', 'F'], ['term', 'Terminals', 'T'], ['proj', 'Projects', 'P'], ['ops', 'Operations', 'O'], ['log', 'Alerts', 'L']];

const selectionKey = (sel) => (sel ? `${sel.type}:${sel.id ?? ''}` : '');
let lastInfoKey = '';

export function createHud(root, cb) {
  root.innerHTML = `
    <header class="bar" role="toolbar" aria-label="Game controls">
      <div class="brand">Runway City <span>MAA</span></div>
      <div class="clock" data-clock aria-live="off">--:--</div>
      <div class="group" role="group" aria-label="Game speed">${SPEEDS.map((s) => `<button data-speed="${s}" aria-label="${s ? `${s} times speed` : 'Pause'}" title="${s ? `${s}× speed (key ${SPEEDS.indexOf(s) + 0 || ''})` : 'Pause (Space)'}">${s === 0 ? '❚❚' : `${s}×`}</button>`).join('')}</div>
      <div class="stats" data-stats></div>
      <div class="group tabs" role="group" aria-label="Panels">
        ${TABS.map(([id, label, key]) => `<button data-tab="${id}" title="${label} (${key})">${label}${id === 'log' ? ' <b data-alerts></b>' : ''}</button>`).join('')}
        <button data-action="menu" aria-label="Menu" title="Menu: scenarios, save, load">☰</button>
      </div>
      <div class="group" role="group" aria-label="Map">
        <button data-zoom="1.5" aria-label="Zoom in" title="Zoom in (+)">+</button>
        <button data-zoom="0.667" aria-label="Zoom out" title="Zoom out (−)">−</button>
        <button data-home aria-label="Show the whole airport" title="Whole airport">⌂</button>
      </div>
    </header>
    <aside class="panel" data-panel hidden></aside>
    <aside class="info" data-info hidden></aside>
    <div class="banner" data-banner hidden></div>
    <div class="toasts" data-toasts aria-live="polite"></div>
    <div class="modal" data-modal hidden role="dialog" aria-modal="true"></div>
    <p class="help">Drag to move · Wheel or pinch to zoom · Click aircraft, stands, terminals or the runway · Space pauses</p>
    <footer class="credits" data-credits></footer>
  `;
  const $ = (sel) => root.querySelector(sel);
  let tab = null;
  let seenAlerts = 0;
  let lastPanel = '';
  let lastInfo = '';

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button, [data-row]');
    if (!b || b.disabled) return;
    const d = b.dataset;
    if (d.speed !== undefined) cb.onSpeed(Number(d.speed));
    else if (d.zoom) cb.onZoom(Number(d.zoom));
    else if (d.home !== undefined) cb.onHome();
    else if (d.tab) api.openTab(tab === d.tab ? null : d.tab);
    else if (d.action) cb.onAction(d.action, d.arg);
    else if (d.pick) cb.onAction('scenario', d.pick);
    else if (d.row) cb.onSelect({ type: 'flight', id: Number(d.row) }, true);
    else if (d.jump) cb.onJump(JSON.parse(d.jump));
    else if (d.close !== undefined) cb.onSelect(null);
  });
  root.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-row]')) {
      e.preventDefault();
      cb.onSelect({ type: 'flight', id: Number(e.target.dataset.row) }, true);
    }
  });
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-import]') && e.target.files?.[0]) cb.onAction('import', e.target.files[0]);
  });

  const typing = (el) => el.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

  const api = {
    openTab(name) {
      tab = name;
      root.querySelectorAll('[data-tab]').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
      $('[data-panel]').hidden = !tab;
      lastPanel = '';
      cb.onRefresh();
    },

    get tab() {
      return tab;
    },

    setSpeed(speed) {
      root.querySelectorAll('[data-speed]').forEach((b) => {
        const on = Number(b.dataset.speed) === speed;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
    },

    toast(message, ok = true) {
      const el = document.createElement('div');
      el.className = `toast ${ok ? 'ok' : 'bad'}`;
      el.textContent = message;
      const box = $('[data-toasts]');
      box.prepend(el);
      while (box.children.length > 3) box.lastChild.remove(); // never a wall of messages
      setTimeout(() => el.remove(), 3600);
    },

    banner(text) {
      const el = $('[data-banner]');
      el.hidden = !text;
      if (text) el.innerHTML = `${esc(text)} <button data-action="cancelPick">Cancel</button>`;
    },

    credits(extra = []) {
      $('[data-credits]').innerHTML = ['Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>', ...extra, 'Airline names are factual references only · Unofficial fan project, not affiliated with AAI or any airline'].join(' · ');
    },

    // Menu: continue a save, start a scenario, save / export / import.
    showMenu({ saved, current, daily, canClose, weatherMode = 'random' }) {
      const m = $('[data-modal]');
      m.hidden = false;
      m.dataset.kind = 'menu';
      const card = (id, s, extra = '') => `<button class="card ${id === current ? 'current' : ''}" data-pick="${id}"><strong>${extra}${esc(s.name)}</strong><span>${esc(s.brief)}</span>${s.objectives ? `<em>Goal: ${Math.round(s.objectives.otp * 100)} % on time, ≤ ${s.objectives.maxDiversions} diversions${s.objectives.projects ? ', build ' + s.objectives.projects.length + ' projects' : ''}</em>` : '<em>No objectives</em>'}</button>`;
      m.innerHTML = `
        <div class="sheet" role="document">
          ${canClose ? '<button class="x" data-action="closeMenu" aria-label="Close menu">×</button>' : ''}
          <h1>Runway City <span>MAA</span></h1>
          <p class="lead">Run Chennai airport's real layout through a real-feeling day: every aircraft lands, taxis, is serviced and departs, and every passenger queues. You decide the stands, staff and expansion.</p>
          ${saved ? `<button class="card continue" data-action="continue"><strong>Continue your game</strong><span>${esc(saved.scenario)} · ${esc(clock(saved.t))} · ${formatINR(saved.money)}</span></button>` : ''}
          <div class="cards">
            ${daily ? card(daily, SCENARIOS[daily], '📅 Daily challenge: ') : ''}
            ${Object.entries(SCENARIOS).map(([id, s]) => card(id, s)).join('')}
          </div>
          <div class="row-actions">
            <button data-action="weatherMode" data-arg="${weatherMode === 'calm' ? 'random' : 'calm'}" title="Random: the season decides rain, fog and storms. Calm: clear skies only.">Weather: ${weatherMode === 'calm' ? 'calm' : 'random'}</button>
            ${canClose ? '<button data-action="saveNow">Save now</button>' : ''}
            ${canClose ? '<button data-action="exportSave">Export save file</button>' : ''}
            <label class="btn">Import save file<input type="file" accept=".json,application/json" data-import hidden></label>
          </div>
          <p class="muted keys">Keys: Space pause · 1–5 speed · F flights · T terminals · P projects · O operations · L alerts · Esc close</p>
        </div>`;
      m.querySelector('button, input')?.focus();
    },

    showReport(r) {
      const m = $('[data-modal]');
      m.hidden = false;
      m.dataset.kind = 'report';
      const wait = (k) => (r.waits[k] > 0.05 ? `${r.waits[k].toFixed(1)} min` : '–');
      m.innerHTML = `
        <div class="sheet" role="document">
          <h1>Day ${r.day} report <span>${esc(r.date)}</span></h1>
          <p class="lead">${esc(r.scenario)}</p>
          <div class="kpis big">
            <span>Departures <b>${r.departures}</b></span><span>On time <b>${Math.round(r.otp * 100)} %</b></span>
            <span>Average delay <b>${Math.round(r.avgDelayMin)} min</b></span><span>Satisfaction <b>${Math.round(r.satisfaction)}</b></span>
            <span>Passengers <b>${(r.paxOut + r.paxIn).toLocaleString('en-IN')}</b></span><span>Missed flights <b>${r.missedPax}</b></span>
            <span>Diversions <b>${r.diversions}</b></span><span>Cancellations <b>${r.cancellations}</b></span>
            <span>Revenue <b>${fmtCr(r.revenue)}</b></span><span>Costs <b>${fmtCr(r.costs)}</b></span>
            <span>Profit <b class="${r.profit >= 0 ? 'ok' : 'bad'}">${fmtCr(r.profit)}</b></span><span>Retail income <b>${fmtCr(r.retail)}</b></span>
          </div>
          <h3>Average waits</h3>
          <div class="kpis"><span>${PROCESSES.checkin.label} <b>${wait('checkin')}</b></span><span>${PROCESSES.security.label} <b>${wait('security')}</b></span><span>${PROCESSES.immigration.label} <b>${wait('immigration')}</b></span><span>${PROCESSES.arrImm.label} <b>${wait('arrImm')}</b></span><span>${PROCESSES.reclaim.label} <b>${wait('reclaim')}</b></span></div>
          ${r.causes.length ? `<h3>Main causes of delay</h3><ul class="obj">${r.causes.map(([c, n]) => `<li>${esc(c)} <b>${n}</b></li>`).join('')}</ul>` : ''}
          ${reportWeather(r.weather)}
          ${reportAirlines(r.airlines ?? [])}
          <h3>Adopt one policy</h3>
          <div class="cards">${r.offer.map((id) => `<button class="card" data-action="perk" data-arg="${id}"><strong>${esc(PERKS[id].label)}</strong><span>${esc(PERKS[id].text)}</span></button>`).join('')}</div>
          <div class="row-actions"><button data-action="perk" data-arg="">Continue without a policy</button><button data-action="copyResult">Copy result to share</button></div>
        </div>`;
      m.querySelector('button')?.focus();
    },

    hideModal() {
      const m = $('[data-modal]');
      m.hidden = true;
      m.innerHTML = '';
      delete m.dataset.kind;
    },

    get modalKind() {
      return $('[data-modal]').hidden ? null : $('[data-modal]').dataset.kind;
    },

    update(world, selection, speed, ui) {
      $('[data-clock]').textContent = clock(world.t);
      const k = world.kpi;
      const otp = k.departures ? Math.round((k.onTime / k.departures) * 100) : 100;
      const closed = world.runwayClosed();
      $('[data-stats]').innerHTML = `
        <span title="Money">${formatINR(world.money)}</span>
        <span title="On-time departures (within 15 min)">On time ${otp}%</span>
        <span title="Passenger satisfaction: flights and queues">☺ ${Math.round(world.satisfaction())}</span>
        <span class="${closed ? 'bad' : ''}" title="Active runway">RWY ${world.active}${closed ? ' CLOSED' : ''}</span>
        <span title="Wind${world.liveWeather ? ' (real)' : ''}${world.wind.gust ? `, gusting ${world.wind.gust} kt` : ''}">↘ ${String(world.wind.from).padStart(3, '0')}°/${world.wind.kt}${world.wind.gust ? `G${world.wind.gust}` : ''} kt</span>
        ${weatherChip(world)}`;
      const fresh = world.log.length - seenAlerts;
      $('[data-alerts]').textContent = fresh > 0 && tab !== 'log' ? fresh : '';
      if (tab === 'log') seenAlerts = world.log.length;
      const pEl = $('[data-panel]');
      if (tab && !typing(pEl)) {
        const html = panel(tab, world, ui);
        if (html !== lastPanel) {
          const top = pEl.scrollTop;
          pEl.innerHTML = html;
          pEl.scrollTop = top;
          lastPanel = html;
        }
      }
      const info = $('[data-info]');
      const html = selection ? selectionPanel(world, selection) : '';
      info.hidden = !html;
      if (html !== lastInfo) {
        const keep = info.scrollTop;
        const wasSame = lastInfoKey === selectionKey(selection);
        info.innerHTML = html;
        info.scrollTop = wasSame ? keep : 0; // keep your place while the same card refreshes
        lastInfo = html;
        lastInfoKey = selectionKey(selection);
      }
      this.setSpeed(speed);
    },
  };
  return api;
}
