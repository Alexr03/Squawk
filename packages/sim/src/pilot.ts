// The radio path every instruction takes: validate -> transmit -> pilot readback (maybe wrong) -> effect.
import { TYPES } from './aircraft.ts';
import { dist, NM } from './geo.ts';
import { aptOf, aptState, enterHold, flowPenalty, lineupPath } from './physics.ts';
import { DT, rand, seatApt, seatId, seatRole, ticks, type Aircraft, type SeatId, type State } from './state.ts';
import { newSquawk, sidFor } from './traffic.ts';
import type { Command, Msg, PilotCall, Seat, Verb } from './types.ts';
import { along, pathLength, route, runwayAt, viaNames, type World } from './world.ts';

const ROLE_VERBS: Record<Seat, Verb[]> = {
  DEL: ['clearance', 'contact', 'negative', 'sayagain', 'unable'],
  GND: ['push', 'taxi', 'greens', 'holdshort', 'continue', 'giveway', 'cross', 'contact', 'negative', 'sayagain', 'unable'],
  TWR: ['luw', 'cto', 'land', 'goaround', 'cross', 'holdshort', 'continue', 'contact', 'heading', 'alt', 'speed', 'negative', 'sayagain', 'unable', 'taxi'],
  DIR: ['heading', 'alt', 'speed', 'direct', 'hold', 'ils', 'contact', 'resume', 'negative', 'sayagain', 'unable', 'goaround'],
  LON: ['heading', 'alt', 'speed', 'direct', 'hold', 'contact', 'resume', 'negative', 'sayagain', 'unable'],
};
const AIR = new Set(['climb', 'arrival', 'stack', 'approach', 'final', 'goaround']);
const TAXI = new Set(['pushed', 'taxi', 'taxiin', 'vacating', 'holding']);

export const find = (st: State, cs: string) => st.aircraft.find(a => a.cs === cs && a.phase !== 'gone');

/** Seats this aircraft may be handed to from its current owner. */
export function nextSeats(ac: Aircraft): Seat[] {
  const r = seatRole(ac.owner);
  // A departure lining up or rolling belongs to Tower until it is airborne: no handing it back to Ground from the runway.
  if (ac.kind === 'dep') return { DEL: ['GND'], GND: ['TWR'], TWR: !ac.onGround ? ['LON'] : ['lineup', 'lined', 'takeoff'].includes(ac.phase) ? [] : ['GND'], DIR: ['LON'], LON: [] }[r] as Seat[];
  return { LON: ['DIR'], DIR: ['TWR'], TWR: ac.onGround ? ['GND'] : ['DIR'], GND: [], DEL: [] }[r] as Seat[];
}

/** Resolve a taxi limit ("27L", "A1", "512") to a node, for this aircraft. */
export function taxiTarget(world: World, ac: Aircraft, to: string): number | null {
  const apt = aptOf(world, ac);
  const end = apt.ends[to];
  if (end) {
    // A holding point near the start of the runway (full length or close to it), on this aircraft's side: the one with the
    // shortest route that doesn't cross a runway. Already at one for this runway? Stay there.
    if (ac.phase === 'holding' && ac.path.length && end.holds.includes(ac.path[ac.path.length - 1])) return ac.path[ac.path.length - 1];
    const holds = end.front.length ? end.front : end.holds;
    if (!holds.length) return null;
    const first = Math.min(...holds.map(h => along(end, apt.nodes[h])));
    const near = holds.filter(h => along(end, apt.nodes[h]) <= first + Math.max(450, end.len * 0.15));
    const start = routeStart(world, ac);
    let best: number | null = null, bc = Infinity;
    for (const h of near) {
      const r = route(apt, start, h);
      if (!r) continue;
      const c = pathLength(apt, r) + (r.slice(1, -1).some(n => apt.onRunway.has(n)) ? 1e6 : 0);
      if (c < bc) { bc = c; best = h; }
    }
    return best ?? near[0];
  }
  const hold = apt.nodes.find(n => n.hold === to);
  if (hold) return hold.id;
  const stand = apt.standByRef[to];
  if (stand) return stand.node;
  return null;
}

/** Current graph node for a ground aircraft (where a new route starts). */
/** Heading that constrains a new taxi route: set once the aircraft is facing along a taxiway. */
export const startHdg = (ac: Aircraft) => (ac.phase === 'pushed' || ac.phase === 'taxi' || ac.phase === 'taxiin' ? ac.hdg : undefined);

export function routeStart(world: World, ac: Aircraft): number {
  const apt = aptOf(world, ac);
  if (ac.path.length && ac.pi < ac.path.length) return ac.path[Math.max(0, ac.pi - 1)] === undefined ? ac.path[ac.pi] : nearestOf(apt.nodes, ac, [ac.path[Math.max(0, ac.pi - 1)], ac.path[ac.pi]]);
  if (ac.path.length) return ac.path[ac.path.length - 1];
  let best = 0, bd = Infinity;
  for (const n of apt.nodes) { const d = dist(n, ac); if (d < bd) { bd = d; best = n.id; } }
  return best;
}
function nearestOf(nodes: { x: number; y: number }[], p: { x: number; y: number }, ids: number[]) {
  // Prefer continuing to the node ahead so the aircraft doesn't U-turn.
  return dist(nodes[ids[1]], p) < 5 ? ids[1] : ids[1];
}

export function validate(world: World, st: State, seat: SeatId, ac: Aircraft | undefined, c: Command): string | null {
  if (!ac) return `${c.cs}: not on frequency`;
  if (ac.freq !== seat) return `${ac.cs} is not on your frequency`;
  const role = seatRole(seat);
  if (!ROLE_VERBS[role].includes(c.verb)) return `${role} can't give that instruction`;
  const apt = aptOf(world, ac);
  const air = AIR.has(ac.phase) && !ac.onGround;
  switch (c.verb) {
    case 'clearance': return ac.kind === 'dep' && ac.phase === 'stand' && !ac.cleared.dl ? null : `${ac.cs} doesn't need a clearance`;
    case 'push': return ac.phase === 'stand' && ac.cleared.dl && !ac.cleared.push ? null : !ac.cleared.dl ? `${ac.cs} has no clearance yet` : `${ac.cs} can't push now`;
    case 'taxi': case 'greens': {
      if (!TAXI.has(ac.phase) && ac.phase !== 'parked') return ac.phase === 'stand' ? `${ac.cs} needs pushback first` : `${ac.cs} isn't taxiing`;
      const tgt = taxiTarget(world, ac, c.to || (ac.kind === 'dep' ? ac.runway! : ac.stand ?? ''));
      if (tgt === null) return `Unknown taxi limit ${c.to}`;
      const r = route(apt, routeStart(world, ac), tgt, { via: c.verb === 'taxi' ? c.via : [], penalty: flowPenalty(st, apt, ac), hdg: startHdg(ac) });
      return r ? null : `No route to ${c.to}`;
    }
    case 'holdshort': case 'continue': case 'giveway': return ac.onGround && (TAXI.has(ac.phase) || ac.phase === 'pushing') ? null : `${ac.cs} isn't taxiing`;
    case 'cross': {
      if (!ac.onGround) return `${ac.cs} is airborne`;
      const rw = apt.runways.find(r => r.ends.includes(c.runway) || r.name === c.runway);
      if (!rw) return `Unknown runway ${c.runway}`;
      // A ground controller has to coordinate crossings with an AI tower.
      if (role === 'GND' && !st.coverage.includes(seatId(ac.apt, 'TWR')) && !runwayFree(world, st, ac.apt, rw.name, 70))
        return `Tower: unable crossing ${rw.name} now, traffic`;
      return null;
    }
    case 'luw': return ac.kind === 'dep' && ac.phase === 'holding' && !ac.cleared.luw ? null : `${ac.cs} isn't at the holding point`;
    case 'cto': return ac.kind === 'dep' && ['holding', 'lineup', 'lined'].includes(ac.phase) && !ac.cleared.cto ? null : `${ac.cs} can't take off now`;
    case 'land': return ac.kind === 'arr' && air && !ac.cleared.land && (ac.nav.established || ac.phase === 'final') ? null : ac.cleared.land ? `${ac.cs} already cleared` : `${ac.cs} isn't established on final`;
    case 'goaround': return ac.kind === 'arr' && air && ac.phase !== 'goaround' ? null : `${ac.cs} can't go around now`;
    case 'heading': case 'alt': case 'speed': return air || ac.phase === 'climb' ? (c.verb === 'alt' && (c.alt < 2000 || c.alt > 41000) ? 'Altitude out of range' : c.verb === 'speed' && c.kt !== null && (c.kt < TYPES[ac.type].vapp || c.kt > 340) ? `Speed out of range for a ${ac.type}` : null) : `${ac.cs} is on the ground`;
    case 'direct': case 'hold': return air ? (apt.fixes[c.fix] ? null : `Unknown fix ${c.fix}`) : `${ac.cs} is on the ground`;
    case 'ils': return ac.kind === 'arr' && air ? (apt.ends[c.runway] ? null : `Unknown runway ${c.runway}`) : `${ac.cs} can't be cleared for the ILS`;
    case 'contact': {
      if (!nextSeats(ac).includes(c.seat)) {
        const want = nextSeats(ac)[0];
        return want ? `${ac.cs} should go to ${want === 'LON' ? 'London Control' : want} next` : `${ac.cs} stays with you`;
      }
      return null;
    }
    case 'negative': return ac.last.length ? null : 'Nothing to correct';
    case 'unable': return ac.req ? null : `${ac.cs} has no request`;
    case 'resume': return air && (ac.sid || ac.star) ? null : `${ac.cs} has no route to resume`;
    case 'sayagain': return null;
  }
}

/** Is a runway clear of landing/departing traffic for the next `secs` seconds? */
export function runwayFree(world: World, st: State, icao: string, pair: string, secs: number, at?: { x: number; y: number }): boolean {
  const apt = world.byIcao[icao];
  for (const o of st.aircraft) {
    if (o.apt !== icao || !o.runway || apt.ends[o.runway]?.runway !== pair) continue;
    const end = apt.ends[o.runway];
    // A take-off or landing roll that has already passed the crossing point is no obstacle.
    const passed = at && (o.phase === 'takeoff' || o.phase === 'landing') && o.s > along(end, at) + 80;
    if ((o.phase === 'takeoff' || o.phase === 'landing') && !passed) return false;
    if ((o.phase === 'lined' || o.phase === 'lineup') && (o.cleared.cto || !at)) return false;
    if ((o.phase === 'final' || o.nav.established) && !o.onGround) {
      const end = apt.ends[o.runway];
      const toThr = dist(o, end.thr) / NM;
      if (toThr / Math.max(120, o.gs) * 3600 < secs) return false;
    }
  }
  for (const o of st.aircraft) if (o.apt === icao && o.onGround && runwayAt(apt, o) === pair && o.phase !== 'holding') return false;
  return true;
}

/** Fill in the display fields the sim knows (wind, QNH, frequency, defaults). */
function enrich(world: World, st: State, ac: Aircraft, c: Command): Command {
  const apt = aptOf(world, ac);
  switch (c.verb) {
    case 'cto': case 'land': return { ...c, runway: c.runway || ac.runway!, wind: { ...st.weather.wind } };
    case 'luw': return { ...c, runway: c.runway || ac.runway! };
    case 'alt': return { ...c, climb: c.alt > ac.alt, ...(c.alt <= apt.pack.transitionAltFt ? { qnh: st.weather.qnh } : {}) };
    case 'contact': {
      const icao = c.seat === 'LON' ? apt.icao : ac.apt;
      const f = world.byIcao[icao].freq[c.seat];
      return { ...c, unit: f?.callsign ?? 'London Control', freq: f?.freq ?? '134.125' };
    }
    case 'clearance': {
      const sid = c.sid || ac.sid || '';
      const s = sidFor(apt, sid);
      return { ...c, sid, dest: ac.other, alt: c.alt || s?.initialAltFt || 6000, squawk: c.squawk || ac.squawk || newSquawk(st) };
    }
    case 'taxi': case 'greens': {
      const to = c.to || (ac.kind === 'dep' ? ac.runway! : ac.stand ?? '');
      const tgt = taxiTarget(world, ac, to)!;
      // A route drawn by the player on the map is used as given if it's continuous and ends at the limit.
      const given = c.nodes && c.nodes.length > 1 && c.nodes[c.nodes.length - 1] === tgt && c.nodes.every((n, i) => i === 0 || apt.adj[c.nodes![i - 1]]?.some(a => a.to === n)) ? c.nodes : null;
      const nodes = given ?? route(apt, routeStart(world, ac), tgt, { via: c.verb === 'taxi' ? c.via : [], penalty: flowPenalty(st, apt, ac), hdg: startHdg(ac) })!;
      const via = c.verb === 'taxi' && c.via.length ? c.via : viaNames(apt, nodes);
      return c.verb === 'taxi' ? { ...c, to, via, nodes } : { ...c, to, nodes };
    }
    case 'cross': {
      const rw = apt.runways.find(r => r.ends.includes(c.runway) || r.name === c.runway)!;
      return { ...c, runway: c.runway.includes('/') ? rw.ends[0] : c.runway };
    }
    default: return c;
  }
}

/** Make a plausible wrong readback of one instruction (the readback-error mechanic). */
function corrupt(st: State, c: Command): Command | null {
  const r = rand(st);
  switch (c.verb) {
    case 'heading': return { ...c, hdg: ((c.hdg + (r < 0.5 ? 20 : 340) + 360) % 360) || 360 };
    case 'alt': return { ...c, alt: c.alt + (r < 0.5 ? 1000 : -1000) };
    case 'speed': return c.kt ? { ...c, kt: c.kt + (r < 0.5 ? 20 : -20) } : null;
    case 'clearance': return { ...c, squawk: c.squawk.slice(0, 3) + String((+c.squawk[3] + 1) % 8) };
    default: return null;
  }
}

export interface IssueOpts { auto?: boolean; voice?: boolean; light?: boolean }

/** Transmit one controller message (one or more instructions to one aircraft). Returns an error, or null. */
export function issue(world: World, st: State, seat: SeatId, cmds: Command[], opts: IssueOpts = {}): string | null {
  if (!cmds.length || st.ended) return 'Nothing to send';
  const ac = find(st, cmds[0].cs);
  for (const c of cmds) { const e = validate(world, st, seat, ac, c); if (e) return e; }
  // Already said, waiting for the readback.
  if (ac && !opts.auto && cmds.some(c => c.verb !== 'sayagain' && c.verb !== 'negative' && st.pending.some(q => q.cs === ac.cs && q.apply?.some(a => a.verb === c.verb)))) return `${ac.cs}: waiting for the readback`;
  const a = ac!;
  const out = cmds.map(c => enrich(world, st, a, c));
  if (!opts.auto) st.cmdLog.push({ tick: st.tick, seat, cmds, ...(opts.voice ? { voice: true } : {}) });
  const nordo = a.emergency?.code === '7600';
  transmit(st, seat, a.cs, { t: 'atc', cmds: out }, { auto: opts.auto, light: nordo });
  // Answering a pending request clears it.
  if (a.req) a.req = null;

  if (out.some(c => c.verb === 'negative')) {
    if (a.rbErr) { st.stats.readbackCaught++; const right = a.rbErr.right; a.rbErr = null; schedule(st, a, seat, { t: 'readback', cmds: [right] }, [right], 1.5); }
    else schedule(st, a, seat, { t: 'readback', cmds: a.last }, [], 1.5);
    return null;
  }
  if (out.some(c => c.verb === 'sayagain')) {
    const lastCall = [...st.radio].reverse().find(r => r.cs === a.cs && r.from === 'pilot');
    if (lastCall) schedule(st, a, seat, lastCall.msg, undefined, 1.2);
    return null;
  }
  if (nordo && seatRole(seat) !== 'TWR' && seatRole(seat) !== 'GND') return null; // no reply, no effect
  a.last = out;
  let heard = out;
  if (!opts.auto && !nordo && st.difficulty.readbackErrors > 0 && rand(st) < st.difficulty.readbackErrors) {
    const i = out.findIndex(c => corrupt(st, c) !== null);
    if (i >= 0) {
      const wrong = corrupt(st, out[i])!;
      heard = out.map((c, j) => (j === i ? wrong : c));
      a.rbErr = { right: out[i], wrong, until: st.tick + ticks(18) };
    }
  }
  // The pilot acts once they've read back; nothing moves before that.
  a.actAt = Number.MAX_SAFE_INTEGER;
  const delay = opts.auto ? 1 + rand(st) : 1.5 + rand(st) * 2;
  schedule(st, a, seat, { t: 'readback', cmds: heard }, heard, delay, nordo);
  return null;
}

function schedule(st: State, ac: Aircraft, seat: SeatId, msg: Msg, apply: Command[] | undefined, delayS: number, light = false) {
  st.pending.push({ tick: st.tick + ticks(delayS), cs: ac.cs, seat, msg, apply, light });
}

export function transmit(st: State, seat: SeatId, cs: string, msg: Msg, o: { auto?: boolean; light?: boolean } = {}) {
  const role = seatRole(seat);
  st.radio.push({ id: ++st.radioId, tick: st.tick, airport: seatApt(seat) ?? 'LON', seat: role, cs, from: msg.t === 'atc' ? 'atc' : 'pilot', msg, ...(o.auto ? { auto: true } : {}), ...(o.light ? { light: true } : {}) });
  (st.radio as unknown as { seatId?: string }[])[st.radio.length - 1].seatId = seat;
  if (st.radio.length > 400) st.radio.splice(0, st.radio.length - 400);
  if (!o.auto) st.stats.transmissions++;
}

export function pilotCall(st: State, ac: Aircraft, call: PilotCall, delayS = 0) {
  if (ac.emergency?.code === '7600' && call.k !== 'mayday') return;
  if (delayS) st.pending.push({ tick: st.tick + ticks(delayS), cs: ac.cs, seat: ac.freq, msg: { t: 'call', call } });
  else transmit(st, ac.freq, ac.cs, { t: 'call', call });
}

/** Deliver due pilot transmissions and apply instructions as they're read back. */
export function deliverPending(world: World, st: State) {
  const due = st.pending.filter(p => p.tick <= st.tick);
  if (!due.length) return;
  st.pending = st.pending.filter(p => p.tick > st.tick);
  for (const p of due) {
    const ac = find(st, p.cs);
    if (!ac) continue;
    if (p.msg.t === 'call' && p.msg.call.k === 'checkin' && ac.freq !== p.seat) continue;
    transmit(st, p.seat, p.cs, p.msg, { light: p.light });
    if (p.msg.t === 'call') ac.checkedIn = true;
    if (p.apply) { ac.actAt = st.tick; for (const c of p.apply) apply(world, st, ac, c); }
  }
}

/** The pilot carries out an instruction. */
export function apply(world: World, st: State, ac: Aircraft, c: Command) {
  const apt = aptOf(world, ac);
  const as = aptState(st, ac.apt);
  switch (c.verb) {
    case 'clearance':
      ac.cleared.dl = true; ac.squawk = c.squawk; if (c.sid) ac.sid = c.sid;
      // "When ready, contact Ground": the crew calls Ground for push once their turnaround is done.
      ac.freq = ac.owner = seatId(ac.apt, 'GND'); ac.checkedIn = false;
      pilotCall(st, ac, { k: 'push', stand: ac.stand ?? '' }, 25 + rand(st) * 90);
      break;
    case 'push':
      ac.cleared.push = true; ac.face = c.face ?? null;
      ac.phase = 'pushing'; ac.offBlockAt = st.tick;
      ac.path = [apt.standByRef[ac.stand!].node, apt.standByRef[ac.stand!].pushNode]; ac.pi = 1;
      if (ac.stand) delete as.standOcc[ac.stand];
      break;
    case 'taxi': case 'greens': {
      const nodes = c.nodes ?? [];
      ac.path = nodes; ac.pi = nodes.length > 1 ? 1 : 0;
      ac.cleared.taxi = true; ac.cleared.greens = c.verb === 'greens';
      ac.holdAt = null;
      if (c.verb === 'taxi' && c.holdShort && !apt.ends[c.holdShort]) {
        const n = apt.nodes.find(x => x.hold === c.holdShort);
        if (n && nodes.includes(n.id)) ac.holdAt = n.id;
      }
      if (ac.phase === 'pushed' || ac.phase === 'holding') ac.phase = ac.kind === 'dep' ? 'taxi' : 'taxiin';
      if (ac.phase === 'parked') ac.phase = 'taxiin';
      if (ac.kind === 'dep' && apt.ends[c.to]) ac.runway = c.to;
      break;
    }
    case 'holdshort': {
      const n = apt.nodes.find(x => x.hold === c.at) ?? null;
      if (n && ac.path.includes(n.id)) ac.holdAt = n.id;
      else {
        // Hold short of a runway: stop at the last node before it.
        const end = apt.ends[c.at] ?? null;
        const pair = end?.runway ?? apt.runways.find(r => r.name === c.at)?.name;
        if (pair) ac.cleared.cross = ac.cleared.cross.filter(r => r !== pair);
        else if (ac.pi < ac.path.length) ac.holdAt = ac.path[ac.pi];
      }
      break;
    }
    case 'continue': ac.holdAt = null; ac.actAt = st.tick + ticks(2); break;
    case 'giveway': ac.holdAt = ac.pi < ac.path.length ? ac.path[ac.pi] : null; ac.blockedBy = c.other; break;
    case 'cross': {
      const rw = apt.runways.find(r => r.ends.includes(c.runway) || r.name === c.runway);
      if (rw) ac.cleared.cross.push(rw.name);
      ac.holdAt = null;
      break;
    }
    case 'luw': ac.cleared.luw = true; ac.runway = c.runway || ac.runway; if (ac.phase === 'holding') { ac.phase = 'lineup'; claimDep(world, ac); } break;
    case 'cto':
      ac.cleared.cto = true; ac.runway = c.runway || ac.runway;
      if (ac.phase === 'holding') { ac.phase = 'lineup'; claimDep(world, ac); }
      ac.actAt = st.tick + ticks(3 + rand(st) * 4);
      break;
    case 'land': ac.cleared.land = true; if (c.runway) ac.runway = c.runway; break;
    case 'goaround': goAround(world, st, ac, false); break;
    case 'heading': ac.nav.mode = 'hdg'; ac.nav.hold = undefined; ac.tgtHdg = c.hdg % 360; ac.turn = c.turn ?? null; if (ac.nav.established && !ac.cleared.land) { ac.nav.established = false; ac.nav.gs = false; if (ac.phase === 'final') ac.phase = 'approach'; } break;
    case 'alt': ac.tgtAlt = c.alt; break;
    case 'speed': ac.tgtSpd = c.kt; break;
    case 'direct': {
      const i = ac.nav.route.indexOf(c.fix);
      ac.nav.mode = 'route'; ac.nav.hold = undefined;
      ac.nav.route = i >= 0 ? ac.nav.route.slice(i) : [c.fix];
      if (ac.kind === 'arr' && c.fix === ac.stack && ac.phase === 'stack') ac.phase = 'arrival';
      break;
    }
    case 'hold': enterHold(world, st, ac, c.fix); ac.nav.hold!.leg = 'entry'; ac.nav.route = []; break;
    case 'ils': ac.nav.ils = c.runway; ac.runway = c.runway; if (ac.phase === 'stack' || ac.phase === 'arrival') ac.phase = 'approach'; break;
    case 'contact': {
      const to = c.seat === 'LON' ? 'LON' : seatId(ac.apt, c.seat);
      ac.freq = to; ac.checkedIn = false; ac.handAt = st.tick;
      initialCall(world, st, ac, 3 + rand(st) * 4);
      break;
    }
    case 'resume': {
      if (ac.kind === 'dep' && ac.sid) {
        const sid = sidFor(apt, ac.sid);
        if (sid) { ac.nav.mode = 'route'; ac.nav.route = sid.fixes.filter(f => dist(apt.fixes[f], ac) > 2000); }
      } else if (ac.stack) { ac.nav.mode = 'route'; ac.nav.route = [ac.stack]; }
      break;
    }
    default: break;
  }
}

/** Taking the runway: record the departure order for wake/route spacing checks. */
function claimDep(world: World, ac: Aircraft) {
  const apt = aptOf(world, ac);
  const pair = apt.ends[ac.runway!].runway;
  ac.path = lineupPath(apt, ac); ac.pi = ac.path.length > 1 ? 1 : 0;
  if (!ac.cleared.cross.includes(pair)) ac.cleared.cross.push(pair);
  ac.holdAt = null;
}

export function goAround(world: World, st: State, ac: Aircraft, pilotInitiated: boolean) {
  const apt = aptOf(world, ac);
  const end = apt.ends[ac.runway!];
  ac.phase = 'goaround'; ac.onGround = false;
  ac.nav = { mode: 'hdg', route: [], established: false, gs: false };
  ac.tgtHdg = end.hdgTrue; ac.turn = null; ac.tgtAlt = 3000; ac.tgtSpd = null;
  ac.cleared.land = false; ac.goArounds++;
  st.stats.goArounds++;
  if (pilotInitiated) pilotCall(st, ac, { k: 'goingaround' });
}

/** First call on a new frequency. Ownership moves when the pilot checks in. */
export function initialCall(world: World, st: State, ac: Aircraft, delayS: number) {
  const role = seatRole(ac.freq);
  const apt = aptOf(world, ac);
  const as = aptState(st, ac.apt);
  let call: PilotCall;
  if (role === 'DEL') call = { k: 'clearance', stand: ac.stand ?? '', type: ac.type, atis: st.weather.atis, dest: ac.other };
  else if (role === 'GND') call = ac.kind === 'dep' ? { k: 'push', stand: ac.stand ?? '' } : { k: 'vacated', runway: ac.runway ?? '', stand: ac.stand ?? undefined };
  else if (role === 'TWR') call = ac.kind === 'dep'
    ? { k: 'ready', hold: holdName(world, ac), runway: ac.runway ?? '' }
    : { k: 'checkin', alt: Math.round(ac.alt / 100) * 100, nm: Math.round(dist(ac, apt.ends[ac.runway!].thr) / NM), runway: ac.runway ?? '' };
  else call = { k: 'checkin', alt: Math.round(ac.alt / 100) * 100, cleared: ac.tgtAlt, route: ac.kind === 'dep' ? ac.sid ?? undefined : ac.star ?? undefined, atis: st.weather.atis, hdg: ac.nav.mode === 'hdg' ? Math.round(ac.tgtHdg ?? ac.hdg) : undefined };
  st.pending.push({ tick: st.tick + ticks(delayS), cs: ac.cs, seat: ac.freq, msg: { t: 'call', call } });
  void as;
}

export function holdName(world: World, ac: Aircraft): string {
  const apt = aptOf(world, ac);
  const last = ac.path[ac.path.length - 1];
  return apt.nodes[last]?.hold ?? ac.runway ?? '';
}

/** Ownership change once the pilot has checked in on the new frequency. */
export function settleOwnership(st: State) {
  for (const ac of st.aircraft) if (ac.freq !== ac.owner && ac.checkedIn) ac.owner = ac.freq;
}

export const DTS = DT;
