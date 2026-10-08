// Airport pack validation: every stand reaches a holding point for every departure runway, procedures reference real fixes.
import type { AirportPack } from '../../packages/sim/src/types.ts';

export function validate(p: AirportPack): string[] {
  const out: string[] = [];
  const adj = new Map<number, number[]>();
  for (const e of p.taxi.edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a)!.push(e.b); adj.get(e.b)!.push(e.a);
  }
  const reach = (from: number) => {
    const seen = new Set([from]), stack = [from];
    while (stack.length) for (const j of adj.get(stack.pop()!) ?? []) if (!seen.has(j)) { seen.add(j); stack.push(j); }
    return seen;
  };
  for (const end of new Set(p.configs.flatMap(c => c.departures))) {
    const holds = p.taxi.nodes.filter(n => n.hold && n.holdRunway === end);
    if (!holds.length) { out.push(`FATAL: no named holding point for runway ${end}`); continue; }
    let bad = 0;
    for (const s of p.stands) { const r = reach(s.node); if (!holds.some(h => r.has(h.id))) bad++; }
    if (bad) out.push(`FATAL: ${bad} stands cannot reach a holding point for ${end}`);
  }
  for (const r of p.runways) if (!p.taxi.edges.some(x => x.runway === r.name)) out.push(`FATAL: runway ${r.name} not in taxi graph`);
  for (const s of p.airspace.sids) for (const f of s.fixes) if (!p.airspace.fixes[f]) out.push(`FATAL: SID ${s.name} fix ${f} missing`);
  for (const s of p.airspace.stars) for (const f of s.fixes) if (!p.airspace.fixes[f]) out.push(`FATAL: STAR ${s.name} fix ${f} missing`);
  for (const s of p.airspace.stacks) if (!p.airspace.fixes[s.fix]) out.push(`FATAL: stack ${s.name} fix missing`);
  if (p.stands.length < 10) out.push('FATAL: fewer than 10 stands');
  return out;
}
