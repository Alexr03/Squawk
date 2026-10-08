// Generative background music: slow ambient pads through a four-chord loop, with sparse plucked notes and an echo.
// It never repeats exactly, sits under the radio, and grows brighter and busier as the controller's workload rises.

const CHORDS = [
  [50, 57, 62, 66, 69],   // Dmaj9-ish
  [47, 54, 59, 62, 66],   // Bm7
  [43, 50, 55, 59, 62],   // Gmaj7
  [45, 52, 57, 61, 64],   // A6sus
];
const BAR_S = 8;
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

export class Music {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private filter!: BiquadFilterNode;
  private delay!: DelayNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  private bar = 0;
  private volume = 0.35;
  private intensity = 0;

  start() {
    if (this.timer) return;
    if (!this.ctx) {
      const c = (this.ctx = new AudioContext());
      this.out = c.createGain();
      this.out.gain.value = 0;
      this.filter = c.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 1400;
      this.delay = c.createDelay(2);
      this.delay.delayTime.value = 0.6;
      const fb = c.createGain(); fb.gain.value = 0.35;
      const wet = c.createGain(); wet.gain.value = 0.3;
      this.delay.connect(fb).connect(this.delay);
      this.delay.connect(wet).connect(this.out);
      this.filter.connect(this.out);
      this.out.connect(c.destination);
    }
    void this.ctx.resume();
    this.out.gain.setTargetAtTime(this.volume * 0.22, this.ctx.currentTime, 2);
    this.next = this.ctx.currentTime + 0.2;
    this.timer = setInterval(() => this.schedule(), 500);
    this.schedule();
  }

  stop() {
    if (!this.ctx || !this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.8);
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx && this.timer) this.out.gain.setTargetAtTime(this.volume * 0.22, this.ctx.currentTime, 0.3);
  }

  /** 0 = quiet frequency, 1 = flat out: opens the filter and adds more notes. */
  setIntensity(k: number) {
    this.intensity = Math.max(0, Math.min(1, k));
    if (this.ctx) this.filter.frequency.setTargetAtTime(1100 + 2600 * this.intensity, this.ctx.currentTime, 3);
  }

  private schedule() {
    const c = this.ctx!;
    while (this.next < c.currentTime + 1.5) {
      const chord = CHORDS[this.bar % CHORDS.length];
      this.pad(chord, this.next);
      // Plucks: a handful of chord tones an octave up, more of them when busy.
      const n = 2 + Math.round(Math.random() * 2 + this.intensity * 5);
      for (let i = 0; i < n; i++) {
        const t = this.next + (Math.floor(Math.random() * 16) / 16) * BAR_S;
        this.pluck(chord[Math.floor(Math.random() * chord.length)] + 12 * (Math.random() < 0.3 ? 2 : 1), t);
      }
      this.next += BAR_S;
      this.bar++;
    }
  }

  private pad(chord: number[], t: number) {
    const c = this.ctx!;
    for (const m of chord) for (const det of [-6, 5]) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = hz(m);
      o.detune.value = det;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 2.5);
      g.gain.setValueAtTime(0.05, t + BAR_S - 1);
      g.gain.linearRampToValueAtTime(0, t + BAR_S + 1.5);
      o.connect(g).connect(this.filter);
      o.start(t);
      o.stop(t + BAR_S + 1.6);
    }
  }

  private pluck(m: number, t: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = hz(m);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g);
    g.connect(this.filter);
    g.connect(this.delay);
    o.start(t);
    o.stop(t + 1.7);
  }
}

/** One player for the whole app, so the music carries on from the menus into a shift. */
export const music = new Music();
