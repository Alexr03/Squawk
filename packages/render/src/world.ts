// Static airport scene from an AirportPack: ground, surfaces, runway markings, buildings and airfield lights.
// World mapping: pack (x east, y north) -> three (x, up, -y).
import * as THREE from 'three';
import type { AirportPack, RunwayPack, XY } from '@squawk/sim/types';
import { segDist } from '@squawk/sim/geo';
import { lightMaterial } from './fx.ts';

export const Y = { grass: 0, map: 0.05, twy: 0.1, apron: 0.16, rwyBase: 0.2, rwy: 0.24, line: 0.3, pool: 0.34, light: 0.6 };

function hash(n: number) { n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; }

// ---------------------------------------------------------------- ground

function grass(): THREE.Mesh {
  const N = 128, data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const x = i % N, y = (i / N) | 0;
    const clump = hash(((x >> 1) * 92821) ^ ((y >> 1) * 68917)) * 0.5 + hash(x * 7919 + y * 104729) * 0.5;
    const v = 214 + clump * 41;
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const size = 80000, seg = 160;
  const g = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  const uv = g.getAttribute('uv'), pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const near = new THREE.Color('#87a564'), far = new THREE.Color('#728f58'), field = new THREE.Color('#a19f66');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    uv.setXY(i, x / 256, -z / 256);
    const r = Math.hypot(x, z + 700);
    const n = hash(Math.round(x / 500) * 7333 + Math.round(z / 500) * 15731);
    c.copy(near).lerp(far, Math.min(1, Math.max(0, (r - 3500) / 2500)));
    if (r > 4500) c.lerp(field, n * n * 0.8);
    c.multiplyScalar(0.94 + n * 0.1);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true });
  // farmland patchwork outside the airfield: crisp hashed field cells in world space
  mat.onBeforeCompile = s => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vField;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvField = (modelMatrix * vec4(transformed, 1.0)).xz;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vField;
      float fh(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }`).replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec2 w = vField + vec2(-150.0, 700.0);
        float airfield = length(w / vec2(2900.0, 1700.0));
        vec2 cell = floor(w / vec2(380.0, 260.0) + vec2(fh(floor(w.yy / 260.0)) * 3.0, 0.0));
        float h = fh(cell);
        vec3 tint = h < 0.5 ? vec3(0.92, 1.0, 0.86) : h < 0.75 ? vec3(1.12, 1.04, 0.78) : h < 0.9 ? vec3(0.8, 0.9, 0.78) : vec3(1.05, 0.9, 0.72);
        diffuseColor.rgb *= mix(vec3(1.0), tint, smoothstep(1.0, 1.15, airfield));
      }`);
  };
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

/** Flat ribbons along polylines/segments (taxiways, motorways, rivers), plus optional round joints. */
function ribbons(segs: [XY, XY][], width: number, y: number, joints: XY[] = []): THREE.BufferGeometry {
  const out: number[] = [];
  const h = width / 2;
  for (const [a, b] of segs) {
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * h, ny = (dx / l) * h;
    const p = [[a.x + nx, a.y + ny], [b.x + nx, b.y + ny], [b.x - nx, b.y - ny], [a.x - nx, a.y - ny]];
    for (const k of [0, 1, 2, 0, 2, 3]) out.push(p[k][0], y, -p[k][1]);
  }
  for (const j of joints) for (let i = 0; i < 10; i++) {
    const a0 = (i / 10) * Math.PI * 2, a1 = ((i + 1) / 10) * Math.PI * 2;
    out.push(j.x, y, -j.y, j.x + Math.cos(a0) * h, y, -(j.y + Math.sin(a0) * h), j.x + Math.cos(a1) * h, y, -(j.y + Math.sin(a1) * h));
  }
  return flatGeometry(out);
}

function polysGeometry(polys: XY[][], y: number): THREE.BufferGeometry {
  const out: number[] = [];
  for (const poly of polys) {
    const pts = poly.map(p => new THREE.Vector2(p.x, p.y));
    if (pts.length > 2 && pts[0].equals(pts[pts.length - 1])) pts.pop();
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    const cw = THREE.ShapeUtils.isClockWise(pts);
    for (const t of tris) for (const k of t) out.push(pts[k].x, y, -pts[k].y);
  }
  return flatGeometry(out);
}

/** Horizontal triangles (three coords): forced to face up, with world-space UVs in metres and up normals. */
function flatGeometry(out: number[]): THREE.BufferGeometry {
  for (let i = 0; i < out.length; i += 9) {
    const cy = (out[i + 5] - out[i + 2]) * (out[i + 6] - out[i]) - (out[i + 3] - out[i]) * (out[i + 8] - out[i + 2]);
    if (cy < 0) for (let k = 0; k < 3; k++) { const t = out[i + 3 + k]; out[i + 3 + k] = out[i + 6 + k]; out[i + 6 + k] = t; }
  }
  const n = out.length / 3, uv = new Float32Array(n * 2), nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { uv[i * 2] = out[i * 3]; uv[i * 2 + 1] = -out[i * 3 + 2]; nor[i * 3 + 1] = 1; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

/** Tileable greyscale detail texture, sRGB, nearest up close and mipmapped far away. */
function detailTexture(N: number, metres: number, f: (x: number, y: number) => number): THREE.DataTexture {
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) { const v = Math.max(0, Math.min(255, f(i % N, (i / N) | 0))); data.set([v, v, v, 255], i * 4); }
  const t = new THREE.DataTexture(data, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(1 / metres, 1 / metres); t.needsUpdate = true;
  return t;
}
const concrete = () => detailTexture(64, 20, (x, y) => {
  const slab = hash((x >> 4) * 31 + (y >> 4) * 977);
  const joint = x % 16 === 0 || y % 16 === 0;
  return 236 + slab * 14 + hash(x * 7 + y * 131) * 8 - (joint ? 26 : 0) - (hash(x * 13 + y * 7) > 0.97 ? 14 : 0);
});
const asphalt = () => detailTexture(64, 24, (x, y) => 238 + hash(x * 17 + y * 389) * 17 - (hash(x * 3 + y * 1031) > 0.93 ? 16 : 0));

// ---------------------------------------------------------------- runway markings

const SHOULDER = 7.5;
function runwayMesh(rw: RunwayPack, maxTex: number): THREE.Mesh {
  const A = rw.ends[0].end, B = rw.ends[1].end;
  const len = Math.hypot(B.x - A.x, B.y - A.y);
  const Wt = rw.widthM + 2 * SHOULDER;
  const ppm = Math.min(2, (maxTex - 2) / len);
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(len * ppm); cv.height = Math.ceil(Wt * 3);
  const ppv = cv.height / Wt; // px per metre across
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#56544f'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#3f3e3c'; ctx.fillRect(0, SHOULDER * ppv, cv.width, rw.widthM * ppv);
  // asphalt speckle
  for (let i = 0; i < len * 3; i++) {
    const h = hash(i * 31 + 7), k = hash(i * 17 + 3);
    ctx.fillStyle = k > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
    ctx.fillRect(h * cv.width, hash(i * 13 + 1) * cv.height, ppm * 2, ppv);
  }
  const sA = Math.hypot(rw.ends[0].thr.x - A.x, rw.ends[0].thr.y - A.y);
  const sB = Math.hypot(rw.ends[1].thr.x - B.x, rw.ends[1].thr.y - B.y);
  // rect relative to an end's threshold: along a..b inward, lateral c0..c1 (+ = landing pilot's left)
  const rect = (e: 0 | 1, a: number, b: number, c0: number, c1: number) => {
    const u0 = e === 0 ? sA + a : len - sB - b, u1 = e === 0 ? sA + b : len - sB - a;
    for (const s of [1, -1]) {
      const y0 = Wt / 2 - (e === 0 ? s : -s) * c1, y1 = Wt / 2 - (e === 0 ? s : -s) * c0;
      ctx.fillRect(u0 * ppm, Math.min(y0, y1) * ppv, (u1 - u0) * ppm, Math.abs(y1 - y0) * ppv);
    }
  };
  for (const e of [0, 1] as const) {
    // rubber deposits in the touchdown zone
    ctx.fillStyle = 'rgba(20,18,16,0.35)';
    for (let i = 0; i < 260; i++) {
      const a = 280 + hash(i * 3 + e) * 520, c = (hash(i * 5 + e + 9) - 0.5) * 16;
      rect(e, a, a + 4 + hash(i) * 14, Math.max(0, c), Math.max(0, c) + 1.5 + hash(i * 7) * 2);
    }
    ctx.fillStyle = '#e9e6dd';
    for (let i = 0; i < 6; i++) rect(e, 6, 36, 2.7 + i * 3.6 - 0.9, 2.7 + i * 3.6 + 0.9); // piano keys
    for (const [a, n] of [[150, 3], [300, 3], [600, 2], [750, 2], [900, 1]] as const)
      for (let i = 0; i < n; i++) rect(e, a, a + 22.5, 11 + i * 3.6, 12.8 + i * 3.6); // TDZ
    rect(e, 400, 460, 10, 16); // aiming point
    // designator, readable from the approach
    const name = rw.ends[e].name;
    const at = (e === 0 ? sA : len - sB) * ppm, dir = e === 0 ? 1 : -1;
    ctx.save();
    ctx.translate(at + dir * 66 * ppm, cv.height / 2);
    ctx.rotate(dir * Math.PI / 2);
    ctx.scale(ppv / ppm, 1);
    ctx.font = `bold ${Math.round(13 * ppm)}px "Arial Narrow", Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    if (name.length > 2) ctx.fillText(name[2], 0, 4 * ppm); // letter nearest the threshold
    ctx.fillText(name.slice(0, 2), 0, -12 * ppm);
    ctx.restore();
  }
  // centreline dashes and edge stripes
  ctx.fillStyle = '#e9e6dd';
  for (let u = sA + 100; u < len - sB - 100; u += 50) ctx.fillRect(u * ppm, (Wt / 2 - 0.45) * ppv, 30 * ppm, Math.max(1, 0.9 * ppv));
  for (const c of [SHOULDER + 0.2, Wt - SHOULDER - 1.1]) ctx.fillRect(sA * ppm, c * ppv, (len - sA - sB) * ppm, Math.max(1, 0.9 * ppv));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  const d = { x: (B.x - A.x) / len, y: (B.y - A.y) / len }, n = { x: -d.y * Wt / 2, y: d.x * Wt / 2 };
  const P = [[A.x - n.x, A.y - n.y], [B.x - n.x, B.y - n.y], [B.x + n.x, B.y + n.y], [A.x + n.x, A.y + n.y]];
  const UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const pos: number[] = [], uv: number[] = [];
  for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(P[k][0], Y.rwy, -P[k][1]); uv.push(UV[k][0], UV[k][1]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex }));
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- buildings

const BUILDING_COLOURS: Record<string, [string, string]> = {
  terminal: ['#d9d3c5', '#b9c0c4'],
  hangar: ['#9fabb5', '#8b969e'],
  tower: ['#eceae4', '#d0d0cc'],
};
const GENERIC: [string, string][] = [['#c4b7a2', '#a9a59c'], ['#b3b0a8', '#9c9d99'], ['#cbbfae', '#b7ada0'], ['#a9b0ac', '#949b97']];

function buildingsGeometry(pack: AirportPack): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  const wall = new THREE.Color(), roof = new THREE.Color();
  pack.buildings.forEach((b, bi) => {
    const pts = b.poly.map(p => new THREE.Vector2(p.x, p.y));
    if (pts.length > 2 && pts[0].equals(pts[pts.length - 1])) pts.pop();
    if (pts.length < 3) return;
    const [w, r] = BUILDING_COLOURS[b.kind] ?? GENERIC[Math.floor(hash(bi + 11) * GENERIC.length)];
    wall.set(w); roof.set(r);
    const h = Math.max(4, b.heightM);
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2).toNonIndexed();
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i += 3) {
      const top = p.getY(i) > h - 0.01 && p.getY(i + 1) > h - 0.01 && p.getY(i + 2) > h - 0.01;
      const bottom = p.getY(i) < 0.01 && p.getY(i + 1) < 0.01 && p.getY(i + 2) < 0.01;
      if (bottom) continue;
      for (let k = 0; k < 3; k++) {
        pos.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k));
        const c = top ? roof : wall;
        col.push(c.r, c.g, c.b);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Lambert with lit windows on walls at night (uNight) — procedural floors/bays from world position. */
function buildingMaterial() {
  const uniforms = { uNight: { value: 0 }, uDetail: { value: 1 } };
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  m.onBeforeCompile = s => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNorm = normalize(mat3(modelMatrix) * objectNormal);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\nuniform float uNight;\nuniform float uDetail;\nfloat bh(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}')
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vWNorm.y > 0.5) { // roof detail: panel seams and plant boxes
          vec2 r = vWPos.xz;
          float seam = step(fract(r.x / 8.0), 0.09) + step(fract(r.y / 8.0), 0.09);
          float box = step(0.86, bh(floor(r / 6.0) + 0.5)) * step(0.25, fract(r.x / 6.0)) * step(fract(r.x / 6.0), 0.8) * step(0.25, fract(r.y / 6.0)) * step(fract(r.y / 6.0), 0.8);
          diffuseColor.rgb *= mix(1.0, (1.0 - 0.07 * min(seam, 1.0)) * (1.0 + 0.12 * box), uDetail);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (abs(vWNorm.y) < 0.5 && uNight > 0.0) {
          vec2 t = normalize(vec2(-vWNorm.z, vWNorm.x));
          float along = dot(vWPos.xz, t);
          float fl = floor((vWPos.y - 1.5) / 4.0);
          float bay = floor(along / 3.2);
          float lit = step(0.38, bh(vec2(bay * 0.37 + floor(along / 40.0), fl + 3.1)));
          float win = step(0.25, fract((vWPos.y - 1.5) / 4.0)) * step(fract((vWPos.y - 1.5) / 4.0), 0.7) * step(0.0, fl)
                    * step(0.15, fract(along / 3.2)) * step(fract(along / 3.2), 0.85);
          float w = mix(0.45 * lit, win * lit, uDetail);
          totalEmissiveRadiance += vec3(1.0, 0.72, 0.4) * w * uNight * 1.3;
        }`);
  };
  return { material: m, uniforms };
}

// ---------------------------------------------------------------- lights

export class LightSet {
  pos: number[] = []; col: number[] = []; size: number[] = [];
  add(p: XY, y: number, c: THREE.Color, sizeM: number) { this.pos.push(p.x, y, -p.y); this.col.push(c.r, c.g, c.b); this.size.push(sizeM); }
  points(): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(this.size, 1));
    const p = new THREE.Points(g, lightMaterial());
    p.frustumCulled = false;
    p.renderOrder = 5;
    return p;
  }
}
const hdr = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);
export const LC = {
  white: hdr('#fff3dc', 2.4), centre: hdr('#dfe8ff', 2), green: hdr('#3dff7a', 2.8), red: hdr('#ff2a1a', 3),
  blue: hdr('#3f6dff', 1.3), amber: hdr('#ffae3a', 1.1), dimGreen: hdr('#3dff7a', 0.38), greens: hdr('#5bff8f', 4), stop: hdr('#ff2414', 3),
};

const lerpXY = (a: XY, b: XY, t: number): XY => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export interface AirportWorld {
  group: THREE.Group;
  buildings: THREE.Mesh;
  buildingUniforms: { uNight: { value: number }; uDetail: { value: number } };
  surfaceMats: { mat: THREE.MeshLambertMaterial; base: THREE.Color; lit?: number }[]; // lit: floodlit at night
  centrelines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  lights: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>[];       // always-on airfield lights
  approach: Map<string, THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>>; // per runway end
  twyCentre: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  stopBars: Map<number, XY[]>;
  standPools: { x: number; y: number }[];
}

export function buildAirport(pack: AirportPack, maxTex: number): AirportWorld {
  const group = new THREE.Group();
  // Ground layers don't write depth; they draw first, in order, so coplanar layers never z-fight.
  let order = -100;
  const ground = (o: THREE.Mesh | THREE.LineSegments) => { o.renderOrder = order++; (o.material as THREE.Material).depthWrite = false; group.add(o); return o; };
  ground(grass());
  const surfaceMats: AirportWorld['surfaceMats'] = [];
  const mat = (hex: string, map?: THREE.Texture, lit = 0) => {
    const base = new THREE.Color(hex);
    const m = new THREE.MeshLambertMaterial({ color: base.clone(), map });
    surfaceMats.push({ mat: m, base, lit });
    return m;
  };
  const flat = (g: THREE.BufferGeometry, m: THREE.Material) => { const o = new THREE.Mesh(g, m); o.receiveShadow = true; return ground(o); };

  // map features around the airport (motorways, rivers)
  const near = (p: XY) => Math.abs(p.x) < 20000 && Math.abs(p.y) < 20000;
  for (const [kind, w, hex] of [['motorway', 30, '#5d5b57'], ['river', 26, '#4d7480']] as const) {
    const segs: [XY, XY][] = [];
    for (const l of pack.airspace.map) if (l.kind === kind)
      for (let i = 1; i < l.pts.length; i++) if (near(l.pts[i]) || near(l.pts[i - 1])) segs.push([l.pts[i - 1], l.pts[i]]);
    const joints = segs.map(s => s[0]);
    flat(ribbons(segs, w, Y.map, joints), mat(hex));
  }

  const nodes = pack.taxi.nodes;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const twyEdges = pack.taxi.edges.filter(e => !e.runway);
  const segs: [XY, XY][] = twyEdges.map(e => [byId.get(e.a)!, byId.get(e.b)!]);
  const used = new Set<number>(); for (const e of twyEdges) { used.add(e.a); used.add(e.b); }
  flat(ribbons(segs, 23, Y.twy, [...used].map(id => byId.get(id)!)), mat('#7a7671', asphalt(), 0.3));
  flat(polysGeometry(pack.surfaces.filter(s => s.kind !== 'runway').map(s => s.poly), Y.apron), mat('#b1a999', concrete(), 1));
  flat(polysGeometry(pack.surfaces.filter(s => s.kind === 'runway').map(s => s.poly), Y.rwyBase), mat('#4b4946'));
  for (const rw of pack.runways) {
    const m = runwayMesh(rw, maxTex);
    surfaceMats.push({ mat: m.material as THREE.MeshLambertMaterial, base: new THREE.Color('#ffffff') });
    ground(m);
  }

  // yellow taxiway centrelines: 1 render pixel wide regardless of zoom
  const lp: number[] = [];
  for (const [a, b] of segs) lp.push(a.x, Y.line, -a.y, b.x, Y.line, -b.y);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  const centrelines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#e7b923', transparent: true }));
  ground(centrelines);

  // buildings
  const { material: bm, uniforms: buildingUniforms } = buildingMaterial();
  const buildings = new THREE.Mesh(buildingsGeometry(pack), bm);
  buildings.castShadow = buildings.receiveShadow = true;
  group.add(buildings);

  // ---- airfield ground lighting
  const rwyL = new LightSet();
  const approach = new Map<string, THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>>();
  for (const rw of pack.runways) {
    const A = rw.ends[0].end, B = rw.ends[1].end;
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    const d = { x: (B.x - A.x) / len, y: (B.y - A.y) / len }, n = { x: -d.y, y: d.x };
    const at = (s: number, c: number): XY => ({ x: A.x + d.x * s + n.x * c, y: A.y + d.y * s + n.y * c });
    const hw = rw.widthM / 2 + 1.5;
    for (let s = 0; s <= len + 0.1; s += len / Math.round(len / 60)) for (const c of [hw, -hw]) rwyL.add(at(s, c), Y.light, LC.white, 3);
    for (let s = 15; s < len; s += 15) rwyL.add(at(s, 0), Y.light, LC.centre, 1.8);
    for (const e of [0, 1] as const) {
      const end = rw.ends[e];
      const inward = e === 0 ? d : { x: -d.x, y: -d.y };
      const side = { x: -inward.y, y: inward.x };
      const T = (s: number, c: number): XY => ({ x: end.thr.x + inward.x * s + side.x * c, y: end.thr.y + inward.y * s + side.y * c });
      for (let c = -rw.widthM / 2; c <= rw.widthM / 2 + 0.1; c += 3) { rwyL.add(T(-1.5, c), Y.light, LC.green, 2.6); rwyL.add(T(1.5, c), Y.light, LC.red, 2.6); }
      for (let c = 0; c < 4; c++) for (const sg of [1, -1]) rwyL.add(T(-1.5, sg * (rw.widthM / 2 + 3 + c * 3)), Y.light, LC.green, 2.6); // wing bars
      for (let s = 60; s <= 900; s += 60) for (const sg of [1, -1]) for (let k = 0; k < 3; k++) rwyL.add(T(s, sg * (9 + k * 1.5)), Y.light, LC.white, 1.6); // TDZ
      // approach lighting: centreline barrettes, crossbars every 150 m, red side rows inner 270 m
      const ap = new LightSet();
      for (let s = 30; s <= 900; s += 30) {
        for (let k = -2; k <= 2; k++) ap.add(T(-s, k * 1.05), Y.light, LC.white, 2.4);
        if (s % 150 === 0) { const w = 9 + s / 30; for (let c = 3; c <= w; c += 2.7) for (const sg of [1, -1]) ap.add(T(-s, sg * c), Y.light, LC.white, 2.4); }
        if (s <= 270) for (const sg of [1, -1]) for (let k = 0; k < 3; k++) ap.add(T(-s, sg * (11 + k * 1.5)), Y.light, LC.red, 2.2);
      }
      const pts = ap.points();
      approach.set(end.name, pts);
      group.add(pts);
    }
  }

  // taxiway centreline (dim unless on a greens route) and blue edge lights on named taxiways
  const twyC = new LightSet(), twyE = new LightSet();
  const allSegs = pack.taxi.edges.map(e => ({ a: byId.get(e.a)!, b: byId.get(e.b)!, e }));
  const cell = 40, grid = new Map<string, number[]>();
  allSegs.forEach((s, i) => {
    const x0 = Math.floor(Math.min(s.a.x, s.b.x) / cell) - 1, x1 = Math.floor(Math.max(s.a.x, s.b.x) / cell) + 1;
    const y0 = Math.floor(Math.min(s.a.y, s.b.y) / cell) - 1, y1 = Math.floor(Math.max(s.a.y, s.b.y) / cell) + 1;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = `${x},${y}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); }
  });
  const clear = (p: XY, self: number, r: number) => {
    for (const i of grid.get(`${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`) ?? [])
      if (i !== self && segDist(p, allSegs[i].a, allSegs[i].b).d < (allSegs[i].e.runway ? 40 : r)) return false;
    return true;
  };
  for (const n of used) twyC.add(byId.get(n)!, Y.light, LC.dimGreen, 1.4);
  allSegs.forEach((s, i) => {
    if (s.e.runway) return;
    const k = Math.max(1, Math.round(s.e.lengthM / 15));
    for (let j = 1; j < k; j++) twyC.add(lerpXY(s.a, s.b, j / k), Y.light, LC.dimGreen, 1.4);
    if (!s.e.name) return;
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, l = Math.hypot(dx, dy) || 1;
    const m = Math.max(1, Math.round(l / 30));
    for (let j = 0; j <= m; j++) for (const sg of [1, -1]) {
      const p = lerpXY(s.a, s.b, j / m);
      const q = { x: p.x - (dy / l) * 12 * sg, y: p.y + (dx / l) * 12 * sg };
      if (clear(q, i, 11)) twyE.add(q, Y.light, LC.blue, 1.5);
    }
  });

  // stop bars at runway holding points, across the taxiway
  const stopBars = new Map<number, XY[]>();
  for (const n of nodes) {
    if (!n.hold) continue;
    const e = pack.taxi.edges.find(e => (e.a === n.id || e.b === n.id) && !e.runway);
    if (!e) continue;
    const o = byId.get(e.a === n.id ? e.b : e.a)!;
    const l = Math.hypot(o.x - n.x, o.y - n.y) || 1;
    const px = -(o.y - n.y) / l, py = (o.x - n.x) / l;
    const bar: XY[] = [];
    for (let c = -10.5; c <= 10.6; c += 3) bar.push({ x: n.x + px * c, y: n.y + py * c });
    stopBars.set(n.id, bar);
  }

  // stand guidance lights + apron floodlight pools
  const standL = new LightSet();
  const RAD = Math.PI / 180;
  for (const s of pack.stands) standL.add({ x: s.x + Math.sin(s.hdg * RAD) * 30, y: s.y + Math.cos(s.hdg * RAD) * 30 }, 4, LC.amber, 2);

  const lights = [rwyL.points(), twyE.points(), standL.points()];
  const twyCentre = twyC.points();
  for (const l of [...lights, twyCentre]) group.add(l);
  return {
    group, buildings, buildingUniforms, surfaceMats, centrelines, lights, approach, twyCentre, stopBars,
    standPools: pack.stands.map(s => ({ x: s.x, y: s.y })),
  };
}
