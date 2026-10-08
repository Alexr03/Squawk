<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { parseSpeech, type ParseCtx } from '@squawk/phraseology';
  import { find, seatRole, viaNames, type Command, type State } from '@squawk/sim';
  import type { ShiftClient, Snap } from './client.ts';
  import Scope from './Scope.svelte';
  import StripBay from './StripBay.svelte';
  import Comms from './Comms.svelte';
  import TopBar from './TopBar.svelte';
  import AircraftCard from './AircraftCard.svelte';
  import RadialMenu from './RadialMenu.svelte';
  import { radialFor, type RadialItem } from './radial.ts';
  import { needs, workload } from './needs.ts';
  import { Sound } from './sound.ts';
  import { settings, saveSettings } from '../lib/settings.svelte.ts';
  import { createVoiceInput, type VoiceInput } from '../audio/voice.ts';

  interface Props {
    client: ShiftClient; title: string; canPause: boolean;
    /** Extra controls in the pause menu (co-op seats). */
    menuExtra?: Snippet;
    coach?: (snap: Snap, selected: string | null) => string | null;
    onEnd: (st: State) => void; onQuit: () => void;
  }
  let { client, title, canPause, coach, onEnd, onQuit, menuExtra }: Props = $props();

  let snap = $state.raw<Snap | null>(null);
  let selected = $state<string | null>(null);
  let filter = $state<string | null>(null);
  let radial = $state<{ cs: string; x: number; y: number } | null>(null);
  let taxiEdit = $state<{ cs: string; to: string; greens?: boolean; via: number[] } | null>(null);
  let overlays = $state({ sids: false, stars: false, weather: true });
  let speed = $state(1);
  let paused = $state(false);
  let menuOpen = $state(false);
  let toasts = $state<{ id: number; text: string; level: string }[]>([]);
  let viewRequest = $state<{ cx: number; cy: number; mpp: number; t: number } | null>(null);
  let cmdInput = $state<HTMLInputElement>();
  let voice = $state({ on: settings.voiceInput, state: 'idle', listening: false });
  let pendingVoice = $state<{ text: string; cmds: Command[]; notes: string[] } | null>(null);
  let scope: Scope;
  const world = client.world;
  const sound = new Sound();
  let toastId = 0;

  const queue = $derived(snap ? needs(world, snap) : []);
  const load = $derived(snap ? workload(snap, queue) : 0);
  const selAc = $derived(snap && selected ? find(snap, selected) ?? null : null);
  const actions = $derived(snap && selAc && snap.coverage.includes(selAc.freq) ? radialFor(world, snap, selAc.cs) : []);
  const coachText = $derived(snap && coach ? coach(snap, selected) : null);

  onMount(() => {
    client.onSnap = s => {
      // The UI sees this player's seats as the coverage (in co-op the sim covers everyone's).
      s = { ...s, coverage: client.seats };
      snap = s;
      sound.update(world, s);
      if (selected && !find(s, selected)) selected = null;
      // Auto-slow when the queue gets long.
      if (settings.autoSlow && !paused) {
        const urgent = needs(world, s).filter(n => n.level !== 'routine').length;
        const want = urgent >= 5 ? 0.5 : speed;
        if (client.speed !== want && speed >= 1) client.setSpeed(want);
      }
    };
    client.onFinal = st => { sound.stop(); onEnd(st); };
    client.onNote = m => toast(m);
    client.onError = m => toast(`Sim error: ${m.split('\n')[0]}`, 'conflict');
    if (client.snap) snap = { ...client.snap, coverage: client.seats };
    return () => { sound.stop(); voiceInput?.dispose(); };
  });

  function toast(text: string, level = 'info') {
    const id = ++toastId;
    toasts = [...toasts.slice(-3), { id, text, level }];
    setTimeout(() => (toasts = toasts.filter(t => t.id !== id)), 4200);
  }
  async function send(cmds: Command[], opts: { voice?: boolean } = {}): Promise<string | null> {
    sound.unlock();
    const err = await client.issue(cmds, opts);
    if (err) toast(err, 'caution');
    return err;
  }
  function pick(it: RadialItem) {
    radial = null;
    if (it.taxi && selected) { taxiEdit = { cs: selected, to: it.taxi.to, greens: it.taxi.greens, via: [] }; return; }
    if (it.cmd) send(it.cmd);
  }
  function taxiDone(commit: boolean) {
    const te = taxiEdit;
    taxiEdit = null;
    if (!commit || !te) return;
    const path = scope.currentTaxiPath();
    const apt = world.primary;
    const via = path ? viaNames(apt, path) : [];
    send([te.greens ? { cs: te.cs, verb: 'greens', to: te.to, nodes: path ?? undefined } : { cs: te.cs, verb: 'taxi', to: te.to, via, nodes: path ?? undefined }]);
  }
  function setSpeed(v: number) {
    if (!client.canSetSpeed) { toast('The host runs the clock'); return; }
    speed = v; paused = v === 0;
    client.setSpeed(v);
  }
  function jump(seat: string) {
    const role = seatRole(seat);
    const icao = seat === 'LON' ? world.primary.icao : seat.split(':')[0];
    const apt = world.byIcao[icao];
    const c = apt.offset;
    const v = { DEL: { mpp: 1.1, dx: -900, dy: -700 }, GND: { mpp: 1.4, dx: -400, dy: -700 }, TWR: { mpp: 2.6, dx: 400, dy: -700 }, DIR: { mpp: 70, dx: 0, dy: 0 }, LON: { mpp: 260, dx: 0, dy: 0 } }[role];
    viewRequest = { cx: c.x + v.dx, cy: c.y + v.dy, mpp: v.mpp, t: performance.now() };
  }

  // ---------------------------------------------------------------- keyboard
  function key(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    sound.unlock();
    if (settings.voiceInput && e.code === settings.pttKey) { e.preventDefault(); if (!e.repeat) pttDown(); return; }
    if (radial) return; // the menu handles its own keys
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') { if (taxiEdit) taxiDone(false); else if (selected) selected = null; else menuOpen = !menuOpen; return; }
    if (e.key === 'Enter' && taxiEdit) { taxiDone(true); return; }
    if (e.key === 'Enter' || e.key === '/') { e.preventDefault(); cmdInput?.focus(); return; }
    if (k === 'p' && canPause) { setSpeed(speed === 0 ? 1 : 0); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      const mine = snap ? snap.aircraft.filter(a => snap!.coverage.includes(a.owner)).map(a => a.cs) : [];
      const order = [...new Set([...queue.map(n => n.cs), ...mine])];
      if (!order.length) return;
      const i = order.indexOf(selected ?? '');
      selected = order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length];
      return;
    }
    if (k === 'n' && !selected?.length && queue[0]) { selected = queue[0].cs; return; }
    if (e.code.startsWith('Digit') && !selected) {
      const role = ['DEL', 'GND', 'TWR', 'DIR', 'LON'][+e.key - 1];
      const seat = snap?.coverage.find(s => seatRole(s) === role) ?? (role ? (role === 'LON' ? 'LON' : `${world.primary.icao}:${role}`) : null);
      if (seat) jump(seat);
      return;
    }
    if (k === 'o') { overlays = { ...overlays, sids: !overlays.sids, stars: !overlays.stars }; return; }
    if (k === 'w') { overlays = { ...overlays, weather: !overlays.weather }; return; }
    if (!selected || !actions.length) return;
    // Single-key instructions for the selected aircraft (open the value ring when one is needed).
    const hit = actions.find(a => a.hint?.toLowerCase() === k);
    if (hit) {
      e.preventDefault();
      if (hit.cmd || hit.taxi) pick(hit);
      else if (hit.sub) radial = { cs: selected, x: innerWidth / 2, y: innerHeight / 2 };
    } else if (k === 'n' && queue[0]) selected = queue.find(q => q.cs !== selected)?.cs ?? selected;
  }
  function keyup(e: KeyboardEvent) {
    if (settings.voiceInput && e.code === settings.pttKey) { e.preventDefault(); pttUp(); }
  }

  // ---------------------------------------------------------------- voice
  let voiceInput: VoiceInput | null = null;
  function ensureVoice() {
    if (voiceInput) return voiceInput;
    voiceInput = createVoiceInput({
      prefer: settings.voiceBackend,
      onState: (s, d) => { voice = { ...voice, state: s + (d ? `: ${d}` : ''), listening: s === 'listening' }; if (s === 'error') toast(`Voice: ${d}`, 'caution'); },
      onFinal: (text, conf) => heard(text, conf),
    });
    return voiceInput;
  }
  function pttDown() { ensureVoice().start(); }
  function pttUp() { voiceInput?.stop(); }
  function speechCtx(): ParseCtx {
    const apt = world.primary;
    const mine = snap!.aircraft.filter(a => snap!.coverage.includes(a.freq));
    const fixNames: Record<string, string> = {};
    for (const f of Object.values(apt.fixes)) if (f.spoken) fixNames[f.name] = f.spoken;
    const as = snap!.apts[0];
    return { callsigns: mine.map(a => a.cs), selected: selected ?? undefined, fixes: Object.keys(apt.fixes), runways: [...new Set([...as.arr, ...as.dep])],
      holds: apt.nodes.filter(n => n.hold).map(n => n.hold!), stands: apt.stands.map(s => s.ref), taxiways: [...new Set(apt.edges.map(e => e.name).filter(Boolean))], fixNames,
      sids: apt.pack.airspace.sids.map(s => s.name + s.designator) };
  }
  function heard(text: string, conf: number) {
    if (!text.trim() || !snap) return;
    const r = parseSpeech(text, speechCtx());
    if (!r) { toast(`"${text}" — station calling, say again`, 'caution'); return; }
    if (r.notes.length) toast(`RT: ${r.notes[0]}`, 'info');
    if (r.confidence * Math.max(0.6, conf) >= 0.6) send(r.cmds, { voice: true });
    else pendingVoice = { text, cmds: r.cmds, notes: r.notes };
  }
  $effect(() => { voice.on = settings.voiceInput; });
</script>

<svelte:window onkeydown={key} onkeyup={keyup} onpointerdown={() => sound.unlock()} />

{#if snap}
  <div class="game" style="--scale:{settings.uiScale}">
    <TopBar {world} {snap} time={snap.start + snap.tick / 4} {queue} {load} {filter} {speed} {canPause} {title} {voice}
      onFilter={(s) => (filter = s)} onSpeed={setSpeed} onMenu={() => (menuOpen = true)} onJump={jump} />
    <div class="mid">
      <StripBay {world} {snap} {selected} {filter} {queue} onSelect={(cs) => (selected = cs)}
        onHandoff={(cs) => { const a = find(snap!, cs); const it = a && radialFor(world, snap!, cs).find(i => i.label.startsWith('Contact')); if (it?.cmd) send(it.cmd); }} />
      <div class="scopewrap">
        <Scope bind:this={scope} {client} {selected} bind:taxiEdit {overlays} {viewRequest}
          onSelect={(cs) => (selected = cs)} onRadial={(cs, x, y) => (radial = { cs, x, y })} onIssue={(c) => send(c)} onTaxiDone={taxiDone} />
        {#if queue.length}
          <div class="queue">
            <h4>Needs you <span>N</span></h4>
            {#each queue.slice(0, 7) as n (n.cs)}
              <button class={n.level} class:sel={n.cs === selected} onclick={() => (selected = n.cs)}><b>{n.cs}</b> {n.text}</button>
            {/each}
          </div>
        {/if}
        {#if coachText}<div class="coach">{coachText}</div>{/if}
        {#if pendingVoice}
          <div class="confirm">
            <div>Heard: “{pendingVoice.text}”</div>
            <div class="row"><button onclick={() => { send(pendingVoice!.cmds, { voice: true }); pendingVoice = null; }}>Send</button><button onclick={() => (pendingVoice = null)}>Discard</button></div>
          </div>
        {/if}
        <div class="toasts">{#each toasts as t (t.id)}<div class="toast {t.level}">{t.text}</div>{/each}</div>
        {#if paused}<div class="pausebadge">PAUSED — P to resume</div>{/if}
      </div>
      {#if selAc}
        <AircraftCard {world} {snap} ac={selAc} {actions} onPick={(it) => (it.sub && !it.cmd && !it.taxi ? (radial = { cs: selAc!.cs, x: innerWidth - 300, y: innerHeight / 2 }) : pick(it))} onClose={() => (selected = null)} />
      {/if}
    </div>
    <div class="bottom">
      <Comms {world} snap={client.monitor ? { ...snap, coverage: client.cfg.coverage } : snap} {selected} {filter} onSend={(c) => send(c)} onSelect={(cs) => (selected = cs)} bind:inputEl={cmdInput} />
    </div>
  </div>
  {#if radial && snap}
    <RadialMenu x={radial.x} y={radial.y} cs={radial.cs} items={radialFor(world, snap, radial.cs)} onPick={pick} onClose={() => (radial = null)} />
  {/if}
  {#if menuOpen}
    <div class="modal" role="dialog" aria-label="Pause menu">
      <div class="box">
        <h2>{title}</h2>
        <button onclick={() => (menuOpen = false)}>Resume</button>
        <label>Pilot voices <input type="checkbox" bind:checked={settings.pilotVoices} onchange={() => { saveSettings(); sound.apply(); }} /></label>
        <label>Volume <input type="range" min="0" max="1" step="0.05" bind:value={settings.master} oninput={() => { saveSettings(); sound.apply(); }} /></label>
        <label>Auto-slow when busy <input type="checkbox" bind:checked={settings.autoSlow} onchange={saveSettings} /></label>
        <label>Push-to-talk voice <input type="checkbox" bind:checked={settings.voiceInput} onchange={saveSettings} /></label>
        {@render menuExtra?.()}
        <div class="keys">Keys: Tab next aircraft · N most urgent · L/T/G/C/X/K/H/A/S/D/I instructions · Enter command line · right-click radial menu · drag a radar blip to vector · 1–5 views · O routes · W weather · P pause</div>
        <button class="quit" onclick={onQuit}>End shift</button>
      </div>
    </div>
  {/if}
{:else}
  <div class="loading">Opening the frequency…</div>
{/if}

<style>
  .game { display: grid; grid-template-rows: 44px 1fr minmax(150px, 24vh); height: 100vh; background: var(--bg); color: var(--ink); zoom: var(--scale); }
  .mid { display: grid; grid-template-columns: minmax(250px, 300px) 1fr auto; min-height: 0; }
  .scopewrap { position: relative; min-width: 0; min-height: 0; }
  .bottom { min-height: 0; }
  .queue { position: absolute; top: 8px; right: 8px; z-index: 5; width: 250px; background: rgba(13, 22, 40, 0.88); border: 1px solid var(--line); padding: 6px; }
  .queue h4 { margin: 0 0 4px; font: 11px Silkscreen, var(--mono); color: var(--muted); display: flex; justify-content: space-between; }
  .queue h4 span { color: var(--dim); }
  .queue button { display: block; width: 100%; text-align: left; background: none; border: none; border-left: 3px solid var(--dim); color: var(--ink); font: 16px VT323, var(--mono); padding: 1px 6px; cursor: pointer; }
  .queue button b { font-weight: 400; color: var(--ink-strong); margin-right: 4px; }
  .queue button.urgent { border-left-color: var(--amber); }
  .queue button.emergency { border-left-color: var(--red); color: var(--red); }
  .queue button.sel { background: var(--sel-bg); }
  .coach { position: absolute; left: 12px; top: 12px; z-index: 6; max-width: 420px; background: rgba(13, 22, 40, 0.94); border: 1px solid var(--green); color: var(--ink-strong); padding: 10px 12px; font: 18px/1.2 VT323, var(--mono); }
  .confirm { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 7; background: var(--panel-2); border: 1px solid var(--amber); padding: 8px 12px; font: 17px VT323, var(--mono); }
  .confirm .row { display: flex; gap: 6px; margin-top: 6px; }
  .confirm button, .box button { background: var(--btn); border: 1px solid var(--line-strong); color: var(--ink-strong); font: 17px VT323, var(--mono); padding: 4px 12px; cursor: pointer; }
  .toasts { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); z-index: 8; display: flex; flex-direction: column; gap: 4px; align-items: center; pointer-events: none; }
  .toast { background: rgba(13, 22, 40, 0.94); border: 1px solid var(--line-strong); padding: 4px 12px; font: 17px VT323, var(--mono); color: var(--ink-strong); }
  .toast.caution { border-color: var(--amber); color: var(--amber); }
  .toast.conflict { border-color: var(--red); color: var(--red); }
  .pausebadge { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 6; font: 14px Silkscreen, var(--mono); color: var(--amber); background: rgba(13, 22, 40, 0.9); padding: 6px 12px; border: 1px solid var(--amber); }
  .modal { position: fixed; inset: 0; z-index: 60; background: rgba(5, 10, 20, 0.7); display: flex; align-items: center; justify-content: center; }
  .box { width: min(480px, 92vw); background: var(--panel-2); border: 1px solid var(--line-strong); padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; font: 18px VT323, var(--mono); }
  .box h2 { margin: 0 0 6px; font: 14px Silkscreen, var(--mono); color: var(--green); }
  .box label { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  .box .keys { color: var(--muted); font-size: 16px; }
  .box .quit { border-color: var(--red); color: var(--red); }
  .loading { height: 100vh; display: flex; align-items: center; justify-content: center; font: 16px Silkscreen, var(--mono); color: var(--green); background: var(--bg); }
</style>
