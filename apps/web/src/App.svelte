<script lang="ts">
  import { debrief, depGap, SHIFT_S, SHIFT_START_S, TICK_HZ, validVerbs, type Aircraft, type State, type Verb } from '@squawk/sim';
  import { text } from '@squawk/phraseology';
  import { blend, draw, toScreen, type View } from './scope';

  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let snap: State | null = $state.raw(null);
  let prev: State | null = null, prevAt = 0, curAt = 0;
  let selected: string | null = $state(null);
  let speed = $state(1);
  let canvas: HTMLCanvasElement;
  let logEl: HTMLDivElement;
  const view: View = { cx: 4500, cy: -500, scale: 0.07 };

  worker.onmessage = (e: MessageEvent<State>) => {
    if (snap && e.data.tick !== snap.tick) { prev = snap; prevAt = curAt; }
    snap = e.data;
    curAt = performance.now();
  };
  function start() {
    prev = null; selected = null;
    worker.postMessage({ t: 'start', seed: (Math.random() * 2 ** 31) | 0 });
    setSpeed(1);
  }
  function setSpeed(v: number) { speed = v; worker.postMessage({ t: 'speed', v }); }
  function cmd(callsign: string, verb: Verb) { worker.postMessage({ t: 'cmd', cmd: { callsign, verb } }); }
  start();

  const LABEL: Record<Verb, string> = { luw: 'Line up', cto: 'Take-off', land: 'Land', goaround: 'Go around' };
  const clock = (tick: number) => {
    const s = SHIFT_START_S + Math.floor(tick / TICK_HZ);
    return [s / 3600, (s / 60) % 60, s % 60].map(n => String(Math.floor(n)).padStart(2, '0')).join(':');
  };
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  const arrivals = $derived(snap ? snap.aircraft.filter(a => a.kind === 'arr' && a.phase === 'final').sort((a, b) => b.s - a.s) : []);
  const departures = $derived(snap ? snap.aircraft.filter(a => ['holding', 'lining', 'lined', 'rolling'].includes(a.phase)) : []);
  const strips = $derived([...arrivals, ...departures]);
  const log = $derived(snap ? [
    ...snap.radio.map(r => ({ tick: r.tick, who: r.from === 'atc' ? 'TWR' : r.callsign, cls: r.auto ? 'auto' : r.from, text: text(r) })),
    ...snap.alerts.map(a => ({ tick: a.tick, who: '!!', cls: a.level, text: a.text })),
  ].sort((a, b) => a.tick - b.tick).slice(-150) : []);
  const result = $derived(snap?.ended ? debrief(snap) : null);

  function status(ac: Aircraft) {
    if (ac.kind === 'arr') return `${(-ac.s / 1852).toFixed(1)} nm${ac.ga ? ' · GA' : ac.cleared ? ' · cleared' : ''}`;
    const wait = (snap!.tick - ac.ready) / TICK_HZ;
    if (ac.phase === 'rolling') return 'rolling';
    const gap = depGap(snap!, ac);
    return `${ac.phase} ${mmss(wait)} · gap ${gap === Infinity ? 'roll' : gap === 0 ? 'OK' : mmss(gap)}`;
  }

  $effect(() => { log.length; logEl?.scrollTo(0, logEl.scrollHeight); });

  $effect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!snap || !canvas) return;
      const r = canvas.getBoundingClientRect();
      if (canvas.width !== Math.round(r.width) || canvas.height !== Math.round(r.height)) { canvas.width = r.width; canvas.height = r.height; }
      const a = curAt > prevAt ? Math.min(1, (performance.now() - curAt) / (curAt - prevAt)) : 1;
      draw(canvas.getContext('2d')!, view, snap, blend(prev, snap, a), selected);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  });

  let drag: { x: number; y: number; moved: boolean } | null = null;
  function down(e: PointerEvent) { drag = { x: e.clientX, y: e.clientY, moved: false }; }
  function moveP(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.moved) { view.cx -= dx / view.scale; view.cy += dy / view.scale; drag.x = e.clientX; drag.y = e.clientY; }
  }
  function up(e: PointerEvent) {
    if (drag && !drag.moved && snap) {
      const r = canvas.getBoundingClientRect();
      let best: string | null = null, bd = 20;
      for (const ac of snap.aircraft) {
        const [x, y] = toScreen(view, canvas.width, canvas.height, ac.x, ac.y);
        const d = Math.hypot(x - (e.clientX - r.left), y - (e.clientY - r.top));
        if (d < bd) { bd = d; best = ac.callsign; }
      }
      selected = best;
    }
    drag = null;
  }
  function wheel(e: WheelEvent) {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left - canvas.width / 2, my = e.clientY - r.top - canvas.height / 2;
    const k = Math.exp(-e.deltaY * 0.0015);
    view.cx += mx / view.scale - mx / (view.scale * k);
    view.cy -= my / view.scale - my / (view.scale * k);
    view.scale = Math.min(2, Math.max(0.01, view.scale * k));
  }

  function key(e: KeyboardEvent) {
    if (!snap) return;
    if (e.key === ' ') { e.preventDefault(); setSpeed(speed ? 0 : 1); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      const i = strips.findIndex(a => a.callsign === selected);
      selected = strips.length ? strips[(i + (e.shiftKey ? -1 : 1) + strips.length) % strips.length].callsign : null;
      return;
    }
    const ac = snap.aircraft.find(a => a.callsign === selected);
    if (!ac) return;
    const verbs = validVerbs(ac);
    const want: Verb[] = { l: ['land', 'luw'], t: ['cto'], g: ['goaround'] }[e.key.toLowerCase()] as Verb[] ?? [];
    const v = want.find(v => verbs.includes(v));
    if (v) cmd(ac.callsign, v);
  }
</script>

<svelte:window onkeydown={key} />

<div class="app">
  <header>
    <b>SQUAWK</b>
    <span class="freq">TWR 118.505</span>
    {#if snap}
      <span>{clock(snap.tick)}</span>
      <span>ARR {snap.arrRwy} · DEP {snap.depRwy}</span>
      <span>Wind {String(snap.wind.dir).padStart(3, '0')}/{snap.wind.kt}</span>
      <span>Left {mmss(Math.max(0, SHIFT_S - snap.tick / TICK_HZ))}</span>
      <span>Moves {snap.stats.landed + snap.stats.departed}</span>
    {/if}
    <span class="speed">
      {#each [0, 1, 2, 4] as v}
        <button class:on={speed === v} onclick={() => setSpeed(v)}>{v ? `${v}×` : '❚❚'}</button>
      {/each}
    </span>
  </header>

  <aside>
    {#each strips as ac (ac.callsign)}
      <div class="strip {ac.kind}" class:sel={ac.callsign === selected} onclick={() => (selected = ac.callsign)} role="button" tabindex="-1" onkeydown={() => {}}>
        <div><b>{ac.callsign}</b> {ac.type}/{ac.wake} {ac.sid ?? ''}</div>
        <div class="st">{status(ac)}</div>
        <div class="btns">
          {#each validVerbs(ac) as v}
            <button onclick={(e) => { e.stopPropagation(); cmd(ac.callsign, v); }}>{LABEL[v]}</button>
          {/each}
        </div>
      </div>
    {/each}
    <p class="help">Click an aircraft or strip · Tab cycles · L land / line up · T take-off · G go around · Space pause · drag to pan, wheel to zoom</p>
  </aside>

  <main>
    <canvas bind:this={canvas} onpointerdown={down} onpointermove={moveP} onpointerup={up} onwheel={wheel}></canvas>
  </main>

  <footer bind:this={logEl}>
    {#each log as l}
      <div class={l.cls}><span class="t">{clock(l.tick)}</span> <span class="who">{l.who}</span> {l.text}</div>
    {/each}
  </footer>

  {#if result}
    <div class="debrief">
      <h2>{snap?.ended === 'collision' ? 'Incident: shift ended' : 'Shift complete'} — grade {result.grade}</h2>
      <table>
        <tbody>
          <tr><td>Score</td><td>{result.score}</td></tr>
          <tr><td>Landings / departures</td><td>{result.landed} / {result.departed}</td></tr>
          <tr><td>Go-arounds (no clearance)</td><td>{result.goArounds} ({result.pilotGoArounds})</td></tr>
          <tr><td>Runway separation losses</td><td>{result.sepLoss}</td></tr>
          <tr><td>Departure gap infringements</td><td>{result.wakeInf}</td></tr>
          <tr><td>Clearances onto an occupied runway</td><td>{result.clrOccupied}</td></tr>
          <tr><td>Departure delay</td><td>{mmss(result.depDelayS)}</td></tr>
          <tr><td>Safety multiplier</td><td>×{result.safety.toFixed(2)}</td></tr>
        </tbody>
      </table>
      <button onclick={start}>New shift</button>
    </div>
  {/if}
</div>

<style>
  :global(body) { margin: 0; background: #0b1426; color: #c8d6e8; font: 13px ui-monospace, Consolas, monospace; }
  .app { display: grid; grid-template: 'h h' auto 'a m' 1fr 'a f' 200px / 300px 1fr; height: 100vh; }
  header { grid-area: h; display: flex; gap: 18px; align-items: center; padding: 6px 12px; background: #101c33; border-bottom: 1px solid #24324d; }
  .freq { color: #4ff0b4; }
  .speed { margin-left: auto; display: flex; gap: 4px; }
  button { background: #1a2947; color: #c8d6e8; border: 1px solid #2f4268; font: inherit; padding: 3px 8px; cursor: pointer; }
  button:hover { border-color: #4ff0b4; }
  button.on { background: #4ff0b4; color: #0b1426; }
  aside { grid-area: a; overflow-y: auto; padding: 6px; background: #0e1830; border-right: 1px solid #24324d; }
  .strip { padding: 6px 8px; margin-bottom: 6px; background: #13213d; border-left: 4px solid #4ff0b4; cursor: pointer; }
  .strip.dep { border-left-color: #6aa6ff; }
  .strip.sel { outline: 1px solid #fff; }
  .st { color: #8fa3bf; margin: 2px 0 4px; }
  .btns { display: flex; gap: 4px; flex-wrap: wrap; }
  .help { color: #5d6f8c; font-size: 11px; }
  main { grid-area: m; position: relative; min-height: 0; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; }
  footer { grid-area: f; overflow-y: auto; padding: 6px 12px; background: #0e1830; border-top: 1px solid #24324d; }
  footer .t { color: #5d6f8c; }
  footer .who { display: inline-block; width: 7ch; color: #8fa3bf; }
  footer .atc { color: #4ff0b4; }
  footer .auto { color: #3f8f75; }
  footer .caution { color: #ffb020; }
  footer .conflict { color: #ff4d4d; font-weight: bold; }
  .debrief { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #101c33; border: 1px solid #4ff0b4; padding: 16px 24px; }
  .debrief td { padding: 2px 12px 2px 0; }
</style>
