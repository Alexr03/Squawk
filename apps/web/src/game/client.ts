// Main-thread side of a running shift: owns the sim worker, keeps the last two snapshots for smooth motion.
import { aircraftView, buildWorld, type AircraftView, type AirportPack, type Command, type ShiftConfig, type State, type World } from '@squawk/sim';
import type { FromWorker, ToWorker } from '../worker.ts';

export type Snap = State & { upcoming: State['schedule'] };

export class GameClient {
  world: World;
  packs: AirportPack[];
  cfg: ShiftConfig;
  snap: Snap | null = null;
  prev: Snap | null = null;
  prevAt = 0; curAt = 0;
  final: State | null = null;
  speed = 1;
  /** Seats this player works (in co-op the sim's coverage is everyone's seats). */
  seats: string[];
  onSnap: (s: Snap) => void = () => {};
  onFinal: (s: State) => void = () => {};
  onError: (m: string) => void = () => {};
  private worker: Worker;
  private nextId = 1;
  private waiting = new Map<number, (err: string | null) => void>();

  constructor(packs: AirportPack[], cfg: ShiftConfig) {
    this.packs = packs; this.cfg = cfg;
    this.world = buildWorld(packs);
    this.seats = [...cfg.coverage];
    this.worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    // Plain data only: Svelte state proxies can't cross to a worker.
    this.cfg = JSON.parse(JSON.stringify(cfg));
    this.send({ t: 'init', packs, cfg: this.cfg });
  }

  private send(m: ToWorker) { this.worker.postMessage(m); }
  private receive(m: FromWorker) {
    if (m.t === 'snap') {
      if (this.snap && m.st.tick !== this.snap.tick) { this.prev = this.snap; this.prevAt = this.curAt; }
      this.snap = m.st as Snap;
      this.curAt = performance.now();
      this.onSnap(this.snap);
    } else if (m.t === 'cmd') { this.waiting.get(m.id)?.(m.err); this.waiting.delete(m.id); }
    else if (m.t === 'final') { this.final = m.st; this.onFinal(m.st); }
    else if (m.t === 'error') this.onError(m.msg);
  }

  /** Send one transmission. Resolves to an error message, or null if the pilot will read it back. */
  issue(cmds: Command[], opts: { voice?: boolean; seat?: string } = {}): Promise<string | null> {
    const id = this.nextId++;
    return new Promise(res => { this.waiting.set(id, res); this.send({ t: 'cmd', id, cmds, ...opts }); });
  }
  setSpeed(v: number) { this.speed = v; this.send({ t: 'speed', v }); }
  replay(log: State['cmdLog'], from: number, to: number) { this.final = null; this.send({ t: 'replay', cfg: this.cfg, log, from, to }); }
  dispose() { this.send({ t: 'stop' }); this.worker.terminate(); }

  /** Aircraft views blended between the previous and current snapshot (the sim ticks at 4 Hz, the screen at 60). */
  views(now = performance.now()): AircraftView[] {
    const cur = this.snap;
    if (!cur) return [];
    const span = this.curAt - this.prevAt;
    const a = this.prev && span > 0 ? Math.min(1, (now - this.curAt) / span) : 1;
    const ta = this.world.primary.pack.transitionAltFt;
    const prevBy = new Map((this.prev?.aircraft ?? []).map(p => [p.cs, p]));
    return cur.aircraft.filter(ac => ac.phase !== 'gone').map(ac => {
      const v = aircraftView(ac, cur, ta);
      const p = prevBy.get(ac.cs);
      if (p && a < 1) {
        v.x = p.x + (ac.x - p.x) * a; v.y = p.y + (ac.y - p.y) * a; v.alt = p.alt + (ac.alt - p.alt) * a;
        let dh = ((ac.hdg - p.hdg + 540) % 360) - 180;
        if (Math.abs(dh) > 90) dh = 0;
        v.hdg = (p.hdg + dh * a + 360) % 360;
      }
      return v;
    });
  }

  /** Static parked aircraft on stands (scenery), as views. */
  fillerViews(): AircraftView[] {
    const cur = this.snap;
    if (!cur) return [];
    const out: AircraftView[] = [];
    for (const as of cur.apts) {
      const apt = this.world.byIcao[as.icao];
      for (const [ref, f] of Object.entries(as.fillers)) {
        const s = apt.standByRef[ref];
        if (!s || as.standOcc[ref]) continue;
        out.push({ cs: `~${as.icao}${ref}`, type: f.type, operator: f.operator, wake: 'M', x: s.x, y: s.y, alt: apt.pack.elevationFt, hdg: s.hdg, gs: 0, vs: 0, onGround: true,
          lights: { beacon: false, nav: false, strobe: false, landing: false, taxi: false }, tug: false, mine: false, alert: 'none', squawk: '', clearedAlt: null, trail: [], tag: [] });
      }
    }
    return out;
  }

  /** Current simulated unix time, interpolated between ticks. */
  time(now = performance.now()): number {
    const cur = this.snap;
    if (!cur) return this.cfg.start;
    const dt = Math.min(0.25, (now - this.curAt) / 1000 * this.speed);
    return cur.start + cur.tick / 4 + (cur.ended ? 0 : dt);
  }
}
