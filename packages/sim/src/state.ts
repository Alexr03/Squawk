// Serialisable simulation state. Everything here survives structuredClone/JSON (snapshots, replays, co-op).
import type { Command, DayPack, Nature, PilotCall, Radio, Seat, Wake, Wind, XY } from './types.ts';

export const TICK_HZ = 4;
export const DT = 1 / TICK_HZ;

/** A controller position: "EGLL:TWR", or "LON" for the shared London Control sector. */
export type SeatId = string;
export const seatId = (icao: string, role: Seat): SeatId => (role === 'LON' ? 'LON' : `${icao}:${role}`);
export const seatRole = (id: SeatId): Seat => (id === 'LON' ? 'LON' : (id.split(':')[1] as Seat));
export const seatApt = (id: SeatId): string | null => (id === 'LON' ? null : id.split(':')[0]);

export interface Difficulty {
  readbackErrors: number;      // probability per instruction with a value
  conflictPrediction: boolean; // STCA prediction lines
  suggestedRoutes: boolean;    // taxi route suggestions
  autoPush: boolean;           // assists: pushback approvals handled for you
  autoSequence: boolean;       // assists: AI sets final-approach speeds
  wake: boolean;               // wake rules enforced
  depGaps?: boolean;           // departure spacing (same-route / wake gaps between take-offs) scored
  pause: boolean;
  emergencies: number;         // expected emergencies per hour (0 = off)
  weatherEvents: boolean;
}
export const DIFFICULTY: Record<'casual' | 'standard' | 'realistic', Difficulty> = {
  casual: { readbackErrors: 0, conflictPrediction: true, suggestedRoutes: true, autoPush: false, autoSequence: false, wake: true, pause: true, emergencies: 0.5, weatherEvents: true },
  standard: { readbackErrors: 0.03, conflictPrediction: true, suggestedRoutes: true, autoPush: false, autoSequence: false, wake: true, pause: true, emergencies: 1, weatherEvents: true },
  realistic: { readbackErrors: 0.06, conflictPrediction: false, suggestedRoutes: false, autoPush: false, autoSequence: false, wake: true, depGaps: true, pause: true, emergencies: 1.5, weatherEvents: true },
};

export type Mode = 'free' | 'career' | 'daily' | 'endless' | 'tutorial' | 'checkride';

export interface ShiftConfig {
  seed: number;
  airports: string[];          // icao, same order as the world packs
  days: (DayPack | null)[];    // per airport; null = synthetic traffic
  start: number;               // unix seconds
  durationS: number;           // 0 = endless
  traffic: number;             // 0..1 share of the real day
  coverage: SeatId[];          // seats the player works
  difficulty: Difficulty;
  mode: Mode;
  /** Force a runway configuration index per airport (else chosen from the wind). */
  config?: (number | null)[];
  weather?: { wind?: Wind; visM?: number; ceilingFt?: number | null; wx?: string[] };
  /** Scripted events for tutorials/checkrides. */
  script?: { at: number; event: string }[];
}

export type Phase =
  // departures
  | 'stand' | 'pushing' | 'pushed' | 'taxi' | 'holding' | 'lineup' | 'lined' | 'takeoff' | 'climb'
  // arrivals
  | 'arrival' | 'stack' | 'approach' | 'final' | 'landing' | 'vacating' | 'taxiin' | 'parked'
  | 'goaround' | 'gone'
  // after something went wrong
  | 'wreck' | 'stopped';

export interface Nav {
  mode: 'hdg' | 'route' | 'hold' | 'climbout';
  route: string[];             // remaining fixes (route mode)
  hold?: { fix: string; inbound: number; turn: 'L' | 'R'; leg: 'entry' | 'outbound' | 'inbound'; t: number };
  ils?: string;                // runway end cleared for the ILS
  established: boolean;
  gs: boolean;                 // glidepath captured
}

export interface Aircraft {
  cs: string; type: string; operator: string; wake: Wake; kind: 'arr' | 'dep';
  apt: string;                 // airport of departure/arrival
  other: string;               // destination/origin ICAO
  sched: number;               // scheduled take-off / landing (unix)
  stand: string | null;
  sid: string | null; star: string | null; stack: string | null;
  runway: string | null;       // assigned runway end
  squawk: string;
  phase: Phase;
  owner: SeatId;               // who controls it
  freq: SeatId;                // whose frequency the pilot is on
  checkedIn: boolean;
  // kinematics (world metres / ft / kt / deg true)
  x: number; y: number; alt: number; hdg: number; ias: number; gs: number; vs: number; trk: number;
  onGround: boolean;
  tgtHdg: number | null; turn: 'L' | 'R' | null; tgtAlt: number; tgtSpd: number | null;
  nav: Nav;
  halted?: boolean;            // told to hold position (or to stop a take-off roll)
  fullStop?: boolean;          // emergency landing: stop on the runway and wait for the fire service
  // ground movement
  path: number[]; pi: number;  // taxi path (node ids) and index of the node being approached
  holdAt: number | null;       // node to stop at until cleared (hold short / stop bar)
  claims: number[];            // taxi nodes this aircraft has locked (occupancy locks)
  towing: boolean;             // being towed backwards (deadlock resolution)
  ghost: string | null;        // AI deadlock backstop: ignore this aircraft until clear of it
  resume: { to: string; after: string } | null; // taxi limit to resume once 'after' has passed
  s: number;                   // distance along the runway (runway phases)
  cleared: { dl: boolean; push: boolean; taxi: boolean; luw: boolean; cto: boolean; land: boolean; cross: string[]; greens: boolean };
  face: 'N' | 'S' | 'E' | 'W' | null;
  stoppedS: number;            // seconds stationary while wanting to move (gridlock detection)
  blockedBy: string | null;
  // pilot
  actAt: number;               // tick the pilot acts on the last instruction
  last: Command[];             // last instructions received (for "negative, I say again")
  rbErr: { right: Command; wrong: Command; until: number } | null;
  req: { call: PilotCall; at: number } | null;
  nextReqAt: number;
  emergency: { code: '7700' | '7600'; nature: Nature | 'radio'; since: number } | null;
  // bookkeeping
  spawnedAt: number; offBlockAt: number | null; airborneAt: number | null; landedAt: number | null; handAt: number | null;
  trackM: number; holdS: number; goArounds: number;
  trail: XY[]; trailT: number;
  alert: 'none' | 'caution' | 'conflict' | 'emergency';
  lateS: number;               // seconds overdue for handoff
  vectors: { pts: XY[]; i: number } | null; // AI Director's planned vectors to the ILS
}

export interface Spawn { at: number; kind: 'arr' | 'dep'; apt: string; cs: string; type: string; operator: string; other: string; sched: number; stand?: string; atHold?: boolean }

export interface ScoreEvent {
  tick: number;
  kind: 'seploss' | 'wake' | 'runway' | 'incursion' | 'collision' | 'readback' | 'goaround' | 'late-handoff' | 'early-handoff'
    | 'unanswered' | 'clearance-occupied' | 'taxi-conflict' | 'gridlock' | 'emergency' | 'missed-approach' | 'stand-wait' | 'bad-rt';
  severity: number;            // 1 minor .. 5 incident
  text: string;
  cs: string[];
  x?: number; y?: number;
  ai?: boolean;                // caused entirely by AI controllers (not scored)
}

export interface Weather {
  wind: Wind; visM: number; ceilingFt: number | null; qnh: number; tempC: number; wx: string[];
  atis: string;                // ATIS letter
  cells: { x: number; y: number; r: number; intensity: number; vx: number; vy: number }[];
  lvp: boolean;
}

/** A crash or an emergency that needs the fire service. */
export interface Incident {
  id: string;
  kind: 'crash' | 'emergency';
  apt: string;
  x: number; y: number;
  runway: string | null;       // runway pair it blocks, if any
  fire: number;                // 0 = none, 1 = fully ablaze
  cs: string[];                // aircraft involved
  since: number;
  dispatched: number | null;   // tick the fire service was sent
  onScene: number | null;      // tick the first vehicle arrived
  clearAt: number | null;      // tick the site is cleared (wreck removed / aircraft towed)
  resolved: boolean;
  offAirport: boolean;         // outside the airfield: handled by the local services, nothing for the tower to do
  warned: boolean;
}
export const CLOSED_UNTIL_REOPENED = Number.MAX_SAFE_INTEGER;

export interface AptState {
  icao: string;
  config: number;              // index into pack.configs
  arr: string[]; dep: string[]; // runway ends in use
  pendingConfig: { config: number; at: number } | null;
  closed: Record<string, number>; // runway pair -> reopen tick (CLOSED_UNTIL_REOPENED: until the tower reopens it)
  /** The configured runways before any closure, restored when everything reopens. */
  base?: { arr: string[]; dep: string[] };
  lastDep: Record<string, { cs: string; wake: Wake; sid: string | null; at: number | null }>; // per departure end: last departure (airborne tick)
  standOcc: Record<string, string>; // stand -> callsign
  stack: Record<string, string[]>;  // stack name -> callsigns holding, bottom first
  seq: string[];                    // landing sequence (AI Director)
  lastRelease: Record<string, number>; // per arrival end: tick of the last AI release
  fillers: Record<string, { type: string; operator: string }>; // stand -> static parked aircraft (scenery)
}

export interface State {
  tick: number;
  rng: number;
  start: number;               // unix at tick 0
  durationS: number;
  coverage: SeatId[];
  difficulty: Difficulty;
  mode: Mode;
  aircraft: Aircraft[];
  schedule: Spawn[];           // future spawns, sorted by .at (tick)
  apts: AptState[];
  weather: Weather;
  radio: Radio[];              // recent transmissions (capped)
  radioId: number;
  pending: { tick: number; cs: string; seat: SeatId; msg: Radio['msg']; apply?: Command[]; light?: boolean }[];
  events: ScoreEvent[];
  alerts: { tick: number; level: 'info' | 'caution' | 'conflict'; text: string; cs?: string }[];
  stats: Stats;
  incidents: Incident[];
  vehicles: { id: string; kind: 'fire' | 'followme' | 'tug'; x: number; y: number; hdg: number; lights: boolean; target: XY | null; home: XY; until: number }[];
  ended: null | 'time' | 'incident' | 'endless-over';
  cmdLog: { tick: number; seat: SeatId; cmds: Command[]; voice?: boolean }[];
  squawks: string[];           // in use
  nextEmergencyAt: number;
  endlessLevel: number;
  /** Rolling STCA pairs currently alerting, "A|B" -> level. */
  stca: Record<string, 'caution' | 'conflict'>;
  sepActive: Record<string, number>; // pair -> tick started (to count each loss once)
}

export interface Stats {
  landed: number; departed: number; spawned: number;
  depDelayS: number; arrDelayS: number; holdS: number; extraTrackNm: number; fuelKg: number;
  goArounds: number; transmissions: number; congestedS: number;
  unanswered: number; lateHandoffs: number; earlyHandoffs: number; readbackMissed: number; readbackCaught: number;
  sepLoss: number; runwayLoss: number; incursions: number; wakeInf: number; collisions: number; taxiConflicts: number;
  emergencies: number; emergenciesHandled: number;
  badRt: number;
}

export const newStats = (): Stats => ({
  landed: 0, departed: 0, spawned: 0, depDelayS: 0, arrDelayS: 0, holdS: 0, extraTrackNm: 0, fuelKg: 0,
  goArounds: 0, transmissions: 0, congestedS: 0, unanswered: 0, lateHandoffs: 0, earlyHandoffs: 0, readbackMissed: 0, readbackCaught: 0,
  sepLoss: 0, runwayLoss: 0, incursions: 0, wakeInf: 0, collisions: 0, taxiConflicts: 0, emergencies: 0, emergenciesHandled: 0, badRt: 0,
});

export function rand(st: State): number { // mulberry32 with state kept in State
  let t = (st.rng = (st.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const pick = <T>(st: State, a: T[]): T => a[Math.floor(rand(st) * a.length)];
export const ticks = (s: number) => Math.round(s * TICK_HZ);
export const now = (st: State) => st.start + st.tick * DT;
