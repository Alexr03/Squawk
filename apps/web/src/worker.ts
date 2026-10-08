// Runs the sim off the main thread. In: start / cmd / speed. Out: a snapshot after each batch of ticks.
import { createShift, issue, step, TICK_HZ, type Command, type State } from '@squawk/sim';

let st: State | null = null;
let speed = 1, acc = 0, last = performance.now();

onmessage = (e: MessageEvent<{ t: 'start'; seed: number } | { t: 'cmd'; cmd: Command } | { t: 'speed'; v: number }>) => {
  const m = e.data;
  if (m.t === 'start') { st = createShift(m.seed); acc = 0; postMessage(st); }
  if (m.t === 'speed') speed = m.v;
  if (m.t === 'cmd' && st) { issue(st, m.cmd); postMessage(st); }
};

setInterval(() => {
  const now = performance.now();
  acc += ((now - last) / 1000) * speed;
  last = now;
  if (!st || st.ended) { acc = 0; return; }
  let stepped = false;
  while (acc >= 1 / TICK_HZ && !st.ended) { step(st); acc -= 1 / TICK_HZ; stepped = true; }
  if (stepped) postMessage(st);
}, 20);
