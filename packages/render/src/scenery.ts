// The world outside the fence (and extra airside pavement): landuse fields, roads with traffic, street lights and buildings.
// World mapping as in world.ts: pack (x east, y north) -> three (x, up, -y).
import * as THREE from 'three';
import type { Scenery, SceneryAreaKind, SceneryRoadKind, XY } from '@squawk/sim/types';
import { lightMaterial, lightUniforms } from './fx.ts';

const AREA_KINDS: SceneryAreaKind[] = ['residential', 'industrial', 'commercial', 'retail', 'farmland', 'grass', 'forest', 'water', 'parking', 'construction', 'paved', 'railway'];
const AREA_COL: Record<SceneryAreaKind, string[]> = {
  residential: ['#9b9884', '#a09a86', '#979580'], industrial: ['#9c9891', '#a19c93', '#96938e'], commercial: ['#a39d93', '#9f9a92'],
  retail: ['#a69f94'], farmland: ['#9fae6a', '#b3ad6e', '#8fa463', '#a99a6c', '#c2b57a', '#88a05e'], grass: ['#86a463', '#82a060'],
  forest: ['#55733f', '#5a7842'], water: ['#3f6f80', '#3c6b7d'], parking: ['#77746f'], construction: ['#ab9c80'], paved: ['#b1a999'], railway: ['#857c70'],
};
const ROAD_KINDS: SceneryRoadKind[] = ['motorway', 'trunk', 'primary', 'secondary', 'minor', 'service', 'rail'];
const ROAD_COL: Record<SceneryRoadKind, string> = {
  motorway: '#58575a', trunk: '#5e5d5f', primary: '#646361', secondary: '#696764', minor: '#6f6d69', service: '#7a7772', rail: '#6d655c',
};

export interface SceneryWorld {
  group: THREE.Group;
  buildingsBig: THREE.Mesh[];
  buildingsSmall: THREE.Mesh[];
  uniforms: { uNight: { value: number }; uDay: { value: number }; uTime: { value: number }; uDetail: { value: number } };
  streetLights: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  cars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
}

function hash(n: number) { n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; }
const signedArea = (p: XY[]) => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j].x - p[i].x) * (p[j].y + p[i].y); return s / 2; };

const GLSL_NOISE = /* glsl */ `
  float sh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float sn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(sh(i), sh(i + vec2(1, 0)), f.x), mix(sh(i + vec2(0, 1)), sh(i + vec2(1, 1)), f.x), f.y); }`;

export function buildScenery(
  sc: Scenery,
  ground: (o: THREE.Mesh) => unknown,
  buildingMat: THREE.Material,
): SceneryWorld {
  const group = new THREE.Group();
  const uniforms = { uNight: { value: 0 }, uDay: { value: 1 }, uTime: { value: 0 }, uDetail: { value: 1 } };
  const c = new THREE.Color();

  // ---- landuse fields: one mesh, largest polygons first so smaller ones draw on top
  {
    const pos: number[] = [], col: number[] = [], kind: number[] = [];
    sc.areas.forEach((a, i) => {
      const pts = a.poly.map(p => new THREE.Vector2(p.x, p.y));
      if (pts.length < 3) return;
      const pal = AREA_COL[a.kind];
      c.set(pal[Math.floor(hash(i * 7 + 3) * pal.length)]).multiplyScalar(0.96 + hash(i) * 0.08);
      const k = AREA_KINDS.indexOf(a.kind);
      for (const t of THREE.ShapeUtils.triangulateShape(pts, [])) {
        const [p0, p1, p2] = [pts[t[0]], pts[t[1]], pts[t[2]]];
        const up = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x) > 0; // CCW in world = up-facing in three
        for (const p of up ? [p0, p1, p2] : [p0, p2, p1]) { pos.push(p.x, 0.02, -p.y); col.push(c.r, c.g, c.b); kind.push(k); }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    m.onBeforeCompile = s => {
      Object.assign(s.uniforms, uniforms);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aKind;\nvarying float vKind;\nvarying vec2 vW;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvKind = aKind;\nvW = (modelMatrix * vec4(transformed, 1.0)).xz;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying float vKind;\nvarying vec2 vW;\nuniform float uNight, uDay, uTime, uDetail;\n${GLSL_NOISE}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            float k = floor(vKind + 0.5);
            vec2 w = vec2(vW.x, -vW.y);
            float px = sh(floor(w / 2.5));
            vec3 m = vec3(1.0);
            if (k < 0.5) { // residential: gardens, patios and drives
              float g = step(0.5, sn(w / 11.0) * 0.7 + px * 0.3);
              m = mix(vec3(1.1, 1.03, 0.95), vec3(0.85, 1.04, 0.8), g);
            } else if (k < 3.5) { // industrial / commercial / retail yards: concrete slabs
              float j = min(1.0, step(fract(w.x / 10.0), 0.07) + step(fract(w.y / 10.0), 0.07));
              m = vec3((1.0 - 0.07 * j) * (0.95 + 0.08 * sh(floor(w / 10.0))));
            } else if (k < 4.5) { // farmland: drill rows
              m = vec3(0.95 + 0.07 * step(0.5, fract((w.x * 0.2 + w.y) / 3.5)));
            } else if (k < 5.5) { // grass
              m = vec3(0.95 + 0.08 * px);
            } else if (k < 6.5) { // woodland canopy
              float t = sn(w / 5.0) * 0.65 + sh(floor(w / 3.0)) * 0.35;
              m = vec3(0.68 + 0.55 * smoothstep(0.35, 0.75, t));
            } else if (k < 7.5) { // water
              m = vec3(0.94 + 0.1 * sn(w / 35.0 + uTime * 0.03));
            } else if (k < 8.5) { // car park: bays and aisles
              float bay = step(fract(w.x / 2.6), 0.14) * step(0.12, fract(w.y / 17.0)) * step(fract(w.y / 17.0), 0.42);
              float bay2 = step(fract(w.x / 2.6), 0.14) * step(0.58, fract(w.y / 17.0)) * step(fract(w.y / 17.0), 0.88);
              m = vec3(1.0 + 0.35 * (bay + bay2) * uDetail);
              float car = step(0.55, sh(floor(vec2(w.x / 2.6, w.y / 8.5)))) * (1.0 - step(0.42, fract(w.y / 17.0)) * step(fract(w.y / 17.0), 0.58));
              m = mix(m, vec3(0.6, 0.62, 0.68) + 0.7 * vec3(sh(floor(w / 2.6)), sh(floor(w / 2.6) + 3.1), sh(floor(w / 2.6) + 7.7)), car * 0.55 * uDetail);
            } else if (k < 9.5) { m = vec3(0.92 + 0.14 * px); }
            else { m = vec3(0.96 + 0.06 * px); }
            diffuseColor.rgb *= m;
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            float k = floor(vKind + 0.5);
            float glow = k < 0.5 ? 0.022 : k < 3.5 ? 0.04 : abs(k - 8.0) < 0.5 ? 0.05 : abs(k - 10.0) < 0.5 ? 0.03 : 0.0;
            totalEmissiveRadiance += vec3(1.0, 0.68, 0.38) * glow * uNight;
            if (abs(k - 7.0) < 0.5) totalEmissiveRadiance += vec3(0.9, 0.95, 1.0) * step(0.93, sn(vec2(vW.x, -vW.y) / 4.0 + uTime * 0.25)) * 0.12 * uDay * uDetail; // sun glints
          }`);
    };
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    ground(mesh);
    group.add(mesh);
  }

  // ---- roads: asphalt ribbons with lane markings on the big ones; street lights and moving traffic
  const lights: { p: XY; c: THREE.Color }[] = [];
  const cars: number[] = [], carDir: number[] = [], carSpd: number[] = [], carCol: number[] = [], carLit: number[] = [];
  const LAMP = new THREE.Color('#ffc27a').multiplyScalar(1.7);
  const HEAD = new THREE.Color('#fff4dc').multiplyScalar(2.2), TAIL = new THREE.Color('#ff3020').multiplyScalar(2.0);
  const CAR_COLS = ['#e8e8e6', '#b9bcc0', '#2b2d31', '#8e1d1d', '#24427a', '#6d7378', '#f0f0ee', '#3a3c40'].map(h => new THREE.Color(h));
  {
    const pos: number[] = [], col: number[] = [], rd: number[] = [];
    let li = 0;
    for (const r of sc.roads) {
      const k = ROAD_KINDS.indexOf(r.kind);
      c.set(ROAD_COL[r.kind]);
      const hw = r.width / 2, lanes = r.kind === 'motorway' || r.kind === 'trunk' ? Math.max(2, Math.round(r.width / 3.6)) : 0;
      let u = 0;
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
        const nx = (-dy / l) * hw, ny = (dx / l) * hw;
        const P = [[a.x + nx, a.y + ny, u, hw], [b.x + nx, b.y + ny, u + l, hw], [b.x - nx, b.y - ny, u + l, -hw], [a.x - nx, a.y - ny, u, -hw]];
        for (const q of [0, 2, 1, 0, 3, 2]) { pos.push(P[q][0], 0.06, -P[q][1]); col.push(c.r, c.g, c.b); rd.push(P[q][2], P[q][3], k, lanes); }
        // round joints on the wide roads so bends don't crack
        if (hw >= 4 && i < r.pts.length - 1) for (let s = 0; s < 8; s++) {
          const a0 = (s / 8) * Math.PI * 2, a1 = ((s + 1) / 8) * Math.PI * 2;
          for (const [x, y] of [[b.x, b.y], [b.x + Math.cos(a1) * hw, b.y + Math.sin(a1) * hw], [b.x + Math.cos(a0) * hw, b.y + Math.sin(a0) * hw]]) {
            pos.push(x, 0.059, -y); col.push(c.r, c.g, c.b); rd.push(0, 999, k, 0);
          }
        }
        // street lamps (not on service roads or railways), alternating sides
        if (r.kind !== 'service' && r.kind !== 'rail') {
          const step = r.kind === 'motorway' ? 45 : 36;
          for (let s = (li * 13) % step; s < l; s += step, li++) {
            const t = s / l, side = li % 2 ? 1 : -1;
            lights.push({ p: { x: a.x + dx * t + (nx / hw) * (hw + 1.5) * side, y: a.y + dy * t + (ny / hw) * (hw + 1.5) * side }, c: LAMP });
          }
        }
        // traffic: cars loop along each segment (one-way carriageways for motorways, two-way otherwise)
        const spacing = { motorway: 55, trunk: 80, primary: 110, secondary: 170, minor: 420, service: 0, rail: 0 }[r.kind];
        if (spacing && l > 25) {
          const n = Math.max(0, Math.floor(l / spacing + hash(i * 31 + li)));
          for (let j = 0; j < n; j++) {
            const back = r.kind !== 'motorway' && j % 2 === 1;
            const sx = back ? b.x : a.x, sy = back ? b.y : a.y, ex = back ? -dx : dx, ey = back ? -dy : dy;
            const off = r.kind === 'motorway' ? (hash(j * 3 + i) - 0.5) * hw : hw * 0.45; // UK: keep left
            const lx = -ey / l, ly = ex / l; // left of travel
            cars.push(sx + lx * off, 0.9, -(sy + ly * off));
            carDir.push(ex, 0, -ey, hash(i * 7 + j * 13 + li));
            const v = { motorway: 30, trunk: 20, primary: 14, secondary: 12, minor: 9, service: 0, rail: 0 }[r.kind] * (0.8 + hash(j + i * 3) * 0.4);
            carSpd.push(v / l);
            const cc = CAR_COLS[Math.floor(hash(j * 17 + i * 5) * CAR_COLS.length)];
            carCol.push(cc.r, cc.g, cc.b);
            // seen from above at night each car is a dot: white streams one way, red the other
            const lit = ex + ey * 0.3 > 0 ? TAIL : HEAD;
            carLit.push(lit.r, lit.g, lit.b);
          }
        }
        u += l;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aRoad', new THREE.Float32BufferAttribute(rd, 4));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    m.onBeforeCompile = s => {
      Object.assign(s.uniforms, uniforms);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aRoad;\nvarying vec4 vRoad;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRoad = aRoad;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec4 vRoad;\nuniform float uDetail;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            float u = vRoad.x, a = vRoad.y, k = floor(vRoad.z + 0.5), lanes = vRoad.w;
            float hw = abs(a) < 900.0 ? abs(a) : 0.0; // joints carry no markings
            float mark = 0.0;
            if (k < 1.5 && lanes > 0.5 && abs(a) < 900.0) { // motorway / trunk: edge lines and lane dashes
              float hh = max(hw, 0.001);
              float across = (a / hh * 0.5 + 0.5) * lanes; // 0..lanes
              mark += step(hh - 0.75, abs(a)) * step(abs(a), hh - 0.3);
              float lane = abs(fract(across + 0.5) - 0.5) * (2.0 * hh / lanes);
              mark += step(lane, 0.12) * step(0.5, across) * step(across, lanes - 0.5) * step(fract(u / 12.0), 0.45);
            } else if (k < 3.5 && abs(a) < 900.0) { // primary / secondary: dashed centre line
              mark += step(abs(a), 0.12) * step(fract(u / 9.0), 0.5);
            } else if (k > 5.5 && abs(a) < 900.0) { // railway: two steel rails on ballast
              mark -= 0.5 * step(abs(abs(a) - 0.75), 0.12);
            }
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.86, 0.8), clamp(mark, 0.0, 1.0) * uDetail);
            if (mark < 0.0) diffuseColor.rgb *= 1.0 + mark * uDetail;
          }`);
    };
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    ground(mesh);
    group.add(mesh);
  }
  const lp: number[] = [], lc: number[] = [], ls: number[] = [];
  for (const l of lights) { lp.push(l.p.x, 6, -l.p.y); lc.push(l.c.r, l.c.g, l.c.b); ls.push(2.4); }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  lg.setAttribute('aColor', new THREE.Float32BufferAttribute(lc, 3));
  lg.setAttribute('aSize', new THREE.Float32BufferAttribute(ls, 1));
  const streetLights = new THREE.Points(lg, lightMaterial(0));
  streetLights.frustumCulled = false; streetLights.renderOrder = 5;
  group.add(streetLights);

  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(cars, 3));
  cg.setAttribute('aDir', new THREE.Float32BufferAttribute(carDir, 4));
  cg.setAttribute('aSpeed', new THREE.Float32BufferAttribute(carSpd, 1));
  cg.setAttribute('aCol', new THREE.Float32BufferAttribute(carCol, 3));
  cg.setAttribute('aLit', new THREE.Float32BufferAttribute(carLit, 3));
  const carMat = new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uNight: uniforms.uNight, uDay: uniforms.uDay, uPxPerM: lightUniforms.uPxPerM },
    vertexShader: /* glsl */ `
      attribute vec4 aDir; attribute float aSpeed; attribute vec3 aCol; attribute vec3 aLit;
      uniform float uTime, uNight, uDay, uPxPerM;
      varying vec3 vC;
      void main() {
        vec3 p = position + aDir.xyz * fract(aDir.w + uTime * aSpeed);
        vC = mix(aCol * (0.35 + 0.75 * uDay), aLit, uNight);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(4.5 * uPxPerM, 1.0, 4.0);
      }`,
    fragmentShader: /* glsl */ `varying vec3 vC; void main() { gl_FragColor = vec4(vC, 1.0); }`,
    depthWrite: false,
  });
  const carPts = new THREE.Points(cg, carMat);
  carPts.frustumCulled = false; carPts.renderOrder = 4;
  group.add(carPts);

  // ---- buildings: custom extrusion, merged per 1 km tile; small ones in their own mesh so they can drop out when zoomed out
  const TILE = 1000;
  const tiles = new Map<string, { big: Arrays; small: Arrays }>();
  const wall = new THREE.Color(), roof = new THREE.Color();
  sc.buildings.forEach((b, i) => {
    let poly = b.poly;
    if (poly.length < 3) return;
    const sa = signedArea(poly);
    if (sa < 0) poly = [...poly].reverse();
    const area = Math.abs(sa), h = Math.max(3, b.heightM);
    const r1 = hash(i * 13 + 5), r2 = hash(i * 29 + 1);
    if (area > 1400 || h >= 11) { // sheds, warehouses, offices, hotels
      roof.set(['#a9afb2', '#919ca6', '#c3c6c4', '#8f9395', '#b5b0a6'][Math.floor(r1 * 5)]);
      wall.set(['#b8b3aa', '#a9adb0', '#c4bcae'][Math.floor(r2 * 3)]);
    } else if (area < 260) { // houses: terracotta or slate roofs, brick or render walls
      roof.set(['#a4614b', '#8f5646', '#b06d52', '#676b71', '#7a6e66', '#5f6368'][Math.floor(r1 * 6)]);
      wall.set(['#a87f65', '#cdbfa8', '#9b7660', '#d6ccb8'][Math.floor(r2 * 4)]);
    } else {
      roof.set(['#8f8a84', '#7d7c7a', '#9a8577'][Math.floor(r1 * 3)]);
      wall.set(['#c2b8a8', '#b3a999'][Math.floor(r2 * 2)]);
    }
    let cx = 0, cy = 0; for (const p of poly) { cx += p.x; cy += p.y; }
    const key = `${Math.floor(cx / poly.length / TILE)},${Math.floor(cy / poly.length / TILE)}`;
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = { big: new Arrays(), small: new Arrays() }));
    extrude(area < 120 && h < 9 ? t.small : t.big, poly, h, wall, roof);
  });
  const buildingsBig: THREE.Mesh[] = [], buildingsSmall: THREE.Mesh[] = [];
  for (const t of tiles.values()) for (const [arr, list] of [[t.big, buildingsBig], [t.small, buildingsSmall]] as const) {
    if (!arr.pos.length) continue;
    const m = new THREE.Mesh(arr.geometry(), buildingMat);
    m.castShadow = m.receiveShadow = true;
    list.push(m);
    group.add(m);
  }
  return { group, buildingsBig, buildingsSmall, uniforms, streetLights, cars: carPts };
}

class Arrays {
  pos: number[] = []; nor: number[] = []; col: number[] = []; idx: number[] = [];
  vert(x: number, y: number, z: number, n: [number, number, number], c: THREE.Color) {
    this.pos.push(x, y, z); this.nor.push(n[0], n[1], n[2]); this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Walls and a flat roof for a CCW footprint (world xy), into indexed arrays in three coordinates. */
function extrude(A: Arrays, poly: XY[], h: number, wall: THREE.Color, roof: THREE.Color) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    const n: [number, number, number] = [dy / l, 0, dx / l]; // outward (right of a->b), in three coords
    const i0 = A.vert(a.x, 0, -a.y, n, wall), i1 = A.vert(b.x, 0, -b.y, n, wall), i2 = A.vert(b.x, h, -b.y, n, wall), i3 = A.vert(a.x, h, -a.y, n, wall);
    A.idx.push(i0, i1, i2, i0, i2, i3);
  }
  const pts = poly.map(p => new THREE.Vector2(p.x, p.y));
  const base = A.pos.length / 3;
  for (const p of poly) A.vert(p.x, h, -p.y, [0, 1, 0], roof);
  for (const t of THREE.ShapeUtils.triangulateShape(pts, [])) {
    const [p0, p1, p2] = [pts[t[0]], pts[t[1]], pts[t[2]]];
    const up = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x) > 0;
    A.idx.push(base + t[0], base + (up ? t[1] : t[2]), base + (up ? t[2] : t[1]));
  }
}
