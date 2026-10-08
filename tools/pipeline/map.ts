// Radar map underlay for the London area: coastline (Natural Earth), the Thames and the main motorways (OSM).
import { project, segDist } from '../../packages/sim/src/geo.ts';
import type { LatLon, XY } from '../../packages/sim/src/types.ts';
import { cached, overpass } from './overpass.ts';

const BBOX = { s: 50.55, w: -2.2, n: 52.45, e: 1.9 };
type Line = { kind: 'coast' | 'river' | 'motorway'; pts: XY[] };
type LL = [number, number]; // [lat, lon]

export async function londonMap(origin: LatLon, refresh = false): Promise<Line[]> {
  const out: Line[] = [];
  const P = (lat: number, lon: number) => { const p = project(origin, { lat, lon }); return { x: Math.round(p.x), y: Math.round(p.y) }; };
  const inBox = (lat: number, lon: number) => lat > BBOX.s && lat < BBOX.n && lon > BBOX.w && lon < BBOX.e;

  const coast: [number, number][][] = await cached('ne_10m_coastline', async () => {
    const r = await fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_coastline.geojson');
    const g = await r.json();
    // Keep only lines touching our box, to keep the cache small.
    return g.features.map((f: any) => f.geometry.coordinates as [number, number][])
      .filter((c: [number, number][]) => c.some(([lon, lat]) => inBox(lat, lon)));
  }, refresh);
  for (const line of coast) pushClipped(out, 'coast', line.map(([lon, lat]) => [lat, lon] as LL), inBox, P, 250);

  const bb = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;
  const osm = await overpass('london-map', `[out:json][timeout:180];(
    way["waterway"="river"]["name"="River Thames"](${bb});
    way["highway"="motorway"]["ref"~"^(M25|M4|M3|M40|M1|M11|M20|M23|M2|M26)$"](${bb});
  );out geom;`, refresh);
  const groups = new Map<string, LL[][]>();
  for (const w of osm.elements as any[]) {
    const key = w.tags.waterway ? 'river' : `motorway:${w.tags.ref}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(w.geometry.map((p: any) => [p.lat, p.lon] as LL));
  }
  for (const [key, ways] of groups) for (const line of stitch(ways))
    pushClipped(out, key.startsWith('river') ? 'river' : 'motorway', line, inBox, P, 120);
  return dedupe(out);
}

function pushClipped(out: Line[], kind: Line['kind'], pts: LL[], inBox: (a: number, b: number) => boolean,
  P: (lat: number, lon: number) => XY, tol: number) {
  let cur: XY[] = [];
  const flush = () => { if (cur.length > 1) { const s = dp(cur, tol); if (len(s) > 1500) out.push({ kind, pts: s }); } cur = []; };
  for (const [lat, lon] of pts) { if (inBox(lat, lon)) cur.push(P(lat, lon)); else flush(); }
  flush();
}
function stitch(ways: LL[][]): LL[][] {
  const eq = (a: LL, b: LL) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  const rest = ways.slice(), out: LL[][] = [];
  while (rest.length) {
    let cur = rest.shift()!;
    for (let grown = true; grown;) {
      grown = false;
      for (let i = 0; i < rest.length; i++) {
        const w = rest[i];
        if (eq(cur[cur.length - 1], w[0])) cur = cur.concat(w.slice(1));
        else if (eq(cur[0], w[w.length - 1])) cur = w.concat(cur.slice(1));
        else if (eq(cur[cur.length - 1], w[w.length - 1])) cur = cur.concat(w.slice().reverse().slice(1));
        else if (eq(cur[0], w[0])) cur = w.slice().reverse().concat(cur.slice(1));
        else continue;
        rest.splice(i, 1); grown = true; break;
      }
    }
    out.push(cur);
  }
  return out;
}
function dp(pts: XY[], tol: number): XY[] {
  if (pts.length < 3) return pts;
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i], pts[0], pts[pts.length - 1]).d; if (d > max) { max = d; idx = i; } }
  if (max <= tol) return [pts[0], pts[pts.length - 1]];
  return [...dp(pts.slice(0, idx + 1), tol).slice(0, -1), ...dp(pts.slice(idx), tol)];
}
const len = (p: XY[]) => p.reduce((s, q, i) => i ? s + Math.hypot(q.x - p[i - 1].x, q.y - p[i - 1].y) : 0, 0);
// Dual carriageways give near-duplicate lines: drop a motorway line whose middle runs within 150 m of one already kept.
function dedupe(lines: Line[]): Line[] {
  const kept: Line[] = [];
  for (const l of lines) {
    if (l.kind !== 'motorway') { kept.push(l); continue; }
    const mid = l.pts[Math.floor(l.pts.length / 2)];
    if (!kept.some(k => k.kind === 'motorway' && k.pts.some((p, i) => i > 0 && segDist(mid, k.pts[i - 1], p).d < 150))) kept.push(l);
  }
  return kept;
}
