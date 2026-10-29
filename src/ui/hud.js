// HTML game interface: top bar, side panel, selection panel, toasts, menu and day report.
// Re-rendered a few times a second from the World; markup is only replaced when it changed, and
// never while the player is typing in a field.
import { formatINR } from '../sim/world.js';
import { reportAirlines } from './airlines.js';
import { weatherChip, reportWeather } from './weatherUi.js';
import { reportFinance } from './financeUi.js';
import { SCENARIOS } from '../sim/scenarios.js';
import { PERKS, PROCESSES, fmtCr } from '../sim/terminal.js';
import { panel, selectionPanel, clock, esc } from './panels.js';

const SPEEDS = [0, 1, 3, 10, 30, 60];
// [id, button label, key, panel title]
const TABS = [['board', 'Flights', 'F', 'Flights'], ['term', 'Terminals', 'T', 'Terminals'], ['proj', 'Projects', 'P', 'Projects'], ['ops', 'Ops', 'O', 'Operations'], ['fin', 'Finance', 'I', 'Finance and management'], ['log', 'Alerts', 'L', 'Alerts']];
const KEYS = [['Space', 'Pause / resume'], ['1 – 5', 'Speed: 1× real time, 3× normal, 10×, 30×, 60×'], ['F', 'Flights board and airlines'], ['T', 'Terminals: queues, staff, building'], ['P', 'Projects'], ['O', 'Operations: weather, lights, runway, vehicles, crews'], ['I', 'Finance and management'], ['L', 'Alerts'], ['M', 'Sound on / off'], ['H or ?', 'This help'], ['+ / −, wheel, pinch', 'Zoom'], ['Arrow keys, drag', 'Move the map'], ['Esc', 'Close the card, the panel or a dialog']];

// Panel title bar, and a row of jump links for long panels (one per section heading).
function decorate(tab, html) {
  const def = TABS.find((x) => x[0] === tab);
  const head = `<div class="ph"><h2>${def ? def[3] : ''}</h2><kbd title="Keyboard shortcut">${def ? def[2] : ''}</kbd><button class="x" data-action="openTab" data-arg="" aria-label="Close panel">×</button></div>`;
  if (html.includes('class="jump"')) return head + html;
  let n = 0;
  const heads = [];
  const body = html.replace(/<h3>([^<]+)/g, (m, title) => {
    const id = `sec-${tab}-${n++}`;
    heads.push([id, title.trim()]);
    return `<h3 id="${id}">${title}`;
  });
  const nav = heads.length >= 4 ? `<nav class="jump" aria-label="Sections">${heads.map(([id, title]) => `<button data-scroll="${id}">${title}</button>`).join('')}</nav>` : '';
  return head + nav + body;
}

const selectionKey = (sel) => (sel ? `${sel.type}:${sel.id ?? ''}` : '');
let lastInfoKey = '';

export function createHud(root, cb) {
  root.innerHTML = `
    <header class="bar" role="toolbar" aria-label="Game controls">
      <div class="brand">Runway City <span>MAA</span></div>
      <div class="clock" data-clock aria-live="off">--:--</div>
      <div class="group" role="group" aria-label="Game speed">${SPEEDS.map((s) => `<button data-speed="${s}" aria-label="${s ? `${s} times speed` : 'Pause'}" title="${s ? `${s === 1 ? 'Real time' : s === 3 ? 'Normal speed (3× real time)' : `${s}× real time`} (key ${SPEEDS.indexOf(s)})` : 'Pause (Space)'}">${s === 0 ? '❚❚' : `${s}×`}</button>`).join('')}</div>
      <div class="stats" data-stats></div>
      <div class="group tabs" role="group" aria-label="Panels">
        ${TABS.map(([id, label, key, title]) => `<button data-tab="${id}" title="${title} (${key})">${label}${id === 'log' ? ' <b data-alerts></b>' : ''}</button>`).join('')}
        <button data-action="menu" aria-label="Menu" title="Menu: scenarios, save, load">☰</button>
      </div>
      <div class="group" role="group" aria-label="Map">
        <button data-zoom="1.5" aria-label="Zoom in" title="Zoom in (+)">+</button>
        <button data-zoom="0.667" aria-label="Zoom out" title="Zoom out (−)">−</button>
        <button data-home aria-label="Show the whole airport" title="Whole airport">⌂</button>
        <button data-action="sound" data-sound aria-label="Sound" aria-pressed="false" title="Sound on / off (M). Zoom in to hear aircraft and vehicles">🔇</button>
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
    if (d.scroll) {
      root.querySelector(`#${d.scroll}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
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
      tab = name || null;
      try {
        localStorage.setItem('rc-tab', tab ?? '');
      } catch {
        // private mode
      }
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
    showMenu({ saved, current, daily, canClose, weatherMode = 'random', traffic = 0.5 }) {
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
            <span class="seg" role="group" aria-label="Traffic on a normal day">${[[0, 'Standard'], [0.5, '+50 %']].map(([v, label]) => `<button data-action="traffic" data-arg="${v}" class="${traffic === v ? 'on' : ''}" aria-pressed="${traffic === v}" title="Flights on a normal day: ${v ? `${label} more than standard` : 'the standard schedule'}. Applies to the next normal day you start.">${label}</button>`).join('')}</span><small class="muted">Traffic, normal day</small>
            ${canClose ? '<button data-action="saveNow">Save now</button>' : ''}
            ${canClose ? '<button data-action="exportSave">Export save file</button>' : ''}
            <label class="btn">Import save file<input type="file" accept=".json,application/json" data-import hidden></label>
          </div>
          <p class="muted keys">Keys: Space pause · 1–5 speed · F T P O I L panels · H help · Esc close <button data-action="help">Keys and tips</button></p>
        </div>`;
      m.querySelector('button, input')?.focus();
    },

    showHelp() {
      const m = $('[data-modal]');
      m.hidden = false;
      m.dataset.kind = 'help';
      m.innerHTML = `
        <div class="sheet help-sheet" role="document">
          <button class="x" data-action="closeHelp" aria-label="Close help">×</button>
          <h1>Keys and tips</h1>
          <table class="keys-table">${KEYS.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('')}</table>
          <h3>Tips</h3>
          <ul class="obj">
            <li>Click the money, on-time, satisfaction or runway figures in the top bar to jump to where you manage them.</li>
            <li>Click any aircraft, stand, terminal or the runway for its card; the flight card shows live data and the whole turnaround.</li>
            <li>Long panels have section links at the top. Finance shows where every rupee comes from and goes.</li>
            <li>The game runs at 3× real time; use 1× to watch closely, 30× or 60× to skip quiet hours.</li>
            <li>Weather can be set to calm in the menu or the Operations panel if storms make a busy day too hard.</li>
          </ul>
        </div>`;
      m.querySelector('button')?.focus();
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
          ${reportFinance(r.finance)}
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
      $('[data-clock]').textContent = clock(world.t).replace(/([0-9]{2}:[0-9]{2}):[0-9]{2}/, '$1'); // minutes are enough at 3x and faster
      const k = world.kpi;
      const otp = k.departures ? Math.round((k.onTime / k.departures) * 100) : 100;
      const closed = world.runwayClosed();
      $('[data-stats]').innerHTML = `
        <button class="stat money ${world.money < 0 ? 'bad' : ''}" data-action="openTab" data-arg="fin" title="Cash. Open Finance (I)">${formatINR(world.money)}</button>
        <button class="stat" data-action="openTab" data-arg="board" title="On-time departures (within 15 min). Open the flight board (F)">⏱ ${otp}%</button>
        <button class="stat ${world.satisfaction() < 50 ? 'bad' : ''}" data-action="openTab" data-arg="term" title="Passenger satisfaction: flights and queues. Open Terminals (T)">☺ ${Math.round(world.satisfaction())}</button>
        <button class="stat ${closed ? 'bad' : ''}" data-jump='{"runway":true}' title="Active runway. Show the runway">RWY ${world.active}${closed ? ' CLOSED' : ''}</button>
        <span title="Wind${world.liveWeather ? ' (real)' : ''}${world.wind.gust ? `, gusting ${world.wind.gust} kt` : ''}">↘ ${String(world.wind.from).padStart(3, '0')}°/${world.wind.kt}${world.wind.gust ? `G${world.wind.gust}` : ''} kt</span>
        ${weatherChip(world)}`;
      const fresh = world.log.length - seenAlerts;
      $('[data-alerts]').textContent = fresh > 0 && tab !== 'log' ? fresh : '';
      if (tab === 'log') seenAlerts = world.log.length;
      const pEl = $('[data-panel]');
      if (tab && !typing(pEl)) {
        const html = decorate(tab, panel(tab, world, ui));
        if (html !== lastPanel) {
          const top = pEl.scrollTop;
          pEl.innerHTML = html;
          pEl.scrollTop = top;
          lastPanel = html;
        }
      }
      const info = $('[data-info]');
      const html = selection ? selectionPanel(world, selection, ui) : '';
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
