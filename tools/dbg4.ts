import { readFileSync } from 'node:fs';
import { buildWorld, createShift, DIFFICULTY, step, runwayAt, geo } from '../packages/sim/src/index.ts';
const pack = JSON.parse(readFileSync(new URL('../data/airports/EGLL/airport.json', import.meta.url), 'utf8'));
const day = JSON.parse(readFileSync(new URL('../data/days/EGLL-2026-08-28.json', import.meta.url), 'utf8'));
const world = buildWorld([pack]);
const apt = world.primary;
const cfg = { seed: 7, airports: ['EGLL'], days: [day], start: Date.parse('2026-08-28T' + (process.env.H ?? '07') + ':00:00Z') / 1000, durationS: 3600, traffic: 1, coverage: [], difficulty: DIFFICULTY.standard, mode: 'free' as const };
const st = createShift(world, cfg);
const [from, to] = [+(process.argv[2]), +(process.argv[3])];
const w = process.argv[4].split(',');
while (st.tick < to && !st.ended) { step(world, cfg, st);
  if (st.tick >= from && st.tick % 4 === 0) { const xs = st.aircraft.filter(a => w.includes(a.cs));
    console.log(st.tick, xs.map(a => `${a.cs} ${a.phase} ${a.owner} chk${a.checkedIn} act${a.actAt>1e12?"INF":a.actAt-st.tick} stp${Math.round(a.stoppedS)} (${Math.round(a.x)},${Math.round(a.y)}) h${Math.round(a.hdg)} gs${a.gs.toFixed(1)} pi${a.pi}/${a.path.length} blk=${a.blockedBy} rw=${runwayAt(apt,a)}`).join(' | '), xs.length === 2 ? 'd=' + geo.dist(xs[0], xs[1]).toFixed(1) : ''); } }
console.log(st.ended);
const z = st.aircraft.find(a => a.cs === (process.argv[5] ?? 'BAW45EM'));
if (z) console.log(z.cs, z.phase, 'claims', z.claims, 'path', z.path.slice(Math.max(0, z.pi - 2), z.pi + 4), 'pi', z.pi, 'cleared', JSON.stringify(z.cleared), 'holdAt', z.holdAt, 'stand', z.stand, 'last', JSON.stringify(z.last).slice(0, 200));
