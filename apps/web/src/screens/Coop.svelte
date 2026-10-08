<script lang="ts">
  // Co-op lobby: host a shift (pick the day, invite friends, hand out seats) or join one.
  import { onMount } from 'svelte';
  import { DIFFICULTY } from '@squawk/sim';
  import { AIRPORTS, daysFor } from '../lib/data.ts';
  import { settings, saveSettings } from '../lib/settings.svelte.ts';
  import type { Launch } from '../lib/launch.ts';
  import type { ShiftClient } from '../game/client.ts';
  import { coop, Guest, Host } from '../net/coop.svelte.ts';
  import { autoSignal } from '../net/signal.ts';
  import CoopSeats from './CoopSeats.svelte';

  interface Props { onBack: () => void; onPlay: (c: ShiftClient, l: Launch) => void }
  let { onBack, onPlay }: Props = $props();

  const s = $derived(coop.session);
  let busy = $state(false);
  let error = $state('');
  let roomInput = $state('');
  let inviteIn = $state('');
  let answerOut = $state('');
  let invites = $state<{ code: string; answer: string; state: string; accept: (a: string) => Promise<void> }[]>([]);

  // Shift setup (host).
  let airport = $state('EGLL');
  const days = $derived(daysFor(airport));
  let dayId = $state(daysFor('EGLL').find(d => d.tags.includes('peak'))?.id ?? daysFor('EGLL')[0]?.id ?? '');
  let hour = $state(8);
  let minutes = $state(30);
  let traffic = $state(0.7);
  let diffName = $state<'casual' | 'standard' | 'realistic'>('standard');
  $effect(() => { if (!days.some(d => d.id === dayId)) dayId = days[0]?.id ?? ''; });
  const day = $derived(days.find(d => d.id === dayId));
  const aptName = $derived(AIRPORTS.find(a => a.icao === airport)?.name ?? airport);
  const summary = $derived(`${aptName} · ${day?.label ?? 'synthetic traffic'} · ${String(hour).padStart(2, '0')}:00 local · ${minutes} min · ${Math.round(traffic * 100)}% traffic · ${diffName}`);
  $effect(() => { if (s?.kind === 'host' && !s.resume && !s.lobby.started) s.setInfo(airport, summary); });

  onMount(() => {
    if (coop.rejoin && !coop.session) { roomInput = coop.rejoin; coop.rejoin = null; join(); }
    if (s?.kind === 'guest') hookGuest(s);
  });

  function launch(): Launch {
    const date = day?.date ?? '2026-08-28';
    const bst = +date.slice(5, 7) >= 4 && +date.slice(5, 7) <= 10; // day packs are UTC days; local time is BST in summer
    return { title: `Co-op — ${aptName}`, airports: [airport], days: [dayId || null], start: Date.parse(`${date}T00:00:00Z`) / 1000 + (hour - (bst ? 1 : 0)) * 3600,
      minutes, traffic, coverage: [], difficulty: { ...DIFFICULTY[diffName] }, mode: 'free', seed: (Math.random() * 2 ** 31) | 0 };
  }

  async function attempt(f: () => Promise<unknown>) {
    busy = true; error = '';
    try { await f(); } catch (e) { error = String((e as Error)?.message ?? e); } finally { busy = false; }
  }
  function host() {
    saveSettings();
    const h = new Host();
    coop.session = h;
    if (autoSignal) h.openRoom();
  }
  const newInvite = () => attempt(async () => { const i = await (s as Host).invite(); invites = [...invites, { ...i, answer: '', state: 'waiting for their answer code' }]; });
  const acceptInvite = (i: (typeof invites)[number]) => attempt(async () => { await i.accept(i.answer); i.state = 'connecting…'; });
  const start = () => attempt(async () => { const h = s as Host; const c = await h.start(h.resume?.launch ?? launch()); onPlay(c, h.launch!); });

  function hookGuest(g: Guest) { g.onStart = (c, l) => onPlay(c, l); }
  function guest() { saveSettings(); const g = new Guest(); hookGuest(g); coop.session = g; return g; }
  function join() { const g = (s as Guest | null) ?? guest(); attempt(() => g.join(roomInput)); }
  const makeAnswer = () => attempt(async () => { answerOut = await ((s as Guest | null) ?? guest()).answer(inviteIn); });

  function leave() { coop.session?.close(); coop.session = null; invites = []; answerOut = ''; error = ''; }
  const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => {});
</script>

<div class="coop">
  <header><button class="back" onclick={() => { leave(); onBack(); }}>← Back</button><h1>Co-op</h1></header>
  {#if !s}
    <p class="note">Work the airport with friends: one browser hosts the shift, everyone else connects to it directly (WebRTC). Voice is up to you — Discord works well.</p>
    <label class="row">Your name <input class="name" maxlength="20" bind:value={settings.callsign} placeholder="Callsign" /></label>
    <div class="cols">
      <section>
        <h2>Host a shift</h2>
        <p class="note">Your browser runs the sim. You choose the day and hand out seats; AI works any seat nobody takes.</p>
        <button class="go" onclick={host}>Host</button>
      </section>
      <section>
        <h2>Join a friend</h2>
        {#if autoSignal}
          <label class="row">Room code <input class="room" maxlength="6" bind:value={roomInput} placeholder="ABCDEF" /></label>
          <button class="go" disabled={roomInput.trim().length !== 6 || busy} onclick={join}>Join</button>
          <h3>…or with an invite code</h3>
        {/if}
        <textarea bind:value={inviteIn} placeholder="Paste the host's invite code"></textarea>
        <button class="go" disabled={!inviteIn.trim() || busy} onclick={makeAnswer}>Make answer code</button>
      </section>
    </div>
  {:else if s.kind === 'host'}
    <div class="cols">
      <section>
        <h2>The shift</h2>
        {#if s.resume}
          <p class="big">{s.lobby.summary}</p>
          <p class="note">Taking over: the shift carries on from the last saved moment once you resume. Invite everyone back and hand out the seats again.</p>
        {:else}
          <div class="chips">{#each AIRPORTS as a}<button class:on={airport === a.icao} onclick={() => (airport = a.icao)}>{a.name}</button>{/each}</div>
          <label class="row">Day <select bind:value={dayId}>{#each days as d}<option value={d.id}>{d.label} ({d.flights})</option>{/each}</select></label>
          <label class="row">Start (local) <input type="range" min="0" max="23" bind:value={hour} /> <b>{String(hour).padStart(2, '0')}:00</b></label>
          <label class="row">Length <select bind:value={minutes}>{#each [15, 20, 30, 40, 60] as m}<option value={m}>{m} min</option>{/each}</select></label>
          <label class="row">Traffic <input type="range" min="0.1" max="1" step="0.05" bind:value={traffic} /> <b>{Math.round(traffic * 100)}%</b></label>
          <div class="chips">{#each ['casual', 'standard', 'realistic'] as n}<button class:on={diffName === n} onclick={() => (diffName = n as typeof diffName)}>{n}</button>{/each}</div>
        {/if}
        <h2>Invite</h2>
        {#if s.room}<p>Room code <b class="code" data-testid="room">{s.room}</b> <button class="mini" onclick={() => copy(s.room!)}>copy</button> — friends pick “Join” and type it.</p>{/if}
        <p class="note">{autoSignal ? 'No room service? ' : ''}Copy-paste works anywhere: make an invite code per friend, send it (Discord, chat), paste back their answer.</p>
        <button class="mini" disabled={busy} onclick={newInvite}>New invite code</button>
        {#each invites as inv, i}
          <div class="invite">
            <div class="row"><b>Invite {i + 1}</b><span class="note">{inv.state}</span></div>
            <textarea readonly value={inv.code} data-testid="invite" onfocus={(e) => e.currentTarget.select()}></textarea>
            <button class="mini" onclick={() => copy(inv.code)}>copy invite</button>
            <textarea bind:value={inv.answer} placeholder="Paste their answer code" data-testid="answer-in"></textarea>
            <button class="mini" disabled={!inv.answer.trim() || busy} onclick={() => acceptInvite(inv)}>Connect</button>
          </div>
        {/each}
        {#if s.status}<p class="err">{s.status}</p>{/if}
      </section>
      <section>
        <h2>Players</h2>
        <ul>{#each s.lobby.players as p}<li>{p.name}{p.id === 'host' ? ' (host, you)' : ''}</li>{/each}</ul>
        <CoopSeats />
        <button class="go" disabled={busy || !Object.keys(s.lobby.seats).length} onclick={start}>{s.resume ? 'Resume shift' : 'Start shift'}</button>
        <button class="mini" onclick={leave}>Stop hosting</button>
      </section>
    </div>
  {:else}
    <div class="cols">
      <section>
        <h2>Joining</h2>
        {#if answerOut && !s.connected}
          <p>Send this answer code back to the host:</p>
          <textarea readonly value={answerOut} data-testid="answer-out" onfocus={(e) => e.currentTarget.select()}></textarea>
          <button class="mini" onclick={() => copy(answerOut)}>copy answer</button>
        {/if}
        <p class="note" data-testid="guest-status">{s.status || 'Connecting…'}</p>
        {#if s.lobby}<p class="big">{s.lobby.summary}</p>{/if}
        <button class="mini" onclick={leave}>Leave</button>
      </section>
      {#if s.lobby}
        <section>
          <h2>Players</h2>
          <ul>{#each s.lobby.players as p}<li>{p.name}{p.id === s.you ? ' (you)' : p.id === 'host' ? ' (host)' : ''}</li>{/each}</ul>
          <CoopSeats />
          <p class="note">{s.lobby.started ? 'Shift in progress — joining…' : 'Waiting for the host to start.'}</p>
        </section>
      {/if}
    </div>
  {/if}
  {#if error}<p class="err">{error}</p>{/if}
</div>

<style>
  .coop { height: 100vh; overflow-y: auto; box-sizing: border-box; background: var(--screen-bg); padding: 18px clamp(16px, 4vw, 48px); font: 14px var(--ui); color: var(--ink); }
  header { display: flex; align-items: center; gap: 18px; }
  h1 { margin: 0; font: 600 21px var(--ui); color: var(--green); }
  h2 { margin: 18px 0 8px; font: 600 13px var(--ui); color: var(--muted); letter-spacing: 1px; }
  h3 { margin: 14px 0 6px; font: 400 12px var(--ui); color: var(--muted); }
  .back { background: var(--btn); border: 1px solid var(--line); color: var(--ink-strong); font: 13px var(--ui); padding: 3px 10px; cursor: pointer; }
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 34px; max-width: 1100px; }
  section { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .note { color: var(--muted); font-size: 13px; margin: 4px 0; }
  .big { font-size: 18px; color: var(--ink-strong); margin: 0; }
  .row { display: flex; align-items: center; gap: 10px; }
  .row b { font-weight: 400; color: var(--ink-strong); }
  input[type=range] { flex: 1; min-width: 140px; accent-color: var(--green); }
  select, .name, .room, textarea { background: var(--btn); color: var(--ink-strong); border: 1px solid var(--line); font: 13px var(--ui); padding: 2px 6px; }
  .room { width: 90px; text-transform: uppercase; letter-spacing: 2px; }
  textarea { width: 100%; box-sizing: border-box; height: 64px; resize: vertical; font-size: 11px; word-break: break-all; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chips button { background: var(--btn); border: 1px solid var(--line); color: var(--ink); font: 13px var(--ui); padding: 3px 10px; cursor: pointer; text-transform: capitalize; }
  .chips button.on { border-color: var(--green); color: var(--green); }
  .go { margin-top: 10px; padding: 8px 26px; background: var(--green); color: var(--bg); border: none; font: 600 15px var(--ui); cursor: pointer; }
  .go:disabled { opacity: 0.4; cursor: default; }
  .mini { background: var(--btn); border: 1px solid var(--line-strong); color: var(--ink-strong); font: 12px var(--ui); padding: 2px 10px; cursor: pointer; }
  .mini:disabled { opacity: 0.4; }
  .invite { width: 100%; border: 1px solid var(--line); background: var(--panel); padding: 6px 8px; box-sizing: border-box; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
  .code { font: 600 23px var(--ui); color: var(--green); letter-spacing: 3px; }
  ul { margin: 0; padding-left: 18px; }
  .err { color: var(--amber); }
  section :global(.seats) { width: 100%; }
</style>
