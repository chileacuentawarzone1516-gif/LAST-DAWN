/**
 * Halos aditivos baratos: un único InstancedMesh de billboards con shader propio. El parpadeo, el
 * pulso y el titileo se calculan en la GPU (uniform de tiempo), sin coste por frame en la CPU.
 */
import * as THREE from 'three';
import type { GlowSpec } from './types';

const KIND: Record<GlowSpec['kind'], number> = { steady: 0, blink: 1, flicker: 2, pulse: 3 };

const VERT = /* glsl */ `
  attribute vec3 aOffset;
  attribute vec3 aColor;
  attribute vec4 aParams; // size, kind, rate, phase
  attribute float aIntensity;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vUv = position.xy * 2.0;
    vColor = aColor;
    float t = uTime * aParams.z + aParams.w;
    float k = aParams.y;
    float f = 1.0;
    if (k > 0.5 && k < 1.5) f = step(fract(t), 0.35);
    else if (k > 1.5 && k < 2.5) f = 0.55 + 0.45 * hash(floor(t * 6.0) + aParams.w * 13.0) * (0.6 + 0.4 * sin(t * 40.0));
    else if (k > 2.5) f = 0.55 + 0.45 * sin(t * 6.2831);
    vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
    float dist = length(mv.xyz);
    // desvanece de lejos y evita halos enormes pegados a la cámara
    float fade = smoothstep(260.0, 120.0, dist) * smoothstep(0.6, 3.0, dist);
    vAlpha = f * aIntensity * fade;
    mv.xy += position.xy * aParams.x;
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(vUv);
    if (d > 1.0 || vAlpha < 0.003) discard;
    float core = exp(-d * d * 14.0);
    float halo = pow(1.0 - d, 2.4) * 0.55;
    float a = (core + halo) * vAlpha;
    gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.6) * a, a);
  }
`;

export interface GlowSystem {
  mesh: THREE.Mesh | null;
  update(dt: number): void;
  dispose(): void;
}

export function buildGlows(glows: readonly GlowSpec[], group: THREE.Group): GlowSystem {
  if (glows.length === 0) return { mesh: null, update() {}, dispose() {} };
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const n = glows.length;
  const off = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const par = new Float32Array(n * 4);
  const inten = new Float32Array(n);
  const c = new THREE.Color();
  glows.forEach((g, i) => {
    off.set([g.x, g.y, g.z], i * 3);
    c.setHex(g.color);
    col.set([c.r, c.g, c.b], i * 3);
    par.set([g.size * 0.5, KIND[g.kind], g.rate, g.phase], i * 4);
    inten[i] = g.intensity;
  });
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
  geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(par, 4));
  geo.setAttribute('aIntensity', new THREE.InstancedBufferAttribute(inten, 1));
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.name = 'glows';
  group.add(mesh);
  return {
    mesh,
    update(dt) {
      (mat.uniforms.uTime as { value: number }).value += dt;
    },
    dispose() {
      geo.dispose();
      quad.dispose();
      mat.dispose();
    },
  };
}
