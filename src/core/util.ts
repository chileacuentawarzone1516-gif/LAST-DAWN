/** Utilidades matemáticas y de azar sin dependencias de three.js. */

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (a === b ? 0 : clamp01((v - a) / (b - a)));
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = invLerp(a, b, v);
  return t * t * (3 - 2 * t);
};
/** Suavizado exponencial independiente del framerate. */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));
export const dist2D = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(ax - bx, az - bz);
export const degToRad = (d: number): number => (d * Math.PI) / 180;
export const radToDeg = (r: number): number => (r * 180) / Math.PI;
/** Normaliza un ángulo a (-π, π]. */
export const wrapAngle = (a: number): number => {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  else if (r <= -Math.PI) r += Math.PI * 2;
  return r;
};

/** Generador pseudoaleatorio determinista (mulberry32). */
export type Rng = () => number;
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const randRange = (rng: Rng, lo: number, hi: number): number => lo + (hi - lo) * rng();
export const randInt = (rng: Rng, lo: number, hi: number): number => Math.floor(randRange(rng, lo, hi + 1));
export const pickOne = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)] as T;

/** Elección ponderada. Devuelve la clave o `undefined` si no hay pesos positivos. */
export function pickWeighted<K extends string>(rng: Rng, weights: Partial<Record<K, number>>): K | undefined {
  let total = 0;
  for (const k in weights) total += Math.max(0, weights[k] ?? 0);
  if (total <= 0) return undefined;
  let r = rng() * total;
  let last: K | undefined;
  for (const k in weights) {
    const w = Math.max(0, weights[k] ?? 0);
    if (w <= 0) continue;
    last = k;
    r -= w;
    if (r <= 0) return k;
  }
  return last;
}

/** 452 → "7:32". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const roundTo = (v: number, step: number): number => Math.round(v / step) * step;
