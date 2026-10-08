// Airport pack builder: OpenStreetMap geometry (Overpass) + hand-kept AIP corrections -> data/airports/<ICAO>/airport.json
// Usage: node tools/pipeline/airport.ts EGLL [--refresh]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { bearing, dist, dms, fromBearing, NM, project, segDist } from '../../packages/sim/src/geo.ts';
import type { AirportPack, Fix, LatLon, RunwayPack, Stand, TaxiEdge, TaxiNode, Wake, XY } from '../../packages/sim/src/types.ts';
import { londonMap } from './map.ts';
import { overpass } from './overpass.ts';
import { validate } from './validate.ts';

const icao = process.argv[2];
const refresh = process.argv.includes('--refresh');
if (!icao) { console.error('usage: node tools/pipeline/airport.ts <ICAO> [--refresh]'); process.exit(1); }
const corr = JSON.parse(readFileSync(new URL(`./corrections/${icao}.json`, import.meta.url), 'utf8'));
const ll = (p: [string, string]): LatLon => ({ lat: dms(p[0]), lon: dms(p[1]) });
const arp = ll(corr.arp);
const P = (p: LatLon): XY => { const q = project(arp, p); return { x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 }; };

interface OsmEl { type: 'node' | 'way' | 'relation'; id: number; lat?: number; lon?: number; tags?: Record<string, string>;
  nodes?: number[]; geometry?: { lat: number; lon: number }[]; members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[] }

const osm: { elements: OsmEl[] } = await overpass(`osm-${icao}`, `[out:json][timeout:180];
(way["aeroway"="aerodrome"]["icao"="${icao}"];relation["aeroway"="aerodrome"]["icao"="${icao}"];)->.ad;.ad map_to_area->.a;
(nwr(area.a)["aeroway"];way(area.a)["building"];relation(area.a)["building"];);out body geom;`, refresh);
const els = osm.elements;
const tag = (e: OsmEl, k: string) => e.tags?.[k];

// ------------------------------------------------------------------ taxi graph
interface GNode extends XY { id: number; adj: Map<number, { name: string; runway?: string }>; hold?: string; stand?: string; keep?: boolean }
const G = new Map<number, GNode>();
let nextId = 1;
const osmNode = new Map<number, number>();
function add(p: XY): GNode { const n: GNode = { id: nextId++, ...p, adj: new Map() }; G.set(n.id, n); return n; }
function link(a: GNode, b: GNode, name: string, runway?: string) {
  if (a === b) return;
  a.adj.set(b.id, { name, runway }); b.adj.set(a.id, { name, runway });
}
function unlink(a: GNode, b: GNode) { a.adj.delete(b.id); b.adj.delete(a.id); }
const twName = (e: OsmEl) => (tag(e, 'ref') ?? tag(e, 'name') ?? '').replace(/^Taxiway\s+/i, '').trim();

const taxiWays = els.filter(e => e.type === 'way' && ['taxiway', 'taxilane', 'runway'].includes(tag(e, 'aeroway') ?? '') && tag(e, 'area') !== 'yes');
for (const w of taxiWays) {
  const rwy = tag(w, 'aeroway') === 'runway' ? tag(w, 'ref') : undefined;
  let prev: GNode | null = null;
  w.nodes!.forEach((id, i) => {
    let n = osmNode.get(id) ? G.get(osmNode.get(id)!)! : null;
    if (!n) { n = add(P(w.geometry![i])); osmNode.set(id, n.id); }
    if (prev) link(prev, n, rwy ? '' : twName(w), rwy);
    prev = n;
  });
}

/** Insert a node on the nearest edge within maxD of p (or reuse an endpoint nearby). */
function snap(p: XY, maxD: number, exclude?: GNode, filter?: (e: { name: string; runway?: string }) => boolean): GNode | null {
  let best: { a: GNode; b: GNode; d: number; t: number } | null = null;
  for (const a of G.values()) for (const [bid, e] of a.adj) {
    if (bid < a.id) continue;
    const b = G.get(bid)!;
    if (a === exclude || b === exclude || (filter && !filter(e))) continue;
    const s = segDist(p, a, b);
    if (s.d < maxD && (!best || s.d < best.d)) best = { a, b, ...s };
  }
  if (!best) return null;
  const { a, b, t } = best;
  const len = dist(a, b);
  if (t * len < 4) return a;
  if ((1 - t) * len < 4) return b;
  const e = a.adj.get(b.id)!;
  const n = add({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  unlink(a, b); link(a, n, e.name, e.runway); link(n, b, e.name, e.runway);
  return n;
}

// Close small gaps: dangling taxiway ends that stop just short of another taxiway or the runway.
for (const n of [...G.values()]) if (n.adj.size === 1) {
  const m = snap(n, 25, n);
  if (m && !m.adj.has(n.id)) link(n, m, [...n.adj.values()][0].name);
}

// Holding points
let holdsNamed = 0;
for (const e of els.filter(e => e.type === 'node' && tag(e, 'aeroway') === 'holding_position')) {
  const ref = tag(e, 'ref');
  if (!ref) continue;
  const id = osmNode.get(e.id);
  const n = id ? G.get(id)! : snap(P(e as LatLon), 30, undefined, x => !x.runway);
  if (n) { n.hold = ref; n.keep = true; holdsNamed++; }
}

// Stands
const stands: (Omit<Stand, 'node' | 'pushNode' | 'maxWake'> & { gn: GNode; push: GNode })[] = [];
const seenStand = new Set<string>();
function addStand(ref: string, spot: XY, push: GNode) {
  let r = ref; for (let i = 2; seenStand.has(r); i++) r = `${ref}-${i}`;
  seenStand.add(r);
  const gn = add(spot);
  gn.stand = r; gn.keep = true; push.keep = true;
  link(push, gn, '');
  const first = r[0];
  stands.push({ ref: r, gn, push, terminal: corr.standTerminalByFirstDigit?.[first] ?? 'Remote', x: spot.x, y: spot.y, hdg: Math.round(bearing(push, spot)) });
}
for (const e of els.filter(e => tag(e, 'aeroway') === 'parking_position' && tag(e, 'ref'))) {
  const ref = tag(e, 'ref')!;
  if (e.type === 'way' && e.geometry && e.geometry.length >= 2) {
    const g = e.geometry, a = P(g[0]), b = P(g[g.length - 1]);
    // The end nearer a taxilane is where the pushback ends; the other end is the stand.
    const da = nearestEdgeDist(a), db = nearestEdgeDist(b);
    const [spot, pushPt] = da < db ? [b, a] : [a, b];
    const push = snap(pushPt, 70, undefined, x => !x.runway);
    if (push) addStand(ref, spot, push);
  } else if (e.type === 'node') {
    const spot = P(e as LatLon);
    // Pushback point: 50 m out from the stand onto the nearest lane.
    const push = snap(spot, 90, undefined, x => !x.runway);
    if (push && dist(push, spot) > 15) addStand(ref, spot, push);
  }
}
function nearestEdgeDist(p: XY) {
  let best = Infinity;
  for (const a of G.values()) for (const bid of a.adj.keys()) if (bid > a.id) best = Math.min(best, segDist(p, a, G.get(bid)!).d);
  return best;
}

// Keep the largest connected component.
{
  const comp = new Map<number, number>(); let biggest = -1, size = 0, c = 0;
  for (const n of G.values()) {
    if (comp.has(n.id)) continue;
    const stack = [n.id]; comp.set(n.id, c); let s = 0;
    while (stack.length) { const id = stack.pop()!; s++; for (const j of G.get(id)!.adj.keys()) if (!comp.has(j)) { comp.set(j, c); stack.push(j); } }
    if (s > size) { size = s; biggest = c; }
    c++;
  }
  let dropped = 0;
  for (const n of [...G.values()]) if (comp.get(n.id) !== biggest) { G.delete(n.id); dropped++; }
  for (let i = stands.length - 1; i >= 0; i--) if (!G.has(stands[i].gn.id)) stands.splice(i, 1);
  console.log(`graph: kept ${size} nodes, dropped ${dropped} in ${c - 1} islands`);
}

// Simplify straight runs of degree-2 nodes on the same taxiway.
for (let pass = 0; pass < 3; pass++) for (const n of [...G.values()]) {
  if (n.keep || n.adj.size !== 2) continue;
  const [[aid, ea], [bid, eb]] = [...n.adj];
  if (ea.name !== eb.name || ea.runway !== eb.runway) continue;
  const a = G.get(aid)!, b = G.get(bid)!;
  if (a.adj.has(b.id)) continue;
  const turn = Math.abs(((bearing(a, n) - bearing(n, b) + 540) % 360) - 180);
  if (turn > 6 || dist(a, b) > 400) continue;
  unlink(a, n); unlink(n, b); link(a, b, ea.name, ea.runway); G.delete(n.id);
}

// ------------------------------------------------------------------ runways
const runways: RunwayPack[] = [];
for (const w of els.filter(e => e.type === 'way' && tag(e, 'aeroway') === 'runway' && tag(e, 'ref'))) {
  const names = tag(w, 'ref')!.split('/');
  const g = w.geometry!, p0 = P(g[0]), p1 = P(g[g.length - 1]);
  const ends = names.map(name => {
    const c = corr.runways[name];
    if (!c) throw new Error(`no AIP correction for runway ${name}`);
    const thr = P(ll(c.thr));
    // This direction's take-off run starts at the physical end nearest its threshold.
    const end = dist(p0, thr) < dist(p1, thr) ? p0 : p1;
    return { name, thr, end, hdgTrue: c.hdgTrue, elevationFt: c.elevFt, ...(c.ils ? { ils: { freq: c.ils, gsDeg: 3 } } : {}) };
  }) as RunwayPack['ends'];
  runways.push({ name: tag(w, 'ref')!, ends, widthM: +(tag(w, 'width') ?? 45), lengthM: Math.round(dist(p0, p1)) });
}

// Hold -> runway end it protects (nearest runway; the end whose threshold the hold sits beside).
const holdRunway = (n: XY): string | undefined => {
  let best: { d: number; end: string } | undefined;
  for (const r of runways) {
    const [e0, e1] = r.ends;
    const s = segDist(n, e0.end, e1.end);
    if (s.d < 450 && (!best || s.d < best.d)) best = { d: s.d, end: s.t < 0.5 ? e0.name : e1.name };
  }
  return best?.end;
};

// ------------------------------------------------------------------ output graph
const ids = new Map<number, number>();
const nodes: TaxiNode[] = [];
for (const n of G.values()) {
  ids.set(n.id, nodes.length);
  const t: TaxiNode = { id: nodes.length, x: n.x, y: n.y };
  if (n.hold) { t.hold = n.hold; const r = holdRunway(n); if (r) t.holdRunway = r; }
  if (n.stand) t.stand = n.stand;
  nodes.push(t);
}
const edges: TaxiEdge[] = [];
for (const n of G.values()) for (const [bid, e] of n.adj) if (bid > n.id) {
  const b = G.get(bid)!;
  edges.push({ a: ids.get(n.id)!, b: ids.get(bid)!, name: e.name, ...(e.runway ? { runway: e.runway } : {}), lengthM: Math.round(dist(n, b) * 10) / 10 });
}

// Stand wake limit from spacing to neighbours (wide gaps take heavies, the widest the A380).
const standOut: Stand[] = stands.map(s => {
  let near = Infinity;
  for (const o of stands) if (o !== s) near = Math.min(near, dist(o, s));
  const maxWake: Wake = near > 85 ? 'J' : near > 52 ? 'H' : 'M';
  return { ref: s.ref, node: ids.get(s.gn.id)!, pushNode: ids.get(s.push.id)!, terminal: s.terminal, x: s.x, y: s.y, hdg: s.hdg, maxWake };
});

// ------------------------------------------------------------------ surfaces + buildings
const ring = (g: { lat: number; lon: number }[]) => simplify(g.map(p => P(p)), 0.8);
function outerRings(e: OsmEl): XY[][] {
  if (e.type === 'way' && e.geometry) return [ring(e.geometry)];
  if (e.type !== 'relation') return [];
  // Stitch outer member ways into closed rings.
  const parts = (e.members ?? []).filter(m => m.role === 'outer' && m.geometry).map(m => m.geometry!.map(p => P(p)));
  const rings: XY[][] = [];
  while (parts.length) {
    let cur = parts.shift()!;
    for (let guard = 0; guard < 500 && dist(cur[0], cur[cur.length - 1]) > 1; guard++) {
      const tail = cur[cur.length - 1];
      const i = parts.findIndex(p => dist(p[0], tail) < 1 || dist(p[p.length - 1], tail) < 1);
      if (i < 0) break;
      const p = parts.splice(i, 1)[0];
      cur = cur.concat(dist(p[0], tail) < 1 ? p.slice(1) : p.reverse().slice(1));
    }
    rings.push(simplify(cur, 0.8));
  }
  return rings;
}
const surfaces: AirportPack['surfaces'] = [];
for (const e of els.filter(e => tag(e, 'aeroway') === 'apron' && e.type !== 'node')) for (const r of outerRings(e)) if (r.length > 3) surfaces.push({ kind: 'apron', poly: r });
for (const e of els.filter(e => tag(e, 'aeroway') === 'taxiway' && tag(e, 'area') === 'yes')) for (const r of outerRings(e)) if (r.length > 3) surfaces.push({ kind: 'taxiway', poly: r });
for (const r of runways) {
  const [a, b] = [r.ends[0].end, r.ends[1].end], h = bearing(a, b), w = r.widthM / 2;
  surfaces.push({ kind: 'runway', poly: [fromBearing(a, h - 90, w), fromBearing(b, h - 90, w), fromBearing(b, h + 90, w), fromBearing(a, h + 90, w)] });
}

const buildings: AirportPack['buildings'] = [];
for (const e of els.filter(e => e.type !== 'node' && (tag(e, 'building') || ['terminal', 'hangar', 'control_tower'].includes(tag(e, 'aeroway') ?? '')))) {
  const aw = tag(e, 'aeroway'), b = tag(e, 'building');
  const kind = aw === 'terminal' || b === 'terminal' ? 'terminal' : aw === 'hangar' || b === 'hangar' ? 'hangar'
    : aw === 'control_tower' || tag(e, 'man_made') === 'tower' ? 'tower' : 'building';
  const levels = tag(e, 'building:levels');
  const h = parseFloat(tag(e, 'height') ?? '') || (levels ? +levels * 4 : { terminal: 24, hangar: 20, tower: 87, building: b === 'roof' ? 9 : 10 }[kind]);
  for (const poly of outerRings(e)) if (poly.length > 3 && area(poly) > 40)
    buildings.push({ kind, poly, heightM: Math.round(h), ...(tag(e, 'name') ? { name: tag(e, 'name') } : {}) });
}

// ------------------------------------------------------------------ airspace
const fixes: Record<string, Fix> = {};
for (const [name, v] of Object.entries(corr.fixes as Record<string, [string, string, string?]>)) {
  const p = ll([v[0], v[1]]);
  fixes[name] = { name, ...p, ...P(p), ...(v[2] ? { spoken: v[2] } : {}) };
}
// "LON/255/7": a point on the LON radial 255 (magnetic) at 7 nm, named ARINC-style D255G.
const pointRef = (ref: string): string => {
  const m = ref.match(/^([A-Z]{3,5})\/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (!m) { if (!fixes[ref]) throw new Error(`unknown fix ${ref}`); return ref; }
  const base = fixes[m[1]], radial = +m[2], nm = +m[3];
  const letter = String.fromCharCode(64 + Math.max(1, Math.min(26, Math.round(nm))));
  const name = m[1] === 'LON' ? `D${String(Math.round(radial)).padStart(3, '0')}${letter}` : `${m[1].slice(0, 3)}${String(Math.round(radial)).padStart(3, '0')}${letter}`;
  const xy = fromBearing(base, radial + corr.magVar, nm * NM);
  fixes[name] = { name, x: Math.round(xy.x), y: Math.round(xy.y), lat: arp.lat + xy.y / 111195, lon: arp.lon + xy.x / (111195 * Math.cos(arp.lat * Math.PI / 180)) };
  return name;
};
const sids = (corr.sids as { name: string; designator: string; runway: string; fixes: string[] }[])
  .map(s => ({ name: s.name, designator: s.designator, runway: s.runway, fixes: s.fixes.map(pointRef), initialAltFt: corr.sidAltFt }));

const map = await londonMap(arp, refresh);

const pack: AirportPack = {
  icao, name: corr.name, rtName: corr.rtName, airac: corr.airac,
  sources: [
    'Airport geometry © OpenStreetMap contributors (ODbL)',
    `UK AIP AD 2.${icao} via NATS AIS, AIRAC ${corr.airac}`,
    'Coastline: Natural Earth (public domain)',
  ],
  arp, elevationFt: corr.elevationFt, transitionAltFt: corr.transitionAltFt, magVar: corr.magVar,
  frequencies: corr.frequencies, runways, taxi: { nodes, edges }, stands: standOut, surfaces, buildings,
  airlineTerminals: corr.airlineTerminals,
  airspace: {
    fixes, stacks: corr.stacks, sids, stars: corr.stars,
    ctr: (corr.ctr as [string, string][]).map(p => P(ll(p))),
    tmaRadiusNm: corr.tmaRadiusNm, areaRadiusNm: corr.areaRadiusNm, map,
  },
  configs: corr.configs,
  ...(corr.fireStation ? { fireStation: P(ll(corr.fireStation)) } : {}),
};

const problems = validate(pack);
console.log(`${icao}: ${nodes.length} nodes, ${edges.length} edges, ${standOut.length} stands, ${holdsNamed} named holds, ${buildings.length} buildings, ${surfaces.length} surfaces, ${map.length} map lines`);
for (const p of problems) console.log('  !', p);
const out = new URL(`../../data/airports/${icao}/`, import.meta.url);
if (!existsSync(out)) mkdirSync(out, { recursive: true });
writeFileSync(new URL('airport.json', out), JSON.stringify(pack));
console.log(`wrote data/airports/${icao}/airport.json`);
if (problems.some(p => p.startsWith('FATAL'))) process.exit(2);

// ------------------------------------------------------------------ helpers
function area(poly: XY[]) { let s = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y); return Math.abs(s / 2); }
export function simplify(pts: XY[], tol: number): XY[] { // Douglas-Peucker
  if (pts.length < 3) return pts;
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i], pts[0], pts[pts.length - 1]).d; if (d > max) { max = d; idx = i; } }
  if (max <= tol) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}
