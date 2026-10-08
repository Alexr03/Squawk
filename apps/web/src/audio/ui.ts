// Interface sounds: soft synthesised clicks for buttons, switches and the home screen strips, wired once for the whole app.
import { settings } from '../lib/settings.svelte.ts';

let ctx: AudioContext | null = null;
let lastHover = 0;

function blip(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', to?: number, delay = 0) {
  if (!settings.uiSounds) return;
  const vol = settings.master * settings.fx;
  if (vol <= 0) return;
  ctx ??= new AudioContext();
  void ctx.resume();
  const t = ctx.currentTime + 0.005 + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain * vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const uiSound = {
  click: () => blip(1250, 0.05, 0.16, 'triangle', 900),
  confirm: () => { blip(660, 0.09, 0.16, 'sine'); blip(990, 0.14, 0.14, 'sine', undefined, 0.07); },
  on: () => blip(700, 0.08, 0.15, 'sine', 1050),
  off: () => blip(900, 0.08, 0.13, 'sine', 600),
  hover: () => { const n = performance.now(); if (n - lastHover > 60) { lastHover = n; blip(1800, 0.025, 0.05, 'sine'); } },
  tab: () => blip(980, 0.045, 0.12, 'triangle'),
};

const PRIMARY = /^(start shift|continue|resume|send|begin shift|play a call|again)$/i;

/** One listener for the whole document: buttons click, primary actions confirm, switches go up or down. */
export function installUiSounds() {
  addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.('button, [role="button"], a, input[type="checkbox"], input[type="range"], select');
    if (!el || (el as HTMLButtonElement).disabled) return;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') return; // handled on change, when the new state is known
    if (el instanceof HTMLInputElement && el.type === 'range') return uiSound.tab();
    const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim();
    if (PRIMARY.test(label) || el.classList.contains('go') || el.classList.contains('start') || el.classList.contains('cta')) uiSound.confirm();
    else if (el.closest('nav') || el.getAttribute('aria-current') !== null) uiSound.tab();
    else uiSound.click();
  }, true);
  addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el?.type === 'checkbox') (el.checked ? uiSound.on : uiSound.off)();
  }, true);
  addEventListener('pointerover', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.('.strip, .seat, .mode, .apt, .day');
    if (el && !(el as HTMLElement).contains((e as PointerEvent).relatedTarget as Node)) uiSound.hover();
  }, true);
}
