import { expect, test } from 'vitest';
import { createShift, debrief, depGap, hashState, issue, occupants, replay, step, TICK_HZ, type State } from './index.ts';

// A competent-but-simple controller, used to drive whole shifts.
function bot(st: State) {
  for (const ac of st.aircraft) {
    if (ac.phase === 'final' && !ac.cleared && !ac.ga) {
      if (!occupants(st, ac.runway).length) issue(st, { callsign: ac.callsign, verb: 'land' });
      else if (ac.s > -1200) issue(st, { callsign: ac.callsign, verb: 'goaround' });
    }
    if (ac.phase === 'lined' && !ac.cleared && depGap(st, ac) === 0) issue(st, { callsign: ac.callsign, verb: 'cto' });
  }
  const next = st.aircraft.find(a => a.phase === 'holding' && !a.luw);
  if (next && !st.aircraft.some(a => a.phase === 'lining' || a.phase === 'lined' || (a.phase === 'holding' && a.luw)))
    issue(st, { callsign: next.callsign, verb: 'luw' });
}
function play(seed: number) {
  const st = createShift(seed);
  while (!st.ended) { bot(st); step(st); }
  return st;
}

test('a careful controller finishes a shift with no safety events', () => {
  const st = play(1);
  const d = debrief(st);
  expect(st.ended).toBe('time');
  expect(d.sepLoss + d.wakeInf + d.clrOccupied).toBe(0);
  expect(d.landed).toBeGreaterThan(5);
  expect(d.departed).toBeGreaterThan(5);
});

test('golden replay: seed + command log reproduce the same final state', () => {
  const st = play(42);
  const again = replay(42, st.cmdLog, st.tick);
  expect(hashState(again)).toBe(hashState(st));
  expect(hashState(st)).toMatchInlineSnapshot(`"998a51e2"`);
});

test('no landing clearance by half a mile means the pilot goes around', () => {
  const st = createShift(7);
  let landed = false;
  while (!st.ended && st.stats.pilotGoArounds === 0) {
    // Clear everyone to land immediately, regardless of the runway.
    for (const ac of st.aircraft) if (ac.phase === 'final' && !ac.cleared && !landed) { issue(st, { callsign: ac.callsign, verb: 'land' }); landed = true; }
    step(st);
  }
  expect(st.stats.pilotGoArounds).toBe(1); // second arrival never got a clearance
  expect(st.stats.goArounds).toBe(1);
});

test('departure gap: medium behind heavy waits 2 minutes', () => {
  const st = createShift(3);
  const dep = (wake: 'M' | 'H', sid: string) => ({ kind: 'dep', wake, sid }) as never;
  st.lastDep = { callsign: 'X', wake: 'H', sid: 'CPT', airborneAt: st.tick };
  expect(depGap(st, dep('M', 'DET'))).toBe(120);
  expect(depGap(st, dep('H', 'DET'))).toBe(60);
  expect(depGap(st, dep('H', 'CPT'))).toBe(120);
  for (let i = 0; i < 90 * TICK_HZ; i++) st.tick++;
  expect(depGap(st, dep('M', 'DET'))).toBe(30);
});
