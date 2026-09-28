/**
 * Reglas de partida: contaminación, sellado del distrito, avisos y condiciones de final.
 * REGLAS PURAS (sin three.js ni DOM). Opera sobre `RunState`; `Game` avanza `match.elapsed`
 * y el módulo de misiones llama a `tickMatch` / `evaluateEnd` cada frame.
 *
 * Línea de tiempo: 0 ─── contaminación (7:30) ─── sellado (12:00).
 * Llamar a la extracción ANTES del sellado evita perder por sellado.
 */
import { CONTAMINATION, TIMERS } from '../config';
import type { RunState } from '../core/state';
import type { EndReason } from '../core/types';
import { clamp01, lerp } from '../core/util';

// ── Contaminación ────────────────────────────────────────────────────────────

/** Radio (m) de la contaminación: 0 = inactiva; lineal startRadius → endRadius hasta el sellado. */
export function contaminationRadius(elapsed: number): number {
  // `!(x >= y)` también descarta NaN.
  if (!(elapsed >= TIMERS.contaminationStartS)) return 0;
  const t = clamp01((elapsed - TIMERS.contaminationStartS) / (TIMERS.sealS - TIMERS.contaminationStartS));
  return lerp(CONTAMINATION.startRadius, CONTAMINATION.endRadius, t);
}

/** Profundidad (m) bajo la superficie de la nube: > 0 dentro, 0 en el borde, < 0 fuera (o inactiva). */
export function contaminationDepth(x: number, z: number, radius: number): number {
  if (!(radius > 0)) return -1;
  return radius - Math.hypot(x - CONTAMINATION.center.x, z - CONTAMINATION.center.z);
}

/** ¿El punto está dentro de la nube (borde incluido)? */
export function isInContamination(x: number, z: number, radius: number): boolean {
  return contaminationDepth(x, z, radius) >= 0;
}

/** Daño por segundo a `depth` metros de profundidad: dpsEdge + dpsPerMeterDeep·depth, con tope dpsMax. */
export function contaminationDps(depth: number): number {
  if (!(depth >= 0)) return 0;
  return Math.min(CONTAMINATION.dpsMax, CONTAMINATION.dpsEdge + CONTAMINATION.dpsPerMeterDeep * depth);
}

// ── Sellado ──────────────────────────────────────────────────────────────────

/** ¿Está sellado el distrito? (bandera de estado o reloj pasado de 12:00). */
export function isSealed(state: RunState): boolean {
  return state.match.sealed || state.match.elapsed >= TIMERS.sealS;
}

// ── Tick de partida ──────────────────────────────────────────────────────────

export type MatchEvent =
  | { type: 'warning'; kind: 'contamination' | 'seal'; secondsLeft: number }
  | { type: 'contaminationStarted' }
  | { type: 'sealed' };

const NO_EVENTS: readonly MatchEvent[] = Object.freeze([]);

// Claves de `match.warned` precalculadas: sin concatenar cadenas en el bucle caliente.
const WARN_KEYS = {
  contamination: TIMERS.warnings.map((w) => `contamination:${w}`),
  seal: TIMERS.warnings.map((w) => `seal:${w}`),
};

/**
 * Marca como emitidos los avisos ya vencidos de un hito y devuelve el más urgente que aún
 * merece anunciarse (o null). Si el reloj salta (p. ej. QA), sólo se anuncia el último y los
 * anteriores se marcan en silencio; pasado el hito no se anuncia nada.
 */
function dueWarning(warned: Record<string, boolean>, kind: 'contamination' | 'seal', target: number, t: number): number | null {
  const keys = WARN_KEYS[kind];
  let announce: number | null = null;
  for (let i = 0; i < TIMERS.warnings.length; i++) {
    const key = keys[i] as string;
    const w = TIMERS.warnings[i] as number;
    if (warned[key] || t < target - w) continue;
    warned[key] = true;
    if (t < target && (announce === null || w < announce)) announce = w;
  }
  return announce;
}

/**
 * Avanza las reglas de partida con el reloj actual (`match.elapsed`, ya sumado por Game).
 * Actualiza `contamination.{active,radius}` y `sealed`, y devuelve los eventos ocurridos
 * (cada aviso una sola vez). Sin eventos devuelve una lista compartida vacía (no asigna).
 * `_dt` se recibe por simetría con el resto de ticks: el reloj no lo necesita.
 */
export function tickMatch(state: RunState, _dt: number): readonly MatchEvent[] {
  const m = state.match;
  if (m.phase !== 'playing') return NO_EVENTS;
  const t = m.elapsed;
  let events: MatchEvent[] | null = null;

  const radius = contaminationRadius(t);
  m.contamination.radius = radius;

  const warnC = dueWarning(m.warned, 'contamination', TIMERS.contaminationStartS, t);
  if (warnC !== null) (events ??= []).push({ type: 'warning', kind: 'contamination', secondsLeft: warnC });

  if (!m.contamination.active && t >= TIMERS.contaminationStartS) {
    m.contamination.active = true;
    (events ??= []).push({ type: 'contaminationStarted' });
  }

  const warnS = dueWarning(m.warned, 'seal', TIMERS.sealS, t);
  if (warnS !== null) (events ??= []).push({ type: 'warning', kind: 'seal', secondsLeft: warnS });

  if (!m.sealed && t >= TIMERS.sealS) {
    m.sealed = true;
    (events ??= []).push({ type: 'sealed' });
  }
  return events ?? NO_EVENTS;
}

// ── Final de partida ─────────────────────────────────────────────────────────

export interface EndVerdict {
  readonly result: 'won' | 'lost';
  readonly reason: EndReason;
}

const DEAD: EndVerdict = Object.freeze({ result: 'lost', reason: 'dead' });
const SEALED: EndVerdict = Object.freeze({ result: 'lost', reason: 'sealed' });
const HELI_LEFT: EndVerdict = Object.freeze({ result: 'lost', reason: 'heli_left' });
const EXTRACTED: EndVerdict = Object.freeze({ result: 'won', reason: 'extracted' });

/**
 * Veredicto de la partida en el estado actual (null = sigue en juego o ya terminó).
 * Prioridad: muerte → abordado (victoria) → helicóptero se va sin el jugador →
 * distrito sellado sin haber llamado a la extracción.
 * Las constantes devueltas son compartidas e inmutables (no asigna memoria).
 */
export function evaluateEnd(state: RunState): EndVerdict | null {
  if (state.match.phase !== 'playing') return null;
  const ex = state.missions.extraction;
  if (!state.player.alive) return DEAD;
  if (ex.boarded) return EXTRACTED;
  if (ex.phase === 'departing' || ex.phase === 'departed') return HELI_LEFT;
  if (isSealed(state) && ex.phase === 'idle') return SEALED;
  return null;
}
