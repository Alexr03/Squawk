import { describe, expect, test } from 'vitest';
import type { Command, Nature, PilotCall, Radio, Seat } from '@squawk/sim/types';
import { callsign, complete, parse, parseLine, parseSpeech, speech, spokenNumber, text, type ParseCtx, type PhraseCtx } from './index.ts';

const fixNames = { BIG: 'Biggin', BNN: 'Bovingdon', BPK: 'Brookmans Park', OCK: 'Ockham', LAM: 'Lambourne', EGPH: 'Edinburgh', CPT: 'Compton' };
const x: PhraseCtx = {
  airport: {
    rtName: 'Heathrow', transitionAltFt: 6000, frequencies: [
      { seat: 'DEL', callsign: 'Heathrow Delivery', freq: '121.980' }, { seat: 'GND', callsign: 'Heathrow Ground', freq: '121.905' },
      { seat: 'TWR', sector: 'South', callsign: 'Heathrow Tower', freq: '118.505' }, { seat: 'DIR', sector: 'North', callsign: 'Heathrow Director', freq: '119.730' },
      { seat: 'LON', callsign: 'London Control', freq: '135.125' }],
  },
  fixNames,
};
const ctx: ParseCtx = {
  callsigns: ['BAW12', 'BAW4RG', 'EIN150', 'EZY45', 'RYR8', 'VIR3', 'UAE1', 'DLH902', 'XAZ77', 'AFR1681'],
  fixes: ['BIG', 'BNN', 'OCK', 'LAM', 'MAXIT', 'CPT'], runways: ['27L', '27R'], holds: ['A1', 'A2', 'N3', 'S1'],
  stands: ['512', '23L', '305'], taxiways: ['A', 'B', 'B2', 'C', 'S', 'N', 'L'], fixNames, sids: ['BPK7G', 'CPT3G', 'MAXIT1F'],
};
const radio = (from: 'atc' | 'pilot', msg: Radio['msg'], cs = 'BAW12', seat: Seat = 'DIR', light = false): Radio =>
  ({ id: 1, tick: 0, airport: 'EGLL', seat, cs, from, msg, light });
const atc = (...cmds: Command[]) => text(radio('atc', { t: 'atc', cmds }, cmds[0].cs), x);

/** Fields the sim fills in for display; they don't take part in round-trips. */
function core(c: Command) {
  const o: Record<string, unknown> = { ...c };
  for (const k of ['wind', 'qnh', 'unit', 'freq', 'nodes']) delete o[k];
  if (c.verb === 'clearance') delete o.alt; // the initial altitude is in the SID and not repeated
  return JSON.parse(JSON.stringify(o));
}

const cs = 'BAW12';
const EVERY: Command[] = [
  { cs, verb: 'clearance', dest: 'EGPH', sid: 'BPK7G', alt: 6000, squawk: '5214' },
  { cs: 'VIR3', verb: 'clearance', sid: 'MAXIT1F', alt: 6000, squawk: '0421' },
  { cs: 'EIN150', verb: 'clearance', dest: 'EGPH', sid: 'CPT3G', alt: 6000, squawk: '7311' },
  { cs, verb: 'push', face: 'E' }, { cs, verb: 'push' }, { cs: 'UAE1', verb: 'push', face: 'N' },
  { cs, verb: 'taxi', to: '27L', via: ['A', 'B2'], holdShort: '27L' }, { cs, verb: 'taxi', to: 'A1', via: ['A'] },
  { cs, verb: 'taxi', to: '512', via: ['B', 'C'], holdShort: '27R' }, { cs, verb: 'taxi', to: 'N3', via: [] },
  { cs, verb: 'greens', to: '512' }, { cs, verb: 'greens', to: '27L' }, { cs, verb: 'greens', to: 'S1' },
  { cs, verb: 'holdshort', at: '27R' }, { cs, verb: 'holdshort', at: 'B2' }, { cs, verb: 'holdshort', at: '09L' },
  { cs, verb: 'continue' },
  { cs, verb: 'giveway', other: 'EIN150' }, { cs: 'EIN150', verb: 'giveway', other: 'BAW4RG' },
  { cs, verb: 'cross', runway: '27R' }, { cs, verb: 'cross', runway: '09L' },
  { cs, verb: 'luw', runway: '27L' }, { cs: 'RYR8', verb: 'luw', runway: '09R' },
  { cs, verb: 'cto', runway: '27L', wind: { dir: 250, kt: 12 } }, { cs, verb: 'cto', runway: '09R', wind: { dir: 80, kt: 5, gust: 18 } },
  { cs, verb: 'land', runway: '27R', wind: { dir: 260, kt: 8 } }, { cs, verb: 'land', runway: '27R' },
  { cs, verb: 'goaround' },
  { cs, verb: 'heading', hdg: 270, turn: 'L' }, { cs, verb: 'heading', hdg: 90, turn: 'R' }, { cs, verb: 'heading', hdg: 360 },
  { cs, verb: 'heading', hdg: 5 },
  { cs, verb: 'alt', alt: 4000, climb: false, qnh: 1013 }, { cs, verb: 'alt', alt: 8000, climb: true }, { cs, verb: 'alt', alt: 3500 },
  { cs, verb: 'alt', alt: 10000, climb: true }, { cs, verb: 'alt', alt: 12000, climb: false }, { cs, verb: 'alt', alt: 6000, climb: true, qnh: 998 },
  { cs, verb: 'speed', kt: 210 }, { cs, verb: 'speed', kt: 160 }, { cs, verb: 'speed', kt: null },
  { cs, verb: 'direct', fix: 'BIG' }, { cs, verb: 'direct', fix: 'MAXIT' }, { cs, verb: 'direct', fix: 'CPT' },
  { cs, verb: 'hold', fix: 'BNN' }, { cs, verb: 'hold', fix: 'LAM' }, { cs, verb: 'hold', fix: 'OCK' },
  { cs, verb: 'ils', runway: '27R' }, { cs, verb: 'ils', runway: '09L' },
  { cs, verb: 'contact', seat: 'TWR' }, { cs, verb: 'contact', seat: 'DIR', unit: 'Heathrow Director', freq: '119.730' },
  { cs, verb: 'contact', seat: 'LON' }, { cs, verb: 'contact', seat: 'GND' }, { cs, verb: 'contact', seat: 'DEL' },
  { cs, verb: 'negative' }, { cs, verb: 'sayagain' }, { cs, verb: 'unable' }, { cs, verb: 'resume' },
  { cs: 'XAZ77', verb: 'heading', hdg: 180, turn: 'R' }, { cs: 'BAW4RG', verb: 'speed', kt: 220 }, { cs: 'AFR1681', verb: 'luw', runway: '27L' },
];

describe('command -> text -> parse round-trips', () => {
  test.each(EVERY.map(c => [atc(c), c] as const))('%s', (s, c) => {
    expect(parse(s, ctx).map(core)).toEqual([core(c)]);
    expect(parse(s, { fixNames }).map(core), 'without a context').toEqual([core(c)]);
  });
  test('covers every verb', () => {
    const verbs: Command['verb'][] = ['clearance', 'push', 'taxi', 'greens', 'holdshort', 'continue', 'giveway', 'cross', 'luw', 'cto',
      'land', 'goaround', 'heading', 'alt', 'speed', 'direct', 'hold', 'ils', 'contact', 'negative', 'sayagain', 'unable', 'resume'];
    expect(new Set(EVERY.map(c => c.verb))).toEqual(new Set(verbs));
  });
  test('several instructions in one transmission', () => {
    const cmds: Command[] = [{ cs, verb: 'heading', hdg: 270, turn: 'L' }, { cs, verb: 'alt', alt: 4000, climb: false, qnh: 1013 },
      { cs, verb: 'speed', kt: 210 }];
    const s = atc(...cmds);
    expect(s).toBe('Speedbird one two, turn left heading two seven zero, descend altitude four thousand feet, QNH one zero one three, speed two one zero knots.');
    expect(parse(s, ctx)).toEqual(cmds);
    const neg: Command[] = [{ cs, verb: 'negative' }, { cs, verb: 'alt', alt: 5000, climb: false }];
    expect(atc(...neg)).toBe('Speedbird one two, negative, I say again, descend altitude five thousand feet.');
    expect(parse(atc(...neg), ctx)).toEqual(neg);
    const dir: Command[] = [{ cs, verb: 'direct', fix: 'BIG' }, { cs, verb: 'alt', alt: 9000, climb: false }, { cs, verb: 'contact', seat: 'DIR' }];
    expect(parse(atc(...dir), ctx).map(core)).toEqual(dir.map(core));
  });
});

describe('CAP 413 text', () => {
  test('controller', () => {
    expect(atc({ cs, verb: 'cto', runway: '27L', wind: { dir: 250, kt: 12 } }))
      .toBe('Speedbird one two, wind two five zero degrees one two knots, runway two seven left, cleared for take-off.');
    expect(atc({ cs, verb: 'contact', seat: 'DIR' })).toBe('Speedbird one two, contact Heathrow Director one one niner decimal seven three zero.');
    expect(atc({ cs, verb: 'contact', seat: 'LON', freq: '120.400' })).toBe('Speedbird one two, contact London Control one two zero decimal four.');
    expect(atc({ cs, verb: 'alt', alt: 8000, climb: true, qnh: 1013 })).toBe('Speedbird one two, climb flight level eight zero.');
    expect(atc({ cs, verb: 'alt', alt: 6000, climb: true })).toBe('Speedbird one two, climb altitude six thousand feet.');
    expect(atc({ cs, verb: 'alt', alt: 20000, climb: true })).toBe('Speedbird one two, climb flight level two hundred.');
    expect(atc({ cs, verb: 'heading', hdg: 90 })).toBe('Speedbird one two, fly heading zero niner zero.');
    expect(atc({ cs: 'EZY45', verb: 'taxi', to: 'A1', via: ['A', 'B2'] })).toBe('Easy four five, taxi to holding point Alpha one via Alpha, Bravo two.');
    expect(atc({ cs, verb: 'clearance', dest: 'EGPH', sid: 'BPK7G', alt: 6000, squawk: '5214' }))
      .toBe('Speedbird one two, cleared to Edinburgh via Brookmans Park seven Golf departure, squawk five two one four.');
    expect(atc({ cs, verb: 'push', face: 'E' })).toBe('Speedbird one two, push and start approved, face east.');
    expect(atc({ cs, verb: 'greens', to: '512' })).toBe('Speedbird one two, follow the greens to stand five one two.');
    expect(atc({ cs, verb: 'goaround' })).toBe('Speedbird one two, go around, I say again, go around.');
    expect(atc({ cs, verb: 'negative' })).toBe('Speedbird one two, negative, I say again.');
    expect(atc({ cs: 'XAZ77', verb: 'resume' })).toBe('X-ray Alpha Zulu seven seven, resume own navigation.');
  });
  test('helpers', () => {
    expect(callsign('BAW4RG')).toBe('Speedbird four Romeo Golf');
    expect(callsign('EIN150')).toBe('Shamrock one five zero');
    expect(callsign('ZZZ9')).toBe('Zulu Zulu Zulu niner');
    expect(spokenNumber(7600)).toBe('seven six zero zero');
    expect(spokenNumber('119.730')).toBe('one one niner decimal seven three zero');
  });
  test('readbacks: key items, callsign last', () => {
    const rb = (...cmds: Command[]) => text(radio('pilot', { t: 'readback', cmds }), x);
    expect(rb({ cs, verb: 'heading', hdg: 270, turn: 'L' }, { cs, verb: 'alt', alt: 4000, climb: false, qnh: 1013 }))
      .toBe('Left heading two seven zero, descend altitude four thousand feet, QNH one zero one three, Speedbird one two.');
    expect(rb({ cs, verb: 'contact', seat: 'TWR' })).toBe('One one eight decimal five zero five, Speedbird one two.');
    expect(rb({ cs, verb: 'cto', runway: '27L', wind: { dir: 250, kt: 12 } })).toBe('Cleared for take-off runway two seven left, Speedbird one two.');
    expect(rb({ cs, verb: 'holdshort', at: '27R' })).toBe('Holding short of runway two seven right, Speedbird one two.');
    expect(rb({ cs, verb: 'goaround' })).toBe('Going around, Speedbird one two.');
    expect(rb({ cs, verb: 'sayagain' })).toBe('Roger, Speedbird one two.');
    for (const c of EVERY) expect(rb(c)).not.toMatch(/undefined|NaN|, ,|\s\s/);
  });
  test('every pilot call renders', () => {
    const natures: Nature[] = ['engine', 'medical', 'fuel', 'birdstrike', 'tyre', 'pressurisation'];
    const calls: [PilotCall, Seat][] = [
      [{ k: 'clearance', stand: '512', type: 'A320', atis: 'K', dest: 'EGPH' }, 'DEL'],
      [{ k: 'push', stand: '512' }, 'GND'], [{ k: 'taxi', stand: '512' }, 'GND'], [{ k: 'taxi' }, 'GND'],
      [{ k: 'ready', hold: 'A1', runway: '27L' }, 'TWR'], [{ k: 'ready', hold: '', runway: '27L' }, 'TWR'],
      [{ k: 'checkin', alt: 3400, cleared: 6000, route: 'BPK7G' }, 'LON'],
      [{ k: 'checkin', alt: 9000, hdg: 250, atis: 'K' }, 'DIR'], [{ k: 'checkin', alt: 12000, cleared: 8000, route: 'BIG' }, 'DIR'],
      [{ k: 'checkin', alt: 2500, runway: '27R', nm: 8 }, 'TWR'],
      [{ k: 'vacated', runway: '27R', stand: '512' }, 'GND'], [{ k: 'vacated', runway: '27R' }, 'GND'],
      [{ k: 'goingaround' }, 'TWR'],
      [{ k: 'request', what: 'direct', fix: 'MAXIT' }, 'LON'], [{ k: 'request', what: 'climb', alt: 24000 }, 'LON'],
      [{ k: 'request', what: 'descend', alt: 5000 }, 'DIR'], [{ k: 'request', what: 'runway', runway: '27L' }, 'TWR'],
      ...natures.flatMap(nature => (['mayday', 'panpan'] as const).map(k =>
        [{ k, nature, souls: 156, intent: 'request immediate return to Heathrow' }, 'DIR'] as [PilotCall, Seat])),
      [{ k: 'holding', fix: 'BNN' }, 'DIR'], [{ k: 'established', runway: '27R' }, 'DIR'],
      [{ k: 'sayagain' }, 'DIR'], [{ k: 'unable', why: 'due weather' }, 'DIR'],
    ];
    const seen = new Set<string>();
    for (const [call, seat] of calls) {
      const s = text(radio('pilot', { t: 'call', call }, 'BAW12', seat), x);
      seen.add(call.k);
      expect(s, JSON.stringify(call)).not.toMatch(/undefined|NaN|null|, ,|\s\s|\[object/);
      expect(s).toMatch(/Speedbird one two/);
      expect(speech(radio('pilot', { t: 'call', call }, 'BAW12', seat), x)).not.toMatch(/undefined|NaN/);
    }
    expect(seen.size).toBe(14);
    const t = (call: PilotCall, seat: Seat) => text(radio('pilot', { t: 'call', call }, 'BAW12', seat), x);
    expect(t({ k: 'clearance', stand: '512', type: 'A320', atis: 'K', dest: 'EGPH' }, 'DEL'))
      .toBe('Heathrow Delivery, Speedbird one two, stand five one two, A320, information Kilo, request clearance to Edinburgh.');
    expect(t({ k: 'checkin', alt: 3400, cleared: 6000, route: 'BPK7G' }, 'LON'))
      .toBe('London Control, Speedbird one two, passing altitude three thousand four hundred feet, climbing altitude six thousand feet, Brookmans Park seven Golf.');
    expect(t({ k: 'mayday', nature: 'engine', souls: 156, intent: 'request immediate return' }, 'DIR'))
      .toBe('MAYDAY MAYDAY MAYDAY, Heathrow Director, Speedbird one two, engine failure, request immediate return, one five six persons on board.');
    expect(t({ k: 'panpan', nature: 'medical', souls: 80, intent: 'request priority landing' }, 'DIR'))
      .toMatch(/^PAN PAN, PAN PAN, PAN PAN, Heathrow Director, Speedbird one two, medical/);
    expect(t({ k: 'ready', hold: 'A1', runway: '27L' }, 'TWR'))
      .toBe('Heathrow Tower, Speedbird one two, holding point Alpha one, runway two seven left, ready for departure.');
  });
  test('light signals on radio failure', () => {
    const l = (from: 'atc' | 'pilot', cmds: Command[]) => text(radio(from, from === 'atc' ? { t: 'atc', cmds } : { t: 'readback', cmds }, cs, 'TWR', true), x);
    expect(l('atc', [{ cs, verb: 'land', runway: '27R' }])).toBe('[Steady green light]');
    expect(l('atc', [{ cs, verb: 'cto', runway: '27L' }])).toBe('[Steady green light]');
    expect(l('atc', [{ cs, verb: 'goaround' }])).toBe('[Steady red light]');
    expect(l('atc', [{ cs, verb: 'holdshort', at: '27R' }])).toBe('[Steady red light]');
    expect(l('atc', [{ cs, verb: 'taxi', to: '512', via: [] }])).toBe('[Flashing green light]');
    expect(l('pilot', [{ cs, verb: 'land', runway: '27R' }])).toBe('[Rocks wings]');
    expect(l('pilot', [{ cs, verb: 'taxi', to: '512', via: [] }])).toMatch(/^\[Acknowledges/);
    expect(speech(radio('atc', { t: 'atc', cmds: [{ cs, verb: 'land', runway: '27R' }] }, cs, 'TWR', true), x)).toBe('');
  });
  test('speech spells abbreviations for TTS', () => {
    const s = speech(radio('atc', { t: 'atc', cmds: [{ cs, verb: 'alt', alt: 4000, climb: false, qnh: 1013 }, { cs, verb: 'ils', runway: '27R' }] }), x);
    expect(s).toBe('Speedbird one two, descend altitude four thousand feet, Q N H one zero one three, cleared I L S approach runway two seven right.');
    expect(speech(radio('atc', { t: 'atc', cmds: [{ cs, verb: 'cto', runway: '27L' }] }), x)).toContain('cleared for take off');
  });
});

describe('typed shortcuts', () => {
  const one = { ...ctx, runways: ['27L'] };
  const ok = (line: string, c: ParseCtx = ctx) => {
    const r = parseLine(line, c);
    if ('error' in r) throw new Error(`${line}: ${r.error}`);
    return r.cmds;
  };
  const err = (line: string, c: ParseCtx = ctx) => {
    const r = parseLine(line, c);
    return 'error' in r ? r.error : `parsed: ${JSON.stringify(r.cmds)}`;
  };
  test('spec examples', () => {
    expect(ok('BAW12 H270 A40 S210')).toEqual([{ cs, verb: 'heading', hdg: 270 }, { cs, verb: 'alt', alt: 4000 }, { cs, verb: 'speed', kt: 210 }]);
    expect(ok('EZY45 TX 27 VIA A B2 HS', one)).toEqual([{ cs: 'EZY45', verb: 'taxi', to: '27L', via: ['A', 'B2'], holdShort: '27L' }]);
    expect(ok('RYR8 LUW', one)).toEqual([{ cs: 'RYR8', verb: 'luw', runway: '27L' }]);
    expect(ok('RYR8 CTO', one)).toEqual([{ cs: 'RYR8', verb: 'cto', runway: '27L' }]);
    expect(ok('BAW12 ILS27', { ...ctx, runways: ['27R'] })).toEqual([{ cs, verb: 'ils', runway: '27R' }]);
    expect(ok('BAW12 CT TWR')).toEqual([{ cs, verb: 'contact', seat: 'TWR' }]);
  });
  test('every shortcut', () => {
    expect(ok('baw12 l270 r090 fl80 f120 s0 sr')).toEqual([{ cs, verb: 'heading', hdg: 270, turn: 'L' }, { cs, verb: 'heading', hdg: 90, turn: 'R' },
      { cs, verb: 'alt', alt: 8000 }, { cs, verb: 'alt', alt: 12000 }, { cs, verb: 'speed', kt: null }, { cs, verb: 'speed', kt: null }]);
    expect(ok('12 D BIG DCT OCK HOLD BNN')).toEqual([{ cs, verb: 'direct', fix: 'BIG' }, { cs, verb: 'direct', fix: 'OCK' }, { cs, verb: 'hold', fix: 'BNN' }]);
    expect(ok('BAW12 ILS 27R CLR 27R LAND GA', { ...ctx, runways: ['27R'] })).toEqual([{ cs, verb: 'ils', runway: '27R' },
      { cs, verb: 'land', runway: '27R' }, { cs, verb: 'land', runway: '27R' }, { cs, verb: 'goaround' }]);
    expect(ok('RYR8 PB E PUSH')).toEqual([{ cs: 'RYR8', verb: 'push', face: 'E' }, { cs: 'RYR8', verb: 'push' }]);
    expect(ok('RYR8 TX A1 VIA A S HS S1')).toEqual([{ cs: 'RYR8', verb: 'taxi', to: 'A1', via: ['A', 'S'], holdShort: 'S1' }]);
    expect(ok('RYR8 TX 512 VIA B C')).toEqual([{ cs: 'RYR8', verb: 'taxi', to: '512', via: ['B', 'C'] }]);
    expect(ok('RYR8 FG 512 GREENS A1 HS 27R HS B2 CONT')).toEqual([{ cs: 'RYR8', verb: 'greens', to: '512' },
      { cs: 'RYR8', verb: 'greens', to: 'A1' }, { cs: 'RYR8', verb: 'holdshort', at: '27R' }, { cs: 'RYR8', verb: 'holdshort', at: 'B2' },
      { cs: 'RYR8', verb: 'continue' }]);
    expect(ok('RYR8 X 27R CROSS 09L GW EIN150')).toEqual([{ cs: 'RYR8', verb: 'cross', runway: '27R' },
      { cs: 'RYR8', verb: 'cross', runway: '09L' }, { cs: 'RYR8', verb: 'giveway', other: 'EIN150' }]);
    expect(ok('VIR3 CLD')).toEqual([{ cs: 'VIR3', verb: 'clearance', sid: '', alt: 0, squawk: '' }]);
    expect(ok('VIR3 CLD MAXIT1F A60 4521')).toEqual([{ cs: 'VIR3', verb: 'clearance', sid: 'MAXIT1F', alt: 6000, squawk: '4521' }]);
    expect(ok('UAE1 NEG A50 SA UNABLE RES')).toEqual([{ cs: 'UAE1', verb: 'negative' }, { cs: 'UAE1', verb: 'alt', alt: 5000 },
      { cs: 'UAE1', verb: 'sayagain' }, { cs: 'UAE1', verb: 'unable' }, { cs: 'UAE1', verb: 'resume' }]);
    expect(ok('CT DIR CT LON CT GND CT DEL', { ...ctx, selected: 'DLH902' }).map(c => c.verb === 'contact' && c.seat)).toEqual(['DIR', 'LON', 'GND', 'DEL']);
    expect(ok('H360', { ...ctx, selected: 'BAW4RG' })).toEqual([{ cs: 'BAW4RG', verb: 'heading', hdg: 360 }]);
  });
  test('errors', () => {
    expect(err('')).toMatch(/Empty/);
    expect(err('H270')).toMatch(/Select an aircraft/);
    expect(err('KLM9 H270')).toMatch(/No aircraft KLM9/);
    expect(err('BAW H270')).toMatch(/ambiguous/);
    expect(err('BAW12 H400')).toMatch(/out of range/);
    expect(err('BAW12 ILS27')).toMatch(/ambiguous: 27L, 27R/);
    expect(err('BAW12 ILS09', one)).toMatch(/not in use/);
    expect(err('BAW12 D XYZ')).toMatch(/Unknown fix XYZ/);
    expect(err('BAW12 D')).toMatch(/Unknown fix/);
    expect(err('BAW12 CT XYZ')).toMatch(/CT needs/);
    expect(err('BAW12 TX 999')).toMatch(/Unknown runway, holding point or stand 999/);
    expect(err('BAW12 TX 512 VIA')).toMatch(/VIA needs/);
    expect(err('BAW12 GW KLM')).toMatch(/No aircraft KLM/);
    expect(err('BAW12 FOO')).toMatch(/Unknown instruction FOO/);
    expect(err('BAW12')).toMatch(/No instruction/);
  });
  test('autocomplete', () => {
    expect(complete('BA', ctx)).toEqual(['BAW12', 'BAW4RG']);
    expect(complete('45', ctx)).toEqual(['EZY45']);
    expect(complete('BAW12 D B', ctx)).toEqual(['BIG', 'BNN']);
    expect(complete('BAW12 HOLD ', ctx)).toEqual(ctx.fixes);
    expect(complete('BAW12 CT T', ctx)).toEqual(['TWR']);
    expect(complete('BAW12 C', ctx)).toEqual(['CTO', 'CLR', 'CT', 'CONT', 'CROSS', 'CLD']);
    expect(complete('EZY45 TX 2', ctx)).toEqual(['27L', '27R', '23L']);
    expect(complete('EZY45 TX 27L VIA A B', ctx)).toEqual(['B', 'B2']);
    expect(complete('EZY45 GW E', ctx)).toEqual(['EIN150', 'EZY45']);
    expect(complete('BAW12 ILS', ctx)).toEqual(['ILS']);
    expect(complete('H', { ...ctx, selected: 'BAW12' })).toEqual(['H', 'HOLD', 'HS', 'HP']);
  });
});

describe('voice', () => {
  const v = (s: string, c: ParseCtx = ctx) => parseSpeech(s, c);
  type NoCs<C = Command> = C extends unknown ? Omit<C, 'cs'> : never;
  const cases: [string, NoCs[]][] = [
    ['speedbird one two turn left heading two seven zero descend altitude four thousand feet QNH one zero one three',
      [{ verb: 'heading', hdg: 270, turn: 'L' }, { verb: 'alt', alt: 4000, climb: false, qnh: 1013 }]],
    ['speed bird 12 turn left heading 270', [{ verb: 'heading', hdg: 270, turn: 'L' }]],
    ['Speedbird twelve, descend to 4000', [{ verb: 'alt', alt: 4000, climb: false }]],
    ['speedbird one two climb flight level one two zero', [{ verb: 'alt', alt: 12000, climb: true }]],
    ['Speedbird 12, climb FL120.', [{ verb: 'alt', alt: 12000, climb: true }]],
    ['speedbird one two descend altitude three thousand five hundred feet', [{ verb: 'alt', alt: 3500, climb: false }]],
    ['Speedbird one two, flight level one hundred', [{ verb: 'alt', alt: 10000 }]],
    ['speedbird one two reduce speed two one zero knots', [{ verb: 'speed', kt: 210 }]],
    ['speedbird 12 speed two ten knots', [{ verb: 'speed', kt: 210 }]],
    ['speedbird one two resume normal speed', [{ verb: 'speed', kt: null }]],
    ['speedbird one two route direct biggin', [{ verb: 'direct', fix: 'BIG' }]],
    ['speedbird one two proceed direct to bravo india golf', [{ verb: 'direct', fix: 'BIG' }]],
    ['speedbird one two hold at bovington', [{ verb: 'hold', fix: 'BNN' }]],
    ['Speedbird 12, cleared ILS approach runway two seven right.', [{ verb: 'ils', runway: '27R' }]],
    ['speedbird one two cleared I L S runway 27 right', [{ verb: 'ils', runway: '27R' }]],
    ['speedbird one two contact heathrow tower one one eight decimal five zero five', [{ verb: 'contact', seat: 'TWR', freq: '118.505' }]],
    ['speedbird one two contact director 119.73', [{ verb: 'contact', seat: 'DIR', freq: '119.730' }]],
    ['sham rock one five zero taxi to holding point alpha one runway two seven left via alpha bravo two',
      [{ verb: 'taxi', to: 'A1', via: ['A', 'B2'] }]],
    ['shamrock 150 taxi to holding point runway 27 left via alpha, bravo 2', [{ verb: 'taxi', to: '27L', via: ['A', 'B2'], holdShort: '27L' }]],
    ['shamrock one fife zero, cross runway two seven right', [{ verb: 'cross', runway: '27R' }]],
    ['shamrock 150 hold short of runway 27 right', [{ verb: 'holdshort', at: '27R' }]],
    ['Ryanair eight, runway two seven left, line up and wait', [{ verb: 'luw', runway: '27L' }]],
    ['ryan air 8 wind two five zero degrees one two knots runway two seven left cleared for take off',
      [{ verb: 'cto', runway: '27L', wind: { dir: 250, kt: 12 } }]],
    ['virgin three runway two seven right cleared to land', [{ verb: 'land', runway: '27R' }]],
    ['virgin three go around I say again go around', [{ verb: 'goaround' }]],
    ['emirates one push and start approved face east', [{ verb: 'push', face: 'E' }]],
    ['emirates one pushback approved tail west', [{ verb: 'push', face: 'E' }]],
    ['easy four five follow the greens to stand five one two', [{ verb: 'greens', to: '512' }]],
    ['speedbird one two negative I say again descend altitude five thousand feet',
      [{ verb: 'negative' }, { verb: 'alt', alt: 5000, climb: false }]],
    ['speedbird one two say again', [{ verb: 'sayagain' }]],
    ['virgin three cleared to Edinburgh via Brookmans Park seven golf departure squawk five two one four',
      [{ verb: 'clearance', dest: 'EGPH', sid: 'BPK7G', alt: 0, squawk: '5214' }]],
    ['speedbird four romeo golf turn right heading zero niner zero', [{ verb: 'heading', hdg: 90, turn: 'R' }]],
    ['x-ray alpha zulu seven seven resume own navigation', [{ verb: 'resume' }]],
    ['lufthansa nine zero two give way to the shamrock one five zero', [{ verb: 'giveway', other: 'EIN150' }]],
    ['air france one six eight one fly heading tree six zero', [{ verb: 'heading', hdg: 360 }]],
    ['speedbird one two, turn left heading two seven zero, descend altitude four thousand feet, speed one eight zero knots, contact heathrow director one one niner decimal seven three zero',
      [{ verb: 'heading', hdg: 270, turn: 'L' }, { verb: 'alt', alt: 4000, climb: false }, { verb: 'speed', kt: 180 },
        { verb: 'contact', seat: 'DIR', freq: '119.730' }]],
  ];
  test.each(cases)('%s', (s, want) => {
    const r = v(s);
    expect(r, s).not.toBeNull();
    const cs = r!.cs;
    expect(r!.cmds).toEqual(want.map(w => ({ cs, ...w })));
    expect(r!.confidence).toBeGreaterThan(0.6);
  });
  test('callsign resolution', () => {
    expect(v('speedbird one two turn left heading 270')!.cs).toBe('BAW12');
    expect(v('speed bird twelve turn left heading 270')!.cs).toBe('BAW12');
    expect(v('sham rock one five zero hold short runway 27 right')!.cs).toBe('EIN150');
    expect(v('speedbird four romeo golf speed 210')!.cs).toBe('BAW4RG');
    expect(v('ryan air eight line up and wait runway two seven left')!.cs).toBe('RYR8');
    expect(v('x ray alpha zulu seven seven speed 210')!.cs).toBe('XAZ77');
  });
  test('weak callsign gives low confidence', () => {
    const exact = v('speedbird one two speed two one zero knots')!.confidence;
    const weak = v('speed bed one two speed two one zero knots')!;
    expect(weak.cs).toBe('BAW12');
    expect(weak.confidence).toBeLessThan(exact);
    expect(weak.confidence).toBeLessThan(0.85);
  });
  test('selected aircraft fills a missing callsign, with a note', () => {
    const r = v('turn left heading two seven zero', { ...ctx, selected: 'EZY45' })!;
    expect(r.cmds).toEqual([{ cs: 'EZY45', verb: 'heading', hdg: 270, turn: 'L' }]);
    expect(r.confidence).toBeLessThan(0.7);
    expect(r.notes.join()).toMatch(/callsign missing/);
  });
  test('radio-discipline notes', () => {
    expect(v('turn left heading two seven zero speedbird one two')!.notes).toContain('callsign should come first');
    expect(v('speedbird one two go down to four thousand')!.notes.join()).toMatch(/say 'descend altitude', not 'go down to'/);
    expect(v('speedbird one two descend and maintain 4000')!.notes.join()).toMatch(/FAA/);
    expect(v('speedbird one two cleared to land')!.notes.join()).toMatch(/missing runway/);
    expect(v('speedbird one two contact tower')!.notes.join()).toMatch(/frequency/);
    expect(v('speedbird one two turn left two seven zero')!.notes.join()).toMatch(/turn left\/right heading/);
    const amb = v('speedbird one two cleared ILS runway two seven')!;
    expect(amb.notes.join()).toMatch(/left or right/);
    expect(amb.confidence).toBeLessThan(0.8);
  });
  test('unknown -> null', () => {
    expect(v('hello is anybody there')).toBeNull();
    expect(v('station calling say again')).toBeNull();
    expect(v('speedbird one two good morning')).toBeNull();
  });
});
