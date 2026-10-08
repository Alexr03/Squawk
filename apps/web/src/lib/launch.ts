// What it takes to start a shift (from free play, the career, the daily challenge or co-op).
import type { AirportPack, Difficulty, Mode, ShiftConfig } from '@squawk/sim';
import type { CareerShift } from './career.ts';
import { loadAirport, loadDay } from './data.ts';

export interface Launch {
  title: string; airports: string[]; days: (string | null)[]; start: number; minutes: number; traffic: number;
  coverage: string[]; difficulty: Difficulty; mode: Mode; seed: number; hints?: boolean;
  career?: CareerShift; dailyKey?: string; weather?: ShiftConfig['weather'];
}

/** Load the packs and build the sim config for a launch. */
export async function prepare(l: Launch): Promise<{ packs: AirportPack[]; cfg: ShiftConfig }> {
  const packs = await Promise.all(l.airports.map(loadAirport));
  const days = await Promise.all(l.days.map(d => (d ? loadDay(d, l.seed) : Promise.resolve(null))));
  const cfg: ShiftConfig = { seed: l.seed, airports: l.airports, days, start: l.start, durationS: l.mode === 'endless' ? 0 : l.minutes * 60, traffic: l.traffic,
    coverage: l.coverage, difficulty: l.difficulty, mode: l.mode, ...(l.weather ? { weather: l.weather } : {}) };
  return { packs, cfg };
}
