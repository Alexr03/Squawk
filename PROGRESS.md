# Squawk — build progress

Working tracker for the autonomous build of all five milestones. Decisions live in DECISIONS.md.

## Architecture (v2)

- `packages/sim`: `types.ts` (pack/command/radio contracts), `aircraft.ts` (type table), `airlines.ts` (telephony + livery colours), sim core.
- `packages/phraseology`: Radio -> CAP 413 text, typed-shortcut parser + autocomplete, voice grammar.
- `packages/render`: Three.js airport scene (pixelated, sun, shadows, AGL, bloom), radar layer, zoom crossfade.
- `apps/web`: Svelte UI, worker bootstrap, audio, voice input, menus, career, settings, co-op transport.
- `apps/leaderboard`: Cloudflare Worker + KV (daily challenge scores, co-op signalling).
- `tools/pipeline`: OSM (Overpass) airport import + AIP corrections + validation; OpenSky + METAR day baking.
- `data/airports/<ICAO>/airport.json`, `data/days/*.json`.

## Milestones

- [x] M1 prototype (Tower only), commit 23f158e
- [ ] M2 vertical slice: taxi graph + routing, radar + vectoring + ILS, radial menu, typed shortcuts, strips, handoffs, scoring + debrief, 7700/7600, first pixel art
- [ ] M3 content: Delivery, London Control (lite), career, second airport, weather + runway changes, night, audio
- [ ] M4 launch: voice commands, daily challenge, leaderboards worker, settings + accessibility, onboarding
- [ ] M5 post-launch: Gatwick/Stansted/Luton/City, London top-down, co-op seats, PWA

## Work log

- Contracts written (types/aircraft/airlines). Parallel agents: traffic pipeline, phraseology v2, audio + voice input.
