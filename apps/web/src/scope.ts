// Placeholder top-down view: runways, final approach and aircraft, drawn on a 2D canvas.
import { RUNWAYS, geom, type Aircraft, type State } from '@squawk/sim';

export interface View { cx: number; cy: number; scale: number } // world metres at centre, px per metre
const NM = 1852;
const C = { bg: '#0b1426', rwy: '#5b6472', line: '#24324d', text: '#8fa3bf', own: '#4ff0b4', sel: '#ffffff', amber: '#ffb020', red: '#ff4d4d' };

export function toScreen(v: View, w: number, h: number, x: number, y: number): [number, number] {
  return [w / 2 + (x - v.cx) * v.scale, h / 2 - (y - v.cy) * v.scale];
}

/** Aircraft positions blended between the previous and current snapshot. */
export function blend(prev: State | null, cur: State, a: number): Aircraft[] {
  return cur.aircraft.map(ac => {
    const p = prev?.aircraft.find(q => q.callsign === ac.callsign);
    return p ? { ...ac, x: p.x + (ac.x - p.x) * a, y: p.y + (ac.y - p.y) * a, alt: p.alt + (ac.alt - p.alt) * a } : ac;
  });
}

export function needsAttention(ac: Aircraft) {
  return ac.phase === 'final' && !ac.cleared && !ac.ga && ac.s > -2 * NM;
}

export function draw(ctx: CanvasRenderingContext2D, v: View, st: State, acs: Aircraft[], selected: string | null) {
  const { width: w, height: h } = ctx.canvas;
  const S = (x: number, y: number) => toScreen(v, w, h, x, y);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.font = '12px ui-monospace, Consolas, monospace';

  for (const r of Object.values(RUNWAYS)) {
    const g = geom(r);
    const [x1, y1] = S(r.thr.x, r.thr.y), [x2, y2] = S(r.end.x, r.end.y);
    // Extended centreline with nm ticks out to 6 nm
    if (r.name === st.arrRwy) {
      ctx.strokeStyle = C.line;
      ctx.setLineDash([6, 6]);
      const [fx, fy] = S(r.thr.x - g.ux * 6 * NM, r.thr.y - g.uy * 6 * NM);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.text;
      for (let n = 1; n <= 6; n++) {
        const [tx, ty] = S(r.thr.x - g.ux * n * NM, r.thr.y - g.uy * n * NM);
        ctx.fillRect(tx - 1, ty - 4, 2, 8);
        ctx.fillText(`${n}`, tx - 3, ty + 16);
      }
    }
    ctx.strokeStyle = C.rwy;
    ctx.lineWidth = Math.max(3, 50 * v.scale);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = C.text;
    const role = r.name === st.arrRwy ? 'ARR' : r.name === st.depRwy ? 'DEP' : '';
    ctx.fillText(`${r.name} ${role}`, x1 + 8, y1 - 8);
    ctx.fillText(`${(+r.name.slice(0, 2) + 18) % 36 || 36}${{ L: 'R', R: 'L' }[r.name[2]] ?? ''}`.padStart(3, '0'), x2 - 34, y2 - 8);
  }

  for (const ac of acs) {
    const [x, y] = S(ac.x, ac.y);
    const col = ac.callsign === selected ? C.sel : needsAttention(ac) ? C.amber : C.own;
    const a = ((ac.hdg - 90) * Math.PI) / 180;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8);
    ctx.lineTo(x + Math.cos(a + 2.5) * 6, y + Math.sin(a + 2.5) * 6);
    ctx.lineTo(x + Math.cos(a - 2.5) * 6, y + Math.sin(a - 2.5) * 6);
    ctx.fill();
    // The holding queue is only metres apart: list its labels upward so they stay readable.
    const dy = ac.phase === 'holding' ? -14 - acs.filter(q => q.phase === 'holding').indexOf(ac) * 14 : -14;
    ctx.fillText(ac.callsign, x + 8, y + dy);
    if (ac.alt > 0 || ac.spd > 0)
      ctx.fillText(`${String(Math.round(ac.alt / 100)).padStart(3, '0')} ${Math.round(ac.spd)} ${ac.wake}`, x + 8, y + dy + 13);
  }
}
