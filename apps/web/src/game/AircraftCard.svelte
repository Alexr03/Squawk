<script lang="ts">
  import { airline, geo, TYPES, type Aircraft, type World } from '@squawk/sim';
  import { callsign } from '@squawk/phraseology';
  import type { Snap } from './client.ts';
  import type { RadialItem } from './radial.ts';

  interface Props { world: World; snap: Snap; ac: Aircraft; actions: RadialItem[]; onPick: (it: RadialItem) => void; onClose: () => void }
  let { world, snap, ac, actions, onPick, onClose }: Props = $props();
  const t = $derived(TYPES[ac.type]);
  const al = $derived(airline(ac.operator));
  const apt = $derived(world.byIcao[ac.apt]);
  const lvl = (ft: number) => (ft > apt.pack.transitionAltFt ? `FL${Math.round(ft / 100)}` : `${Math.round(ft / 100) * 100} ft`);
  const delay = $derived(Math.round((snap.start + snap.tick / 4 - ac.sched) / 60));
</script>

<aside class="card">
  <header>
    <div>
      <h2>{ac.cs}</h2>
      <div class="tel" title="Say this on the radio (or spell the letters: {ac.cs.split('').join(' ')})">On the radio: <b>{callsign(ac.cs)}</b></div>
    </div>
    <button class="x" onclick={onClose} aria-label="Close">×</button>
  </header>
  <div class="livery" style="--body:{al.body}; --tail:{al.tail}; --accent:{al.accent}"><span></span></div>
  <dl>
    <dt>Type</dt><dd>{t.name} · {ac.wake === 'J' ? 'Super' : ac.wake === 'H' ? 'Heavy' : 'Medium'}</dd>
    <dt>Operator</dt><dd>{al.name}</dd>
    <dt>{ac.kind === 'dep' ? 'To' : 'From'}</dt><dd>{ac.other === 'ZZZZ' ? '—' : ac.other}</dd>
    <dt>{ac.kind === 'dep' ? 'SID' : 'Route'}</dt><dd>{ac.kind === 'dep' ? ac.sid ?? '—' : `${ac.star ?? '—'} → ${ac.stack ?? ''}`}</dd>
    <dt>Runway</dt><dd>{ac.runway ?? '—'}</dd>
    <dt>Stand</dt><dd>{ac.stand ?? '—'}</dd>
    <dt>Squawk</dt><dd class:emg={ac.squawk.startsWith('7')}>{ac.squawk || '—'}</dd>
    {#if !ac.onGround}
      <dt>Level</dt><dd>{lvl(ac.alt)} → {lvl(ac.tgtAlt)}</dd>
      <dt>Speed</dt><dd>{Math.round(ac.ias)} kt IAS{ac.tgtSpd ? ` (${ac.tgtSpd})` : ''} · GS {Math.round(ac.gs)}</dd>
      <dt>Heading</dt><dd>{String(Math.round(ac.hdg)).padStart(3, '0')}{ac.nav.mode === 'hdg' && ac.tgtHdg !== null ? ` → ${String(Math.round(ac.tgtHdg)).padStart(3, '0')}` : ac.nav.mode === 'route' ? ` → ${ac.nav.route[0] ?? ''}` : ac.nav.mode === 'hold' ? ` holding ${ac.nav.hold?.fix}` : ''}</dd>
      {#if ac.nav.ils}<dt>ILS</dt><dd>{ac.nav.ils} {ac.nav.established ? 'established' : 'cleared'}</dd>{/if}
    {:else}
      <dt>Ground</dt><dd>{Math.round(ac.gs)} kt{ac.blockedBy ? ` · waiting for ${ac.blockedBy}` : ''}</dd>
    {/if}
    <dt>Schedule</dt><dd>{delay > 1 ? `${delay} min late` : delay < -1 ? `${-delay} min early` : 'on time'}</dd>
    {#if ac.emergency}<dt>Emergency</dt><dd class="emg">{ac.emergency.code} · {ac.emergency.nature}</dd>{/if}
    {#if ac.req}<dt>Request</dt><dd class="req">{ac.req.call.k === 'request' ? ac.req.call.what : ''}</dd>{/if}
  </dl>
  {#if snap.pending.some(p => p.cs === ac.cs)}<div class="rb"><span class="dots"><i></i><i></i><i></i></span>Pilot is reading back…</div>{/if}
  <div class="acts" class:waiting={snap.pending.some(p => p.cs === ac.cs)}>
    {#each actions.slice(0, 10) as it (it.label)}
      <button class:danger={it.danger} onclick={() => onPick(it)}>{it.label}{#if it.hint}<kbd>{it.hint}</kbd>{/if}</button>
    {/each}
  </div>
  {#if !ac.onGround}<div class="foot">{(geo.dist(ac, apt.offset) / geo.NM).toFixed(1)} nm from {apt.icao}</div>{/if}
</aside>

<style>
  .card { max-height: 100%; border-radius: 14px; background: var(--glass); backdrop-filter: blur(14px) saturate(1.2); box-shadow: var(--lift); padding: 12px 14px; overflow-y: auto; font: 13px/1.3 var(--ui); color: var(--ink); scrollbar-width: thin; }
  header { display: flex; justify-content: space-between; align-items: flex-start; }
  h2 { margin: 0; font: 600 22px var(--mono); color: var(--ink-strong); }
  .tel { color: var(--muted); }
  .tel b { color: var(--accent); font-weight: 600; }
  .x { background: none; border: none; color: var(--muted); font-size: 21px; cursor: pointer; line-height: 1; }
  .livery { height: 10px; margin: 8px 0; border-radius: 5px; background: var(--body); border-bottom: 3px solid var(--accent); position: relative; }
  .livery span { position: absolute; right: 0; top: -6px; width: 22px; height: 16px; background: var(--tail); clip-path: polygon(30% 0, 100% 0, 100% 100%, 0 100%); }
  dl { display: grid; grid-template-columns: 84px 1fr; gap: 2px 8px; margin: 6px 0 10px; }
  dt { color: var(--muted); }
  dd { font-family: var(--mono); }
  dd { margin: 0; }
  .emg { color: var(--red); }
  .req { color: var(--amber); }
  .acts { display: flex; flex-wrap: wrap; gap: 5px; }
  .acts button { background: var(--knob); color: var(--ink-strong); border: 1px solid var(--glass-line); font: 500 13px var(--ui); padding: 6px 10px; cursor: pointer; border-radius: 999px; display: flex; gap: 6px; align-items: center; }
  .acts button:hover { border-color: var(--green); color: var(--green); }
  .acts button.danger { color: var(--red); border-color: var(--red); }
  kbd { font: 600 11px var(--mono); color: var(--muted); background: rgba(0, 0, 0, 0.25); border-radius: 4px; padding: 1px 5px; }
  .foot { margin-top: 10px; color: var(--dim); }
  .rb { display: flex; gap: 8px; align-items: center; margin: 0 0 8px; padding: 7px 10px; border-radius: 10px; background: rgba(108, 183, 255, 0.12); color: var(--accent); font: 500 13px var(--ui); }
  .acts.waiting { opacity: 0.45; }
  .dots { display: inline-flex; gap: 3px; }
  .dots i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; animation: dot 1s infinite ease-in-out; }
  .dots i:nth-child(2) { animation-delay: 0.15s; }
  .dots i:nth-child(3) { animation-delay: 0.3s; }
  @keyframes dot { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
</style>
