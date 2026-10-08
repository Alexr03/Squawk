// Local tangent-plane projection (equirectangular about an origin) and small vector helpers.
import type { LatLon, XY } from './types.ts';

const R = 6371008.8;
const RAD = Math.PI / 180;
export const NM = 1852;
export const FT = 0.3048;
export const KT = NM / 3600; // m/s per knot

export function project(origin: LatLon, p: LatLon): XY {
  return {
    x: (p.lon - origin.lon) * RAD * R * Math.cos(origin.lat * RAD),
    y: (p.lat - origin.lat) * RAD * R,
  };
}
export function unproject(origin: LatLon, p: XY): LatLon {
  return { lat: origin.lat + p.y / R / RAD, lon: origin.lon + p.x / (R * Math.cos(origin.lat * RAD)) / RAD };
}

/** "512839.63N" / "0002559.82W" (AIP DMS) to decimal degrees. */
export function dms(s: string): number {
  const m = s.match(/^(\d{2,3})(\d{2})(\d{2}(?:\.\d+)?)([NSEW])$/);
  if (!m) throw new Error(`bad DMS ${s}`);
  const v = +m[1] + +m[2] / 60 + +m[3] / 3600;
  return m[4] === 'S' || m[4] === 'W' ? -v : v;
}

export const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
/** Bearing from a to b, degrees true (0 = north, clockwise). */
export const bearing = (a: XY, b: XY) => (Math.atan2(b.x - a.x, b.y - a.y) / RAD + 360) % 360;
export const norm360 = (d: number) => ((d % 360) + 360) % 360;
/** Signed smallest turn from a to b in degrees (-180..180, positive = right). */
export const angleDiff = (a: number, b: number) => ((b - a + 540) % 360) - 180;
export const fromBearing = (p: XY, brg: number, d: number): XY => ({ x: p.x + Math.sin(brg * RAD) * d, y: p.y + Math.cos(brg * RAD) * d });

/** Distance from p to segment ab, plus the parameter t (0..1) of the closest point. */
export function segDist(p: XY, a: XY, b: XY): { d: number; t: number } {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return { d: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy), t };
}

export function pointInPoly(p: XY, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
