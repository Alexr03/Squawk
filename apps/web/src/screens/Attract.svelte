<script lang="ts">
  // Live backdrop: the real sim running AI-only at Heathrow, with the camera drifting through the zoom from a stand to the radar.
  import { onMount } from 'svelte';
  import { createScene } from '@squawk/render';
  import { DIFFICULTY } from '@squawk/sim';
  import { GameClient } from '../game/client.ts';
  import { loadAirport, loadDay } from '../lib/data.ts';

  let wrap: HTMLDivElement;
  let canvas: HTMLCanvasElement;

  onMount(() => {
    let disposed = false, raf = 0;
    let client: GameClient | null = null;
    let scene: ReturnType<typeof createScene> | null = null;
    (async () => {
      const [pack, day] = await Promise.all([loadAirport('EGLL'), loadDay('EGLL-2026-08-28')]);
      if (disposed) return;
      // Golden hour on a summer Friday.
      const start = Date.parse('2026-08-28T17:20:00Z') / 1000;
      client = new GameClient([pack], { seed: 11, airports: ['EGLL'], days: [day], start, durationS: 3 * 3600, traffic: 0.9, coverage: [], difficulty: { ...DIFFICULTY.standard, emergencies: 0 }, mode: 'free' });
      client.setSpeed(1);
      scene = createScene(canvas, [pack], { pixelSize: 3, quality: 'high' });
      const ro = new ResizeObserver(() => scene?.resize());
      ro.observe(wrap);
      const t0 = performance.now();
      // Camera beats: stand close-up -> apron -> whole airport -> terminal radar -> back.
      const beats = [
        { cx: -1150, cy: -560, mpp: 0.35 }, { cx: -900, cy: -650, mpp: 1.2 }, { cx: 0, cy: -700, mpp: 4.2 },
        { cx: 9000, cy: -2000, mpp: 40 }, { cx: 0, cy: 0, mpp: 110 }, { cx: 2000, cy: -900, mpp: 2.6 },
      ];
      const frame = () => {
        raf = requestAnimationFrame(frame);
        if (!client?.snap || !scene) return;
        const now = performance.now();
        const t = ((now - t0) / 1000) / 14; // 14 s per beat
        const i = Math.floor(t) % beats.length, k = t - Math.floor(t);
        const a = beats[i], b = beats[(i + 1) % beats.length];
        const e = k < 0.65 ? 0 : (k - 0.65) / 0.35, s = e * e * (3 - 2 * e);
        const drift = (now - t0) / 1000;
        scene.setView({ cx: a.cx + (b.cx - a.cx) * s + Math.sin(drift / 9) * 40 * a.mpp, cy: a.cy + (b.cy - a.cy) * s, mpp: Math.exp(Math.log(a.mpp) + (Math.log(b.mpp) - Math.log(a.mpp)) * s) });
        scene.setAircraft([...client.views(now), ...client.fillerViews()]);
        scene.setTime(client.time(now));
        scene.setWeather({ rain: 0, visM: 10000, cloud: 0.25 });
        scene.setRunwaysInUse(client.snap.apts[0].arr, client.snap.apts[0].dep);
        scene.setOverlays({ rings: true, ctr: true });
        scene.render();
      };
      frame();
      (wrap as HTMLDivElement & { ro?: ResizeObserver }).ro = ro;
    })();
    return () => { disposed = true; cancelAnimationFrame(raf); client?.dispose(); scene?.dispose(); (wrap as HTMLDivElement & { ro?: ResizeObserver }).ro?.disconnect(); };
  });
</script>

<div class="attract" bind:this={wrap}><canvas bind:this={canvas}></canvas></div>

<style>
  .attract { position: absolute; inset: 0; overflow: hidden; background: #0a1324; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; }
</style>
