/**
 * Contaminación visual: pared/cúpula de niebla tóxica y anillo/suelo brillante que crecen con
 * `state.match.contamination`. Dos draw calls, shaders animados, visibles por dentro y por fuera.
 */
import * as THREE from 'three';
import { CONTAMINATION } from '../config';
import type { RunState } from '../core/state';
import { damp } from '../core/util';

const NOISE = /* glsl */ `
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.1 + 3.7) + 0.2 * vnoise(p * 4.3 + 9.1); }
`;

const WALL_VERT = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vH;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vH = position.y;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const WALL_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vH;
  ${NOISE}
  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    float ang = atan(vWorld.z, vWorld.x);
    vec2 p = vec2(ang * 22.0, vWorld.y * 0.045 - uTime * 0.05);
    float n = fbm(p + vec2(uTime * 0.04, 0.0));
    float n2 = fbm(p * 2.3 + vec2(-uTime * 0.07, uTime * 0.03));
    float density = smoothstep(0.25, 0.85, n * 0.7 + n2 * 0.5);
    float fres = 1.0 - abs(dot(V, normalize(vNormalW)));
    float height = 1.0 - smoothstep(0.15, 1.0, vH);
    float base = smoothstep(0.0, 0.05, vH);
    float a = (0.16 + 0.55 * density) * (0.35 + 0.65 * fres) * (0.25 + 0.75 * height) * base * uAlpha;
    vec3 col = mix(vec3(0.05, 0.30, 0.12), vec3(0.42, 1.0, 0.35), density * 0.7 + fres * 0.3);
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.85));
  }
`;
const FLOOR_VERT = /* glsl */ `
  varying vec2 vLocal;
  varying vec3 vWorld;
  void main() {
    vLocal = position.xy;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const FLOOR_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  uniform float uRadius;
  varying vec2 vLocal;
  varying vec3 vWorld;
  ${NOISE}
  void main() {
    float r = length(vLocal);
    float edge = smoothstep(0.90, 0.995, r) * (1.0 - smoothstep(0.995, 1.0, r));
    float dEdge = (1.0 - r) * uRadius;
    float ring = exp(-dEdge * dEdge * 0.35) * step(r, 1.0);
    float n = fbm(vWorld.xz * 0.06 + vec2(uTime * 0.05, -uTime * 0.03));
    float haze = smoothstep(0.0, 25.0, dEdge) * 0.0 + (1.0 - smoothstep(0.0, 40.0, dEdge)) * 0.28;
    float a = (ring * 0.9 + haze * (0.5 + n)) * uAlpha;
    a += edge * 0.0;
    if (r >= 1.0 || a < 0.004) discard;
    vec3 col = mix(vec3(0.10, 0.55, 0.20), vec3(0.6, 1.0, 0.4), ring);
    gl_FragColor = vec4(col * a, a);
  }
`;

export interface ContaminationVisual {
  update(dt: number): void;
  dispose(): void;
  readonly radius: number;
}

export function createContamination(group: THREE.Group, state: RunState): ContaminationVisual {
  const uTime = { value: 0 };
  const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 96, 1, true);
  wallGeo.translate(0, 0.5, 0);
  const wallMat = new THREE.ShaderMaterial({
    vertexShader: WALL_VERT, fragmentShader: WALL_FRAG, uniforms: { uTime, uAlpha: { value: 1 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.frustumCulled = false;
  wall.renderOrder = 8;
  wall.name = 'contamination-wall';
  const floorGeo = new THREE.CircleGeometry(1, 96);
  const uRadius = { value: 1 };
  const floorMat = new THREE.ShaderMaterial({
    vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG, uniforms: { uTime, uAlpha: { value: 1 }, uRadius },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.12;
  floor.frustumCulled = false;
  floor.renderOrder = 7;
  floor.name = 'contamination-floor';
  const root = new THREE.Group();
  root.position.set(CONTAMINATION.center.x, 0, CONTAMINATION.center.z);
  root.visible = false;
  root.add(floor, wall);
  group.add(root);
  let radius = 0;
  const HEIGHT = 55;
  return {
    get radius() {
      return radius;
    },
    update(dt) {
      uTime.value += dt;
      const c = state.match.contamination;
      const target = c.active ? c.radius : 0;
      radius = damp(radius, target, 2.5, dt);
      if (Math.abs(radius - target) < 0.05) radius = target;
      root.visible = radius > 0.5;
      if (!root.visible) return;
      wall.scale.set(radius, HEIGHT, radius);
      floor.scale.set(radius, radius, 1);
      uRadius.value = radius;
    },
    dispose() {
      group.remove(root);
      wallGeo.dispose();
      wallMat.dispose();
      floorGeo.dispose();
      floorMat.dispose();
    },
  };
}
