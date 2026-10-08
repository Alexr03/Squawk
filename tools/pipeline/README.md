# Data pipeline

## Traffic (day packs)

`traffic.ts` bakes one real UTC day at an airport into `data/days/<ICAO>-<YYYY-MM-DD>.json` (a `DayPack`) and
rebuilds `data/days/index.json`.

```sh
# bake a day (needs OpenSky API client credentials)
OPENSKY_CREDENTIALS=path/to/credentials.json node tools/pipeline/traffic.ts EGLL 2026-08-28 --label "Fri 28 Aug 2026 — summer Friday peak" --tags summer,peak

# suggest candidate days from METARs (no credentials needed)
node tools/pipeline/traffic.ts find EGLL --from 2025-10-01 --to 2026-10-05
```

`OPENSKY_CREDENTIALS` defaults to `credentials.json` in the repo root (`{"clientId": "...", "clientSecret": "..."}`,
gitignored). Raw responses are cached in `tools/pipeline/.cache/` (gitignored); delete a file there to refetch.

Sources:

- **Movements:** OpenSky `/flights/arrival` (1-day window, filtered by `lastSeen`) and `/flights/departure`
  (2-day window, filtered by `firstSeen`). OpenSky files each flight under the day it *ended*, so a long-haul
  departure landing tomorrow only shows up in tomorrow's partition. A day is therefore bakeable once the day
  *after* it has been batch-processed (in practice: 3 days ago or older). Each query costs 30 credits, so a bake
  costs 60 of the free tier's 4,000 daily `/flights` credits. History back to at least 2020 works on the free tier.
- **Types:** [tar1090-db](https://github.com/wiedehopf/tar1090-db) (current), falling back to OpenSky's aircraft
  database dump (last published 2025-08). OpenSky's `/metadata/aircraft/icao/` endpoint now returns 410 Gone.
  Types are mapped to the families in `packages/sim/src/aircraft.ts` by the `FAMILY` table, then by ICAO Doc 8643
  class (bizjets and other light/medium jets → E190, props → AT76, heavies → B772/B744). Every mapping is logged
  in the pack's `substitutions`; helicopters and untypeable aircraft are dropped and logged as `drop ...`.
- **Operator:** the callsign's 3-letter prefix (who flies it and whose RT callsign is spoken).
- **Weather:** METARs + SPECIs from the [IEM ASOS archive](https://mesonet.agron.iastate.edu/request/download.phtml),
  from 23:00 the day before to 01:00 the day after.

Filters: callsigns must match `^[A-Z]{3}[0-9][0-9A-Z]{0,3}$`; repeats of the same callsign and direction within
30 min are dropped; flights OpenSky gives the same airport at both ends are dropped (they appear in both lists
and one copy is wrong). The bake warns about empty daytime hours, which usually mean an OpenSky data gap: check
the hourly profile and pick another day rather than shipping a hole.

`find` heuristics: easterly = ≥60% of METARs with wind 020–160° above 5 kt; fog = visibility < 800 m in 3+
distinct hours between 06 and 20 UTC; winter night = Mon–Wed in Dec–Feb with no poor night weather; summer
Friday = Fridays in Jun–Aug (with the share of westerly METARs).

`traffic.test.ts` checks every committed pack (types known, times within the day ±1, both kinds present, METARs
sorted and non-empty) and that the index matches the files.
