# Squawk — Game Design Plan

Oct 8, 2026 · @Alex Redding

## Pitch & pillars

**Squawk is a browser-based air traffic control game.** You work an airport's frequencies from clearance delivery to radar approach, either one position at a time or all of them at once, in a top-down low-poly pixel style, starting with a real-data Heathrow. It plays as an approachable sim: real phraseology and procedures, with the rules simplified so anyone can learn them in a shift.

Four design pillars:

1. **Real radio, readable rules.** Every instruction goes out as a real transmission with a pilot readback. Separation rules are real in spirit but simplified in the numbers.
2. **Every position is its own game.** Ground is a traffic puzzle on taxiways. Tower is runway timing. Approach is vectoring and sequencing. You change games by changing frequency.
3. **Calm, then chaos.** A shift starts relaxed and builds up. Weather, go-arounds and emergencies cause the spikes.
4. **Built for co-op.** Single-player ships first, but each position is a seat that a friend can take later.

**Target players:** fans of *Mini Airways* who want more depth, flight-sim players who are curious about the other side of the radio, and aviation enthusiasts who listen to LiveATC.

## Core loop & positions

**A game is a shift: 20 to 40 minutes of scheduled traffic at one airport, scored at the end.** During a shift you pick which positions you staff. AI controllers run every position you leave empty, and they hand traffic to you and take it back the way a real neighbouring controller would.

The loop inside a shift:

1. Traffic appears, either as a departure at a stand or an arrival entering your airspace.
2. You select an aircraft and issue instructions. The pilot reads them back, and you check the readback.
3. You keep aircraft separated and moving, and avoid delays.
4. You hand each aircraft off to the next position. A late or early handoff costs points.
5. At the end of the shift you get a debrief covering safety, efficiency and radio discipline, then unlocks.

| Position (RT callsign) | Airspace | Main instructions | Core challenge | Hands off to |
| --- | --- | --- | --- | --- |
| **Delivery** ("Heathrow Delivery") | Stands, before pushback | Departure clearance: SID, initial altitude, **squawk code** | Ordering departures so the runway is neither starved nor flooded | Ground |
| **Ground** ("Heathrow Ground", 3 frequencies) | Aprons and taxiways | Pushback, taxi to holding point, give way, cross runway, follow the greens | Gridlock, head-on taxiway conflicts, runway crossings | Tower (departures), stand (arrivals) |
| **Tower** ("Heathrow Tower", North / South) | Runways and the control zone | Line up and wait, cleared for take-off / to land, go around | Runway occupancy, wake spacing, the 15:00 runway swap | London Control (departures), Ground (arrivals) |
| **Director** ("Heathrow Director", Intermediate North / South, Final) | From the four stacks down to the final approach | Leave the hold, heading, altitude, speed, cleared ILS approach | Sequencing arrivals from four stacks onto one final with tight spacing | Tower (arrivals only) |
| **London Control** ("London Control") | The London terminal area around the airport | Levels, direct routings, speed control, feeding the stacks, climbing departures out | Steady flow into the stacks while departures climb out through it | Director (arrivals), off-map (departures) |

At Heathrow, Director handles arrivals only. Departures go straight from Tower to London Control.

&#91;embedded content: handoff chain · 5 positions\]

Each dot is a handoff, where the aircraft changes frequency and changes owner.

Delivery assigning the squawk code is the moment the game's name comes from. That code then follows the aircraft on every scope and data tag until it leaves your airspace.

**Solo, one position:** you play one seat, such as Tower only, and AI covers the rest. This suits learning and short sessions.

**Combined:** you staff several positions. The camera zooms from the apron out to the radar scope, and the frequency tabs switch which instructions you can give. This is the high-skill mode, and it mirrors a real controller working "bandboxed" positions on a quiet night.

### Top-down coverage (solo)

**A solo player can work top-down, like VATSIM controllers do: from London Control down to Ground at several airports at once. Workload is always the player's choice.** You pick your coverage before a shift and can change it during the shift. The game never adds seats to your coverage without asking.

| Preset | You cover | Feels like |
| --- | --- | --- |
| Single seat | e.g. Heathrow Tower | Focused, a good way to learn |
| Heathrow combined | Delivery, Ground, Tower, Director at Heathrow | A full airport, one place |
| London top-down | London Control plus everything below it at Heathrow, Gatwick, Stansted, Luton and City | The Twitch-style "everything" shift |
| Custom | Any mix of seats and airports | Whatever you want |

**How top-down stays manageable:**

- **Traffic is a separate dial from coverage.** London top-down can run at 25%, 50% or 100% of the real day's flights, sampled from the real schedule. Covering everything doesn't force a full peak hour on you.
- **No handoffs to yourself.** When you own consecutive positions, aircraft stay with you and skip the frequency change, as they do on a real top-down frequency. Handoffs only happen at the edge of your coverage.
- **One "needs you" queue.** Calls from every frequency land in one list, sorted by urgency: emergencies, then aircraft about to bust a clearance, then routine requests. Pilots wait patiently instead of everything failing at once, and a key jumps to the next item.
- **Open or close seats at any time.** If Gatwick gets busy, hand it to AI with one click ("open" the position, as a real controller would) and take it back when it calms down. The game may *suggest* opening a seat when your queue stays long, but it never does it for you.
- **Optional assists per seat:** auto-pushback approval, suggested taxi routes, auto-sequencing on final. Turn them on for the airports you care least about.
- **Optional pause and auto-slow:** solo shifts can pause, or slow time automatically when the queue passes a threshold.
- **Workspaces:** each airport has its own tab with an alert badge. Small picture-in-picture insets show the runways you own while you sit on the London scope.
- **A workload meter** in the top bar shows how close you are to overload, so it's a choice and never a surprise.

London top-down needs the other London airports built through the same real-data pipeline, so it arrives after launch. Heathrow combined is available from the vertical slice.

## Controls & comms

**There are three ways to give an instruction, and all of them produce the same radio call:** a click with a radial menu, a direct drag, and typed shortcuts. New players never need to type. Experienced players can run a whole shift from the keyboard.

### Selecting

- Click a blip, an aircraft sprite or its flight strip to select it. Tab cycles through aircraft on your frequency, and arrow keys move through the strip bay.
- Hover shows a preview: the planned route, the taxi path, and a 1/2/3-minute leader line on radar.

### Radial menu (mouse/touch)

Right-click, or long-press on touch, to open a ring of the instructions that make sense **for that aircraft, at that position, right now**. For example, Ground sees *Push / Taxi / Hold short / Cross / Contact Tower*, while Director sees *Heading / Altitude / Speed / Direct / ILS / Hold / Contact Tower*. Sub-rings pick values, such as an altitude dial or a list of runways. The menu stays short because it filters by context.

### Direct manipulation

- **Radar:** drag out from a blip to set a heading. A ghost line shows the new track, and releasing the mouse sends the vector.
- **Ground:** click taxiway segments to build a route. A pathfinder suggests the shortest legal route, and you drag it to edit. Red marks show hold-short points.
- **Strips:** drag a strip into another bay to hand the aircraft off.

### Typed shortcuts (keyboard)

A command line under the radio log accepts compact syntax and autocompletes callsigns and fixes.

```
BAW12 H270 A40 S210        heading 270, descend 4,000 ft, speed 210 kt
EZY45 TX 27 VIA A B2 HS    taxi to holding point runway 27 via A, B2, hold short
RYR8 LUW                   line up and wait
RYR8 CTO                   cleared for take-off
BAW12 ILS27                cleared ILS approach runway 27
BAW12 CT TWR               contact Tower
```

The radial menu builds the same command objects, so there's one parser and one source of truth.

### The radio

- Every command is printed as proper phraseology in the radio log, followed by the pilot's readback: *"Speedbird one two, turn left heading two seven zero, descend altitude four thousand feet."*
- Optional radio audio uses the browser's built-in speech with a radio filter, squelch clicks and a stepped-on transmission now and then.
- **Readback errors** are a mechanic. A few percent of readbacks are wrong, such as the wrong altitude or another aircraft's callsign. You catch them with **Say again** or **Negative, I say again…**. If you miss one, the aircraft follows the wrong instruction.
- **Pilot requests** arrive as calls you must answer: requests for direct routing, a higher level, a different runway, or a ride report.

### Phraseology: UK (decided)

All radio text, readbacks and voice parsing follow UK phraseology from the CAA's CAP 413 radiotelephony manual. That means *"taxi to holding point A1, runway 27R"*, *"descend altitude 4,000 feet, QNH 1013"*, *"contact Heathrow Director 119.730"*, and full callsign use until the pilot is allowed to abbreviate it. There's no FAA toggle, which keeps the parser and the content to one standard.

### Voice commands

**You can work the frequency with your own voice.** Hold push-to-talk (Space or a mouse button), say the instruction as a real controller would, and the pilot reads it back.

1. **Speech-to-text runs in the browser.** A small Whisper model runs locally via WebGPU, so audio never leaves the machine and there's no server cost. Browsers without WebGPU fall back to the built-in Web Speech API.
2. **A constrained grammar** turns the transcript into the same command objects as clicks and typing. Callsigns are fuzzy-matched against the aircraft on your frequency ("Speedbird one two" → BAW12), and spoken numbers, flight levels, headings and frequencies are normalised.
3. **Confidence handling:** a high-confidence command is sent at once. A low-confidence one shows its transcript for a one-tap confirm. Anything the parser doesn't understand gets *"Station calling, say again"*, as it would in reality.
4. **Bad phraseology isn't rejected.** It costs radio-discipline points in the debrief, so voice play teaches proper RT over time.

Pilots answer with synthesised voices through the radio filter, so a voice-only shift sounds like a real frequency.

### Time & camera

- Pause in any solo shift (not in co-op or the daily challenge), 1×, 2× and 4× speed.
- Mouse-wheel zoom moves smoothly from the stand all the way out to the TMA. Number keys 1–5 jump to the Delivery / Ground / Tower / Director / London Control frequency.

## Rules & scoring

**Safety ends a shift, and efficiency ranks it.** Losing separation costs heavy points. A collision or runway incursion that causes contact ends the shift with an incident report. Delays and wasted fuel decide how well you score on a clean shift.

### Separation (simplified)

| Where | Rule | Warning |
| --- | --- | --- |
| Taxiways | No two aircraft on the same segment head-on; give-way at junctions | Taxi conflict highlight |
| Runway | One aircraft on the runway at a time (landing, departing or crossing) | Runway incursion alarm |
| Departures | Wake gap by category: Light / Medium / Heavy / Super, 1 to 3 minutes | Wake timer on the tower strip |
| Director | 3 nm or 1,000 ft, more behind a heavier aircraft | Short-term conflict alert (STCA): data tags flash amber, then red |
| London Control | 5 nm or 1,000 ft | STCA |

Assists can draw predicted conflict lines. Higher difficulties turn the assists off.

### Events that shape a shift

- **Go-arounds** happen from an occupied runway, a missed approach or an unstable approach. The aircraft rejoins the sequence.
- **Weather:** wind shifts force a runway change mid-shift. Thunderstorm cells have to be vectored around. Low visibility brings bigger gaps and slower taxiing.
- **Emergencies**, signalled by squawk codes:
  - **7700**, general emergency: priority landing, fire services on standby, and the runway closes after landing.
  - **7600**, radio failure: the aircraft flies its last clearance, and Tower uses light signals.
  - Other events: medical diversions, low fuel (*Mayday fuel*), bird strikes on departure, and a burst tyre that closes the runway.
- **Night** brings runway lighting, harder visual spotting on the ground view, and lighter traffic.

### Scoring

| Category | Measures | Weight |
| --- | --- | --- |
| Safety | Separation losses, incursions, missed readback errors | Penalty multiplier on the total |
| Efficiency | Delay minutes vs schedule, extra track miles, holding time, fuel burned | Main score |
| Throughput | Movements per hour vs the airport's capacity | Bonus |
| Radio discipline | Handoff timing, unanswered requests, frequency congestion | Bonus |

The debrief gives a letter grade (S to D) and a timeline of the shift's worst moments that you can replay.

## Look & feel

**The game has two visual layers that zoom into each other.** Up close is a low-poly 3D airport with a pixel-art finish and real lighting. Zoomed out is a crisp vector radar scope. The zoom from a stand at Heathrow to the 40 nm scope in one smooth scroll is the game's signature moment, with lighting, shadows and the day/night cycle providing the atmosphere.

### Ground and Tower view (zoomed in)

- **A "3D pixel art" style.** Low-poly 3D models are seen through a fixed top-down orthographic camera, rendered at low resolution and scaled up with crisp, unsmoothed pixels. It reads as pixel art, but it gets real lighting and shadows for free.
- **Real geometry.** Terminals, piers and hangars are extruded from real building footprints. Aircraft are low-poly models per type family, to scale. Aircraft wear real airline liveries, simplified into low-poly colour blocks and tail art, and fly under real callsigns such as Speedbird, Shamrock and Virgin.
- **Living details:** pushback tugs, follow-me cars, jet bridges that swing out, and fire trucks rolling to the runway on a 7700.

### Lighting & day/night

- **Real sun.** The sun position is calculated from Heathrow's latitude and longitude and the in-game date and time. Shadows sweep across the apron through the shift, with golden hour, blue hour and full night.
- **Real-time shadows** from buildings and aircraft. An arriving aircraft's shadow slides closer to it as it descends onto the runway.
- **Airfield ground lighting:** white runway edge lights, green threshold, red runway end, approach light bars, green taxiway centrelines, blue edge lights, red stop bars and stand guidance. They are rendered as thousands of glowing points with bloom, and **Follow the Greens** paths light up segment by segment.
- **Aircraft lights follow real practice:** beacon on before pushback, nav lights, a taxi light that throws a cone on the tarmac while moving, and landing lights plus strobes when entering the runway, off again after vacating.
- **Night apron:** floodlit stands, lit terminal windows and vehicle headlights.
- **Weather:** rain gives the concrete a wet sheen that reflects the lights, and fog in low-visibility procedures shrinks what you can see in the ground view, so you lean on the greens and stop bars.
- The radar view keeps its own palette and isn't affected by the time of day.

### Director and London Control view (zoomed out)

**Zoomed out, it becomes a real controller's radar display, styled to match the game.** There's no 3D aircraft at this scale. Approach and London Control work from blips and data tags, as they do in reality. The world doesn't vanish, though: it fades into a dim map underneath the scope.

| Zoom tier | Range | What you see |
| --- | --- | --- |
| Airport | Stand to about 3 nm | Full low-poly 3D, lighting, shadows, aircraft models |
| Terminal (Heathrow Director) | About 3–40 nm | The 3D world flattens into a dark map underlay. The scope is drawn on top: final approach centrelines, the BNN/LAM/BIG/OCK stacks, range rings, and blips with history trails |
| Area (London Control) | 40–150+ nm | Pure radar: sector boundaries, airways, stacks and every London airport (Heathrow, Gatwick, Stansted, Luton, City) as small runway symbols. The underlay is just coastline, the Thames and the M25 |

- **The transition** is a crossfade during the zoom. Buildings flatten into footprints, then into map shapes. Each aircraft model shrinks into its blip, and its data tag fades in.
- **Blips and tags:** a square position symbol, a trail of fading history dots, a leader line, and a data block with callsign, flight level, ground speed and cleared level. The tags use a crisp pixel font, so the radar layer still feels like the same game.
- **Day/night still shows:** at night the map underlay glows faintly with city lights, and the scope dims to its night palette.
- **Overlays you can toggle:** weather radar (rain and thunderstorm cells), restricted areas, SID/STAR routes, and the Follow the Greens state of Heathrow's apron as a mini inset.
- **Split screen in Combined mode:** a picture-in-picture of the airport view in one corner of the scope, so you can keep an eye on the runway while vectoring.

### Palette

| Use | Colour |
| --- | --- |
| Scope background | Deep navy |
| Your traffic | Phosphor green / teal |
| Other sectors' traffic | Muted grey-blue |
| Selected | White |
| Caution | Amber |
| Conflict / emergency | Red |
| Airport by day | Warm concrete grey, soft greens |

### Screen layout

The scope stays in the centre and fills most of the screen. The surrounding panels can be collapsed.

- **Top bar:** frequency tabs (DEL 121.980 / GND 121.905 / TWR 118.505 / DIR 119.730 / London Control), clock, ATIS letter, wind and runway in use.
- **Left:** flight strip bay, grouped into Pending / Active / Handed off.
- **Bottom:** radio log with the command line underneath.
- **Right (on selection):** aircraft card showing type, route, cleared level, squawk and fuel state.

&#91;embedded content: screen layout wireframe\]

### Audio

The ambient sound is a quiet tower-cab hum with radio static under the chatter. Optional synthesised pilot voices use a range of accents and speeds. Each event type has its own short chime, such as a new strip, a conflict alert or a pilot request.

## Launch airport: London Heathrow (EGLL)

**Squawk launches with Heathrow, built from real published data, and every later airport goes through the same pipeline.** Heathrow also suits the game's design. Its two parallel runways run in segregated mode, with one for landings and one for take-offs, which makes a clear first Tower shift. Four holding stacks feed Approach, and the airport has a dense four-terminal apron and real Follow the Greens lighting.

### Real facts the sim uses

| Item | Real-world value | How the game uses it |
| --- | --- | --- |
| Runways | 09L/27R 3,902 m; 09R/27L 3,660 m; both 50 m wide, asphalt | Runway geometry, take-off and landing distances |
| Elevation | 25 m (about 83 ft) | Altimetry and the base for approach altitudes |
| Operating mode | Segregated: one landing runway, one departure runway; occasional landings on the departure runway to cut delays | The core Tower loop |
| Runway alternation | Westerlies: 27L and 27R swap roles at 15:00 local each day. Easterlies: 09L lands and 09R departs | A scheduled runway swap mid-shift and a wind-driven direction change |
| Positions (RT callsigns) | Heathrow Delivery 121.980; Heathrow Ground 121.905 / 121.705 / 121.855; Heathrow Tower 118.505 (South) / 118.705 (North); Heathrow Director 119.730 (North), 134.980 (South), 120.400 (Final) | Frequency tabs and the callsigns in the radio log |
| Holding stacks | BNN and LAM (north), BIG and OCK (south) | Where arrivals enter Approach; hold-or-release decisions |
| Arrival spacing | 3 nm minimum, 2.5 nm on final under set conditions; time-based separation since 2015, pairwise separation since 2025 | Approach sequencing, with a TBS-style spacing marker as an assist |
| Departure spacing | Wake gap by airborne time (RECAT-EU, roughly 1 min 40 s to 3 min); +1 min from an intersection; +1 min per speed-group step | Tower wake timer and departure ordering |
| Night | Night quota period 23:30–06:00; no scheduled arrivals before 04:30 | A quiet night shift, then the dawn arrival wave |
| Traffic | 473,965 movements and 83.9 million passengers in 2024 | Calibrates "realistic" traffic density |

The London transition altitude is 6,000 ft, so the game uses altitudes below it and flight levels above it. Frequencies and procedures change with each AIRAC cycle. Each airport pack records the cycle it was checked against, and the UK AIP is the final authority before release.

### Follow the Greens

At Heathrow, Follow the Greens is used when the airfield ground lighting is on, at night or in poor visibility. The tower controls the lights, and green centreline lights guide the aircraft to its stand. In Squawk:

- Instead of reading out a taxi route, Ground can say **"Speedbird 12, follow the greens"**. The route you built lights up as green centreline segments ahead of the aircraft and switches off behind it.
- **Red stop bars** at runway holding points stay lit until you clear the aircraft to line up or cross, which drops the bar. A pilot will not cross a lit stop bar.
- In low-visibility procedures, Follow the Greens becomes the main way to move traffic. Watching the green paths thread through the apron at night is meant to be one of the game's best-looking moments.

### Data pipeline (real data only)

1. **Geometry from OpenStreetMap:** runways, taxiway centrelines, stands, aprons and terminal footprints, imported from aeroway tags (ODbL, with attribution in game). Terminal footprints and heights become the low-poly buildings.
2. **Correction against the UK AIP (AD 2.EGLL)**, published by NATS AIS: holding point names (A1–A13, N3, S1 and so on), stand numbers, frequencies, SIDs/STARs, stacks and missed approaches. Fixes are typed in by hand.
3. **Validation:** an automatic check that every stand reaches every runway through the taxiway graph, and that every SID/STAR fix exists, plus a visual overlay against the AIP ground movement chart.
4. **Output:** a versioned airport pack in JSON, tagged with its sources and AIRAC cycle.

### Real traffic

**Shifts replay real Heathrow days.** A build-time script pulls one real day of movements and turns it into a schedule pack. A shift labelled *Fri 19 Sep, 06:00–08:00* contains the flights that actually operated in that window.

1. **Movements:** the OpenSky Network REST API (`/flights/arrival` and `/flights/departure` for EGLL). Each request covers at most 2 days, data lands the next day after a nightly batch, and access uses a free account with OAuth2 client credentials. Each flight comes back with its callsign, transponder (ICAO24) address, estimated origin or destination, and first- and last-seen times.
2. **Type and operator:** the ICAO24 address is joined against OpenSky's aircraft database to get the type code (A320, B77W and so on) and operator. That sets the livery, wake category and performance profile.
3. **Terminal and stand:** a hand-kept table maps airline to Heathrow terminal (for example, BA uses T5). The aircraft then gets a real stand at that terminal.
4. **Routing:** departures get the SID that matches their destination's direction. Arrivals get the stack (BNN/LAM/BIG/OCK) that matches their origin's direction.
5. **Weather:** the real METARs for that day, from a historical archive, set the wind, visibility and runway direction. Easterly days become easterly shifts, and fog days bring low-visibility procedures.
6. **Bake:** each day becomes a static JSON pack served with the game. The game never calls OpenSky while you play, so there are no API keys in the browser and no rate limits for players.

The starter library is a summer Friday peak, a quiet winter night, an easterly day and a fog day. Free shift jitters times by a few minutes so replays differ. The Daily challenge uses the exact day.

[OpenSky REST API docs](https://openskynetwork.github.io/opensky-api/rest.html)

Sources: [UK AIP via NATS / CAA data portal](https://caa.co.uk/Commercial-industry/Airspace/Communication-navigation-and-surveillance/The-aeronautical-data-management-portal) · [Heathrow Airport – Wikipedia](https://en.wikipedia.org/wiki/Heathrow_Airport) · [EGLL aerodrome data – Learn ATC](https://www.learn-atc.com/tools/aerodrome/egll) · [EGLL local procedures – IVAO UK](https://wiki.ivao.aero/en/home/divisions/xu/atc/aerodrome/local-procedure/london/egll) · [Follow the Greens – NATS blog](https://nats.aero/blog/?p=3871) · [Pairwise separation at Heathrow – NATS](https://www.nats.aero/news/elevate/may-26/a-real-game-changer-how-heathrow-transformed-performance-with-pairwise-separation/)

## Progression & modes

**Career is the spine: you start as a trainee on Delivery at Heathrow during the quiet night period and earn ratings that unlock positions and busier airports.** Every other mode reuses the same shifts with different rules.

### Career ratings

1. **Trainee:** Delivery and Ground on a night shift, with a handful of movements and Follow the Greens. A tutorial teaches through the radio.
2. **Tower rated:** Tower on segregated runways, then combined Ground/Tower and the 15:00 runway swap.
3. **Director rated: stacks, radar vectoring, ILS sequencing** and weather.
4. **London Control rated: feeding the stacks and climbing departures; multi-airport sectors once more London airports are built**.
5. **Supervisor:** combined everything at Heathrow's peak hour, with runway configuration changes and emergencies stacked together.

Each rating is earned by passing a checkride shift with a minimum grade and no safety losses.

### Airports

- **Real airports only.** Launch with **Heathrow**, built through the real-data pipeline described above.
- Later airports go through the same pipeline. Good next picks are other UK airports with different challenges: Gatwick (a single-runway hub), Manchester (parallel runways), and London City (steep approach, tight apron).

### Modes

| Mode | What it is |
| --- | --- |
| Career | Rated progression with checkrides |
| Free shift | Pick airport, positions, traffic level, weather, time of day |
| Daily challenge | One seeded shift per day, the same for everyone, with a leaderboard |
| Endless | Traffic keeps ramping until something breaks; score is movements handled |
| Co-op (later) | Each player takes a seat at the same airport |

### Difficulty dials

The dials are traffic density, pilot readback error rate, assists (conflict prediction, auto-handoff, suggested taxi routes), pause allowed, and wake rules on or off. Presets are Casual, Standard and Realistic, and all of them can be overridden.

## Tech plan

**The heart of the design is a deterministic simulation core in TypeScript, kept separate from rendering and UI.** The same core then powers single-player, replays, the daily challenge and later co-op without a rewrite. Squawk is a fresh codebase that shares no code, assets or services with any other project.

### Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Sim core | TypeScript, fixed tick (4 Hz), seeded RNG, runs in a Web Worker | Deterministic: the same seed and the same commands give the same shift. Keeps the UI smooth |
| Rendering | Three.js (WebGL 2; WebGPU later) | An orthographic low-poly scene rendered to a low-res target for the pixel look, with shadow maps, instanced airfield lights and bloom. The radar is drawn as crisp vector lines |
| UI panels | Svelte | Strips, radio log, menus and settings; small, fast and reactive, which suits lots of live-updating panels |
| Audio | Web Audio + Web Speech API | Radio filter, squelch and synthesised voices without assets; voice input via in-browser Whisper (WebGPU), falling back to Web Speech |
| Saves | localStorage / IndexedDB for MVP | No backend needed to launch |
| Multiplayer & online | No game server. Co-op is hosted in a browser over WebRTC, with a tiny signalling service; leaderboards use a Cloudflare Worker + KV | Everything stays in TypeScript and there's nothing to run or pay for. A Node/Bun dedicated server can come later and run the same sim core |
| Hosting | Static site at squawk.x3.dev (Cloudflare Pages or similar, via a subdomain record on x3.dev) | Cheap, fast, nothing to run for single-player |

### Sim model

- **Aircraft** is a state machine: at stand → pushback → taxi → holding → take-off roll → climb → en route, and the reverse for arrivals. Each aircraft type has a simplified performance profile: speeds, climb and descent rates, turn rate and wake category.
- **Commands** are typed objects such as `{ callsign, verb: 'heading', value: 270 }`. They come from the radial menu, a drag or the parser, and they all go through one validator: is this legal for this position and this aircraft now? A pilot model then adds response delay and readback errors.
- **Ground** is a taxiway graph. Nodes are junctions and hold points, and edges are taxiway segments with occupancy locks. A\* handles route suggestions.
- **Air** uses simple kinematics in nautical miles and feet. Conflict detection projects tracks 2 minutes ahead.

### Data formats (JSON)

- **Airport:** built by the real-data pipeline: runways (thresholds, headings, ILS), taxiway graph, stands, the control-zone polygon, and SIDs/STARs as lists of fixes.
- **Traffic schedule:** callsign, type, origin/destination, time and stand. Built from real Heathrow schedules (real airlines, flight numbers, aircraft types, routes and terminals), with a seed that shuffles timings so no two shifts are identical.
- **Aircraft types:** a performance table covering about 15 common types to start.

### Co-op readiness (design for it now, build it later)

- Positions own aircraft, and a handoff is an explicit ownership transfer. AI controllers and human players use the same interface.
- All input goes through the command queue, never by mutating state directly. The host's browser runs the authoritative sim. Other players send commands over WebRTC data channels and receive state snapshots. If the host drops, the shift pauses and can be handed to another player from the latest snapshot.
- Decided: browser hosting first. If you want shifts that keep running with no host, add a small Node or Bun server that runs the same TypeScript core with no rendering. The simulation is never ported to another language.

### Co-op seats (decided)

**Co-op is built for 2–4 friends and scales to 10 seats.** At Heathrow those seats are Delivery, Ground ×3, Tower North/South, Director North/South/Final, and London Control. With fewer players, positions merge ("bandboxed") the way they do on a real quiet shift, and AI covers any seat nobody takes.

| Players | Default split |
| --- | --- |
| 1 | Your choice of seats; AI runs the rest |
| 2 | Delivery + Ground · Tower + Director |
| 3 | Delivery + Ground · Tower · Director |
| 4 | Delivery + Ground · Tower · Director · London Control |
| 5–10 | Split Ground, Tower North/South, Director North/South/Final |

- Players can split or merge seats mid-shift, with a quick handover summary like a real position handover.
- Each player's radio log shows their own frequency. Others can be monitored on demand.
- Voice is left to Discord, which friends already use.

## Roadmap

**Prove that Heathrow Tower is fun before building anything else.** If two segregated runways with a steady flow of arrivals and departures aren't fun, adding more positions won't fix it.

1. **Prototype: Tower only.** Heathrow in segregated mode, with one landing and one departure runway. Arrivals appear on a 5 nm final and departures at the holding point. Commands: line up, take-off, land, go around. Click commands, a radio log, and basic runway-occupancy and wake rules. *Done when:* a 15-minute shift is tense and fun with placeholder art.
2. **Vertical slice: Ground + Tower + Director.** Taxiway graph and routing, radar view with vectoring and ILS, the radial menu and typed shortcuts, flight strips, handoffs, scoring and debrief, 7700 and 7600, first pixel art. *Done when:* a stranger can learn it with no help and play a full combined shift.
3. **Content: Delivery, London Control (lite) and career.** Squawk assignment and clearances, ratings and checkrides, a second real airport, weather and runway changes, night, audio. *Done when:* there's a 3 to 5 hour career path.
4. **Launch: squawk.x3.dev.** Voice commands, daily challenge, leaderboards (Cloudflare Worker), settings and accessibility, onboarding polish. Done when: friends can open squawk.x3.dev and play the career and the daily challenge with no install.
5. **Post-launch.** Gatwick, Stansted, Luton and City through the pipeline, London top-down coverage, co-op seats, plus installable as a PWA, so it opens like an app from the home screen or desktop without a download.

## Build brief for Claude Code

**This doc is the spec. Build it milestone by milestone, and stop at each "Done when" for Alex to play-test before starting the next.** Where the doc is silent, choose realism first, keep it simple second, and note the choice in `DECISIONS.md`.

### Repo layout (pnpm monorepo, TypeScript strict, Vite)

- `packages/sim`: pure TypeScript with no DOM. Deterministic 4 Hz tick, seeded RNG, command queue, serialisable snapshots. Runs in a Web Worker in the browser and headless in Node for tests.
- `packages/phraseology`: command ↔ UK CAP 413 text in both directions, the typed-shortcut parser, and the voice grammar.
- `packages/render`: the Three.js airport scene, the radar layer and the zoom transition.
- `apps/web`: Svelte UI, worker bootstrap and settings.
- `tools/pipeline`: Node scripts for the OpenStreetMap (Overpass) import, hand-kept AIP corrections, OpenSky and METAR fetches, validation and baking.
- `data/airports/EGLL/` and `data/days/`: the baked JSON packs, committed to the repo.

### Conventions

- The internal frame is local east/north metres centred on Heathrow's aerodrome reference point. Convert to nm, ft and kt only at the edges (UI and phraseology).
- No hand-made art is needed. Aircraft meshes are generated from a type table (length, wingspan, engine count and position, tail shape) plus per-airline livery colours. Buildings are extruded from OSM footprints. Data tags use an open-licensed pixel font.
- Unknown aircraft types from OpenSky map to the nearest type family, and the substitution is logged in the pipeline.

### Quality bar

- **Tests (Vitest):** sim unit tests; **golden replays**, where a seed plus a command log must produce the same final state hash; phraseology round-trips (command → text → parse → same command); and pipeline validation run in CI.
- **Performance:** 60 fps on a mid-range laptop with 150 aircraft on the scope, in the latest Chrome, Edge, Firefox and Safari. WebGPU is an enhancement, never a requirement.
- **Scope:** no code from other projects, no FAA phraseology, no backend server at launch.

### Inputs needed from Alex

- [ ] **OpenSky credentials:** Alex provides `credentials.json` (OpenSky API client ID and secret) in the repo root. The pipeline reads it from there. Add it to `.gitignore` before the first commit; it is never committed or shipped to the browser.
- [ ] **Domain:** squawk.x3.dev (Alex's own domain), with a DNS record pointing at the host by the launch milestone.
- [ ] Optional: which real days to bake first. Otherwise the pipeline picks a summer Friday, a winter night, an easterly day and a fog day from the archive.

### Open questions

- [ ] Pixel 2D or low-poly 3D? Decided: low-poly 3D with a pixel-art finish and real lighting (see Look & feel).
- [ ] Phraseology: decided. UK CAP 413 only (see Controls & comms).
- [ ] Voice input: decided. A core feature for launch (see Voice commands).
- [ ] Co-op size: decided. 2–4 friends, scaling to 10 seats with bandboxing (see Co-op seats).

* [ ] Real schedules: decided. Replay real days from OpenSky data (see Real traffic).
