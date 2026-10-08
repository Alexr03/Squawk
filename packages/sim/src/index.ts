// Squawk sim core: pure TypeScript, no DOM. Deterministic 4 Hz tick, seeded RNG; commands are the only input.
import { TYPES } from './aircraft.ts';
import { aiStep } from './ai.ts';
import { dist, NM } from './geo.ts';
import { emergencies, emergencyAftermath, nordo, runwayConfig, scheduleNextEmergency, approachChecks } from './events.ts';
import { moveAir, moveGround } from './physics.ts';
import { deliverPending, find, goAround, initialCall, issue as rawIssue, settleOwnership } from './pilot.ts';
import { arrivalCalls, earlyHandoff, event, groundRules, handoffs, radioRules, separation, startRolls, thresholdCheck } from './rules.ts';
import { DT, newStats, pick, rand, seatRole, ticks, type AptState, type ShiftConfig, type State } from './state.ts';
import { buildSchedule, realMix, spawn, synthDay } from './traffic.ts';
import { facility } from './incidents.ts';

const TOWER_ACTIONS = new Set<string>(['rescue', 'closerwy', 'openrwy']);
import type { Command } from './types.ts';
import { chooseConfig, initialWeather, updateWeather } from './weather.ts';
import type { World } from './world.ts';

export * from './types.ts';
export * from './state.ts';
export { TYPES, KNOWN_TYPES } from './aircraft.ts';
export { AIRLINES, airline } from './airlines.ts';
export { buildWorld, route, viaNames, runwayAt, finalPoint, along, lateral, pointOnEnd, type World, type Apt, type EndInfo } from './world.ts';
export { depGap, appSpacing, WAKE_APP, WAKE_DEP, isDark, etaToThreshold } from './ai.ts';
export { validate, nextSeats, find, taxiTarget, runwayFree, routeStart, startHdg } from './pilot.ts';
export { flowPenalty } from './physics.ts';
export { domain } from './rules.ts';
export { debrief, type Debrief } from './score.ts';
export { views, aircraftView } from './views.ts';
export { declare as declareEmergency } from './events.ts';
export { isClosed, crash } from './incidents.ts';
export { localHour, chooseConfig } from './weather.ts';
export * as geo from './geo.ts';

export function createShift(world: World, cfg: ShiftConfig): State {
  const st: State = {
    tick: 0, rng: cfg.seed | 0, start: cfg.start, durationS: cfg.durationS, coverage: [...cfg.coverage], difficulty: cfg.difficulty, mode: cfg.mode,
    aircraft: [], schedule: [], apts: [], weather: null as never, radio: [], radioId: 0, pending: [], events: [], alerts: [], stats: newStats(),
    vehicles: [], incidents: [], ended: null, cmdLog: [], squawks: [], nextEmergencyAt: 0, endlessLevel: 1, stca: {}, sepActive: {},
  };
  st.weather = initialWeather(cfg, st);
  for (const [i, icao] of cfg.airports.entries()) {
    const apt = world.byIcao[icao];
    const config = cfg.config?.[i] ?? chooseConfig(apt, st.weather.wind, cfg.start);
    const c = apt.pack.configs[config];
    const as: AptState = { icao, config, arr: [...c.arrivals], dep: [...c.departures], pendingConfig: null, closed: {}, lastDep: {}, standOcc: {}, stack: {}, seq: [], fillers: {}, lastRelease: {} };
    // A living apron: parked aircraft on about half the stands (they give way when a stand is needed).
    // Each parked aircraft is a real airline + type pairing from the day, sized for the stand, its airline's terminal preferred.
    const mix = realMix(cfg.days[i]);
    const fits = (s: (typeof apt.stands)[number], type: string) => { const w = TYPES[type]?.wake; return s.maxWake === 'J' || (s.maxWake === 'H' ? w !== 'J' : w === 'L' || w === 'M'); };
    for (const s of apt.stands) if (rand(st) < 0.45) {
      const sized = mix.filter(f => fits(s, f.type));
      const local = sized.filter(f => apt.pack.airlineTerminals[f.operator] === s.terminal);
      const pool = local.length && rand(st) < 0.7 ? local : sized;
      const f = pool[Math.floor(rand(st) * pool.length)];
      if (f) as.fillers[s.ref] = { type: f.type, operator: f.operator };
    }
    st.apts.push(as);
  }
  // Endless invents its traffic, but from each airport's real airline/aircraft/destination mix.
  // Endless starts quiet (about 14 movements an hour for its first half hour) and then ramps up (see endless()).
  buildSchedule(world, cfg.mode === 'endless' ? { ...cfg, days: cfg.days.map(() => null), durationS: 1800 } : cfg, st, cfg.mode === 'endless' ? cfg.days.map(realMix) : undefined, cfg.mode === 'endless' ? 7 : undefined); // per direction
  scheduleNextEmergency(st);
  return st;
}

/** Issue a controller transmission from whichever of the player's seats the aircraft is on. */
export function issue(world: World, st: State, cmds: Command[], opts: { voice?: boolean; seat?: string } = {}): string | null {
  // The tower's own actions (fire service, runway closures) aren't radio calls to an aircraft.
  if (cmds[0] && TOWER_ACTIONS.has(cmds[0].verb)) {
    const err = facility(world, st, cmds[0]);
    if (!err) st.cmdLog.push({ tick: st.tick, seat: 'tower', cmds });
    return err;
  }
  const ac = cmds[0] && find(st, cmds[0].cs);
  if (!ac) return `${cmds[0]?.cs ?? '?'}: no such aircraft`;
  const seat = opts.seat ?? ac.freq;
  if (!st.coverage.includes(seat)) return `${ac.cs} is on ${seatRole(seat)}, not your frequency`;
  if (cmds.some(c => c.verb === 'contact')) earlyHandoff(world, st, ac);
  return rawIssue(world, st, seat, cmds, { voice: opts.voice });
}

export function step(world: World, cfg: Pick<ShiftConfig, 'days' | 'weather'>, st: State) {
  if (st.ended) return;
  st.tick++;
  deliverPending(world, st);
  settleOwnership(st);

  // Spawns that are due.
  for (const sp of st.schedule.filter(s => s.at <= st.tick)) {
    const ac = spawn(world, st, sp);
    if (!ac && st.tick - sp.at < ticks(1800)) continue; // no stand yet, try again
    st.schedule.splice(st.schedule.indexOf(sp), 1);
    if (!ac) continue;
    st.aircraft.push(ac);
    st.stats.spawned++;
    initialCall(world, st, ac, 1 + rand(st) * 4);
  }

  aiStep(world, st);
  startRolls(world, st);

  for (const ac of st.aircraft) {
    const prev = ac.phase;
    if (ac.onGround) moveGround(world, st, ac); else moveAir(world, st, ac);
    if (prev === 'takeoff' && ac.phase === 'climb') st.stats.departed++;
    const r = thresholdCheck(world, st, ac);
    if (r === 'no-clearance' || r === 'closed') {
      event(st, { kind: 'goaround', severity: 1, text: `${ac.cs} going around: ${r === 'closed' ? 'runway closed' : 'no landing clearance'}`, cs: [ac.cs] });
      goAround(world, st, ac, true);
    }
    arrivalCalls(world, st, ac, prev);
    if (st.tick - ac.trailT >= ticks(4)) { ac.trail.push({ x: Math.round(ac.x), y: Math.round(ac.y) }); if (ac.trail.length > 6) ac.trail.shift(); ac.trailT = st.tick; }
    if (!ac.onGround) st.stats.fuelKg += (TYPES[ac.type].wake === 'M' ? 0.7 : TYPES[ac.type].wake === 'J' ? 3.3 : 2) * DT;
    // Departures leave the map; parked arrivals shut down.
    if (ac.kind === 'dep' && !ac.onGround && dist(ac, world.primary.offset) > world.primary.pack.airspace.areaRadiusNm * NM * 0.8) ac.phase = 'gone';
  }
  for (const ac of st.aircraft.filter(a => a.phase === 'gone')) {
    st.squawks = st.squawks.filter(s => s !== ac.squawk);
    const as = st.apts.find(a => a.icao === ac.apt);
    if (as && ac.stand && as.standOcc[ac.stand] === ac.cs && ac.kind === 'arr') {
      delete as.standOcc[ac.stand];
      as.fillers[ac.stand] = { type: ac.type, operator: ac.operator }; // it stays parked on the stand
    }
  }
  st.aircraft = st.aircraft.filter(a => a.phase !== 'gone');

  if (st.tick % 2 === 0) separation(world, st);
  groundRules(world, st);
  handoffs(world, st);
  radioRules(world, st);
  approachChecks(world, st);
  emergencies(world, st);
  emergencyAftermath(world, st);
  nordo(world, st);
  runwayConfig(world, st);
  updateWeather(world, cfg, st);
  if (st.alerts.length > 200) st.alerts.splice(0, st.alerts.length - 200);
  if (st.events.length > 500) st.events.splice(0, st.events.length - 500);

  if (st.mode === 'endless') endless(world, st, cfg);
  else if (st.durationS && st.tick >= ticks(st.durationS)) st.ended = 'time';
}

/** Endless: traffic keeps ramping until something breaks. */
function endless(world: World, st: State, cfg: Pick<ShiftConfig, 'days'>) {
  if (st.tick % ticks(300) === 1) {
    const from = st.start + st.tick * DT + 1500, to = from + 300;
    const perHour = 16 + st.endlessLevel * 6;
    st.endlessLevel++;
    for (const [i, as] of st.apts.entries()) {
      const apt = world.byIcao[as.icao];
      const day = synthDay(apt, from, to, st, perHour, realMix(cfg.days[i]));
      for (const f of day.flights) st.schedule.push({ at: ticks(f.time - (f.kind === 'dep' ? 22 * 60 : 26 * 60) - st.start), kind: f.kind, apt: as.icao, cs: f.cs + (st.endlessLevel % 10), type: f.type, operator: f.operator, other: f.other, sched: f.time });
    }
    st.schedule.sort((a, b) => a.at - b.at);
  }
  // Endless runs until something actually hits: a loss of separation costs score, not the shift.
  if (st.stats.collisions >= 3) st.ended = 'endless-over'; // crashes are survivable; three of them end the run
}

/** Snapshot for the UI thread: everything except the bulky future schedule and replay log. */
export function snapshot(st: State) {
  const { schedule, cmdLog, pending, ...rest } = st;
  void cmdLog;
  // Only instructions awaiting a readback: the UI shows a 'reading back' cue on those aircraft.
  return { ...rest, schedule: [], cmdLog: [], pending: pending.filter(p => p.apply), upcoming: schedule.slice(0, 40), radio: st.radio.slice(-200) } as State & { upcoming: State['schedule'] };
}

/** Re-run a shift from its config and command log. Same inputs, same final state. */
export function replay(world: World, cfg: ShiftConfig, log: State['cmdLog'], until: number): State {
  const st = createShift(world, cfg);
  let i = 0;
  while (st.tick < until && !st.ended) {
    while (i < log.length && log[i].tick === st.tick) { if (TOWER_ACTIONS.has(log[i].cmds[0]?.verb)) { facility(world, st, log[i].cmds[0]); i++; continue; } rawIssue(world, st, log[i].seat, log[i].cmds, { voice: log[i].voice }); i++; }
    step(world, cfg, st);
  }
  return st;
}

export function hashState(st: State): string { // FNV-1a over the serialised state
  let h = 0x811c9dc5;
  const s = JSON.stringify(st);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Verbs that make sense for this aircraft from this seat right now (radial menu). */
export function validVerbs(world: World, st: State, cs: string): Command['verb'][] {
  const ac = find(st, cs);
  if (!ac || !st.coverage.includes(ac.freq)) return [];
  const role = seatRole(ac.freq);
  const verbs: Command['verb'][] = [];
  const add = (v: Command['verb'], ok: boolean) => { if (ok) verbs.push(v); };
  const air = !ac.onGround;
  switch (role) {
    case 'DEL': add('clearance', ac.phase === 'stand' && !ac.cleared.dl); break;
    case 'GND':
      add('push', ac.phase === 'stand' && ac.cleared.dl && !ac.cleared.push);
      add('taxi', ['pushed', 'taxi', 'taxiin', 'vacating', 'holding'].includes(ac.phase));
      add('greens', ['pushed', 'taxi', 'taxiin', 'vacating'].includes(ac.phase));
      add('holdshort', ['taxi', 'taxiin'].includes(ac.phase));
      add('continue', ['taxi', 'taxiin'].includes(ac.phase) && ac.gs < 1);
      add('cross', ['taxi', 'taxiin'].includes(ac.phase));
      break;
    case 'TWR':
      add('luw', ac.phase === 'holding' && !ac.cleared.luw);
      add('cto', ['holding', 'lineup', 'lined'].includes(ac.phase) && !ac.cleared.cto);
      add('land', ac.kind === 'arr' && air && !ac.cleared.land && (ac.phase === 'final' || ac.nav.established));
      add('goaround', ac.kind === 'arr' && air && ac.phase !== 'goaround');
      add('cross', ['taxi', 'taxiin'].includes(ac.phase));
      add('heading', air); add('alt', air);
      break;
    case 'DIR': case 'LON':
      add('heading', air); add('alt', air); add('speed', air); add('direct', air);
      add('ils', role === 'DIR' && ac.kind === 'arr' && air); add('hold', air); add('resume', air);
      break;
  }
  add('contact', true);
  if (ac.req) verbs.push('unable');
  if (ac.rbErr || ac.last.length) verbs.push('negative');
  return verbs;
}
