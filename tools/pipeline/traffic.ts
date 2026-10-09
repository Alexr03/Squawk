// Real-traffic pipeline: OpenSky movements + aircraft DB types + IEM METARs -> data/days/<ICAO>-<date>.json.
//   node tools/pipeline/traffic.ts EGLL 2025-09-19 --label "..." --tags summer,peak
//   node tools/pipeline/traffic.ts find EGLL --from 2025-01-01 --to 2025-12-31
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { KNOWN_TYPES } from '../../packages/sim/src/aircraft.ts';
import type { DayPack, Flight, Metar } from '../../packages/sim/src/types.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CACHE = path.join(import.meta.dirname, '.cache');
const DAYS = path.join(ROOT, 'data/days');
const AIRCRAFT_DB = 'aircraft-database-complete-2025-08.csv';
const TAR1090_DB = 'tar1090-aircraft.csv.gz';
const TAR1090_URL = 'https://raw.githubusercontent.com/wiedehopf/tar1090-db/csv/aircraft.csv.gz';
const S3 ='https://s3.opensky-network.org/data-samples/metadata/';
const API = 'https://opensky-network.org/api';
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const DAY = 86400;
const dayStart = (date: string) => Date.parse(date + 'T00:00:00Z') / 1000;

/** Reads the cache file, or runs fetcher and stores its text. Errors are not cached. */
async function cached(name: string, fetcher: () => Promise<string>): Promise<string> {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const text = await fetcher();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return text;
}

// ---------------------------------------------------------------- OpenSky

let token: { value: string; expires: number } | null = null;
async function bearer(): Promise<string> {
  if (token && Date.now() < token.expires) return token.value;
  const credFile = process.env.OPENSKY_CREDENTIALS ?? path.join(ROOT, 'credentials.json');
  const { clientId, clientSecret } = JSON.parse(fs.readFileSync(credFile, 'utf8'));
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) throw new Error(`OpenSky token: HTTP ${res.status}`);
  const j = await res.json() as { access_token: string; expires_in?: number };
  token = { value: j.access_token, expires: Date.now() + ((j.expires_in ?? 1800) - 60) * 1000 };
  return token.value;
}

/** GET an OpenSky API path; 404 means "no flights" and returns []. Retries 429/5xx politely. */
async function opensky(p: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + p, { headers: { authorization: 'Bearer ' + await bearer() } });
    const left = res.headers.get('x-rate-limit-remaining');
    console.error(`  GET ${p} -> ${res.status}${left ? ` (credits left ${left})` : ''}`);
    if (res.ok) return await res.text();
    if (res.status === 404) return '[]';
    if (res.status === 401 && attempt < 2) { token = null; continue; } // a stale token: one fresh one, then give up like anything else
    if (attempt >= 4 || (res.status !== 429 && res.status < 500)) throw new Error(`OpenSky ${p}: HTTP ${res.status} ${await res.text()}`);
    const wait = Number(res.headers.get('x-rate-limit-retry-after-seconds') ?? 0);
    if (wait > 600) throw new Error(`OpenSky credits exhausted; retry in ${Math.round(wait / 60)} min`);
    await sleep(Math.max(wait * 1000, 5000 * (attempt + 1)));
  }
}

interface OSFlight {
  icao24: string; firstSeen: number; lastSeen: number; callsign: string | null;
  estDepartureAirport: string | null; estArrivalAirport: string | null;
}

/**
 * One UTC day of arrivals (by lastSeen) or departures (by firstSeen). OpenSky files each flight under the day of
 * its lastSeen, so a long-haul departure that lands tomorrow is only returned by a window reaching into tomorrow:
 * departures use a 2-day window (the API maximum; 30 credits like a 1-day one) and need tomorrow's batch to exist.
 */
async function movements(airport: string, kind: 'arrival' | 'departure', date: string): Promise<OSFlight[]> {
  const b = dayStart(date), e = b + (kind === 'departure' ? 2 * DAY : DAY) - 1;
  const text = await cached(`opensky/${airport}-${kind}-${b}-${e}.json`, async () => {
    const t = await opensky(`/flights/${kind}?airport=${airport}&begin=${b}&end=${e}`);
    await sleep(1500);
    return t;
  });
  const field = kind === 'arrival' ? 'lastSeen' : 'firstSeen';
  return (JSON.parse(text) as OSFlight[]).filter(f => f[field] >= b && f[field] < b + DAY);
}

// ---------------------------------------------------------------- aircraft types

/** Explicit type -> family table for designators seen at the London airports. */
const FAMILY: Record<string, string> = {
  A318: 'A319', A19N: 'A319', BCS1: 'BCS3', CS100: 'BCS3', CS300: 'BCS3',
  B733: 'B738', B734: 'B738', B735: 'B738', B736: 'B738', B737: 'B738', B739: 'B738',
  B37M: 'B38M', B39M: 'B38M', B3XM: 'B38M', B3JM: 'B38M',
  E170: 'E190', E75L: 'E190', E75S: 'E190', E175: 'E190', E290: 'E190', E295: 'E195',
  CRJ2: 'E190', CRJ7: 'E190', CRJ9: 'E190', CRJX: 'E190', RJ85: 'E190', RJ1H: 'E190', B461: 'E190', B462: 'E190', B463: 'E190',
  FA6X: 'E190', F70: 'E190', F100: 'E190', E135: 'E190', E145: 'E190',
  AT43: 'AT76', AT45: 'AT76', AT46: 'AT76', AT72: 'AT76', AT73: 'AT76', AT75: 'AT76', SF34: 'AT76', JS41: 'AT76', D328: 'AT76', SB20: 'AT76',
  DH8A: 'DH8D', DH8B: 'DH8D', DH8C: 'DH8D',
  B753: 'B752', B762: 'B763', B764: 'B763',
  A306: 'B763', A30B: 'B763', A310: 'B763', MD11: 'B772', DC10: 'B772',
  A338: 'A339', A337: 'A333', A342: 'A333', A343: 'A333', A345: 'A35K', A346: 'A35K',
  B77L: 'B772', B773: 'B77W', B778: 'B77W', B779: 'B77W',
  B741: 'B744', B742: 'B744', B743: 'B744', B74S: 'B744', B74R: 'B744', A124: 'B748', A225: 'B748',
};

interface Doc8643 { engines: number; engineType: string; wtc: string; desc: string }

/** Nearest family by ICAO Doc 8643 class when the explicit table has no entry. */
function familyFor(type: string, doc: Map<string, Doc8643>): string | null {
  if (KNOWN_TYPES.includes(type)) return type;
  if (FAMILY[type]) return FAMILY[type];
  const d = doc.get(type);
  if (!d || d.desc === 'Helicopter' || d.desc === 'Gyrocopter' || d.desc === 'Tiltrotor') return null;
  if (d.engineType === 'Turboprop/Turboshaft' || d.engineType === 'Piston') return 'AT76';
  if (d.engineType !== 'Jet') return null;
  if (d.wtc === 'J') return 'A388';
  if (d.wtc === 'H') return d.engines >= 4 ? 'B744' : 'B772';
  // ponytail: business jets and other light/medium jets all become E190; add a bizjet family if Luton/Farnborough matter.
  return 'E190';
}

/** CSV line splitter honouring a quote character ('' or "" escapes). */
function splitCsv(line: string, q: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === q && line[i + 1] === q) { cur += q; i++; }
      else if (c === q) inQ = false;
      else cur += c;
    } else if (c === q) inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

async function download(name: string): Promise<string> {
  const file = path.join(CACHE, name);
  if (!fs.existsSync(file)) {
    console.error(`  downloading ${name}...`);
    const res = await fetch(S3 + name);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return file;
}

async function loadDoc8643(): Promise<Map<string, Doc8643>> {
  const lines = fs.readFileSync(await download('doc8643AircraftTypes.csv'), 'utf8').split(/\r?\n/).slice(1);
  const m = new Map<string, Doc8643>();
  for (const l of lines) {
    if (!l) continue;
    const [desc, , des, eng, engType, , , wtc] = splitCsv(l, '"');
    if (!m.has(des)) m.set(des, { desc, engines: Number(eng) || 2, engineType: engType, wtc });
  }
  return m;
}

/**
 * ICAO type code per icao24. Primary: tar1090-db (current, community-maintained; OpenSky's own metadata endpoint
 * now returns 410 Gone and its DB dump stops at 2025-08). Fallback: the OpenSky dump for anything tar1090-db lacks.
 */
async function lookupTypes(wanted: Set<string>): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const tar = path.join(CACHE, TAR1090_DB);
  if (!fs.existsSync(tar)) {
    console.error(`  downloading ${TAR1090_DB}...`);
    const res = await fetch(TAR1090_URL);
    if (!res.ok) throw new Error(`tar1090-db: HTTP ${res.status}`);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(tar, Buffer.from(await res.arrayBuffer()));
  }
  for (const line of zlib.gunzipSync(fs.readFileSync(tar)).toString('utf8').split('\n')) {
    const [id, , type] = line.split(';');   // icao;reg;type;flags;description;...
    if (type && wanted.has(id.toLowerCase())) found.set(id.toLowerCase(), type.toUpperCase());
  }
  if (found.size === wanted.size) return found;
  const rl = readline.createInterface({ input: fs.createReadStream(await download(AIRCRAFT_DB)) });
  let typeCol = -1;
  for await (const line of rl) {
    if (line.startsWith("'icao24'")) { typeCol = splitCsv(line, "'").indexOf('typecode'); continue; }
    const id = line.slice(1, 7);
    if (!wanted.has(id) || found.has(id)) continue;
    const type = splitCsv(line, "'")[typeCol]?.trim().toUpperCase();
    if (type) found.set(id, type);
  }
  return found;
}

// ---------------------------------------------------------------- METAR

/** Parses a METAR body (wind, vis, ceiling, QNH, temp, wx). Trend and remarks are ignored. */
export function parseMetar(raw: string, time: number): Metar {
  const m: Metar = { time, raw, wind: { dir: 0, kt: 0 }, visM: 10000, ceilingFt: null, qnh: 1013, tempC: 15, wx: [] };
  let visSeen = false;
  for (const tok of raw.trim().split(/\s+/)) {
    if (/^(TEMPO|BECMG|NOSIG|RMK|FM\d+|TL\d+|AT\d+)$/.test(tok)) break;
    let r: RegExpMatchArray | null;
    if ((r = tok.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT$/))) {
      m.wind = r[1] === 'VRB' ? { dir: 0, kt: 0 } : { dir: Number(r[1]), kt: Number(r[2]) };
      if (r[3] && r[1] !== 'VRB') m.wind.gust = Number(r[3]);
    } else if (tok === 'CAVOK') { m.visM = 10000; visSeen = true; }
    else if (!visSeen && (r = tok.match(/^(\d{4})(NDV)?$/))) { m.visM = r[1] === '9999' ? 10000 : Number(r[1]); visSeen = true; }
    else if ((r = tok.match(/^(BKN|OVC|VV)(\d{3})/))) {
      const ft = Number(r[2]) * 100;
      if (m.ceilingFt === null || ft < m.ceilingFt) m.ceilingFt = ft;
    } else if ((r = tok.match(/^(M?\d{2})\/(M?\d{2})?$/))) m.tempC = Number(r[1].replace('M', '-'));
    else if ((r = tok.match(/^Q(\d{4})$/))) m.qnh = Number(r[1]);
    else if ((r = tok.match(/^A(\d{4})$/))) m.qnh = Math.round(Number(r[1]) / 100 * 33.8639);
    else if (/^(\+|-|VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)*$/.test(tok)
      && /[A-Z]{2}/.test(tok) && tok !== 'VC') m.wx.push(tok);
  }
  return m;
}

/** METARs + SPECIs for [from, to] (unix s) from the Iowa Environmental Mesonet ASOS archive. */
async function metars(station: string, from: number, to: number): Promise<Metar[]> {
  const d = (t: number) => new Date(t * 1000);
  const [a, b] = [d(from), d(to)];
  const q = new URLSearchParams({
    station, data: 'metar', tz: 'Etc/UTC', format: 'onlycomma', report_type: '3', // 3 = routine + specials
    year1: String(a.getUTCFullYear()), month1: String(a.getUTCMonth() + 1), day1: String(a.getUTCDate()), hour1: String(a.getUTCHours()),
    year2: String(b.getUTCFullYear()), month2: String(b.getUTCMonth() + 1), day2: String(b.getUTCDate()), hour2: String(b.getUTCHours()),
  });
  q.append('report_type', '4');
  const text = await cached(`metar/${station}-${from}-${to}.csv`, async () => {
    const res = await fetch('https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?' + q);
    if (!res.ok) throw new Error(`IEM ${station}: HTTP ${res.status}`);
    await sleep(1000);
    return await res.text();
  });
  const seen = new Set<string>();
  const out: Metar[] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const [, valid, raw] = line.split(',');
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    const t = Date.parse(valid.replace(' ', 'T') + ':00Z') / 1000;
    if (t >= from && t <= to) out.push(parseMetar(raw, t));
  }
  return out.sort((x, y) => x.time - y.time);
}

// ---------------------------------------------------------------- bake

const AIRLINE_CS = /^[A-Z]{3}[0-9][0-9A-Z]{0,3}$/;

async function bake(airport: string, date: string, label: string, tags: string[]) {
  const t0 = dayStart(date);
  if (Number.isNaN(t0)) throw new Error(`bad date ${date}`);
  console.error(`${airport} ${date}: movements`);
  const raw = [
    ...(await movements(airport, 'arrival', date)).map(f => ({ f, kind: 'arr' as const })),
    ...(await movements(airport, 'departure', date)).map(f => ({ f, kind: 'dep' as const })),
  ];

  let skippedCs = 0, dupes = 0, circular = 0;
  const seen = new Map<string, number>();     // cs|kind -> time, to drop repeats within 30 min
  const rows: { cs: string; icao24: string; kind: 'arr' | 'dep'; time: number; other: string }[] = [];
  for (const { f, kind } of raw.sort((a, b) => a.f.firstSeen - b.f.firstSeen)) {
    const cs = (f.callsign ?? '').trim().toUpperCase();
    if (!AIRLINE_CS.test(cs)) { skippedCs++; continue; }
    // Same airport at both ends: OpenSky returns it as both arrival and departure, and one of them is wrong.
    if (f.estDepartureAirport === airport && f.estArrivalAirport === airport) { circular++; continue; }
    const time = kind === 'arr' ? f.lastSeen : f.firstSeen;
    const key = `${cs}|${kind}`;
    if (seen.has(key) && Math.abs(seen.get(key)! - time) < 1800) { dupes++; continue; }
    seen.set(key, time);
    const other = (kind === 'arr' ? f.estDepartureAirport : f.estArrivalAirport) ?? 'ZZZZ';
    rows.push({ cs, icao24: f.icao24.toLowerCase(), kind, time, other });
  }

  console.error(`${airport} ${date}: aircraft types for ${rows.length} flights`);
  const doc = await loadDoc8643();
  const types = await lookupTypes(new Set(rows.map(r => r.icao24)));
  const substitutions = new Map<string, number>();
  const flights: Flight[] = [];
  for (const r of rows) {
    const type = types.get(r.icao24);
    const fam = type ? familyFor(type, doc) : null;
    if (!fam) {
      substitutions.set(`drop ${r.cs} ${r.icao24}: ${type ? `type ${type} has no family` : 'no type known'}`, 1);
      continue;
    }
    if (fam !== type) substitutions.set(`${type} -> ${fam}`, (substitutions.get(`${type} -> ${fam}`) ?? 0) + 1);
    // Operator = callsign prefix: that is who flies it (and whose RT callsign is spoken); DB owners go stale.
    flights.push({ cs: r.cs, icao24: r.icao24, type: fam, operator: r.cs.slice(0, 3), kind: r.kind, time: r.time, other: r.other });
  }
  flights.sort((a, b) => a.time - b.time || a.cs.localeCompare(b.cs));

  console.error(`${airport} ${date}: METARs`);
  const wx = await metars(airport, t0 - 3600, t0 + DAY + 3600);
  if (!wx.length) throw new Error(`no METARs for ${airport} ${date}`);

  const id = `${airport}-${date}`;
  const pack: DayPack = {
    id, airport, date, label, tags,
    sources: [
      `OpenSky Network /flights/arrival + /flights/departure, ${date} (opensky-network.org)`,
      'Aircraft types: tar1090-db (github.com/wiedehopf/tar1090-db), OpenSky aircraft database 2025-08',
      'METARs: Iowa Environmental Mesonet ASOS archive (mesonet.agron.iastate.edu)',
    ],
    metars: wx,
    flights,
    substitutions: [...substitutions].map(([s, n]) => n > 1 ? `${s} (x${n})` : s),
  };
  fs.mkdirSync(DAYS, { recursive: true });
  // Compact: one flight / METAR per line keeps diffs readable without pretty-printing everything.
  const lines = (xs: unknown[]) => '[\n' + xs.map(x => JSON.stringify(x)).join(',\n') + '\n]';
  const { metars: _m, flights: _f, substitutions: _s, ...head } = pack;
  fs.writeFileSync(path.join(DAYS, id + '.json'),
    JSON.stringify(head).slice(0, -1) + `,"substitutions":${JSON.stringify(pack.substitutions)},\n"metars":${lines(wx)},\n"flights":${lines(flights)}}\n`);

  // Rebuilt from the packs on disk, so a deleted pack drops out on the next bake.
  const indexFile = path.join(DAYS, 'index.json');
  const next = fs.readdirSync(DAYS).filter(f => f.endsWith('.json') && f !== 'index.json').sort().map(f => {
    const p = JSON.parse(fs.readFileSync(path.join(DAYS, f), 'utf8')) as DayPack;
    return { id: p.id, airport: p.airport, date: p.date, label: p.label, tags: p.tags, flights: p.flights.length };
  });
  fs.writeFileSync(indexFile, '[\n' + next.map(e => JSON.stringify(e)).join(',\n') + '\n]\n');

  // OpenSky has receiver/processing outages; an empty daytime hour usually means a gap, not a quiet airport.
  for (let h = 7; h < 21; h++) {
    const n = flights.filter(f => f.time >= t0 + h * 3600 && f.time < t0 + (h + 1) * 3600).length;
    if (n === 0) console.error(`WARNING ${id}: no movements ${h}:00-${h + 1}:00 UTC (OpenSky data gap?)`);
  }
  const arr = flights.filter(f => f.kind === 'arr').length;
  console.log(`${id}: ${flights.length} flights (${arr} arr, ${flights.length - arr} dep), ${wx.length} METARs; ` +
    `skipped ${skippedCs} non-airline callsigns, ${dupes} duplicates, ${circular} circular, ${[...substitutions.keys()].filter(s => s.startsWith('drop')).length} untyped`);
}

// ---------------------------------------------------------------- find

async function find(airport: string, from: string, to: string) {
  const all: Metar[] = [];
  // One IEM request per month keeps responses small and cacheable.
  for (let t = dayStart(from); t <= dayStart(to);) {
    const d = new Date(t * 1000);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
    all.push(...await metars(airport, t, Math.min(next, dayStart(to) + DAY) - 1));
    t = next;
  }
  const byDay = new Map<string, Metar[]>();
  for (const m of all) {
    const k = new Date(m.time * 1000).toISOString().slice(0, 10);
    byDay.set(k, [...(byDay.get(k) ?? []), m]);
  }
  const out: Record<string, string[]> = { easterly: [], fog: [], 'winter night': [], 'summer friday': [] };
  for (const [date, ms] of byDay) {
    const d = new Date(date + 'T00:00:00Z');
    const month = d.getUTCMonth() + 1, dow = d.getUTCDay();
    const east = ms.filter(m => m.wind.dir >= 20 && m.wind.dir <= 160 && m.wind.kt > 5).length / ms.length;
    if (east >= 0.6) out.easterly.push(`${date} ${(east * 100).toFixed(0)}% easterly`);
    const fogHours = new Set(ms.filter(m => m.visM < 800).map(m => new Date(m.time * 1000).getUTCHours()).filter(h => h >= 6 && h < 20));
    if (fogHours.size >= 3) out.fog.push(`${date} ${fogHours.size} daytime hours < 800 m`);
    const night = ms.filter(m => { const h = new Date(m.time * 1000).getUTCHours(); return h >= 23 || h < 6; });
    const calm = night.every(m => m.visM >= 5000 && m.wind.kt < 20);
    if ((month === 12 || month <= 2) && dow >= 1 && dow <= 3 && calm) out['winter night'].push(`${date} ${['Sun', 'Mon', 'Tue', 'Wed'][dow]}`);
    const westerly = ms.filter(m => m.wind.dir >= 200 && m.wind.dir <= 340).length / ms.length;
    if (month >= 6 && month <= 8 && dow === 5) out['summer friday'].push(`${date} ${(westerly * 100).toFixed(0)}% westerly`);
  }
  for (const [k, v] of Object.entries(out)) console.log(`${k} (${v.length}):\n  ${v.join('\n  ') || '-'}`);
}

// ---------------------------------------------------------------- CLI

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === 'find' && args[1]) {
      await find(args[1].toUpperCase(), flag(args, 'from') ?? '2025-01-01', flag(args, 'to') ?? '2025-12-31');
    } else if (args[0] && /^\d{4}-\d{2}-\d{2}$/.test(args[1] ?? '')) {
      await bake(args[0].toUpperCase(), args[1], flag(args, 'label') ?? `${args[0]} ${args[1]}`,
        (flag(args, 'tags') ?? '').split(',').filter(Boolean));
    } else {
      console.error('usage: traffic.ts <ICAO> <YYYY-MM-DD> [--label "..."] [--tags a,b]\n       traffic.ts find <ICAO> [--from YYYY-MM-DD] [--to YYYY-MM-DD]');
      process.exit(2);
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
