// Runs the sim off the main thread. In: init / resume / cmd / speed / replay / full. Out: snapshots after each batch of ticks.
import { crash, declareEmergency, buildWorld, createShift, issue, replay, snapshot, step, TICK_HZ, type AirportPack, type Command, type ShiftConfig, type State, type World } from '@squawk/sim';

export type ToWorker =
  | { t: 'init'; packs: AirportPack[]; cfg: ShiftConfig }
  | { t: 'resume'; packs: AirportPack[]; cfg: ShiftConfig; st: State }
  | { t: 'full' }
  | { t: 'cmd'; id: number; cmds: Command[]; voice?: boolean; seat?: string }
  | { t: 'speed'; v: number }
  | { t: 'replay'; cfg: ShiftConfig; log: State['cmdLog']; from: number; to: number }
  | { t: 'stop' }
  | { t: 'debug'; what: 'crash' | 'emergency' }; // development builds only: stage an incident to look at
export type FromWorker =
  | { t: 'snap'; st: ReturnType<typeof snapshot> }
  | { t: 'cmd'; id: number; err: string | null }
  | { t: 'final'; st: State }
  | { t: 'full'; st: State }
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
    } else if (m.t === 'resume') {
      // Co-op host takeover: carry on from another host's full state.
      world = buildWorld(m.packs); cfg = m.cfg;
      st = m.st; acc = 0; replayUntil = Infinity; replayCmds = [];
      post({ t: 'snap', st: snapshot(st) });
    } else if (m.t === 'full' && st) post({ t: 'full', st });
    else if (m.t === 'speed') speed = m.v;
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
    else if (m.t === 'debug' && import.meta.env.DEV && world && st) { debug(world, st, m.what); post({ t: 'snap', st: snapshot(st) }); }
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

/** Development only: put two departures together on the first departure runway and crash them, or give an arrival on
 *  final an engine failure (it will stop on the runway after landing). */
function debug(world: World, st: State, what: 'crash' | 'emergency') {
  const apt = world.primary;
  if (what === 'crash') {
    const deps = [...st.aircraft].sort((x, y) => (y.onGround ? 1 : 0) - (x.onGround ? 1 : 0)).slice(0, 2);
    if (deps.length < 2) return;
    const end = apt.ends[st.apts[0].dep[0]], p = { x: end.thr.x + end.ux * 700, y: end.thr.y + end.uy * 700 };
    for (const [k, a] of deps.entries()) Object.assign(a, { x: p.x + k * 18, y: p.y + k * 6, onGround: true, alt: 0 });
    crash(world, st, deps[0], deps[1], false);
  } else {
    const ac = st.aircraft.find(a => a.kind === 'arr' && !a.onGround && !a.emergency && (a.phase === 'final' || a.nav.established)) ?? st.aircraft.find(a => a.kind === 'arr' && !a.onGround && !a.emergency);
    if (ac) declareEmergency(world, st, ac, '7700', 'engine');
  }
}
