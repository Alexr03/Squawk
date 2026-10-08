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
