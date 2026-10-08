// Debug view of an airport pack as SVG: node tools/pipeline/preview.ts EGLL > out.html
import { readFileSync } from 'node:fs';
import type { AirportPack } from '../../packages/sim/src/types.ts';

const icao = process.argv[2] ?? 'EGLL';
const zoom = process.argv[3] ?? 'airport';
const p: AirportPack = JSON.parse(readFileSync(new URL(`../../data/airports/${icao}/airport.json`, import.meta.url), 'utf8'));
const R = zoom === 'airport' ? 3200 : 120000;
const pt = (q: { x: number; y: number }) => `${q.x.toFixed(0)},${(-q.y).toFixed(0)}`;
const s: string[] = [];
if (zoom !== 'airport') for (const l of p.airspace.map) s.push(`<polyline points="${l.pts.map(pt).join(' ')}" fill="none" stroke="${l.kind === 'coast' ? '#4a7' : l.kind === 'river' ? '#48c' : '#776'}" stroke-width="${R / 400}"/>`);
for (const f of p.surfaces) s.push(`<polygon points="${f.poly.map(pt).join(' ')}" fill="${f.kind === 'runway' ? '#555' : '#3a3f47'}"/>`);
for (const b of p.buildings) s.push(`<polygon points="${b.poly.map(pt).join(' ')}" fill="${b.kind === 'terminal' ? '#b9a27a' : '#7d746a'}"/>`);
for (const e of p.taxi.edges) { const a = p.taxi.nodes[e.a], b = p.taxi.nodes[e.b]; s.push(`<line x1="${a.x}" y1="${-a.y}" x2="${b.x}" y2="${-b.y}" stroke="${e.runway ? '#fff' : e.name ? '#e8c840' : '#999'}" stroke-width="${e.runway ? 4 : 2}"/>`); }
for (const n of p.taxi.nodes) if (n.hold) s.push(`<circle cx="${n.x}" cy="${-n.y}" r="9" fill="red"/><text x="${n.x + 10}" y="${-n.y}" font-size="22" fill="#f88">${n.hold}${n.holdRunway ? '>' + n.holdRunway : ''}</text>`);
for (const st of p.stands) s.push(`<circle cx="${st.x}" cy="${-st.y}" r="6" fill="${{ M: '#6cf', H: '#c6f', J: '#f6c', L: '#fff' }[st.maxWake]}"/>`);
for (const r of p.runways) for (const e of r.ends) s.push(`<circle cx="${e.thr.x}" cy="${-e.thr.y}" r="14" fill="lime"/><text x="${e.thr.x}" y="${-e.thr.y - 30}" font-size="50" fill="lime">${e.name}</text>`);
if (zoom !== 'airport') {
  for (const f of Object.values(p.airspace.fixes)) s.push(`<circle cx="${f.x}" cy="${-f.y}" r="${R / 300}" fill="#9cf"/><text x="${f.x}" y="${-f.y}" font-size="${R / 80}" fill="#9cf">${f.name}</text>`);
  for (const sid of p.airspace.sids) { const r = p.runways.flatMap(r => r.ends).find(e => e.name === sid.runway)!; s.push(`<polyline points="${[r.thr, ...sid.fixes.map(f => p.airspace.fixes[f])].map(pt).join(' ')}" fill="none" stroke="#f90" stroke-width="${R / 600}"/>`); }
  for (const st of p.airspace.stars) s.push(`<polyline points="${st.fixes.map(f => pt(p.airspace.fixes[f])).join(' ')}" fill="none" stroke="#0cf" stroke-width="${R / 600}"/>`);
  s.push(`<polygon points="${p.airspace.ctr.map(pt).join(' ')}" fill="none" stroke="#88f" stroke-width="${R / 500}"/>`);
}
console.log(`<html><body style="margin:0;background:#1d2a1d"><svg viewBox="${-R} ${-R * 0.5625} ${2 * R} ${2 * R * 0.5625}" width="100%" height="100%">${s.join('')}</svg></body></html>`);
