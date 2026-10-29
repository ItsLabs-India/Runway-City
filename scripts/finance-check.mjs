// Checks the books: every rupee is categorised and they balance with the cash, airport charges change
// income and satisfaction as described, the day report carries the books, and a save restores them.
// Usage: npm run check:finance
import { readFile } from 'node:fs/promises';
import { World } from '../src/sim/world.js';
import { INCOME, EXPENSE } from '../src/sim/finance.js';

const map = JSON.parse(await readFile(new URL('../public/data/maa-map.json', import.meta.url), 'utf8'));
const start = Date.UTC(2026, 9, 29, 0, 30);
let failed = 0;
const ok = (name, pass, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (!pass) failed++;
};
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

const w = new World(map, { scenarioId: 'normal', startTime: start, weatherMode: 'calm' });
const cash0 = w.money;
w.buyVehicles('tug', 2);
w.hireCrews(3);
w.sellVehicles('gpu', 1);
w.term.hire('security', 5);
w.update(26 * 3600);
const L = w.ledger;
ok('the books balance with the cash', Math.abs(cash0 + sum(L.total.in) - sum(L.total.out) - w.money) < 1, `${Math.round(w.money - cash0)} change`);
ok('the books match revenue and costs', Math.abs(sum(L.total.in) - w.kpi.revenue) < 1 && Math.abs(sum(L.total.out) - w.kpi.costs) < 1);
ok('every category is a known one', Object.keys(L.total.in).every((k) => INCOME[k]) && Object.keys(L.total.out).every((k) => EXPENSE[k]), `${Object.keys(L.total.in).join(', ')} / ${Object.keys(L.total.out).join(', ')}`);
ok('nothing lands in "other"', !L.total.in.other && !L.total.out.other);
const r = w.reports.at(-1);
ok('the day report carries the books', r?.finance && Math.abs(sum(r.finance.in) - r.revenue) < 2 && Math.abs(sum(r.finance.out) - r.costs) < 2);
ok('hours add up to the day', r && Math.abs(r.finance.hours.reduce((a, h) => a + h.in, 0) - sum(r.finance.in)) < 2);
ok('aeronautical income is split by airline', r && Object.keys(r.finance.airlines).length > 5);
ok('one-off transactions are logged', L.tx.some((x) => x.cat === 'equipment') && L.tx.some((x) => x.cat === 'hiring') && L.tx.some((x) => x.cat === 'sales'));

// Airport charges.
const aero = (x) => (x.ledger.day.in.landing ?? 0) + (x.ledger.day.in.udf ?? 0) + (x.ledger.day.in.parking ?? 0);
const a = new World(map, { scenarioId: 'normal', startTime: start, weatherMode: 'calm' });
const b = new World(map, { scenarioId: 'normal', startTime: start, weatherMode: 'calm' });
b.setTariff('premium');
a.update(6 * 3600);
b.update(6 * 3600);
const ratio = aero(b) / aero(a);
ok('premium charges raise aeronautical income about 15 %', ratio > 1.1 && ratio < 1.2, `×${ratio.toFixed(3)}`);
ok('premium charges cost satisfaction', b.kpi.satisfaction < a.kpi.satisfaction, `${a.kpi.satisfaction.toFixed(1)} → ${b.kpi.satisfaction.toFixed(1)}`);

// Saving.
const c = new World(map, { scenarioId: 'normal', startTime: start, weatherMode: 'calm' });
c.restore(w.snapshot());
w.update(3600);
c.update(3600);
ok('a saved game restores the books exactly', JSON.stringify(w.ledger.snapshot()) === JSON.stringify(c.ledger.snapshot()) && w.tariff === c.tariff);
process.exit(failed ? 1 : 0);
