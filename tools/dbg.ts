import { readFileSync } from 'node:fs';
import { buildWorld, createShift, DIFFICULTY, step } from '../packages/sim/src/index.ts';
const pack = JSON.parse(readFileSync(new URL('../data/airports/EGLL/airport.json', import.meta.url), 'utf8'));
const day = JSON.parse(readFileSync(new URL('../data/days/EGLL-2026-08-28.json', import.meta.url), 'utf8'));
const world = buildWorld([pack]);
const apt = world.primary;
const cfg = { seed: 7, airports: ['EGLL'], days: [day], start: Date.parse('2026-08-28T' + (process.env.H ?? '07') + ':00:00Z') / 1000, durationS: 1800, traffic: 1, coverage: [], difficulty: DIFFICULTY.standard, mode: 'free' as const };
const st = createShift(world, cfg);
const until = +(process.argv[2] ?? 2400);
while (st.tick < until && !st.ended) step(world, cfg, st);
for (const a of st.aircraft.filter(a => a.onGround && a.stoppedS > 60)) {
  const nxt = a.path[a.pi], nn = apt.nodes[nxt];
  console.log(a.cs, a.phase, 'owner', a.owner, 'freq', a.freq, 'chk', a.checkedIn, 'stopped', Math.round(a.stoppedS), 'blk', a.blockedBy, 'holdAt', a.holdAt, 'pi', a.pi, '/', a.path.length,
    'next', nxt, nn?.hold, apt.onRunway.get(nxt), 'after', apt.onRunway.get(a.path[a.pi + 1]), 'cross', a.cleared.cross, 'rwy', a.runway, 'actAt', a.actAt > 1e12 ? 'INF' : a.actAt - st.tick);
}
