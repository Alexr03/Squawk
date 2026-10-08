// Player-as-Ground check: push every departure, then taxi it to its runway; count routes whose first leg points backwards.
import { readFileSync } from 'node:fs';
import { buildWorld, createShift, DIFFICULTY, geo, issue, step, type AirportPack, type DayPack, type ShiftConfig } from '../packages/sim/src/index.ts';

const dayId = process.argv[2] ?? 'EGLL-2026-08-28', icao = dayId.slice(0, 4);
const pack: AirportPack = JSON.parse(readFileSync(new URL(`../data/airports/${icao}/airport.json`, import.meta.url), 'utf8'));
const day: DayPack = JSON.parse(readFileSync(new URL(`../data/days/${dayId}.json`, import.meta.url), 'utf8'));
const world = buildWorld([pack]);
const apt = world.primary;
const cfg: ShiftConfig = { seed: 7, airports: [icao], days: [day], start: Date.parse(day.date + 'T00:00:00Z') / 1000 + 7 * 3600, durationS: 40 * 60, traffic: 1, coverage: [`${icao}:GND`], difficulty: { ...DIFFICULTY.standard, readbackErrors: 0, emergencies: 0 }, mode: 'free' };
const st = createShift(world, cfg);
let taxied = 0, backwards = 0;
const done = new Set<string>();
while (!st.ended) {
  step(world, cfg, st);
  for (const a of st.aircraft) {
    if (a.kind !== 'dep' || !a.onGround) continue;
    if (a.phase === 'stand' && a.cleared.dl && !a.cleared.push && a.freq.endsWith(':GND')) issue(world, st, [{ cs: a.cs, verb: 'push' }]);
    else if (a.phase === 'pushed' && !a.cleared.taxi && !done.has(a.cs)) {
      if (issue(world, st, [{ cs: a.cs, verb: 'taxi', to: a.runway!, via: [] }])) continue;
      done.add(a.cs);
    }
    if (done.has(a.cs) && a.cleared.taxi && a.path.length > 1 && !(a as { checked?: boolean }).checked) {
      (a as { checked?: boolean }).checked = true; taxied++;
      const leg = geo.bearing(apt.nodes[a.path[0]], apt.nodes[a.path[1]]);
      const d = Math.abs(((leg - a.hdg + 540) % 360) - 180);
      if (d > 110) { backwards++; console.log('BACKWARDS', a.cs, a.stand, 'hdg', Math.round(a.hdg), 'leg', Math.round(leg)); }
    }
  }
}
console.log(`taxied ${taxied}, first leg backwards ${backwards}`);
