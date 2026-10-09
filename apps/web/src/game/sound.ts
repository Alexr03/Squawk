// Turns what happens on the player's frequencies into sound: radio voices, squelch, chimes, the STCA alarm.
import { speech, type PhraseCtx } from '@squawk/phraseology';
import type { Radio, World } from '@squawk/sim';
import { createRadioAudio, type RadioAudio } from '../audio/radio.ts';
import { music as sharedMusic } from '../audio/music.ts';
import { airfield as sharedAirfield, type Listener } from '../audio/engine.ts';
import { settings } from '../lib/settings.svelte.ts';
import { unseen } from './assist.ts';
import type { Snap } from './client.ts';

export class Sound {
  radio: RadioAudio = createRadioAudio();
  music = sharedMusic;
  airfield = sharedAirfield;
  private lastRadio = 0;
  private seenAlerts = { tick: -1, n: 0 };
  private seenEvents = { tick: -1, n: 0 };
  private alarm = false;
  private known = new Set<string>();
  private heard = new Set<string>();
  private vehPos = new Map<string, { x: number; y: number }>();
  private unlocked = false;
  private primed = false;
  private emergencies = new Set<string>();

  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.radio.unlock();
    this.airfield.unlock();
    this.apply();
    this.radio.ambient(true);
    this.music.start();
  }
  apply() {
    this.radio.setVolumes({ master: settings.master, voice: settings.voice, fx: settings.fx, ambient: settings.ambient });
    this.radio.setVoiceEnabled(settings.pilotVoices);
    this.music.setVolume(settings.master * settings.music);
    this.airfield.setVolume(settings.master * settings.aircraft * 2);
  }

  setPaused(p: boolean) { this.music.setPaused(p); this.airfield.setPaused(p); }

  update(world: World, snap: Snap, at: Listener | null) {
    if (!this.unlocked) return;
    this.airfield.update({ aircraft: snap.aircraft.filter(a => a.phase !== 'gone'), weather: snap.weather }, at ?? { x: 0, y: 0, mpp: 3 });
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
      // Quiet radio: only what really needs you is spoken; everything else is a short tone (a call) or a squelch click (a readback).
      // A readback that came back wrong is spoken too: catching it is the point.
      const wrong = r.msg.t === 'readback' && !!snap.aircraft.find(a => a.cs === r.cs)?.rbErr;
      // The emergency tone plays whatever the radio mode, before the words.
      if (urgent && r.from === 'pilot') { this.radio.chime('emergency'); if (!this.emergencies.has(r.cs)) { this.emergencies.add(r.cs); this.music.alert('emergency'); } }
      const big = urgent || wrong || (r.msg.t === 'call' && ['goingaround', 'unable', 'sayagain'].includes(r.msg.call.k));
      if (settings.radioVoices === 'off' || (settings.radioVoices === 'important' && !big)) {
        if (r.from === 'pilot' && !urgent) this.radio.chime(r.msg.t === 'call' ? 'call' : 'click');
        continue;
      }
      // Now and then two stations transmit at once.
      const stepOn = r.from === 'pilot' && !urgent && snap.radio.some(o => o.id !== r.id && o.tick === r.tick && mine(o)) && Math.random() < 0.25;
      this.radio.say(line, { voiceKey: r.from === 'atc' ? `atc-${r.seat}` : r.cs, atc: r.from === 'atc', urgent, stepOn });
      if (r.from === 'pilot' && r.msg.t === 'call') {
        const k = r.msg.call.k;
        if (k === 'request') this.radio.chime('request');
        else if (!this.known.has(r.cs)) { this.known.add(r.cs); this.radio.chime('strip'); }
      }
    }
    // A crash: the boom and the fire, once per incident.
    for (const i of snap.incidents) {
      if (i.kind !== 'crash' || this.heard.has(i.id)) continue;
      this.heard.add(i.id);
      if (snap.tick - i.since < 60) { this.radio.crash(); this.music.alert('crash'); } // not for crashes already on the map when the shift (or a replay) loads
    }
    // Siren while any fire engine is on the move.
    const moving = snap.vehicles.some(v => { const p = this.vehPos.get(v.id); return v.kind === 'fire' && !!p && Math.hypot(v.x - p.x, v.y - p.y) > 0.5; });
    this.vehPos = new Map(snap.vehicles.map(v => [v.id, { x: v.x, y: v.y }]));
    if (moving) this.radio.siren();
    for (const a of unseen(snap.alerts, this.seenAlerts)) {
      if (a.level === 'conflict') { this.radio.chime('conflict'); this.music.alert('conflict'); }
      else if (a.level === 'caution' && /hand off/.test(a.text)) this.radio.chime('caution'); // other cautions are score events, which knock below
    }
    // Points lost on aircraft the player works: a low knock (the same events that pop up on the scope).
    const fresh = unseen(snap.events, this.seenEvents);
    if (this.primed && fresh.some(e => !e.ai && e.severity >= 2)) this.radio.chime('penalty');
    this.primed = true; // events already in the log when the shift (or a replay) loads stay silent
    const conflict = snap.aircraft.some(a => a.alert === 'conflict' && snap.coverage.includes(a.owner));
    if (conflict && !this.alarm) { this.radio.chime('alarm'); this.alarm = true; }
    if (!conflict && this.alarm) { this.radio.stopAlarm(); this.alarm = false; }
  }
  stop() { this.radio.clear(); this.radio.stopAlarm(); this.radio.ambient(false); this.music.stop(); this.airfield.stop(); }
}
