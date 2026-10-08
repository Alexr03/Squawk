import { describe, expect, it } from 'vitest';
import { handle, type KV } from './index.ts';

function kv() {
  const m = new Map<string, { v: string; ttl?: number }>();
  const store: KV & { m: typeof m } = { m, get: async k => m.get(k)?.v ?? null, put: async (k, v, o) => void m.set(k, { v, ttl: o?.expirationTtl }) };
  return store;
}
const call = (env: { SQUAWK: KV }, method: string, path: string, body?: unknown, ip = '1.2.3.4') =>
  handle(new Request(`https://lb.test${path}`, { method, headers: { 'cf-connecting-ip': ip }, body: body === undefined ? undefined : JSON.stringify(body) }), env);

describe('daily leaderboard', () => {
  it('ranks scores, cleans names and caps the board', async () => {
    const env = { SQUAWK: kv() };
    expect(await (await call(env, 'POST', '/daily/2026-10-08', { name: 'Alex\u0007 the controller of everything', score: 500, grade: 'B' })).json()).toEqual({ rank: 1 });
    expect(await (await call(env, 'POST', '/daily/2026-10-08', { name: 'Sam', score: 900, grade: 'A' }, '5.6.7.8')).json()).toEqual({ rank: 1 });
    const { entries } = await (await call(env, 'GET', '/daily/2026-10-08')).json();
    expect(entries.map((e: { name: string }) => e.name)).toEqual(['Sam', 'Alex the controller']);
    for (let i = 0; i < 60; i++) await call(env, 'POST', '/daily/2026-10-08', { name: `P${i}`, score: 1000 + i, grade: 'S' }, `ip${i}`);
    expect((await (await call(env, 'GET', '/daily/2026-10-08')).json()).entries).toHaveLength(50);
    expect(await (await call(env, 'POST', '/daily/2026-10-08', { name: 'Low', score: 1, grade: 'D' }, 'late')).json()).toEqual({ rank: null });
  });

  it('rejects bad shapes and rate-limits per IP', async () => {
    const env = { SQUAWK: kv() };
    for (const b of [{ name: 'x', score: -1, grade: 'A' }, { name: 'x', score: 1.5, grade: 'A' }, { name: 'x', score: 100001, grade: 'A' }, { name: '', score: 1, grade: 'A' }, { name: 'x', score: 1, grade: 'Z' }])
      expect((await call(env, 'POST', '/daily/2026-10-08', b)).status).toBe(400);
    expect((await call(env, 'POST', '/daily/2026-10-08', { name: 'x', score: 1, grade: 'A' })).status).toBe(200);
    expect((await call(env, 'POST', '/daily/2026-10-08', { name: 'x', score: 2, grade: 'A' })).status).toBe(429);
    expect(env.SQUAWK.m.get('rl:1.2.3.4')?.ttl).toBe(60);
    expect((await call(env, 'GET', '/daily/not-a-date')).status).toBe(404);
  });
});

describe('signalling rooms', () => {
  it('passes an invite and answers through a room', async () => {
    const env = { SQUAWK: kv() };
    const { code } = await (await call(env, 'POST', '/room')).json();
    expect(code).toMatch(/^[A-Z]{6}$/);
    expect(await (await call(env, 'GET', `/room/${code}/offer`)).json()).toBeNull();
    expect(await (await call(env, 'GET', `/room/${code}/answer/abc`)).json()).toBeNull();
    expect((await call(env, 'PUT', `/room/${code}/offer`, { id: 'abc', code: 'sdp' })).status).toBe(200);
    expect(await (await call(env, 'GET', `/room/${code}/offer`)).json()).toEqual({ id: 'abc', code: 'sdp' });
    expect((await call(env, 'PUT', `/room/${code}/answer/abc`, { code: 'ans' })).status).toBe(200);
    expect((await call(env, 'PUT', `/room/${code}/answer/abc`, { code: 'other' })).status).toBe(409);
    expect(await (await call(env, 'GET', `/room/${code}/answer/abc`)).json()).toEqual({ code: 'ans' });
    expect(await (await call(env, 'GET', `/room/${code}/peers`)).json()).toEqual({ peers: ['abc'] });
    expect(env.SQUAWK.m.get(`room:${code}:offer`)?.ttl).toBe(600);
    expect((await call(env, 'GET', '/room/ZZZZZZ/offer')).status).toBe(404);
    expect((await call(env, 'PUT', `/room/${code}/offer`, 'x'.repeat(20000))).status).toBe(400);
  });

  it('answers CORS preflight for any origin', async () => {
    const r = await call({ SQUAWK: kv() }, 'OPTIONS', '/room');
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
  });
});
