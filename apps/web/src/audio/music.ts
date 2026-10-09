// Generative score for a tense job. It is built from layers that come in as the controller's workload rises: a dark drone and
// sonar pings when it is quiet, then a pulsing bass, kick, hats and a plucked arpeggio, then backbeat, tremolo strings and
// risers when it is flat out. Every few bars a new section picks its own key, mode, chord loop, tempo and patterns, and now
// and then the drums drop out for a breather, so a long shift never loops. Conflicts, emergencies and crashes hit it with stingers.

type Rng = () => number;
const rngFrom = (seed: number): Rng => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const SCALES: Record<string, number[]> = {
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  locrian: [0, 1, 3, 5, 6, 8, 10],
};
// Which modes suit which heat: dark and open when quiet, hard-edged when busy.
const MODES_CALM = ['aeolian', 'dorian', 'dorian', 'aeolian', 'phrygian'];
const MODES_BUSY = ['phrygian', 'harmonic', 'aeolian', 'locrian', 'phrygian', 'harmonic'];
// Chord roots as scale degrees (0 = tonic), four bars each (some eight).
const PROGS = [
  [0, 5, 2, 6], [0, 3, 6, 5], [0, 6, 5, 6], [0, 0, 5, 6], [0, 2, 3, 6], [0, 5, 3, 4], [0, 1, 0, 6],
  [0, 3, 0, 4], [0, 6, 3, 4], [0, 5, 0, 6, 0, 3, 6, 4], [0, 2, 5, 6],
];
const BASS_PATTERNS: number[][] = [
  [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],   // steady eighths
  [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],   // syncopated
  [1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1],   // driving sixteenths
  [1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1],   // loose
  [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],   // off-beat
];
const KICK_PATTERNS: number[][] = [
  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0],
  [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0],
];

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const ramp = (x: number, lo: number, hi: number) => { const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

interface Section {
  root: number; scale: number[]; prog: number[]; bars: number; tempo: number;
  bassPat: number[]; bassOct: number[]; kick: number[]; arp: number[]; arpOct: number; lead: number[];
  breather: boolean; breathBars: number; padSplit: boolean;
}

export type MusicAlert = 'conflict' | 'emergency' | 'crash';

export class Music {
  private ctx: BaseAudioContext | null = null;
  private owned = false;
  private out!: GainNode;
  private muffle!: BiquadFilterNode;
  private dry!: GainNode;
  private verb!: GainNode;
  private echo!: DelayNode;
  private echoIn!: GainNode;
  private noise!: AudioBuffer;
  private padF!: BiquadFilterNode;
  private droneF!: BiquadFilterNode;
  private droneG!: GainNode;
  private drone: OscillatorNode[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private rnd: Rng = rngFrom((Math.random() * 2 ** 32) >>> 0);
  private t = 0;            // time of the next step
  private step = 0;
  private bar = 0;
  private sec!: Section;
  private secBar = 0;
  private volume = 0.35;
  private target = 0;       // workload 0..1 as given
  private level = 0.2;      // smoothed drive actually used
  private boost = 0;        // decays: a conflict or crash lifts the whole score for a while
  private emergencyUntil = 0;
  private hushUntil = 0;    // after a crash the drums drop out for a moment
  private paused = false;
  private lastRiser = -99;
  private wander = 0;

  /** Use an existing context (an OfflineAudioContext, in tests). */
  attach(ctx: BaseAudioContext, dest: AudioNode) {
    this.build(ctx, dest);
  }

  start() {
    if (this.running) return;
    if (!this.ctx) { const c = new AudioContext(); this.owned = true; this.build(c, c.destination); }
    void (this.ctx as AudioContext).resume?.();
    this.running = true;
    this.fade(1);
    this.t = this.ctx!.currentTime + 0.2;
    this.step = 0; this.bar = 0;
    this.newSection(true);
    this.timer = setInterval(() => this.tick(), 250);
    this.tick();
  }

  stop() {
    if (!this.ctx || !this.running) return;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.8);
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx && this.running) this.fade(this.paused ? 0.4 : 1);
  }

  /** 0 = a quiet frequency, 1 = flat out. */
  setIntensity(k: number) { this.target = Math.max(0, Math.min(1, k)); }

  /** Paused: the score ducks and dulls but keeps going. */
  setPaused(p: boolean) {
    this.paused = p;
    if (!this.ctx || !this.running) return;
    this.fade(p ? 0.4 : 1);
    this.muffle.frequency.setTargetAtTime(p ? 700 : 14000, this.ctx.currentTime, 0.25);
  }

  /** Something happened that should hit the score. */
  alert(kind: MusicAlert) {
    if (!this.ctx || !this.running) return;
    const c = this.ctx, t = c.currentTime + 0.02;
    if (kind === 'conflict') {
      this.boost = Math.min(0.5, this.boost + 0.25);
      this.stinger(t, this.sec.root, 0.8);
    } else if (kind === 'emergency') {
      this.boost = Math.min(0.6, this.boost + 0.35);
      this.emergencyUntil = t + 75;
      this.stinger(t, this.sec.root - 1, 1);
    } else {
      this.boost = 0.7;
      this.hushUntil = t + 5;
      this.stinger(t, this.sec.root - 2, 1.4);
      this.thump(t + 0.02, 1.2);
    }
  }

  // ---------------------------------------------------------------- graph

  private build(c: BaseAudioContext, dest: AudioNode) {
    this.ctx = c;
    this.out = c.createGain();
    this.out.gain.value = 0;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 3.5; comp.attack.value = 0.01; comp.release.value = 0.25;
    this.muffle = c.createBiquadFilter();
    this.muffle.type = 'lowpass'; this.muffle.frequency.value = 14000;
    this.out.connect(comp).connect(this.muffle).connect(dest);
    this.dry = c.createGain();
    this.dry.connect(this.out);
    // Reverb: a dark noise tail.
    const len = Math.floor(c.sampleRate * 2.8), ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) { lp += 0.35 * ((Math.random() * 2 - 1) - lp); d[i] = lp * (1 - i / len) ** 3.2; }
    }
    const conv = c.createConvolver(); conv.buffer = ir;
    this.verb = c.createGain(); this.verb.gain.value = 0.55;
    this.verb.connect(conv).connect(this.out);
    // Tempo-synced echo.
    this.echo = c.createDelay(2); this.echo.delayTime.value = 0.4;
    const fb = c.createGain(); fb.gain.value = 0.38;
    const echoLp = c.createBiquadFilter(); echoLp.type = 'lowpass'; echoLp.frequency.value = 2800;
    this.echoIn = c.createGain(); this.echoIn.gain.value = 0.5;
    this.echoIn.connect(this.echo); this.echo.connect(echoLp); echoLp.connect(fb).connect(this.echo);
    echoLp.connect(this.verb); echoLp.connect(this.dry);
    // Shared noise.
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // Pad filter and the drone, which never stops.
    this.padF = c.createBiquadFilter(); this.padF.type = 'lowpass'; this.padF.frequency.value = 900; this.padF.Q.value = 0.7;
    this.padF.connect(this.dry); this.padF.connect(this.verb);
    this.droneF = c.createBiquadFilter(); this.droneF.type = 'lowpass'; this.droneF.frequency.value = 260; this.droneF.Q.value = 2.5;
    this.droneG = c.createGain(); this.droneG.gain.value = 0.12;
    this.droneF.connect(this.droneG).connect(this.dry);
    this.droneG.connect(this.verb);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = c.createGain(); lfoG.gain.value = 90;
    lfo.connect(lfoG).connect(this.droneF.frequency);
    for (const [type, det, mul] of [['sawtooth', -7, 1], ['sawtooth', 8, 1], ['sine', 0, 1], ['triangle', 0, 1.5]] as const) {
      const o = c.createOscillator(); o.type = type; o.detune.value = det; o.frequency.value = hz(36) * mul;
      const g = c.createGain(); g.gain.value = type === 'sine' ? 0.9 : type === 'triangle' ? 0.12 : 0.28;
      o.connect(g).connect(this.droneF);
      o.start(); this.drone.push(o);
    }
    lfo.start(); this.drone.push(lfo);
  }

  private fade(k: number) {
    this.out.gain.setTargetAtTime(this.volume * 0.62 * k, this.ctx!.currentTime, 1.2);
  }

  // ---------------------------------------------------------------- sections

  private newSection(first = false) {
    const r = this.rnd, pick = <T>(a: T[]): T => a[Math.floor(r() * a.length)];
    const L = this.level;
    const prev = this.sec;
    // Modulate: usually by a fourth or fifth, sometimes up a semitone (it unsettles).
    let root = prev ? prev.root + pick([0, 5, 7, -2, 1, -5, 3]) : 33 + Math.floor(r() * 9);
    while (root > 43) root -= 12;
    while (root < 31) root += 12;
    const modeName = pick(L > 0.55 ? MODES_BUSY : MODES_CALM);
    const scale = SCALES[modeName];
    const breather = !first && r() < (L > 0.8 ? 0.1 : L > 0.5 ? 0.22 : 0.3);
    const sparse = r() < 0.3;
    const arp: number[] = [];
    const arpDeg = [0, 2, 4, 7, 4, 2, 9, 5, 0, 2, 4, 6, 7, 11];
    for (let i = 0; i < 16; i++) arp.push(r() < (sparse ? 0.42 : 0.7) ? pick(arpDeg) : -1);
    const lead: number[] = [];
    for (let i = 0; i < 4; i++) lead.push(pick([0, 2, 4, 6, 7, 9, 11, 4]));
    this.sec = {
      root, scale, prog: pick(PROGS), bars: pick([8, 8, 12, 16, 16]), tempo: 0.93 + r() * 0.14,
      bassPat: pick(BASS_PATTERNS), bassOct: Array.from({ length: 16 }, () => (r() < 0.18 ? 12 : r() < 0.1 ? 7 : 0)),
      kick: pick(KICK_PATTERNS), arp, arpOct: r() < 0.35 ? 12 : 24, lead, breather, breathBars: 2 + Math.floor(r() * 3), padSplit: r() < 0.4,
    };
    this.secBar = 0;
    // The drone follows the key.
    if (this.ctx) {
      const c = this.ctx.currentTime;
      this.drone.slice(0, 4).forEach((o, i) => o.frequency.setTargetAtTime(hz(root) * (i === 3 ? 1.5 : 1), Math.max(c, this.t), 1.5));
    }
  }

  // ---------------------------------------------------------------- scheduler

  private tick() {
    const c = this.ctx;
    if (!c || !this.running) return;
    const now = c.currentTime;
    while (this.t < now + 0.9) this.stepOnce();
  }

  /** Run the scheduler up to `until` seconds (offline rendering). */
  schedule(until: number) {
    this.running = true;
    while (this.t < until) this.stepOnce();
  }
  begin() {
    this.running = true;
    this.out.gain.value = this.volume * 0.62;
    this.t = 0.1; this.step = 0; this.bar = 0;
    this.newSection(true);
  }

  private stepOnce() {
    const c = this.ctx!, t = this.t, st = this.step, sec = this.sec;
    // Smoothed drive: up fast, down slowly, with a slow wander so it never holds still.
    const drive = Math.min(1, 0.2 + 0.8 * this.target + this.boost + this.wander);
    this.level += (drive - this.level) * (drive > this.level ? 0.03 : 0.006);
    this.boost = Math.max(0, this.boost - 0.0009);
    if (st === 0 && this.bar % 4 === 0) this.wander = (this.rnd() - 0.4) * 0.12;
    const breather = sec.breather && this.secBar < sec.breathBars ? (this.level > 0.7 ? 0.3 : 0.45) : 0;
    const hush = t < this.hushUntil ? 1 : 0;
    const L = Math.max(0, this.level - breather - hush * 0.5);
    const bpm = lerp(74, 126, ramp(L, 0.1, 1) ** 1.1) * sec.tempo;
    const sd = 60 / bpm / 4;
    this.echo.delayTime.setTargetAtTime(sd * 3, t, 0.5);
    const chordDeg = sec.prog[this.secBar % sec.prog.length];
    const nt = (d: number) => sec.root + sec.scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);

    if (st === 0) this.newBar(t, sd, L, chordDeg, nt);

    // Drums.
    const kickLv = ramp(L, 0.3, 0.42);
    if (kickLv > 0) {
      const pat = L > 0.7 ? sec.kick : L > 0.45 ? KICK_PATTERNS[0] : [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
      if (pat[st]) this.kick(t, kickLv * (st % 8 === 0 ? 1 : 0.8));
    }
    const snareLv = ramp(L, 0.55, 0.66);
    if (snareLv > 0 && (st === 4 || st === 12)) this.snare(t, snareLv);
    if (snareLv > 0.5 && L > 0.85 && st === 15 && this.rnd() < 0.5) this.snare(t, snareLv * 0.4);
    const hatLv = ramp(L, 0.38, 0.5);
    if (hatLv > 0) {
      const sixteenth = L > 0.66;
      if (st % 2 === 0 || (sixteenth && this.rnd() < 0.8)) this.hat(t, hatLv * (st % 4 === 2 ? 1 : 0.6) * (0.7 + this.rnd() * 0.3), st === 14 && this.rnd() < 0.3);
    }
    // Quiet radar blips while it is calm.
    const ping = 1 - ramp(L, 0.3, 0.6);
    if (ping > 0 && this.rnd() < 0.045 * ping) this.ping(t, nt(pickIdx(this.rnd, [0, 2, 4, 7, 9])) + 36 + (this.rnd() < 0.5 ? 12 : 0), 0.5 * ping);

    // Bass.
    const bassLv = ramp(L, 0.15, 0.3);
    if (bassLv > 0) {
      let on = false;
      if (L < 0.32) on = st === 0 || (st === 8 && L > 0.24);
      else if (L < 0.5) on = st % 4 === 0 || (st === 14 && this.rnd() < 0.3);
      else on = sec.bassPat[st] === 1 && (L > 0.72 || st % 2 === 0 || sec.bassPat === BASS_PATTERNS[2]);
      if (on) this.bass(t, nt(chordDeg) + sec.bassOct[st], bassLv * (0.75 + (st % 4 === 0 ? 0.25 : 0)), sd, L);
    }

    // Arpeggio.
    const arpLv = ramp(L, 0.42, 0.55);
    const slot = sec.arp[st];
    if (arpLv > 0 && slot >= 0 && (L > 0.62 || st % 2 === 0)) {
      const m = nt(chordDeg + slot) + sec.arpOct;
      this.arpNote(t, m, arpLv * (L > 0.75 ? 0.9 : 0.7), L, sd);
    }
    if (st === 8 && this.bar % 2 === 1 && this.rnd() < 0.6) sec.arp[Math.floor(this.rnd() * 16)] = this.rnd() < 0.3 ? -1 : [0, 2, 4, 6, 7, 9][Math.floor(this.rnd() * 6)];

    // A slow lead line while the score is still quiet.
    const leadLv = ramp(L, 0.1, 0.2) * (1 - ramp(L, 0.5, 0.8));
    if (leadLv > 0.05 && this.secBar % 2 === 1 && st % 4 === 0 && st < 16 && this.rnd() < 0.55) {
      const d = sec.lead[(st / 4) | 0];
      this.leadNote(t, nt(chordDeg + d) + 36, leadLv, sd * 6);
    }

    // Emergency heartbeat.
    if (t < this.emergencyUntil && st % 8 === 0) { this.thump(t, 0.7); this.thump(t + sd * 1.6, 0.45); }

    this.t += sd;
    if (++this.step >= 16) { this.step = 0; this.bar++; this.secBar++; if (this.secBar >= sec.bars) this.newSection(); }
  }

  private newBar(t: number, sd: number, L: number, deg: number, nt: (d: number) => number) {
    const sec = this.sec, c = this.ctx!, barLen = sd * 16;
    // Pad: the chord, held across the bar change.
    const padLv = 0.85 * (1 - 0.45 * ramp(L, 0.4, 0.9));
    const voices = [nt(deg), nt(deg + 2), nt(deg + 4), nt(deg + 7)];
    this.padF.frequency.setTargetAtTime(500 + 2300 * ramp(L, 0.1, 0.95), t, 1.5);
    const tones = sec.padSplit ? voices.slice(0, 2) : voices;
    for (const m of tones) for (const det of [-9, 8]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m + 12); o.detune.value = det;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.028 * padLv, t + barLen * 0.35);
      g.gain.setValueAtTime(0.028 * padLv, t + barLen * 0.8);
      g.gain.linearRampToValueAtTime(0, t + barLen * 1.5);
      o.connect(g).connect(this.padF);
      o.start(t); o.stop(t + barLen * 1.6);
    }
    // Drone filter and level follow the heat.
    this.droneG.gain.setTargetAtTime(0.1 + 0.1 * L, t, 2);
    this.droneF.frequency.setTargetAtTime(200 + 600 * L, t, 3);
    // Tension strings: a minor second grinding against the chord.
    const tens = ramp(L, 0.62, 0.8);
    if (tens > 0 && this.bar % 2 === 0) {
      const base = nt(deg + 4) + 24;
      [base, base + 1, nt(deg) + 36].forEach((m, i) => {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m);
        const trem = c.createGain(), lf = c.createOscillator(), lg = c.createGain();
        trem.gain.value = 0.5; lf.frequency.value = 6 + this.rnd() * 5; lg.gain.value = 0.5;
        lf.connect(lg).connect(trem.gain);
        const bp = c.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 2200;
        const g = c.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.012 * tens * (i === 2 ? 0.7 : 1), t + barLen * 0.5);
        g.gain.linearRampToValueAtTime(0, t + barLen * 2);
        o.connect(trem).connect(bp).connect(g);
        g.connect(this.verb); g.connect(this.dry);
        o.start(t); lf.start(t); o.stop(t + barLen * 2.1); lf.stop(t + barLen * 2.1);
      });
    }
    // Riser into the last bar of a busy section.
    if (L > 0.72 && this.secBar === this.sec.bars - 1 && this.bar - this.lastRiser > 6) { this.lastRiser = this.bar; this.riser(t, barLen); }
  }

  // ---------------------------------------------------------------- voices

  private burst(t: number, dur: number, type: BiquadFilterType, f: number, q: number, peak: number, dest: AudioNode, f2?: number) {
    const c = this.ctx!;
    const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const bf = c.createBiquadFilter(); bf.type = type; bf.Q.value = q;
    bf.frequency.setValueAtTime(f, t);
    if (f2) bf.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bf).connect(g).connect(dest);
    s.start(t, this.rnd() * 1.5); s.stop(t + dur + 0.02);
  }

  private kick(t: number, v: number) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.55 * v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.dry);
    o.start(t); o.stop(t + 0.32);
    this.burst(t, 0.02, 'highpass', 2500, 0.7, 0.05 * v, this.dry);
  }

  private snare(t: number, v: number) {
    const c = this.ctx!;
    this.burst(t, 0.16, 'bandpass', 1900, 0.9, 0.2 * v, this.dry);
    this.burst(t, 0.3, 'bandpass', 1400, 0.7, 0.08 * v, this.verb);
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    g.gain.setValueAtTime(0.14 * v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g).connect(this.dry); o.start(t); o.stop(t + 0.12);
  }

  private hat(t: number, v: number, open: boolean) {
    this.burst(t, open ? 0.22 : 0.045, 'highpass', 7500, 0.6, 0.07 * v, this.dry);
  }

  private bass(t: number, m: number, v: number, sd: number, L: number) {
    const c = this.ctx!, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = hz(m);
    f.type = 'lowpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(260 + 1500 * L, t);
    f.frequency.exponentialRampToValueAtTime(110, t + sd * 2.2);
    const len = L < 0.32 ? sd * 14 : sd * 1.8;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.2 * v, t + 0.01);
    g.gain.setTargetAtTime(0, t + len * 0.5, len * 0.3);
    o.connect(f).connect(g).connect(this.dry);
    o.start(t); o.stop(t + len * 1.6 + 0.2);
    const sub = c.createOscillator(), sg = c.createGain();
    sub.type = 'sine'; sub.frequency.value = hz(m);
    sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(0.22 * v, t + 0.01); sg.gain.setTargetAtTime(0, t + len * 0.5, len * 0.3);
    sub.connect(sg).connect(this.dry); sub.start(t); sub.stop(t + len * 1.6 + 0.2);
  }

  private arpNote(t: number, m: number, v: number, L: number, sd: number) {
    const c = this.ctx!;
    for (const det of [-6, 6]) {
      const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
      f.type = 'lowpass'; f.Q.value = 4;
      f.frequency.setValueAtTime(900 + 4500 * L, t);
      f.frequency.exponentialRampToValueAtTime(400, t + sd * 3);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.045 * v, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + sd * 3.2);
      o.connect(f).connect(g);
      g.connect(this.dry); g.connect(this.echoIn); g.connect(this.verb);
      o.start(t); o.stop(t + sd * 3.4);
    }
  }

  private ping(t: number, m: number, v: number) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = hz(m);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06 * v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    o.connect(g); g.connect(this.dry); g.connect(this.echoIn); g.connect(this.verb);
    o.start(t); o.stop(t + 1.9);
  }

  private leadNote(t: number, m: number, v: number, dur: number) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain(), vib = c.createOscillator(), vg = c.createGain();
    o.type = 'triangle'; o.frequency.value = hz(m);
    vib.frequency.value = 5; vg.gain.value = 5; vib.connect(vg).connect(o.detune);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07 * v, t + 0.25); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(this.dry); g.connect(this.verb); g.connect(this.echoIn);
    o.start(t); vib.start(t); o.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
  }

  private riser(t: number, len: number) {
    this.burst(t, len, 'bandpass', 400, 1.5, 0.16, this.verb, 6000);
    this.burst(t, len, 'highpass', 800, 0.7, 0.05, this.dry, 7000);
  }

  private thump(t: number, v: number) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.2);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5 * v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(this.dry); o.start(t); o.stop(t + 0.55);
  }

  /** A dissonant hit: a low drop, a noise crash and a cluster that swells and dies. */
  private stinger(t: number, root: number, v: number) {
    const c = this.ctx!;
    this.thump(t, v);
    this.burst(t, 1.6, 'bandpass', 3000, 0.5, 0.12 * v, this.verb, 400);
    for (const iv of [0, 1, 6, 13]) {
      const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth'; o.frequency.value = hz(root + 36 + iv);
      f.type = 'lowpass'; f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(500, t + 2.2);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 * v, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      o.connect(f).connect(g); g.connect(this.dry); g.connect(this.verb);
      o.start(t); o.stop(t + 2.5);
    }
  }
}

const pickIdx = (r: Rng, a: number[]) => a[Math.floor(r() * a.length)];

/** One player for the whole app, so the music carries on from the menus into a shift. */
export const music = new Music();
