// The "needs you" queue: everything on the player's frequencies waiting for an instruction, most urgent first.
import { depGap, geo, nextSeats, domain, seatRole, type Aircraft, type World } from '@squawk/sim';
import type { Snap } from './client.ts';

export interface Need { cs: string; urgency: number; text: string; level: 'emergency' | 'urgent' | 'routine' }

export function needs(world: World, snap: Snap): Need[] {
  const out: Need[] = [];
  const mine = (a: Aircraft) => snap.coverage.includes(a.owner) && a.owner === a.freq;
  for (const a of snap.aircraft) {
    if (!mine(a) || a.phase === 'gone') continue;
    const apt = world.byIcao[a.apt];
    const add = (urgency: number, text: string) => out.push({ cs: a.cs, urgency, text, level: urgency >= 90 ? 'emergency' : urgency >= 60 ? 'urgent' : 'routine' });
    if (a.emergency) add(100, a.emergency.code === '7600' ? 'Radio failure (7600)' : `MAYDAY: ${a.emergency.nature}`);
    if (a.alert === 'conflict') add(95, 'Separation lost');
    else if (a.alert === 'caution') add(85, 'Conflict predicted');
    if (a.rbErr) add(70, 'Check the readback');
    if (a.phase === 'final' && !a.cleared.land && a.nav.established) {
      const d = geo.dist(a, apt.ends[a.runway!].thr) / geo.NM;
      if (seatRole(a.owner) === 'TWR') add(d < 2 ? 92 : d < 4 ? 75 : 45, `Landing clearance, ${d.toFixed(1)} nm`);
    }
    if (a.req) add(55, 'Request');
    switch (a.phase) {
      case 'stand': if (seatRole(a.owner) === 'DEL' && !a.cleared.dl) add(30, 'Clearance request'); else if (a.cleared.dl && !a.cleared.push && a.checkedIn) add(35, 'Ready to push'); break;
      case 'pushed': if (!a.cleared.taxi) add(40, 'Ready to taxi'); break;
      case 'holding': if (!a.cleared.luw && !a.cleared.cto && seatRole(a.owner) === 'TWR') { const g = gapFor(world, snap, a); add(g === 0 ? 50 : 25, g === 0 ? 'Ready, gap OK' : `Ready, gap ${Math.ceil(g === Infinity ? 99 : g)} s`); } break;
      case 'lined': if (!a.cleared.cto) { const g = gapFor(world, snap, a); add(g === 0 ? 65 : 30, g === 0 ? 'Lined up, gap OK' : g === Infinity ? 'Lined up, runway busy' : `Lined up, wait ${Math.ceil(g)} s`); } break;
      case 'taxi': case 'taxiin': if (a.stoppedS > 20 && !a.blockedBy) add(45, 'Holding short, waiting'); else if (a.stoppedS > 60) add(42, 'Stuck in traffic'); break;
      case 'stack': if (seatRole(a.owner) === 'DIR') add(20 + Math.min(30, a.holdS / 20), `Holding ${a.stack}`); break;
    }
    if (!a.checkedIn) continue;
    // Due a handoff.
    const want = domain(world, snap, a);
    if (want !== seatRole(a.owner) && nextSeats(a).includes(want) && !snap.coverage.some(s => s.endsWith(want) || s === want)) add(a.lateS > 30 ? 60 : 40, `Hand off to ${want === 'LON' ? 'London' : want}`);
  }
  // One line per aircraft (its most urgent need).
  const best = new Map<string, Need>();
  for (const n of out) if (!best.has(n.cs) || best.get(n.cs)!.urgency < n.urgency) best.set(n.cs, n);
  return [...best.values()].sort((a, b) => b.urgency - a.urgency);
}

/** Workload 0..1: aircraft on frequency plus what's waiting. */
export function workload(snap: Snap, queue: Need[]): number {
  const onFreq = snap.aircraft.filter(a => snap.coverage.includes(a.owner)).length;
  const pressure = queue.reduce((s, n) => s + (n.level === 'emergency' ? 3 : n.level === 'urgent' ? 1.5 : 0.5), 0);
  return Math.min(1, (onFreq * 0.04 + pressure * 0.06));
}

/** Seconds until this departure may roll. With departure gaps off (the default), only a departure still rolling blocks it. */
export function gapFor(world: World, snap: Parameters<typeof depGap>[1], a: Aircraft): number {
  const g = depGap(world, snap, a);
  return snap.difficulty.depGaps || g === Infinity ? g : 0;
}
