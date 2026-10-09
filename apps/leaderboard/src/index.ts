// Squawk's only server code: the daily-challenge leaderboard and co-op signalling rooms (Cloudflare Worker + KV).
// The game works without it: the leaderboard falls back to the device, co-op to copy-paste codes.

/** The slice of Workers KV this uses (kept local so there's no types dependency). */
export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}
export interface Env { SQUAWK: KV }
interface Entry { name: string; score: number; grade: string; at: number }

const TOP = 50;
const RATE_MS = 30_000;
const KV_MIN_TTL = 60;   // KV's shortest expiry; the 30 s window is checked against the stored time
const ROOM_TTL = 600;
const MAX_BODY = 16_384; // an SDP code is ~1 kB
const GRADES = ['S', 'A', 'B', 'C', 'D'];
const ROOM_WRITES = 40;  // co-op signalling writes one address may make per ROOM_TTL (a session needs a handful)

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS', 'access-control-allow-headers': 'content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });
const fail = (status: number, error: string) => json({ error }, status);

async function body(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

const getJSON = async <T>(env: Env, key: string, missing: T): Promise<T> => { const v = await env.SQUAWK.get(key); return v === null ? missing : JSON.parse(v) as T; };

async function board(env: Env, date: string): Promise<Entry[]> {
  return getJSON<Entry[]>(env, `daily:${date}`, []);
}

/** Room writes are budgeted per address, so nobody can loop them and use up the day's KV writes. Costs one write itself. */
async function roomWriteAllowed(req: Request, env: Env): Promise<boolean> {
  const key = `rlw:${req.headers.get('cf-connecting-ip') ?? 'unknown'}`, now = Date.now();
  const v = await getJSON<{ n: number; since: number } | null>(env, key, null);
  const cur = v && now - v.since < ROOM_TTL * 1000 ? v : { n: 0, since: now };
  if (cur.n >= ROOM_WRITES) return false;
  await env.SQUAWK.put(key, JSON.stringify({ n: cur.n + 1, since: cur.since }), { expirationTtl: ROOM_TTL });
  return true;
}
const busy = () => fail(429, 'Too many room requests; try again in a few minutes');

async function submit(req: Request, env: Env, date: string): Promise<Response> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const last = Number(await env.SQUAWK.get(`rl:${ip}`));
  if (last && Date.now() - last < RATE_MS) return fail(429, 'One score every 30 seconds');
  const b = await body(req);
  const name = typeof b?.name === 'string' ? b.name.replace(/[^\x20-\x7e]/g, '').slice(0, 20).trim() : '';
  const score = b?.score;
  if (!name || typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 100_000 || !GRADES.includes(b?.grade as string)) return fail(400, 'Expected {name, score: 0..100000, grade}');
  await env.SQUAWK.put(`rl:${ip}`, String(Date.now()), { expirationTtl: KV_MIN_TTL });
  // ponytail: read-modify-write on one key, so two scores landing in the same instant can drop one; a Durable Object fixes it if that ever matters.
  const entry: Entry = { name, score, grade: b!.grade as string, at: Date.now() };
  const list = [...(await board(env, date)), entry].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, TOP);
  await env.SQUAWK.put(`daily:${date}`, JSON.stringify(list), { expirationTtl: 60 * 60 * 24 * 90 });
  const i = list.indexOf(entry);
  return json({ rank: i < 0 ? null : i + 1 });
}

// ---------------------------------------------------------------- co-op signalling rooms
const roomKey = (code: string) => `room:${code}`;
async function room(req: Request, env: Env, code: string, rest: string[]): Promise<Response> {
  if (!(await env.SQUAWK.get(roomKey(code)))) return fail(404, 'No such room');
  const ttl = { expirationTtl: ROOM_TTL };
  const [what, peer] = rest;
  if (what === 'offer' && rest.length === 1) {
    if (req.method === 'GET') return json(await getJSON(env, `${roomKey(code)}:offer`, null)); // null: no invite yet (200, so polling stays quiet)
    if (req.method === 'PUT') {
      const b = await body(req);
      if (!b) return fail(400, 'Expected a JSON object');
      if (!(await roomWriteAllowed(req, env))) return busy();
      await env.SQUAWK.put(`${roomKey(code)}:offer`, JSON.stringify(b), ttl);
      await env.SQUAWK.put(roomKey(code), '1', ttl); // the host's activity keeps the room alive
      return json({ ok: true });
    }
  }
  if (what === 'answer' && rest.length === 2 && /^[a-z0-9]{1,16}$/i.test(peer)) {
    const key = `${roomKey(code)}:answer:${peer}`;
    if (req.method === 'GET') return json(await getJSON(env, key, null));
    if (req.method === 'PUT') {
      if (await env.SQUAWK.get(key)) return fail(409, 'That invite is taken');
      const b = await body(req);
      if (!b) return fail(400, 'Expected a JSON object');
      if (!(await roomWriteAllowed(req, env))) return busy();
      await env.SQUAWK.put(key, JSON.stringify(b), ttl);
      const peers = await getJSON<string[]>(env, `${roomKey(code)}:peers`, []);
      await env.SQUAWK.put(`${roomKey(code)}:peers`, JSON.stringify([...peers, peer].slice(-32)), ttl);
      return json({ ok: true });
    }
  }
  if (what === 'peers' && rest.length === 1 && req.method === 'GET') return json({ peers: await getJSON<string[]>(env, `${roomKey(code)}:peers`, []) });
  return fail(405, 'Not allowed');
}

async function newRoom(req: Request, env: Env): Promise<Response> {
  if (!(await roomWriteAllowed(req, env))) return busy();
  for (let i = 0; i < 8; i++) {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), n => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[n % 24]).join('');
    if (await env.SQUAWK.get(roomKey(code))) continue;
    await env.SQUAWK.put(roomKey(code), '1', { expirationTtl: ROOM_TTL });
    return json({ code });
  }
  return fail(503, 'Try again');
}

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  try {
    if (parts[0] === 'daily' && parts.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(parts[1])) {
      if (req.method === 'GET') return json({ entries: await board(env, parts[1]) });
      if (req.method === 'POST') return await submit(req, env, parts[1]);
    }
    if (parts[0] === 'room') {
      if (parts.length === 1 && req.method === 'POST') return await newRoom(req, env);
      if (parts.length >= 3 && /^[A-Z]{6}$/.test(parts[1])) return await room(req, env, parts[1], parts.slice(2));
    }
    return fail(404, 'Not found');
  } catch (e) {
    return fail(500, String((e as Error)?.message ?? e));
  }
}

export default { fetch: handle };
