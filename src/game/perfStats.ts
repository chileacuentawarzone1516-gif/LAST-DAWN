/**
 * Estadísticas PURAS de la instrumentación de rendimiento (?perf=1): sin DOM, sin three.js y sin estado
 * global. Las usa src/game/perf.ts (sólo se carga con ?perf=1) y se testean en tests/perf.stats.test.ts.
 *
 * Definiciones (PLAN v0.1.5, secciones 7 y 15):
 *  - frame time = intervalo entre dos callbacks de requestAnimationFrame consecutivos (ms);
 *  - T_sost = mediana del frame time de la ventana (nivel realmente sostenido en esa ventana);
 *  - «frames > 2T» = intervalos mayores que 2 × T_sost;
 *  - pausas largas (hitches) = intervalos > 100 ms y > 250 ms;
 *  - stutter = rachas de ≥ 2 intervalos consecutivos > 2 × T_sost.
 * La cadencia observada de rAF NO es la frecuencia física de la pantalla: se etiqueta siempre como
 * «rAF observed cadence» y sólo es un dato experimental a contrastar con el dispositivo.
 */

/** Etiqueta obligatoria de la cadencia derivada de rAF (no es la frecuencia de refresco real). */
export const RAF_CADENCE_LABEL = 'rAF observed cadence';

/** Umbrales (ms) de las pausas largas que se cuentan por separado. */
export const HITCH_MS = [100, 250] as const;

/** Resumen de una serie de frame times. Todos los tiempos en ms; `null` si no hay datos suficientes. */
export interface FrameSummary {
  frames: number;
  /** Suma de los intervalos (ms). */
  durationMs: number;
  /** FPS derivado = frames / duración. */
  fps: number | null;
  mean: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  /** Intervalos > 2 × p50 (T_sost de la serie). */
  over2T: number;
  over2TPct: number | null;
  hitches100: number;
  hitches250: number;
  /** Rachas de ≥ 2 intervalos consecutivos > 2 × p50. */
  stutterBursts: number;
}

/** Percentil por rango más cercano sobre un array YA ORDENADO de forma ascendente (p en 0..100). */
export function percentileSorted(sorted: ArrayLike<number>, p: number): number | null {
  const n = sorted.length;
  if (n === 0 || !Number.isFinite(p)) return null;
  const q = Math.min(100, Math.max(0, p));
  const rank = Math.max(1, Math.ceil((q / 100) * n));
  return sorted[rank - 1] as number;
}

/**
 * Resume `count` intervalos de `values` (en el orden en que se registraron). `scratch` debe tener
 * capacidad ≥ count: se usa para ordenar sin reservar memoria (se sobrescribe).
 */
export function summarizeFrames(values: ArrayLike<number>, count: number, scratch: Float64Array | Float32Array): FrameSummary {
  const n = Math.max(0, Math.min(count, values.length, scratch.length));
  let sum = 0;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i] as number;
    scratch[i] = v;
    sum += v;
    if (v > max) max = v;
  }
  if (n === 0) {
    return {
      frames: 0, durationMs: 0, fps: null, mean: null, p50: null, p95: null, p99: null, max: null,
      over2T: 0, over2TPct: null, hitches100: 0, hitches250: 0, stutterBursts: 0,
    };
  }
  const view = scratch.subarray(0, n);
  view.sort();
  const p50 = percentileSorted(view, 50) as number;
  const limit = 2 * p50;
  let over2T = 0;
  let h100 = 0;
  let h250 = 0;
  let bursts = 0;
  let run = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i] as number;
    if (v > HITCH_MS[0]) h100++;
    if (v > HITCH_MS[1]) h250++;
    if (v > limit) {
      over2T++;
      run++;
      if (run === 2) bursts++;
    } else run = 0;
  }
  return {
    frames: n,
    durationMs: sum,
    fps: sum > 0 ? (n * 1000) / sum : null,
    mean: sum / n,
    p50,
    p95: percentileSorted(view, 95),
    p99: percentileSorted(view, 99),
    max,
    over2T,
    over2TPct: (over2T * 100) / n,
    hitches100: h100,
    hitches250: h250,
    stutterBursts: bursts,
  };
}

/** Cadencia observada de rAF: mediana de la serie y proporción de intervalos a ±10 % de ella. */
export interface RafCadence {
  label: typeof RAF_CADENCE_LABEL;
  /** 1000 / mediana (Hz observados en rAF; NO es la frecuencia física de la pantalla). */
  hz: number | null;
  medianMs: number | null;
  /** Proporción (0..1) de intervalos dentro de ±10 % de la mediana: cuanto más baja, menos estable. */
  withinTenPct: number | null;
  frames: number;
}

/** Calcula la cadencia observada (usa `scratch` para ordenar; capacidad ≥ count). */
export function rafCadence(values: ArrayLike<number>, count: number, scratch: Float64Array | Float32Array): RafCadence {
  const n = Math.max(0, Math.min(count, values.length, scratch.length));
  if (n === 0) return { label: RAF_CADENCE_LABEL, hz: null, medianMs: null, withinTenPct: null, frames: 0 };
  for (let i = 0; i < n; i++) scratch[i] = values[i] as number;
  const view = scratch.subarray(0, n);
  view.sort();
  const med = percentileSorted(view, 50) as number;
  let near = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i] as number;
    if (Math.abs(v - med) <= med * 0.1) near++;
  }
  return { label: RAF_CADENCE_LABEL, hz: med > 0 ? 1000 / med : null, medianMs: med, withinTenPct: near / n, frames: n };
}

/**
 * Buffer circular de frame times con marca de tiempo (ms desde el origen de la página). Capacidad fija:
 * al llenarse, sobrescribe lo más antiguo (las ventanas ya resumidas no se pierden).
 */
export class FrameRing {
  readonly capacity: number;
  private readonly dt: Float32Array;
  private readonly at: Float64Array;
  private head = 0;
  private size = 0;
  /** Total de intervalos registrados (incluidos los sobrescritos). */
  total = 0;

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.dt = new Float32Array(this.capacity);
    this.at = new Float64Array(this.capacity);
  }

  get length(): number {
    return this.size;
  }

  /** Registra un intervalo `dtMs` que terminó en el instante `atMs`. */
  push(dtMs: number, atMs: number): void {
    this.dt[this.head] = dtMs;
    this.at[this.head] = atMs;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
    this.total++;
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
    this.total = 0;
  }

  /** Instante del intervalo más antiguo conservado (null si vacío). */
  oldestAt(): number | null {
    if (this.size === 0) return null;
    const start = (this.head - this.size + this.capacity) % this.capacity;
    return this.at[start] as number;
  }

  /**
   * Copia a `out` (en orden cronológico) los intervalos que terminaron en [fromMs, toMs] y devuelve cuántos.
   * `out` debe tener capacidad suficiente (como mucho `capacity`).
   */
  copyRange(fromMs: number, toMs: number, out: Float32Array | Float64Array): number {
    let n = 0;
    const start = (this.head - this.size + this.capacity) % this.capacity;
    for (let k = 0; k < this.size && n < out.length; k++) {
      const i = (start + k) % this.capacity;
      const t = this.at[i] as number;
      if (t < fromMs || t > toMs) continue;
      out[n++] = this.dt[i] as number;
    }
    return n;
  }

  /** Intervalos y marcas de tiempo en orden cronológico (para exportar en bruto). */
  toArrays(): { dtMs: number[]; atMs: number[] } {
    const dtMs: number[] = [];
    const atMs: number[] = [];
    const start = (this.head - this.size + this.capacity) % this.capacity;
    for (let k = 0; k < this.size; k++) {
      const i = (start + k) % this.capacity;
      dtMs.push(round3(this.dt[i] as number));
      atMs.push(round3(this.at[i] as number));
    }
    return { dtMs, atMs };
  }
}

/** Origen de un error capturado en la página. */
export type ErrorOrigin = 'app' | 'external' | 'unknown';

/**
 * Clasifica un error por el fichero donde se produjo: mismo origen que la página = aplicación; otro
 * origen o esquema de extensión/DevTools = externo; sin fichero = desconocido (p. ej. código evaluado).
 */
export function classifyErrorSource(filename: string | null | undefined, pageOrigin: string): ErrorOrigin {
  if (!filename) return 'unknown';
  if (/^(chrome|moz|safari)-extension:|^devtools:|^chrome:/.test(filename)) return 'external';
  try {
    return new URL(filename, pageOrigin).origin === pageOrigin ? 'app' : 'external';
  } catch {
    return 'unknown';
  }
}

/** Redondeo a 3 decimales para exportar (evita ruido de coma flotante en el JSON). */
export function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Copia apta para JSON: NaN/Infinity → null, profundidad limitada y sin ciclos (los informes de la
 * instrumentación no deben ocultar valores no finitos convirtiéndolos silenciosamente).
 */
export function jsonSafe(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || typeof value !== 'object') return typeof value === 'function' || typeof value === 'symbol' ? undefined : value;
  if (depth > 12 || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => jsonSafe(v, depth + 1, seen));
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>, (v) => (Number.isFinite(v) ? v : null));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const s = jsonSafe(v, depth + 1, seen);
    if (s !== undefined) out[k] = s;
  }
  return out;
}
