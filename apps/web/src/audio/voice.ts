// Push-to-talk speech recognition. Whisper on WebGPU (local, audio never leaves the
// machine) with a Web Speech API fallback.

export type VoiceState = 'idle' | 'loading' | 'ready' | 'listening' | 'processing' | 'error';
export type VoiceBackend = 'whisper' | 'webspeech' | 'none';

export interface VoiceInputOptions {
  onPartial?(text: string): void;
  onFinal(text: string, confidence: number): void;
  onState?(s: VoiceState, detail?: string): void;
  prefer?: 'whisper' | 'webspeech';
}

export interface VoiceInput {
  /** PTT down. */
  start(): void;
  /** PTT up: produces onFinal. */
  stop(): void;
  available(): { whisper: boolean; webspeech: boolean };
  readonly backend: VoiceBackend;
  dispose(): void;
}

export const WHISPER_MODEL = 'onnx-community/whisper-base.en';
const WHISPER_CONFIDENCE = 0.8; // Whisper gives no per-utterance confidence through the pipeline.

// Minimal Web Speech recognition typing (the constructor isn't in lib.dom).
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  const w = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function available() {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    whisper: !!nav && 'gpu' in nav && !!nav.gpu && !!nav.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined',
    webspeech: !!recognitionCtor(),
  };
}

type Transcriber = (audio: Float32Array) => Promise<string>;

async function loadWhisper(onProgress: (pct: number) => void): Promise<Transcriber> {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');
  const { pipeline } = await import('@huggingface/transformers');
  const asr = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
    device: 'webgpu',
    // q4/q4: ~142 MB download, no shader-f16 needed, same transcripts as fp32 in testing.
    // (fp16 merged decoder fails to load in onnxruntime-web 1.31-dev.)
    dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' },
    progress_callback: (p) => {
      if (p.status === 'progress_total') onProgress(p.progress);
    },
  });
  // Initial-prompt / vocabulary bias (prompt_ids) isn't implemented in transformers.js yet.
  const run: Transcriber = async (audio) => {
    const out = await asr(audio);
    return (Array.isArray(out) ? out[0] : out).text;
  };
  await run(new Float32Array(16000)); // warm-up: compiles shaders so the first real call is quick
  return run;
}

/** Whisper writes things like "[BLANK_AUDIO]" or "(static)" for non-speech. */
const cleanWhisper = (s: string) => s.replace(/\[[^\]]*\]|\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();

export function createVoiceInput(opts: VoiceInputOptions): VoiceInput {
  const avail = available();
  const prefer = opts.prefer ?? 'whisper';
  let backend: VoiceBackend =
    avail[prefer] ? prefer : avail.whisper ? 'whisper' : avail.webspeech ? 'webspeech' : 'none';
  const state = (s: VoiceState, detail?: string) => opts.onState?.(s, detail);
  let disposed = false;
  let held = false;

  // ---- Whisper ----
  let whisper: Promise<Transcriber> | null = null;
  let stream: Promise<MediaStream> | null = null;
  let recorder: MediaRecorder | null = null;

  function startWhisperLoad() {
    state('loading', 'Loading speech model');
    whisper = loadWhisper((pct) => state('loading', `Downloading speech model ${Math.round(pct)}%`));
    whisper.then(
      () => !disposed && !held && state('ready', 'Whisper (WebGPU, on-device)'),
      (e: unknown) => {
        if (disposed) return;
        const msg = `Speech model failed to load: ${e instanceof Error ? e.message : String(e)}`;
        if (avail.webspeech) {
          backend = 'webspeech';
          state('ready', `${msg}. Using browser speech recognition instead.`);
        } else {
          backend = 'none';
          state('error', msg);
        }
      },
    );
  }

  async function startRecording() {
    stream ??= navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    let s: MediaStream;
    try {
      s = await stream;
    } catch (e) {
      stream = null;
      held = false;
      state('error', micError(e));
      return;
    }
    if (!held || disposed) return; // released before the mic opened
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(s);
    recorder = rec;
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => void transcribe(new Blob(chunks, { type: rec.mimeType }));
    rec.start();
    state('listening');
  }

  async function transcribe(blob: Blob) {
    state('processing');
    try {
      // OfflineAudioContext at 16 kHz resamples to Whisper's rate and gives mono channel 0.
      const buf = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await blob.arrayBuffer());
      const pcm = buf.getChannelData(0);
      let text = '';
      if (pcm.length > 16000 * 0.3) text = cleanWhisper(await (await whisper!)(pcm));
      if (disposed) return;
      opts.onFinal(text, text ? WHISPER_CONFIDENCE : 0);
      state('ready');
    } catch (e) {
      if (!disposed) state('error', `Transcription failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---- Web Speech ----
  let recognition: Recognition | null = null;
  let finals: { text: string; confidence: number }[] = [];
  let interim = '';

  function startWebSpeech() {
    finals = [];
    interim = '';
    listen();
    state('listening');
  }

  function listen() {
    const Ctor = recognitionCtor()!;
    const rec = new Ctor();
    recognition = rec;
    rec.lang = 'en-GB';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    const sessionFinals: typeof finals = [];
    const base = finals;
    rec.onresult = (e) => {
      sessionFinals.length = 0;
      interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const best = e.results[i][0];
        if (e.results[i].isFinal) sessionFinals.push({ text: best.transcript.trim(), confidence: best.confidence });
        else interim += best.transcript;
      }
      finals = [...base, ...sessionFinals];
      opts.onPartial?.([...finals.map((f) => f.text), interim.trim()].filter(Boolean).join(' '));
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      held = false;
      const msg =
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'Microphone permission denied'
          : e.error === 'audio-capture'
            ? 'No microphone found'
            : e.error === 'network'
              ? 'Speech recognition service unreachable'
              : `Speech recognition error: ${e.error}`;
      state('error', msg);
    };
    rec.onend = () => {
      if (rec !== recognition || disposed) return;
      if (held) return listen(); // engine stopped on silence while PTT still held
      recognition = null;
      let text = finals.map((f) => f.text).join(' ').trim();
      // Chrome reports 0 confidence when it has none; treat that as middling.
      let confidence = finals.length
        ? finals.reduce((a, f) => a + (f.confidence || 0.5), 0) / finals.length
        : 0;
      if (!text && interim.trim()) {
        text = interim.trim();
        confidence = 0.5;
      }
      opts.onFinal(text, confidence);
      state('ready');
    };
    try {
      rec.start();
    } catch (e) {
      held = false;
      state('error', `Speech recognition failed to start: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---- init ----
  if (backend === 'whisper') startWhisperLoad();
  else if (backend === 'webspeech') state('ready', 'Browser speech recognition');
  else state('error', 'Voice input is not supported in this browser');

  return {
    start() {
      if (held || disposed || backend === 'none') return;
      held = true;
      if (backend === 'whisper') void startRecording();
      else startWebSpeech();
    },
    stop() {
      if (!held) return;
      held = false;
      if (backend === 'whisper') {
        if (recorder?.state === 'recording') recorder.stop();
        recorder = null;
      } else {
        recognition?.stop();
      }
    },
    available,
    get backend() {
      return backend;
    },
    dispose() {
      disposed = true;
      held = false;
      recorder?.stop();
      recognition?.abort();
      void stream?.then((s) => s.getTracks().forEach((t) => t.stop()), () => {});
      state('idle');
    },
  };
}

function micError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone permission denied';
  if (name === 'NotFoundError') return 'No microphone found';
  return `Microphone unavailable: ${e instanceof Error ? e.message : String(e)}`;
}
