// Every career shift and today's daily: how many pilot calls reach the player's positions? A shift with ~0 is broken.
import { readFileSync } from 'node:fs';
import { buildWorld, createShift, DIFFICULTY, seatId, step, type AirportPack, type DayPack, type ShiftConfig } from '../packages/sim/src/index.ts';
import { dailyShift, RATINGS, type CareerShift } from '../apps/web/src/lib/career.ts';

const packs = new Map<string, AirportPack>();
const pack = (icao: string) => packs.get(icao) ?? (packs.set(icao, JSON.parse(readFileSync(new URL(`../data/airports/${icao}/airport.json`, import.meta.url), 'utf8'))), packs.get(icao)!);
const shifts: CareerShift[] = [...RATINGS.flatMap(r => r.shifts), ...[0, 1, 2, 3, 4, 5, 6].map(i => dailyShift(new Date(Date.UTC(2026, 9, 8 + i))))];
for (const c of shifts) {
  const day: DayPack = JSON.parse(readFileSync(new URL(`../data/days/${c.day}.json`, import.meta.url), 'utf8'));
  const world = buildWorld([pack(c.airport)]);
  const start = Date.parse(`${day.date}T${c.startUtc}:00Z`) / 1000;
  const coverage = c.seats.map(s => seatId(c.airport, s));
  const cfg: ShiftConfig = { seed: 5, airports: [c.airport], days: [day], start, durationS: c.minutes * 60, traffic: c.traffic, coverage, difficulty: { ...DIFFICULTY[c.difficulty], emergencies: 0 }, mode: 'career' as never };
  const st = createShift(world, cfg);
  let firstCall = -1;
  while (!st.ended) { step(world, cfg, st); if (firstCall < 0 && st.radio.some(r => r.from === 'pilot' && coverage.includes((r as { seatId?: string }).seatId ?? `${r.airport}:${r.seat}`))) firstCall = st.tick / 240; }
  const calls = st.radio.filter(r => r.from === 'pilot' && coverage.includes((r as { seatId?: string }).seatId ?? `${r.airport}:${r.seat}`)).length;
  console.log(`${c.id.padEnd(6)} ${c.title.slice(0, 28).padEnd(28)} ${c.seats.join('+').padEnd(16)} ${c.startUtc} ${c.minutes}m  calls ${String(calls).padStart(3)}  first at ${firstCall < 0 ? 'never' : firstCall.toFixed(1) + ' min'}`);
}
