/**
 * Reglas PURAS de combate del jugador (sin three.js ni DOM): absorción del blindaje,
 * daño por caída y por explosión, placas de armadura y curación.
 */
import { CONTAMINATION, PLAYER } from '../config';
import type { DamageSource } from '../core/types';
import { clamp, lerp } from '../core/util';

export interface Vitals {
  hp: number;
  armor: number;
}

export interface DamageResult {
  /** Parte del daño que se llevó el blindaje. */
  armorDamage: number;
  /** Parte del daño que pasó a la vida (sin limitar a la vida restante). */
  hpDamage: number;
}

/**
 * ¿Protege el blindaje de esta fuente? La contaminación lo ignora según CONTAMINATION.armorProtects
 * y la caída siempre (el impacto no pasa por la placa).
 */
export function armorProtectsFrom(source: DamageSource): boolean {
  if (source === 'contamination') return CONTAMINATION.armorProtects;
  if (source === 'fall') return false;
  return true;
}

/**
 * Reparte `amount` entre blindaje y vida sin modificar nada.
 * El blindaje absorbe `PLAYER.armorAbsorb` del daño mientras dure; si se agota a mitad de golpe,
 * el resto pasa íntegro a la vida. Daño ≤ 0 o no finito → 0.
 */
export function splitDamage(armor: number, amount: number, source: DamageSource, out: DamageResult = { armorDamage: 0, hpDamage: 0 }): DamageResult {
  if (!(amount > 0) || !Number.isFinite(amount)) {
    out.armorDamage = 0;
    out.hpDamage = 0;
    return out;
  }
  const absorbed = armorProtectsFrom(source) ? Math.min(Math.max(0, armor), amount * PLAYER.armorAbsorb) : 0;
  out.armorDamage = absorbed;
  out.hpDamage = amount - absorbed;
  return out;
}

/**
 * Aplica daño al estado (`hp`, `armor`) in-place, sin bajar de 0, y devuelve el reparto.
 * Siempre se cumple armorDamage + hpDamage === amount (para amount > 0).
 */
export function applyDamageToPlayer(state: Vitals, amount: number, source: DamageSource = 'melee', out?: DamageResult): DamageResult {
  const res = splitDamage(state.armor, amount, source, out);
  state.armor = Math.max(0, state.armor - res.armorDamage);
  state.hp = Math.max(0, state.hp - res.hpDamage);
  return res;
}

/** Daño por caída a partir de la velocidad vertical de impacto (m/s, positiva hacia abajo). */
export function fallDamage(impactSpeed: number): number {
  if (!(impactSpeed > PLAYER.fallDamageMinSpeed)) return 0;
  return (impactSpeed - PLAYER.fallDamageMinSpeed) * PLAYER.fallDamagePerMps;
}

/**
 * Daño de una explosión: `maxDamage` en el centro, cae linealmente hasta `maxDamage × minMult` en
 * el borde (`radius`) y es 0 fuera. `selfMult` escala el resultado (autodaño del jugador).
 */
export function explosionDamage(distance: number, radius: number, maxDamage: number, minMult: number, selfMult = 1): number {
  if (radius <= 0 || !(distance <= radius)) return 0;
  const t = clamp(distance / radius, 0, 1);
  return lerp(maxDamage, maxDamage * minMult, t) * selfMult;
}

/** ¿Se puede empezar a usar una placa? Hace falta una placa y blindaje por debajo del máximo. */
export function canUsePlate(plates: number, armor: number, maxArmor: number): boolean {
  return plates > 0 && armor < maxArmor;
}

/** Blindaje resultante de colocar una placa (limitado al máximo). */
export function applyPlate(armor: number, maxArmor: number, perPlate: number = PLAYER.armorPerPlate): number {
  return Math.min(maxArmor, Math.max(0, armor) + Math.max(0, perPlate));
}

/** Curación limitada al máximo. Devuelve la vida nueva y lo realmente curado. */
export function applyHeal(hp: number, maxHp: number, amount: number): { hp: number; healed: number } {
  if (!(amount > 0) || hp >= maxHp) return { hp: Math.min(hp, maxHp), healed: 0 };
  const next = Math.min(maxHp, hp + amount);
  return { hp: next, healed: next - hp };
}
