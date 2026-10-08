// Co-op sessions. The host's browser runs the authoritative sim (a normal GameClient) and streams snapshots to every
// guest; guests send commands, which the host checks against that guest's seats before the sim sees them.
// Star topology over WebRTC data channels (peer.ts); signalling by copy-paste codes or a room code (signal.ts).
import { find, seatRole, SEATS, seatId, type AirportPack, type Command, type Seat, type ShiftConfig, type State } from '@squawk/sim';
import { GameClient, ShiftClient, type Snap } from '../game/client.ts';
import { prepare, type Launch } from '../lib/launch.ts';
import { settings } from '../lib/settings.svelte.ts';
import { answer, deflate, offer, Link } from './peer.ts';
import { createRoom, hostRoom, joinRoom } from './signal.ts';

export interface Player { id: string; name: string }
export interface Lobby { players: Player[]; seats: Record<string, string>; airport: string; summary: string; started: boolean }

type HostMsg =
  | { t: 'lobby'; you: string; lobby: Lobby }
  | { t: 'start'; launch: Launch }
  | { t: 'snap'; st: Snap; speed: number }
  | { t: 'full'; st: State }
  | { t: 'final'; st: State }
  | { t: 'res'; id: number; err: string | null }
  | { t: 'note'; text: string }
  | { t: 'ping' };
type GuestMsg =
  | { t: 'hello'; name: string }
  | { t: 'claim'; seat: string }
  | { t: 'cmd'; id: number; cmds: Command[]; voice?: boolean };

export const HOST = 'host';
export const ROLE_NAMES: Record<Seat, string> = { DEL: 'Delivery', GND: 'Ground', TWR: 'Tower', DIR: 'Director', LON: 'London Control' };
export const seatName = (seat: string) => ROLE_NAMES[seatRole(seat)];
export const seatsFor = (icao: string) => SEATS.map(r => seatId(icao, r));
export const seatsOf = (lobby: Lobby, id: string) => Object.keys(lobby.seats).filter(s => lobby.seats[s] === id);
const clean = (s: unknown) => String(s ?? '').replace(/[^\x20-\x7e]/g, '').slice(0, 20).trim();

// PLAN.md's default splits by player count (the sim has one seat per role, so 5+ players get one role each).
const SPLITS: Seat[][][] = [
  [['TWR']],
  [['DEL', 'GND'], ['TWR', 'DIR']],
  [['DEL', 'GND'], ['TWR'], ['DIR']],
  [['DEL', 'GND'], ['TWR'], ['DIR'], ['LON']],
  [['DEL'], ['GND'], ['TWR'], ['DIR'], ['LON']],
];
export function defaultSplit(players: Player[], icao: string): Record<string, string> {
  const out: Record<string, string> = {};
  SPLITS[Math.min(players.length, SPLITS.length) - 1]?.forEach((roles, i) => roles.forEach(r => (out[seatId(icao, r)] = players[i].id)));
  return out;
}

/** The session the co-op screens and the in-game seat panel talk to. `lost`: a guest's host went away mid-shift. */
export const coop = $state<{ session: Host | Guest | null; lost: boolean; monitor: boolean; rejoin: string | null }>({ session: null, lost: false, monitor: false, rejoin: null });
if (import.meta.env.DEV) (globalThis as { __coop?: typeof coop }).__coop = coop; // for tools/coop.mjs

export function endCoop() { coop.session?.close(); coop.session = null; coop.lost = false; }

// ---------------------------------------------------------------- host
export class Host {
  readonly kind = 'host';
  lobby = $state<Lobby>({ players: [{ id: HOST, name: clean(settings.callsign) || 'Host' }], seats: {}, airport: 'EGLL', summary: '', started: false });
  room = $state<string | null>(null);
  status = $state('');
  client: GameClient | null = null;
  launch: Launch | null = null;
  /** Bytes per message kind (raw JSON → deflated), the latest of each. */
  stats: Record<string, [number, number]> = {};
  private links = new Map<string, Link>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private closed = false;

  /** `resume`: carry on a shift from the last full state a guest received (host takeover). */
  constructor(readonly resume: { st: State; launch: Launch } | null = null, room: string | null = null) {
    if (resume) { this.lobby.airport = resume.launch.airports[0]; this.lobby.summary = `${resume.launch.title} (resuming)`; }
    if (room) this.openRoom(room);
  }

  /** Manual signalling: an invite code for one more guest, and how to apply the answer they send back. */
  async invite() {
    const o = await offer();
    return { code: o.code, accept: async (ans: string) => { await o.accept(ans); this.attach(new Link(o.pc, o.dc)); } };
  }
  async openRoom(code?: string) {
    try {
      this.room = code ?? await createRoom();
      hostRoom(this.room, l => this.attach(l), () => this.closed).catch(e => (this.status = String(e?.message ?? e)));
    } catch (e) { this.status = String((e as Error)?.message ?? e); }
  }

  private attach(link: Link) {
    const id = Math.random().toString(36).slice(2, 10);
    link.onmsg = (m: GuestMsg) => this.recv(id, link, m);
    link.onclose = () => this.drop(id);
  }

  private async recv(id: string, link: Link, m: GuestMsg) {
    if (m.t === 'hello') {
      if (this.links.has(id)) return;
      this.links.set(id, link);
      this.lobby.players.push({ id, name: clean(m.name) || `Player ${this.lobby.players.length + 1}` });
      if (this.lobby.started && this.launch) link.send({ t: 'start', launch: this.launch } satisfies HostMsg); // late join
      this.client?.onNote(`${this.name(id)} joined`);
      this.sync();
    } else if (!this.links.has(id)) return;
    else if (m.t === 'claim') { if (!this.lobby.started) this.claim(String(m.seat), id); }
    else if (m.t === 'cmd') {
      // Trust boundary: a guest's commands must be well-formed and for an aircraft on one of *their* frequencies.
      const ok = Array.isArray(m.cmds) && m.cmds.length > 0 && m.cmds.length < 8 && m.cmds.every(c => typeof c?.cs === 'string' && typeof c?.verb === 'string');
      const err = !ok ? 'Malformed command' : !this.client ? 'The shift has not started' : await this.client.issue(m.cmds, { voice: !!m.voice, seats: seatsOf(this.lobby, id) });
      link.send({ t: 'res', id: m.id, err } satisfies HostMsg);
    }
  }

  private name(id: string) { return this.lobby.players.find(p => p.id === id)?.name ?? 'Someone'; }

  /** A guest taking or releasing a seat in the lobby (the host overrides with `assign`). */
  private claim(seat: string, id: string) {
    if (!seatsFor(this.lobby.airport).includes(seat)) return;
    const cur = this.lobby.seats[seat];
    if (cur === id) this.assign(seat, null); else if (!cur) this.assign(seat, id);
  }

  /** Give a seat to a player (null = AI, lobby only). Mid-shift this is a split/merge, with a handover summary. */
  assign(seat: string, to: string | null) {
    const from = this.lobby.seats[seat] ?? null;
    if (from === to || (this.lobby.started && (!to || !from))) return; // mid-shift, seats only move between players
    if (to) this.lobby.seats[seat] = to; else delete this.lobby.seats[seat];
    if (this.lobby.started && to) {
      const acs = this.client?.snap ? this.client.snap.aircraft.filter(a => a.freq === seat && a.phase !== 'gone').map(a => a.cs) : [];
      const text = `Handover: ${seatName(seat)} → ${this.name(to)} · ${acs.length ? acs.join(', ') : 'frequency quiet'}`;
      for (const p of new Set([from!, to])) this.note(p, text);
    }
    this.sync();
  }
  setSeats(seats: Record<string, string>) { this.lobby.seats = seats; this.sync(); }
  setInfo(airport: string, summary: string) {
    if (airport !== this.lobby.airport) this.lobby.seats = {};
    this.lobby.airport = airport; this.lobby.summary = summary; this.sync();
  }

  private note(id: string, text: string) {
    if (id === HOST) this.client?.onNote(text); else this.links.get(id)?.send({ t: 'note', text } satisfies HostMsg);
  }
  private sync() {
    if (this.client) this.client.seats = seatsOf(this.lobby, HOST);
    const lobby = $state.snapshot(this.lobby);
    for (const [id, l] of this.links) l.send({ t: 'lobby', you: id, lobby } satisfies HostMsg);
  }

  private drop(id: string) {
    if (!this.links.delete(id)) return;
    const name = this.name(id);
    // A player who leaves mid-shift bandboxes their seats back to the host; in the lobby they go back to AI.
    for (const s of seatsOf(this.lobby, id)) if (this.lobby.started) this.assign(s, HOST); else delete this.lobby.seats[s];
    this.lobby.players = this.lobby.players.filter(p => p.id !== id);
    this.client?.onNote(`${name} left — their seats are yours`);
    this.sync();
  }

  /** Start (or resume) the shift: coverage is every claimed seat; the rest are AI. */
  async start(l: Launch): Promise<GameClient> {
    const coverage = Object.keys(this.lobby.seats);
    if (!coverage.length) throw new Error('Someone has to take a seat');
    l = { ...l, coverage };
    const { packs, cfg } = await prepare(l);
    this.client = new GameClient(packs, cfg, this.resume ? { ...this.resume.st, coverage } : undefined);
    this.client.monitor = coop.monitor;
    this.launch = l;
    this.lobby.started = true;
    for (const link of this.links.values()) link.send({ t: 'start', launch: l } satisfies HostMsg);
    this.sync();
    this.stream(this.client);
    return this.client;
  }

  private broadcast(m: HostMsg, droppable = false) {
    if (!this.links.size) return;
    const json = JSON.stringify(m), p = deflate(json);
    p.then(b => (this.stats[m.t] = [json.length, b.length]));
    for (const l of this.links.values()) l.sendPacked(p, droppable);
  }

  /** ~4 snapshots a second, a full state every 10 s (what a guest needs to take over), a ping when idle, then the final state. */
  private stream(c: GameClient) {
    let sent: Snap | null = null, lastSend = 0, lastFull = 0, finalSent = false;
    this.timer = setInterval(async () => {
      const now = Date.now();
      if (c.final) { if (!finalSent) { finalSent = true; this.broadcast({ t: 'final', st: c.final }); } return; }
      if (c.snap && c.snap !== sent) { sent = c.snap; lastSend = now; this.broadcast({ t: 'snap', st: c.snap, speed: c.speed }, true); }
      else if (now - lastSend > 2000) { lastSend = now; this.broadcast({ t: 'ping' }); }
      if (c.snap && now - lastFull > 10000 && this.links.size) { lastFull = now; this.broadcast({ t: 'full', st: await c.full() }); }
    }, 250);
  }

  close() {
    this.closed = true;
    clearInterval(this.timer);
    for (const l of this.links.values()) { l.onclose = () => {}; l.close(); }
    this.links.clear();
  }
}

// ---------------------------------------------------------------- guest
export class Guest {
  readonly kind = 'guest';
  lobby = $state<Lobby | null>(null);
  status = $state('');
  connected = $state(false);
  you = $state('');
  remote: RemoteClient | null = null;
  launch: Launch | null = null;
  lastFull: State | null = null;
  onStart: (c: RemoteClient, l: Launch) => void = () => {};
  private link: Link | null = null;
  private lastMsg = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(public room: string | null = null) {}

  /** Manual signalling: answer the host's invite; returns the code to send back. */
  async answer(invite: string): Promise<string> {
    const a = await answer(invite);
    a.dc.then(dc => this.connect(new Link(a.pc, dc)));
    return a.code;
  }
  async join(room: string) {
    this.room = room.trim().toUpperCase();
    this.status = `Looking for room ${this.room}…`;
    try { await this.connect(await joinRoom(this.room)); } catch (e) { this.status = String((e as Error)?.message ?? e); }
  }

  private async connect(link: Link) {
    this.link = link;
    link.onmsg = (m: HostMsg) => this.recv(m);
    link.onclose = () => this.lose();
    try { await link.opened(); } catch (e) { this.status = String((e as Error).message); return; }
    this.connected = true; this.status = 'Connected — waiting for the host';
    link.send({ t: 'hello', name: clean(settings.callsign) || 'Guest' } satisfies GuestMsg);
    this.lastMsg = Date.now();
    this.timer = setInterval(() => { if (this.launch && Date.now() - this.lastMsg > 5000) this.lose(); }, 1000);
  }

  private recv(m: HostMsg) {
    this.lastMsg = Date.now();
    if (m.t === 'lobby') { this.you = m.you; this.lobby = m.lobby; if (this.remote) this.remote.seats = seatsOf(m.lobby, m.you); }
    else if (m.t === 'start') this.begin(m.launch);
    else if (m.t === 'snap') this.remote?.receive(m.st, m.speed);
    else if (m.t === 'full') this.lastFull = m.st;
    else if (m.t === 'final') this.remote?.end(m.st);
    else if (m.t === 'res') this.remote?.resolve(m.id, m.err);
    else if (m.t === 'note') this.remote?.onNote(m.text);
  }

  private async begin(l: Launch) {
    this.launch = { ...l, difficulty: { ...l.difficulty, pause: false } }; // the clock is the host's
    const { packs, cfg } = await prepare(this.launch);
    this.remote = new RemoteClient(packs, cfg, this);
    this.remote.seats = this.lobby ? seatsOf(this.lobby, this.you) : [];
    this.remote.monitor = coop.monitor;
    this.onStart(this.remote, this.launch);
  }

  send(m: GuestMsg) { this.link?.send(m); }
  claim(seat: string) { this.send({ t: 'claim', seat }); }

  private lose() {
    if (this.remote?.final) return; // the shift ended normally
    this.connected = false;
    if (this.remote) coop.lost = true; else this.status = 'Lost the host';
    clearInterval(this.timer);
  }
  get canTakeOver() { return !!(this.lastFull && this.launch); }
  /** Become the host from the last full state (the shift rewinds by up to 10 s). */
  takeover(): Host | null {
    if (!this.lastFull || !this.launch) return null;
    this.close();
    return new Host({ st: this.lastFull, launch: this.launch }, this.room);
  }

  close() {
    clearInterval(this.timer);
    if (this.link) { this.link.onclose = () => {}; this.link.close(); }
  }
}

/** A guest's view of the shift: same shape as GameClient, but the sim runs in the host's browser. */
export class RemoteClient extends ShiftClient {
  canSetSpeed = false;
  private nextId = 1;
  private waiting = new Map<number, (err: string | null) => void>();
  constructor(packs: AirportPack[], cfg: ShiftConfig, private guest: Guest) { super(packs, cfg); }

  receive(st: Snap, speed: number) { this.speed = speed; this.push(st); }
  end(st: State) { this.final = st; this.onFinal(st); }
  resolve(id: number, err: string | null) { this.waiting.get(id)?.(err); this.waiting.delete(id); }

  issue(cmds: Command[], opts: { voice?: boolean } = {}): Promise<string | null> {
    const ac = this.snap && cmds[0] ? find(this.snap, cmds[0].cs) : undefined;
    if (ac && !this.seats.includes(ac.freq)) return Promise.resolve(`${ac.cs} is on ${seatRole(ac.freq)}, not your frequency`);
    const id = this.nextId++;
    setTimeout(() => this.resolve(id, 'No answer from the host'), 8000);
    return new Promise(res => { this.waiting.set(id, res); this.guest.send({ t: 'cmd', id, cmds, voice: opts.voice }); });
  }
  setSpeed() { /* host only */ }
  dispose() { this.guest.close(); }
}
