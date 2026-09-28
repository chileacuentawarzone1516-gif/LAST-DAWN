/**
 * Decals (agujeros, sangre, chamusquina, ácido) y trazadores: pools en anillo, un draw call
 * cada uno. El tiempo vive en un uniform compartido: el desvanecimiento y el crecimiento se
 * calculan en el shader, así que en reposo no hay coste de CPU ni subidas a la GPU.
 */
import * as THREE from 'three';
import type { Vec3 } from '../core/types';
import { FOG_FADE_GLSL } from './glsl';
import type { NoiseLayers } from './noise';
import { fogUniforms, makeQuadGeometry } from './fxParticles';

export type DecalKind = 'bullet' | 'blood' | 'scorch' | 'acid';
export const DECAL_FRAME: Record<DecalKind, number> = { bullet: 0, blood: 1, scorch: 2, acid: 3 };
const DECAL_LIFE: Record<DecalKind, number> = { bullet: 70, blood: 45, scorch: 90, acid: 25 };

export interface TimeUniform {
  value: number;
}

// ── Decals ──────────────────────────────────────────────────────────────────
const DECAL_VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec4 aA;   // tamaño, rotación, frame, nacimiento
attribute vec2 aB;   // vida, duración del crecimiento
uniform float uTime;
varying vec2 vUv;
varying float vFrame;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  float age = uTime - aA.w;
  float fade = clamp((aB.x - age) / max(aB.x * 0.2, 0.001), 0.0, 1.0);
  float grow = aB.y > 0.0 ? mix(0.35, 1.0, smoothstep(0.0, 1.0, age / aB.y)) : 1.0;
  vAlpha = (age < 0.0 || fade <= 0.0) ? 0.0 : fade;
  vec3 n = normalize(aNormal);
  vec3 ref = abs(n.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 t = normalize(cross(ref, n));
  vec3 b = cross(n, t);
  float c = cos(aA.y);
  float s = sin(aA.y);
  vec3 tt = t * c + b * s;
  vec3 bb = -t * s + b * c;
  vec2 q = position.xy * aA.x * grow;
  float dist = length(aPos - cameraPosition);
  vec3 wp = aPos + n * (0.008 + dist * 0.0006) + tt * q.x + bb * q.y;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  if (vAlpha <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vUv = position.xy + 0.5;
  vFrame = aA.z;
  #include <fog_vertex>
}
`;

const DECAL_FRAG = /* glsl */ `
uniform sampler2D tAtlas;
varying vec2 vUv;
varying float vFrame;
varying float vAlpha;
#include <fog_pars_fragment>
${FOG_FADE_GLSL}
void main() {
  vec2 cell = vec2(mod(vFrame, 2.0), floor(vFrame / 2.0));
  vec4 t = texture2D(tAtlas, (vUv + cell) * 0.5);
  float a = t.a * vAlpha * fogVisibility();
  vec3 col = t.rgb * (vFrame > 2.5 ? 1.8 : 1.0);
  gl_FragColor = vec4(col, a);
}
`;

/** Atlas 2×2 (128 px por celda) RGBA: agujero de bala, sangre, chamusquina, ácido. */
export function createDecalAtlas(layers: NoiseLayers): THREE.DataTexture {
  const C = 128;
  const S = C * 2;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const cx = x < C ? 0 : 1;
      const cy = y < C ? 0 : 1; // fila 0 del array = abajo (v = 0)
      const lx = (x % C) / C * 2 - 1;
      const ly = (y % C) / C * 2 - 1;
      const r = Math.hypot(lx, ly);
      const ang = Math.atan2(ly, lx);
      const n = layers.mid[(((y % C) * 2) << 8) | ((x % C) * 2)] as number;
      const n2 = layers.hi[(((y % C) * 2 + 77) << 8) | (((x % C) * 2 + 33) & 255)] as number;
      let R = 0, G = 0, B = 0, A = 0;
      const frame = cy * 2 + cx;
      if (frame === 0) {
        // Agujero: núcleo oscuro, zona dañada irregular y grietas radiales.
        const rad = r + (n - 0.5) * 0.35;
        const hole = rad < 0.16 ? 1 : 0;
        const dmg = Math.max(0, 1 - rad / 0.62);
        const crack = Math.pow(Math.abs(Math.sin(ang * 5.5 + n * 6)), 40) * Math.max(0, 1 - r) * 0.7;
        A = Math.min(1, hole + dmg * 0.75 + crack);
        const v = hole ? 8 : 34 + n2 * 20;
        R = v; G = v; B = v + 3;
      } else if (frame === 1) {
        const rad = r * (1 + (n - 0.5) * 0.9);
        const main = rad < 0.42 ? 1 : Math.max(0, 1 - (rad - 0.42) / 0.12);
        const dr = Math.hypot(lx - Math.cos(n * 40) * 0.7, ly - Math.sin(n2 * 40) * 0.7);
        const drop = dr < 0.09 ? 1 : 0;
        A = Math.min(1, Math.max(main, drop) * 0.92) * (r < 1 ? 1 : 0);
        R = 96 - n * 28; G = 8; B = 8;
      } else if (frame === 2) {
        const rad = r + (n - 0.5) * 0.5;
        A = Math.max(0, 1 - rad) ** 1.1 * 0.9;
        R = 10 + n2 * 14; G = 9 + n2 * 10; B = 9 + n2 * 8;
      } else {
        const rad = r * (1 + (n - 0.5) * 0.8);
        const main = rad < 0.5 ? 1 : Math.max(0, 1 - (rad - 0.5) / 0.25);
        A = main * 0.85 * (r < 1 ? 1 : 0);
        R = 90 + n2 * 60; G = 210 + n2 * 40; B = 40;
      }
      const o = (y * S + x) * 4;
      data[o] = R; data[o + 1] = G; data[o + 2] = B; data[o + 3] = Math.max(0, Math.min(255, A * 255));
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export interface Decals {
  readonly mesh: THREE.Mesh;
  add(kind: DecalKind, p: Vec3, n: Vec3, size: number, grow?: number): void;
  setCapacity(n: number): void;
  clear(): void;
  dispose(): void;
}

export function createDecals(maxCount: number, atlas: THREE.Texture, time: TimeUniform): Decals {
  const N = maxCount;
  const aPos = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const aNormal = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const aA = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const aB = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2).setUsage(THREE.DynamicDrawUsage);
  // Nacimiento en -1e9: todo el pool empieza «no nacido» (alfa 0).
  for (let i = 0; i < N; i++) (aA.array as Float32Array)[i * 4 + 3] = 1e9;
  const geo = makeQuadGeometry();
  geo.setAttribute('aPos', aPos);
  geo.setAttribute('aNormal', aNormal);
  geo.setAttribute('aA', aA);
  geo.setAttribute('aB', aB);
  geo.instanceCount = N;
  const material = new THREE.ShaderMaterial({
    vertexShader: DECAL_VERT,
    fragmentShader: DECAL_FRAG,
    uniforms: fogUniforms({ tAtlas: { value: atlas }, uTime: time as THREE.IUniform }),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'fx-decals';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  let cap = N;
  let head = 0;

  return {
    mesh,
    add(kind, p, n, size, grow = 0) {
      const i = head;
      head = (head + 1) % cap;
      const P = aPos.array as Float32Array;
      const Nn = aNormal.array as Float32Array;
      const A = aA.array as Float32Array;
      const B = aB.array as Float32Array;
      P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z;
      Nn[i * 3] = n.x; Nn[i * 3 + 1] = n.y; Nn[i * 3 + 2] = n.z;
      A[i * 4] = size;
      A[i * 4 + 1] = Math.random() * 6.283;
      A[i * 4 + 2] = DECAL_FRAME[kind];
      A[i * 4 + 3] = time.value;
      B[i * 2] = DECAL_LIFE[kind];
      B[i * 2 + 1] = grow;
      aPos.needsUpdate = true;
      aNormal.needsUpdate = true;
      aA.needsUpdate = true;
      aB.needsUpdate = true;
    },
    setCapacity(n) {
      cap = Math.max(1, Math.min(N, n));
      geo.instanceCount = cap;
      if (head >= cap) head = 0;
    },
    clear() {
      const A = aA.array as Float32Array;
      for (let i = 0; i < N; i++) A[i * 4 + 3] = 1e9;
      aA.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}

// ── Trazadores ──────────────────────────────────────────────────────────────
const TRACER_VERT = /* glsl */ `
attribute vec3 aFrom;
attribute vec3 aTo;
attribute vec4 aT;     // nacimiento, velocidad, longitud de cola, ancho
attribute vec3 aColor;
uniform float uTime;
uniform float uViewH;
varying vec2 vQ;
varying vec3 vColor;
varying float vA;
void main() {
  vec3 seg = aTo - aFrom;
  float total = length(seg);
  vec3 dir = seg / max(total, 1e-4);
  float age = uTime - aT.x;
  float head = min(age * aT.y, total + aT.z);
  float tail = clamp(head - aT.z, 0.0, total);
  float headC = min(head, total);
  float along = mix(tail, headC, position.y + 0.5);
  vec3 P = aFrom + dir * along;
  vec3 toCam = cameraPosition - P;
  vec3 side = normalize(cross(dir, toCam) + vec3(1e-6));
  float depth = -(viewMatrix * vec4(P, 1.0)).z;
  float pxW = 2.0 / (projectionMatrix[1][1] * uViewH) * max(depth, 0.1) * 1.4;
  float w = max(aT.w, pxW);
  vec3 wp = P + side * position.x * w;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  float alive = (age >= 0.0 && tail < total - 0.001) ? 1.0 : 0.0;
  if (alive < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vQ = vec2(position.x * 2.0, position.y + 0.5);
  vColor = aColor;
  vA = min(1.0, aT.w / w) * smoothstep(1.0, 7.0, along) * (1.0 - smoothstep(0.75, 1.0, tail / max(total, 1e-3)));
}
`;

const TRACER_FRAG = /* glsl */ `
varying vec2 vQ;
varying vec3 vColor;
varying float vA;
void main() {
  float across = 1.0 - smoothstep(0.0, 1.0, abs(vQ.x));
  float along = pow(vQ.y, 1.6);
  float a = across * along * vA;
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

export interface Tracers {
  readonly mesh: THREE.Mesh;
  add(from: Vec3, to: Vec3, color: THREE.Color, gain: number): void;
  setViewportHeight(px: number): void;
  clear(): void;
  dispose(): void;
}

const TRACER_SPEED = 420;
const TRACER_TAIL = 7;
const TRACER_WIDTH = 0.022;

export function createTracers(count: number, time: TimeUniform): Tracers {
  const N = count;
  const aFrom = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const aTo = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const aT = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const aColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < N; i++) (aT.array as Float32Array)[i * 4] = 1e9;
  const geo = makeQuadGeometry();
  geo.setAttribute('aFrom', aFrom);
  geo.setAttribute('aTo', aTo);
  geo.setAttribute('aT', aT);
  geo.setAttribute('aColor', aColor);
  geo.instanceCount = N;
  const viewH: THREE.IUniform<number> = { value: 540 };
  const material = new THREE.ShaderMaterial({
    vertexShader: TRACER_VERT,
    fragmentShader: TRACER_FRAG,
    uniforms: { uTime: time as THREE.IUniform, uViewH: viewH },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'fx-tracers';
  mesh.frustumCulled = false;
  mesh.renderOrder = 11;
  let head = 0;
  return {
    mesh,
    add(from, to, color, gain) {
      const i = head;
      head = (head + 1) % N;
      const F = aFrom.array as Float32Array;
      const T = aTo.array as Float32Array;
      const A = aT.array as Float32Array;
      const C = aColor.array as Float32Array;
      F[i * 3] = from.x; F[i * 3 + 1] = from.y; F[i * 3 + 2] = from.z;
      T[i * 3] = to.x; T[i * 3 + 1] = to.y; T[i * 3 + 2] = to.z;
      A[i * 4] = time.value;
      A[i * 4 + 1] = TRACER_SPEED;
      A[i * 4 + 2] = TRACER_TAIL;
      A[i * 4 + 3] = TRACER_WIDTH;
      C[i * 3] = color.r * gain; C[i * 3 + 1] = color.g * gain; C[i * 3 + 2] = color.b * gain;
      aFrom.needsUpdate = true;
      aTo.needsUpdate = true;
      aT.needsUpdate = true;
      aColor.needsUpdate = true;
    },
    setViewportHeight(px) {
      viewH.value = Math.max(1, px);
    },
    clear() {
      const A = aT.array as Float32Array;
      for (let i = 0; i < N; i++) A[i * 4] = 1e9;
      aT.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}
