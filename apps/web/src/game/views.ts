// Where the camera goes for each position at an airport: the runways for Tower, the stands for Ground and Delivery, the
// terminal area for the radar seats. Worked out from the airport itself, so every airport frames properly.
import type { Apt } from '@squawk/sim';

export function viewFor(apt: Apt, role: string): { cx: number; cy: number; mpp: number } {
  const o = apt.offset;
  if (role === 'DIR') return { cx: o.x, cy: o.y, mpp: 105 };
  if (role === 'LON') return { cx: o.x, cy: o.y, mpp: 260 };
  if (role === 'TWR') {
    const pts = apt.runways.flatMap(r => [r.a, r.b]);
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * 1.8);
    return { cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2, mpp: Math.max(1.2, Math.min(4.5, span / 1300)) };
  }
  const n = apt.stands.length || 1;
  return { cx: apt.stands.reduce((t, s) => t + s.x, 0) / n, cy: apt.stands.reduce((t, s) => t + s.y, 0) / n, mpp: 1.1 };
}
