// Typed shortcuts for the command line: "BAW12 H270 A40 S210" -> commands, plus autocomplete.
import type { Command, Seat } from '@squawk/sim/types';
import { isRunway } from './text.ts';

/** What the parsers may resolve against. Empty lists accept anything that looks right. */
export interface ParseCtx {
  callsigns: string[];        // aircraft on the frequency
  fixes: string[];
  runways: string[];          // runway ends usable by these aircraft; "27" resolves only when unique here
  holds: string[];            // holding points ("A1")
  stands: string[];
  taxiways: string[];
  selected?: string;          // selected aircraft: used when the line has no callsign
  fixNames?: Record<string, string>; // spoken names (BNN -> "Bovingdon", EGPH -> "Edinburgh"), voice only
  sids?: string[];            // SID designators, voice only
}

type Result = { cmds: Command[] } | { error: string };

const WORDS = ['SR', 'D', 'DCT', 'HOLD', 'ILS', 'LUW', 'CTO', 'CLR', 'LAND', 'GA', 'CT', 'PB', 'PUSH', 'TX', 'VIA', 'FG',
  'GREENS', 'HS', 'CONT', 'X', 'CROSS', 'GW', 'CLD', 'NEG', 'SA', 'UNABLE', 'RES', 'HP', 'STOP'];
const VALUE = /^([HLR]\d{1,3}|A\d+|FL?\d+|S\d+|ILS\d\d?[LRC]?)$/;
const isVerb = (t: string) => WORDS.includes(t) || VALUE.test(t);
const SEATS: Record<string, Seat> = { DEL: 'DEL', GND: 'GND', TWR: 'TWR', DIR: 'DIR', LON: 'LON', APP: 'DIR', CTR: 'LON' };

/** Exact, then unique prefix or suffix match ("BAW12" or "12"). */
function findCs(t: string, list: string[]): string | { error: string } {
  if (list.includes(t)) return t;
  const m = list.filter(c => c.startsWith(t) || c.endsWith(t));
  return m.length === 1 ? m[0] : { error: m.length ? `${t} is ambiguous: ${m.join(', ')}` : `No aircraft ${t} on frequency` };
}

function findRunway(t: string | undefined, list: string[]): string | { error: string } {
  const m = t && /^(\d{1,2})([LRC]?)$/.exec(t);
  if (!m) return { error: `Expected a runway, got ${t ?? 'nothing'}` };
  const r = m[1].padStart(2, '0') + m[2];
  if (!list.length || list.includes(r)) return r;
  const c = list.filter(x => x.startsWith(r));
  return c.length === 1 ? c[0] : { error: c.length ? `Runway ${r} is ambiguous: ${c.join(', ')}` : `Runway ${r} not in use` };
}

/** Taxi limit: runway (-> its holding point), holding point or stand. */
function findTarget(t: string | undefined, c: ParseCtx): string | { error: string } {
  if (!t) return { error: 'Expected a runway, holding point or stand' };
  if (/^\d{1,2}[LRC]?$/.test(t) && !c.stands.includes(t)) return findRunway(t, c.runways);
  if (c.holds.includes(t) || c.stands.includes(t)) return t;
  if (!c.holds.length && /^[A-Z]{1,2}\d{1,2}$/.test(t)) return t;
  if (!c.stands.length && /^\d{3}[A-Z]?$/.test(t)) return t;
  return { error: `Unknown runway, holding point or stand ${t}` };
}

export function parseLine(line: string, ctx: ParseCtx): Result {
  const T = line.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!T.length) return { error: 'Empty command' };
  let i = 0, cs = ctx.selected;
  if (!isVerb(T[0])) {
    const r = findCs(T[0], ctx.callsigns);
    if (typeof r !== 'string') return r;
    cs = r; i = 1;
  }
  if (!cs) return { error: 'Select an aircraft or start with its callsign' };
  const cmds: Command[] = [];
  const ok = (v: string | { error: string }): v is string => typeof v === 'string';
  const optRunway = (): string | { error: string } =>
    T[i] && /^\d{1,2}[LRC]?$/.test(T[i]) ? findRunway(T[i++], ctx.runways) : ctx.runways.length === 1 ? ctx.runways[0] : '';

  while (i < T.length) {
    const t = T[i++];
    let m: RegExpExecArray | null;
    if ((m = /^([HLR])(\d{1,3})$/.exec(t))) {
      const hdg = +m[2];
      if (hdg < 1 || hdg > 360) return { error: `Heading ${hdg} out of range` };
      cmds.push({ cs, verb: 'heading', hdg, turn: m[1] === 'H' ? undefined : m[1] as 'L' | 'R' });
    } else if ((m = /^A(\d+)$/.exec(t))) cmds.push({ cs, verb: 'alt', alt: +m[1] < 1000 ? +m[1] * 100 : +m[1] });
    else if ((m = /^FL?(\d+)$/.exec(t))) cmds.push({ cs, verb: 'alt', alt: +m[1] * 100 });
    else if ((m = /^S(\d+)$/.exec(t))) cmds.push({ cs, verb: 'speed', kt: +m[1] || null });
    else if ((m = /^ILS(\S*)$/.exec(t))) {
      const r = findRunway(m[1] || T[i++], ctx.runways);
      if (!ok(r)) return r;
      cmds.push({ cs, verb: 'ils', runway: r });
    } else switch (t) {
      case 'SR': cmds.push({ cs, verb: 'speed', kt: null }); break;
      case 'D': case 'DCT': case 'HOLD': {
        const fix = T[i++];
        if (!fix || (ctx.fixes.length && !ctx.fixes.includes(fix))) return { error: `Unknown fix ${fix ?? ''}`.trim() };
        cmds.push({ cs, verb: t === 'HOLD' ? 'hold' : 'direct', fix });
        break;
      }
      case 'LUW': case 'CTO': case 'CLR': case 'LAND': {
        const r = optRunway();
        if (!ok(r)) return r;
        cmds.push({ cs, verb: t === 'LUW' ? 'luw' : t === 'CTO' ? 'cto' : 'land', runway: r });
        break;
      }
      case 'GA': cmds.push({ cs, verb: 'goaround' }); break;
      case 'CT': {
        const seat = SEATS[(T[i++] ?? '').slice(0, 3)];
        if (!seat) return { error: 'CT needs DEL, GND, TWR, DIR or LON' };
        cmds.push({ cs, verb: 'contact', seat });
        break;
      }
      case 'PB': case 'PUSH': {
        const face = /^[NSEW]$/.test(T[i] ?? '') ? T[i++] as 'N' | 'S' | 'E' | 'W' : undefined;
        cmds.push({ cs, verb: 'push', face });
        break;
      }
      case 'TX': {
        const to = findTarget(T[i++], ctx);
        if (!ok(to)) return to;
        const via: string[] = [];
        if (T[i] === 'VIA') {
          i++;
          while (T[i] && (ctx.taxiways.length ? ctx.taxiways.includes(T[i]) : /^[A-Z]\d{0,2}$/.test(T[i]) && T[i] !== 'X')) via.push(T[i++]);
          if (!via.length) return { error: 'VIA needs taxiways' };
        }
        // A runway taxi limit always means its holding point, so the aircraft holds short of that runway.
        let holdShort = isRunway(to) && !ctx.stands.includes(to) ? to : undefined;
        if (T[i] === 'HS') {
          i++;
          const at = T[i] && (!isVerb(T[i]) || ctx.holds.includes(T[i])) ? findTarget(T[i++], ctx) : to;
          if (!ok(at)) return at;
          holdShort = at;
        }
        cmds.push({ cs, verb: 'taxi', to, via, holdShort });
        break;
      }
      case 'FG': case 'GREENS': {
        const to = findTarget(T[i++], ctx);
        if (!ok(to)) return to;
        cmds.push({ cs, verb: 'greens', to });
        break;
      }
      case 'HS': {
        const at = T[i] && (ctx.taxiways.includes(T[i]) || /^[A-Z]$/.test(T[i])) ? T[i++] : findTarget(T[i++], ctx);
        if (!ok(at)) return at;
        cmds.push({ cs, verb: 'holdshort', at });
        break;
      }
      case 'CONT': cmds.push({ cs, verb: 'continue' }); break;
      case 'X': case 'CROSS': {
        const r = findRunway(T[i++], []); // any runway may be crossed, not just the ones in use
        if (!ok(r)) return r;
        cmds.push({ cs, verb: 'cross', runway: r });
        break;
      }
      case 'GW': {
        const other = T[i] ? findCs(T[i++], ctx.callsigns) : { error: 'GW needs a callsign' };
        if (!ok(other)) return other;
        cmds.push({ cs, verb: 'giveway', other });
        break;
      }
      case 'CLD': {
        const c: Command & { verb: 'clearance' } = { cs, verb: 'clearance', sid: '', alt: 0, squawk: '' };
        for (; T[i] && !WORDS.includes(T[i]); i++) {
          if (/^[0-7]{4}$/.test(T[i])) c.squawk = T[i];
          else if ((m = /^A(\d+)$/.exec(T[i]))) c.alt = +m[1] < 1000 ? +m[1] * 100 : +m[1];
          else if (/^[A-Z]{3,5}\d[A-Z]$/.test(T[i]) && (!ctx.sids?.length || ctx.sids.includes(T[i]))) c.sid = T[i];
          else return { error: `Unknown clearance item ${T[i]}` };
        }
        cmds.push(c);
        break;
      }
      case 'NEG': cmds.push({ cs, verb: 'negative' }); break;
      case 'SA': cmds.push({ cs, verb: 'sayagain' }); break;
      case 'UNABLE': cmds.push({ cs, verb: 'unable' }); break;
      case 'RES': cmds.push({ cs, verb: 'resume' }); break;
      case 'HP': case 'STOP': cmds.push({ cs, verb: 'halt' }); break; // hold position / stop immediately
      default: return { error: `Unknown instruction ${t}` };
    }
  }
  return cmds.length ? { cmds } : { error: `No instruction for ${cs}` };
}

const HINTS = ['H', 'L', 'R', 'A', 'FL', 'S', ...WORDS];

/** Suggestions for the last (partial) token of the line. */
export function complete(line: string, ctx: ParseCtx): string[] {
  const T = line.toUpperCase().split(/\s+/);
  const last = T.pop() ?? '', prev = T.filter(Boolean).at(-1);
  const inVia = T.includes('VIA') && T.slice(T.lastIndexOf('VIA') + 1).every(t => !isVerb(t) || ctx.taxiways.includes(t));
  const pool =
    !prev ? (ctx.selected ? [...ctx.callsigns, ...HINTS] : ctx.callsigns)
    : prev === 'D' || prev === 'DCT' || prev === 'HOLD' ? ctx.fixes
    : prev === 'CT' ? ['DEL', 'GND', 'TWR', 'DIR', 'LON']
    : prev === 'GW' ? ctx.callsigns
    : ['TX', 'FG', 'GREENS', 'HS'].includes(prev) ? [...ctx.runways, ...ctx.holds, ...ctx.stands]
    : prev === 'X' || prev === 'CROSS' || prev === 'ILS' || prev === 'LUW' || prev === 'CTO' || prev === 'LAND' ? ctx.runways
    : prev === 'CLD' ? ctx.sids ?? []
    : inVia ? [...ctx.taxiways, 'HS'] : HINTS;
  const hit = pool.filter(s => s.startsWith(last));
  if (pool === ctx.callsigns || !prev) hit.push(...ctx.callsigns.filter(s => last && !s.startsWith(last) && s.endsWith(last)));
  return [...new Set(hit)];
}
