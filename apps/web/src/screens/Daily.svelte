<script lang="ts">
  import { onMount } from 'svelte';
  import { DIFFICULTY, seatId, type Seat } from '@squawk/sim';
  import { dailyShift } from '../lib/career.ts';
  import { fetchBoard, type Entry } from '../lib/leaderboard.ts';
  import { loadProgress } from '../lib/progress.ts';
  import { DAYS } from '../lib/data.ts';
  import type { Launch } from '../lib/launch.ts';

  interface Props { onStart: (l: Launch) => void; onBack: () => void }
  let { onStart, onBack }: Props = $props();
  const d = dailyShift();
  const mine = loadProgress().daily[d.key];
  let board = $state<Entry[]>([]);
  let online = $state(false);
  onMount(async () => { const r = await fetchBoard(d.key); board = r.entries; online = r.online; });

  function go() {
    const date = DAYS.find(x => x.id === d.day)?.date ?? '2026-08-28';
    const [hh, mm] = d.startUtc.split(':').map(Number);
    onStart({ title: d.title, airports: [d.airport], days: [d.day], start: Date.parse(`${date}T00:00:00Z`) / 1000 + hh * 3600 + mm * 60, minutes: d.minutes, traffic: d.traffic,
      coverage: d.seats.map(r => seatId(d.airport, r as Seat)), difficulty: { ...DIFFICULTY.standard, emergencies: d.emergencies ?? 1, pause: false }, mode: 'daily', seed: d.seed, dailyKey: d.key });
  }
</script>

<div class="daily">
  <header><button class="back" onclick={onBack}>← Back</button><h1>Daily challenge</h1></header>
  <div class="cols">
    <section>
      <h2>{d.key}</h2>
      <p class="big">{d.seats.join(' + ')} at Heathrow</p>
      <p>{DAYS.find(x => x.id === d.day)?.label} · from {d.startUtc} UTC · {d.minutes} minutes · {Math.round(d.traffic * 100)}% traffic</p>
      <p class="note">Everyone gets the same traffic, weather and emergencies today. No pause.</p>
      {#if mine}<p>Your best today: <b>{mine.score.toLocaleString('en-GB')}</b> (grade {mine.grade})</p>{/if}
      <button class="go" onclick={go}>Start</button>
    </section>
    <section>
      <h2>Leaderboard {online ? '' : '(this device)'}</h2>
      {#if board.length}
        <ol>{#each board.slice(0, 20) as e, i}<li><span>{i + 1}.</span><b>{e.name}</b><span>{e.grade}</span><span>{e.score.toLocaleString('en-GB')}</span></li>{/each}</ol>
      {:else}<p class="note">No scores yet today. Be the first.</p>{/if}
    </section>
  </div>
</div>

<style>
  .daily { height: 100vh; overflow-y: auto; background: var(--bg); padding: 18px clamp(16px, 4vw, 48px); font: 18px VT323, var(--mono); color: var(--ink); }
  header { display: flex; align-items: center; gap: 18px; }
  h1 { margin: 0; font: 400 20px Silkscreen, var(--mono); color: var(--green); }
  h2 { margin: 20px 0 8px; font: 400 12px Silkscreen, var(--mono); color: var(--muted); }
  .back { background: var(--btn); border: 1px solid var(--line); color: var(--ink-strong); font: 17px VT323, var(--mono); padding: 3px 10px; cursor: pointer; }
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 34px; max-width: 1000px; }
  .big { font-size: 30px; color: var(--ink-strong); margin: 0; }
  .note { color: var(--muted); }
  .go { margin-top: 14px; padding: 10px 28px; background: var(--green); color: var(--bg); border: none; font: 400 14px Silkscreen, var(--mono); cursor: pointer; }
  ol { list-style: none; padding: 0; }
  li { display: grid; grid-template-columns: 34px 1fr 30px 90px; gap: 8px; padding: 2px 0; border-bottom: 1px solid var(--line); }
  li b { font-weight: 400; color: var(--ink-strong); }
</style>
