# Runway City · MAA

A 2D top-down airport management game in the browser, inspired by Chennai's real airport. You run the airport with quick, high-level building and group hiring, on the real layout, with real schedules and live traffic.

**[Play it](https://itslabs-india.github.io/Runway-City/play/)** · [Game page](https://itslabs-india.github.io/Runway-City/)

*Unofficial fan project, not affiliated with the Airports Authority of India or any airline.*

## Status

**Playable.** Chennai's real layout (OpenStreetMap plus official chart facts) as a detailed top-down map with a living airport on it:

- **Aircraft** land, taxi on the painted lines, park on a stand that fits, turn round, push back and take off. Gears stay on the lines (checked automatically). Eleven real types (ATR 72, Q400, A320neo, A321neo, 737-800, 737 MAX 8, 787-8, 787-9, A350-900, A340-300, 777-300ER) drawn from their real dimensions: wing planform, engines, winglets, tailplane, doors, flaps and slats that extend for landing.
- **Real airlines:** 21 airlines (IndiGo, Air India Group, SpiceJet, Akasa, Emirates, Qatar, Singapore, Lufthansa, British Airways and more) with their corporate group, alliance and business model. Aircraft are painted in each airline's colours, map tags and flight lists carry its badge, and an **Airlines** view groups them by owner, alliance, type or region with today's on-time results.
- **Weather, day and night:** random Chennai weather by season (north-east monsoon rain and thunderstorms, hot-season storms, winter mist), a real sun for the date, and night operations. The map darkens with sunrise, dusk and night; floodlights, runway, approach and taxiway lights, terminal windows and aircraft lights come on by rules. Rain, fog, lightning and wind change how the airport works (spacing, taxi speed, ramp work, runway closures). Weather can be set to Calm in the menu or the Operations panel.
- **Two runways:** 07/25 and 12/30 both work. Choose a plan (single runway, dual landing, segregated, dual mixed) or set each runway's direction and role yourself in Operations, or click a runway on the map. Arrivals share the runways by slot and load, wide-bodies stay on 07/25, traffic from 12/30 holds short and crosses 07/25, and movements that pass the point where the two centrelines meet take turns.
- **Finance and management:** a Finance panel (key I, or click the cash) with today's income, expenses, profit and a projection, cash flow by hour, income and expenses by category, aeronautical income by airline, running costs and investment, per-departure and per-passenger figures, a day-by-day history, recent transactions, airport charges (discount / standard / premium) and a CSV export of the books. The day report shows where the money came from and went.
- **Apron operations:** working jet bridges drive out to the aircraft door (two on wide-body stands) and back before push-back; belt loaders run bags down when unloading and up when loading, carts fill and empty, wide-bodies get ULD containers on dollies; ground staff are visible: ramp lead chocking the nose gear, baggage handlers carrying bags between carts and belt, fuellers, catering, cleaners, a marshaller with wands on remote stands, and a headset operator and two wing walkers on push-back.
- **Flight details:** click any flight for an ordered card: status, live flight data (speed, altitude and vertical-speed dials, a heading compass, ground speed and airspeed, QNH, height above ground, distance to go, thrust, fuel, squawk, gear, flaps, spoilers and lights, plus speed and altitude charts of the last minutes), the inbound and outbound route with distances, a timeline from final approach to take-off (planned, estimated and actual times, delays in minutes), aircraft (type, engines, size, a made-up registration), stand and turnaround progress, passengers and security progress, and the weather and runway conditions.
- **Passengers** queue at check-in, security, emigration, immigration and baggage reclaim. Long queues delay boarding and passengers miss flights.
- **You run it:** quick-add and upgrade counters, lanes, desks and belts (or stage a whole expansion in plan mode), set staffing, shifts and hiring, reassign stands, switch the runway, buy ground equipment.
- **Expand** with real projects: rapid-exit taxiways, CAT-III landing, fuel hydrant, Terminal 3 (new stands with jet bridges) and Terminal 5.
- **Scenarios:** normal day, Deepavali rush, Bhogi smoke, cyclone, IT outage, sandbox, a multi-day career, plus a daily challenge. A report card ends each day and offers a policy.
- **Real world, optional:** real wind sets the runway; "Live Watch" shows real aircraft near Chennai.
- **Saves**, offline play, phone layout, keyboard shortcuts.

## Run it

```bash
npm install
npm run dev                       # http://localhost:5173 (also serves /api like Cloudflare does)
npm run check -- festival 24      # headless 24 h test: overlaps, stuck aircraft, line following
npm run check:terminals           # passenger system, save/load determinism, lever tests
npm run test:ui                   # 62-check browser test in your Chrome (Playwright)
npm run inspect                   # live gear-to-line inspection of every scenario
npm run check:gridlock             # two-day replay of a ground deadlock found on 30 Oct 2026; traffic must keep flowing
npm run check:runways              # two-runway plans, interlock, role and direction changes, save/load
npm run check:finance              # the books balance, categories, charges, save/load
npm run check:ground               # jet bridges meet the door and retract before push-back; staff and bags logic
npm run check:flights              # flight details render for every flight and phase; milestones in order
npm run check:weather              # sun, climate, determinism, lighting logic and weather rules
npm run check:brands               # airline brand table: colours, contrast, callsigns
npm run logos                     # list official logo files you added in public/data/logos/
npm run aircraft                  # screenshots of every aircraft type (also: npm run dev → /aircraft.html)
npm run import:timetable -- schedule.csv   # real timetable → public/data/timetable.json
```

Deploy (free Cloudflare account): `npm run build && npx wrangler deploy`. This serves the game and the `/api` proxy together.

Useful URLs: `?scenario=cyclone`, `?time=09:20`, `?speed=30` (speeds 1, 3, 10, 30, 60), `?warm=1800`, `?panel=term`, `?view=stands`.

| Control | Action |
|---|---|
| Drag / arrow keys / one finger | Move around |
| Wheel / pinch / + − | Zoom |
| Space, 1–5 | Pause / resume; 1× (normal: real time), 3×, 10×, 30×, 60× |
| F T P O I L | Flights, Terminals, Projects, Operations, Finance, Alerts |
| H or ? | Keys and tips |
| F T P O L | Flights, Terminals, Projects, Operations, Alerts |
| Click an aircraft / stand / runway / terminal | Details and actions |
| ☰ | Menu: scenarios, continue, save, export, import |

## Airline logos

Brand colours, groups and alliances are built in (`src/sim/brands.js`, approximate; edit freely). **Official logos are trademarks and are not bundled**: every airline gets a monogram badge in its colours. To show real logos, copy files named by IATA code (`6E.svg`, `AI.png`, `EK.webp` ...) into `public/data/logos/` and run `npm run logos`. They then replace the badges in the panels and on the map tags. Check the licence of any logo you add before you publish the game.

## Map data

```bash
npm run fetch:osm   # re-download the OSM extract (rarely; the public server is often busy)
npm run build:map   # data/raw/*.json → public/data/maa-map.json
```

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL.

## Plan

See `CLAUDE.md` for the stack, rules and roadmap.

## Play online

**https://itslabs-india.github.io/Runway-City/**: deployed to GitHub Pages by `.github/workflows/pages.yml` on every
push to `main`. Pages is static, so the `/api` proxy is not there: Live Watch (real aircraft) and METAR need the
Cloudflare Worker deploy (`npm run build && npx wrangler deploy`); real wind still works via Open-Meteo.
