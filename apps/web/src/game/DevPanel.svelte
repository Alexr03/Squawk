<script lang="ts">
  // Dev panel (F2): stage incidents to try the emergency handling. Shown in development builds, or with ?dev in the address.
  import type { Nature } from '@squawk/sim';

  interface Props { selected: string | null; onDebug: (what: 'crash' | 'midair' | 'emergency', cs?: string, nature?: Nature | 'radio') => void; onClose: () => void }
  let { selected, onDebug, onClose }: Props = $props();

  const EMERGENCIES: { n: Nature | 'radio'; label: string; note: string }[] = [
    { n: 'engine', label: 'Engine failure', note: 'Mayday · stops on the runway, engine fire' },
    { n: 'tyre', label: 'Burst tyre', note: 'Mayday · stops on the runway' },
    { n: 'birdstrike', label: 'Bird strike', note: 'Mayday · stops on the runway' },
    { n: 'fuel', label: 'Low fuel', note: 'Mayday · priority landing' },
    { n: 'pressurisation', label: 'Pressurisation', note: 'Mayday · emergency descent' },
    { n: 'medical', label: 'Medical', note: 'Pan-pan · priority landing' },
    { n: 'radio', label: 'Radio failure', note: '7600 · flies its last clearance' },
  ];
</script>

<div class="dev" role="dialog" aria-label="Dev panel">
  <header>
    <b>Dev panel</b>
    <span>{selected ? `Target: ${selected}` : 'Target: picked for you (select an aircraft to choose)'}</span>
    <button class="x" onclick={onClose} aria-label="Close">×</button>
  </header>
  <h4>Crashes</h4>
  <div class="row">
    <button onclick={() => onDebug('crash', selected ?? undefined)}><b>Ground collision</b><span>On the runway, or at the selected aircraft</span></button>
    <button onclick={() => onDebug('midair', selected ?? undefined)}><b>Mid-air collision</b><span>The selected aircraft and its nearest neighbour</span></button>
  </div>
  <h4>Emergencies</h4>
  <div class="grid">
    {#each EMERGENCIES as e (e.n)}
      <button onclick={() => onDebug('emergency', selected ?? undefined, e.n)}><b>{e.label}</b><span>{e.note}</span></button>
    {/each}
  </div>
  <p>A shift that used the dev panel is kept off the leaderboard. F2 hides this panel.</p>
</div>

<style>
  .dev { position: absolute; left: 50%; top: 70px; transform: translateX(-50%); z-index: 30; width: min(560px, calc(100vw - 32px)); padding: 12px 14px 10px; border-radius: 14px;
    background: rgba(40, 14, 18, 0.92); backdrop-filter: blur(14px); box-shadow: var(--lift), inset 0 0 0 1px rgba(255, 90, 90, 0.4); color: var(--ink); font: 13px var(--ui); }
  header { display: flex; align-items: baseline; gap: 10px; }
  header b { font: 700 14px var(--ui); color: #ff8a8a; }
  header span { flex: 1; color: var(--muted); font-size: 12px; }
  .x { border: none; background: none; color: var(--muted); font-size: 20px; cursor: pointer; }
  h4 { margin: 10px 0 6px; font: 600 12px var(--ui); color: var(--ink-strong); }
  .row, .grid { display: grid; gap: 6px; }
  .row { grid-template-columns: 1fr 1fr; }
  .grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
  button:not(.x) { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 7px 10px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05); color: var(--ink-strong); cursor: pointer; text-align: left; }
  button:not(.x):hover { border-color: #ff8a8a; background: rgba(255, 90, 90, 0.12); }
  button b { font: 600 13px var(--ui); }
  button span { font: 400 11px var(--ui); color: var(--muted); }
  p { margin: 10px 0 0; font-size: 11px; color: var(--muted); }
</style>
