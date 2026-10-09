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

/** A soft struck note: the pitch plus a quieter overtone, so buttons ring like glass rather than beep. */
function note(freq: number, dur: number, gain: number, delay = 0) {
  blip(freq, dur, gain, 'sine', undefined, delay);
  blip(freq * 2.76, dur * 0.4, gain * 0.25, 'sine', undefined, delay);
}

export const uiSound = {
  click: () => { blip(1500, 0.04, 0.14, 'triangle', 800); blip(220, 0.05, 0.1, 'sine', 120); },
  confirm: () => { note(587, 0.18, 0.15); note(880, 0.3, 0.14, 0.07); note(1175, 0.4, 0.1, 0.14); },
  on: () => { note(698, 0.14, 0.14); note(1047, 0.22, 0.13, 0.06); },
  off: () => { note(1047, 0.14, 0.12); note(698, 0.22, 0.12, 0.06); },
  hover: () => { const n = performance.now(); if (n - lastHover > 60) { lastHover = n; blip(2400, 0.02, 0.035, 'sine'); } },
  tab: () => { blip(1100, 0.05, 0.1, 'triangle', 1400); },
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
