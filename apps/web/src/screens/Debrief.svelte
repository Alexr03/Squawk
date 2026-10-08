<script lang="ts">
  import { localHour, type Debrief, type State } from '@squawk/sim';
  import { submitScore } from '../lib/leaderboard.ts';
  import { settings } from '../lib/settings.svelte.ts';

  interface Props { d: Debrief; st: State; title: string; outcome: string | null; dailyKey: string | null; onReplay: (tick: number) => void; onAgain: () => void; onMenu: () => void }
  let { d, st, title, outcome, dailyKey, onReplay, onAgain, onMenu }: Props = $props();
  const s = d.stats;
  const clock = (tick: number) => { const h = localHour(st.start + tick / 4); const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };
  const canReplay = !!st.ended && st.cmdLog.length >= 0 && st.tick > 0;
  let submitted = $state<string | null>(null);
  async function submit() {
    if (!dailyKey) return;
    submitted = 'Sending…';
    submitted = await submitScore(dailyKey, settings.callsign || 'Anonymous', d.score, d.grade);
  }
  const bars = [
    { name: 'Safety', v: d.safety, label: `×${d.safety.toFixed(2)}`, note: 'Multiplies everything' },
    { name: 'Efficiency', v: d.efficiency / 100, label: `${d.efficiency}`, note: `${Math.round((s.depDelayS + s.arrDelayS) / 60)} min delay · ${Math.round(s.holdS / 60)} min holding` },
    { name: 'Throughput', v: d.throughput / 40, label: `+${d.throughput}`, note: `${d.movements} movements · ${d.perHour}/hour` },
    { name: 'Radio', v: d.radio / 20, label: `+${d.radio}`, note: `${s.transmissions} transmissions` },
  ];
</script>

<div class="deb">
  <div class="card">
    <div class="head">
      <div class="grade g{d.grade}">{d.grade}</div>
      <div>
        <h1>{d.incident ? 'Incident — shift ended' : 'Shift debrief'}</h1>
        <div class="title">{title}</div>
        <div class="score">{d.score.toLocaleString('en-GB')} points</div>
        {#if outcome}<div class="outcome">{outcome}</div>{/if}
      </div>
    </div>
    <div class="bars">
      {#each bars as b}
        <div class="bar"><span class="n">{b.name}</span><div class="track"><div style="width:{Math.round(Math.max(0, Math.min(1, b.v)) * 100)}%"></div></div><b>{b.label}</b><span class="note">{b.note}</span></div>
      {/each}
    </div>
    <ul class="notes">{#each d.notes as n}<li>{n}</li>{/each}</ul>
    <h2>Worst moments</h2>
    {#if d.worst.length}
      <ol class="timeline">
        {#each d.worst as e}
          <li class="sev{e.severity}"><span class="t">{clock(e.tick)}</span><span class="txt">{e.text}{e.ai ? ' (AI)' : ''}</span>{#if canReplay}<button onclick={() => onReplay(e.tick)}>Replay</button>{/if}</li>
        {/each}
      </ol>
    {:else}<p class="quiet">Nothing worth replaying. Clean shift.</p>{/if}
    <div class="acts">
      {#if dailyKey}<button onclick={submit} disabled={!!submitted}>{submitted ?? 'Submit to leaderboard'}</button>{/if}
      <button onclick={onAgain}>Again</button>
      <button class="primary" onclick={onMenu}>Continue</button>
    </div>
  </div>
</div>

<style>
  .deb { height: 100vh; overflow-y: auto; display: flex; justify-content: center; padding: 30px 16px; background: radial-gradient(ellipse at top, #10203c, var(--bg) 70%); font: 18px VT323, var(--mono); color: var(--ink); }
  .card { width: min(760px, 100%); }
  .head { display: flex; gap: 22px; align-items: center; }
  .grade { font: 400 92px Silkscreen, var(--mono); width: 130px; text-align: center; color: var(--green); text-shadow: 0 0 30px currentColor; }
  .grade.gS { color: #ffe27a; } .grade.gA { color: var(--green); } .grade.gB { color: var(--accent); } .grade.gC { color: var(--amber); } .grade.gD { color: var(--red); }
  h1 { margin: 0; font: 400 16px Silkscreen, var(--mono); color: var(--ink-strong); }
  .title { color: var(--muted); }
  .score { font-size: 28px; color: var(--ink-strong); }
  .outcome { color: var(--green); margin-top: 4px; }
  .bars { margin: 24px 0 10px; display: flex; flex-direction: column; gap: 6px; }
  .bar { display: grid; grid-template-columns: 100px 1fr 60px 1.2fr; gap: 10px; align-items: center; }
  .track { height: 10px; background: var(--btn); border: 1px solid var(--line); }
  .track div { height: 100%; background: var(--green); }
  .bar b { font-weight: 400; color: var(--ink-strong); text-align: right; }
  .note { color: var(--muted); font-size: 16px; }
  .notes { color: var(--ink); padding-left: 20px; }
  h2 { font: 400 12px Silkscreen, var(--mono); color: var(--muted); margin: 18px 0 8px; }
  .timeline { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
  .timeline li { display: grid; grid-template-columns: 56px 1fr auto; gap: 10px; align-items: center; padding: 4px 8px; border-left: 3px solid var(--dim); background: var(--panel); }
  .timeline .sev2, .timeline .sev3 { border-left-color: var(--amber); }
  .timeline .sev4, .timeline .sev5 { border-left-color: var(--red); }
  .t { color: var(--dim); }
  .quiet { color: var(--muted); }
  button { background: var(--btn); border: 1px solid var(--line-strong); color: var(--ink-strong); font: 17px VT323, var(--mono); padding: 4px 12px; cursor: pointer; }
  .acts { display: flex; gap: 8px; justify-content: flex-end; margin-top: 22px; }
  .primary { background: var(--green); color: var(--bg); border-color: var(--green); font: 400 13px Silkscreen, var(--mono); }
</style>
