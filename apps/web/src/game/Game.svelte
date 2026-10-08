<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { callsign, parseSpeech, type ParseCtx } from '@squawk/phraseology';
  import { find, seatRole, viaNames, type Command, type State } from '@squawk/sim';
  import type { ShiftClient, Snap } from './client.ts';
  import Scope from './Scope.svelte';
  import StripBay from './StripBay.svelte';
  import Comms from './Comms.svelte';
  import TopBar from './TopBar.svelte';
  import AircraftCard from './AircraftCard.svelte';
  import RadialMenu from './RadialMenu.svelte';
  import Console from './Console.svelte';
  import Settings from '../screens/Settings.svelte';
  import { viewFor } from './views.ts';
  import { versionLabel } from '../lib/version.ts';
  import Loading, { type Brief } from '../screens/Loading.svelte';
  import { radialFor, type RadialItem } from './radial.ts';
  import { needs, workload } from './needs.ts';
  import { Sound } from './sound.ts';
  import { settings, saveSettings, dayClock } from '../lib/settings.svelte.ts';
  import { createVoiceInput, type VoiceInput } from '../audio/voice.ts';
  import Help from '../screens/Help.svelte';

  interface Props {
    client: ShiftClient; title: string; canPause: boolean;
    /** Shown while the first frame of the shift arrives. */
    brief?: Brief;
    /** Extra controls in the pause menu (co-op seats). */
    menuExtra?: Snippet;
    coach?: (snap: Snap, selected: string | null) => string | null;
    onEnd: (st: State) => void; onQuit: () => void;
  }
  let { client, title, canPause, coach, onEnd, onQuit, menuExtra, brief }: Props = $props();

  let snap = $state.raw<Snap | null>(null);
  let selected = $state<string | null>(null);
  let filter = $state<string | null>(null);
  let radial = $state<{ cs: string; x: number; y: number; items?: RadialItem[]; title?: string } | null>(null);
  let taxiEdit = $state<{ cs: string; to: string; greens?: boolean; via: number[] } | null>(null);
  let overlays = $state({ sids: false, stars: false, weather: true });
  let speed = $state(1);
  let paused = $state(false);
  let menuOpen = $state(false);
  let helpOpen = $state(false);
  let settingsOpen = $state(false);
  let stripsOpen = $state(innerWidth > 1000);
  let logOpen = $state(false);
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
      sound.music.setIntensity(workload(s, queue));
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
    if (err) toast(err, 'caution'); else sound.radio.chime('click');
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
    const v = viewFor(apt, role === 'DEL' ? 'GND' : role);
    viewRequest = { ...v, t: performance.now() };
  }

  /** Fly the camera to an aircraft: close in on the ground, radar view in the air. */
  // ---------------------------------------------------------------- camera: follow and auto
  let following = $state<string | null>(null);
  let autoCam = $state(false);
  let autoTarget: string | null = null, autoSince = 0, autoPauseUntil = 0, autoHome = false; // plain: the effect below writes them
  function toggleFollow(cs: string | null) {
    following = following === cs ? null : cs;
    if (following) { focus(following); toast(`Following ${following}`, 'info'); }
  }
  function toggleAuto() {
    autoCam = !autoCam; autoTarget = null; autoPauseUntil = 0; autoHome = false;
    if (!autoCam) following = null;
    toast(autoCam ? 'Auto camera on: it will show you whatever needs you' : 'Auto camera off', 'info');
  }
  function userCamera(how: 'pan' | 'zoom') {
    if (autoCam) { autoPauseUntil = performance.now() + 15000; if (how === 'pan') following = null; return; }
    if (how === 'pan' && following) following = null;
  }
  // Auto camera: go to the most pressing aircraft and follow it; stay a few seconds so you can act; home when it's quiet.
  $effect(() => {
    void snap?.tick;
    if (!autoCam || !snap) return;
    const now = performance.now();
    if (now < autoPauseUntil) return;
    const top = queue.find(n => n.level === 'emergency') ?? queue.find(n => n.level === 'urgent') ?? queue[0];
    const current = autoTarget ? queue.find(n => n.cs === autoTarget) : undefined;
    const outranked = current && top && top.cs !== current.cs && (top.level === 'emergency' || (top.level === 'urgent' && current.level === 'routine'));
    if (current && !outranked) return; // still needs you: stay on it
    if (autoTarget && now - autoSince < 3000) return; // just handled: let the player see it happen
    if (top) {
      autoTarget = top.cs; autoSince = now; autoHome = false;
      focus(top.cs); following = top.cs;
    } else if (!autoHome) {
      autoTarget = null; autoHome = true; following = null;
      const seat = client.seats[0]; if (seat) jump(seat);
    }
  });
  function focus(cs: string) {
    const a = snap && find(snap, cs);
    if (!a) return;
    const mpp = a.onGround ? 0.9 : a.alt < 3000 ? 12 : 40;
    viewRequest = { cx: a.x, cy: a.y, mpp, t: performance.now() };
  }

  // ---------------------------------------------------------------- keyboard
  function key(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    sound.unlock();
    if (settings.voiceInput && e.code === settings.pttKey) { e.preventDefault(); if (!e.repeat) pttDown(); return; }
    if (radial || settingsOpen) return; // the menu / settings handle their own keys
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') { if (taxiEdit) taxiDone(false); else if (selected) selected = null; else menuOpen = !menuOpen; return; }
    if (e.key === 'Enter' && taxiEdit) { taxiDone(true); return; }
    if (e.key === 'Enter' || e.key === '/') { e.preventDefault(); cmdInput?.focus(); return; }
    if (e.code === 'Space' && canPause) { e.preventDefault(); setSpeed(speed === 0 ? 1 : 0); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      const mine = snap ? snap.aircraft.filter(a => snap!.coverage.includes(a.owner)).map(a => a.cs) : [];
      const order = [...new Set([...queue.map(n => n.cs), ...mine])];
      if (!order.length) return;
      const i = order.indexOf(selected ?? '');
      selected = order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length];
      return;
    }
    if (k === 'n' && queue.length) { selected = queue.find(q => q.cs !== selected)?.cs ?? queue[0].cs; return; }
    // 1-5 set the speed (1x to 5x); Shift+1-5 jump the view to Delivery, Ground, Tower, Director, London.
    const digit = /^Digit[1-5]$/.test(e.code) ? +e.code.slice(5) : 0;
    if (digit && !e.shiftKey) { e.preventDefault(); setSpeed(digit); toast(`${digit}× speed`, 'info'); return; }
    if (digit && e.shiftKey) {
      const role = ['DEL', 'GND', 'TWR', 'DIR', 'LON'][digit - 1];
      const seat = snap?.coverage.find(s => seatRole(s) === role) ?? (role ? (role === 'LON' ? 'LON' : `${world.primary.icao}:${role}`) : null);
      if (seat) jump(seat);
      return;
    }
    if (k === 'v') { if (e.shiftKey) toggleAuto(); else if (selected) toggleFollow(selected); return; }
    if (k === 'o') { overlays = { ...overlays, sids: !overlays.sids, stars: !overlays.stars }; return; }
    if (k === 'w') { overlays = { ...overlays, weather: !overlays.weather }; return; }
    if (!selected || !actions.length) return;
    // Single-key instructions for the selected aircraft (open the value ring when one is needed).
    const hit = actions.find(a => a.hint?.toLowerCase() === k);
    if (hit) {
      e.preventDefault();
      if (hit.cmd || hit.taxi) pick(hit);
      else if (hit.sub) radial = { cs: selected, x: innerWidth / 2, y: innerHeight / 2, items: hit.sub(), title: hit.label };
    }
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
  <div class="game" class:radial-open={!!radial} style="--scale:{settings.uiScale}">
    <div class="world">
      <Scope bind:this={scope} {client} {selected} bind:taxiEdit {overlays} {viewRequest} follow={following} onUserCamera={userCamera}
        onSelect={(cs) => (selected = cs)} onRadial={(cs, x, y) => (radial = { cs, x, y })} onIssue={(c) => send(c)} onTaxiDone={taxiDone}
        {queue} onAction={(cs, a) => { selected = cs; if (a.cmds) send(a.cmds); else if (a.taxi) send([a.taxi.greens ? { cs, verb: 'greens', to: a.taxi.to } : { cs, verb: 'taxi', to: a.taxi.to, via: [] }]); }} />
    </div>

    <TopBar {world} {snap} time={dayClock(snap.start + snap.tick / 4, client.cfg.start)} {queue} {load} {filter} {speed} {canPause} {title} {voice}
      onFilter={(s) => (filter = s)} onSpeed={setSpeed} onMenu={() => (menuOpen = true)} onJump={jump} />

    {#if stripsOpen}
      <div class="drawer">
        <StripBay {world} {snap} {selected} {filter} {queue} onSelect={(cs) => { selected = cs; focus(cs); }}
          onHandoff={(cs) => { const a = find(snap!, cs); const it = a && radialFor(world, snap!, cs).find(i => i.label.startsWith('Contact')); if (it?.cmd) send(it.cmd); }} />
      </div>
    {/if}

    <div class="side">
      {#if queue.length}
        <div class="alerts" aria-label="Needs you">
          {#each queue.slice(0, 5) as n (n.cs)}
            <button class="alert {n.level}" class:sel={n.cs === selected} onclick={() => { selected = n.cs; focus(n.cs); }}>
              <span class="mark"></span><span class="who"><b>{n.cs}</b><small>{callsign(n.cs)}</small></span><span class="what">{n.text}</span>
            </button>
          {/each}
          {#if queue.length > 5}<div class="more">+{queue.length - 5} more · press N</div>{/if}
        </div>
      {/if}
      {#if selAc}
        <AircraftCard {world} {snap} ac={selAc} {actions} following={following === selAc.cs} onFollow={() => toggleFollow(selAc!.cs)} onPick={(it) => (it.sub && !it.cmd && !it.taxi ? (radial = { cs: selAc!.cs, x: innerWidth - 300, y: innerHeight / 2, items: it.sub(), title: it.label }) : pick(it))} onClose={() => (selected = null)} />
      {/if}
    </div>

    <div class="radio" class:open={logOpen}>
      <Comms {world} snap={client.monitor ? { ...snap, coverage: client.cfg.coverage } : snap} {selected} {filter} onSend={(c) => send(c)} onSelect={(cs) => (selected = cs)} bind:inputEl={cmdInput} />
    </div>

    <Console {world} {snap} {queue} {filter} {overlays} {stripsOpen} {logOpen} {autoCam} onAutoCam={toggleAuto}
      onSeat={(s) => { jump(s); }} onFilter={(s) => (filter = s)}
      onOverlay={(k) => (k === 'routes' ? (overlays = { ...overlays, sids: !overlays.sids, stars: !overlays.stars }) : (overlays = { ...overlays, weather: !overlays.weather }))}
      onStrips={() => (stripsOpen = !stripsOpen)} onLog={() => (logOpen = !logOpen)} onHelp={() => (helpOpen = true)} />

    {#if coachText}<div class="coach"><span class="who">Instructor</span>{coachText}</div>{/if}
    {#if pendingVoice}
      <div class="confirm">
        <div>Heard “{pendingVoice.text}”</div>
        <div class="row"><button class="go" onclick={() => { send(pendingVoice!.cmds, { voice: true }); pendingVoice = null; }}>Send</button><button onclick={() => (pendingVoice = null)}>Discard</button></div>
      </div>
    {/if}
    <div class="toasts">{#each toasts as t (t.id)}<div class="toast {t.level}">{t.text}</div>{/each}</div>
    {#if paused}<div class="pausebadge">Paused · Space resumes</div>{/if}
  </div>
  {#if radial && snap}
    <RadialMenu x={radial.x} y={radial.y} cs={radial.title ? `${radial.cs} · ${radial.title}` : radial.cs} items={radial.items ?? radialFor(world, snap, radial.cs)} onPick={pick} onClose={() => (radial = null)} />
  {/if}
  {#if menuOpen}
    <div class="modal" role="dialog" aria-label="Pause menu">
      <div class="box">
        <h2>{title}</h2>
        <button class="go" onclick={() => (menuOpen = false)}>Resume</button>
        <button onclick={() => (settingsOpen = true)}>Settings</button>
        {@render menuExtra?.()}
        <button onclick={() => (helpOpen = true)}>How to play</button>
        <button class="quit" onclick={onQuit}>End shift</button>
        <div class="ver">Squawk {versionLabel}</div>
      </div>
    </div>
  {/if}
{#if helpOpen}<Help onClose={() => (helpOpen = false)} />{/if}
{#if settingsOpen}<div class="settings-layer"><Settings onBack={() => { settingsOpen = false; sound.apply(); }} /></div>{/if}
{:else}
  {#if brief}<Loading {brief} step={2} />{:else}<div class="loading">Opening the frequency…</div>{/if}
{/if}

<style>
  .game { position: relative; height: 100vh; overflow: hidden; background: var(--bg); color: var(--ink); zoom: var(--scale); }
  .world { position: absolute; inset: 0; }
  .radial-open :global(.bubble) { display: none; }
  .drawer { position: absolute; left: 12px; top: 68px; max-height: calc(100% - 230px); display: flex; flex-direction: column; width: 290px; z-index: 8; border-radius: 14px; overflow: hidden; background: var(--glass); backdrop-filter: blur(14px) saturate(1.2); box-shadow: var(--lift); }
  .side { position: absolute; right: 12px; top: 74px; bottom: 90px; width: 300px; z-index: 8; display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
  .side > :global(*) { pointer-events: auto; }
  .alerts { display: flex; flex-direction: column; gap: 4px; }
  .alert { display: grid; grid-template-columns: 6px auto 1fr; gap: 9px; align-items: center; text-align: left; padding: 7px 12px 7px 8px; border: none; border-radius: 10px;
    background: var(--glass); backdrop-filter: blur(14px); box-shadow: var(--lift); color: var(--ink); cursor: pointer; font: 500 13px var(--ui); }
  .alert:hover, .alert.sel { background: var(--glass-hi); }
  .alert .mark { width: 6px; height: 28px; border-radius: 3px; background: var(--muted); }
  .alert.urgent .mark { background: var(--amber); }
  .alert.emergency .mark { background: var(--red); box-shadow: 0 0 10px var(--red); }
  .alert .who { display: flex; flex-direction: column; line-height: 1.15; }
  .alert b { font: 600 13px var(--mono); color: var(--ink-strong); }
  .alert small { font: 500 11px var(--ui); color: var(--muted); white-space: nowrap; }
  .alert .what { color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .alert.emergency .what { color: var(--red); }
  .more { font: 500 12px var(--ui); color: var(--muted); padding-left: 10px; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8); }
  .radio { position: absolute; left: 12px; bottom: 14px; width: min(560px, calc(50vw - 230px)); z-index: 9; border-radius: 14px; overflow: hidden; background: var(--glass); backdrop-filter: blur(14px) saturate(1.2); box-shadow: var(--lift); height: 132px; transition: height 0.2s; }
  .radio.open { height: min(46vh, 420px); }
  .coach { position: absolute; left: 50%; top: 64px; transform: translateX(-50%); z-index: 9; max-width: 560px; display: flex; flex-direction: column; gap: 3px; padding: 10px 16px; border-radius: 14px;
    background: var(--glass); backdrop-filter: blur(14px); box-shadow: var(--lift), inset 0 0 0 1px rgba(62, 230, 168, 0.35); color: var(--ink-strong); font: 500 14px/1.4 var(--ui); }
  .coach .who { font: 600 12px var(--ui); color: var(--green); }
  .confirm { position: absolute; left: 50%; bottom: 96px; transform: translateX(-50%); z-index: 11; padding: 10px 14px; border-radius: 14px; background: var(--glass); backdrop-filter: blur(14px); box-shadow: var(--lift), inset 0 0 0 1px rgba(255, 181, 71, 0.5); font: 500 14px var(--ui); }
  .confirm .row { display: flex; gap: 6px; margin-top: 8px; }
  .confirm button, .box button { border: none; border-radius: 10px; background: var(--knob); color: var(--ink-strong); font: 600 13px var(--ui); padding: 8px 14px; cursor: pointer; }
  .confirm button:hover, .box button:hover { background: var(--glass-hi); }
  button.go { background: var(--green); color: var(--bg); }
  button.go:hover { background: var(--green); filter: brightness(1.08); }
  .toasts { position: absolute; left: 50%; top: 120px; transform: translateX(-50%); z-index: 12; display: flex; flex-direction: column; gap: 6px; align-items: center; pointer-events: none; }
  .toast { padding: 7px 14px; border-radius: 999px; background: var(--glass); backdrop-filter: blur(14px); box-shadow: var(--lift); font: 500 13px var(--ui); color: var(--ink-strong); }
  .toast.caution { color: var(--amber); }
  .toast.conflict { color: var(--red); }
  .pausebadge { position: absolute; left: 50%; top: 64px; transform: translateX(-50%); z-index: 9; font: 600 14px var(--ui); color: var(--bg); background: var(--amber); padding: 6px 16px; border-radius: 999px; box-shadow: var(--lift); }
  .settings-layer { position: fixed; inset: 0; z-index: 70; }
  .modal { position: fixed; inset: 0; z-index: 60; background: rgba(5, 10, 20, 0.55); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; }
  .box { width: min(420px, 92vw); border-radius: 18px; background: var(--glass); backdrop-filter: blur(18px); box-shadow: var(--lift); padding: 20px 22px; display: flex; flex-direction: column; gap: 10px; font: 500 14px var(--ui); }
  .box h2 { margin: 0 0 6px; font: 600 17px var(--ui); color: var(--ink-strong); }
  .box label { display: flex; justify-content: space-between; align-items: center; gap: 10px; color: var(--ink); }
  .box .quit { color: var(--red); }
  .box .ver { margin-top: 4px; text-align: center; font: 500 11px var(--mono); color: var(--dim); }
  .loading { height: 100vh; display: flex; align-items: center; justify-content: center; font: 600 17px var(--ui); color: var(--green); background: var(--bg); }
  @media (max-width: 1100px) { .drawer { width: 240px; } .side { width: 260px; } }
</style>
