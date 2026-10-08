// Shaders: glowing light points, ground light pools, and the low-res grade pass (fog, rain, cloud shadows).
import * as THREE from 'three';

/** Shared per-frame uniforms for every light material. */
export const lightUniforms = {
  uPxPerM: { value: 1 },
  uWet: { value: 0 },
};

/** Additive HDR points sized in metres, clamped to 1..6 render pixels. Per-material gain. */
export function lightMaterial(gain = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...lightUniforms, uGain: { value: gain } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aSize;
      uniform float uPxPerM, uGain, uWet;
      varying vec3 vColor; varying float vSize;
      void main() {
        vColor = aColor * uGain;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        float s = clamp(aSize * uPxPerM, 1.0, 5.0);
        vSize = s;
        gl_PointSize = s * (1.0 + uWet * 2.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uWet;
      varying vec3 vColor; varying float vSize;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = vSize / (vSize * (1.0 + uWet * 2.0)) * 0.5; // core radius in point space
        float k = 0.0;
        if (max(abs(c.x), abs(c.y)) <= r + 0.001 || vSize < 2.5 && uWet < 0.01) k = 1.0;
        else if (vSize >= 2.5 && length(c) < r) k = 1.0;
        // wet tarmac: a short reflection streak below the light (screen-down)
        if (uWet > 0.0 && abs(c.x) < r * 0.6 && c.y > 0.0) k = max(k, uWet * 0.35 * (1.0 - c.y * 2.0));
        if (k <= 0.0) discard;
        gl_FragColor = vec4(vColor * k, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Ground light pools (instanced quads). shape 0 = round flood, 1 = forward cone (apex at origin, +Z forward). */
export function poolMaterial(shape: 0 | 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uGain: { value: 1 } },
    defines: { SHAPE: shape },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vCol;
      void main() {
        vUv = uv;
        vCol = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uGain;
      varying vec2 vUv; varying vec3 vCol;
      void main() {
        float a;
        #if SHAPE == 0
          float d = length(vUv - 0.5) * 2.0;
          a = pow(max(0.0, 1.0 - d), 1.6);
        #else
          float v = vUv.y, u = abs(vUv.x - 0.5);
          float w = 0.06 + 0.44 * v;
          a = step(u, w) * pow(1.0 - v, 1.3) * smoothstep(0.0, 0.08, v) * (1.0 - u / w * 0.5);
        #endif
        // ordered (Bayer 4x4) dither into 5 bands: a pixel-art falloff without visible rings
        ivec2 q = ivec2(mod(gl_FragCoord.xy, 4.0));
        int i = q.x + q.y * 4;
        float bayer = float(i == 0 ? 0 : i == 1 ? 8 : i == 2 ? 2 : i == 3 ? 10 : i == 4 ? 12 : i == 5 ? 4 : i == 6 ? 14 : i == 7 ? 6 : i == 8 ? 3 : i == 9 ? 11 : i == 10 ? 1 : i == 11 ? 9 : i == 12 ? 15 : i == 13 ? 7 : i == 14 ? 13 : 5) / 16.0;
        a = floor(a * 5.0 + bayer) / 5.0;
        if (a <= 0.0) discard;
        gl_FragColor = vec4(vCol * a * uGain, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Grade pass at render resolution. World position of a pixel = uO + uv.x * uU + uv.y * uV (ortho => affine). */
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uO: { value: new THREE.Vector2() }, uU: { value: new THREE.Vector2() }, uV: { value: new THREE.Vector2() },
    uTime: { value: 0 },
    uFog: { value: 0 }, uFogColor: { value: new THREE.Color() },
    uRain: { value: 0 },
    uCloud: { value: 0 }, uSun: { value: 1 },
    uRes: { value: new THREE.Vector2(1, 1) },
    tDepth: { value: null as THREE.Texture | null }, uDepthRange: { value: 12000 }, uEdge: { value: 1 },
    uSat: { value: 1 }, uContrast: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uO, uU, uV, uRes;
    uniform float uTime, uFog, uRain, uCloud, uSun;
    uniform vec3 uFogColor;
    uniform sampler2D tDepth; uniform float uDepthRange, uEdge, uSat, uContrast;
    varying vec2 vUv;
    float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
    }
    float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.1 + 7.3) * 0.3 + vnoise(p * 4.3 + 2.1) * 0.15; }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 w = uO + vUv.x * uU + vUv.y * uV;
      float lum = max(c.r, max(c.g, c.b));
      float glow = smoothstep(1.2, 2.5, lum); // HDR lights punch through fog and cloud shade
      // pixel-art edges from depth: dark outline outside objects, a faint rim inside
      vec2 tx = 1.0 / uRes;
      float dC = texture2D(tDepth, vUv).r;
      float d1 = texture2D(tDepth, vUv + vec2(tx.x, 0.0)).r, d2 = texture2D(tDepth, vUv - vec2(tx.x, 0.0)).r;
      float d3 = texture2D(tDepth, vUv + vec2(0.0, tx.y)).r, d4 = texture2D(tDepth, vUv - vec2(0.0, tx.y)).r;
      float th = 1.2 / uDepthRange;
      float outline = step(th, dC - min(min(d1, d2), min(d3, d4)));
      float rim = step(th, max(d3, d1) - dC) * (1.0 - outline);
      c.rgb *= (1.0 - outline * 0.55 * uEdge * (1.0 - glow)) * (1.0 + rim * 0.14 * uEdge);
      if (uCloud > 0.0) {
        float n = fbm(w / 1400.0 + vec2(uTime * 0.004, uTime * 0.0015));
        c.rgb *= 1.0 - uCloud * uSun * 0.38 * smoothstep(0.42, 0.62, n) * (1.0 - glow);
      }
      if (uFog > 0.0) {
        float n = fbm(w / 600.0 + vec2(uTime * 0.006, -uTime * 0.002));
        float f = clamp(uFog * (0.72 + 0.45 * n), 0.0, 0.97);
        c.rgb = mix(c.rgb, uFogColor, f * (1.0 - glow * 0.75));
      }
      if (uRain > 0.0) {
        vec2 p = floor(vUv * uRes);
        float col = p.x + floor(p.y * 0.35);
        float y = p.y + uTime * 90.0 + h21(vec2(col, 1.7)) * 300.0;
        float s = step(fract(y / 37.0), 0.16) * step(h21(vec2(col, 9.1)), uRain * 0.4);
        c.rgb += s * (vec3(0.02, 0.025, 0.03) + c.rgb * 0.45); // streaks pick up the scene's own light
      }
      // time-of-day grade (saturation/contrast around mid grey, in linear space)
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = max(vec3(0.0), mix(vec3(l), c.rgb, uSat));
      c.rgb = max(vec3(0.0), (c.rgb - 0.18) * uContrast + 0.18);
      gl_FragColor = c;
    }`,
};

/** Diorama depth: tilt-shift blur away from a sharp band through the middle of the screen, haze toward the horizon (the top of
 *  the tilted view is farther away) and a soft vignette. All three scale with how tilted the camera is. */
export const DepthShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uBlur: { value: 0 },          // max blur radius in render pixels
    uHaze: { value: 0 }, uHazeColor: { value: new THREE.Color() },
    uVignette: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uBlur, uHaze, uVignette;
    uniform vec3 uHazeColor;
    varying vec2 vUv;
    void main() {
      // Sharp band a little below centre (where the eye rests on a tilted view), blurring toward top and bottom.
      float d = vUv.y > 0.46 ? (vUv.y - 0.46) / 0.54 : (0.46 - vUv.y) / 0.46;
      float r = uBlur * smoothstep(0.28, 1.0, d) * (vUv.y > 0.46 ? 1.0 : 0.75);
      vec4 c = texture2D(tDiffuse, vUv);
      if (r > 0.35) {
        vec4 acc = c; float n = 1.0;
        for (int i = 1; i < 16; i++) {
          float a = float(i) * 2.39996, rr = sqrt(float(i) / 15.0) * r;
          acc += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * rr / uRes); n += 1.0;
        }
        c = acc / n;
      }
      c.rgb = mix(c.rgb, uHazeColor, uHaze * smoothstep(0.45, 1.05, vUv.y));
      vec2 p = vUv - 0.5;
      c.rgb *= 1.0 - uVignette * smoothstep(0.18, 0.62, dot(p, p) * 1.6);
      gl_FragColor = c;
    }`,
};
