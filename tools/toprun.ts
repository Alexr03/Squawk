// London top-down headless run: all five airports, AI on every seat.
import { readFileSync } from 'node:fs';
import { buildWorld, createShift, step, DIFFICULTY, type AirportPack, type DayPack } from '../packages/sim/src/index.ts';
const ids: [string, string][] = [['EGLL', 'EGLL-2026-08-28'], ['EGKK', 'EGKK-2026-08-28'], ['EGSS', 'EGSS-2026-08-28'], ['EGGW', 'EGGW-2026-08-28'], ['EGLC', 'EGLC-2026-09-17']];
const packs: AirportPack[] = ids.map(([i]) => JSON.parse(readFileSync(new URL(`../data/airports/${i}/airport.json`, import.meta.url), 'utf8')));
const days: DayPack[] = ids.map(([, d]) => JSON.parse(readFileSync(new URL(`../data/days/${d}.json`, import.meta.url), 'utf8')));
const world = buildWorld(packs);
const cfg = { seed: 5, airports: ids.map(i => i[0]), days, start: Date.parse('2026-08-28T07:00:00Z') / 1000, durationS: 1800, traffic: +(process.argv[2] ?? 0.5), coverage: [], difficulty: DIFFICULTY.standard, mode: 'free' as const };
const st = createShift(world, cfg);
const t0 = performance.now(); let max = 0;
while (!st.ended) { step(world, cfg, st); max = Math.max(max, st.aircraft.length); }
console.log('ended', st.ended, 'ms/tick', ((performance.now() - t0) / st.tick).toFixed(2), 'max aircraft', max);
const by: Record<string, number[]> = {};
for (const a of st.aircraft) (by[a.apt] ??= [0, 0])[a.onGround ? 0 : 1]++;
console.log(JSON.stringify(st.stats), JSON.stringify(by));
const ev: Record<string, number> = {}; for (const e of st.events) ev[e.kind] = (ev[e.kind] ?? 0) + 1; console.log(JSON.stringify(ev));
