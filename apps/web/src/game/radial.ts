// Radial menu model: the instructions that make sense for this aircraft, at this position, right now.
import { find, nextSeats, seatRole, validVerbs, type Aircraft, type Command, type Seat, type World } from '@squawk/sim';
import type { Snap } from './client.ts';

export interface RadialItem {
  label: string;
  hint?: string;               // keyboard shortcut / short note
  cmd?: Command[];             // leaf: send this
  sub?: () => RadialItem[];    // or open a sub-ring
  taxi?: { to: string; greens?: boolean }; // or start taxi-route editing to this limit
  danger?: boolean;
}

const UNIT: Record<Seat, string> = { DEL: 'Delivery', GND: 'Ground', TWR: 'Tower', DIR: 'Director', LON: 'London' };
const fl = (ft: number, ta: number) => (ft > ta ? `FL${Math.round(ft / 100)}` : `${ft.toLocaleString('en-GB')} ft`);

export function radialFor(world: World, snap: Snap, cs: string): RadialItem[] {
  const ac = find(snap, cs);
  if (!ac) return [];
  const apt = world.byIcao[ac.apt];
  const as = snap.apts.find(a => a.icao === ac.apt)!;
  const ta = apt.pack.transitionAltFt;
  const v = new Set(validVerbs(world, snap, cs));
  const items: RadialItem[] = [];
  const C = (c: Command | Command[]) => (Array.isArray(c) ? c : [c]);

  if (v.has('clearance')) {
    const sids = [...new Set(apt.pack.airspace.sids.filter(s => s.runway === ac.runway).map(s => s.name + s.designator))];
    items.push({ label: 'Clearance', hint: 'C', cmd: C({ cs, verb: 'clearance', sid: ac.sid ?? '', alt: 0, squawk: '' }),
      sub: () => sids.map(s => ({ label: s + (s === ac.sid ? ' ✓' : ''), cmd: C({ cs, verb: 'clearance', sid: s, alt: 0, squawk: '' }) })) });
  }
  if (v.has('push')) items.push({ label: 'Push & start', hint: 'P', cmd: C({ cs, verb: 'push' }),
    sub: () => (['N', 'E', 'S', 'W'] as const).map(f => ({ label: `Face ${({ N: 'north', E: 'east', S: 'south', W: 'west' })[f]}`, cmd: C({ cs, verb: 'push', face: f }) })) });
  if (v.has('taxi')) {
    if (ac.kind === 'dep') {
      const end = ac.runway ?? as.dep[0];
      items.push({ label: 'Taxi', hint: 'X', taxi: { to: end }, sub: () => [
        ...as.dep.map(e => ({ label: `Runway ${e}`, taxi: { to: e } })),
        ...(apt.ends[end]?.front ?? []).slice(0, 6).map(h => ({ label: `Hold ${apt.nodes[h].hold}`, taxi: { to: apt.nodes[h].hold! } })),
      ] });
    } else if (ac.stand) {
      items.push({ label: 'Taxi to stand', hint: 'X', taxi: { to: ac.stand } });
      items.push({ label: 'Follow the greens', hint: 'F', taxi: { to: ac.stand, greens: true } });
    }
  }
  if (v.has('cross')) {
    const rws = apt.runways.map(r => r.ends[0]);
    items.push({ label: 'Cross runway', sub: () => rws.map(r => ({ label: apt.runways.find(x => x.ends[0] === r)!.name, cmd: C({ cs, verb: 'cross', runway: r }) })) });
  }
  if (v.has('holdshort')) items.push({ label: 'Hold position', cmd: C({ cs, verb: 'holdshort', at: '' }) });
  if (v.has('continue')) items.push({ label: 'Continue taxi', cmd: C({ cs, verb: 'continue' }) });
  if (v.has('luw')) items.push({ label: 'Line up', hint: 'L', cmd: C({ cs, verb: 'luw', runway: ac.runway ?? '' }) });
  if (v.has('cto')) items.push({ label: 'Take-off', hint: 'T', cmd: C({ cs, verb: 'cto', runway: ac.runway ?? '' }) });
  if (v.has('land')) items.push({ label: 'Cleared to land', hint: 'L', cmd: C({ cs, verb: 'land', runway: ac.runway ?? '' }) });
  if (v.has('goaround')) items.push({ label: 'Go around', hint: 'G', cmd: C({ cs, verb: 'goaround' }), danger: true });
  if (v.has('heading')) items.push({ label: 'Heading', hint: 'H', sub: () => headingRing(ac) });
  if (v.has('alt')) items.push({ label: ac.kind === 'dep' ? 'Climb' : 'Descend', hint: 'A', sub: () => altRing(ac, ta, cs) });
  if (v.has('speed')) items.push({ label: 'Speed', hint: 'S', sub: () => [...[160, 180, 200, 210, 220, 250].map(kt => ({ label: `${kt} kt`, cmd: C({ cs, verb: 'speed', kt }) })), { label: 'Resume', cmd: C({ cs, verb: 'speed', kt: null }) }] });
  if (v.has('direct')) items.push({ label: 'Direct', hint: 'D', sub: () => directRing(world, ac).map(f => ({ label: f, cmd: C({ cs, verb: 'direct', fix: f }) })) });
  if (v.has('ils')) items.push({ label: 'Cleared ILS', hint: 'I', cmd: C({ cs, verb: 'ils', runway: as.arr[0] }),
    sub: () => [...new Set([...as.arr, ...Object.keys(apt.ends)])].map(e => ({ label: `ILS ${e}`, cmd: C({ cs, verb: 'ils', runway: e }) })) });
  if (v.has('hold')) items.push({ label: 'Hold', sub: () => apt.pack.airspace.stacks.map(s => ({ label: s.name, cmd: C({ cs, verb: 'hold', fix: s.fix }) })) });
  if (v.has('resume')) items.push({ label: 'Own navigation', cmd: C({ cs, verb: 'resume' }) });
  const next = nextSeats(ac);
  if (v.has('contact') && next.length) items.push({ label: `Contact ${UNIT[next[0]]}`, hint: 'K', cmd: C({ cs, verb: 'contact', seat: next[0] }),
    sub: next.length > 1 ? () => next.map(s => ({ label: UNIT[s], cmd: C({ cs, verb: 'contact', seat: s }) })) : undefined });
  if (v.has('unable')) items.push({ label: 'Unable', cmd: C({ cs, verb: 'unable' }) });
  if (v.has('negative')) items.push({ label: 'Negative, say again', hint: 'Z', cmd: C({ cs, verb: 'negative' }) });
  items.push({ label: 'Say again', cmd: C({ cs, verb: 'sayagain' }) });
  void seatRole; void fl;
  return items;
}

function headingRing(ac: Aircraft): RadialItem[] {
  const out: RadialItem[] = [];
  const cur = Math.round(ac.hdg / 10) * 10;
  for (let h = 30; h <= 360; h += 30) {
    const turn = ((h - ac.hdg + 540) % 360) - 180 < 0 ? 'L' : 'R';
    out.push({ label: String(h).padStart(3, '0'), cmd: [{ cs: ac.cs, verb: 'heading', hdg: h, turn }] });
  }
  for (const d of [-20, -10, 10, 20]) {
    const h = ((cur + d + 360) % 360) || 360;
    out.push({ label: `${d < 0 ? 'L' : 'R'} ${String(h).padStart(3, '0')}`, cmd: [{ cs: ac.cs, verb: 'heading', hdg: h, turn: d < 0 ? 'L' : 'R' }] });
  }
  return out;
}

function altRing(ac: Aircraft, ta: number, cs: string): RadialItem[] {
  const levels = [3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 12000, 15000, 18000, 23000, 25000];
  const near = levels.filter(l => Math.abs(l - ac.alt) > 400 && Math.abs(l - ac.alt) < 13000);
  return near.slice(0, 10).map(l => ({ label: fl(l, ta), cmd: [{ cs, verb: 'alt' as const, alt: l }] }));
}

function directRing(world: World, ac: Aircraft): string[] {
  const apt = world.byIcao[ac.apt];
  const route = ac.nav.route.slice(0, 4);
  const named = Object.values(apt.fixes).filter(f => !/^D\d{3}[A-Z]$/.test(f.name) && !/^[A-Z]{3}\d{3}[A-Z]$/.test(f.name));
  named.sort((a, b) => Math.hypot(a.x - ac.x, a.y - ac.y) - Math.hypot(b.x - ac.x, b.y - ac.y));
  return [...new Set([...route, ...(ac.stack ? [ac.stack] : []), ...named.slice(0, 8).map(f => f.name)])].slice(0, 10);
}
