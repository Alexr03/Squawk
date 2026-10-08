# Squawk

A browser air traffic control game at London Heathrow (and Gatwick, Stansted, Luton and City), built from real data: OpenStreetMap airport geometry corrected against the UK AIP (AIRAC 2610), real days of traffic from the OpenSky Network, real METARs, and UK CAP 413 radio phraseology. Work one position or all of them, from Delivery to London Control.

PLAN.md is the design spec, DECISIONS.md records the choices made while building it, PROGRESS.md tracks the milestones.

## Play

```sh
pnpm install
pnpm dev            # http://localhost:5173
```

Start with **Career** (it coaches you through each position) or **How to play** on the main menu.

## Build and test

```sh
pnpm typecheck      # TypeScript across all packages
pnpm test           # Vitest: sim (incl. golden replay), phraseology round-trips, pipeline validation, day packs
pnpm build          # static site in apps/web/dist
node tools/simrun.ts EGLL-2026-08-28 7 60 1   # headless all-AI shift: day, start hour UTC, minutes, traffic share
```

## Deploy (squawk.x3.dev)

The game is a static site; nothing runs on a server for single-player.

1. Cloudflare Pages → create a project from this repo. Build command `pnpm build`, output directory `apps/web/dist`, Node 24.
2. Custom domain: add `squawk.x3.dev` to the Pages project (Cloudflare creates the CNAME on the x3.dev zone).
3. Optional, for the daily leaderboard and co-op room codes: deploy the Worker in `apps/leaderboard` (see its README), then set `VITE_LEADERBOARD_URL` in the Pages build environment. Without it the leaderboard is per-device and co-op uses copy-paste invite codes.

## Layout

| Path | What |
| --- | --- |
| `packages/sim` | Deterministic simulation (4 Hz, seeded): traffic, physics, pilots, AI controllers, rules, scoring |
| `packages/phraseology` | CAP 413 text and speech, typed shortcuts, voice grammar |
| `packages/render` | Three.js "3D pixel art" airport and the radar scope |
| `apps/web` | Svelte game client, audio, voice input, menus |
| `apps/leaderboard` | Cloudflare Worker: daily leaderboard + co-op signalling |
| `tools/pipeline` | Airport packs (OSM + AIP) and day packs (OpenSky + METAR) |
| `data/` | Baked airport and day packs |

## Data

Rebuild an airport pack: `node tools/pipeline/airport.ts EGLL`. Bake a traffic day (needs `credentials.json` with OpenSky API client credentials in the repo root — never committed): `node tools/pipeline/traffic.ts EGLL 2026-08-28 --label "..." --tags summer,peak`. See `tools/pipeline/README.md`.

Attribution: airport geometry © OpenStreetMap contributors (ODbL); UK AIP via NATS AIS; traffic from The OpenSky Network; METARs from the Iowa Environmental Mesonet; coastline from Natural Earth. Not for real-world navigation or ATC.
