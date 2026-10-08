import { createRadioAudio, type ChimeKind, type SayOptions, type Volumes } from './radio';
import { createVoiceInput, type VoiceInput } from './voice';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const radio = createRadioAudio();
document.addEventListener('pointerdown', () => radio.unlock(), { once: true });

const lines: Record<string, [string, SayOptions]> = {
  atc: [
    'Speedbird one two, turn left heading two seven zero, descend altitude four thousand feet, QNH one zero one three.',
    { voiceKey: 'Heathrow Director', atc: true },
  ],
  pilot: [
    'Left heading two seven zero, descend altitude four thousand feet, QNH one zero one three, Speedbird one two.',
    { voiceKey: 'BAW12' },
  ],
  pilot2: [
    'Heathrow Director, good morning, Shamrock one five two, flight level one two zero, information Bravo.',
    { voiceKey: 'EIN152' },
  ],
  foreign: ['Lufthansa nine two six, request direct Lambourne.', { voiceKey: 'DLH926' }],
  urgent: [
    'Mayday mayday mayday, Speedbird four seven, engine failure, request immediate return.',
    { voiceKey: 'BAW47', urgent: true },
  ],
  stepon: ['', { voiceKey: 'blocked', stepOn: true }],
};

$('#radio').addEventListener('click', (e) => {
  const key = (e.target as HTMLElement).dataset.say;
  if (!key) return;
  if (key === 'burst') {
    for (let i = 1; i <= 8; i++) void radio.say(`Transmission number ${i}.`, { voiceKey: `T${i}`, urgent: i === 2 });
    return;
  }
  const [text, opts] = lines[key];
  void radio.say(text, opts).then(() => console.log('done:', key));
});
$('#clear').onclick = () => radio.clear();
$<HTMLInputElement>('#voiceOn').onchange = (e) => radio.setVoiceEnabled((e.target as HTMLInputElement).checked);

$('#chimes').addEventListener('click', (e) => {
  const kind = (e.target as HTMLElement).dataset.chime as ChimeKind | undefined;
  if (kind) radio.chime(kind);
});
$('#stopAlarm').onclick = () => radio.stopAlarm();
$<HTMLInputElement>('#ambient').onchange = (e) => radio.ambient((e.target as HTMLInputElement).checked);

$('#volumes').addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  radio.setVolumes({ [el.dataset.vol as keyof Volumes]: Number(el.value) });
});

let voice: VoiceInput | null = null;
const ptt = $<HTMLButtonElement>('#ptt');
const out = $('#transcript');
$('#enableVoice').onclick = () => {
  voice?.dispose();
  voice = createVoiceInput({
    prefer: $<HTMLSelectElement>('#prefer').value as 'whisper' | 'webspeech',
    onState: (s, d) => {
      $('#vstate').textContent = `${s}${d ? ` - ${d}` : ''} [backend: ${voice?.backend ?? '...'}]`;
    },
    onPartial: (t) => (out.textContent = `... ${t}`),
    onFinal: (t, c) => (out.textContent = `FINAL (${c.toFixed(2)}): ${t || '(nothing heard)'}`),
  });
  console.log('voice available:', voice.available(), 'backend:', voice.backend);
  ptt.disabled = voice.backend === 'none';
};

const down = () => {
  if (!voice) return;
  ptt.classList.add('down');
  radio.chime('click');
  voice.start();
};
const up = () => {
  ptt.classList.remove('down');
  voice?.stop();
};
ptt.addEventListener('pointerdown', down);
ptt.addEventListener('pointerup', up);
ptt.addEventListener('pointerleave', up);
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || (e.target as HTMLElement).tagName === 'INPUT') return;
  e.preventDefault();
  down();
});
window.addEventListener('keyup', (e) => {
  if (e.code !== 'Space' || (e.target as HTMLElement).tagName === 'INPUT') return;
  e.preventDefault(); // don't "click" a focused button
  up();
});
