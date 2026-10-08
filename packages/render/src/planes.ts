// Low-poly aircraft and vehicle meshes generated from the type table and airline liveries.
// Local frame: +Z = nose, +X = left (port) wing, +Y = up, origin at mid-fuselage on the ground.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TYPES, type AircraftType } from '@squawk/sim/aircraft';
import { airline } from '@squawk/sim/airlines';

const WING_GREY = new THREE.Color('#b4bac3');
const DARK = new THREE.Color('#20242b');

function paint(g: THREE.BufferGeometry, c: THREE.Color | ((y: number) => THREE.Color)): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  n.deleteAttribute('normal');
  const pos = n.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = typeof c === 'function' ? c(pos.getY(i)) : c;
    col[i * 3] = k.r; col[i * 3 + 1] = k.g; col[i * 3 + 2] = k.b;
  }
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return n;
}

/** Flat slab from a 2D outline (u, v) extruded by `t`; `orient` maps it into place. */
function slab(pts: [number, number][], t: number): THREE.BufferGeometry {
  const s = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)));
  return new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
}

/** Swept planform (wing / tailplane) in the X-Z plane, top surface at y = 0. side: +1 left, -1 right. */
function planform(semi: number, root: number, tip: number, sweepDeg: number, side: 1 | -1, t: number, dihedral = 0) {
  const sw = Math.tan((sweepDeg * Math.PI) / 180) * semi;
  const pts: [number, number][] = [[0, 0], [semi * side, -sw], [semi * side, -sw - tip], [0, -root]];
  if (side < 0) pts.reverse();
  const g = slab(pts, t).rotateX(Math.PI / 2); // shape (u, v) -> (x, z), extrusion -> -y
  if (dihedral) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + Math.abs(p.getX(i)) * dihedral);
  }
  return g;
}

function buildAircraft(type: AircraftType, op: string): THREE.BufferGeometry {
  const liv = airline(op);
  const body = new THREE.Color(liv.body), tail = new THREE.Color(liv.tail), accent = new THREE.Color(liv.accent);
  const belly = body.clone().lerp(new THREE.Color('#8c939c'), 0.35);
  const L = type.lengthM, S = type.spanM;
  const prop = type.tail === 't' && type.cruise < 400;
  const D = (prop ? 0.4 : 1.2) + 0.075 * L;
  const gear = 0.28 * D;
  const cy = gear + D / 2;
  const parts: THREE.BufferGeometry[] = [];

  // Fuselage: lathe profile along the axis (y in lathe space -> +Z after rotation), tail cone raised.
  const prof: [number, number][] = [[0.02, -0.5], [0.22, -0.47], [0.42, -0.38], [0.5, -0.26], [0.5, 0.36], [0.44, 0.44], [0.3, 0.485], [0.04, 0.5]];
  const fus = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r * D, z * L)), 8).rotateX(Math.PI / 2);
  const fp = fus.getAttribute('position');
  for (let i = 0; i < fp.count; i++) {
    const z = fp.getZ(i) / L; // -0.5 tail .. 0.5 nose
    const lift = z < -0.26 ? ((-0.26 - z) / 0.24) * 0.38 * D : 0;
    fp.setY(i, fp.getY(i) * (type.wake === 'J' ? 1.2 : 1) + cy + lift);
  }
  parts.push(paint(fus, y => (y < cy - 0.18 * D ? belly : body)));
  // Cockpit windows
  parts.push(paint(new THREE.BoxGeometry(0.62 * D, 0.14 * D, 0.035 * L).translate(0, cy + 0.3 * D, 0.43 * L), DARK));

  // Wings
  const root = (prop ? 0.1 : 0.17) * L, semi = S / 2;
  const sweep = prop ? 2 : type.wake === 'H' || type.wake === 'J' ? 31 : 26;
  const wingY = prop ? cy + 0.5 * D : gear + 0.3 * D;
  const wz = prop ? 0.08 * L : 0.1 * L;
  const th = Math.min(1, Math.max(0.3, root * 0.07));
  for (const side of [1, -1] as const)
    parts.push(paint(planform(semi, root, root * (prop ? 0.6 : 0.26), sweep, side, th, prop ? 0 : 0.05).translate(0, wingY, wz), WING_GREY));

  // Engines
  const er = prop ? 0.22 * D : (type.wake === 'M' ? 0.27 : 0.3) * D;
  const el = prop ? 0.17 * L : 0.11 * L;
  const stations = type.engines === 4 ? [0.37, 0.66] : [prop ? 0.3 : 0.34];
  const swt = Math.tan((sweep * Math.PI) / 180);
  for (const f of stations) for (const side of [1, -1]) {
    const x = side * f * semi;
    const le = wz - Math.abs(x) * swt;
    const ey = prop ? wingY : wingY - er * 0.9 + Math.abs(x) * 0.05;
    const z = le + el * (prop ? 0.25 : 0.35);
    parts.push(paint(new THREE.CylinderGeometry(er * 0.9, er, el, 8).rotateX(Math.PI / 2).translate(x, ey, z), accent));
    if (prop) parts.push(paint(new THREE.CylinderGeometry(0.075 * L, 0.075 * L, 0.15, 8).rotateX(Math.PI / 2).translate(x, ey, z + el / 2 + 0.2), DARK));
  }

  // Fin (tail colour) and tailplane
  const finH = Math.max(2, type.heightM - gear - D - (prop ? 0 : 0.3 * D));
  const fr = (prop ? 0.17 : 0.15) * L, ft = fr * (prop ? 0.55 : 0.4);
  const fsw = Math.tan(((prop ? 30 : 38) * Math.PI) / 180) * finH;
  const ftz = -0.34 * L, fbase = cy + 0.25 * D;
  const fin = slab([[0, 0], [-fsw, finH], [-fsw - ft, finH], [-fr, 0]], 0.35 + D * 0.04).rotateY(-Math.PI / 2);
  parts.push(paint(fin.translate(0.18 + D * 0.02, fbase, ftz), tail));
  const hs = S * (prop ? 0.27 : 0.18), hr = 0.09 * L;
  const hy = type.tail === 't' ? fbase + finH : cy + 0.15 * D;
  const hz = type.tail === 't' ? ftz - fsw : -0.37 * L;
  for (const side of [1, -1] as const)
    parts.push(paint(planform(hs, hr, hr * 0.45, prop ? 8 : 32, side, 0.3, type.tail === 't' ? 0 : 0.08).translate(0, hy, hz), type.tail === 't' ? tail : WING_GREY));

  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const cache = new Map<string, THREE.BufferGeometry>();
/** Geometry for a type x operator, cached. Unknown types fall back to the A320. */
export function aircraftGeometry(type: string, op: string): THREE.BufferGeometry {
  const key = `${type}|${op}`;
  let g = cache.get(key);
  if (!g) cache.set(key, (g = buildAircraft(TYPES[type] ?? TYPES.A320, op)));
  return g;
}
export const typeOf = (t: string): AircraftType => TYPES[t] ?? TYPES.A320;

/** Light anchor points in the local frame: wingtips, tail, beacon, nose. */
export function lightPoints(t: AircraftType) {
  const L = t.lengthM, S = t.spanM;
  const prop = t.tail === 't' && t.cruise < 400;
  const D = (prop ? 0.4 : 1.2) + 0.075 * L;
  const gear = 0.28 * D, cy = gear + D / 2;
  const wingY = prop ? cy + 0.5 * D : gear + 0.3 * D + (S / 2) * 0.05;
  const sweep = prop ? 2 : t.wake === 'H' || t.wake === 'J' ? 31 : 26;
  const tipZ = 0.1 * L - Math.tan((sweep * Math.PI) / 180) * (S / 2) - 0.1 * L * 0.26;
  return {
    left: new THREE.Vector3(S / 2, wingY, tipZ),
    right: new THREE.Vector3(-S / 2, wingY, tipZ),
    tail: new THREE.Vector3(0, cy + 0.2 * D, -0.5 * L),
    beaconTop: new THREE.Vector3(0, cy + 0.52 * D, 0.05 * L),
    nose: new THREE.Vector3(0, gear * 0.6, 0.4 * L),
    wingRoot: new THREE.Vector3(0.12 * S, wingY, 0.06 * L),
  };
}

export type VehicleKind = 'fire' | 'followme' | 'tug';
const vcache = new Map<VehicleKind, THREE.BufferGeometry>();
export function vehicleGeometry(kind: VehicleKind): THREE.BufferGeometry {
  let g = vcache.get(kind);
  if (g) return g;
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 'fire') {
    parts.push(paint(new THREE.BoxGeometry(3, 2.8, 10).translate(0, 1.9, 0), new THREE.Color('#c8261e')));
    parts.push(paint(new THREE.BoxGeometry(2.6, 0.5, 6).translate(0, 3.5, -1.5), new THREE.Color('#e9e6dc')));
    parts.push(paint(new THREE.BoxGeometry(2.9, 0.9, 1.4).translate(0, 2.4, 4.4), DARK));
  } else if (kind === 'followme') {
    parts.push(paint(new THREE.BoxGeometry(1.9, 1.2, 4.6).translate(0, 0.9, 0), new THREE.Color('#f2c230')));
    parts.push(paint(new THREE.BoxGeometry(1.7, 0.5, 2.2).translate(0, 1.75, -0.4), new THREE.Color('#2b2b2b')));
  } else {
    parts.push(paint(new THREE.BoxGeometry(2.8, 1.3, 6).translate(0, 0.85, 0), new THREE.Color('#e3dccb')));
    parts.push(paint(new THREE.BoxGeometry(1.6, 0.9, 1.4).translate(0.5, 1.9, -1.8), DARK));
  }
  g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  vcache.set(kind, g);
  return g;
}
