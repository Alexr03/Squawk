# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Squawk is a browser air traffic control game set at London's airports: a pnpm monorepo in strict TypeScript, Svelte 5 and Three.js r186. PLAN.md is the design spec, DECISIONS.md records the choices made while building it (update it when a rule or behaviour changes), and PROGRESS.md tracks the milestones.

## Commands

```sh
pnpm dev                 # http://localhost:5173 (runs `vite` in apps/web)
pnpm typecheck           # tsc --noEmit over packages/*/src, apps/web/src/**/*.ts, apps/leaderboard/src (.svelte files are not type-checked)
pnpm test                # vitest run: sim (incl. golden replay), phraseology, pipeline pack validation, leaderboard worker, web helpers
pnpm build               # static site in apps/web/dist

npx vitest run packages/sim/src/sim.test.ts -t "holding"   # one file / one test by name
node tools/simrun.ts EGLL-2026-08-28 7 45 1                # headless all-AI shift: day, start hour UTC, minutes, traffic share[, coverage]
node tools/play.mjs http://localhost:5173/ tools/scenarios/<name>.mjs <outDir>   # Playwright play-through with screenshots
node tools/careercheck.ts                                  # every career shift and a week of dailies have enough calls
```

- The quality bar for sim changes: `simrun EGLL-2026-08-28 7 45 1` stays around 10 landed / 19 departed with 0 collisions. Check other days too (`data/days/*.json`), because the sim is chaotic and one run can hide a regression.
- If `pnpm <script>` stops to reinstall `node_modules` ("Aborted removal of modules directory due to no TTY"), the underlying commands still work: `npx tsc --noEmit`, `npx vitest run`, `cd apps/web && npx vite` / `npx vite build`.
- Play-through scenarios export `default async (page, shot) => {}`. In dev builds `window.squawkSnap()` returns the current snapshot and `window.squawkDebug('crash' | 'emergency')` stages an incident. The in-game dev panel is F2, in dev builds or with `?dev` in the URL; shifts that use it stay off the leaderboard.
- Data: `node tools/pipeline/airport.ts <ICAO>` rebuilds an airport pack (OSM + `tools/pipeline/corrections/<ICAO>.json`). Baking traffic days needs OpenSky credentials in the git-ignored `credentials.json`. See tools/pipeline/README.md.

## Architecture

**packages/sim**: the deterministic simulation, with no DOM or Three.js.
- 4 Hz (`DT = 0.25`), seeded RNG (`rand(st)`), everything driven by `step(world, cfg, st)` in `index.ts`.
- `World` (`world.ts`) is static and rebuilt from airport packs: taxi graph, A* `route()`, runway ends, fixes, frequencies.
- `State` (`state.ts`) is plain serialisable data: aircraft, schedule, incidents, vehicles, stats, command log.
- Every sim function takes `(world, st)`. Never put Maps, class instances or randomness from `Math.random` into `State`.
- **Golden replay:** `replay(world, cfg, cmdLog, tick)` must reproduce `hashState`. The test compares a run with its own replay, so changes are fine as long as they stay deterministic.
- **Tick order** in `step()`: pending radio, spawns, `aiStep` (AI controllers for every seat the player doesn't cover), take-off rolls, per-aircraft `moveGround` / `moveAir`, separation (every other tick), ground rules, handoffs, radio rules, emergencies, incidents, runway config, weather.
- **Commands** go through `issue()`: `pilot.ts` validates, transmits, delays the readback, then applies. Tower-only actions (fire service, closing runways) go through `incidents.ts` `facility()`.
- **Ownership:** each aircraft has an `owner` seat (`EGLL:TWR`, `LON`, …). `domain()` decides the seat it should be with; `st.coverage` lists the player's seats; `blame()` / `penal()` only count penalties for aircraft the player works. `event()` writes a score event and an on-screen alert together.
- **Ground movement** is node locks (`Aircraft.claims`) plus a physical traffic-ahead check in `physics.ts`. Mutual waits are broken by distance to the contested node.
- **Air:** `moveAir` covers turns, wind, routes, holds and ILS capture. `predict.ts` `project()` flies an aircraft's current instructions ahead; it is used both by STCA (`rules.ts` `separation()`) and by the scope's projection line, so keep them in step.
- **Holds:** the holding-pattern geometry (`holdShape`, `racetrack`, `turnRate`) lives in `geo.ts`, shared by physics, the scope and the projection.
- **Subpath exports** (`@squawk/sim/geo`, `/types`, `/world`, …) let the renderer import pieces without the whole sim.

**packages/phraseology**: CAP 413 text and speech, typed shortcuts, voice grammar, place names (rules in DECISIONS.md "Phraseology").

**packages/render**: the Three.js scene and the 2D radar overlay.
- **Low resolution on purpose:** the WebGL canvas is the low-res target (`setPixelRatio(1 / pixelSize)`, nearest-neighbour CSS upscale).
- **Effects chain:** render → grade → bloom → output → SMAA. The "Smooth edges" setting switches SMAA, PCF shadows and soft lights live.
- **Radar** (`radar.ts`) is a full-resolution 2D canvas drawn every frame, crossfading in as you zoom out; above 8 m/px the WebGL pass is skipped.
- **Inputs:** the scene gets views (`AircraftView`, `VehicleView`), not sim state.

**apps/web**: the Svelte 5 client.
- **The sim runs in a Web Worker** (`worker.ts`). `GameClient` (`game/client.ts`) posts commands and receives snapshots, and the main thread blends between the last two.
- **Co-op** (`net/`) is a WebRTC star. The host runs the only sim; guests use `RemoteClient` and send commands, which the host checks against that guest's seats.
- **Main game files:**
  - `game/Game.svelte`: the shift screen.
  - `game/Scope.svelte`: feeds the renderer and draws alert lines, routes and captions.
  - `game/assist.ts`: action bubbles, drag targets, score pops.
  - `game/flightplan.ts`: plan and projection lines.
  - `game/sound.ts` and `audio/`: speech and chimes, all synthesised.
- **Menu-side code:** `lib/` holds settings (`settings.svelte.ts`), the career, made-up days, PocketBase accounts and cloud saves (`pb.svelte.ts`), and data loading.

**apps/leaderboard**: a single-file Cloudflare Worker with KV, for the daily leaderboard and co-op room signalling. It has no package.json and is deployed with `npx wrangler`.

**pocketbase/**: migrations and hooks for accounts (Discord), scores, profiles and co-op rooms. Change rules with a new migration rather than editing an applied one.

**data/**: committed airport packs (`airports/<ICAO>/airport.json`, `scenery.json`) and day packs (`days/<ICAO>-<date>.json`, OpenSky + METAR).

## Conventions

- **Code style:** dense, comment-light code with short "why" comments, matching the surrounding style. UI and radar text use IBM Plex Sans/Mono (no pixel fonts), and menus and HUD are game-like floating glass panels, not dashboard styling.
- **Line endings are mixed** (most files LF, some CRLF, e.g. apps/leaderboard). Keep each file's existing endings so diffs stay small. Check `git diff --stat` for whole-file churn.
- **Commits:** one fix per commit, with a plain-language message describing the behaviour change.
