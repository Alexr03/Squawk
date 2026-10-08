// Scenery around (and pavement inside) an airport from OpenStreetMap -> data/airports/<ICAO>/scenery.json
// Usage: node tools/pipeline/scenery.ts <ICAO> [--refresh]   (airport.ts also runs this after writing the pack)
// Compact on disk: flat delta-encoded integer coordinate arrays (metres in the pack's local frame); see decodeScenery in @squawk/render.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { pointInPoly, segDist, unproject } from '../../packages/sim/src/geo.ts';
import type { AirportPack, SceneryAreaKind, SceneryRoadKind, XY } from '../../packages/sim/src/types.ts';
import { overpass } from './overpass.ts';

interface G { lat: number; lon: number }
interface El { type: string; id: number; tags?: Record<string, string>; geometry?: G[]; members?: { role: string; geometry?: G[] }[] }

const AREA: [RegExp, string, SceneryAreaKind][] = [
  [/^(reservoir|basin)$/, 'landuse', 'water'], [/^water$/, 'natural', 'water'], [/./, 'water', 'water'],
  [/^(residential)$/, 'landuse', 'residential'], [/^(industrial|depot|port)$/, 'landuse', 'industrial'],
  [/^(commercial)$/, 'landuse', 'commercial'], [/^(retail)$/, 'landuse', 'retail'],
  [/^(farmland|farmyard|meadow|orchard|allotments|vineyard|greenhouse_horticulture)$/, 'landuse', 'farmland'],
  [/^(forest)$/, 'landuse', 'forest'], [/^(wood|scrub)$/, 'natural', 'forest'],
  [/^(grass|recreation_ground|village_green|cemetery|greenfield|flowerbed)$/, 'landuse', 'grass'],
  [/^(grassland|heath)$/, 'natural', 'grass'], [/^(park|golf_course|pitch|nature_reserve|garden|playground|common)$/, 'leisure', 'grass'],
  [/^(parking)$/, 'amenity', 'parking'], [/^(construction|brownfield|landfill|quarry)$/, 'landuse', 'construction'],
  [/^(railway)$/, 'landuse', 'railway'], [/^(apron)$/, 'aeroway', 'paved'], [/^(taxiway)$/, 'area:aeroway', 'paved'],
];
const ROAD: Record<string, [SceneryRoadKind, number]> = {
  motorway: ['motorway', 12], motorway_link: ['trunk', 7], trunk: ['trunk', 11], trunk_link: ['minor', 7],
  primary: ['primary', 10], primary_link: ['minor', 7], secondary: ['secondary', 9], secondary_link: ['minor', 6],
  tertiary: ['minor', 7.5], unclassified: ['minor', 6], residential: ['minor', 6], living_street: ['minor', 5], service: ['service', 4.5],
};

export async function buildScenery(icao: string, refresh = false) {
  const dir = new URL(`../../data/airports/${icao}/`, import.meta.url);
  const pack: AirportPack = JSON.parse(readFileSync(new URL('airport.json', dir), 'utf8'));
  // Box around the airfield: its extent plus a margin of town (Heathrow: about ±7 km E-W, ±4 km N-S).
  const xs = [...pack.taxi.nodes.map(n => n.x), ...pack.runways.flatMap(r => r.ends.map(e => e.end.x))];
  const ys = [...pack.taxi.nodes.map(n => n.y), ...pack.runways.flatMap(r => r.ends.map(e => e.end.y))];
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const ex = Math.max(...xs) - Math.min(...xs), ey = Math.max(...ys) - Math.min(...ys);
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const hx = Math.round(ex / 2 + clamp(1.25 * ex, 2500, 4500)), hy = Math.round(ey / 2 + clamp(1.3 * ey, 2000, 3000));
  const sw = unproject(pack.arp, { x: cx - hx, y: cy - hy }), ne = unproject(pack.arp, { x: cx + hx, y: cy + hy });
  const bbox = `${sw.lat.toFixed(5)},${sw.lon.toFixed(5)},${ne.lat.toFixed(5)},${ne.lon.toFixed(5)}`;
  const osm: { elements: El[] } = await overpass(`scenery-${icao}-${hx}x${hy}`, `[out:json][timeout:600][maxsize:1073741824][bbox:${bbox}];
(way["building"];relation["building"]["type"="multipolygon"];
 way["landuse"];relation["landuse"]["type"="multipolygon"];
 way["natural"~"^(water|wood|scrub|grassland|heath)$"];relation["natural"~"^(water|wood)$"]["type"="multipolygon"];
 way["water"];way["leisure"~"^(park|golf_course|pitch|nature_reserve|garden|playground|common)$"];
 way["amenity"="parking"];relation["amenity"="parking"]["type"="multipolygon"];
 way["aeroway"="apron"];relation["aeroway"="apron"];way["area:aeroway"="taxiway"];
 way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|unclassified|residential|living_street|service)$"];
 way["railway"="rail"];);out body geom qt;`, refresh);

  const P = (g: G): XY => { const lat0 = pack.arp.lat * Math.PI / 180; return { x: (g.lon - pack.arp.lon) * Math.PI / 180 * 6371008.8 * Math.cos(lat0), y: (g.lat - pack.arp.lat) * Math.PI / 180 * 6371008.8 }; };
  const inBox = (p: XY) => Math.abs(p.x - cx) < hx + 2000 && Math.abs(p.y - cy) < hy + 2000;
  const rings = (e: El): XY[][] => {
    if (e.geometry) return [e.geometry.map(P)];
    const parts = (e.members ?? []).filter(m => m.role === 'outer' && m.geometry).map(m => m.geometry!.map(P));
    const out: XY[][] = [];
    while (parts.length) {
      let cur = parts.shift()!;
      for (let guard = 0; guard < 500 && d(cur[0], cur[cur.length - 1]) > 1; guard++) {
        const tail = cur[cur.length - 1];
        const i = parts.findIndex(p => d(p[0], tail) < 1 || d(p[p.length - 1], tail) < 1);
        if (i < 0) break;
        const p = parts.splice(i, 1)[0];
        cur = cur.concat(d(p[0], tail) < 1 ? p.slice(1) : p.reverse().slice(1));
      }
      out.push(cur);
    }
    return out;
  };
  // first point absolute, then deltas: about 40% smaller than absolute coordinates
  const flat = (pts: XY[]) => { let px = 0, py = 0; return pts.flatMap(p => { const x = Math.round(p.x), y = Math.round(p.y), o = [x - px, y - py]; px = x; py = y; return o; }); };
  const closedRing = (r: XY[], tol: number) => { const s = simplify(r, tol); if (s.length > 2 && d(s[0], s[s.length - 1]) < 0.5) s.pop(); return s; };

  // Pack buildings already cover the terminal area: skip duplicates (centroid inside an existing footprint).
  const packB = pack.buildings.map(b => ({ poly: b.poly, x0: Math.min(...b.poly.map(p => p.x)), x1: Math.max(...b.poly.map(p => p.x)), y0: Math.min(...b.poly.map(p => p.y)), y1: Math.max(...b.poly.map(p => p.y)) }));
  const dup = (c: XY) => packB.some(b => c.x >= b.x0 && c.x <= b.x1 && c.y >= b.y0 && c.y <= b.y1 && pointInPoly(c, b.poly));

  const areas: [SceneryAreaKind, number[], number][] = [], roads: [SceneryRoadKind, number, number[]][] = [], buildings: [number, number[]][] = [];
  for (const e of osm.elements) {
    const t = e.tags ?? {};
    if (t.building && t.building !== 'no') {
      for (const r of rings(e)) {
        const poly = closedRing(r, 0.7), a = area(poly);
        if (poly.length < 3 || a < 20) continue;
        const c = centroid(poly);
        if (!inBox(c) || dup(c)) continue;
        buildings.push([heightOf(t, a), flat(poly)]);
      }
      continue;
    }
    const hw = t.highway && t.area !== 'yes' ? ROAD[t.highway] : undefined;
    if (hw || t.railway === 'rail') {
      if (!e.geometry) continue;
      const pts = simplify(e.geometry.map(P), 1.5);
      if (!pts.some(inBox)) continue;
      const lanes = +(t.lanes ?? 0);
      const w = hw ? (hw[0] === 'motorway' && lanes >= 4 ? lanes * 3.4 : hw[1]) : 5;
      roads.push([hw ? hw[0] : 'rail', w, flat(pts)]);
      continue;
    }
    const kind = AREA.find(([re, k]) => t[k] !== undefined && re.test(t[k]))?.[2];
    if (!kind) continue;
    for (const r of rings(e)) {
      if (r.length < 4 || d(r[0], r[r.length - 1]) > 2) continue;
      const poly = closedRing(r, 2), a = area(poly);
      if (poly.length < 3 || a < 150 || !poly.some(inBox)) continue;
      areas.push([kind, flat(poly), a]);
    }
  }
  areas.sort((a, b) => b[2] - a[2]); // big first, so smaller fields draw on top
  const out = { v: 1, bbox: [Math.round(cx - hx), Math.round(cy - hy), Math.round(cx + hx), Math.round(cy + hy)], areas: areas.map(a => [a[0], a[1]]), roads, buildings };
  const json = JSON.stringify(out);
  writeFileSync(new URL('scenery.json', dir), json);
  console.log(`${icao} scenery: ${areas.length} areas, ${roads.length} roads, ${buildings.length} buildings, ${(json.length / 1e6).toFixed(2)} MB`);
}

const d = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
function area(poly: XY[]) { let s = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y); return Math.abs(s / 2); }
function centroid(poly: XY[]): XY { let x = 0, y = 0; for (const p of poly) { x += p.x; y += p.y; } return { x: x / poly.length, y: y / poly.length }; }
function simplify(pts: XY[], tol: number): XY[] { // Douglas-Peucker
  if (pts.length < 3) return pts;
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) { const s = segDist(pts[i], pts[0], pts[pts.length - 1]).d; if (s > max) { max = s; idx = i; } }
  if (max <= tol) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}
function heightOf(t: Record<string, string>, a: number): number {
  const h = parseFloat(t.height ?? '') || parseFloat(t['building:height'] ?? '');
  if (h) return Math.round(h);
  const lv = parseFloat(t['building:levels'] ?? '');
  if (lv) return Math.round(lv * 3.2 + 1.5);
  const b = t.building;
  if (/^(garage|garages|shed|hut|kiosk|carport|roof|greenhouse)$/.test(b)) return 3;
  if (/^(hotel)$/.test(b)) return 24;
  if (/^(office)$/.test(b)) return 18;
  if (/^(industrial|warehouse|commercial|retail|supermarket|hangar|service|manufacture)$/.test(b)) return 12;
  return a > 1500 ? 11 : 7;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const icao = process.argv[2];
  if (!icao) { console.error('usage: node tools/pipeline/scenery.ts <ICAO> [--refresh]'); process.exit(1); }
  await buildScenery(icao, process.argv.includes('--refresh'));
}
