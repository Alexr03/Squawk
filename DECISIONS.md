# Decisions

Choices made where PLAN.md is silent, or where milestone 1 deliberately cuts a corner.

## Milestone 1 (Prototype: Tower only)

- **Placeholder art is a 2D canvas, not Three.js.** The roadmap says placeholder art for M1, so `packages/render` doesn't exist yet. It arrives with the pixel-art scene in M2.
- **No pipeline yet.** Runway thresholds are typed in from approximate AD 2.EGLL coordinates (`packages/sim`, `RUNWAYS`). Traffic is synthetic: real airlines, callsigns and types, generated from the seed. OpenSky days come with `tools/pipeline`.
- **Runway config:** westerly, 27R landing and 27L departing (one half of the alternation pattern). No 15:00 swap or easterlies yet.
- **The sim is 1-D per runway.** Each aircraft has a distance along its runway axis and a lateral offset. That covers final, rollout, vacate, the holding queue, line-up, take-off and climb-out without a taxiway graph.
- **Arrivals:** they appear at 5 nm, fly 160 kt to 4 nm, then slow to their approach speed on a 3° glidepath. The AI Director only releases one onto final once UK wake spacing behind the last arrival is met (minimum 3 nm). The 160-to-4 speed step compresses gaps, so the Tower sees them tighten as they would in reality.
- **No landing clearance by 0.5 nm means the pilot goes around.** This counts as a go-around plus a "no clearance" penalty. A controller-ordered go-around costs less. Go-arounds climb straight ahead to 3,000 ft, go to Director, and rejoin final 5 minutes later.
- **Runway occupancy:** an aircraft is on the runway from the moment it starts lining up until it is airborne, or until it has vacated after landing. Lining up behind a departure that is already rolling is allowed, as UK practice allows. A second line-up waits until the runway ahead is free. Any of these is a runway separation loss: starting a roll while another aircraft is rolling or landing, or crossing the threshold with the runway occupied.
- **Departure separation:** the gap is measured from the leader becoming airborne. It's the larger of a route gap (2 min on the same SID, 1 min on different SIDs, the classic Heathrow rule) and a wake gap (2 min for a Medium or Light behind a Heavy, 3 min behind an A380). RECAT-EU pairwise values, the intersection and speed-group adjustments are left for later. Departures wait on a holding queue, and any of them can be lined up in any order. That ordering (alternating SIDs and wake categories) is the departure puzzle.
- **Handoffs are automatic in M1:** to Ground once vacated, to London Control at 2,000 ft, to Director after a go-around. They show as dim "auto" lines in the log. M1's command set is the four in the roadmap.
- **London Control frequency is a placeholder (135.125)** until the pipeline brings in the AIP value.
- **Collision:** two aircraft on the ground within 40 m of each other end the shift.
- **Scoring weights and grade thresholds are first guesses.** They're in `debrief()` and are for tuning after play-testing.
- **Sim in a Web Worker** posts the whole state after each batch of ticks. The main thread blends between the last two snapshots for smooth motion.
- **Svelte components aren't type-checked yet** (`tsc` covers the `.ts` files). Add `svelte-check` when the UI grows.

## Phraseology (`packages/phraseology`)

- **Written numbers:** digits are plain words, except 9, which is written "niner" ("one one niner decimal seven three zero"). CAP 413's tree/fife/fower/ait are pronunciation guides, not spellings, but the voice parser accepts them. Digits are said one by one, except whole thousands and hundreds in levels ("four thousand feet", "flight level one hundred"). Frequencies drop the last two digits when both are zero ("one two zero decimal four"), as CAP 413 says.
- **Levels:** the transition altitude itself is still an altitude ("climb altitude six thousand feet"). Above it, levels are flight levels. QNH is only given with altitudes.
- **Clearance:** "cleared to Edinburgh via Brookmans Park seven Golf departure, squawk five two one four". At Heathrow the initial altitude is part of the SID, so it isn't said and doesn't survive a text round-trip.
- **Taxi:** a runway taxi limit always means that runway's holding point ("taxi to holding point runway two seven left via Alpha, Bravo two") and implies holding short of the runway. So `TX 27L` and `TX 27L HS` produce the same command.
- **Heathrow wording:** "push and start approved, face east"; "follow the greens to stand five one two"; "route direct Biggin"; "hold at Biggin as published"; "cleared ILS approach runway two seven right".
- **Light signals (7600):** steady green for landing and take-off, steady red for go-around, hold, hold short and give way, flashing green for ground movement. Pilots rock their wings when airborne and move the ailerons on the ground.
- **`ParseCtx.runways`** lists the runways the addressed aircraft can use. "27" only resolves when exactly one runway in that list matches.

## Render (packages/render)

- **The WebGL canvas itself is the low-res target.** `renderer.setPixelRatio(1 / pixelSize)` and CSS `image-rendering: pixelated` do the nearest-neighbour upscale; the composer (render, grade, bloom, output, SMAA) runs at that resolution, so post-processing is cheap. Pixel size 1 is a full-resolution, fully smooth image.
- **"Smooth edges" (Settings → Display, on by default, applies live)** adds SMAA after the output pass (FXAA was tried first: at 3× it smeared 1–2 pixel details such as parked aircraft and stand markings), PCF shadows, round lights with a soft falloff and a longer, gentler bloom tail. The upscale stays nearest-neighbour either way: at 2–4× smoothing cleans up edges inside the pixel grid instead of blurring the whole frame (a bilinear upscale at 3× just looked out of focus). Off is the original crisp look. Measured with GPU-synced renders on the render test bed: 1.3–2.3 ms a frame at 3× and 1×, with no measurable cost from smoothing.
- **Pixel-art edges come from the depth buffer** in the grade pass: a dark outline outside objects and a faint rim inside. No normal pass.
- **Ground layers don't write depth.** They draw first in a fixed order, so coplanar aprons, taxiways and runways never z-fight.
- **Shadows are PCF with smoothing on, `BasicShadowMap` with it off.** An old note said PCF "left the whole scene shadowed"; with r186's hardware-compare PCF and the current bias/normal-bias it renders correctly at noon, golden hour, dawn, across the shadow cut-off zoom and when switching types live (three recompiles materials and rebuilds the map on a type change). The original failure couldn't be reproduced. The shadow camera follows the visible area and snaps to its texel grid.
- **The lighting is stylised, not photometric.** The sun gets stronger at low elevation so that golden hour reads, and night keeps a moonlit blue ambient so the ground stays legible.
- **The radar is a 2D canvas overlay at full device resolution**, drawn every frame. Underlay geometry is cached as `Path2D` in world metres and drawn through the ortho camera's affine transform. The scope hides ground traffic beyond 15 m/px.
- **Crossfade:** tilt eases to zero by about 3.5 m/px. Buildings flatten between 2.5 and 5 m/px. The 3D image desaturates while the navy scope fades in between 3 and 8 m/px. Above 8 m/px the WebGL pass is skipped entirely.
- **Fonts:** VT323 for data tags and Silkscreen for small labels (both OFL), bundled under `packages/render/assets`.
- **Only the primary pack is built in 3D.** Other packs appear on the scope as runway symbols, placed by their ARP.

## Co-op (apps/web/src/net)

- **Star topology over WebRTC.** The host's browser runs the only sim (a normal `GameClient`). Each guest has one reliable, ordered data channel to the host. STUN is Google's public server, and there is no TURN, so two players behind symmetric NATs can't connect. TURN costs money to run, so it waits until someone hits this.
- **Signalling has two modes.** *Manual* needs no server: the host makes an invite code per guest (the SDP offer with every ICE candidate, deflate-raw and base64url, about 600 characters), and the guest pastes it and sends back an answer code. *Room codes* need `VITE_LEADERBOARD_URL`: the host keeps one invite posted in a 6-letter KV room, a guest takes it by writing an answer under the invite's id (a second taker gets 409 and waits for the next invite), and both sides poll every 1.5 s. Manual mode is always offered as a fallback.
- **Wire format:** JSON, deflate-raw, split into 60 kB frames with a one-byte "last frame" flag. The host packs each broadcast once for all guests. A guest more than 1 MB behind skips snapshots, since the next one replaces it.
- **Measured sizes** at 08:00 on the summer peak day: a snapshot is about 21 to 27 kB of JSON and 3.6 to 4.6 kB deflated. The full state is about 22 kB of JSON and 3.9 kB deflated early in a shift, and it grows with the schedule and command log. At 4 per second, that's under 20 kB/s per guest.
- **What goes over the wire:** the worker's trimmed snapshot about 4 times a second (sampled every 250 ms, whatever the sim speed), a full `State` every 10 s for takeover, a ping when idle, the final state, and per-guest command results. Guests send `hello`, `claim` and `cmd`.
- **Authority:** the host runs a guest's command only if the aircraft's current frequency (`ac.freq`) is one of *that guest's* seats. The same check applies to the host's own commands, because the sim's coverage is everyone's seats. Malformed commands are refused before they reach the worker.
- **Seats:** the sim models one seat per role per airport, so the lobby offers the five roles (Delivery, Ground, Tower, Director, London Control). PLAN's Heathrow splits (Ground ×3, Tower N/S, Director N/S/Final) need the sim to split those roles first. With 5 or more players, each gets one role, and players beyond the fifth can only watch (with "monitor" on).
- **Default split** follows PLAN: 2 players get DEL+GND · TWR+DIR, 3 get DEL+GND · TWR · DIR, 4 get DEL+GND · TWR · DIR · LON, and 1 gets Tower. Shift coverage is the union of claimed seats, and AI works the rest.
- **Mid-shift split/merge:** the host moves seats between players from the pause menu. The sim's coverage is fixed at the start, so a seat can't go back to AI mid-shift. When a guest leaves, their seats bandbox back to the host. Each move shows both players a handover toast listing the aircraft on that frequency.
- **The clock is the host's.** Guests can't pause or change speed, and replay is host/solo only.
- **Host drop:** guests treat a closed channel, or 5 s with no message (the host pings every 2 s), as host loss and show "Host lost — shift paused". One guest can take over. Their browser starts a sim from the last full state (`worker.ts` `resume`), so up to 10 s of play is lost. The new host gets a fresh lobby to re-invite players and re-assign seats, and in room mode it reuses the same room code. Guests can only resume if they received at least one full state, and the host sends one as soon as the first guest is in the shift.
- **Monitor** is a per-player toggle in the lobby and in the pause menu. It shows every covered frequency in the radio log. Instructions still go only to your own frequencies.

## Leaderboard / rooms worker (apps/leaderboard)

- **No package.json.** It's one TypeScript file deployed with `npx wrangler`. It defines the small KV interface it uses, so there's no workers-types dependency. Root `tsc` and Vitest cover it.
- **The rate limit is 30 s per IP**, but KV's minimum TTL is 60 s, so the key stores the time of the last score and the handler checks the 30 s itself. The server sets `at`.
- **Polling-friendly reads:** a missing offer or answer in an existing room returns `200 null`, not 404, so the browser console stays quiet while polling. An unknown room is a 404.
- **KV is eventually consistent.** That's fine for a leaderboard. Room signalling can lag for players in different regions, and copy-paste codes always work. A Durable Object is the upgrade path if it matters.

## PWA

- **No plugin.** A small Vite plugin (`vite.config.ts`) emits `sw.js` from `apps/web/sw.js` with the build's file list. The worker is registered from `main.ts` in production builds only.
- **Precached:** `./`, the manifest, the icons, and every JS, CSS and woff2 file in the build. **Not precached:** the data packs, which are cached on first use, cache-first, since their names are hashed. Also left out are the audio/render test pages and the transformers chunk and its ONNX/wasm files. The service worker never touches those, and transformers.js caches its models itself. Navigations are network-first, so a new release shows up on the next load and the cached shell is the offline fallback.
- **One version-free `squawk-assets` cache** keeps the data packs across releases, and it is never pruned (a few MB per release). Shell caches are versioned and the old ones are deleted on activate.
- **Icons** are a 32×32 pixel-art radar scope, drawn by `tools/icons.mjs` using only Node built-ins (zlib deflate and crc32). The maskable icon keeps the art inside the safe zone. They're committed under `apps/web/public/icons`.
- **Scenery is stored in its own file, `data/airports/<ICAO>/scenery.json`.** It comes from `tools/pipeline/scenery.ts`, which `airport.ts` runs after writing the pack. It holds OSM landuse, roads, rail and buildings in a box around the airfield, sized by the airfield's extent (about ±7 × ±4 km at Heathrow). Coordinates are rounded to 1 m and delta-encoded, so every pack stays under 2.5 MB. The format is decoded by `decodeScenery` from `@squawk/render`. `lib/data.ts` attaches the result as the optional `AirportPack.scenery`, and the game client strips it before posting packs to the sim worker. `airport.json` is unchanged.
- **Airside pavement uses heuristics, because OSM maps Heathrow's aprons as strips by the piers.** Every stand gets a paved box sized by wake, apron lanes are 64 m wide, and taxiways get 10 m concrete shoulders and filleted junctions. Together these give the continuous concrete seen in aerial photos.
- **Scenery rendering:**
  - Landuse is one mesh, largest polygons first, with per-kind patterns in the shader.
  - Roads are one mesh with lane markings.
  - Traffic is GPU-animated points: cars by day, white and red light streams at night.
  - Street lights are additive points.
  - Buildings are merged per 1 km tile and share the terminal material, so they get lit windows. Houses and sheds drop out above 4 m/px.

## Game-style HUD (user feedback: "looks like an admin dashboard")
The world fills the screen; everything else floats over it as rounded translucent glass (`--glass`, `--lift` tokens in App.svelte), in the spirit of Cities: Skylines / Planet Coaster. The bottom-centre radio console (one button per position, showing its frequency, with a badge counting waiting calls) is the signature control and replaces the frequency tabs. The flight strips are a collapsible drawer, alerts and the selected aircraft float on the right, and the radio feed plus command bar sit bottom-left (toggle the log to expand it). The menu screens share a sky gradient (`--screen-bg`) and rounded controls.

## Made-up days
Free shift and co-op offer a "Made-up day" per airport alongside the real recorded days. It borrows the airline/type/destination mix and daily rhythm of the busiest real day there, invents callsigns in each operator's style, jitters times by about ±40 min and varies the volume ±12%. Same seed, same day; "Again" picks a new seed, so it is fresh every shift (apps/web/src/lib/madeup.ts).

## Fast day and night
On by default (Settings > Gameplay, or the pause menu): the clock, sun and sky run 30x (an hour every two minutes of play) so a session sees dusk and dawn. Only presentation changes: traffic, weather, separation and timers stay on the real sim clock. The radio log uses the same fast clock so times match the top bar.

## Separation alerts (packages/sim/src/rules.ts, predict.ts)
- **Prediction follows the real path.** `project()` flies each aircraft's current instructions forward (turn rates and the instructed turn direction, routes, the holding racetrack, ILS capture and the glidepath, climb/descent to the cleared level) in 10 s steps. STCA warns (amber) only if that path comes inside the minimum within 2 minutes; the scope's projection line for the selected aircraft is the same function, so what you see is what STCA predicts.
- **Red means closing.** Inside the minimum (3 nm in the TMA, 5 nm outside, under 900 ft vertically) is a red loss, counted once, only while the pair is converging. Moving apart, or both in the same hold, is an amber caution at most and never a new penalty; a loss already counted stays counted until the pair is clear.
- **The final approach is always watched,** even low and close in where the rest of the Tower's domain is left to the tower (below 2,600 ft within 7 nm). Two arrivals on the same final (established, or lined up within 0.5 nm of the centreline inside 15 nm): inside wake spacing (or predicted to be) is an amber caution on the follower; under 1 nm and 500 ft is red. Final-approach cautions draw no line on the scope (the follower's tag turns amber), so the airport view stays clean.
- **Stack levels:** an aircraft is never given a stack level someone in that hold is still at or cleared to, even when it is still far out; it takes the next one up.
- **AI vectoring:** an arrival levelled off for traffic is cleared on down once nothing is in conflict with it, and the AI Director releases whoever best fills the slot behind the last release (not someone at the far end of a holding pattern, and not one too high to get down on the track).

## Holding (packages/sim/src/physics.ts, geo.ts)
- Rate-one turns, limited to 25° of bank (about 2°/s at holding speeds), in holds only; vectoring keeps the 3°/s (2.5°/s heavies) the AI approach is tuned for.
- Proper entries by sector: direct, parallel (outbound on the non-holding side, turn back the other way), teardrop (30° into the holding side until a turn will roll out on the inbound leg).
- Inbound leg 1 minute (1½ above FL140) in still air. Turn radius is sized for the wind at that level (TAS + wind over the turn rate), so the turn stays flyable with the wind behind it; both legs and both turns are tracked with wind correction, settling within about 0.15 nm.
- The scope draws each stack at the size flown at its bottom level in the current wind; a selected aircraft's projection uses its exact pattern.

## Incidents
- Fire vehicles drive the taxi graph: A* from the taxiway nearest the station to the one nearest the incident (crossing runways where they must, along the incident's own runway if quicker), off the graph only for the station's own access and the last metres onto the scene, and back the same way. They leave four seconds apart.

## Audio (apps/web/src/audio)
- **The score is tense, not calm.** `music.ts` is generative: a drone and sonar pings when quiet, then a pulsing bass, kick, hats and a plucked arpeggio from about 4 aircraft, then backbeat, tremolo strings and risers when flat out. `setIntensity` takes the workload; the drive is smoothed (rises in seconds, falls over about half a minute) with a floor of 0.2, so even a quiet frequency has an edge.
- **It does not loop.** Every 8-16 bars a new section picks a key (usually a 4th/5th away, sometimes a semitone), a mode (darker when quiet, phrygian/harmonic/locrian when busy), a chord loop, tempo, bass, kick and arpeggio patterns; about a quarter of sections open with a 2-4 bar breather where the drums drop out. `alert('conflict' | 'emergency' | 'crash')` lifts the score and plays a stinger; an emergency adds a heartbeat for 75 s.
- **Aircraft are heard.** `engine.ts` gives each aircraft near the camera its own voice (at most 7, the loudest): jet whine, roar and rumble tied to thrust, turboprop blade drone, tug diesel, tyre rumble that thumps with taxiway joints, reverse thrust, a touchdown squeal. Thrust comes from the phase (`demand()`), loudness from distance to the camera centre scaled by zoom, with air absorption (low-pass), stereo pan and Doppler. Weather adds wind (gusting, whistling above 14 kt), rain, thunder in storms and the odd gull. The "Aircraft and weather" volume covers all of it; paused ducks everything.
- **Checking audio without speakers:** both modules accept an `OfflineAudioContext` (`Music.attach`, `AirfieldAudio.unlock(ctx)`), so a headless browser can render them to samples and measure level and spectrum.
