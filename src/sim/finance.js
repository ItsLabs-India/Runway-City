// The airport's books: every rupee in and out, by category, by hour of the day, by airline, plus a log of
// the larger one-off transactions. Pure data (no DOM); saved with the game.

export const INCOME = {
  landing: 'Landing fees',
  parking: 'Parking fees',
  udf: 'Passenger fees (UDF)',
  retail: 'Retail concessions',
  sales: 'Equipment sales',
  other: 'Other income',
};

export const EXPENSE = {
  staff: 'Terminal staff wages',
  crews: 'Ramp crew wages',
  fixed: 'Fixed operations',
  vehicles: 'Vehicle running costs',
  power: 'Airfield lighting power',
  hiring: 'Hiring',
  equipment: 'Equipment purchases',
  build: 'Terminal works',
  projects: 'Capital projects',
  compensation: 'Passenger compensation',
  priority: 'Priority handling',
  other: 'Other costs',
};

// Airport charges the player can set: a multiplier on aeronautical income (landing, parking, UDF) and the
// effect on satisfaction per hour (airlines and passengers notice the price).
export const TARIFFS = {
  discount: { label: 'Discount', mult: 0.85, satPerHour: 0.25, text: '−15 % charges: airlines and passengers happier' },
  standard: { label: 'Standard', mult: 1, satPerHour: 0, text: 'AERA-approved rates' },
  premium: { label: 'Premium', mult: 1.15, satPerHour: -0.3, text: '+15 % charges: more income, satisfaction drifts down' },
};

const blankDay = () => ({ in: {}, out: {}, hours: Array.from({ length: 24 }, () => ({ in: 0, out: 0 })), airlines: {} });

export class Ledger {
  constructor() {
    this.day = blankDay();
    this.total = { in: {}, out: {} };
    this.tx = []; // the latest one-off transactions, newest first
  }

  add(kind, cat, amount, t, meta = null) {
    if (!(amount > 0)) return;
    const book = this.day[kind];
    book[cat] = (book[cat] ?? 0) + amount;
    this.total[kind][cat] = (this.total[kind][cat] ?? 0) + amount;
    const h = Math.floor((((t % 86400) + 86400) % 86400) / 3600);
    this.day.hours[h][kind] += amount;
    if (meta?.airline && kind === 'in') this.day.airlines[meta.airline] = (this.day.airlines[meta.airline] ?? 0) + amount;
    if (meta?.label) {
      this.tx.unshift({ t, kind, cat, amount, label: meta.label });
      if (this.tx.length > 40) this.tx.length = 40;
    }
  }

  sum(book) {
    return Object.values(book).reduce((a, b) => a + b, 0);
  }

  // The day's books for the report card; starts a fresh day.
  closeDay() {
    const d = this.day;
    const out = { in: { ...d.in }, out: { ...d.out }, hours: d.hours.map((h) => ({ ...h })), airlines: { ...d.airlines } };
    this.day = blankDay();
    return out;
  }

  snapshot() {
    return structuredClone({ day: this.day, total: this.total, tx: this.tx });
  }

  static restore(s) {
    const l = new Ledger();
    if (s) Object.assign(l, structuredClone(s));
    return l;
  }
}
