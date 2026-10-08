// What it takes to start a shift (from free play, the career, the daily challenge or co-op).
import type { Difficulty, Mode, ShiftConfig } from '@squawk/sim';
import type { CareerShift } from './career.ts';

export interface Launch {
  title: string; airports: string[]; days: (string | null)[]; start: number; minutes: number; traffic: number;
  coverage: string[]; difficulty: Difficulty; mode: Mode; seed: number; hints?: boolean;
  career?: CareerShift; dailyKey?: string; weather?: ShiftConfig['weather'];
}
