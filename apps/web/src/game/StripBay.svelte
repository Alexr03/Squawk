<script lang="ts">
  import { depGap, geo, nextSeats, seatRole, type Aircraft, type World } from '@squawk/sim';
  import type { Snap } from './client.ts';
  import type { Need } from './needs.ts';

  interface Props { world: World; snap: Snap; selected: string | null; filter: string | null; queue: Need[]; onSelect: (cs: string) => void; onHandoff: (cs: string) => void }
  let { world, snap, selected, filter, queue, onSelect, onHandoff }: Props = $props();

  // Remember who we've worked so the "handed off" bay can show them for a while.
  let worked = new Map<string, number>();

  const mine = (a: Aircraft) => snap.coverage.includes(a.owner) && (!filter || a.owner === filter);
  const roles = $derived(new Set(snap.coverage.map(s => seatRole(s))));
  const groups = $derived.by(() => {
    const active: Aircraft[] = [], pending: Aircraft[] = [], handed: Aircraft[] = [];
    for (const a of snap.aircraft) {
      if (a.phase === 'gone') continue;
      if (mine(a)) { active.push(a); worked.set(a.cs, snap.tick); continue; }
      const w = worked.get(a.cs);
      if (w !== undefined && snap.tick - w < 4 * 150) { handed.push(a); continue; }
      // Pending: about to come to one of our seats.
      const next = nextSeats(a).filter(r => roles.has(r));
      if (next.length && soon(a, next[0])) pending.push(a);
    }
    const urg = new Map(queue.map(n => [n.cs, n.urgency]));
    active.sort((x, y) => (urg.get(y.cs) ?? 0) - (urg.get(x.cs) ?? 0) || order(x) - order(y));
    return { pending: pending.slice(0, 12), active, handed: handed.slice(-8) };
  });

  function soon(a: Aircraft, role: string) {
    const apt = world.byIcao[a.apt];
    if (role === 'TWR' && a.kind === 'arr') return a.nav.established && geo.dist(a, apt.ends[a.runway!].thr) < 16 * geo.NM;
    if (role === 'TWR' && a.kind === 'dep') return a.phase === 'taxi';
    if (a.kind === 'arr' && a.nav.established) return geo.dist(a, apt.ends[a.runway!].thr) < 20 * geo.NM;
    if (a.kind === 'arr' && (a.phase === 'stack' || a.phase === 'approach' || a.phase === 'arrival')) return a.stack ? geo.dist(a, apt.fixes[a.stack]) < 40 * geo.NM : true;
    if (a.kind === 'dep') return a.phase === 'taxi' || a.phase === 'pushed' || a.phase === 'climb' || (a.phase === 'stand' && a.cleared.dl);
    return a.phase === 'landing' || a.phase === 'vacating' || a.phase === 'final';
  }
  const order = (a: Aircraft) => a.spawnedAt;

  function status(a: Aircraft): string {
    const apt = world.byIcao[a.apt];
    switch (a.phase) {
      case 'stand': return a.cleared.dl ? (a.checkedIn ? 'ready to push' : 'cleared') : 'clearance';
      case 'pushing': return 'pushing';
      case 'pushed': return 'ready to taxi';
      case 'taxi': return a.stoppedS > 15 ? (a.blockedBy ? `wait ${a.blockedBy}` : 'holding short') : `taxi ${a.path.length ? apt.nodes[a.path[a.path.length - 1]].hold ?? '' : ''}`;
      case 'holding': { const g = depGap(world, snap, a); return g === 0 ? 'ready · gap OK' : `ready · gap ${g === Infinity ? 'roll' : Math.ceil(g) + 's'}`; }
      case 'lineup': return 'lining up';
      case 'lined': { const g = depGap(world, snap, a); return a.cleared.cto ? 'rolling' : g === 0 ? 'lined · gap OK' : `lined · ${g === Infinity ? 'roll' : Math.ceil(g) + 's'}`; }
      case 'takeoff': return 'rolling';
      case 'climb': return `${alt(a.alt)} → ${alt(a.tgtAlt)}`;
      case 'arrival': return `${alt(a.alt)} → ${alt(a.tgtAlt)} ${a.stack ?? ''}`;
      case 'stack': return `holding ${a.stack} ${alt(a.alt)}`;
      case 'approach': return `${alt(a.alt)} h${String(Math.round(a.tgtHdg ?? a.hdg)).padStart(3, '0')}${a.nav.ils ? ' ILS' : ''}`;
      case 'final': return `${(geo.dist(a, apt.ends[a.runway!].thr) / geo.NM).toFixed(1)} nm${a.cleared.land ? ' · cleared' : ''}`;
      case 'landing': return 'landing';
      case 'vacating': return 'vacating';
      case 'taxiin': return a.stoppedS > 15 ? 'waiting' : `taxi ${a.stand ?? ''}`;
      case 'parked': return 'on stand';
      case 'goaround': return 'going around';
      default: return a.phase;
    }
  }
  const alt = (ft: number) => (ft > 6000 ? `F${Math.round(ft / 100)}` : `A${Math.round(ft / 100)}`.padStart(3, '0'));

  let dragging: string | null = null;
</script>

<aside class="bay">
  {#each [['Pending', groups.pending], ['Active', groups.active], ['Handed off', groups.handed]] as [title, list] (title)}
    <section class="group" class:drop={title === 'Handed off'}
      ondragover={(e) => { if (title === 'Handed off' && dragging) e.preventDefault(); }}
      ondrop={(e) => { e.preventDefault(); if (title === 'Handed off' && dragging) onHandoff(dragging); dragging = null; }}>
      <h3>{title} <span>{(list as Aircraft[]).length}</span></h3>
      {#each list as Aircraft[] as a (a.cs)}
        {@const need = queue.find(n => n.cs === a.cs)}
        <button class="strip {a.kind}" class:sel={a.cs === selected} class:emg={!!a.emergency} class:alert={a.alert !== 'none' && a.alert !== 'emergency'}
          class:dim={title !== 'Active'} draggable={title === 'Active'}
          ondragstart={() => (dragging = a.cs)} onclick={() => onSelect(a.cs)}>
          <div class="row1">
            <b>{a.cs}</b>
            <span class="type">{a.type}/{a.wake}</span>
            <span class="sq">{a.squawk || '----'}</span>
          </div>
          <div class="row2">
            <span class="route">{a.kind === 'dep' ? (a.sid ?? '—') : (a.star ?? a.stack ?? '—')}</span>
            <span class="rwy">{a.runway ?? ''}</span>
            <span class="st">{status(a)}</span>
          </div>
          {#if need && title === 'Active'}<div class="need {need.level}">{need.text}</div>{/if}
        </button>
      {/each}
    </section>
  {/each}
</aside>

<style>
  .bay { height: 100%; overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 8px; background: var(--panel); border-right: 1px solid var(--line); }
  h3 { margin: 2px 4px 4px; font: 400 11px Silkscreen, var(--mono); letter-spacing: 1px; color: var(--muted); text-transform: uppercase; display: flex; justify-content: space-between; }
  h3 span { color: var(--dim); }
  .group.drop { min-height: 48px; border: 1px dashed transparent; border-radius: 3px; }
  .group.drop:hover { border-color: var(--line); }
  .strip { display: block; width: 100%; text-align: left; margin: 0 0 4px; padding: 4px 7px 5px 9px; border: none; border-left: 6px solid var(--strip-dep);
    background: var(--strip-bg); color: var(--ink); font: 17px/1.05 VT323, var(--mono); cursor: pointer; border-radius: 2px; }
  .strip.arr { border-left-color: var(--strip-arr); }
  .strip:hover { background: var(--strip-hover); }
  .strip.sel { outline: 2px solid var(--sel); outline-offset: -2px; }
  .strip.emg { border-left-color: var(--red); background: var(--strip-emg); }
  .strip.alert { box-shadow: inset 0 0 0 1px var(--amber); }
  .strip.dim { opacity: 0.62; }
  .row1, .row2 { display: flex; gap: 8px; align-items: baseline; }
  .row1 b { font-weight: 400; font-size: 20px; color: var(--ink-strong); min-width: 82px; }
  .type, .sq { color: var(--muted); }
  .sq { margin-left: auto; }
  .route { color: var(--accent); min-width: 64px; }
  .rwy { color: var(--muted); min-width: 28px; }
  .st { margin-left: auto; color: var(--ink); text-align: right; }
  .need { margin-top: 2px; font-size: 15px; }
  .need.routine { color: var(--muted); }
  .need.urgent { color: var(--amber); }
  .need.emergency { color: var(--red); }
</style>
