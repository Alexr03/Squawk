// Peek at aircraft in a phase at a given tick: node tools/peek.ts <dayId> <hourUTC> <tick> <phase>
import { readFileSync } from 'node:fs';
import { buildWorld, createShift, DIFFICULTY, step, along } from '../packages/sim/src/index.ts';
const [dayId, hour, until, phase] = process.argv.slice(2);
const icao = dayId.slice(0, 4);
const pack = JSON.parse(readFileSync(new URL(`../data/airports/${icao}/airport.json`, import.meta.url), 'utf8'));
const day = JSON.parse(readFileSync(new URL(`../data/days/${dayId}.json`, import.meta.url), 'utf8'));
const world = buildWorld([pack]); const apt = world.primary;
const cfg = { seed: 7, airports: [icao], days: [day], start: Date.parse(day.date + 'T00:00:00Z') / 1000 + +hour * 3600, durationS: 3600, traffic: 1, coverage: [], difficulty: DIFFICULTY.standard, mode: 'free' as const };
const st = createShift(world, cfg);
while (st.tick < +until) step(world, cfg, st);
for (const a of st.aircraft.filter(a => phase === "vectors" ? !!a.vectors : a.phase === phase)) {
  if (phase === "vectors") { console.log(a.cs, a.phase, a.owner, "vec", a.vectors!.i, "/", a.vectors!.pts.length, "alt", Math.round(a.alt), "hdg", Math.round(a.hdg), "tgtHdg", a.tgtHdg, "ils", a.nav.ils, "est", a.nav.established, "pos", Math.round(a.x), Math.round(a.y), "chk", a.checkedIn, "act", a.actAt - st.tick); continue; }
  const end = a.runway ? apt.ends[a.runway] : null;
  console.log(a.cs, a.phase, 'rwy', a.runway, 's', Math.round(a.s), 'len', end && Math.round(end.len), 'ias', a.ias.toFixed(1), 'gs', a.gs.toFixed(1), 'pos', Math.round(a.x), Math.round(a.y), 'pi', a.pi, a.path.length, 'stopped', a.stoppedS, 'blk', a.blockedBy);
  if (end) { const ex: string[] = []; for (const [n, rw] of apt.onRunway) if (rw === end.runway) for (const { to } of apt.adj[n]) if (apt.onRunway.get(to) !== rw) ex.push(`${n}@${Math.round(along(end, apt.nodes[n]))}`); console.log(' exits', ex.join(' ')); }
}
