// Voice grammar: a controller's spoken (or written) CAP 413 transmission -> commands.
// Works on Web Speech / Whisper transcripts: numbers as words or digits, split or merged words, ASR noise.
import type { Command, Seat, Wind } from '@squawk/sim/types';
import { AIRLINES } from '@squawk/sim/airlines';
import type { ParseCtx } from './shortcuts.ts';
import { compact, isDigits, letter, similar, tokens } from './words.ts';

export interface SpeechResult {
  cmds: Command[];
  confidence: number;         // 0..1: send at once when high, ask for a one-tap confirm when low
  cs: string;
  notes: string[];            // radio-discipline remarks for the debrief
}

/** Words that carry no instruction; they don't count against coverage. */
const FILLER = new Set(['and', 'the', 'to', 'of', 'at', 'on', 'for', 'now', 'then', 'please', 'roger', 'okay', 'ok', 'uh', 'um',
  'er', 'approved', 'isayagain', 'is', 'a', 'feet', 'ft', 'knots', 'degrees', 'via', 'departure', 'published', 'as', 'over', 'good',
  'morning', 'afternoon', 'evening', 'hello', 'thanks', 'bye', 'heathrow', 'information', 'correction', 'with', 'you']);
const CLIMB: Record<string, boolean | undefined> = {
  climb: true, climbing: true, goup: true, descend: false, descending: false, godown: false, maintain: undefined, maintaining: undefined,
};
const SIDE: Record<string, string> = { left: 'L', l: 'L', right: 'R', r: 'R', centre: 'C', center: 'C', c: 'C' };
const SEAT: Record<string, Seat> = { delivery: 'DEL', clearance: 'DEL', ground: 'GND', tower: 'TWR', director: 'DIR',
  approach: 'DIR', radar: 'DIR', london: 'LON', control: 'LON' };
const FACE: Record<string, 'N' | 'S' | 'E' | 'W'> = { north: 'N', south: 'S', east: 'E', west: 'W' };
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' } as const;

/** Matching key for a callsign: telephony + flight number ("BAW4RG" -> "speedbird4rg"); unknown operators by letters. */
const csKey = (cs: string) => {
  const m = /^([A-Z]{3})(\d.*)$/.exec(cs);
  return compact(m ? (AIRLINES[m[1]]?.telephony ?? m[1]) + m[2] : cs);
};
/** Keys for tokens [s, e): words as heard up to the first number then spelling letters; and everything letter-mapped. */
function windowKeys(T: string[], s: number, e: number): string[] {
  let mixed = '', mapped = '', digit = false;
  for (let k = s; k < e; k++) {
    const t = T[k], l = letter(t);
    digit ||= isDigits(t);
    mixed += digit && l ? l : t;
    mapped += l ?? t;
  }
  return [compact(mixed), compact(mapped)];
}

interface CsHit { cs: string; sim: number; s: number; e: number }

/** Best fuzzy callsign match in T[from, to); with an empty list, decode telephony exactly. */
function findCallsign(T: string[], list: string[], from: number, to: number, fixedStart = false): CsHit | null {
  let best: CsHit | null = null;
  for (let s = from; s < (fixedStart ? from + 1 : to); s++) {
    if (!list.length) {
      const e = decodeAt(T, s);
      if (e) return { cs: e.cs, sim: 1, s, e: e.e };
      continue;
    }
    for (let e = s + 1; e <= Math.min(s + 7, to); e++) {
      const keys = windowKeys(T, s, e);
      for (const cs of list) {
        const key = csKey(cs), num = compact(cs.slice(3));
        for (const k of keys) {
          const sim = similar(k, key) * (k.endsWith(num) ? 1 : 0.85);
          if (!best || sim > best.sim || (sim === best.sim && s === best.s && e > best.e)) best = { cs, sim, s, e };
        }
      }
    }
  }
  return best;
}

/** Exact decode: "<telephony> <digits> [letters]" or a spelled operator ("X-ray Alpha Zulu one two"). */
function decodeAt(T: string[], s: number): { cs: string; e: number } | null {
  const suffix = (k: number, op: string) => {
    let sfx = '';
    while (isDigits(T[k])) sfx += T[k++];
    if (!sfx) return null;
    for (let n = 0; n < 2 && T[k]?.length > 1 && letter(T[k]); n++) sfx += letter(T[k++]);
    return { cs: op + sfx, e: k };
  };
  for (const [icao, a] of Object.entries(AIRLINES)) {
    const tel = compact(a.telephony);
    let acc = '', k = s;
    while (k < T.length && acc.length < tel.length && !isDigits(T[k])) acc += T[k++];
    if (acc === tel) { const r = suffix(k, icao); if (r) return r; }
  }
  const op = T.slice(s, s + 3).map(t => t.length > 1 ? letter(t) : undefined).join('');
  return op.length === 3 ? suffix(s + 3, op) : null;
}

/** Parse a controller transmission. Null when no callsign can be found and none is selected, or nothing parses. */
export function parseSpeech(transcript: string, ctx: ParseCtx): SpeechResult | null {
  const T = tokens(transcript);
  const notes: string[] = [];
  let conf = 1, cs: string, B: string[];
  const hit = findCallsign(T, ctx.callsigns, 0, T.length);
  if (hit && hit.sim >= 0.7) {
    cs = hit.cs;
    conf *= hit.sim;
    if (T.slice(0, hit.s).some(t => !FILLER.has(t))) notes.push('callsign should come first');
    B = [...T.slice(0, hit.s), ...T.slice(hit.e)];
  } else if (ctx.selected) {
    cs = ctx.selected; conf *= 0.6; B = T;
    notes.push('callsign missing: start every transmission with the callsign');
  } else return null;

  const note = (s: string, penalty = 1) => { if (!notes.includes(s)) notes.push(s); conf *= penalty; };
  const out: Command[] = [];
  const at = (k: number) => B[k] ?? '';
  const skip = (k: number, ...w: string[]) => { while (w.includes(at(k))) k++; return k; };

  function num(j: number): { v: number; s: string; frac?: string; n: number } | null {
    if (!isDigits(B[j])) return null;
    let acc = 0, cur = '', s = '', k = j, mult = false;
    for (; k < B.length; k++) {
      const t = B[k];
      if (isDigits(t)) { cur += t; s += t; }
      else if (t === 'hundred' || t === 'thousand') { acc += (+cur || 1) * (t === 'hundred' ? 100 : 1000); cur = ''; mult = true; }
      else if (t === 'and' && mult && isDigits(B[k + 1])) continue;
      else break;
    }
    let frac: string | undefined;
    if (B[k] === 'decimal' && isDigits(B[k + 1])) { frac = ''; k++; while (isDigits(B[k])) frac += B[k++]; }
    return { v: acc + (+cur || 0), s, frac, n: k };
  }

  function runwayAt(j: number): { rwy: string; n: number } | null {
    const k = at(j) === 'runway' ? j + 1 : j, n = num(k);
    if (!n || n.s.length > 2 || n.frac !== undefined || n.v < 1 || n.v > 36) return null;
    const side = SIDE[at(n.n)] ?? '', raw = String(n.v).padStart(2, '0') + side;
    let rwy = raw;
    if (ctx.runways.length && !ctx.runways.includes(raw)) {
      const c = ctx.runways.filter(r => r.startsWith(raw));
      if (c.length === 1) rwy = c[0];
      else note(side ? `runway ${raw} is not in use` : `say left or right for runway ${raw}`, 0.7);
    }
    return { rwy, n: n.n + (side ? 1 : 0) };
  }

  /** Taxiway / holding point name: spelling letter + optional number ("Bravo two" -> B2). */
  function nameAt(j: number): { name: string; n: number } | null {
    const l = letter(B[j]);
    if (!l) return null;
    return isDigits(B[j + 1]) && B[j + 1].length <= 2 ? { name: l + B[j + 1], n: j + 2 } : { name: l, n: j + 1 };
  }

  function fixAt(j: number): { fix: string; n: number } | null {
    const names = ctx.fixNames ?? {};
    const ids = [...new Set([...ctx.fixes, ...Object.keys(names)])];
    let best = { fix: '', sim: 0, n: j };
    for (let e = j + 1; e <= Math.min(j + 3, B.length); e++)
      for (const k of windowKeys(B, j, e))
        for (const id of ids)
          for (const key of [compact(id), compact(names[id] ?? '')]) {
            const sim = similar(k, key);
            if (sim > best.sim) best = { fix: id, sim, n: e };
          }
    if (best.sim >= 0.75) { if (best.sim < 0.9) conf *= best.sim; return best; }
    if (ctx.fixes.length) return null;
    let id = '', k = j;
    while (id.length < 5 && at(k).length > 1 && letter(at(k))) id += letter(at(k++));
    if (id.length >= 3) return { fix: id, n: k };
    return /^[a-z]{3,5}$/.test(at(j)) && !FILLER.has(at(j)) ? { fix: at(j).toUpperCase(), n: j + 1 } : null;
  }

  function altAt(j: number): { alt: number; climb?: boolean; qnh?: number; n: number } | null {
    let k = j, climb: boolean | undefined;
    if (Object.hasOwn(CLIMB, at(k))) {
      climb = CLIMB[at(k)];
      if (at(k) === 'godown' || at(k) === 'goup') note(`say '${climb ? 'climb' : 'descend'} altitude', not '${at(k) === 'goup' ? 'go up' : 'go down'} to'`);
      k++;
    }
    if (at(k) === 'and' && at(k + 1) === 'maintain') note(`'${at(j)} and maintain' is FAA phraseology: say '${at(j)} altitude' or '${at(j)} flight level'`);
    k = skip(k, 'to', 'and', 'maintain');
    const kind = at(k) === 'fl' ? 'fl' : at(k) === 'altitude' ? 'alt' : '';
    if (kind) k++;
    const n = num(k);
    if (!n || (!kind && at(n.n) === 'knots')) return null;
    const alt = kind === 'fl' ? n.v * 100 : kind === 'alt' || n.v >= 1000 ? n.v : n.v * 100;
    if (!kind) note("say 'altitude' or 'flight level' before the level");
    if (alt < 500 || alt > 60000) note(`level ${alt} ft looks wrong`, 0.5);
    k = skip(n.n, 'feet', 'ft');
    let qnh: number | undefined;
    const q = at(k) === 'qnh' ? num(k + 1) : null;
    if (q) { qnh = q.v; k = q.n; }
    return { alt, climb, qnh, n: k };
  }

  /** Taxi limit after "taxi to" / "follow the greens to". Runway limits imply holding short of that runway. */
  function targetAt(j: number): { to: string; holdShort?: string; n: number } | null {
    let k = skip(j, 'to');
    if (at(k) === 'stand') {
      const n = num(k + 1), l = n && letter(at(n.n));
      if (!n) return null;
      const to = n.s + (l && at(n.n).length === 1 ? l : '');
      if (ctx.stands.length && !ctx.stands.includes(to)) note(`stand ${to} unknown`, 0.6);
      return { to, n: n.n + (to.length > n.s.length ? 1 : 0) };
    }
    const hp = at(k) === 'hp';
    if (hp) k++;
    const h = at(k) !== 'runway' ? nameAt(k) : null;
    if (h) {
      if (ctx.holds.length && !ctx.holds.includes(h.name)) note(`holding point ${h.name} unknown`, 0.6);
      const r = runwayAt(h.n);
      return { to: h.name, n: r && at(h.n) === 'runway' ? r.n : h.n };
    }
    const r = runwayAt(k);
    if (r && (hp || at(k) === 'runway')) return { to: r.rwy, holdShort: r.rwy, n: r.n };
    return null;
  }

  function seatAt(j: number): { seat: Seat; n: number } | null {
    for (let k = j; k < j + 3; k++) {
      const seat = SEAT[at(k)];
      if (seat) return { seat, n: skip(k + 1, 'control', 'director', 'tower', 'ground', 'delivery') };
      if (isDigits(at(k))) break;
    }
    return null;
  }

  function windAt(j: number): { wind: Wind; n: number } | null {
    if (at(j + 1) === 'calm') return { wind: { dir: 0, kt: 0 }, n: j + 2 };
    const d = num(j + 1), s = d && num(skip(d.n, 'degrees'));
    if (!d || !s) return null;
    const wind: Wind = { dir: d.v, kt: s.v };
    let k = skip(s.n, 'knots');
    const g = at(k) === 'gusting' || at(k) === 'maximum' ? num(k + 1) : null;
    if (g) { wind.gust = g.v; k = skip(g.n, 'knots'); }
    return { wind, n: k };
  }

  function clearanceAt(j: number): number {
    let k = j;
    const dest = at(k) === 'to' ? fixAt(k + 1) : null;
    if (dest) k = dest.n;
    k = skip(k, 'via');
    const c: Command & { verb: 'clearance' } = { cs, verb: 'clearance', dest: dest?.fix, sid: '', alt: 0, squawk: '' };
    const dep = B.indexOf('departure', k);
    if (dep > k && dep - k <= 6) {
      const l = letter(at(dep - 1)), d = at(dep - 2), f = fixAt(k);
      if (l && /^\d$/.test(d) && f) {
        c.sid = f.fix + d + l;
        if (ctx.sids?.length && !ctx.sids.includes(c.sid)) {
          const best = ctx.sids.reduce((a, b) => similar(b, c.sid) > similar(a, c.sid) ? b : a);
          if (similar(best, c.sid) >= 0.7) c.sid = best; else note(`SID ${c.sid} unknown`, 0.6);
        }
      }
      k = dep + 1;
    }
    for (;;) {
      if (Object.hasOwn(CLIMB, at(k)) || at(k) === 'altitude') {
        const a = altAt(k);
        if (!a) break;
        c.alt = a.alt; k = a.n;
      } else if (at(k) === 'squawk' && num(k + 1)) {
        const s = num(k + 1)!;
        c.squawk = s.s; k = s.n;
        if (!/^[0-7]{4}$/.test(s.s)) note(`squawk ${s.s} is not a valid code`, 0.5);
      } else break;
    }
    out.push(c);
    return k;
  }

  let pendingRwy: string | undefined, pendingWind: Wind | undefined;
  const needRunway = (k: number, verb: string): { rwy: string; n: number } => {
    const r = runwayAt(k);
    if (r) return r;
    const rwy = pendingRwy ?? (ctx.runways.length === 1 ? ctx.runways[0] : '');
    pendingRwy = undefined;
    if (!rwy) note(`missing runway (${verb})`, 0.7);
    return { rwy, n: k };
  };
  const rwyCmd = (verb: 'luw' | 'cto' | 'land', k: number) => {
    const r = needRunway(k, verb === 'luw' ? 'line up' : verb === 'cto' ? 'take-off' : 'landing');
    const c: Command = verb === 'luw' ? { cs, verb, runway: r.rwy } : { cs, verb, runway: r.rwy, wind: pendingWind };
    pendingWind = undefined;
    out.push(c);
    return r.n;
  };
  const ils = (k: number) => {
    const r = needRunway(skip(k, 'approach'), 'ILS');
    out.push({ cs, verb: 'ils', runway: r.rwy });
    return r.n;
  };
  const heading = (k: number, turn?: 'L' | 'R') => {
    const n = num(k);
    if (!n) return 0;
    if (n.v < 1 || n.v > 360) note(`heading ${n.v} out of range`, 0.4);
    out.push({ cs, verb: 'heading', hdg: n.v, turn });
    return n.n;
  };

  /** Try every grammar rule at B[i]; returns the index after the match, or 0. */
  function rule(i: number): number {
    const w = B[i], nx = at(i + 1);
    switch (w) {
      case 'turn': {
        const turn = nx === 'left' ? 'L' : nx === 'right' ? 'R' : undefined;
        const k = turn ? i + 2 : i + 1;
        if (at(k) !== 'heading') note("say 'turn left/right heading ...'");
        return heading(skip(k, 'heading'), turn);
      }
      case 'left': case 'right': return nx === 'heading' ? heading(i + 2, w === 'left' ? 'L' : 'R') : 0;
      case 'fly': return nx === 'heading' ? heading(i + 2) : 0;
      case 'heading': return heading(i + 1);
      case 'climb': case 'climbing': case 'descend': case 'descending': case 'godown': case 'goup':
      case 'maintain': case 'maintaining': case 'fl': case 'altitude': {
        const a = altAt(i);
        if (a) { out.push({ cs, verb: 'alt', alt: a.alt, climb: a.climb, qnh: a.qnh }); return a.n; }
        if (w !== 'maintain') return 0;
        const s = num(i + 1);
        if (!s || at(s.n) !== 'knots') return 0;
        out.push({ cs, verb: 'speed', kt: s.v });
        return s.n + 1;
      }
      case 'qnh': {
        const q = num(i + 1), last = out[out.length - 1];
        if (!q) return 0;
        if (last?.verb === 'alt') last.qnh = q.v;
        return q.n;
      }
      case 'speed': case 'reduce': case 'increase': {
        const s = num(skip(i + 1, 'speed', 'to'));
        if (!s) return 0;
        if (s.v < 100 || s.v > 400) note(`speed ${s.v} kt looks wrong`, 0.5);
        out.push({ cs, verb: 'speed', kt: s.v });
        return skip(s.n, 'knots');
      }
      case 'resumespeed': out.push({ cs, verb: 'speed', kt: null }); return i + 1;
      case 'direct': case 'dct': {
        const f = fixAt(skip(i + 1, 'to'));
        if (!f) { note('direct to where? fix not recognised', 0.5); return 0; }
        out.push({ cs, verb: 'direct', fix: f.fix });
        return f.n;
      }
      case 'hold': {
        if (nx === 'position') return 0;
        const f = fixAt(skip(i + 1, 'at', 'over'));
        if (!f) return 0;
        out.push({ cs, verb: 'hold', fix: f.fix });
        return skip(f.n, 'as', 'published');
      }
      case 'cleared': {
        const k = skip(i + 1, 'for', 'the');
        if (at(k) === 'takeoff') return rwyCmd('cto', k + 1);
        if (at(k) === 'land' || (at(k) === 'to' && at(k + 1) === 'land')) return rwyCmd('land', at(k) === 'land' ? k + 1 : k + 2);
        if (at(k) === 'ils' || at(k) === 'approach') return ils(k + 1);
        return clearanceAt(k);
      }
      case 'takeoff': note("say 'cleared for take-off'"); return rwyCmd('cto', i + 1);
      case 'ils': return ils(i + 1);
      case 'lineup': return rwyCmd('luw', skip(i + 1, 'and', 'wait'));
      case 'runway': {
        const r = runwayAt(i);
        if (!r) return 0;
        pendingRwy = r.rwy;
        return r.n;
      }
      case 'wind': {
        const v = windAt(i);
        if (!v) return 0;
        pendingWind = v.wind;
        return v.n;
      }
      case 'goaround': out.push({ cs, verb: 'goaround' }); return skip(i + 1, 'isayagain', 'goaround');
      case 'contact': case 'call': case 'monitor': {
        const s = seatAt(i + 1);
        if (!s) return 0;
        const f = num(s.n);
        const freq = f?.frac !== undefined ? `${f.s}.${f.frac.padEnd(3, '0')}` : undefined;
        if (!freq) note('give the frequency with the handoff');
        out.push({ cs, verb: 'contact', seat: s.seat, freq });
        return f?.n ?? s.n;
      }
      case 'taxi': {
        const t = targetAt(i + 1);
        let k = t?.n ?? i + 1;
        const via: string[] = [];
        if (at(k) === 'via') {
          k++;
          for (let n = nameAt(k); n; n = nameAt(k = skip(k, 'and'))) {
            if (ctx.taxiways.length && !ctx.taxiways.includes(n.name)) note(`taxiway ${n.name} unknown`, 0.7);
            via.push(n.name); k = n.n;
          }
        }
        if (!t) note('missing taxi limit: say where to taxi to', 0.6);
        const c: Command = { cs, verb: 'taxi', to: t?.to ?? '', via, holdShort: t?.holdShort };
        out.push(c);
        return k;
      }
      case 'greens': {
        const t = targetAt(i + 1);
        out.push({ cs, verb: 'greens', to: t?.to ?? '' });
        return t?.n ?? i + 1;
      }
      case 'holdshort': {
        const k = skip(i + 1, 'of');
        const r = runwayAt(k), n = r ? null : nameAt(k);
        const atName = r?.rwy ?? n?.name;
        if (!atName) return 0;
        const last = out[out.length - 1];
        if (last?.verb === 'taxi' && (!last.holdShort || last.holdShort === last.to)) last.holdShort = atName;
        else out.push({ cs, verb: 'holdshort', at: atName });
        return r?.n ?? n!.n;
      }
      case 'continue':
        if (nx && !['taxi', 'taxiing'].includes(nx)) return 0;
        out.push({ cs, verb: 'continue' });
        return nx ? i + 2 : i + 1;
      case 'giveway': {
        const k = skip(i + 1, 'to', 'the');
        const h = findCallsign(B, ctx.callsigns.filter(c => c !== cs), k, B.length, true);
        if (!h || h.sim < 0.7) return 0;
        out.push({ cs, verb: 'giveway', other: h.cs });
        return h.e;
      }
      case 'cross': case 'crossing': {
        const r = runwayAt(i + 1);
        if (!r) { note('missing runway (cross)', 0.5); return 0; }
        out.push({ cs, verb: 'cross', runway: r.rwy });
        return r.n;
      }
      case 'push': {
        let k = skip(i + 1, 'approved', 'and', 'start');
        let face: 'N' | 'S' | 'E' | 'W' | undefined;
        if ((at(k) === 'face' || at(k) === 'facing') && FACE[at(k + 1)]) { face = FACE[at(k + 1)]; k += 2; }
        else if (at(k) === 'tail' && FACE[at(k + 1)]) { face = OPPOSITE[FACE[at(k + 1)]]; k += 2; }
        out.push({ cs, verb: 'push', face });
        return k;
      }
      case 'squawk': {
        const s = num(i + 1), last = out[out.length - 1];
        if (!s) return 0;
        if (last?.verb === 'clearance') last.squawk = s.s;
        return s.n;
      }
      case 'negative': out.push({ cs, verb: 'negative' }); return skip(i + 1, 'isayagain');
      case 'sayagain': out.push({ cs, verb: 'sayagain' }); return i + 1;
      case 'unable': out.push({ cs, verb: 'unable' }); return i + 1;
      case 'resumenav': out.push({ cs, verb: 'resume' }); return i + 1;
    }
    return 0;
  }

  const used = B.map(() => false);
  for (let i = 0; i < B.length;) {
    const n = rule(i);
    if (n > i) { used.fill(true, i, n); i = n; } else i++;
  }
  const cmds = out.filter((c, i) => i === 0 || JSON.stringify(c) !== JSON.stringify(out[i - 1]));
  if (!cmds.length) return null;
  const words = B.filter(t => !FILLER.has(t)).length;
  const covered = B.filter((t, i) => used[i] && !FILLER.has(t)).length;
  const coverage = words ? covered / words : 1;
  if (coverage < 0.6) notes.push('part of the transmission was not understood');
  return { cmds, cs, confidence: Math.round(conf * (0.5 + 0.5 * coverage) * 100) / 100, notes };
}

/** CAP 413 text -> commands (the radio log round-trip). Without a context, callsigns, fixes and runways are taken as heard. */
export function parse(text: string, ctx: Partial<ParseCtx> = {}): Command[] {
  return parseSpeech(text, { callsigns: [], fixes: [], runways: [], holds: [], stands: [], taxiways: [], ...ctx })?.cmds ?? [];
}
