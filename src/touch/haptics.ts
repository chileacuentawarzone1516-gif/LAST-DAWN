/** Lógica pura de la vibración háptica: duración proporcional al daño y limitación de frecuencia. */

/** Vibración (ms) proporcional al daño recibido: mínimo 35 % y máximo 150 % de `baseMs`. */
export function damagePulseMs(amount: number, baseMs: number): number {
  if (!(amount > 0) || !(baseMs > 0)) return 0;
  const ms = amount * 2;
  return Math.round(Math.min(baseMs * 1.5, Math.max(baseMs * 0.35, ms)));
}

/** ¿Ha pasado al menos `minGapMs` desde el último aviso del mismo tipo? */
export function gateOpen(lastMs: number, nowMs: number, minGapMs: number): boolean {
  return nowMs - lastMs >= minGapMs;
}

/** Separación mínima (ms) entre vibraciones de cada tipo. */
export const HAPTIC_GAP_MS = { shot: 90, hit: 70, damage: 140, pickup: 120, landed: 1000 } as const;

export type HapticKind = keyof typeof HAPTIC_GAP_MS;
