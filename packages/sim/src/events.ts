// Events that shape a shift: emergencies (7700/7600), runway closures with fire crews, runway configuration changes.
import { dist, NM } from './geo.ts';
import { aptOf, aptState, elevation } from './physics.ts';
import { goAround, pilotCall } from './pilot.ts';
import { event } from './rules.ts';
import { DT, pick, rand, seatId, ticks, type Aircraft, type State } from './state.ts';
import type { Nature } from './types.ts';
import { chooseConfig } from './weather.ts';
import { finalPoint, type World } from './world.ts';

export function scheduleNextEmergency(st: State) {
  const perHour = st.difficulty.emergencies;
  st.nextEmergencyAt = perHour > 0 ? st.tick + ticks(Math.max(600, -Math.log(1 - rand(st)) * 3600 / perHour)) : Number.MAX_SAFE_INTEGER;
}

export function emergencies(world: World, st: State) {
  if (st.tick < st.nextEmergencyAt) return;
  scheduleNextEmergency(st);
  // Prefer aircraft the player is working.
  const cands = st.aircraft.filter(a => !a.emergency && !a.onGround && (a.phase === 'arrival' || a.phase === 'stack' || (a.phase === 'climb' && a.alt > 2500 && a.alt < 9000)));
  const mine = cands.filter(a => st.coverage.includes(a.owner) || st.coverage.some(s => s.endsWith(':TWR')));
  const pool = mine.length ? mine : cands;
  if (!pool.length) return;
  declare(world, st, pick(st, pool));
}

export function declare(world: World, st: State, ac: Aircraft, kind?: '7700' | '7600', nature?: Nature) {
  const radio = kind ? kind === '7600' : rand(st) < 0.15 && ac.kind === 'arr';
  st.stats.emergencies++;
  if (radio) {
    ac.emergency = { code: '7600', nature: 'radio', since: st.tick };
    ac.squawk = '7600';
    event(st, { kind: 'emergency', severity: 1, text: `${ac.cs} squawking 7600: radio failure. Expect it to fly its last clearance; use light signals.`, cs: [ac.cs] });
    return;
  }
  const n: Nature = nature ?? (ac.kind === 'dep' ? pick(st, ['engine', 'birdstrike', 'pressurisation'] as Nature[]) : pick(st, ['engine', 'medical', 'fuel', 'pressurisation'] as Nature[]));
  ac.emergency = { code: '7700', nature: n, since: st.tick };
  ac.squawk = '7700';
  const pan = n === 'medical';
  pilotCall(st, ac, { k: pan ? 'panpan' : 'mayday', nature: n, souls: 80 + Math.floor(rand(st) * 250), intent: ac.kind === 'dep' ? 'request immediate return' : 'request priority landing' });
  event(st, { kind: 'emergency', severity: 1, text: `${pan ? 'PAN PAN' : 'MAYDAY'} ${ac.cs}: ${n}. ${ac.kind === 'dep' ? 'Returning to land.' : 'Priority landing.'}`, cs: [ac.cs] });
  if (ac.kind === 'dep') returnToLand(world, st, ac);
}

/** A departure with a problem turns back: it becomes an arrival for the same airport. */
function returnToLand(world: World, st: State, ac: Aircraft) {
  const as = aptState(st, ac.apt);
  ac.kind = 'arr';
  ac.tgtAlt = Math.min(ac.alt, 4000);
  ac.runway = as.arr[0];
  ac.stack = aptOf(world, ac).pack.airspace.stacks[0]?.name ?? null;
  ac.phase = 'approach';
  ac.nav = { mode: 'hdg', route: [], established: false, gs: false };
  ac.tgtHdg = Math.round(ac.hdg);
  ac.stand = null;
  ac.sched = st.start + st.tick * DT;
}

/** After an emergency landing, fire crews meet the aircraft and the runway closes for an inspection. */
export function emergencyAftermath(world: World, st: State) {
  for (const ac of st.aircraft) {
    if (!ac.emergency || ac.phase !== 'landing' || ac.landedAt !== st.tick - 1) continue;
    const apt = aptOf(world, ac), as = aptState(st, ac.apt);
    const pair = apt.ends[ac.runway!].runway;
    const mins = ac.emergency.nature === 'tyre' || ac.emergency.nature === 'birdstrike' ? 12 : ac.emergency.code === '7700' ? 6 : 0;
    if (mins) {
      as.closed[pair] = st.tick + ticks(mins * 60);
      st.alerts.push({ tick: st.tick, level: 'caution', text: `Runway ${pair} closed for inspection, about ${mins} minutes` });
    }
    for (let i = 0; i < 3; i++) st.vehicles.push({ id: `fire${st.tick}-${i}`, kind: 'fire', x: apt.fire.x + i * 12, y: apt.fire.y, hdg: 0, lights: true, target: { x: ac.x, y: ac.y }, home: { ...apt.fire }, until: st.tick + ticks(mins * 60 || 300) });
  }
  // Vehicles drive straight to their target, wait, then go home.
  for (const v of st.vehicles) {
    const tgt = st.tick < v.until ? v.target! : v.home;
    const d = dist(v, tgt);
    if (d > 3) { const sp = 18 * DT; v.hdg = Math.atan2(tgt.x - v.x, tgt.y - v.y) * 180 / Math.PI; v.x += (tgt.x - v.x) / d * Math.min(sp, d); v.y += (tgt.y - v.y) / d * Math.min(sp, d); }
  }
  st.vehicles = st.vehicles.filter(v => st.tick < v.until || dist(v, v.home) > 3);
}

/** Radio failure: the aircraft flies its last clearance, then makes its own approach. */
export function nordo(world: World, st: State) {
  for (const ac of st.aircraft) {
    if (ac.emergency?.code !== '7600' || ac.onGround) continue;
    const apt = aptOf(world, ac);
    if ((ac.phase === 'stack' && st.tick - ac.emergency.since > ticks(240)) || (ac.phase === 'approach' && !ac.nav.ils)) {
      // Leaves the hold and flies the ILS by itself.
      const end = apt.ends[ac.runway!];
      const fp = finalPoint(end, 12);
      ac.nav = { mode: 'route', route: [], established: false, gs: false, ils: ac.runway! };
      ac.phase = 'approach';
      ac.tgtAlt = 4000;
      ac.tgtHdg = Math.round(Math.atan2(fp.x - ac.x, fp.y - ac.y) * 180 / Math.PI + 360) % 360;
      ac.nav.mode = 'hdg';
      if (dist(ac, fp) < 2 * NM) ac.tgtHdg = Math.round(end.hdgTrue);
    }
  }
}

/** Runway configuration: wind changes and Heathrow's 15:00 alternation. Announced 10 minutes ahead. */
export function runwayConfig(world: World, st: State) {
  if (st.tick % ticks(30) !== 0) return;
  for (const as of st.apts) {
    const apt = world.byIcao[as.icao];
    const want = chooseConfig(apt, st.weather.wind, st.start + st.tick * DT + 600);
    if (want !== as.config && !as.pendingConfig) {
      as.pendingConfig = { config: want, at: st.tick + ticks(600) };
      st.alerts.push({ tick: st.tick, level: 'info', text: `${apt.pack.rtName}: runway change to ${apt.pack.configs[want].name} in 10 minutes` });
    }
    if (as.pendingConfig && st.tick >= as.pendingConfig.at) {
      const c = apt.pack.configs[as.pendingConfig.config];
      as.config = as.pendingConfig.config; as.arr = [...c.arrivals]; as.dep = [...c.departures]; as.pendingConfig = null;
      st.alerts.push({ tick: st.tick, level: 'info', text: `${apt.pack.rtName}: now ${c.name}` });
      // New assignments: arrivals not yet established and departures not yet at the runway move to the new runways.
      for (const ac of st.aircraft) {
        if (ac.apt !== as.icao) continue;
        if (ac.kind === 'arr' && !ac.nav.established && !ac.onGround) { ac.runway = as.arr[0]; if (ac.nav.ils) ac.nav.ils = as.arr[0]; ac.vectors = null; }
        if (ac.kind === 'dep' && ['stand', 'pushing', 'pushed'].includes(ac.phase)) ac.runway = as.dep[0];
      }
    }
    for (const [pair, until] of Object.entries(as.closed)) if (until <= st.tick) { delete as.closed[pair]; st.alerts.push({ tick: st.tick, level: 'info', text: `Runway ${pair} open` }); }
  }
}

/** Unstable or too-close approaches: pilots go around on their own. */
export function approachChecks(world: World, st: State) {
  for (const ac of st.aircraft) {
    if (ac.phase !== 'final' || !ac.nav.established || ac.onGround) continue;
    const apt = aptOf(world, ac), end = apt.ends[ac.runway!];
    const toThr = dist(ac, end.thr) / NM;
    const gsAlt = elevation(apt) + 50 + toThr * NM * Math.tan((end.ils?.gsDeg ?? 3) * Math.PI / 180) * 3.28084;
    if (toThr < 3.5 && ac.alt > gsAlt + 700) {
      event(st, { kind: 'missed-approach', severity: 1, text: `${ac.cs} unstable approach (too high), going around`, cs: [ac.cs] });
      goAround(world, st, ac, true);
    }
    void seatId;
  }
}
