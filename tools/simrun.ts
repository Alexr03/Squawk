// Headless shift runner for tuning: node tools/simrun.ts [dayId] [startHourUTC] [minutes] [traffic] [coverage,...]
import { readFileSync } from 'node:fs';
import { buildWorld, createShift, debrief, DIFFICULTY, step, type AirportPack, type DayPack, type ShiftConfig } from '../packages/sim/src/index.ts';

const [dayId = 'EGLL-2026-08-28', hour = '7', minutes = '60', traffic = '1', cov = ''] = process.argv.slice(2);
const pack: AirportPack = JSON.parse(readFileSync(new URL('../data/airports/EGLL/airport.json', import.meta.url), 'utf8'));
const day: DayPack = JSON.parse(readFileSync(new URL(`../data/days/${dayId}.json`, import.meta.url), 'utf8'));
const world = buildWorld([pack]);
const start = Date.parse(day.date + 'T00:00:00Z') / 1000 + +hour * 3600;
const cfg: ShiftConfig = { seed: 7, airports: ['EGLL'], days: [day], start, durationS: +minutes * 60, traffic: +traffic, coverage: cov ? cov.split(',') : [], difficulty: DIFFICULTY.standard, mode: 'free' };
const st = createShift(world, cfg);
const t0 = performance.now();
let maxAc = 0;
const phaseLog: string[] = [];
while (!st.ended) {
  step(world, cfg, st);
  maxAc = Math.max(maxAc, st.aircraft.length);
  if (st.tick % (4 * 600) === 0) {
    const ph: Record<string, number> = {};
    for (const a of st.aircraft) ph[a.phase] = (ph[a.phase] ?? 0) + 1;
    phaseLog.push(`${(st.tick / 240).toFixed(0)}min ${JSON.stringify(ph)}`);
  }
}
const ms = performance.now() - t0;
const d = debrief(st);
console.log(phaseLog.join('\n'));
console.log(`ended=${st.ended} ticks=${st.tick} ${ms.toFixed(0)}ms (${(ms / st.tick).toFixed(2)} ms/tick) maxAircraft=${maxAc}`);
console.log(JSON.stringify(st.stats));
console.log(`grade ${d.grade} score ${d.score} eff ${d.efficiency} perHour ${d.perHour}`);
const stuck = st.aircraft.filter(a => a.onGround && a.stoppedS > 120);
console.log('stuck>2min:', stuck.map(a => `${a.cs}:${a.phase}:${Math.round(a.stoppedS)}s blk=${a.blockedBy}`).join(' '));
const evs: Record<string, number> = {};
for (const e of st.events) evs[e.kind] = (evs[e.kind] ?? 0) + 1;
console.log('events', JSON.stringify(evs));
for (const e of st.events.filter(e => e.severity >= 2).slice(0, 25)) console.log(`  ${(e.tick / 240).toFixed(1)}min ${e.kind}: ${e.text}`);
