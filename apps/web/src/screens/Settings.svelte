<script lang="ts">
  import { settings, saveSettings } from '../lib/settings.svelte.ts';
  import { createRadioAudio } from '../audio/radio.ts';
  import { BUILT, COMMIT, REPO, VERSION } from '../lib/version.ts';
  interface Props { onBack: () => void }
  let { onBack }: Props = $props();

  const SECTIONS = [
    { id: 'audio', name: 'Sound', hint: 'Radio, chimes and the tower cab' },
    { id: 'voice', name: 'Voice commands', hint: 'Talk to pilots with your microphone' },
    { id: 'display', name: 'Display', hint: 'Graphics and interface size' },
    { id: 'access', name: 'Accessibility', hint: 'Contrast, colour and motion' },
    { id: 'play', name: 'Gameplay', hint: 'Hints, pacing and your name' },
    { id: 'about', name: 'About', hint: `Version ${VERSION}` },
  ] as const;
  let tab = $state<(typeof SECTIONS)[number]['id']>('audio');

  let test: ReturnType<typeof createRadioAudio> | null = null;
  let playing = $state(false);
  async function hear() {
    test ??= createRadioAudio();
    test.unlock();
    test.setVolumes({ master: settings.master, voice: settings.voice, fx: settings.fx, ambient: settings.ambient });
    playing = true;
    await test.say('Heathrow Tower, Speedbird one two, established ILS runway two seven right, eight miles.', { voiceKey: 'BAW12' });
    playing = false;
  }
  let listening = $state(false);
  function bindKey() {
    listening = true;
    const h = (e: KeyboardEvent) => { e.preventDefault(); settings.pttKey = e.code; saveSettings(); listening = false; removeEventListener('keydown', h, true); };
    addEventListener('keydown', h, true);
  }
  const keyName = (code: string) => code === 'Backquote' ? 'Backtick  `' : code === 'Space' ? 'Space bar' : code.replace(/^Key|^Digit/, '');
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  function esc(e: KeyboardEvent) { if (e.key === 'Escape' && !listening) onBack(); }
</script>

<svelte:window onkeydown={esc} />
{#snippet slider(label: string, desc: string, key: 'master' | 'voice' | 'fx' | 'ambient')}
  <div class="row">
    <div class="lab"><b>{label}</b><span>{desc}</span></div>
    <div class="ctl"><input type="range" min="0" max="1" step="0.05" bind:value={settings[key]} aria-label={label} /><output>{pct(settings[key])}</output></div>
  </div>
{/snippet}
{#snippet toggle(label: string, desc: string, key: 'pilotVoices' | 'atcVoice' | 'voiceInput' | 'highContrast' | 'colorblind' | 'reducedMotion' | 'tutorialHints' | 'autoSlow' | 'fastDay')}
  <label class="row">
    <div class="lab"><b>{label}</b><span>{desc}</span></div>
    <div class="ctl"><input class="switch" type="checkbox" bind:checked={settings[key]} /></div>
  </label>
{/snippet}

<div class="set">
  <header>
    <button class="back" onclick={onBack} aria-label="Back to the menu"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg></button>
    <h1>Settings</h1>
    <span class="saved">Changes are saved as you make them</span>
  </header>
  <div class="body">
    <nav aria-label="Settings sections">
      {#each SECTIONS as s}
        <button class:on={tab === s.id} onclick={() => (tab = s.id)} aria-current={tab === s.id}>
          <b>{s.name}</b><span>{s.hint}</span>
        </button>
      {/each}
    </nav>

    <div class="panel" onchange={saveSettings} oninput={saveSettings}>
      {#if tab === 'audio'}
        <section>
          <h2>Volume</h2>
          {@render slider('Master', 'Everything at once', 'master')}
          {@render slider('Radio voices', 'Pilots (and you, if you turn that on)', 'voice')}
          {@render slider('Chimes and alerts', 'New strips, requests, conflict alarms', 'fx')}
          {@render slider('Tower cab', 'A quiet room tone under the radio', 'ambient')}
          <div class="row">
            <div class="lab"><b>Test the radio</b><span>A pilot checks in with your current volumes</span></div>
            <div class="ctl"><button class="act" class:playing onclick={hear}>{#if playing}<span class="eq"><i></i><i></i><i></i></span>Transmitting{:else}Play a call{/if}</button></div>
          </div>
        </section>
        <section>
          <h2>Who speaks</h2>
          {@render toggle('Pilot voices', 'Read pilot transmissions aloud', 'pilotVoices')}
          {@render toggle('Your transmissions', 'Also read out what you say to pilots', 'atcVoice')}
        </section>
      {:else if tab === 'voice'}
        <section>
          <h2>Push to talk</h2>
          {@render toggle('Voice commands', 'Hold the push-to-talk key and speak like a controller', 'voiceInput')}
          <div class="row">
            <div class="lab"><b>Push-to-talk key</b><span>Hold it while you speak</span></div>
            <div class="ctl"><button class="act key" class:wait={listening} onclick={bindKey}>{listening ? 'Press a key…' : keyName(settings.pttKey)}</button></div>
          </div>
          <div class="row">
            <div class="lab"><b>Recogniser</b><span>Browser speech is instant; Whisper keeps your audio on this device</span></div>
            <div class="ctl">
              <select bind:value={settings.voiceBackend}>
                <option value="webspeech">Browser speech (Chrome, Edge)</option>
                <option value="whisper">Whisper on this device (140 MB, once)</option>
              </select>
            </div>
          </div>
        </section>
        <section class="example">
          <h2>How to say it</h2>
          <p>Callsign first, then the instruction. Each aircraft's card shows its radio name.</p>
          <ul>
            <li>“Speedbird one two, turn left heading two seven zero, descend altitude four thousand feet.”</li>
            <li>“Easy four five, taxi to holding point November one via Alpha, Bravo.”</li>
            <li>“Shuttle two Victor, runway two seven left, cleared for take-off.”</li>
          </ul>
          <p class="note">Clear commands are sent straight away. If the recogniser isn't sure, you'll be asked to confirm.</p>
        </section>
      {:else if tab === 'display'}
        <section>
          <h2>Graphics</h2>
          <div class="row">
            <div class="lab"><b>Quality</b><span>Low turns off shadows and bloom for laptops</span></div>
            <div class="ctl seg">
              {#each [['high', 'High'], ['low', 'Low']] as [v, n]}<button class:on={settings.quality === v} onclick={() => { settings.quality = v as 'high' | 'low'; saveSettings(); }}>{n}</button>{/each}
            </div>
          </div>
          <div class="row">
            <div class="lab"><b>Pixel size</b><span>Bigger pixels look chunkier and run faster</span></div>
            <div class="ctl seg">
              {#each [2, 3, 4] as v}<button class:on={settings.pixelSize === v} onclick={() => { settings.pixelSize = v; saveSettings(); }}>{v}×</button>{/each}
            </div>
          </div>
          <label class="row">
            <div class="lab"><b>Depth of field</b><span>Miniature-style blur toward the edges, haze on the horizon</span></div>
            <div class="ctl"><input class="switch" type="checkbox" bind:checked={settings.depth} /></div>
          </label>
          <p class="note">Graphics changes apply from the next shift.</p>
        </section>
        <section>
          <h2>Interface</h2>
          <div class="row">
            <div class="lab"><b>Interface scale</b><span>Panels, strips and text in a shift</span></div>
            <div class="ctl"><input type="range" min="0.8" max="1.4" step="0.05" bind:value={settings.uiScale} aria-label="Interface scale" /><output>{pct(settings.uiScale)}</output></div>
          </div>
        </section>
      {:else if tab === 'access'}
        <section>
          <h2>Seeing it clearly</h2>
          {@render toggle('High contrast', 'Brighter text and lines', 'highContrast')}
          {@render toggle('Colour-blind safe palette', 'Blue instead of green, magenta instead of red', 'colorblind')}
          {@render toggle('Reduce motion', 'No pulses, sweeps or animated transitions', 'reducedMotion')}
        </section>
      {:else if tab === 'about'}
        <section>
          <h2>Squawk</h2>
          <div class="row"><div class="lab"><b>Version</b><span>Semantic versioning: major.minor.patch</span></div><div class="ctl"><output class="wide">{VERSION}</output></div></div>
          <div class="row"><div class="lab"><b>Build</b><span>{BUILT ? `Built ${BUILT}` : 'Development build'}</span></div>
            <div class="ctl">{#if /^[0-9a-f]{7}$/.test(COMMIT)}<a class="act" href="{REPO}/commit/{COMMIT}" target="_blank" rel="noopener">{COMMIT}</a>{:else}<output class="wide">{COMMIT}</output>{/if}</div></div>
          <div class="row"><div class="lab"><b>Source and release notes</b><span>github.com/Alexr03/Squawk</span></div><div class="ctl"><a class="act" href={REPO} target="_blank" rel="noopener">Open on GitHub</a></div></div>
        </section>
        <section>
          <h2>Data</h2>
          <p class="note">Airport layouts © OpenStreetMap contributors (ODbL). Procedures from the UK AIP via NATS AIS. Traffic from The OpenSky Network. Weather from the Iowa Environmental Mesonet. Not for real-world navigation or air traffic control.</p>
        </section>
      {:else}
        <section>
          <h2>Pacing</h2>
          {@render toggle('Coach hints', 'Tips from the instructor in training shifts', 'tutorialHints')}
          {@render toggle('Slow down when busy', 'Time eases off when many calls are waiting', 'autoSlow')}
          {@render toggle('Fast day and night', 'The clock and daylight run 30× (an hour every two minutes) so you see dusk and dawn in one session. Traffic and radio stay in real time.', 'fastDay')}
        </section>
        <section>
          <h2>Leaderboard</h2>
          <div class="row">
            <div class="lab"><b>Your name</b><span>Shown next to your daily challenge score</span></div>
            <div class="ctl"><input class="txt" bind:value={settings.callsign} maxlength="20" placeholder="Anonymous" aria-label="Leaderboard name" /></div>
          </div>
        </section>
      {/if}
    </div>
  </div>
</div>

<style>
  .set { height: 100vh; box-sizing: border-box; display: flex; flex-direction: column; background: var(--screen-bg); padding: 22px clamp(16px, 4vw, 56px); font: 14px var(--ui); color: var(--ink); }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 22px; }
  h1 { margin: 0; font: 600 26px var(--ui); color: var(--ink-strong); }
  .saved { margin-left: auto; font: 500 12px var(--ui); color: var(--muted); }
  button { font-family: var(--ui); cursor: pointer; border: none; color: inherit; }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  .back { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: var(--glass); box-shadow: var(--lift); color: var(--ink-strong); }
  .back:hover { color: var(--green); }

  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: 260px minmax(0, 720px); gap: 22px; }
  nav { display: flex; flex-direction: column; gap: 4px; }
  nav button { display: flex; flex-direction: column; gap: 1px; text-align: left; padding: 11px 14px; border-radius: 12px; background: transparent; }
  nav button b { font: 600 15px var(--ui); color: var(--ink-strong); }
  nav button span { font: 400 12px var(--ui); color: var(--muted); }
  nav button:hover { background: var(--knob); }
  nav button.on { background: var(--glass); box-shadow: var(--lift), inset 3px 0 0 var(--green); }

  .panel { overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding-bottom: 20px; scrollbar-width: thin; }
  section { border-radius: 16px; background: var(--glass); backdrop-filter: blur(14px); box-shadow: var(--lift), inset 0 0 0 1px var(--glass-line); padding: 6px 18px 8px; }
  h2 { margin: 12px 0 4px; font: 600 13px var(--ui); color: var(--green); }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 12px 0; border-top: 1px solid var(--glass-line); cursor: default; }
  h2 + .row { border-top: none; }
  label.row { cursor: pointer; }
  .lab { display: flex; flex-direction: column; gap: 2px; }
  .lab b { font: 500 15px var(--ui); color: var(--ink-strong); }
  .lab span { font: 400 12.5px var(--ui); color: var(--muted); }
  .ctl { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  input[type=range] { width: 200px; accent-color: var(--green); }
  output.wide { width: auto; }
  a.act { text-decoration: none; }
  output { width: 42px; text-align: right; font: 600 13px var(--mono); color: var(--ink-strong); }

  /* Switches made from the native checkbox. */
  .switch { appearance: none; width: 44px; height: 26px; border-radius: 13px; background: rgba(255, 255, 255, 0.14); position: relative; cursor: pointer; transition: background 0.15s; margin: 0; }
  .switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4); transition: transform 0.15s; }
  .switch:checked { background: var(--green); }
  .switch:checked::after { transform: translateX(18px); }

  .act { padding: 8px 16px; border-radius: 999px; background: var(--knob); box-shadow: inset 0 0 0 1px var(--glass-line); font: 600 13px var(--ui); color: var(--ink-strong); display: inline-flex; align-items: center; gap: 8px; }
  .act:hover { box-shadow: inset 0 0 0 1px var(--green); }
  .act.playing { color: var(--green); }
  .act.key { min-width: 64px; justify-content: center; font-family: var(--mono); }
  .act.wait { color: var(--amber); box-shadow: inset 0 0 0 1px var(--amber); }
  .eq { display: inline-flex; gap: 2px; align-items: flex-end; height: 12px; }
  .eq i { width: 3px; background: currentColor; animation: eq 0.6s infinite alternate; }
  .eq i:nth-child(1) { height: 5px; } .eq i:nth-child(2) { height: 12px; animation-delay: 0.2s; } .eq i:nth-child(3) { height: 8px; animation-delay: 0.4s; }
  @keyframes eq { to { transform: scaleY(0.4); } }
  .seg { background: var(--knob); border-radius: 999px; padding: 3px; gap: 2px; }
  .seg button { padding: 6px 14px; border-radius: 999px; background: transparent; font: 600 13px var(--ui); color: var(--ink); }
  .seg button.on { background: var(--green); color: var(--bg); }
  select, .txt { background: var(--knob); color: var(--ink-strong); border: 1px solid var(--glass-line); border-radius: 10px; font: 13px var(--ui); padding: 7px 10px; }
  .txt { width: 200px; }
  .example p { margin: 4px 0 8px; color: var(--ink); }
  .example ul { margin: 0 0 8px; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; color: var(--ink-strong); }
  .note { color: var(--muted); font-size: 12.5px; margin: 8px 0 6px; }
  @media (max-width: 820px) {
    .body { grid-template-columns: 1fr; }
    nav { flex-direction: row; overflow-x: auto; }
    nav button span { display: none; }
    .row { flex-wrap: wrap; }
    input[type=range], .txt { width: 150px; }
    .saved { display: none; }
  }
</style>
