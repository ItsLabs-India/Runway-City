// Small cockpit-style instruments as inline SVG: round dials (speed, altitude, vertical speed), a heading
// compass, and a sparkline for the recent history of a value. Pure functions that return HTML strings.

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
// Point on a circle: degrees clockwise from 12 o'clock.
const at = (r, deg, c = 50) => [c + r * Math.sin((deg * Math.PI) / 180), c - r * Math.cos((deg * Math.PI) / 180)];
const fix = (n) => n.toFixed(1);

// A round dial with a needle. min/max map to the angles from..to (degrees clockwise from the top).
export function dial({ value, min, max, from = -135, to = 135, step, major, label, unit, text, tone = '' }) {
  const k = clamp((value - min) / (max - min));
  const angle = from + (to - from) * k;
  const ticks = [];
  for (let v = min; v <= max + 1e-6; v += step) {
    const deg = from + ((to - from) * (v - min)) / (max - min);
    const big = Math.abs((v - min) % major) < 1e-6;
    const [x1, y1] = at(big ? 36 : 40, deg);
    const [x2, y2] = at(44, deg);
    ticks.push(`<line x1="${fix(x1)}" y1="${fix(y1)}" x2="${fix(x2)}" y2="${fix(y2)}" class="${big ? 'tk big' : 'tk'}"/>`);
    if (big) {
      const [tx, ty] = at(28, deg);
      const shown = Math.abs(v) >= 1000 ? `${Math.abs(v) / 1000}` : `${Math.abs(v)}`;
      ticks.push(`<text x="${fix(tx)}" y="${fix(ty + 2.5)}" class="tl">${shown}</text>`);
    }
  }
  const [nx, ny] = at(33, angle);
  return `<figure class="inst ${tone}"><svg viewBox="0 0 100 100" role="img" aria-label="${label} ${text}"><circle cx="50" cy="50" r="47" class="bg"/>${ticks.join('')}
    <line x1="50" y1="50" x2="${fix(nx)}" y2="${fix(ny)}" class="needle"/><circle cx="50" cy="50" r="3.4" class="hub"/><text x="50" y="72" class="un">${unit}</text></svg>
    <figcaption><small>${label}</small><b>${text}</b></figcaption></figure>`;
}

// Heading compass: the card turns under a fixed marker at the top.
export function compass(deg) {
  const marks = [];
  for (let d = 0; d < 360; d += 10) {
    const big = d % 30 === 0;
    const [x1, y1] = at(big ? 36 : 40, d);
    const [x2, y2] = at(44, d);
    marks.push(`<line x1="${fix(x1)}" y1="${fix(y1)}" x2="${fix(x2)}" y2="${fix(y2)}" class="${big ? 'tk big' : 'tk'}"/>`);
  }
  const cards = [['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([c, d]) => {
    const [x, y] = at(28, d);
    return `<text x="${fix(x)}" y="${fix(y + 3)}" class="tl ${c === 'N' ? 'north' : ''}">${c}</text>`;
  });
  return `<figure class="inst"><svg viewBox="0 0 100 100" role="img" aria-label="Heading ${Math.round(deg)} degrees"><circle cx="50" cy="50" r="47" class="bg"/>
    <g transform="rotate(${fix(-deg)} 50 50)">${marks.join('')}${cards.join('')}</g>
    <path d="M50 4 L46 12 L54 12 Z" class="marker"/><path d="M50 40 L45 58 L50 54 L55 58 Z" class="plane"/></svg>
    <figcaption><small>Heading</small><b>${String(Math.round(deg) % 360).padStart(3, '0')}°</b></figcaption></figure>`;
}

// Line of the last samples of one value, scaled to its own range.
export function spark(points, key, { unit = '', width = 170, height = 34 } = {}) {
  if (!points || points.length < 2) return '<div class="spark empty">collecting…</div>';
  const vals = points.map((p) => p[key]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = Math.max(1e-6, hi - lo) || 1;
  const t0 = points[0].t;
  const t1 = points.at(-1).t;
  const line = points.map((p) => `${fix(((p.t - t0) / Math.max(1, t1 - t0)) * width)},${fix(height - 3 - ((p[key] - lo) / span) * (height - 6))}`).join(' ');
  const last = vals.at(-1);
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Recent ${key}"><polyline points="${line}"/></svg><small>${Math.round(lo)}–${Math.round(hi)} ${unit} · now ${Math.round(last)}</small>`;
}
