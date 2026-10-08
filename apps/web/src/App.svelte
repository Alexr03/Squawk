<script lang="ts">
  import { debrief, type Debrief, type State } from '@squawk/sim';
  import Game from './game/Game.svelte';
  import { GameClient, type ShiftClient, type Snap } from './game/client.ts';
  import { coop, endCoop, type Guest } from './net/coop.svelte.ts';
  import CoopSeats from './screens/CoopSeats.svelte';
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
  import { prepare, type Launch } from './lib/launch.ts';
  import Loading, { type Brief } from './screens/Loading.svelte';
  import { DAYS } from './lib/data.ts';

  type Screen = 'menu' | 'setup' | 'loading' | 'game' | 'debrief' | 'settings' | 'career' | 'daily' | 'coop';
  let screen = $state<Screen>('menu');
  let client = $state<ShiftClient | null>(null);
  let launch = $state<Launch | null>(null);
  let result = $state<{ d: Debrief; st: State; outcome: string | null } | null>(null);
  let replaying = $state(false);
  let error = $state('');
  let setupMode = $state<'free' | 'endless'>('free');

  const brief = $derived<Brief | null>(launch ? {
    title: launch.title, airports: launch.airports, coverage: launch.coverage, start: launch.start, minutes: launch.mode === 'endless' ? 0 : launch.minutes,
    traffic: launch.traffic, dayLabel: DAYS.find(d => d.id === launch!.days[0])?.label, weather: launch.weather,
  } : null);
  async function start(l: Launch) {
    screen = 'loading'; error = ''; launch = l; replaying = false;
    try {
      // The briefing stays up long enough to read, even when everything is cached.
      const [{ packs, cfg }] = await Promise.all([prepare(l), new Promise(r => setTimeout(r, 1400))]);
      client?.dispose();
      client = new GameClient(packs, cfg);
      screen = 'game';
    } catch (e) { error = String(e); screen = 'menu'; }
  }
  /** Co-op: the lobby hands over a running shift (the host's GameClient or a guest's RemoteClient). */
  function play(c: ShiftClient, l: Launch) { launch = l; replaying = false; client = c; screen = 'game'; }
  function takeOver() {
    const h = (coop.session as Guest).takeover();
    client?.dispose(); client = null;
    coop.session = h; coop.lost = false; screen = 'coop';
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
    if (!(client instanceof GameClient) || !result) return;
    replaying = true;
    client.replay(result.st.cmdLog, Math.max(0, tick - 4 * 40), tick + 4 * 30);
    screen = 'game';
  }
  function quit() { client?.dispose(); client = null; endCoop(); screen = launch?.career ? 'career' : 'menu'; }
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
    <Coop onBack={() => (screen = 'menu')} onPlay={play} />
  {:else if screen === 'settings'}
    <Settings onBack={() => (screen = 'menu')} />
  {:else if screen === 'loading'}
    {#if brief}<Loading {brief} step={0} />{/if}
  {:else if screen === 'game' && client && launch}
    {#key client}
      <Game {client} brief={brief ?? undefined} title={replaying ? `REPLAY — ${launch.title}` : launch.title} canPause={launch.difficulty.pause && launch.mode !== 'daily' || replaying}
        coach={launch.hints && settings.tutorialHints ? (s: Snap, sel: string | null) => careerCoach(client!.world, s, sel) : undefined}
        onEnd={(st) => (replaying ? (screen = 'debrief') : ended(st))} onQuit={async () => { if (replaying) { screen = 'debrief'; return; } if (!client) return; ended(client.final ?? (client instanceof GameClient ? await client.full() : client.snap as State)); }}
        menuExtra={coop.session ? coopPanel : undefined} />
    {/key}
    {#snippet coopPanel()}<CoopSeats />{/snippet}
    {#if coop.lost}
      <div class="lost" role="alertdialog" aria-label="Host lost">
        <div class="box">
          <h2>Host lost — shift paused</h2>
          <p>The host's browser stopped answering. One player can take over hosting from the last saved moment (up to 10 s ago); everyone else rejoins them.</p>
          <div class="row">
            {#if (coop.session as Guest | null)?.canTakeOver}<button onclick={takeOver}>Take over hosting</button>{/if}
            <button onclick={() => { const room = (coop.session as Guest | null)?.room ?? null; quit(); coop.rejoin = room; screen = 'coop'; }}>Rejoin a new host</button>
            <button onclick={quit}>Leave</button>
          </div>
        </div>
      </div>
    {/if}
  {:else if screen === 'debrief' && result && launch}
    <DebriefScreen d={result.d} st={result.st} title={launch.title} outcome={result.outcome} dailyKey={launch.dailyKey ?? null}
      onReplay={replayMoment} onAgain={() => coop.session ? quit() : start({ ...launch!, seed: launch!.mode === 'free' ? (Math.random() * 2 ** 31) | 0 : launch!.seed })} onMenu={quit} />
  {/if}
</div>

<style>
  :global(:root) {
    --bg: #070e1c; --panel: #0d1628; --panel-2: #111d34; --btn: #1a2b47; --line: #26395a; --line-strong: #34496f;
    --ink: #c9d6e6; --ink-strong: #eef3f8; --muted: #7d90ae; --dim: #4f6080;
    --green: #3ee6a8; --green-dim: #2f8f72; --accent: #6cb7ff; --amber: #ffb547; --red: #ff5a5a; --sel: #ffffff; --sel-bg: rgba(143, 199, 255, 0.09);
    --strip-bg: #172234; --strip-hover: #1f2d44; --strip-emg: #3b1c25; --strip-dep: #4a8be0; --strip-arr: #d9a441;
    --ui: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    --mono: 'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace;
    --glass: rgba(14, 26, 43, 0.82); --glass-hi: rgba(30, 48, 74, 0.92); --glass-line: rgba(255, 255, 255, 0.09); --knob: rgba(255, 255, 255, 0.07);
    --lift: 0 10px 30px rgba(0, 0, 0, 0.35), 0 1px 0 rgba(255, 255, 255, 0.06) inset;
    --screen-bg: radial-gradient(ellipse 90% 70% at 75% -10%, #1b3658 0%, #0c1a30 45%, var(--bg) 85%) fixed;
    color-scheme: dark;
  }
  :global(body) { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--ui); overflow: hidden; }
  :global(button) { font-family: inherit; border-radius: 10px; }
  :global(select), :global(input:not([type=range]):not([type=checkbox])) { border-radius: 8px; }
  /* Panels in the menu screens: soft, rounded, lifted. */
  :global(.rating), :global(.box), :global(.dials), :global(.seat), :global(.card) { border-radius: 14px; }
  :global(.start) { border-radius: 12px; box-shadow: 0 8px 24px rgba(62, 230, 168, 0.25); }
  :global(.app.hc) { --ink: #ffffff; --muted: #c7d3e6; --dim: #9fb0cb; --line: #4a6290; --green: #7dffcf; }
  :global(.app.cb) { --green: #5cc8ff; --green-dim: #3a7fa6; --amber: #ffd23f; --red: #ff6ad5; }
  :global(.app.rm *) { animation: none !important; transition: none !important; }
  .loading { height: 100vh; display: flex; flex-direction: column; gap: 14px; align-items: center; justify-content: center; font: 600 15px var(--ui); color: var(--green); }
  .lost { position: fixed; inset: 0; z-index: 80; background: rgba(5, 10, 20, 0.75); display: flex; align-items: center; justify-content: center; }
  .lost .box { width: min(520px, 92vw); background: var(--panel-2); border: 1px solid var(--amber); padding: 18px 20px; font: 14px var(--ui); }
  .lost h2 { margin: 0 0 8px; font: 600 15px var(--ui); color: var(--amber); }
  .lost .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .lost button { background: var(--btn); border: 1px solid var(--line-strong); color: var(--ink-strong); font: 13px var(--ui); padding: 4px 12px; cursor: pointer; }
  .spin { width: 18px; height: 18px; border: 2px solid var(--green); border-right-color: transparent; border-radius: 50%; animation: s 0.8s linear infinite; }
  @keyframes s { to { transform: rotate(360deg); } }
</style>
