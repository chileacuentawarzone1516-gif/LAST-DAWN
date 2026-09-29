/**
 * Botín: qué suelta cada infectado, reparto estático inicial y aplicación de recogidas.
 * REGLAS PURAS (sin three.js ni DOM). Todo el azar entra por un `Rng` inyectado, de modo que
 * con la misma semilla el resultado es idéntico.
 *
 * Unidades de `amount` según el tipo de objeto:
 *  - cash:    dinero.
 *  - ammo:    «cajas» de munición (1 caja = LOOT.ammoFraction de cargador por arma, ver applyPickup).
 *  - plate / grenade: unidades.
 *  - medkit:  puntos de vida (LOOT.medkitHeal).
 */
import { ECONOMY, LOOT, THREAT_SCALE, WEAPONS } from '../config';
import type { PickupKind } from '../config';
import type { RunState } from '../core/state';
import type { EnemyType, ZoneId } from '../core/types';
import { clamp01, pickWeighted, randRange, roundTo } from '../core/util';
import type { Rng } from '../core/util';
import { clampThreat, addMoney, grenadeCap, plateCap } from './economy';
import { threatOf } from './zones';

export interface PickupDrop {
  kind: PickupKind;
  amount: number;
}

export interface StaticLootItem extends PickupDrop {
  x: number;
  z: number;
}

/** Cantidad concreta de un objeto recién generado (el azar de dinero se consume aquí). */
function makeDrop(rng: Rng, kind: PickupKind, threat: number): PickupDrop {
  switch (kind) {
    case 'cash': {
      const base = randRange(rng, LOOT.cash[0], LOOT.cash[1]) * (THREAT_SCALE.loot[threat] ?? 1);
      return { kind, amount: Math.max(ECONOMY.bountyRounding, roundTo(base, ECONOMY.bountyRounding)) };
    }
    case 'medkit':
      return { kind, amount: LOOT.medkitHeal };
    default:
      return { kind, amount: 1 };
  }
}

/** Elige un tipo de objeto según los pesos de la amenaza. Siempre devuelve un tipo. */
function rollKind(rng: Rng, threat: number): PickupKind {
  const weights = LOOT.weights[threat];
  return (weights ? pickWeighted<PickupKind>(rng, weights) : undefined) ?? 'cash';
}

/** Probabilidad de que `type` suelte botín en una zona de amenaza `threat`. */
export function dropChance(type: EnemyType, threat: number): number {
  const t = clampThreat(threat);
  return clamp01(LOOT.dropChance[type] * (THREAT_SCALE.dropChance[t] ?? 1));
}

/**
 * Botín al morir un infectado (o null). Orden de tiradas: probabilidad → tipo → importe.
 * Más amenaza = más probabilidad, mejores objetos (pesos) y más dinero.
 */
export function rollDrop(rng: Rng, type: EnemyType, threat: number): PickupDrop | null {
  const t = clampThreat(threat);
  if (rng() >= dropChance(type, t)) return null;
  return makeDrop(rng, rollKind(rng, t), t);
}

/** Número de objetos estáticos de una zona: LOOT.staticPerZone × THREAT_SCALE.dropChance[amenaza]. */
export function staticLootCount(zone: ZoneId): number {
  return Math.round(LOOT.staticPerZone[zone] * (THREAT_SCALE.dropChance[clampThreat(threatOf(zone))] ?? 1));
}

/**
 * Reparto estático inicial: elige posiciones distintas de `spots` (sin repetir ni mutar la
 * entrada) y les asigna tipo e importe según la amenaza de la zona.
 */
export function staticLootPlan(rng: Rng, zone: ZoneId, spots: readonly { x: number; z: number }[]): StaticLootItem[] {
  const threat = clampThreat(threatOf(zone));
  const count = Math.min(spots.length, staticLootCount(zone));
  // Fisher-Yates parcial sobre los índices: los primeros `count` son la muestra sin repetición.
  const idx = spots.map((_, i) => i);
  const out: StaticLootItem[] = [];
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (idx.length - i));
    const tmp = idx[i] as number;
    idx[i] = idx[j] as number;
    idx[j] = tmp;
    const spot = spots[idx[i] as number] as { x: number; z: number };
    const drop = makeDrop(rng, rollKind(rng, threat), threat);
    out.push({ x: spot.x, z: spot.z, kind: drop.kind, amount: drop.amount });
  }
  return out;
}

export interface PickupOutcome {
  /** false = el objeto no sirve ahora (no se consume). */
  collected: boolean;
  /** Cantidad realmente aplicada (dinero, cartuchos, unidades, vida). */
  amount: number;
}

const NOT_COLLECTED: PickupOutcome = Object.freeze({ collected: false, amount: 0 });

/**
 * Aplica una recogida respetando los topes. Sólo se consume si sirve: munición con las
 * reservas llenas, placas/granadas al tope, botiquín con vida completa → `collected: false`.
 */
export function applyPickup(state: RunState, kind: PickupKind, amount: number): PickupOutcome {
  const p = state.player;
  if (!p.alive || !(amount > 0)) return NOT_COLLECTED;
  switch (kind) {
    case 'cash': {
      const added = addMoney(state, amount);
      return added > 0 ? { collected: true, amount: added } : NOT_COLLECTED;
    }
    case 'ammo': {
      // Cada caja reparte LOOT.ammoFraction de cargador a cada arma con reserva libre.
      let total = 0;
      for (const slot of p.slots) {
        if (!slot) continue;
        const def = WEAPONS[slot.id];
        const give = Math.min(def.reserveMax - slot.reserve, Math.ceil(def.magSize * LOOT.ammoFraction * amount));
        if (give > 0) {
          slot.reserve += give;
          total += give;
        }
      }
      return total > 0 ? { collected: true, amount: total } : NOT_COLLECTED;
    }
    case 'plate': {
      const give = Math.min(Math.floor(amount), plateCap(state) - p.plates);
      if (give <= 0) return NOT_COLLECTED;
      p.plates += give;
      return { collected: true, amount: give };
    }
    case 'grenade': {
      const give = Math.min(Math.floor(amount), grenadeCap(state) - p.grenades);
      if (give <= 0) return NOT_COLLECTED;
      p.grenades += give;
      return { collected: true, amount: give };
    }
    case 'medkit': {
      const give = Math.min(amount, p.maxHp - p.hp);
      if (give <= 0) return NOT_COLLECTED;
      p.hp += give;
      return { collected: true, amount: give };
    }
  }
}
