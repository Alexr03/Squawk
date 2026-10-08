<script lang="ts">
  import { debrief, type Debrief, type ShiftConfig, type State } from '@squawk/sim';
  import Game from './game/Game.svelte';
  import { GameClient, type Snap } from './game/client.ts';
  import { loadAirport, loadDay } from './lib/data.ts';
  import { coach as careerCoach } from './lib/career.ts';
  import { loadProgress, saveProgress, gradeAtLeast } from './lib/progress.ts';
  import { settings } from './lib/settings.svelte.ts';
  import Menu from './screens/Menu.svelte';
  import Setup from './screens/Setup.svelte';
  import DebriefScreen from './screens/Debrief.svelte';
  import Settings from './screens/Settings.svelte';
  import Career from './screens/Career.svelte';
  import Daily from './screens/Daily.svelte';
  import Coop from './screens/Coop.svelte';
  import type { Launch } from './lib/launch.ts';

  type Screen = 'menu' | 'setup' | 'loading' | 'game' | 'debrief' | 'settings' | 'career' | 'daily' | 'coop';
  let screen = $state<Screen>('menu');
  let client = $state<GameClient | null>(null);
  let launch = $state<Launch | null>(null);
  let result = $state<{ d: Debrief; st: State; outcome: string | null } | null>(null);
  let replaying = $state(false);
  let error = $state('');
  let setupMode = $state<'free' | 'endless'>('free');

  async function start(l: Launch) {
    screen = 'loading'; error = ''; launch = l; replaying = false;
    try {
      const packs = await Promise.all(l.airports.map(loadAirport));
      const days = await Promise.all(l.days.map(d => (d ? loadDay(d) : Promise.resolve(null))));
      const cfg: ShiftConfig = { seed: l.seed, airports: l.airports, days, start: l.start, durationS: l.mode === 'endless' ? 0 : l.minutes * 60, traffic: l.traffic, coverage: l.coverage, difficulty: l.difficulty, mode: l.mode, ...(l.weather ? { weather: l.weather } : {}) };
      client?.dispose();
      client = new GameClient(packs, cfg);
      screen = 'game';
    } catch (e) { error = String(e); screen = 'menu'; }
  }

  function ended(st: State) {
    client?.setSpeed(0);
    const d = debrief(st);
    let outcome: string | null = null;
    const p = loadProgress();
    p.shifts++;
    if (launch?.career) {
      const c = launch.career;
      const prev = p.passed[c.id];
      const passed = !c.checkride || (gradeAtLeast(d.grade, c.checkride.minGrade) && d.stats.sepLoss + d.stats.runwayLoss + d.stats.collisions === 0 && !d.incident);
      if (passed && (!prev || prev.score < d.score)) p.passed[c.id] = { grade: d.grade, score: d.score, at: Date.now() };
      outcome = c.checkride ? (passed ? 'Checkride passed — rating earned!' : `Checkride not passed (needs ${c.checkride.minGrade} and no safety events). Try again.`) : passed ? 'Shift complete.' : null;
    }
    if (launch?.dailyKey) p.daily[launch.dailyKey] = { score: Math.max(d.score, p.daily[launch.dailyKey]?.score ?? 0), grade: d.grade };
    const key = `${launch?.mode}:${launch?.coverage.join('+')}`;
    p.bests[key] = Math.max(p.bests[key] ?? 0, d.score);
    saveProgress(p);
    result = { d, st, outcome };
    screen = 'debrief';
  }

  function replayMoment(tick: number) {
    if (!client || !result) return;
    replaying = true;
    client.replay(result.st.cmdLog, Math.max(0, tick - 4 * 40), tick + 4 * 30);
    screen = 'game';
  }
  function quit() { client?.dispose(); client = null; screen = launch?.career ? 'career' : 'menu'; }
</script>

<div class="app" class:hc={settings.highContrast} class:cb={settings.colorblind} class:rm={settings.reducedMotion}>
  {#if screen === 'menu'}
    <Menu onNav={(s) => { setupMode = s === 'setup:endless' ? 'endless' : 'free'; screen = (s.startsWith('setup') ? 'setup' : s) as Screen; }} {error} />
  {:else if screen === 'setup'}
    <Setup mode={setupMode} onStart={start} onBack={() => (screen = 'menu')} />
  {:else if screen === 'career'}
    <Career onStart={start} onBack={() => (screen = 'menu')} />
  {:else if screen === 'daily'}
    <Daily onStart={start} onBack={() => (screen = 'menu')} />
  {:else if screen === 'coop'}
    <Coop onBack={() => (screen = 'menu')} />
  {:else if screen === 'settings'}
    <Settings onBack={() => (screen = 'menu')} />
  {:else if screen === 'loading'}
    <div class="loading"><div class="spin"></div>Loading {launch?.title}…</div>
  {:else if screen === 'game' && client && launch}
    {#key client}
      <Game {client} title={replaying ? `REPLAY — ${launch.title}` : launch.title} canPause={launch.difficulty.pause && launch.mode !== 'daily' || replaying}
        coach={launch.hints && settings.tutorialHints ? (s: Snap, sel: string | null) => careerCoach(client!.world, s, sel) : undefined}
        onEnd={(st) => (replaying ? (screen = 'debrief') : ended(st))} onQuit={() => (replaying ? (screen = 'debrief') : client && ended((client.final ?? client.snap) as State))} />
    {/key}
  {:else if screen === 'debrief' && result && launch}
    <DebriefScreen d={result.d} st={result.st} title={launch.title} outcome={result.outcome} dailyKey={launch.dailyKey ?? null}
      onReplay={replayMoment} onAgain={() => start({ ...launch!, seed: launch!.mode === 'free' ? (Math.random() * 2 ** 31) | 0 : launch!.seed })} onMenu={quit} />
  {/if}
</div>

<style>
  :global(:root) {
    --bg: #070e1c; --panel: #0d1628; --panel-2: #111d34; --btn: #16243f; --line: #22324f; --line-strong: #34496f;
    --ink: #b9c8de; --ink-strong: #e8f0fb; --muted: #7d90ae; --dim: #4f6080;
    --green: #4ff0b4; --green-dim: #2f8f72; --accent: #8fc7ff; --amber: #ffb547; --red: #ff5a5a; --sel: #ffffff; --sel-bg: rgba(143, 199, 255, 0.09);
    --strip-bg: #e9e2cc; --strip-hover: #f3ecd7; --strip-emg: #f6d5cf; --strip-dep: #4a8be0; --strip-arr: #d9a441;
    --ui: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    --mono: 'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace;
    color-scheme: dark;
  }
  :global(body) { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--ui); overflow: hidden; }
  :global(button) { font-family: inherit; }
  :global(.app.hc) { --ink: #ffffff; --muted: #c7d3e6; --dim: #9fb0cb; --line: #4a6290; --green: #7dffcf; }
  :global(.app.cb) { --green: #5cc8ff; --green-dim: #3a7fa6; --amber: #ffd23f; --red: #ff6ad5; }
  :global(.app.rm *) { animation: none !important; transition: none !important; }
  /* Strips are paper: dark ink on buff. */
  :global(.strip) { color: #1f2633 !important; }
  :global(.strip b) { color: #0b0f17 !important; }
  :global(.strip .type), :global(.strip .sq), :global(.strip .rwy) { color: #5c6577 !important; }
  :global(.strip .route) { color: #1d4f9a !important; }
  :global(.strip .st) { color: #1f2633 !important; }
  :global(.strip .need.routine) { color: #5c6577 !important; }
  :global(.strip .need.urgent) { color: #a8650a !important; }
  :global(.strip .need.emergency) { color: #c0262d !important; }
  .loading { height: 100vh; display: flex; flex-direction: column; gap: 14px; align-items: center; justify-content: center; font: 600 15px var(--ui); color: var(--green); }
  .spin { width: 18px; height: 18px; border: 2px solid var(--green); border-right-color: transparent; border-radius: 50%; animation: s 0.8s linear infinite; }
  @keyframes s { to { transform: rotate(360deg); } }
</style>
