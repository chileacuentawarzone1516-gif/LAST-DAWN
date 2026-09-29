/** Utilidades comunes a los ficheros de recetas. */
import type { Rng } from '../../core/util';
import { between, chance, vary } from '../pure';
import { biquad, noiseBurst, partials, sweep, tone } from '../synth';
import type { BusName, Recipe, RecipeDef, SfxCategory } from '../types';

export interface DefineOptions {
  bus?: BusName;
  trim?: number;
  send?: number;
  range?: number;
  minDur?: number;
}

/** Crea una definición de receta con valores por defecto razonables. */
export function defineRecipe(
  id: string, category: SfxCategory, priority: number, dur: number, play: Recipe, o: DefineOptions = {},
): RecipeDef {
  return {
    id, play, category, priority, dur,
    bus: o.bus ?? 'sfx',
    trim: o.trim ?? 1,
    send: o.send ?? 0.15,
    range: o.range,
    minDur: o.minDur ?? Math.min(0.05, dur * 0.3),
  };
}

/** Añade varias definiciones a un registro. */
export function register(target: Record<string, RecipeDef>, defs: readonly RecipeDef[]): void {
  for (const d of defs) target[d.id] = d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Foley mecánico reutilizable (armas, recogidas, tienda)
// ─────────────────────────────────────────────────────────────────────────────
/** Clic metálico seco (seguro, cerrojo, cargador). 5 nodos. */
export function mechClick(ac: BaseAudioContext, dest: AudioNode, t: number, rng: Rng, o: { peak?: number; f?: number; ring?: number } = {}): void {
  const peak = o.peak ?? 0.22;
  const f = (o.f ?? 1900) * vary(rng, 1, 0.1);
  noiseBurst(ac, dest, t, { dur: 0.016, peak, attack: 0.0006, type: 'bandpass', f0: f, q: 2.4, rng });
  if (o.ring !== 0) partials(ac, dest, t, { f: f * 1.45, ratios: [1], decay: 0.04 * (o.ring ?? 1), peak: peak * 0.35 });
}

/** Golpe sordo (culata, cargador asentándose, tope). 3–6 nodos. */
export function thunk(ac: BaseAudioContext, dest: AudioNode, t: number, rng: Rng, o: { peak?: number; f?: number; dur?: number; noise?: boolean } = {}): void {
  const f = o.f ?? 150;
  const dur = o.dur ?? 0.06;
  tone(ac, dest, t, { f0: f * 1.3, f1: f * 0.6, dur, peak: o.peak ?? 0.3, attack: 0.001 });
  if (o.noise !== false) noiseBurst(ac, dest, t, { dur: dur * 0.7, peak: (o.peak ?? 0.3) * 0.6, attack: 0.001, type: 'lowpass', f0: f * 7, f1: f * 2.5, rng });
}

/** Roce deslizante (cargador entrando/saliendo, ropa). 3 nodos. */
export function rasp(ac: BaseAudioContext, dest: AudioNode, t: number, rng: Rng, o: { dur?: number; peak?: number; f0?: number; f1?: number; q?: number } = {}): void {
  const dur = o.dur ?? 0.08;
  noiseBurst(ac, dest, t, {
    dur, peak: o.peak ?? 0.09, attack: dur * 0.3, type: 'bandpass', f0: o.f0 ?? 1200, f1: o.f1 ?? 2600, q: o.q ?? 1.4, rng,
  });
}

/** Silbido de aire (movimiento rápido: puñetazo, lanzamiento). 3 nodos. */
export function whoosh(ac: BaseAudioContext, dest: AudioNode, t: number, rng: Rng, o: { dur?: number; peak?: number; f0?: number; f1?: number; q?: number } = {}): void {
  const dur = o.dur ?? 0.22;
  noiseBurst(ac, dest, t, {
    dur, peak: o.peak ?? 0.2, attack: dur * 0.45, type: 'bandpass', f0: o.f0 ?? 350, f1: o.f1 ?? 1700, q: o.q ?? 1.1, rng,
  });
}

/** Pequeña variación de nivel en dB → factor lineal. */
export const dbJitter = (rng: Rng, db: number): number => 10 ** ((between(rng, -db, db)) / 20);

export { between, chance, vary, biquad, sweep };
