import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { KNOWN_TYPES } from '../../packages/sim/src/aircraft.ts';
import type { DayPack } from '../../packages/sim/src/types.ts';
import { parseMetar } from './traffic.ts';

const DAYS = path.resolve(import.meta.dirname, '../../data/days');
const files = fs.readdirSync(DAYS).filter(f => f.endsWith('.json') && f !== 'index.json');

test('index lists every committed day pack', () => {
  const index = JSON.parse(fs.readFileSync(path.join(DAYS, 'index.json'), 'utf8')) as { id: string; flights: number }[];
  expect(index.map(e => e.id + '.json').sort()).toEqual([...files].sort());
});

test.each(files)('%s is a valid day pack', f => {
  const p = JSON.parse(fs.readFileSync(path.join(DAYS, f), 'utf8')) as DayPack;
  expect(p.id + '.json').toBe(f);
  const t0 = Date.parse(p.date + 'T00:00:00Z') / 1000;
  for (const fl of p.flights) {
    expect(KNOWN_TYPES, `${fl.cs} type`).toContain(fl.type);
    expect(fl.time, `${fl.cs} time`).toBeGreaterThanOrEqual(t0 - 86400);
    expect(fl.time, `${fl.cs} time`).toBeLessThan(t0 + 2 * 86400);
    expect(fl.cs).toMatch(/^[A-Z]{3}[0-9][0-9A-Z]{0,3}$/);
    expect(fl.other).toMatch(/^[A-Z0-9]{4}$/);
  }
  expect(p.flights.some(fl => fl.kind === 'arr')).toBe(true);
  expect(p.flights.some(fl => fl.kind === 'dep')).toBe(true);
  expect(p.metars.length).toBeGreaterThan(0);
  expect(p.metars.map(m => m.time)).toEqual(p.metars.map(m => m.time).sort((a, b) => a - b));
});

test('parseMetar', () => {
  const m = parseMetar('EGLL 170620Z AUTO 25012G25KT 0200 R27L/0350 FG VV002 BKN010 04/04 Q1016 TEMPO 1500 BR', 0);
  expect(m).toMatchObject({ wind: { dir: 250, kt: 12, gust: 25 }, visM: 200, ceilingFt: 200, qnh: 1016, tempC: 4, wx: ['FG'] });
  const c = parseMetar('EGKK 131050Z VRB03KT CAVOK M02/M04 Q1030 NOSIG', 0);
  expect(c).toMatchObject({ wind: { dir: 0, kt: 0 }, visM: 10000, ceilingFt: null, qnh: 1030, tempC: -2, wx: [] });
  expect(parseMetar('EGSS 011220Z 09008KT 9999 -SHRA SCT020CB OVC045 12/08 Q1009', 0)).toMatchObject({ visM: 10000, ceilingFt: 4500, wx: ['-SHRA'] });
});
