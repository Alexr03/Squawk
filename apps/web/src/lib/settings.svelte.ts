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
  audioV: number;              // bumped when the mix changes, to reset saved volumes once
}

const DEFAULTS: Settings = {
  master: 0.5, voice: 0.8, fx: 0.5, ambient: 0.2, pilotVoices: true, atcVoice: false,
  voiceInput: false, voiceBackend: 'webspeech', pttKey: 'Backquote',
  pixelSize: 3, quality: 'high', uiScale: 1, highContrast: false, reducedMotion: false, colorblind: false,
  autoSlow: false, tutorialHints: true, callsign: '', audioV: 2,
};

function read(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem('squawk.settings') ?? '{}');
    // The radio mix was retuned (quieter, no harsh static): start from the new volumes once.
    if ((saved.audioV ?? 1) < DEFAULTS.audioV) { delete saved.master; delete saved.voice; delete saved.fx; delete saved.ambient; saved.audioV = DEFAULTS.audioV; }
    return { ...DEFAULTS, ...saved };
  } catch { return { ...DEFAULTS }; }
}
export const settings: Settings = $state(read());
export function saveSettings() {
  try { localStorage.setItem('squawk.settings', JSON.stringify(settings)); } catch { /* storage unavailable */ }
}
