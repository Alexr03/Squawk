<script lang="ts">
  import { settings, saveSettings } from '../lib/settings.svelte.ts';
  import { createRadioAudio } from '../audio/radio.ts';
  interface Props { onBack: () => void }
  let { onBack }: Props = $props();
  let test: ReturnType<typeof createRadioAudio> | null = null;
  function hear() {
    test ??= createRadioAudio();
    test.unlock();
    test.setVolumes({ master: settings.master, voice: settings.voice, fx: settings.fx, ambient: settings.ambient });
    test.say('Heathrow Tower, Speedbird one two, established ILS runway two seven right, eight miles.', { voiceKey: 'BAW12' });
  }
  let listening = $state(false);
  function bindKey() {
    listening = true;
    const h = (e: KeyboardEvent) => { e.preventDefault(); settings.pttKey = e.code; saveSettings(); listening = false; removeEventListener('keydown', h, true); };
    addEventListener('keydown', h, true);
  }
</script>

<div class="set">
  <header><button class="back" onclick={onBack}>← Back</button><h1>Settings</h1></header>
  <div class="cols" onchange={saveSettings} oninput={saveSettings}>
    <section>
      <h2>Audio</h2>
      <label>Master <input type="range" min="0" max="1" step="0.05" bind:value={settings.master} /></label>
      <label>Radio voices <input type="range" min="0" max="1" step="0.05" bind:value={settings.voice} /></label>
      <label>Effects &amp; chimes <input type="range" min="0" max="1" step="0.05" bind:value={settings.fx} /></label>
      <label>Tower cab ambience <input type="range" min="0" max="1" step="0.05" bind:value={settings.ambient} /></label>
      <label><input type="checkbox" bind:checked={settings.pilotVoices} /> Speak pilot transmissions</label>
      <label><input type="checkbox" bind:checked={settings.atcVoice} /> Speak my transmissions too</label>
      <button onclick={hear}>Test the radio</button>
      <h2>Voice commands</h2>
      <label><input type="checkbox" bind:checked={settings.voiceInput} /> Push-to-talk speech recognition</label>
      <label>Recogniser
        <select bind:value={settings.voiceBackend}>
          <option value="webspeech">Browser speech (Chrome/Edge)</option>
          <option value="whisper">Whisper on this device (WebGPU, ~140 MB download once)</option>
        </select>
      </label>
      <label>Push-to-talk key <button onclick={bindKey}>{listening ? 'press a key…' : settings.pttKey}</button></label>
      <p class="note">Say instructions as a controller would: “Speedbird one two, turn left heading two seven zero, descend altitude four thousand feet.” High-confidence commands are sent at once; unclear ones ask you to confirm. Whisper keeps your audio on your machine.</p>
    </section>
    <section>
      <h2>Display</h2>
      <label>Pixel size <select bind:value={settings.pixelSize}>{#each [2, 3, 4] as p}<option value={p}>{p}×</option>{/each}</select></label>
      <label>Graphics <select bind:value={settings.quality}><option value="high">High</option><option value="low">Low (laptops)</option></select></label>
      <label>Interface scale <input type="range" min="0.8" max="1.4" step="0.05" bind:value={settings.uiScale} /> {Math.round(settings.uiScale * 100)}%</label>
      <h2>Accessibility</h2>
      <label><input type="checkbox" bind:checked={settings.highContrast} /> High contrast</label>
      <label><input type="checkbox" bind:checked={settings.colorblind} /> Colour-blind safe palette</label>
      <label><input type="checkbox" bind:checked={settings.reducedMotion} /> Reduce motion</label>
      <h2>Play</h2>
      <label><input type="checkbox" bind:checked={settings.tutorialHints} /> Coach hints in training shifts</label>
      <label><input type="checkbox" bind:checked={settings.autoSlow} /> Slow time automatically when the queue is long</label>
      <label>Leaderboard name <input class="txt" bind:value={settings.callsign} maxlength="20" placeholder="Anonymous" /></label>
      <p class="note">Graphics changes apply to the next shift.</p>
    </section>
  </div>
</div>

<style>
  .set { height: 100vh; overflow-y: auto; background: var(--screen-bg); padding: 18px clamp(16px, 4vw, 48px); font: 14px var(--ui); color: var(--ink); }
  header { display: flex; align-items: center; gap: 18px; }
  h1 { margin: 0; font: 600 21px var(--ui); color: var(--green); }
  h2 { margin: 20px 0 8px; font: 600 13px var(--ui); color: var(--muted); letter-spacing: 1px; }
  .back, button { background: var(--btn); border: 1px solid var(--line); color: var(--ink-strong); font: 13px var(--ui); padding: 3px 10px; cursor: pointer; }
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 34px; max-width: 1100px; }
  label { display: flex; align-items: center; gap: 10px; margin: 6px 0; }
  input[type=range] { flex: 1; accent-color: var(--green); }
  select, .txt { background: var(--btn); color: var(--ink-strong); border: 1px solid var(--line); font: 13px var(--ui); padding: 2px 6px; }
  .note { color: var(--muted); font-size: 13px; }
</style>
