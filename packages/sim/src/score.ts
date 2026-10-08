// End-of-shift debrief: safety multiplies, efficiency ranks, throughput and radio discipline add bonuses.
import type { ScoreEvent, State } from './state.ts';

export interface Debrief {
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  score: number;
  safety: number;          // multiplier 0..1
  efficiency: number;      // 0..100
  throughput: number;      // bonus points
  radio: number;           // bonus points
  movements: number;
  perHour: number;
  incident: boolean;
  stats: State['stats'];
  worst: ScoreEvent[];     // worst moments, for the replay timeline
  notes: string[];
}

export function debrief(st: State): Debrief {
  const s = st.stats;
  const hours = Math.max(0.25, st.tick / 4 / 3600);
  const movements = s.landed + s.departed;
  const incident = st.ended === 'incident';
  // Only a crash zeroes the shift; close calls cost score, gently enough that one bad moment does not sink everything.
  const safety = incident ? 0 : Math.max(0.2, 1 - 0.1 * s.sepLoss - 0.12 * s.runwayLoss - 0.12 * s.incursions - 0.04 * s.wakeInf - 0.05 * s.readbackMissed);
  // Efficiency: average delay per movement and wasted holding, against a generous baseline.
  // Aircraft the player left waiting count too, not only the ones that got away late.
  const now = st.start + st.tick / 4;
  const waiting = st.aircraft.filter(a => st.coverage.includes(a.owner) && now - a.sched > 180);
  const waitS = waiting.reduce((t, a) => t + now - a.sched - 180, 0);
  const delayPerMove = (s.depDelayS + s.arrDelayS + waitS) / 60 / Math.max(1, movements + waiting.length);
  const efficiency = Math.max(0, Math.min(100, 100 - delayPerMove * 6 - (s.holdS / 60 / Math.max(1, s.landed)) * 3 - s.goArounds * 4 - s.extraTrackNm * 0.2));
  const perHour = movements / hours;
  const throughput = Math.round(Math.min(40, perHour * 0.6));
  const radio = Math.max(0, 20 - s.lateHandoffs * 3 - s.earlyHandoffs * 2 - s.unanswered * 3 - s.congestedS / 60 * 2 - s.badRt + s.readbackCaught * 2);
  const score = Math.round((efficiency * 10 + throughput * 10 + radio * 10) * safety);
  const clean = s.sepLoss + s.runwayLoss + s.incursions + s.readbackMissed === 0;
  // Top grades need traffic actually moved: at least one movement per 10 minutes when there was work to do.
  const idle = movements < Math.max(1, Math.floor(st.tick / 4 / 600)) && (waiting.length > 0 || s.unanswered > 0);
  const grade = incident ? 'D' : idle ? (efficiency >= 55 ? 'C' : 'D') : clean && efficiency >= 85 && s.wakeInf === 0 && s.goArounds === 0 ? 'S' : safety >= 0.9 && efficiency >= 70 ? 'A' : safety >= 0.7 && efficiency >= 55 ? 'B' : safety >= 0.45 ? 'C' : 'D';
  const worst = [...st.events].sort((a, b) => b.severity - a.severity || a.tick - b.tick).slice(0, 8).sort((a, b) => a.tick - b.tick);
  const notes: string[] = [];
  if (s.sepLoss) notes.push(`${s.sepLoss} loss${s.sepLoss > 1 ? 'es' : ''} of separation in the air`);
  if (s.runwayLoss) notes.push(`${s.runwayLoss} runway occupancy loss${s.runwayLoss > 1 ? 'es' : ''}`);
  if (s.wakeInf) notes.push(`${s.wakeInf} wake or departure spacing infringement${s.wakeInf > 1 ? 's' : ''}`);
  if (s.readbackMissed) notes.push(`${s.readbackMissed} readback error${s.readbackMissed > 1 ? 's' : ''} missed`);
  if (s.readbackCaught) notes.push(`${s.readbackCaught} readback error${s.readbackCaught > 1 ? 's' : ''} caught — good ears`);
  if (s.goArounds) notes.push(`${s.goArounds} go-around${s.goArounds > 1 ? 's' : ''}`);
  if (s.lateHandoffs) notes.push(`${s.lateHandoffs} late handoff${s.lateHandoffs > 1 ? 's' : ''}`);
  if (s.unanswered) notes.push(`${s.unanswered} pilot request${s.unanswered > 1 ? 's' : ''} left unanswered`);
  const airborne = st.aircraft.filter(a => a.emergency && !a.onGround).length;
  if (s.emergencies) notes.push(`${s.emergenciesHandled}/${s.emergencies} emergencies landed safely${airborne ? ` (${airborne} still airborne at handover)` : ''}`);
  if (idle) notes.push('Traffic was left waiting: keep things moving for a better grade');
  else if (waiting.length) notes.push(`${waiting.length} aircraft still waiting on you at handover`);
  if (!notes.length) notes.push('A clean, quiet shift.');
  return { grade, score, safety, efficiency: Math.round(efficiency), throughput, radio: Math.round(radio), movements, perHour: Math.round(perHour), incident, stats: s, worst, notes };
}
