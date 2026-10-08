// UK CAP 413 radio language: the single source of truth for what goes out on frequency.
//   text / speech        radio message -> written log line / text-to-speech line
//   parseLine / complete typed shortcuts ("BAW12 H270 A40 S210")
//   parseSpeech / parse  spoken or written phraseology -> commands
export { callsign, spokenNumber, speech, text, type PhraseCtx } from './text.ts';
export { complete, parseLine, type ParseCtx } from './shortcuts.ts';
export { parse, parseSpeech, type SpeechResult } from './voice.ts';
export { placeName } from './places.ts';
