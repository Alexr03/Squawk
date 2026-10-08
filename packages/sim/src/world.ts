// Static world built once from airport packs: taxi graphs, runway geometry, procedures, frequencies.
// Not part of the serialisable State; every sim function takes (world, state).
import { angleDiff, bearing, dist, fromBearing, NM, project, segDist } from './geo.ts';
import type { AirportPack, Fix, RunwayEnd, Seat, Stand, XY } from './types.ts';

export interface EndInfo extends RunwayEnd {
  runway: string;             // pair name "09L/27R"
  opposite: string;           // "09L" for "27R"
  len: number;                // physical length (m)
  ux: number; uy: number;     // unit vector along the take-off direction (end -> far end)
  thrS: number;               // threshold distance from the take-off end along u
  holds: number[];            // named holding-point nodes for departures on this end
  front: number[];            // holds nearest the runway on each link (others are CAT III positions behind them)
}
export interface Apt {
  icao: string;
  pack: AirportPack;
  offset: XY;                 // pack origin in world frame
  nodes: { id: number; x: number; y: number; hold?: string; holdRunway?: string; stand?: string }[];
  adj: { to: number; edge: number }[][];
  edges: { a: number; b: number; name: string; runway?: string; len: number }[];
  ends: Record<string, EndInfo>;
  runways: { name: string; a: XY; b: XY; width: number; len: number; ends: [string, string] }[];
  stands: (Stand & { x: number; y: number })[];
  standByRef: Record<string, Stand & { x: number; y: number }>;
  /** Node indices that sit on a runway (within the runway strip), keyed by runway pair. */
  onRunway: Map<number, string>;
  /** Nodes within 35 m of each node (occupancy locks cover these too). */
  near: number[][];
  fixes: Record<string, Fix>;
  freq: Record<Seat, { callsign: string; freq: string }>;
  terminalFor(operator: string): string;
  fire: XY;
}
export interface World { apts: Apt[]; byIcao: Record<string, Apt>; primary: Apt }

const RWY_HALF = 45;          // lateral half-width (m) treated as "on the runway" for occupancy

export function buildWorld(packs: AirportPack[]): World {
  const primary = packs[0];
  const apts = packs.map(p => buildApt(p, project(primary.arp, p.arp)));
  return { apts, byIcao: Object.fromEntries(apts.map(a => [a.icao, a])), primary: apts[0] };
}

function buildApt(pack: AirportPack, off: XY): Apt {
  const o = (p: XY) => ({ x: p.x + off.x, y: p.y + off.y });
  const nodes = pack.taxi.nodes.map(n => ({ ...n, ...o(n) }));
  const edges = pack.taxi.edges.map(e => ({ a: e.a, b: e.b, name: e.name, runway: e.runway, len: e.lengthM }));
  const adj: Apt['adj'] = nodes.map(() => []);
  edges.forEach((e, i) => { adj[e.a].push({ to: e.b, edge: i }); adj[e.b].push({ to: e.a, edge: i }); });

  const runways = pack.runways.map(r => ({ name: r.name, a: o(r.ends[0].end), b: o(r.ends[1].end), width: r.widthM, len: r.lengthM, ends: [r.ends[0].name, r.ends[1].name] as [string, string] }));
  const ends: Record<string, EndInfo> = {};
  for (const r of pack.runways) {
    const [e0, e1] = r.ends;
    for (const [e, f] of [[e0, e1], [e1, e0]] as [RunwayEnd, RunwayEnd][]) {
      const start = o(e.end), far = o(f.end), len = dist(start, far);
      const ux = (far.x - start.x) / len, uy = (far.y - start.y) / len;
      const thr = o(e.thr);
      ends[e.name] = { ...e, thr, end: start, runway: r.name, opposite: f.name, len, ux, uy, thrS: (thr.x - start.x) * ux + (thr.y - start.y) * uy, holds: [], front: [] };
    }
  }
  const onRunway = new Map<number, string>();
  for (const n of nodes) for (const r of runways) {
    if (segDist(n, r.a, r.b).d < RWY_HALF) { onRunway.set(n.id, r.name); break; }
  }
  for (const n of nodes) if (n.hold && n.holdRunway && ends[n.holdRunway]) ends[n.holdRunway].holds.push(n.id);
  // Order departure holds: full-length first (nearest the take-off end).
  for (const e of Object.values(ends)) e.holds.sort((a, b) => along(e, nodes[a]) - along(e, nodes[b]));

  const apt0 = { nodes, adj, edges, onRunway, runways } as unknown as Apt;
  for (const e of Object.values(ends)) {
    const front = e.holds.filter(h => {
      const p = routeToRunway(apt0, h, e);
      return !!p && !p.slice(1).some(n => nodes[n].hold && e.holds.includes(n));
    });
    // Keep holds whose line-up routes can't be blocked by someone waiting at another kept hold.
    const kept: { h: number; path: number[] }[] = [];
    // Each side of the runway is filtered separately, so both sides keep their holds.
    for (const h of [...front.filter(h => lateral(e, nodes[h]) > 0), ...front.filter(h => lateral(e, nodes[h]) <= 0)]) {
      const path = routeToRunway(apt0, h, e)!;
      const clash = kept.some(k => Math.sign(lateral(e, nodes[k.h])) === Math.sign(lateral(e, nodes[h])) && (k.path.some(n => dist(nodes[n], nodes[h]) < 70) || path.some(n => dist(nodes[n], nodes[k.h]) < 70)));
      if (!clash) kept.push({ h, path });
    }
    e.front = kept.map(k => k.h);
  }
  const fixes: Record<string, Fix> = {};
  for (const [k, f] of Object.entries(pack.airspace.fixes)) fixes[k] = { ...f, ...o(f) };
  const freq = {} as Apt['freq'];
  for (const f of pack.frequencies) if (!freq[f.seat]) freq[f.seat] = { callsign: f.callsign, freq: f.freq };
  const stands = pack.stands.map(s => ({ ...s, ...o(s) }));
  // Spatial neighbours via a coarse grid.
  const cell = (v: number) => Math.floor(v / 40);
  const grid = new Map<string, number[]>();
  for (const n of nodes) { const k = cell(n.x) + ',' + cell(n.y); if (!grid.has(k)) grid.set(k, []); grid.get(k)!.push(n.id); }
  const near = nodes.map(n => {
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const m of grid.get((cell(n.x) + dx) + ',' + (cell(n.y) + dy)) ?? []) if (m !== n.id && dist(nodes[m], n) < 35) out.push(m);
    return out;
  });
  return {
    icao: pack.icao, pack, offset: off, nodes, adj, edges, ends, runways, stands,
    standByRef: Object.fromEntries(stands.map(s => [s.ref, s])), onRunway, near, fixes, freq,
    terminalFor: op => pack.airlineTerminals[op] ?? '',
    fire: pack.fireStation ? o(pack.fireStation) : o({ x: 0, y: 0 }),
  };
}

/** Distance of p along an end's take-off direction, from its start. */
export const along = (e: EndInfo, p: XY) => (p.x - e.end.x) * e.ux + (p.y - e.end.y) * e.uy;
/** Signed lateral offset of p from an end's centreline (positive = right of the take-off direction). */
export const lateral = (e: EndInfo, p: XY) => (p.x - e.end.x) * e.uy - (p.y - e.end.y) * e.ux;
export const pointOnEnd = (e: EndInfo, s: number, off = 0): XY => ({ x: e.end.x + e.ux * s + e.uy * off, y: e.end.y + e.uy * s - e.ux * off });

/** Which runway pair (if any) a ground position is on. */
export function runwayAt(apt: Apt, p: XY): string | null {
  for (const r of apt.runways) { const s = segDist(p, r.a, r.b); if (s.d < RWY_HALF && s.t > 0 && s.t < 1) return r.name; }
  return null;
}

// ------------------------------------------------------------------ routing

export interface RouteOpts {
  /** Extra cost per edge (e.g. occupied or against the flow). */
  penalty?: (edge: number, from: number, to: number) => number;
  /** Runway pairs the route may cross (others are avoided where possible). */
  allowRunway?: (runway: string) => boolean;
  /** Restrict to taxiways with these names first (controller-given route), in order. */
  via?: string[];
  /** Heading the aircraft is already pointing: the route must not start with a U-turn. */
  hdg?: number;
}

/** A* over the taxi graph. Runway edges cost a lot so routes cross runways only where they must. */
export function route(apt: Apt, from: number, to: number, opts: RouteOpts = {}): number[] | null {
  if (opts.via?.length) {
    const r = routeVia(apt, from, to, opts.via, opts);
    if (r) return r;
  }
  const r = astar(apt, from, n => n === to, apt.nodes[to], opts);
  // Boxed in (a dead end ahead): accept turning round rather than no route at all.
  return r ?? (opts.hdg !== undefined ? route(apt, from, to, { ...opts, hdg: undefined }) : null);
}

function astar(apt: Apt, from: number, goal: (n: number) => boolean, target: XY, opts: RouteOpts, edgeOk?: (e: number) => boolean): number[] | null {
  const g = new Map<number, number>([[from, 0]]), came = new Map<number, number>();
  const open: [number, number][] = [[dist(apt.nodes[from], target), from]];
  const closed = new Set<number>();
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, cur] = open.splice(bi, 1)[0];
    if (closed.has(cur)) continue;
    if (goal(cur)) { const path = [cur]; let c = cur; while (came.has(c)) { c = came.get(c)!; path.unshift(c); } return path; }
    closed.add(cur);
    const gc = g.get(cur)!;
    const prev = came.get(cur);
    for (const { to, edge } of apt.adj[cur]) {
      if (closed.has(to) || (edgeOk && !edgeOk(edge))) continue;
      const e = apt.edges[edge];
      let cost = e.len;
      if (e.runway) {
        if (opts.allowRunway?.(e.runway)) cost += e.len * 2;
        else {
          // Crossing a runway is allowed; taxiing along one is not.
          const rw = apt.runways.find(r => r.name === e.runway);
          if (rw && Math.abs(Math.sin((bearing(apt.nodes[cur], apt.nodes[to]) - bearing(rw.a, rw.b)) * Math.PI / 180)) < 0.5) continue;
          cost += e.len * 40 + 4000;
        }
      }
      // An aircraft already pointing somewhere can't start by reversing.
      if (prev === undefined && cur === from && opts.hdg !== undefined && Math.abs(angleDiff(opts.hdg, bearing(apt.nodes[cur], apt.nodes[to]))) > 110) continue;
      // Discourage sharp turns (aircraft can't pivot on the spot).
      if (prev !== undefined) {
        const turn = Math.abs(angleDiff(bearing(apt.nodes[prev], apt.nodes[cur]), bearing(apt.nodes[cur], apt.nodes[to])));
        if (turn > 100) cost += 600; else if (turn > 60) cost += 60;
      }
      if (opts.penalty) cost += opts.penalty(edge, cur, to);
      const ng = gc + cost;
      if (ng < (g.get(to) ?? Infinity)) { g.set(to, ng); came.set(to, cur); open.push([ng + dist(apt.nodes[to], target), to]); }
    }
  }
  return null;
}

/** Shortest route from a node onto a runway's centreline (for line-up from a holding point). */
export function routeToRunway(apt: Apt, from: number, end: EndInfo): number[] | null {
  const goal = (n: number) => apt.onRunway.get(n) === end.runway && Math.abs(lateral(end, apt.nodes[n])) < 8;
  const target = pointOnEnd(end, Math.max(0, along(end, apt.nodes[from])));
  return astar(apt, from, goal, target, { allowRunway: r => r === end.runway });
}

/** Route that follows the named taxiways in order (controller's "via A, B2"), then the shortest path to the goal. */
function routeVia(apt: Apt, from: number, to: number, via: string[], opts: RouteOpts): number[] | null {
  let path = [from];
  for (const name of via) {
    const cur = path[path.length - 1];
    const onIt = apt.adj[cur].some(a => apt.edges[a.edge].name === name);
    // Get onto the named taxiway (shortest), then ride it as far toward the goal as it goes.
    const reach = onIt ? [cur] : astar(apt, cur, n => apt.adj[n].some(a => apt.edges[a.edge].name === name), apt.nodes[to], opts);
    if (!reach) return null;
    path = path.concat(reach.slice(1));
    if (path.length > 1) opts = { ...opts, hdg: undefined }; // the heading only constrains the first step
    const ride = astar(apt, path[path.length - 1], n => n === to || !apt.adj[n].some(a => apt.edges[a.edge].name === name) ? false : nearer(apt, n, to),
      apt.nodes[to], opts, e => apt.edges[e].name === name);
    if (ride) path = path.concat(ride.slice(1));
    if (path.length > 1) opts = { ...opts, hdg: undefined };
  }
  const rest = astar(apt, path[path.length - 1], n => n === to, apt.nodes[to], opts);
  return rest ? dedupe(path.concat(rest.slice(1))) : null;
}
function nearer(apt: Apt, n: number, to: number) {
  // A node on the taxiway from which leaving is reasonable: one that's a junction with something else, closest to the goal.
  return apt.adj[n].length > 2 && dist(apt.nodes[n], apt.nodes[to]) < 400;
}
function dedupe(p: number[]) { return p.filter((n, i) => i === 0 || n !== p[i - 1]); }

/** Taxiway names along a path, collapsed ("A", "B2", ...), for the radio. */
export function viaNames(apt: Apt, path: number[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < path.length; i++) {
    const e = apt.adj[path[i - 1]].find(a => a.to === path[i]);
    const name = e ? apt.edges[e.edge].name : '';
    if (name && out[out.length - 1] !== name && !apt.edges[e!.edge].runway) out.push(name);
  }
  return out.slice(0, 6);
}

export function pathLength(apt: Apt, path: number[]) {
  let s = 0; for (let i = 1; i < path.length; i++) s += dist(apt.nodes[path[i - 1]], apt.nodes[path[i]]); return s;
}

// ------------------------------------------------------------------ approach geometry

/** Point on the extended centreline of an arrival end, nm before the threshold. */
export const finalPoint = (e: EndInfo, nm: number): XY => ({ x: e.thr.x - e.ux * nm * NM, y: e.thr.y - e.uy * nm * NM });

/** AI Director transition from a stack to the ILS: downwind, base, intercept, as points. */
export function transition(apt: Apt, stackFix: XY, end: EndInfo): XY[] {
  const hdg = bearing(end.end, pointOnEnd(end, 1000));
  // Downwind on the stack's side of the centreline.
  const side = lateral(end, stackFix) > 0 ? 1 : -1;
  const off = 5.5 * NM * side;
  const thr = end.thr;
  const abeam = { x: thr.x + end.uy * off, y: thr.y - end.ux * off };
  const baseTurn = fromBearing(abeam, hdg + 180, 11 * NM);
  const intercept = finalPoint(end, 12.5);
  const entry = fromBearing(abeam, hdg, 4 * NM);
  // If the stack is ahead of the runway (approaching from the far side) join downwind early; else go straight to base.
  const pts = along(end, stackFix) > along(end, thr) - 4 * NM ? [entry, baseTurn, intercept] : [baseTurn, intercept];
  return pts;
}
