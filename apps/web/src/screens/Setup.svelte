<script lang="ts">
  import { DIFFICULTY, seatId, type Difficulty, type Seat } from '@squawk/sim';
  import { AIRPORTS, daysFor, isMadeUp } from '../lib/data.ts';
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
    { name: 'Whole airport', seats: ['DEL', 'GND', 'TWR', 'DIR'] }, { name: 'Radar (Director + London)', seats: ['DIR', 'LON'] },
    { name: 'Everything', seats: ['DEL', 'GND', 'TWR', 'DIR', 'LON'] },
  ];

  const NOTES: Record<string, string> = {
    EGLL: 'Two parallel runways, the busiest in Europe', EGKK: 'One runway, run flat out', EGSS: 'One long runway, low-cost hub',
    EGGW: 'One runway on a hilltop', EGLC: 'Short runway, steep 5.5° approach',
  };
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
      airports, days: airports.map(icao => (icao === airport ? dayId || null : isMadeUp(dayId) ? `${icao}-madeup` : daysFor(icao).find(d => d.date === date && !isMadeUp(d.id))?.id ?? null)),
      start, minutes, traffic, coverage, difficulty: diff, mode, seed: +seed || 1, weather: wx,
    });
  }
</script>

<div class="setup">
  <header>
    <button class="back" onclick={onBack} aria-label="Back to the menu"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg></button>
    <div><h1>{mode === 'endless' ? 'Endless' : 'Free shift'}</h1><p class="sub">{mode === 'endless' ? 'Traffic keeps building. Last as long as you can without an incident.' : 'Set up any shift you like: airport, positions, day, weather.'}</p></div>
  </header>

  <div class="grid">
    <div class="col">
      <section>
        <h2>Airport</h2>
        <div class="apts">
          {#each AIRPORTS as a}
            <button class="apt" class:on={airport === a.icao} onclick={() => (airport = a.icao)}>
              <span class="code">{a.icao}</span><b>{a.name.replace('London ', '')}</b><span class="what">{NOTES[a.icao] ?? ''}</span>
            </button>
          {/each}
        </div>
        {#if AIRPORTS.length > 1}
          <h3>Also work these at the same time (London top-down)</h3>
          <div class="chips">{#each AIRPORTS.filter(a => a.icao !== airport) as a}<button class:on={extraAirports.includes(a.icao)} onclick={() => (extraAirports = extraAirports.includes(a.icao) ? extraAirports.filter(x => x !== a.icao) : [...extraAirports, a.icao])}>{a.name.replace('London ', '')}</button>{/each}</div>
        {/if}
      </section>

      <section>
        <h2>Traffic</h2>
        <div class="days">
          {#each days as d}
            <button class="day" class:on={dayId === d.id} class:made={isMadeUp(d.id)} onclick={() => (dayId = d.id)}>
              <b>{d.label}</b><span>{isMadeUp(d.id) ? `About ${d.flights.toLocaleString('en-GB')} movements, invented fresh each time` : `${d.flights.toLocaleString('en-GB')} real movements · ${d.tags.join(', ')}`}</span>
            </button>
          {/each}
        </div>
        <div class="row"><span class="lab">Start</span><input type="range" min="0" max="23" bind:value={hour} aria-label="Start time" /><output>{String(hour).padStart(2, '0')}:00 local</output></div>
        {#if mode !== 'endless'}
          <div class="row"><span class="lab">Length</span>
            <div class="seg">{#each [15, 20, 30, 40, 60] as m}<button class:on={minutes === m} onclick={() => (minutes = m)}>{m} min</button>{/each}</div>
          </div>
        {/if}
        <div class="row"><span class="lab">Busyness</span><input type="range" min="0.1" max="1" step="0.05" bind:value={traffic} aria-label="Traffic level" /><output>{Math.round(traffic * 100)}%</output></div>
      </section>
    </div>

    <div class="col">
      <section>
        <h2>Your positions</h2>
        <div class="chips">{#each PRESETS as p}<button class:on={p.seats.length === seats.length && p.seats.every(s => seats.includes(s))} onclick={() => (seats = [...p.seats])}>{p.name}</button>{/each}</div>
        <div class="seats">
          {#each SEATS as s}
            <label class="seat" class:on={seats.includes(s.role)}>
              <div><b>{s.name}</b><span>{s.note}</span></div>
              <input class="switch" type="checkbox" checked={seats.includes(s.role)} onchange={() => toggle(s.role)} />
            </label>
          {/each}
        </div>
        <p class="note">AI controllers work every position you leave empty. Aircraft stay with you across positions you hold together.</p>
      </section>

      <section>
        <h2>Conditions</h2>
        <div class="row"><span class="lab">Difficulty</span>
          <div class="seg">{#each [['casual', 'Casual'], ['standard', 'Standard'], ['realistic', 'Realistic']] as [n, label]}<button class:on={diffName === n} onclick={() => preset(n)}>{label}</button>{/each}</div>
          <button class="link" onclick={() => (showAdvanced = !showAdvanced)}>{showAdvanced ? 'Hide details' : 'Details'}</button>
        </div>
        {#if showAdvanced}
          <div class="dials">
            <div class="row"><span class="lab">Readback errors</span><input type="range" min="0" max="0.12" step="0.01" bind:value={diff.readbackErrors} aria-label="Readback errors" /><output>{Math.round(diff.readbackErrors * 100)}%</output></div>
            <div class="row"><span class="lab">Emergencies</span><input type="range" min="0" max="3" step="0.5" bind:value={diff.emergencies} aria-label="Emergencies per hour" /><output>{diff.emergencies}/h</output></div>
            <label class="row"><span class="lab">Conflict prediction</span><input class="switch" type="checkbox" bind:checked={diff.conflictPrediction} /></label>
            <label class="row"><span class="lab">Wake rules</span><input class="switch" type="checkbox" bind:checked={diff.wake} /></label>
            <label class="row"><span class="lab">Departure gaps</span><input class="switch" type="checkbox" bind:checked={diff.depGaps} /></label>
            <label class="row"><span class="lab">Pause allowed</span><input class="switch" type="checkbox" bind:checked={diff.pause} /></label>
          </div>
        {/if}
        <h3>Weather</h3>
        <div class="chips">{#each [['real', isMadeUp(dayId) ? 'Typical' : 'As it was'], ['calm', 'Calm'], ['east', 'Easterly'], ['rain', 'Rain and gusts'], ['storm', 'Thunderstorms'], ['fog', 'Fog']] as [k, n]}<button class:on={weather === k} onclick={() => (weather = k as typeof weather)}>{n}</button>{/each}</div>
      </section>
    </div>
  </div>

  <footer class="go">
    <div class="sum">
      <b>{AIRPORTS.find(a => a.icao === airport)?.name}{extraAirports.length ? ` + ${extraAirports.length} more` : ''}</b>
      <span>{seats.map(s => SEATS.find(x => x.role === s)?.name).join(' + ') || 'Pick at least one position'} · {String(hour).padStart(2, '0')}:00{mode !== 'endless' ? ` · ${minutes} min` : ''} · {diffName}</span>
    </div>
    <label class="seedf">Seed <input class="seed" bind:value={seed} aria-label="Seed" /></label>
    <button class="start" disabled={!seats.length} onclick={go}>Start shift</button>
  </footer>
</div>

<style>
  .setup { height: 100vh; box-sizing: border-box; display: flex; flex-direction: column; background: var(--screen-bg); font: 14px var(--ui); color: var(--ink); }
  header { display: flex; align-items: center; gap: 14px; padding: 22px clamp(16px, 4vw, 56px) 14px; }
  h1 { margin: 0; font: 600 26px var(--ui); color: var(--ink-strong); }
  .sub { margin: 2px 0 0; color: var(--muted); font-size: 14px; }
  button { font-family: var(--ui); cursor: pointer; border: none; color: inherit; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  .back { width: 40px; height: 40px; flex-shrink: 0; border-radius: 50%; display: grid; place-items: center; background: var(--glass); box-shadow: var(--lift); color: var(--ink-strong); }
  .back:hover { color: var(--green); }

  .grid { flex: 1; min-height: 0; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 16px; padding: 4px clamp(16px, 4vw, 56px) 16px; max-width: 1280px; scrollbar-width: thin; }
  .col { display: flex; flex-direction: column; gap: 16px; }
  section { border-radius: 16px; background: var(--glass); backdrop-filter: blur(14px); box-shadow: var(--lift), inset 0 0 0 1px var(--glass-line); padding: 14px 18px 16px; }
  h2 { margin: 0 0 10px; font: 600 16px var(--ui); color: var(--ink-strong); }
  h3 { margin: 14px 0 8px; font: 500 13px var(--ui); color: var(--muted); }

  .apts { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
  .apt { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; padding: 10px 12px; border-radius: 12px; background: var(--knob); box-shadow: inset 0 0 0 1px var(--glass-line); }
  .apt:hover { box-shadow: inset 0 0 0 1px rgba(108, 183, 255, 0.5); }
  .apt.on { background: rgba(62, 230, 168, 0.12); box-shadow: inset 0 0 0 2px var(--green); }
  .apt .code { font: 600 11px var(--mono); color: var(--accent); }
  .apt b { font: 600 15px var(--ui); color: var(--ink-strong); }
  .apt .what { font: 400 12px/1.3 var(--ui); color: var(--muted); }

  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chips button { padding: 6px 12px; border-radius: 999px; background: var(--knob); box-shadow: inset 0 0 0 1px var(--glass-line); font: 500 13px var(--ui); color: var(--ink); }
  .chips button:hover { color: var(--ink-strong); box-shadow: inset 0 0 0 1px rgba(108, 183, 255, 0.5); }
  .chips button.on { background: var(--green); color: var(--bg); box-shadow: none; font-weight: 600; }

  .days { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
  .day { display: flex; flex-direction: column; gap: 1px; text-align: left; padding: 9px 12px; border-radius: 12px; background: var(--knob); box-shadow: inset 0 0 0 1px var(--glass-line); }
  .day b { font: 600 14px var(--ui); color: var(--ink-strong); }
  .day span { font: 400 12.5px var(--ui); color: var(--muted); }
  .day:hover { box-shadow: inset 0 0 0 1px rgba(108, 183, 255, 0.5); }
  .day.on { background: rgba(62, 230, 168, 0.12); box-shadow: inset 0 0 0 2px var(--green); }
  .day.made b::before { content: '✦ '; color: var(--amber); }

  .row { display: flex; align-items: center; gap: 12px; padding: 8px 0; }
  .lab { min-width: 92px; font: 500 14px var(--ui); color: var(--ink-strong); }
  .row input[type=range] { flex: 1; accent-color: var(--green); }
  output { min-width: 86px; text-align: right; font: 600 13px var(--mono); color: var(--ink-strong); }
  .seg { display: flex; flex-wrap: wrap; background: var(--knob); border-radius: 999px; padding: 3px; gap: 2px; }
  .seg button { padding: 6px 12px; border-radius: 999px; background: transparent; font: 600 13px var(--ui); color: var(--ink); }
  .seg button.on { background: var(--green); color: var(--bg); }
  .link { margin-left: auto; background: none; color: var(--accent); font: 500 13px var(--ui); }
  .dials { margin-top: 4px; padding: 4px 12px; border-radius: 12px; background: rgba(0, 0, 0, 0.15); }
  .dials label.row { justify-content: space-between; cursor: pointer; }

  .seats { display: flex; flex-direction: column; margin: 10px 0 6px; }
  .seat { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 0; border-top: 1px solid var(--glass-line); cursor: pointer; }
  .seat:first-child { border-top: none; }
  .seat div { display: flex; flex-direction: column; }
  .seat b { font: 500 15px var(--ui); color: var(--ink-strong); }
  .seat span { font: 400 12.5px var(--ui); color: var(--muted); }
  .switch { appearance: none; flex-shrink: 0; width: 44px; height: 26px; border-radius: 13px; background: rgba(255, 255, 255, 0.14); position: relative; cursor: pointer; transition: background 0.15s; margin: 0; }
  .switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4); transition: transform 0.15s; }
  .switch:checked { background: var(--green); }
  .switch:checked::after { transform: translateX(18px); }
  .note { margin: 6px 0 0; color: var(--muted); font-size: 12.5px; }

  .go { display: flex; align-items: center; gap: 18px; padding: 14px clamp(16px, 4vw, 56px); background: rgba(8, 16, 30, 0.85); backdrop-filter: blur(14px); box-shadow: 0 -1px 0 var(--glass-line), 0 -10px 30px rgba(0, 0, 0, 0.3); }
  .sum { display: flex; flex-direction: column; min-width: 0; }
  .sum b { font: 600 16px var(--ui); color: var(--ink-strong); }
  .sum span { font: 400 13px var(--ui); color: var(--muted); text-transform: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .seedf { margin-left: auto; display: flex; align-items: center; gap: 8px; font: 500 12px var(--ui); color: var(--muted); }
  .seed { width: 90px; background: var(--knob); color: var(--ink-strong); border: 1px solid var(--glass-line); border-radius: 8px; font: 13px var(--mono); padding: 6px 8px; }
  .start { padding: 12px 30px; border-radius: 999px; background: var(--green); color: var(--bg); font: 700 16px var(--ui); box-shadow: 0 8px 24px rgba(62, 230, 168, 0.3); }
  .start:hover { filter: brightness(1.08); }
  .start:disabled { opacity: 0.4; cursor: default; box-shadow: none; }
  @media (max-width: 700px) { .seedf { display: none; } .go { gap: 10px; } .start { padding: 11px 20px; } }
</style>
