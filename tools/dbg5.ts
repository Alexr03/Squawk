import { readFileSync } from 'node:fs';
import { buildWorld, createShift, DIFFICULTY, step, etaToThreshold } from '../packages/sim/src/index.ts';
const pack = JSON.parse(readFileSync(new URL('../data/airports/EGLL/airport.json', import.meta.url), 'utf8'));
const day = JSON.parse(readFileSync(new URL('../data/days/EGLL-2026-08-28.json', import.meta.url), 'utf8'));
const world = buildWorld([pack]);
const cfg = { seed: 7, airports: ['EGLL'], days: [day], start: Date.parse('2026-08-28T07:00:00Z') / 1000, durationS: 3600, traffic: 1, coverage: [], difficulty: DIFFICULTY.standard, mode: 'free' as const };
const st = createShift(world, cfg);
const pred = new Map<string, number[]>(); let last = 0;
while (!st.ended && st.tick < 4 * 2400) { step(world, cfg, st);
  for (const a of st.aircraft) {
    if (a.kind === 'arr' && !a.onGround && (a.vectors || a.nav.established) && st.tick % 240 === 0) { const p = pred.get(a.cs) ?? []; p.push(Math.round(etaToThreshold(world, st, a) / 60 * 10) / 10); pred.set(a.cs, p); }
    if (a.phase === 'landing' && a.landedAt === st.tick) { console.log(`${(st.tick / 240).toFixed(1)} LAND ${a.cs} +${((st.tick - last) / 4).toFixed(0)}s  predicted-at-each-min: ${(pred.get(a.cs) ?? []).join(' ')}`); last = st.tick; }
  }
}
