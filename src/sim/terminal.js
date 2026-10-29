// Passenger and terminal simulation: FIFO fluid queues at check-in, security, emigration,
// arrivals immigration and baggage reclaim. Capacity = positions × tier rate, limited by on-duty
// staff. Departing passengers appear before each flight's STD and must clear security before
// boarding; arriving passengers leave the aircraft and flow to reclaim. All state is plain data.
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const cdf = (u) => {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x); // smoothstep: peak of arrivals in the middle of the window
};

// Real throughput figures from the research notes: BCAS caps a conventional lane at 160–180/h and
// automatic tray return reaches ~280/h; staffed check-in ~75–90 s per passenger; self bag-drop is
// faster; immigration desks ~90 s per passenger. Costs are game-scaled rupees.
export const PROCESSES = {
  checkin: {
    label: 'Check-in', unit: 'counter', dept: 'checkin', opt: 10, addCost: 6e5,
    rate: [42, 76, 98], staffPer: [1, 0.5, 0.35], upCost: [0, 4e5, 6e5],
    tiers: ['Staffed counters', 'Self bag-drop', 'Self bag-drop + app'],
  },
  security: {
    label: 'Security', unit: 'lane', dept: 'security', opt: 10, addCost: 35e5,
    rate: [170, 280, 350], staffPer: [4, 4, 3], upCost: [0, 18e5, 60e5],
    tiers: ['Conventional X-ray', 'Automatic tray return', 'CT scanners'],
  },
  immigration: {
    label: 'Emigration', unit: 'desk', dept: 'immigration', opt: 10, addCost: 10e5,
    rate: [40, 75, 110], staffPer: [1, 0.4, 0.25], upCost: [0, 12e5, 20e5],
    tiers: ['Manned desks', 'FTI-TTP e-gates', 'Biometric e-gates'],
  },
  arrImm: {
    label: 'Immigration', unit: 'desk', dept: 'immigration', opt: 10, addCost: 10e5,
    rate: [40, 75, 110], staffPer: [1, 0.4, 0.25], upCost: [0, 12e5, 20e5],
    tiers: ['Manned desks', 'FTI-TTP e-gates', 'Biometric e-gates'],
  },
  reclaim: {
    label: 'Baggage reclaim', unit: 'belt', dept: 'reclaim', opt: 15, addCost: 120e5,
    rate: [360, 520, 700], staffPer: [2, 2, 1.5], upCost: [0, 50e5, 90e5],
    tiers: ['Standard belt', 'Dual-feed belt', 'Smart belt'],
  },
};
export const PROC_ORDER = ['checkin', 'security', 'immigration', 'arrImm', 'reclaim'];
export const DIALS = { auto: 'Auto', lean: 'Lean', standard: 'Standard', surge: 'Surge' };
const DIAL_SHARE = { lean: 0.5, standard: 0.8, surge: 1 };

export const DEPTS = {
  security: { label: 'Security (CISF)', wage: 1500, hire: 4e4, start: 260 },
  checkin: { label: 'Check-in agents', wage: 900, hire: 2.5e4, start: 190 },
  immigration: { label: 'Immigration officers', wage: 2000, hire: 6e4, start: 190 },
  reclaim: { label: 'Baggage handlers', wage: 800, hire: 2e4, start: 100 },
};

// Relative on-duty weights by hour of day. Average share is normalised to 1/3 (3 shifts).
export const SHIFTS = {
  even: { label: 'Even 3-shift', weights: Array(24).fill(1) },
  day: { label: 'Day-heavy', weights: Array.from({ length: 24 }, (_, h) => (h >= 6 && h < 22 ? 1.4 : 0.45)) },
  peak: {
    label: 'Chennai peaks',
    weights: Array.from({ length: 24 }, (_, h) => (h < 4 ? 0.8 : h < 11 ? 1.5 : h < 17 ? 0.9 : 1.3)),
  },
};
export function shiftShare(shift, hour) {
  const w = SHIFTS[shift].weights;
  const mean = w.reduce((a, b) => a + b, 0) / 24;
  return w[hour] / mean / 3;
}

export const TERMINAL_DEFS = {
  T1: { name: 'Terminal 1', short: 'T1', kind: 'dom', start: { checkin: 26, security: 12, reclaim: 6 }, cap: { checkin: 44, security: 18, reclaim: 9 }, retail: [6, 12] },
  T4: { name: 'Terminal 4', short: 'T4', kind: 'dom', start: { checkin: 12, security: 6, reclaim: 3 }, cap: { checkin: 28, security: 10, reclaim: 5 }, retail: [4, 8] },
  T2: {
    name: 'Terminal 2', short: 'T2', kind: 'intl',
    start: { checkin: 24, security: 10, immigration: 28, arrImm: 34, reclaim: 6 },
    cap: { checkin: 60, security: 16, immigration: 44, arrImm: 52, reclaim: 9 }, retail: [10, 18],
  },
  T3: {
    name: 'Terminal 3 (phase 2)', short: 'T3', kind: 'mixed', locked: 't3',
    start: { checkin: 28, security: 10, immigration: 24, arrImm: 28, reclaim: 6 },
    cap: { checkin: 64, security: 20, immigration: 48, arrImm: 56, reclaim: 10 }, retail: [8, 20],
  },
  T5: {
    name: 'Terminal 5', short: 'T5', kind: 'mixed', locked: 't5',
    start: { checkin: 32, security: 14, immigration: 30, arrImm: 36, reclaim: 7 },
    cap: { checkin: 80, security: 26, immigration: 56, arrImm: 64, reclaim: 12 }, retail: [10, 26],
  },
};

const CHAINS = { depDom: ['checkin', 'security'], depIntl: ['checkin', 'security', 'immigration'], arrDom: ['reclaim'], arrIntl: ['arrImm', 'reclaim'] };
const WALK_S = { checkin: 60, security: 90, immigration: 90, arrImm: 150, reclaim: 0 };
const RETAIL = { podCost: 5e5, pax: 25, spendPerHour: { dom: 600, intl: 1800, mixed: 1200 }, share: 0.35 };
const SELL_REFUND = 0.4;

export const PERKS = {
  fasttrack: { label: 'Fast-track lane', text: 'Security throughput +10 %' },
  kiosks: { label: 'Self-service kiosks', text: 'Check-in throughput +15 %' },
  ramp: { label: 'Ramp efficiency drills', text: 'Turnaround tasks 8 % faster' },
  gse: { label: 'Preventive maintenance', text: 'Ground equipment breakdowns halved' },
  concession: { label: 'Concession drive', text: 'Retail revenue +20 %' },
  wages: { label: 'Group wage deal', text: 'Staff wages −10 %' },
};

export class Terminals {
  constructor(world) {
    this.w = world;
    this.list = {};
    for (const [id, def] of Object.entries(TERMINAL_DEFS)) this.list[id] = makeTerminal(id, def);
    this.staff = Object.fromEntries(Object.entries(DEPTS).map(([k, d]) => [k, d.start]));
    this.shift = 'even';
    this.transit = [];
    this.nextGen = 0;
    this.nextCalc = 0;
    this.day = freshDay();
    this.fmap = new Map();
  }

  // ---- queries -----------------------------------------------------------------------------

  rate(T, key) {
    const P = T.proc[key];
    let r = PROCESSES[key].rate[P.tier];
    if (key === 'security') {
      if (T.kind === 'intl') r *= 0.92;
      if (this.w.perks.includes('fasttrack')) r *= 1.1;
    }
    if (key === 'checkin' && this.w.perks.includes('kiosks')) r *= 1.15;
    if (key === 'checkin' && this.w.t < this.w.mods.itUntil) r *= 0.5; // IT outage: manual check-in
    if (key === 'security' && this.w.t < (this.w.mods.secUntil ?? -1)) r *= 0.5;
    return r;
  }

  positionsBuilding(T, key) {
    return T.builds.filter((b) => b.kind === 'add' && b.proc === key).reduce((s, b) => s + b.n, 0);
  }

  estWait(T, key) {
    const P = T.proc[key];
    const mu = P.open * this.rate(T, key);
    if (P.qn < 1) return 0;
    return mu > 0 ? (P.qn / mu) * 60 : 99;
  }

  worstWait(T) {
    let worst = 0;
    for (const key of Object.keys(T.proc)) worst = Math.max(worst, this.estWait(T, key));
    return worst;
  }

  wageMul() {
    return this.w.perks.includes('wages') ? 0.9 : 1;
  }

  dailyStaffCost() {
    return Object.entries(DEPTS).reduce((s, [k, d]) => s + this.staff[k] * d.wage, 0) * this.wageMul();
  }

  onDuty(dept, hour = Math.floor((this.w.t % 86400) / 3600)) {
    return Math.floor(this.staff[dept] * shiftShare(this.shift, hour));
  }

  termFor(f) {
    const L = this.list;
    if (L.T5.open && f.id % 10 < 3) return 'T5';
    if (L.T3.open && f.id % 10 >= 7) return 'T3';
    if (f.intl) return 'T2';
    return f.airline === 'AI' || f.airline === 'IX' || f.type === 'AT76' ? 'T4' : 'T1';
  }

  window(f) {
    return f.intl ? [f.std - 210 * 60, f.std - 75 * 60] : [f.std - 150 * 60, f.std - 40 * 60];
  }

  // Start of game: passengers of flights whose window has begun are assumed already processed.
  initFlights() {
    const t = this.w.t;
    for (const f of this.w.flights) {
      f.pax = { term: this.termFor(f), out: 0, done: 0, inn: 0, exit: 0, board: null, missed: 0, late: 0 };
      const [a, b] = this.window(f);
      if (t > a) {
        const g = cdf((t - a) / (b - a)) * f.paxOut;
        f.pax.out = g;
        f.pax.done = g;
        this.list[f.pax.term].airside += g;
      }
      if (f.onBlock && f.onBlock < t) {
        f.pax.inn = f.paxIn;
        f.pax.exit = f.paxIn;
      }
    }
  }

  // ---- the simulation tick -------------------------------------------------------------------

  update(dt) {
    const t = this.w.t;
    if (t >= this.nextGen) {
      this.nextGen = t + 30;
      this.fmap = new Map(this.w.flights.map((f) => [f.id, f]));
      this.#generate(t);
    }
    if (t >= this.nextCalc) {
      this.nextCalc = t + 15;
      this.#allocate(t);
      this.#builds(t);
    }
    if (this.transit.length) {
      const keep = [];
      for (const x of this.transit) (x.at <= t ? this.#enter(x.T, x.key, x.fid, x.n, x.dir, t) : keep.push(x));
      this.transit = keep;
    }
    for (const T of Object.values(this.list)) {
      if (!T.open) continue;
      for (const key of Object.keys(T.proc)) this.#serve(T, key, dt, t);
      this.#retail(T, dt);
    }
  }

  #generate(t) {
    for (const f of this.w.flights) {
      if (f.phase === 'cancelled' || f.phase === 'diverted') continue;
      if (!f.pax) f.pax = { term: null, out: 0, done: 0, inn: 0, exit: 0, board: null, missed: 0, late: 0 };
      const p = f.pax;
      const [a, b] = this.window(f);
      if (t >= a && p.out < f.paxOut - 1e-6 && p.board === null) {
        p.term ??= this.termFor(f);
        const add = cdf((t - a) / (b - a)) * f.paxOut - p.out;
        if (add > 0.5 || (t >= b && add > 1e-6)) {
          p.out += add;
          this.day.paxOut += add;
          const T = this.list[p.term];
          const share = f.intl ? 0.7 : 0.6;
          this.#enter(T, 'checkin', f.id, add * share, 'dep', t);
          this.#enter(T, 'security', f.id, add * (1 - share), 'dep', t);
        }
      }
      if (f.onBlock !== null && f.onBlock !== undefined && p.inn < f.paxIn - 1e-6) {
        p.term ??= this.termFor(f);
        const span = Math.max(240, f.paxIn * 1.6);
        const start = f.onBlock + 60;
        const add = clamp((t - start) / span, 0, 1) * f.paxIn - p.inn;
        if (add > 0.5 || (t >= start + span && add > 1e-6)) {
          p.inn += add;
          this.day.paxIn += add;
          this.transit.push({ at: t + 120, T: this.list[p.term], key: CHAINS[f.intl ? 'arrIntl' : 'arrDom'][0], fid: f.id, n: add, dir: 'arr' });
        }
      }
    }
  }

  #enter(T, key, fid, n, dir, t) {
    if (n <= 1e-9) return;
    const P = T.proc[key];
    if (!P || P.positions === 0) return this.#forward(T, key, fid, n, dir, t, true);
    P.inAcc += n;
    const last = P.q[P.q.length - 1];
    if (last && last.fid === fid && last.dir === dir && t - last.t0 < 30) last.n += n;
    else P.q.push({ fid, n, dir, t0: t });
    P.qn += n;
  }

  #forward(T, key, fid, n, dir, t, skipWalk = false) {
    const f = this.fmap.get(fid) ?? this.w.flights.find((x) => x.id === fid);
    if (!f) return;
    const chain = CHAINS[dir + (f.intl ? 'Intl' : 'Dom')];
    const next = chain[chain.indexOf(key) + 1];
    if (next) {
      const walk = skipWalk ? 0 : WALK_S[key];
      if (walk > 0) this.transit.push({ at: t + walk, T, key: next, fid, n, dir });
      else this.#enter(T, next, fid, n, dir, t);
    } else if (dir === 'dep') {
      if (f.pax.board !== null) f.pax.late += n; // too late: the aircraft is boarded
      else {
        f.pax.done += n;
        T.airside += n;
      }
    } else {
      f.pax.exit += n;
    }
  }

  #serve(T, key, dt, t) {
    const P = T.proc[key];
    if (!P.positions) return;
    P.carry += (P.open * this.rate(T, key) / 3600) * dt;
    const opt = PROCESSES[key].opt;
    while (P.q.length) {
      const c = P.q[0];
      const f = this.fmap.get(c.fid);
      if (c.dir === 'dep' && f?.pax.board !== null && f) {
        // This flight has already left (or boarded): its late passengers are rebooked, not served.
        f.pax.late += c.n;
        P.qn -= c.n;
        P.q.shift();
        continue;
      }
      if (P.carry <= 1e-9) break;
      const take = Math.min(c.n, P.carry);
      const wait = (t - c.t0) / 60;
      P.carry -= take;
      P.qn -= take;
      c.n -= take;
      P.sumWait += wait * take;
      P.sumN += take;
      P.wait += (wait - P.wait) * Math.min(1, take / 150);
      T.scoreSum += clamp(1 - Math.max(0, wait - opt) / (2 * opt), 0, 1) * take;
      T.scoreN += take;
      this.day.waitSum[key] = (this.day.waitSum[key] ?? 0) + wait * take;
      this.day.waitN[key] = (this.day.waitN[key] ?? 0) + take;
      if (c.n <= 1e-9) P.q.shift();
      this.#forward(T, key, c.fid, take, c.dir, t);
    }
    if (!P.q.length) {
      P.carry = 0;
      P.qn = 0;
    }
  }

  #retail(T, dt) {
    if (!T.retail.pods || T.airside < 1) return;
    const browsing = Math.min(T.airside, T.retail.pods * RETAIL.pax);
    let rev = (browsing * RETAIL.spendPerHour[T.kind] * RETAIL.share * dt) / 3600;
    if (this.w.perks.includes('concession')) rev *= 1.2;
    this.w.income(rev, 'retail');
    this.day.retail += rev;
  }

  // Open positions per process from the staffing dial, limited by on-duty staff.
  #allocate(t) {
    const hour = Math.floor((t % 86400) / 3600);
    const reqs = [];
    for (const T of Object.values(this.list)) {
      if (!T.open) continue;
      for (const [key, P] of Object.entries(T.proc)) {
        const rate = this.rate(T, key);
        const perHour = P.inAcc / (15 / 3600);
        P.inAcc = 0;
        P.inflow += (perHour - P.inflow) * 0.35;
        let req;
        if (P.dial === 'auto') {
          const need = (P.inflow + P.qn * 10) / rate;
          req = P.positions === 0 ? 0 : clamp(Math.ceil(need * 1.15), 1, P.positions);
        } else {
          req = Math.ceil(P.positions * DIAL_SHARE[P.dial]);
        }
        const per = PROCESSES[key].staffPer[P.tier];
        reqs.push({ T, key, P, req, per, dept: PROCESSES[key].dept });
      }
      T.scoreSum *= Math.exp(-15 / 7200);
      T.scoreN *= Math.exp(-15 / 7200);
      T.score = T.scoreN > 20 ? (T.scoreSum / T.scoreN) * 100 : 100;
    }
    for (const dept of Object.keys(DEPTS)) {
      const mine = reqs.filter((r) => r.dept === dept);
      const duty = this.onDuty(dept, hour);
      const need = mine.reduce((s, r) => s + r.req * r.per, 0);
      const k = need <= duty || need === 0 ? 1 : duty / need;
      for (const r of mine) {
        r.P.req = r.req;
        r.P.open = k === 1 ? r.req : Math.floor(r.req * k + 1e-9);
        r.P.short = r.req - r.P.open;
      }
      this.dutyNow = this.dutyNow ?? {};
      this.dutyNow[dept] = { duty, need: Math.ceil(need) };
    }
    this.#alerts(t);
  }

  #alerts(t) {
    for (const T of Object.values(this.list)) {
      if (!T.open) continue;
      for (const [key, P] of Object.entries(T.proc)) {
        const wait = this.estWait(T, key);
        const limit = PROCESSES[key].opt * 1.6;
        if (wait > limit && t >= (P.alertAt ?? 0)) {
          P.alertAt = t + 45 * 60;
          const why = P.short > 0 ? `${P.short} position${P.short > 1 ? 's' : ''} short of staff` : P.open < P.positions ? `${P.open} of ${P.positions} ${PROCESSES[key].unit}s open` : `all ${P.positions} ${PROCESSES[key].unit}s busy`;
          this.w.note('warn', `${T.name} ${PROCESSES[key].label.toLowerCase()}: about ${Math.round(wait)} min wait (${why}).`, { terminal: T.id });
        }
      }
    }
  }

  // ---- boarding gate -------------------------------------------------------------------------

  // May boarding start? Needs 92 % of passengers through security (and emigration), or the gate
  // closure time (STD − 18 min) after which the rest are offloaded.
  boardingReady(f) {
    const p = f.pax;
    if (!p) return { ok: true, board: f.paxOut };
    const t = this.w.t;
    const closing = t >= f.std - 18 * 60;
    if (p.done >= 0.92 * f.paxOut || closing) return { ok: true, board: Math.min(f.paxOut, Math.floor(p.done + 1e-6)) };
    return { ok: false, reason: `Passengers still in the ${this.bottleneck(f).toLowerCase()} queue`, cause: `${this.bottleneck(f)} queue` };
  }

  bottleneck(f) {
    const T = this.list[f.pax?.term];
    if (!T) return 'Terminal';
    let best = { n: -1, key: 'security' };
    for (const key of ['checkin', 'security', 'immigration']) {
      const P = T.proc[key];
      if (!P) continue;
      const n = P.q.filter((c) => c.fid === f.id).reduce((s, c) => s + c.n, 0) + this.transit.filter((x) => x.fid === f.id && x.key === key).reduce((s, x) => s + x.n, 0);
      if (n > best.n) best = { n, key };
    }
    return PROCESSES[best.key].label;
  }

  startBoarding(f, board) {
    const p = f.pax;
    if (!p) return;
    const T = this.list[p.term];
    p.board = board;
    p.missed = Math.max(0, Math.round(f.paxOut - board));
    T.airside = Math.max(0, T.airside - p.done);
    if (p.missed > 0) {
      this.day.missed += p.missed;
      this.w.pay(p.missed * 2500, 'compensation', { label: `${f.depNo}: ${p.missed} passengers compensated` });
      this.w.nudgeSatisfaction(-Math.min(6, p.missed * 0.12));
      this.w.note('warn', `${f.depNo}: ${p.missed} passenger${p.missed > 1 ? 's' : ''} missed the flight (${this.bottleneck(f).toLowerCase()} queue).`, { flight: f.id });
    }
  }

  // ---- building, upgrades, staffing ----------------------------------------------------------

  // Validates one operation against a virtual state; returns { ok, why, cost, minutes }.
  quote(op, virt = null) {
    const T = this.list[op.term];
    if (!T) return { ok: false, why: 'Unknown terminal' };
    if (!T.open) return { ok: false, why: `${T.name} is not open yet` };
    const v = virt ?? {};
    const get = (key) => (v[`${op.term}.${key}`] ??= { positions: T.proc[key]?.positions ?? 0, adds: this.positionsBuilding(T, key), tier: T.proc[key]?.tier ?? 0, tierPending: T.builds.some((b) => b.kind === 'tier' && b.proc === key), pods: T.retail.pods, podsBuilding: T.builds.filter((b) => b.kind === 'retail').reduce((s, b) => s + b.n, 0) });
    if (op.kind === 'retail') {
      const s = get('retail_');
      const n = Math.max(0, op.n | 0);
      if (!n) return { ok: false, why: 'Nothing to add' };
      if (s.pods + s.podsBuilding + n > T.retail.cap) return { ok: false, why: `${T.name} has room for only ${T.retail.cap} retail pods` };
      s.podsBuilding += n;
      return { ok: true, cost: n * RETAIL.podCost, minutes: 20 + 5 * n };
    }
    const def = PROCESSES[op.proc];
    const P = T.proc[op.proc];
    if (!P) return { ok: false, why: `${T.name} has no ${def?.label.toLowerCase() ?? 'such'} area` };
    const s = get(op.proc);
    if (op.kind === 'add') {
      const n = Math.max(0, op.n | 0);
      if (!n) return { ok: false, why: 'Nothing to add' };
      if (s.positions + s.adds + n > P.cap) return { ok: false, why: `${T.name} can take at most ${P.cap} ${def.unit}s (${s.positions + s.adds} planned)` };
      s.adds += n;
      return { ok: true, cost: n * def.addCost, minutes: 25 + 7 * n };
    }
    if (op.kind === 'tier') {
      const to = op.to ?? s.tier + 1;
      if (s.tierPending) return { ok: false, why: 'An upgrade is already under construction' };
      if (to <= s.tier || to > 2) return { ok: false, why: s.tier >= 2 ? 'Already the best technology' : 'Nothing to upgrade' };
      let cost = 0;
      for (let k = s.tier + 1; k <= to; k++) cost += (s.positions + s.adds) * def.upCost[k];
      s.tier = to;
      s.tierPending = true;
      return { ok: true, cost, minutes: 60 + 6 * s.positions };
    }
    if (op.kind === 'sell') {
      const n = Math.max(0, op.n | 0);
      if (!n || s.positions - n < 1) return { ok: false, why: 'Cannot remove that many' };
      s.positions -= n;
      return { ok: true, cost: -n * def.addCost * SELL_REFUND, minutes: 0 };
    }
    return { ok: false, why: 'Unknown operation' };
  }

  previewPlan(ops) {
    const virt = {};
    let cost = 0;
    let minutes = 0;
    const items = ops.map((op) => {
      const q = this.quote(op, virt);
      if (q.ok) {
        cost += q.cost;
        minutes = Math.max(minutes, q.minutes);
      }
      return { op, ...q };
    });
    return { items, cost, minutes, ok: items.every((i) => i.ok) };
  }

  applyPlan(ops) {
    const plan = this.previewPlan(ops);
    const bad = plan.items.find((i) => !i.ok);
    if (bad) return { ok: false, message: bad.why };
    if (plan.cost > this.w.money) return { ok: false, message: `Not enough money (needs ${fmtCr(plan.cost)})` };
    const t = this.w.t;
    this.w.pay(Math.max(0, plan.cost), 'build', { label: `Terminal works: ${plan.items.length} item${plan.items.length > 1 ? 's' : ''}` });
    if (plan.cost < 0) this.w.income(-plan.cost, 'sales', { label: 'Terminal equipment removed' });
    let n = 0;
    for (const i of plan.items) {
      const op = i.op;
      const T = this.list[op.term];
      if (op.kind === 'sell') {
        T.proc[op.proc].positions -= op.n;
        continue;
      }
      T.builds.push({ id: ++n + Math.floor(t), kind: op.kind, proc: op.proc ?? null, n: op.n ?? 0, to: op.to, finishAt: t + i.minutes * 60 });
    }
    return { ok: true, message: `${plan.items.length} change${plan.items.length > 1 ? 's' : ''} ordered (${fmtCr(plan.cost)}), ready in ${Math.round(plan.minutes)} min`, cost: plan.cost };
  }

  #builds(t) {
    for (const T of Object.values(this.list)) {
      if (!T.builds.length) continue;
      const keep = [];
      for (const b of T.builds) {
        if (b.finishAt > t) {
          keep.push(b);
          continue;
        }
        if (b.kind === 'add') {
          T.proc[b.proc].positions += b.n;
          this.w.note('info', `${T.name}: ${b.n} new ${PROCESSES[b.proc].unit}${b.n > 1 ? 's' : ''} open (${PROCESSES[b.proc].label.toLowerCase()}).`, { terminal: T.id });
        } else if (b.kind === 'tier') {
          T.proc[b.proc].tier = b.to ?? T.proc[b.proc].tier + 1;
          this.w.note('info', `${T.name}: ${PROCESSES[b.proc].label.toLowerCase()} upgraded to ${PROCESSES[b.proc].tiers[T.proc[b.proc].tier].toLowerCase()}.`, { terminal: T.id });
        } else if (b.kind === 'retail') {
          T.retail.pods += b.n;
          this.w.note('info', `${T.name}: ${b.n} retail pod${b.n > 1 ? 's' : ''} open.`, { terminal: T.id });
        }
      }
      T.builds = keep;
    }
  }

  setDial(termId, key, dial) {
    const P = this.list[termId]?.proc[key];
    if (!P || !DIALS[dial]) return { ok: false, message: 'Unknown staffing level' };
    P.dial = dial;
    return { ok: true, message: `${this.list[termId].name} ${PROCESSES[key].label.toLowerCase()}: ${DIALS[dial]} staffing` };
  }

  setDialAll(key, dial) {
    for (const T of Object.values(this.list)) if (T.open && T.proc[key]) T.proc[key].dial = dial;
    return { ok: true, message: `All ${PROCESSES[key].label.toLowerCase()} areas: ${DIALS[dial]} staffing` };
  }

  setShift(shift) {
    if (!SHIFTS[shift]) return { ok: false, message: 'Unknown shift template' };
    this.shift = shift;
    return { ok: true, message: `Shift template: ${SHIFTS[shift].label} (applies to every department)` };
  }

  hire(dept, n) {
    const d = DEPTS[dept];
    if (!d) return { ok: false, message: 'Unknown department' };
    if (n > 0) {
      const cost = n * d.hire;
      if (this.w.money < cost) return { ok: false, message: 'Not enough money' };
      this.w.pay(cost, 'hiring', { label: `Hired ${n} × ${d.label.toLowerCase()}` });
      this.staff[dept] += n;
      return { ok: true, message: `Hired ${n} × ${d.label.toLowerCase()} (${fmtCr(cost)}, ${fmtCr(n * d.wage)} per day)` };
    }
    const k = Math.min(-n, this.staff[dept] - 10);
    if (k <= 0) return { ok: false, message: 'Cannot release more' };
    this.staff[dept] -= k;
    return { ok: true, message: `Released ${k} × ${d.label.toLowerCase()}` };
  }

  unlock(id) {
    const T = this.list[id];
    const def = TERMINAL_DEFS[id];
    if (!T || T.open) return;
    T.open = true;
    for (const [key, n] of Object.entries(def.start)) if (T.proc[key]) T.proc[key].positions = n;
    T.retail.pods = def.retail[0];
    this.w.note('info', `${T.name} opens to passengers.`, { terminal: id });
  }

  // ---- layout codes (share / stamp) ----------------------------------------------------------

  layoutCode(id) {
    const T = this.list[id];
    const c = {};
    for (const [key, P] of Object.entries(T.proc)) c[key] = [P.positions, P.tier];
    return `RC1.${btoa(JSON.stringify({ c, r: T.retail.pods }))}`;
  }

  layoutOps(id, code) {
    let data;
    try {
      if (!code.startsWith('RC1.')) throw new Error('bad prefix');
      data = JSON.parse(atob(code.slice(4).trim()));
    } catch {
      return { ok: false, message: 'That is not a valid layout code' };
    }
    const T = this.list[id];
    const ops = [];
    for (const [key, P] of Object.entries(T.proc)) {
      const want = data.c?.[key];
      if (!want) continue;
      const have = P.positions + this.positionsBuilding(T, key);
      const add = Math.min(want[0], P.cap) - have;
      if (add > 0) ops.push({ kind: 'add', term: id, proc: key, n: add });
      if (want[1] > P.tier && !T.builds.some((b) => b.kind === 'tier' && b.proc === key)) ops.push({ kind: 'tier', term: id, proc: key, to: Math.min(2, want[1]) });
    }
    const pods = Math.min(data.r ?? 0, T.retail.cap) - T.retail.pods - T.builds.filter((b) => b.kind === 'retail').reduce((s, b) => s + b.n, 0);
    if (pods > 0) ops.push({ kind: 'retail', term: id, n: pods });
    return { ok: true, ops };
  }

  // Bulk upgrade: raise one process to the next technology in every open terminal at once.
  upgradeAllOps(key) {
    const ops = [];
    for (const T of Object.values(this.list)) {
      const P = T.proc[key];
      if (T.open && P && P.tier < 2 && !T.builds.some((b) => b.kind === 'tier' && b.proc === key)) ops.push({ kind: 'tier', term: T.id, proc: key });
    }
    return ops;
  }

  // ---- forecast: expected pax/h in each of the next `hours` hours ------------------------------

  forecast(id, key, hours = 12) {
    const t = this.w.t;
    const h0 = Math.floor(t / 3600) * 3600;
    const out = Array(hours).fill(0);
    for (const f of this.w.flights) {
      if (f.phase === 'cancelled' || f.phase === 'diverted' || f.phase === 'departed') continue;
      if ((f.pax?.term ?? this.termFor(f)) !== id) continue;
      if (key === 'checkin' || key === 'security' || key === 'immigration') {
        if (key === 'immigration' && !f.intl) continue;
        const share = key === 'checkin' ? (f.intl ? 0.7 : 0.6) : 1;
        const [a, b] = this.window(f);
        for (let i = 0; i < hours; i++) {
          const lo = Math.max(h0 + i * 3600, a);
          const hi = Math.min(h0 + (i + 1) * 3600, b);
          if (hi > lo) out[i] += (cdf((hi - a) / (b - a)) - cdf((lo - a) / (b - a))) * f.paxOut * share;
        }
      } else if (key === 'arrImm' || key === 'reclaim') {
        if (key === 'arrImm' && !f.intl) continue;
        const start = f.sta + (f.inboundDelay ?? 0) + 60;
        const i = Math.floor((start - h0) / 3600);
        if (i >= 0 && i < hours) out[i] += f.paxIn;
      }
    }
    return out;
  }

  // ---- persistence ---------------------------------------------------------------------------

  snapshot() {
    return { list: this.list, staff: this.staff, shift: this.shift, transit: this.transit, nextGen: this.nextGen, nextCalc: this.nextCalc, day: this.day, dutyNow: this.dutyNow ?? null };
  }

  restore(s) {
    this.list = s.list;
    this.staff = s.staff;
    this.shift = s.shift;
    this.transit = s.transit;
    this.nextGen = s.nextGen;
    this.nextCalc = s.nextCalc;
    this.day = s.day;
    this.dutyNow = s.dutyNow;
    this.fmap = new Map(this.w.flights.map((f) => [f.id, f]));
  }

  freshDay() {
    const old = this.day;
    this.day = freshDay();
    return old;
  }
}

function makeTerminal(id, def) {
  const open = !def.locked;
  const proc = {};
  for (const key of PROC_ORDER) {
    const cap = def.cap[key];
    if (!cap) continue;
    proc[key] = { positions: open ? def.start[key] ?? 0 : 0, cap, tier: 0, dial: 'auto', q: [], qn: 0, carry: 0, open: 0, req: 0, short: 0, inAcc: 0, inflow: 0, wait: 0, sumWait: 0, sumN: 0, alertAt: 0 };
  }
  return { id, name: def.name, short: def.short, kind: def.kind, open, locked: def.locked ?? null, proc, retail: { pods: open ? def.retail[0] : 0, cap: def.retail[1] }, builds: [], airside: 0, score: 100, scoreSum: 0, scoreN: 0 };
}

function freshDay() {
  return { waitSum: {}, waitN: {}, missed: 0, retail: 0, paxOut: 0, paxIn: 0 };
}

export function fmtCr(v) {
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(1)} lakh`;
  return `${s}₹${Math.round(a).toLocaleString('en-IN')}`;
}
