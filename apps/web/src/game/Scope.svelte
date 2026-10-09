<script lang="ts">
  import { dayClock } from '../lib/settings.svelte.ts';
  import { onMount } from 'svelte';
  import { createScene, type Scene } from '@squawk/render';
  import { find, flowPenalty, geo, route, routeStart, startHdg, taxiTarget, viaNames, type Aircraft, type Command, type XY } from '@squawk/sim';
  import { flightPlan, withCommands, type FlightPlan } from './flightplan.ts';
  import { viewFor } from './views.ts';
  import type { ShiftClient } from './client.ts';
  import { settings } from '../lib/settings.svelte.ts';
  import { dropAction, primaryAction, Feedback, type Action } from './assist.ts';
  import type { Need } from './needs.ts';

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
    queue: Need[];
    onAction: (cs: string, a: Action) => void;
    /** Keep the camera on this aircraft. */
    follow?: string | null;
    /** The player moved the camera by hand (pan or zoom). */
    onUserCamera?: (how: 'pan' | 'zoom') => void;
  }
  let { client, selected, taxiEdit = $bindable(), overlays, onSelect, onRadial, onIssue, onTaxiDone, viewRequest, queue, onAction, follow = null, onUserCamera }: Props = $props();
  const feedback = new Feedback();
  let groundBubble = $state<{ x: number; y: number; n: number } | null>(null);
  let bubbles = $state<{ cs: string; x: number; y: number; oy: number; a: Action | null; level: string }[]>([]);

  let wrap: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let ui: HTMLCanvasElement;
  let scene: Scene | null = null;
  let mpp = $state(3);
  let anim: { from: { cx: number; cy: number; mpp: number }; to: { cx: number; cy: number; mpp: number }; t0: number } | null = null;

  const world = client.world;
  const apt = world.primary;

  onMount(() => {
    scene = createScene(canvas, client.packs, { pixelSize: settings.pixelSize, quality: settings.quality, depth: settings.depth, smooth: settings.smoothEdges });
    const cov = client.seats;
    const roles = cov.map(s => s.split(':').pop());
    const v = viewFor(apt, roles.includes('GND') || roles.includes('DEL') ? 'GND' : roles.includes('TWR') ? 'TWR' : roles.includes('DIR') ? 'DIR' : 'LON');
    const start = { cx: v.cx, cy: v.cy, mpp: v.mpp };
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
      } else if (follow) {
        // Ease the camera after the followed aircraft, keeping the player's zoom.
        const t = client.views(now).find(v => v.cs === follow);
        if (t) { const v = scene.getView(); scene.setView({ ...v, cx: v.cx + (t.x - v.cx) * 0.12, cy: v.cy + (t.y - v.cy) * 0.12 }); }
      }
      const snap = client.snap;
      scene.setAircraft([...client.views(now), ...client.fillerViews()]);
      scene.setVehicles(snap.vehicles.map(v => ({ id: v.id, kind: v.kind, x: v.x, y: v.y, hdg: v.hdg, lights: v.lights })));
      scene.setIncidents((snap.incidents ?? []).map(i => ({ id: i.id, x: i.x, y: i.y, fire: i.fire, kind: i.kind, resolved: i.resolved })));
      scene.setTime(dayClock(client.time(now), client.cfg.start));
      const w = snap.weather;
      scene.setWeather({ rain: w.wx.some(x => x.includes('RA') || x.includes('DZ')) ? (w.wx.some(x => x.startsWith('+')) ? 1 : 0.55) : 0, visM: w.visM, windKt: w.wind.kt, cloud: w.ceilingFt !== null ? Math.max(0.2, Math.min(1, 1 - w.ceilingFt / 5000)) : 0.1, cells: w.cells });
      const as = snap.apts[0];
      scene.setRunwaysInUse(as.arr, as.dep);
      scene.setSelected(selected);
      // The selected aircraft's route lines are drawn inside the scene, beneath aircraft and data tags.
      const sel = selected && !(drag?.vector && drag.moved) ? find(snap, selected) : undefined;
      scene.setUnderlay(sel ? (c) => { if (!sel.onGround) drawPlan(c, sel, flightPlan(world, sel), '#eef3f8', true); else if (!taxiEdit) drawGround(c, sel); } : null);
      scene.setAttention(Object.fromEntries(queue.map(n => [n.cs, n.level as 'routine' | 'urgent' | 'emergency'])));
      scene.setOverlays({ ...overlays, ctr: true, rings: true });
      scene.setGreens(greens());
      scene.setStopBars(stopBars());
      scene.render();
      mpp = scene.getView().mpp;
      feedback.update(snap, now);
      placeBubbles();
      drawUi(now);
    };
    frame();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); scene?.dispose(); };
  });

  $effect(() => { const on = settings.smoothEdges; scene?.setSmooth(on); }); // applies live, from the in-game settings too
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

  /** One-click bubbles next to the aircraft that need you most. */
  function placeBubbles() {
    const out: typeof bubbles = [];
    const w = wrap.clientWidth, h = wrap.clientHeight;
    const views = new Map(client.views().map(v => [v.cs, v]));
    const waiting = new Set(client.snap!.pending.map(p => p.cs));
    const items = [...[...waiting].map(cs => ({ cs, level: 'routine' })), ...queue.slice(0, 8).filter(n => !waiting.has(n.cs))];
    // Zoomed out to the radar, ground traffic is a dot: fold its bubbles into one summary at the airport.
    const radar = mpp > 6;
    let onGround = 0;
    for (const n of items) {
      const v = views.get(n.cs);
      if (radar && v?.onGround) { if (!waiting.has(n.cs)) onGround++; continue; }
      const a = waiting.has(n.cs) ? null : primaryAction(world, client.snap!, n as Need);
      if ((!a && !waiting.has(n.cs)) || !v || taxiEdit) continue;
      const p = scene!.worldToScreen(v);
      if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue;
      const x = Math.round(p.x), y = Math.round(p.y);
      // Stack bubbles upwards so neighbours (e.g. two aircraft at adjacent holds) never overlap.
      let oy = 0;
      while (out.some(b => Math.abs(b.x - x) < 170 && Math.abs(b.y + b.oy - (y + oy)) < 30)) oy -= 32;
      out.push({ cs: n.cs, x, y, oy, a, level: n.level });
      if (out.length >= 6) break;
    }
    const gp = onGround ? scene!.worldToScreen(apt.offset) : null;
    const gb = gp ? { x: Math.round(gp.x), y: Math.round(gp.y), n: onGround } : null;
    if (gb?.x !== groundBubble?.x || gb?.y !== groundBubble?.y || gb?.n !== groundBubble?.n) groundBubble = gb;
    // Avoid rewriting state every frame when nothing moved.
    if (out.length !== bubbles.length || out.some((b, i) => b.cs !== bubbles[i].cs || b.x !== bubbles[i].x || b.y !== bubbles[i].y || b.oy !== bubbles[i].oy || b.a?.label !== bubbles[i].a?.label)) bubbles = out;
  }

  function drawUi(now = performance.now()) {
    const dpr = devicePixelRatio || 1;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (ui.width !== Math.round(w * dpr) || ui.height !== Math.round(h * dpr)) { ui.width = Math.round(w * dpr); ui.height = Math.round(h * dpr); }
    const ctx = ui.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!scene) return;
    const S = (p: XY) => scene!.worldToScreen(p);
    // Pulses on aircraft that need you.
    const views = new Map(client.views().map(v => [v.cs, v]));
    for (const n of queue.slice(0, 10)) {
      const v = views.get(n.cs);
      if (!v || n.level === 'routine') continue;
      const p = S(v);
      const k = (now / 900) % 1;
      ctx.strokeStyle = n.level === 'emergency' ? `rgba(255,90,90,${1 - k})` : `rgba(255,181,71,${0.9 - k * 0.9})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 12 + k * 16, 0, Math.PI * 2); ctx.stroke();
    }
    // Conflicts: a line between the pair with the actual distance and height difference, so the alarm explains itself.
    for (const [key, lvl] of Object.entries(client.snap!.stca ?? {})) {
      const [ca, cb] = key.split('|'); const A = views.get(ca), B = views.get(cb);
      if (!A || !B || key.endsWith('|w')) continue;
      const p = S(A), q = S(B), col = lvl === 'conflict' ? '#ff5a5a' : '#ffb547';
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.setLineDash([]);
      const nm = Math.hypot(A.x - B.x, A.y - B.y) / 1852, ft = Math.round(Math.abs(A.alt - B.alt) / 100) * 100;
      const text = lvl === 'conflict' ? `${nm.toFixed(1)} nm · ${ft} ft, too close` : `converging · ${nm.toFixed(1)} nm · ${ft} ft`;
      ctx.font = "600 12px 'IBM Plex Mono', ui-monospace, monospace";
      const w = ctx.measureText(text).width, mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
      ctx.fillStyle = 'rgba(7,14,28,0.9)'; ctx.fillRect(mx - w / 2 - 6, my - 10, w + 12, 20);
      ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, mx, my); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
    // Score pops float up and fade.
    ctx.font = "600 13px 'IBM Plex Sans', system-ui, sans-serif"; ctx.textAlign = 'center';
    for (const pop of feedback.pops) {
      const k = (now - pop.t0) / 2200, p = S(pop);
      ctx.globalAlpha = Math.max(0, 1 - k);
      ctx.fillStyle = pop.good ? '#4ff0b4' : '#ff5a5a';
      ctx.fillText(pop.text, p.x, p.y - 22 - k * 34);
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
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
    // The selected aircraft's filed route (dashed) and where it is really going (solid, a tick a minute).
    const selAc = selected && !(drag?.vector && drag.moved) ? find(client.snap!, selected) : undefined;
    void selAc; // drawn under the tags by the scene (see setUnderlay in the frame loop)
    // Drag-to-target: preview exactly what letting go will do (the new path in the air, the taxi route on the ground).
    if (drag?.vector && drag.cur && drag.moved) {
      const ac = find(client.snap!, drag.vector);
      if (ac) {
        const a = S(ac), b = S(drag.cur);
        const act = dropAction(world, client.snap!, ac, drag.cur, mpp);
        const col = !act ? '#7d90ae' : act.tone === 'go' ? '#4ff0b4' : act.tone === 'warn' ? '#ffb547' : '#ffffff';
        const preview = act?.cmds && !ac.onGround ? flightPlan(world, withCommands(ac, act.cmds)) : null;
        const taxi = act?.taxi && ac.onGround ? taxiPreview(ac, act.taxi.to) : null;
        if (preview) drawPlan(ctx, ac, preview, col, false);
        else if (taxi) {
          const tapt = world.byIcao[ac.apt] ?? apt;
          ctx.strokeStyle = act?.taxi?.greens ? '#5dff8a' : '#ffd84a'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
          ctx.beginPath(); taxi.forEach((n, i) => { const p = S(tapt.nodes[n]); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke(); ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
        const label = act?.label ?? 'Drop on a runway, holding point, final approach, stack or fix';
        ctx.font = "600 13px 'IBM Plex Sans', system-ui, sans-serif";
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(7,14,28,0.9)'; ctx.fillRect(b.x + 10, b.y - 26, tw + 14, 22);
        ctx.fillStyle = col; ctx.fillText(label, b.x + 17, b.y - 10);
      }
    }
  }

  /** Draw a flight plan: the filed route dashed in blue (with fix names), the projected path solid with a tick each minute. */
  function drawPlan(ctx: CanvasRenderingContext2D, ac: Aircraft, fp: FlightPlan | null, col: string, showPlan: boolean) {
    if (!fp || !scene) return;
    const S = (p: XY) => scene!.worldToScreen(p);
    const start = scene.worldToScreen(ac);
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (showPlan && fp.plan.length > 1) {
      ctx.strokeStyle = 'rgba(108,183,255,0.85)'; ctx.lineWidth = 2; ctx.setLineDash([7, 6]);
      ctx.beginPath(); ctx.moveTo(start.x, start.y); for (const p of fp.plan.slice(1)) { const q = S(p); ctx.lineTo(q.x, q.y); } ctx.stroke(); ctx.setLineDash([]);
      ctx.font = "600 11px 'IBM Plex Mono', ui-monospace, monospace"; ctx.textBaseline = 'middle';
      for (const f of fp.fixes) {
        const q = S(f.p);
        ctx.fillStyle = '#6cb7ff'; ctx.beginPath(); ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(7,14,28,0.8)'; const w = ctx.measureText(f.name).width; ctx.fillRect(q.x + 7, q.y - 8, w + 8, 16);
        ctx.fillStyle = '#cfe6ff'; ctx.fillText(f.name, q.x + 11, q.y);
      }
      if (fp.end) {
        let q = S(fp.end.p);
        if (fp.end.dir !== undefined) {
          // Departures: an arrow on past the last fix, toward the destination.
          const b = (fp.end.dir * Math.PI) / 180, far = S({ x: fp.end.p.x + Math.sin(b) * 9000, y: fp.end.p.y + Math.cos(b) * 9000 });
          ctx.strokeStyle = 'rgba(108,183,255,0.85)'; ctx.setLineDash([7, 6]); ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(far.x, far.y); ctx.stroke(); ctx.setLineDash([]);
          const a = Math.atan2(far.y - q.y, far.x - q.x);
          ctx.fillStyle = '#6cb7ff'; ctx.beginPath(); ctx.moveTo(far.x, far.y); ctx.lineTo(far.x - 10 * Math.cos(a - 0.45), far.y - 10 * Math.sin(a - 0.45)); ctx.lineTo(far.x - 10 * Math.cos(a + 0.45), far.y - 10 * Math.sin(a + 0.45)); ctx.fill();
          q = far;
        }
        ctx.font = "600 12px 'IBM Plex Sans', system-ui, sans-serif";
        const w = ctx.measureText(fp.end.text).width;
        ctx.fillStyle = 'rgba(7,14,28,0.85)'; ctx.fillRect(q.x + 8, q.y - 10, w + 12, 20);
        ctx.fillStyle = '#6cb7ff'; ctx.fillText(fp.end.text, q.x + 14, q.y);
      }
    }
    if (fp.track.length) {
      ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.95;
      ctx.beginPath(); ctx.moveTo(start.x, start.y); for (const p of fp.track) { const q = S(p); ctx.lineTo(q.x, q.y); } ctx.stroke();
      ctx.font = "500 11px 'IBM Plex Mono', ui-monospace, monospace"; ctx.textBaseline = 'middle';
      for (const m of fp.minutes) {
        const q = S(m.p);
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(7,14,28,0.75)'; const w = ctx.measureText(m.text).width; ctx.fillRect(q.x + 6, q.y + 4, w + 6, 15);
        ctx.fillStyle = col; ctx.fillText(m.text, q.x + 9, q.y + 12);
      }
      if (fp.level) {
        // Level-off marker: a bar across the track where it reaches the cleared level.
        const q = S(fp.level.p);
        ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(q.x - 7, q.y); ctx.lineTo(q.x + 7, q.y); ctx.stroke();
        ctx.font = "600 11px 'IBM Plex Mono', ui-monospace, monospace";
        const w = ctx.measureText(fp.level.text).width;
        ctx.fillStyle = 'rgba(7,14,28,0.85)'; ctx.fillRect(q.x + 10, q.y - 9, w + 8, 17);
        ctx.fillStyle = '#ffb547'; ctx.fillText(fp.level.text, q.x + 14, q.y);
      }
    }
    ctx.restore();
  }
  /** On the ground: the route it is cleared along (solid), or the route it wants and where to (dashed), so the next instruction is obvious. */
  function drawGround(ctx: CanvasRenderingContext2D, ac: Aircraft) {
    const tapt = world.byIcao[ac.apt] ?? apt;
    const S = (p: XY) => scene!.worldToScreen(p);
    const moving = ['taxi', 'taxiin', 'vacating', 'lineup'].includes(ac.phase) && ac.pi < ac.path.length;
    const wants = ac.kind === 'dep' ? (['stand', 'pushing', 'pushed'].includes(ac.phase) ? ac.runway : null) : (ac.phase === 'taxiin' || ac.phase === 'vacating') && !moving ? ac.stand : null;
    let path: number[] | null = null, label = '', cleared = false;
    if (moving) {
      path = [...ac.path.slice(ac.pi)]; cleared = true;
      const last = tapt.nodes[ac.path[ac.path.length - 1]];
      const to = last?.hold ? `holding point ${last.hold}` : last?.stand ? `stand ${last.stand}` : ac.runway ?? '';
      label = `Taxiing to ${to}${ac.holdAt !== null && ac.holdAt !== ac.path[ac.path.length - 1] ? ' · holding short on the way' : ''}`;
    } else if (wants) {
      path = taxiPreview(ac, wants);
      const last = path ? tapt.nodes[path[path.length - 1]] : null;
      const where = ac.kind === 'dep' ? `runway ${wants}${last?.hold ? ` (holding point ${last.hold})` : ''}` : `stand ${wants}`;
      label = ac.phase === 'stand' ? `After pushback: ${where}` : `Wants to taxi to ${where}${path ? ` via ${viaNames(tapt, path).join(' ') || 'the apron'}` : ''}`;
    }
    if (!path || path.length < 2) return;
    const col = ac.cleared.greens ? '#5dff8a' : cleared ? '#ffd84a' : '#6cb7ff';
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const a = S(ac);
    const line = () => { ctx.beginPath(); ctx.moveTo(a.x, a.y); for (const n of path!) { const q = S(tapt.nodes[n]); ctx.lineTo(q.x, q.y); } };
    // Dark casing under the line so it reads over grass, concrete and taxiway paint alike.
    ctx.strokeStyle = 'rgba(5,10,20,0.75)'; ctx.lineWidth = 7; line(); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 3.5; ctx.globalAlpha = ac.phase === 'stand' ? 0.8 : 1;
    if (!cleared) ctx.setLineDash([10, 7]);
    line(); ctx.stroke(); ctx.setLineDash([]);
    const end = S(tapt.nodes[path[path.length - 1]]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(end.x, end.y, 5, 0, Math.PI * 2); ctx.fill();
    // The caption goes at the far end; a route ending right by the aircraft (a line-up) would put it on top of its label.
    if (Math.hypot(end.x - a.x, end.y - a.y) > 80) {
      ctx.font = "600 12px 'IBM Plex Sans', system-ui, sans-serif"; ctx.textBaseline = 'middle';
      const w = ctx.measureText(label).width;
      const lx = Math.min(end.x + 10, wrap.clientWidth - w - 20), ly = end.y - 18;
      ctx.fillStyle = 'rgba(7,14,28,0.88)'; ctx.fillRect(lx, ly - 11, w + 14, 22);
      ctx.fillStyle = col; ctx.fillText(label, lx + 7, ly);
    }
    ctx.restore();
  }
  /** The taxi route a drop would give (same routing as the sim), cached while the drag stays on one target. */
  let taxiMemo: { key: string; path: number[] | null } | null = null;
  function taxiPreview(ac: Aircraft, to: string): number[] | null {
    const key = ac.cs + '>' + to + '@' + (client.snap!.tick >> 4); // re-route every few seconds as traffic moves
    if (taxiMemo?.key === key) return taxiMemo.path;
    const tapt = world.byIcao[ac.apt] ?? apt;
    const tgt = taxiTarget(world, ac, to);
    const path = tgt === null ? null : route(tapt, routeStart(world, ac), tgt, { penalty: flowPenalty(client.snap!, tapt, ac), hdg: startHdg(ac) });
    taxiMemo = { key, path };
    return path;
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
    // Drag out of any of your aircraft to send it somewhere (runway, holding point, final, stack, fix, or a heading).
    const ac = hit ? find(client.snap!, hit) : null;
    const vector = e.button === 0 && !taxiEdit && ac && client.seats.includes(ac.freq) ? hit : null;
    drag = { x: p.x, y: p.y, moved: false, vector, cur: null, button: e.button };
    canvas.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!drag || !scene) return;
    const p = local(e);
    if (Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y) > 4) drag.moved = true;
    if (drag.vector) { drag.cur = scene.screenToWorld(p.x, p.y); return; }
    if (drag.moved && drag.button === 0) {
      onUserCamera?.('pan');
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
      const act = dropAction(world, client.snap!, ac, drag.cur, mpp);
      onSelect(ac.cs);
      if (act) onAction(ac.cs, act);
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
    onUserCamera?.('zoom');
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
  {#if groundBubble}
    <button class="bubble info" style="left:{groundBubble.x + 16}px; top:{groundBubble.y - 34}px" onpointerdown={(e) => { e.stopPropagation(); const v = viewFor(apt, 'GND'); zoomTo(v.cx, v.cy, v.mpp); }} title="Zoom in to the ground traffic">
      <span class="cs">{apt.icao}</span>{groundBubble.n} on the ground waiting
    </button>
  {/if}
  {#each bubbles as b (b.cs)}
    {#if b.a}
      {@const a = b.a}
      <!-- Two targets: the callsign selects the aircraft, the action does it straight away. Both fire on press, so a bubble
           that moves with its aircraft can't lose the click. -->
      <div class="bubble split {a.tone} {b.level}" style="left:{b.x + 16}px; top:{b.y - 34 + b.oy}px">
        <button class="sel" onpointerdown={(e) => { if (e.button === 0) { e.stopPropagation(); onSelect(b.cs); } }} onkeydown={(e) => { if (e.key === 'Enter') onSelect(b.cs); }} title="Select {b.cs}">{b.cs}</button>
        <button class="act" onpointerdown={(e) => { if (e.button === 0) { e.stopPropagation(); onAction(b.cs, a); } }} onkeydown={(e) => { if (e.key === 'Enter') onAction(b.cs, a); }} title="{b.cs}: {a.label}">{a.label}</button>
      </div>
    {:else}
      <div class="bubble wait" style="left:{b.x + 16}px; top:{b.y - 34 + b.oy}px" title="{b.cs} is reading back">
        <span class="cs">{b.cs}</span><span class="dots"><i></i><i></i><i></i></span>
      </div>
    {/if}
  {/each}
  <div class="scale">{mpp < 8 ? `${mpp.toFixed(1)} m/px` : `${((mpp * 900) / 1852).toFixed(0)} nm across`}</div>
</div>

<style>
  .scope { position: relative; width: 100%; height: 100%; overflow: hidden; background: #0a1324; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
  canvas.ui { pointer-events: none; z-index: 2; }
  .bubble { position: absolute; z-index: 4; display: flex; gap: 6px; align-items: baseline; padding: 4px 10px; border-radius: 14px; border: 1px solid var(--line-strong);
    background: rgba(13, 22, 40, 0.92); color: var(--ink-strong); font: 600 12.5px var(--ui); cursor: pointer; white-space: nowrap; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35); }
  .bubble .cs { font: 500 11px var(--mono); color: var(--muted); }
  .bubble.split { padding: 0; gap: 0; align-items: stretch; overflow: hidden; cursor: default; }
  .bubble.split button { border: none; background: transparent; color: inherit; cursor: pointer; font: inherit; }
  .bubble.split .sel { padding: 4px 8px 4px 10px; font: 500 11px var(--mono); color: var(--muted); border-right: 1px solid var(--line-strong); }
  .bubble.split .sel:hover { color: var(--ink-strong); background: rgba(255, 255, 255, 0.08); }
  .bubble.split .act { padding: 4px 10px 4px 8px; }
  .bubble.split.go:hover { background: rgba(13, 22, 40, 0.92); color: var(--ink-strong); }
  .bubble.split.go .act:hover { background: var(--green); color: var(--bg); }
  .bubble.split.warn .act:hover { background: var(--amber); color: var(--bg); }
  .bubble.split.info .act:hover { color: var(--accent); }
  .bubble.go { border-color: var(--green); }
  .bubble.go:hover { background: var(--green); color: var(--bg); }
  .bubble.warn { border-color: var(--amber); color: var(--amber); }
  .bubble.warn:hover { background: var(--amber); color: var(--bg); }
  .bubble.info:hover { border-color: var(--accent); color: var(--accent); }
  .bubble.emergency { box-shadow: 0 0 0 2px var(--red); }
  .bubble:hover .cs { color: inherit; }
  .bubble.wait { cursor: default; border-color: var(--accent); pointer-events: none; }
  .dots { display: inline-flex; gap: 3px; align-items: center; height: 12px; }
  .dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); animation: dot 1s infinite ease-in-out; }
  .dots i:nth-child(2) { animation-delay: 0.15s; }
  .dots i:nth-child(3) { animation-delay: 0.3s; }
  @keyframes dot { 0%, 80%, 100% { opacity: 0.25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
  .scale { position: absolute; right: 10px; bottom: 8px; z-index: 3; font: 11px var(--mono); color: #6f86a8; pointer-events: none; }
</style>
