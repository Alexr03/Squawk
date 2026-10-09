import { readFileSync } from 'node:fs';
import { lineupBlocked, stackLevel } from './ai.ts';
import { standFits } from './aircraft.ts';
import { project } from './predict.ts';
import { separation } from './rules.ts';
import { pointOnEnd } from './world.ts';
import { describe, expect, test } from 'vitest';
import { buildWorld, createShift, debrief, depGap, DIFFICULTY, flowPenalty, geo, hashState, issue, replay, route, step, find, taxiTarget, type AirportPack, type DayPack, type ShiftConfig, type State } from './index.ts';

const pack: AirportPack = JSON.parse(readFileSync(new URL('../../../data/airports/EGLL/airport.json', import.meta.url), 'utf8'));
const day: DayPack = JSON.parse(readFileSync(new URL('../../../data/days/EGLL-2026-08-28.json', import.meta.url), 'utf8'));
const world = buildWorld([pack]);
const start = Date.parse('2026-08-28T06:00:00Z') / 1000;
const cfg = (over: Partial<ShiftConfig> = {}): ShiftConfig => ({ seed: 3, airports: ['EGLL'], days: [day], start, durationS: 20 * 60, traffic: 0.8, coverage: [], difficulty: { ...DIFFICULTY.standard, emergencies: 0 }, mode: 'free', ...over });
const run = (st: State, c: ShiftConfig, each?: (st: State) => void) => { while (!st.ended) { each?.(st); step(world, c, st); } return st; };

describe('whole shifts', () => {
  test('AI controllers run a 20-minute Heathrow morning without an incident', () => {
    const c = cfg();
    const st = run(createShift(world, c), c);
    expect(st.ended).toBe('time');
    expect(st.stats.landed).toBeGreaterThan(2);
    expect(st.stats.departed).toBeGreaterThan(2);
    expect(st.events.filter(e => e.kind === 'collision')).toHaveLength(0);
  });

  test('golden replay: seed + command log reproduce the same final state', () => {
    // A simple Tower bot: clear everything that is ready and spaced.
    const c = cfg({ coverage: ['EGLL:TWR'], durationS: 12 * 60 });
    const bot = (st: State) => {
      if (st.tick % 8) return;
      for (const ac of st.aircraft) {
        if (ac.owner !== 'EGLL:TWR' || !ac.checkedIn || ac.freq !== ac.owner) continue;
        if (ac.phase === 'final' && !ac.cleared.land && !st.aircraft.some(o => o.onGround && o.phase === 'landing')) issue(world, st, [{ cs: ac.cs, verb: 'land', runway: ac.runway! }]);
        if (ac.phase === 'holding' && !ac.cleared.luw && !st.aircraft.some(o => o.phase === 'lineup' || o.phase === 'lined')) issue(world, st, [{ cs: ac.cs, verb: 'luw', runway: ac.runway! }]);
        if (ac.phase === 'lined' && !ac.cleared.cto && depGap(world, st, ac) === 0) issue(world, st, [{ cs: ac.cs, verb: 'cto', runway: ac.runway! }]);
        if (ac.phase === 'climb' && ac.alt > 2000) issue(world, st, [{ cs: ac.cs, verb: 'contact', seat: 'LON' }]);
        if (ac.phase === 'taxiin') issue(world, st, [{ cs: ac.cs, verb: 'contact', seat: 'GND' }]);
      }
    };
    const st = run(createShift(world, c), c, bot);
    expect(st.cmdLog.length).toBeGreaterThan(5);
    const again = replay(world, c, st.cmdLog, st.tick);
    expect(hashState(again)).toBe(hashState(st));
  });
});

describe('rules', () => {
  test('departure gap: a medium behind a heavy waits 2 minutes, same SID 2 minutes, different SID 1 minute', () => {
    const st = createShift(world, cfg());
    const as = st.apts[0];
    const dep = (wake: 'M' | 'H', sid: string) => ({ kind: 'dep', wake, sid, runway: as.dep[0], cs: 'X1', apt: 'EGLL' }) as never;
    as.lastDep[as.dep[0]] = { cs: 'L1', wake: 'H', sid: 'CPT5K', at: st.tick };
    expect(depGap(world, st, dep('M', 'MODMI1J'))).toBe(120);
    expect(depGap(world, st, dep('H', 'UMLAT1G'))).toBe(60);
    expect(depGap(world, st, dep('H', 'CPT5K'))).toBe(120);
    st.tick += 4 * 90;
    expect(depGap(world, st, dep('M', 'UMLAT1G'))).toBe(30);
  });

  test('readback errors: a wrong readback is caught with "negative", or counted if missed', () => {
    const c = cfg({ coverage: ['EGLL:DIR', 'EGLL:LON'], difficulty: { ...DIFFICULTY.standard, readbackErrors: 1, emergencies: 0 } });
    const st = createShift(world, c);
    while (!st.aircraft.some(a => !a.onGround && st.coverage.includes(a.freq) && a.checkedIn)) step(world, c, st);
    const ac = st.aircraft.find(a => !a.onGround && st.coverage.includes(a.freq) && a.checkedIn)!;
    expect(issue(world, st, [{ cs: ac.cs, verb: 'heading', hdg: 180 }])).toBeNull();
    for (let i = 0; i < 20; i++) step(world, c, st);
    expect(find(st, ac.cs)!.rbErr).not.toBeNull();
    expect(find(st, ac.cs)!.tgtHdg).not.toBe(180);
    expect(issue(world, st, [{ cs: ac.cs, verb: 'negative' }])).toBeNull();
    for (let i = 0; i < 20; i++) step(world, c, st);
    expect(find(st, ac.cs)!.tgtHdg).toBe(180);
    expect(st.stats.readbackCaught).toBe(1);
  });

  test('loss of separation between two of the player\'s aircraft is counted', () => {
    const c = cfg({ coverage: ['LON', 'EGLL:DIR'] });
    const st = createShift(world, c);
    while (st.aircraft.filter(a => !a.onGround).length < 2) step(world, c, st);
    const [a, b] = st.aircraft.filter(a => !a.onGround);
    // Put them nose to nose at the same level, 2 nm apart, far from the airport.
    Object.assign(a, { x: 60000, y: 60000, alt: 15000, tgtAlt: 15000, hdg: 90, owner: 'LON', freq: 'LON', checkedIn: true, nav: { ...a.nav, mode: 'hdg', route: [] }, tgtHdg: 90 });
    Object.assign(b, { x: 63700, y: 60000, alt: 15000, tgtAlt: 15000, hdg: 270, owner: 'LON', freq: 'LON', checkedIn: true, nav: { ...b.nav, mode: 'hdg', route: [] }, tgtHdg: 270 });
    for (let i = 0; i < 8; i++) step(world, c, st);
    expect(st.stats.sepLoss).toBeGreaterThan(0);
    expect(debrief(st).safety).toBeLessThan(1);
  });
});

describe('holding', () => {
  test('from any direction the entry (direct, teardrop, parallel) settles onto the racetrack the scope draws', () => {
    const c = cfg({ coverage: ['LON', 'EGLL:DIR', 'EGLL:TWR', 'EGLL:GND', 'EGLL:DEL'], durationS: 3600 });
    const sk = pack.airspace.stacks.find(s => s.name === 'BNN')!, fix = world.primary.fixes[sk.fix];
    const entries = new Set<string>();
    for (const from of [0, 90, 180]) {
      const st = createShift(world, c);
      while (!st.aircraft.some(a => !a.onGround && a.kind === 'arr')) step(world, c, st);
      const ac = st.aircraft.find(a => !a.onGround && a.kind === 'arr')!;
      st.aircraft = [ac];
      const p = geo.fromBearing(fix, from, 12 * geo.NM);
      Object.assign(ac, { x: p.x, y: p.y, hdg: geo.bearing(p, fix), alt: 8000, tgtAlt: 8000, ias: 220, tgtSpd: 220, phase: 'stack', owner: 'EGLL:DIR', freq: 'EGLL:DIR', checkedIn: true, turn: null, tgtHdg: null });
      ac.nav = { ...ac.nav, mode: 'hold', route: [], ils: undefined, established: false, hold: { fix: sk.fix, inbound: sk.inboundTrack, turn: sk.turn, leg: 'entry', t: 0 } };
      let worst = 0, first = '';
      for (let i = 0; i < 4 * 900; i++) {
        step(world, c, st);
        if (!first && ac.nav.hold!.leg !== 'entry') entries.add(first = ac.nav.hold!.leg);
        if (i < 4 * 660) continue;
        const h = ac.nav.hold!, loop = geo.racetrack(fix, h.inbound, h.turn, { r: h.r!, leg: h.len! }, 64);
        worst = Math.max(worst, Math.min(...loop.map((q, k) => geo.segDist(ac, q, loop[(k + 1) % loop.length]).d)));
      }
      expect(worst / geo.NM).toBeLessThan(0.25);
    }
    expect([...entries].sort()).toEqual(['outbound', 'parallel', 'teardrop']);
  });
});

describe('separation alerts', () => {
  const NM = geo.NM;
  /** Two airborne aircraft placed by hand, owned by the player's Director. */
  const pair = (over: [Partial<State['aircraft'][number]>, Partial<State['aircraft'][number]>]) => {
    const c = cfg({ coverage: ['EGLL:DIR', 'LON'] });
    const st = createShift(world, c);
    while (st.aircraft.filter(a => !a.onGround && a.kind === 'arr').length < 2) step(world, c, st);
    const [a, b] = st.aircraft.filter(a => !a.onGround && a.kind === 'arr');
    st.aircraft = [a, b];
    for (const [ac, o] of [[a, over[0]], [b, over[1]]] as const) Object.assign(ac, { owner: 'EGLL:DIR', freq: 'EGLL:DIR', checkedIn: true, turn: null, vs: 0, tgtSpd: null, runway: '27R', vectors: null, emergency: null, ...o });
    return { st, a, b };
  };
  const nav = (o: Partial<State['aircraft'][number]['nav']>) => ({ mode: 'hdg', route: [], established: false, gs: false, ...o }) as State['aircraft'][number]['nav'];

  test('two in the same hold at the same level, moving apart: a caution, not a loss', () => {
    const sk = pack.airspace.stacks.find(s => s.name === 'BNN')!, f = world.primary.fixes[sk.fix];
    const hold = (leg: 'inbound' | 'outbound') => nav({ mode: 'hold', hold: { fix: sk.fix, inbound: sk.inboundTrack, turn: sk.turn, leg, t: 0 } });
    const p = geo.fromBearing(f, sk.inboundTrack + 180, 1.35 * NM), q = geo.fromBearing(f, sk.inboundTrack, 1.35 * NM);
    const { st, a, b } = pair([
      { x: p.x, y: p.y, alt: 8000, tgtAlt: 8000, hdg: sk.inboundTrack + 180, trk: sk.inboundTrack + 180, gs: 220, phase: 'stack', nav: hold('outbound') },
      { x: q.x, y: q.y, alt: 8000, tgtAlt: 8000, hdg: sk.inboundTrack, trk: sk.inboundTrack, gs: 220, phase: 'stack', nav: hold('inbound') },
    ]);
    separation(world, st);
    expect(Object.values(st.stca)).toEqual(['caution']);
    expect(st.stats.sepLoss).toBe(0);
    expect(a.alert).toBe('caution'); expect(b.alert).toBe('caution');
  });

  test('two arrivals overlapping on final, low and close in: a red alert; closing inside wake spacing: a caution', () => {
    const e = world.primary.ends['27R'];
    const fin = (nm: number, alt: number) => { const p = pointOnEnd(e, e.thrS - nm * NM); return { x: p.x, y: p.y, alt, tgtAlt: 3000, hdg: e.hdgTrue, trk: e.hdgTrue, gs: 150, phase: 'final' as const, nav: nav({ ils: '27R', established: true, gs: true }) }; };
    let { st } = pair([fin(4, 1300), fin(4.6, 1450)]);
    separation(world, st);
    expect(Object.values(st.stca)).toContain('conflict');
    expect(st.stats.sepLoss).toBe(1);
    ({ st } = pair([fin(4, 1300), fin(6, 1900)]));
    separation(world, st);
    expect(Object.entries(st.stca)).toEqual([[expect.stringMatching(/\|w$/), 'caution']]);
    expect(st.stats.sepLoss).toBe(0);
  });

  test('prediction follows the ILS join: one turning onto the localizer is no conflict with one on final 4.5 nm behind', () => {
    const e = world.primary.ends['27R'];
    const base = pointOnEnd(e, e.thrS - 8 * NM, 2 * NM), fin = pointOnEnd(e, e.thrS - 12.5 * NM);
    const toCl = geo.bearing(base, pointOnEnd(e, e.thrS - 8 * NM)); // straight at the centreline
    const { st, a, b } = pair([
      { x: base.x, y: base.y, alt: 4000, tgtAlt: 4000, hdg: toCl, trk: toCl, gs: 210, ias: 210, phase: 'approach', nav: nav({ ils: '27R' }), tgtHdg: toCl },
      { x: fin.x, y: fin.y, alt: 4000, tgtAlt: 3000, hdg: e.hdgTrue, trk: e.hdgTrue, gs: 180, ias: 180, phase: 'final', nav: nav({ ils: '27R', established: true }) },
    ]);
    // Straight on, as the old prediction assumed, they would pass inside 3 nm within two minutes...
    const straight = (ac: typeof a, t: number) => geo.fromBearing(ac, ac.trk, ac.gs * NM / 3600 * t);
    expect(Math.min(...[10, 20, 30, 40, 50, 60].map(t => geo.dist(straight(a, t), straight(b, t))))).toBeLessThan(3 * NM);
    // ...but it turns onto the localizer ahead of the other.
    const pa = project(world, a, 120, 10);
    expect(Math.abs(geo.angleDiff(geo.bearing(pa[10], pa[11]), e.hdgTrue))).toBeLessThan(10);
    separation(world, st);
    expect(st.stca).toEqual({});
  });

  test('stack levels: an inbound never gets a level someone is still holding at', () => {
    const sk = pack.airspace.stacks.find(s => s.name === 'BNN')!, f = world.primary.fixes[sk.fix];
    const far = geo.fromBearing(f, 0, 40 * NM);
    const { st, a, b } = pair([
      { x: f.x, y: f.y, alt: 8000, tgtAlt: 8000, phase: 'stack', stack: 'BNN', nav: nav({ mode: 'hold', hold: { fix: sk.fix, inbound: sk.inboundTrack, turn: sk.turn, leg: 'inbound', t: 0 } }) },
      { x: far.x, y: far.y, alt: 15000, tgtAlt: 15000, phase: 'arrival', stack: 'BNN', nav: nav({ mode: 'route', route: [sk.fix] }) },
    ]);
    expect(stackLevel(world, st, a)).toBe(7000);
    expect(stackLevel(world, st, b)).toBe(9000); // its rank says 8000, but the one holding hasn't left 8000
  });
});

test('two departures on top of each other at one holding point: one of them can still line up', () => {
  const c = cfg({ coverage: ['EGLL:TWR'] }); // nobody lines them up
  const st = createShift(world, c);
  for (let i = 0; i < 4 * 1800 && st.aircraft.filter(a => a.kind === 'dep' && a.phase === 'holding').length < 2; i++) step(world, c, st);
  const [a, b] = st.aircraft.filter(a => a.kind === 'dep' && a.phase === 'holding');
  const n = world.primary.nodes.find(n => n.hold === 'NB2E')!; // where it happened: its line-up path starts right next to it
  for (const ac of [a, b]) Object.assign(ac, { x: n.x, y: n.y, path: [n.id], pi: 1, runway: '27L' });
  st.aircraft = [a, b];
  expect([lineupBlocked(world, st, a), lineupBlocked(world, st, b)].sort()).toEqual([false, true]);
});

test('taxiing aircraft never sit waiting on each other: one reserving nodes ahead of another that pulled in front, or two meeting at a merge', () => {
  const dec: DayPack = JSON.parse(readFileSync(new URL('../../../data/days/EGLL-2025-12-17.json', import.meta.url), 'utf8'));
  const c = cfg({ days: [dec], start: Date.parse('2025-12-17T14:00:00Z') / 1000, durationS: 40 * 60, traffic: 1 });
  let stuck = 0;
  run(createShift(world, c), c, st => {
    for (const a of st.aircraft) if (a.onGround && a.stoppedS > 60 && a.blockedBy && find(st, a.blockedBy)?.blockedBy === a.cs) stuck++;
  });
  expect(stuck / 4).toBeLessThan(30); // aircraft-seconds; this was about 300 before
});

test('stand sizes: an aircraft fits a stand built for its wake category or larger', () => {
  expect(['L', 'M', 'H', 'J'].map(w => standFits('H', w))).toEqual([true, true, true, false]);
  expect(['L', 'M', 'H', 'J'].map(w => standFits('L', w))).toEqual([true, false, false, false]);
  expect(standFits('J', 'J')).toBe(true);
});

test("the player's taxi clearances take the shortest route; only AI ground controllers route round oncoming traffic", () => {
  const c = cfg({ coverage: ['EGLL:GND', 'EGLL:DEL'] });
  const st = createShift(world, c);
  while (!st.aircraft.some(a => a.kind === 'dep' && a.onGround)) step(world, c, st);
  const ac = st.aircraft.find(a => a.kind === 'dep' && a.onGround)!, apt = world.primary;
  const s = apt.standByRef[ac.stand!];
  Object.assign(ac, { phase: 'pushed', x: apt.nodes[s.pushNode].x, y: apt.nodes[s.pushNode].y, path: [s.pushNode], pi: 0, owner: 'EGLL:GND', freq: 'EGLL:GND', checkedIn: true, cleared: { ...ac.cleared, dl: true, push: true } });
  const goal = taxiTarget(world, ac, ac.runway!)!, shortest = route(apt, s.pushNode, goal)!;
  // Someone (AI-worked) coming the other way along that whole route.
  const o = { ...st.aircraft.find(a => a !== ac)!, cs: 'ONCOMING', phase: 'taxi' as const, onGround: true, owner: 'EGLL:TWR', path: [...shortest].reverse(), pi: 1 };
  st.aircraft = [ac, o];
  expect(issue(world, st, [{ cs: ac.cs, verb: 'taxi', to: ac.runway!, via: [] }])).toBeNull();
  const sent = st.pending.flatMap(q => q.cs === ac.cs ? q.apply ?? [] : []).find(x => x.verb === 'taxi') as { nodes: number[] };
  expect(sent.nodes).toEqual(shortest);
  expect(route(apt, s.pushNode, goal, { penalty: flowPenalty(st, apt, ac) })).not.toEqual(shortest); // what the AI would do
});
