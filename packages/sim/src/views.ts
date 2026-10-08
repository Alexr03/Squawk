// Per-frame render views and radar data blocks, built from a state snapshot (main thread).
import type { Aircraft, State } from './state.ts';
import type { AircraftView } from './types.ts';

const RUNWAY_LIGHT_PHASES = new Set(['lineup', 'lined', 'takeoff', 'landing', 'final', 'goaround']);

export function aircraftView(ac: Aircraft, st: State, transitionAlt = 6000): AircraftView {
  const moving = ac.gs > 1;
  const airborneLow = !ac.onGround && ac.alt < 10000;
  const lvl = ac.alt > transitionAlt ? String(Math.round(ac.alt / 100)).padStart(3, '0') : `A${String(Math.round(ac.alt / 100)).padStart(2, '0')}`;
  const cfl = ac.tgtAlt > transitionAlt ? String(Math.round(ac.tgtAlt / 100)).padStart(3, '0') : `A${String(Math.round(ac.tgtAlt / 100)).padStart(2, '0')}`;
  const arrow = ac.vs > 300 ? '↑' : ac.vs < -300 ? '↓' : ' ';
  const tag = ac.onGround
    ? [ac.cs, `${ac.type} ${ac.kind === 'dep' ? ac.sid ?? '' : ac.stand ?? ''}`]
    : [ac.cs + (ac.emergency ? ` ${ac.emergency.code}` : ''), `${lvl}${arrow}${cfl} ${String(Math.round(ac.gs / 10)).padStart(2, '0')}`, `${ac.type} ${ac.kind === 'dep' ? (ac.sid ?? '').replace(/\d.*/, '') : ac.runway ?? ''}`];
  return {
    cs: ac.cs, type: ac.type, operator: ac.operator, wake: ac.wake,
    x: ac.x, y: ac.y, alt: ac.alt, hdg: ac.hdg, gs: ac.gs, vs: ac.vs, onGround: ac.onGround,
    lights: {
      beacon: ac.phase !== 'stand' && ac.phase !== 'parked' || ac.cleared.push,
      nav: true,
      strobe: RUNWAY_LIGHT_PHASES.has(ac.phase) || (!ac.onGround && ac.alt < 18000),
      landing: RUNWAY_LIGHT_PHASES.has(ac.phase) || airborneLow,
      taxi: ac.onGround && moving && !RUNWAY_LIGHT_PHASES.has(ac.phase),
    },
    tug: ac.phase === 'pushing' || ac.towing,
    mine: st.coverage.includes(ac.owner),
    wreck: ac.phase === 'wreck',
    onRunway: ['lineup', 'lined', 'takeoff', 'landing', 'vacating'].includes(ac.phase) || (ac.onGround && ac.gs > 40),
    alert: ac.alert,
    squawk: ac.squawk,
    clearedAlt: ac.onGround ? null : ac.tgtAlt,
    trail: ac.trail,
    tag,
  };
}

export function views(st: State, transitionAlt = 6000): AircraftView[] {
  return st.aircraft.filter(a => a.phase !== 'gone').map(a => aircraftView(a, st, transitionAlt));
}
