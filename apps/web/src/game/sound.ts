// Turns what happens on the player's frequencies into sound: radio voices, squelch, chimes, the STCA alarm.
import { speech, type PhraseCtx } from '@squawk/phraseology';
import type { Radio, World } from '@squawk/sim';
import { createRadioAudio, type RadioAudio } from '../audio/radio.ts';
import { settings } from '../lib/settings.svelte.ts';
import type { Snap } from './client.ts';

export class Sound {
  radio: RadioAudio = createRadioAudio();
  private lastRadio = 0;
  private lastAlert = 0;
  private alarm = false;
  private known = new Set<string>();
  private unlocked = false;

  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.radio.unlock();
    this.apply();
    this.radio.ambient(true);
  }
  apply() {
    this.radio.setVolumes({ master: settings.master, voice: settings.voice, fx: settings.fx, ambient: settings.ambient });
    this.radio.setVoiceEnabled(settings.pilotVoices);
  }

  update(world: World, snap: Snap) {
    if (!this.unlocked) return;
    const mine = (r: Radio) => snap.coverage.includes((r as Radio & { seatId?: string }).seatId ?? (r.seat === 'LON' ? 'LON' : `${r.airport}:${r.seat}`));
    for (const r of snap.radio) {
      if (r.id <= this.lastRadio) continue;
      this.lastRadio = r.id;
      if (!mine(r) || r.light) continue;
      if (r.from === 'atc' && (!settings.atcVoice || r.auto)) continue;
      const apt = world.byIcao[r.airport === 'LON' ? world.primary.icao : r.airport] ?? world.primary;
      const ctx: PhraseCtx = { airport: { rtName: apt.pack.rtName, transitionAltFt: apt.pack.transitionAltFt, frequencies: apt.pack.frequencies } };
      const urgent = r.msg.t === 'call' && (r.msg.call.k === 'mayday' || r.msg.call.k === 'panpan');
      const line = speech(r, ctx);
      if (!line) continue;
      // Now and then two stations transmit at once.
      const stepOn = r.from === 'pilot' && !urgent && snap.radio.some(o => o.id !== r.id && o.tick === r.tick && mine(o)) && Math.random() < 0.25;
      this.radio.say(line, { voiceKey: r.from === 'atc' ? `atc-${r.seat}` : r.cs, atc: r.from === 'atc', urgent, stepOn });
      if (r.from === 'pilot' && r.msg.t === 'call') {
        const k = r.msg.call.k;
        if (k === 'mayday' || k === 'panpan') this.radio.chime('emergency');
        else if (k === 'request') this.radio.chime('request');
        else if (!this.known.has(r.cs)) { this.known.add(r.cs); this.radio.chime('strip'); }
      }
    }
    for (const a of snap.alerts) {
      if (a.tick <= this.lastAlert) continue;
      this.lastAlert = a.tick;
      if (a.level === 'conflict') this.radio.chime('conflict');
    }
    const conflict = snap.aircraft.some(a => a.alert === 'conflict' && snap.coverage.includes(a.owner));
    if (conflict && !this.alarm) { this.radio.chime('alarm'); this.alarm = true; }
    if (!conflict && this.alarm) { this.radio.stopAlarm(); this.alarm = false; }
  }
  stop() { this.radio.clear(); this.radio.stopAlarm(); this.radio.ambient(false); }
}
