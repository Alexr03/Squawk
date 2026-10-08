// Automatic co-op signalling through the room endpoints of apps/leaderboard (when VITE_LEADERBOARD_URL is set).
// The host keeps one open invite in the room; a guest takes it by writing its answer under the invite's id, then the
// host applies that answer and posts the next invite. Everything is polled; rooms expire after 10 minutes idle.
import { BASE } from '../lib/leaderboard.ts';
import { answer, offer, Link } from './peer.ts';

export const autoSignal = !!BASE;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const url = (p: string) => `${BASE}/room/${p}`;
const put = (p: string, body: unknown) => fetch(url(p), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function get<T>(p: string): Promise<T | null> {
  try { const r = await fetch(url(p)); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

export async function createRoom(): Promise<string> {
  const r = await fetch(`${BASE}/room`, { method: 'POST' });
  if (!r.ok) throw new Error(`Room service said ${r.status}`);
  return ((await r.json()) as { code: string }).code;
}

/** Host: keep an invite posted in the room and hand each new connection to `onLink` until `stop()` returns true. */
export async function hostRoom(room: string, onLink: (l: Link) => void, stop: () => boolean) {
  while (!stop()) {
    const o = await offer();
    const id = Math.random().toString(36).slice(2, 10);
    await put(`${room}/offer`, { id, code: o.code });
    let ans: { code: string } | null = null;
    for (let i = 0; !ans && !stop(); i++) {
      await wait(1500);
      ans = await get<{ code: string }>(`${room}/answer/${id}`);
      if (i % 100 === 99) await put(`${room}/offer`, { id, code: o.code }); // keep the room alive
    }
    if (!ans) { o.pc.close(); return; }
    try { await o.accept(ans.code); onLink(new Link(o.pc, o.dc)); } catch { o.pc.close(); }
  }
}

/** Guest: take the room's current invite and connect. */
export async function joinRoom(room: string, timeoutMs = 60000): Promise<Link> {
  const until = Date.now() + timeoutMs;
  const tried = new Set<string>();
  while (Date.now() < until) {
    const inv = await get<{ id: string; code: string }>(`${room.toUpperCase()}/offer`);
    if (inv && !tried.has(inv.id)) {
      tried.add(inv.id);
      const a = await answer(inv.code);
      const r = await put(`${room.toUpperCase()}/answer/${inv.id}`, { code: a.code });
      if (r.ok) {
        const link = new Link(a.pc, await Promise.race([a.dc, wait(20000).then(() => { throw new Error('Host did not pick up'); })]));
        await link.opened();
        return link;
      }
      a.pc.close(); // someone else took this invite; wait for the next one
    }
    await wait(1500);
  }
  throw new Error(`No host in room ${room}`);
}
