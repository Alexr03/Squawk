// Player settings, kept in localStorage (a per-browser convenience; everything works without it).
export interface Settings {
  master: number; voice: number; fx: number; ambient: number;
  pilotVoices: boolean;        // speak pilot transmissions
  atcVoice: boolean;           // speak your own transmissions too
  voiceInput: boolean;         // push-to-talk speech recognition
  voiceBackend: 'whisper' | 'webspeech';
  pttKey: string;              // KeyboardEvent.code
  pixelSize: number; quality: 'high' | 'low';
  uiScale: number; highContrast: boolean; reducedMotion: boolean; colorblind: boolean;
  autoSlow: boolean;           // slow time when the queue gets long
  tutorialHints: boolean;
  callsign: string;            // name on leaderboards
}

const DEFAULTS: Settings = {
  master: 0.8, voice: 0.9, fx: 0.6, ambient: 0.25, pilotVoices: true, atcVoice: false,
  voiceInput: false, voiceBackend: 'webspeech', pttKey: 'Backquote',
  pixelSize: 3, quality: 'high', uiScale: 1, highContrast: false, reducedMotion: false, colorblind: false,
  autoSlow: false, tutorialHints: true, callsign: '',
};

function read(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('squawk.settings') ?? '{}') }; } catch { return { ...DEFAULTS }; }
}
export const settings: Settings = $state(read());
export function saveSettings() {
  try { localStorage.setItem('squawk.settings', JSON.stringify(settings)); } catch { /* storage unavailable */ }
}
