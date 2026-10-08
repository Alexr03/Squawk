<script lang="ts">
  import { DIFFICULTY, seatId, type Seat } from '@squawk/sim';
  import { RATINGS, type CareerShift } from '../lib/career.ts';
  import { loadProgress } from '../lib/progress.ts';
  import { DAYS } from '../lib/data.ts';
  import type { Launch } from '../lib/launch.ts';

  interface Props { onStart: (l: Launch) => void; onBack: () => void }
  let { onStart, onBack }: Props = $props();
  const p = loadProgress();
  // A rating's shifts unlock in order; the next rating unlocks when the previous checkride is passed.
  const unlocked = (ri: number, si: number) => {
    if (ri > 0 && !RATINGS[ri - 1].shifts.every(s => p.passed[s.id])) return false;
    return si === 0 || !!p.passed[RATINGS[ri].shifts[si - 1].id];
  };
  let open = $state<CareerShift | null>(null);

  export function launchFor(c: CareerShift, seed = 4242): Launch {
    const date = DAYS.find(d => d.id === c.day)?.date ?? '2026-08-28';
    const [hh, mm] = c.startUtc.split(':').map(Number);
    const start = Date.parse(`${date}T00:00:00Z`) / 1000 + hh * 3600 + mm * 60;
    return {
      title: c.title, airports: [c.airport], days: [c.day], start, minutes: c.minutes, traffic: c.traffic,
      coverage: c.seats.map(r => seatId(c.airport, r as Seat)), mode: c.checkride ? 'checkride' : 'career', seed,
      difficulty: { ...DIFFICULTY[c.difficulty], ...(c.emergencies !== undefined ? { emergencies: c.emergencies } : {}) }, hints: c.hints, career: c,
    };
  }
</script>

<div class="career">
  <header><button class="back" onclick={onBack}>← Back</button><h1>Career</h1></header>
  <div class="ladder">
    {#each RATINGS as r, ri}
      {@const done = r.shifts.every(s => p.passed[s.id])}
      <section class="rating" class:done class:locked={!unlocked(ri, 0)}>
        <h2>{r.name} {#if done}<span class="badge">RATED</span>{/if}</h2>
        <p>{r.summary}</p>
        <div class="shifts">
          {#each r.shifts as s, si}
            {@const best = p.passed[s.id]}
            <button class="shift" class:check={!!s.checkride} disabled={!unlocked(ri, si)} onclick={() => (open = s)}>
              <b>{s.title}</b>
              <span>{s.seats.join(' + ')} · {s.minutes} min{s.checkride ? ' · checkride' : ''}</span>
              {#if best}<i class="g{best.grade}">{best.grade}</i>{:else if !unlocked(ri, si)}<i class="lock">🔒</i>{/if}
            </button>
          {/each}
        </div>
      </section>
    {/each}
  </div>
  {#if open}
    <div class="modal" role="dialog">
      <div class="box">
        <h2>{open.title}</h2>
        <p>{open.brief}</p>
        <p class="meta">{DAYS.find(d => d.id === open!.day)?.label} · {open.startUtc} UTC · {open.seats.join(' + ')} · {Math.round(open.traffic * 100)}% traffic{open.checkride ? ` · pass: grade ${open.checkride.minGrade}, no safety events` : ''}</p>
        <div class="row"><button onclick={() => (open = null)}>Cancel</button><button class="go" onclick={() => onStart(launchFor(open!))}>Begin shift</button></div>
      </div>
    </div>
  {/if}
</div>

<style>
  .career { height: 100vh; overflow-y: auto; background: var(--bg); padding: 18px clamp(16px, 4vw, 48px); font: 18px VT323, var(--mono); color: var(--ink); }
  header { display: flex; align-items: center; gap: 18px; }
  h1 { margin: 0; font: 400 20px Silkscreen, var(--mono); color: var(--green); }
  .back, button { background: var(--btn); border: 1px solid var(--line); color: var(--ink-strong); font: 17px VT323, var(--mono); padding: 3px 10px; cursor: pointer; }
  .ladder { display: flex; flex-direction: column; gap: 14px; margin-top: 16px; max-width: 980px; }
  .rating { border: 1px solid var(--line); background: var(--panel); padding: 10px 14px; }
  .rating.done { border-color: var(--green-dim); }
  .rating.locked { opacity: 0.5; }
  .rating h2 { margin: 0; font: 400 14px Silkscreen, var(--mono); color: var(--ink-strong); display: flex; gap: 10px; align-items: center; }
  .badge { font-size: 10px; color: var(--bg); background: var(--green); padding: 2px 6px; }
  .rating p { margin: 4px 0 8px; color: var(--muted); }
  .shifts { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 6px; }
  .shift { position: relative; text-align: left; display: flex; flex-direction: column; padding: 6px 10px; }
  .shift span { color: var(--muted); font-size: 16px; }
  .shift.check { border-color: var(--amber); }
  .shift:disabled { cursor: default; opacity: 0.55; }
  .shift i { position: absolute; right: 8px; top: 6px; font: 400 16px Silkscreen, var(--mono); font-style: normal; }
  .gS { color: #ffe27a; } .gA { color: var(--green); } .gB { color: var(--accent); } .gC { color: var(--amber); } .gD { color: var(--red); }
  .lock { font-size: 14px; }
  .modal { position: fixed; inset: 0; background: rgba(5, 10, 20, 0.75); display: flex; align-items: center; justify-content: center; z-index: 10; }
  .box { width: min(560px, 92vw); background: var(--panel-2); border: 1px solid var(--line-strong); padding: 18px 20px; }
  .box h2 { margin: 0 0 8px; font: 400 15px Silkscreen, var(--mono); color: var(--green); }
  .meta { color: var(--muted); }
  .row { display: flex; gap: 8px; justify-content: flex-end; }
  .go { background: var(--green); color: var(--bg); border-color: var(--green); }
</style>
