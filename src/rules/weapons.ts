/**
 * Reglas PURAS de armas (sin three.js ni DOM): cadencia, dispersión, caída de daño,
 * recarga, munición y generación determinista de perdigones. Todo el balance sale de
 * `WEAPONS` y `WEAPON_HANDLING` (config.ts).
 */
import { WEAPON_HANDLING } from '../config';
import type { WeaponDef } from '../config';
import type { Rng } from '../core/util';
import { clamp, clamp01, lerp } from '../core/util';

// ─────────────────────────────────────────────────────────────────────────────
// Cadencia
// ─────────────────────────────────────────────────────────────────────────────

/** Segundos entre disparos a partir de las balas por minuto. */
export function fireIntervalS(def: Pick<WeaponDef, 'rpm'>): number {
  return def.rpm > 0 ? 60 / def.rpm : Infinity;
}

/** ¿Dispara mientras se mantiene el gatillo? */
export function isAutomatic(def: Pick<WeaponDef, 'fireMode'>): boolean {
  return def.fireMode === 'auto';
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispersión (grados, cono completo)
// ─────────────────────────────────────────────────────────────────────────────

export interface SpreadContext {
  /** 0 = cadera, 1 = apuntando del todo. */
  adsT: number;
  crouched: boolean;
  /** Velocidad horizontal normalizada: 0 quieto … 1 a la velocidad de marcha. */
  speed01: number;
  airborne: boolean;
  sprinting: boolean;
  /** Dispersión acumulada por los últimos disparos (grados). */
  shotSpread: number;
}

/** Dispersión base entre cadera y ADS (sin postura ni acumulación). */
export function baseSpreadDeg(def: Pick<WeaponDef, 'spreadHip' | 'spreadAds'>, adsT: number): number {
  const t = clamp01(adsT);
  if (t <= 0) return def.spreadHip;
  if (t >= 1) return def.spreadAds;
  return lerp(def.spreadHip, def.spreadAds, t);
}

/** Multiplicador por postura/movimiento: agacharse y estar quieto reducen; correr y saltar aumentan. */
export function spreadMultiplier(ctx: Pick<SpreadContext, 'crouched' | 'speed01' | 'airborne' | 'sprinting'>): number {
  const H = WEAPON_HANDLING;
  const speed = clamp01(ctx.speed01);
  let m = speed < 0.05 ? H.spreadStillMult : 1 + H.spreadMoveMult * speed;
  if (ctx.crouched) m *= H.spreadCrouchMult;
  if (ctx.sprinting) m *= H.spreadSprintMult;
  if (ctx.airborne) m *= H.spreadAirMult;
  return m;
}

/** Dispersión total actual (grados), limitada a max(spreadMax, base). */
export function currentSpreadDeg(def: WeaponDef, ctx: SpreadContext): number {
  const base = baseSpreadDeg(def, ctx.adsT);
  const total = base * spreadMultiplier(ctx) + Math.max(0, ctx.shotSpread);
  const cap = Math.max(def.spreadMax, base);
  return clamp(total, 0, cap);
}

/** Dispersión total normalizada 0..1 respecto al máximo del arma (punto de mira dinámico). */
export function spread01(def: Pick<WeaponDef, 'spreadMax'>, deg: number): number {
  return def.spreadMax > 0 ? clamp01(deg / def.spreadMax) : 0;
}

/** Nueva dispersión acumulada tras un disparo. Apuntando, el aumento es menor. */
export function spreadAfterShot(shotSpread: number, def: WeaponDef, adsT: number): number {
  const perShot = def.spreadPerShot * lerp(1, WEAPON_HANDLING.adsShotSpreadMult, clamp01(adsT));
  // El hueco hasta el máximo depende de la base actual: así no se acumula dispersión "oculta".
  const room = Math.max(0, def.spreadMax - baseSpreadDeg(def, adsT));
  return clamp(shotSpread + perShot, 0, room);
}

/** Segundos tras un disparo antes de que empiece a recuperarse la dispersión. */
export function spreadRecoveryDelayS(def: Pick<WeaponDef, 'rpm'>): number {
  return Math.max(WEAPON_HANDLING.spreadRecoveryMinDelayS, fireIntervalS(def) * WEAPON_HANDLING.spreadRecoveryDelayMult);
}

/** Recupera la dispersión acumulada: nada hasta pasado el retardo, luego `spreadRecoverPerS` grados/s. */
export function recoverSpread(shotSpread: number, def: WeaponDef, sinceShotS: number, dt: number): number {
  if (shotSpread <= 0) return 0;
  if (sinceShotS < spreadRecoveryDelayS(def)) return shotSpread;
  return Math.max(0, shotSpread - def.spreadRecoverPerS * dt);
}

// ─────────────────────────────────────────────────────────────────────────────
// Daño
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Daño de UN proyectil tras la caída con la distancia: pleno hasta `falloffStart`, lineal hasta
 * `damage × minDamageMult` en `falloffEnd` y constante a partir de ahí. Sin multiplicadores de zona.
 */
export function damageAfterFalloff(def: Pick<WeaponDef, 'damage' | 'falloffStart' | 'falloffEnd' | 'minDamageMult'>, distance: number): number {
  const d = Math.max(0, distance);
  if (d <= def.falloffStart) return def.damage;
  const min = def.damage * def.minDamageMult;
  if (d >= def.falloffEnd || def.falloffEnd <= def.falloffStart) return min;
  return lerp(def.damage, min, (d - def.falloffStart) / (def.falloffEnd - def.falloffStart));
}

// ─────────────────────────────────────────────────────────────────────────────
// Recarga y munición
// ─────────────────────────────────────────────────────────────────────────────

export interface ReloadPlan {
  /** 'none': nada que recargar · 'magazine': cargador entero · 'shells': cartucho a cartucho. */
  kind: 'none' | 'magazine' | 'shells';
  /** Duración total planificada (s). 0 si no hay recarga. */
  durationS: number;
  /** Duración del primer paso (cargador completo, o primer cartucho). */
  firstStepS: number;
  /** Duración de cada cartucho posterior (sólo 'shells'). */
  stepS: number;
  /** Cartuchos a insertar ('shells'); 0 en 'magazine'. */
  shells: number;
  /** Recarga táctica (quedaba munición en el cargador y el arma define reloadTacticalS). */
  tactical: boolean;
}

const NO_RELOAD: ReloadPlan = { kind: 'none', durationS: 0, firstStepS: 0, stepS: 0, shells: 0, tactical: false };

/** Cartuchos que caben ahora: mín(hueco del cargador, reserva). */
export function ammoToLoad(mag: number, reserve: number, magSize: number): number {
  return Math.max(0, Math.min(magSize - mag, reserve));
}

/** Plan de recarga con los tiempos del arma. */
export function planReload(def: WeaponDef, mag: number, reserve: number): ReloadPlan {
  const n = ammoToLoad(mag, reserve, def.magSize);
  if (n <= 0) return NO_RELOAD;
  if (def.reloadPerShellS !== undefined) {
    const stepS = def.reloadPerShellS;
    return { kind: 'shells', durationS: def.reloadS + (n - 1) * stepS, firstStepS: def.reloadS, stepS, shells: n, tactical: false };
  }
  const tactical = mag > 0 && def.reloadTacticalS !== undefined;
  const durationS = tactical ? (def.reloadTacticalS as number) : def.reloadS;
  return { kind: 'magazine', durationS, firstStepS: durationS, stepS: 0, shells: 0, tactical };
}

export interface AmmoState {
  mag: number;
  reserve: number;
}

/** Pasa munición de la reserva al cargador (recarga completa). Escribe en `out` y lo devuelve. */
export function transferAmmo(mag: number, reserve: number, magSize: number, out: AmmoState = { mag: 0, reserve: 0 }): AmmoState {
  const moved = ammoToLoad(mag, reserve, magSize);
  out.mag = mag + moved;
  out.reserve = reserve - moved;
  return out;
}

/** Inserta UN cartucho (escopeta). Sin efecto si el cargador está lleno o no hay reserva. */
export function transferShell(mag: number, reserve: number, magSize: number, out: AmmoState = { mag: 0, reserve: 0 }): AmmoState {
  const moved = ammoToLoad(mag, reserve, magSize) > 0 ? 1 : 0;
  out.mag = mag + moved;
  out.reserve = reserve - moved;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Perdigones / cono
// ─────────────────────────────────────────────────────────────────────────────

const GOLDEN_ANGLE = 2.399963229728653;

/**
 * Genera `count` desplazamientos (ox, oy) sobre el plano tangente unitario dentro de un cono de
 * `spreadDeg` grados (ángulo completo). La dirección final es normalize(fwd + right·ox + up·oy).
 * Determinista dado `rng`. Con count > 1 reparte los perdigones de forma estratificada (espiral
 * con jitter) para cubrir el cono sin huecos grandes; con 1 elige un punto uniforme del disco.
 * Escribe 2·count valores en `out` (Float32Array/Float64Array/number[]) y devuelve count.
 */
export function generatePellets(count: number, spreadDeg: number, rng: Rng, out: ArrayLike<number> & { [i: number]: number }): number {
  const n = Math.max(0, Math.floor(count));
  const radius = Math.tan((Math.max(0, spreadDeg) * Math.PI) / 360);
  if (n === 0) return 0;
  if (radius === 0) {
    for (let i = 0; i < n; i++) {
      out[i * 2] = 0;
      out[i * 2 + 1] = 0;
    }
    return n;
  }
  if (n === 1) {
    const r = radius * Math.sqrt(rng());
    const a = rng() * Math.PI * 2;
    out[0] = r * Math.cos(a);
    out[1] = r * Math.sin(a);
    return 1;
  }
  const phase = rng() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const r = radius * Math.sqrt((i + rng()) / n);
    const a = phase + i * GOLDEN_ANGLE + (rng() - 0.5) * 0.5;
    out[i * 2] = r * Math.cos(a);
    out[i * 2 + 1] = r * Math.sin(a);
  }
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// Apuntado (ADS) y FOV
// ─────────────────────────────────────────────────────────────────────────────

/** Acerca `current` a `target` (0..1) de forma lineal para que el recorrido completo dure `durationS`. */
export function approachLinear(current: number, target: number, dt: number, durationS: number): number {
  if (durationS <= 0) return target;
  const step = dt / durationS;
  if (current < target) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

/** Suavizado 0..1 → 0..1 (smoothstep). */
export function easeAds(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/** FOV vertical (grados) para un progreso de ADS `adsT` (0..1) con el zoom del arma. */
export function adsFov(baseFov: number, def: Pick<WeaponDef, 'adsFovMult'>, adsT: number): number {
  return baseFov * lerp(1, def.adsFovMult, easeAds(adsT));
}
