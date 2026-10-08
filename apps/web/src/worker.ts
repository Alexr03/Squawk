// Runs the sim off the main thread. In: init / resume / cmd / speed / replay / full. Out: snapshots after each batch of ticks.
import { crash, declareEmergency, buildWorld, createShift, issue, replay, snapshot, step, TICK_HZ, type AirportPack, type Command, type Nature, type ShiftConfig, type State, type World } from '@squawk/sim';

export type ToWorker =
  | { t: 'init'; packs: AirportPack[]; cfg: ShiftConfig }
  | { t: 'resume'; packs: AirportPack[]; cfg: ShiftConfig; st: State }
  | { t: 'full' }
  | { t: 'cmd'; id: number; cmds: Command[]; voice?: boolean; seat?: string }
  | { t: 'speed'; v: number }
  | { t: 'replay'; cfg: ShiftConfig; log: State['cmdLog']; from: number; to: number }
  | { t: 'stop' }
  | { t: 'debug'; what: DebugWhat; cs?: string; nature?: Nature | 'radio' }; // the dev panel: stage an incident to look at
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
    else if (m.t === 'debug' && world && st) { debug(world, st, m.what, m.cs, m.nature); post({ t: 'snap', st: snapshot(st) }); }
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

export type DebugWhat = 'crash' | 'midair' | 'emergency';

/** The dev panel: stage a crash on the ground, a mid-air collision or an emergency. Uses the given aircraft where it can.
 *  A shift that used it is marked, and is kept off the leaderboard. */
function debug(world: World, st: State, what: DebugWhat, cs?: string, nature?: Nature | 'radio') {
  const apt = world.primary;
  st.debugUsed = true;
  const say = (why: string) => { st.alerts.push({ tick: st.tick, level: 'caution', text: `Dev panel: ${why}` }); };
  const pick = cs ? st.aircraft.find(a => a.cs === cs && a.phase !== 'gone') : undefined;
  const nearest = (to: { x: number; y: number }, ok: (a: (typeof st.aircraft)[number]) => boolean) =>
    st.aircraft.filter(a => a !== pick && a.phase !== 'gone' && a.phase !== 'wreck' && ok(a)).sort((a, b) => Math.hypot(a.x - to.x, a.y - to.y) - Math.hypot(b.x - to.x, b.y - to.y))[0];
  if (what === 'crash') {
    // Two aircraft meet on the ground: at the selected one, or on the departure runway.
    let a = pick && pick.onGround ? pick : undefined;
    const end = apt.ends[st.apts[0].dep[0]];
    const p = a ? { x: a.x, y: a.y } : { x: end.thr.x + end.ux * 700, y: end.thr.y + end.uy * 700 };
    a ??= nearest(p, x => x.onGround) ?? nearest(p, () => true);
    const b = a && nearest(p, x => x !== a && x.onGround) || a && nearest(p, x => x !== a);
    if (!a || !b) return say('a ground collision needs two aircraft');
    Object.assign(a, { x: p.x, y: p.y, onGround: true, alt: elevationOf(apt) }); Object.assign(b, { x: p.x + 18, y: p.y + 6, onGround: true, alt: elevationOf(apt) });
    crash(world, st, a, b, false);
  } else if (what === 'midair') {
    const a = pick && !pick.onGround ? pick : st.aircraft.find(x => !x.onGround && x.phase !== 'gone');
    const b = a && nearest(a, x => x !== a && !x.onGround);
    if (!a || !b) return say('a mid-air collision needs two aircraft in the air');
    Object.assign(b, { x: a.x + 30, y: a.y, alt: a.alt });
    crash(world, st, a, b, true);
  } else {
    const a = pick && !pick.emergency ? pick : st.aircraft.find(x => x.kind === 'arr' && !x.onGround && !x.emergency && (x.phase === 'final' || x.nav.established)) ?? st.aircraft.find(x => !x.onGround && !x.emergency);
    if (!a) return say('no aircraft in the air for an emergency');
    if (nature === 'radio') declareEmergency(world, st, a, '7600');
    else declareEmergency(world, st, a, '7700', nature ?? 'engine');
  }
}
const elevationOf = (apt: World['primary']) => apt.pack.runways[0]?.ends[0].elevationFt ?? 0;
