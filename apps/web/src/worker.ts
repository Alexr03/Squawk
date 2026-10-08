// Runs the sim off the main thread. In: init / cmd / speed / replay. Out: snapshots after each batch of ticks.
import { buildWorld, createShift, issue, replay, snapshot, step, TICK_HZ, type AirportPack, type Command, type ShiftConfig, type State, type World } from '@squawk/sim';

export type ToWorker =
  | { t: 'init'; packs: AirportPack[]; cfg: ShiftConfig }
  | { t: 'cmd'; id: number; cmds: Command[]; voice?: boolean; seat?: string }
  | { t: 'speed'; v: number }
  | { t: 'replay'; cfg: ShiftConfig; log: State['cmdLog']; from: number; to: number }
  | { t: 'stop' };
export type FromWorker =
  | { t: 'snap'; st: ReturnType<typeof snapshot> }
  | { t: 'cmd'; id: number; err: string | null }
  | { t: 'final'; st: State }
  | { t: 'error'; msg: string };

let world: World | null = null;
let cfg: ShiftConfig | null = null;
let st: State | null = null;
let speed = 1, acc = 0, last = performance.now();
let replayUntil = Infinity;
let replayCmds: State['cmdLog'] = [];

const post = (m: FromWorker) => postMessage(m);

onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  try {
    if (m.t === 'init') {
      world = buildWorld(m.packs); cfg = m.cfg;
      st = createShift(world, cfg); acc = 0; replayUntil = Infinity; replayCmds = [];
      post({ t: 'snap', st: snapshot(st) });
    } else if (m.t === 'speed') speed = m.v;
    else if (m.t === 'cmd' && world && st) {
      if (replayUntil !== Infinity) { post({ t: 'cmd', id: m.id, err: 'Replay: watching only' }); return; }
      const err = issue(world, st, m.cmds, { voice: m.voice, seat: m.seat });
      post({ t: 'cmd', id: m.id, err });
      post({ t: 'snap', st: snapshot(st) });
    } else if (m.t === 'replay' && world) {
      // Re-run the shift from its seed up to just before the moment, then play the recorded commands live.
      cfg = m.cfg;
      st = replay(world, m.cfg, m.log, m.from);
      replayCmds = m.log.filter(c => c.tick >= m.from);
      replayUntil = m.to;
      post({ t: 'snap', st: snapshot(st) });
    } else if (m.t === 'stop') { st = null; }
  } catch (err) {
    post({ t: 'error', msg: String((err as Error)?.stack ?? err) });
  }
};

setInterval(() => {
  const now = performance.now();
  acc += ((now - last) / 1000) * speed;
  last = now;
  if (!st || !world || !cfg || st.ended) { acc = 0; return; }
  let stepped = false, n = 0;
  while (acc >= 1 / TICK_HZ && !st.ended && n < 64) {
    if (replayUntil !== Infinity) {
      for (const c of replayCmds.filter(c => c.tick === st!.tick)) issue(world, st, c.cmds, { seat: c.seat, voice: c.voice });
      if (st.tick >= replayUntil) { acc = 0; break; }
    }
    step(world, cfg, st); acc -= 1 / TICK_HZ; stepped = true; n++;
  }
  if (n >= 64) acc = 0; // can't keep up: drop time rather than spiral
  if (stepped) post({ t: 'snap', st: snapshot(st) });
  if (st.ended && replayUntil === Infinity) post({ t: 'final', st });
}, 16);
