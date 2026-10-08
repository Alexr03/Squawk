<script lang="ts" module>
  /** What the briefing shows about the shift being opened. */
  export interface Brief { title: string; airports: string[]; coverage: string[]; start: number; minutes: number; traffic: number; dayLabel?: string; weather?: { wind: { dir: number; kt: number; gust?: number }; visM: number; wx: string[] } }
</script>

<script lang="ts">
  import { localHour } from '@squawk/sim';
  import { AIRPORTS } from '../lib/data.ts';

  interface Props { brief: Brief; step: number }
  let { brief, step }: Props = $props();

  const STEPS = ['Loading the airport and the day’s traffic', 'Building the scene', 'Opening the frequency'];
  const SEAT: Record<string, string> = { DEL: 'Delivery', GND: 'Ground', TWR: 'Tower', DIR: 'Director', LON: 'London Control' };
  const TIPS = [
    'Press N to jump to whoever needs you most. The list on the right is sorted the same way.',
    'Drag from an aircraft onto a holding point, runway, stack or final approach to send it there.',
    'Landing clearance by half a mile or the pilot goes around. Clear early when the runway is free.',
    'Departures on the same route need two minutes between them; on different routes, one.',
    'A medium behind a heavy needs 5 nm on final. Behind an A380, 6 nm or more.',
    'Listen to readbacks: now and then a pilot gets the level or heading wrong. Press Z to correct them.',
    'Zoom in on the airfield to read the signs: yellow are taxiways, red are holding points.',
    'Squawk 7700 is an emergency: give it priority. 7600 is a radio failure — it flies its last clearance.',
    'Right-click an aircraft for everything you can say to it right now.',
    'Space pauses in free play. Use it when the frequency gets busy and plan the next minute.',
    'Hold the push-to-talk key and speak like a controller: callsign first, then the instruction.',
    'Clicking a strip flies the camera to that aircraft.',
  ];
  const tip = TIPS[Math.floor(Math.random() * TIPS.length)];

  const names = $derived(brief.airports.map(i => AIRPORTS.find(a => a.icao === i)?.name ?? i));
  const roles = $derived([...new Set(brief.coverage.map(s => (s === 'LON' ? 'LON' : s.split(':')[1])))].map(r => SEAT[r] ?? r));
  const time = $derived.by(() => { const h = localHour(brief.start), hh = Math.floor(h), mm = Math.round((h - hh) * 60) % 60; return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; });
  const wx = $derived.by(() => {
    const w = brief.weather;
    if (!w) return 'Real weather for the day';
    const what = w.wx.some(x => x.includes('FG')) ? 'Fog, low visibility' : w.wx.some(x => x.includes('TS')) ? 'Thunderstorms' : w.wx.some(x => x.includes('RA')) ? 'Rain' : w.visM >= 9999 ? 'Clear' : 'Haze';
    return `${what} · wind ${String(w.wind.dir).padStart(3, '0')}° ${w.wind.kt}${w.wind.gust ? `–${w.wind.gust}` : ''} kt`;
  });
</script>

<div class="load" role="status" aria-live="polite">
  <div class="sweep" aria-hidden="true"></div>
  <div class="panel">
    <div class="kicker">Shift briefing</div>
    <h1>{brief.title}</h1>
    <dl>
      <div><dt>Airport</dt><dd>{names.join(', ')}</dd></div>
      <div><dt>Your positions</dt><dd>{roles.join(' + ') || 'Watching'}</dd></div>
      <div><dt>On duty</dt><dd>{time} local{brief.minutes ? ` · ${brief.minutes} min` : ' · until it breaks'}</dd></div>
      <div><dt>Traffic</dt><dd>{Math.round(brief.traffic * 100)}%{brief.dayLabel ? ` of ${brief.dayLabel.replace(/ — .*/, '')}` : ''}</dd></div>
      <div class="wide"><dt>Weather</dt><dd>{wx}</dd></div>
    </dl>
    <ol class="steps">
      {#each STEPS as s, i}
        <li class:done={i < step} class:now={i === step}><span class="mark"></span>{s}{i === step ? '…' : ''}</li>
      {/each}
    </ol>
    <div class="bar"><div style="width:{((step + 0.5) / STEPS.length) * 100}%"></div></div>
    <p class="tip"><b>Tip</b>{tip}</p>
  </div>
</div>

<style>
  .load { position: relative; height: 100vh; display: grid; place-items: center; overflow: hidden; background: var(--screen-bg); color: var(--ink); padding: 16px; box-sizing: border-box; }
  /* A slow radar sweep behind the briefing. */
  .sweep { position: absolute; width: 140vmax; height: 140vmax; left: 50%; top: 50%; transform: translate(-50%, -50%); border-radius: 50%;
    background: conic-gradient(from 0deg, transparent 0deg 290deg, rgba(62, 230, 168, 0.16) 360deg),
      repeating-radial-gradient(circle, transparent 0 79px, rgba(108, 183, 255, 0.07) 79px 80px);
    animation: spin 6s linear infinite; }
  @keyframes spin { to { transform: translate(-50%, -50%) rotate(360deg); } }
  .panel { position: relative; width: min(560px, 100%); padding: 24px 26px 20px; border-radius: 20px; background: var(--glass); backdrop-filter: blur(16px) saturate(1.2); box-shadow: var(--lift), inset 0 0 0 1px var(--glass-line); }
  .kicker { font: 600 12px var(--ui); color: var(--green); }
  h1 { margin: 4px 0 16px; font: 600 24px/1.2 var(--ui); color: var(--ink-strong); }
  dl { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; margin: 0 0 18px; }
  dl .wide { grid-column: 1 / -1; }
  dt { font: 500 12px var(--ui); color: var(--muted); }
  dd { margin: 2px 0 0; font: 500 15px var(--ui); color: var(--ink-strong); }
  .steps { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 6px; font: 500 13px var(--ui); color: var(--dim); }
  .steps li { display: flex; align-items: center; gap: 10px; }
  .steps .mark { width: 10px; height: 10px; border-radius: 50%; border: 2px solid currentColor; box-sizing: border-box; }
  .steps li.done { color: var(--muted); }
  .steps li.done .mark { background: var(--green); border-color: var(--green); }
  .steps li.now { color: var(--ink-strong); }
  .steps li.now .mark { border-color: var(--green); animation: pulse 1s infinite; }
  @keyframes pulse { 50% { box-shadow: 0 0 0 4px rgba(62, 230, 168, 0.25); } }
  .bar { height: 4px; border-radius: 2px; background: var(--knob); overflow: hidden; margin-bottom: 16px; }
  .bar div { height: 100%; background: var(--green); transition: width 0.4s ease-out; }
  .tip { margin: 0; padding: 10px 12px; border-radius: 12px; background: rgba(108, 183, 255, 0.08); font: 400 13.5px/1.45 var(--ui); color: var(--ink); }
  .tip b { display: block; font: 600 12px var(--ui); color: var(--accent); margin-bottom: 2px; }
  @media (prefers-reduced-motion: reduce) { .sweep, .steps li.now .mark { animation: none; } }
  @media (max-width: 480px) { dl { grid-template-columns: 1fr; } }
</style>
