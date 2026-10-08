// Squawk sim core: pure TypeScript, no DOM. Deterministic 4 Hz tick, seeded RNG,
// commands are the only input. Internal frame: metres east/north of the Heathrow ARP.

export const TICK_HZ = 4;
const DT = 1 / TICK_HZ;
const NM = 1852;
const KT = NM / 3600; // m/s per knot
export const SHIFT_S = 15 * 60;
export const SHIFT_START_S = 7 * 3600; // 07:00 local

export type Wake = 'L' | 'M' | 'H' | 'J';
export type Verb = 'luw' | 'cto' | 'land' | 'goaround';
export interface Command { callsign: string; verb: Verb }
export type Unit = 'GND' | 'DIR' | 'LON';
export interface Wind { dir: number; kt: number }
export type Msg =
  | { t: 'luw' | 'cto' | 'land'; rwy: string; wind?: Wind }
  | { t: 'goaround' | 'ready' | 'goingaround' }
  | { t: 'contact'; unit: Unit }
  | { t: 'final'; nm: number };
export interface Radio { tick: number; from: 'atc' | 'pilot'; callsign: string; msg: Msg; auto?: boolean }
export interface Alert { tick: number; level: 'caution' | 'conflict'; text: string }

export type Phase =
  | 'final' | 'landing' | 'vacating' | 'goaround'
  | 'holding' | 'lining' | 'lined' | 'rolling' | 'climb' | 'gone';

export interface Aircraft {
  callsign: string; type: string; wake: Wake; kind: 'arr' | 'dep';
  runway: string; sid?: string; phase: Phase;
  s: number; off: number; // metres along runway from threshold, metres right of centreline
  x: number; y: number; hdg: number; alt: number; spd: number; // m, m, deg true, ft, kt
  ready: number; // tick it came onto frequency
  luw: boolean; cleared: boolean; ga: boolean; // instructions issued
  actAt: number; // tick the pilot acts on the last instruction
}

interface Perf { wake: Wake; vapp: number; vr: number; accel: number; decel: number; climb: number }
// ponytail: ~15 representative types with rounded figures; replace with a sourced perf table later.
export const TYPES: Record<string, Perf> = {
  A319: { wake: 'M', vapp: 133, vr: 140, accel: 4.6, decel: 2.8, climb: 2800 },
  A320: { wake: 'M', vapp: 137, vr: 145, accel: 4.4, decel: 2.7, climb: 2600 },
  A20N: { wake: 'M', vapp: 136, vr: 145, accel: 4.5, decel: 2.7, climb: 2700 },
  A321: { wake: 'M', vapp: 142, vr: 155, accel: 4.0, decel: 2.6, climb: 2400 },
  B738: { wake: 'M', vapp: 145, vr: 150, accel: 4.2, decel: 2.6, climb: 2500 },
  E190: { wake: 'M', vapp: 130, vr: 135, accel: 4.6, decel: 2.9, climb: 2800 },
  A333: { wake: 'H', vapp: 140, vr: 155, accel: 3.4, decel: 2.4, climb: 2200 },
  A359: { wake: 'H', vapp: 140, vr: 155, accel: 3.6, decel: 2.4, climb: 2400 },
  A35K: { wake: 'H', vapp: 145, vr: 165, accel: 3.3, decel: 2.3, climb: 2200 },
  B789: { wake: 'H', vapp: 145, vr: 160, accel: 3.5, decel: 2.4, climb: 2400 },
  B772: { wake: 'H', vapp: 140, vr: 160, accel: 3.2, decel: 2.3, climb: 2000 },
  B77W: { wake: 'H', vapp: 149, vr: 170, accel: 3.2, decel: 2.3, climb: 2000 },
  A388: { wake: 'J', vapp: 145, vr: 155, accel: 2.8, decel: 2.1, climb: 1600 },
};

// ponytail: synthetic traffic until tools/pipeline bakes real OpenSky days (milestone 3).
const AIRLINES: [string, number, string[]][] = [
  ['BAW', 40, ['A319', 'A320', 'A20N', 'A321', 'A321', 'B772', 'B789', 'B77W', 'A35K', 'A388']],
  ['SHT', 6, ['A319', 'A320']],
  ['VIR', 8, ['B789', 'A35K', 'A333']],
  ['EIN', 6, ['A320', 'A20N', 'A321']],
  ['DLH', 5, ['A320', 'A321', 'A20N']],
  ['AFR', 4, ['A319', 'A320']],
  ['KLM', 4, ['B738', 'E190']],
  ['IBE', 3, ['A320', 'A321']],
  ['SWR', 3, ['A320', 'A20N']],
  ['UAE', 5, ['A388', 'B77W']],
  ['QTR', 4, ['A359', 'A388', 'B77W']],
  ['AAL', 4, ['B77W', 'B772', 'B789']],
  ['UAL', 3, ['B789', 'B772']],
  ['DAL', 3, ['A333', 'A359']],
];
const SIDS = ['BPK', 'CPT', 'DET', 'GOGSI', 'MAXIT', 'MODMI', 'UMLAT', 'ULTIB'];

// Departure wake gap in seconds, [leader][follower], measured from leader airborne.
const WAKE_DEP: Record<Wake, Partial<Record<Wake, number>>> = {
  J: { L: 180, M: 180, H: 120 },
  H: { L: 120, M: 120 },
  M: { L: 120 },
  L: {},
};
// Approach wake spacing in nm, [leader][follower]; the AI Director feeds final at these.
const WAKE_APP: Record<Wake, Partial<Record<Wake, number>>> = {
  J: { L: 8, M: 7, H: 6, J: 4 },
  H: { L: 6, M: 5, H: 4, J: 4 },
  M: { L: 5 },
  L: {},
};

interface XY { x: number; y: number }
export interface Runway { name: string; thr: XY; end: XY }
const ARP = { lat: 51.4775, lon: -0.461389 };
const ll = (lat: number, lon: number): XY => ({
  x: (lon - ARP.lon) * 111320 * Math.cos((ARP.lat * Math.PI) / 180),
  y: (lat - ARP.lat) * 111320,
});
// ponytail: thresholds hand-entered (approx. AD 2.EGLL); the pipeline replaces these in milestone 2.
export const RUNWAYS: Record<string, Runway> = {
  '27R': { name: '27R', thr: ll(51.477292, -0.433264), end: ll(51.4775, -0.484992) },
  '27L': { name: '27L', thr: ll(51.464806, -0.435817), end: ll(51.464856, -0.483589) },
};
export function geom(r: Runway) {
  const dx = r.end.x - r.thr.x, dy = r.end.y - r.thr.y, len = Math.hypot(dx, dy);
  return { len, ux: dx / len, uy: dy / len, hdg: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 };
}

interface Spawn { tick: number; kind: 'arr' | 'dep'; callsign: string; type: string; sid?: string }
export interface Stats {
  landed: number; departed: number; goArounds: number; pilotGoArounds: number;
  sepLoss: number; wakeInf: number; clrOccupied: number; depDelayS: number; spawned: number;
}
export interface State {
  tick: number; rng: number; wind: Wind; arrRwy: string; depRwy: string;
  aircraft: Aircraft[]; schedule: Spawn[];
  pending: { tick: number; callsign: string; msg: Msg; apply?: Verb }[];
  radio: Radio[]; alerts: Alert[];
  lastDep: { callsign: string; wake: Wake; sid: string; airborneAt: number | null } | null;
  stats: Stats; ended: null | 'time' | 'collision';
  cmdLog: { tick: number; cmd: Command }[];
}

function rand(st: State): number { // mulberry32, state kept in State so snapshots stay serialisable
  let t = (st.rng = (st.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(st: State, a: T[]): T => a[Math.floor(rand(st) * a.length)];
const ticks = (s: number) => Math.round(s * TICK_HZ);

export function createShift(seed: number): State {
  const st: State = {
    tick: 0, rng: seed | 0, wind: { dir: 0, kt: 0 }, arrRwy: '27R', depRwy: '27L',
    aircraft: [], schedule: [], pending: [], radio: [], alerts: [], lastDep: null,
    stats: { landed: 0, departed: 0, goArounds: 0, pilotGoArounds: 0, sepLoss: 0, wakeInf: 0, clrOccupied: 0, depDelayS: 0, spawned: 0 },
    ended: null, cmdLog: [],
  };
  st.wind = { dir: 230 + Math.round(rand(st) * 6) * 10, kt: 6 + Math.floor(rand(st) * 12) };
  const used = new Set<string>();
  const flight = (kind: 'arr' | 'dep', t: number) => {
    let total = 0; for (const a of AIRLINES) total += a[1];
    let r = rand(st) * total, al = AIRLINES[0];
    for (const a of AIRLINES) if ((r -= a[1]) < 0) { al = a; break; }
    let cs: string;
    do {
      cs = al[0] + (1 + Math.floor(rand(st) * (al[0] === 'BAW' ? 999 : 299)));
      if (al[0] === 'BAW' && rand(st) < 0.3) cs += 'ABCEGHJKLMNPRTUWXYZ'[Math.floor(rand(st) * 19)];
    } while (used.has(cs));
    used.add(cs);
    st.schedule.push({ tick: ticks(t), kind, callsign: cs, type: pick(st, al[2]), sid: kind === 'dep' ? pick(st, SIDS) : undefined });
  };
  // Calm, then busier: gaps shrink across the shift.
  for (let t = 15; t < SHIFT_S - 60; t += (130 - 60 * t / SHIFT_S) * (0.7 + 0.6 * rand(st))) flight('arr', t);
  flight('dep', 0); flight('dep', 0);
  for (let t = 40; t < SHIFT_S - 60; t += (115 - 55 * t / SHIFT_S) * (0.7 + 0.6 * rand(st))) flight('dep', t);
  st.schedule.sort((a, b) => a.tick - b.tick);
  return st;
}

const find = (st: State, cs: string) => st.aircraft.find(a => a.callsign === cs);
const ON_RWY: Phase[] = ['landing', 'vacating', 'lining', 'lined', 'rolling'];
export const occupants = (st: State, rwy: string, except?: Aircraft) =>
  st.aircraft.filter(a => a !== except && a.runway === rwy && ON_RWY.includes(a.phase));

function alert(st: State, level: Alert['level'], text: string) { st.alerts.push({ tick: st.tick, level, text }); }
function say(st: State, from: Radio['from'], callsign: string, msg: Msg, auto?: boolean) {
  st.radio.push({ tick: st.tick, from, callsign, msg, ...(auto ? { auto } : {}) });
}
function readback(st: State, callsign: string, msg: Msg, apply?: Verb) {
  st.pending.push({ tick: st.tick + ticks(1.5 + rand(st) * 1.5), callsign, msg, apply });
}
function handoff(st: State, ac: Aircraft, unit: Unit) {
  say(st, 'atc', ac.callsign, { t: 'contact', unit }, true);
  readback(st, ac.callsign, { t: 'contact', unit });
  ac.phase = 'gone';
}

/** Seconds until departure separation (route + wake) behind the last departure is met; Infinity while it is still on the roll. */
export function depGap(st: State, ac: Aircraft): number {
  const L = st.lastDep;
  if (!L || ac.kind !== 'dep') return 0;
  if (L.airborneAt === null) return Infinity;
  const need = Math.max(L.sid === ac.sid ? 120 : 60, WAKE_DEP[L.wake][ac.wake] ?? 0);
  return Math.max(0, need - (st.tick - L.airborneAt) * DT);
}

export function validVerbs(ac: Aircraft): Verb[] {
  if (ac.kind === 'arr') return ac.phase !== 'final' || ac.ga ? [] : ac.cleared ? ['goaround'] : ['land', 'goaround'];
  if (ac.cleared) return [];
  if (ac.phase === 'holding') return ac.luw ? ['cto'] : ['luw', 'cto'];
  if (ac.phase === 'lining' || ac.phase === 'lined') return ['cto'];
  return [];
}

/** Queue a controller instruction. Returns an error string if it isn't legal for this aircraft now. */
export function issue(st: State, cmd: Command): string | null {
  const ac = find(st, cmd.callsign);
  if (!ac || st.ended) return `${cmd.callsign} not on frequency`;
  if (!validVerbs(ac).includes(cmd.verb)) return `${cmd.callsign}: ${cmd.verb} not valid now`;
  st.cmdLog.push({ tick: st.tick, cmd });
  const busy = occupants(st, ac.runway, ac);
  let msg: Msg;
  if (cmd.verb === 'goaround') { ac.ga = true; msg = { t: 'goaround' }; }
  else {
    msg = { t: cmd.verb, rwy: ac.runway, ...(cmd.verb === 'luw' ? {} : { wind: st.wind }) };
    if (cmd.verb === 'luw') ac.luw = true;
    else {
      ac.cleared = true;
      const blocking = cmd.verb === 'land' ? busy : busy.filter(a => a.phase === 'rolling' || a.phase === 'landing');
      if (blocking.length) {
        st.stats.clrOccupied++;
        alert(st, 'caution', `${ac.callsign} cleared ${cmd.verb === 'land' ? 'to land' : 'for take-off'} with ${blocking[0].callsign} on ${ac.runway}`);
      }
    }
  }
  ac.actAt = Number.MAX_SAFE_INTEGER; // nothing happens until the readback
  say(st, 'atc', ac.callsign, msg);
  readback(st, ac.callsign, msg, cmd.verb);
  return null;
}

const holdSlot = (i: number) => 40 - i * 75; // queue on the taxiway behind the holding point

function spawn(st: State, sp: Spawn): boolean {
  const p = TYPES[sp.type];
  const ac: Aircraft = {
    callsign: sp.callsign, type: sp.type, wake: p.wake, kind: sp.kind, sid: sp.sid,
    runway: sp.kind === 'arr' ? st.arrRwy : st.depRwy, phase: sp.kind === 'arr' ? 'final' : 'holding',
    s: sp.kind === 'arr' ? -5 * NM : holdSlot(st.aircraft.filter(a => a.runway === st.depRwy && a.phase === 'holding').length),
    off: sp.kind === 'arr' ? 0 : 110,
    x: 0, y: 0, hdg: 0, alt: 0, spd: sp.kind === 'arr' ? 160 : 0,
    ready: st.tick, luw: false, cleared: false, ga: false, actAt: 0,
  };
  if (sp.kind === 'arr') {
    // AI Director only releases onto final once wake/radar spacing behind the last arrival is met.
    const ahead = st.aircraft.filter(a => a.phase === 'final').sort((a, b) => a.s - b.s)[0];
    if (ahead && ahead.s - ac.s < Math.max(3, WAKE_APP[ahead.wake][ac.wake] ?? 3) * NM) return false;
  }
  st.aircraft.push(ac);
  st.stats.spawned++;
  say(st, 'pilot', ac.callsign, sp.kind === 'arr' ? { t: 'final', nm: 5 } : { t: 'ready' });
  return true;
}

const approach = (v: number, target: number, rate: number) => v < target ? Math.min(target, v + rate * DT) : Math.max(target, v - rate * DT);

function goAround(st: State, ac: Aircraft) {
  ac.phase = 'goaround';
  st.stats.goArounds++;
}

function move(st: State, ac: Aircraft) {
  const p = TYPES[ac.type];
  const len = geom(RUNWAYS[ac.runway]).len;
  const fwd = () => { ac.s += ac.spd * KT * DT; };
  switch (ac.phase) {
    case 'final': {
      ac.spd = approach(ac.spd, ac.s < -4 * NM ? 160 : p.vapp, 1);
      fwd();
      ac.alt = 50 + Math.max(0, -ac.s) * 0.172; // 3° glidepath, 50 ft over the threshold
      if (!ac.cleared && !ac.ga && ac.s >= -0.5 * NM) {
        st.stats.pilotGoArounds++;
        alert(st, 'caution', `${ac.callsign} going around: no landing clearance`);
        say(st, 'pilot', ac.callsign, { t: 'goingaround' });
        goAround(st, ac);
      } else if (ac.s >= 0) {
        const busy = occupants(st, ac.runway, ac);
        if (busy.length) {
          st.stats.sepLoss++;
          alert(st, 'conflict', `Runway ${ac.runway}: ${ac.callsign} landing with ${busy[0].callsign} on the runway`);
        }
        ac.phase = 'landing';
      }
      break;
    }
    case 'landing':
      if (ac.s > 400) ac.spd = approach(ac.spd, 0, p.decel);
      fwd();
      ac.alt = Math.max(0, 50 * (1 - ac.s / 400));
      if (ac.spd <= 25 || ac.s > len - 300) ac.phase = 'vacating';
      break;
    case 'vacating':
      ac.spd = approach(ac.spd, 15, 3);
      fwd();
      ac.off -= 9 * DT;
      if (ac.off <= -90) { st.stats.landed++; handoff(st, ac, 'GND'); }
      break;
    case 'goaround':
      ac.spd = approach(ac.spd, 185, 2);
      fwd();
      ac.alt = Math.min(3000, ac.alt + (p.climb / 60) * DT);
      if (ac.s > len + 2 * NM) {
        handoff(st, ac, 'DIR');
        // Director re-sequences it back onto final.
        st.schedule.push({ tick: st.tick + ticks(300), kind: 'arr', callsign: ac.callsign, type: ac.type });
        st.schedule.sort((a, b) => a.tick - b.tick);
        st.stats.spawned--; // it will be counted again when it rejoins
      }
      break;
    case 'holding': {
      const queue = st.aircraft.filter(a => a.runway === ac.runway && a.phase === 'holding');
      ac.s = approach(ac.s, holdSlot(queue.indexOf(ac)), 8);
      if ((ac.luw || ac.cleared) && st.tick >= ac.actAt &&
        !st.aircraft.some(a => a.runway === ac.runway && (a.phase === 'lining' || a.phase === 'lined'))) ac.phase = 'lining';
      break;
    }
    case 'lining':
      ac.s = approach(ac.s, 30, 8);
      ac.off = approach(ac.off, 0, 8);
      if (ac.off === 0 && ac.s === 30) { ac.phase = 'lined'; ac.actAt = Math.max(ac.actAt, st.tick + ticks(3)); }
      break;
    case 'lined':
      if (ac.cleared && st.tick >= ac.actAt) {
        const blocker = occupants(st, ac.runway, ac).find(a => a.phase === 'rolling' || a.phase === 'landing');
        if (blocker) {
          st.stats.sepLoss++;
          alert(st, 'conflict', `Runway ${ac.runway}: ${ac.callsign} rolling with ${blocker.callsign} still on the runway`);
        } else {
          const gap = depGap(st, ac);
          if (gap > 0) {
            st.stats.wakeInf++;
            alert(st, 'caution', `${ac.callsign} departed ${Math.ceil(gap)}s inside the required gap behind ${st.lastDep?.callsign}`);
          }
        }
        st.stats.depDelayS += Math.max(0, (st.tick - ac.ready) * DT - 60);
        st.lastDep = { callsign: ac.callsign, wake: ac.wake, sid: ac.sid!, airborneAt: null };
        ac.phase = 'rolling';
      }
      break;
    case 'rolling':
      ac.spd += p.accel * DT;
      fwd();
      if (ac.spd >= p.vr) {
        ac.phase = 'climb';
        if (st.lastDep?.callsign === ac.callsign) st.lastDep.airborneAt = st.tick;
      }
      break;
    case 'climb':
      ac.spd = approach(ac.spd, 220, 2);
      fwd();
      ac.alt += (p.climb / 60) * DT;
      if (ac.alt >= 2000) { st.stats.departed++; handoff(st, ac, 'LON'); }
      break;
  }
}

export function step(st: State): void {
  if (st.ended) return;
  st.tick++;

  for (const p of st.pending.filter(p => p.tick <= st.tick)) {
    say(st, 'pilot', p.callsign, p.msg);
    const ac = find(st, p.callsign);
    if (!ac) continue;
    if (p.apply === 'goaround' && ac.phase === 'final') goAround(st, ac);
    if (p.apply === 'luw') ac.actAt = st.tick + ticks(2);
    if (p.apply === 'cto') ac.actAt = st.tick + ticks(3 + rand(st) * 3);
  }
  st.pending = st.pending.filter(p => p.tick > st.tick);

  for (const sp of st.schedule.filter(sp => sp.tick <= st.tick))
    if (spawn(st, sp)) st.schedule.splice(st.schedule.indexOf(sp), 1);

  for (const ac of st.aircraft) {
    move(st, ac);
    const r = RUNWAYS[ac.runway], g = geom(r);
    ac.x = r.thr.x + g.ux * ac.s + g.uy * ac.off;
    ac.y = r.thr.y + g.uy * ac.s - g.ux * ac.off;
    ac.hdg = g.hdg;
  }
  st.aircraft = st.aircraft.filter(a => a.phase !== 'gone');

  const ground = st.aircraft.filter(a => a.alt < 30);
  for (let i = 0; i < ground.length; i++)
    for (let j = i + 1; j < ground.length; j++)
      if (Math.hypot(ground[i].x - ground[j].x, ground[i].y - ground[j].y) < 40) {
        alert(st, 'conflict', `COLLISION: ${ground[i].callsign} and ${ground[j].callsign}`);
        st.ended = 'collision';
        return;
      }

  if (st.tick >= ticks(SHIFT_S)) st.ended = 'time';
}

/** Re-run a shift from its seed and command log. Same inputs, same final state. */
export function replay(seed: number, log: State['cmdLog'], until: number): State {
  const st = createShift(seed);
  let i = 0;
  while (st.tick < until && !st.ended) {
    while (i < log.length && log[i].tick === st.tick) issue(st, log[i++].cmd);
    step(st);
  }
  return st;
}

export function hashState(st: State): string { // FNV-1a over the serialised state
  let h = 0x811c9dc5;
  const s = JSON.stringify(st);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function debrief(st: State) {
  const s = st.stats;
  const movements = s.landed + s.departed;
  // ponytail: first-guess weights, tune from play-tests.
  const efficiency = Math.max(0, movements * 100 - (s.depDelayS / 60) * 15 - s.goArounds * 100 - s.pilotGoArounds * 100);
  const safety = st.ended === 'collision' ? 0 : Math.max(0, 1 - 0.3 * s.sepLoss - 0.1 * s.wakeInf - 0.05 * s.clrOccupied);
  const score = Math.round(efficiency * safety);
  // Arrivals still on final at the bell weren't yours to land yet; waiting departures were.
  const ratio = score / (100 * Math.max(1, s.spawned - st.aircraft.filter(a => a.phase === 'final').length));
  const clean = s.sepLoss + s.wakeInf + s.clrOccupied === 0;
  const grade = st.ended === 'collision' ? 'D' : ratio >= 0.9 && clean ? 'S' : ratio >= 0.8 ? 'A' : ratio >= 0.65 ? 'B' : ratio >= 0.5 ? 'C' : 'D';
  return { movements, score, safety, grade, ...s };
}
