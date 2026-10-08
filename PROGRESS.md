# Squawk — build progress

Working tracker for the autonomous build of all five milestones. Decisions live in DECISIONS.md.

## Architecture

- `packages/sim`: contracts (`types.ts`), aircraft/airlines tables, `world.ts` (taxi graph, A*, runways), `traffic.ts` (real day packs → schedule, SID/STAR by direction, stands), `physics.ts` (ground with occupancy locks, air with wind/route/hold/ILS), `pilot.ts` (validate → transmit → readback → apply), `ai.ts` (AI controllers for every seat), `rules.ts` (separation, STCA, runway, handoffs, blame-based scoring), `events.ts` (7700/7600, closures, runway configs), `score.ts`, `views.ts`, `index.ts` (createShift/step/replay/snapshot).
- `packages/phraseology`: CAP 413 text/speech, typed shortcuts + autocomplete, voice grammar.
- `packages/render`: Three.js pixel-art airport + radar scope + zoom crossfade.
- `apps/web`: Svelte game client (worker, scope, strips, radio log + command line, radial menu, card, needs queue, voice, audio), menus (career, free shift, daily, endless, co-op, settings), debrief with replay.
- `tools/pipeline`: OSM + AIP (AIRAC 2610) airport packs for EGLL, EGKK, EGSS, EGGW, EGLC; OpenSky + METAR day packs.
- `tools/simrun.ts`: headless all-AI shift runner for tuning; `tools/play.mjs` + `tools/scenarios/*`: Playwright play-throughs.

## Milestones

- [x] M1 prototype (Tower only)
- [x] M2 vertical slice: taxi graph + routing, radar + vectoring + ILS, radial menu, typed shortcuts, strips, handoffs, scoring + debrief, 7700/7600, pixel art
- [x] M3 content: Delivery, London Control, career (5 ratings, checkrides), second airport (+3 more), weather + runway changes (15:00 swap, easterlies, LVP), night, audio
- [~] M4 launch: voice commands (Web Speech + Whisper), daily challenge, leaderboard worker, settings + accessibility, onboarding coach. Deploy to squawk.x3.dev needs the owner's Cloudflare login.
- [~] M5 post-launch: London airports built; top-down multi-airport coverage selectable in Free shift; co-op (WebRTC) + PWA done.

## Open work

- Deploy (Pages + leaderboard Worker) needs the owner; see README.
- Game-style HUD done (floating glass panels, radio console); keep polishing from play-tests.
- AI Director throughput (~20 arrivals/h at Heathrow vs ~42 real); AI-only ground glitches use a pass-through backstop.
- Gatwick/Stansted/Luton/City: mixed-mode runway logic is basic.
