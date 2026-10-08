import { settings } from '../lib/settings.svelte.ts';
// Radio + UI audio. Speech comes from speechSynthesis, which can't be routed through
// Web Audio, so the "radio" is faked: a soft squelch click + a faint hiss under the
// speech for its duration, then a squelch tail. Everything else is synthesised.

export type ChimeKind = 'strip' | 'request' | 'conflict' | 'alarm' | 'emergency' | 'handoff' | 'click';

export interface SayOptions {
  /** Speaker identity (callsign, or ATC position). Picks a stable voice/pitch/rate. */
  voiceKey: string;
  atc?: boolean;
  urgent?: boolean;
  /** Blocked transmission: plays a heterodyne squeal instead of the words. */
  stepOn?: boolean;
}

export interface Volumes {
  master: number;
  voice: number;
  fx: number;
  ambient: number;
}

export interface RadioAudio {
  /** Call from a user gesture. Creates/resumes the AudioContext. */
  unlock(): void;
  /** Queue a transmission. Resolves when it has played (or was dropped/cleared). */
  say(text: string, opts: SayOptions): Promise<void>;
  /** Drop queued transmissions and cut the current one. */
  clear(): void;
  chime(kind: ChimeKind): void;
  stopAlarm(): void;
  ambient(on: boolean): void;
  setVolumes(v: Partial<Volumes>): void;
  setVoiceEnabled(on: boolean): void;
}

const MAX_QUEUE = 4;
// Child voices (Edge: Ana en-US, Maisie en-GB, Gisela de-DE, Eloise fr-FR, Xiaoyou/Xiaoshuang zh) and macOS novelty voices.
const NOT_PILOTS = /\b(ana|maisie|gisela|eloise|xiaoyou|xiaoshuang|junior|kid|child|princess|bubbles|bells|boing|cellos|deranged|hysterical|organ|trinoids|whisper|zarvox|albert|bad news|good news|jester|superstar|wobble)\b/i;
// Voice language to look for per airline, best first. European carriers get their own language (reading English gives the
// accent); elsewhere a regional English, since Asian and Arabic voices reading English are hard to understand.
const L = (...l: string[]) => l.concat('en');
const GB = L('en-gb'), US = L('en-us'), IE = L('en-ie', 'en-gb'), FR = L('fr-fr', 'fr'), DE = L('de-de', 'de'), ES = L('es-es', 'es'), IT = L('it'), NL = L('nl'),
  PT = L('pt-pt', 'pt'), BR = L('pt-br', 'pt'), IN = L('en-in'), AU = L('en-au'), ZA = L('en-za'), GULF = L('en-in', 'en-gb');
const ACCENT: Record<string, string[]> = {
  BAW: GB, SHT: GB, CFE: GB, VIR: GB, EZY: GB, EXS: GB, TOM: GB, LOG: GB, BEE: GB, TCX: GB, UKV: GB, EFW: GB, JTH: GB, NJE: GB,
  EIN: IE, EAI: IE, RYR: IE, STK: IE, RUK: GB,  AUR: GB, AWC: GB, JBU: US, ASA: US, FDX: US, UPS: US, ASL: L('sr', 'hr'), LZB: L('bg'), DAH: FR, TAY: FR, CLX: FR, ROU: L('fr-ca', 'en-ca'), EZS: DE, EWG: DE, BCS: DE, SXS: L('de', 'tr'), CAI: L('tr', 'nl'), IGO: IN, DLA: IT, LAV: IT, NSZ: L('sv', 'nb'),
  AFR: FR, HOP: FR, TVF: FR, BEL: FR, LGL: FR, RAM: FR, TAR: FR, CRL: FR, ACA: L('fr-ca', 'en-ca'), TSC: L('fr-ca', 'en-ca'),
  DLH: DE, CLH: DE,  GWI: DE, CFG: DE, TUI: DE, SWR: DE, EDW: DE, AUA: DE, LDM: DE, CXS: DE,
  KLM: NL, KLC: NL, TRA: NL, TFL: NL,
  IBE: ES, IBS: ES, VLG: ES, AEA: ES, ANE: ES, LAN: L('es'), AVA: L('es'), AMX: L('es-mx', 'es'),
  ITY: IT, AZA: IT, NOS: IT, TAP: PT, TAM: BR, GLO: BR, AZU: BR,
  SAS: L('sv', 'da', 'nb', 'no'), NOZ: L('nb', 'no', 'sv'),  FIN: L('fi', 'sv'), ICE: L('is', 'en-gb'),
  LOT: L('pl'), ENT: L('pl'), AEE: L('el'), CYP: L('el'), THY: L('tr'), PGT: L('tr'), ROT: L('ro'), WZZ: L('hu', 'pl', 'ro'), CTN: L('hr'),
  CSA: L('cs'), BTI: L('lv', 'lt'), ELY: L('he'), AAL: US, UAL: US, DAL: US,    GTI: US,
  AIC: IN, VTI: IN, PIA: IN, ALK: IN, QFA: AU, ANZ: L('en-nz', 'en-au'), SAA: ZA, KQA: L('en-ke', 'en-za'), ETH: L('en-ke', 'en-za'),
  UAE: GULF, QTR: GULF, ETD: GULF, GFA: GULF, KAC: GULF, SVA: GULF, OMA: GULF, MSR: GULF, RJA: GULF, MEA: L('fr', 'en'),
  SIA: L('en-sg', 'en-gb'), MAS: L('en-sg', 'en-gb'), CPA: L('en-hk', 'en-gb'), THA: L('en-sg', 'en-gb'),
  JAL: US, ANA: US, KAL: US, AAR: US, CCA: L('en-hk', 'en-gb'), CES: L('en-hk', 'en-gb'), CSN: L('en-hk', 'en-gb'), CAL: L('en-hk', 'en-gb'),
};

interface QueueItem {
  text: string;
  opts: SayOptions;
  done: () => void;
}

/** FNV-1a -> mulberry32: deterministic pseudo-random numbers per speaker. */
function speakerRng(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Rough spoken duration (~14 chars/s), used when there is no speech engine. */
const estimateMs = (text: string) => Math.min(8000, Math.max(800, text.length * 70));

export function createRadioAudio(): RadioAudio {
  const synth: SpeechSynthesis | null = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  const vol: Volumes = { master: 0.8, voice: 1, fx: 0.7, ambient: 0.5 };
  let voiceEnabled = true;

  let ctx: AudioContext | null = null;
  let master!: GainNode, voiceBus!: GainNode, fxBus!: GainNode, ambientBus!: GainNode;
  let noise!: AudioBuffer, brown!: AudioBuffer;

  const queue: QueueItem[] = [];
  let busy = false;
  let abortCurrent: (() => void) | null = null;
  let alarmTimer: ReturnType<typeof setInterval> | null = null;
  let ambientNodes: AudioScheduledSourceNode[] | null = null;

  function audio(): AudioContext {
    if (ctx) return ctx;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
    const bus = () => {
      const g = ctx!.createGain();
      g.connect(master);
      return g;
    };
    voiceBus = bus();
    fxBus = bus();
    ambientBus = bus();
    applyVolumes();

    const len = ctx.sampleRate * 2;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = noise.getChannelData(0);
    const b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      b[i] = last * 3.5;
    }
    return ctx;
  }

  function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(vol.master, t, 0.02);
    voiceBus.gain.setTargetAtTime(vol.voice, t, 0.02);
    fxBus.gain.setTargetAtTime(vol.fx, t, 0.02);
    ambientBus.gain.setTargetAtTime(vol.ambient, t, 0.02);
  }

  function noiseSource(buf = noise): AudioBufferSourceNode {
    const s = audio().createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.loopStart = Math.random() * 1.5; // decorrelate overlapping uses
    return s;
  }

  /** Soft radio band for the noise layers. No saturation: distorted white noise is what sounded harsh. */
  function radioBand(dest: AudioNode): AudioNode {
    const c = audio();
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 400;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    hp.connect(lp).connect(dest);
    return hp;
  }

  /** Short noise burst through the radio band: squelch open click or closing tail. */
  function squelch(kind: 'open' | 'tail', at = audio().currentTime) {
    const c = audio();
    const g = c.createGain();
    g.connect(voiceBus);
    const src = noiseSource();
    src.connect(radioBand(g));
    const dur = kind === 'open' ? 0.03 : 0.09;
    const peak = kind === 'open' ? 0.06 : 0.05;
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.start(at);
    src.stop(at + dur + 0.05);
  }

  /** Faint hiss under a transmission. Returns a stop function. */
  function staticBed(level: number): () => void {
    const c = audio();
    const t0 = c.currentTime;
    const out = c.createGain();
    out.gain.setValueAtTime(0, t0);
    out.gain.linearRampToValueAtTime(1, t0 + 0.03);
    out.connect(voiceBus);
    const band = radioBand(out);

    const hiss = noiseSource();
    const hissGain = c.createGain();
    hissGain.gain.value = level;
    hiss.connect(hissGain).connect(band);

    hiss.start(t0);

    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      const t = c.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + 0.03);
      hiss.stop(t + 0.1);
      squelch('tail', t + 0.02);
    };
  }

  /** Two carriers keying at once: heterodyne squeal + noise, ~1 s. */
  function heterodyne(): number {
    const c = audio();
    const t = c.currentTime;
    const dur = 0.8 + Math.random() * 0.6;
    const out = c.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.06, t + 0.02);
    out.gain.setValueAtTime(0.06, t + dur - 0.05);
    out.gain.linearRampToValueAtTime(0, t + dur);
    out.connect(voiceBus);
    const band = radioBand(out);
    const base = 900 + Math.random() * 700;
    const lfo = c.createOscillator();
    lfo.frequency.value = 3 + Math.random() * 5;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 40 + Math.random() * 80;
    lfo.connect(lfoDepth);
    const nodes: AudioScheduledSourceNode[] = [lfo];
    for (const f of [base, base + 60 + Math.random() * 180]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      lfoDepth.connect(o.frequency);
      const g = c.createGain();
      g.gain.value = 0.3;
      o.connect(g).connect(band);
      nodes.push(o);
    }
    const n = noiseSource();
    const ng = c.createGain();
    ng.gain.value = 0.5;
    n.connect(ng).connect(band);
    nodes.push(n);
    for (const s of nodes) {
      s.start(t);
      s.stop(t + dur + 0.05);
    }
    return dur * 1000;
  }

  function pickVoice(opts: SayOptions): { voice: SpeechSynthesisVoice | null; pitch: number; rate: number } {
    const rnd = speakerRng(opts.voiceKey);
    const all = synth?.getVoices() ?? [];
    const lang = (v: SpeechSynthesisVoice) => v.lang.replace('_', '-').toLowerCase();
    // Child and novelty voices (Edge "Ana", macOS "Junior", "Bubbles"...) never belong on an ATC frequency.
    const usable = all.filter((v) => !NOT_PILOTS.test(v.name) && !settings.blockedVoices.includes(v.name));
    const english = usable.filter((v) => lang(v).startsWith('en'));
    // Pilots sound like their airline: an Air France crew gets a French voice reading English, a Delta crew an American one.
    // Accent strength (Settings): off = plain English; light = regional English, plus home-language voices only when they are
    // 'Multilingual' (fluent English with a light accent); strong = any home-language voice reading English.
    const level = settings.accents;
    const want = opts.atc || level === 'off' ? ['en-gb', 'en'] : ACCENT[opts.voiceKey.slice(0, 3)] ?? ['en-gb', 'en'];
    let pool: SpeechSynthesisVoice[] = english;
    for (const w of want) {
      let m = usable.filter((v) => lang(v).startsWith(w));
      if (level === 'light' && !w.startsWith('en')) m = m.filter((v) => /multilingual/i.test(v.name));
      if (m.length) { pool = m; break; }
    }
    if (!pool.length) pool = usable.length ? usable : all;
    const voice = pool.length ? pool[Math.floor(rnd() * pool.length)] : null;
    // Pitch only ever goes down a little: raising it makes adults sound like children.
    const pitch = opts.atc ? 0.95 + rnd() * 0.05 : 0.88 + rnd() * 0.12;
    let rate = opts.atc ? 1.05 + rnd() * 0.1 : 0.95 + rnd() * 0.3;
    if (opts.urgent) rate += 0.1;
    return { voice, pitch, rate };
  }

  function speak(text: string, opts: SayOptions): Promise<void> {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const { voice, pitch, rate } = pickVoice(opts);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else u.lang = 'en-GB';
      u.pitch = pitch;
      u.rate = rate;
      u.volume = Math.min(1, vol.master * vol.voice);
      // Some engines never fire onend; don't let the queue hang.
      const timer = setTimeout(finish, (estimateMs(text) / rate) * 2 + 3000);
      function finish() {
        clearTimeout(timer);
        abortCurrent = null;
        resolve();
      }
      u.onend = finish;
      u.onerror = finish;
      abortCurrent = () => {
        synth!.cancel();
        finish();
      };
      synth!.speak(u);
    });
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(finish, ms);
      function finish() {
        clearTimeout(timer);
        abortCurrent = null;
        resolve();
      }
      abortCurrent = finish;
    });
  }

  async function transmit({ text, opts }: QueueItem) {
    audio();
    squelch('open');
    if (opts.stepOn) {
      const stop = staticBed(0.008);
      await wait(heterodyne());
      stop();
      return;
    }
    const stop = staticBed(opts.urgent ? 0.012 : 0.006);
    await sleep(60); // let the click land before the words
    if (voiceEnabled && synth) await speak(text, opts);
    else await wait(voiceEnabled ? estimateMs(text) : 500);
    stop();
  }

  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const item = queue.shift()!;
      try {
        await transmit(item);
      } catch (e) {
        console.warn('radio: transmission failed', e);
      }
      item.done();
      await sleep(250 + Math.random() * 400);
    }
    busy = false;
  }

  function tone(
    freq: number,
    start: number,
    dur: number,
    type: OscillatorType = 'sine',
    gain = 0.25,
    toFreq?: number,
  ) {
    const c = audio();
    const t = c.currentTime + start;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.setValueAtTime(gain, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(fxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  const chimes: Record<Exclude<ChimeKind, 'alarm'>, () => void> = {
    strip: () => {
      tone(660, 0, 0.07, 'sine', 0.2);
      tone(990, 0.08, 0.1, 'sine', 0.2);
    },
    request: () => {
      tone(784, 0, 0.18, 'triangle', 0.3);
      tone(1046, 0.16, 0.3, 'triangle', 0.3);
    },
    conflict: () => {
      for (let i = 0; i < 3; i++) tone(1000, i * 0.14, 0.08, 'square', 0.06);
    },
    emergency: () => {
      for (let i = 0; i < 3; i++) tone(1400, i * 0.45, 0.4, 'triangle', 0.12, 500);
    },
    handoff: () => tone(523, 0, 0.22, 'sine', 0.25, 784),
    click: () => tone(2200, 0, 0.015, 'square', 0.08),
  };

  return {
    unlock() {
      void audio().resume();
      // iOS/Safari only allow speech after one utterance inside a gesture.
      if (synth) {
        const u = new SpeechSynthesisUtterance('');
        u.volume = 0;
        synth.speak(u);
      }
    },

    say(text, opts) {
      return new Promise<void>((done) => {
        queue.push({ text, opts, done });
        while (queue.length > MAX_QUEUE) {
          const i = queue.findIndex((q) => !q.opts.urgent);
          if (i < 0) break;
          queue.splice(i, 1)[0].done();
        }
        void pump();
      });
    },

    clear() {
      for (const q of queue.splice(0)) q.done();
      abortCurrent?.();
    },

    chime(kind) {
      audio();
      if (kind !== 'alarm') return chimes[kind]();
      if (alarmTimer) return;
      // STCA-style two-tone, repeating until stopAlarm().
      const cycle = () => {
        tone(950, 0, 0.18, 'square', 0.06);
        tone(750, 0.22, 0.18, 'square', 0.06);
      };
      cycle();
      alarmTimer = setInterval(cycle, 800);
    },

    stopAlarm() {
      if (alarmTimer) clearInterval(alarmTimer);
      alarmTimer = null;
    },

    ambient(on) {
      if (!on) {
        const t = ctx?.currentTime ?? 0;
        for (const n of ambientNodes ?? []) n.stop(t + 0.05);
        ambientNodes = null;
        return;
      }
      if (ambientNodes) return;
      const c = audio();
      // Room: brown noise, low-passed.
      const room = noiseSource(brown);
      const roomLp = c.createBiquadFilter();
      roomLp.type = 'lowpass';
      roomLp.frequency.value = 350;
      const roomGain = c.createGain();
      roomGain.gain.value = 0.06;
      room.connect(roomLp).connect(roomGain).connect(ambientBus);
      const nodes: AudioScheduledSourceNode[] = [room];
      for (const n of nodes) n.start();
      ambientNodes = nodes;
    },

    setVolumes(v) {
      for (const k of Object.keys(v) as (keyof Volumes)[]) {
        const x = v[k];
        if (x !== undefined) vol[k] = Math.min(1, Math.max(0, x));
      }
      applyVolumes();
    },

    setVoiceEnabled(on) {
      voiceEnabled = on;
    },
  };
}
