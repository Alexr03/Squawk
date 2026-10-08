// UK CAP 413 phraseology: sim radio messages -> text, and controller text -> commands.
import type { Command, Radio, Unit, Verb, Wind } from '@squawk/sim';

export const TELEPHONY: Record<string, string> = {
  BAW: 'Speedbird', SHT: 'Shuttle', VIR: 'Virgin', EIN: 'Shamrock', DLH: 'Lufthansa',
  AFR: 'Airfrans', KLM: 'KLM', IBE: 'Iberia', SWR: 'Swiss', UAE: 'Emirates',
  QTR: 'Qatari', AAL: 'American', UAL: 'United', DAL: 'Delta',
};
const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const NATO = ['alfa', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliett', 'kilo', 'lima', 'mike',
  'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey', 'x-ray', 'yankee', 'zulu'];
// ponytail: London Control frequency is a placeholder until the pipeline brings in the AIP value.
const UNITS: Record<Unit, [string, string]> = {
  GND: ['Heathrow Ground', '121.905'], DIR: ['Heathrow Director', '119.730'], LON: ['London Control', '135.125'],
};

const spell = (s: string) => [...s].map(c => /\d/.test(c) ? DIGITS[+c] : c === '.' ? 'decimal' : NATO[c.charCodeAt(0) - 65]).join(' ');
export const callsign = (cs: string) => `${TELEPHONY[cs.slice(0, 3)] ?? spell(cs.slice(0, 3))} ${spell(cs.slice(3))}`;
const runway = (r: string) => `runway ${spell(r.slice(0, 2))}${{ L: ' left', R: ' right', C: ' centre' }[r[2]] ?? ''}`;
const wind = (w: Wind) => `wind ${spell(String(w.dir).padStart(3, '0'))} degrees ${spell(String(w.kt))} knots`;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const INSTR: Record<Verb, string> = {
  luw: 'line up and wait', cto: 'cleared for take-off', land: 'cleared to land', goaround: 'go around',
};

/** Text of one radio transmission, as heard on frequency. */
export function text(r: Radio): string {
  const cs = callsign(r.callsign), m = r.msg;
  if (r.from === 'atc') {
    switch (m.t) {
      case 'luw': return `${cap(cs)}, ${runway(m.rwy)}, line up and wait.`;
      case 'cto': case 'land': return `${cap(cs)}, ${m.wind ? wind(m.wind) + ', ' : ''}${runway(m.rwy)}, ${INSTR[m.t]}.`;
      case 'goaround': return `${cap(cs)}, go around, I say again, go around.`;
      case 'contact': return `${cap(cs)}, contact ${UNITS[m.unit][0]} ${spell(UNITS[m.unit][1])}.`;
    }
  } else {
    switch (m.t) {
      case 'luw': case 'cto': case 'land': return `${cap(INSTR[m.t])} ${runway(m.rwy)}, ${cs}.`;
      case 'goaround': return `Going around, ${cs}.`;
      case 'contact': return `${cap(spell(UNITS[m.unit][1]))}, ${cs}.`;
      case 'ready': return `Heathrow Tower, ${cs}, ready for departure.`;
      case 'final': return `Heathrow Tower, ${cs}, ${spell(String(m.nm))} miles.`;
      case 'goingaround': return `${cap(cs)}, going around.`;
    }
  }
  return `${cap(cs)}.`;
}

/** Parse a controller instruction ("Speedbird one two, ..., cleared to land.") back into a command. */
export function parse(s: string): Command | null {
  const [head, ...rest] = s.toLowerCase().split(',');
  const words = head.trim().split(/\s+/);
  const icao = Object.keys(TELEPHONY).find(k => TELEPHONY[k].toLowerCase() === words[0]);
  if (!icao) return null;
  const suffix = words.slice(1).map(w => DIGITS.includes(w) ? DIGITS.indexOf(w) : NATO.includes(w) ? String.fromCharCode(65 + NATO.indexOf(w)) : null);
  if (!suffix.length || suffix.includes(null)) return null;
  const body = rest.join(',');
  const verb = (Object.keys(INSTR) as Verb[]).find(v => body.includes(INSTR[v]));
  return verb ? { callsign: icao + suffix.join(''), verb } : null;
}
