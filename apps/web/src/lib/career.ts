// Career: ratings earned through training shifts and checkrides. Every shift is a real Heathrow day.
import { find, geo, seatRole, type Aircraft, type World } from '@squawk/sim';
import type { Snap } from '../game/client.ts';
import { needs } from '../game/needs.ts';

export interface CareerShift {
  id: string;
  title: string;
  brief: string;
  airport: string;
  day: string;                 // day pack id
  startUtc: string;            // HH:MM UTC
  minutes: number;
  seats: string[];             // roles, e.g. ['TWR']
  traffic: number;
  difficulty: 'casual' | 'standard' | 'realistic';
  emergencies?: number;        // per hour override
  checkride?: { minGrade: string };
  hints?: boolean;
}
export interface Rating { id: string; name: string; summary: string; shifts: CareerShift[] }

const W = 'EGLL-2026-08-28', NIGHT = 'EGLL-2026-01-13', EAST = 'EGLL-2026-07-15', FOG = 'EGLL-2025-12-17';

export const RATINGS: Rating[] = [
  { id: 'trainee', name: 'Trainee', summary: 'Delivery and Ground on a quiet night. Clearances, pushbacks, taxi routes and Follow the Greens.', shifts: [
    { id: 't1', title: 'First clearances', brief: 'You are Heathrow Delivery on a winter night. Departures call you from their stands for their clearance: give each one its SID and squawk, and they move to Ground. Select an aircraft and press C, or right-click it.', airport: 'EGLL', day: NIGHT, startUtc: '05:00', minutes: 15, seats: ['DEL'], traffic: 0.7, difficulty: 'casual', hints: true, emergencies: 0 },
    { id: 't2', title: 'Push and taxi', brief: 'Now you are Heathrow Ground. Approve pushbacks (P), then taxi departures to their holding point (X) and arrivals to their stands. Watch for aircraft nose to nose — re-route one of them.', airport: 'EGLL', day: NIGHT, startUtc: '05:15', minutes: 20, seats: ['GND'], traffic: 0.7, difficulty: 'casual', hints: true, emergencies: 0 },
    { id: 't3', title: 'Follow the greens', brief: 'Arrivals before dawn. Use Follow the Greens (F) to send arrivals to their stands along the lit centreline. You also run Delivery.', airport: 'EGLL', day: NIGHT, startUtc: '04:40', minutes: 20, seats: ['DEL', 'GND'], traffic: 0.8, difficulty: 'casual', hints: true, emergencies: 0 },
    { id: 'tc', title: 'Checkride: night apron', brief: 'Delivery and Ground together at the start of the morning wave. Pass with grade B or better and no safety events.', airport: 'EGLL', day: NIGHT, startUtc: '05:30', minutes: 25, seats: ['DEL', 'GND'], traffic: 0.9, difficulty: 'standard', checkride: { minGrade: 'B' }, emergencies: 0 },
  ] },
  { id: 'tower', name: 'Tower rated', summary: 'Segregated runways: landings on one, departures on the other. Wake gaps, departure order, crossings and the 15:00 swap.', shifts: [
    { id: 'w1', title: 'Two runways', brief: 'Heathrow Tower, westerly. Arrivals land on 27R, departures leave from 27L. Clear arrivals to land (L) once the runway is clear; line departures up (L) and clear them for take-off (T) when the wake/route gap allows.', airport: 'EGLL', day: W, startUtc: '06:00', minutes: 15, seats: ['TWR'], traffic: 0.55, difficulty: 'casual', hints: true, emergencies: 0 },
    { id: 'w2', title: 'Wake and order', brief: 'Busier. The departure queue lets you pick the order: alternate SIDs and avoid putting a medium straight behind a heavy to keep the runway busy.', airport: 'EGLL', day: W, startUtc: '06:30', minutes: 20, seats: ['TWR'], traffic: 0.8, difficulty: 'standard', hints: true, emergencies: 0.5 },
    { id: 'w3', title: 'Ground and Tower', brief: 'You run the whole surface: pushbacks and taxi out to your own runway, arrivals vacating and taxiing in — and the runway crossings in between.', airport: 'EGLL', day: W, startUtc: '07:00', minutes: 25, seats: ['GND', 'TWR'], traffic: 0.7, difficulty: 'standard', hints: true, emergencies: 0.5 },
    { id: 'w4', title: 'The 15:00 swap', brief: 'At 15:00 local the westerly runways swap roles. Plan the changeover: arrivals switch to 27L and departures to 27R.', airport: 'EGLL', day: W, startUtc: '13:42', minutes: 30, seats: ['TWR'], traffic: 0.8, difficulty: 'standard', emergencies: 0.5 },
    { id: 'wc', title: 'Checkride: summer Friday', brief: 'Ground and Tower in the Friday afternoon peak. Grade B or better with no safety events.', airport: 'EGLL', day: W, startUtc: '15:00', minutes: 30, seats: ['GND', 'TWR'], traffic: 0.9, difficulty: 'standard', checkride: { minGrade: 'B' }, emergencies: 1 },
  ] },
  { id: 'director', name: 'Director rated', summary: 'Four stacks, one final. Release from the holds, vector onto the ILS and space arrivals at 2.5–3 nm (more behind heavies).', shifts: [
    { id: 'd1', title: 'Stacks and vectors', brief: 'Heathrow Director. Arrivals hold at BNN, LAM, BIG and OCK. Release them with headings (drag out of a blip, or H), descend (A), slow (S) and clear the ILS (I). Hand them to Tower around 10 nm.', airport: 'EGLL', day: W, startUtc: '06:00', minutes: 20, seats: ['DIR'], traffic: 0.5, difficulty: 'casual', hints: true, emergencies: 0 },
    { id: 'd2', title: 'Sequencing', brief: 'Build one continuous stream from four stacks: about 3 nm between mediums, 5 nm behind a heavy, 6–7 nm behind an A380.', airport: 'EGLL', day: W, startUtc: '06:30', minutes: 25, seats: ['DIR'], traffic: 0.8, difficulty: 'standard', emergencies: 0.5 },
    { id: 'd3', title: 'Easterly', brief: 'The wind has gone round to the east: landings on 09L from the west, the whole pattern mirrored.', airport: 'EGLL', day: EAST, startUtc: '07:00', minutes: 25, seats: ['DIR'], traffic: 0.8, difficulty: 'standard', emergencies: 0.5 },
    { id: 'd4', title: 'Low visibility', brief: 'Fog. Low visibility procedures: 6 nm spacing on final, slower runway occupancy. You also run Tower.', airport: 'EGLL', day: FOG, startUtc: '06:00', minutes: 25, seats: ['DIR', 'TWR'], traffic: 0.8, difficulty: 'standard', emergencies: 0.5 },
    { id: 'dc', title: 'Checkride: the morning wave', brief: 'Director and Tower for the 06:00 arrival wave. Grade B or better with no safety events.', airport: 'EGLL', day: W, startUtc: '05:00', minutes: 30, seats: ['DIR', 'TWR'], traffic: 0.9, difficulty: 'standard', checkride: { minGrade: 'B' }, emergencies: 1 },
  ] },
  { id: 'london', name: 'London Control rated', summary: 'Feeding the stacks from the airways and climbing departures out through them.', shifts: [
    { id: 'l1', title: 'Feeding the stacks', brief: 'London Control. Arrivals enter on their STARs at FL150–FL170: descend them into their stacks without conflicts and hand them to Director.', airport: 'EGLL', day: W, startUtc: '06:00', minutes: 25, seats: ['LON'], traffic: 0.7, difficulty: 'standard', hints: true, emergencies: 0.5 },
    { id: 'l2', title: 'Climbing out', brief: 'Departures from Tower at 6,000 ft: climb them through the arrivals (5 nm or 1,000 ft) and send them on their way. Arrivals still need feeding.', airport: 'EGLL', day: W, startUtc: '07:00', minutes: 25, seats: ['LON'], traffic: 0.9, difficulty: 'standard', emergencies: 0.5 },
    { id: 'lc', title: 'Checkride: the terminal area', brief: 'London Control and Director together. Grade B or better with no safety events.', airport: 'EGLL', day: W, startUtc: '07:00', minutes: 30, seats: ['LON', 'DIR'], traffic: 0.9, difficulty: 'standard', checkride: { minGrade: 'B' }, emergencies: 1 },
  ] },
  { id: 'supervisor', name: 'Supervisor', summary: 'Everything at Heathrow, at the Friday peak, with emergencies stacked together.', shifts: [
    { id: 's1', title: 'Bandboxed', brief: 'Delivery, Ground, Tower and Director at once on a busy morning.', airport: 'EGLL', day: W, startUtc: '07:00', minutes: 30, seats: ['DEL', 'GND', 'TWR', 'DIR'], traffic: 0.6, difficulty: 'standard', emergencies: 1 },
    { id: 'sc', title: 'Final checkride: peak hour', brief: 'All five positions, summer Friday peak, two emergencies an hour. Grade A or better.', airport: 'EGLL', day: W, startUtc: '16:00', minutes: 40, seats: ['DEL', 'GND', 'TWR', 'DIR', 'LON'], traffic: 0.8, difficulty: 'realistic', checkride: { minGrade: 'A' }, emergencies: 2 },
  ] },
];

/** A short tip for the training shifts, based on what's waiting. */
export function coach(world: World, snap: Snap, selected: string | null): string | null {
  const q = needs(world, snap);
  const top = q[0];
  if (!top) return snap.tick < 4 * 90 ? 'Quiet for now. Traffic builds through the shift — watch the strip bay on the left.' : null;
  const ac = find(snap, top.cs) as Aircraft;
  const role = seatRole(ac.owner);
  const sel = selected === ac.cs;
  const pick = sel ? '' : `Select ${ac.cs} (click its strip or press N), then `;
  if (ac.emergency) return `${ac.cs} has declared an emergency. Give it priority: ${role === 'TWR' ? 'keep the runway clear and clear it to land' : 'vector it straight onto the ILS'}.`;
  if (top.text.startsWith('Check the readback')) return `${ac.cs} read back something different from what you said. Check the radio log and press N (Negative, say again) to correct it.`;
  switch (ac.phase) {
    case 'stand': return ac.cleared.dl ? `${pick}press P to approve pushback.` : `${pick}press C to give the departure clearance (SID and squawk).`;
    case 'pushed': return `${pick}press X to taxi to the holding point. The suggested route is drawn: click taxiway points to change it, Enter to send.`;
    case 'taxiin': case 'vacating': return `${pick}press X to taxi to stand ${ac.stand}${snap.weather.lvp || isNight(snap) ? ' — or F to Follow the Greens' : ''}.`;
    case 'holding': return top.text.includes('gap OK') ? `${pick}press L to line up (the wake/route gap is met).` : `${ac.cs} is ready but the departure gap isn't met yet — line up someone else, or wait.`;
    case 'lined': return top.text.includes('gap OK') ? `${pick}press T to clear ${ac.cs} for take-off.` : 'Wait for the gap timer before clearing for take-off.';
    case 'final': return `${pick}press L to clear ${ac.cs} to land — only once the runway is clear.`;
    case 'stack': return `${pick}release it: H for a heading (or drag a line out of the blip), A to descend, then I for the ILS once it's pointing at the final.`;
    case 'approach': return ac.nav.ils ? `${ac.cs} will intercept the localiser. Hand it to Tower (K) inside about 10 nm.` : `${pick}turn it toward the final and press I to clear the ILS.`;
    case 'arrival': return `${pick}descend it (A) toward its stack level and hand it to Director (K) about 20 nm out.`;
    case 'climb': return `${pick}${role === 'TWR' ? 'hand it to London Control (K).' : 'climb it (A) when clear of arrivals.'}`;
  }
  void geo;
  return top.text;
}
const isNight = (snap: Snap) => { const h = new Date((snap.start + snap.tick / 4) * 1000).getUTCHours(); return h >= 19 || h < 6; };

/** Daily challenge: one seeded shift per day, the same for everyone. */
export function dailyShift(date = new Date()): CareerShift & { seed: number; key: string } {
  const key = date.toISOString().slice(0, 10);
  let h = 2166136261; for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const r = (n: number) => { h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; return h % n; };
  const days = [W, EAST, FOG, W, NIGHT];
  const seatsOpts = [['TWR'], ['DIR'], ['GND', 'TWR'], ['DIR', 'TWR'], ['TWR'], ['LON', 'DIR']];
  const starts = ['06:00', '07:00', '11:00', '15:00', '16:30', '05:30'];
  const day = days[r(days.length)];
  return { id: 'daily', key, seed: h | 0, title: `Daily challenge — ${key}`, brief: 'One shift, the same for everyone today. Score counts on the leaderboard.', airport: 'EGLL', day,
    startUtc: day === NIGHT ? '05:00' : starts[r(starts.length)], minutes: 20, seats: seatsOpts[r(seatsOpts.length)], traffic: 0.85, difficulty: 'standard', emergencies: 1 };
}
