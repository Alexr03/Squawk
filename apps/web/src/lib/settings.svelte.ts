// Player settings, kept in localStorage (a per-browser convenience; everything works without it).
export interface Settings {
  master: number; voice: number; fx: number; ambient: number; music: number;
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
  fastDay: boolean;            // the clock and daylight run 30x (1 h = 2 min); traffic stays real time
  depth: boolean;              // depth of field, horizon haze and vignette on the 3D view
  smoothEdges: boolean;        // anti-aliasing, soft shadows and soft light falloff on the 3D view (off: crisp pixel art)
  accents: 'off' | 'light' | 'strong'; // how strongly pilots sound like their airline's country
  blockedVoices: string[];     // speech voices the player switched off
  uiSounds: boolean;
  radioVoices: 'all' | 'important' | 'off'; // which transmissions are spoken; the rest play a tone           // clicks and chimes on buttons and switches
}

const DEFAULTS: Settings = {
  master: 0.5, voice: 0.8, fx: 0.5, ambient: 0.2, music: 0.4, pilotVoices: true, atcVoice: false,
  voiceInput: false, voiceBackend: 'webspeech', pttKey: 'Backquote',
  pixelSize: 3, quality: 'high', uiScale: 1, highContrast: false, reducedMotion: false, colorblind: false,
  autoSlow: false, tutorialHints: true, callsign: '', audioV: 2, fastDay: true, depth: true, smoothEdges: true, accents: 'light', blockedVoices: [], uiSounds: true, radioVoices: 'important',
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

/** Fast day: one hour of clock and daylight per two minutes of play. */
export const DAY_SCALE = 30;
/** The time of day shown on the clock and used for the sun: the sim's own clock, sped up when fast day is on. */
export const dayClock = (simTime: number, shiftStart: number) => (settings.fastDay ? shiftStart + (simTime - shiftStart) * DAY_SCALE : simTime);
export function saveSettings() {
  try { localStorage.setItem('squawk.settings', JSON.stringify(settings)); } catch { /* storage unavailable */ }
}
