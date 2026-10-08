<script lang="ts">
  import Attract, { type AttractInfo } from './Attract.svelte';
  import Help from './Help.svelte';
  import { localHour } from '@squawk/sim';
  import { loadProgress } from '../lib/progress.ts';
  import { dailyShift, RATINGS } from '../lib/career.ts';
  import { DAYS } from '../lib/data.ts';

  interface Props { onNav: (s: string) => void; error?: string }
  let { onNav, error = '' }: Props = $props();
  const p = loadProgress();
  let help = $state(p.shifts === 0 && !sessionStorage.getItem('squawk.helpSeen'));
  const closeHelp = () => { help = false; try { sessionStorage.setItem('squawk.helpSeen', '1'); } catch { /* ignore */ } };

  // Career: where you are on the ladder and what comes next.
  const ladder = RATINGS.map(r => ({ name: r.name, done: r.shifts.filter(s => p.passed[s.id]).length, total: r.shifts.length }));
  const earned = ladder.filter(r => r.done === r.total).length;
  const next = RATINGS.flatMap(r => r.shifts.map(s => ({ ...s, rating: r.name }))).find(s => !p.passed[s.id]);
  const current = earned ? RATINGS[earned - 1].name : 'Student';

  // Daily challenge: today's shift, your result, and when it changes.
  const daily = dailyShift();
  const dailyResult = p.daily[daily.key];
  const dailyDay = DAYS.find(d => d.id === daily.day);
  const dailyMood = dailyDay?.tags.includes('fog') ? 'Fog and low visibility' : dailyDay?.tags.includes('night') ? 'Before dawn' : dailyDay?.tags.includes('easterly') ? 'Easterly day' : 'Summer Friday peak';
  const SEAT: Record<string, string> = { DEL: 'Delivery', GND: 'Ground', TWR: 'Tower', DIR: 'Director', LON: 'London' };
  let now = $state(Date.now());
  $effect(() => { const t = setInterval(() => (now = Date.now()), 1000); return () => clearInterval(t); });
  const resetIn = $derived.by(() => {
    const ms = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1) - now;
    const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4);
    return `${h} h ${String(m).padStart(2, '0')} min`;
  });

  // The live backdrop's clock, weather and radio.
  let live = $state<AttractInfo | null>(null);
  const clock = $derived.by(() => {
    if (!live) return '';
    const h = localHour(live.time), hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = Math.floor(live.time % 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  });
</script>

<div class="menu">
  <Attract onInfo={(i) => (live = i)} />
  <div class="shade"></div>

  {#if live}
    <div class="live" aria-label="Live at Heathrow">
      <span class="dot"></span><span class="where">Live at Heathrow</span>
      <b class="clk">{clock}</b>
      <span class="atis">{live.atis}</span>
      <span>{String(live.wind.dir).padStart(3, '0')}° {live.wind.kt} kt</span>
      <span class="rw"><i class="arr">⬇ {live.arr.join(' ')}</i> <i class="dep">⬆ {live.dep.join(' ')}</i></span>
      <span>{live.moving} aircraft moving</span>
    </div>
    <div class="feed" aria-hidden="true">
      {#each live.lines as l, i (i + l.text)}
        <p class:atc={l.atc} style="opacity:{0.35 + (i / Math.max(1, live.lines.length - 1)) * 0.65}"><b>{l.who}</b>{l.text}</p>
      {/each}
    </div>
  {/if}

  <main>
    <h1>SQUAWK</h1>
    <p class="tag">Work the radio at London's airports. Real traffic, real procedures, one frequency at a time.</p>

    <div class="cards">
      <button class="card career" onclick={() => onNav('career')}>
        <div class="kicker">Career · {current}</div>
        <div class="title">{next ? next.title : 'Every rating earned'}</div>
        <div class="desc">{next ? `${next.rating} · ${next.seats.map(s => SEAT[s]).join(' + ')} · ${next.minutes} min${next.checkride ? ' · checkride' : ''}` : 'Fly any shift again to beat your best.'}</div>
        <div class="ladder" aria-label="{earned} of {ladder.length} ratings">
          {#each ladder as r}
            <div class="rung" class:done={r.done === r.total} title="{r.name}: {r.done} of {r.total} shifts"><div class="fill" style="width:{(r.done / r.total) * 100}%"></div></div>
          {/each}
        </div>
        <div class="cap">{earned} of {ladder.length} ratings{next ? ` · working towards ${next.rating}` : ''}</div>
        <div class="cta">{p.shifts ? 'Continue' : 'Start training'} <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg></div>
      </button>

      <button class="card daily" onclick={() => onNav('daily')}>
        <div class="kicker">Daily challenge</div>
        <div class="title">Heathrow {daily.seats.map(s => SEAT[s]).join(' + ')}</div>
        <div class="desc">{dailyMood} · from {daily.startUtc} UTC · {daily.minutes} min. Everyone gets the same shift.</div>
        <div class="dfoot">
          {#if dailyResult}<span class="res">Today: <b class="g{dailyResult.grade}">{dailyResult.grade}</b> · {dailyResult.score.toLocaleString('en-GB')}</span>
          {:else}<span class="res">Not flown yet today</span>{/if}
          <span class="reset">New shift in {resetIn}</span>
        </div>
      </button>
    </div>

    <div class="modes">
      <button class="mode" onclick={() => onNav('setup')}>
        <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 26L16 6l10 20" /><path d="M16 11v3M16 17v3M16 23v2" /></svg>
        <b>Free shift</b><span>Pick the airport, positions, day and weather</span>
      </button>
      <button class="mode" onclick={() => onNav('setup:endless')}>
        <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 24h5l4-8 4 4 4-10 4 6h3" /></svg>
        <b>Endless</b><span>Traffic builds until something gives</span>
      </button>
      <button class="mode" onclick={() => onNav('coop')}>
        <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 17a6 6 0 0 1 12 0M15 17a6 6 0 0 1 12 0" /><rect x="4" y="17" width="3" height="6" rx="1.5" /><rect x="15" y="17" width="3" height="6" rx="1.5" /><rect x="25" y="17" width="3" height="6" rx="1.5" /></svg>
        <b>Co-op</b><span>Split the positions with friends</span>
      </button>
    </div>

    <div class="util">
      <button onclick={() => onNav('settings')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></svg>Settings
      </button>
      <button onclick={() => (help = true)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17.2v.1" /></svg>How to play
      </button>
      {#if p.shifts}<span class="stat">{p.shifts} {p.shifts === 1 ? 'shift' : 'shifts'} worked</span>{/if}
    </div>
    {#if error}<p class="err">{error}</p>{/if}
    <footer>
      Airport data © OpenStreetMap contributors (ODbL) · UK AIP via NATS AIS · Traffic: The OpenSky Network · Weather: Iowa Environmental Mesonet. Not for real-world navigation or ATC.
    </footer>
  </main>
</div>
{#if help}<Help onClose={closeHelp} />{/if}

<style>
  .menu { position: relative; height: 100vh; overflow: hidden; color: var(--ink); }
  .shade { position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(90deg, rgba(6, 12, 24, 0.92) 0%, rgba(6, 12, 24, 0.72) 30%, rgba(6, 12, 24, 0.1) 62%, rgba(6, 12, 24, 0) 75%),
      linear-gradient(0deg, rgba(6, 12, 24, 0.7) 0%, rgba(6, 12, 24, 0) 30%); }
  main { position: relative; z-index: 2; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; gap: 14px;
    padding: 24px clamp(16px, 5vw, 80px); width: min(640px, 100%); overflow-y: auto; }
  h1 { margin: 0; font: 400 clamp(46px, 6.5vw, 80px)/1 Silkscreen, var(--mono); color: var(--green); letter-spacing: 6px; text-shadow: 0 0 28px rgba(62, 230, 168, 0.35), 0 3px 0 rgba(0, 0, 0, 0.5); }
  .tag { margin: 0 0 10px; font: 400 17px/1.45 var(--ui); color: var(--ink); max-width: 46ch; text-shadow: 0 1px 8px rgba(0, 0, 0, 0.6); }

  button { font-family: var(--ui); color: inherit; cursor: pointer; text-align: left; border: none; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  svg { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

  .cards { display: grid; grid-template-columns: 1.35fr 1fr; gap: 12px; }
  .card { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 16px 18px 14px; border-radius: 18px; background: var(--glass); backdrop-filter: blur(14px) saturate(1.2);
    box-shadow: var(--lift), inset 0 0 0 1px var(--glass-line); transition: transform 0.15s, box-shadow 0.15s; overflow: hidden; }
  .card:hover { transform: translateY(-2px); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(255, 255, 255, 0.16); }
  .kicker { font: 600 12px var(--ui); color: var(--muted); }
  .title { font: 600 21px/1.2 var(--ui); color: var(--ink-strong); }
  .desc { font: 400 13px/1.4 var(--ui); color: var(--ink); }
  .career { border-top: 3px solid var(--green); }
  .career .kicker { color: var(--green); }
  .ladder { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; margin: 10px 0 0; }
  .cap { font: 500 12px var(--ui); color: var(--muted); }
  .rung { position: relative; height: 6px; border-radius: 6px; background: rgba(255, 255, 255, 0.06); overflow: hidden; }
  .rung .fill { position: absolute; inset: 0 auto 0 0; background: rgba(62, 230, 168, 0.35); }
  .rung.done .fill { background: var(--green); }
  .cta { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; padding: 7px 12px 7px 16px; border-radius: 999px; background: var(--green); color: var(--bg); font: 700 14px var(--ui); }
  .cta svg { width: 16px; height: 16px; stroke-width: 2.6; }
  .daily { border-top: 3px solid var(--amber); }
  .daily .kicker { color: var(--amber); }
  .dfoot { margin-top: auto; display: flex; flex-direction: column; gap: 2px; padding-top: 10px; font: 500 12px var(--ui); }
  .res { color: var(--ink); }
  .res b { font-family: var(--mono); }
  .reset { color: var(--muted); }
  .gS { color: #ffe27a; } .gA { color: var(--green); } .gB { color: var(--accent); } .gC { color: var(--amber); } .gD { color: var(--red); }

  .modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .mode { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 12px 14px 13px; border-radius: 14px;
    background: rgba(14, 26, 43, 0.66); backdrop-filter: blur(10px); box-shadow: inset 0 0 0 1px var(--glass-line); transition: background 0.15s, box-shadow 0.15s; }
  .mode:hover { background: var(--glass-hi); box-shadow: inset 0 0 0 1px rgba(108, 183, 255, 0.45); }
  .mode svg { width: 28px; height: 28px; margin-bottom: 4px; color: var(--accent); stroke-width: 1.8; }
  .mode b { font: 600 15px var(--ui); color: var(--ink-strong); }
  .mode span { font: 400 12px/1.3 var(--ui); color: var(--muted); }

  .util { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
  .util button { display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px 8px 10px; border-radius: 999px; background: transparent; color: var(--ink); font: 500 14px var(--ui); }
  .util button:hover { background: var(--knob); color: var(--ink-strong); }
  .util svg { width: 18px; height: 18px; }
  .stat { margin-left: auto; font: 500 12px var(--ui); color: var(--muted); }
  .err { color: var(--red); font: 14px var(--ui); margin: 0; }
  footer { font: 11px/1.5 var(--ui); color: var(--dim); max-width: 70ch; }

  .live { position: absolute; z-index: 3; top: 16px; right: 16px; display: flex; align-items: center; gap: 12px; padding: 7px 14px; border-radius: 999px;
    background: var(--glass); backdrop-filter: blur(14px); box-shadow: var(--lift); font: 500 13px var(--ui); color: var(--ink); }
  .live .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--red); box-shadow: 0 0 8px var(--red); animation: blink 2s infinite; }
  .live .where { font-weight: 600; color: var(--ink-strong); }
  .clk { font: 600 15px var(--mono); color: var(--ink-strong); }
  .atis { width: 20px; height: 20px; border-radius: 5px; background: var(--knob); display: grid; place-items: center; font: 700 11px var(--mono); color: var(--accent); }
  .rw i { font: 600 12px var(--mono); font-style: normal; }
  .rw .arr { color: var(--accent); } .rw .dep { color: var(--green); }
  .feed { position: absolute; z-index: 3; right: 16px; bottom: 16px; width: min(440px, 40vw); display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
  .feed p { margin: 0; padding: 8px 12px; border-radius: 12px; background: rgba(10, 20, 36, 0.72); backdrop-filter: blur(8px); font: 400 13px/1.35 var(--ui); color: var(--ink); }
  .feed p b { display: block; font: 600 11px var(--mono); color: var(--muted); margin-bottom: 1px; }
  .feed p.atc { color: var(--green); }
  @keyframes blink { 50% { opacity: 0.35; } }
  @media (prefers-reduced-motion: reduce) { .live .dot { animation: none; } .card { transition: none; } }
  @media (max-width: 1150px) { .feed { display: none; } .live { left: 16px; right: auto; top: auto; bottom: 16px; } }
  @media (max-width: 640px) { .cards, .modes { grid-template-columns: 1fr; } .live { display: none; } main { justify-content: flex-start; } }
</style>
