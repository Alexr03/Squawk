<script lang="ts">
  // Who works which seat. The host assigns (in the lobby and mid-shift: split/merge); guests claim free seats in the lobby.
  import { coop, defaultSplit, HOST, seatName, seatsFor, type Host } from '../net/coop.svelte.ts';

  const s = $derived(coop.session);
  const lobby = $derived(s?.lobby ?? null);
  const me = $derived(s?.kind === 'host' ? HOST : s?.you ?? '');
  const nameOf = (id: string | undefined) => lobby?.players.find(p => p.id === id)?.name ?? 'AI';
  function monitor(on: boolean) {
    coop.monitor = on;
    const c = s?.kind === 'host' ? s.client : s?.remote;
    if (c) c.monitor = on;
  }
</script>

{#if s && lobby}
  <div class="seats">
    <h3>Seats {#if s.kind === 'host' && !lobby.started}<button class="mini" onclick={() => (s as Host).setSeats(defaultSplit(lobby.players, lobby.airport))}>default split</button>{/if}</h3>
    {#each seatsFor(lobby.airport) as seat}
      {@const owner = lobby.seats[seat]}
      <div class="seat" class:mine={owner === me} class:ai={!owner}>
        <b>{seatName(seat)}</b>
        {#if s.kind === 'host' && (!lobby.started || owner)}
          <select aria-label="{seatName(seat)} controller" value={owner ?? ''} onchange={(e) => (s as Host).assign(seat, e.currentTarget.value || null)}>
            {#if !lobby.started}<option value="">AI</option>{/if}
            {#each lobby.players as p}<option value={p.id}>{p.name}{p.id === HOST ? ' (host)' : ''}</option>{/each}
          </select>
        {:else}
          <span>{nameOf(owner)}</span>
          {#if s.kind === 'guest' && !lobby.started && (!owner || owner === me)}
            <button class="mini" onclick={() => s.claim(seat)}>{owner === me ? 'release' : 'claim'}</button>
          {/if}
        {/if}
      </div>
    {/each}
    <label class="mon"><input type="checkbox" checked={coop.monitor} onchange={(e) => monitor(e.currentTarget.checked)} /> Monitor every frequency in my radio log</label>
  </div>
{/if}

<style>
  .seats { display: flex; flex-direction: column; gap: 4px; font: 13px var(--ui); }
  h3 { margin: 6px 0 2px; font: 600 13px var(--ui); color: var(--muted); display: flex; gap: 10px; align-items: center; }
  .seat { display: grid; grid-template-columns: 140px 1fr auto; align-items: center; gap: 8px; padding: 3px 8px; border: 1px solid var(--line); background: var(--panel); }
  .seat.mine { border-color: var(--green); }
  .seat.ai span { color: var(--dim); }
  .seat b { font-weight: 400; color: var(--ink-strong); }
  select { background: var(--btn); color: var(--ink-strong); border: 1px solid var(--line); font: 13px var(--ui); padding: 1px 4px; }
  .mini { background: var(--btn); border: 1px solid var(--line-strong); color: var(--ink-strong); font: 12px var(--ui); padding: 0 8px; cursor: pointer; text-transform: none; letter-spacing: 0; }
  .mon { display: flex; gap: 8px; align-items: center; color: var(--muted); margin-top: 4px; }
</style>
