/**
 * Ruido determinista y periódico (tileable) para texturas procedurales.
 * Sin dependencias de three.js ni del DOM: testeable en Node (tests/engine.noise.test.ts).
 *
 * Las capas se generan UNA vez (Float32Array de `size`²) y las recetas de textura las
 * muestrean con desplazamientos/multiplicadores enteros, de modo que el resultado siga siendo
 * periódico y el coste por píxel sea una lectura de array.
 */
import { createRng } from '../core/util';

/** Hash entero de 2 coordenadas + semilla → [0, 1). */
export function hash2(ix: number, iy: number, seed = 0): number {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Curva de suavizado quíntica (Perlin mejorado). */
export const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Módulo positivo (para envolver índices de retícula). */
export const wrap = (v: number, n: number): number => ((v % n) + n) % n;

/**
 * Rellena `out` (size×size) con ruido de valor fractal PERIÓDICO.
 * `baseCells` celdas por lado en la primera octava; cada octava dobla la frecuencia.
 * El resultado se estira a [0, 1] (mín/máx) para que los umbrales sean predecibles.
 */
export function fillFbm(out: Float32Array, size: number, baseCells: number, octaves: number, seed: number, gain = 0.5): Float32Array {
  out.fill(0);
  let amp = 1;
  let cells = baseCells;
  const xi0 = new Int32Array(size);
  const xi1 = new Int32Array(size);
  const xs = new Float32Array(size);
  for (let o = 0; o < octaves; o++) {
    const lat = new Float32Array(cells * cells);
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) lat[j * cells + i] = hash2(i, j, seed + o * 131);
    const scale = cells / size;
    for (let x = 0; x < size; x++) {
      const g = x * scale;
      const i0 = Math.floor(g);
      xi0[x] = i0 % cells;
      xi1[x] = (i0 + 1) % cells;
      xs[x] = fade(g - i0);
    }
    for (let y = 0; y < size; y++) {
      const g = y * scale;
      const j0 = Math.floor(g);
      const sy = fade(g - j0);
      const r0 = (j0 % cells) * cells;
      const r1 = ((j0 + 1) % cells) * cells;
      const row = y * size;
      for (let x = 0; x < size; x++) {
        const a = lat[r0 + (xi0[x] as number)] as number;
        const b = lat[r0 + (xi1[x] as number)] as number;
        const c = lat[r1 + (xi0[x] as number)] as number;
        const d = lat[r1 + (xi1[x] as number)] as number;
        const sx = xs[x] as number;
        const top = a + (b - a) * sx;
        const bot = c + (d - c) * sx;
        out[row + x] = (out[row + x] as number) + amp * (top + (bot - top) * sy);
      }
    }
    amp *= gain;
    cells *= 2;
  }
  normalize01(out);
  return out;
}

/** Estira los valores al rango [0, 1] in-place. */
export function normalize01(a: Float32Array): void {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < a.length; i++) {
    const v = a[i] as number;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const k = hi > lo ? 1 / (hi - lo) : 0;
  for (let i = 0; i < a.length; i++) a[i] = ((a[i] as number) - lo) * k;
}

/**
 * Ruido celular (Worley) periódico: `dist` = distancia normalizada al punto más cercano (F1, 0..~1)
 * e `id` = valor aleatorio estable por celda (0..1). Útil para guijarros, escamas, células.
 */
export function fillWorley(dist: Float32Array, id: Float32Array, size: number, cells: number, seed: number): void {
  const px = new Float32Array(cells * cells);
  const py = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      px[j * cells + i] = hash2(i, j, seed) * 0.8 + 0.1;
      py[j * cells + i] = hash2(i, j, seed + 977) * 0.8 + 0.1;
    }
  }
  const scale = cells / size;
  for (let y = 0; y < size; y++) {
    const gy = y * scale;
    const cy = Math.floor(gy);
    for (let x = 0; x < size; x++) {
      const gx = x * scale;
      const cx = Math.floor(gx);
      let best = 1e9;
      let bestId = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = wrap(cx + di, cells);
          const jj = wrap(cy + dj, cells);
          const k = jj * cells + ii;
          const fx = cx + di + (px[k] as number) - gx;
          const fy = cy + dj + (py[k] as number) - gy;
          const d = fx * fx + fy * fy;
          if (d < best) {
            best = d;
            bestId = k;
          }
        }
      }
      dist[y * size + x] = Math.min(1, Math.sqrt(best));
      id[y * size + x] = hash2(bestId, 7, seed + 31);
    }
  }
}

/** Capas de ruido compartidas por las recetas de textura (todas periódicas, `size`²). */
export interface NoiseLayers {
  readonly size: number;
  /** Manchas grandes (≈3 celdas por lado, 4 octavas). */
  readonly lo: Float32Array;
  /** Detalle medio (≈8 celdas, 4 octavas). */
  readonly mid: Float32Array;
  /** Grano fino (≈32 celdas, 3 octavas). */
  readonly hi: Float32Array;
  /** Crestas 0..1 (1 en las líneas): grietas, venas, arañazos. */
  readonly ridge: Float32Array;
  /** Ruido blanco por píxel. */
  readonly white: Float32Array;
}

export function createNoiseLayers(size = 256): NoiseLayers {
  const lo = fillFbm(new Float32Array(size * size), size, 3, 4, 11);
  const mid = fillFbm(new Float32Array(size * size), size, 8, 4, 23);
  const hi = fillFbm(new Float32Array(size * size), size, 32, 3, 37, 0.6);
  const ridgeSrc = fillFbm(new Float32Array(size * size), size, 5, 4, 53);
  const ridge = new Float32Array(size * size);
  for (let i = 0; i < ridge.length; i++) ridge[i] = 1 - Math.abs(2 * (ridgeSrc[i] as number) - 1);
  const white = new Float32Array(size * size);
  const rng = createRng(7);
  for (let i = 0; i < white.length; i++) white[i] = rng();
  return { size, lo, mid, hi, ridge, white };
}

let shared: NoiseLayers | null = null;
/** Capas compartidas (se generan la primera vez que se piden: ≈15-30 ms). */
export function getNoiseLayers(): NoiseLayers {
  if (!shared) shared = createNoiseLayers(256);
  return shared;
}
