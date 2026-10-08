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

  // Projection: fly the aircraft's current instructions forward for four minutes, turning at rate one.
  const track: XY[] = [];
  const minutes: FlightPlan['minutes'] = [];
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
    if (t % 60 === 0) minutes.push({ p: { x, y }, text: `${t / 60}′ ${alt >= 6000 ? 'FL' + String(Math.round(alt / 100)).padStart(3, '0') : Math.round(alt / 100) * 100 + ' ft'}` });
    if (ac.nav.ils && established && geo.dist({ x, y }, apt.ends[ac.nav.ils]?.thr ?? { x: 1e9, y: 0 }) < 0.5 * NM) break;
  }
  return { plan, fixes, end, track, minutes };
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
