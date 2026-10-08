import { expect, test } from 'vitest';
import type { Verb } from '@squawk/sim';
import { parse, text } from './index.ts';

test('command -> text -> parse round-trips', () => {
  for (const callsign of ['BAW12', 'BAW4RG', 'EIN150', 'UAE1'])
    for (const verb of ['luw', 'cto', 'land', 'goaround'] as Verb[]) {
      const msg = verb === 'goaround' ? { t: verb } : { t: verb, rwy: '27L', wind: { dir: 250, kt: 12 } };
      const s = text({ tick: 0, from: 'atc', callsign, msg });
      expect(parse(s), s).toEqual({ callsign, verb });
    }
});

test('UK phraseology text', () => {
  expect(text({ tick: 0, from: 'atc', callsign: 'BAW12', msg: { t: 'cto', rwy: '27L', wind: { dir: 250, kt: 12 } } }))
    .toBe('Speedbird one two, wind two five zero degrees one two knots, runway two seven left, cleared for take-off.');
  expect(text({ tick: 0, from: 'pilot', callsign: 'BAW12', msg: { t: 'contact', unit: 'GND' } }))
    .toBe('One two one decimal nine zero five, Speedbird one two.');
});
