// Trace one aircraft each N ticks: node tools/trace.ts <dayId> <hourUTC> <cs> <from> <to> <every>
import { readFileSync } from 'node:fs';
import { buildWorld, createShift, DIFFICULTY, step } from '../packages/sim/src/index.ts';
const [dayId, hour, cs, from, to, every] = process.argv.slice(2);
const icao = dayId.slice(0, 4);
const pack = JSON.parse(readFileSync(new URL(`../data/airports/${icao}/airport.json`, import.meta.url), 'utf8'));
const day = JSON.parse(readFileSync(new URL(`../data/days/${dayId}.json`, import.meta.url), 'utf8'));
const world = buildWorld([pack]);
const cfg = { seed: 7, airports: [icao], days: [day], start: Date.parse(day.date + 'T00:00:00Z') / 1000 + +hour * 3600, durationS: 3600, traffic: 1, coverage: [], difficulty: DIFFICULTY.standard, mode: 'free' as const };
const st = createShift(world, cfg);
while (st.tick < +to) { step(world, cfg, st);
  if (st.tick >= +from && st.tick % +every === 0) { const a = st.aircraft.find(x => x.cs === cs); if (a) console.log(st.tick, a.phase, a.owner, 'pos', Math.round(a.x / 1852), Math.round(a.y / 1852), 'alt', Math.round(a.alt), 'hdg', Math.round(a.hdg), 'tgt', a.tgtHdg, a.turn, 'mode', a.nav.mode, a.nav.hold?.leg, 'vec', a.vectors ? `${a.vectors.i}/${a.vectors.pts.length}` : '-'); } }
for (const r of st.radio.filter(r => r.cs === cs).slice(-6)) console.log(r.tick, r.from, JSON.stringify(r.msg).slice(0, 140));
