// Automatic co-op signalling by room code: through PocketBase when VITE_POCKETBASE_URL is set (8-digit codes), otherwise the room
// endpoints of apps/leaderboard (VITE_LEADERBOARD_URL). Only the WebRTC handshake goes through the server; play is peer to peer.
// The host keeps one open invite in the room; a guest takes it by writing its answer under the invite's id, then the
// host applies that answer and posts the next invite. Everything is polled; rooms expire after 10 minutes idle.
import { BASE } from '../lib/leaderboard.ts';
import { answer, offer, Link } from './peer.ts';
import { account, pb } from '../lib/pb.svelte.ts';

export const autoSignal = !!pb || !!BASE;
/** Room codes: 8 digits on PocketBase, 6 letters on the Worker. */
export const codeLength = pb ? 8 : 6;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const url = (p: string) => `${BASE}/room/${p}`;
const put = (p: string, body: unknown) => fetch(url(p), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function get<T>(p: string): Promise<T | null> {
  try { const r = await fetch(url(p)); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

export async function createRoom(): Promise<string> {
  if (pb) return pbCreateRoom();
  const r = await fetch(`${BASE}/room`, { method: 'POST' });
  if (!r.ok) throw new Error(`Room service said ${r.status}`);
  return ((await r.json()) as { code: string }).code;
}

/** Host: keep an invite posted in the room and hand each new connection to `onLink` until `stop()` returns true. */
export async function hostRoom(room: string, onLink: (l: Link) => void, stop: () => boolean) {
  if (pb) return pbHostRoom(room, onLink, stop);
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
  if (pb) return pbJoinRoom(room.trim(), timeoutMs);
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

// ------------------------------------------------------------------ PocketBase rooms

async function pbRoom(code: string) {
  // The code goes along as a query parameter: the server only lets you see a room whose code you know.
  return (await pb!.collection('rooms').getList(1, 1, { filter: pb!.filter('code = {:c}', { c: code }), code })).items[0] ?? null;
}

async function pbCreateRoom(): Promise<string> {
  if (!account.user) throw new Error('Sign in with Discord (Settings → Account) to host a room');
  for (let i = 0; i < 5; i++) {
    const code = String(10000000 + Math.floor(Math.random() * 90000000));
    try { await pb!.collection('rooms').create({ code, host: account.user.id }); return code; } catch { /* code taken: try another */ }
  }
  throw new Error('Could not open a room');
}

async function pbHostRoom(code: string, onLink: (l: Link) => void, stop: () => boolean) {
  let room = await pbRoom(code);
  if (!room && account.user) room = await pb!.collection('rooms').create({ code, host: account.user.id }); // host takeover: reopen the same code
  if (!room) throw new Error('Sign in with Discord to host');
  while (!stop()) {
    const o = await offer();
    const id = Math.random().toString(36).slice(2, 10);
    // Taking over from a host who dropped: the server allows it once their room has been quiet for 45 s, so keep trying.
    for (let t = 0; ; t++) {
      try { await pb!.collection('rooms').update(room.id, { offer: { id, code: o.code }, host: account.user?.id }); break; }
      catch (e) { if (t > 24 || stop()) throw e; await wait(5000); }
    }
    let ans: { code: string } | null = null;
    for (let i = 0; !ans && !stop(); i++) {
      await wait(1500);
      const r = (await pb!.collection('answers').getList(1, 1, { filter: pb!.filter('room = {:r} && offer_id = {:o}', { r: room.id, o: id }) }).catch(() => null))?.items[0];
      if (r) ans = r.sdp as { code: string };
      if (i % 13 === 12) await pb!.collection('rooms').update(room.id, { offer: { id, code: o.code } }).catch(() => {}); // heartbeat every ~20 s
    }
    if (!ans) { o.pc.close(); break; }
    try { await o.accept(ans.code); onLink(new Link(o.pc, o.dc)); } catch { o.pc.close(); }
  }
  await pb!.collection('rooms').delete(room.id).catch(() => {});
}

async function pbJoinRoom(code: string, timeoutMs: number): Promise<Link> {
  const until = Date.now() + timeoutMs;
  const tried = new Set<string>();
  while (Date.now() < until) {
    const room = await pbRoom(code).catch(() => null);
    const inv = room?.offer as { id: string; code: string } | undefined;
    if (room && inv && !tried.has(inv.id)) {
      tried.add(inv.id);
      const a = await answer(inv.code);
      const ok = await pb!.collection('answers').create({ room: room.id, offer_id: inv.id, sdp: { code: a.code } }).then(() => true, () => false);
      if (ok) {
        const link = new Link(a.pc, await Promise.race([a.dc, wait(20000).then(() => { throw new Error('Host did not pick up'); })]));
        await link.opened();
        return link;
      }
      a.pc.close();
    }
    await wait(1500);
  }
  throw new Error(`No host in room ${code}`);
}
