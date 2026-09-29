/**
 * Fragmentos GLSL compartidos por el motor (cielo, post-proceso, partículas, decals) y el
 * parche de la niebla exponencial con distancia de inicio (RENDER.fogNear).
 */
import * as THREE from 'three';
import { RENDER } from '../config';

let patched = false;

/**
 * Parcha los chunks de niebla de three: `FogExp2` no tiene distancia de inicio; aquí la niebla
 * sólo empieza a acumularse pasados `RENDER.fogNear` metros, de modo que el primer plano queda
 * nítido y la bruma se concentra a media/larga distancia. Idempotente. Afecta a todos los
 * materiales compilados después (incluidos los de otros módulos), que así quedan coherentes.
 */
export function installFogPatch(): void {
  if (patched) return;
  patched = true;
  const chunks = THREE.ShaderChunk as Record<string, string>;
  const start = RENDER.fogNear.toFixed(2);
  const pars = chunks.fog_pars_fragment;
  if (pars !== undefined) {
    chunks.fog_pars_fragment = pars.replace('#ifdef USE_FOG', `#ifdef USE_FOG\n\tconst float FOG_START = ${start};`);
  }
  const frag = chunks.fog_fragment;
  if (frag !== undefined) {
    chunks.fog_fragment = frag.replace(
      'float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );',
      'float fogD = max( vFogDepth - FOG_START, 0.0 );\n\t\tfloat fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogD * fogD );',
    );
  }
}

/** Factor de visibilidad por niebla (1 = nítido, 0 = totalmente en niebla) para shaders propios. */
export const FOG_FADE_GLSL = /* glsl */ `
float fogVisibility() {
#ifdef USE_FOG
  float d = max(vFogDepth - FOG_START, 0.0);
  return exp(-fogDensity * fogDensity * d * d);
#else
  return 1.0;
#endif
}
`;

/** Vértice de un triángulo a pantalla completa (posiciones en clip space). */
export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Capa de superposición de pantalla (viñeta, tintes de daño/vida baja/toxicidad/muerte).
 * Devuelve un color PREMULTIPLICADO en espacio sRGB (rgb ya multiplicado por alpha).
 * La comparten el post-proceso completo y la superposición barata de la calidad baja.
 */
export const SCREEN_OVERLAY_GLSL = /* glsl */ `
uniform float uVig;
uniform float uHurt;
uniform float uLowHp;
uniform float uPulse;
uniform float uToxic;
uniform float uDeath;
uniform float uDesat;
uniform float uTime;

void overlayLayer(inout vec4 acc, vec3 col, float a) {
  a = clamp(a, 0.0, 1.0);
  acc.rgb = col * a + acc.rgb * (1.0 - a);
  acc.a = a + acc.a * (1.0 - a);
}

vec4 screenOverlay(vec2 uv) {
  vec2 c = uv - 0.5;
  float r = length(c * vec2(1.0, 0.85)) * 1.6;
  vec4 acc = vec4(0.0);
#ifdef OVERLAY_DESAT
  overlayLayer(acc, vec3(0.30, 0.31, 0.34), uDesat * 0.42);
#endif
  overlayLayer(acc, vec3(0.0, 0.006, 0.02), uVig * pow(smoothstep(0.42, 1.12, r), 1.35));
  float flick = 0.92 + 0.08 * sin(uTime * 2.3 + r * 4.0);
  overlayLayer(acc, vec3(0.10, 0.46, 0.06), uToxic * (0.11 + 0.30 * smoothstep(0.25, 1.1, r)) * flick);
  overlayLayer(acc, vec3(0.5, 0.0, 0.02), uPulse * 0.6 * smoothstep(0.22, 1.05, r) + uLowHp * 0.12 * smoothstep(0.4, 1.1, r));
  overlayLayer(acc, vec3(0.78, 0.02, 0.02), uHurt * (0.14 + 0.62 * smoothstep(0.18, 1.05, r)));
  overlayLayer(acc, vec3(0.09, 0.015, 0.02), uDeath * (0.62 + 0.24 * smoothstep(0.2, 1.0, r)));
  return acc;
}
`;

/** Superposición barata (calidad baja): un quad con mezcla premultiplicada sobre el frame. */
export const OVERLAY_FRAG = /* glsl */ `
varying vec2 vUv;
${SCREEN_OVERLAY_GLSL}
void main() {
  gl_FragColor = screenOverlay(vUv);
}
`;

const BLOOM_TAP = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
`;

/** Filtro previo: umbral con rodilla suave, 4 muestras (Karis parcial) a media resolución. */
export const BLOOM_PREFILTER_FRAG = /* glsl */ `
${BLOOM_TAP}
uniform float uThreshold;
uniform float uKnee;
vec3 prefilter(vec3 c) {
  c = min(c, vec3(24.0));
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float k = max(soft, br - uThreshold) / max(br, 1e-4);
  return c * k;
}
void main() {
  vec3 a = prefilter(texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb);
  vec3 b = prefilter(texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb);
  vec3 c = prefilter(texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb);
  vec3 d = prefilter(texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb);
  gl_FragColor = vec4((a + b + c + d) * 0.25, 1.0);
}
`;

/** Reducción «dual filter» (Bjørge): centro + 4 diagonales. */
export const BLOOM_DOWN_FRAG = /* glsl */ `
${BLOOM_TAP}
void main() {
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  s += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  s += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(s * 0.125, 1.0);
}
`;

/** Ampliación «dual filter»: 8 muestras; se suma (blending aditivo) al nivel superior. */
export const BLOOM_UP_FRAG = /* glsl */ `
${BLOOM_TAP}
void main() {
  vec2 h = uTexel * 0.5;
  vec3 s = texture2D(tSrc, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(-h.x, h.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(0.0, h.y * 2.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(h.x, h.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(h.x * 2.0, 0.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(0.0, -h.y * 2.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  gl_FragColor = vec4(s / 12.0, 1.0);
}
`;

/**
 * Pase final: aberración cromática leve + bloom + tone mapping ACES + sRGB (chunks de three) +
 * desaturación, superposición de pantalla y grano fino (ya en espacio de visualización).
 */
export const FINAL_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uChroma;
uniform float uGrain;
${SCREEN_OVERLAY_GLSL}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 c = vUv - 0.5;
  vec3 col;
#ifdef POST_LITE
  col = texture2D(tScene, vUv).rgb;
#else
  float ca = uChroma * (1.0 + uHurt * 2.5 + uToxic * 0.6) * dot(c, c);
  col.r = texture2D(tScene, vUv + c * ca).r;
  col.g = texture2D(tScene, vUv).g;
  col.b = texture2D(tScene, vUv - c * ca).b;
#endif
#ifdef USE_BLOOM
  col += texture2D(tBloom, vUv).rgb * uBloom;
#endif
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 ldr = gl_FragColor.rgb;
  float l = dot(ldr, vec3(0.2126, 0.7152, 0.0722));
  ldr = mix(vec3(l), ldr, 1.0 - uDesat);
  vec4 o = screenOverlay(vUv);
  ldr = ldr * (1.0 - o.a) + o.rgb;
  float g = hash12(gl_FragCoord.xy + fract(uTime * 7.13) * vec2(97.0, 53.0)) - 0.5;
  ldr += g * uGrain * (1.15 - l);
  gl_FragColor = vec4(ldr, 1.0);
}
`;
