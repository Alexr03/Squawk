<script lang="ts">
  import type { RadialItem } from './radial.ts';

  interface Props { x: number; y: number; cs: string; items: RadialItem[]; onPick: (item: RadialItem) => void; onClose: () => void }
  let { x, y, cs, items, onPick, onClose }: Props = $props();
  let stack = $state<{ title: string; items: RadialItem[] }[]>([]);
  const current = $derived(stack.length ? stack[stack.length - 1] : { title: cs, items });
  const R = $derived(Math.max(92, Math.min(170, 46 + current.items.length * 9)));

  function choose(it: RadialItem, e?: MouseEvent) {
    // Right-click or a long list item with both: open the sub-ring; plain click sends the default.
    if (it.sub && (!it.cmd && !it.taxi || e?.shiftKey || e?.button === 2)) { stack = [...stack, { title: it.label, items: it.sub() }]; return; }
    onPick(it);
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (stack.length) stack = stack.slice(0, -1); else onClose(); return; }
    if (e.key === 'Backspace' && stack.length) { e.preventDefault(); stack = stack.slice(0, -1); return; }
    const n = Number(e.key);
    if (n >= 1 && n <= 9 && current.items[n - 1]) { e.preventDefault(); e.stopPropagation(); choose(current.items[n - 1]); }
  }
  const pos = (i: number, n: number) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    // tx anchors each label so it grows away from the centre instead of over the aircraft.
    return { left: Math.cos(a) * R, top: Math.sin(a) * R, tx: -50 + Math.cos(a) * 50 };
  };
  const cx = $derived(Math.min(Math.max(x, R + 90), innerWidth - R - 90));
  const cy = $derived(Math.min(Math.max(y, R + 40), innerHeight - R - 40));
</script>

<svelte:window onkeydown={key} />
<div class="backdrop" onpointerdown={onClose} oncontextmenu={(e) => { e.preventDefault(); onClose(); }} role="presentation"></div>
<div class="ring" style="left:{cx}px; top:{cy}px">
  <div class="halo"></div>
  <button class="hub" onclick={() => (stack.length ? (stack = stack.slice(0, -1)) : onClose())} aria-label={stack.length ? 'Back' : 'Close'}></button>
  <div class="title"><b>{current.title}</b>{#if stack.length}<small>click the centre to go back</small>{/if}</div>
  {#each current.items as it, i (it.label + i)}
    {@const p = pos(i, current.items.length)}
    <button class="item" class:danger={it.danger} class:hasSub={!!it.sub} style="left:{p.left}px; top:{p.top}px; --tx:{p.tx}%; animation-delay:{i * 18}ms"
      onclick={(e) => choose(it, e)} oncontextmenu={(e) => { e.preventDefault(); if (it.sub) stack = [...stack, { title: it.label, items: it.sub() }]; }}>
      <span class="n">{i + 1}</span>{it.label}{#if it.sub}<span class="more">›</span>{/if}
    </button>
  {/each}
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 40; }
  .ring { position: fixed; z-index: 41; width: 0; height: 0; }
  /* A soft dark halo separates the menu from the map without hiding it. */
  .halo { position: absolute; width: 0; height: 0; pointer-events: none; }
  .halo::before { content: ''; position: absolute; left: -210px; top: -210px; width: 420px; height: 420px; border-radius: 50%; background: radial-gradient(circle, rgba(6, 12, 24, 0.5) 0%, rgba(6, 12, 24, 0.3) 45%, transparent 70%); }
  /* The centre is an open ring, so you still see the aircraft you are talking to. */
  .hub { position: absolute; transform: translate(-50%, -50%); width: 56px; height: 56px; border-radius: 50%; background: transparent; border: 2px solid var(--green); cursor: pointer;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4), 0 0 18px rgba(62, 230, 168, 0.35), inset 0 0 0 1px rgba(0, 0, 0, 0.4); }
  .hub:hover { background: rgba(62, 230, 168, 0.12); }
  .title { position: absolute; transform: translate(-50%, 36px); display: flex; flex-direction: column; align-items: center; gap: 1px; pointer-events: none; white-space: nowrap; }
  .title b { font: 600 13px var(--mono); color: var(--ink-strong); background: rgba(10, 20, 36, 0.7); padding: 2px 8px; border-radius: 999px; }
  .title small { font: 500 11px var(--ui); color: var(--muted); text-shadow: 0 1px 3px #000; }
  .item { position: absolute; transform: translate(var(--tx), -50%); white-space: nowrap; padding: 7px 14px 7px 8px; background: rgba(16, 30, 50, 0.72); backdrop-filter: blur(10px) saturate(1.2);
    color: var(--ink-strong); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.12); font: 500 14px var(--ui); cursor: pointer; border-radius: 999px;
    display: flex; gap: 7px; align-items: center; transition: background 0.12s, border-color 0.12s; }
  .item:hover, .item:focus-visible { background: var(--green); color: var(--bg); border-color: var(--green); outline: none; }
  .item.danger { border-color: rgba(255, 90, 90, 0.6); color: #ff8a8a; }
  .item.danger:hover { background: var(--red); color: var(--bg); }
  .n { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: rgba(255, 255, 255, 0.1); color: var(--muted); font: 600 11px var(--mono); }
  .item:hover .n { background: rgba(0, 0, 0, 0.15); color: var(--bg); }
  .more { color: var(--accent); }
  .item:hover .more { color: var(--bg); }
  @media (prefers-reduced-motion: no-preference) { .item { animation: pop 0.14s ease-out both; } }
  @keyframes pop { from { opacity: 0; transform: translate(var(--tx), -50%) scale(0.85); } }
</style>
