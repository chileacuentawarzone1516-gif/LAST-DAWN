/**
 * Sistema de partículas billboard con POOL en anillo y un único draw call.
 * Mezcla premultiplicada: alfa de salida = a·(1 - add) → cada partícula es alfa normal o aditiva.
 * Integración en CPU sobre arrays tipados (sin asignaciones en update).
 */
import * as THREE from 'three';
import type { FxKind } from '../core/context';
import type { Vec3 } from '../core/types';
import { FOG_FADE_GLSL } from './glsl';
import type { NoiseLayers } from './noise';

/** Frames del atlas (canal RGBA): 0 punto suave, 1 humo, 2 gota, 3 destello estrella. */
const enum Frame { Dot = 0, Puff = 1, Blob = 2, Star = 3 }

interface Layer {
  count: number;
  life: [number, number];
  speed: [number, number];
  /** 0 = sigue `dir`; 1 = esfera completa. */
  spread: number;
  up: number;
  size0: [number, number];
  size1: [number, number];
  grav: number;
  drag: number;
  c0: number;
  c1: number;
  /** Multiplicador HDR del color (bloom). */
  boost: number;
  a0: number;
  a1: number;
  add: number;
  frame: Frame;
  stretch: number;
  rotVel: number;
  bounce: number;
  jitter: number;
}

const L = (o: Partial<Layer> & Pick<Layer, 'count' | 'life' | 'speed' | 'size0' | 'size1' | 'c0' | 'c1'>): Layer => ({
  spread: 0.5, up: 0, grav: 0, drag: 1, boost: 1, a0: 1, a1: 0, add: 0, frame: Frame.Puff, stretch: 0, rotVel: 0.6, bounce: 0, jitter: 0.02, ...o,
});

export const RECIPES: Record<FxKind, Layer[]> = {
  sparks: [L({ count: 9, life: [0.2, 0.5], speed: [3, 9], spread: 0.45, size0: [0.03, 0.05], size1: [0.01, 0.02], grav: 9, drag: 0.6, c0: 0xffd070, c1: 0xff5a14, boost: 3.2, add: 1, frame: Frame.Dot, stretch: 0.05, bounce: 0.35, rotVel: 0 })],
  dust: [L({ count: 5, life: [0.6, 1.1], speed: [0.6, 1.8], spread: 0.6, up: 0.4, size0: [0.12, 0.2], size1: [0.4, 0.7], grav: -0.15, drag: 2.2, c0: 0xaab2c0, c1: 0x7a8494, a0: 0.4 })],
  blood: [
    L({ count: 8, life: [0.35, 0.7], speed: [2, 5], spread: 0.5, size0: [0.03, 0.06], size1: [0.02, 0.04], grav: 12, drag: 0.4, c0: 0x8a0e0e, c1: 0x4a0606, a0: 0.95, a1: 0.6, frame: Frame.Blob, stretch: 0.03, rotVel: 0 }),
    L({ count: 3, life: [0.3, 0.55], speed: [0.5, 1.3], spread: 0.7, size0: [0.1, 0.16], size1: [0.3, 0.45], drag: 3, c0: 0x781010, c1: 0x400808, a0: 0.5 }),
  ],
  acid: [
    L({ count: 8, life: [0.4, 0.8], speed: [1.5, 4], spread: 0.6, size0: [0.04, 0.08], size1: [0.02, 0.04], grav: 8, drag: 0.5, c0: 0x9dff4a, c1: 0x3cc41c, boost: 1.6, add: 0.5, a0: 0.95, frame: Frame.Blob }),
    L({ count: 3, life: [0.5, 0.9], speed: [0.4, 1], spread: 0.8, up: 0.5, size0: [0.12, 0.2], size1: [0.4, 0.6], drag: 2, c0: 0x6ee02c, c1: 0x2e8a18, a0: 0.4, add: 0.3 }),
  ],
  explosion: [
    L({ count: 1, life: [0.14, 0.18], speed: [0, 0], size0: [4, 5], size1: [6, 7], c0: 0xffd9a0, c1: 0xff8030, boost: 5, add: 1, frame: Frame.Star, a0: 1, rotVel: 0 }),
    L({ count: 10, life: [0.35, 0.7], speed: [1, 5], spread: 1, size0: [0.9, 1.5], size1: [2.2, 3.4], drag: 3, c0: 0xffc060, c1: 0x9a3210, boost: 3.6, add: 0.9, a0: 0.9 }),
    L({ count: 24, life: [0.4, 1.0], speed: [8, 22], spread: 0.9, up: 0.3, size0: [0.05, 0.09], size1: [0.02, 0.03], grav: 10, drag: 0.5, c0: 0xffd070, c1: 0xff4a10, boost: 3.2, add: 1, frame: Frame.Dot, stretch: 0.05, bounce: 0.3, rotVel: 0 }),
    L({ count: 9, life: [1.6, 2.6], speed: [0.8, 3], spread: 0.8, up: 0.8, size0: [1.2, 2], size1: [3.5, 5.5], grav: -0.5, drag: 1.6, c0: 0x3e4452, c1: 0x22262e, a0: 0.55, jitter: 0.6 }),
    L({ count: 10, life: [0.8, 1.4], speed: [4, 9], spread: 0.15, size0: [0.6, 1], size1: [1.8, 3], drag: 2.6, c0: 0x8a8a92, c1: 0x606672, a0: 0.4, jitter: 0.8 }),
  ],
  smoke: [L({ count: 6, life: [2, 3.5], speed: [0.3, 1], spread: 0.6, up: 0.9, size0: [0.6, 0.9], size1: [1.8, 2.6], grav: -0.4, drag: 1.2, c0: 0x50565f, c1: 0x2c3038, a0: 0.4, jitter: 0.3 })],
  muzzle: [
    L({ count: 1, life: [0.045, 0.065], speed: [0, 0], size0: [0.35, 0.5], size1: [0.2, 0.3], c0: 0xffe6a0, c1: 0xffa040, boost: 5, add: 1, frame: Frame.Star, rotVel: 0 }),
    L({ count: 3, life: [0.08, 0.16], speed: [4, 10], spread: 0.25, size0: [0.025, 0.04], size1: [0.01, 0.02], drag: 1, c0: 0xffe090, c1: 0xff7020, boost: 3, add: 1, frame: Frame.Dot, stretch: 0.05, rotVel: 0 }),
    L({ count: 2, life: [0.5, 0.9], speed: [0.5, 1.5], spread: 0.35, size0: [0.05, 0.08], size1: [0.25, 0.4], drag: 2.5, c0: 0x9098a8, c1: 0x606878, a0: 0.3 }),
  ],
  heliDust: [L({ count: 8, life: [1.2, 2.2], speed: [5, 11], spread: 0.08, size0: [1.1, 1.8], size1: [3.5, 5], drag: 1.4, c0: 0x8a8272, c1: 0x5c5a54, a0: 0.34, jitter: 0.5 })],
  toxic: [L({ count: 6, life: [1.4, 2.4], speed: [0.3, 0.9], spread: 0.8, up: 0.6, size0: [0.5, 0.8], size1: [1.3, 1.8], grav: -0.25, drag: 1.5, c0: 0x78ff46, c1: 0x2c7a20, boost: 1.4, add: 0.6, a0: 0.4, jitter: 0.4 })],
};

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aVel;
attribute vec4 aParam;
attribute vec3 aColor;
attribute vec2 aFrame;
varying vec2 vUv;
varying vec3 vColor;
varying vec2 vAlpha;
varying float vFrame;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(aPos, 1.0);
  vec2 corner = position.xy;
  float s = aParam.x;
  vec2 off;
  if (aFrame.y > 0.0) {
    vec3 vv = mat3(viewMatrix) * aVel;
    float l2 = length(vv.xy);
    vec2 d = l2 > 1e-3 ? vv.xy / l2 : vec2(0.0, 1.0);
    float len = s * (1.0 + aFrame.y * length(vv) * 8.0);
    off = d * corner.y * len + vec2(-d.y, d.x) * corner.x * s;
  } else {
    float c = cos(aParam.y);
    float sn = sin(aParam.y);
    off = vec2(c * corner.x - sn * corner.y, sn * corner.x + c * corner.y) * s;
  }
  mvPosition.xy += off;
  gl_Position = projectionMatrix * mvPosition;
  vUv = corner + 0.5;
  vColor = aColor;
  vAlpha = aParam.zw;
  vFrame = aFrame.x;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tAtlas;
varying vec2 vUv;
varying vec3 vColor;
varying vec2 vAlpha;
varying float vFrame;
#include <fog_pars_fragment>
${FOG_FADE_GLSL}
void main() {
  vec4 t = texture2D(tAtlas, vUv);
  float m = vFrame < 0.5 ? t.r : vFrame < 1.5 ? t.g : vFrame < 2.5 ? t.b : t.a;
  float a = m * vAlpha.x;
  float f = fogVisibility();
  gl_FragColor = vec4(vColor * a * f, a * (1.0 - vAlpha.y) * f);
}
`;

/** Atlas RGBA 128² con 4 sprites (uno por canal). */
export function createParticleAtlas(layers: NoiseLayers): THREE.DataTexture {
  const S = 128;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = (x + 0.5) / S * 2 - 1;
      const ny = (y + 0.5) / S * 2 - 1;
      const r = Math.hypot(nx, ny);
      const n = layers.mid[((y * 2) << 8) | (x * 2)] as number;
      const n2 = layers.hi[((y * 2 + 60) << 8) | ((x * 2 + 30) & 255)] as number;
      const dot = Math.max(0, 1 - r) ** 2;
      const puffR = r + (n - 0.5) * 0.7;
      const puff = Math.max(0, 1 - puffR) ** 1.3 * 1.15;
      const blobR = r * (1 + (n2 - 0.5) * 0.9);
      const blob = blobR < 0.8 ? 1 : Math.max(0, 1 - (blobR - 0.8) / 0.2);
      const star = Math.exp(-r * r * 26) + 0.55 * Math.exp(-Math.abs(nx) * 22 - ny * ny * 3) + 0.55 * Math.exp(-Math.abs(ny) * 22 - nx * nx * 3);
      const o = (y * S + x) * 4;
      data[o] = Math.min(255, dot * 255);
      data[o + 1] = Math.min(255, puff * 255);
      data[o + 2] = Math.min(255, blob * 255) * (r < 1 ? 1 : 0);
      data[o + 3] = Math.min(255, star * (r < 1 ? 1 : Math.max(0, 2 - r)) * 255);
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Uniforms de niebla + propios SIN clonar (merge clonaría texturas y el uniform de tiempo compartido). */
export function fogUniforms(extra: Record<string, THREE.IUniform>): Record<string, THREE.IUniform> {
  return { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...extra };
}

export function makeQuadGeometry(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

const HEX = new THREE.Color();
const c0 = [0, 0, 0];
const c1 = [0, 0, 0];
const setRgb = (hex: number, boost: number, out: number[]): void => {
  HEX.set(hex);
  out[0] = HEX.r * boost;
  out[1] = HEX.g * boost;
  out[2] = HEX.b * boost;
};
const rr = (r: [number, number]): number => r[0] + Math.random() * (r[1] - r[0]);

export interface Particles {
  readonly mesh: THREE.Mesh;
  emit(kind: FxKind, pos: Vec3, dir: Vec3 | undefined, scale: number, tint?: number): void;
  update(dt: number): void;
  setCapacity(n: number): void;
  clear(): void;
  readonly alive: number;
  dispose(): void;
}

export function createParticles(maxCount: number, atlas: THREE.Texture): Particles {
  const N = maxCount;
  // Estado por partícula (SoA).
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const age = new Float32Array(N);
  const life = new Float32Array(N); // 0 = libre
  const s0 = new Float32Array(N);
  const s1 = new Float32Array(N);
  const rot = new Float32Array(N);
  const rotV = new Float32Array(N);
  const drag = new Float32Array(N);
  const grav = new Float32Array(N);
  const bounce = new Float32Array(N);
  const col0 = new Float32Array(N * 3);
  const col1 = new Float32Array(N * 3);
  const al0 = new Float32Array(N);
  const al1 = new Float32Array(N);
  const add = new Float32Array(N);
  const frame = new Float32Array(N);
  const stretch = new Float32Array(N);

  const aPos = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const aVel = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const aParam = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const aColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const aFrame = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2).setUsage(THREE.DynamicDrawUsage);
  const geo = makeQuadGeometry();
  geo.setAttribute('aPos', aPos);
  geo.setAttribute('aVel', aVel);
  geo.setAttribute('aParam', aParam);
  geo.setAttribute('aColor', aColor);
  geo.setAttribute('aFrame', aFrame);
  geo.instanceCount = N;

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: fogUniforms({ tAtlas: { value: atlas } }),
    transparent: true,
    depthWrite: false,
    fog: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'fx-particles';
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.visible = false;

  let cap = N;
  let head = 0;
  let alive = 0;

  const spawn = (layer: Layer, px: number, py: number, pz: number, dx: number, dy: number, dz: number, scale: number, tint: number): void => {
    const i = head;
    head = (head + 1) % cap;
    if (life[i] === 0) alive++;
    // Dirección: cono alrededor de `dir` mezclado con una esfera aleatoria.
    let rx = Math.random() * 2 - 1;
    let ry = Math.random() * 2 - 1;
    let rz = Math.random() * 2 - 1;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const sp = rr(layer.speed) * Math.sqrt(scale);
    const k = layer.spread;
    const vx = (dx * (1 - k * 0.5) + rx * k) * sp;
    const vy = (dy * (1 - k * 0.5) + ry * k + layer.up) * sp;
    const vz = (dz * (1 - k * 0.5) + rz * k) * sp;
    const j = layer.jitter * scale;
    pos[i * 3] = px + (Math.random() - 0.5) * j;
    pos[i * 3 + 1] = py + (Math.random() - 0.5) * j;
    pos[i * 3 + 2] = pz + (Math.random() - 0.5) * j;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    age[i] = 0;
    life[i] = rr(layer.life);
    s0[i] = rr(layer.size0) * scale;
    s1[i] = rr(layer.size1) * scale;
    rot[i] = Math.random() * 6.283;
    rotV[i] = (Math.random() - 0.5) * 2 * layer.rotVel;
    drag[i] = layer.drag;
    grav[i] = layer.grav;
    bounce[i] = layer.bounce;
    setRgb(tint >= 0 && layer.frame === Frame.Puff ? tint : layer.c0, layer.boost, c0);
    setRgb(tint >= 0 && layer.frame === Frame.Puff ? tint : layer.c1, layer.boost, c1);
    col0[i * 3] = c0[0] as number; col0[i * 3 + 1] = c0[1] as number; col0[i * 3 + 2] = c0[2] as number;
    col1[i * 3] = c1[0] as number; col1[i * 3 + 1] = c1[1] as number; col1[i * 3 + 2] = c1[2] as number;
    al0[i] = layer.a0;
    al1[i] = layer.a1;
    add[i] = layer.add;
    frame[i] = layer.frame;
    stretch[i] = layer.stretch;
  };

  const kill = (i: number): void => {
    life[i] = 0;
    alive--;
    const p = aParam.array as Float32Array;
    p[i * 4] = 0;
    p[i * 4 + 2] = 0;
  };

  return {
    mesh,
    get alive() {
      return alive;
    },
    emit(kind, p, dir, scale, tint = -1) {
      let dx = 0, dy = 1, dz = 0;
      if (dir) {
        const l = Math.hypot(dir.x, dir.y, dir.z);
        if (l > 1e-6) { dx = dir.x / l; dy = dir.y / l; dz = dir.z / l; }
      }
      for (const layer of RECIPES[kind]) {
        const n = Math.max(1, Math.round(layer.count * scale));
        for (let q = 0; q < n; q++) spawn(layer, p.x, p.y, p.z, dx, dy, dz, scale, tint);
      }
      mesh.visible = true;
    },
    update(dt) {
      if (alive === 0) {
        mesh.visible = false;
        return;
      }
      const P = aPos.array as Float32Array;
      const V = aVel.array as Float32Array;
      const A = aParam.array as Float32Array;
      const C = aColor.array as Float32Array;
      const F = aFrame.array as Float32Array;
      for (let i = 0; i < cap; i++) {
        if (life[i] === 0) continue;
        const a = (age[i] as number) + dt;
        const lf = life[i] as number;
        if (a >= lf) {
          kill(i);
          continue;
        }
        age[i] = a;
        const k = Math.max(0, 1 - (drag[i] as number) * dt);
        const i3 = i * 3;
        let vx = (vel[i3] as number) * k;
        let vy = ((vel[i3 + 1] as number) - (grav[i] as number) * dt) * k;
        let vz = (vel[i3 + 2] as number) * k;
        let py = (pos[i3 + 1] as number) + vy * dt;
        if (py < 0.02) {
          const b = bounce[i] as number;
          py = 0.02;
          if (b > 0) vy = -vy * b;
          else if (grav[i] as number > 0) { vx = 0; vy = 0; vz = 0; }
          else vy = 0;
        }
        vel[i3] = vx; vel[i3 + 1] = vy; vel[i3 + 2] = vz;
        const px = (pos[i3] as number) + vx * dt;
        const pz = (pos[i3 + 2] as number) + vz * dt;
        pos[i3] = px; pos[i3 + 1] = py; pos[i3 + 2] = pz;
        rot[i] = (rot[i] as number) + (rotV[i] as number) * dt;
        const t = a / lf;
        const e = 1 - (1 - t) * (1 - t);
        const fadeIn = Math.min(1, a * 30);
        P[i3] = px; P[i3 + 1] = py; P[i3 + 2] = pz;
        V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz;
        A[i * 4] = (s0[i] as number) + ((s1[i] as number) - (s0[i] as number)) * e;
        A[i * 4 + 1] = rot[i] as number;
        A[i * 4 + 2] = ((al0[i] as number) + ((al1[i] as number) - (al0[i] as number)) * t) * fadeIn;
        A[i * 4 + 3] = add[i] as number;
        C[i3] = (col0[i3] as number) + ((col1[i3] as number) - (col0[i3] as number)) * t;
        C[i3 + 1] = (col0[i3 + 1] as number) + ((col1[i3 + 1] as number) - (col0[i3 + 1] as number)) * t;
        C[i3 + 2] = (col0[i3 + 2] as number) + ((col1[i3 + 2] as number) - (col0[i3 + 2] as number)) * t;
        F[i * 2] = frame[i] as number;
        F[i * 2 + 1] = stretch[i] as number;
      }
      aPos.needsUpdate = true;
      aVel.needsUpdate = true;
      aParam.needsUpdate = true;
      aColor.needsUpdate = true;
      aFrame.needsUpdate = true;
    },
    setCapacity(n) {
      cap = Math.max(1, Math.min(N, n));
      geo.instanceCount = cap;
      if (head >= cap) head = 0;
      for (let i = cap; i < N; i++) if (life[i] !== 0) kill(i);
    },
    clear() {
      for (let i = 0; i < N; i++) if (life[i] !== 0) kill(i);
      alive = 0;
      mesh.visible = false;
    },
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}
