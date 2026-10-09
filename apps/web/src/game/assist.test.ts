import { expect, test } from 'vitest';
import { unseen } from './assist.ts';

test('unseen: entries sharing a tick are all handled, once, even when they arrive in different snapshots', () => {
  const seen = { tick: -1, n: 0 };
  const log = [{ tick: 5, k: 'a' }, { tick: 5, k: 'b' }];
  expect(unseen(log, seen).map(e => e.k)).toEqual(['a', 'b']);
  expect(unseen(log, seen)).toEqual([]);
  log.push({ tick: 5, k: 'c' }, { tick: 6, k: 'd' }); // a third at tick 5, posted after a command mid-tick
  expect(unseen(log, seen).map(e => e.k)).toEqual(['c', 'd']);
  expect(unseen(log, seen)).toEqual([]);
});
