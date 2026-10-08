<script lang="ts">
  interface Props { onClose: () => void }
  let { onClose }: Props = $props();
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }} />

<div class="help" role="dialog" aria-label="How to play">
  <div class="box">
    <header><h2>How to play</h2><button onclick={onClose} aria-label="Close">×</button></header>
    <div class="cols">
      <section>
        <h3>The job</h3>
        <p>You are a controller at Heathrow. Aircraft call you on the radio; you give instructions; the pilot reads them back and does it. Keep aircraft apart, keep them moving, hand them to the next controller on time. AI controllers run every position you don't.</p>
        <h3>Giving instructions</h3>
        <ul>
          <li><b>Select</b> an aircraft: click it, click its strip, <kbd>Tab</kbd> to cycle, or <kbd>N</kbd> for the most urgent.</li>
          <li><b>Right-click</b> for the radial menu of what makes sense right now.</li>
          <li><b>Keys</b> for the selected aircraft: <kbd>C</kbd> clearance · <kbd>P</kbd> push · <kbd>X</kbd> taxi · <kbd>F</kbd> follow the greens · <kbd>L</kbd> line up / land · <kbd>T</kbd> take-off · <kbd>G</kbd> go around · <kbd>H</kbd> heading · <kbd>A</kbd> altitude · <kbd>S</kbd> speed · <kbd>D</kbd> direct · <kbd>I</kbd> ILS · <kbd>K</kbd> contact next · <kbd>Z</kbd> negative, say again.</li>
          <li><b>Radar</b>: drag a line out of the selected blip to give a heading.</li>
          <li><b>Taxi</b>: the suggested route is drawn — click taxiway points to route through them, <kbd>Enter</kbd> to send. Zoom in to read the airfield signs: yellow are taxiways, red are holding points, small dark tags are stands.</li>
          <li><b>Type</b> (<kbd>Enter</kbd> or <kbd>/</kbd>): <code>BAW12 H270 A40 S210</code>, <code>LUW</code>, <code>CTO</code>, <code>CLR</code>, <code>TX 27L VIA A B</code>, <code>ILS27R</code>, <code>CT TWR</code>.</li>
          <li><b>Talk</b>: turn on push-to-talk in Settings, hold <kbd>`</kbd> and speak like a controller: callsign first, then the instruction. Every aircraft shows its radio name (BAW is <i>Speedbird</i>, EZY is <i>Easy</i>); spelling the letters works too. With an aircraft selected you can skip the callsign.<br>“Speedbird one two, taxi to holding point November one via Alpha, Bravo” · “Shuttle two Victor, line up and wait runway two seven left” · “Easy four five, turn left heading two seven zero, descend altitude four thousand”. The route after “via” is optional.</li>
        </ul>
      </section>
      <section>
        <h3>The rules (simplified)</h3>
        <ul>
          <li><b>Runway</b>: one aircraft at a time. Clear to land only when the runway is clear; no landing clearance by half a mile means a go-around.</li>
          <li><b>Departures</b>: one aircraft rolling at a time. On Realistic (or with <i>Departure gaps</i> on in Free shift) real spacing applies too: 2 minutes between aircraft on the same route, 1 minute on different routes, 2 behind a heavy, 3 behind an A380. Strips then count down the wait.</li>
          <li><b>Radar</b>: 3 nm or 1,000 ft near the airport (5 nm further out); 2.5–7 nm on final depending on wake. Amber tags mean a predicted conflict, red means lost.</li>
          <li><b>Readbacks</b>: listen — sometimes a pilot reads back the wrong level or heading. Correct it with <kbd>Z</kbd>.</li>
          <li><b>Emergencies</b>: 7700 needs priority; 7600 is a radio failure — the aircraft flies its last clearance and Tower uses light signals. An engine, tyre or bird-strike Mayday stops on the runway after landing: send the fire service (<kbd>R</kbd>, or click its alert).</li>
          <li><b>Crashes</b>: aircraft that collide become wrecks, often on fire. The shift carries on: send the fire service, keep traffic away, and reopen the runway from the runways button on the console once it's clear. Closing a runway moves arrivals and departures to the others; with none left, arrivals hold.</li>
          <li><b>Stopping someone</b>: <kbd>B</kbd> holds position (taxiing, lining up) or, early in a take-off roll, stops it. An aircraft on the runway can be taxied off it again to a holding point.</li>
        </ul>
        <h3>Scoring</h3>
        <p>Safety multiplies everything: a loss of separation or a runway incursion costs some score, but the shift goes on. Only an actual collision ends it (and Endless runs until one happens). Efficiency (delays, holding), throughput and radio discipline (on-time handoffs, answered requests) rank a clean shift from D to S.</p>
        <h3>Time</h3>
        <p><kbd>Space</kbd> pauses (not in the daily challenge or co-op). <kbd>1</kbd>–<kbd>5</kbd> set the speed from 1× to 5× (or use the buttons at the top). <kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>5</kbd> jump the view to Delivery, Ground, Tower, Director and London.</p>
      </section>
    </div>
    <p class="start">New here? Start the <b>Career</b>: the first shifts coach you through each position.</p>
  </div>
</div>

<style>
  .help { position: fixed; inset: 0; z-index: 80; background: rgba(5, 10, 20, 0.78); display: flex; align-items: center; justify-content: center; padding: 16px; }
  .box { width: min(1020px, 100%); max-height: 92vh; overflow-y: auto; background: var(--panel-2); border: 1px solid var(--line-strong); padding: 18px 22px; font: 14px/1.45 var(--ui); color: var(--ink); }
  header { display: flex; justify-content: space-between; align-items: center; }
  h2 { margin: 0; font: 600 18px var(--ui); color: var(--green); }
  header button { background: none; border: none; color: var(--muted); font-size: 26px; cursor: pointer; }
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 26px; }
  h3 { margin: 14px 0 6px; font: 600 13px var(--ui); color: var(--ink-strong); text-transform: uppercase; letter-spacing: 0.6px; }
  ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; }
  b { color: var(--ink-strong); font-weight: 600; }
  kbd { font: 500 12px var(--mono); background: var(--btn); border: 1px solid var(--line-strong); border-bottom-width: 2px; padding: 0 5px; border-radius: 3px; color: var(--ink-strong); }
  code { font: 12.5px var(--mono); color: var(--green); }
  .start { margin-top: 16px; padding-top: 10px; border-top: 1px solid var(--line); color: var(--muted); }
</style>
