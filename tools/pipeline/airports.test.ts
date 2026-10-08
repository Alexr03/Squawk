import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import type { AirportPack } from '../../packages/sim/src/types.ts';
import { validate } from './validate.ts';

const DIR = path.resolve(import.meta.dirname, '../../data/airports');
const icaos = fs.readdirSync(DIR).filter(d => fs.existsSync(path.join(DIR, d, 'airport.json')));

test.each(icaos)('%s airport pack is valid', icao => {
  const p = JSON.parse(fs.readFileSync(path.join(DIR, icao, 'airport.json'), 'utf8')) as AirportPack;
  expect(p.icao).toBe(icao);
  expect(validate(p).filter(x => x.startsWith('FATAL'))).toEqual([]);
  const { fixes, sids, stars, stacks } = p.airspace;
  for (const s of [...sids, ...stars]) for (const f of s.fixes) expect(fixes[f], `${s.name} fix ${f}`).toBeDefined();
  const stackNames = new Set(stacks.map(s => s.name));
  for (const s of stars) expect(stackNames.has(s.stack), `${s.name} stack ${s.stack}`).toBe(true);
  const ends = new Set(p.runways.flatMap(r => r.ends.map(e => e.name)));
  for (const s of sids) expect(ends.has(s.runway), `SID ${s.name}${s.designator} runway ${s.runway}`).toBe(true);
  expect(p.configs.length).toBeGreaterThan(0);
  for (const c of p.configs) for (const e of [...c.arrivals, ...c.departures]) expect(ends.has(e), `${c.name}: ${e}`).toBe(true);
  // Every departure runway in a config has at least one SID.
  for (const e of new Set(p.configs.flatMap(c => c.departures))) expect(sids.some(s => s.runway === e), `SIDs for ${e}`).toBe(true);
});
