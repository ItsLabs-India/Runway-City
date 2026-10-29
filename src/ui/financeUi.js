// Finance and management: today's books, cash flow by hour, income and expenses by category, revenue by
// airline, unit economics, running costs, capital spending, day history, recent transactions, airport
// charges, and a CSV export. Pure functions of the World; actions go through data-action as elsewhere.
import { formatINR } from '../sim/world.js';
import { INCOME, EXPENSE, TARIFFS } from '../sim/finance.js';
import { brandOf } from '../sim/brands.js';
import { badge, esc } from '../logos.js';

const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)} %` : '–');
const hhmm = (t) => `${String(Math.floor((t % 86400) / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`;
const COLOURS_IN = { landing: '#3fae6a', parking: '#7bc96f', udf: '#2f8f83', retail: '#9b7bd6', sales: '#c8b14a', other: '#8a96a3' };
const COLOURS_OUT = { staff: '#ff8a5c', crews: '#ff6f61', fixed: '#d8705a', vehicles: '#f2a65a', power: '#f2c230', hiring: '#e86fa3', equipment: '#b07be0', build: '#7a8fe8', projects: '#5aa9ff', compensation: '#ff4d6d', priority: '#c97b3a', other: '#8a96a3' };

// Horizontal bars for one side of the books.
function breakdown(book, labels, colours) {
  const total = sum(book);
  const rows = Object.entries(book).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '<p class="muted">Nothing yet today.</p>';
  return `<ul class="fbars">${rows.map(([cat, v]) => `<li><span class="fl">${esc(labels[cat] ?? cat)}</span><span class="fv">${formatINR(v)} <small>${pct(v, total)}</small></span><i style="--w:${Math.max(1.5, (v / rows[0][1]) * 100)}%;--c:${colours[cat] ?? '#8a96a3'}"></i></li>`).join('')}</ul>`;
}

// Income and expenses per hour today, with the running profit as a line.
function cashflowChart(day, nowHour) {
  const W = 336;
  const H = 120;
  const max = Math.max(1, ...day.hours.map((h) => Math.max(h.in, h.out)));
  const bw = W / 24;
  let run = 0;
  const runs = day.hours.map((h) => (run += h.in - h.out));
  const lo = Math.min(0, ...runs);
  const hi = Math.max(1, ...runs);
  const y = (v) => H - 14 - ((v - lo) / (hi - lo || 1)) * (H - 24);
  const bars = day.hours.map((h, i) => {
    const hin = (h.in / max) * (H - 24) * 0.5;
    const hout = (h.out / max) * (H - 24) * 0.5;
    const mid = (H - 14) / 2 + 5;
    return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(mid - hin).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${hin.toFixed(1)}" class="in"/><rect x="${(i * bw + 1).toFixed(1)}" y="${mid.toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${hout.toFixed(1)}" class="out"/>`;
  }).join('');
  const first = Math.max(0, day.hours.findIndex((h) => h.in > 0 || h.out > 0)); // the game may have started mid-day
  const line = runs.slice(0, nowHour + 1).map((v, i) => [i, v]).filter(([i]) => i >= first).map(([i, v]) => `${(i * bw + bw / 2).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const ticks = [0, 6, 12, 18].map((h) => `<text x="${(h * bw + 2).toFixed(1)}" y="${H - 2}">${String(h).padStart(2, '0')}</text>`).join('');
  return `<svg class="cashflow" viewBox="0 0 ${W} ${H}" role="img" aria-label="Income and expenses per hour today">
    <line x1="0" x2="${W}" y1="${((H - 14) / 2 + 5).toFixed(1)}" y2="${((H - 14) / 2 + 5).toFixed(1)}" class="axis"/>${bars}
    <rect x="${(nowHour * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H - 12}" class="now"/>
    ${line ? `<polyline points="${line}" class="run"/>` : ''}${ticks}</svg>
    <p class="legend"><i class="in"></i>income <i class="out"></i>expenses <i class="run"></i>running profit today</p>`;
}

export function financePanel(w) {
  const L = w.ledger;
  const day = L.day;
  const inc = sum(day.in);
  const exp = sum(day.out);
  const profit = inc - exp;
  const nowHour = Math.floor((w.t % 86400) / 3600);
  // Projection: today so far plus the last three hours' average for the rest of the day.
  const recent = day.hours.slice(Math.max(0, nowHour - 3), nowHour);
  const avgNet = recent.length ? recent.reduce((a, h) => a + h.in - h.out, 0) / recent.length : 0;
  const left = 24 - ((w.t % 86400) / 3600);
  const projected = profit + avgNet * left;
  const last = w.reports.at(-1);
  const yProfit = last ? last.revenue - last.costs : null;

  // Running costs per day at today's rates.
  const vehicles = Object.values(w.pool).reduce((s, p) => s + p.total, 0);
  const rates = {
    staff: w.term.dailyStaffCost(),
    crews: w.crews.total * 6000 * w.term.wageMul(),
    fixed: 1.2e7,
    vehicles: vehicles * 1500,
    power: 12 * 12000, // about twelve hours of night lighting at typical settings
  };
  const perDay = sum(rates);
  const burnDays = projected < 0 && w.money > 0 ? Math.floor(w.money / -projected) : null;

  const deps = w.kpi.departures - (w.dayBase?.departures ?? 0);
  const pax = Math.round(w.term.day?.paxOut ?? 0) + Math.round(w.term.day?.paxIn ?? 0);
  const aero = (day.in.landing ?? 0) + (day.in.parking ?? 0) + (day.in.udf ?? 0);
  const staffShare = exp > 0 ? ((day.out.staff ?? 0) + (day.out.crews ?? 0)) / exp : 0;

  const card = (label, value, sub = '', cls = '') => `<div class="fcard ${cls}"><small>${label}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
  const tariffs = Object.entries(TARIFFS).map(([id, t]) => `<button data-action="tariff" data-arg="${id}" class="${w.tariff === id ? 'on' : ''}" title="${esc(t.text)}">${t.label}</button>`).join('');

  const airlines = Object.entries(day.airlines).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topAir = airlines[0]?.[1] ?? 1;
  const airRows = airlines.map(([code, v]) => `<li><span class="fl">${badge(code, 'sm')} ${esc(brandOf(code).short)}</span><span class="fv">${formatINR(v)} <small>${pct(v, aero)}</small></span><i style="--w:${(v / topAir) * 100}%;--c:${brandOf(code).primary}"></i></li>`).join('');

  const capital = ['projects', 'equipment', 'build', 'hiring'].map((c) => [c, L.total.out[c] ?? 0]).filter(([, v]) => v > 0);
  const history = [...w.reports.slice(-7).map((r) => ({ label: `Day ${r.day}`, inc: r.revenue, exp: r.costs, otp: r.otp })), { label: 'Today', inc, exp, otp: w.kpi.departures ? w.kpi.onTime / w.kpi.departures : 1, today: true }];
  const tx = L.tx.slice(0, 12);

  return `
    <nav class="jump" aria-label="Sections">${[['fin-sum', 'Summary'], ['fin-flow', 'Cash flow'], ['fin-in', 'Income'], ['fin-out', 'Expenses'], ['fin-unit', 'Per unit'], ['fin-hist', 'History'], ['fin-tx', 'Transactions']].map(([id, l]) => `<button data-scroll="${id}">${l}</button>`).join('')}</nav>
    <h3 id="fin-sum">Today</h3>
    <div class="fcards">
      ${card('Cash', formatINR(w.money), Number.isFinite(w.money) ? '' : 'sandbox')}
      ${card('Income', formatINR(inc), `${Object.keys(day.in).length} sources`, 'pos')}
      ${card('Expenses', formatINR(exp), `${formatINR(perDay)} a day running`, 'neg')}
      ${card('Profit', formatINR(profit), `margin ${pct(profit, inc)}`, profit >= 0 ? 'pos' : 'neg')}
      ${card('Day end (projected)', formatINR(projected), recent.length ? 'at the last 3 hours’ pace' : 'not enough data yet', projected >= 0 ? 'pos' : 'neg')}
      ${card('Yesterday', yProfit === null ? '–' : formatINR(yProfit), yProfit === null ? 'first day' : `profit, ${pct(yProfit, last.revenue)} margin`)}
    </div>
    ${burnDays !== null ? `<p class="warn">At today’s pace the cash lasts about ${burnDays} day${burnDays === 1 ? '' : 's'}. Cut costs or raise income.</p>` : ''}
    <div class="lightrow"><span class="lbl">Airport charges <small>${esc(TARIFFS[w.tariff].text)}</small></span><div class="seg">${tariffs}</div></div>

    <h3 id="fin-flow">Cash flow by hour</h3>
    ${cashflowChart(day, nowHour)}

    <h3 id="fin-in">Income <small>${formatINR(inc)}</small></h3>
    ${breakdown(day.in, INCOME, COLOURS_IN)}
    ${airlines.length ? `<h4 class="sub-h">Aeronautical income by airline</h4><ul class="fbars">${airRows}</ul>` : ''}

    <h3 id="fin-out">Expenses <small>${formatINR(exp)}</small></h3>
    ${breakdown(day.out, EXPENSE, COLOURS_OUT)}
    <h4 class="sub-h">Running costs per day at today’s rates</h4>
    <div class="kpis fd-grid">${Object.entries(rates).map(([k, v]) => `<span>${esc(EXPENSE[k])} <b>${formatINR(v)}</b></span>`).join('')}<span>Total <b>${formatINR(perDay)}</b> · 30 days ${formatINR(perDay * 30)}</span></div>
    ${capital.length ? `<h4 class="sub-h">Investment since the start</h4><div class="kpis fd-grid">${capital.map(([c, v]) => `<span>${esc(EXPENSE[c])} <b>${formatINR(v)}</b></span>`).join('')}</div>` : ''}

    <h3 id="fin-unit">Per unit</h3>
    <div class="kpis fd-grid">
      <span>Income per departure <b>${deps ? formatINR(inc / deps) : '–'}</b></span><span>Cost per departure <b>${deps ? formatINR(exp / deps) : '–'}</b></span>
      <span>Income per passenger <b>${pax ? formatINR(inc / pax) : '–'}</b></span><span>Retail per passenger <b>${pax ? formatINR((day.in.retail ?? 0) / pax) : '–'}</b></span>
      <span>Aeronautical share <b>${pct(aero, inc)}</b></span><span>Wages share of costs <b>${Math.round(staffShare * 100)} %</b></span>
    </div>

    <h3 id="fin-hist">History</h3>
    <table class="fids ftable"><tr><th>Day</th><th>Income</th><th>Expenses</th><th>Profit</th><th>On time</th></tr>
      ${history.map((h) => `<tr class="${h.today ? 'today' : ''}"><td>${h.label}</td><td>${formatINR(h.inc)}</td><td>${formatINR(h.exp)}</td><td class="${h.inc - h.exp >= 0 ? 'ok' : 'bad'}">${formatINR(h.inc - h.exp)}</td><td>${Math.round(h.otp * 100)} %</td></tr>`).join('')}
    </table>

    <h3 id="fin-tx">Recent transactions</h3>
    ${tx.length ? `<ul class="txs">${tx.map((x) => `<li><span>${hhmm(x.t)}</span><span>${esc(x.label)}</span><b class="${x.kind === 'in' ? 'ok' : 'bad'}">${x.kind === 'in' ? '+' : '−'}${formatINR(x.amount).replace('−', '')}</b></li>`).join('')}</ul>` : '<p class="muted">No one-off transactions yet.</p>'}
    <div class="row-actions"><button data-action="exportFinance">⬇ Export the books (CSV)</button></div>`;
}

// Finance lines for the day report.
export function reportFinance(fin) {
  if (!fin) return '';
  const top = (book, labels) => Object.entries(book).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `<li>${esc(labels[k] ?? k)} <b>${formatINR(v)}</b></li>`).join('');
  return `<h3>Where the money came from and went</h3><div class="rgroups"><div class="rgroup"><h4>Income</h4><ul class="obj">${top(fin.in, INCOME)}</ul></div><div class="rgroup"><h4>Expenses</h4><ul class="obj">${top(fin.out, EXPENSE)}</ul></div></div>`;
}

// The books as CSV: one row per day, kind and category (days from the reports, then today).
export function financeCsv(w) {
  const rows = [['day', 'date', 'kind', 'category', 'amount_inr']];
  const push = (label, date, book) => {
    for (const [k, v] of Object.entries(book.in ?? {})) rows.push([label, date, 'income', INCOME[k] ?? k, Math.round(v)]);
    for (const [k, v] of Object.entries(book.out ?? {})) rows.push([label, date, 'expense', EXPENSE[k] ?? k, Math.round(v)]);
  };
  for (const r of w.reports) if (r.finance) push(r.day, r.date, r.finance);
  push('today', '', w.ledger.day);
  return rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n');
}
