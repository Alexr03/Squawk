// Rules and scoring events: runway occupancy, air separation, wake, STCA prediction, handoff timing, requests, readbacks.
import { TYPES } from './aircraft.ts';
import { crash } from './incidents.ts';
import { appSpacing, depGap } from './ai.ts';
import { angleDiff, dist, NM } from './geo.ts';
import { aptOf, aptState, elevation } from './physics.ts';
import { initialCall, nextSeats, pilotCall } from './pilot.ts';
import { DT, rand, seatId, seatRole, ticks, type Aircraft, type ScoreEvent, type State } from './state.ts';
import type { Seat } from './types.ts';
import { project, type Pt } from './predict.ts';
import { along, lateral, runwayAt, type World } from './world.ts';

/** Is the player responsible for any of these aircraft (working them on one of their seats)? */
export function blame(st: State, cs: string[]): boolean {
  return cs.some(c => { const a = st.aircraft.find(x => x.cs === c); return !!a && st.coverage.includes(a.owner); });
}
/** Count a penalty statistic only when the player is responsible. */
export function penal(st: State, cs: string[], key: keyof State['stats']) { if (blame(st, cs)) (st.stats[key] as number)++; }

export function event(st: State, e: Omit<ScoreEvent, 'tick'>) {
  st.events.push({ tick: st.tick, ...e, ...(blame(st, e.cs) ? {} : { ai: true }) } as ScoreEvent);
  st.alerts.push({ tick: st.tick, level: e.severity >= 3 ? 'conflict' : 'caution', text: e.text, cs: e.cs[0] });
}

/** Lined-up aircraft with take-off clearance start rolling: check runway and departure spacing. */
export function startRolls(world: World, st: State) {
  for (const ac of st.aircraft) {
    if (ac.phase !== 'lined' || !ac.cleared.cto || ac.halted || st.tick < ac.actAt) continue;
    const apt = aptOf(world, ac), as = aptState(st, ac.apt);
    const pair = apt.ends[ac.runway!].runway;
    const blocker = st.aircraft.find(o => o !== ac && ((o.runway && apt.ends[o.runway]?.runway === pair && (o.phase === 'takeoff' || o.phase === 'landing')) || (o.onGround && o.phase !== 'holding' && o.phase !== 'lineup' && runwayAt(apt, o) === pair)));
    if (blocker) {
      penal(st, [ac.cs, blocker.cs], 'runwayLoss');
      event(st, { kind: 'runway', severity: 4, text: `Runway ${pair}: ${ac.cs} rolling with ${blocker.cs} on the runway`, cs: [ac.cs, blocker.cs], x: ac.x, y: ac.y });
    } else {
      const gap = depGap(world, st, ac);
      if (st.difficulty.depGaps && gap > 0 && gap !== Infinity) {
        penal(st, [ac.cs], 'wakeInf');
        event(st, { kind: 'wake', severity: 2, text: `${ac.cs} departed ${Math.ceil(gap)} s inside the required gap behind ${as.lastDep[ac.runway!]?.cs}`, cs: [ac.cs], x: ac.x, y: ac.y });
      }
    }
    as.lastDep[ac.runway!] = { cs: ac.cs, wake: ac.wake, sid: ac.sid, at: null };
    ac.phase = 'takeoff'; ac.ias = 0; ac.gs = 0;
    st.stats.depDelayS += Math.max(0, st.start + st.tick * DT - ac.sched - 120);
  }
}

/** Touchdown / go-around decision at the threshold. */
export function thresholdCheck(world: World, st: State, ac: Aircraft) {
  if (ac.phase !== 'final' || !ac.nav.established || ac.onGround) return null;
  const apt = aptOf(world, ac), end = apt.ends[ac.runway!];
  const toThr = end.thrS - ((ac.x - end.end.x) * end.ux + (ac.y - end.end.y) * end.uy);
  const closed = (aptState(st, ac.apt).closed[end.runway] ?? 0) > st.tick;
  if (!ac.cleared.land && toThr < 0.5 * NM && ac.emergency?.code !== '7600') return 'no-clearance';
  if (toThr < 0.5 * NM && closed) return 'closed';
  if (toThr <= 0) {
    if (!ac.cleared.land) return 'no-clearance';
    const busy = st.aircraft.find(o => o !== ac && o.onGround && runwayAt(apt, o) === end.runway && o.phase !== 'holding');
    if (busy) {
      penal(st, [ac.cs, busy.cs], 'runwayLoss');
      event(st, { kind: 'runway', severity: 4, text: `Runway ${end.runway}: ${ac.cs} landed with ${busy.cs} on the runway`, cs: [ac.cs, busy.cs], x: ac.x, y: ac.y });
    }
    // Touchdown.
    ac.phase = 'landing'; ac.onGround = true; ac.alt = elevation(apt); ac.vs = 0;
    ac.s = Math.max(end.thrS, (ac.x - end.end.x) * end.ux + (ac.y - end.end.y) * end.uy);
    ac.landedAt = st.tick; ac.nav.ils = undefined; ac.nav.established = false; ac.nav.gs = false;
    st.stats.holdS += ac.holdS;
    st.stats.landed++;
    st.stats.arrDelayS += Math.max(0, st.start + st.tick * DT - ac.sched - 180);
    if (ac.emergency) { st.stats.emergenciesHandled++; }
    return 'landed';
  }
  return null;
}

// ------------------------------------------------------------------ separation

const RVSM = 1000;
export function separation(world: World, st: State) {
  const air = st.aircraft.filter(a => !a.onGround && a.phase !== 'gone');
  const live = new Set<string>();
  const stca: State['stca'] = {};
  const paths = new Map<string, Pt[]>();
  const path = (a: Aircraft) => { let p = paths.get(a.cs); if (!p) paths.set(a.cs, p = project(world, a, 120, 10)); return p; };
  for (const a of air) a.alert = a.emergency ? 'emergency' : 'none';
  for (let i = 0; i < air.length; i++) for (let j = i + 1; j < air.length; j++) {
    const a = air[i], b = air[j];
    if (a.phase === 'gone' || b.phase === 'gone') continue; // already collided this tick
    const d = dist(a, b), dv = Math.abs(a.alt - b.alt);
    if (d > 12 * NM) continue;
    const key = a.cs < b.cs ? `${a.cs}|${b.cs}` : `${b.cs}|${a.cs}`;
    // An actual mid-air: wingspans overlapping (allowing for how far the pair closes in one tick), not merely too close.
    if (d < 90 + (a.gs + b.gs) * 0.514 * DT && dv < 120) {
      penal(st, [a.cs, b.cs], 'collisions');
      crash(world, st, a, b, true);
      continue;
    }
    const lost = (text: string) => {
      live.add(key);
      stca[key] = 'conflict'; mark(a, 'conflict'); mark(b, 'conflict');
      if (key in st.sepActive) return;
      st.sepActive[key] = st.tick;
      penal(st, [a.cs, b.cs], 'sepLoss');
      event(st, { kind: 'seploss', severity: 4, text: `${text}: ${a.cs} and ${b.cs}, ${(d / NM).toFixed(1)} nm / ${Math.round(dv / 100) * 100} ft`, cs: [a.cs, b.cs], x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    };
    const aptA = aptOf(world, a);
    // Arrivals on the same final: wake spacing, closing up, overlapping. Checked even low and close in (the Tower's domain).
    const end = onFinal(world, a) && onFinal(world, b) && a.runway === b.runway && a.apt === b.apt ? aptA.ends[a.runway!] : null;
    if (end) {
      const [lead, follow] = dist(a, end.thr) < dist(b, end.thr) ? [a, b] : [b, a];
      const need = appSpacing(lead.wake, follow.wake, false) * NM - 0.25 * NM;
      const wkey = `${lead.cs}|${follow.cs}|w`;
      if (d < NM && dv < RVSM - 500) lost('Too close on final');
      else if (d < need) {
        live.add(wkey);
        if (!(wkey in st.sepActive)) { st.sepActive[wkey] = st.tick; if (st.coverage.includes(seatId(a.apt, 'DIR'))) penal(st, [follow.cs, lead.cs], 'wakeInf'); event(st, { kind: 'wake', severity: 2, text: `Wake spacing: ${follow.cs} ${(d / NM).toFixed(1)} nm behind ${lead.cs} (needs ${(need / NM + 0.25).toFixed(0)} nm)`, cs: [follow.cs, lead.cs], x: follow.x, y: follow.y }); }
        stca[wkey] = 'caution'; mark(follow, 'caution');
      } else if (predictConflict(path(lead), path(follow), need, false)) { stca[wkey] = 'caution'; mark(follow, 'caution'); }
      continue;
    }
    // Tower's domain: both low and close to the same airport (parallel runway operations are independent).
    const elev = elevation(aptA);
    if (a.apt === b.apt && a.alt - elev < 2600 && b.alt - elev < 2600 && dist(a, aptA.offset) < 7 * NM && dist(b, aptOf(world, b).offset) < 7 * NM) continue;
    const inTma = dist(a, world.primary.offset) < world.primary.pack.airspace.tmaRadiusNm * NM;
    const req = (inTma ? 3 : 5) * NM;
    if (d < req && dv < RVSM - 100) {
      // Moving apart, or both in the same hold: a caution, not a new loss (one already counted stays counted).
      const va = vel(a), vb = vel(b), apart = (b.x - a.x) * (vb.x - va.x) + (b.y - a.y) * (vb.y - va.y) >= 0;
      const sameHold = a.nav.mode === 'hold' && b.nav.mode === 'hold' && a.nav.hold?.fix === b.nav.hold?.fix;
      if (apart || sameHold) {
        stca[key] = 'caution'; mark(a, 'caution'); mark(b, 'caution');
        if (key in st.sepActive) live.add(key);
      } else lost('Separation lost');
    } else if (predictConflict(path(a), path(b), req, true)) {
      stca[key] = 'caution'; mark(a, 'caution'); mark(b, 'caution');
    }
  }
  for (const k of Object.keys(st.sepActive)) if (!live.has(k) && !k.endsWith('|g')) delete st.sepActive[k];
  st.stca = stca;
}
function mark(a: Aircraft, level: 'caution' | 'conflict') {
  if (a.alert === 'emergency' || a.alert === 'conflict') return;
  a.alert = level;
}
/** On (or joining) the final approach to its runway: established, or lined up on it inside 15 nm. */
function onFinal(world: World, a: Aircraft) {
  if (a.kind !== 'arr' || !a.runway) return false;
  if (a.nav.established || a.phase === 'final') return true;
  const end = aptOf(world, a).ends[a.runway], toThr = end.thrS - along(end, a);
  return a.nav.ils === a.runway && toThr > 0 && toThr < 15 * NM && Math.abs(lateral(end, a)) < 0.5 * NM && Math.abs(angleDiff(a.trk, end.hdgTrue)) < 45;
}
/** Along both projected paths (every 10 s for 2 minutes): will they come closer than the minimum? */
function predictConflict(pa: Pt[], pb: Pt[], req: number, vertical: boolean): boolean {
  for (let k = 0; k < Math.min(pa.length, pb.length); k++) {
    if (Math.hypot(pa[k].x - pb[k].x, pa[k].y - pb[k].y) < req && (!vertical || Math.abs(pa[k].alt - pb[k].alt) < RVSM - 100)) return true;
  }
  return false;
}
const vel = (a: Aircraft) => ({ x: Math.sin(a.trk * Math.PI / 180) * a.gs * NM / 3600, y: Math.cos(a.trk * Math.PI / 180) * a.gs * NM / 3600 });

/** Ground: runway occupancy losses, ground collisions, taxi gridlock. */
export function groundRules(world: World, st: State) {
  const gnd = st.aircraft.filter(a => a.onGround && a.phase !== 'gone' && a.phase !== 'parked' && a.phase !== 'stand');
  for (let i = 0; i < gnd.length; i++) for (let j = i + 1; j < gnd.length; j++) {
    const a = gnd[i], b = gnd[j];
    if (a.apt !== b.apt) continue;
    const d = dist(a, b);
    if (d > 120) continue;
    const ta = TYPES[a.type], tb = TYPES[b.type];
    const fast = a.gs > 30 || b.gs > 30;
    if (a.ghost === b.cs || b.ghost === a.cs) { if (d > 160) { if (a.ghost === b.cs) a.ghost = null; if (b.ghost === a.cs) b.ghost = null; } continue; }
    // AI-only contact on the ground is a background glitch, not the player's incident.
    const playerInvolved = st.coverage.includes(a.owner) || st.coverage.includes(b.owner);
    if (playerInvolved && d < Math.min(ta.lengthM, tb.lengthM) * 0.45 && (a.gs > 3 || b.gs > 3)) {
      penal(st, [a.cs, b.cs], 'collisions');
      crash(world, st, a, b, false);
      return;
    }
    const gkey = `${a.cs}|${b.cs}|g`;
    // Stuck on each other: both stopped a while, each waiting for the other (not just a moment's wait while one rolls past).
    const stuck = a.blockedBy === b.cs && b.blockedBy === a.cs && a.stoppedS >= 10 && b.stoppedS >= 10;
    if (!stuck && gkey in st.sepActive) delete st.sepActive[gkey];
    if (stuck) {
      const key = `${a.cs}|${b.cs}|g`;
      if (!(key in st.sepActive)) {
        st.sepActive[key] = st.tick;
        penal(st, [a.cs, b.cs], 'taxiConflicts');
        event(st, { kind: 'taxi-conflict', severity: 1, text: `Taxi conflict: ${a.cs} and ${b.cs} nose to nose`, cs: [a.cs, b.cs], x: a.x, y: a.y });
      } else if (st.tick - st.sepActive[key] === ticks(120)) {
        event(st, { kind: 'gridlock', severity: 2, text: `Gridlock: ${a.cs} and ${b.cs} stuck for two minutes`, cs: [a.cs, b.cs], x: a.x, y: a.y });
      }
    }
    void fast;
  }
}

// ------------------------------------------------------------------ handoffs and radio discipline

/** Which seat should be working this aircraft right now. */
export function domain(world: World, st: State, ac: Aircraft): Seat {
  const apt = aptOf(world, ac);
  const elev = elevation(apt);
  if (ac.kind === 'dep') {
    if (ac.phase === 'stand' && !ac.cleared.dl) return 'DEL';
    if (['stand', 'pushing', 'pushed'].includes(ac.phase)) return 'GND';
    if (ac.phase === 'taxi') return remainingTaxi(world, ac) < 160 ? 'TWR' : 'GND';
    if (ac.phase === 'climb') return ac.alt - elev < 1500 && dist(ac, apt.offset) < 8 * NM ? 'TWR' : 'LON';
    return 'TWR';
  }
  switch (ac.phase) {
    case 'arrival': return ac.stack && dist(ac, apt.fixes[ac.stack]) > 24 * NM && ac.alt > 11000 ? 'LON' : 'DIR';
    case 'stack': case 'approach': return 'DIR';
    case 'final': return dist(ac, apt.ends[ac.runway!].thr) < 10 * NM ? 'TWR' : 'DIR';
    case 'landing': case 'vacating': return 'TWR';
    case 'goaround': return ac.alt - elev < 1800 ? 'TWR' : 'DIR';
    default: return 'GND';
  }
}
function remainingTaxi(world: World, ac: Aircraft) {
  const apt = aptOf(world, ac);
  let d = 0;
  for (let i = Math.max(1, ac.pi); i < ac.path.length; i++) d += dist(apt.nodes[ac.path[i - 1]], apt.nodes[ac.path[i]]);
  return d;
}

export function handoffs(world: World, st: State) {
  if (st.tick % 4 !== 0) return;
  for (const ac of st.aircraft) {
    if (ac.phase === 'gone' || ac.freq !== ac.owner) continue;
    const want = domain(world, st, ac);
    const curRole = seatRole(ac.owner);
    if (want === curRole) { ac.lateS = 0; continue; }
    const target = want === 'LON' ? 'LON' : seatId(ac.apt, want);
    const mineNow = st.coverage.includes(ac.owner), mineNext = st.coverage.includes(target);
    if (!nextSeats(ac).includes(want)) continue;
    // No handoffs to yourself: when you own both seats the aircraft just stays with you.
    if (mineNow && mineNext) { ac.owner = ac.freq = target; ac.checkedIn = true; continue; }
    if (ac.emergency?.code === '7600') { ac.owner = ac.freq = target; ac.checkedIn = true; continue; }
    if (!mineNow) continue; // AI seats hand off on their own
    ac.lateS += 4 * DT;
    if (ac.lateS === 30) st.alerts.push({ tick: st.tick, level: 'caution', text: `${ac.cs}: hand off to ${want === 'LON' ? 'London Control' : want}`, cs: ac.cs });
    if (ac.lateS === 75) {
      st.stats.lateHandoffs++;
      event(st, { kind: 'late-handoff', severity: 1, text: `Late handoff: ${ac.cs} should be with ${want === 'LON' ? 'London Control' : want}`, cs: [ac.cs] });
    }
  }
}

/** Early handoff check, run when a human gives a "contact" instruction. */
export function earlyHandoff(world: World, st: State, ac: Aircraft) {
  const want = domain(world, st, ac);
  if (want === seatRole(ac.owner)) {
    // Allow a sensible lead: Tower near the hold, Director->Tower established inside ~14 nm, etc.
    const apt = aptOf(world, ac);
    const ok = ac.kind === 'dep' ? (ac.phase === 'taxi' && remainingTaxi(world, ac) < 1500) || ac.phase === 'climb' || ac.phase === 'stand'
      : (ac.nav.established && dist(ac, apt.ends[ac.runway!].thr) < 16 * NM) || ac.phase === 'taxiin' || (ac.phase === 'arrival') || ac.phase === 'goaround';
    if (!ok) { st.stats.earlyHandoffs++; event(st, { kind: 'early-handoff', severity: 1, text: `Early handoff: ${ac.cs}`, cs: [ac.cs] }); }
  }
}

export function radioRules(world: World, st: State) {
  for (const ac of st.aircraft) {
    if (ac.rbErr && st.tick >= ac.rbErr.until) {
      st.stats.readbackMissed++;
      event(st, { kind: 'readback', severity: 2, text: `Missed readback error: ${ac.cs} read back the wrong ${ac.rbErr.wrong.verb === 'clearance' ? 'squawk' : ac.rbErr.wrong.verb}`, cs: [ac.cs] });
      ac.rbErr = null;
    }
    if (ac.req && st.tick - ac.req.at === ticks(45)) pilotCall(st, ac, ac.req.call);
    if (ac.req && st.tick - ac.req.at > ticks(90)) {
      st.stats.unanswered++;
      event(st, { kind: 'unanswered', severity: 1, text: `Unanswered request from ${ac.cs}`, cs: [ac.cs] });
      ac.req = null;
    }
    // Requests from aircraft on the player's frequencies.
    if (!ac.req && st.tick >= ac.nextReqAt && st.coverage.includes(ac.owner) && ac.checkedIn && !ac.onGround && !ac.emergency) {
      ac.nextReqAt = st.tick + ticks(600 + rand(st) * 1200);
      const apt = aptOf(world, ac);
      if (ac.kind === 'dep' && ac.phase === 'climb' && ac.alt > 5000 && seatRole(ac.owner) === 'LON' && rand(st) < 0.6) {
        const sid = apt.pack.airspace.sids.find(s => `${s.name}${s.designator}` === ac.sid);
        const end = sid?.fixes[sid.fixes.length - 1];
        const call = rand(st) < 0.5 && end && ac.nav.route.length > 1 ? { k: 'request' as const, what: 'direct' as const, fix: end } : { k: 'request' as const, what: 'climb' as const, alt: Math.max(ac.tgtAlt + 4000, 15000) };
        ac.req = { call, at: st.tick }; pilotCall(st, ac, call);
      } else if (ac.kind === 'arr' && ac.phase === 'arrival' && seatRole(ac.owner) === 'LON' && ac.alt > 12000 && rand(st) < 0.5) {
        const call = { k: 'request' as const, what: 'descend' as const, alt: Math.max(9000, ac.tgtAlt - 4000) };
        ac.req = { call, at: st.tick }; pilotCall(st, ac, call);
      }
    }
  }
  // Frequency congestion: more than ~12 player transmissions a minute.
  if (st.tick % ticks(60) === 0) {
    const recent = st.radio.filter(r => !r.auto && st.tick - r.tick < ticks(60) && r.from === 'atc').length;
    if (recent > 12) st.stats.congestedS += 60;
  }
}

/** Departure calls Tower when it reaches the holding point, arrivals call Ground once clear of the runway. */
export function arrivalCalls(world: World, st: State, ac: Aircraft, prevPhase: string) {
  if (ac.phase === prevPhase) return;
  if (ac.phase === 'holding' && seatRole(ac.freq) === 'TWR' && ac.checkedIn) pilotCall(st, ac, { k: 'ready', hold: ac.path.length ? aptOf(world, ac).nodes[ac.path[ac.path.length - 1]].hold ?? '' : '', runway: ac.runway ?? '' }, 2);
  if (ac.phase === 'taxiin' && prevPhase === 'vacating' && !ac.cleared.taxi) {
    // Stop clear of the runway until Ground gives a taxi clearance.
    ac.holdAt = ac.pi < ac.path.length ? ac.path[ac.pi] : null;
  }
  void initialCall;
}
