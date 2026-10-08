<script lang="ts">
  // The radio console: one button per position you work (with its frequency), plus view layers.
  import { seatRole, type World } from '@squawk/sim';
  import type { Snap } from './client.ts';
  import type { Need } from './needs.ts';

  interface Props {
    world: World; snap: Snap; queue: Need[]; filter: string | null;
    overlays: { sids: boolean; stars: boolean; weather: boolean };
    stripsOpen: boolean; logOpen: boolean;
    onSeat: (seat: string) => void; onFilter: (s: string | null) => void;
    onOverlay: (k: 'routes' | 'weather') => void; onStrips: () => void; onLog: () => void; onHelp: () => void;
  }
  let { world, snap, queue, filter, overlays, stripsOpen, logOpen, onSeat, onFilter, onOverlay, onStrips, onLog, onHelp }: Props = $props();

  const NAME: Record<string, string> = { DEL: 'Delivery', GND: 'Ground', TWR: 'Tower', DIR: 'Director', LON: 'London' };
  const freq = (seat: string) => { const icao = seat === 'LON' ? world.primary.icao : seat.split(':')[0]; return world.byIcao[icao]?.freq[seatRole(seat)]?.freq ?? ''; };
  const multi = $derived(new Set(snap.coverage.filter(s => s !== 'LON').map(s => s.split(':')[0])).size > 1);
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
  @media (max-width: 900px) { .seat { min-width: 0; padding: 6px 9px; } .freq { display: none; } }
</style>
