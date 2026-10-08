<script lang="ts">
  import { localHour, type World } from '@squawk/sim';
  import type { Snap } from './client.ts';
  import type { Need } from './needs.ts';
  import { settings } from '../lib/settings.svelte.ts';

  interface Props {
    world: World; snap: Snap; time: number; queue: Need[]; load: number; filter: string | null; speed: number; canPause: boolean; title: string;
    onFilter: (s: string | null) => void; onSpeed: (v: number) => void; onMenu: () => void; onJump: (seat: string) => void;
    voice: { on: boolean; state: string; listening: boolean };
  }
  let { snap, time, load, speed, canPause, title, onSpeed, onMenu, voice }: Props = $props();

  const clock = $derived.by(() => {
    const h = localHour(time); const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  });
  const secs = $derived(String(Math.floor(time % 60)).padStart(2, '0'));
  const left = $derived(snap.durationS ? Math.max(0, snap.durationS - snap.tick / 4) : null);
  const w = $derived(snap.weather);
  const moves = $derived(snap.stats.landed + snap.stats.departed);
  const safety = $derived(snap.stats.sepLoss + snap.stats.runwayLoss + snap.stats.collisions);
</script>

<div class="hud-top">
  <div class="cluster left">
    <button class="round" onclick={onMenu} title="Pause menu (Esc)" aria-label="Menu">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" /></svg>
    </button>
    <div class="title">{title}</div>
  </div>

  <div class="pill time">
    <div class="speeds" role="group" aria-label="Simulation speed">
      {#if canPause}
        <button class:on={speed === 0} onclick={() => onSpeed(speed === 0 ? 1 : 0)} title="Pause (Space)" aria-label="Pause">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12M15 6v12" /></svg>
        </button>
      {/if}
      {#each [1, 2, 3, 4, 5] as v}
        <button class="num" class:on={speed === v} onclick={() => onSpeed(v)} title="{v}× speed (key {v})" aria-label="{v} times speed">{v}×</button>
      {/each}
    </div>
    <div class="clock" title={settings.fastDay ? 'Fast day: an hour passes every two minutes (traffic runs in real time)' : 'Local time'}><b>{clock}</b>{#if settings.fastDay}<span class="fast">30×</span>{:else}<span>{secs}</span>{/if}</div>
    <div class="wx" title="Weather (ATIS information {w.atis})">
      <span class="atis">{w.atis}</span>
      <svg class="wind" viewBox="0 0 24 24" style="transform: rotate({w.wind.dir + 180}deg)" aria-hidden="true"><path d="M12 4v16M7 9l5-5 5 5" /></svg>
      <span>{w.wind.kt}{w.wind.gust ? `–${w.wind.gust}` : ''} kt</span>
      {#if w.lvp}<span class="lvp">LVP</span>{/if}
    </div>
    {#each snap.apts.slice(0, 1) as as (as.icao)}
      <div class="rwy" title="Runways in use">
        <span class="arr">⬇ {as.arr.join(' ')}</span><span class="dep">⬆ {as.dep.join(' ')}</span>
        {#if as.pendingConfig}<span class="chg" title="Runway change coming">⟳</span>{/if}
      </div>
    {/each}
  </div>

  <div class="cluster right">
    {#if voice.on}<div class="pill mic" class:live={voice.listening} title="Push-to-talk: {voice.state}"><span class="dot"></span>{voice.listening ? 'Transmitting' : 'Mic ready'}</div>{/if}
    <div class="pill stats">
      <div class="stat" title="Movements this shift"><b>{moves}</b><span>moves</span></div>
      <div class="stat" class:bad={safety > 0} title="Safety events"><b>{safety}</b><span>{safety === 1 ? 'incident' : 'incidents'}</span></div>
      {#if left !== null}<div class="stat" title="Time left in the shift"><b>{Math.floor(left / 60)}:{String(Math.floor(left % 60)).padStart(2, '0')}</b><span>left</span></div>{/if}
      <div class="load" title="Workload"><div style="height:{Math.round(load * 100)}%" class:hot={load > 0.75} class:warm={load > 0.5}></div></div>
    </div>
  </div>
</div>

<style>
  .hud-top { position: absolute; top: 12px; left: 12px; right: 12px; z-index: 10; display: grid; grid-template-columns: 1fr auto 1fr; align-items: start; pointer-events: none; }
  .hud-top > * { pointer-events: auto; }
  .cluster { display: flex; gap: 10px; align-items: center; }
  .right { justify-content: flex-end; }
  .pill { display: flex; align-items: center; gap: 14px; padding: 6px 14px; border-radius: 999px; background: var(--glass); backdrop-filter: blur(14px) saturate(1.2); box-shadow: var(--lift); color: var(--ink); font: 500 13px var(--ui); }
  .round { width: 40px; height: 40px; border-radius: 50%; border: none; background: var(--glass); backdrop-filter: blur(14px); box-shadow: var(--lift); color: var(--ink-strong); cursor: pointer; display: grid; place-items: center; }
  .round:hover { color: var(--green); }
  .title { font: 600 14px var(--ui); color: var(--ink-strong); text-shadow: 0 1px 6px rgba(0, 0, 0, 0.7); }
  svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .time { padding: 5px 16px 5px 6px; }
  .speeds { display: flex; gap: 2px; background: var(--knob); border-radius: 999px; padding: 2px; }
  .speeds button { height: 30px; min-width: 34px; padding: 0 8px; border: none; border-radius: 999px; background: transparent; color: var(--ink); cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .speeds button.on { background: var(--green); color: var(--bg); }
  .speeds .num { min-width: 30px; padding: 0 6px; font: 600 12px var(--mono); }
  .clock b { font: 600 22px/1 var(--mono); color: var(--ink-strong); letter-spacing: 0.5px; }
  .clock span { font: 500 13px var(--mono); color: var(--muted); margin-left: 2px; }
  .clock .fast { margin-left: 6px; font: 600 10px var(--ui); color: var(--amber); vertical-align: 3px; }
  .wx { display: flex; align-items: center; gap: 6px; color: var(--ink); }
  .atis { width: 22px; height: 22px; border-radius: 6px; background: var(--knob); display: grid; place-items: center; font: 700 12px var(--mono); color: var(--accent); }
  .wind { width: 16px; height: 16px; color: var(--accent); }
  .lvp { color: var(--amber); font-weight: 700; }
  .rwy { display: flex; gap: 8px; font: 600 13px var(--mono); }
  .arr { color: var(--accent); }
  .dep { color: var(--green); }
  .chg { color: var(--amber); }
  .stats { gap: 16px; border-radius: 16px; padding: 6px 12px 6px 16px; }
  .stat { display: flex; flex-direction: column; align-items: center; line-height: 1.05; }
  .stat b { font: 600 17px var(--mono); color: var(--ink-strong); }
  .stat span { font: 500 11px var(--ui); color: var(--muted); }
  .stat.bad b { color: var(--red); }
  .load { width: 8px; height: 30px; border-radius: 4px; background: var(--knob); display: flex; align-items: flex-end; overflow: hidden; }
  .load div { width: 100%; background: var(--green); transition: height 0.5s; }
  .load div.warm { background: var(--amber); }
  .load div.hot { background: var(--red); }
  .mic { gap: 8px; font-size: 12px; color: var(--muted); }
  .mic .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
  .mic.live { color: var(--red); }
  .mic.live .dot { background: var(--red); box-shadow: 0 0 8px var(--red); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (max-width: 1100px) { .title, .rwy { display: none; } }
</style>
