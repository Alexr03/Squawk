import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { buildWorld, createShift, debrief, depGap, DIFFICULTY, geo, hashState, issue, replay, step, find, type AirportPack, type DayPack, type ShiftConfig, type State } from './index.ts';

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
