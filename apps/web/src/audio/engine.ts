// The airfield you can hear: every aircraft near the view makes its own engine sound (jet whine and roar, turboprop drone, tug
// diesel, tyre rumble, reverse thrust), placed by where it is relative to the camera, with Doppler as it passes. Touchdowns
// squeal, and wind, rain, thunder and the odd gull come from the weather. Only the loudest few aircraft get a voice at a time.
import { TYPES } from '@squawk/sim/aircraft';
import type { Aircraft, Weather } from '@squawk/sim';

export interface Listener { x: number; y: number; mpp: number }
export interface EngineScene {
  aircraft: Pick<Aircraft, 'cs' | 'type' | 'x' | 'y' | 'alt' | 'hdg' | 'gs' | 'vs' | 'phase' | 'onGround' | 'wake'>[];
  weather: Weather;
}

const MAX_VOICES = 7;
const SOUND = 343;
const KT = 0.5144;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };

type Kind = 'jet' | 'prop' | 'tug';

interface Voice {
  cs: string; kind: Kind;
  out: GainNode; lp: BiquadFilterNode; pan: StereoPannerNode;
  params: Record<string, AudioParam>;
  nodes: AudioScheduledSourceNode[];
  dead: boolean;
}

/** What each phase asks of the engines: thrust 0..1 and reverse thrust 0..1. */
function demand(a: EngineScene['aircraft'][number], vr: number): { thrust: number; rev: number; tug: boolean; roll: number } {
  const roll = a.onGround ? clamp((a.gs - 2) / 40, 0, 1.4) : 0;
  switch (a.phase) {
    case 'stand': case 'parked': case 'wreck': return { thrust: 0, rev: 0, tug: false, roll: 0 };
    case 'pushing': return { thrust: 0, rev: 0, tug: true, roll: 0 };
    case 'stopped': return { thrust: 0.1, rev: 0, tug: false, roll: 0 };
    case 'pushed': return { thrust: 0.12, rev: 0, tug: false, roll: 0 };
    case 'taxi': case 'taxiin': case 'holding': case 'vacating': return { thrust: a.gs > 3 ? 0.2 + clamp((a.gs - 8) / 40, 0, 0.12) : 0.14, rev: 0, tug: false, roll };
    case 'lineup': case 'lined': return { thrust: 0.16, rev: 0, tug: false, roll };
    case 'takeoff': return { thrust: clamp(0.62 + a.gs / (vr * 2.2), 0.62, 1), rev: 0, tug: false, roll };
    case 'climb': case 'goaround': return { thrust: a.alt < 4000 ? 0.92 : 0.74, rev: 0, tug: false, roll: 0 };
    case 'landing': return { thrust: 0.18, rev: a.onGround ? clamp((a.gs - 35) / 90, 0, 1) : 0, tug: false, roll };
    case 'final': return { thrust: 0.4 + clamp((3000 - a.alt) / 8000, 0, 0.1), rev: 0, tug: false, roll: 0 };
    default: return { thrust: a.vs < -300 ? 0.28 : 0.46, rev: 0, tug: false, roll: 0 };
  }
}

export class AirfieldAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: GainNode;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private voices = new Map<string, Voice>();
  private wasAir = new Map<string, boolean>();
  private volume = 0.5;
  private paused = false;
  private wind: { g: GainNode; bp: BiquadFilterNode; whistle: GainNode } | null = null;
  private rain: { g: GainNode } | null = null;
  private nextThunder = 0;
  private nextBird = 0;

  /** `ctx` is only passed by tests, to render offline. */
  unlock(ctx?: BaseAudioContext) {
    if (this.ctx) { void (this.ctx as AudioContext).resume?.(); return; }
    const c = (this.ctx = (ctx ?? new AudioContext()) as AudioContext);
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.bus = c.createGain();
    this.bus.connect(this.master);
    const len = c.sampleRate * 3;
    this.white = c.createBuffer(1, len, c.sampleRate);
    this.brown = c.createBuffer(1, len, c.sampleRate);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { w[i] = Math.random() * 2 - 1; last = (last + 0.02 * w[i]) / 1.02; b[i] = last * 3.5; }
    // Make both loop points seamless.
    const fade = 800;
    for (let i = 0; i < fade; i++) { const k = i / fade; w[len - fade + i] = w[len - fade + i] * (1 - k) + w[i] * k; b[len - fade + i] = b[len - fade + i] * (1 - k) + b[i] * k; }
  }

  setVolume(v: number) {
    this.volume = clamp(v, 0, 1);
    if (this.ctx) this.master.gain.setTargetAtTime(this.volume * (this.paused ? 0.25 : 1), this.ctx.currentTime, 0.1);
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (this.ctx) this.master.gain.setTargetAtTime(this.volume * (p ? 0.25 : 1), this.ctx.currentTime, 0.4);
  }

  stop() {
    if (!this.ctx) return;
    for (const v of this.voices.values()) this.kill(v);
    this.voices.clear();
    for (const w of [this.wind, this.rain]) if (w) w.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
  }

  // ---------------------------------------------------------------- per update

  update(scene: EngineScene, at: Listener, now = this.ctx?.currentTime ?? 0) {
    const c = this.ctx;
    if (!c || (c.state !== 'running' && !('startRendering' in c))) return;
    const R = Math.max(260, at.mpp * 110);       // distance at which an aircraft is half as loud
    const wants: { a: EngineScene['aircraft'][number]; d: number; gain: number; dx: number; dy: number; kind: Kind; dem: ReturnType<typeof demand> }[] = [];

    for (const a of scene.aircraft) {
      const ty = TYPES[a.type];
      const dem = demand(a, ty?.vr ?? 150);
      const was = this.wasAir.get(a.cs);
      this.wasAir.set(a.cs, !a.onGround);
      const dx = a.x - at.x, dy = a.y - at.y, h = Math.max(0, a.alt - 80) * 0.3048;
      const d = Math.hypot(dx, dy, h);
      if (was && a.onGround && a.phase === 'landing') this.touchdown(a, d, dx, R, now);
      if (dem.thrust <= 0 && !dem.tug) continue;
      const loud = (ty?.cruise ?? 450) < 360 ? 0.6 : ty?.engines === 4 ? 1.35 : a.wake === 'H' ? 1.1 : a.wake === 'L' ? 0.5 : 0.85;
      const gain = loud / (1 + (d / R) ** 1.5);
      wants.push({ a, d, gain, dx, dy, kind: dem.tug ? 'tug' : (ty?.cruise ?? 450) < 360 ? 'prop' : 'jet', dem });
    }
    wants.sort((p, q) => q.gain - p.gain);
    const keep = new Set(wants.slice(0, MAX_VOICES).filter(w => w.gain > 0.012).map(w => w.a.cs));
    for (const [cs, v] of this.voices) if (!keep.has(cs)) { this.kill(v, now); this.voices.delete(cs); }
    // Drop bookkeeping for aircraft that are gone.
    if (this.wasAir.size > 400) { const live = new Set(scene.aircraft.map(a => a.cs)); for (const k of this.wasAir.keys()) if (!live.has(k)) this.wasAir.delete(k); }

    for (const w of wants) {
      if (!keep.has(w.a.cs)) continue;
      let v = this.voices.get(w.a.cs);
      if (v && v.kind !== w.kind) { this.kill(v, now); this.voices.delete(w.a.cs); v = undefined; }
      if (!v) { v = this.makeVoice(w.a, w.kind); this.voices.set(w.a.cs, v); }
      this.drive(v, w.a, w.dem, w.d, w.gain, w.dx, w.dy, R, now);
    }
    this.weather(scene.weather, now);
  }

  // ---------------------------------------------------------------- voices

  private src(buf: AudioBuffer, dest: AudioNode, nodes: AudioScheduledSourceNode[]): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.loopStart = 0; s.loopEnd = buf.duration - 0.05;
    s.connect(dest);
    s.start(0, Math.random() * (buf.duration - 0.1));
    nodes.push(s);
    return s;
  }

  private makeVoice(a: EngineScene['aircraft'][number], kind: Kind): Voice {
    const c = this.ctx!, nodes: AudioScheduledSourceNode[] = [], p: Record<string, AudioParam> = {};
    const out = c.createGain(); out.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
    const pan = c.createStereoPanner();
    out.connect(lp).connect(pan).connect(this.bus);
    const rnd = hash(a.cs), ty = TYPES[a.type];
    const stage = (g = 0) => { const n = c.createGain(); n.gain.value = g; n.connect(out); return n; };
    const osc = (type: OscillatorType, f: number, dest: AudioNode) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.connect(dest); o.start(); nodes.push(o); return o;
    };

    // Tyre rumble on the ground: brown noise that thumps at the pace of the joints in the concrete.
    const rollG = stage(0), rollLp = c.createBiquadFilter();
    rollLp.type = 'lowpass'; rollLp.frequency.value = 140;
    const rollMod = c.createGain(); rollMod.gain.value = 0.75;
    this.src(this.brown, rollLp, nodes); rollLp.connect(rollMod).connect(rollG);
    const thump = c.createOscillator(); thump.frequency.value = 3;
    const thumpD = c.createGain(); thumpD.gain.value = 0.25;
    thump.connect(thumpD).connect(rollMod.gain); thump.start(); nodes.push(thump);
    p.roll = rollG.gain; p.thump = thump.frequency;

    if (kind === 'tug') {
      // Diesel putter: low sawtooth chopped at engine pace, plus a growl.
      const f = 38 + rnd * 8;
      const g = stage(0.0), o = osc('sawtooth', f, g);
      const lf = c.createBiquadFilter(); lf.type = 'lowpass'; lf.frequency.value = 220;
      o.disconnect(); o.connect(lf).connect(g);
      const chop = c.createOscillator(); chop.frequency.value = 9;
      const cd = c.createGain(); cd.gain.value = 0.035; chop.connect(cd).connect(g.gain); chop.start(); nodes.push(chop);
      g.gain.value = 0.07;
      const rg = stage(0.04), rb = c.createBiquadFilter(); rb.type = 'bandpass'; rb.frequency.value = 160; rb.Q.value = 0.8;
      this.src(this.white, rb, nodes); rb.connect(rg);
      p.pitch = o.frequency;
      return { cs: a.cs, kind, out, lp, pan, params: p, nodes, dead: false };
    }

    if (kind === 'prop') {
      // Turboprop: propeller beat (sawtooth at blade rate through a low pass) plus turbine hiss and a slow twin-prop beat.
      const blade = 68 + rnd * 22;
      const lf = c.createBiquadFilter(); lf.type = 'lowpass'; lf.frequency.value = 900; lf.Q.value = 1.2;
      const g = stage(0), g2 = stage(0);
      lf.connect(g);
      const o1 = osc('sawtooth', blade, lf), o2 = osc('sawtooth', blade * 1.012, lf);
      osc('square', blade * 2.02, lf);
      const hiss = c.createBiquadFilter(); hiss.type = 'bandpass'; hiss.frequency.value = 1700; hiss.Q.value = 0.6;
      this.src(this.white, hiss, nodes); hiss.connect(g2);
      p.thrust = g.gain; p.hiss = g2.gain; p.lf = lf.frequency; p.bladeHz = o1.frequency; p.bladeHz2 = o2.frequency;
      return { cs: a.cs, kind, out, lp, pan, params: p, nodes, dead: false };
    }

    // Jet: a roar (band-limited noise), a low rumble, and the fan whine, which climbs with thrust. Bigger engines sit lower.
    const heavy = ty?.wake === 'H' || ty?.wake === 'J' ? 1 : 0;
    const roarBp = c.createBiquadFilter(); roarBp.type = 'bandpass'; roarBp.frequency.value = 700; roarBp.Q.value = 0.5;
    const roarG = stage(0);
    this.src(this.white, roarBp, nodes); roarBp.connect(roarG);
    const rumLp = c.createBiquadFilter(); rumLp.type = 'lowpass'; rumLp.frequency.value = 220;
    const rumG = stage(0);
    this.src(this.brown, rumLp, nodes); rumLp.connect(rumG);
    const whineBase = (heavy ? 520 : 820) * (0.85 + rnd * 0.3);
    const whBp = c.createBiquadFilter(); whBp.type = 'bandpass'; whBp.frequency.value = whineBase * 1.6; whBp.Q.value = 1.5;
    const whG = stage(0);
    const w1 = osc('sawtooth', whineBase, whBp), w2 = osc('sawtooth', whineBase * 1.5 * (1.005 + rnd * 0.01), whBp);
    whBp.connect(whG);
    // Reverse thrust: a harsh, low-mid blast.
    const revBp = c.createBiquadFilter(); revBp.type = 'bandpass'; revBp.frequency.value = 480; revBp.Q.value = 0.9;
    const revG = stage(0);
    this.src(this.white, revBp, nodes); revBp.connect(revG);
    return {
      cs: a.cs, kind, out, lp, pan, nodes, dead: false,
      params: { roar: roarG.gain, roarF: roarBp.frequency, rum: rumG.gain, wh: whG.gain, w1: w1.frequency, w2: w2.frequency, whF: whBp.frequency, rev: revG.gain, ...p },
    };
  }

  private drive(v: Voice, a: EngineScene['aircraft'][number], dem: ReturnType<typeof demand>, d: number, gain: number, dx: number, dy: number, R: number, now: number) {
    const P = v.params, ty = TYPES[a.type], rnd = hash(a.cs);
    const T = (p: AudioParam, x: number, tc = 0.35) => p.setTargetAtTime(x, now, tc);
    // Doppler from how fast the aircraft is closing on or leaving the camera.
    const vel = a.gs * KT, hr = a.hdg * Math.PI / 180;
    const rad = d > 1 ? (Math.sin(hr) * vel * dx + Math.cos(hr) * vel * dy) / Math.hypot(dx, dy, 1) : 0;
    const dop = SOUND / (SOUND + clamp(rad, -SOUND * 0.5, SOUND * 0.5));
    T(v.out.gain, gain * 0.9, 0.5);
    T(v.lp.frequency, clamp(260 + 11000 / (1 + (d / (R * 0.55)) ** 1.2), 300, 11000), 0.3);
    v.pan.pan.setTargetAtTime(clamp(dx / Math.max(R * 0.6, Math.hypot(dx, dy)), -1, 1) * 0.85, now, 0.25);
    const th = dem.thrust, tc = th > 0.5 ? 0.9 : 1.6;     // engines spool up faster than they spool down
    T(P.roll, dem.roll * 0.55 * (a.onGround ? 1 : 0), 0.3);
    T(P.thump, clamp(a.gs * KT / 28, 1, 22), 0.3);
    if (v.kind === 'tug') {
      T(P.pitch, (38 + rnd * 8) * dop, 0.4);
      return;
    }
    if (v.kind === 'prop') {
      const blade = (68 + rnd * 22) * (0.82 + 0.4 * th) * dop;
      T(P.bladeHz, blade, tc); T(P.bladeHz2, blade * 1.012, tc);
      T(P.thrust, 0.06 + 0.2 * th, tc); T(P.hiss, 0.03 + 0.11 * th, tc);
      T(P.lf, (700 + 800 * th) * dop, tc);
      return;
    }
    const heavy = ty?.wake === 'H' || ty?.wake === 'J';
    const base = (heavy ? 520 : 820) * (0.85 + rnd * 0.3);
    const f = base * (0.5 + 1.15 * th) * dop;
    T(P.w1, f, tc); T(P.w2, f * 1.5 * (1.005 + rnd * 0.01), tc); T(P.whF, f * 1.6, tc);
    T(P.wh, 0.02 + 0.16 * th ** 1.5 + (a.phase === 'final' || a.phase === 'approach' ? 0.03 : 0), tc);
    T(P.roar, 0.03 + 2.4 * th ** 2.2, tc);
    T(P.roarF, (heavy ? 520 : 760) * (0.6 + 1.3 * th) * dop, tc);
    T(P.rum, 0.1 + 1.3 * th ** 1.6 + (heavy ? 0.15 : 0), tc);
    T(P.rev, dem.rev * 2.2, 0.35);
  }

  private kill(v: Voice, t = this.ctx!.currentTime) {
    if (v.dead) return;
    v.dead = true;
    v.out.gain.cancelScheduledValues(t);
    v.out.gain.setTargetAtTime(0, t, 0.25);
    for (const n of v.nodes) { try { n.stop(t + 1.5); } catch { /* already stopped */ } }
    setTimeout(() => { try { v.out.disconnect(); v.lp.disconnect(); v.pan.disconnect(); } catch { /* gone */ } }, 1800);
  }

  // ---------------------------------------------------------------- one-shots

  private shot(dest: (out: AudioNode) => void, gain: number, dx: number, R: number, d: number) {
    const c = this.ctx!;
    const out = c.createGain(); out.gain.value = gain;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = clamp(300 + 10000 / (1 + (d / (R * 0.55)) ** 1.2), 300, 10000);
    const pan = c.createStereoPanner(); pan.pan.value = clamp(dx / Math.max(R * 0.6, d), -1, 1) * 0.85;
    out.connect(lp).connect(pan).connect(this.bus);
    dest(out);
    setTimeout(() => { try { out.disconnect(); lp.disconnect(); pan.disconnect(); } catch { /* gone */ } }, 4000);
  }

  /** Tyres hitting the runway: a chirp of rubber and a thump through the gear. */
  private touchdown(a: EngineScene['aircraft'][number], d: number, dx: number, R: number, now: number) {
    const c = this.ctx!, t = now + 0.02;
    const heavy = a.wake === 'H' || a.wake === 'J';
    const gain = (heavy ? 1.2 : 0.9) / (1 + (d / R) ** 1.4);
    if (gain < 0.015) return;
    this.shot((out) => {
      const s = c.createBufferSource(); s.buffer = this.white;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(1500 + Math.random() * 500, t); bp.frequency.exponentialRampToValueAtTime(700, t + 0.5); bp.Q.value = 1.2;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.02); g.gain.setValueAtTime(0.5, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      s.connect(bp).connect(g).connect(out); s.start(t, Math.random()); s.stop(t + 0.8);
      const o = c.createOscillator(), og = c.createGain();
      o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
      og.gain.setValueAtTime(0.7, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(og).connect(out); o.start(t); o.stop(t + 0.45);
    }, gain, dx, R, d);
  }

  // ---------------------------------------------------------------- weather

  private weather(w: Weather, now: number) {
    const c = this.ctx!;
    if (!this.wind) {
      const g = c.createGain(); g.gain.value = 0;
      const bp = c.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 500; bp.Q.value = 0.7;
      const s = c.createBufferSource(); s.buffer = this.brown; s.loop = true; s.start(0, Math.random());
      // Gusts: a slow swell on top of the steady level.
      const gustG = c.createGain(); gustG.gain.value = 0.8;
      const gust = c.createOscillator(); gust.frequency.value = 0.13;
      const gd = c.createGain(); gd.gain.value = 0.25; gust.connect(gd).connect(gustG.gain); gust.start();
      s.connect(bp).connect(gustG).connect(g).connect(this.bus);
      const wh = c.createGain(); wh.gain.value = 0;
      const wbp = c.createBiquadFilter(); wbp.type = 'bandpass'; wbp.frequency.value = 1100; wbp.Q.value = 9;
      const ws = c.createBufferSource(); ws.buffer = this.white; ws.loop = true; ws.start(0, Math.random());
      const wl = c.createOscillator(); wl.frequency.value = 0.21;
      const wld = c.createGain(); wld.gain.value = 250; wl.connect(wld).connect(wbp.frequency); wl.start();
      ws.connect(wbp).connect(wh).connect(this.bus);
      this.wind = { g, bp, whistle: wh };
      const rg = c.createGain(); rg.gain.value = 0;
      const rhp = c.createBiquadFilter(); rhp.type = 'highpass'; rhp.frequency.value = 1400;
      const rlp = c.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 7500;
      const rs = c.createBufferSource(); rs.buffer = this.white; rs.loop = true; rs.start(0, Math.random());
      rs.connect(rhp).connect(rlp).connect(rg).connect(this.bus);
      this.rain = { g: rg };
    }
    const kt = Math.max(w.wind.kt, (w.wind.gust ?? 0) * 0.8);
    this.wind.g.gain.setTargetAtTime(0.01 + clamp(kt / 30, 0, 1) ** 1.3 * 0.3, now, 1.5);
    this.wind.bp.frequency.setTargetAtTime(280 + kt * 22, now, 1.5);
    this.wind.whistle.gain.setTargetAtTime(clamp((kt - 14) / 25, 0, 1) * 0.05, now, 1.5);
    const wx = w.wx.join(' ');
    const heavyRain = /\+(TS)?RA|\+SH/.test(wx);
    const rain = /RA|DZ|SH|TS/.test(wx);
    this.rain!.g.gain.setTargetAtTime(rain ? (heavyRain ? 0.3 : /DZ/.test(wx) ? 0.07 : 0.17) : 0, now, 2);
    if (!this.nextThunder) this.nextThunder = now + 10 + Math.random() * 30;
    if (!this.nextBird) this.nextBird = now + 20 + Math.random() * 60;
    if (/TS|CB/.test(wx) && now > this.nextThunder) {
      this.nextThunder = now + 18 + Math.random() * 50;
      this.thunder(now + Math.random() * 0.5);
    }
    // A gull or two on a calm, dry day.
    if (!rain && kt < 14 && now > this.nextBird) {
      this.nextBird = now + 45 + Math.random() * 120;
      this.gull(now + 0.05);
    }
  }

  private thunder(t: number) {
    const c = this.ctx!;
    const s = c.createBufferSource(); s.buffer = this.brown;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(120, t + 5);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1.1, t + 0.15); g.gain.exponentialRampToValueAtTime(0.4, t + 1.2);
    for (let k = 1.2; k < 4.5; k += 0.5 + Math.random() * 0.7) g.gain.linearRampToValueAtTime(0.25 + Math.random() * 0.6, t + k);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
    s.connect(lp).connect(g).connect(this.bus); s.start(t, Math.random() * 2); s.stop(t + 6.2);
  }

  private gull(t: number) {
    const c = this.ctx!, n = 2 + Math.floor(Math.random() * 4), pan = c.createStereoPanner();
    pan.pan.value = Math.random() * 1.4 - 0.7;
    const out = c.createGain(); out.gain.value = 0.04 + Math.random() * 0.03;
    out.connect(pan).connect(this.bus);
    const base = 1500 + Math.random() * 500;
    for (let i = 0; i < n; i++) {
      const at = t + i * 0.32, o = c.createOscillator(), g = c.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * 1.15, at); o.frequency.exponentialRampToValueAtTime(base * 0.8, at + 0.26);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = base * 1.3; bp.Q.value = 3;
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(1, at + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
      o.connect(bp).connect(g).connect(out); o.start(at); o.stop(at + 0.32);
    }
  }
}

export const airfield = new AirfieldAudio();
