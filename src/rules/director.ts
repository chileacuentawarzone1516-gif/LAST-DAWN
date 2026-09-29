/**
 * Reglas PURAS del director de enemigos: qué generar, cuánto y dónde (sin three.js).
 * La parte con efectos (spawn real, navegación, visibilidad) vive en src/enemies/director.ts.
 */
import { DIRECTOR, ENEMIES, SPAWN_MIX, WARDEN } from '../config';
import type { HordeDef } from '../config';
import type { Vec2, ZoneId } from '../core/types';
import { clamp, lerp, pickWeighted, type Rng } from '../core/util';
import { clampThreat, type InfectedType } from './enemies';

export const ZONES: readonly ZoneId[] = ['perimeter', 'warehouses', 'refinery', 'complex'];

/** Filtra una mezcla de pesos dejando solo los tipos permitidos por `minThreat` a esa amenaza. */
export function filterMix(
  mix: Partial<Record<InfectedType, number>>,
  threat: number,
): Partial<Record<InfectedType, number>> {
  const t = clampThreat(threat);
  const out: Partial<Record<InfectedType, number>> = {};
  for (const key of Object.keys(mix) as InfectedType[]) {
    const w = mix[key] ?? 0;
    if (w > 0 && ENEMIES[key].minThreat <= t) out[key] = w;
  }
  return out;
}

/** Tipo de infectado según la mezcla de la amenaza (SPAWN_MIX) respetando minThreat. */
export function pickSpawnType(rng: Rng, threat: number): InfectedType {
  return pickFromMix(rng, SPAWN_MIX[clampThreat(threat)] ?? {}, threat);
}

/** Como pickSpawnType pero con una mezcla propia (hordas). Si no queda ningún tipo válido devuelve 'walker'. */
export function pickFromMix(rng: Rng, mix: Partial<Record<InfectedType, number>>, threat: number): InfectedType {
  return pickWeighted(rng, filterMix(mix, threat)) ?? 'walker';
}

/** Parámetros de una oleada de horda con el progreso 0..1 (interpolación lineal). */
export interface HordeWave {
  intervalS: number;
  size: number;
}

export function hordeWave(def: HordeDef, progress: number, out: HordeWave = { intervalS: 0, size: 0 }): HordeWave {
  const p = clamp(progress, 0, 1);
  out.intervalS = lerp(def.waveIntervalS[0], def.waveIntervalS[1], p);
  out.size = Math.max(1, Math.round(lerp(def.waveSize[0], def.waveSize[1], p)));
  return out;
}

/** Progreso 0..1 de una horda a partir de los segundos transcurridos y su rampa. */
export function hordeProgress(def: HordeDef, elapsedS: number): number {
  return def.rampS > 0 ? clamp(elapsedS / def.rampS, 0, 1) : 1;
}

export type ZoneCounts = Record<ZoneId, number>;

export function emptyZoneCounts(): ZoneCounts {
  return { perimeter: 0, warehouses: 0, refinery: 0, complex: 0 };
}

/**
 * Déficit ambiental por zona: cuántos infectados faltan para llegar al objetivo, con el tope
 * global `maxAlive` repartido priorizando el mayor déficit. `totalAlive` (por defecto la suma de
 * `counts`) permite descontar infectados que no son ambientales (hordas, refuerzos).
 */
export function ambientDeficit(
  counts: ZoneCounts,
  targets: ZoneCounts,
  maxAlive: number,
  totalAlive?: number,
  out: ZoneCounts = emptyZoneCounts(),
): ZoneCounts {
  let alive = totalAlive ?? 0;
  if (totalAlive === undefined) for (const z of ZONES) alive += Math.max(0, counts[z]);
  let budget = Math.max(0, maxAlive - alive);
  for (const z of ZONES) out[z] = Math.max(0, Math.floor(targets[z] - counts[z]));
  // Reparto del presupuesto: se recorta primero la zona con menos déficit para conservar las grandes.
  let total = 0;
  for (const z of ZONES) total += out[z];
  if (total <= budget) return out;
  const order = [...ZONES].sort((a, b) => out[b] - out[a]);
  for (const z of order) {
    const give = Math.min(out[z], budget);
    out[z] = give;
    budget -= give;
  }
  return out;
}

/** Tamaño de un grupo: aleatorio en `range` acotado por el presupuesto restante (≥ 0). */
export function packSize(rng: Rng, budget: number, range: readonly [number, number] = DIRECTOR.packSize): number {
  const lo = Math.max(1, Math.floor(range[0]));
  const hi = Math.max(lo, Math.floor(range[1]));
  const n = lo + Math.floor(rng() * (hi - lo + 1));
  return Math.max(0, Math.min(n, Math.floor(budget)));
}

/**
 * Cuántos refuerzos del Warden corresponden ya: número de umbrales de `fractions` (en orden
 * decreciente) alcanzados por `hpFraction` menos los ya invocados. Nunca negativo.
 */
export function summonsDue(hpFraction: number, done: number, fractions: readonly number[] = WARDEN.summonAtHpFractions): number {
  let reached = 0;
  for (const f of fractions) if (hpFraction <= f) reached++;
  return Math.max(0, reached - done);
}

/** Punto uniforme en área dentro del anillo [rMin, rMax] alrededor de (cx, cz). */
export function ringPoint(rng: Rng, cx: number, cz: number, rMin: number, rMax: number, out: Vec2 = { x: 0, z: 0 }): Vec2 {
  const a = rng() * Math.PI * 2;
  const lo = Math.min(rMin, rMax);
  const hi = Math.max(rMin, rMax);
  const r = Math.sqrt(lerp(lo * lo, hi * hi, rng()));
  out.x = cx + Math.cos(a) * r;
  out.z = cz + Math.sin(a) * r;
  return out;
}

/**
 * ¿Está `(px,pz)` a la vista del jugador según su cono? `yaw` es el del jugador (0 = -Z).
 * Solo geometría 2D: el director añade después la comprobación de línea de visión.
 */
export function inViewCone(
  playerX: number, playerZ: number, yaw: number, px: number, pz: number, halfAngleDeg: number,
): boolean {
  const dx = px - playerX;
  const dz = pz - playerZ;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return true;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const cos = (dx * fx + dz * fz) / len;
  return cos >= Math.cos((halfAngleDeg * Math.PI) / 180);
}

/** ¿Se simula un infectado a esta distancia del jugador? Hay histéresis al dormirlo (recicla si supera `recycle`). */
export function simState(dist: number): 'active' | 'dormant' | 'recycle' {
  if (dist <= DIRECTOR.simRadius) return 'active';
  return dist > DIRECTOR.simRadius + 12 ? 'recycle' : 'dormant';
}
