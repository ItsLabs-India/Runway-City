// HTML game interface: top bar, side panel, selection panel, toasts, menu and day report.
// Re-rendered a few times a second from the World; markup is only replaced when it changed, and
// never while the player is typing in a field.
import { formatINR } from '../sim/world.js';
import { reportAirlines } from './airlines.js';
import { weatherChip, reportWeather } from './weatherUi.js';
import { reportFinance } from './financeUi.js';
import { SCENARIOS } from '../sim/scenarios.js';
import { PERKS, PROCESSES, fmtCr } from '../sim/terminal.js';
import { panel, selectionPanel, hhmm, esc } from './panels.js';
import { setSectionOpen } from './flightDetails.js';
import { simDay } from '../sim/timing.js';

const clockText = (t) => `Day ${simDay(t) + 1} · ${hhmm(t)} IST`;
const SPEEDS = [0, 1, 3, 10, 30, 60];
// [id, button label, key, panel title]
const TABS = [['board', 'Flights', 'F', 'Flights'], ['term', 'Terminals', 'T', 'Terminals'], ['proj', 'Projects', 'P', 'Projects'], ['ops', 'Ops', 'O', 'Operations'], ['fin', 'Finance', 'I', 'Finance and management'], ['log', 'Alerts', 'L', 'Alerts']];
const KEYS = [['Space', 'Pause / resume'], ['1 – 5', 'Speed: 1× normal (real time), 3×, 10×, 30×, 60×'], ['F', 'Flights board and airlines'], ['T', 'Terminals: queues, staff, building'], ['P', 'Projects'], ['O', 'Operations: weather, lights, runway, vehicles, crews'], ['I', 'Finance and management'], ['L', 'Alerts'], ['M', 'Sound on / off'], ['H or ?', 'This help'], ['+ / −, wheel, pinch', 'Zoom'], ['Arrow keys, drag', 'Move the map'], ['Esc', 'Close the card, the panel or a dialog']];

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
      <div class="group" role="group" aria-label="Game speed">${SPEEDS.map((s) => `<button data-speed="${s}" aria-label="${s ? `${s} times speed` : 'Pause'}" title="${s ? `${s === 1 ? 'Normal speed: one clock second per real second' : `${s}× real time`} (key ${SPEEDS.indexOf(s)})` : 'Pause (Space)'}">${s === 0 ? '❚❚' : `${s}×`}</button>`).join('')}</div>
      <div class="stats" data-stats></div>
      <div class="group tabs" role="group" aria-label="Panels">
        ${TABS.map(([id, label, key, title]) => `<button data-tab="${id}" title="${title} (${key})">${label}${id === 'log' ? ' <b data-alerts></b>' : ''}</button>`).join('')}
        <button data-action="menu" aria-label="Menu" title="Menu: scenarios, save, load">☰</button>
      </div>
    </header>
    <aside class="panel" data-panel hidden></aside>
    <aside class="info" data-info hidden></aside>
    <div class="mapctl" role="group" aria-label="Map">
      <button data-zoom="1.5" aria-label="Zoom in" title="Zoom in (+)">+</button>
      <button data-zoom="0.667" aria-label="Zoom out" title="Zoom out (−)">−</button>
      <button data-home aria-label="Show the whole airport" title="Whole airport">⌂</button>
      <button data-action="sound" data-sound aria-label="Sound" aria-pressed="false" title="Sound on / off (M). Zoom in to hear aircraft and vehicles">🔇</button>
    </div>
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
    // A flight-card section stays as the player left it while the card refreshes.
    const sum = e.target.closest('summary[data-sec]');
    if (sum) setSectionOpen(sum.dataset.sec, !sum.parentElement.open);
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
      const goal = (s) => (s.objectives ? `${Math.round(s.objectives.otp * 100)} % on time · at most ${s.objectives.maxDiversions} diversion${s.objectives.maxDiversions === 1 ? '' : 's'}${s.objectives.projects ? ` · build ${s.objectives.projects.length} projects` : ''}` : 'No objectives, unlimited money');
      const card = (id, s, { feature = false, tag = '' } = {}) => `<button class="card ${feature ? 'feature' : ''} ${id === current ? 'current' : ''}" data-pick="${id}"><strong>${esc(s.name)}${tag}${id === current && canClose ? '<i class="tag ok">Playing</i>' : ''}</strong><span title="${esc(s.brief)}">${esc(s.brief)}</span><em>${goal(s)}</em></button>`;
      const featured = [['normal', '<i class="tag">Start here</i>'], ...(daily && daily !== 'normal' ? [[daily, '<i class="tag now">Today\'s challenge</i>']] : [])];
      const rest = Object.entries(SCENARIOS).filter(([id]) => !featured.some(([f]) => f === id));
      const opt = (action, value, label, cur, title) => `<button data-action="${action}" data-arg="${value}" class="${cur === value ? 'on' : ''}" aria-pressed="${cur === value}" title="${title}">${label}</button>`;
      m.innerHTML = `
        <div class="sheet" role="document">
          ${canClose ? '<button class="x" data-action="closeMenu" aria-label="Close menu">×</button>' : ''}
          <h1>Runway City <span>MAA</span></h1>
          <p class="lead">Run Chennai airport's real layout through a day: every aircraft lands, taxis, is serviced and departs, and every passenger queues. You decide the stands, staff and expansion.</p>
          ${saved ? `<button class="card continue" data-action="continue"><strong>Continue your game</strong><span>${esc(saved.scenario)} · ${esc(clockText(saved.t))} · ${formatINR(saved.money)}</span></button>` : ''}
          <div class="cards feature">${featured.map(([id, tag]) => card(id, SCENARIOS[id], { feature: true, tag })).join('')}</div>
          <h3>More scenarios</h3>
          <div class="cards more">${rest.map(([id, s]) => card(id, s)).join('')}</div>
          <div class="menu-foot">
            <div>
              <h3>Options</h3>
              <div class="ctl"><span class="lbl">Weather</span><span class="seg" role="group" aria-label="Weather">${opt('weatherMode', 'random', 'Random', weatherMode, 'The season decides rain, fog and storms')}${opt('weatherMode', 'calm', 'Calm', weatherMode, 'Clear skies only')}</span></div>
              <div class="ctl"><span class="lbl">Traffic on a normal day</span><span class="seg" role="group" aria-label="Traffic on a normal day">${opt('traffic', 0, 'Standard', traffic, 'The standard schedule. Applies to the next normal day you start.')}${opt('traffic', 0.5, '+50 %', traffic, '50 % more flights than standard. Applies to the next normal day you start.')}</span></div>
            </div>
            <div>
              <h3>Saved games</h3>
              <div class="row-actions">
                ${canClose ? '<button data-action="saveNow">Save now</button>' : ''}
                ${canClose ? '<button data-action="exportSave">Export file</button>' : ''}
                <label class="btn">Import file<input type="file" accept=".json,application/json" data-import hidden></label>
              </div>
            </div>
          </div>
          <p class="keys">Space pauses · 1–5 set the speed · F T P O I L open panels <button data-action="help">Keys and tips</button></p>
        </div>`;
      m.querySelector('.sheet').setAttribute('tabindex', '-1');
      m.querySelector('.sheet').focus();
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
            <li>Every day starts at 06:00. At 1× the clock runs in real time and ground services take 30 % of their real time (a 10-minute job takes 3 minutes); 3× to 60× skip quiet hours.</li>
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
      const otp = Math.round(r.otp * 100);
      const lost = r.diversions + r.cancellations;
      const [word, tone] = otp >= 90 && !lost ? ['An excellent day', 'ok'] : otp >= 75 ? ['A solid day', 'ok'] : otp >= 55 ? ['A difficult day', 'mid'] : ['A rough day', 'bad'];
      const toneOf = (v, good, ok) => (v >= good ? 'ok' : v >= ok ? 'mid' : 'bad');
      const tile = (label, value, cls = '', note = '') => `<div class="tile ${cls}"><small>${label}</small><b>${value}</b>${note ? `<span>${note}</span>` : ''}</div>`;
      // A report section: its title is the summary, so the heading inside is dropped.
      const part = (title, html, open = false) => (html ? `<details class="rsec" ${open ? 'open' : ''}><summary>${title}</summary>${html.replace(/^\s*<h3>.*?<\/h3>/s, '')}</details>` : '');
      m.innerHTML = `
        <div class="sheet" role="document" tabindex="-1">
          <h1>Day ${r.day} report <span>${esc(r.date)}</span></h1>
          <p class="verdict"><b class="${tone}">${word}.</b> ${esc(r.scenario)}: ${r.departures} departures${lost ? `, ${r.diversions} diverted, ${r.cancellations} cancelled` : ', nothing diverted or cancelled'}.</p>
          <div class="tiles">
            ${tile('On time', `${otp} %`, toneOf(otp, 80, 60), `average delay ${Math.round(r.avgDelayMin)} min`)}
            ${tile('Profit', fmtCr(r.profit), r.profit >= 0 ? 'ok' : 'bad', `${fmtCr(r.revenue)} in, ${fmtCr(r.costs)} out`)}
            ${tile('Satisfaction', Math.round(r.satisfaction), toneOf(r.satisfaction, 70, 50))}
            ${tile('Passengers', (r.paxOut + r.paxIn).toLocaleString('en-IN'), r.missedPax > 50 ? 'mid' : '', `${r.missedPax} missed their flight`)}
          </div>
          <h3>Adopt one policy</h3>
          <div class="cards">${r.offer.map((id) => `<button class="card" data-action="perk" data-arg="${id}"><strong>${esc(PERKS[id].label)}</strong><span>${esc(PERKS[id].text)}</span></button>`).join('')}</div>
          <h3>The day in detail</h3>
          ${part('Waits and delays', `<div class="kpis"><span>${PROCESSES.checkin.label} <b>${wait('checkin')}</b></span><span>${PROCESSES.security.label} <b>${wait('security')}</b></span><span>${PROCESSES.immigration.label} <b>${wait('immigration')}</b></span><span>${PROCESSES.arrImm.label} <b>${wait('arrImm')}</b></span><span>${PROCESSES.reclaim.label} <b>${wait('reclaim')}</b></span></div>
            ${r.causes.length ? `<h3>Main causes of delay</h3><ul class="obj">${r.causes.map(([c, n]) => `<li>${esc(c)} <b>${n}</b></li>`).join('')}</ul>` : ''}
            ${r.runways ? `<p class="muted">Runways: ${r.runways.map((x) => `${esc(x.ref)} ${x.landings} landings, ${x.takeoffs} take-offs`).join(' · ')}</p>` : ''}`, true)}
          ${part('Money', `<div class="kpis"><span>Revenue <b>${fmtCr(r.revenue)}</b></span><span>Costs <b>${fmtCr(r.costs)}</b></span><span>Retail income <b>${fmtCr(r.retail)}</b></span></div>${reportFinance(r.finance)}`)}
          ${part('Weather', reportWeather(r.weather))}
          ${part('Airlines', reportAirlines(r.airlines ?? []))}
          <div class="sticky-foot"><button data-action="perk" data-arg="">Continue without a policy</button><button data-action="copyResult">Copy result to share</button></div>
        </div>`;
      m.querySelector('.sheet').focus();
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
      $('[data-clock]').innerHTML = `<b>${hhmm(world.t)}${speed > 1 ? '' : `:${String(Math.floor(world.t % 60)).padStart(2, '0')}`}</b><small>Day ${simDay(world.t) + 1} · IST</small>`; // minutes are enough at 3x and faster
      const k = world.kpi;
      const otp = k.departures ? Math.round((k.onTime / k.departures) * 100) : 100;
      const inUse = world.runways.filter((R) => R.mode !== 'off');
      const closed = inUse.some((R) => world.runwayClosed(world.t, R.ref));
      const sat = Math.round(world.satisfaction());
      // A figure only takes a colour when it needs the player's attention.
      $('[data-stats]').innerHTML = `
        <button class="stat money ${world.money < 0 ? 'bad' : ''}" data-action="openTab" data-arg="fin" title="Cash. Open Finance (I)"><small>Cash</small><b>${formatINR(world.money)}</b></button>
        <button class="stat ${otp < 60 ? 'bad' : otp < 80 ? 'mid' : ''}" data-action="openTab" data-arg="board" title="On-time departures (within 15 min). Open the flight board (F)"><small>On time</small><b>${otp}%</b></button>
        <button class="stat ${sat < 50 ? 'bad' : sat < 70 ? 'mid' : ''}" data-action="openTab" data-arg="term" title="Passenger satisfaction: flights and queues. Open Terminals (T)"><small>Satisfaction</small><b>${sat}</b></button>
        <button class="stat ${closed ? 'bad' : ''}" data-jump='{"runway":true}' title="Runways in use. Show the runway control"><small>RWY</small><b>${inUse.map((R) => R.active).join(' · ')}${closed ? ' closed' : ''}</b></button>
        <span class="wind" title="Wind${world.liveWeather ? ' (real)' : ''}${world.wind.gust ? `, gusting ${world.wind.gust} kt` : ''}"><small>Wind</small><b>${String(world.wind.from).padStart(3, '0')}° ${world.wind.kt}${world.wind.gust ? `G${world.wind.gust}` : ''} kt</b></span>
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
