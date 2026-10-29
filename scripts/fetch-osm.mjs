// Downloads the OpenStreetMap extract for Chennai airport (VOMM) into data/raw/.
// Run rarely (the public Overpass server is often overloaded); the game never calls Overpass at runtime.
// Data © OpenStreetMap contributors, ODbL.
import { writeFile } from 'node:fs/promises';

// Public Overpass mirrors, tried in turn.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const BBOX = '12.955,80.125,13.020,80.215'; // south,west,north,east: airport plus surrounding streets

const QUERIES = {
  'osm_aeroway.json': `[out:json][timeout:90];
    (nwr["aeroway"](${BBOX}););
    out geom;`,
  'osm_landside.json': `[out:json][timeout:120];
    (
      way["building"](${BBOX});
      nwr["railway"~"station|platform|subway_entrance"](${BBOX});
      nwr["amenity"~"parking|bus_station|fire_station"](${BBOX});
      nwr["landuse"~"grass|military|construction"](${BBOX});
    );
    out geom;`,
  'osm_surroundings.json': `[out:json][timeout:120];
    (
      way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|residential|unclassified|service)$"](${BBOX});
      way["railway"~"^(rail|subway|light_rail)$"](${BBOX});
      way["waterway"~"^(river|canal|stream|drain)$"](${BBOX});
      nwr["natural"="water"](${BBOX});
      nwr["water"](${BBOX});
    );
    out geom;`,
};

const only = process.argv[2]; // optional: fetch just one file, e.g. osm_surroundings.json
for (const [file, query] of Object.entries(QUERIES)) {
  if (only && file !== only) continue;
  let saved = false;
  for (const endpoint of ENDPOINTS) {
    const res = await fetch(endpoint, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
      headers: { 'User-Agent': 'runway-city-map-builder/0.1' },
    }).catch((err) => ({ ok: false, status: err.message }));
    if (res.ok) {
      await writeFile(new URL(`../data/raw/${file}`, import.meta.url), await res.text());
      console.log(`saved data/raw/${file} (from ${new URL(endpoint).host})`);
      saved = true;
      break;
    }
    console.warn(`${file}: ${new URL(endpoint).host} failed (${res.status})`);
    await new Promise((r) => setTimeout(r, 5_000));
  }
  if (!saved) process.exit(1);
}
