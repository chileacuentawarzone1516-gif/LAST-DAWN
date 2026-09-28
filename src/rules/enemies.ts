/**
 * Reglas PURAS de enemigos (sin three.js ni DOM): escalado de estadísticas por amenaza,
 * estado de vida (con el casco del Warden) y resolución de impactos por zona.
 * La IA y el render solo leen/llaman a estas funciones; el balance vive en config.ts.
 */
import { ENEMIES, THREAT_SCALE, WARDEN } from '../config';
import type { EnemyType, HitZone } from '../core/types';
import { clamp, type Rng } from '../core/util';

export type InfectedType = Exclude<EnemyType, 'warden'>;

export const INFECTED_TYPES: readonly InfectedType[] = ['walker', 'runner', 'brute', 'spitter'];

/** Amenaza válida (1..4, entera). */
export function clampThreat(threat: number): number {
  if (!Number.isFinite(threat)) return 1;
  return clamp(Math.round(threat), 1, 4);
}

export function isInfected(type: EnemyType): type is InfectedType {
  return type !== 'warden';
}

/** Estadísticas efectivas de un individuo tras aplicar el escalado de su amenaza. */
export interface EnemyStats {
  maxHp: number;
  /** Velocidad de persecución (m/s) sin variación individual. */
  speed: number;
  wanderSpeed: number;
  /** Daño por golpe / proyectil, ya escalado por amenaza. */
  damage: number;
  /** Radio de visión (m). */
  sight: number;
  hearingMult: number;
  radius: number;
  height: number;
  attackRange: number;
  attackWindupS: number;
  attackCooldownS: number;
  staggerChance: number;
  staggerS: number;
  speedJitter: number;
}

/**
 * Escala vida/velocidad/daño/visión con THREAT_SCALE. El Warden es un jefe con cifras propias
 * (WARDEN) ya equilibradas para el complejo: NO se escala por amenaza.
 */
export function scaleEnemyStats(type: EnemyType, threat: number): EnemyStats {
  if (type === 'warden') {
    return {
      maxHp: WARDEN.hp,
      speed: WARDEN.speed,
      wanderSpeed: WARDEN.speed * 0.5,
      damage: WARDEN.meleeDamage,
      sight: WARDEN.aggroRange,
      hearingMult: 1,
      radius: WARDEN.radius,
      height: WARDEN.height,
      attackRange: WARDEN.attackRange,
      attackWindupS: WARDEN.comboWindupS,
      attackCooldownS: WARDEN.attackCooldownS,
      staggerChance: 0,
      staggerS: 0,
      speedJitter: 0,
    };
  }
  const def = ENEMIES[type];
  const t = clampThreat(threat);
  return {
    maxHp: Math.round(def.hp * (THREAT_SCALE.hp[t] ?? 1)),
    speed: def.speed * (THREAT_SCALE.speed[t] ?? 1),
    wanderSpeed: def.wanderSpeed,
    damage: def.damage * (THREAT_SCALE.damage[t] ?? 1),
    sight: def.sightRange * (THREAT_SCALE.sight[t] ?? 1),
    hearingMult: def.hearingMult,
    radius: def.radius,
    height: def.height,
    attackRange: def.attackRange,
    attackWindupS: def.attackWindupS,
    attackCooldownS: def.attackCooldownS,
    staggerChance: def.staggerChance,
    staggerS: def.staggerS,
    speedJitter: def.speedJitter,
  };
}

/** Velocidad individual: la de la especie ± speedJitter (determinista con `rng`). */
export function rollSpeed(stats: EnemyStats, rng: Rng): number {
  return stats.speed * (1 + (rng() * 2 - 1) * stats.speedJitter);
}

// ─────────────────────────────────────────────────────────────────────────────
// Vida e impactos
// ─────────────────────────────────────────────────────────────────────────────

/** Estado de vida mutable de un enemigo (casco solo para el Warden). */
export interface EnemyLife {
  type: EnemyType;
  hp: number;
  maxHp: number;
  helmetHp: number;
  helmetMaxHp: number;
  helmetBroken: boolean;
}

export function createLife(type: EnemyType, threat: number): EnemyLife {
  const stats = scaleEnemyStats(type, threat);
  const hasHelmet = type === 'warden';
  return {
    type,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    helmetHp: hasHelmet ? WARDEN.helmetHp : 0,
    helmetMaxHp: hasHelmet ? WARDEN.helmetHp : 0,
    helmetBroken: !hasHelmet,
  };
}

/** Reinicia in-place un estado de vida (para pools). */
export function resetLife(life: EnemyLife, type: EnemyType, threat: number): EnemyLife {
  const stats = scaleEnemyStats(type, threat);
  const hasHelmet = type === 'warden';
  life.type = type;
  life.hp = stats.maxHp;
  life.maxHp = stats.maxHp;
  life.helmetHp = hasHelmet ? WARDEN.helmetHp : 0;
  life.helmetMaxHp = hasHelmet ? WARDEN.helmetHp : 0;
  life.helmetBroken = !hasHelmet;
  return life;
}

export interface HitResult {
  /** Daño realmente descontado de la vida (acotado a la vida restante). */
  applied: number;
  /** Daño tras multiplicadores de zona, antes de acotar (útil para cifras flotantes / overkill). */
  scaled: number;
  killed: boolean;
  /** Daño descontado del casco (solo Warden con casco). */
  helmetDamage: number;
  /** El impacto fue al casco (con casco intacto antes del golpe). */
  helmetHit: boolean;
  /** Este impacto ROMPIÓ el casco (transición). */
  helmetBroken: boolean;
  /** Muerte por impacto en la cabeza (sin casco por medio). */
  headshotKill: boolean;
}

export function createHitResult(): HitResult {
  return { applied: 0, scaled: 0, killed: false, helmetDamage: 0, helmetHit: false, helmetBroken: false, headshotKill: false };
}

const clearHit = (out: HitResult): HitResult => {
  out.applied = 0;
  out.scaled = 0;
  out.killed = false;
  out.helmetDamage = 0;
  out.helmetHit = false;
  out.helmetBroken = false;
  out.headshotKill = false;
  return out;
};

/** Multiplicador de daño de una zona (sin considerar el casco del Warden con casco, que va aparte). */
export function zoneMultiplier(type: EnemyType, zone: HitZone, helmetBroken = true): number {
  if (type === 'warden') {
    if (zone === 'head') return helmetBroken ? WARDEN.headMultAfterHelmet : WARDEN.helmetDamageMult;
    return zone === 'body' ? WARDEN.bodyMult : WARDEN.limbMult;
  }
  const def = ENEMIES[type];
  return zone === 'head' ? def.headMult : zone === 'body' ? def.bodyMult : def.limbMult;
}

/**
 * Resuelve un impacto sobre `life` (lo MUTA) y devuelve el resultado.
 *
 * - Infectados: multiplicador de zona de ENEMIES.
 * - Warden con casco intacto: los impactos en la cabeza dañan SOLO el casco
 *   (helmetDamageMult, sin multiplicador de headshot); el exceso NO pasa a la vida.
 * - Warden sin casco: cabeza × headMultAfterHelmet; cuerpo × bodyMult; extremidades × limbMult.
 * - Un enemigo muerto, o un daño ≤ 0 / no finito, no hace nada.
 * `out` permite reutilizar el objeto de resultado (sin asignaciones).
 */
export function resolveHit(life: EnemyLife, zone: HitZone, amount: number, out: HitResult = createHitResult()): HitResult {
  clearHit(out);
  if (life.hp <= 0 || !(amount > 0) || !Number.isFinite(amount)) return out;

  if (life.type === 'warden' && zone === 'head' && !life.helmetBroken) {
    const scaled = amount * WARDEN.helmetDamageMult;
    const dealt = Math.min(life.helmetHp, scaled);
    life.helmetHp -= dealt;
    out.scaled = scaled;
    out.applied = dealt;
    out.helmetDamage = dealt;
    out.helmetHit = true;
    if (life.helmetHp <= 1e-6) {
      life.helmetHp = 0;
      life.helmetBroken = true;
      out.helmetBroken = true;
    }
    return out;
  }

  const scaled = amount * zoneMultiplier(life.type, zone, life.helmetBroken);
  const dealt = Math.min(life.hp, scaled);
  life.hp -= dealt;
  out.scaled = scaled;
  out.applied = dealt;
  if (life.hp <= 1e-6) {
    life.hp = 0;
    out.killed = true;
    out.headshotKill = zone === 'head';
  }
  return out;
}

/**
 * Segundos de aturdimiento tras un impacto. Warden: solo al romperse el casco.
 * Resto: tirada de `staggerChance` (no si murió).
 */
export function rollStagger(type: EnemyType, hit: HitResult, rng: Rng): number {
  if (hit.killed) return 0;
  if (type === 'warden') return hit.helmetBroken ? WARDEN.helmetBreakStaggerS : 0;
  const def = ENEMIES[type];
  return rng() < def.staggerChance ? def.staggerS : 0;
}

/** Velocidad de retroceso (m/s) por un impacto: crece con el daño relativo; el bruto pesa más y el Warden no se mueve. */
export function knockbackSpeed(type: EnemyType, applied: number, maxHp: number): number {
  if (type === 'warden' || maxHp <= 0) return 0;
  const rel = clamp(applied / maxHp, 0, 1);
  const base = 0.9 + rel * 6;
  return Math.min(4.2, base) * (type === 'brute' ? 0.3 : type === 'runner' ? 0.85 : 1);
}

/**
 * Daño de una explosión a distancia `dist` (m, medida al borde del enemigo): caída lineal de
 * `maxDamage` (centro) a `maxDamage × minMult` (borde del radio); 0 fuera del radio.
 */
export function explosionDamage(maxDamage: number, minMult: number, dist: number, radius: number): number {
  if (radius <= 0 || dist > radius || maxDamage <= 0) return 0;
  const t = clamp(dist / radius, 0, 1);
  return maxDamage * (1 + (minMult - 1) * t);
}
