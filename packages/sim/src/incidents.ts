// When things go wrong: crashes and emergency stops become incidents on the map, with fire, smoke and a fire service
// the tower has to send. Runways with something on them close; the tower reopens them once the site is clear.
import { dist } from './geo.ts';
import { aptOf, aptState } from './physics.ts';
import { event } from './rules.ts';
import { CLOSED_UNTIL_REOPENED, DT, seatId, ticks, type Aircraft, type Incident, type State } from './state.ts';
import type { Command } from './types.ts';
import { route, runwayAt, type Apt, type World } from './world.ts';
import type { XY } from './types.ts';

const EXTINGUISH_S = 75;      // a fully burning wreck, once crews are on scene
const BURN_OUT_S = 600;       // with nobody there, a fire dies down by itself (the wreck stays)
const CLEAR_CRASH_S = 360;    // recovering a wreck after the fire is out
const CLEAR_STOP_S = 150;     // checking an aircraft that stopped on the runway, then towing it clear
const WARN_S = 150;           // the tower should have sent the fire service by now

const towerIsAi = (st: State, icao: string) => !st.coverage.includes(seatId(icao, 'TWR'));

/** Two aircraft have collided (air or ground): wrecks, fire, and a closed runway if it happened on one. */
export function crash(world: World, st: State, a: Aircraft, b: Aircraft, air: boolean) {
  const apt = aptOf(world, a);
  const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
  const offAirport = dist({ x, y }, apt.offset) > 4500;
  const runway = offAirport ? null : runwayAt(apt, { x, y }) ?? null;
  for (const ac of [a, b]) {
    ac.gs = 0; ac.ias = 0; ac.vs = 0; ac.halted = false;
    // In the air there is nothing left to control; on the ground the wrecks stay where they are.
    ac.phase = air ? 'gone' : 'wreck';
    if (!air) ac.onGround = true;
  }
  open(world, st, { kind: 'crash', apt: a.apt, x, y, runway, fire: 1, cs: [a.cs, b.cs], offAirport });
  event(st, { kind: 'collision', severity: 5, text: `${air ? 'MID-AIR COLLISION' : 'COLLISION'}: ${a.cs} and ${b.cs}${runway ? ` on runway ${runway}` : offAirport ? ', outside the airfield' : ''}`, cs: [a.cs, b.cs], x, y });
}

/** An emergency arrival has stopped on the runway: the fire service has to meet it there. */
export function emergencyStop(world: World, st: State, ac: Aircraft) {
  const apt = aptOf(world, ac);
  ac.phase = 'stopped'; ac.gs = 0; ac.ias = 0;
  const runway = runwayAt(apt, ac) ?? (ac.runway ? apt.ends[ac.runway]?.runway ?? null : null);
  open(world, st, { kind: 'emergency', apt: ac.apt, x: ac.x, y: ac.y, runway, fire: ac.emergency?.nature === 'engine' ? 0.45 : 0, cs: [ac.cs], offAirport: false });
  event(st, { kind: 'emergency', severity: 2, text: `${ac.cs} has stopped on runway ${runway ?? ''}${ac.emergency?.nature === 'engine' ? ' with an engine fire' : ''}: send the fire service`, cs: [ac.cs], x: ac.x, y: ac.y });
}

function open(world: World, st: State, i: Omit<Incident, 'id' | 'since' | 'dispatched' | 'onScene' | 'clearAt' | 'resolved' | 'warned'>) {
  const inc: Incident = { ...i, id: `inc${st.tick}-${st.incidents.length}`, since: st.tick, dispatched: null, onScene: null, clearAt: null, resolved: false, warned: false };
  st.incidents.push(inc);
  if (inc.runway) closeRunway(world, st, inc.apt, inc.runway);
  if (inc.offAirport) inc.dispatched = inc.onScene = st.tick; // local services; nothing for the tower to send
  return inc;
}

// ------------------------------------------------------------------ the tower's own actions

/** Fire service, runway closures: actions the tower takes itself rather than instructions to an aircraft. */
export function facility(world: World, st: State, c: Command): string | null {
  if (c.verb === 'rescue') {
    const inc = st.incidents.find(i => !i.resolved && i.cs.includes(c.cs));
    if (!inc) return `${c.cs} doesn't need the fire service`;
    if (towerIsAi(st, inc.apt)) return 'The AI tower is handling it';
    if (inc.dispatched !== null) return 'The fire service is already on its way';
    dispatch(world, st, inc);
    return null;
  }
  if (c.verb === 'closerwy' || c.verb === 'openrwy') {
    const apt = world.byIcao[c.apt];
    if (!apt) return `Unknown airport ${c.apt}`;
    if (towerIsAi(st, c.apt)) return `${c.apt} tower is run by the AI`;
    const pair = apt.runways.find(r => r.name === c.runway || r.ends.includes(c.runway))?.name;
    if (!pair) return `Unknown runway ${c.runway}`;
    const as = aptState(st, c.apt);
    if (c.verb === 'closerwy') {
      if ((as.closed[pair] ?? 0) > st.tick) return `Runway ${pair} is already closed`;
      closeRunway(world, st, c.apt, pair);
      st.alerts.push({ tick: st.tick, level: 'info', text: `Runway ${pair} closed` });
    } else {
      const blocked = st.incidents.find(i => !i.resolved && i.apt === c.apt && i.runway === pair);
      if (blocked) return `Runway ${pair} can't reopen: ${blocked.kind === 'crash' ? 'wreckage' : 'an aircraft'} still on it`;
      if ((as.closed[pair] ?? 0) <= st.tick) return `Runway ${pair} is already open`;
      reopenRunway(world, st, c.apt, pair);
      st.alerts.push({ tick: st.tick, level: 'info', text: `Runway ${pair} open` });
    }
    return null;
  }
  return 'Not a tower action';
}

function dispatch(world: World, st: State, inc: Incident) {
  const apt = world.byIcao[inc.apt];
  inc.dispatched = st.tick;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const target = { x: inc.x + Math.cos(a) * 32, y: inc.y + Math.sin(a) * 32 };
    st.vehicles.push({ id: `fire-${inc.id}-${k}`, kind: 'fire', x: apt.fire.x, y: apt.fire.y, hdg: 0, lights: true,
      target, home: { ...apt.fire }, until: CLOSED_UNTIL_REOPENED, path: roads(apt, apt.fire, target, inc.runway), leave: st.tick + ticks(k * 4) });
  }
  st.alerts.push({ tick: st.tick, level: 'info', text: `Fire service on its way to ${inc.cs.join(' / ')}` });
}

/** Waypoints along the taxi graph from a to b (crossing runways where it must, along the incident's own runway if quicker). */
function roads(apt: Apt, a: XY, b: XY, runway: string | null): XY[] {
  const p = route(apt, junction(apt, a), junction(apt, b), { allowRunway: r => r === runway }) ?? [];
  return [...p.map(n => ({ x: apt.nodes[n].x, y: apt.nodes[n].y })), b];
}
/** Nearest node on a through taxiway (not a stand's dead-end lead-in). */
function junction(apt: Apt, p: XY) {
  let best = 0, bd = Infinity;
  for (const n of apt.nodes) { const d = dist(n, p); if (d < bd && !n.stand && apt.adj[n.id].length > 1) { bd = d; best = n.id; } }
  return best;
}

// ------------------------------------------------------------------ runway closures

export const isClosed = (st: State, icao: string, pair: string) => (aptState(st, icao).closed[pair] ?? 0) > st.tick;

export function closeRunway(world: World, st: State, icao: string, pair: string) {
  const as = aptState(st, icao);
  as.base ??= { arr: [...as.arr], dep: [...as.dep] };
  as.closed[pair] = CLOSED_UNTIL_REOPENED;
  applyClosures(world, st, icao);
}
export function reopenRunway(world: World, st: State, icao: string, pair: string) {
  const as = aptState(st, icao);
  delete as.closed[pair];
  applyClosures(world, st, icao);
}

/** The runways in use, minus closed ones. If a whole direction is lost, the other runway goes mixed mode. */
function applyClosures(world: World, st: State, icao: string) {
  const as = aptState(st, icao), apt = world.byIcao[icao];
  const base = as.base ?? { arr: as.arr, dep: as.dep };
  const open = (e: string) => !isClosed(st, icao, apt.ends[e]?.runway ?? '');
  let arr = base.arr.filter(open), dep = base.dep.filter(open);
  if (!arr.length) arr = dep.slice(0, 1);
  if (!dep.length) dep = arr.slice(0, 1);
  // Single-runway airport with its runway closed: keep the names, nothing will be cleared onto it.
  as.arr = arr.length ? arr : base.arr; as.dep = dep.length ? dep : base.dep;
  if (!Object.keys(as.closed).some(p => isClosed(st, icao, p))) { as.arr = [...base.arr]; as.dep = [...base.dep]; as.base = undefined; }
}

// ------------------------------------------------------------------ each tick

export function updateIncidents(world: World, st: State) {
  for (const inc of st.incidents) {
    if (inc.resolved) continue;
    // An AI tower sends the fire service at once.
    if (inc.dispatched === null && towerIsAi(st, inc.apt)) dispatch(world, st, inc);
    if (inc.dispatched === null && !inc.warned && st.tick - inc.since > ticks(WARN_S)) {
      inc.warned = true;
      st.stats.unanswered++;
      event(st, { kind: 'emergency', severity: 3, text: `No fire service sent to ${inc.cs.join(' / ')} after ${Math.round(WARN_S / 60 * 10) / 10} minutes`, cs: inc.cs, x: inc.x, y: inc.y });
    }
    const crews = st.vehicles.filter(v => v.id.startsWith(`fire-${inc.id}-`));
    if (inc.onScene === null && crews.some(v => v.target && dist(v, v.target) < 6)) {
      inc.onScene = st.tick;
      st.alerts.push({ tick: st.tick, level: 'info', text: `Fire service on scene at ${inc.cs.join(' / ')}` });
    }
    // Fire: crews put it out quickly; left alone it slowly burns out.
    if (inc.fire > 0) inc.fire = Math.max(0, inc.fire - DT / (inc.onScene !== null ? EXTINGUISH_S : BURN_OUT_S));
    if (inc.onScene !== null && inc.fire === 0 && inc.clearAt === null) inc.clearAt = st.tick + ticks(inc.kind === 'crash' ? CLEAR_CRASH_S : CLEAR_STOP_S);
    if (inc.clearAt !== null && st.tick >= inc.clearAt) resolve(world, st, inc);
  }
  // Vehicles drive to the scene, stay until it is cleared, then go home.
  for (const v of st.vehicles) {
    if (st.tick < (v.leave ?? 0)) continue;
    // Called home: back the way it came.
    if (st.tick >= v.until && v.target) { v.target = null; v.path = [...(v.path ?? [])].reverse().slice(1).concat(v.home); v.pi = 0; }
    const path = v.path ?? [v.target ?? v.home];
    let sp = 18 * DT, i = v.pi ?? 0;
    while (sp > 0 && i < path.length) {
      const tgt = path[i], d = dist(v, tgt), k = Math.min(sp, d);
      if (d > 0.5) v.hdg = Math.atan2(tgt.x - v.x, tgt.y - v.y) * 180 / Math.PI;
      if (d > 0) { v.x += (tgt.x - v.x) / d * k; v.y += (tgt.y - v.y) / d * k; }
      sp -= k;
      if (k === d) i++;
    }
    v.pi = i;
  }
  st.vehicles = st.vehicles.filter(v => st.tick < v.until || dist(v, v.home) > 3);
  st.incidents = st.incidents.filter(i => !i.resolved || st.tick - (i.clearAt ?? i.since) < ticks(60)); // resolved ones linger a minute (smoke clearing)
}

function resolve(world: World, st: State, inc: Incident) {
  inc.resolved = true;
  // Wrecks are recovered; a stopped aircraft is towed to its stand.
  for (const ac of st.aircraft) if (inc.cs.includes(ac.cs) && (ac.phase === 'wreck' || ac.phase === 'stopped')) ac.phase = 'gone';
  for (const v of st.vehicles) if (v.id.startsWith(`fire-${inc.id}-`)) v.until = st.tick;
  if (!inc.runway) return;
  if (st.incidents.some(i => !i.resolved && i.apt === inc.apt && i.runway === inc.runway)) return; // something else still on it
  if (towerIsAi(st, inc.apt)) reopenRunway(world, st, inc.apt, inc.runway);
  else st.alerts.push({ tick: st.tick, level: 'info', text: `Runway ${inc.runway} is clear: reopen it when you are ready` });
}

/** Nothing on the airfield to deal with: for tools and tests. */
export const quiet = (st: State) => st.incidents.every(i => i.resolved);
