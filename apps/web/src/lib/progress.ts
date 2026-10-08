// Career progress, personal bests and daily-challenge results, kept in localStorage.
export interface Progress {
  ratings: string[];                       // career ratings earned
  passed: Record<string, { grade: string; score: number; at: number }>; // career shift id -> best
  bests: Record<string, number>;           // mode key -> best score
  daily: Record<string, { score: number; grade: string }>; // yyyy-mm-dd -> result
  shifts: number;
}
const KEY = 'squawk.progress';
export function loadProgress(): Progress {
  try { return { ratings: [], passed: {}, bests: {}, daily: {}, shifts: 0, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; }
  catch { return { ratings: [], passed: {}, bests: {}, daily: {}, shifts: 0 }; }
}
export function saveProgress(p: Progress) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ } }

const GRADES = ['D', 'C', 'B', 'A', 'S'];
export const gradeAtLeast = (g: string, min: string) => GRADES.indexOf(g) >= GRADES.indexOf(min);
