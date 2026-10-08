// Radio messages -> UK CAP 413 text, as printed in the radio log and spoken by the synthesised voices.
import { placeName } from './places.ts';
import type { Command, Frequency, Nature, PilotCall, Radio, Seat, Wind } from '@squawk/sim/types';
import { AIRLINES } from '@squawk/sim/airlines';
import { DIGITS, PHONETIC, spell } from './words.ts';

export interface PhraseCtx {
  airport: { rtName: string; transitionAltFt: number; frequencies: Frequency[] };
  /** Spoken names for fixes, SID fixes and destination airports: BNN -> "Bovingdon", EGPH -> "Edinburgh". */
  fixNames?: Record<string, string>;
}

/** Digits spoken one by one: 5214 -> "five two one four". */
export const spokenNumber = (n: number | string) => spell(String(n).replace(/[^\d.]/g, ''));

/** RT callsign: telephony + flight number spoken digit by digit, letters phonetically. Unknown operators are spelled. */
export function callsign(cs: string): string {
  const m = /^([A-Z]{3})(\d.*)$/.exec(cs);
  if (!m) return spell(cs);
  return `${AIRLINES[m[1]]?.telephony ?? spell(m[1])} ${spell(m[2])}`;
}

const cap = (s: string) => s && s[0].toUpperCase() + s.slice(1);
const join = (parts: (string | false | undefined | 0)[]) => parts.filter(Boolean).join(', ');
export const isRunway = (s: string) => /^(0[1-9]|[12]\d|3[0-6])[LRC]?$/.test(s);
const isHold = (s: string) => /^[A-Z]{1,2}\d{1,2}[A-Z]?$/.test(s) && !isRunway(s);

const runway = (r: string) => r && `runway ${spell(r.slice(0, 2))}${{ L: ' left', R: ' right', C: ' centre' }[r[2]] ?? ''}`;
/** A taxi limit: runway holding point, named holding point, or stand. */
const target = (t: string) => !t ? '' : isRunway(t) ? `holding point ${runway(t)}` : isHold(t) ? `holding point ${spell(t)}` : `stand ${spell(t)}`;
const limit = (t: string) => isRunway(t) ? runway(t) : spell(t);
/** Named place: fix or airport name if known, five-letter fixes as a word ("Maxit"), else spelled. */
const place = (id: string, x: PhraseCtx) =>
  x.fixNames?.[id] ?? (/^[A-Z]{5}$/.test(id) ? id[0] + id.slice(1).toLowerCase() : /^[A-Z]{2}[A-Z0-9]{2}$/.test(id) ? placeName(id) ?? (id === 'ZZZZ' ? 'your destination' : spell(id)) : spell(id));
/** SID/STAR designator: BPK7G -> "Brookmans Park seven Golf". */
const route = (d: string, x: PhraseCtx) => {
  const m = /^([A-Z]{3,5})(\d)([A-Z])$/.exec(d);
  return m ? `${place(m[1], x)} ${DIGITS[+m[2]]} ${PHONETIC[m[3].charCodeAt(0) - 65]}` : d;
};
const feet = (ft: number) => {
  const n = Math.round(ft / 100), th = Math.floor(n / 10), h = n % 10;
  return `${[th && `${spell(th)} thousand`, h && `${DIGITS[h]} hundred`].filter(Boolean).join(' ') || 'zero'} feet`;
};
const fl = (ft: number) => {
  const n = Math.round(ft / 100);
  return `flight level ${n % 100 ? spell(n) : `${spell(n / 100)} hundred`}`;
};
// The transition altitude itself is still an altitude (London: "altitude six thousand feet"); above it, flight levels.
const level = (ft: number, x: PhraseCtx) => ft > x.airport.transitionAltFt ? fl(ft) : `altitude ${feet(ft)}`;
const hdg = (h: number) => spell(String(((Math.round(h) + 359) % 360) + 1).padStart(3, '0'));
/** CAP 413: all six digits, but when the last two are zero only the first four ("one two zero decimal four"). */
const freq = (f: string) => {
  const [a, b = ''] = f.split('.'), d = b.padEnd(3, '0');
  return spell(`${a}.${d.endsWith('00') ? d[0] : d}`);
};
const wind = (w: Wind) => w.kt < 1 ? 'wind calm'
  : `wind ${spell(String(w.dir).padStart(3, '0'))} degrees ${spell(w.kt)} knots${w.gust ? ` gusting ${spell(w.gust)} knots` : ''}`;
const UNIT: Record<Seat, string> = { DEL: 'Delivery', GND: 'Ground', TWR: 'Tower', DIR: 'Director', LON: '' };
const unit = (seat: Seat, x: PhraseCtx) =>
  x.airport.frequencies.find(f => f.seat === seat)?.callsign ?? (seat === 'LON' ? 'London Control' : `${x.airport.rtName} ${UNIT[seat]}`);
const FACE = { N: 'north', S: 'south', E: 'east', W: 'west' };

/** One instruction as the controller says it (rb = false) or as the pilot reads it back (rb = true). */
function instr(c: Command, x: PhraseCtx, rb: boolean): string {
  switch (c.verb) {
    case 'clearance': {
      const to = c.dest ? `cleared to ${place(c.dest, x)}` : 'cleared';
      // At Heathrow the initial altitude is part of the SID, so the clearance doesn't repeat it.
      return join([c.sid ? `${to} ${c.dest ? 'via ' : ''}${route(c.sid, x)} departure` : to, c.squawk && `squawk ${spell(c.squawk)}`]);
    }
    case 'push': return join(['push and start approved', c.face && `face ${FACE[c.face]}`]);
    case 'taxi': return join([`taxi to ${target(c.to)}${c.via.length ? ` via ${c.via.map(spell).join(', ')}` : ''}`,
      c.holdShort && c.holdShort !== c.to && `hold short of ${limit(c.holdShort)}`]);
    case 'greens': return `follow the greens to ${target(c.to)}`;
    case 'holdshort': return `${rb ? 'holding' : 'hold'} short of ${limit(c.at)}`;
    case 'continue': return 'continue taxi';
    case 'giveway': return `give way to ${callsign(c.other)}`;
    case 'cross': return `${rb ? 'crossing' : 'cross'} ${runway(c.runway)}`;
    case 'luw': return rb ? `line up and wait ${runway(c.runway)}`.trim() : join([runway(c.runway), 'line up and wait']);
    case 'cto': case 'land': {
      const what = c.verb === 'cto' ? 'cleared for take-off' : 'cleared to land';
      return rb ? `${what} ${runway(c.runway)}`.trim() : join([c.wind && wind(c.wind), runway(c.runway), what]);
    }
    case 'goaround': return rb ? 'going around' : 'go around, I say again, go around';
    case 'heading': {
      const turn = c.turn && (c.turn === 'L' ? 'left' : 'right');
      return rb ? `${turn ? turn + ' ' : ''}heading ${hdg(c.hdg)}` : `${turn ? `turn ${turn}` : 'fly'} heading ${hdg(c.hdg)}`;
    }
    case 'alt': return join([`${c.climb ? 'climb' : c.climb === false ? 'descend' : 'maintain'} ${level(c.alt, x)}`,
      c.qnh && c.alt <= x.airport.transitionAltFt && `QNH ${spell(c.qnh)}`]);
    case 'speed': return c.kt === null ? 'resume normal speed' : `speed ${spell(c.kt)} knots`;
    case 'direct': return `route direct ${place(c.fix, x)}`;
    case 'hold': return `hold at ${place(c.fix, x)}${rb ? '' : ' as published'}`;
    case 'ils': return `cleared ILS approach ${runway(c.runway)}`.trim();
    case 'contact': {
      const f = c.freq ?? x.airport.frequencies.find(q => q.seat === c.seat)?.freq;
      return rb ? (f ? freq(f) : unit(c.seat, x)) : `contact ${c.unit ?? unit(c.seat, x)}${f ? ' ' + freq(f) : ''}`;
    }
    case 'negative': return rb ? '' : 'negative, I say again';
    case 'sayagain': return rb ? '' : 'say again';
    case 'unable': return rb ? 'roger' : 'unable';
    case 'resume': return 'resume own navigation';
    case 'halt': return c.abort ? (rb ? 'stopping' : 'stop immediately, I say again, stop immediately') : rb ? 'holding position' : 'hold position';
    case 'rescue': case 'closerwy': case 'openrwy': return ''; // tower actions, never transmitted
  }
}

const NATURE: Record<Nature, string> = {
  engine: 'engine failure', medical: 'medical emergency on board', fuel: 'low fuel', birdstrike: 'bird strike',
  tyre: 'burst tyre', pressurisation: 'loss of cabin pressure',
};

function call(p: PilotCall, seat: Seat, cs: string, x: PhraseCtx): string {
  const me = callsign(cs), head = `${unit(seat, x)}, ${me}`;
  switch (p.k) {
    case 'clearance': return `${head}, stand ${spell(p.stand)}, ${p.type}, information ${spell(p.atis)}, request clearance to ${place(p.dest, x)}.`;
    case 'push': return `${head}, stand ${spell(p.stand)}, request push and start.`;
    case 'taxi': return `${join([head, p.stand && `stand ${spell(p.stand)}`])}, request taxi.`;
    case 'ready': return `${join([head, p.hold && p.hold !== p.runway && `holding point ${spell(p.hold)}`, runway(p.runway)])}, ready for departure.`;
    case 'checkin': {
      if (seat === 'TWR' && p.runway) return `${join([head, `established ILS ${runway(p.runway)}`, p.nm && `${spell(Math.round(p.nm))} miles`])}.`;
      const lvl = p.cleared !== undefined && Math.abs(p.cleared - p.alt) >= 100
        ? `passing ${level(p.alt, x)}, ${p.cleared > p.alt ? 'climbing' : 'descending'} ${level(p.cleared, x)}` : level(p.alt, x);
      return `${join([head, lvl, p.hdg !== undefined && `heading ${hdg(p.hdg)}`, p.route && route(p.route, x),
        p.atis && `information ${spell(p.atis)}`])}.`;
    }
    case 'vacated': return `${join([head, `vacated ${runway(p.runway)}`, p.stand && `for stand ${spell(p.stand)}`])}.`;
    case 'goingaround': return `${head}, going around.`;
    case 'request': return `${head}, request ${p.what === 'direct' ? `direct ${place(p.fix, x)}` : p.what === 'runway'
      ? runway(p.runway) : `${p.what} ${level(p.alt, x)}`}.`;
    case 'mayday': case 'panpan': {
      const pre = p.k === 'mayday' ? 'MAYDAY MAYDAY MAYDAY' : 'PAN PAN, PAN PAN, PAN PAN';
      const what = p.k === 'mayday' && p.nature === 'fuel' ? 'MAYDAY fuel' : NATURE[p.nature];
      return `${join([pre, head, what, p.intent, `${spell(p.souls)} persons on board`])}.`;
    }
    case 'holding': return `${head}, holding at ${place(p.fix, x)}.`;
    case 'established': return `${head}, established localiser ${runway(p.runway)}.`;
    case 'sayagain': return `Say again, ${me}.`;
    case 'unable': return `${join(['Unable', p.why, me])}.`;
  }
}

const AIRBORNE = new Set(['land', 'goaround', 'heading', 'alt', 'speed', 'direct', 'hold', 'ils', 'resume']);
const RED = new Set(['goaround', 'holdshort', 'giveway', 'hold']);
const STEADY_GREEN = new Set(['land', 'cto']);

/** Light signal (radio failure, squawk 7600) shown in the log instead of a transmission. */
function light(r: Radio): string {
  const m = r.msg;
  if (m.t === 'call') return '[Acknowledges]';
  const verbs = m.cmds.map(c => c.verb);
  if (m.t === 'readback') return verbs.some(v => AIRBORNE.has(v)) ? '[Rocks wings]' : '[Acknowledges: moves ailerons]';
  if (verbs.some(v => RED.has(v))) return '[Steady red light]';
  if (verbs.some(v => STEADY_GREEN.has(v))) return '[Steady green light]';
  if (verbs.some(v => !AIRBORNE.has(v))) return '[Flashing green light]';
  return '[No light signal for this instruction]';
}

/** The written transmission, as shown in the radio log. */
export function text(r: Radio, x: PhraseCtx): string {
  if (r.light) return light(r);
  const m = r.msg, cs = callsign(r.cs);
  if (m.t === 'call') return call(m.call, r.seat, r.cs, x);
  if (m.t === 'atc') return `${cap(cs)}, ${join(m.cmds.map(c => instr(c, x, false)))}.`;
  return `${cap(join(m.cmds.map(c => instr(c, x, true))) || 'roger')}, ${cs}.`;
}

/** The transmission adapted for text-to-speech: abbreviations spelled out, light signals silent. */
export function speech(r: Radio, x: PhraseCtx): string {
  if (r.light) return '';
  return text(r, x)
    .replace(/\bQNH\b/g, 'Q N H').replace(/\bILS\b/g, 'I L S').replace(/MAYDAY/g, 'Mayday').replace(/PAN PAN/g, 'Pan Pan')
    .replace(/take-off/g, 'take off').replace(/X-ray/g, 'X ray')
    .replace(/\b([A-Z])(\d)(\d)(\d)\b/g, (_, l: string, a: string, b: string, c: string) => `${l} ${spell(a + b + c)}`);
}
