// Puts the public website together in _site: the marketing page (site/) at the top and the built game
// (dist/) under play/. Run through `npm run build:site`, which builds the game first.
import { cp, rm } from 'node:fs/promises';

await rm('_site', { recursive: true, force: true });
await cp('site', '_site', { recursive: true });
await cp('public/icon.svg', '_site/icon.svg');
await cp('dist', '_site/play', { recursive: true });
console.log('_site is ready: marketing page at /, game at /play/');
