import { readFileSync } from 'node:fs';
import { buildWorld, createShift, DIFFICULTY, step, etaToThreshold } from '../packages/sim/src/index.ts';
const pack = JSON.parse(readFileSync(new URL('../data/airports/EGLL/airport.json', import.meta.url), 'utf8'));
const day = JSON.parse(readFileSync(new URL('../data/days/EGLL-2026-08-28.json', import.meta.url), 'utf8'));
const world = buildWorld([pack]);
const cfg = { seed: 7, airports: ['EGLL'], days: [day], start: Date.parse('2026-08-28T07:00:00Z') / 1000, durationS: 1800, traffic: 1, coverage: [], difficulty: DIFFICULTY.standard, mode: 'free' as const };
const st = createShift(world, cfg);
const until = +(process.argv[2] ?? 2400);
const watch = (process.argv[3] ?? '').split(',');
while (st.tick < until && !st.ended) {
  step(world, cfg, st);
  if (st.tick % 20 === 0) for (const a of st.aircraft.filter(a => watch.includes(a.cs))) console.log((st.tick/240).toFixed(1), a.cs, a.phase, a.owner, a.checkedIn, Math.round(a.alt), Math.round(a.tgtAlt), Math.round(a.hdg), a.nav.mode, a.nav.hold?.fix, a.nav.ils, a.nav.established, !!a.vectors, a.vectors?.i);
}
console.log('as', JSON.stringify(st.apts[0].arr), 'tick', st.tick);
for (const a of st.aircraft.filter(a => a.kind === 'arr' && !a.onGround).slice(0, 14)) console.log(a.cs, a.phase, a.owner, 'chk', a.checkedIn, 'alt', Math.round(a.alt), '->', a.tgtAlt, a.stack, a.runway, 'vec', a.vectors ? a.vectors.i + '/' + a.vectors.pts.length : '-', 'est', a.nav.established, 'eta', Math.round(etaToThreshold(world, st, a) - st.tick / 4), 'act', a.actAt > 1e12 ? 'INF' : a.actAt - st.tick);
for (const e of st.events) console.log(e.tick, e.text);
