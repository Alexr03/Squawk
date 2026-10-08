// What the selected aircraft intends (its filed route) and where it is actually heading (a short projection of its real path).
import { finalPoint, geo, type Aircraft, type Command, type World } from '@squawk/sim';
import { placeName } from '@squawk/phraseology';

type XY = { x: number; y: number };
export interface FlightPlan {
  plan: XY[];                                   // filed route from the aircraft onward
  fixes: { p: XY; name: string }[];             // named points on it
  end: { p: XY; text: string; dir?: number } | null; // where the plan leads: runway, or the destination off the edge
  track: XY[];                                  // projected path, one point per 10 s
  minutes: { p: XY; text: string }[];           // a tick each minute along the projection
  level?: { p: XY; text: string };              // where it reaches its cleared level (climbing or descending)
}

const NM = geo.NM;
const KT = NM / 3600; // metres per second per knot

export function flightPlan(world: World, ac: Aircraft): FlightPlan | null {
  if (ac.onGround) return null;
  const apt = world.byIcao[ac.apt] ?? world.primary;
  const fx = (n: string) => apt.fixes[n] as XY | undefined;
  const fixes: FlightPlan['fixes'] = [];
  const plan: XY[] = [{ x: ac.x, y: ac.y }];
  const add = (name: string) => { const p = fx(name); if (p && !fixes.some(f => f.name === name)) { plan.push(p); fixes.push({ p, name }); } };
  let end: FlightPlan['end'] = null;

  if (ac.kind === 'arr') {
    // Remaining STAR fixes (the route the pilot is flying, if any), the stack, then the final approach to the runway.
    const star = apt.pack.airspace.stars.find(s => s.name === ac.star);
    // On its own navigation it flies the rest of the STAR to the stack; holding, it waits at the stack; on vectors or the ILS
    // the plan is simply the final approach.
    const stackFix = apt.pack.airspace.stacks.find(s => s.name === ac.stack)?.fix ?? star?.stack;
    if (ac.nav.mode === 'route' && !ac.nav.ils) { for (const f of ac.nav.route) add(f); if (stackFix) add(stackFix); }
    else if (ac.nav.mode === 'hold' && ac.nav.hold) add(ac.nav.hold.fix);
    const e = ac.runway ? apt.ends[ac.runway] : null;
    if (e) { const fp = finalPoint(e, 10); plan.push(fp, e.thr); end = { p: e.thr, text: `Runway ${e.name}` }; }
  } else {
    const sid = apt.pack.airspace.sids.find(s => s.name + s.designator === ac.sid || s.name === ac.sid);
    const rest = ac.nav.mode === 'route' && ac.nav.route.length ? ac.nav.route : sid?.fixes ?? [];
    for (const f of rest) add(f);
    const last = plan[plan.length - 1], prev = plan[plan.length - 2] ?? { x: ac.x, y: ac.y };
    const dir = plan.length > 1 ? geo.bearing(prev, last) : ac.hdg;
    end = { p: last, text: `${placeName(ac.other) ?? ac.other} (${ac.other})`, dir };
  }

  // Holding: the racetrack itself (as drawn on the scope): straight to the fix if not there yet, then round the pattern.
  if (ac.nav.mode === 'hold' && ac.nav.hold) {
    const loop = racetrack(apt, ac.nav.hold.fix, ac.nav.hold.inbound, ac.nav.hold.turn);
    if (loop) return { plan, fixes, end, ...followLoop(ac, loop, fx(ac.nav.hold.fix)!) };
  }
  // Projection: fly the aircraft's current instructions forward for four minutes, turning at rate one.
  const track: XY[] = [];
  const minutes: FlightPlan['minutes'] = [];
  let level: FlightPlan['level'];
  let x = ac.x, y = ac.y, hdg = ac.trk ?? ac.hdg, alt = ac.alt;
  const route = [...(ac.nav.mode === 'route' ? ac.nav.route : [])];
  let established = ac.nav.established;
  const target = (): number | null => {
    if (ac.nav.mode === 'hold' && ac.nav.hold) {
      const f = fx(ac.nav.hold.fix);
      return f && geo.dist({ x, y }, f) > 1.5 * NM ? geo.bearing({ x, y }, f) : null; // at the fix: keep the current turn going (racetrack)
    }
    if (ac.nav.ils) {
      const e = apt.ends[ac.nav.ils];
      if (e && !established) {
        // Capture the localizer when close to the centreline and pointing roughly along it.
        const ax = x - e.thr.x, ay = y - e.thr.y, along = -(ax * e.ux + ay * e.uy), off = Math.abs(ax * e.uy - ay * e.ux);
        const course = (Math.atan2(e.ux, e.uy) * 180) / Math.PI;
        if (along > 0 && off < 0.4 * NM && Math.abs(((course - hdg + 540) % 360) - 180) < 70) established = true;
      }
      if (e && established) return geo.bearing({ x, y }, e.thr);
    }
    while (route.length && fx(route[0]) && geo.dist({ x, y }, fx(route[0])!) < 1.2 * NM) route.shift();
    if (route.length && fx(route[0])) return geo.bearing({ x, y }, fx(route[0])!);
    return ac.tgtHdg;
  };
  const vs = Math.sign(ac.tgtAlt - ac.alt) * Math.max(800, Math.abs(ac.vs) || 1500);
  for (let t = 10; t <= 240; t += 10) {
    const want = target();
    if (want !== null) {
      let d = ((want - hdg + 540) % 360) - 180;
      if (ac.nav.mode === 'hdg' && ac.turn && Math.abs(d) > 5) d = ac.turn === 'L' ? (d > 0 ? d - 360 : d) : (d < 0 ? d + 360 : d); // the way the controller said to turn
      hdg = (hdg + Math.max(-30, Math.min(30, d)) + 360) % 360; // 3°/s
    } else if (ac.nav.mode === 'hold') hdg = (hdg + (ac.nav.hold?.turn === 'L' ? -30 : 30) * 0.25 + 360) % 360;
    const b = (hdg * Math.PI) / 180, v = Math.max(120, ac.gs) * KT * 10;
    x += Math.sin(b) * v; y += Math.cos(b) * v;
    alt = vs > 0 ? Math.min(ac.tgtAlt, alt + (vs / 60) * 10) : Math.max(ac.tgtAlt, alt + (vs / 60) * 10);
    track.push({ x, y });
    if (t % 60 === 0) minutes.push({ p: { x, y }, text: `${t / 60}′` });
    if (!level && Math.abs(ac.tgtAlt - ac.alt) > 200 && alt === ac.tgtAlt) level = { p: { x, y }, text: `${ac.tgtAlt > ac.alt ? '▲' : '▼'} ${ac.tgtAlt >= 6000 ? 'FL' + String(Math.round(ac.tgtAlt / 100)).padStart(3, '0') : ac.tgtAlt + ' ft'} level` };
    if (ac.nav.ils && established && geo.dist({ x, y }, apt.ends[ac.nav.ils]?.thr ?? { x: 1e9, y: 0 }) < 0.5 * NM) break;
  }
  return { plan, fixes, end, track, minutes, level };
}

/** The aircraft as it would be after these instructions: for previewing a drag before letting go. */
export function withCommands(ac: Aircraft, cmds: Command[]): Aircraft {
  const a: Aircraft = { ...ac, nav: { ...ac.nav, route: [...ac.nav.route] } };
  for (const c of cmds) {
    if (c.verb === 'heading') { a.tgtHdg = c.hdg; a.turn = c.turn ?? null; a.nav = { ...a.nav, mode: 'hdg', route: [] }; }
    else if (c.verb === 'direct') a.nav = { ...a.nav, mode: 'route', route: [c.fix], hold: undefined };
    else if (c.verb === 'hold') a.nav = { ...a.nav, mode: 'hold', hold: { fix: c.fix, inbound: 0, turn: 'R', leg: 'entry', t: 0 } };
    else if (c.verb === 'ils') { a.nav = { ...a.nav, ils: c.runway, established: false }; a.runway = c.runway; }
    else if (c.verb === 'alt') a.tgtAlt = c.alt;
  }
  return a;
}

/** The holding pattern at a fix as a closed polyline in flying order: inbound leg to the fix, turn, outbound leg, turn. */
function racetrack(apt: { pack: { airspace: { stacks: { fix: string; inboundTrack: number; turn: 'L' | 'R' }[] } }; fixes: Record<string, XY> }, fix: string, inbound: number, turn: 'L' | 'R'): XY[] | null {
  const f = apt.fixes[fix];
  if (!f) return null;
  const sk = apt.pack.airspace.stacks.find(s => s.fix === fix);
  const trk = sk?.inboundTrack ?? inbound, dir = sk?.turn ?? turn;
  const t = (trk * Math.PI) / 180, ux = Math.sin(t), uy = Math.cos(t);
  const sx = dir === 'R' ? uy : -uy, sy = dir === 'R' ? -ux : ux; // toward the turn side
  const leg = 4 * NM, r = 1.2 * NM;
  const a0 = { x: f.x - ux * leg, y: f.y - uy * leg };
  const pts: XY[] = [a0, { x: f.x, y: f.y }];
  const arc = (c: XY, from: XY) => {
    const ang0 = Math.atan2(from.y - c.y, from.x - c.x);
    for (let i = 1; i <= 12; i++) { const a = ang0 + (dir === 'R' ? -1 : 1) * Math.PI * (i / 12); pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }); }
  };
  arc({ x: f.x + sx * r, y: f.y + sy * r }, f);
  const b0 = { x: f.x + sx * 2 * r - ux * leg, y: f.y + sy * 2 * r - uy * leg };
  pts.push(b0);
  arc({ x: a0.x + sx * r, y: a0.y + sy * r }, b0);
  return pts;
}

/** Four minutes along: to the fix first if still on the way in, then round the loop from the nearest point, ticks by distance. */
function followLoop(ac: Aircraft, loop: XY[], fixPt: XY): Pick<FlightPlan, 'track' | 'minutes'> {
  const speed = Math.max(140, ac.gs) * KT; // m/s
  const path: XY[] = [];
  let i: number;
  if (geo.dist(ac, fixPt) > 2.5 * NM && geo.dist(ac, loop[0]) > 2.5 * NM) { path.push(fixPt); i = 2; } // inbound to the fix, then into the turn
  else { i = loop.reduce((b, p, k) => (geo.dist(ac, p) < geo.dist(ac, loop[b]) ? k : b), 0); i = (i + 1) % loop.length; }
  while (path.length < 400) { path.push(loop[i]); i = (i + 1) % loop.length; if (path.length > loop.length * 2) break; }
  // Walk 240 s of flying along it.
  const track: XY[] = [], minutes: FlightPlan['minutes'] = [];
  let prev: XY = { x: ac.x, y: ac.y }, t = 0, nextTick = 60;
  for (const p of path) {
    const d = geo.dist(prev, p), dt = d / speed;
    while (t + dt >= nextTick && nextTick <= 240) {
      const k = (nextTick - t) / dt, q = { x: prev.x + (p.x - prev.x) * k, y: prev.y + (p.y - prev.y) * k };
      minutes.push({ p: q, text: `${nextTick / 60}′` }); nextTick += 60;
    }
    t += dt;
    if (t > 240) { const k = 1 - (t - 240) / dt; track.push({ x: prev.x + (p.x - prev.x) * k, y: prev.y + (p.y - prev.y) * k }); break; }
    track.push(p); prev = p;
  }
  return { track, minutes };
}
