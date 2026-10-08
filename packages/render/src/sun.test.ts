import { expect, test } from 'vitest';
import { sunPosition } from './sun.ts';

test('sun over Heathrow', () => {
  const at = (iso: string) => sunPosition(Date.parse(iso) / 1000, 51.4775, -0.4614);
  const noon = at('2026-09-19T12:00:00Z');
  expect(noon.el).toBeGreaterThan(38); // ~39.6° near the equinox
  expect(noon.el).toBeLessThan(41);
  expect(Math.abs(noon.az - 180)).toBeLessThan(5);
  const morning = at('2026-06-21T06:00:00Z');
  expect(morning.az).toBeGreaterThan(70); // east-north-east, low
  expect(morning.az).toBeLessThan(100);
  expect(at('2026-12-21T23:00:00Z').el).toBeLessThan(-40);
});
