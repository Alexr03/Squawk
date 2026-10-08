import { readFileSync } from 'node:fs';
import { buildWorld, createShift, DIFFICULTY, step, find, along, lateral } from '../packages/sim/src/index.ts';
const pack = JSON.parse(readFileSync(new URL('../data/airports/EGLL/airport.json', import.meta.url), 'utf8'));
const day = JSON.parse(readFileSync(new URL('../data/days/EGLL-2026-08-28.json', import.meta.url), 'utf8'));
const world = buildWorld([pack]); const apt = world.primary;
const cfg = { seed: 7, airports: ['EGLL'], days: [day], start: Date.parse('2026-08-28T' + (process.env.H ?? '07') + ':00:00Z') / 1000, durationS: 3600, traffic: 1, coverage: [], difficulty: DIFFICULTY.standard, mode: 'free' as const };
const st = createShift(world, cfg);
const cs = process.argv[3]; let prevCross = '';
while (st.tick < +process.argv[2]) { step(world, cfg, st); const a = find(st, cs); if (a) { const k = JSON.stringify(a.cleared.cross) + a.phase + a.owner; if (k !== prevCross) { console.log(st.tick, a.phase, a.owner, 'cross', a.cleared.cross, 'pos', Math.round(a.x), Math.round(a.y)); prevCross = k; } } }
const a = find(st, cs)!; const e = apt.ends['27L'];
console.log(a.path.map((n, i) => `${i === a.pi ? '>' : ''}${n}${apt.onRunway.has(n) ? 'R' : ''}${apt.nodes[n].hold ? '[' + apt.nodes[n].hold + ']' : ''}(${Math.round(lateral(e, apt.nodes[n]))})`).slice(-12).join(' '));
