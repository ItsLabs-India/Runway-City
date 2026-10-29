// Airline logo badges, for the HTML panels and the map. Official logos are trademarks and are not
// bundled: every airline gets a monogram badge in its brand colours. To show an official logo
// instead, put a file named after the IATA code (6E.svg, AI.png ...) in public/data/logos/ and run
// `npm run logos`, which lists the files in public/data/logos/index.json.
import { brandOf, onColour } from './sim/brands.js';

let files = {}; // IATA code → url of a user-supplied logo
const images = new Map();

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function loadLogos(base = '/') {
  try {
    const r = await fetch(`${base}data/logos/index.json`);
    const j = r.ok ? await r.json() : null;
    files = Object.fromEntries(Object.entries(j?.logos ?? {}).map(([code, name]) => [code, `${base}data/logos/${name}`]));
  } catch {
    files = {};
  }
}

export const hasLogo = (code) => Boolean(files[code]);

// For canvas drawing: the loaded logo image, or null while loading / when there is none.
export function logoImage(code) {
  if (!files[code]) return null;
  let img = images.get(code);
  if (!img) {
    img = new Image();
    img.src = files[code];
    images.set(code, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

// HTML badge: the official logo if one was supplied, otherwise the code in the airline's colours.
export function badge(code, size = 'md') {
  const b = brandOf(code);
  const inner = files[code] ? `<img src="${esc(files[code])}" alt="">` : esc(code);
  return `<span class="al ${size}${files[code] ? ' has-logo' : ''}" style="--c:${b.primary};--t:${onColour(b.primary)}" title="${esc(b.name)}" aria-label="${esc(b.name)}">${inner}</span>`;
}
