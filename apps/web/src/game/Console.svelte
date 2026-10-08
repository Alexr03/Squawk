<script lang="ts">
  // The radio console: one button per position you work (with its frequency), plus view layers.
  import { seatRole, type World } from '@squawk/sim';
  import type { Snap } from './client.ts';
  import type { Need } from './needs.ts';

  interface Props {
    world: World; snap: Snap; queue: Need[]; filter: string | null;
    overlays: { sids: boolean; stars: boolean; weather: boolean };
    stripsOpen: boolean; logOpen: boolean; autoCam?: boolean; onAutoCam?: () => void;
    onRunway?: (apt: string, pair: string, open: boolean) => void;
    onSeat: (seat: string) => void; onFilter: (s: string | null) => void;
    onOverlay: (k: 'routes' | 'weather') => void; onStrips: () => void; onLog: () => void; onHelp: () => void;
  }
  let { world, snap, queue, filter, overlays, stripsOpen, logOpen, autoCam = false, onAutoCam, onRunway, onSeat, onFilter, onOverlay, onStrips, onLog, onHelp }: Props = $props();

  const NAME: Record<string, string> = { DEL: 'Delivery', GND: 'Ground', TWR: 'Tower', DIR: 'Director', LON: 'London' };
  const freq = (seat: string) => { const icao = seat === 'LON' ? world.primary.icao : seat.split(':')[0]; return world.byIcao[icao]?.freq[seatRole(seat)]?.freq ?? ''; };
  const multi = $derived(new Set(snap.coverage.filter(s => s !== 'LON').map(s => s.split(':')[0])).size > 1);
  // Runways the player's towers control: open or closed, and what (if anything) is blocking one.
  let rwyOpen = $state(false);
  const runways = $derived(snap.apts.filter(a => snap.coverage.includes(`${a.icao}:TWR`)).flatMap(a => world.byIcao[a.icao].runways.map(r => {
    const closed = (a.closed[r.name] ?? 0) > snap.tick;
    const blocker = (snap.incidents ?? []).find(i => !i.resolved && i.apt === a.icao && i.runway === r.name);
    return { apt: a.icao, pair: r.name, closed, blocker: blocker ? (blocker.kind === 'crash' ? 'wreckage' : 'aircraft stopped') : null };
  })));
  const anyClosed = $derived(runways.some(r => r.closed));
  const waiting = (seat: string) => queue.filter(n => n.level !== 'routine' && snap.aircraft.find(a => a.cs === n.cs)?.owner === seat).length;
</script>

<nav class="console" aria-label="Positions and view">
  <div class="group seats">
    {#each snap.coverage as seat (seat)}
      {@const w = waiting(seat)}
      <button class="seat" class:on={filter === seat} onclick={() => onSeat(seat)} oncontextmenu={(e) => { e.preventDefault(); onFilter(filter === seat ? null : seat); }}
        title="{NAME[seatRole(seat)]}: click to look, right-click to show only this frequency">
        <span class="name">{multi && seat !== 'LON' ? seat.split(':')[0].slice(2) + ' ' : ''}{NAME[seatRole(seat)]}</span>
        <span class="freq">{freq(seat)}</span>
        {#if w}<span class="badge">{w}</span>{/if}
      </button>
    {/each}
  </div>
  <div class="group tools">
    <button class="tool" class:on={stripsOpen} onclick={onStrips} title="Flight strips">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="4" rx="1" /><rect x="4" y="10" width="16" height="4" rx="1" /><rect x="4" y="16" width="16" height="4" rx="1" /></svg>
    </button>
    <button class="tool" class:on={logOpen} onclick={onLog} title="Radio log">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9v6M9 6v12M13 9v6M17 4v16M21 10v4" /></svg>
    </button>
    <button class="tool" class:on={overlays.sids} onclick={() => onOverlay('routes')} title="Departure and arrival routes (O)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19c5-1 6-6 9-7s6 1 9-6" /><circle cx="3" cy="19" r="1.6" /><circle cx="21" cy="6" r="1.6" /></svg>
    </button>
    <button class="tool" class:on={overlays.weather} onclick={() => onOverlay('weather')} title="Weather radar (W)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 17z" /></svg>
    </button>
    {#if onRunway && runways.length}
      <div class="rwywrap">
        <button class="tool" class:on={rwyOpen} class:alarm={anyClosed} onclick={() => (rwyOpen = !rwyOpen)} title="Runways: open or close" aria-expanded={rwyOpen}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3l-3 18M15 3l3 18M12 5v2M12 10v3M12 16v3" /></svg>
        </button>
        {#if rwyOpen}
          <div class="rwypop" role="dialog" aria-label="Runways">
            <b>Runways</b>
            {#each runways as r (r.apt + r.pair)}
              <div class="rw" class:closed={r.closed}>
                <span class="nm">{r.pair}{snap.apts.length > 1 ? ` · ${r.apt}` : ''}</span>
                <span class="st">{r.closed ? (r.blocker ? `Closed · ${r.blocker}` : 'Closed') : 'Open'}</span>
                <button disabled={r.closed && !!r.blocker} onclick={() => onRunway(r.apt, r.pair, r.closed)}>{r.closed ? 'Reopen' : 'Close'}</button>
              </div>
            {/each}
            <p>Closing a runway moves traffic to the others. With every runway closed, arrivals hold.</p>
          </div>
        {/if}
      </div>
    {/if}
    {#if onAutoCam}<button class="tool" class:on={autoCam} onclick={onAutoCam} title="Auto camera: show me whatever needs me (Shift+V)" aria-pressed={autoCam}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="13" height="10" rx="2" /><path d="M16 11l5-3v8l-5-3z" /><path d="M7 4h2M11 4h2" /></svg>
    </button>{/if}
    <button class="tool" onclick={onHelp} title="How to play">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17.2v.1" /></svg>
    </button>
  </div>
</nav>

<style>
  .console { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 10; display: flex; gap: 10px; align-items: stretch;
    padding: 8px; border-radius: 18px; background: var(--glass); backdrop-filter: blur(14px) saturate(1.2); box-shadow: var(--lift); }
  .group { display: flex; gap: 6px; }
  .tools { padding-left: 10px; border-left: 1px solid var(--glass-line); align-items: center; }
  .seat { position: relative; min-width: 92px; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 7px 12px 6px; border-radius: 12px;
    border: 1px solid var(--glass-line); background: var(--knob); color: var(--ink-strong); cursor: pointer; text-align: left; transition: background 0.15s, border-color 0.15s; }
  .seat:hover { border-color: var(--green); }
  .seat.on { background: var(--green); color: var(--bg); border-color: var(--green); }
  .name { font: 600 13px var(--ui); }
  .freq { font: 500 12px var(--mono); color: var(--green); }
  .seat.on .freq { color: var(--bg); }
  .badge { position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--amber); color: var(--bg); font: 700 11px/18px var(--ui); text-align: center; }
  .tool { width: 40px; height: 40px; border-radius: 12px; border: 1px solid transparent; background: transparent; color: var(--ink); cursor: pointer; display: grid; place-items: center; }
  .tool:hover { background: var(--knob); }
  .tool.on { color: var(--green); background: var(--knob); border-color: var(--glass-line); }
  svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  svg rect, svg circle { fill: none; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .rwywrap { position: relative; }
  .tool.alarm { color: var(--red); }
  .rwypop { position: absolute; bottom: calc(100% + 14px); left: 50%; transform: translateX(-50%); width: 300px; padding: 12px 14px; border-radius: 14px; background: var(--glass-hi); backdrop-filter: blur(14px); box-shadow: var(--lift); display: flex; flex-direction: column; gap: 6px; }
  .rwypop > b { font: 600 14px var(--ui); color: var(--ink-strong); }
  .rw { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid var(--glass-line); }
  .rw .nm { font: 600 13px var(--mono); color: var(--ink-strong); }
  .rw .st { font: 500 12px var(--ui); color: var(--green); }
  .rw.closed .st { color: var(--red); }
  .rw button { padding: 4px 10px; border-radius: 999px; border: 1px solid var(--glass-line); background: var(--knob); color: var(--ink-strong); font: 600 12px var(--ui); cursor: pointer; }
  .rw button:disabled { opacity: 0.4; cursor: default; }
  .rwypop p { margin: 4px 0 0; font: 400 12px/1.4 var(--ui); color: var(--muted); }
  @media (max-width: 900px) { .seat { min-width: 0; padding: 6px 9px; } .freq { display: none; } }
</style>
