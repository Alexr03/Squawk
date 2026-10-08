// A made-up day: the airline, type and destination mix of a real day at the airport,
// with invented callsigns, reshuffled times and a volume that varies a little. New every seed.
import type { DayPack, Flight } from '@squawk/sim/types';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';

export function madeUpDay(template: DayPack, seed: number): DayPack {
  const r = rng(seed * 2654435761);
  const used = new Set<string>();
  const dayStart = Date.parse(template.date + 'T00:00:00Z') / 1000;
  // Callsign in the style the operator really uses: same number of digits, same trailing letters.
  const callsign = (like: Flight) => {
    const m = /^([A-Z]{3})(\d+)([A-Z]*)$/.exec(like.cs);
    const op = like.operator || like.cs.slice(0, 3);
    for (let tries = 0; tries < 50; tries++) {
      const digits = Math.max(1, Math.min(4, m ? m[2].length : 3));
      let n = String(1 + Math.floor(r() * 9));
      for (let i = 1; i < digits; i++) n += Math.floor(r() * 10);
      let sfx = '';
      for (let i = 0; i < (m ? m[3].length : 0); i++) sfx += LETTERS[Math.floor(r() * LETTERS.length)];
      const cs = op + n + sfx;
      if (!used.has(cs)) { used.add(cs); return cs; }
    }
    return like.cs;
  };
  const flights: Flight[] = [];
  for (const f of template.flights) {
    // About as busy as the real day, give or take: some flights don't run, others appear twice.
    const copies = r() < 0.12 ? 0 : r() < 0.14 ? 2 : 1;
    for (let k = 0; k < copies; k++) {
      const jitter = (r() + r() + r() - 1.5) * 50 * 60; // roughly ±40 min, bunched near the real time
      const time = Math.round(Math.min(dayStart + 86399, Math.max(dayStart, f.time + jitter)));
      flights.push({ cs: callsign(f), type: f.type, operator: f.operator, kind: f.kind, time, other: f.other });
    }
  }
  flights.sort((a, b) => a.time - b.time);
  return {
    ...template,
    id: `${template.airport}-madeup`,
    label: 'Made-up day',
    tags: ['made up'],
    sources: ['Generated from the traffic mix of ' + template.label],
    flights,
    substitutions: [],
  };
}
