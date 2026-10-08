<script lang="ts">
  import Attract, { type AttractInfo } from './Attract.svelte';
  import Help from './Help.svelte';
  import { localHour } from '@squawk/sim';
  import { loadProgress } from '../lib/progress.ts';
  import { dailyShift, RATINGS } from '../lib/career.ts';
  import { AIRPORTS, DAYS } from '../lib/data.ts';
  import { REPO, versionLabel } from '../lib/version.ts';

  interface Props { onNav: (s: string) => void; error?: string }
  let { onNav, error = '' }: Props = $props();
  const p = loadProgress();
  let help = $state(p.shifts === 0 && !sessionStorage.getItem('squawk.helpSeen'));
  const closeHelp = () => { help = false; try { sessionStorage.setItem('squawk.helpSeen', '1'); } catch { /* ignore */ } };

  // Career: where you are on the ladder and what comes next.
  const earned = RATINGS.filter(r => r.shifts.every(s => p.passed[s.id])).length;
  const next = RATINGS.flatMap(r => r.shifts.map(s => ({ ...s, rating: r.name }))).find(s => !p.passed[s.id]);
  const rank = earned ? RATINGS[earned - 1].name : 'Student';

  // Daily challenge: today's shift, your result, and when it changes.
  const daily = dailyShift();
  const dailyResult = p.daily[daily.key];
  const dailyDay = DAYS.find(d => d.id === daily.day);
  const mood = dailyDay?.tags.includes('fog') ? 'Fog, low visibility' : dailyDay?.tags.includes('night') ? 'Before dawn' : dailyDay?.tags.includes('easterly') ? 'Easterly day' : 'Summer Friday peak';
  let now = $state(Date.now());
  $effect(() => { const t = setInterval(() => (now = Date.now()), 15000); return () => clearInterval(t); });
  const resetIn = $derived.by(() => {
    const d = new Date(now), ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
    return `${Math.floor(ms / 3.6e6)}h${String(Math.floor((ms % 3.6e6) / 6e4)).padStart(2, '0')}`;
  });
  const realDays = DAYS.filter(d => !d.id.endsWith('-madeup')).length;

  // The live backdrop: its clock, weather and radio.
  let live = $state<AttractInfo | null>(null);
  const hhmm = (t: number) => { const h = localHour(t), hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}`; };

  // Each mode is a flight progress strip, boxed like a real UK strip: name, two short fields, the detail, two more.
  type Strip = { id: string; edge: string; name: string; a: string; b: string; c: string; d: string; e: string };
  const strips: Strip[] = $derived([
    { id: 'career', edge: 'var(--green)', name: 'Career', a: rank, b: `${earned}/${RATINGS.length}`, c: next ? `Next: ${next.title}` : 'Every rating earned', d: next ? next.seats.join('+') : '—', e: next ? `${next.minutes}m` : '' },
    { id: 'daily', edge: 'var(--amber)', name: 'Daily', a: 'EGLL', b: daily.seats.join('+'), c: dailyResult ? `Flown today: grade ${dailyResult.grade}, ${dailyResult.score.toLocaleString('en-GB')}` : mood, d: `${daily.startUtc}Z`, e: resetIn },
    { id: 'setup', edge: 'var(--accent)', name: 'Free shift', a: `${AIRPORTS.length} apts`, b: `${realDays}d`, c: 'Any airport, any day', d: 'ANY', e: '' },
    { id: 'setup:endless', edge: 'var(--red)', name: 'Endless', a: 'EGLL', b: '∞', c: 'Until something gives', d: 'ALL', e: '' },
    { id: 'coop', edge: '#b48cff', name: 'Co-op', a: '2–10', b: 'P2P', c: 'Share the airport', d: 'ANY', e: '' },
  ]);
</script>

<div class="menu">
  <Attract onInfo={(i) => (live = i)} />
  <div class="shade"></div>

  <main>
    <header>
      <h1>SQUAWK</h1>
      {#if live}
        <p class="atis" aria-label="Live conditions at Heathrow">
          Heathrow information <b>{live.atis}</b>, time {hhmm(live.time)}, wind {String(live.wind.dir).padStart(3, '0')} degrees {live.wind.kt} knots,
          landing {live.arr.join(' and ')}, departing {live.dep.join(' and ')}.
        </p>
      {:else}
        <p class="atis">Work the radio at London's airports.</p>
      {/if}
    </header>

    <nav class="bay" aria-label="Game modes">
      {#each strips as s (s.id)}
        <button class="strip" style="--edge:{s.edge}" onclick={() => onNav(s.id)}>
          <span class="name">{s.name}</span>
          <span class="box a">{s.a}</span>
          <span class="box b">{s.b}</span>
          <span class="box c">{s.c}</span>
          <span class="box d">{s.d}</span>
          <span class="box e">{s.e}</span>
        </button>
      {/each}
    </nav>

    <nav class="aux">
      <button onclick={() => onNav('settings')}>Settings</button>
      <button onclick={() => (help = true)}>How to play</button>
      {#if p.shifts}<span>{p.shifts} {p.shifts === 1 ? 'shift' : 'shifts'} worked</span>{/if}
    </nav>
    {#if error}<p class="err">{error}</p>{/if}
  </main>

  {#if live}
    <ol class="log" aria-hidden="true">
      {#each live.lines as l, i (i + l.text)}<li class:atc={l.atc}><span>{l.who}</span>{l.text}</li>{/each}
    </ol>
  {/if}

  <footer>
    <a href={REPO} target="_blank" rel="noopener">{versionLabel}</a>
    <span>Airport data © OpenStreetMap contributors, UK AIP, OpenSky Network, Iowa Environmental Mesonet. Not for real-world navigation.</span>
  </footer>
</div>
{#if help}<Help onClose={closeHelp} />{/if}

<style>
  .menu { position: relative; height: 100vh; overflow: hidden; color: var(--ink); }
  .shade { position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(90deg, rgba(5, 10, 20, 0.88) 0%, rgba(5, 10, 20, 0.6) 34%, rgba(5, 10, 20, 0) 60%),
      linear-gradient(0deg, rgba(5, 10, 20, 0.75) 0%, rgba(5, 10, 20, 0) 24%),
      radial-gradient(ellipse 38% 46% at 100% 100%, rgba(5, 10, 20, 0.82), rgba(5, 10, 20, 0) 100%); }
  main { position: relative; z-index: 2; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; gap: 26px;
    padding: 32px clamp(16px, 5vw, 88px) 64px; width: min(760px, 100%); }

  h1 { margin: 0; font: 400 clamp(44px, 6vw, 76px)/0.9 Silkscreen, var(--mono); letter-spacing: 4px; color: #eef3f8; text-shadow: 4px 4px 0 rgba(0, 0, 0, 0.45); }
  .atis { margin: 14px 0 0; max-width: 52ch; font: 400 14px/1.55 var(--mono); color: #b9c8de; }
  .atis b { color: var(--amber); font-weight: 600; }

  /* An electronic strip bay (EFPS): a dark touchscreen panel, flat strips, a solid colour block naming each one. */
  .bay { display: flex; flex-direction: column; gap: 4px; padding: 10px; border-radius: 8px; background: rgba(9, 15, 25, 0.86); border: 1px solid #22314a;
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45); backdrop-filter: blur(6px); }
  .strip { position: relative; display: grid; grid-template-columns: 140px 84px 70px 1fr 66px 56px; align-items: stretch; height: 44px; padding: 0; border: 1px solid #253650; border-radius: 3px;
    background: #152133; color: #c9d6e6; text-align: left; cursor: pointer; font: 500 13px var(--mono); overflow: hidden; transition: background 0.1s, border-color 0.1s; }
  .strip:hover, .strip:focus-visible { background: #1d2d45; border-color: var(--edge); outline: none; }
  .strip:active { background: #24384f; }
  .name { display: flex; align-items: center; padding-left: 12px; background: var(--edge); font: 700 15px var(--ui); color: #08101c; }
  .box { display: flex; align-items: center; padding: 0 10px; border-left: 1px solid #253650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .box.c { font: 400 13px var(--ui); color: #e6edf6; }
  .box.d, .box.e { justify-content: center; color: #8ea0ba; }
  .box.b { justify-content: center; color: #e6edf6; }
  .strip:hover .box.c { color: #fff; }

  .aux { display: flex; align-items: center; gap: 22px; padding-left: 2px; font: 500 14px var(--ui); }
  .aux button { padding: 0; border: none; background: none; color: #c9d6e6; cursor: pointer; font: inherit; border-bottom: 1px solid transparent; }
  .aux button:hover, .aux button:focus-visible { color: #fff; border-bottom-color: currentColor; outline: none; }
  .aux span { color: var(--muted); font-size: 13px; }
  .err { margin: 0; color: var(--red); font: 14px var(--ui); }

  /* The backdrop's radio, as a transcript fading up from the corner. */
  .log { position: absolute; z-index: 2; right: clamp(16px, 3vw, 40px); bottom: 56px; width: min(420px, 36vw); margin: 0; padding: 0; list-style: none;
    display: flex; flex-direction: column; gap: 10px; font: 400 13px/1.45 var(--mono); color: #c9d6e6; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
    -webkit-mask-image: linear-gradient(transparent, #000 45%); mask-image: linear-gradient(transparent, #000 45%); pointer-events: none; }
  .log span { display: block; font-size: 11px; color: #8ea0ba; }
  .log li.atc { color: #8af0c6; }

  footer { position: absolute; z-index: 2; left: clamp(16px, 5vw, 88px); right: clamp(16px, 3vw, 40px); bottom: 18px; display: flex; gap: 18px; align-items: baseline; font: 11px var(--ui); color: #6f819c; }
  footer a { font: 500 11px var(--mono); color: #8ea0ba; text-decoration: none; white-space: nowrap; }
  footer a:hover { color: #fff; }
  footer span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  @media (prefers-reduced-motion: reduce) { .strip { transition: none; } }
  @media (max-width: 1100px) { .log { display: none; } }
  @media (max-width: 720px) {
    .strip { grid-template-columns: 120px 1fr 52px; height: auto; min-height: 46px; }
    .box.a, .box.b, .box.e { display: none; }
    .box.c { white-space: normal; padding: 6px 9px; }
    main { justify-content: flex-start; padding-top: 40px; }
    footer span { display: none; }
  }
</style>
