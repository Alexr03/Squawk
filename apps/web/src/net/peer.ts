// WebRTC plumbing for co-op: one reliable, ordered data channel per guest (star around the host), public STUN.
// Signalling is a copy-paste "code" (the SDP with all ICE candidates, deflated and base64url'd) or the room
// endpoints of apps/leaderboard (signal.ts), which carry the same codes.
const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const CHUNK = 60_000; // stay well under every browser's SCTP message limit

async function pipe(b: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([b as BlobPart]).stream().pipeThrough(t)).arrayBuffer());
}
export const deflate = (s: string) => pipe(new TextEncoder().encode(s), new CompressionStream('deflate-raw'));
export const inflate = async (b: Uint8Array) => new TextDecoder().decode(await pipe(b, new DecompressionStream('deflate-raw')));

function b64(b: Uint8Array) {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const unb64 = (s: string) => Uint8Array.from(atob(s.trim().replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const encode = async (d: RTCSessionDescription) => b64(await deflate(JSON.stringify({ type: d.type, sdp: d.sdp })));
async function decode(code: string): Promise<RTCSessionDescriptionInit> {
  try { return JSON.parse(await inflate(unb64(code))); } catch { throw new Error('That code is not valid — copy it again in full.'); }
}

/** Codes carry every candidate, so wait for gathering to finish (or give up after a few seconds and send what we have). */
const gathered = (pc: RTCPeerConnection) => new Promise<void>(res => {
  if (pc.iceGatheringState === 'complete') return res();
  pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && res());
  setTimeout(res, 5000);
});

/** Host side: a fresh connection and its invite code (one per guest). */
export async function offer() {
  const pc = new RTCPeerConnection(ICE);
  const dc = pc.createDataChannel('squawk', { ordered: true });
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  return { pc, dc, code: await encode(pc.localDescription!), accept: async (answer: string) => pc.setRemoteDescription(await decode(answer)) };
}

/** Guest side: answer an invite code. The data channel arrives once the host has applied the answer. */
export async function answer(invite: string) {
  const pc = new RTCPeerConnection(ICE);
  const dc = new Promise<RTCDataChannel>(res => (pc.ondatachannel = e => res(e.channel)));
  await pc.setRemoteDescription(await decode(invite));
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  return { pc, dc, code: await encode(pc.localDescription!) };
}

/** Pack a message once (JSON, deflated) so a broadcast compresses it a single time. */
export const pack = (m: unknown) => deflate(JSON.stringify(m));

/** A data channel carrying deflated JSON messages, split into frames: [1 = last frame | 0 = more] + bytes. */
export class Link {
  onmsg: (m: any) => void = () => {};
  onclose: () => void = () => {};
  closed = false;
  private parts: Uint8Array[] = [];
  private out: Promise<unknown> = Promise.resolve();
  private inq: Promise<unknown> = Promise.resolve();

  constructor(readonly pc: RTCPeerConnection, readonly dc: RTCDataChannel) {
    dc.binaryType = 'arraybuffer';
    dc.onmessage = e => this.frame(new Uint8Array(e.data as ArrayBuffer));
    dc.onclose = () => this.close();
    pc.addEventListener('connectionstatechange', () => { if (['failed', 'closed'].includes(pc.connectionState)) this.close(); });
  }

  get open() { return this.dc.readyState === 'open'; }
  opened(): Promise<void> {
    return new Promise((res, rej) => {
      if (this.open) return res();
      this.dc.addEventListener('open', () => res(), { once: true });
      setTimeout(() => rej(new Error('Could not connect (timed out). Try a fresh code.')), 20000);
    });
  }

  send(m: unknown) { this.sendPacked(pack(m)); }
  /** `droppable`: skip it when the guest is too far behind (snapshots; the next one replaces it). */
  sendPacked(bytes: Promise<Uint8Array>, droppable = false) {
    this.out = this.out.then(async () => {
      const b = await bytes;
      if (!this.open || (droppable && this.dc.bufferedAmount > 1 << 20)) return;
      for (let i = 0; i < b.length; i += CHUNK) {
        const part = b.subarray(i, i + CHUNK), f = new Uint8Array(part.length + 1);
        f[0] = i + CHUNK >= b.length ? 1 : 0; f.set(part, 1);
        this.dc.send(f);
      }
    }).catch(() => {});
  }

  private frame(f: Uint8Array) {
    this.parts.push(f.subarray(1));
    if (!f[0]) return;
    const all = new Uint8Array(this.parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of this.parts) { all.set(p, o); o += p.length; }
    this.parts = [];
    // Inflate is async: chain it so messages are handled in the order they arrived.
    this.inq = this.inq.then(async () => this.onmsg(JSON.parse(await inflate(all)))).catch(e => console.error('co-op message', e));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.dc.close(); this.pc.close(); } catch { /* already gone */ }
    this.onclose();
  }
}
