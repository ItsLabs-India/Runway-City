# Runway City — Build Action Plan

> Source of truth for this project. Claude Code auto-loads it. Update it as decisions change.
> Full research plan: `E:\CodeBase\reports\Chennai airport sim game plan.md` (notes in `E:\CodeBase\research_notes\Chennai airport sim game plan\`).

## 1. Mission

A 2D top-down airport management game in the browser, modelled on the **real Chennai International Airport (MAA / VOMM)** as it stands in Oct 2026. Real layout, real airline schedules, real weather and live traffic, Chennai's real disruptions as scenarios.

**The player builds fast:** prefab modules, drag-to-size, templates, bulk upgrades and group hiring. **Never** Airport CEO-style placement of individual walls, desks, chairs or bins. Depth goes into running flights and passengers, not decorating.

**Non-goals (v1):** monetisation or ads (free data feeds are non-commercial only), accounts, multiplayer, app stores.

## 2. Tech stack (locked)

| Layer | Choice |
|---|---|
| Rendering | **2D top-down map on Canvas 2D** (no 3D engine). North up; drag to pan, wheel/pinch/+− to zoom, follow-aircraft. Static airport cached to an offscreen layer (redrawn only when the camera moves); traffic drawn on top each frame. Detail appears by zoom level (LOD) |
| Language / build | Plain JavaScript (ES modules) + Vite |
| Simulation | Pure logic in `src/sim/` (no DOM), 1 s ticks, 0/1/3/10/30/60× speed (1× is the default: one clock second per real second; see "Time" in section 7); whole state saved with `World.snapshot()` / `restore()` (deterministic: restored games replay identically) |
| Map data | OSM extracts (airside, landside, surroundings) → `scripts/build-map.mjs` → `public/data/maa-map.json` (~1.4 MB; local metres `[x, y]`: x east, y south) |
| Aircraft / vehicles | 11 real types (ATR 72, Q400, A320neo, A321neo, 737-800, 737 MAX 8, 787-8/-9, A350-900, A340-300, 777-300ER). Real dimensions in `src/sim/aircraftTypes.js` → geometry in `src/sim/airframe.js` → drawn by `src/map/sprites.js` and collided by `footprint.js` (same shapes). Generic neutral tails. No licensed art |
| Passengers | Aggregate queues per process + a small sample of drawn people (never thousands of agents) |
| UI | HTML overlay (`src/ui/`) |
| Hosting | Cloudflare Workers: static game + `/api/*` proxy in one deploy (`wrangler.jsonc`, `worker/index.js`). In `npm run dev` the same worker code is served by a Vite plugin |
| Saves | IndexedDB slot `auto` (autosave every 20 s and on page hide) + export / import `.json` (`src/persist.js`) |

## 3. Folder structure

```
data/raw/            OSM extracts (ODbL). Refresh with `npm run fetch:osm`, rarely
scripts/             build-map, fetch-osm; checks: sim-check (24 h headless: overlaps, stuck, line following),
                     term-check (passengers, save/load determinism, lever tests), ui-test (Playwright in your Chrome:
                     62 checks incl. phone touch, offline, accessibility), inspect (live gear-to-line distances);
                     import-timetable (CSV → public/data/timetable.json)
worker/index.js      /api/traffic (adsb.fi), /api/metar (NOAA AWC): trimmed, cached, CORS-enabled proxy
wrangler.jsonc       one Cloudflare deploy for game + proxy: `npm run build && npx wrangler deploy`
site/                marketing page (plain HTML + CSS, images from `npm run site:shots`); `npm run build:site` makes `_site`
public/              maa-map.json (generated), manifest.webmanifest, sw.js (offline), icon.svg
src/main.js          bootstrap, loop, actions, keyboard, autosave
src/persist.js       IndexedDB + file export/import        src/audio.js  optional ATC voice
src/live/            real wind (Open-Meteo / METAR) and Live Watch ghosts
src/map/             camera, renderer, props, sprites, geometry
aircraft.html        developer viewer of the fleet (`npm run aircraft` saves screenshots)
src/sim/             world, timing (game clock, service times), terminal (passengers, staff, modules), projects, taxiGraph,
                     stands, footprint, schedule, airlines, brands, weather, sky, aircraftTypes, airframe, scenarios, lineCheck
src/ui/              hud (shell, menu, report), panels (all panels as pure functions)
```

## 3a. Simulation rules (do not break)

- **No overlaps, enforced by geometry, verified by `npm run check`:** stands accept an aircraft only if its
  footprint clears buildings, jet bridges and the apron edge (`stands.js` fits), and neither its body nor its
  turnaround vehicle area clashes with aircraft booked on neighbouring stands. Vehicle spots are solved
  collision-free per type (`servicePositions`), vehicles drive around the aircraft (`routeAround`), and tugs
  return along their own empty lead-in. Every change to sim or stands must keep the check at 0 overlaps / 0 stuck.
- **Flight phases:** scheduled → holding (no stand / no slot) → inbound → final → landing → taxiIn → atStand
  (turnaround tasks) → pushback → turning → taxiOut → holdShort → lineUp → takeoff → departed; plus goAround,
  diverted, cancelled. Every wait sets `f.waiting` (shown to the player) and the first cause sets `f.delayCause`.
- **Runway:** one active direction (wind decides; player can switch). Arrival slots keep wake separation
  (`SEP`, doubled in low visibility); a departure goes when the next arrival leaves it time to line up and get airborne (`#departureGap`), and frees the runway once airborne (`RUNWAY_FREE_ALT_M`). Closures re-slot arrivals,
  hold departures at the gate, and divert flights more than 50 min late.
- **Ground traffic:** taxi routes are registered with direction; routes against existing traffic cost extra per metre (a flat charge per segment sent aircraft across the airfield),
  so opposing flows use different taxiways. Aircraft stop for traffic ahead; only a true circular wait may be
  broken (counted in `kpi.conflictsIgnored`, should stay 0).
- **Taxi lines = aircraft paths (one geometry):** `TaxiGraph.filletArc` makes every turn a circular
  fillet (40 m radius, 55 m for runway turn-offs). `paintLines()` paints straight centrelines + these arcs
  (Y lead-ins at every stand, yellow lead-on/lead-off over the runway) at real 0.3 m width, and
  `smoothRoute()` builds every aircraft path from the same arcs. Stand direction = its real lead-in edge.
- **Steering:** the nose gear runs on the line and the main gear is the point on the line one wheelbase
  (straight) behind, so both gears stay on the paint and the body swings in turns (`#placeOnPath`).
  Speed in curves ≤ sqrt(1.0 m/s² · R). Routing is direction-aware: no turn sharper than 110°.
- **Real manoeuvres:** landing roll → follows the lead-off curve at a forward-angled exit; taxi-in ends with
  the nose gear at the stand's stop position; push-back is tail-first along the lead-in and round the curve
  onto the taxilane (away from the taxi-out direction), ending aligned; line-up follows the lead-on curve.
- **Ground control:** taxiways are split into corridors at real junctions (stand lead-ins do not split
  them). An aircraft is cleared at each junction only if no corridor left on its route is occupied, or
  promised to a cleared aircraft, the other way; otherwise it holds 47.5 m short of the crossing
  taxiway (ICAO code E intermediate holding position). Push-back and exit choice use the same test. An
  aircraft still on the runway never holds. Standoffs re-route either aircraft (max +1.5 km); only after
  4 min is a counted last-resort override used (`kpi.conflictsIgnored`, currently 1–3 per day).
- **Turnaround:** tasks with dependencies; each needs vehicles from the shared fleet (`GSE`) and the flight
  needs a ramp crew. Shortages are the main thing the player manages (buy / hire in groups).

## 3b. Passengers, staff, projects, live data (do not break)

- **Passengers are FIFO fluid queues** (`terminal.js`): check-in → security → emigration (departures) and
  arrivals immigration → reclaim, per terminal (T1, T4, T2, T3, T5). Capacity = open positions × tier rate,
  where open positions come from the staffing dial (Auto / Lean / Standard / Surge) limited by on-duty staff
  (headcount × shift template share). Departing passengers must clear security before boarding starts:
  at 92 % cleared, or at gate closure (`serviceTime(18 min)` before STD) the rest are offloaded (money + satisfaction penalty).
- **Quick / group building** is by panel, not by placing objects: add positions in steps, upgrade technology,
  bulk "upgrade all", **plan mode** (stage, preview cost and time, Build all), **layout codes** (`RC1.…`,
  copy and stamp onto another terminal). Nothing is built instantly; every order has a build time.
- **Terminal 3 stands** (`T3-n`) are created at start but locked and invisible; the T3 project unlocks them
  with 22 m bridges (`stand.bridge`). Locked stands are skipped by the renderer, picking and paint.
- **Projects** (`projects.js`): rets (spacing × 0.8), cat3 (low-vis 2× → 1.3×), hydrant (+6 fuel, 30 % faster),
  t3, t5. Effects are read through getters (`sepScale`) so a restored game keeps them.
- **Day report** when the sim day ends at 06:00 IST (`pendingReport`, one policy perk of three). The game loop pauses while any
  modal is open.
- **Live data is optional**: real wind from Open-Meteo (CORS ok) or METAR via `/api/metar`; "Live Watch" draws real
  aircraft from `/api/traffic` as translucent ghosts with the adsb.fi credit (non-commercial terms: keep the
  game free). Military / privacy-flagged aircraft are removed in the worker. Feeds off = game unchanged.
- **Timetable**: if `public/data/timetable.json` exists it replaces the generated day (weekday-aware).
- **Tests to keep green**: `npm run check -- <scenario> 24` (0 overlaps, 0 stuck, gears < 1 m off the lines),
  `npm run check:terminals`, `npm run check:time`, `npm run test:ui`.

## 4. Coordinates and facts

- Reference point lat 12.9941, lon 80.1709. x = metres east, z = metres south, y = up.
- Runway 07/25: 3,661 m × 45 m, CAT I ILS both ends, the main runway. 25 threshold is the east end.
- Runway 12/30: 2,890 m, Code C only, RWY 12 threshold displaced 780 m, crosses the Adyar river on a bridge.
- Capacity 36 movements/hour (eAIP); AAI target ~45 with new rapid-exit taxiways.
- ~87 primary stands on aprons A, B, T, I, II, III; only PB104 takes an A380. OSM stand points are "Bay N" `gate` nodes; Phase 1 should replace them with eAIP stand coordinates.
- Terminals: T1 + T4 domestic, T2 international, T3 under construction (career goal), T5 planned north-west (late game). Parandur was cancelled in Aug 2026.
- OSM has no building heights; heights in `build-map.mjs` are estimates.

## 5. Legal and IP rules (do not break)

- Real airline names, codes, flight numbers and ICAO type codes as **plain text only**.
- **No** airline logos, liveries or brand colours; aircraft use generic paint.
- **No** "Chennai International Airport", "AAI" or airline names in the game title, icon or store text. Keep "Unofficial fan project, not affiliated with AAI or any airline" visible.
- Always show data credits: "© OpenStreetMap contributors" now; add DGCA, adsb.fi, AeroDataBox, NOAA AWC and Open-Meteo when used.
- Players never call data providers directly; everything goes through one cached Worker.

## 6. Roadmap

| Phase | Goal | Status |
|---|---|---|
| 0. Spike | Real MAA as a detailed 2D map from OSM; pan / zoom / pick | **Done** |
| 1. One Real Day | Full flight life cycle on the real taxi network, stands, turnarounds, scenarios, save / load, importer for a real timetable | **Done** (real DGCA data not bundled) |
| 2. Quick building + staff | Terminals with modules, upgrades, plan mode, layout codes, staffing dials, shift templates, hiring, heat overlay, day report + policies | **Done** (panel-based; no map drag-placement) |
| 3. Live layer | Worker proxy, real wind, runway follows wind, Live Watch | **Done** (AeroDataBox board not built; Worker not deployed) |
| 4. Career + scenarios | T3, rapid exits, CAT-III, hydrant, T5 projects; career scenario; daily challenge; layout codes | **Done** |
| 5. Polish | ATC voice (off by default), PWA / offline, phone layout, keyboard, accessibility | **Done** (voice not heard in tests; MapLibre radar tab skipped) |

## 7. Working rules

- Keep the simulation independent of rendering, so speed-up, saves and the Worker move stay easy.
- Keep real-world facts in data files, not code; refresh schedules each IATA season.
- Time (2026-10-31): `sim/timing.js`. The game clock is not the real-world clock: every new game (every scenario) and every sim day starts at 06:00 IST; only the date and season come from the real date. A day runs 06:00 to 06:00 (`simDay`, `hoursIntoDay`): the report, the Day number and the books' hours follow it (`hours[0]` is 06:00). 1× is the default and means one clock second per real second; the other buttons are exact multiples (`npm run test:ui` measures them). Movement stays at real speed. Work takes `SERVICE_TIME` (0.3) of its real duration: turnaround tasks and their lead times (the plans in `world.js` stay in real minutes, `#startTurnaround` scales them), gate closure, passengers leaving the aircraft, runway inspections and random-event repairs. Not scaled, on purpose: the timetable (STA / STD stay real, so aircraft finish servicing early and wait for their departure time), runway separation, passenger process rates (they are capacity against real passenger numbers), walking, construction, weather, and scripted scenario disruptions. Add new ground work in real time and pass it through `serviceTime()`. Keep `npm run check:time` green.
- Test URLs: `?time=HH:MM` (IST start time, tests only: a game otherwise starts at 06:00), `?scenario=normal|festival|bhogi|cyclone|outage|sandbox` (skips the chooser), `?view=terminals|runway25|stands|gate`, `?speed=0|1|3|10|30|60`, `?warm=SECONDS` (run the sim ahead), `?panel=board|ops|log`.
- Real-world facts OSM lacks (displaced thresholds, approach-light lengths) come from the eAIP and live in `build-map.mjs` / `renderer.js` constants. OSM boarding-gate doors on terminal facades are filtered out of stands (`props.js`).
- Decided 2026-10-29 (after trying isometric and 3D): the game is a **full 2D top-down map**, drag/pan/zoom only. Do not reintroduce 3D, tilt or rotation.
- Two runways (2026-10-31): `world.runways` = [07/25 `main`, 12/30 `second`], each with its own direction, `mode` (both / arr / dep / off), `user`, `closures`, `arrSlots`, `lastDeparture`, exits and entry. A flight's runway is `f.rwy` (`world.runwayOf(f)`), chosen at booking (`#bookSlot`: soonest, least booked, 07/25 slightly preferred) and at the gate (`#chooseDeparture`). Never use a global runway: pass R to `#along`, `#offCentre`, `#runwayNeighbour`, `#bestExit`. Wide-bodies only on 07/25. Taxi crossings stop at any runway in use (`stop.rw`); a runway with mode off is plain pavement. The centrelines meet just past the 30 end (`crossPoint`): `#usesCrossing` says which movements pass it, `#crossingBusy` makes them take turns (07 and 12 landings are independent). `RUNWAY_PLANS` are presets; UI in `ui/runwayUi.js`. Default plan: dual landing. Keep `npm run check:runways` green.
- Finance (2026-10-30): every rupee goes through `World.#earn(amount, category, meta)` / `#spend(...)` (or `world.income` / `world.pay` from other modules) into `sim/finance.js` `Ledger`: by category (`INCOME`, `EXPENSE`), by hour, by airline (meta.airline) and a transaction log (meta.label). Never change `money` directly. Airport charges (`TARIFFS`) multiply landing, parking and UDF income and nudge satisfaction. The day report carries `finance`. UI: `ui/financeUi.js`. Keep `npm run check:finance` green (the books must balance with the cash).
- UI shell (2026-10-30): panels get a title bar and, when they have four or more `<h3>` sections, a row of jump links (`hud.js decorate`); top-bar figures are buttons that open where you manage them; H or ? opens keys and tips; the last open panel is remembered (`rc-tab`).
- Ground deadlocks (2026-10-30): `#inBlockCycle` follows holding-behind, give-way and hold-short-for-the-runway links (up to 30 aircraft); a cycle is broken by the last-resort override (sooner, 60 s, for an aircraft still on the runway). `npm run check:gridlock` replays the day that exposed it.
- Apron operations (2026-10-30): `sim/jetbridges.js` builds one working bridge per contact stand (rotunda on the terminal facade, a second for wide-body stands) and times it from the turnaround tasks (`connect` drives it out, `close` drives it back, so push-back always finds it parked); a contact stand no bridge reaches is served like a remote stand. `sim/groundcrew.js` places the people (roles, positions, animation) from tasks and vehicles; `World.vehicleSprites()` carries `task`, `work`, `progress`, `fill` and `flow` for the belt and cart animations. Drawing: `map/apronSprites.js` (people, bridges) and the GSE in `map/sprites.js`; animations run on the game clock (`sim.t`). The OSM jet-bridge lines are still used for stand fit checks but no longer drawn. Keep `npm run check:ground` green.
- Live flight data (2026-10-29): `sim/telemetry.js` derives what the instruments read from the flight's sim state (speeds in m/s and heights in m become kt and ft; vertical speed from the phase: 3° glide on final, 9 m/s climb; thrust and fuel are labelled estimates). `ui/instruments.js` draws the SVG dials; the selected flight's speed/altitude history is sampled in `main.js sampleTrace` into `ui.trace`. Nothing is stored in the flight itself. The card's section order is checked by `check:flights` and `test:ui`.
- Flight details (2026-10-29): `ui/flightDetails.js` renders the selected flight in a fixed order (status, route, timeline, aircraft, stand and turnaround, passengers, conditions). The timeline reads milestone times the sim records in `flight.times` (`#mark`: final, landed, board, airborne) plus `onBlock`, `offBlock` and `task.doneAt`; add a milestone by marking it in `world.js` and adding a step in `steps()`. Registrations are made up (`brands.js registration`), distances come from `airlines.js AIRPORTS`. Keep `npm run check:flights` green.
- Weather and light (2026-10-29): `sim/weather.js` makes a seeded sequence of spells (own RNG, saved with the game, exact forecast); `sim/sky.js` is the sun (elevation, sunrise/sunset, daylight, tint, shadow vector). `World.#environment()` (every 20 s) turns them into `world.wind` (scenario/real base wind in `windBase` + sea breeze, turbulence, gusts), `world.lights` (apron / taxi / terminal / runway step from daylight and visibility, with manual overrides in `world.lighting`), `world.fx` (taxi and ramp speed factors), lightning ramp closure (`rampClosed`, 10 min rule), low-visibility spacing from `visibility()`, crosswind closure and light faults (night-only random events). Rendering is `map/atmosphere.js`: one darkness layer, light sources cut holes in it and add glows, plus clouds, wet ground, fog, rain, lightning; building and aircraft shadows follow the sun. Never read the wall clock in the sim; always `world.t`. Tests that need dry, predictable weather construct `World` with `weatherMode: 'calm'`. Keep `npm run check:weather` green.
- Airlines (2026-10-29): `src/sim/brands.js` is the single source of airline identity (group, alliance, kind, region, ICAO callsign prefix, brand colours, livery). Aircraft liveries (`sprites.js`), map tags (`renderer.js` `airTag`), panels (`ui/airlines.js`, `logos.js` badges) and the day report read it; unknown airlines get a neutral livery. Per-airline daily results live in `world.airDay` (saved, reported at midnight). Official logos are never committed: users drop files in `public/data/logos/` (`npm run logos`). Keep `npm run check:brands` green.
- Aircraft (2026-10-29): data-driven. Add a type by giving `aircraftTypes.js` its real length / span / fuselage width, wing (root, chords, sweep, tip device), tailplane, fin, engine pod (`nacelle`), doors, `noseGear` and `wheelbase`; nothing else needs code. Positions are "metres from the nose". Jet pods hang under the wing (only the inlet end shows, as in real top views); turboprops sit on it. Flaps, slats and spoilers follow the flight phase. Gear geometry is per type (`f.gN`, `f.wb`), never a fraction constant.
- Traffic option (2026-10-30): the "normal" scenario takes a Traffic level, `World` option `trafficBoost` (`TRAFFIC_LEVELS` 0 / 0.5 = standard / +50 %, default `DEFAULT_TRAFFIC_BOOST` 0.5), chosen in the menu, remembered in `localStorage` (`rc-traffic`), saved with the game (old saves restore as 0). Other scenarios ignore it. `buildSchedule({ boost })` scales foreign banks and domestic departures (≈175 → 263 rotations a day) and, for a real timetable, adds shifted extra sections. Starting crews and vehicles scale by `1 + trafficBoost`. A +50 % day unattended: 91 % on time, 0 overlaps / 0 stuck / 0 diversions, but **9 conflict overrides** (evening peak 17:45–18:30, taxi-in vs taxi-out head-on on apron taxilanes) and one 1.39 m gear deviation during an override: the open ground-control task. A larger departure queue limit, a stricter one (6) and a bigger standoff detour (+3 km) did not reduce them. `boost: 1` (+100 %, 350 rotations, above the runway's 36 movements/h) is not offered: with extra equipment it can freeze the runway at line-up. `#requestPushback` meters departures (`MAX_DEPARTURE_QUEUE`) so the taxiway queue cannot block arrivals, and `#inBlockCycle` ignores stale `blockedBy` links (they hid a real deadlock at +50 %).
- Sound (2026-10-29): `src/soundscape.js` is a procedural Web Audio soundscape (no audio files, nothing licensed): wind, rain, thunder, aircraft (jet roar and whine, turboprop beat, APU at the stand, reverse thrust, Doppler), ground vehicles per kind (diesel idle/drive, 400 Hz GPU hum, pumps, conveyors, push-back beeper), Live Watch ghosts, road traffic and terminal crowd. The listener is the screen centre and loudness follows zoom (`scale`): zoomed out you only hear weather; aircraft carry from ~0.1 px/m, vehicles from ~0.6. Fixed voice pools (4 aircraft, 6 vehicles) take the loudest sources; a slot is only reused after it faded to silence. Sound only reads `world`/camera, never changes the sim, and fades out at 20×/60× and when paused. On by default after the first tap or key, remembered in `localStorage` (`rc-sound`), toggled by the 🔊 button, the Ops panel or key `M`. Keep `npm run check:sound` green.
- Art style (2026-10-29): clean top-down management-game look, using Airport CEO screenshots as a *style reference only*. All art is original vector drawing in `src/map/sprites.js`. Never copy or trace another game's sprites. Detail is gated by zoom (`scale` px/m): lights > 0.6, stand paint > 1.6, vehicle detail (wheels, bags, seats) > 2.5.
- Marketing page (2026-10-31): `site/` is the front page of the website, for players: no technical details, and it counts as store text under section 5 (no airline names, the fan-project line and data credits always shown). Its screenshots come from the real game (`scripts/site-shots.mjs`), with every flight repainted as a generic operator first, because the game itself shows airline names and colours. Keep claims true of the Pages build: no Live Watch there.
- Hosting (2026-10-30, updated 2026-10-31): the marketing page is at https://itslabs-india.github.io/Runway-City/ and the game at `/play/`, published by `.github/workflows/pages.yml` on every push to `main`. Only the deploy moves the game: in this repo it stays at the root (`index.html`, `npm run dev`, tests). The page itself removes the old offline worker of returning visitors; the repo was made public for this (free org plan). Pages has no `/api`: Live Watch and METAR report "unavailable", Open-Meteo wind still works. The Windows exe (Electron) was tried and removed the same day: no desktop build.
- Stand fit and wingtip clearance (2026-10-30): `buildStands(oriented, map, taxiLines)` accepts a type on a stand only if the whole outline (not just the centre) is on apron (≤ 2 % past the OSM edge), never on grass, clear of buildings / bridges, and at least `TAXI_CLEAR_M` (24.5 m, ICAO code C taxilane-to-object) from every taxi line, its own taxilane included (this replaced the old "lead-in ≥ 0.75 L" tail rule, which let wide-body tails sit on the taxilane). Stands no type fits get `usable: false`, are closed and are not drawn or pickable (OSM bay points on grass). Result: 66 narrow-body, 11–30 wide-body stands per type. Wide-bodies (half span + `WINGTIP_MARGIN_M` > 24.5 m) also route around taxi lines that pass an occupied stand too closely (`#wingReach`, `#routeOptions(f)`; a heavy penalty, not a ban, so routes never deadlock). `sim-check` now also counts "taxiing over parked aircraft" and "taxiing over working vehicles" (were 79 / 102 a day before this, now 0–1 / 1–2). Open: a push-back round the lead-in curve can still sweep a wing over a wide-body on the next stand (~1 a day).
- Cargo and general aviation (2026-10-30): rotations carry `service: 'cargo' | 'ga'` (passenger flights have none). `CARGO_AIRLINES` / `GENERAL_AVIATION` in `airlines.js` (Blue Dart, Quikjet, IndiGo CarGo, Alliance Air night network on 737-800BCF / A321P2F / ATR 72F; Qatar, Emirates, Etihad, Lufthansa, Turkish 777F; private VT- registered B350 / C56X / CL60). `schedule.js cargoAndGa()` uses its own RNG so passenger flights of a day are unchanged; it scales with traffic and the Traffic option (≈ 8 cargo + 6 GA a normal day, 14 + 9 at +50 %). Freighters: `paxIn/paxOut` 0, `cargoIn/cargoOut` tonnes, `#cargoPlan` (unload, fuel, load, no bridge / catering / cleaning), stands nearest the cargo terminal (`stand.cargoDist`), never jet-bridge stands, income `cargo` (₹5,000/t in + out). GA: `#gaPlan` (no ramp crew from the pool, operator's agent), smallest remote stand, income `ga` (₹30,000 a visit), wake `L` (new `SEP` pairs). New types: `B77F` (777 Freighter), `B350`, `C56X`, `CL60` (business jets use `nacelle.rear` = engines on the rear fuselage); `freightT` = payload, `freighter` = no windows. The OSM "Cargo Terminal" is no longer a passenger terminal for stand kinds. UI: Cargo / GA tags on the board, cargo tonnes or GA occupants instead of passengers in the flight card, `nameOf` shows the operator ("Qatar Airways Cargo"). Brands BZ, QO, TK, GA. Note: in `check:gridlock` (storm + projects stress run) deadlock overrides rose from 5–8 to 17–20 with the extra traffic, mostly passenger-to-passenger evening / night peak conflicts; the normal 24 h `npm run check` shows 3.
- Push-backs, wide-body taxilanes and ground vehicles (2026-10-30, production check): (1) `#pushBlocks()` gives each stand `pushBlocksOf(type)` (lazy, cached): neighbour stand + type pairs that a push-back swing would hit whichever way the tail turns; `standBlocker` refuses booking such pairs at the same time ("Push-back clash with stand X"). At push time `#pushSweepClear` re-tests the planned swing against aircraft actually parked within 250 m; if it clashes the push goes the other way (route planned facing the other way); if both clash it holds up to 10 min (`world.pushStats`). (2) `stand.accessBlocked(type, nId, nType)`: a wide-body may not be booked next to a stand whose aircraft every taxi line at its lead-in would pass closer than its half span + margin. (3) Freighters no longer take a ramp crew from the pool (cargo terminal handlers), like GA. (4) The fuel truck's service spot is ahead of the wing, pushed outward (was behind the wing and pushed aft into the taxilane: 43 taxi-over-vehicle events a day, now ~0). Tried and reverted (worse): straight-back "push and turn" for clashing pushes (gear deviation up to 7.8 m at taxi start), a 10-min gate hold for wide-bodies whose first 600 m pass narrow stands (held 14, released 12 anyway), and a "physically on my line" crossing rule (12 taxi overlaps). Remaining known, all wide-body on the Terminal 2 apron taxilane (narrow-bodies parked 24.5 m from a line wide-bodies must use; real MAA has Code E clearance there, the OSM bay points do not): ~1–9 brief (2–4 s) wing-over-parked/cart clips a day, plus a rare main-gear 1.5–1.75 m off the line at the start of taxi-out. Proper fix: real eAIP stand coordinates.
- Shadows (2026-10-31): one rule, `sunShadow(sun)` in `sim/sky.js`: a point h metres up falls (ux, uy) * h from the point below it, away from the sun, with alpha from sun height and `directSun(weather)` (overcast, rain, fog take shadows away). Never hard-code a shadow offset. Aircraft: `drawAircraftShadow` gives each part its own height from the type's real `height` (wing, body, tailplane, engines, fin swept root to tip, gear legs reach the ground); ground aircraft and jet bridges are drawn opaque into one layer laid over the map once (`#drawShadowLayer`), so overlaps are not darker. Solid parts are swept from their lowest to highest point (`sweepSteps`: a step per 1.5 screen pixels), so shadows grow out of the object; length is capped at twice the height (sun about 27° up) and alpha fades over the last 14° of sun. Always check shadow changes with Playwright close-ups. Vehicles and cars turn the world offset into their own frame (`localShadow`). Building shadows sweep the walls (`fillBuildingShadow`) so they stay attached. Keep the shadow checks in `npm run check:weather` green.
- Taxi pattern and traffic (2026-10-31): `#flowPlan()` works out, per active runway, which way each taxi line normally runs (departures from every stand first, then arrivals from their best exit; majority wins) and `#routeOptions` adds `AGAINST_FLOW_COST` per metre against it. Arrivals take the first usable exit unless someone is coming the other way on its route (`#bestExit`, `ROLL_COST`): the runway is the scarce resource. Tried: strong pattern with later exits (`ROLL_COST` 0.25–6): two-way taxiways fell from 13 to 4.7 km and taxi-in to 1.9 min, but occupied the runway (up to 126 go-arounds, on-time as low as 26 %). Measure a change with a full day in Playwright (taxi-out time, stopped time, on-time, go-arounds, forced resolutions), not by eye.
- Airport grounds (2026-10-31): `GROUND_EXTENSIONS` in `scripts/build-map.mjs` extends the OSM aerodrome boundary north-west of the runway 12 end (a game decision, not real data), keeping south of Manapakkam Main Road; minor streets inside are removed. Decorative only: stands, taxiways and traffic do not use it.
- Interface design (2026-10-31): the design system is the last layer of `src/style.css` (its header lists the rules). Tokens: surfaces `--s0..--s3`, text `--t1..--t3` (all at least 4.5:1), one accent, three state colours. Accent yellow means only "now / do this": running speed, open-tab underline, primary action, current timeline step; never a heading. State colours appear only when something needs attention; a healthy figure stays white. Selected options are white. At most one `.primary` on a screen. Top bar: time, then speed, then labelled figures, then panels; map controls float on the map (`.mapctl`). Flight card: what the player acts on first (status, route, timeline, stand, passengers); Live data, Aircraft and Conditions fold (`fold()`, remembered by `setSectionOpen`, Live data opens by itself for moving aircraft); actions stay in view. Day report: verdict, four tiles, the policy choice, then folded detail. Menu: Continue, two featured scenarios, the rest, options. Phones: status on top, navigation at the bottom. Log list classes are `lv-*` (a plain `info` class picked up the selection card's layout). Check UI changes with Playwright at 1440, 1280, 800 and 390 px.
