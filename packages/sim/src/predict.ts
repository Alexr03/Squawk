// Where an aircraft will be over the next few minutes if it keeps flying its instructions: turns at its real rate (and the
// way it was told to turn), routes, holds, ILS joins and cleared levels. STCA and the scope's projection both use it.
import { TYPES } from './aircraft.ts';
import { angleDiff, bearing, dist, holdShape, KT, NM, norm360, racetrack, tas, turnRate } from './geo.ts';
import type { Aircraft } from './state.ts';
import { along, glidepath, lateral, type World } from './world.ts';

export interface Pt { x: number; y: number; alt: number }

/** Positions every `step` seconds for `secs` seconds (not including now). */
export function project(world: World, ac: Aircraft, secs = 240, step = 10): Pt[] {
  if (ac.onGround) return [];
  const apt = world.byIcao[ac.apt] ?? world.primary;
  const t = TYPES[ac.type];
  const gs = Math.max(120, ac.gs) * KT;
  // Vertical: towards the cleared level at its climb or descent rate; down the glidepath once on it.
  const vRate = (ac.tgtAlt > ac.alt ? t.climb : t.descent) / 60;
  const level = (alt: number, dt: number) => ac.tgtAlt > alt ? Math.min(ac.tgtAlt, alt + vRate * dt) : Math.max(ac.tgtAlt, alt - vRate * dt);
  const out: Pt[] = [];

  // Holding: round the racetrack it is flying (to the fix first if it isn't there yet).
  const h = ac.nav.mode === 'hold' ? ac.nav.hold : undefined;
  if (h && apt.fixes[h.fix]) {
    const f = apt.fixes[h.fix], sk = apt.pack.airspace.stacks.find(s => s.fix === h.fix);
    const loop = racetrack(f, sk?.inboundTrack ?? h.inbound, sk?.turn ?? h.turn, h.r && h.len ? { r: h.r, leg: h.len } : holdShape(ac.ias, ac.alt));
    const path: { x: number; y: number }[] = [{ x: ac.x, y: ac.y }];
    let i: number;
    if (h.leg === 'entry' && dist(ac, f) > 2.5 * NM) { path.push(f); i = 2; } // inbound to the fix, then into the turn
    else { i = loop.reduce((b, p, k) => (dist(ac, p) < dist(ac, loop[b]) ? k : b), 0); i = (i + 1) % loop.length; }
    for (let n = 0; n < loop.length * 3; n++) { path.push(loop[i]); i = (i + 1) % loop.length; }
    let j = 0, at = 0, alt = ac.alt; // segment j starts `at` metres along
    for (let s = step; s <= secs; s += step) {
      const D = gs * s;
      while (j < path.length - 2 && at + dist(path[j], path[j + 1]) < D) { at += dist(path[j], path[j + 1]); j++; }
      const a = path[j], b = path[j + 1], q = Math.min(1, (D - at) / (dist(a, b) || 1));
      alt = level(alt, step);
      out.push({ x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q, alt });
    }
    return out;
  }

  let x = ac.x, y = ac.y, hdg = ac.trk ?? ac.hdg, alt = ac.alt, turn = ac.nav.mode === 'hdg' ? ac.turn : null;
  const route = ac.nav.mode === 'route' ? [...ac.nav.route] : [];
  const end = ac.nav.ils ? apt.ends[ac.nav.ils] : undefined;
  let established = ac.nav.established, onGs = ac.nav.gs;
  const rate = t.wake === 'M' ? 3 : 2.5; // as moveAir turns outside holds
  const sub = 2; // seconds per integration step
  for (let s = sub; s <= secs; s += sub) {
    let want: number | null = ac.tgtHdg;
    if (end) {
      const xt = lateral(end, { x, y }), toThr = end.thrS - along(end, { x, y });
      if (!established && toThr > 0 && toThr < 25 * NM) {
        // Capture as moveAir does: closing the centreline, within a turn's lead of it.
        const intercept = Math.abs(angleDiff(hdg, end.hdgTrue));
        const lead = gs * (intercept / turnRate(tas(ac.ias, alt))) * 0.55 + 120;
        const closing = Math.sign(xt) * Math.sin((hdg - end.hdgTrue) * Math.PI / 180) < 0 || Math.abs(xt) < 150;
        if (intercept < 95 && closing && Math.abs(xt) < lead + 200) { established = true; turn = null; }
      }
      if (established) {
        want = norm360(end.hdgTrue - Math.max(-30, Math.min(30, (xt / NM) * 40)));
        const gsAlt = glidepath(apt, end, toThr);
        if (alt >= gsAlt - 60) onGs = true;
        if (onGs) alt = Math.max(gsAlt, alt - 2500 / 60 * sub);
        if (toThr < 0) break; // landed
      }
    }
    if (!established) {
      while (route.length && apt.fixes[route[0]] && dist({ x, y }, apt.fixes[route[0]]) < Math.max(1500, gs * 12)) route.shift();
      if (route.length && apt.fixes[route[0]]) want = bearing({ x, y }, apt.fixes[route[0]]);
    }
    if (want !== null) {
      let d = angleDiff(hdg, want);
      if (turn && Math.abs(d) > 5) d = turn === 'L' ? (d > 0 ? d - 360 : d) : (d < 0 ? d + 360 : d); // the way it was told to turn
      else turn = null;
      hdg = norm360(hdg + Math.max(-rate * sub, Math.min(rate * sub, d)));
    }
    x += Math.sin(hdg * Math.PI / 180) * gs * sub; y += Math.cos(hdg * Math.PI / 180) * gs * sub;
    if (!onGs) alt = level(alt, sub);
    if (s % step === 0) out.push({ x, y, alt });
  }
  return out;
}
