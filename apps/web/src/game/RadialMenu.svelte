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
    return { left: Math.cos(a) * R, top: Math.sin(a) * R };
  };
  const cx = $derived(Math.min(Math.max(x, R + 90), innerWidth - R - 90));
  const cy = $derived(Math.min(Math.max(y, R + 40), innerHeight - R - 40));
</script>

<svelte:window onkeydown={key} />
<div class="backdrop" onpointerdown={onClose} oncontextmenu={(e) => { e.preventDefault(); onClose(); }} role="presentation"></div>
<div class="ring" style="left:{cx}px; top:{cy}px">
  <button class="hub" onclick={() => (stack.length ? (stack = stack.slice(0, -1)) : onClose())}>
    <b>{current.title}</b><small>{stack.length ? 'back' : 'close'}</small>
  </button>
  {#each current.items as it, i (it.label + i)}
    {@const p = pos(i, current.items.length)}
    <button class="item" class:danger={it.danger} class:hasSub={!!it.sub} style="left:{p.left}px; top:{p.top}px"
      onclick={(e) => choose(it, e)} oncontextmenu={(e) => { e.preventDefault(); if (it.sub) stack = [...stack, { title: it.label, items: it.sub() }]; }}>
      <span class="n">{i + 1}</span>{it.label}{#if it.sub}<span class="more">›</span>{/if}
    </button>
  {/each}
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 40; }
  .ring { position: fixed; z-index: 41; width: 0; height: 0; }
  .hub { position: absolute; transform: translate(-50%, -50%); width: 96px; height: 96px; border-radius: 50%; background: var(--glass-hi); backdrop-filter: blur(14px); border: 2px solid var(--green);
    color: var(--ink-strong); display: flex; flex-direction: column; align-items: center; justify-content: center; font: 600 14px var(--mono); cursor: pointer; box-shadow: 0 0 0 6px rgba(10, 19, 36, 0.45), var(--lift); }
  .hub small { color: var(--muted); font-size: 11px; }
  .item { position: absolute; transform: translate(-50%, -50%); white-space: nowrap; padding: 7px 14px 7px 8px; background: var(--glass-hi); backdrop-filter: blur(14px); color: var(--ink-strong); box-shadow: var(--lift);
    border: 1px solid var(--glass-line); font: 500 14px var(--ui); cursor: pointer; border-radius: 999px; display: flex; gap: 6px; align-items: center; }
  .item:hover, .item:focus-visible { background: var(--green); color: var(--bg); border-color: var(--green); }
  .item.danger { border-color: var(--red); color: var(--red); }
  .item.danger:hover { background: var(--red); color: var(--bg); }
  .n { color: var(--dim); font-size: 11px; }
  .item:hover .n { color: var(--bg); }
  .more { color: var(--accent); }
  @media (prefers-reduced-motion: no-preference) { .item { animation: pop 0.12s ease-out both; } }
  @keyframes pop { from { opacity: 0; transform: translate(-50%, -50%) scale(0.8); } }
</style>
