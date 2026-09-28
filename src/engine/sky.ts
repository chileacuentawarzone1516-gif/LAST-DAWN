/**
 * Cúpula de cielo procedural de HORA AZUL: gradiente con resplandor en el horizonte, bruma baja
 * coherente con la niebla, estrellas, luna con fases/cráteres, nubes con ruido y deriva lenta.
 * También hornea el entorno PMREM (reflejos) a partir del mismo shader.
 */
import * as THREE from 'three';
import { RENDER } from '../config';
import type { NoiseLayers } from './noise';
import { lightAxes } from './shadowSnap';
import type { V3 } from './shadowSnap';

const DEG = Math.PI / 180;

/** Dirección unitaria hacia la luna (desde el jugador) según RENDER.moon. Norte = -Z, este = +X. */
export function moonDirection(out = new THREE.Vector3()): THREE.Vector3 {
  const az = RENDER.moon.azimuthDeg * DEG;
  const el = RENDER.moon.elevationDeg * DEG;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // Siempre en el plano lejano: nunca se recorta y queda detrás de todo.
  gl_Position.z = gl_Position.w;
}
`;

const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform float uTime;
uniform sampler2D tNoise;
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform vec3 uGround;
uniform vec3 uMoonColor;
uniform vec3 uMoonDir;
uniform vec3 uMoonRight;
uniform vec3 uMoonUp;
uniform vec3 uGlowDir;
uniform vec3 uGlowColor;
uniform float uMoonBoost;
uniform float uStars;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 skyGradient(vec3 d) {
  float up = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.34, up));
  c = mix(c, uTop, smoothstep(0.2, 0.95, up));
  // Resplandor crepuscular en el lado por donde se puso el sol.
  vec2 hd = normalize(d.xz + vec2(1e-5));
  float az = max(dot(hd, uGlowDir.xz), 0.0);
  c += uGlowColor * (pow(az, 2.5) * 0.95 + 0.12) * exp(-up * 5.0);
  // Bruma baja: converge con el color de la niebla del mundo en el horizonte.
  c = mix(c, uFog, (1.0 - smoothstep(0.0, 0.14, up)) * 0.82);
  // Por debajo del horizonte (fuera del mapa): del color de niebla a un suelo oscuro.
  float below = smoothstep(0.0, 0.02, -d.y);
  c = mix(c, mix(uFog, uGround, smoothstep(0.0, 0.5, -d.y)), below);
  return c;
}

float starField(vec3 d) {
  vec3 sp = d * 92.0;
  vec3 id = floor(sp);
  vec3 f = fract(sp) - 0.5;
  float r = hash13(id);
  if (r < 0.987) return 0.0;
  vec3 jit = (vec3(hash13(id + 3.1), hash13(id + 7.7), hash13(id + 11.3)) - 0.5) * 0.55;
  float dd = length(f - jit);
  float b = hash13(id + 19.0);
  float tw = 0.78 + 0.22 * sin(uTime * (1.4 + b * 3.0) + r * 200.0);
  float core = exp(-dd * dd * (110.0 + 380.0 * (1.0 - b)));
  return core * (0.35 + 1.9 * b * b) * tw;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyGradient(d);

  // Nubes proyectadas sobre un plano lejano; se funden con la bruma cerca del horizonte.
  float dens = 0.0;
  float lit = 0.0;
  if (d.y > 0.0) {
    vec2 p = d.xz / (d.y + 0.16);
    vec2 q = p * 0.5 + vec2(uTime * 0.0055, uTime * 0.0018);
    float n1 = texture2D(tNoise, q).r;
    float n2 = texture2D(tNoise, q * 2.7 + 0.31).g;
    float n3 = texture2D(tNoise, q * 6.3 + 0.77).b;
    float n = n1 * 0.58 + n2 * 0.30 + n3 * 0.12;
    dens = smoothstep(0.5, 0.8, n) * smoothstep(0.035, 0.3, d.y);
    lit = pow(max(dot(d, uMoonDir), 0.0), 3.0);
  }

  // Estrellas (se apagan cerca del horizonte y tras las nubes).
  float st = starField(d) * smoothstep(0.03, 0.4, d.y) * (1.0 - dens) * uStars;
  vec3 starCol = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.92, 0.78), hash13(floor(d * 92.0) + 5.5));
  col += starCol * st * 1.6;

  // Luna: disco con terminador (gibosa), mares y limbo, más halo.
  float md = dot(d, uMoonDir);
  float x = 1.0 - md;
  vec2 mp = vec2(dot(d, uMoonRight), dot(d, uMoonUp)) / 0.05;
  float mr = length(mp);
  vec3 moon = vec3(0.0);
  if (md > 0.0 && mr < 1.5) {
    float disc = smoothstep(1.0, 0.93, mr);
    float z = sqrt(max(1.0 - mr * mr, 0.0));
    vec3 nrm = vec3(mp, z);
    float ph = clamp(dot(nrm, normalize(vec3(-0.5, 0.2, 0.85))) * 3.2 + 0.55, 0.0, 1.0);
    float maria = texture2D(tNoise, mp * 0.32 + 0.5).g;
    float crater = texture2D(tNoise, mp * 1.4 + 0.2).b;
    float alb = mix(0.5, 1.0, smoothstep(0.32, 0.62, maria)) * (0.86 + 0.14 * crater);
    alb *= mix(0.72, 1.0, z);
    moon += uMoonColor * alb * ph * disc * 5.0;
  }
  moon += uMoonColor * (exp(-x * 1100.0) * 0.55 + exp(-x * 110.0) * 0.07 + exp(-x * 14.0) * 0.012);
  col += moon * uMoonBoost * (1.0 - dens * 0.88);

  // Nubes: sombra azulada con borde iluminado por la luna.
  vec3 cloudDark = mix(uMid, uTop, 0.45) * 1.25 + uHorizon * 0.10;
  vec3 cloudLit = cloudDark + uMoonColor * 0.20;
  float rim = smoothstep(0.0, 0.25, dens) * (1.0 - smoothstep(0.35, 0.95, dens));
  vec3 cloudCol = mix(cloudDark, cloudLit, clamp(lit * (0.45 + 0.9 * rim), 0.0, 1.0));
  col = mix(col, cloudCol, dens * 0.78);

  // Ruido de tramado: evita el banding del degradado en pantallas de 8 bits.
  col += (hash12(gl_FragCoord.xy) - 0.5) * 0.0035;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Textura de ruido periódica RGBA (fbm bajo/medio/fino) para nubes y superficie lunar. */
export function createNoiseTexture(layers: NoiseLayers): THREE.DataTexture {
  const n = layers.size;
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    data[i * 4] = Math.round((layers.lo[i] as number) * 255);
    data[i * 4 + 1] = Math.round((layers.mid[i] as number) * 255);
    data[i * 4 + 2] = Math.round((layers.hi[i] as number) * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

interface SkyMaterialOptions {
  /** Multiplicador del brillo de la luna (más bajo al hornear el entorno). */
  moonBoost: number;
  /** 0 = sin estrellas (entorno). */
  stars: number;
}

function createSkyMaterial(noise: THREE.Texture, moonDir: THREE.Vector3, opts: SkyMaterialOptions): THREE.ShaderMaterial {
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  lightAxes(moonDir as V3, right as V3, up as V3);
  const c = (hex: number) => new THREE.Color(hex);
  const top = c(RENDER.sky.top);
  const horizon = c(RENDER.sky.horizon);
  const glowAz = 72 * DEG;
  return new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uTime: { value: 0 },
      tNoise: { value: noise },
      uTop: { value: top },
      uMid: { value: top.clone().lerp(horizon, 0.5) },
      uHorizon: { value: horizon },
      uFog: { value: c(RENDER.sky.fog) },
      uGround: { value: c(RENDER.sky.ground) },
      uMoonColor: { value: c(RENDER.sky.moon) },
      uMoonDir: { value: moonDir.clone() },
      uMoonRight: { value: right },
      uMoonUp: { value: up },
      uGlowDir: { value: new THREE.Vector3(Math.sin(glowAz), 0, -Math.cos(glowAz)) },
      // Resplandor tenue de crepúsculo: azul verdoso con un toque violeta.
      uGlowColor: { value: new THREE.Color(0x27447a).lerp(new THREE.Color(0x5a3f78), 0.25) },
      uMoonBoost: { value: opts.moonBoost },
      uStars: { value: opts.stars },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

export interface Sky {
  /** Cúpula (añadir a la escena del mundo). */
  readonly dome: THREE.Mesh;
  readonly moonDir: THREE.Vector3;
  /** Sitúa la cúpula sobre la cámara y avanza el tiempo del shader. */
  update(cameraPos: THREE.Vector3, time: number): void;
  /** Hornea el entorno PMREM del cielo (reflejos); el llamador es dueño de la textura devuelta. */
  bakeEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget;
  dispose(): void;
}

export function createSky(layers: NoiseLayers): Sky {
  const noise = createNoiseTexture(layers);
  const moonDir = moonDirection();
  const material = createSkyMaterial(noise, moonDir, { moonBoost: 1, stars: 1 });
  const geometry = new THREE.SphereGeometry(1, 40, 20);
  const dome = new THREE.Mesh(geometry, material);
  dome.name = 'sky-dome';
  dome.scale.setScalar(80);
  dome.frustumCulled = false;
  // Se dibuja al final de los opacos: el z-test descarta los píxeles ya cubiertos por geometría.
  dome.renderOrder = 1e6;

  return {
    dome,
    moonDir,
    update(cameraPos, time) {
      dome.position.copy(cameraPos);
      (material.uniforms.uTime as THREE.IUniform<number>).value = time;
    },
    bakeEnvironment(renderer) {
      const envMat = createSkyMaterial(noise, moonDir, { moonBoost: 0.55, stars: 0 });
      const envScene = new THREE.Scene();
      const envDome = new THREE.Mesh(geometry, envMat);
      envDome.scale.setScalar(50);
      envScene.add(envDome);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const rt = pmrem.fromScene(envScene, 0.02, 0.1, 100, { size: 128 });
      pmrem.dispose();
      envMat.dispose();
      return rt;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      noise.dispose();
    },
  };
}
