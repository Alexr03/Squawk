// Render test bed: Heathrow with ~60 fake aircraft. Wheel zoom, drag pan, click select.
// Keys: T time of day, R rain, F fog, G follow-the-greens demo, W weather overlay, S SIDs/STARs.
// URL params (for screenshots): cx, cy, mpp, t=dawn|noon|golden|dusk|night, rain, fog, greens, sel, ov=sids,stars,weather, n=extra aircraft
import '@fontsource/ibm-plex-mono/500.css';
import { createScene, decodeScenery } from '@squawk/render';
import type { AircraftView, AirportPack, VehicleView, XY } from '@squawk/sim/types';
import { TYPES } from '@squawk/sim/aircraft';
import { FT, NM, bearing, dist, fromBearing } from '@squawk/sim/geo';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? +q.get(k)! : d);

let seed = 7;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];

const TIMES: [string, string][] = [['dawn', '05:58'], ['noon', '12:00'], ['golden', '16:50'], ['dusk', '18:25'], ['night', '21:30']];
const KT = NM / 3600;

interface Fake { v: AircraftView; step(dt: number): void; trailT: number }

async function main() {
  const pack: AirportPack = await (await fetch(new URL('../../../data/airports/EGLL/airport.json', import.meta.url))).json();
  if (q.get('scenery') !== '0') pack.scenery = decodeScenery(await (await fetch(new URL('../../../data/airports/EGLL/scenery.json', import.meta.url))).json());
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  if (q.get('hud') === '0') hud.style.display = 'none';
  // A runway-only stand-in for Gatwick, to exercise secondary packs on the scope (until its real pack is baked).
  const lgwEnd = (name: string, x: number, hdg: number) => ({ name, thr: { x, y: x * 0.22 }, end: { x, y: x * 0.22 }, hdgTrue: hdg, elevationFt: 202 });
  const lgw = {
    ...pack, icao: 'EGKK', name: 'London Gatwick', arp: { lat: 51.1481, lon: -0.1903 }, surfaces: [], buildings: [], stands: [],
    taxi: { nodes: [], edges: [] }, runways: [{ name: '08R/26L', widthM: 45, lengthM: 3316, ends: [lgwEnd('08R', -1620, 77.6), lgwEnd('26L', 1620, 257.6)] }],
  } as unknown as AirportPack;
  const scene = createScene(canvas, [pack, lgw], { quality: q.get('q') === 'low' ? 'low' : 'high', pixelSize: num('px', 3), smooth: q.get('smooth') !== '0' });
  (window as unknown as { scene: unknown }).scene = scene;

  const nodes = new Map(pack.taxi.nodes.map(n => [n.id, n]));
  const adj = new Map<number, { to: number; len: number; rwy: boolean }[]>();
  for (const e of pack.taxi.edges) {
    for (const [a, b] of [[e.a, e.b], [e.b, e.a]]) (adj.get(a) ?? adj.set(a, []).get(a)!).push({ to: b, len: e.lengthM, rwy: !!e.runway });
  }
  const elev = pack.elevationFt;
  const ends = new Map(pack.runways.flatMap(r => r.ends).map(e => [e.name, e]));
  const fixes = pack.airspace.fixes;
  const opsByTerm = new Map<string, string[]>();
  for (const [op, t] of Object.entries(pack.airlineTerminals)) (opsByTerm.get(t) ?? opsByTerm.set(t, []).get(t)!).push(op);
  const narrow = ['A319', 'A320', 'A20N', 'A321', 'A21N', 'B738', 'B38M', 'E190', 'BCS3'];
  const wide = ['B77W', 'B789', 'A359', 'A35K', 'B772', 'A333', 'B788', 'A388', 'B744'];
  const ops = Object.keys(pack.airlineTerminals);
  const used = new Set<string>();
  const callsign = (op: string) => { let cs; do cs = op + (10 + Math.floor(rnd() * 980)) + (rnd() < 0.3 ? 'A' : ''); while (used.has(cs)); used.add(cs); return cs; };

  const view = (cs: string, type: string, operator: string, p: Partial<AircraftView>): AircraftView => ({
    cs, type, operator, wake: TYPES[type]?.wake ?? 'M', x: 0, y: 0, alt: elev, hdg: 0, gs: 0, vs: 0, onGround: true,
    lights: { beacon: false, nav: true, strobe: false, landing: false, taxi: false }, tug: false, mine: true, alert: 'none',
    squawk: String(2000 + Math.floor(rnd() * 5000)), clearedAlt: null, trail: [], tag: [], ...p,
  });
  const fakes: Fake[] = [];
  const add = (v: AircraftView, step: (dt: number) => void) => fakes.push({ v, step, trailT: rnd() * 4 });

  // ---- parked at stands
  const stands = pack.stands.filter(() => rnd() < 0.55);
  for (const [si, s] of stands.slice(0, 34).entries()) {
    const op = pick(opsByTerm.get(s.terminal) ?? ops);
    const big = s.maxWake === 'H' || s.maxWake === 'J';
    const type = big && rnd() < 0.6 ? pick(s.maxWake === 'J' ? wide : wide.filter(t => t !== 'A388')) : pick(narrow);
    const L = TYPES[type].lengthM;
    const b = (s.hdg * Math.PI) / 180;
    const pos = { x: s.x - Math.sin(b) * L * 0.38, y: s.y - Math.cos(b) * L * 0.38 };
    const pushing = si === 0 || rnd() < 0.12;
    add(view(callsign(op), type, op, { ...pos, hdg: s.hdg, lights: { beacon: pushing, nav: rnd() < 0.5, strobe: false, landing: false, taxi: false }, tug: pushing }), () => {});
  }

  // ---- taxiing: random walk on the taxi graph (one follows the greens demo path)
  const walk = (start: number, op: string, type: string, path?: number[]) => {
    let a = start, b = adj.get(start)!.find(e => !e.rwy)!.to, s = 0, i = 0;
    const v = view(callsign(op), type, op, { lights: { beacon: true, nav: true, strobe: false, landing: false, taxi: true }, gs: 15 });
    add(v, dt => {
      const A = nodes.get(a)!, B = nodes.get(b)!, l = Math.max(1, dist(A, B));
      s += v.gs * KT * dt;
      while (s >= l) {
        s -= l;
        const prev = a; a = b;
        if (path) { i = (i + 1) % (path.length - 1); a = path[i]; b = path[i + 1]; if (i === 0) s = 0; }
        else { const opts = adj.get(a)!.filter(e => !e.rwy && e.to !== prev); b = (opts.length ? pick(opts) : adj.get(a)![0]).to; }
      }
      const P = nodes.get(a)!, Q = nodes.get(b)!, t = s / Math.max(1, dist(P, Q));
      v.x = P.x + (Q.x - P.x) * t; v.y = P.y + (Q.y - P.y) * t;
      const h = bearing(P, Q), d = ((h - v.hdg + 540) % 360) - 180;
      v.hdg = (v.hdg + Math.max(-90 * dt, Math.min(90 * dt, d)) + 360) % 360;
    });
  };
  const twyNodes = pack.taxi.nodes.filter(n => adj.get(n.id)?.some(e => !e.rwy) && !n.stand);
  for (let i = 0; i < 6; i++) walk(pick(twyNodes).id, pick(ops), pick(narrow));

  // greens demo route: shortest path from a 27R exit to a T5 stand
  const route = (from: number, to: number): number[] => {
    const d = new Map([[from, 0]]), prev = new Map<number, number>(), open = new Set([from]);
    while (open.size) {
      let u = -1, du = Infinity; for (const n of open) if (d.get(n)! < du) { du = d.get(n)!; u = n; }
      open.delete(u); if (u === to) break;
      for (const e of adj.get(u) ?? []) { if (e.rwy) continue; const nd = du + e.len; if (nd < (d.get(e.to) ?? Infinity)) { d.set(e.to, nd); prev.set(e.to, u); open.add(e.to); } }
    }
    const out = [to]; while (out[0] !== from && prev.has(out[0])) out.unshift(prev.get(out[0])!);
    return out;
  };
  const exitNode = pack.taxi.nodes.filter(n => n.hold && n.holdRunway?.includes('27R')).sort((a, b) => a.x - b.x)[0] ?? pack.taxi.nodes.find(n => n.hold)!;
  const t5 = pack.stands.find(s => s.terminal === '5') ?? pack.stands[0];
  const greensPath = route(exitNode.id, t5.pushNode);
  walk(greensPath[0], 'BAW', 'A320', greensPath);
  let greensOn = q.has('greens') ? q.get('greens') !== '0' : true;
  const applyGreens = () => scene.setGreens(greensOn ? [greensPath.map(id => nodes.get(id)!)] : []);
  applyGreens();
  scene.setStopBars(pack.taxi.nodes.filter(n => n.hold).map(n => n.id));

  // ---- final approach 27R
  const r27R = ends.get('27R')!, r27L = ends.get('27L')!;
  for (let i = 0; i < 7; i++) {
    let d = (2 + i * 3.3) * NM;
    const op = pick(ops), type = rnd() < 0.3 ? pick(wide) : pick(narrow);
    const T = TYPES[type];
    const v = view(callsign(op), type, op, { onGround: false, lights: { beacon: true, nav: true, strobe: true, landing: true, taxi: false }, clearedAlt: 3000 });
    add(v, dt => {
      if (d > 0) {
        v.gs = d > 8 * NM ? 180 : d > 4 * NM ? 160 : T.vapp;
        d -= v.gs * KT * dt;
        const glide = elev + 50 + (Math.max(0, d) * Math.tan((3 * Math.PI) / 180)) / FT;
        v.alt = Math.min(glide, 4000 + Math.max(0, d - 12 * NM) / NM * 300);
        v.vs = d < 12 * NM ? -v.gs * 5.3 : 0;
        v.onGround = false;
      } else {
        v.onGround = true; v.alt = elev; v.vs = 0;
        v.gs = Math.max(15, v.gs - 5 * dt);
        d -= v.gs * KT * dt;
        if (d < -2600) { d = 20 * NM; v.trail = []; }
      }
      const p = fromBearing(r27R.thr, r27R.hdgTrue + 180, d);
      v.x = p.x; v.y = p.y; v.hdg = r27R.hdgTrue;
      v.lights.landing = d < 9 * NM && d > -1500; v.lights.strobe = d > -1500;
    });
  }

  // ---- departures 27L, then out along a SID-ish track
  for (let i = 0; i < 4; i++) {
    let s = -i * 9000, alt = elev;
    const op = pick(ops), type = rnd() < 0.3 ? pick(wide) : pick(narrow);
    const T = TYPES[type];
    const turn = [-40, 35, -15, 60][i];
    const v = view(callsign(op), type, op, { lights: { beacon: true, nav: true, strobe: true, landing: true, taxi: false }, clearedAlt: 6000, mine: true });
    add(v, dt => {
      if (s < 0) { s += 120 * dt; v.gs = 0; v.onGround = true; v.alt = elev; const p = r27L.end; v.x = p.x; v.y = p.y; v.hdg = r27L.hdgTrue; v.lights.landing = false; v.lights.strobe = false; return; }
      v.lights.landing = alt < elev + 10000; v.lights.strobe = true;
      if (v.onGround) {
        v.gs += T.accel * dt; s += v.gs * KT * dt;
        if (v.gs >= T.vr) v.onGround = false;
      } else {
        v.gs = Math.min(alt > 6000 ? 290 : 220, v.gs + 2 * dt);
        alt = Math.min(alt > 5900 ? 11000 : 6000, alt + (T.climb / 60) * dt * (alt > 5900 ? 0.8 : 1));
        if (alt > elev + 1500) v.hdg = (v.hdg + Math.sign(turn) * Math.min(3 * dt, Math.abs(((r27L.hdgTrue + turn - v.hdg + 540) % 360) - 180))) % 360;
        v.mine = alt < 6000;
        v.clearedAlt = alt > 5900 ? 11000 : 6000;
      }
      v.alt = v.onGround ? elev : alt;
      v.vs = v.onGround ? 0 : T.climb;
      const p = v.onGround ? fromBearing(r27L.end, r27L.hdgTrue, s) : fromBearing(v, v.hdg, v.gs * KT * dt);
      v.x = p.x; v.y = p.y;
      if (dist(v, { x: 0, y: 0 }) > 60 * NM) { s = -60; alt = elev; v.onGround = true; v.gs = 0; v.hdg = r27L.hdgTrue; v.trail = []; }
    });
  }

  // ---- inbound on STARs, then holding at the stacks
  const hold = (stack: (typeof pack.airspace.stacks)[number], v: AircraftView, level: number) => {
    const f = fixes[stack.fix]; let ph = rnd();
    v.alt = level; v.clearedAlt = level; v.gs = 220;
    return (dt: number) => {
      ph = (ph + dt / 240) % 1; // 4-minute racetrack
      const leg = 4 * NM, r = 1.2 * NM, u = stack.inboundTrack, side = u + (stack.turn === 'R' ? 90 : -90);
      const perim = 2 * leg + 2 * Math.PI * r, s = ph * perim;
      let p: XY, h: number;
      const back = fromBearing(f, u + 180, leg);
      if (s < leg) { p = fromBearing(back, u, s); h = u; }
      else if (s < leg + Math.PI * r) { const a = (s - leg) / r, c = fromBearing(f, side, r); p = fromBearing(c, side + 180 + (stack.turn === 'R' ? 1 : -1) * (a * 180) / Math.PI, r); h = u + (stack.turn === 'R' ? 1 : -1) * (a * 180) / Math.PI; }
      else if (s < 2 * leg + Math.PI * r) { const o = fromBearing(f, side, 2 * r); p = fromBearing(o, u + 180, s - leg - Math.PI * r); h = u + 180; }
      else { const a = (s - 2 * leg - Math.PI * r) / r, c = fromBearing(back, side, r); p = fromBearing(c, side + (stack.turn === 'R' ? 1 : -1) * (a * 180) / Math.PI, r); h = u + 180 + (stack.turn === 'R' ? 1 : -1) * (a * 180) / Math.PI; }
      v.x = p.x; v.y = p.y; v.hdg = (h + 360) % 360;
    };
  };
  const stars = pack.airspace.stars.filter(s => s.fixes.every(f => fixes[f]));
  for (let i = 0; i < 14; i++) {
    const star = stars[i % stars.length];
    const stack = pack.airspace.stacks.find(s => s.name === star.stack) ?? pack.airspace.stacks[0];
    const op = pick(ops), type = rnd() < 0.35 ? pick(wide) : pick(narrow);
    const v = view(callsign(op), type, op, { onGround: false, gs: 280, lights: { beacon: true, nav: true, strobe: true, landing: false, taxi: false } });
    const pts = [fromBearing(fixes[star.fixes[0]], bearing(fixes[stack.fix], fixes[star.fixes[0]]), 25 * NM), ...star.fixes.map(f => fixes[f])];
    let seg = 0, s = rnd() * dist(pts[0], pts[1]);
    const lvl = stack.minAltFt + (i % 4) * 1000;
    let holding: ((dt: number) => void) | null = i % 3 === 0 ? hold(stack, v, lvl) : null;
    if (i === 4) { v.alert = 'caution'; } if (i === 7) { v.alert = 'emergency'; v.squawk = '7700'; }
    v.mine = i % 5 !== 2;
    add(v, dt => {
      if (holding) return holding(dt);
      const a = pts[seg], b = pts[seg + 1], l = dist(a, b);
      s += v.gs * KT * dt;
      if (s >= l) { s -= l; seg++; if (seg >= pts.length - 1) { holding = hold(stack, v, lvl); return; } }
      const t = Math.min(1, s / l), A = pts[seg], B = pts[seg + 1];
      v.x = A.x + (B.x - A.x) * t; v.y = A.y + (B.y - A.y) * t; v.hdg = bearing(A, B);
      const remain = (pts.length - 2 - seg + (1 - t)) / (pts.length - 1);
      v.alt = lvl + (star.entryAltFt - lvl) * remain; v.clearedAlt = lvl; v.vs = -1500;
    });
  }
  // extra load for perf testing
  for (let i = 0; i < num('n', 0); i++) {
    const op = pick(ops), type = pick(narrow);
    let brg = rnd() * 360, r = (10 + rnd() * 60) * NM;
    const v = view(callsign(op), type, op, { onGround: false, gs: 300, alt: 9000 + Math.floor(rnd() * 20) * 1000, clearedAlt: 9000, mine: rnd() < 0.5, lights: { beacon: true, nav: true, strobe: true, landing: false, taxi: false } });
    add(v, dt => { brg = (brg + (v.gs * KT * dt) / r * 57.3) % 360; const p = fromBearing({ x: 0, y: 0 }, brg, r); v.x = p.x; v.y = p.y; v.hdg = (brg + 90) % 360; });
  }

  // ---- vehicles
  const vehicles: VehicleView[] = [];
  if (pack.fireStation) vehicles.push({ id: 'fire1', kind: 'fire', x: pack.fireStation.x, y: pack.fireStation.y, hdg: 0, lights: true });
  {
    let a = pick(twyNodes).id, b = adj.get(a)!.find(e => !e.rwy)!.to, s = 0;
    const fm: VehicleView = { id: 'fm1', kind: 'followme', x: 0, y: 0, hdg: 0, lights: true };
    vehicles.push(fm);
    fakes.push({ v: view('', 'A320', '', {}), trailT: 0, step: dt => {
      const A = nodes.get(a)!, B = nodes.get(b)!; s += 9 * dt;
      if (s >= dist(A, B)) { s = 0; const prev = a; a = b; const o = adj.get(a)!.filter(e => !e.rwy && e.to !== prev); b = (o.length ? pick(o) : adj.get(a)![0]).to; }
      const P = nodes.get(a)!, Q = nodes.get(b)!, t = s / Math.max(1, dist(P, Q));
      fm.x = P.x + (Q.x - P.x) * t; fm.y = P.y + (Q.y - P.y) * t; fm.hdg = bearing(P, Q);
    } });
  }
  const planes = () => fakes.filter(f => f.v.cs);

  // ---- tags
  const lvl = (ft: number) => String(Math.round((ft > 6000 ? ft : ft) / 100)).padStart(3, '0');
  const tagOf = (v: AircraftView) => [v.cs + (v.squawk === '7700' ? ' 7700' : ''), `${lvl(v.alt)}${v.clearedAlt ? ' ' + lvl(v.clearedAlt) : ''}`, `${v.type} ${Math.round(v.gs / 10)}`];

  // ---- time, weather, view
  let ti = Math.max(0, TIMES.findIndex(t => t[0] === (q.get('t') ?? 'noon')));
  const setTime = () => scene.setTime(Date.parse(`2026-09-19T${TIMES[ti][1]}:00Z`) / 1000);
  setTime();
  let rain = num('rain', 0), fog = num('fog', 0) > 0;
  const cells = [{ x: -30000, y: 25000, r: 9000, intensity: 0.9 }, { x: 35000, y: -40000, r: 14000, intensity: 0.5 }, { x: -60000, y: -20000, r: 6000, intensity: 0.3 }];
  const setWx = () => scene.setWeather({ rain, visM: fog ? num('vis', 450) : 10000, cloud: rain ? 0.8 : 0.25, cells });
  setWx();
  const ov = (q.get('ov') ?? '').split(',');
  const overlays = { sids: ov.includes('sids'), stars: ov.includes('stars'), weather: ov.includes('weather'), ctr: true, rings: true };
  scene.setOverlays(overlays);
  scene.setRunwaysInUse(['27R'], ['27L']);
  if (q.has('sel')) scene.setSelected(q.get('sel') === '1' ? planes()[40]?.v.cs ?? null : q.get('sel'));

  let cur = { cx: num('cx', 200), cy: num('cy', -700), mpp: num('mpp', 3) };
  let target = cur.mpp;
  let anchor: XY = { x: innerWidth / 2, y: innerHeight / 2 };
  scene.setView(cur);
  window.addEventListener('resize', () => scene.resize());

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    target = Math.min(900, Math.max(0.12, target * Math.exp(e.deltaY * 0.0016)));
    anchor = { x: e.offsetX, y: e.offsetY };
  }, { passive: false });
  let drag: { x: number; y: number; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.offsetX, y: e.offsetY, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    if (Math.hypot(e.offsetX - drag.x, e.offsetY - drag.y) > 3) drag.moved = true;
    if (!drag.moved) return;
    const a = scene.screenToWorld(drag.x, drag.y), b = scene.screenToWorld(e.offsetX, e.offsetY);
    cur = { ...cur, cx: cur.cx - (b.x - a.x), cy: cur.cy - (b.y - a.y) };
    scene.setView(cur);
    drag.x = e.offsetX; drag.y = e.offsetY;
  });
  canvas.addEventListener('pointerup', e => {
    if (drag && !drag.moved) { const r = scene.pick(e.offsetX, e.offsetY); scene.setSelected('cs' in r ? r.cs : null); }
    drag = null;
  });
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === 't') { ti = (ti + 1) % TIMES.length; setTime(); }
    if (k === 'r') { rain = rain ? 0 : 0.8; setWx(); }
    if (k === 'f') { fog = !fog; setWx(); }
    if (k === 'g') { greensOn = !greensOn; applyGreens(); }
    if (k === 'w') { overlays.weather = !overlays.weather; scene.setOverlays(overlays); }
    if (k === 's') { overlays.sids = overlays.stars = !overlays.sids; scene.setOverlays(overlays); }
  });

  let last = performance.now(), frames = 0, fps = 0, fpsT = last, renderMs = 0;
  const views = () => planes().map(f => f.v);
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    for (const f of fakes) {
      f.step(dt);
      f.trailT += dt;
      if (f.v.cs && f.trailT > 4) { f.trailT = 0; f.v.trail = [...f.v.trail.slice(-5), { x: f.v.x, y: f.v.y }]; }
      f.v.tag = tagOf(f.v);
    }
    // smooth zoom anchored at the cursor
    if (Math.abs(Math.log(target / cur.mpp)) > 1e-4) {
      const before = scene.screenToWorld(anchor.x, anchor.y);
      cur = { ...cur, mpp: cur.mpp * Math.pow(target / cur.mpp, 1 - Math.exp(-dt * 12)) };
      scene.setView(cur);
      const after = scene.screenToWorld(anchor.x, anchor.y);
      cur = { ...cur, cx: cur.cx + before.x - after.x, cy: cur.cy + before.y - after.y };
      scene.setView(cur);
    }
    if (q.has('follow')) { const f = planes()[num('follow', 0)]?.v; if (f) { cur = { ...cur, cx: f.x, cy: f.y }; scene.setView(cur); } }
    scene.setAircraft(views());
    scene.setVehicles(vehicles);
    const r0 = performance.now();
    scene.render();
    renderMs = renderMs * 0.95 + (performance.now() - r0) * 0.05;
    frames++;
    if (now - fpsT > 500) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
    hud.textContent = `mpp ${cur.mpp.toFixed(2)}  ${(cur.mpp * innerWidth / NM).toFixed(1)} nm wide   ${fps.toFixed(0)} fps  cpu ${renderMs.toFixed(1)} ms
${TIMES[ti][0]} ${TIMES[ti][1]}Z${rain ? '  rain' : ''}${fog ? '  fog' : ''}${greensOn ? '  greens' : ''}   ${views().length} aircraft
wheel zoom · drag pan · click select · T time · R rain · F fog · G greens · W wx · S routes`;
    (window as unknown as { perf: unknown }).perf = { fps, renderMs, mpp: cur.mpp };
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
main();
