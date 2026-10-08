<script lang="ts">
  import { localHour, seatRole, type World } from '@squawk/sim';
  import type { Snap } from './client.ts';
  import type { Need } from './needs.ts';

  interface Props {
    world: World; snap: Snap; time: number; queue: Need[]; load: number; filter: string | null; speed: number; canPause: boolean; title: string;
    onFilter: (s: string | null) => void; onSpeed: (v: number) => void; onMenu: () => void; onJump: (seat: string) => void;
    voice: { on: boolean; state: string; listening: boolean };
  }
  let { world, snap, time, queue, load, filter, speed, canPause, title, onFilter, onSpeed, onMenu, onJump, voice }: Props = $props();

  const UNIT: Record<string, string> = { DEL: 'DEL', GND: 'GND', TWR: 'TWR', DIR: 'DIR', LON: 'LON' };
  function freq(seat: string) {
    const role = seatRole(seat);
    const icao = seat === 'LON' ? world.primary.icao : seat.split(':')[0];
    return world.byIcao[icao]?.freq[role]?.freq ?? '';
  }
  const badge = (seat: string) => queue.filter(n => snap.aircraft.find(a => a.cs === n.cs)?.owner === seat && n.level !== 'routine').length;
  const hhmmss = $derived.by(() => {
    const h = localHour(time); const hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = Math.floor(time % 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  });
  const left = $derived(snap.durationS ? Math.max(0, snap.durationS - snap.tick / 4) : null);
  const w = $derived(snap.weather);
</script>

<header class="top">
  <button class="menu" onclick={onMenu} title="Pause menu (Esc)">☰</button>
  <div class="title">{title}</div>
  <nav class="tabs">
    <button class:on={filter === null} onclick={() => onFilter(null)}>ALL</button>
    {#each snap.coverage as seat (seat)}
      {@const b = badge(seat)}
      <button class:on={filter === seat} onclick={() => onFilter(filter === seat ? null : seat)} ondblclick={() => onJump(seat)} title="Click to filter, double-click to jump the view">
        <b>{seat.includes(':') && snap.coverage.some(s => s.split(':')[0] !== seat.split(':')[0] && s !== 'LON') ? seat.replace(':', ' ') : UNIT[seatRole(seat)]}</b>
        <span class="f">{freq(seat)}</span>
        {#if b}<span class="badge">{b}</span>{/if}
      </button>
    {/each}
  </nav>
  <div class="wx">
    <span class="clock">{hhmmss}</span>
    <span>INFO <b>{w.atis}</b></span>
    <span>{String(w.wind.dir).padStart(3, '0')}/{w.wind.kt}{w.wind.gust ? 'G' + w.wind.gust : ''}KT</span>
    <span>{w.visM >= 9999 ? '10KM' : w.visM + 'M'}{w.lvp ? ' LVP' : ''}</span>
    {#each snap.apts as as (as.icao)}<span class="rwy">{as.icao.slice(2)} ↓{as.arr.join('/')} ↑{as.dep.join('/')}{as.pendingConfig ? ' ⟳' : ''}{Object.keys(as.closed).length ? ' ✖' : ''}</span>{/each}
    {#if left !== null}<span class="left">{Math.floor(left / 60)}:{String(Math.floor(left % 60)).padStart(2, '0')}</span>{/if}
  </div>
  <div class="load" title="Workload">
    <div class="bar"><div style="width:{Math.round(load * 100)}%" class:hot={load > 0.75} class:warm={load > 0.5}></div></div>
  </div>
  {#if voice.on}<div class="mic" class:live={voice.listening} title="Push-to-talk: {voice.state}">● {voice.listening ? 'TX' : 'PTT'}</div>{/if}
  <div class="speed">
    {#if canPause}<button class:on={speed === 0} onclick={() => onSpeed(speed === 0 ? 1 : 0)} title="Pause (Space)">❚❚</button>{/if}
    {#each [1, 2, 4] as v}<button class:on={speed === v} onclick={() => onSpeed(v)}>{v}×</button>{/each}
  </div>
</header>

<style>
  .top { display: flex; align-items: center; gap: 10px; padding: 0 8px; height: 44px; background: var(--panel-2); border-bottom: 1px solid var(--line); font: 17px VT323, var(--mono); color: var(--ink); white-space: nowrap; overflow: hidden; }
  .menu { background: none; border: 1px solid var(--line); color: var(--ink); font-size: 18px; width: 32px; height: 30px; cursor: pointer; }
  .title { font: 12px Silkscreen, var(--mono); color: var(--green); letter-spacing: 1px; }
  .tabs { display: flex; gap: 3px; }
  .tabs button { position: relative; background: var(--btn); border: 1px solid var(--line); color: var(--muted); font: 16px VT323, var(--mono); padding: 2px 8px; cursor: pointer; display: flex; gap: 6px; align-items: baseline; }
  .tabs button b { font-weight: 400; color: var(--ink-strong); }
  .tabs button.on { border-color: var(--green); color: var(--green); }
  .tabs .f { font-size: 14px; }
  .badge { position: absolute; top: -5px; right: -5px; background: var(--amber); color: var(--bg); border-radius: 8px; padding: 0 5px; font-size: 13px; line-height: 15px; }
  .wx { display: flex; gap: 12px; margin-left: auto; color: var(--muted); }
  .wx b { color: var(--ink-strong); font-weight: 400; }
  .clock { color: var(--ink-strong); font-size: 20px; }
  .rwy { color: var(--accent); }
  .left { color: var(--ink-strong); }
  .load { width: 90px; }
  .bar { height: 8px; background: var(--btn); border: 1px solid var(--line); }
  .bar div { height: 100%; background: var(--green); transition: width 0.4s; }
  .bar div.warm { background: var(--amber); }
  .bar div.hot { background: var(--red); }
  .mic { color: var(--dim); font-size: 15px; }
  .mic.live { color: var(--red); }
  .speed { display: flex; gap: 3px; }
  .speed button { background: var(--btn); border: 1px solid var(--line); color: var(--ink); font: 15px VT323, var(--mono); padding: 2px 7px; cursor: pointer; }
  .speed button.on { background: var(--green); color: var(--bg); border-color: var(--green); }
  @media (max-width: 1100px) { .title, .tabs .f, .load { display: none; } }
</style>
