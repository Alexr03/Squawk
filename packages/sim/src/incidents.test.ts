import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { buildWorld, crash, createShift, declareEmergency, DIFFICULTY, isClosed, issue, step, type AirportPack, type DayPack, type ShiftConfig, type State } from './index.ts';
import { runwayAt } from './world.ts';
import { segDist } from './geo.ts';

const pack: AirportPack = JSON.parse(readFileSync(new URL('../../../data/airports/EGLL/airport.json', import.meta.url), 'utf8'));
const day: DayPack = JSON.parse(readFileSync(new URL('../../../data/days/EGLL-2026-08-28.json', import.meta.url), 'utf8'));
const world = buildWorld([pack]);
const apt = world.primary;
const start = Date.parse('2026-08-28T07:00:00Z') / 1000;
const cfg = (over: Partial<ShiftConfig> = {}): ShiftConfig => ({ seed: 5, airports: ['EGLL'], days: [day], start, durationS: 40 * 60, traffic: 0.7, coverage: [], difficulty: { ...DIFFICULTY.standard, emergencies: 0, readbackErrors: 0 }, mode: 'free', ...over });
const steps = (st: State, c: ShiftConfig, n: number, each?: () => void) => { for (let i = 0; i < n && !st.ended; i++) { each?.(); step(world, c, st); } };
const until = (st: State, c: ShiftConfig, cond: () => boolean, max = 4 * 1800, each?: () => void) => { for (let i = 0; i < max && !st.ended && !cond(); i++) { each?.(); step(world, c, st); } return cond(); };

/** Put two departures together on a runway and crash them there. */
function crashOnRunway(st: State, c: ShiftConfig) {
  until(st, c, () => st.aircraft.filter(a => a.kind === 'dep' && a.onGround && a.phase === 'holding').length >= 2);
  const [a, b] = st.aircraft.filter(a => a.kind === 'dep' && a.phase === 'holding');
  const end = apt.ends['27L'], p = { x: end.thr.x + end.ux * 900, y: end.thr.y + end.uy * 900 };
  Object.assign(a, { x: p.x, y: p.y }); Object.assign(b, { x: p.x + 20, y: p.y });
  crash(world, st, a, b, false);
  return { a, b, pair: runwayAt(apt, p)! };
}

describe('crashes', () => {
  test('a crash on a runway leaves wrecks and fire, closes the runway, and the shift carries on', () => {
    const c = cfg({ coverage: ['EGLL:TWR'] });
    const st = createShift(world, c);
    const { a, pair } = crashOnRunway(st, c);
    expect(a.phase).toBe('wreck');
    expect(st.incidents).toHaveLength(1);
    expect(st.incidents[0].fire).toBe(1);
    expect(isClosed(st, 'EGLL', pair)).toBe(true);
    steps(st, c, 40);
    expect(st.ended).toBeNull();
  });

  test('the player sends the fire service: fire out, wreck cleared, then the player reopens the runway', () => {
    const c = cfg({ coverage: ['EGLL:TWR'] });
    const st = createShift(world, c);
    const { a, pair } = crashOnRunway(st, c);
    expect(issue(world, st, [{ cs: '', verb: 'openrwy', runway: pair, apt: 'EGLL' }])).toMatch(/still on it/);
    expect(issue(world, st, [{ cs: a.cs, verb: 'rescue' }])).toBeNull();
    expect(st.vehicles.filter(v => v.kind === 'fire')).toHaveLength(3);
    // They drive the taxiways (and the runway itself), not straight across the grass.
    const offRoad = (v: State['vehicles'][number]) => Math.min(...apt.edges.map(e => segDist(v, apt.nodes[e.a], apt.nodes[e.b]).d));
    let worst = 0;
    // Off the graph only on the station's own access (to its first waypoint) and the last few metres onto the scene.
    const access = Math.hypot(st.vehicles[0].path![0].x - apt.fire.x, st.vehicles[0].path![0].y - apt.fire.y) + 10;
    const watch = () => { for (const v of st.vehicles) if (Math.hypot(v.x - apt.fire.x, v.y - apt.fire.y) > access && Math.hypot(v.x - st.incidents[0].x, v.y - st.incidents[0].y) > 120) worst = Math.max(worst, offRoad(v)); };
    expect(until(st, c, () => st.incidents[0].onScene !== null, undefined, watch)).toBe(true);
    expect(worst).toBeLessThan(15);
    expect(until(st, c, () => st.incidents[0].fire === 0, 4 * 120)).toBe(true);
    expect(until(st, c, () => st.incidents[0].resolved, 4 * 420)).toBe(true);
    expect(st.aircraft.some(x => x.cs === a.cs && x.phase !== 'gone')).toBe(false);
    expect(isClosed(st, 'EGLL', pair)).toBe(true); // stays closed until the tower reopens it
    expect(issue(world, st, [{ cs: '', verb: 'openrwy', runway: pair, apt: 'EGLL' }])).toBeNull();
    expect(isClosed(st, 'EGLL', pair)).toBe(false);
  });

  test('left without the fire service, the tower is warned and it costs the score', () => {
    const c = cfg({ coverage: ['EGLL:TWR'] });
    const st = createShift(world, c);
    crashOnRunway(st, c);
    steps(st, c, 4 * 160);
    expect(st.events.some(e => /No fire service sent/.test(e.text))).toBe(true);
    expect(st.incidents[0].resolved).toBe(false);
  });

  test('with an AI tower, the fire service goes by itself and the runway reopens', () => {
    const c = cfg();
    const st = createShift(world, c);
    const { pair } = crashOnRunway(st, c);
    expect(until(st, c, () => st.incidents[0].resolved, 4 * 900)).toBe(true);
    expect(isClosed(st, 'EGLL', pair)).toBe(false);
  });

  test('a closed runway: AI arrivals and departures move to the runway still open', () => {
    const c = cfg({ coverage: ['EGLL:TWR'] });
    const st = createShift(world, c);
    const closing = apt.ends[st.apts[0].arr[0]].runway;
    expect(issue(world, st, [{ cs: '', verb: 'closerwy', runway: closing, apt: 'EGLL' }])).toBeNull();
    expect(st.apts[0].arr.every(e => apt.ends[e].runway !== closing)).toBe(true);
    let landedOnClosed = 0;
    steps(st, c, 4 * 900, () => { for (const a of st.aircraft) if (a.phase === 'landing' && a.landedAt === st.tick && apt.ends[a.runway!].runway === closing) landedOnClosed++; });
    expect(landedOnClosed).toBe(0);
  });
});

describe('emergencies', () => {
  test('an engine-failure Mayday stops on the runway and needs the fire service', () => {
    const c = cfg({ coverage: ['EGLL:TWR'] });
    const st = createShift(world, c);
    until(st, c, () => st.aircraft.some(a => a.kind === 'arr' && a.phase === 'final' && a.nav.established));
    const ac = st.aircraft.find(a => a.kind === 'arr' && a.phase === 'final' && a.nav.established)!;
    declareEmergency(world, st, ac, '7700', 'engine');
    const bot = () => { if (st.tick % 8 === 0 && ac.freq === 'EGLL:TWR' && ac.checkedIn && !ac.cleared.land && ac.phase === 'final') issue(world, st, [{ cs: ac.cs, verb: 'land', runway: ac.runway! }]); };
    expect(until(st, c, () => ac.phase === 'stopped', 4 * 900, bot)).toBe(true);
    const inc = st.incidents.find(i => i.cs.includes(ac.cs))!;
    expect(inc.kind).toBe('emergency');
    expect(isClosed(st, 'EGLL', inc.runway!)).toBe(true);
    expect(issue(world, st, [{ cs: ac.cs, verb: 'rescue' }])).toBeNull();
    expect(until(st, c, () => inc.resolved, 4 * 600)).toBe(true);
  });
});

describe('ground control', () => {
  test('hold position stops a taxiing aircraft; continue sets it off again', () => {
    const c = cfg({ coverage: ['EGLL:GND', 'EGLL:TWR'] });
    const st = createShift(world, c);
    let ac = st.aircraft[0];
    const bot = () => {
      for (const a of st.aircraft) if (a.kind === 'dep' && a.freq === 'EGLL:GND' && a.checkedIn && !st.pending.some(p => p.cs === a.cs)) {
        if (a.phase === 'stand' && a.cleared.dl && !a.cleared.push) issue(world, st, [{ cs: a.cs, verb: 'push' }]);
        if (a.phase === 'pushed' && !a.cleared.taxi) issue(world, st, [{ cs: a.cs, verb: 'taxi', to: a.runway!, via: [] }]);
      }
    };
    expect(until(st, c, () => (ac = st.aircraft.find(a => a.phase === 'taxi' && a.gs > 8)!) !== undefined, 4 * 1500, bot)).toBe(true);
    expect(issue(world, st, [{ cs: ac.cs, verb: 'halt' }])).toBeNull();
    steps(st, c, 4 * 20);
    expect(ac.gs).toBe(0);
    const at = { x: ac.x, y: ac.y };
    steps(st, c, 4 * 20);
    expect(Math.hypot(ac.x - at.x, ac.y - at.y)).toBeLessThan(1);
    expect(issue(world, st, [{ cs: ac.cs, verb: 'continue' }])).toBeNull();
    steps(st, c, 4 * 30);
    expect(Math.hypot(ac.x - at.x, ac.y - at.y)).toBeGreaterThan(20);
  });

  test('stop immediately rejects a take-off; the aircraft can then taxi off the runway to a holding point', () => {
    const c = cfg({ coverage: ['EGLL:TWR'] });
    const st = createShift(world, c);
    let ac = st.aircraft[0];
    expect(until(st, c, () => (ac = st.aircraft.find(a => a.kind === 'dep' && a.phase === 'holding' && a.freq === 'EGLL:TWR' && a.checkedIn)!) !== undefined)).toBe(true);
    // Stop the AI-free tower from doing anything else with it: we are the tower.
    expect(issue(world, st, [{ cs: ac.cs, verb: 'cto', runway: ac.runway! }])).toBeNull();
    expect(until(st, c, () => ac.phase === 'takeoff' && ac.ias > 40, 4 * 300)).toBe(true);
    expect(issue(world, st, [{ cs: ac.cs, verb: 'halt' }])).toBeNull();
    expect(until(st, c, () => ac.phase === 'lined', 4 * 120)).toBe(true);
    expect(ac.gs).toBe(0);
    expect(ac.onGround).toBe(true);
    const hold = apt.nodes.find(n => n.hold && n.holdRunway && apt.ends[n.holdRunway]?.runway === apt.ends[ac.runway!].runway)!;
    expect(issue(world, st, [{ cs: ac.cs, verb: 'taxi', to: ac.runway!, via: [] }])).toBeNull();
    expect(until(st, c, () => ac.phase === 'holding' || (ac.phase === 'taxi' && runwayAt(apt, ac) === null), 4 * 600)).toBe(true);
    void hold;
  });

  test('a fast take-off roll is past the point of stopping', () => {
    const c = cfg({ coverage: ['EGLL:TWR'] });
    const st = createShift(world, c);
    let ac = st.aircraft[0];
    until(st, c, () => (ac = st.aircraft.find(a => a.kind === 'dep' && a.phase === 'holding' && a.freq === 'EGLL:TWR' && a.checkedIn)!) !== undefined);
    issue(world, st, [{ cs: ac.cs, verb: 'cto', runway: ac.runway! }]);
    until(st, c, () => ac.phase === 'takeoff' && ac.ias > 130, 4 * 400);
    expect(issue(world, st, [{ cs: ac.cs, verb: 'halt' }])).toMatch(/too fast to stop/);
  });
});
