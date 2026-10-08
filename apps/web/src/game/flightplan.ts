// What the selected aircraft intends (its filed route) and where it is actually heading (a short projection of its real path).
import { finalPoint, geo, project, type Aircraft, type Command, type World } from '@squawk/sim';
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

  // Projection: the sim's own prediction of its path (the one STCA uses), four minutes ahead.
  const track: XY[] = [];
  const minutes: FlightPlan['minutes'] = [];
  let level: FlightPlan['level'];
  project(world, ac, 240, 10).forEach(({ x, y, alt }, i) => {
    track.push({ x, y });
    if ((i + 1) % 6 === 0) minutes.push({ p: { x, y }, text: `${(i + 1) / 6}′` });
    if (!level && Math.abs(ac.tgtAlt - ac.alt) > 200 && alt === ac.tgtAlt) level = { p: { x, y }, text: `${ac.tgtAlt > ac.alt ? '▲' : '▼'} ${ac.tgtAlt >= 6000 ? 'FL' + String(Math.round(ac.tgtAlt / 100)).padStart(3, '0') : ac.tgtAlt + ' ft'} level` };
  });
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
