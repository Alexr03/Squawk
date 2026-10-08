import { readFileSync } from 'node:fs';
import { buildWorld, geo, along, lateral } from '../packages/sim/src/index.ts';
const pack = JSON.parse(readFileSync(new URL('../data/airports/EGLL/airport.json', import.meta.url), 'utf8'));
const world = buildWorld([pack]); const apt = world.primary;
const end = apt.ends['27L'];
console.log('27L end', end.end, 'thr', end.thr, 'holds', end.holds.slice(0, 8).map(h => `${apt.nodes[h].hold}@${Math.round(apt.nodes[h].x)},${Math.round(apt.nodes[h].y)}`));
const near = apt.nodes.filter(n => geo.dist(n, { x: 1754, y: -1258 }) < 260);
for (const n of near) console.log(n.id, Math.round(n.x), Math.round(n.y), n.hold ?? '', apt.onRunway.get(n.id) ?? '', 's', Math.round(along(end, n)), 'lat', Math.round(lateral(end, n)), '->', apt.adj[n.id].map(a => a.to + ':' + apt.edges[a.edge].name + (apt.edges[a.edge].runway ? '(R)' : '')).join(' '));
