// Crisp 2D radar scope drawn on an overlay canvas: map underlay, scope symbology, blips and data tags.
import type { AircraftView, AirportPack, XY } from '@squawk/sim/types';
import { NM } from '@squawk/sim/geo';

export const TAG_FONT = "500 11.5px 'IBM Plex Mono', ui-monospace, Consolas, monospace";
export const SMALL_FONT = "500 10px 'IBM Plex Mono', ui-monospace, Consolas, monospace";

const DAY = {
  bg: '#0a1426', apron: '#14223a', rwy: '#33456a', bldg: '#1a2a46', coast: '#2a5466', river: '#1e3d63', motorway: '#2a3552',
  ring: '#1b2c4a', ringTxt: '#3f5780', cl: '#4a6a99', fix: '#55709b', fixTxt: '#6683b0', stack: '#86a2d4', ctr: '#2d4b7a',
  sid: '#2f7c84', star: '#7a68ad', own: '#4ff0b4', other: '#7d8fa8', sel: '#ffffff', amber: '#ffb020', red: '#ff4d4d', city: '#ffb35a',
};
type Pal = typeof DAY;
const NIGHT: Pal = {
  ...DAY, bg: '#050a16', apron: '#0f1a2e', rwy: '#26365a', bldg: '#14213a', ring: '#132139', ringTxt: '#2f4466', cl: '#3a557f',
  fix: '#41597f', fixTxt: '#4e6a94', stack: '#6a85b5', ctr: '#22395f', own: '#3fd9a0', other: '#62748e', sel: '#e8ecf2',
};

export interface Affine { a: number; b: number; c: number; d: number; e: number; f: number } // sx = a x + c y + e; sy = b x + d y + f
export interface RadarFrame {
  w: number; h: number; dpr: number; M: Affine; mpp: number;
  fade: number;          // 0 = airport tier, 1 = pure radar
  night: boolean;
  now: number;           // ms, for flashing
  aircraft: AircraftView[];
  screenOf: (ac: AircraftView) => XY; // projected 3D position (airport tier)
  groundOf: (p: XY) => XY;              // projected ground point (airport tier)
  sizeOf: (ac: AircraftView) => number; // aircraft half-length in px (airport tier)
  selected: string | null;
  overlays: { sids?: boolean; stars?: boolean; weather?: boolean; ctr?: boolean; rings?: boolean };
  arr: string[]; dep: string[];
  /** Aircraft waiting on the player, and how badly. */
  underlay?: (ctx: CanvasRenderingContext2D) => void;
  attention: Record<string, 'routine' | 'urgent' | 'emergency'>;
  cells: { x: number; y: number; r: number; intensity: number }[];
}

type Label = { x: number; y: number; text: string; kind: 'rwy' | 'twy' | 'hold' | 'stand' };
interface PackPaths { pack: AirportPack; off: XY; aprons: Path2D; rwys: Path2D; bldgs: Path2D; twy: Path2D; labels: Label[] }

function hash(n: number) { n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; }

export class Radar {
  private packs: PackPaths[];
  private map: Record<string, Path2D> = {};
  private city: XY[] = [];
  private tagPos = new Map<string, number>();
  readonly ctx: CanvasRenderingContext2D;

  constructor(readonly canvas: HTMLCanvasElement, packs: { pack: AirportPack; off: XY }[]) {
    this.ctx = canvas.getContext('2d')!;
    this.packs = packs.map(({ pack, off }) => {
      const poly = (pts: XY[], p = new Path2D()) => { pts.forEach((q, i) => (i ? p.lineTo(q.x + off.x, q.y + off.y) : p.moveTo(q.x + off.x, q.y + off.y))); p.closePath(); return p; };
      const aprons = new Path2D(), rwys = new Path2D(), bldgs = new Path2D(), twy = new Path2D();
      for (const s of pack.surfaces) poly(s.poly, s.kind === 'runway' ? rwys : aprons);
      for (const b of pack.buildings) poly(b.poly, bldgs);
      for (const r of pack.runways) { // runway symbol: works even for packs without surfaces
        const [a, b] = r.ends, dx = b.end.x - a.end.x, dy = b.end.y - a.end.y, l = Math.hypot(dx, dy), nx = (-dy / l) * r.widthM / 2, ny = (dx / l) * r.widthM / 2;
        poly([{ x: a.end.x + nx, y: a.end.y + ny }, { x: b.end.x + nx, y: b.end.y + ny }, { x: b.end.x - nx, y: b.end.y - ny }, { x: a.end.x - nx, y: a.end.y - ny }], rwys);
      }
      const byId = new Map(pack.taxi.nodes.map(n => [n.id, n]));
      for (const e of pack.taxi.edges) if (!e.runway) { const a = byId.get(e.a)!, b = byId.get(e.b)!; twy.moveTo(a.x + off.x, a.y + off.y); twy.lineTo(b.x + off.x, b.y + off.y); }
      // Names you can say on the radio: taxiways (every ~300 m along each), holding points and stands.
      const labels: Label[] = [];
      for (const e of pack.taxi.edges) {
        if (!e.name || e.runway) continue;
        const a = byId.get(e.a)!, b = byId.get(e.b)!;
        if (Math.hypot(b.x - a.x, b.y - a.y) < 40) continue;
        const m = { x: (a.x + b.x) / 2 + off.x, y: (a.y + b.y) / 2 + off.y };
        if (labels.some(l => l.text === e.name && Math.hypot(l.x - m.x, l.y - m.y) < 300)) continue;
        labels.push({ ...m, text: e.name, kind: 'twy' });
      }
      for (const n of pack.taxi.nodes) if (n.hold) labels.push({ x: n.x + off.x, y: n.y + off.y, text: n.hold, kind: 'hold' });
      // Runway designators just beyond each threshold, on the runway, as painted.
      for (const r of pack.runways) for (const [i, e] of r.ends.entries()) {
        const o = r.ends[1 - i], dx = o.thr.x - e.thr.x, dy = o.thr.y - e.thr.y, l = Math.hypot(dx, dy) || 1;
        labels.push({ x: e.thr.x + (dx / l) * 220 + off.x, y: e.thr.y + (dy / l) * 220 + off.y, text: e.name, kind: 'rwy' });
      }
      for (const s of pack.stands) { const n = byId.get(s.node); if (n) labels.push({ x: n.x + off.x, y: n.y + off.y, text: s.ref, kind: 'stand' }); }
      const order = { rwy: 0, hold: 1, twy: 2, stand: 3 }; // drawing priority when labels collide
      labels.sort((a, b) => order[a.kind] - order[b.kind]);
      return { pack, off, aprons, rwys, bldgs, twy, labels };
    });
    const prim = packs[0].pack;
    for (const l of prim.airspace.map) {
      const p = (this.map[l.kind] ??= new Path2D());
      l.pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
    }
    // City lights: scattered along roads and rivers, denser toward central London (~24 km east).
    const src = prim.airspace.map.filter(l => l.kind !== 'coast').flatMap(l => l.pts);
    for (let i = 0; i < 9000 && src.length; i++) {
      const p = src[Math.floor(hash(i * 3 + 1) * src.length)];
      const r = 300 + hash(i * 7 + 2) * 2600, t = hash(i * 11 + 5) * Math.PI * 2;
      const q = { x: p.x + Math.cos(t) * r, y: p.y + Math.sin(t) * r };
      const dl = Math.hypot(q.x - 24000, q.y - 2000), dh = Math.hypot(q.x, q.y);
      if (dh < 3200) continue;
      if (hash(i * 13 + 9) < Math.exp(-dl / 18000) + 0.12) this.city.push(q);
    }
  }

  /** Taxiway letters (yellow-on-black signs), holding points and stands, when zoomed in on the ground. */
  private drawGroundLabels(F: RadarFrame) {
    const { ctx } = this;
    const a0 = ctx.globalAlpha;
    const stands = F.mpp < 1.1;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    // Aircraft win: a sign never sits on top of a plane (reserve each one, with its callsign tag below it).
    for (const ac of F.aircraft) { const q = F.screenOf(ac), r = Math.max(10, F.sizeOf(ac)); if (q.x > -40 && q.y > -40 && q.x < F.w + 40 && q.y < F.h + 40) placed.push({ x: q.x - r, y: q.y - r, w: 2 * r, h: 2 * r + 16 }); }
    for (const pk of this.packs) for (const l of pk.labels) {
      if (l.kind === 'stand' && !stands) continue;
      if (l.kind !== 'rwy' && F.mpp >= 2.2) continue;
      const p = F.groundOf(l);
      if (p.x < -20 || p.y < -20 || p.x > F.w + 20 || p.y > F.h + 20) continue;
      ctx.font = l.kind === 'rwy' ? "700 15px 'IBM Plex Sans', system-ui, sans-serif" : l.kind === 'stand' ? "500 9px 'IBM Plex Mono', monospace" : "700 11px 'IBM Plex Sans', system-ui, sans-serif";
      const w = Math.ceil(ctx.measureText(l.text).width) + (l.kind === 'rwy' ? 14 : 8), h = l.kind === 'rwy' ? 22 : l.kind === 'stand' ? 13 : 16;
      const x = Math.round(p.x - w / 2), y = Math.round(p.y - h / 2);
      if (placed.some(b => x < b.x + b.w + 2 && b.x < x + w + 2 && y < b.y + b.h + 2 && b.y < y + h + 2)) continue;
      placed.push({ x, y, w, h });
      // Airfield sign colours: location (taxiway) black on yellow, mandatory (holding point) white on red.
      // Runways: white designator on a dark plate with a white outline.
      if (l.kind === 'rwy') { ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(8,12,20,0.85)'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5); ctx.fillStyle = '#fff'; ctx.fillText(l.text, Math.round(p.x), Math.round(p.y) + 1); continue; }
      ctx.fillStyle = l.kind === 'twy' ? '#f5c518' : l.kind === 'hold' ? '#c8102e' : 'rgba(10,18,32,0.7)';
      ctx.globalAlpha = a0 * (l.kind === 'stand' ? 0.85 : 0.95);
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = l.kind === 'twy' ? '#111' : '#fff';
      ctx.fillText(l.text, Math.round(p.x), Math.round(p.y) + 1);
    }
    ctx.globalAlpha = a0;
  }

  /** Where each aircraft's label was drawn last frame (screen px), so clicking a tag selects its aircraft. */
  tagRects: { cs: string; x: number; y: number; w: number; h: number }[] = [];

  draw(F: RadarFrame) {
    const { ctx, packs } = this;
    this.tagRects = [];
    const P: Pal = F.night ? NIGHT : DAY;
    const { M, dpr } = F;
    const S = (p: XY): XY => ({ x: M.a * p.x + M.c * p.y + M.e, y: M.b * p.x + M.d * p.y + M.f });
    const world = () => ctx.setTransform(M.a * dpr, M.b * dpr, M.c * dpr, M.d * dpr, M.e * dpr, M.f * dpr);
    const screen = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const px = F.mpp; // one css pixel in world metres
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const fade = F.fade;
    const prim = packs[0].pack;
    const flash = Math.floor(F.now / 400) % 2 === 0;

    if (fade > 0) {
      screen();
      ctx.globalAlpha = Math.min(1, fade * 1.6); // the scope background closes in before the symbology arrives
      ctx.fillStyle = P.bg; ctx.fillRect(0, 0, F.w, F.h);
      ctx.globalAlpha = fade;
      // ---- map underlay
      world();
      ctx.lineJoin = 'round';
      if (F.night) {
        const g = ctx.createRadialGradient(24000, 2000, 0, 24000, 2000, 30000);
        g.addColorStop(0, 'rgba(255,170,90,0.10)'); g.addColorStop(1, 'rgba(255,170,90,0)');
        ctx.fillStyle = g; ctx.fillRect(-6000, -28000, 60000, 60000);
        ctx.fillStyle = P.city;
        const s = 1.2 * px;
        for (let i = 0; i < this.city.length; i++) {
          ctx.globalAlpha = fade * (0.18 + hash(i) * 0.3);
          const q = this.city[i]; ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s);
        }
        ctx.globalAlpha = fade;
      }
      for (const [k, col, wpx] of [['coast', P.coast, 1.2], ['river', P.river, 1], ['motorway', P.motorway, 1]] as const) {
        const p = this.map[k]; if (!p) continue;
        ctx.strokeStyle = col; ctx.lineWidth = wpx * px; ctx.stroke(p);
      }
      for (const pp of packs) {
        ctx.fillStyle = P.apron; ctx.fill(pp.aprons);
        ctx.strokeStyle = P.apron; ctx.lineWidth = Math.max(23, px); ctx.stroke(pp.twy);
        ctx.fillStyle = P.bldg; ctx.fill(pp.bldgs);
        ctx.fillStyle = P.rwy; ctx.fill(pp.rwys);
        ctx.strokeStyle = P.rwy; ctx.lineWidth = 2.5 * px; ctx.stroke(pp.rwys);
      }
      // ---- scope symbology
      const ov = F.overlays;
      if (ov.weather) for (const c of F.cells) {
        const bands: [number, string, number][] = [[1, '#1d6b3a', 0.35], [0.62, '#a48d1c', 0.45], [0.32, '#a3262b', 0.55]];
        for (const [f, col, al] of bands) {
          if (f < 1 && c.intensity < (f > 0.5 ? 0.4 : 0.7)) continue;
          ctx.globalAlpha = fade * al; ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(c.x, c.y, c.r * f * (0.9 + 0.1 * c.intensity), 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = fade;
      }
      if (ov.rings !== false) {
        const step = F.mpp < 120 ? 5 : 10;
        ctx.strokeStyle = P.ring; ctx.lineWidth = px;
        for (let n = step; n <= 150; n += step) { ctx.beginPath(); ctx.arc(0, 0, n * NM, 0, Math.PI * 2); ctx.stroke(); }
      }
      if (ov.ctr !== false && prim.airspace.ctr.length) {
        ctx.setLineDash([6 * px, 4 * px]); ctx.strokeStyle = P.ctr; ctx.lineWidth = px;
        ctx.beginPath(); prim.airspace.ctr.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.stroke();
        ctx.setLineDash([]);
      }
      const fixes = prim.airspace.fixes;
      const route = (names: string[], start: XY | null, col: string, dash: number[]) => {
        const pts = names.map(n => fixes[n]).filter(Boolean) as XY[];
        if (start) pts.unshift(start);
        if (pts.length < 2) return;
        ctx.strokeStyle = col; ctx.lineWidth = px; ctx.setLineDash(dash.map(d => d * px));
        ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke(); ctx.setLineDash([]);
      };
      const endByName = new Map(prim.runways.flatMap(r => r.ends).map(e => [e.name, e]));
      if (ov.sids) for (const s of prim.airspace.sids) route(s.fixes, endByName.get(s.runway)?.thr ?? null, P.sid, [2, 3]);
      if (ov.stars) for (const s of prim.airspace.stars) route(s.fixes, null, P.star, [5, 3]);
      // extended centrelines with nm ticks
      ctx.strokeStyle = P.cl; ctx.lineWidth = px;
      for (const name of F.arr) {
        const e = endByName.get(name); if (!e) continue;
        const b = ((e.hdgTrue + 180) * Math.PI) / 180, ux = Math.sin(b), uy = Math.cos(b);
        ctx.setLineDash([4 * px, 4 * px]);
        ctx.beginPath(); ctx.moveTo(e.thr.x, e.thr.y); ctx.lineTo(e.thr.x + ux * 20 * NM, e.thr.y + uy * 20 * NM); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        for (let n = 1; n <= 20; n++) {
          const t = (n % 5 === 0 ? 7 : 3.5) * px, cx = e.thr.x + ux * n * NM, cy = e.thr.y + uy * n * NM;
          ctx.moveTo(cx - uy * t, cy + ux * t); ctx.lineTo(cx + uy * t, cy - ux * t);
        }
        ctx.stroke();
      }
      for (const name of F.dep) {
        const e = endByName.get(name); if (!e) continue;
        const b = (e.hdgTrue * Math.PI) / 180, other = prim.runways.find(r => r.ends.includes(e))!.ends.find(x => x !== e)!;
        ctx.globalAlpha = fade * 0.5; ctx.beginPath(); ctx.moveTo(other.thr.x, other.thr.y);
        ctx.lineTo(other.thr.x + Math.sin(b) * 3 * NM, other.thr.y + Math.cos(b) * 3 * NM); ctx.stroke(); ctx.globalAlpha = fade;
      }
      // holding stacks: racetrack with inbound leg ending at the fix
      ctx.strokeStyle = P.stack; ctx.lineWidth = 1.2 * px;
      for (const s of prim.airspace.stacks) {
        const f = fixes[s.fix]; if (!f) continue;
        const t = (s.inboundTrack * Math.PI) / 180, ux = Math.sin(t), uy = Math.cos(t);
        const sx = s.turn === 'R' ? uy : -uy, sy = s.turn === 'R' ? -ux : ux; // unit toward the turn side
        const leg = 4 * NM, r = 1.2 * NM;
        const a0 = { x: f.x - ux * leg, y: f.y - uy * leg };
        ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(f.x, f.y);
        const turnArc = (c: XY, from: XY) => {
          const ang0 = Math.atan2(from.y - c.y, from.x - c.x);
          for (let i = 1; i <= 16; i++) { const a = ang0 + (s.turn === 'R' ? -1 : 1) * Math.PI * (i / 16); ctx.lineTo(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r); }
        };
        turnArc({ x: f.x + sx * r, y: f.y + sy * r }, f);
        const b0 = { x: f.x + sx * 2 * r - ux * leg, y: f.y + sy * 2 * r - uy * leg };
        ctx.lineTo(b0.x, b0.y);
        turnArc({ x: a0.x + sx * r, y: a0.y + sy * r }, b0);
        ctx.stroke();
      }
      // fixes
      screen();
      ctx.font = SMALL_FONT; ctx.textBaseline = 'middle';
      const stackFixes = new Set(prim.airspace.stacks.map(s => s.fix));
      for (const f of Object.values(fixes)) {
        const q = S(f); if (q.x < -50 || q.y < -50 || q.x > F.w + 50 || q.y > F.h + 50) continue;
        const big = stackFixes.has(f.name);
        if (!big && F.mpp > 120) continue;
        const x = Math.round(q.x), y = Math.round(q.y);
        ctx.fillStyle = big ? P.stack : P.fix;
        ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x + 4, y + 3); ctx.lineTo(x - 4, y + 3); ctx.closePath();
        if (big) ctx.fill(); else { ctx.strokeStyle = P.fix; ctx.lineWidth = 1; ctx.stroke(); }
        ctx.fillStyle = big ? P.stack : P.fixTxt; ctx.fillText(f.name, x + 7, y);
      }
      for (const s of prim.airspace.stacks) {
        const f = fixes[s.fix]; if (!f) continue;
        const q = S(f); ctx.fillStyle = P.stack; ctx.fillText(`${s.minAltFt / 100 | 0}+`, Math.round(q.x) + 7, Math.round(q.y) + 10);
      }
      if (ov.rings !== false) {
        ctx.fillStyle = P.ringTxt;
        const step = F.mpp < 120 ? 5 : 10;
        for (let n = step; n <= 150; n += step) { const q = S({ x: 0, y: n * NM }); if (q.y > 6) ctx.fillText(`${n}`, Math.round(q.x) + 3, Math.round(q.y) + 6); }
      }
      for (const pp of packs.slice(1)) {
        const q = S(pp.off); ctx.fillStyle = P.fixTxt; ctx.fillText(pp.pack.icao, Math.round(q.x) + 10, Math.round(q.y) - 8);
      }
      ctx.globalAlpha = 1;
    }

    // ---- traffic
    screen();
    // The game's route lines go here: over the map, under the aircraft and their tags.
    if (F.underlay) { ctx.save(); F.underlay(ctx); ctx.restore(); screen(); }
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    const colOf = (ac: AircraftView) => {
      if (ac.alert === 'emergency') return flash ? P.red : P.sel;
      if (ac.alert === 'conflict') return flash ? P.red : P.amber;
      if (ac.alert === 'caution') return flash ? P.amber : ac.mine ? P.own : P.other;
      if (ac.cs === F.selected) return P.sel;
      return ac.mine ? P.own : P.other;
    };
    const list = [...F.aircraft].sort((a, b) => (a.cs === F.selected ? -1 : b.cs === F.selected ? 1 : 0) || +(b.alert !== 'none') - +(a.alert !== 'none'));

    if (fade < 1) { // airport tier: small callsign labels and selection brackets
      ctx.globalAlpha = Math.max(0, 1 - fade * 2.5);
      ctx.font = SMALL_FONT; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
      if (F.mpp < 9) this.drawGroundLabels(F);
      ctx.font = SMALL_FONT; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
      for (const ac of list) {
        if (ac.cs.startsWith("~")) continue; // parked scenery, no label
        const q = F.screenOf(ac), r = F.sizeOf(ac);
        if (q.x < -40 || q.y < -40 || q.x > F.w + 40 || q.y > F.h + 40) continue;
        const col = colOf(ac);
        const x = Math.round(q.x), y = Math.round(q.y + Math.max(8, r * 0.75) + 4);
        if (ac.cs === F.selected || ac.alert !== 'none') {
          const b = Math.round(Math.max(10, r + 4)), k = Math.max(4, b / 3);
          ctx.strokeStyle = col; ctx.lineWidth = 1;
          ctx.beginPath();
          for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const cx = Math.round(q.x) + sx * b + 0.5, cy = Math.round(q.y) + sy * b + 0.5;
            ctx.moveTo(cx - sx * k, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy - sy * k);
          }
          ctx.stroke();
        }
        if (F.mpp > 1.6 && ac.onGround && ac.gs < 1 && ac.cs !== F.selected) continue; // parked: no label when zoomed out
        const tw = ctx.measureText(ac.cs).width;
        ctx.fillStyle = 'rgba(6,10,20,0.55)'; ctx.fillRect(x - Math.ceil(tw / 2) - 2, y - 1, Math.ceil(tw) + 4, 10);
        ctx.fillStyle = col; ctx.fillText(ac.cs, x, y);
        this.tagRects.push({ cs: ac.cs, x: x - tw / 2 - 2, y: y - 1, w: tw + 4, h: 10 });
      }
      ctx.textAlign = 'left';
    }
    if (fade > 0) {
      ctx.globalAlpha = fade;
      ctx.font = TAG_FONT; ctx.textBaseline = 'top';
      const LH = 14;
      // reserve blip areas first
      for (const ac of list) { const q = S(ac); boxes.push({ x: q.x - 5, y: q.y - 5, w: 10, h: 10 }); }
      for (const ac of list) {
        const q = S(ac); const x = Math.round(q.x), y = Math.round(q.y);
        if (x < -100 || y < -100 || x > F.w + 100 || y > F.h + 100) continue;
        const col = colOf(ac);
        const parked = ac.onGround && ac.gs < 1;
        if (ac.onGround && F.mpp > 15 && ac.cs !== F.selected) continue; // the scope doesn't show ground traffic
        // history dots
        ctx.fillStyle = col;
        const n = ac.trail.length;
        for (let i = 0; i < n - 1; i++) {
          const t = S(ac.trail[i]);
          ctx.globalAlpha = fade * (0.15 + 0.55 * ((i + 1) / n));
          ctx.fillRect(Math.round(t.x) - 1, Math.round(t.y) - 1, 2, 2);
        }
        ctx.globalAlpha = fade;
        if (parked) { ctx.globalAlpha = fade * 0.5; ctx.fillRect(x - 1, y - 1, 3, 3); ctx.globalAlpha = fade; if (ac.cs !== F.selected) continue; }
        // position symbol
        if (ac.mine || ac.cs === F.selected) ctx.fillRect(x - 3, y - 3, 6, 6);
        else { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x - 3.5, y - 3.5, 7, 7); }
        if (ac.cs === F.selected) { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x - 6.5, y - 6.5, 13, 13); }
        // heading/speed vector: 1 minute ahead
        if (!ac.onGround) {
          const b = (ac.hdg * Math.PI) / 180, d = (ac.gs * NM) / 60;
          const v = S({ x: ac.x + Math.sin(b) * d, y: ac.y + Math.cos(b) * d });
          ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.globalAlpha = fade * 0.6; ctx.beginPath(); ctx.moveTo(x + 0.5, y + 0.5); ctx.lineTo(Math.round(v.x) + 0.5, Math.round(v.y) + 0.5); ctx.stroke(); ctx.globalAlpha = fade;
        }
        // data tag with simple 4-way placement
        const lines = ac.onGround ? ac.tag.slice(0, 1) : ac.tag;
        if (!lines.length) continue;
        const tw = Math.ceil(Math.max(...lines.map(l => ctx.measureText(l).width))) + 4, th = lines.length * LH + 3;
        const cands = [[14, -th - 8], [14, 8], [-14 - tw, -th - 8], [-14 - tw, 8], [30, -th / 2], [-30 - tw, -th / 2], [-tw / 2, -th - 22], [-tw / 2, 22]];
        const prev = this.tagPos.get(ac.cs) ?? 0;
        let best = 0, bestScore = Infinity;
        cands.forEach(([dx, dy], i) => {
          const r = { x: x + dx, y: y + dy, w: tw, h: th };
          let s = i === prev ? 0 : 30;
          for (const o of boxes) s += Math.max(0, Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x)) * Math.max(0, Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y));
          if (r.x < 0 || r.y < 0 || r.x + r.w > F.w || r.y + r.h > F.h) s += 500;
          if (s < bestScore) { bestScore = s; best = i; }
        });
        this.tagPos.set(ac.cs, best);
        const [dx, dy] = cands[best];
        const r = { x: x + dx, y: y + dy, w: tw, h: th };
        boxes.push(r);
        this.tagRects.push({ cs: ac.cs, ...r });
        // leader line to the nearest tag corner
        const lx = Math.max(r.x, Math.min(x, r.x + r.w)), ly = Math.max(r.y + 2, Math.min(y, r.y + r.h - 2));
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.globalAlpha = fade * 0.8;
        const ll = Math.hypot(lx - x, ly - y) || 1;
        ctx.beginPath(); ctx.moveTo(x + 0.5 + ((lx - x) / ll) * 6, y + 0.5 + ((ly - y) / ll) * 6); ctx.lineTo(lx + 0.5, ly + 0.5); ctx.stroke();
        ctx.globalAlpha = fade;
        // Waiting on you: a boxed tag (green routine, amber urgent, red emergency) so the scope shows at a glance what to work.
        const need = F.attention[ac.cs];
        if (need) {
          const nc = need === 'emergency' ? P.red : need === 'urgent' ? P.amber : P.own;
          ctx.fillStyle = 'rgba(5,10,22,0.85)'; ctx.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
          ctx.strokeStyle = nc; ctx.lineWidth = need === 'routine' ? 1 : 2; ctx.strokeRect(r.x - 1.5, r.y - 1.5, r.w + 3, r.h + 3);
          ctx.fillStyle = nc; ctx.fillRect(r.x - 2, r.y - 2, 3, r.h + 4);
        } else if (ac.alert !== 'none' || ac.cs === F.selected) { ctx.fillStyle = 'rgba(5,10,22,0.75)'; ctx.fillRect(r.x, r.y, r.w, r.h); }
        // Other people's traffic recedes.
        if (!ac.mine && !need && ac.cs !== F.selected && ac.alert === 'none') ctx.globalAlpha = fade * 0.55;
        if (ac.alert === 'emergency' || ac.alert === 'conflict') { ctx.strokeStyle = col; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1); }
        ctx.fillStyle = col;
        lines.forEach((l, i) => ctx.fillText(l, r.x + 2, r.y + 1 + i * LH));
        ctx.globalAlpha = fade;
      }
      ctx.globalAlpha = 1;
    }
  }

  resize(w: number, h: number, dpr: number) {
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
  }
}
