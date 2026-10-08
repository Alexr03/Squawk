<script lang="ts">
  import { DIFFICULTY, seatId, type Difficulty, type Seat } from '@squawk/sim';
  import { AIRPORTS, daysFor } from '../lib/data.ts';
  import type { Launch } from '../lib/launch.ts';

  interface Props { mode: 'free' | 'endless'; onStart: (l: Launch) => void; onBack: () => void }
  let { mode, onStart, onBack }: Props = $props();

  const SEATS: { role: Seat; name: string; note: string }[] = [
    { role: 'DEL', name: 'Delivery', note: 'Clearances, SIDs, squawks' },
    { role: 'GND', name: 'Ground', note: 'Pushback, taxi, crossings' },
    { role: 'TWR', name: 'Tower', note: 'Runway timing, wake, landing clearances' },
    { role: 'DIR', name: 'Director', note: 'Stacks, vectors, ILS sequencing' },
    { role: 'LON', name: 'London Control', note: 'Feeding stacks, climbing departures' },
  ];
  const PRESETS: { name: string; seats: Seat[]; all?: boolean }[] = [
    { name: 'Tower', seats: ['TWR'] }, { name: 'Ground + Tower', seats: ['GND', 'TWR'] }, { name: 'Director', seats: ['DIR'] },
    { name: 'Heathrow combined', seats: ['DEL', 'GND', 'TWR', 'DIR'] }, { name: 'Radar (Director + London)', seats: ['DIR', 'LON'] },
    { name: 'Everything', seats: ['DEL', 'GND', 'TWR', 'DIR', 'LON'] },
  ];

  let airport = $state('EGLL');
  let extraAirports = $state<string[]>([]);
  const days = $derived(daysFor(airport));
  let dayId = $state(daysFor('EGLL').find(d => d.tags.includes('peak'))?.id ?? daysFor('EGLL')[0]?.id ?? '');
  let hour = $state(7);
  let minutes = $state(mode === 'endless' ? 0 : 30);
  let traffic = $state(mode === 'endless' ? 1 : 0.7);
  let seats = $state<Seat[]>(['TWR']);
  let diffName = $state<'casual' | 'standard' | 'realistic'>('standard');
  let diff = $state<Difficulty>({ ...DIFFICULTY.standard });
  let weather = $state<'real' | 'calm' | 'east' | 'rain' | 'storm' | 'fog'>('real');
  let seed = $state(String((Math.random() * 1e6) | 0));
  let showAdvanced = $state(false);

  $effect(() => { if (!days.some(d => d.id === dayId)) dayId = days[0]?.id ?? ''; });
  function preset(n: string) { diffName = n as typeof diffName; diff = { ...DIFFICULTY[diffName] }; }
  function toggle(r: Seat) { seats = seats.includes(r) ? seats.filter(s => s !== r) : [...seats, r]; }
  const day = $derived(days.find(d => d.id === dayId));
  // Day packs are UTC days; local time is BST in summer.
  const bst = $derived(day ? +day.date.slice(5, 7) >= 4 && +day.date.slice(5, 7) <= 10 : false);

  function go() {
    if (!seats.length) return;
    const airports = [airport, ...extraAirports.filter(a => a !== airport)];
    const date = day?.date ?? '2026-08-28';
    const start = Date.parse(`${date}T00:00:00Z`) / 1000 + (hour - (bst ? 1 : 0)) * 3600;
    const coverage = [...new Set(airports.flatMap(icao => seats.map(r => seatId(icao, r))))];
    const wx = weather === 'real' ? undefined : weather === 'calm' ? { wind: { dir: 260, kt: 4 }, visM: 10000, ceilingFt: null, wx: [] }
      : weather === 'east' ? { wind: { dir: 80, kt: 14 }, visM: 10000, ceilingFt: 3500, wx: [] }
      : weather === 'rain' ? { wind: { dir: 230, kt: 18, gust: 28 }, visM: 4000, ceilingFt: 1200, wx: ['RA'] }
      : weather === 'storm' ? { wind: { dir: 220, kt: 20, gust: 35 }, visM: 5000, ceilingFt: 2500, wx: ['+TSRA', 'CB'] }
      : { wind: { dir: 270, kt: 3 }, visM: 300, ceilingFt: 100, wx: ['FG'] };
    onStart({
      title: mode === 'endless' ? 'Endless' : `${AIRPORTS.find(a => a.icao === airport)?.name ?? airport} — ${PRESETS.find(p => p.seats.length === seats.length && p.seats.every(s => seats.includes(s)))?.name ?? seats.join('+')}`,
      airports, days: airports.map(icao => (icao === airport ? dayId || null : daysFor(icao).find(d => d.date === date)?.id ?? null)),
      start, minutes, traffic, coverage, difficulty: diff, mode, seed: +seed || 1, weather: wx,
    });
  }
</script>

<div class="setup">
  <header><button class="back" onclick={onBack}>← Back</button><h1>{mode === 'endless' ? 'Endless' : 'Free shift'}</h1></header>
  <div class="cols">
    <section>
      <h2>Airport</h2>
      <div class="chips">{#each AIRPORTS as a}<button class:on={airport === a.icao} onclick={() => (airport = a.icao)}>{a.name}</button>{/each}</div>
      {#if AIRPORTS.length > 1}
        <h3>Also cover (London top-down)</h3>
        <div class="chips">{#each AIRPORTS.filter(a => a.icao !== airport) as a}<button class:on={extraAirports.includes(a.icao)} onclick={() => (extraAirports = extraAirports.includes(a.icao) ? extraAirports.filter(x => x !== a.icao) : [...extraAirports, a.icao])}>{a.icao}</button>{/each}</div>
      {/if}
      <h2>Day</h2>
      <div class="list">{#each days as d}<button class:on={dayId === d.id} onclick={() => (dayId = d.id)}><b>{d.label}</b><span>{d.flights} movements · {d.tags.join(', ')}</span></button>{/each}</div>
      <label class="row">Start (local) <input type="range" min="0" max="23" bind:value={hour} /> <b>{String(hour).padStart(2, '0')}:00</b></label>
      {#if mode !== 'endless'}<label class="row">Length <select bind:value={minutes}>{#each [15, 20, 30, 40, 60] as m}<option value={m}>{m} min</option>{/each}</select></label>{/if}
      <label class="row">Traffic <input type="range" min="0.1" max="1" step="0.05" bind:value={traffic} /> <b>{Math.round(traffic * 100)}% of the real day</b></label>
    </section>
    <section>
      <h2>Your positions</h2>
      <div class="chips">{#each PRESETS as p}<button class:on={p.seats.length === seats.length && p.seats.every(s => seats.includes(s))} onclick={() => (seats = [...p.seats])}>{p.name}</button>{/each}</div>
      <div class="seats">
        {#each SEATS as s}
          <label class="seat" class:on={seats.includes(s.role)}><input type="checkbox" checked={seats.includes(s.role)} onchange={() => toggle(s.role)} /><b>{s.name}</b><span>{s.note}</span></label>
        {/each}
      </div>
      <p class="note">AI controllers staff every position you leave empty. When you hold consecutive positions, aircraft stay with you — no handoffs to yourself.</p>
      <h2>Difficulty</h2>
      <div class="chips">{#each ['casual', 'standard', 'realistic'] as n}<button class:on={diffName === n} onclick={() => preset(n)}>{n}</button>{/each}<button class:on={showAdvanced} onclick={() => (showAdvanced = !showAdvanced)}>dials…</button></div>
      {#if showAdvanced}
        <div class="dials">
          <label class="row">Readback errors <input type="range" min="0" max="0.12" step="0.01" bind:value={diff.readbackErrors} /> <b>{Math.round(diff.readbackErrors * 100)}%</b></label>
          <label class="row">Emergencies / hour <input type="range" min="0" max="3" step="0.5" bind:value={diff.emergencies} /> <b>{diff.emergencies}</b></label>
          <label class="row"><input type="checkbox" bind:checked={diff.conflictPrediction} /> Conflict prediction (STCA lines)</label>
          <label class="row"><input type="checkbox" bind:checked={diff.wake} /> Wake rules</label>
          <label class="row"><input type="checkbox" bind:checked={diff.pause} /> Pause allowed</label>
        </div>
      {/if}
      <h2>Weather</h2>
      <div class="chips">{#each [['real', 'Real METARs'], ['calm', 'Calm'], ['east', 'Easterly'], ['rain', 'Rain + gusts'], ['storm', 'Thunderstorms'], ['fog', 'Fog (LVP)']] as [k, n]}<button class:on={weather === k} onclick={() => (weather = k as typeof weather)}>{n}</button>{/each}</div>
      <label class="row">Seed <input class="seed" bind:value={seed} /></label>
      <button class="start" disabled={!seats.length} onclick={go}>Start shift</button>
    </section>
  </div>
</div>

<style>
  .setup { height: 100vh; overflow-y: auto; background: var(--bg); padding: 18px clamp(16px, 4vw, 48px); font: 18px VT323, var(--mono); color: var(--ink); }
  header { display: flex; align-items: center; gap: 18px; }
  h1 { margin: 0; font: 400 20px Silkscreen, var(--mono); color: var(--green); }
  h2 { margin: 18px 0 8px; font: 400 12px Silkscreen, var(--mono); color: var(--muted); letter-spacing: 1px; }
  h3 { margin: 10px 0 6px; font: 400 16px VT323, var(--mono); color: var(--muted); }
  .back { background: none; border: 1px solid var(--line); color: var(--ink); font: 17px VT323, var(--mono); padding: 3px 10px; cursor: pointer; }
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 34px; max-width: 1200px; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chips button, .list button { background: var(--btn); border: 1px solid var(--line); color: var(--ink); font: 17px VT323, var(--mono); padding: 3px 10px; cursor: pointer; text-transform: capitalize; }
  .chips button.on, .list button.on { border-color: var(--green); color: var(--green); }
  .list { display: flex; flex-direction: column; gap: 4px; }
  .list button { text-align: left; display: flex; flex-direction: column; text-transform: none; padding: 5px 10px; }
  .list button span { color: var(--muted); font-size: 16px; }
  .row { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
  .row b { font-weight: 400; color: var(--ink-strong); }
  input[type=range] { flex: 1; accent-color: var(--green); }
  select, .seed { background: var(--btn); color: var(--ink-strong); border: 1px solid var(--line); font: 17px VT323, var(--mono); padding: 2px 6px; }
  .seats { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
  .seat { display: grid; grid-template-columns: 22px 150px 1fr; align-items: center; gap: 6px; padding: 4px 8px; border: 1px solid var(--line); background: var(--panel); cursor: pointer; }
  .seat.on { border-color: var(--green); }
  .seat span { color: var(--muted); }
  .note { color: var(--muted); font-size: 16px; }
  .dials { border: 1px solid var(--line); padding: 4px 10px 10px; margin-top: 6px; }
  .start { margin-top: 22px; width: 100%; padding: 10px; background: var(--green); color: var(--bg); border: none; font: 400 14px Silkscreen, var(--mono); letter-spacing: 1px; cursor: pointer; }
  .start:disabled { opacity: 0.4; cursor: default; }
</style>
