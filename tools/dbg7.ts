import { readFileSync } from 'node:fs';
import { buildWorld, createShift, DIFFICULTY, step, find } from '../packages/sim/src/index.ts';
import { planUnjam } from '../packages/sim/src/ai.ts';
const pack = JSON.parse(readFileSync(new URL('../data/airports/EGLL/airport.json', import.meta.url), 'utf8'));
const day = JSON.parse(readFileSync(new URL('../data/days/EGLL-2026-08-28.json', import.meta.url), 'utf8'));
const world = buildWorld([pack]); const apt = world.primary;
const cfg = { seed: 7, airports: ['EGLL'], days: [day], start: Date.parse('2026-08-28T12:00:00Z') / 1000, durationS: 3600, traffic: 1, coverage: [], difficulty: DIFFICULTY.standard, mode: 'free' as const };
const st = createShift(world, cfg);
while (st.tick < 4400) step(world, cfg, st);
const a = find(st, 'BAW45EM')!, b = find(st, 'SHT22A')!;
for (const [x, o] of [[a, b], [b, a]]) {
  console.log(x.cs, x.phase, 'owner', x.owner, 'blk', x.blockedBy, 'stopped', x.stoppedS, 'resume', JSON.stringify(x.resume), 'towing', x.towing, 'pi', x.pi, 'back', x.path.slice(0, x.pi).reverse().slice(0, 6).map(n => `${n}(deg${apt.adj[n].length})`).join(' '));
  console.log('  plan:', JSON.stringify(planUnjam(world, st, x, o))?.slice(0, 200));
}
