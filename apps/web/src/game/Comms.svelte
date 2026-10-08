<script lang="ts">
  import { complete, parseLine, text, type ParseCtx, type PhraseCtx } from '@squawk/phraseology';
  import { localHour, type Command, type Radio, type World } from '@squawk/sim';
  import type { Snap } from './client.ts';

  interface Props { world: World; snap: Snap; selected: string | null; filter: string | null; onSend: (cmds: Command[]) => Promise<string | null>; onSelect: (cs: string) => void; inputEl?: HTMLInputElement }
  let { world, snap, selected, filter, onSend, onSelect, inputEl = $bindable() }: Props = $props();

  let line = $state('');
  let error = $state('');
  let logEl: HTMLDivElement;
  let suggestions = $state<string[]>([]);
  let history: string[] = [];
  let hi = -1;

  const ctxFor = (icao: string): PhraseCtx => {
    const apt = world.byIcao[icao] ?? world.primary;
    return { airport: { rtName: apt.pack.rtName, transitionAltFt: apt.pack.transitionAltFt, frequencies: apt.pack.frequencies }, fixNames: fixNames(apt.icao) };
  };
  const nameCache = new Map<string, Record<string, string>>();
  function fixNames(icao: string) {
    if (!nameCache.has(icao)) {
      const apt = world.byIcao[icao];
      const m: Record<string, string> = {};
      for (const f of Object.values(apt.fixes)) if (f.spoken) m[f.name] = f.spoken;
      nameCache.set(icao, m);
    }
    return nameCache.get(icao)!;
  }

  type Line = { id: string; tick: number; who: string; cls: string; text: string; cs: string };
  const seatOf = (r: Radio) => (r as Radio & { seatId?: string }).seatId ?? (r.seat === 'LON' ? 'LON' : `${r.airport}:${r.seat}`);
  const lines = $derived.by(() => {
    const out: Line[] = [];
    for (const r of snap.radio) {
      const seat = seatOf(r);
      if (!snap.coverage.includes(seat) || (filter && seat !== filter)) continue;
      const ctx = ctxFor(r.airport === 'LON' ? world.primary.icao : r.airport);
      out.push({ id: 'r' + r.id, tick: r.tick, who: r.from === 'atc' ? r.seat : r.cs, cls: r.from === 'atc' ? (r.auto ? 'auto' : 'atc') : r.msg.t === 'call' && (r.msg.call.k === 'mayday' || r.msg.call.k === 'panpan') ? 'mayday' : 'pilot', text: text(r, ctx), cs: r.cs });
    }
    for (const a of snap.alerts) {
      if (a.cs && !snap.aircraft.some(x => x.cs === a.cs && snap.coverage.includes(x.owner))) continue;
      out.push({ id: 'a' + a.tick + a.text, tick: a.tick, who: '!!', cls: a.level, text: a.text, cs: a.cs ?? '' });
    }
    return out.sort((a, b) => a.tick - b.tick).slice(-160);
  });
  let pinned = true;
  $effect(() => { void lines.length; if (logEl && pinned) logEl.scrollTop = logEl.scrollHeight; });

  const clock = (tick: number) => {
    const u = snap.start + tick / 4;
    const h = localHour(u);
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = Math.floor(u % 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };

  function parseCtx(): ParseCtx {
    const apt = world.primary;
    const mine = snap.aircraft.filter(a => snap.coverage.includes(a.freq));
    const sel = mine.find(a => a.cs === selected);
    const as = snap.apts.find(a => a.icao === (sel?.apt ?? apt.icao))!;
    const runways = sel ? (sel.kind === 'arr' ? [...as.arr] : [...as.dep]) : [...as.arr, ...as.dep];
    return {
      callsigns: mine.map(a => a.cs), selected: sel?.cs,
      fixes: Object.keys(apt.fixes), runways: [...new Set(runways)],
      holds: apt.nodes.filter(n => n.hold).map(n => n.hold!), stands: apt.stands.map(s => s.ref),
      taxiways: [...new Set(apt.edges.map(e => e.name).filter(Boolean))],
      fixNames: fixNames(apt.icao), sids: apt.pack.airspace.sids.map(s => s.name + s.designator),
    };
  }

  async function submit() {
    const l = line.trim();
    if (!l) return;
    const r = parseLine(l, parseCtx());
    if ('error' in r) { error = r.error; return; }
    const err = await onSend(r.cmds);
    if (err) { error = err; return; }
    history.unshift(l); hi = -1; line = ''; error = ''; suggestions = [];
  }
  function keydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const s = complete(line, parseCtx());
      if (s.length === 1) { line = line.replace(/\S*$/, s[0]) + ' '; suggestions = []; } else suggestions = s.slice(0, 8);
    } else if (e.key === 'ArrowUp') { e.preventDefault(); hi = Math.min(history.length - 1, hi + 1); if (hi >= 0) line = history[hi]; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.max(-1, hi - 1); line = hi >= 0 ? history[hi] : ''; }
    else if (e.key === 'Escape') { line = ''; error = ''; suggestions = []; inputEl?.blur(); }
  }
  function oninput() { error = ''; suggestions = line.length ? complete(line, parseCtx()).slice(0, 8) : []; }
</script>

<section class="comms">
  <div class="log" bind:this={logEl} onscroll={() => (pinned = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 8)}>
    {#each lines as l (l.id)}
      <div class="ln {l.cls}" class:sel={l.cs === selected} onclick={() => l.cs && onSelect(l.cs)} role="presentation">
        <span class="t">{clock(l.tick)}</span><span class="who">{l.who}</span><span class="txt">{l.text}</span>
      </div>
    {/each}
  </div>
  <div class="cmd">
    <span class="prompt">{selected ?? '>'}</span>
    <input bind:this={inputEl} bind:value={line} {oninput} onkeydown={keydown} spellcheck="false" autocomplete="off"
      placeholder={selected ? 'H270 A40 S210 · LUW · CTO · CLR · TX 27L · CT TWR   (Tab completes, Enter sends)' : 'BAW12 H270 A40 · select an aircraft first to skip the callsign'} aria-label="Command line" />
    {#if error}<span class="err">{error}</span>{/if}
    {#if suggestions.length}<div class="sugg">{#each suggestions as s}<button onmousedown={(e) => { e.preventDefault(); line = line.replace(/\S*$/, s) + ' '; suggestions = []; inputEl?.focus(); }}>{s}</button>{/each}</div>{/if}
  </div>
</section>

<style>
  .comms { display: flex; flex-direction: column; height: 100%; background: var(--panel); border-top: 1px solid var(--line); }
  .log { flex: 1; overflow-y: auto; padding: 4px 10px; font: 13px/1.15 var(--mono); }
  .ln { display: flex; gap: 10px; color: var(--ink); cursor: default; }
  .ln.sel { background: var(--sel-bg); }
  .t { color: var(--dim); min-width: 62px; }
  .who { color: var(--muted); min-width: 70px; }
  .txt { flex: 1; }
  .atc .txt { color: var(--green); }
  .auto .txt { color: var(--green-dim); }
  .pilot .txt { color: var(--ink); }
  .mayday .txt { color: var(--red); }
  .caution .txt, .caution .who { color: var(--amber); }
  .conflict .txt, .conflict .who { color: var(--red); }
  .info .txt { color: var(--accent); }
  .cmd { position: relative; display: flex; align-items: center; gap: 8px; padding: 5px 10px; border-top: 1px solid var(--line); background: var(--panel-2); }
  .prompt { font: 14px var(--mono); color: var(--green); min-width: 70px; }
  input { flex: 1; background: transparent; border: none; outline: none; color: var(--ink-strong); font: 15px var(--mono); }
  input::placeholder { color: var(--dim); }
  .err { color: var(--red); font: 12px var(--mono); }
  .sugg { position: absolute; bottom: 100%; left: 88px; display: flex; gap: 4px; padding: 4px; background: var(--panel-2); border: 1px solid var(--line); }
  .sugg button { background: var(--btn); color: var(--ink); border: 1px solid var(--line); font: 12px var(--mono); padding: 1px 6px; cursor: pointer; }
</style>
