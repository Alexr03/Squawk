// The approachable layer: one-click action bubbles, drag-to-target gestures and score pops.
// Everything here produces ordinary commands, so the realistic rules still apply underneath.
import { find, geo, lateral, along, nextSeats, seatRole, type Aircraft, type Command, type World, type XY } from '@squawk/sim';
import type { Snap } from './client.ts';
import type { Need } from './needs.ts';

export interface Action { label: string; cmds?: Command[]; taxi?: { to: string; greens?: boolean }; tone: 'go' | 'warn' | 'info' }

const UNIT: Record<string, string> = { DEL: 'Delivery', GND: 'Ground', TWR: 'Tower', DIR: 'Director', LON: 'London' };

/** The obvious next step for an aircraft that needs you (or null if it needs a decision only you can make, like vectors). */
export function primaryAction(world: World, snap: Snap, n: Need): Action | null {
  if (/send the fire service/.test(n.text)) return { label: 'Send fire service', cmds: [{ cs: n.cs, verb: 'rescue' }], tone: 'warn' };
  const ac = find(snap, n.cs);
  if (!ac) return null;
  const cs = ac.cs;
  // An emergency's alert is about the emergency, but the bubble should still offer what it needs next: landing clearance.
  if (/MAYDAY|PAN|Radio failure/.test(n.text) && ac.kind === 'arr' && !ac.onGround && !ac.cleared.land && (ac.phase === 'final' || ac.nav.established) && seatRole(ac.owner) === 'TWR')
    return { label: 'Clear to land', cmds: [{ cs, verb: 'land', runway: ac.runway ?? '' }], tone: 'go' };
  if (/Landing clearance/.test(n.text)) return { label: 'Clear to land', cmds: [{ cs, verb: 'land', runway: ac.runway ?? '' }], tone: 'go' };
  if (/Lined up, gap OK/.test(n.text)) return { label: 'Take-off', cmds: [{ cs, verb: 'cto', runway: ac.runway ?? '' }], tone: 'go' };
  if (/Ready, gap OK/.test(n.text)) return { label: 'Line up', cmds: [{ cs, verb: 'luw', runway: ac.runway ?? '' }], tone: 'go' };
  if (/Clearance request/.test(n.text)) return { label: 'Clearance', cmds: [{ cs, verb: 'clearance', sid: ac.sid ?? '', alt: 0, squawk: '' }], tone: 'go' };
  if (/Ready to push/.test(n.text)) return { label: 'Push back', cmds: [{ cs, verb: 'push' }], tone: 'go' };
  if (/Ready to taxi/.test(n.text)) return { label: 'Taxi', taxi: { to: ac.runway ?? '' }, tone: 'go' };
  if (/Hand off/.test(n.text)) { const s = nextSeats(ac)[0]; return s ? { label: `→ ${UNIT[s]}`, cmds: [{ cs, verb: 'contact', seat: s }], tone: 'info' } : null; }
  if (/readback/i.test(n.text)) return { label: 'Negative, say again', cmds: [{ cs, verb: 'negative' }], tone: 'warn' };
  if (/Holding short/.test(n.text) && seatRole(ac.owner) === 'TWR') {
    const apt = world.byIcao[ac.apt];
    for (let j = ac.pi; j < Math.min(ac.path.length - 1, ac.pi + 4); j++) {
      const rw = apt.onRunway.get(ac.path[j + 1]);
      if (rw && !apt.onRunway.has(ac.path[j])) return { label: `Cross ${rw}`, cmds: [{ cs, verb: 'cross', runway: rw }], tone: 'warn' };
    }
  }
  if (ac.phase === 'taxiin' && !ac.cleared.taxi && ac.stand) return { label: 'Taxi to stand', taxi: { to: ac.stand }, tone: 'go' };
  if (/Request/.test(n.text) && ac.req?.call.k === 'request') {
    const r = ac.req.call;
    if (r.what === 'direct') return { label: `Direct ${r.fix}`, cmds: [{ cs, verb: 'direct', fix: r.fix }], tone: 'info' };
    if (r.what === 'climb' || r.what === 'descend') return { label: `${r.what === 'climb' ? 'Climb' : 'Descend'} ${r.alt > 6000 ? 'FL' + r.alt / 100 : r.alt}`, cmds: [{ cs, verb: 'alt', alt: r.alt }], tone: 'info' };
  }
  return null;
}

/** What dropping a dragged aircraft at this world point would mean. */
export function dropAction(world: World, snap: Snap, ac: Aircraft, p: XY, mpp: number): Action | null {
  const apt = world.byIcao[ac.apt];
  const as = snap.apts.find(a => a.icao === ac.apt)!;
  const cs = ac.cs;
  const near = Math.max(400, mpp * 18);
  if (!ac.onGround) {
    // Onto an extended centreline of an arrival runway: vector to intercept, descend, clear the ILS.
    if (ac.kind === 'arr') {
      for (const endName of [...new Set([...as.arr, ...Object.keys(apt.ends)])]) {
        const e = apt.ends[endName];
        const toThr = e.thrS - along(e, p);
        if (toThr < 3 * geo.NM || toThr > 22 * geo.NM || Math.abs(lateral(e, p)) > near * 1.5) continue;
        const hdg = Math.round(geo.bearing(ac, p) / 5) * 5 || 360;
        const gsAt = (apt.pack.elevationFt + toThr / geo.NM * 318);
        const alt = Math.max(2000, Math.min(ac.tgtAlt, Math.floor(gsAt / 1000) * 1000));
        const turn = ((hdg - ac.hdg + 540) % 360) - 180 < 0 ? 'L' : 'R';
        return { label: `ILS ${endName} · H${String(hdg).padStart(3, '0')} · ${alt > apt.pack.transitionAltFt ? 'FL' + alt / 100 : alt + ' ft'}`, tone: 'go',
          cmds: [{ cs, verb: 'heading', hdg, turn }, ...(alt < ac.tgtAlt ? [{ cs, verb: 'alt' as const, alt }] : []), { cs, verb: 'ils', runway: endName }] };
      }
    }
    // Onto a stack: hold there.
    for (const sk of apt.pack.airspace.stacks) {
      const f = apt.fixes[sk.fix];
      if (geo.dist(f, p) < near * 1.2) return { label: `Hold ${sk.name}`, cmds: [{ cs, verb: 'hold', fix: sk.fix }], tone: 'info' };
    }
    // Onto a fix: route direct.
    for (const f of Object.values(apt.fixes)) {
      if (/^D\d{3}[A-Z]$/.test(f.name)) continue;
      if (geo.dist(f, p) < near * 0.8) return { label: `Direct ${f.name}`, cmds: [{ cs, verb: 'direct', fix: f.name }], tone: 'info' };
    }
    const hdg = Math.round(geo.bearing(ac, p) / 5) * 5 || 360;
    const turn = ((hdg - ac.hdg + 540) % 360) - 180 < 0 ? 'L' : 'R';
    return { label: `Heading ${String(hdg).padStart(3, '0')}`, cmds: [{ cs, verb: 'heading', hdg, turn }], tone: 'info' };
  }
  // Ground: onto a runway -> line up (if waiting at its hold) or taxi to its holding point; onto a stand/hold -> taxi there.
  const onRwy = apt.runways.find(r => geo.segDist(p, r.a, r.b).d < Math.max(60, mpp * 10));
  if (onRwy && ac.kind === 'dep') {
    const end = ac.runway && apt.ends[ac.runway]?.runway === onRwy.name ? ac.runway : onRwy.ends.find(e => as.dep.includes(e)) ?? onRwy.ends[0];
    if (ac.phase === 'holding') return { label: `Line up ${end}`, cmds: [{ cs, verb: 'luw', runway: end }], tone: 'go' };
    if (ac.phase === 'lined') return { label: `Take-off ${end}`, cmds: [{ cs, verb: 'cto', runway: end }], tone: 'go' };
    return { label: `Taxi to ${end}`, taxi: { to: end }, tone: 'go' };
  }
  const reach = Math.max(40, mpp * 14);
  const hold = apt.nodes.filter(n => n.hold).sort((a, b) => geo.dist(a, p) - geo.dist(b, p))[0];
  if (hold && geo.dist(hold, p) < reach) return { label: `Taxi to ${hold.hold}`, taxi: { to: hold.hold! }, tone: 'go' };
  const stand = apt.stands.slice().sort((a, b) => geo.dist(a, p) - geo.dist(b, p))[0];
  if (stand && geo.dist(stand, p) < reach && ac.kind === 'arr') return { label: `Taxi to stand ${stand.ref}`, taxi: { to: stand.ref }, tone: 'go' };
  return null;
}

/** Score pops: little floating rewards where good (and bad) things happen. */
export interface Pop { x: number; y: number; text: string; good: boolean; t0: number }
export class Feedback {
  pops: Pop[] = [];
  private phase = new Map<string, string>();
  private seen = { tick: -1, n: 0 };
  update(snap: Snap, now: number) {
    for (const a of snap.aircraft) {
      const prev = this.phase.get(a.cs);
      this.phase.set(a.cs, a.phase);
      if (!prev || prev === a.phase || !snap.coverage.includes(a.owner)) continue;
      if (prev === 'final' && a.phase === 'landing') this.add(a, '+ Landed', true, now);
      else if (prev === 'takeoff' && a.phase === 'climb') this.add(a, '+ Airborne', true, now);
      else if (a.phase === 'goaround') this.add(a, '− Go-around', false, now);
      else if (prev === 'taxiin' && a.phase === 'parked') this.add(a, '+ On stand', true, now);
    }
    for (const e of unseen(snap.events, this.seen)) {
      if (e.ai || e.x === undefined || e.severity < 2) continue;
      this.pops.push({ x: e.x, y: e.y!, text: e.kind === 'seploss' ? '− Separation' : e.kind === 'runway' ? '− Runway' : e.kind === 'wake' ? '− Wake' : '− ' + e.kind, good: false, t0: now });
    }
    this.pops = this.pops.filter(p => now - p.t0 < 2200);
  }
  private add(a: Aircraft, text: string, good: boolean, now: number) { this.pops.push({ x: a.x, y: a.y, text, good, t0: now }); }
}

/** Entries not handled yet from a log stamped by tick, where several can share a tick: `seen` keeps the last tick and how many at it. */
export function unseen<T extends { tick: number }>(list: T[], seen: { tick: number; n: number }): T[] {
  const last = list.reduce((m, e) => Math.max(m, e.tick), seen.tick);
  const out = [...list.filter(e => e.tick === seen.tick).slice(seen.n), ...list.filter(e => e.tick > seen.tick)];
  seen.n = list.filter(e => e.tick === last).length; seen.tick = last;
  return out;
}
