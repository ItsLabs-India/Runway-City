// End-to-end browser test: drives the production build in your installed Chrome like a player would
// and checks every system (terminals, plan mode, projects, report card, save/load, live data, phone
// touch, offline, accessibility). Usage: npm run build && node scripts/ui-test.mjs [outDir]
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { preview } from 'vite';
import { chromium } from 'playwright-core';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p));
const out = process.argv[2] ?? 'ui-test-output';
await mkdir(out, { recursive: true });
const PORT = 4181;
const URL = `http://localhost:${PORT}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: String(detail) });
  if (!ok) console.log(`  FAIL ${name} ${detail}`);
};

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errors = [];
const watch = (page, label) => {
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`));
};
const page = await context.newPage();
watch(page, 'desktop');
const W = (fn, arg) => page.evaluate(fn, arg);
const click = (sel) => page.click(sel, { timeout: 8000 });
const settle = (ms = 400) => page.waitForTimeout(ms);

// ---- boot -------------------------------------------------------------------------------------
await page.goto(`${URL}/?scenario=normal&time=07:00&warm=600&speed=0`);
await page.waitForFunction(() => window.__runway?.world, null, { timeout: 30000 });
check('game boots without a menu when ?scenario is given', await W(() => window.__runway.hud.modalKind === null));

// ---- tabs and keyboard shortcuts ----------------------------------------------------------------
for (const [key, text] of [['f', 'Arrivals'], ['t', 'Upgrade every terminal'], ['p', 'Terminal 3'], ['o', 'Ground equipment'], ['l', '']]) {
  await page.keyboard.press(key);
  await settle(350);
  const html = await W(() => document.querySelector('[data-panel]').innerText);
  check(`key "${key}" opens its panel`, html.toLowerCase().includes(text.toLowerCase()) || key === 'l', `got: ${html.slice(0, 60)}`);
}
await page.keyboard.press('Escape');
check('Esc closes the panel', await W(() => document.querySelector('[data-panel]').hidden));
await page.keyboard.press('3');
check('key 3 sets 10x speed', (await W(() => window.__runway.hud && document.querySelector('[data-speed="10"]').classList.contains('active'))) === true);
await page.keyboard.press('Space');
check('Space pauses', await W(() => document.querySelector('[data-speed="0"]').classList.contains('active')));

// ---- terminals: quick add, plan mode, dials, shifts, hiring, bulk upgrade, layout codes -----------
await page.keyboard.press('t');
await settle();
const money0 = await W(() => window.__runway.world.money);
await click('[data-action="add"][data-arg="T1:security:2"]');
await settle();
const money1 = await W(() => window.__runway.world.money);
check('quick add: +2 security lanes costs ₹70 lakh', Math.abs(money0 - money1 - 7e6) < 1, `Δ ${money0 - money1}`);
check('construction is queued', (await W(() => window.__runway.world.term.list.T1.builds.length)) === 1);
check('panel shows it under construction', (await W(() => document.querySelector('[data-panel]').innerText)).toLowerCase().includes('under construction'));

await click('[data-action="planMode"]');
await click('[data-action="add"][data-arg="T1:checkin:4"]');
await click('[data-action="tier"][data-arg="T1:security"]');
const staged = await W(() => ({ n: window.__runway.ui.plan.length, money: window.__runway.world.money }));
check('plan mode stages without spending', staged.n === 2 && staged.money === money1, JSON.stringify(staged));
check('plan shows total and Build all', (await W(() => document.querySelector('[data-panel]').innerText)).includes('Build all'));
await click('[data-action="buildPlan"]');
await settle();
const afterPlan = await W(() => ({ n: window.__runway.ui.plan.length, builds: window.__runway.world.term.list.T1.builds.length, money: window.__runway.world.money }));
check('Build all orders everything at once', afterPlan.n === 0 && afterPlan.builds === 3 && afterPlan.money < money1, JSON.stringify(afterPlan));
await click('[data-action="planMode"]');

await click('[data-action="dial"][data-arg="T1:security:lean"]');
check('staffing dial', (await W(() => window.__runway.world.term.list.T1.proc.security.dial)) === 'lean');
await click('[data-action="dial"][data-arg="T1:security:auto"]');
await click('[data-action="shift"][data-arg="peak"]');
check('shift template', (await W(() => window.__runway.world.term.shift)) === 'peak');
const staff0 = await W(() => window.__runway.world.term.staff.security);
await click('[data-action="hire"][data-arg="security:10"]');
check('hire 10 security staff', (await W(() => window.__runway.world.term.staff.security)) === staff0 + 10);
await click('[data-action="upgradeAll"][data-arg="checkin"]');
await settle();
check('bulk upgrade orders every terminal', (await W(() => ['T1', 'T4', 'T2'].filter((id) => window.__runway.world.term.list[id].builds.some((b) => b.kind === 'tier' && b.proc === 'checkin')).length)) === 3);

await click('[data-action="copyLayout"][data-arg="T1"]');
const code = await page.inputValue('#layoutCode');
check('layout code is produced', code.startsWith('RC1.'), code.slice(0, 12));
await click('[data-action="term"][data-arg="T4"]');
await settle();
await page.fill('#layoutCode', code);
await click('[data-action="applyLayout"][data-arg="T4"]');
await settle();
check('stamping a layout onto T4 orders builds', (await W(() => window.__runway.world.term.list.T4.builds.length)) > 0);
await page.screenshot({ path: `${out}/terminals.png` });

await W(() => window.__runway.world.update(3 * 3600));
await settle();
check('builds complete after time passes', (await W(() => window.__runway.world.term.list.T1.proc.security.positions)) === 14);
check('upgraded technology applies', (await W(() => window.__runway.world.term.list.T1.proc.security.tier)) === 1);

// ---- clicking a terminal on the map opens its panel ----------------------------------------------
await page.keyboard.press('Escape');
await W(() => {
  const w = window.__runway.world;
  const b = w.map.buildings.find((x) => x.name?.startsWith('Terminal 1'));
  const xs = b.polygon.map((p) => p[0]);
  const ys = b.polygon.map((p) => p[1]);
  window.__runway.camera.setView({ x: xs.reduce((a, c) => a + c) / xs.length, y: ys.reduce((a, c) => a + c) / ys.length, scale: 0.8 });
});
await settle(500);
const pt = await W(() => {
  const w = window.__runway.world;
  const b = w.map.buildings.find((x) => x.name?.startsWith('Terminal 1'));
  const xs = b.polygon.map((p) => p[0]);
  const ys = b.polygon.map((p) => p[1]);
  const [sx, sy] = window.__runway.camera.worldToScreen(xs.reduce((a, c) => a + c) / xs.length, ys.reduce((a, c) => a + c) / ys.length);
  return { x: sx, y: sy };
});
await page.mouse.click(pt.x, pt.y);
await settle();
check('clicking Terminal 1 on the map opens the Terminals panel', await W(() => window.__runway.hud.tab === 'term' && window.__runway.ui.term === 'T1'));

// ---- flight selection and actions --------------------------------------------------------------
await page.keyboard.press('f');
await W(() => window.__runway.world.update(1200));
await settle(500);
// A parked passenger flight that is on the board (the board lists only the next departures).
const rowId = await W(() => {
  const on = new Set([...document.querySelectorAll('[data-panel] [data-row]')].map((r) => Number(r.dataset.row)));
  return window.__runway.world.flights.find((f) => f.phase === 'atStand' && !f.service && on.has(f.id))?.id;
});
await page.click(`[data-row="${rowId}"]`);
await settle();
check('board row selects the flight', (await W(() => document.querySelector('[data-info]').innerText)).toLowerCase().includes('passengers'));
check('flight details come in order: status, route, timeline, stand, passengers, then live data, aircraft, conditions', await W(() => {
  const heads = [...document.querySelectorAll('[data-info] .fd-sec h4')].map((h) => h.innerText.toLowerCase());
  return heads.join('|') === 'status|route|timeline|stand and turnaround|passengers|live data|aircraft|conditions';
}));
check('the timeline lists the steps of the flight, done steps first', await W(() => {
  const items = [...document.querySelectorAll('[data-info] .tline li')].map((li) => li.className);
  const firstOpen = items.findIndex((c) => c !== 'done');
  return items.length >= 7 && items.slice(0, firstOpen).every((c) => c === 'done') && items.slice(firstOpen).every((c) => c !== 'done');
}));
check('live data shows four instruments, ground speed and the altimeter setting', await W(() => document.querySelectorAll('[data-info] .inst-row .inst').length === 4 && /ground speed/i.test(document.querySelector('[data-info]').textContent) && /QNH/.test(document.querySelector('[data-info]').textContent)));
check('the flight card shows a registration and the route distance', await W(() => /[A-Z0-9]{1,3}-[A-Z]{2,4}/.test(document.querySelector('[data-info]').innerText) && /[0-9] km/.test(document.querySelector('[data-info]').innerText)));
// ---- visual hierarchy: reference sections fold, and stay as the player left them ----------------------------
await page.click('[data-info] summary[data-sec="Aircraft"]');
await W(() => window.__runway.setSpeed(3));
await page.waitForTimeout(1200); // several refreshes of the card
check('a folded section stays open while the card refreshes', await W(() => document.querySelector('[data-info] summary[data-sec="Aircraft"]').parentElement.open));
await page.click('[data-info] summary[data-sec="Aircraft"]');
await page.waitForTimeout(600);
check('and stays closed after closing it', await W(() => !document.querySelector('[data-info] summary[data-sec="Aircraft"]').parentElement.open));
await W(() => window.__runway.setSpeed(0));
check('the flight actions stay in view while the card scrolls', await W(() => {
  const card = document.querySelector('[data-info]');
  card.scrollTop = card.scrollHeight / 2;
  const r = card.querySelector(':scope > .row-actions').getBoundingClientRect();
  const c = card.getBoundingClientRect();
  card.scrollTop = 0;
  return r.bottom <= c.bottom + 1 && r.top >= c.top;
}));
check('panels fit their width (nothing clipped sideways)', await W(() => { const p = document.querySelector('[data-panel]'); return p.scrollWidth <= p.clientWidth + 1; }));
check('the top bar stays on one row at desktop width', await W(() => document.querySelector('.bar').getBoundingClientRect().height < 60));
const mBefore = await W(() => window.__runway.world.money);
await click('[data-action="prioritise"]');
check('prioritise charges ₹50,000', Math.abs(mBefore - (await W(() => window.__runway.world.money)) - 5e4) < 100);

// ---- airlines: badges, groups, filter ------------------------------------------------------------
check('flight card shows the airline badge, group and name', await W(() => {
  const info = document.querySelector('[data-info]');
  return Boolean(info.querySelector('.al.lg')) && info.querySelectorAll('.sub, .muted').length >= 2;
}));
await page.click('[data-action="boardView"][data-arg="airlines"]');
await settle();
check('Airlines view lists groups with badges', await W(() => document.querySelectorAll('.algroup').length >= 3 && document.querySelectorAll('.alrow .al').length >= 5));
await page.click('[data-action="airlineGroup"][data-arg="alliance"]');
await settle();
check('Airlines can be grouped by alliance', await W(() => [...document.querySelectorAll('.algroup h4')].some((h) => /Star Alliance|Oneworld/.test(h.innerText))));
await page.click('.alrow');
await settle();
check('clicking an airline filters the flight board', await W(() => {
  const chip = document.querySelector('.chip .al');
  const rows = [...document.querySelectorAll('.fids tr[data-row] .al')];
  return Boolean(chip) && rows.length > 0 && rows.every((el) => el.title === chip.title);
}));
await page.click('[data-action="boardAirline"][data-arg=""]');
await page.click('[data-action="boardGroup"][data-arg="group"]');
await settle();
check('flight board can be grouped by airline group', await W(() => document.querySelectorAll('.fids tr.grp').length >= 2));
await page.click('[data-action="boardGroup"][data-arg="none"]');

// ---- weather, daylight, lighting ------------------------------------------------------------------
await page.keyboard.press('o');
await settle();
check('weather chip in the top bar', await W(() => Boolean(document.querySelector('[data-stats] .chip-btn'))));
check('Operations panel shows the weather card with a 12-hour forecast', await W(() => document.querySelectorAll('.forecast .fc').length === 12 && document.querySelector('.metar').innerText.startsWith('VOMM')));
await W(() => {
  const w = window.__runway.world;
  w.weather.spells = [{ type: 'storm', start: w.t - 3600, end: w.t + 7200, scale: 1, seed: 3 }];
  w.weather.update(w.t, 0);
  w.update(40);
});
await settle(500);
check('a thunderstorm stops outdoor ramp work', await W(() => window.__runway.world.rampClosed === true && window.__runway.world.weather.now.lightning === true));
check('the weather card explains the lightning rule', await W(() => document.querySelector('[data-panel]').innerText.includes('Lightning')));
await click('[data-action="weatherMode"][data-arg="calm"]');
check('weather can be set to calm', await W(() => window.__runway.world.weatherMode === 'calm'));
await click('[data-action="weatherMode"][data-arg="random"]');
await click('[data-action="lighting"][data-arg="apron:on"]');
check('apron floodlights can be forced on', await W(() => window.__runway.world.lights.apron === true));
await click('[data-action="lighting"][data-arg="runway:4"]');
check('runway light intensity can be set', await W(() => window.__runway.world.lights.rwyStep >= 4));
await click('[data-action="lighting"][data-arg="apron:auto"]');
await click('[data-action="lighting"][data-arg="runway:auto"]');
await W(() => {
  const w = window.__runway.world;
  w.weather.spells = [{ type: 'clear', start: w.t - 3600, end: w.t + 40 * 3600, scale: 1, seed: 5 }];
  w.weather.update(w.t, 0);
  w.update(1300); // the lightning rule lifts ten minutes after the last strike
});
check('the ramp reopens after the storm', await W(() => window.__runway.world.rampClosed === false));

// ---- runway control --------------------------------------------------------------------------------
const topBar = () => W(() => document.querySelector('[data-stats]').innerText);
check('both runways are listed in the top bar by default', /RWY\s+\d+ · \d+/.test(await topBar()), (await topBar()).match(/RWY[^\n]*/)?.[0]);
check('Operations has a plan selector and a card per runway', await W(() => document.querySelectorAll('.rwplans button').length === 4 && document.querySelectorAll('.rwcard').length === 2));
check('07/25 offers no "not in use" role', await W(() => !document.querySelector('[data-action="runwayMode"][data-arg="07/25:off"]') && Boolean(document.querySelector('[data-action="runwayMode"][data-arg="12/30:off"]'))));
await page.screenshot({ path: `${out}/runway-control.png` });
await click('[data-action="runwayPlan"][data-arg="single"]');
await settle();
check('plan "single" takes 12/30 out of use', await W(() => window.__runway.world.second.mode === 'off' && window.__runway.world.runwayPlan === 'single'));
check('the top bar then lists one runway', !/RWY \d+ · \d+/.test(await topBar()));
await click('[data-action="runwayPlan"][data-arg="dualMixed"]');
await settle();
check('plan "dual mixed" uses both for everything', await W(() => window.__runway.world.runways.every((R) => R.mode === 'both')));
await click('[data-action="runwayMode"][data-arg="12/30:arr"]');
await settle();
check('a role button sets that runway', await W(() => window.__runway.world.second.mode === 'arr'));
const dir0 = await W(() => window.__runway.world.second.active);
for (let i = 0; i < 40 && (await W(() => window.__runway.world.second.active)) === dir0; i++) {
  await W(() => document.querySelector('[data-action="switchRunway"][data-arg="12/30"]').click());
  await W(() => window.__runway.world.update(30));
}
check('the direction button turns 12/30 round', (await W(() => window.__runway.world.second.active)) !== dir0);
await settle();
await click('[data-action="inspectRunway"][data-arg="12/30"]');
await settle();
check('12/30 can be closed for inspection on its own', await W(() => { const w = window.__runway.world; return w.runwayClosed(w.t, '12/30') && !w.runwayClosed(w.t, '07/25'); }));
await click('[data-action="reopenRunway"][data-arg="12/30"]');
await settle();
check('and reopened', await W(() => { const w = window.__runway.world; return !w.runwayClosed(w.t, '12/30'); }));
await click('[data-action="runwayPlan"][data-arg="dualLand"]');
await settle();
const rwyPoint = await W(() => {
  const { world: w, camera } = window.__runway;
  const [a, b] = Object.values(w.second.frame.ends);
  // A quarter of the way along stays clear of the crossing and of any traffic at the threshold.
  const x = a[0] + (b[0] - a[0]) * 0.25;
  const y = a[1] + (b[1] - a[1]) * 0.25;
  camera.setView({ x, y, scale: 0.8 });
  return camera.worldToScreen(x, y);
});
await settle();
await page.mouse.click(rwyPoint[0], rwyPoint[1]);
await settle();
check('clicking 12/30 on the map opens its own card', await W(() => document.body.innerText.includes('Runway 12/30') && Boolean(document.querySelector('.rwcard'))));
await page.keyboard.press('Escape');

// ---- finance, top-bar shortcuts, panel header, help --------------------------------------------------
await page.click('.stats .stat.money');
await settle();
check('clicking the cash opens Finance', await W(() => window.__runway.hud.tab === 'fin'));
check('Finance shows today, cash flow, income and expense breakdowns', await W(() => document.querySelectorAll('.fcards .fcard').length === 6 && Boolean(document.querySelector('.cashflow')) && document.querySelectorAll('.fbars li').length >= 4));
check('panels have a title bar with a close button', await W(() => document.querySelector('[data-panel] .ph h2')?.innerText.toLowerCase().includes('finance') && Boolean(document.querySelector('[data-panel] .ph .x'))));
await click('[data-action="tariff"][data-arg="premium"]');
check('airport charges can be set', await W(() => window.__runway.world.tariff === 'premium'));
await click('[data-action="tariff"][data-arg="standard"]');
const [csv] = await Promise.all([page.waitForEvent('download'), click('[data-action="exportFinance"]')]);
check('the books export as CSV', (await csv.suggestedFilename()).endsWith('.csv'));
await page.keyboard.press('o');
await settle();
check('long panels get section links', await W(() => document.querySelectorAll('[data-panel] .jump button').length >= 4));
await page.click('[data-panel] .jump button:last-child');
await settle(600);
check('a section link scrolls the panel', await W(() => document.querySelector('[data-panel]').scrollTop > 100));
await page.click('[data-panel] .ph .x');
await settle();
check('the title bar closes the panel', await W(() => window.__runway.hud.tab === null));
await page.keyboard.press('h');
await settle();
check('H opens keys and tips', await W(() => window.__runway.hud.modalKind === 'help' && document.querySelectorAll('.keys-table tr').length >= 10));
await page.keyboard.press('Escape');
await settle();
check('Esc closes the help', await W(() => window.__runway.hud.modalKind === null));

// ---- projects ------------------------------------------------------------------------------------
await page.keyboard.press('p');
await settle();
await click('[data-action="project"][data-arg="hydrant"]');
check('project starts and charges', (await W(() => window.__runway.world.projects.hydrant.state)) === 'building');
const fuel0 = await W(() => window.__runway.world.pool.fuel.total);
await W(() => window.__runway.world.update(9 * 3600));
check('project completes with its effect (+6 fuel dispensers)', (await W(() => window.__runway.world.projects.hydrant.state === 'done' && window.__runway.world.pool.fuel.total)) === fuel0 + 6);

await W(() => {
  const w = window.__runway.world;
  w.money = 100e7;
});
const t5Blocked = await W(() => window.__runway.world.startProject('t5'));
check('Terminal 5 needs Terminal 3 first', !t5Blocked.ok, t5Blocked.message);
await W(() => window.__runway.hud.openTab('proj'));
await click('[data-action="project"][data-arg="t3"]');
const stands0 = await W(() => window.__runway.world.stands.filter((s) => s.contact && !s.locked).length);
await W(() => window.__runway.world.update(37 * 3600));
await settle(600);
const t3 = await W(() => {
  const w = window.__runway.world;
  return { open: w.term.list.T3.open, bridges: w.stands.filter((s) => s.bridge).length, contact: w.stands.filter((s) => s.contact && !s.locked).length, pos: w.term.list.T3.proc.security.positions };
});
check('Terminal 3 opens with capacity', t3.open && t3.pos === 10, JSON.stringify(t3));
check('Terminal 3 adds new jet-bridge stands', t3.bridges > 0 && t3.contact === stands0 + t3.bridges, `${stands0} → ${t3.contact} contact, ${t3.bridges} new bridges`);

// ---- day report card -------------------------------------------------------------------------------
await page.waitForSelector('[data-modal]:not([hidden]) h1', { timeout: 8000 });
if (process.env.DEBUG_GRIDLOCK) console.log(await W(() => {
  const w = window.__runway.world;
  const hh = (x) => `${String(Math.floor((x % 86400) / 3600)).padStart(2, '0')}:${String(Math.floor((x % 3600) / 60)).padStart(2, '0')}`;
  const ru = w.flights.find((f) => f.id === w.main.user);
  const lines = [`t ${hh(w.t)} runwayUser ${w.main.user} ${ru ? ru.depNo + ' ' + ru.phase + ' s ' + ru.s?.toFixed(0) + ' wait ' + ru.waiting : ''} closed ${w.runwayClosed()}`];
  for (const f of w.flights.filter((x) => ['taxiOut', 'holdShort', 'taxiIn', 'lineUp', 'landing', 'pushback'].includes(x.phase))) lines.push(`${f.id} ${f.phase} ${f.depNo} v${f.speed.toFixed(1)} s${f.s.toFixed(0)}/${f.limit?.toFixed(0)} wait=${f.waiting} blockedBy=${f.blockedBy} waitFor=${f.waitFor} blockedFor=${f.blockedFor?.toFixed(0)} giveWay=${f.giveWayFor?.toFixed(0)} ghost=${f.ghostUntil > w.t}`);
  lines.push('overrides ' + JSON.stringify((w.overrides ?? []).slice(-6)));
  return lines.join(String.fromCharCode(10));
}));
check('day report appears when the sim day ends',(await W(() => document.querySelector('[data-modal] h1').innerText)).toLowerCase().includes('report'));
const reportAl = await W(() => ({ airlines: document.querySelector('[data-modal]').innerText.includes('Airlines'), rows: document.querySelectorAll('[data-modal] .rgroup .al').length, day: window.__runway.world.pendingReport?.airlines?.length, text: document.querySelector('[data-modal]').innerText.slice(0, 400) }));
check('day report lists results by airline group', reportAl.airlines && reportAl.rows >= 3, JSON.stringify(reportAl));
await page.screenshot({ path: `${out}/report.png` });
await page.click('[data-modal] .card');
await settle();
check('adopting a policy applies it and closes the report', await W(() => window.__runway.world.perks.length === 1 && window.__runway.hud.modalKind === null));

await W(() => window.__runway.hud.openTab('term'));
await click('[data-action="term"][data-arg="T3"]');
await W(() => {
  const site = window.__runway.world.map.zones.find((z) => z.kind === 'construction');
  const xs = site.polygon.map((p) => p[0]);
  const ys = site.polygon.map((p) => p[1]);
  window.__runway.camera.setView({ x: xs.reduce((a, c) => a + c) / xs.length, y: ys.reduce((a, c) => a + c) / ys.length, scale: 1.1 });
});
await W(() => window.__runway.hud.openTab(null));
await settle(600);
await page.screenshot({ path: `${out}/terminal3-open.png` });

// ---- save, continue, export, import ------------------------------------------------------------------
await W(() => window.__runway.setSpeed(0));
await click('[data-action="menu"]');
await click('[data-action="saveNow"]');
await settle(600);
const saved = await W(() => ({ t: window.__runway.world.t, money: window.__runway.world.money, perks: window.__runway.world.perks.length }));
const [dl] = await Promise.all([page.waitForEvent('download'), click('[data-action="exportSave"]')]);
await dl.saveAs(`${out}/save.json`);
check('export downloads a save file', dl.suggestedFilename().startsWith('runway-city-'), dl.suggestedFilename());
await page.goto(`${URL}/?speed=0`); // no ?scenario, so the menu opens
await page.waitForFunction(() => window.__runway?.world && document.querySelector('.card.continue'), null, { timeout: 20000 });
check('Continue card appears after a reload', true);
await page.screenshot({ path: `${out}/menu.png` });
await click('.card.continue');
await settle(800);
const loaded = await W(() => ({ t: window.__runway.world.t, money: window.__runway.world.money, perks: window.__runway.world.perks.length, t3: window.__runway.world.projects.t3.state }));
check('continue restores time, money, policies and projects', Math.abs(loaded.t - saved.t) < 30 && Math.abs(loaded.money - saved.money) < 1e6 && loaded.perks === saved.perks && loaded.t3 === 'done', JSON.stringify({ saved, loaded }));
await W(() => window.__runway.act('menu'));
await settle(300);
await page.setInputFiles('[data-import]', `${out}/save.json`);
await settle(1000);
check('import restores a save file', Math.abs((await W(() => window.__runway.world.t)) - saved.t) < 30);

// ---- live data ------------------------------------------------------------------------------------------
await page.route('**/api/traffic', (route) =>
  route.fulfill({
    json: {
      ts: Date.now(), source: 'adsb.fi', attribution: 'Live aircraft data: adsb.fi (non-commercial use)',
      aircraft: [
        { hex: 'aaa001', call: 'TEST001', type: 'A20N', lat: 12.9941, lon: 80.1709, alt: 0, gs: 0, trk: 250, gnd: true, age: 1 },
        { hex: 'aaa002', call: 'TEST002', type: 'B38M', lat: 12.9863, lon: 80.2095, alt: 1500, gs: 140, trk: 250, gnd: false, age: 2 },
        { hex: 'aaa003', call: 'TEST003', type: 'B789', lat: 13.1, lon: 80.4, alt: 28000, gs: 450, trk: 90, gnd: false, age: 0 },
      ],
    },
  }),
);
await W(() => window.__runway.hud.openTab('ops'));
await click('[data-action="liveTraffic"]');
await page.waitForFunction(() => window.__runway.traffic.status === 'live', null, { timeout: 10000 });
check('Live Watch shows tracked aircraft', (await W(() => window.__runway.traffic.ghosts().length)) === 3);
check('adsb.fi credit is shown while live traffic is on', (await W(() => document.querySelector('[data-credits]').innerText)).includes('adsb.fi'));
await W(() => {
  window.__runway.hud.openTab(null);
  window.__runway.camera.setView({ x: 400, y: 0, scale: 0.6 });
});
await settle(700);
await page.screenshot({ path: `${out}/live-watch.png` });
await W(() => window.__runway.hud.openTab('ops'));
await click('[data-action="liveTraffic"]');
check('Live Watch switches off', (await W(() => window.__runway.traffic.status)) === 'off');

await click('[data-action="liveWeather"]');
await page.waitForFunction(() => window.__runway.ui.live.weather !== '', null, { timeout: 15000 });
const wx = await W(() => ({ src: window.__runway.ui.live.weather, wind: window.__runway.world.wind, on: window.__runway.world.liveWeather }));
check('real weather sets the wind', wx.on && /METAR|Open-Meteo|unavailable/.test(wx.src), JSON.stringify(wx));
await click('[data-action="autoRunway"]');
check('runway follows the wind option', await W(() => window.__runway.world.autoRunway));
await click('[data-action="voice"]');
check('ATC voice toggle works without errors', typeof (await W(() => window.__runway.ui.voice)) === 'boolean');
await click('[data-action="voice"]');

// ---- all scenarios start --------------------------------------------------------------------------------
for (const id of ['festival', 'bhogi', 'cyclone', 'outage', 'sandbox', 'career']) {
  await W((s) => window.__runway.act('scenario', s), id);
  await W(() => window.__runway.world.update(1800));
  check(`scenario "${id}" runs`, await W((s) => window.__runway.world.scenarioId === s && Number.isFinite(window.__runway.world.t), id));
}

// ---- accessibility audit ----------------------------------------------------------------------------------
await W(() => window.__runway.act('scenario', 'normal'));
for (const tab of ['board', 'term', 'proj', 'ops', 'log']) {
  await W((t) => window.__runway.hud.openTab(t), tab);
  await settle(300);
  const bad = await W(() => [...document.querySelectorAll('#hud button, #hud input')].filter((el) => el.offsetParent && !(el.getAttribute('aria-label') || el.title || el.innerText.trim() || el.placeholder)).map((el) => el.outerHTML.slice(0, 60)));
  check(`every control in "${tab}" has an accessible name`, bad.length === 0, bad.slice(0, 2).join(' | '));
}

// ---- PWA and offline --------------------------------------------------------------------------------------
await page.goto(`${URL}/?scenario=normal&speed=0`);
await page.waitForFunction(() => window.__runway?.world);
const sw = await W(async () => (await navigator.serviceWorker.ready).active?.state);
check('service worker is active', sw === 'activated', sw);
check('web app manifest is linked', await W(() => Boolean(document.querySelector('link[rel="manifest"]'))));
await page.reload();
await W(() => navigator.serviceWorker.ready);
await context.setOffline(true);
await page.reload();
await page.waitForFunction(() => window.__runway?.world, null, { timeout: 15000 }).catch(() => {});
check('game loads offline', await W(() => Boolean(window.__runway?.world)));
await context.setOffline(false);

// ---- the game clock: starts at 06:00 and runs at the rate the speed buttons say -----------------------------
await page.goto(`${URL}/?scenario=normal`);
await page.waitForFunction(() => window.__runway?.world);
await settle();
const opening = await W(() => ({ t: window.__runway.world.t, normal: document.querySelector('[data-speed="1"]').classList.contains('active'), clock: document.querySelector('[data-clock] b').innerText }));
check('a new game starts at 06:00, whatever the real time', opening.t >= 21600 && opening.t < 21660 && /^06:00:\d\d$/.test(opening.clock), JSON.stringify(opening));
check('a new game runs at 1×', opening.normal);
for (const s of [1, 3, 10, 30, 60]) {
  const rate = await W(async (x) => {
    const r = window.__runway;
    r.setSpeed(x);
    const [t0, w0] = [r.world.t, performance.now()];
    await new Promise((done) => setTimeout(done, 3000));
    return (r.world.t - t0) / ((performance.now() - w0) / 1000);
  }, s);
  check(`at ${s}× the clock runs ${s} seconds per real second`, Math.abs(rate / s - 1) < 0.05, `measured ${rate.toFixed(2)}`);
}
await W(() => window.__runway.setSpeed(0));

// ---- phone: layout, touch pan, pinch zoom --------------------------------------------------------------------
const phone = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, hasTouch: true, isMobile: true });
const mp = await phone.newPage();
watch(mp, 'phone');
await mp.goto(`${URL}/?scenario=normal&speed=0&time=09:00&warm=600`);
await mp.waitForFunction(() => window.__runway?.world);
await mp.waitForTimeout(500);
check('phone: no horizontal scrolling', await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await mp.evaluate(() => `${document.documentElement.scrollWidth} vs ${window.innerWidth}`));
await mp.tap('[data-tab="term"]');
await mp.waitForTimeout(400);
const panelBox = await mp.evaluate(() => {
  const r = document.querySelector('[data-panel]').getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight };
});
check('phone: panel is a bottom sheet inside the screen', panelBox.left >= 0 && panelBox.right <= panelBox.vw && panelBox.bottom <= panelBox.vh && panelBox.top > panelBox.vh * 0.3, JSON.stringify(panelBox));
const smallList = await mp.evaluate(() => [...document.querySelectorAll('#hud button')].filter((b) => b.offsetParent).filter((b) => { const r = b.getBoundingClientRect(); return r.height < 34 || r.width < 30; }).map((b) => { const r = b.getBoundingClientRect(); return `${b.dataset.action ?? b.dataset.tab ?? b.className ?? b.textContent.slice(0, 8)} ${Math.round(r.width)}x${Math.round(r.height)}`; }));
check('phone: touch targets are at least 34 px', smallList.length === 0, `${smallList.length} small: ${[...new Set(smallList)].slice(0, 6).join(', ')}`);
await mp.screenshot({ path: `${out}/phone-terminals.png` });
await mp.tap('[data-tab="term"]');
await mp.waitForTimeout(300);

const cdp = await phone.newCDPSession(mp);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
const cam0 = await mp.evaluate(() => ({ x: window.__runway.camera.x, y: window.__runway.camera.y, s: window.__runway.camera.scale }));
await touch('touchStart', [[200, 500]]);
for (let i = 1; i <= 8; i++) await touch('touchMove', [[200 + i * 15, 500 + i * 8]]);
await touch('touchEnd', []);
await mp.waitForTimeout(300);
const cam1 = await mp.evaluate(() => ({ x: window.__runway.camera.x, y: window.__runway.camera.y, s: window.__runway.camera.scale }));
check('phone: one-finger drag pans the map', Math.hypot(cam1.x - cam0.x, cam1.y - cam0.y) > 20, JSON.stringify({ cam0, cam1 }));
await touch('touchStart', [[150, 500], [250, 500]]);
for (let i = 1; i <= 8; i++) await touch('touchMove', [[150 - i * 10, 500], [250 + i * 10, 500]]);
await touch('touchEnd', []);
await mp.waitForTimeout(300);
const cam2 = await mp.evaluate(() => window.__runway.camera.scale);
check('phone: pinch zooms in', cam2 > cam1.s * 1.5, `${cam1.s.toFixed(3)} → ${cam2.toFixed(3)}`);
await mp.tap('[data-zoom="0.667"]');
await mp.tap('[data-tab="board"]');
await mp.waitForTimeout(300);
await mp.screenshot({ path: `${out}/phone-board.png` });

await browser.close();
server.httpServer.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
const realErrors = errors.filter((e) => !/Failed to load resource.*(api|favicon)/i.test(e));
console.log(`console / page errors: ${realErrors.length}`, realErrors.slice(0, 5));
await writeFile(`${out}/results.json`, JSON.stringify({ results, errors: realErrors }, null, 2));
process.exit(failed.length || realErrors.length ? 1 : 0);
