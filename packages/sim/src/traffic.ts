// Traffic: schedule from real day packs (or synthetic), SID/STAR choice by direction, stands, spawning.
import { TYPES } from './aircraft.ts';
import { AIRLINES } from './airlines.ts';
import { angleDiff, bearing, dist, fromBearing, NM } from './geo.ts';
import { DT, pick, rand, seatId, ticks, type Aircraft, type ShiftConfig, type Spawn, type State } from './state.ts';
import type { DayPack, XY } from './types.ts';
import { finalPoint, transition, type Apt, type World } from './world.ts';

// Rough bearing from London to a destination region, by ICAO prefix (longest match wins).
const REGION: Record<string, number> = {
  EGP: 345, EGN: 340, EGC: 330, EGA: 305, EGB: 320, EGH: 230, EGJ: 205, EGT: 255, EGG: 290, EGF: 280, EGS: 40, EGK: 180,
  EGM: 110, EGE: 345, EGGP: 320, EGGD: 270, EGHH: 235, EGNT: 345, EGPH: 345, EGPF: 340, EGAA: 305, EGAC: 305, EG: 320,
  EI: 290, BI: 320, BG: 320, EH: 80, EB: 100, ED: 90, ET: 90, LF: 160, LFP: 140, EL: 110, LS: 135, LO: 110, LK: 95, EP: 80,
  EK: 65, ES: 50, EN: 40, EF: 50, EE: 60, EV: 70, EY: 75, LE: 200, LP: 210, GC: 210, LI: 140, LM: 145, LG: 125, LT: 105,
  LH: 105, LR: 100, LB: 110, LW: 120, LY: 120, LD: 125, LJ: 125, LQ: 125, LC: 115, LL: 120, OJ: 120, OL: 115, OS: 110,
  OR: 105, OI: 95, OB: 110, OK: 110, OM: 105, OT: 108, OE: 120, OO: 105, OP: 85, VI: 90, VA: 92, VO: 95, VE: 85, VC: 95,
  VG: 80, VT: 80, VH: 60, WS: 85, WM: 85, WI: 85, RJ: 30, RO: 30, RK: 35, Z: 50, VV: 70, RP: 60, RC: 55, Y: 70, NZ: 60,
  U: 60, UT: 80, UB: 95, UG: 95, HE: 135, HA: 140, HK: 150, FA: 165, DN: 180, GM: 195, DT: 160, DA: 170, F: 165, H: 145,
  K: 290, KS: 315, KL: 315, C: 300, P: 330, M: 270, T: 255, S: 230, G: 195,
};
export function regionBearing(icao: string, st: State): number {
  for (let n = 4; n > 0; n--) { const b = REGION[icao.slice(0, n)]; if (b !== undefined) return b; }
  return rand(st) * 360;
}

export function chooseSid(apt: Apt, end: string, dest: string, st: State): string | null {
  const sids = apt.pack.airspace.sids.filter(s => s.runway === end);
  if (!sids.length) return null;
  const want = regionBearing(dest, st);
  const arp = { x: apt.offset.x, y: apt.offset.y };
  let best = sids[0], bd = 999;
  for (const s of sids) {
    const f = apt.fixes[s.fixes[s.fixes.length - 1]];
    const d = Math.abs(angleDiff(bearing(arp, f), want));
    if (d < bd) { bd = d; best = s; }
  }
  return `${best.name}${best.designator}`;
}
export function sidFor(apt: Apt, id: string) {
  return apt.pack.airspace.sids.find(s => `${s.name}${s.designator}` === id);
}
export function chooseStar(apt: Apt, origin: string, st: State) {
  const stars = apt.pack.airspace.stars;
  const want = regionBearing(origin, st);
  const arp = { x: apt.offset.x, y: apt.offset.y };
  let best = stars[0], bd = 999;
  for (const s of stars) {
    const d = Math.abs(angleDiff(bearing(arp, apt.fixes[s.fixes[0]]), want)) + rand(st) * 25; // spread between nearby STARs
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

// ------------------------------------------------------------------ schedule

const DEP_LEAD_S = 22 * 60;     // departures call for clearance this long before take-off
export function buildSchedule(world: World, cfg: ShiftConfig, st: State) {
  const end = cfg.start + (cfg.durationS || 3 * 3600);
  cfg.airports.forEach((icao, i) => {
    const apt = world.byIcao[icao];
    const day = cfg.days[i] ?? synthDay(apt, cfg.start, end, st);
    const seen = new Set<string>();
    // A day pack from another date is replayed on the shift's date (multi-airport shifts mix days).
    const shift = day.date ? Math.floor(cfg.start / 86400) * 86400 - Date.parse(day.date + 'T00:00:00Z') / 1000 : 0;
    for (const f0 of day.flights) {
      const f = shift ? { ...f0, time: f0.time + shift } : f0;
      if (!TYPES[f.type]) continue;
      // Sample the day deterministically to the requested traffic share.
      if (rand(st) > cfg.traffic) continue;
      let cs = f.cs; for (let k = 2; seen.has(cs); k++) cs = f.cs.slice(0, 6) + String.fromCharCode(64 + k);
      if (f.kind === 'dep') {
        if (f.time < cfg.start + 13 * 60 || f.time > end + 5 * 60) continue;
        seen.add(cs);
        st.schedule.push({ at: ticks(Math.max(0, f.time - DEP_LEAD_S - cfg.start)), kind: 'dep', apt: icao, cs, type: f.type, operator: f.operator, other: f.other, sched: f.time, stand: f.stand });
      } else {
        if (f.time < cfg.start + 7 * 60 || f.time > end + 5 * 60) continue;
        seen.add(cs);
        st.schedule.push({ at: ticks(Math.max(0, f.time - arrivalLead(apt) - cfg.start)), kind: 'arr', apt: icao, cs, type: f.type, operator: f.operator, other: f.other, sched: f.time });
      }
    }
  });
  st.schedule.sort((a, b) => a.at - b.at);
}

/** Seconds from STAR entry to touchdown, roughly. */
export const arrivalLead = (apt: Apt) => apt.icao === 'EGLL' ? 26 * 60 : 22 * 60;

/** Synthetic day for airports without a baked pack, or endless mode. */
export function synthDay(apt: Apt, from: number, to: number, st: State, perHour = 36): DayPack {
  const ops = Object.keys(apt.pack.airlineTerminals).filter(o => AIRLINES[o]);
  const pool = ops.length ? ops : Object.keys(AIRLINES);
  const types = ['A319', 'A320', 'A20N', 'A321', 'A21N', 'B738', 'E190', 'B789', 'B77W', 'A359', 'A333', 'A388'];
  const flights: DayPack['flights'] = [];
  for (const kind of ['arr', 'dep'] as const) {
    for (let t = from; t < to; t += (3600 / perHour) * (0.5 + rand(st))) {
      const op = pick(st, pool);
      flights.push({ cs: op + (10 + Math.floor(rand(st) * 980)), type: pick(st, types), operator: op, kind, time: Math.round(t), other: pick(st, ['LFPG', 'EDDF', 'EHAM', 'KJFK', 'OMDB', 'EGPH', 'LEMD', 'LIRF', 'EIDW', 'KBOS', 'VHHH', 'OTHH']) });
    }
  }
  return { id: `synthetic-${apt.icao}`, airport: apt.icao, date: '', label: 'Synthetic traffic', tags: [], sources: [], metars: [], flights, substitutions: [] };
}

// ------------------------------------------------------------------ spawning

function freeStand(world: World, st: State, apt: Apt, operator: string, wake: string, kind: 'arr' | 'dep', prefer?: string): string | null {
  const as = st.apts.find(a => a.icao === apt.icao)!;
  const ok = (s: Apt['stands'][number]) => !as.standOcc[s.ref] && (wake !== 'J' || s.maxWake === 'J') && (wake !== 'H' || s.maxWake !== 'M');
  const term = apt.terminalFor(operator);
  // Departures take over a parked aircraft; arrivals prefer an empty stand.
  const tiers = kind === 'dep'
    ? [(s: Apt['stands'][number]) => !!as.fillers[s.ref] && s.terminal === term, (s: Apt['stands'][number]) => s.terminal === term, () => true]
    : [(s: Apt['stands'][number]) => !as.fillers[s.ref] && s.terminal === term, (s: Apt['stands'][number]) => !as.fillers[s.ref], (s: Apt['stands'][number]) => s.terminal === term, () => true];
  let ref: string | null = null;
  if (prefer && apt.standByRef[prefer] && ok(apt.standByRef[prefer])) ref = prefer;
  for (const tier of tiers) { if (ref) break; const l = apt.stands.filter(s => ok(s) && tier(s)); if (l.length) ref = pick(st, l).ref; }
  if (ref) delete as.fillers[ref];
  return ref;
}

export function newSquawk(st: State): string {
  for (;;) {
    const c = [3, 4, 5, 6].map(() => 0).map((_, i) => (i === 0 ? 2 + Math.floor(rand(st) * 5) : Math.floor(rand(st) * 8))).join('');
    if (!['7500', '7600', '7700', '7000', '2000'].includes(c) && !st.squawks.includes(c)) { st.squawks.push(c); return c; }
  }
}

function base(sp: Spawn, st: State): Aircraft {
  const t = TYPES[sp.type];
  return {
    cs: sp.cs, type: sp.type, operator: sp.operator, wake: t.wake, kind: sp.kind, apt: sp.apt, other: sp.other, sched: sp.sched,
    stand: null, sid: null, star: null, stack: null, runway: null, squawk: '', phase: 'stand', owner: '', freq: '', checkedIn: false,
    x: 0, y: 0, alt: 0, hdg: 0, ias: 0, gs: 0, vs: 0, trk: 0, onGround: true,
    tgtHdg: null, turn: null, tgtAlt: 0, tgtSpd: null, nav: { mode: 'hdg', route: [], established: false, gs: false },
    path: [], pi: 0, holdAt: null, claims: [], towing: false, ghost: null, resume: null, s: 0,
    cleared: { dl: false, push: false, taxi: false, luw: false, cto: false, land: false, cross: [], greens: false },
    face: null, stoppedS: 0, blockedBy: null,
    actAt: 0, last: [], rbErr: null, req: null, nextReqAt: st.tick + ticks(300 + rand(st) * 900), emergency: null,
    spawnedAt: st.tick, offBlockAt: null, airborneAt: null, landedAt: null, handAt: null,
    trackM: 0, holdS: 0, goArounds: 0, trail: [], trailT: 0, alert: 'none', lateS: 0, vectors: null,
  };
}

/** Put a scheduled flight into the world. Returns null if it can't appear yet (no stand). */
export function spawn(world: World, st: State, sp: Spawn): Aircraft | null {
  const apt = world.byIcao[sp.apt];
  const as = st.apts.find(a => a.icao === sp.apt)!;
  const ac = base(sp, st);
  if (sp.kind === 'dep') {
    const stand = freeStand(world, st, apt, sp.operator, ac.wake, 'dep', sp.stand);
    if (!stand) return null;
    const s = apt.standByRef[stand];
    as.standOcc[stand] = sp.cs;
    Object.assign(ac, { stand, x: s.x, y: s.y, hdg: s.hdg, phase: 'stand' as const });
    ac.runway = as.dep[0];
    ac.sid = chooseSid(apt, ac.runway, sp.other, st);
    ac.owner = ac.freq = seatId(apt.icao, 'DEL');
    // Late in the window: clearance already issued before the shift.
    if (sp.sched - (st.start + st.tick * DT) < 17 * 60) { ac.cleared.dl = true; ac.squawk = newSquawk(st); ac.owner = ac.freq = seatId(apt.icao, 'GND'); }
  } else {
    const star = chooseStar(apt, sp.other, st);
    ac.star = star.name; ac.stack = star.stack;
    ac.runway = as.arr[0];
    ac.squawk = newSquawk(st);
    const stand = freeStand(world, st, apt, sp.operator, ac.wake, 'arr');
    if (stand) { ac.stand = stand; as.standOcc[stand] = sp.cs; }
    ac.onGround = false;
    if (!placeArrival(world, st, apt, ac, star.fixes, star.entryAltFt, sp.sched, sp.at <= 1)) { if (stand) delete as.standOcc[stand]; return null; }
  }
  return ac;
}

/** Arrivals appear at their STAR entry, or part-way along if they land soon after the shift starts. */
function placeArrival(world: World, st: State, apt: Apt, ac: Aircraft, fixes: string[], entryAlt: number, landAt: number, initial: boolean): boolean {
  const nowU = st.start + st.tick * DT;
  const remaining = landAt - nowU;
  const end = apt.ends[ac.runway!];
  const stackFix = apt.fixes[ac.stack!];
  const trans = transition(apt, stackFix, end);
  const pts: { p: XY; fix?: string }[] = [...fixes.map(f => ({ p: apt.fixes[f], fix: f })), ...trans.map(p => ({ p })), { p: finalPoint(end, 4) }];
  const lead = arrivalLead(apt);
  let total = 0; for (let j = 1; j < pts.length; j++) total += dist(pts[j - 1].p, pts[j].p);
  // Part-way placement: walk back from touchdown along the path at typical speeds, further back until clear of other traffic.
  let back = remaining * 210 * (NM / 3600), placed: { pos: XY; hdg: number; i: number; alt: number } | null = null;
  for (let k = 0; initial && remaining < lead - 30 && k < 14 && back < total - 2 * NM; k++, back += 3 * NM) {
    let rest = back, i = pts.length - 1;
    while (i > 0) { const d = dist(pts[i].p, pts[i - 1].p); if (rest <= d) break; rest -= d; i--; }
    const a = pts[Math.max(0, i - 1)].p, b = pts[i].p;
    const seg = dist(a, b) || 1, f = Math.max(0, 1 - rest / seg);
    const pos = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    const toThr = dist(pos, end.thr) / NM;
    const alt = Math.round(Math.max(3000, Math.min(entryAlt, 2000 + toThr * 300)) / 1000) * 1000;
    if (st.aircraft.some(o => !o.onGround && dist(o, pos) < 5.5 * NM && Math.abs(o.alt - alt) < 1000)) continue;
    placed = { pos, hdg: bearing(a, b), i, alt };
    break;
  }
  if (!placed) {
    // At the STAR entry, heading for the next fix, at the first entry level clear of anyone nearby.
    const p0 = pts[0].p, p1 = pts[1].p;
    // The upstream sector won't hand over until the previous arrival on this route is well clear.
    if (st.aircraft.some(o => !o.onGround && dist(o, p0) < 9 * NM && Math.abs(o.alt - entryAlt) < 3000)) return false;
    const alt = entryAlt;
    Object.assign(ac, { x: p0.x, y: p0.y, hdg: bearing(p0, p1), trk: bearing(p0, p1), alt, tgtAlt: alt, ias: alt > 10000 ? 300 : 250, phase: 'arrival' as const });
    ac.nav = { mode: 'route', route: fixes.slice(1), established: false, gs: false };
    ac.owner = ac.freq = 'LON';
    return true;
  }
  const { pos, hdg, i } = placed;
  const toThr = dist(pos, end.thr) / NM;
  Object.assign(ac, { x: pos.x, y: pos.y, hdg, trk: hdg, ias: Math.min(250, 160 + toThr * 4), phase: 'approach' as const, alt: placed.alt, tgtAlt: placed.alt });
  const remainingFixes = pts.slice(i).filter(q => q.fix).map(q => q.fix!);
  if (remainingFixes.length) {
    ac.phase = 'arrival';
    ac.nav = { mode: 'route', route: remainingFixes, established: false, gs: false };
    ac.owner = ac.freq = toThr < 45 ? seatId(apt.icao, 'DIR') : 'LON';
  } else {
    ac.nav = { mode: 'hdg', route: [], established: false, gs: false };
    ac.tgtHdg = hdg;
    ac.owner = ac.freq = seatId(apt.icao, 'DIR');
  }
  return true;
}

