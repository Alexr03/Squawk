// @squawk/render: the "3D pixel art" airport scene (Three.js, low-res target + bloom) that crossfades into a crisp radar scope.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { AircraftView, AirportPack, VehicleView, XY } from '@squawk/sim/types';
import { FT, project } from '@squawk/sim/geo';
import { buildAirport, LC, LightSet, Y } from './world.ts';
import { aircraftGeometry, lightPoints, typeOf, vehicleGeometry } from './planes.ts';
import { DepthShader, GradeShader, lightMaterial, lightUniforms, poolMaterial } from './fx.ts';
import { Radar, type Affine } from './radar.ts';
import { sunPosition } from './sun.ts';
export { decodeScenery, type SceneryFile } from './sceneryData.ts';

export interface SceneOptions { pixelSize?: number; quality?: 'low' | 'high'; /** tilt-shift depth of field, haze and vignette */ depth?: boolean }
export interface Weather { rain: number; visM: number; cloud: number; cells?: { x: number; y: number; r: number; intensity: number }[] }
export interface Overlays { sids?: boolean; stars?: boolean; weather?: boolean; ctr?: boolean; rings?: boolean }
export interface Scene {
  setAircraft(views: AircraftView[]): void;
  setVehicles(v: VehicleView[]): void;
  setTime(unix: number): void;
  setWeather(w: Weather): void;
  setView(v: { cx: number; cy: number; mpp: number }): void;
  getView(): { cx: number; cy: number; mpp: number };
  setGreens(paths: XY[][]): void;
  setStopBars(lit: number[]): void;
  setSelected(cs: string | null): void;
  setOverlays(o: Overlays): void;
  setRunwaysInUse(arr: string[], dep: string[]): void;
  setNight?(palette: boolean): void;
  pick(sx: number, sy: number): { cs: string } | { x: number; y: number };
  worldToScreen(p: XY): XY;
  screenToWorld(sx: number, sy: number): XY;
  resize(): void;
  render(): void;
  dispose(): void;
}

const RAD = Math.PI / 180;
const MAX_TILT = 24 * RAD;
/** How tilted the camera is at a zoom (1 = full 3D, 0 = straight down): the whole airport still reads in 3D, the radar is flat. */
const tiltK = (mpp: number) => 1 - lsmooth(1.4, 6.5, mpp);
const MAX_LIGHTS = 4096, MAX_POOLS = 512;
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lsmooth = (a: number, b: number, x: number) => smooth(Math.log(a), Math.log(b), Math.log(x));
const hashStr = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };

export function createScene(canvas: HTMLCanvasElement, packs: AirportPack[], opts: SceneOptions = {}): Scene {
  const pixelSize = opts.pixelSize ?? 3;
  const high = opts.quality !== 'low';
  const primary = packs[0];

  // ---- renderer: the canvas itself is the low-res target; CSS upscales it with nearest-neighbour
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1 / pixelSize);
  renderer.shadowMap.enabled = high;
  renderer.shadowMap.type = THREE.BasicShadowMap; // crisp pixel shadows (PCF also misbehaves here)
  canvas.style.imageRendering = 'pixelated';

  const overlay = document.createElement('canvas');
  overlay.style.cssText = 'position:absolute;pointer-events:none;z-index:3;'; // above the game's UI layer: tags sit on top of route lines
  canvas.insertAdjacentElement('afterend', overlay);
  const radar = new Radar(overlay, packs.map(p => ({ pack: p, off: project(primary.arp, p.arp) })));

  const scene = new THREE.Scene();
  const world = buildAirport(primary, renderer.capabilities.maxTextureSize);
  scene.add(world.group);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 100, 45000);
  camera.up.set(0, 0, -1);
  const sun = new THREE.DirectionalLight('#ffffff', 2);
  sun.castShadow = high;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.00003;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight('#c4d8f0', '#8a8466', 1);
  scene.add(hemi);

  // ---- dynamic objects
  const acMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const vehMat = acMat;
  const acMeshes = new Map<string, { mesh: THREE.Mesh; key: string; tug?: THREE.Mesh }>();
  const vehMeshes = new Map<string, THREE.Mesh>();

  const dynGeo = new THREE.BufferGeometry();
  const dPos = new Float32Array(MAX_LIGHTS * 3), dCol = new Float32Array(MAX_LIGHTS * 3), dSize = new Float32Array(MAX_LIGHTS);
  dynGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3).setUsage(THREE.DynamicDrawUsage));
  dynGeo.setAttribute('aColor', new THREE.BufferAttribute(dCol, 3).setUsage(THREE.DynamicDrawUsage));
  dynGeo.setAttribute('aSize', new THREE.BufferAttribute(dSize, 1).setUsage(THREE.DynamicDrawUsage));
  const dynLights = new THREE.Points(dynGeo, lightMaterial());
  dynLights.frustumCulled = false; dynLights.renderOrder = 6;
  scene.add(dynLights);

  const pools = (shape: 0 | 1) => {
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    if (shape === 1) g.translate(0, 0, -0.5); // apex at origin, extends along -Z (three forward = north)
    const m = new THREE.InstancedMesh(g, poolMaterial(shape), MAX_POOLS);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_POOLS * 3), 3);
    m.frustumCulled = false; m.count = 0; m.renderOrder = 4;
    scene.add(m);
    return m;
  };
  const roundPools = pools(0), conePools = pools(1);
  const standPools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMaterial(0), world.standPools.length);
  {
    const m = new THREE.Matrix4(), c = new THREE.Color('#ffd9a8').multiplyScalar(0.22);
    world.standPools.forEach((p, i) => {
      standPools.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, Y.pool, -p.y), new THREE.Quaternion(), new THREE.Vector3(170, 1, 170)));
      standPools.setColorAt(i, c);
    });
    standPools.frustumCulled = false; standPools.renderOrder = 4;
    scene.add(standPools);
  }

  let greens: THREE.Object3D[] = [];
  let stopBars: THREE.Points | null = null;

  // ---- post
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  const depth = new ShaderPass(DepthShader);
  if (opts.depth !== false) composer.addPass(depth);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0, 1.0);
  // tight halos: at this low resolution the default wide mips smear the whole frame
  bloom.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.35, 0.06, 0.0, 0.0];
  if (high) composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---- state
  let view = { cx: 0, cy: -700, mpp: 3 };
  let W = 1, H = 1, dpr = 1;
  let aircraft: AircraftView[] = [];
  let vehicles: VehicleView[] = [];
  let selected: string | null = null;
  let overlays: Overlays = { rings: true, ctr: true };
  let weather: Weather = { rain: 0, visM: 10000, cloud: 0 };
  let arr: string[] = primary.configs[0]?.arrivals ?? [];
  let dep: string[] = primary.configs[0]?.departures ?? [];
  let nightOverride: boolean | null = null;
  let sunEl = 30, sunAz = 180;
  let night = 0, day = 1, ctlGain = 1, baseSat = 1;
  const t0 = performance.now();
  const elevM = primary.elevationFt * FT;

  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const color = new THREE.Color();

  function updateCamera() {
    const { mpp } = view;
    const tilt = MAX_TILT * tiltK(mpp);
    // snap the camera target to the render-pixel grid so static pixels don't crawl while panning
    const step = mpp * pixelSize;
    const cx = Math.round(view.cx / step) * step, cy = Math.round(view.cy / (step / Math.cos(tilt))) * (step / Math.cos(tilt));
    camera.left = (-W / 2) * mpp; camera.right = (W / 2) * mpp;
    camera.top = (H / 2) * mpp; camera.bottom = (-H / 2) * mpp;
    const D = 20000;
    camera.position.set(cx, D * Math.cos(tilt), -cy + D * Math.sin(tilt));
    camera.lookAt(cx, 0, -cy);
    camera.near = D - 9000; camera.far = D + 3000;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  function worldToScreen(p: XY, h = 0): XY {
    tmp.set(p.x, h, -p.y).project(camera);
    return { x: ((tmp.x + 1) / 2) * W, y: ((1 - tmp.y) / 2) * H };
  }
  function screenToWorld(sx: number, sy: number): XY {
    const nx = (sx / W) * 2 - 1, ny = 1 - (sy / H) * 2;
    tmp.set(nx, ny, -1).unproject(camera);
    tmp2.set(nx, ny, 1).unproject(camera);
    const t = tmp.y / (tmp.y - tmp2.y);
    return { x: tmp.x + (tmp2.x - tmp.x) * t, y: -(tmp.z + (tmp2.z - tmp.z) * t) };
  }
  function affine(): Affine {
    const o = worldToScreen({ x: 0, y: 0 }), ex = worldToScreen({ x: 1000, y: 0 }), ey = worldToScreen({ x: 0, y: 1000 });
    return { a: (ex.x - o.x) / 1000, b: (ex.y - o.y) / 1000, c: (ey.x - o.x) / 1000, d: (ey.y - o.y) / 1000, e: o.x, f: o.y };
  }
  const heightOf = (ac: AircraftView) => (ac.onGround ? 0 : Math.max(0, ac.alt * FT - elevM));
  const screenOf = (ac: AircraftView) => worldToScreen(ac, heightOf(ac));
  const sizeOf = (ac: AircraftView) => typeOf(ac.type).lengthM / 2 / view.mpp;
  const radarFade = () => lsmooth(3, 8, view.mpp);

  function resize() {
    W = Math.max(1, canvas.clientWidth); H = Math.max(1, canvas.clientHeight);
    dpr = window.devicePixelRatio || 1;
    renderer.setSize(W, H, false);
    composer.setSize(W, H);
    radar.resize(W, H, dpr);
    Object.assign(overlay.style, { left: `${canvas.offsetLeft}px`, top: `${canvas.offsetTop}px`, width: `${W}px`, height: `${H}px` });
    updateCamera();
  }

  function applyLighting() {
    const el = sunEl;
    day = smooth(-6, 10, el);
    night = 1 - smooth(-5, 4, el);
    const cloud = Math.max(weather.cloud, weather.rain * 0.9);
    const sunI = smooth(-1, 6, el) * 3.6 * (1 + 1.6 * (1 - smooth(4, 28, el))) * (1 - 0.7 * cloud); // stylised: strong low sun
    sun.intensity = sunI;
    sun.color.set('#ff9a50').lerp(color.set('#fff3e2'), smooth(0, 22, el));
    const dir = tmp.set(Math.sin(sunAz * RAD) * Math.cos(el * RAD), Math.sin(Math.max(el, 2) * RAD), -Math.cos(sunAz * RAD) * Math.cos(el * RAD)).normalize();
    sun.userData.dir = dir.clone();
    const blue = smooth(-7, -2, el) * (1 - smooth(-1, 5, el));
    hemi.color.set('#3a4f80').lerp(color.set('#c7dbf2'), day).lerp(color.set('#5466a8'), blue * 0.7);
    hemi.groundColor.set('#141a28').lerp(color.set('#8a8466'), day);
    hemi.intensity = 1.75 + 0.6 * blue + 0.9 * cloud * day;
    // wet surfaces darken; rain also shows light reflections
    const wet = weather.rain;
    for (const s of world.surfaceMats) { s.mat.color.copy(s.base).multiplyScalar(1 - 0.38 * wet); s.mat.emissive.set('#ffb070').multiplyScalar(0.035 * night * (s.lit ?? 0)); }
    lightUniforms.uWet.value = wet * (0.4 + 0.6 * night);
    const fogAmt = Math.min(0.93, Math.max(0, (2200 - weather.visM) / 2000));
    const lightsOn = Math.max(night, smooth(0.15, 0.6, fogAmt), wet * 0.5);
    const g = 0.06 + 0.78 * lightsOn; // a touch under full: at night the field read as too bright
    for (const l of world.lights) l.material.uniforms.uGain.value = g;
    ctlGain = 0.3 + 0.7 * lightsOn;
    for (const o of [...greens, stopBars]) { const m = (o as THREE.Points | null)?.material as THREE.ShaderMaterial | undefined; if (m?.uniforms?.uGain) m.uniforms.uGain.value = ctlGain; }
    world.twyCentre.material.uniforms.uGain.value = g;
    for (const [name, p] of world.approach) p.material.uniforms.uGain.value = arr.includes(name) ? g : 0;
    (standPools.material as THREE.ShaderMaterial).uniforms.uGain.value = 0.55 * night * (1 + 0.6 * wet);
    world.buildingUniforms.uNight.value = night;
    if (world.scenery) {
      const sc = world.scenery;
      sc.uniforms.uNight.value = night; sc.uniforms.uDay.value = day;
      sc.streetLights.material.uniforms.uGain.value = Math.max(1 - smooth(-3, 5, el), smooth(0.3, 0.7, fogAmt)) * 0.9;
    }
    acMat.emissive.set('#ffe2b8').multiplyScalar(0.07 * night); // apron floodlight on airframes
    world.centrelines.material.color.set('#d9b53a').multiplyScalar(0.18 + 0.82 * day);
    grade.uniforms.uFog.value = fogAmt;
    grade.uniforms.uFogColor.value.set('#2c2e3b').lerp(color.set('#c3c9cf'), day);
    grade.uniforms.uRain.value = weather.rain;
    grade.uniforms.uCloud.value = cloud;
    grade.uniforms.uSun.value = smooth(0, 10, el);
    const golden = smooth(0, 4, el) * (1 - smooth(12, 24, el));
    baseSat = 1.08 + 0.06 * golden - 0.2 * night - 0.25 * cloud;
    grade.uniforms.uContrast.value = 1.04 + 0.08 * golden;
    bloom.strength = 0.15 + 0.2 * night + 0.5 * fogAmt;
  }

  function placeShadowCamera() {
    if (!high) return;
    const corners = [screenToWorld(0, 0), screenToWorld(W, 0), screenToWorld(0, H), screenToWorld(W, H)];
    const c = { x: corners.reduce((s, p) => s + p.x, 0) / 4, y: corners.reduce((s, p) => s + p.y, 0) / 4 };
    const R = Math.min(4000, Math.max(...corners.map(p => Math.hypot(p.x - c.x, p.y - c.y))) * 1.08 + 30);
    const texel = (2 * R) / sun.shadow.mapSize.x;
    const dir = sun.userData.dir as THREE.Vector3;
    sun.target.position.set(Math.round(c.x / texel) * texel, 0, -Math.round(c.y / texel) * texel);
    sun.position.copy(sun.target.position).addScaledVector(dir, 4000);
    const sc = sun.shadow.camera;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1000; sc.far = 7000;
    sc.updateProjectionMatrix();
    sun.shadow.normalBias = texel * 0.7;
    sun.castShadow = sunEl > 1 && view.mpp < 7;
  }

  function updateDynamic(now: number) {
    const t = (now - t0) / 1000;
    const seen = new Set<string>();
    let nl = 0, nr = 0, nc = 0;
    const light = (p: THREE.Vector3, c: THREE.Color, k: number, size: number) => {
      if (nl >= MAX_LIGHTS || k <= 0) return;
      dPos[nl * 3] = p.x; dPos[nl * 3 + 1] = p.y; dPos[nl * 3 + 2] = p.z;
      dCol[nl * 3] = c.r * k; dCol[nl * 3 + 1] = c.g * k; dCol[nl * 3 + 2] = c.b * k;
      dSize[nl++] = size;
    };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pp = new THREE.Vector3();
    const pool = (mesh: THREE.InstancedMesh, i: number, x: number, z: number, rotY: number, sx: number, sz: number, c: THREE.Color, k: number) => {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rotY);
      mesh.setMatrixAt(i, m4.compose(pp.set(x, Y.pool, z), q, sc.set(sx, 1, sz)));
      mesh.setColorAt(i, color.copy(c).multiplyScalar(k));
    };
    const navGain = 0.35 + 0.65 * night;
    const poolGain = Math.max(night, 0.15 * (1 - day)) * (1 + 0.8 * weather.rain); // wet tarmac throws light back
    for (const ac of aircraft) {
      seen.add(ac.cs);
      const key = `${ac.type}|${ac.operator}`;
      let e = acMeshes.get(ac.cs);
      if (!e) {
        const mesh = new THREE.Mesh(aircraftGeometry(ac.type, ac.operator), acMat);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.rotation.order = 'YXZ';
        scene.add(mesh);
        acMeshes.set(ac.cs, (e = { mesh, key }));
      } else if (e.key !== key) { e.mesh.geometry = aircraftGeometry(ac.type, ac.operator); e.key = key; }
      const h = heightOf(ac);
      const m = e.mesh;
      m.position.set(ac.x, h, -ac.y);
      m.rotation.y = Math.PI - ac.hdg * RAD;
      const pitch = ac.onGround || ac.gs < 30 ? 0 : Math.atan2((ac.vs * FT) / 60, ac.gs * 0.5144);
      m.rotation.x = -Math.min(0.25, Math.max(-0.1, pitch + (ac.onGround ? 0 : 0.04)));
      m.updateMatrixWorld();
      // tug
      if (ac.tug) {
        if (!e.tug) { e.tug = new THREE.Mesh(vehicleGeometry('tug'), vehMat); e.tug.castShadow = true; scene.add(e.tug); }
        const L = typeOf(ac.type).lengthM, b = ac.hdg * RAD;
        e.tug.position.set(ac.x + Math.sin(b) * (L * 0.5 + 3), 0, -(ac.y + Math.cos(b) * (L * 0.5 + 3)));
        e.tug.rotation.y = -ac.hdg * RAD;
      } else if (e.tug) { scene.remove(e.tug); e.tug = undefined; }
      // lights
      const T = typeOf(ac.type), lp = lightPoints(T), L = ac.lights;
      const ph = hashStr(ac.cs);
      const W2 = (v: THREE.Vector3) => tmp.copy(v).applyMatrix4(m.matrixWorld);
      if (L.nav) {
        light(W2(lp.left), LC.red, navGain * 0.9, 1.6);
        light(W2(lp.right), LC.green, navGain * 0.9, 1.6);
        light(W2(lp.tail), LC.white, navGain * 0.6, 1.4);
      }
      if (L.beacon && (t + ph) % 1.1 < 0.14) { light(W2(lp.beaconTop), LC.red, 1.6, 2.4); }
      if (L.strobe) { const s = (t * 0.85 + ph) % 1.2; if (s < 0.05 || (s > 0.12 && s < 0.17)) { light(W2(lp.left), LC.white, 3, 3); light(W2(lp.right), LC.white, 3, 3); } }
      if (L.landing) { for (const sg of [1, -1]) light(W2(tmp2.copy(lp.wingRoot).setX(lp.wingRoot.x * sg)), LC.white, 0.25 + 1.25 * night, 2.6); }
      if (L.taxi) light(W2(lp.nose), LC.white, 0.2 + 0.8 * night, 2);
      // light pools on the tarmac
      const b = ac.hdg * RAD, fx = Math.sin(b), fy = Math.cos(b);
      const nose = T.lengthM * 0.45;
      if (L.taxi && h < 5 && nc < MAX_POOLS)
        pool(conePools, nc++, ac.x + fx * nose, -(ac.y + fy * nose), -b, 34, 70, LC.white, 0.2 * poolGain);
      // Landing lights only light the ground in the last moments before touchdown (and on the roll), right under the nose:
      // higher up the beam lands far ahead, which looked detached from the aircraft.
      if (L.landing && h < 40 && nc < MAX_POOLS) {
        const k = (1 - h / 40) * 0.24 * poolGain, off = nose + h * 1.2;
        pool(conePools, nc++, ac.x + fx * off, -(ac.y + fy * off), -b, 50 + h * 0.5, 110 + h, LC.white, k);
      }
    }
    for (const [cs, e] of acMeshes) if (!seen.has(cs)) { scene.remove(e.mesh); if (e.tug) scene.remove(e.tug); acMeshes.delete(cs); }

    const vseen = new Set<string>();
    for (const v of vehicles) {
      vseen.add(v.id);
      let m = vehMeshes.get(v.id);
      if (!m) { m = new THREE.Mesh(vehicleGeometry(v.kind), vehMat); m.castShadow = true; scene.add(m); vehMeshes.set(v.id, m); }
      m.position.set(v.x, 0, -v.y); m.rotation.y = Math.PI - v.hdg * RAD; m.updateMatrixWorld();
      if (v.lights) {
        const on = Math.floor((t + hashStr(v.id)) * 4) % 2;
        const c = v.kind === 'fire' ? LC.blue : LC.amber, top = v.kind === 'fire' ? 4 : 2.2;
        for (const [sg, k] of [[1, on], [-1, 1 - on]]) light(tmp.set(sg * 1, top, 1.5).applyMatrix4(m.matrixWorld), c, k * 2, 1.6);
        const b = v.hdg * RAD;
        if (nc < MAX_POOLS) pool(conePools, nc++, v.x + Math.sin(b) * 3, -(v.y + Math.cos(b) * 3), -b, 10, 26, LC.white, 0.2 * poolGain);
        if (v.kind === 'fire' && nr < MAX_POOLS) pool(roundPools, nr++, v.x, -v.y, 0, 30, 30, c, 0.3 * on * poolGain);
      }
    }
    for (const [id, m] of vehMeshes) if (!vseen.has(id)) { scene.remove(m); vehMeshes.delete(id); }

    dynGeo.setDrawRange(0, nl);
    for (const k of ['position', 'aColor', 'aSize']) (dynGeo.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
    roundPools.count = nr; conePools.count = nc;
    for (const p of [roundPools, conePools]) { p.instanceMatrix.needsUpdate = true; if (p.instanceColor) p.instanceColor.needsUpdate = true; }
  }

  const api: Scene = {
    setAircraft(v) { aircraft = v; },
    setVehicles(v) { vehicles = v; },
    setTime(unix) { const s = sunPosition(unix, primary.arp.lat, primary.arp.lon); sunEl = s.el; sunAz = s.az; applyLighting(); },
    setWeather(w) { weather = w; applyLighting(); },
    setView(v) { view = { ...v, mpp: Math.min(2000, Math.max(0.05, v.mpp)) }; updateCamera(); },
    getView() { return { ...view }; },
    setGreens(paths) {
      for (const o of greens) { scene.remove(o); (o as THREE.Points).geometry.dispose(); }
      const ls = new LightSet(), seg: number[] = [];
      for (const path of paths) for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], l = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.round(l / 7.5));
        for (let k = 0; k < n; k++) ls.add({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }, Y.light + 0.1, LC.greens, 2.2);
        seg.push(a.x, Y.line + 0.02, -a.y, b.x, Y.line + 0.02, -b.y);
      }
      const pts = ls.points();
      pts.material.uniforms.uGain.value = ctlGain;
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      const line = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: new THREE.Color('#5bff8f').multiplyScalar(1.6) }));
      greens = [pts, line];
      scene.add(pts, line);
    },
    setStopBars(lit) {
      if (stopBars) { scene.remove(stopBars); stopBars.geometry.dispose(); }
      const ls = new LightSet();
      for (const id of lit) for (const p of world.stopBars.get(id) ?? []) ls.add(p, Y.light + 0.1, LC.stop, 2.2);
      const sb = ls.points(); sb.material.uniforms.uGain.value = ctlGain;
      stopBars = sb; scene.add(sb);
    },
    setSelected(cs) { selected = cs; },
    setOverlays(o) { overlays = { ...overlays, ...o }; },
    setRunwaysInUse(a, d) { arr = a; dep = d; applyLighting(); },
    setNight(p) { nightOverride = p; },
    pick(sx, sy) {
      // A click on a data tag or callsign label selects that aircraft.
      const tag = radar.tagRects.find(r => sx >= r.x - 2 && sx <= r.x + r.w + 2 && sy >= r.y - 2 && sy <= r.y + r.h + 2);
      if (tag) return { cs: tag.cs };
      const fade = radarFade();
      let best: string | null = null, bd = Infinity;
      for (const ac of aircraft) {
        const p = fade > 0.5 ? worldToScreen(ac) : screenOf(ac);
        const r = fade > 0.5 ? 14 : Math.max(10, sizeOf(ac));
        const d = Math.hypot(p.x - sx, p.y - sy);
        if (d < r && d < bd) { bd = d; best = ac.cs; }
      }
      return best ? { cs: best } : screenToWorld(sx, sy);
    },
    // Aircraft views project at their altitude in the 3D view, so rings and bubbles sit on the plane, not its shadow.
    worldToScreen: p => ('alt' in p && radarFade() <= 0.5 ? screenOf(p as AircraftView) : worldToScreen(p)),
    screenToWorld,
    resize,
    render() {
      const now = performance.now();
      const fade = radarFade();
      if (fade < 0.999) {
        updateDynamic(now);
        const flat = lsmooth(4.5, 7.5, view.mpp); // buildings fold flat only as the radar takes over
        world.buildings.scale.y = 1 - 0.97 * flat;
        if (world.scenery) {
          const sc = world.scenery;
          sc.uniforms.uTime.value = (now - t0) / 1000;
          sc.uniforms.uDetail.value = 1 - lsmooth(1, 2.5, view.mpp);
          for (const m of sc.buildingsBig) m.scale.y = 1 - 0.97 * flat;
          for (const m of sc.buildingsSmall) { m.scale.y = 1 - 0.97 * flat; m.visible = view.mpp < 4; } // LOD: houses and sheds drop out once the scope takes over
        }
        world.buildingUniforms.uDetail.value = 1 - lsmooth(1, 2.5, view.mpp);
        world.centrelines.material.opacity = (0.9 - 0.55 * lsmooth(0.8, 3, view.mpp)) * (1 - lsmooth(2.5, 6, view.mpp));
        lightUniforms.uPxPerM.value = 1 / (view.mpp * pixelSize);
        placeShadowCamera();
        const o = screenToWorld(0, H), u = screenToWorld(W, H), v = screenToWorld(0, 0);
        grade.uniforms.uO.value.set(o.x, o.y); grade.uniforms.uU.value.set(u.x - o.x, u.y - o.y); grade.uniforms.uV.value.set(v.x - o.x, v.y - o.y);
        grade.uniforms.uTime.value = (now - t0) / 1000;
        grade.uniforms.uSat.value = baseSat * (1 - fade); // the world drains to a monochrome map under the scope
        grade.uniforms.uRes.value.set(renderer.domElement.width, renderer.domElement.height);
        grade.uniforms.tDepth.value = composer.readBuffer.depthTexture;
        grade.uniforms.uDepthRange.value = camera.far - camera.near;
        const k = tiltK(view.mpp) * (1 - fade);
        depth.uniforms.uRes.value.set(renderer.domElement.width, renderer.domElement.height);
        depth.uniforms.uBlur.value = 2.0 * k;
        depth.uniforms.uHaze.value = 0.14 * k;
        depth.uniforms.uHazeColor.value.copy(grade.uniforms.uFogColor.value);
        depth.uniforms.uVignette.value = 0.35 * (1 - fade);
        grade.uniforms.uEdge.value = 1 - 0.6 * lsmooth(1.5, 5, view.mpp);
        composer.render();
      }
      radar.draw({
        w: W, h: H, dpr, M: affine(), mpp: view.mpp, fade, night: nightOverride ?? sunEl < -4, now,
        aircraft, screenOf, groundOf: p => worldToScreen(p), sizeOf, selected, overlays, arr, dep, cells: weather.cells ?? [],
      });
    },
    dispose() {
      composer.dispose();
      renderer.dispose();
      overlay.remove();
      scene.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); });
    },
  };
  applyLighting();
  resize();
  return api;
}
