// Lists the logo files in public/data/logos/ (6E.svg, AI.png ...) in index.json so the game shows
// them instead of the colour monogram badges.  Usage: npm run logos
import { readdir, writeFile } from 'node:fs/promises';

const dir = new URL('../public/data/logos/', import.meta.url);
const logos = {};
for (const name of (await readdir(dir)).sort()) {
  const m = /^([A-Za-z0-9]{2})\.(svg|png|webp|jpg)$/.exec(name);
  if (m) logos[m[1].toUpperCase()] = name;
}
await writeFile(new URL('index.json', dir), JSON.stringify({ logos }, null, 2));
console.log(Object.keys(logos).length ? `listed ${Object.keys(logos).length} logos: ${Object.keys(logos).join(', ')}` : 'no logo files found; badges stay as colour monograms');
