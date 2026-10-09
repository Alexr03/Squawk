// Aircraft movement: ground (pushback, taxi, line-up, take-off roll, rollout, exits) and air (turns, climb, wind, nav, ILS).
import { TYPES } from './aircraft.ts';
import { angleDiff, bearing, dist, holdShape, KT, NM, norm360, segDist, tas, turnRate, windKtAt } from './geo.ts';
import { DT, rand, ticks, type Aircraft, type State } from './state.ts';
import { along, glidepath, lateral, pointOnEnd, route, routeToRunway, runwayAt, type Apt, type EndInfo, type World } from './world.ts';
import { emergencyStop } from './incidents.ts';

const MS = (kt: number) => kt * KT;

// ------------------------------------------------------------------ helpers

export function aptOf(world: World, ac: Aircraft) { return world.byIcao[ac.apt]; }
export function aptState(st: State, icao: string) { return st.apts.find(a => a.icao === icao)!; }
export const elevation = (apt: Apt) => apt.pack.elevationFt;

/** Wind vector (m/s, toward) at an altitude. */
export function windAt(st: State, alt: number) {
  const w = st.weather.wind;
  const kt = windKtAt(w.kt, alt);
  const from = w.dir + Math.min(30, alt / 1000 * 2);
  const to = (from + 180) * Math.PI / 180;
  return { x: Math.sin(to) * MS(kt), y: Math.cos(to) * MS(kt) };
}
/** Headwind component (kt) for a runway heading. */
export function headwind(st: State, hdg: number) { return st.weather.wind.kt * Math.cos((st.weather.wind.dir - hdg) * Math.PI / 180); }

interface Exit { node: number; out: number; s: number; angle: number }
const exitCache = new WeakMap<Apt, Record<string, Exit[]>>();
export function exitsFor(apt: Apt, end: EndInfo): Exit[] {
  let c = exitCache.get(apt);
  if (!c) exitCache.set(apt, (c = {}));
  if (c[end.name]) return c[end.name];
  const out: Exit[] = [];
  const rdir = bearing(end.end, pointOnEnd(end, 1000));
  for (const [n, rw] of apt.onRunway) {
    if (rw !== end.runway) continue;
    for (const { to, edge } of apt.adj[n]) {
      if (apt.edges[edge].runway || apt.onRunway.get(to) === rw) continue;
      const ang = Math.abs(angleDiff(rdir, bearing(apt.nodes[n], apt.nodes[to])));
      if (ang <= 100) out.push({ node: n, out: to, s: along(end, apt.nodes[n]), angle: ang });
    }
  }
  out.sort((a, b) => a.s - b.s);
  return (c[end.name] = out);
}

// ------------------------------------------------------------------ ground

const GROUND_PHASES = new Set(['pushing', 'taxi', 'taxiin', 'vacating']);

// Occupancy locks. Each ground aircraft locks the taxi nodes it is on and the next ones ahead (all of its
// line-up route when lining up). A node locked by someone else can't be entered, except when queueing behind
// them on the same taxiway, so taxiing aircraft can't collide. Locks live in Aircraft.claims (serialisable);
// this map is a per-tick index.
const lockCache = new WeakMap<State, { tick: number; map: Map<string, Map<number, string>> }>();
function locks(st: State, icao: string): Map<number, string> {
  let c = lockCache.get(st);
  if (!c || c.tick !== st.tick) {
    c = { tick: st.tick, map: new Map() };
    for (const a of st.aircraft) {
      if (!a.onGround || !a.claims.length) continue;
      if (!c.map.has(a.apt)) c.map.set(a.apt, new Map());
      const m = c.map.get(a.apt)!;
      for (const n of a.claims) if (!m.has(n)) m.set(n, a.cs);
    }
    lockCache.set(st, c);
  }
  if (!c.map.has(icao)) c.map.set(icao, new Map());
  return c.map.get(icao)!;
}
/** Who (if anyone) holds the lock on a taxi node. */
export function lockedBy(st: State, icao: string, node: number): string | undefined { return locks(st, icao).get(node); }

/** Queueing: they came the same way into this node and are ahead of us, or have already gone through it our way. */
function following(apt: Apt, ac: Aircraft, o: Aircraft, j: number): boolean {
  const n = ac.path[j], k = o.path.indexOf(n);
  if (k < 0) return false;
  const myNext = ac.path[j + 1], myPrev = ac.path[j - 1];
  const sameIncoming = myPrev !== undefined && o.path[k - 1] === myPrev && dist(o, apt.nodes[n]) < dist(ac, apt.nodes[n]);
  const goneAhead = o.pi > k && myNext !== undefined && o.path[k + 1] === myNext;
  return sameIncoming || goneAhead;
}

/** How far this aircraft may move along its path before it must stop, and who (if anyone) it's waiting for. Updates its locks. */
function clearance(st: State, apt: Apt, ac: Aircraft): { d: number; by: string | null; at: number } {
  const t = TYPES[ac.type];
  const m = locks(st, ac.apt);
  const tail = t.lengthM / 2 + 15;
  // Release nodes our tail has cleared (and anything no longer on our path).
  ac.claims = ac.claims.filter(n => {
    const i = ac.path.indexOf(n);
    const keep = i >= ac.pi || (i === ac.pi - 1 && dist(ac, apt.nodes[n]) < tail);
    if (!keep && m.get(n) === ac.cs) m.delete(n);
    return keep;
  });
  const v = MS(ac.gs);
  const lookahead = ac.phase === 'lineup' ? Infinity : 70 + t.lengthM + v * v / 1.2;
  let d = dist(ac, apt.nodes[ac.path[ac.pi]]);
  for (let j = ac.pi; j < ac.path.length; j++) {
    const n = ac.path[j];
    if (j > ac.pi) d += dist(apt.nodes[ac.path[j - 1]], apt.nodes[n]);
    if (d > lookahead) return { d: Infinity, by: null, at: -1 };
    if (ac.holdAt === n) return { d, by: null, at: j };
    // The node itself, and nodes physically close to it, must be free of other aircraft's locks.
    for (const k of [n, ...apt.near[n]]) {
      const owner = m.get(k);
      if (!owner || owner === ac.cs || owner === ac.ghost) continue;
      const o = st.aircraft.find(x => x.cs === owner);
      if (!o || o.ghost === ac.cs) continue;
      if (k === n ? following(apt, ac, o, j) : (o.path.includes(n) && following(apt, ac, o, j))) continue;
      // Waiting on each other (someone behind reserved a node ahead of us, or two meeting at a merge): the one nearer that
      // node goes first. The other is still held back by the traffic check, so this can't drive anyone into anyone.
      if (o.blockedBy === ac.cs && (dist(ac, apt.nodes[k]) - dist(o, apt.nodes[k]) || (ac.cs < o.cs ? -1 : 1)) < 0) continue;
      if (k !== n && ac.path.slice(Math.max(0, ac.pi - 1), j).includes(k)) continue;
      return { d: d - (t.spanM / 2 + 14), by: owner, at: j };
    }
    if (!ac.claims.includes(n)) { ac.claims.push(n); if (!m.has(n)) m.set(n, ac.cs); }
    const next = ac.path[j + 1];
    if (next === undefined) return { d, by: null, at: -1 };
    const rw = apt.onRunway.get(next);
    if (rw && !apt.onRunway.has(n) && ac.phase !== 'vacating') {
      // Entering a runway: needs a clearance, and (unless lining up) the far side free to vacate onto.
      if (!ac.cleared.cross.includes(rw)) return { d, by: null, at: j };
      if (ac.phase !== 'lineup') {
        // Room beyond the runway for the whole aircraft plus a margin, free of locks and traffic.
        let k = j + 1;
        while (k < ac.path.length && apt.onRunway.has(ac.path[k])) k++;
        let room = 0;
        for (let q = k; q < ac.path.length && room < t.lengthM + 90; q++) {
          if (q > k) room += dist(apt.nodes[ac.path[q - 1]], apt.nodes[ac.path[q]]);
          const node = apt.nodes[ac.path[q]];
          const l = m.get(ac.path[q]);
          if (l && l !== ac.cs) return { d, by: l, at: j };
          const near = st.aircraft.find(o => o !== ac && o.onGround && o.apt === ac.apt && o.phase !== 'parked' && o.phase !== 'stand' && dist(o, node) < 45);
          if (near) return { d, by: near.cs, at: j };
        }
      }
    }
  }
  return { d, by: null, at: -1 };
}

/** Nearest aircraft physically on our path ahead (queueing distance), within 250 m. */
function trafficOnPath(st: State, apt: Apt, ac: Aircraft): { d: number; who: Aircraft | null } {
  const me = TYPES[ac.type];
  let best = Infinity, who: Aircraft | null = null;
  const segs: { a: { x: number; y: number }; b: { x: number; y: number }; s0: number }[] = [];
  let s = 0, prev: { x: number; y: number } = ac;
  for (let j = ac.pi; j < ac.path.length && s < 250; j++) {
    const n = apt.nodes[ac.path[j]];
    segs.push({ a: prev, b: n, s0: s });
    s += dist(prev, n); prev = n;
  }
  for (const o of st.aircraft) {
    if (o === ac || o.cs === ac.ghost || o.ghost === ac.cs || !o.onGround || o.apt !== ac.apt || o.phase === 'parked' || o.phase === 'stand' || o.phase === 'landing' || o.phase === 'takeoff') continue;
    if (o.phase === 'pushing' && !o.claims.length) continue;
    if (Math.abs(o.x - ac.x) > 300 || Math.abs(o.y - ac.y) > 300) continue;
    for (const g of segs) {
      const r = segDist(o, g.a, g.b);
      if (r.d > 20) continue;
      const along = g.s0 + r.t * dist(g.a, g.b);
      if (along < 1) continue;
      const gap = along - (me.lengthM + TYPES[o.type].lengthM) / 2 - 12;
      if (gap < best) { best = gap; who = o; }
      break;
    }
  }
  return { d: best, who };
}

function stepToward(ac: Aircraft, target: { x: number; y: number }, step: number, reverse = false): number {
  const d = dist(ac, target);
  if (d < 1e-6) return step;
  const k = Math.min(1, step / d);
  ac.x += (target.x - ac.x) * k; ac.y += (target.y - ac.y) * k;
  const want = reverse ? norm360(bearing(ac, target) + 180) : bearing(ac, target);
  if (d > 0.5) ac.hdg = turnToward(ac.hdg, want, 25 * DT * (reverse ? 0.3 : 1));
  return Math.max(0, step - d);
}
export function turnToward(h: number, want: number, maxStep: number, dir?: 'L' | 'R' | null) {
  // With a forced direction, measure the turn the long way round if need be (monotonic, no flip-flop near 180°).
  const diff = dir === 'R' ? norm360(want - h) : dir === 'L' ? -norm360(h - want) : angleDiff(h, want);
  return norm360(h + Math.max(-maxStep, Math.min(maxStep, diff)));
}

export function moveGround(world: World, st: State, ac: Aircraft) {
  const apt = aptOf(world, ac);
  const t = TYPES[ac.type];
  const lvp = st.weather.lvp;
  switch (ac.phase) {
    case 'pushing': {
      if (ac.halted) { ac.gs = 0; break; } // "hold position": the tug stops
      const target = apt.nodes[ac.path[1]];
      // Lock the lane around the push point so taxiing traffic waits; wait if someone is already there.
      if (!ac.claims.length) {
        const m = locks(st, ac.apt);
        const near = apt.nodes.filter(n => dist(n, target) < 70).map(n => n.id);
        const other = near.map(n => m.get(n)).find(o => o && o !== ac.cs);
        if (other) { ac.gs = 0; ac.blockedBy = other; break; }
        ac.claims = near; for (const n of near) m.set(n, ac.cs);
      }
      ac.gs = 3;
      const rest = stepToward(ac, target, MS(ac.gs) * DT, true);
      if (rest > 0 || dist(ac, target) < 0.5) {
        // Swing the nose to the requested direction (or along the lane), then wait for taxi.
        const want = faceHeading(apt, ac);
        ac.gs = 0;
        ac.hdg = turnToward(ac.hdg, want, 6 * DT);
        if (Math.abs(angleDiff(ac.hdg, want)) < 2) { ac.phase = 'pushed'; ac.path = [ac.path[1]]; ac.pi = 0; ac.claims = [ac.path[0]]; }
      }
      break;
    }
    case 'taxi': case 'taxiin': case 'vacating': case 'lineup': {
      if (ac.pi >= ac.path.length) { if (ac.towing) ac.towing = false; else arrive(world, st, ac, apt); ac.gs = 0; break; }
      if (st.tick < ac.actAt) { ac.gs = 0; break; }
      // A route point just behind the nose (the centre of a node the aircraft stopped a few metres past) is skipped, never
      // driven back to: big jets can't reverse, and doubling back to it would mean two half-turns instead of one.
      if ((ac.phase === 'taxi' || ac.phase === 'taxiin') && ac.pi <= 1 && ac.gs < 2 && ac.pi < ac.path.length - 1 && ac.holdAt !== ac.path[ac.pi] && !ac.towing) {
        const n = apt.nodes[ac.path[ac.pi]];
        if (dist(ac, n) < 25 && Math.abs(angleDiff(ac.hdg, bearing(ac, n))) > 100) ac.pi++;
      }
      let want = ac.towing ? 4 : ac.phase === 'lineup' ? 10 : Math.min(t.taxi, lvp ? 12 : 30) * (ac.phase === 'vacating' ? 1.6 : 1);
      if (ac.halted) want = 0; // "hold position"
      // Slow for the coming turn.
      const n0 = apt.nodes[ac.path[ac.pi]], n1 = apt.nodes[ac.path[ac.pi + 1]];
      if (n1) {
        const turn = Math.abs(angleDiff(bearing(ac, n0), bearing(n0, n1)));
        if (turn > 40 && dist(ac, n0) < 80) want = Math.min(want, turn > 80 ? 7 : 11);
      }
      const c = clearance(st, apt, ac);
      const q = trafficOnPath(st, apt, ac);
      const stopD = Math.min(c.d, q.d);
      ac.blockedBy = stopD > 40 ? null : c.d <= q.d ? c.by : q.who?.cs ?? null;
      want = Math.min(want, Math.max(stopD > 0.6 ? 1.5 : 0, Math.sqrt(2 * 0.6 * Math.max(0, stopD - 0.4)) / KT));
      ac.gs = want > ac.gs ? Math.min(want, ac.gs + 1.2 * DT) : Math.max(want, ac.gs - 4 * DT);
      if (ac.gs < 0.3 && want < 0.3) { ac.gs = 0; ac.stoppedS += DT; } else ac.stoppedS = 0;
      let step = MS(ac.gs) * DT;
      while (step > 0 && ac.pi < ac.path.length) {
        const n = apt.nodes[ac.path[ac.pi]];
        step = stepToward(ac, n, step, ac.towing);
        if (dist(ac, n) < 1) {
          ac.x = n.x; ac.y = n.y;
          // Stop points (hold short, runway entry without clearance, a lock beyond): wait here, don't pass the node.
          if (ac.holdAt === n.id || c.at === ac.pi) { ac.gs = 0; break; }
          ac.pi++;
        }
      }
      if (ac.phase === 'vacating' && !runwayAt(apt, ac) && ac.s >= 0) { ac.phase = 'taxiin'; ac.s = -1; }
      break;
    }
    case 'takeoff': {
      const end = apt.ends[ac.runway!];
      if (ac.halted) {
        // "Stop immediately": a rejected take-off. Brake hard, then sit on the runway (lined up where it stopped).
        ac.ias = Math.max(0, ac.ias - t.decel * 1.3 * DT);
        ac.gs = Math.max(0, ac.ias - headwind(st, end.hdgTrue));
        ac.s += MS(ac.gs) * DT;
        const q = pointOnEnd(end, ac.s); ac.x = q.x; ac.y = q.y;
        if (ac.ias < 1) { ac.ias = 0; ac.gs = 0; ac.phase = 'lined'; ac.cleared.cto = false; ac.halted = false; }
        break;
      }
      ac.ias += t.accel * DT;
      ac.gs = Math.max(0, ac.ias - headwind(st, end.hdgTrue));
      ac.s += MS(ac.gs) * DT;
      const p = pointOnEnd(end, ac.s);
      ac.x = p.x; ac.y = p.y;
      if (ac.ias >= t.vr) {
        ac.onGround = false; ac.phase = 'climb'; ac.airborneAt = st.tick;
        ac.vs = t.climb; ac.tgtSpd = null;
        ac.tgtAlt = Math.max(ac.tgtAlt, apt.pack.airspace.sids.find(q => q.name + q.designator === ac.sid)?.initialAltFt ?? 6000);
        ac.nav = { mode: 'climbout', route: [], established: false, gs: false };
        const as = aptState(st, ac.apt);
        const ld = as.lastDep[ac.runway!];
        if (ld && ld.cs === ac.cs) ld.at = st.tick;
      }
      break;
    }
    case 'landing': {
      const end = apt.ends[ac.runway!];
      if (ac.fullStop && ac.s > end.thrS + 250) {
        // Emergency: stop straight ahead on the runway and wait for the fire service.
        ac.ias = Math.max(0, ac.ias - t.decel * 1.15 * DT);
        ac.gs = Math.max(0, ac.ias - headwind(st, end.hdgTrue) * Math.min(1, ac.ias / 60));
        ac.s = Math.min(end.len - 30, ac.s + MS(ac.gs) * DT);
        const q = pointOnEnd(end, ac.s); ac.x = q.x; ac.y = q.y; ac.alt = elevation(apt);
        if (ac.ias < 1) emergencyStop(world, st, ac);
        break;
      }
      const v = MS(ac.gs);
      const wet = st.weather.wx.some(w => w.includes('RA')) ? 0.85 : 1;
      // Pick the first exit we can still make, and brake so we arrive at it at exit speed.
      const exits = exitsFor(apt, end);
      let target: Exit | null = null;
      for (const e of exits) {
        if (e.s < ac.s - 2) continue;
        // Skip an exit with someone stopped on it.
        const outN = apt.nodes[e.out];
        if (st.aircraft.some(o => o !== ac && o.onGround && o.phase !== 'landing' && o.phase !== 'takeoff' && dist(o, outN) < 130)) continue;
        const exitV = MS(e.angle < 50 ? 40 : 15);
        const need = v > exitV ? (v * v - exitV * exitV) / (2 * 1.8 * wet) : 0;
        if (e.s - ac.s >= need - 5) { target = e; break; }
      }
      let allowed = Math.max(12, Math.min(30, Math.sqrt(2 * 1.4 * Math.max(0, end.len - 60 - ac.s)) / KT)); // no exit ahead: 30 kt, and stop before the end
      if (target) {
        const exitV = MS(target.angle < 50 ? 40 : 15);
        allowed = Math.sqrt(exitV * exitV + 2 * 1.6 * wet * Math.max(0, target.s - ac.s)) / KT;
      }
      if (ac.s > end.thrS + 350) ac.ias = Math.max(12, Math.min(ac.ias, Math.max(allowed, ac.ias - t.decel * wet * DT)));
      ac.gs = Math.max(0, ac.ias - headwind(st, end.hdgTrue) * Math.min(1, ac.ias / 60));
      ac.s = Math.min(end.len - 1, ac.s + MS(ac.gs) * DT);
      const p = pointOnEnd(end, ac.s);
      ac.x = p.x; ac.y = p.y;
      ac.alt = elevation(apt);
      if (!target && ac.ias <= 16) {
        // No normal exit ahead (short runway, sharp exits): leave by the nearest exit of any angle, backtracking if needed.
        let best: { node: number; out: number; d: number } | null = null;
        for (const [n, rw] of apt.onRunway) {
          if (rw !== end.runway) continue;
          for (const { to } of apt.adj[n]) {
            if (apt.onRunway.get(to) === rw) continue;
            const d = Math.abs(along(end, apt.nodes[n]) - ac.s);
            if (!best || d < best.d) best = { node: n, out: to, d };
          }
        }
        if (best) {
          let near = best.node, nd = Infinity;
          for (const [n, rw] of apt.onRunway) if (rw === end.runway) { const d = dist(apt.nodes[n], ac); if (d < nd) { nd = d; near = n; } }
          const onRwy = route(apt, near, best.node, { allowRunway: r => r === end.runway }) ?? [near, best.node];
          const goal = ac.stand ? apt.standByRef[ac.stand].node : best.out;
          const r = route(apt, best.out, goal, { penalty: flowPenalty(st, apt, ac) });
          ac.phase = 'vacating'; ac.s = 0; ac.gs = 8;
          ac.path = [...onRwy, ...(r ?? [best.out])]; ac.pi = 1; ac.cleared.cross = [];
        }
        break;
      }
      if (target && (target.s - ac.s < 3 || ac.s >= end.len - 2)) {
        ac.phase = 'vacating'; ac.s = 0;
        const goal = ac.stand ? apt.standByRef[ac.stand].node : target.out;
        const r = route(apt, target.out, goal, { penalty: flowPenalty(st, apt, ac) });
        ac.path = [target.node, ...(r ?? [target.out])]; ac.pi = 1;
        ac.cleared.cross = [];
      }
      break;
    }
    case 'parked':
      ac.gs = 0;
      if (st.tick - (ac.landedAt ?? st.tick) > ticks(120) && ac.pi >= ac.path.length) ac.phase = 'gone';
      break;
    default:
      ac.gs = 0;
  }
}

function faceHeading(apt: Apt, ac: Aircraft): number {
  if (ac.face) return { N: 0, E: 90, S: 180, W: 270 }[ac.face];
  // Nose along the first leg of the route the aircraft will actually taxi, so it never has to turn round.
  const n = ac.path[1];
  const end = ac.runway ? apt.ends[ac.runway] : null;
  const goal = end ? end.front[0] ?? end.holds[0] : undefined;
  const r = goal !== undefined ? route(apt, n, goal) : null;
  if (r && r.length > 1) return bearing(apt.nodes[n], apt.nodes[r[1]]);
  const lane = apt.adj[n].find(a => !apt.nodes[a.to].stand);
  return lane ? bearing(apt.nodes[n], apt.nodes[lane.to]) : ac.hdg;
}

/** Penalty that keeps routes off taxiways other aircraft are using in the opposite direction. */
export function flowPenalty(st: State, apt: Apt, me: Aircraft) {
  const used = new Map<string, number>();
  for (const o of st.aircraft) {
    if (o === me || o.apt !== me.apt || !GROUND_PHASES.has(o.phase) && o.phase !== 'pushed') continue;
    for (let i = Math.max(1, o.pi); i < o.path.length; i++) {
      const k = `${o.path[i - 1]}>${o.path[i]}`;
      used.set(k, (used.get(k) ?? 0) + 1);
    }
  }
  return (_e: number, from: number, to: number) => (used.get(`${to}>${from}`) ?? 0) * 4000 + (used.get(`${from}>${to}`) ?? 0) * 15;
}

function arrive(world: World, st: State, ac: Aircraft, apt: Apt) {
  if (ac.phase === 'lineup') {
    // On the centreline: swing onto the runway heading.
    const end = apt.ends[ac.runway!];
    const hdg = bearing(end.end, pointOnEnd(end, 1000));
    ac.hdg = turnToward(ac.hdg, hdg, 15 * DT);
    if (Math.abs(angleDiff(ac.hdg, hdg)) < 2) {
      ac.hdg = hdg; ac.phase = 'lined'; ac.s = along(end, ac);
      const p = pointOnEnd(end, ac.s); ac.x = p.x; ac.y = p.y;
      ac.actAt = Math.max(ac.actAt, st.tick + ticks(3));
    }
    return;
  }
  if (ac.kind === 'dep' && ac.phase === 'taxi') {
    const last = ac.path[ac.path.length - 1];
    if (apt.nodes[last]?.hold || apt.ends[ac.runway!]?.holds.includes(last)) {
      ac.phase = 'holding';
      ac.holdAt = null;
    }
  } else if (ac.kind === 'arr' && (ac.phase === 'taxiin' || ac.phase === 'vacating')) {
    const st0 = ac.stand ? apt.standByRef[ac.stand] : null;
    if (st0 && ac.path[ac.path.length - 1] === st0.node) {
      ac.phase = 'parked'; ac.hdg = st0.hdg; ac.landedAt = ac.landedAt ?? st.tick;
    }
  }
  void world;
}

// ------------------------------------------------------------------ air

export function defaultSpeed(world: World, st: State, ac: Aircraft): number {
  const t = TYPES[ac.type];
  if (ac.kind === 'dep') return ac.alt < 3000 ? t.vr + 25 : ac.alt < 10000 ? 250 : 300;
  if (ac.nav.established) {
    const end = aptOf(world, ac).ends[ac.nav.ils!];
    const d = (end.thrS - along(end, ac)) / NM;
    return d < 4.5 ? t.vapp : d < 12 ? 170 : 190;
  }
  if (ac.phase === 'stack') return 220;
  if (ac.phase === 'approach' || ac.phase === 'goaround') return ac.alt < 4000 ? 180 : 210;
  return ac.alt > 10000 ? 280 : 250;
}

export function moveAir(world: World, st: State, ac: Aircraft) {
  const t = TYPES[ac.type];
  const apt = aptOf(world, ac);
  const elev = elevation(apt);
  let wantHdg: number | null = ac.tgtHdg;
  let gsAlt: number | null = null;
  const nav = ac.nav;

  // ---- lateral navigation
  if (nav.mode === 'climbout') {
    const end = apt.ends[ac.runway!];
    wantHdg = end.hdgTrue;
    if (ac.alt > elev + 800) {
      const sid = apt.pack.airspace.sids.find(s => `${s.name}${s.designator}` === ac.sid);
      nav.mode = 'route'; nav.route = sid ? [...sid.fixes] : [];
      if (!sid) { nav.mode = 'hdg'; ac.tgtHdg = end.hdgTrue; }
    }
  }
  if (nav.mode === 'route') {
    while (nav.route.length && dist(ac, apt.fixes[nav.route[0]] ?? ac) < Math.max(1500, MS(ac.gs) * 12)) {
      const done = nav.route.shift()!;
      if (!nav.route.length && ac.kind === 'arr' && done === ac.stack && !nav.ils) enterHold(world, st, ac, done);
    }
    if (nav.mode === 'route') {
      if (nav.route.length) wantHdg = crab(st, ac, bearing(ac, apt.fixes[nav.route[0]]));
      else { nav.mode = 'hdg'; ac.tgtHdg = ac.hdg; wantHdg = ac.hdg; }
    }
  }
  if (nav.mode === 'hold' && nav.hold) wantHdg = holdHeading(world, st, ac);

  if (nav.ils && !ac.onGround) {
    const end = apt.ends[nav.ils];
    const course = end.hdgTrue;
    const xt = lateral(end, ac);          // + right of course
    const toThr = end.thrS - along(end, ac);
    if (!nav.established && toThr > 0 && toThr < 25 * NM) {
      const intercept = Math.abs(angleDiff(ac.trk, course));
      const lead = MS(ac.gs) * (intercept / turnRate(tas(ac.ias, ac.alt))) * 0.55 + 120;
      const closing = Math.sign(xt) * Math.sin((ac.trk - course) * Math.PI / 180) < 0 || Math.abs(xt) < 150;
      if (intercept < 95 && closing && Math.abs(xt) < lead + 200 && Math.abs(xt) < 3 * NM) {
        nav.established = true; nav.mode = 'hdg'; ac.tgtHdg = null; ac.turn = null;
        if (ac.phase === 'approach' || ac.phase === 'arrival' || ac.phase === 'stack' || ac.phase === 'goaround') ac.phase = 'final';
      }
    }
    if (nav.established) {
      wantHdg = crab(st, ac, course - Math.max(-30, Math.min(30, (xt / NM) * 40)));
      gsAlt = glidepath(apt, end, toThr);
      if (!nav.gs && ac.alt >= gsAlt - 60) nav.gs = true;
    }
  }

  // ---- turn
  const rate = nav.mode === 'hold' ? turnRate(tas(ac.ias, ac.alt)) : t.wake === 'M' ? 3 : 2.5; // ponytail: rate-one/25° bank only in holds; vectoring keeps the rates the AI approach is tuned for
  if (wantHdg !== null) {
    ac.hdg = turnToward(ac.hdg, wantHdg, rate * DT, nav.established || nav.mode === 'route' ? null : ac.turn);
    if (ac.turn && Math.abs(angleDiff(ac.hdg, wantHdg)) < 5) ac.turn = null;
  }

  // ---- speed
  const want = Math.max(t.vapp, ac.tgtSpd !== null && !(nav.established && (apt.ends[nav.ils!].thrS - along(apt.ends[nav.ils!], ac)) < 4 * NM)
    ? ac.tgtSpd : defaultSpeed(world, st, ac));
  const limit = ac.alt < 10000 && ac.kind === 'arr' ? Math.min(want, 250) : want;
  ac.ias = ac.ias < limit ? Math.min(limit, ac.ias + 1.8 * DT) : Math.max(limit, ac.ias - 1.1 * DT);

  // ---- vertical
  if (nav.gs && gsAlt !== null) {
    const prev = ac.alt;
    ac.alt = Math.max(gsAlt, ac.alt - 2500 / 60 * DT);
    ac.vs = (ac.alt - prev) / DT * 60;
  } else {
    const climbRate = (ac.vs > 0 ? t.climb : t.climb) * Math.max(0.35, 1 - ac.alt / 40000);
    const descRate = t.descent * (ac.alt > 10000 ? 1.2 : 1);
    if (ac.alt < ac.tgtAlt - 20) { ac.vs = climbRate; ac.alt = Math.min(ac.tgtAlt, ac.alt + climbRate / 60 * DT); }
    else if (ac.alt > ac.tgtAlt + 20) { ac.vs = -descRate; ac.alt = Math.max(ac.tgtAlt, ac.alt - descRate / 60 * DT); }
    else { ac.vs = 0; ac.alt = ac.tgtAlt; }
  }

  // ---- position (TAS + wind)
  const v = MS(tas(ac.ias, ac.alt));
  const h = ac.hdg * Math.PI / 180, w = windAt(st, ac.alt);
  const vx = Math.sin(h) * v + w.x, vy = Math.cos(h) * v + w.y;
  ac.x += vx * DT; ac.y += vy * DT;
  ac.gs = Math.hypot(vx, vy) / KT;
  ac.trk = norm360(Math.atan2(vx, vy) * 180 / Math.PI);
  ac.trackM += Math.hypot(vx, vy) * DT;
  void rand;
}

/** Heading that makes good the desired track given the wind at the aircraft's level. */
export function crab(st: State, ac: Aircraft, track: number): number {
  const w = windAt(st, ac.alt);
  const v = Math.max(80, tas(ac.ias, ac.alt)) * KT;
  const tr = track * Math.PI / 180;
  const cross = w.x * Math.cos(tr) - w.y * Math.sin(tr); // wind component to the right of track
  const wca = Math.asin(Math.max(-0.5, Math.min(0.5, -cross / v))) * 180 / Math.PI;
  return norm360(track + wca);
}

export function enterHold(world: World, st: State, ac: Aircraft, fix: string) {
  const apt = aptOf(world, ac);
  const sk = apt.pack.airspace.stacks.find(s => s.fix === fix || s.name === fix);
  ac.nav.mode = 'hold';
  ac.nav.hold = { fix, inbound: sk?.inboundTrack ?? bearing(ac, apt.fixes[fix]), turn: sk?.turn ?? 'R', leg: 'entry', t: 0 };
  if (ac.kind === 'arr' && (ac.phase === 'arrival' || ac.phase === 'approach')) ac.phase = 'stack';
}

function holdHeading(world: World, st: State, ac: Aircraft): number {
  const apt = aptOf(world, ac);
  const h = ac.nav.hold!;
  const fix = apt.fixes[h.fix];
  ac.holdS += DT;
  const { r, leg } = holdShape(ac.ias, ac.alt, windKtAt(st.weather.wind.kt, ac.alt));
  h.r = r; h.len = leg; // what the scope draws for it
  const dir = h.turn === 'R' ? 1 : -1, out = norm360(h.inbound + 180), legT = ac.alt > 14000 ? 90 : 60;
  // Hold frame: u along the inbound course (0 at the fix, negative before it), v toward the holding side.
  const ci = h.inbound * Math.PI / 180, dx = ac.x - fix.x, dy = ac.y - fix.y;
  const u = dx * Math.sin(ci) + dy * Math.cos(ci), v = dir * (dx * Math.cos(ci) - dy * Math.sin(ci));
  // Onto a leg: its course, cutting back toward it by how far off it is (offset positive to the right of the course).
  const steer = (course: number, off: number) => crab(st, ac, norm360(course - Math.max(-45, Math.min(45, Math.atan(off / r) * 180 / Math.PI))));
  const release = (want: number) => { if (ac.turn && Math.abs(angleDiff(ac.hdg, want)) < 60) ac.turn = null; return want; };

  if (h.leg === 'entry') {
    if (dist(ac, fix) > Math.max(900, MS(ac.gs) * 4)) return crab(st, ac, bearing(ac, fix));
    // Over the fix: the entry follows from the heading (sectors relative to the inbound course, mirrored for left-hand holds).
    const rel = norm360(dir * angleDiff(h.inbound, ac.hdg));
    h.leg = rel > 110 && rel <= 180 ? 'teardrop' : rel > 180 && rel < 290 ? 'parallel' : 'outbound';
    h.t = 0;
    ac.turn = h.leg === 'outbound' ? h.turn : null;
  }
  if (h.leg === 'teardrop') {
    // 30� into the holding side, until a turn in the hold direction will roll out on the inbound leg.
    h.t += DT;
    if (v < r * 1.87 && h.t < 3 * legT) return crab(st, ac, norm360(out - dir * 30));
    h.leg = 'inbound'; ac.turn = h.turn;
  }
  if (h.leg === 'parallel') {
    // Outbound on the non-holding side, then turn back the other way to the inbound leg.
    h.t += DT;
    if (h.t < legT) return crab(st, ac, out);
    h.leg = 'inbound'; ac.turn = h.turn === 'R' ? 'L' : 'R';
  }
  // Round the pattern: each turn follows its drawn arc and each leg its line, so the wind can't push it off either.
  // (centre of the turn at the fix end, or at the far end)
  const arc = (along: number) => {
    const cx = fix.x + Math.sin(ci) * along + dir * Math.cos(ci) * r, cy = fix.y + Math.cos(ci) * along - dir * Math.sin(ci) * r;
    const rho = Math.hypot(ac.x - cx, ac.y - cy);
    return release(steer(norm360(bearing({ x: cx, y: cy }, ac) + dir * 90), -dir * (rho - r)));
  };
  if (h.leg === 'outbound') {
    if (u > 0) return arc(0);
    if (u > -leg) return release(steer(out, -dir * (v - 2 * r)));
    h.leg = 'inbound';
  }
  if (u >= 0) { h.leg = 'outbound'; return arc(0); } // over the fix: round again
  return u < -leg ? arc(-leg) : release(steer(h.inbound, dir * v));
}

/** Path from the holding point onto the runway centreline for line-up. */
export function lineupPath(apt: Apt, ac: Aircraft): number[] {
  const end = apt.ends[ac.runway!];
  const from = ac.path.length ? ac.path[ac.path.length - 1] : nearestNode(apt, ac);
  return routeToRunway(apt, from, end) ?? [from];
}
function nearestNode(apt: Apt, p: { x: number; y: number }) {
  let best = 0, bd = Infinity;
  for (const n of apt.nodes) { const d = dist(n, p); if (d < bd) { bd = d; best = n.id; } }
  return best;
}

