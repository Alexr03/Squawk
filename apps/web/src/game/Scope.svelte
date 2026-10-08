<script lang="ts">
  import { onMount } from 'svelte';
  import { createScene, type Scene } from '@squawk/render';
  import { find, geo, route, viaNames, type Command, type XY } from '@squawk/sim';
  import type { ShiftClient } from './client.ts';
  import { settings } from '../lib/settings.svelte.ts';

  interface Props {
    client: ShiftClient;
    selected: string | null;
    taxiEdit: { cs: string; to: string; greens?: boolean; via: number[] } | null;
    overlays: { sids: boolean; stars: boolean; weather: boolean };
    onSelect: (cs: string | null) => void;
    onRadial: (cs: string, x: number, y: number) => void;
    onIssue: (cmds: Command[]) => void;
    onTaxiDone: (commit: boolean) => void;
    viewRequest: { cx: number; cy: number; mpp: number; t: number } | null;
  }
  let { client, selected, taxiEdit = $bindable(), overlays, onSelect, onRadial, onIssue, onTaxiDone, viewRequest }: Props = $props();

  let wrap: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let ui: HTMLCanvasElement;
  let scene: Scene | null = null;
  let mpp = $state(3);
  let anim: { from: { cx: number; cy: number; mpp: number }; to: { cx: number; cy: number; mpp: number }; t0: number } | null = null;

  const world = client.world;
  const apt = world.primary;

  onMount(() => {
    scene = createScene(canvas, client.packs, { pixelSize: settings.pixelSize, quality: settings.quality });
    const cov = client.seats;
    const roles = cov.map(s => s.split(':').pop());
    const start = roles.includes('GND') || roles.includes('DEL') ? { mpp: 1.1, cx: -900, cy: -700 } : roles.includes('TWR') ? { mpp: 2.6, cx: 400, cy: -700 } : roles.includes('DIR') ? { mpp: 105, cx: 0, cy: 0 } : { mpp: 260, cx: 0, cy: 0 };
    scene.setView(start);
    const ro = new ResizeObserver(() => scene?.resize());
    ro.observe(wrap);
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!scene || !client.snap) return;
      const now = performance.now();
      if (anim) {
        const k = Math.min(1, (now - anim.t0) / 600), e = k * k * (3 - 2 * k);
        const lm = Math.log(anim.from.mpp) + (Math.log(anim.to.mpp) - Math.log(anim.from.mpp)) * e;
        scene.setView({ cx: anim.from.cx + (anim.to.cx - anim.from.cx) * e, cy: anim.from.cy + (anim.to.cy - anim.from.cy) * e, mpp: Math.exp(lm) });
        if (k >= 1) anim = null;
      }
      const snap = client.snap;
      scene.setAircraft([...client.views(now), ...client.fillerViews()]);
      scene.setVehicles(snap.vehicles.map(v => ({ id: v.id, kind: v.kind, x: v.x, y: v.y, hdg: v.hdg, lights: v.lights })));
      scene.setTime(client.time(now));
      const w = snap.weather;
      scene.setWeather({ rain: w.wx.some(x => x.includes('RA') || x.includes('DZ')) ? (w.wx.some(x => x.startsWith('+')) ? 1 : 0.55) : 0, visM: w.visM, cloud: w.ceilingFt !== null ? Math.max(0.2, Math.min(1, 1 - w.ceilingFt / 5000)) : 0.1, cells: w.cells });
      const as = snap.apts[0];
      scene.setRunwaysInUse(as.arr, as.dep);
      scene.setSelected(selected);
      scene.setOverlays({ ...overlays, ctr: true, rings: true });
      scene.setGreens(greens());
      scene.setStopBars(stopBars());
      scene.render();
      mpp = scene.getView().mpp;
      drawUi();
    };
    frame();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); scene?.dispose(); };
  });

  $effect(() => {
    if (viewRequest && scene) anim = { from: scene.getView(), to: viewRequest, t0: performance.now() };
  });

  function greens(): XY[][] {
    const out: XY[][] = [];
    for (const a of client.snap!.aircraft) {
      if (!a.cleared.greens || !a.onGround || a.apt !== apt.icao || a.pi >= a.path.length) continue;
      // Lit just ahead of the aircraft, off behind it.
      out.push([{ x: a.x, y: a.y }, ...a.path.slice(a.pi, a.pi + 12).map(n => apt.nodes[n])]);
    }
    return out;
  }
  function stopBars(): number[] {
    const snap = client.snap!;
    const open = new Set<number>();
    for (const a of snap.aircraft) {
      if (!a.onGround || a.apt !== apt.icao) continue;
      if (a.cleared.luw || a.cleared.cto || a.cleared.cross.length) for (let i = Math.max(0, a.pi - 2); i < Math.min(a.path.length, a.pi + 8); i++) open.add(a.path[i]);
    }
    const lit: number[] = [];
    for (const e of Object.values(apt.ends)) for (const h of e.holds) if (!open.has(h)) lit.push(h);
    return lit;
  }

  // ---------------------------------------------------------------- UI overlay (route preview, drag vector)
  let drag: { x: number; y: number; moved: boolean; vector: string | null; cur: XY | null; button: number } | null = null;
  function taxiPath(): number[] | null {
    if (!taxiEdit) return null;
    const ac = find(client.snap!, taxiEdit.cs);
    if (!ac) return null;
    const start = ac.path.length && ac.pi < ac.path.length ? ac.path[Math.max(0, ac.pi - 1)] : nearestNode(ac);
    const goal = goalNode(taxiEdit.to);
    if (goal === null) return null;
    let path = [start];
    for (const v of [...taxiEdit.via, goal]) {
      const r = route(apt, path[path.length - 1], v);
      if (!r) return null;
      path = path.concat(r.slice(1));
    }
    return path;
  }
  function goalNode(to: string): number | null {
    const end = apt.ends[to];
    if (end) return end.front[0] ?? end.holds[0] ?? null;
    const h = apt.nodes.find(n => n.hold === to);
    if (h) return h.id;
    return apt.standByRef[to]?.node ?? null;
  }
  function nearestNode(p: XY) { let best = 0, bd = Infinity; for (const n of apt.nodes) { const d = geo.dist(n, p); if (d < bd) { bd = d; best = n.id; } } return best; }

  function drawUi() {
    const dpr = devicePixelRatio || 1;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (ui.width !== Math.round(w * dpr) || ui.height !== Math.round(h * dpr)) { ui.width = Math.round(w * dpr); ui.height = Math.round(h * dpr); }
    const ctx = ui.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!scene) return;
    const S = (p: XY) => scene!.worldToScreen(p);
    // Taxi route being built.
    const path = taxiPath();
    if (path) {
      ctx.strokeStyle = taxiEdit?.greens ? '#5dff8a' : '#ffd84a'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
      ctx.beginPath(); path.forEach((n, i) => { const p = S(apt.nodes[n]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); ctx.setLineDash([]);
      for (const v of taxiEdit!.via) { const p = S(apt.nodes[v]); ctx.fillStyle = '#ffd84a'; ctx.fillRect(p.x - 4, p.y - 4, 8, 8); }
      const end = S(apt.nodes[path[path.length - 1]]);
      ctx.font = "12px 'IBM Plex Mono', ui-monospace, monospace"; ctx.fillStyle = '#ffd84a';
      ctx.fillText(`${taxiEdit!.to} via ${viaNames(apt, path).join(' ') || 'direct'} — click to add a point, Enter/double-click to send, Esc to cancel`, Math.min(end.x + 10, w - 520), end.y - 10);
    }
    // Heading vector being dragged out of a blip.
    if (drag?.vector && drag.cur) {
      const ac = find(client.snap!, drag.vector);
      if (ac) {
        const a = S(ac), b = S(drag.cur);
        const hdg = Math.round(geo.bearing(ac, drag.cur) / 5) * 5 || 360;
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = "600 13px 'IBM Plex Mono', ui-monospace, monospace"; ctx.fillStyle = '#fff'; ctx.fillText(`H${String(hdg).padStart(3, '0')}`, b.x + 8, b.y - 8);
      }
    }
  }

  // ---------------------------------------------------------------- input
  function local(e: MouseEvent) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function pickAircraft(x: number, y: number): string | null {
    if (!scene) return null;
    const p = scene.pick(x, y);
    return 'cs' in p && !p.cs.startsWith('~') ? p.cs : null;
  }
  function down(e: PointerEvent) {
    const p = local(e);
    const hit = pickAircraft(p.x, p.y);
    // Radar: drag out of the selected blip to vector it.
    const vector = e.button === 0 && hit && hit === selected && mpp > 8 && find(client.snap!, hit) && !find(client.snap!, hit)!.onGround ? hit : null;
    drag = { x: p.x, y: p.y, moved: false, vector, cur: null, button: e.button };
    canvas.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!drag || !scene) return;
    const p = local(e);
    if (Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y) > 4) drag.moved = true;
    if (drag.vector) { drag.cur = scene.screenToWorld(p.x, p.y); return; }
    if (drag.moved && drag.button === 0) {
      const v = scene.getView();
      scene.setView({ ...v, cx: v.cx - (p.x - drag.x) * v.mpp, cy: v.cy + (p.y - drag.y) * v.mpp });
      drag.x = p.x; drag.y = p.y;
    }
  }
  function up(e: PointerEvent) {
    if (!drag || !scene) return;
    const p = local(e);
    if (drag.vector && drag.cur && drag.moved) {
      const ac = find(client.snap!, drag.vector)!;
      const hdg = Math.round(geo.bearing(ac, drag.cur) / 5) * 5 || 360;
      const turn = ((hdg - ac.hdg + 540) % 360) - 180 < 0 ? 'L' : 'R';
      onIssue([{ cs: ac.cs, verb: 'heading', hdg, turn }]);
    } else if (!drag.moved && drag.button === 0) {
      if (taxiEdit) {
        const w = scene.screenToWorld(p.x, p.y);
        const n = nearestNode(w);
        if (geo.dist(apt.nodes[n], w) < 12 * scene.getView().mpp + 15) taxiEdit = { ...taxiEdit, via: [...taxiEdit.via, n] };
      } else onSelect(pickAircraft(p.x, p.y));
    }
    drag = null;
  }
  function context(e: MouseEvent) {
    e.preventDefault();
    const p = local(e);
    if (taxiEdit) { onTaxiDone(false); return; }
    const hit = pickAircraft(p.x, p.y) ?? selected;
    if (hit) { onSelect(hit); onRadial(hit, e.clientX, e.clientY); }
  }
  function wheel(e: WheelEvent) {
    e.preventDefault();
    if (!scene) return;
    anim = null;
    const p = local(e);
    const v = scene.getView();
    const before = scene.screenToWorld(p.x, p.y);
    const k = Math.exp(e.deltaY * 0.0016);
    const nm = Math.min(700, Math.max(0.12, v.mpp * k));
    scene.setView({ ...v, mpp: nm });
    const after = scene.screenToWorld(p.x, p.y);
    const v2 = scene.getView();
    scene.setView({ ...v2, cx: v2.cx + before.x - after.x, cy: v2.cy + before.y - after.y });
  }
  function dbl() { if (taxiEdit) onTaxiDone(true); }

  export function currentTaxiPath() { return taxiPath(); }
  export function zoomTo(cx: number, cy: number, m: number) { if (scene) anim = { from: scene.getView(), to: { cx, cy, mpp: m }, t0: performance.now() }; }
</script>

<div class="scope" bind:this={wrap}>
  <canvas bind:this={canvas} onpointerdown={down} onpointermove={move} onpointerup={up} oncontextmenu={context} onwheel={wheel} ondblclick={dbl}></canvas>
  <canvas class="ui" bind:this={ui}></canvas>
  <div class="scale">{mpp < 8 ? `${mpp.toFixed(1)} m/px` : `${((mpp * 900) / 1852).toFixed(0)} nm across`}</div>
</div>

<style>
  .scope { position: relative; width: 100%; height: 100%; overflow: hidden; background: #0a1324; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
  canvas.ui { pointer-events: none; z-index: 2; }
  .scale { position: absolute; right: 10px; bottom: 8px; z-index: 3; font: 11px var(--mono); color: #6f86a8; pointer-events: none; }
</style>
