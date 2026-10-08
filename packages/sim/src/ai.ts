// AI controllers. They staff every seat the player leaves empty and use exactly the same commands as a human.
import { TYPES } from './aircraft.ts';
import { angleDiff, bearing, dist, NM, segDist } from './geo.ts';
import { aptOf, aptState, elevation, flowPenalty, lineupPath, lockedBy } from './physics.ts';
import { find, issue, nextSeats, routeStart, runwayFree, taxiTarget } from './pilot.ts';
import { DT, seatId, seatRole, type Aircraft, type State } from './state.ts';
import type { Command, Wake } from './types.ts';
import { lateral, pathLength, route, runwayAt, transition, type Apt, type World } from './world.ts';

// Departure spacing (s) by wake, [leader][follower], measured from the leader becoming airborne.
export const WAKE_DEP: Record<Wake, Partial<Record<Wake, number>>> = { J: { L: 180, M: 180, H: 120 }, H: { L: 120, M: 120 }, M: { L: 120 }, L: {} };
// Final approach spacing (nm), [leader][follower]. Minimum radar spacing on final is 3 nm (2.5 nm used at Heathrow in good conditions).
export const WAKE_APP: Record<Wake, Partial<Record<Wake, number>>> = { J: { L: 8, M: 7, H: 6, J: 4 }, H: { L: 6, M: 5, H: 4, J: 4 }, M: { L: 5 }, L: {} };
export const appSpacing = (lead: Wake, follow: Wake, lvp: boolean) => Math.max(lvp ? 6 : 2.5, WAKE_APP[lead][follow] ?? 0);

const human = (st: State, seat: string) => st.coverage.includes(seat);
const say = (world: World, st: State, ac: Aircraft, cmds: Command[]) => issue(world, st, ac.owner, cmds, { auto: true });

/** Seconds until departure separation (route + wake) behind the last departure from this end is met; Infinity while it's still rolling. */
export function depGap(world: World, st: State, ac: Aircraft): number {
  const as = aptState(st, ac.apt);
  const L = ac.runway ? as.lastDep[ac.runway] : undefined;
  if (!L || L.cs === ac.cs) return 0;
  if (L.at === null) return Infinity;
  const apt = aptOf(world, ac);
  const first = (id: string | null) => apt.pack.airspace.sids.find(s => s.name + s.designator === id)?.fixes[0];
  const sameRoute = !!L.sid && !!ac.sid && (L.sid.replace(/\d.*/, '') === ac.sid.replace(/\d.*/, '') || first(L.sid) === first(ac.sid));
  const need = Math.max(sameRoute ? 120 : 60, st.difficulty.wake ? WAKE_DEP[L.wake][ac.wake] ?? 0 : 0);
  return Math.max(0, need - (st.tick - L.at) * DT);
}

export function aiStep(world: World, st: State) {
  for (const ac of st.aircraft) {
    if (ac.phase === 'gone' || human(st, ac.owner) || ac.owner !== ac.freq) continue;
    if (ac.emergency?.code === '7600' && seatRole(ac.owner) !== 'TWR') continue;
    // Spread decisions out: each aircraft is looked at every ~2 s, pilots need a moment after each instruction.
    if ((st.tick + hash(ac.cs)) % 8 !== 0 || st.tick < ac.actAt) continue;
    switch (seatRole(ac.owner)) {
      case 'DEL': delivery(world, st, ac); break;
      case 'GND': ground(world, st, ac); break;
      case 'TWR': tower(world, st, ac); break;
      case 'DIR': director(world, st, ac); break;
      case 'LON': london(world, st, ac); break;
    }
  }
  if (st.tick % 8 === 3) for (const a of world.apts) sequence(world, st, a);
  if (st.tick % 8 === 5) resolveConflicts(world, st);
}

/** AI radar controllers act on predicted conflicts: level-off, a level change or a speed control for one of the pair. */
function resolveConflicts(world: World, st: State) {
  for (const key of Object.keys(st.stca)) {
    const [c1, c2] = key.split('|');
    const a = find(st, c1), b = find(st, c2);
    if (!a || !b || a.onGround || b.onGround) continue;
    // Who acts: an AI-controlled radar aircraft that isn't on final.
    const canAct = (x: Aircraft) => !human(st, x.owner) && x.owner === x.freq && x.checkedIn && st.tick >= x.actAt && !x.nav.established
      && (seatRole(x.owner) === 'LON' || seatRole(x.owner) === 'DIR') && x.emergency?.code !== '7600';
    const actors = [a, b].filter(canAct);
    if (!actors.length) continue;
    const other = (x: Aircraft) => (x === a ? b : a);
    // Prefer moving the one that is changing level, else the departure (climb) / the follower.
    actors.sort((x, y) => Math.abs(y.vs) - Math.abs(x.vs));
    const x = actors[0], o = other(x);
    const lvl = Math.round(x.alt / 1000) * 1000;
    if (Math.abs(x.vs) > 300) {
      // Stop the climb/descent at a level clear of the other aircraft.
      const stop = x.vs > 0 ? Math.max(Math.ceil((x.alt + 100) / 1000) * 1000, 0) : Math.floor((x.alt - 100) / 1000) * 1000;
      const safe = Math.abs(stop - o.alt) >= 1000 ? stop : x.vs > 0 ? Math.floor((o.alt - 1000) / 1000) * 1000 : Math.ceil((o.alt + 1000) / 1000) * 1000;
      if (safe !== x.tgtAlt && safe >= 3000) say(world, st, x, [{ cs: x.cs, verb: 'alt', alt: safe }]);
    } else {
      // Level and converging: a level change away from the other, plus slow the follower.
      const up = x.kind === 'dep' || x.alt >= o.alt;
      const nl = up ? lvl + 1000 : lvl - 1000;
      const cmds: Command[] = [];
      if (nl >= 4000 && nl <= 30000 && !st.aircraft.some(z => z !== x && !z.onGround && dist(z, x) < 8 * NM && Math.abs(z.alt - nl) < 1000)) cmds.push({ cs: x.cs, verb: 'alt', alt: nl });
      if (x.ias > 210 && (x.tgtSpd === null || x.tgtSpd > 210)) cmds.push({ cs: x.cs, verb: 'speed', kt: x.kind === 'dep' ? 250 : 210 });
      if (cmds.length) say(world, st, x, cmds);
    }
  }
}

function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

function handTo(world: World, st: State, ac: Aircraft) {
  const next = nextSeats(ac)[0];
  if (next) say(world, st, ac, [{ cs: ac.cs, verb: 'contact', seat: next }]);
}

// ------------------------------------------------------------------ Delivery

function delivery(world: World, st: State, ac: Aircraft) {
  if (ac.phase !== 'stand' || ac.cleared.dl) return;
  // Hold clearances back when the runway queue is already long (departure flow management).
  const queued = st.aircraft.filter(o => o.apt === ac.apt && o.kind === 'dep' && ['pushed', 'taxi', 'holding'].includes(o.phase)).length;
  if (queued > 14) return;
  if ((st.tick - ac.spawnedAt) * DT < 20) return;
  say(world, st, ac, [{ cs: ac.cs, verb: 'clearance', sid: ac.sid ?? '', alt: 0, squawk: '' }]);
}

// ------------------------------------------------------------------ Ground

function ground(world: World, st: State, ac: Aircraft) {
  const apt = aptOf(world, ac);
  if (ac.kind === 'dep') {
    if (ac.phase === 'stand' && ac.cleared.dl && !ac.cleared.push && ac.checkedIn) {
      if (pushPathClear(world, st, ac)) say(world, st, ac, [{ cs: ac.cs, verb: 'push' }]);
      return;
    }
    if (ac.phase === 'pushed' && !ac.cleared.taxi) { taxiOut(world, st, ac); return; }
    if (ac.phase === 'taxi') {
      if (remaining(apt, ac) < 450 || ac.pi >= ac.path.length) { handTo(world, st, ac); return; }
      if (atRunwayEntry(world, ac)) { handTo(world, st, ac); return; } // crossings are Tower's
      unjam(world, st, ac);
    }
    if (ac.phase === 'holding') handTo(world, st, ac);
  } else {
    if ((ac.phase === 'taxiin' || ac.phase === 'vacating') && !ac.cleared.taxi && ac.checkedIn) {
      const to = ac.stand ?? '';
      if (to) {
        const night = isDark(st) || st.weather.lvp;
        say(world, st, ac, [night ? { cs: ac.cs, verb: 'greens', to } : { cs: ac.cs, verb: 'taxi', to, via: [] }]);
      }
      return;
    }
    if (ac.phase === 'taxiin') {
      if (atRunwayEntry(world, ac)) { handTo2(world, st, ac, 'TWR'); return; }
      unjam(world, st, ac);
    }
  }
}
function handTo2(world: World, st: State, ac: Aircraft, seat: 'TWR') {
  // Crossing: Ground passes the aircraft to Tower, who hands it back once across.
  if (human(st, seatId(ac.apt, 'TWR'))) { issue(world, st, ac.owner, [{ cs: ac.cs, verb: 'contact', seat }], { auto: true }); return; }
  const rw = entryRunway(world, ac);
  if (rw && runwayFree(world, st, ac.apt, rw, 60, ac)) say(world, st, ac, [{ cs: ac.cs, verb: 'cross', runway: rw }]);
}

export const isDark = (st: State) => {
  const h = new Date((st.start + st.tick * DT) * 1000).getUTCHours();
  return h >= 20 || h < 6;
};

function taxiOut(world: World, st: State, ac: Aircraft) {
  const apt = aptOf(world, ac);
  const as = aptState(st, ac.apt);
  const end = as.dep.includes(ac.runway!) ? ac.runway! : as.dep[0];
  // Spread departures over the runway's holding points so the tower can re-order them.
  const holds = (st.weather.lvp ? apt.ends[end]?.holds : apt.ends[end]?.front) ?? [];
  const busy = (h: number) => st.aircraft.filter(o => o.kind === 'dep' && o.path[o.path.length - 1] === h && ['taxi', 'holding'].includes(o.phase)).length;
  // Nearest holding point on our side of the runway (no crossing), among those near the full length.
  const start = routeStart(world, ac);
  let best: number | undefined, bestCost = Infinity;
  for (const h of holds.slice(0, 5)) {
    const r = route(apt, start, h, { penalty: flowPenalty(st, apt, ac) });
    if (!r) continue;
    const crosses = r.some((n, i) => i > 0 && apt.onRunway.has(n));
    const cost = pathLength(apt, r) + (crosses ? 20000 : 0) + busy(h) * 250 + holds.indexOf(h) * 150;
    if (cost < bestCost) { bestCost = cost; best = h; }
  }
  const to = best !== undefined ? apt.nodes[best].hold ?? end : end;
  if (taxiTarget(world, ac, to) === null) return;
  say(world, st, ac, [{ cs: ac.cs, verb: 'taxi', to, via: [] }]);
}

function remaining(apt: Apt, ac: Aircraft) {
  return pathLength(apt, [Math.max(0, ac.pi - 1), ...ac.path.slice(ac.pi)].length > 1 ? ac.path.slice(Math.max(0, ac.pi - 1)) : []);
}
function pushPathClear(world: World, st: State, ac: Aircraft) {
  const apt = aptOf(world, ac);
  const pn = apt.nodes[apt.standByRef[ac.stand!].pushNode];
  return !st.aircraft.some(o => o !== ac && o.apt === ac.apt && o.onGround && o.gs > 1 && dist(o, pn) < 130)
    && !st.aircraft.some(o => o !== ac && o.phase === 'pushing' && dist(o, pn) < 90);
}
function entryRunway(world: World, ac: Aircraft): string | null {
  const apt = aptOf(world, ac);
  for (let j = ac.pi; j < Math.min(ac.path.length - 1, ac.pi + 4); j++) {
    const rw = apt.onRunway.get(ac.path[j + 1]);
    if (rw && !apt.onRunway.has(ac.path[j])) return rw;
  }
  return null;
}
function atRunwayEntry(world: World, ac: Aircraft) {
  const rw = entryRunway(world, ac);
  return !!rw && !ac.cleared.cross.includes(rw) && ac.gs < 1;
}
/** Two aircraft nose to nose: re-route one of them away from the other. */
function unjam(world: World, st: State, ac: Aircraft) {
  if (ac.stoppedS < 25 || !ac.blockedBy) return;
  // Long stall behind anyone (AI only): pass through.
  const blk = find(st, ac.blockedBy);
  if (ac.stoppedS > 150 && blk && !human(st, blk.owner) && !ac.ghost) { ac.ghost = blk.cs; ac.stoppedS = 0; return; }
  // Follow the chain of who-is-waiting-for-whom; act only if it loops back (a real deadlock).
  const chain: Aircraft[] = [ac];
  let cur: Aircraft | undefined = ac;
  while (cur?.blockedBy && chain.length < 8) { cur = find(st, cur.blockedBy); if (!cur || chain.includes(cur)) break; chain.push(cur); }
  if (!cur || !chain.includes(cur)) return;
  const loop = chain.slice(chain.indexOf(cur));
  if (!loop.includes(ac)) return;
  // The first member (in a fixed order) that can actually get out of the way does so: a detour, else a tow.
  const cands = loop.filter(x => !human(st, x.owner) && (x.phase === 'taxi' || x.phase === 'taxiin')).sort((x, y) => hash(x.cs) - hash(y.cs));
  // Backstop: an AI-only deadlock that has lasted 90 s is broken by letting one aircraft pass through.
  if (ac.stoppedS > 45 && cands[0] === ac && loop.every(x => !human(st, x.owner))) {
    ac.ghost = ac.blockedBy; ac.stoppedS = 0;
    return;
  }
  for (const x of cands) {
    const o = find(st, x.blockedBy!) ?? loop[(loop.indexOf(x) + 1) % loop.length];
    const plan = planUnjam(world, st, x, o);
    if (!plan) continue;
    if (x !== ac) return; // someone else will move on their own turn
    const apt = aptOf(world, ac);
    const goal = ac.path[ac.path.length - 1];
    const to = apt.nodes[goal].hold ?? apt.nodes[goal].stand ?? (ac.kind === 'dep' ? ac.runway! : ac.stand!);
    ac.stoppedS = 0;
    say(world, st, ac, [{ cs: ac.cs, verb: 'taxi', to, via: [] }]);
    // Use the detour, not the default shortest route.
    const p = st.pending[st.pending.length - 1];
    if (p?.apply?.[0]?.verb === 'taxi') (p.apply[0] as Extract<Command, { verb: 'taxi' }>).nodes = plan.path;
    return;
  }
}

/** A way out of a deadlock for x: a route that keeps clear of o. */
export function planUnjam(world: World, st: State, x: Aircraft, o: Aircraft): { path: number[] } | null {
  const apt = aptOf(world, x);
  const goal = x.path[x.path.length - 1];
  const fp = flowPenalty(st, apt, x);
  const avoid = (e: number, a: number, b: number) => segDist(o, apt.nodes[a], apt.nodes[b]).d < 90 ? 50000 : fp(e, a, b);
  const back = x.path[Math.max(0, x.pi - 1)] ?? routeStart(world, x);
  const r = route(apt, back, goal, { penalty: avoid });
  if (r && r.length > 1 && !r.some((n, i) => i > 0 && segDist(o, apt.nodes[r[i - 1]], apt.nodes[n]).d < 70)) return { path: r };
  return null;
}

// ------------------------------------------------------------------ Tower

function tower(world: World, st: State, ac: Aircraft) {
  const apt = aptOf(world, ac);
  const elev = elevation(apt);
  if (ac.kind === 'arr') {
    if (ac.phase === 'final' && !ac.cleared.land && ac.checkedIn) {
      const end = apt.ends[ac.runway!];
      const toThr = dist(ac, end.thr) / NM;
      const occupied = st.aircraft.some(o => o !== ac && o.onGround && runwayAt(apt, o) === end.runway && o.phase !== 'holding');
      if (!occupied && !st.aircraft.some(o => o.runway && apt.ends[o.runway]?.runway === end.runway && ['lineup', 'lined', 'takeoff'].includes(o.phase))) {
        if (toThr < 6) say(world, st, ac, [{ cs: ac.cs, verb: 'land', runway: ac.runway! }]);
      } else if (toThr < 0.9) say(world, st, ac, [{ cs: ac.cs, verb: 'goaround' }]);
      return;
    }
    if (ac.phase === 'taxiin' && !runwayAt(apt, ac)) {
      if (!entryRunwayPending(world, ac)) { handTo(world, st, ac); return; }
    }
    if (ac.phase === 'taxiin' || ac.phase === 'vacating') { crossings(world, st, ac); unjam(world, st, ac); }
    if (ac.phase === 'goaround' && ac.alt > elev + 1500) say(world, st, ac, [{ cs: ac.cs, verb: 'contact', seat: 'DIR' }]);
    return;
  }
  if (ac.phase === 'taxi') { crossings(world, st, ac); unjam(world, st, ac); return; }
  if (ac.phase === 'holding' && ac.checkedIn && !ac.cleared.luw && !ac.cleared.cto) { departures(world, st, ac); return; }
  if (ac.phase === 'lined' && ac.cleared.luw && !ac.cleared.cto) {
    const end = apt.ends[ac.runway!];
    const busy = st.aircraft.some(o => o !== ac && ((o.runway && apt.ends[o.runway]?.runway === end.runway && (o.phase === 'takeoff' || o.phase === 'landing')) || (o.onGround && o.phase !== 'holding' && runwayAt(apt, o) === end.runway)));
    const landingSoon = st.aircraft.some(o => o.kind === 'arr' && o.runway && apt.ends[o.runway]?.runway === end.runway && o.nav.established && dist(o, apt.ends[o.runway].thr) < 3 * NM);
    if (!busy && !landingSoon && depGap(world, st, ac) === 0) say(world, st, ac, [{ cs: ac.cs, verb: 'cto', runway: ac.runway! }]);
    return;
  }
  if (ac.phase === 'climb' && ac.alt > elev + 1300) handTo(world, st, ac);
}

/** Would this aircraft's line-up route run through someone else waiting at another holding point? */
export function lineupBlocked(world: World, st: State, ac: Aircraft): boolean {
  const apt = aptOf(world, ac);
  const path = lineupPath(apt, ac);
  return path.slice(1).some(n => { const l = lockedBy(st, ac.apt, n); return l && l !== ac.cs; })
    || st.aircraft.some(o => o !== ac && o.onGround && o.apt === ac.apt && (o.phase === 'holding' || o.phase === 'taxi') && path.slice(1).some(n => dist(apt.nodes[n], o) < 35));
}
function entryRunwayPending(world: World, ac: Aircraft) { return !!entryRunway(world, ac); }

function crossings(world: World, st: State, ac: Aircraft) {
  const rw = entryRunway(world, ac);
  if (rw && !ac.cleared.cross.includes(rw) && ac.gs < 3 && runwayFree(world, st, ac.apt, rw, 75, ac))
    say(world, st, ac, [{ cs: ac.cs, verb: 'cross', runway: rw }]);
  // Once across, back to Ground.
  if (!rw && ac.cleared.cross.length && !runwayAt(aptOf(world, ac), ac) && ac.kind === 'dep' && ac.phase === 'taxi') {
    // departures stay with Tower (they're heading for the holding point)
  }
}

/** Pick which waiting departure lines up next: the one that wastes the least runway time. */
function departures(world: World, st: State, ac: Aircraft) {
  const apt = aptOf(world, ac);
  const end = apt.ends[ac.runway!];
  // Crossing traffic that has been waiting gets the next gap.
  const crossers = st.aircraft.some(o => o.apt === ac.apt && o.onGround && o.stoppedS > 30 && !o.blockedBy && (o.phase === 'taxi' || o.phase === 'taxiin') && entryRunway(world, o) === end.runway);
  if (crossers) return;
  const onRunway = st.aircraft.some(o => o !== ac && o.runway && apt.ends[o.runway]?.runway === end.runway && (o.phase === 'lineup' || o.phase === 'lined' || (o.phase === 'holding' && (o.cleared.luw || o.cleared.cto))))
    || st.pending.some(p => p.cs !== ac.cs && p.apply?.some(c => c.verb === 'luw' || c.verb === 'cto'));
  if (onRunway) return;
  const rolling = st.aircraft.find(o => o.runway === ac.runway && o.phase === 'takeoff');
  if (rolling && rolling.ias < 60) return;
  const waiting = st.aircraft.filter(o => o.apt === ac.apt && o.phase === 'holding' && o.runway === ac.runway && o.checkedIn && seatRole(o.owner) === 'TWR' && !human(st, o.owner) && !lineupBlocked(world, st, o));
  let best = ac, bestScore = Infinity;
  for (const w of waiting) {
    const gap = depGap(world, st, w);
    const score = (gap === Infinity ? 90 : gap) - (st.tick - w.spawnedAt) * DT * 0.02 - (w.emergency ? 1000 : 0);
    if (score < bestScore) { bestScore = score; best = w; }
  }
  if (best === ac) say(world, st, ac, [{ cs: ac.cs, verb: 'luw', runway: ac.runway! }]);
}

// ------------------------------------------------------------------ Director (approach)


function director(world: World, st: State, ac: Aircraft) {
  const apt = aptOf(world, ac);
  if (ac.kind !== 'arr') { handTo(world, st, ac); return; }
  const end = apt.ends[ac.runway!];
  if (ac.nav.established) {
    const toThr = dist(ac, end.thr) / NM;
    spacingOnFinal(world, st, ac);
    if (toThr < 11) handTo(world, st, ac);
    return;
  }
  const plan = ac.vectors;
  if (!plan) return; // waiting in the stack for a slot (see sequence())
  const target = plan.pts[plan.i];
  if (!target) return;
  const d = dist(ac, target);
  const isLast = plan.i === plan.pts.length - 1;
  // Reached the point, or flown past it (abeam and opening).
  const passed = d < 4 * NM && Math.abs(angleDiff(ac.trk, bearing(ac, target))) > 100;
  if (d < (isLast ? 1.2 : 1.8) * NM || passed) {
    plan.i++;
    if (isLast) {
      // Intercept: 30° onto the localiser, cleared ILS.
      const side = Math.sign(lateral(end, ac)) || 1; // right of course -> turn left onto it
      say(world, st, ac, [{ cs: ac.cs, verb: 'heading', hdg: Math.round(norm(end.hdgTrue - side * 30)) || 360 }, { cs: ac.cs, verb: 'ils', runway: ac.runway! }]);
    } else {
      const next = plan.pts[plan.i];
      say(world, st, ac, [{ cs: ac.cs, verb: 'heading', hdg: Math.round(norm(bearing(ac, next))) || 360 }, ...(plan.i === plan.pts.length - 1 ? [{ cs: ac.cs, verb: 'alt' as const, alt: 4000 }, { cs: ac.cs, verb: 'speed' as const, kt: 180 }] : [])]);
    }
  } else if (Math.abs(angleDiff(ac.tgtHdg ?? ac.hdg, bearing(ac, target))) > 12 && ac.nav.mode === 'hdg' && d > 3 * NM) {
    say(world, st, ac, [{ cs: ac.cs, verb: 'heading', hdg: Math.round(norm(bearing(ac, target))) || 360 }]);
  }
}
const norm = (h: number) => ((h % 360) + 360) % 360;

/** Keep established arrivals spaced: slow the follower early, break it off if it gets too close. */
function spacingOnFinal(world: World, st: State, ac: Aircraft) {
  const apt = aptOf(world, ac);
  const end = apt.ends[ac.runway!];
  const mine = dist(ac, end.thr);
  let lead: Aircraft | null = null, ld = 0;
  for (const o of st.aircraft) {
    if (o === ac || o.kind !== 'arr' || o.runway !== ac.runway || o.onGround || !o.nav.established) continue;
    const d = dist(o, end.thr);
    if (d < mine && d > ld) { ld = d; lead = o; }
  }
  if (!lead) return;
  const gap = (mine - ld) / NM;
  const need = appSpacing(lead.wake, ac.wake, st.weather.lvp);
  if (gap < need - 0.6 && mine > 5 * NM && !human(st, ac.owner)) {
    // Too tight: take it off the approach and resequence.
    say(world, st, ac, [{ cs: ac.cs, verb: 'heading', hdg: Math.round(norm(end.hdgTrue + 40)) || 360 }, { cs: ac.cs, verb: 'alt', alt: 4000 }]);
    ac.vectors = null;
    return;
  }
  const t = TYPES[ac.type];
  if (gap < need + 0.4 && (ac.tgtSpd === null || ac.tgtSpd > t.vapp + 10) && mine > 5 * NM) say(world, st, ac, [{ cs: ac.cs, verb: 'speed', kt: Math.max(t.vapp + 10, 160) }]);
}

/** AI Director: release arrivals from the stacks so they land at the required spacing. */
function sequence(world: World, st: State, apt: Apt) {
  const dirSeat = seatId(apt.icao, 'DIR');
  if (human(st, dirSeat)) return;
  const as = aptState(st, apt.icao);
  for (const endName of as.arr) {
    const end = apt.ends[endName];
    if (!end) continue;
    // When will the last released aircraft land?
    const released = st.aircraft.filter(a => a.apt === apt.icao && a.kind === 'arr' && a.runway === endName && !a.onGround && (a.vectors || a.nav.established || a.phase === 'final' || a.phase === 'goaround' && a.owner !== dirSeat));
    let lastEta = st.tick * DT, lastWake: Wake = 'M';
    for (const a of released) { const eta = etaToThreshold(world, st, a); if (eta > lastEta) { lastEta = eta; lastWake = a.wake; } }
    const candidates = st.aircraft.filter(a => a.apt === apt.icao && a.kind === 'arr' && a.owner === dirSeat && a.checkedIn && !a.vectors && !a.nav.established && !a.onGround
      && (a.phase === 'stack' || a.phase === 'goaround' || a.phase === 'approach' || (a.phase === 'arrival' && a.stack && dist(a, apt.fixes[a.stack]) < 12 * NM)) && a.runway === endName);
    if (!candidates.length) continue;
    // Emergencies first, then go-arounds, then whoever has waited longest.
    candidates.sort((a, b) => (b.emergency ? 1 : 0) - (a.emergency ? 1 : 0) || (b.phase === 'goaround' ? 1 : 0) - (a.phase === 'goaround' ? 1 : 0) || a.spawnedAt - b.spawnedAt);
    const lowestInStack = (a: Aircraft) => a.phase !== 'stack' || !candidates.some(o => o !== a && o.phase === 'stack' && o.stack === a.stack && o.alt < a.alt - 200);
    // Of those free to leave, priority first, then the one that costs the least wake spacing, then whoever waited longest.
    const free = candidates.filter(lowestInStack);
    const prio = (a: Aircraft) => (a.emergency ? -1e6 : 0) + (a.phase === 'goaround' ? -1e5 : 0) + appSpacing(lastWake, a.wake, st.weather.lvp) * 120 - (st.tick - a.spawnedAt) * DT * 0.15;
    free.sort((x, y) => prio(x) - prio(y));
    const next = free[0];
    if (!next) continue;
    const pts = transition(apt, next.phase === 'stack' || next.phase === 'arrival' ? apt.fixes[next.stack!] : next, end);
    const eta = st.tick * DT + pathTime(next, pts, end);
    const need = appSpacing(lastWake, next.wake, st.weather.lvp) + 0.45;
    const gapS = need * NM / (140 * NM / 3600);
    if (eta >= lastEta + gapS || next.emergency) {
      next.vectors = { pts, i: 0 };
      const first = pts[0];
      const cmds: Command[] = [{ cs: next.cs, verb: 'heading', hdg: Math.round(norm(bearing(next, first))) || 360 }, { cs: next.cs, verb: 'alt', alt: next.alt > 6000 ? 6000 : 5000 }, { cs: next.cs, verb: 'speed', kt: 220 }];
      issue(world, st, dirSeat, cmds, { auto: true });
      removeFromStack(st, as, next.cs);
    }
  }
  // Stack levels: everyone holding descends as the bottom empties.
  for (const a of st.aircraft) {
    if (a.apt !== apt.icao || a.owner !== dirSeat || !a.checkedIn || a.vectors || a.nav.established || (a.phase !== 'stack' && a.phase !== 'arrival') || st.tick < a.actAt) continue;
    const lvl = stackLevel(world, st, a);
    if (lvl !== null && a.tgtAlt !== lvl && (lvl < a.tgtAlt || a.phase === 'arrival') && !levelBlockedDown(st, a, lvl)) issue(world, st, dirSeat, [{ cs: a.cs, verb: 'alt', alt: lvl }], { auto: true });
  }
}

/** Level in its stack: rank among everyone bound for the same stack (holding aircraft by height, then inbound by distance). */
export function stackLevel(world: World, st: State, ac: Aircraft): number | null {
  const apt = aptOf(world, ac);
  const sk = apt.pack.airspace.stacks.find(s => s.name === ac.stack);
  if (!sk) return null;
  const fix = apt.fixes[sk.fix];
  const key = (a: Aircraft) => a.phase === 'stack' ? a.alt / 1e6 : 1 + dist(a, fix) / NM;
  const group = st.aircraft.filter(a => a.apt === ac.apt && a.stack === ac.stack && a.kind === 'arr' && !a.onGround && !a.vectors && !a.nav.established && (a.phase === 'stack' || a.phase === 'arrival'));
  group.sort((a, b) => key(a) - key(b));
  return sk.minAltFt + Math.max(0, group.indexOf(ac)) * 1000;
}
function removeFromStack(st: State, as: ReturnType<typeof aptState>, cs: string) { for (const k of Object.keys(as.stack)) as.stack[k] = as.stack[k].filter(c => c !== cs); void st; }

function pathTime(ac: Aircraft, pts: { x: number; y: number }[], end: ReturnType<typeof aptOf>['ends'][string]) {
  // Vectors at ~210 kt ground speed, then the final from the intercept at ~160 kt.
  let d = 0, prev: { x: number; y: number } = ac;
  for (const p of pts) { d += dist(prev, p); prev = p; }
  const fin = dist(prev, end.thr);
  return d / (210 * NM / 3600) + fin / (155 * NM / 3600) + 25;
}
export function etaToThreshold(world: World, st: State, a: Aircraft): number {
  const apt = aptOf(world, a), end = apt.ends[a.runway!];
  if (a.nav.established) return st.tick * DT + dist(a, end.thr) / (Math.max(130, a.gs) * NM / 3600);
  if (a.vectors) return st.tick * DT + pathTime(a, a.vectors.pts.slice(a.vectors.i), end);
  return st.tick * DT + dist(a, end.thr) / (180 * NM / 3600) + 300;
}

// ------------------------------------------------------------------ London Control

function london(world: World, st: State, ac: Aircraft) {
  const apt = aptOf(world, ac);
  if (!ac.checkedIn) return;
  if (ac.kind === 'dep') {
    if (ac.tgtAlt < 15000 && ac.alt > 4500) {
      const lvl = ac.tgtAlt < 9000 ? 15000 : 23000;
      if (!levelBlocked(st, ac, lvl)) say(world, st, ac, [{ cs: ac.cs, verb: 'alt', alt: lvl }]);
    } else if (ac.tgtAlt === 15000 && ac.alt > 14000 && dist(ac, apt.offset) > 25 * NM) say(world, st, ac, [{ cs: ac.cs, verb: 'alt', alt: 25000 }]);
    return;
  }
  // Arrivals: down to the stack, then over to Director.
  const sk = apt.fixes[ac.stack!];
  const d = dist(ac, sk) / NM;
  const lvl = Math.max(stackLevel(world, st, ac) ?? 9000, 8000);
  if (d < 45 && ac.tgtAlt > lvl && !levelBlockedDown(st, ac, lvl)) say(world, st, ac, [{ cs: ac.cs, verb: 'alt', alt: lvl }]);
  else if (d < 75 && ac.tgtAlt > 15000 && !levelBlockedDown(st, ac, 15000)) say(world, st, ac, [{ cs: ac.cs, verb: 'alt', alt: 15000 }]);
  if (d < 22 && ac.alt < 16000) handTo(world, st, ac);
}
function levelBlockedDown(st: State, ac: Aircraft, lvl: number) {
  // Anyone below us (down to the new level) within 8 nm, or anyone at the new level within 10 nm.
  return st.aircraft.some(o => o !== ac && !o.onGround && ((dist(o, ac) < 8 * NM && o.alt < ac.alt - 200 && o.alt > lvl - 900) || (dist(o, ac) < 10 * NM && Math.abs(Math.max(o.alt, o.tgtAlt) - lvl) < 900)));
}
function levelBlocked(st: State, ac: Aircraft, lvl: number) {
  return st.aircraft.some(o => o !== ac && !o.onGround && o.kind === 'arr' && dist(o, ac) < 12 * NM && o.alt > ac.alt - 500 && o.alt < lvl + 1000);
}



