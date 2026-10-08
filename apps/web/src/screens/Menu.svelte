<script lang="ts">
  import Attract from './Attract.svelte';
  import Help from './Help.svelte';
  import { loadProgress } from '../lib/progress.ts';
  import { RATINGS } from '../lib/career.ts';

  interface Props { onNav: (s: string) => void; error?: string }
  let { onNav, error = '' }: Props = $props();
  const p = loadProgress();
  let help = $state(p.shifts === 0 && !sessionStorage.getItem('squawk.helpSeen'));
  const closeHelp = () => { help = false; try { sessionStorage.setItem('squawk.helpSeen', '1'); } catch { /* ignore */ } };
  const earned = RATINGS.filter(r => r.shifts.every(s => p.passed[s.id])).length;
  const items = [
    { s: 'career', label: 'Career', sub: earned ? `${RATINGS[Math.min(earned, RATINGS.length - 1)].name} · ${earned}/${RATINGS.length} ratings` : 'Start as a trainee on Delivery' },
    { s: 'setup', label: 'Free shift', sub: 'Any airport, positions, day and traffic' },
    { s: 'daily', label: 'Daily challenge', sub: 'One shift, the same for everyone today' },
    { s: 'setup:endless', label: 'Endless', sub: 'Traffic keeps ramping until something breaks' },
    { s: 'coop', label: 'Co-op', sub: 'Work the airport with friends (2–10 seats)' },
    { s: 'settings', label: 'Settings', sub: 'Audio, voice, display, accessibility' },
    { s: 'help', label: 'How to play', sub: 'Controls, rules and scoring' },
  ];
</script>

<div class="menu">
  <Attract />
  <div class="shade"></div>
  <main>
    <h1>SQUAWK</h1>
    <p class="tag">Air traffic control at London Heathrow — real data, real radio.</p>
    <nav>
      {#each items as it}
        <button onclick={() => (it.s === 'help' ? (help = true) : onNav(it.s))}>
          <b>{it.label}</b><span>{it.sub}</span>
        </button>
      {/each}
    </nav>
    {#if error}<p class="err">{error}</p>{/if}
    <footer>
      Airport data © OpenStreetMap contributors (ODbL) · UK AIP via NATS AIS (AIRAC 2610) · Traffic: The OpenSky Network · Weather: Iowa Environmental Mesonet<br />
      Not for real-world navigation or ATC.
    </footer>
  </main>
</div>
{#if help}<Help onClose={closeHelp} />{/if}

<style>
  .menu { position: relative; height: 100vh; overflow: hidden; }
  .shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(7, 14, 28, 0.94) 0%, rgba(7, 14, 28, 0.75) 32%, rgba(7, 14, 28, 0.05) 70%); pointer-events: none; }
  main { position: relative; z-index: 2; height: 100%; display: flex; flex-direction: column; justify-content: center; padding: 0 clamp(20px, 6vw, 90px); max-width: 520px; }
  h1 { margin: 0; font: 400 clamp(42px, 6vw, 72px) Silkscreen, var(--mono); color: var(--green); letter-spacing: 6px; text-shadow: 0 0 24px rgba(79, 240, 180, 0.35); }
  .tag { margin: 4px 0 28px; font: 17px var(--ui); color: var(--ink); }
  nav { display: flex; flex-direction: column; gap: 6px; }
  nav button { text-align: left; background: rgba(13, 22, 40, 0.72); border: 1px solid var(--line); border-left: 3px solid var(--line-strong); color: var(--ink-strong); padding: 8px 14px; cursor: pointer;
    display: flex; flex-direction: column; gap: 1px; backdrop-filter: blur(2px); }
  nav button b { font: 600 16px var(--ui); letter-spacing: 1px; }
  nav button span { font: 14px var(--ui); color: var(--muted); }
  nav button:hover, nav button:focus-visible { border-left-color: var(--green); background: rgba(17, 29, 52, 0.92); outline: none; }
  nav button:hover b { color: var(--green); }
  .err { color: var(--red); font: 14px var(--ui); }
  footer { margin-top: 32px; font: 12px var(--ui); color: var(--dim); }
</style>
