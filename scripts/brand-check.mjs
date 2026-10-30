// Checks the airline brand table: every airline in the sim has a brand, colours are valid and readable,
// callsign prefixes are unique, alliances are real.  Usage: npm run check:brands
import { BRANDS, ALLIANCES, onColour } from '../src/sim/brands.js';
import { DOMESTIC_AIRLINES, FOREIGN_AIRLINES, CARGO_AIRLINES } from '../src/sim/airlines.js';

const problems = [];
const hex = /^#[0-9a-f]{6}$/i;
const lum = (h) => {
  const n = parseInt(h.slice(1), 16);
  const lin = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

if (!BRANDS.GA) problems.push('GA (general aviation) has no brand');
for (const a of [...DOMESTIC_AIRLINES, ...FOREIGN_AIRLINES, ...CARGO_AIRLINES]) if (!BRANDS[a.code]) problems.push(`${a.code} (${a.name}) has no brand`);
const icao = new Map();
for (const b of Object.values(BRANDS)) {
  for (const [k, v] of Object.entries({ primary: b.primary, secondary: b.secondary, ...b.livery })) {
    if (typeof v === 'string' && !hex.test(v)) problems.push(`${b.code}: ${k} "${v}" is not a #rrggbb colour`);
  }
  if (b.alliance && !ALLIANCES.includes(b.alliance)) problems.push(`${b.code}: unknown alliance ${b.alliance}`);
  if (icao.has(b.icao)) problems.push(`${b.code}: callsign prefix ${b.icao} also used by ${icao.get(b.icao)}`);
  icao.set(b.icao, b.code);
  const text = onColour(b.primary);
  if (contrast(text, b.primary) < 4.5) problems.push(`${b.code}: badge text on ${b.primary} has contrast ${contrast(text, b.primary).toFixed(1)} (< 4.5)`);
  if (b.name.length > 24) problems.push(`${b.code}: name too long for the panels`);
}
console.log(`${Object.keys(BRANDS).length} airlines, ${new Set(Object.values(BRANDS).map((b) => b.group)).size} groups, ${new Set(Object.values(BRANDS).map((b) => b.alliance).filter(Boolean)).size} alliances`);
if (problems.length) {
  console.log(problems.map((p) => `  PROBLEM ${p}`).join('\n'));
  process.exit(1);
}
console.log('brand table OK');
