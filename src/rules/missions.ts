/**
 * Contratos: relé, Warden y extracción, más el LIBRO DE PAGOS (cada contrato paga una sola vez).
 * REGLAS PURAS (sin three.js ni DOM). Operan sobre `state.missions` / `state.match`.
 *
 * Máquina de extracción (`state.missions.extraction.phase`):
 *   idle → inbound (etaS) → landed (boardWindowS) ⇄ boarding (boardHoldS) → departing (departDurationS) → departed
 * `boarded` distingue cómo termina `departing`: true = el jugador se va en el helicóptero
 * (contrato pagado, victoria); false = la ventana venció y el helicóptero se va sin él.
 */
import { MAP, MISSIONS } from '../config';
import type { ExtractionMissionState, RunState } from '../core/state';
import type { MissionId } from '../core/types';
import { addMoney } from './economy';
import { isSealed } from './match';

// ── Libro de pagos ───────────────────────────────────────────────────────────

/** Recompensa de un contrato. */
export function contractReward(id: MissionId): number {
  return MISSIONS[id].reward;
}

/**
 * Paga el contrato SOLO la primera vez (bandera `paid`) y devuelve lo pagado (0 si ya estaba
 * pagado). Es idempotente: repetir eventos, reactivar o completar de nuevo no vuelve a pagar.
 */
export function payContract(state: RunState, id: MissionId): number {
  const mission = state.missions[id];
  if (mission.paid) return 0;
  mission.paid = true;
  return addMoney(state, contractReward(id));
}

// ── Relé ─────────────────────────────────────────────────────────────────────

/** ¿Está (x, z) dentro del círculo del relé? (borde incluido). */
export function isInsideRelay(x: number, z: number): boolean {
  return Math.hypot(x - MAP.relay.x, z - MAP.relay.z) <= MAP.relay.circleRadius;
}

/** Activa el transmisor. false si ya estaba activo o completado (no se reactiva). */
export function activateRelay(state: RunState): boolean {
  const r = state.missions.relay;
  if (r.activated || r.status === 'completed') return false;
  r.activated = true;
  r.status = 'active';
  r.progress = 0;
  r.insideCircle = false;
  return true;
}

/** Marca el relé como restaurado y desbloquea la extracción. Idempotente. */
export function completeRelay(state: RunState): void {
  const r = state.missions.relay;
  r.activated = true;
  r.status = 'completed';
  r.progress = MISSIONS.relay.requiredS;
  r.insideCircle = false;
  const ex = state.missions.extraction;
  if (ex.status === 'locked') ex.status = 'available';
}

export type RelayTick = 'idle' | 'progress' | 'completed';

/**
 * Avanza el relé: el progreso sube 1 s por s SOLO dentro del círculo y decae a
 * MISSIONS.relay.decayPerS fuera (0 = solo pausa). Completa al alcanzar `requiredS`.
 * Devuelve 'idle' si no está activo, 'progress' mientras avanza y 'completed' UNA vez.
 */
export function tickRelay(state: RunState, dt: number, inside: boolean): RelayTick {
  const r = state.missions.relay;
  if (!r.activated || r.status !== 'active') return 'idle';
  const step = dt > 0 ? dt : 0;
  r.insideCircle = inside;
  r.progress = inside
    ? Math.min(MISSIONS.relay.requiredS, r.progress + step)
    : Math.max(0, r.progress - MISSIONS.relay.decayPerS * step);
  if (r.progress >= MISSIONS.relay.requiredS) {
    completeRelay(state);
    return 'completed';
  }
  return 'progress';
}

// ── Warden ───────────────────────────────────────────────────────────────────

// El módulo de enemigos es dueño de `warden.{spawned,engaged,helmetBroken,killed,hpFraction,helmetFraction}`;
// aquí SOLO se cambia `status` (y `paid` vía payContract).

/** El Warden entra en combate o pierde el casco: el contrato pasa de disponible a activo. true si cambia. */
export function activateWardenContract(state: RunState): boolean {
  const w = state.missions.warden;
  if (w.status !== 'available') return false;
  w.status = 'active';
  return true;
}

/** Casco roto (evento `warden:helmetBroken`): el contrato pasa a activo. true si cambia el estado. */
export function onWardenHelmetBroken(state: RunState): boolean {
  return activateWardenContract(state);
}

/** El Warden ha muerto: contrato completado. true si ESTA llamada lo completa (no repite). */
export function onWardenKilled(state: RunState): boolean {
  const w = state.missions.warden;
  if (w.status === 'completed') return false;
  w.status = 'completed';
  return true;
}

// ── Extracción ───────────────────────────────────────────────────────────────

/** ¿Puede llamarse ahora a la extracción? (relé restaurado si se exige, distrito sin sellar, fase idle). */
export function canCallExtraction(state: RunState): boolean {
  if (state.match.phase !== 'playing' || isSealed(state)) return false;
  if (state.missions.extraction.phase !== 'idle') return false;
  return !MISSIONS.extraction.requiresRelay || state.missions.relay.status === 'completed';
}

/** Llama al helicóptero: idle → inbound con `etaS` de cuenta atrás. false si no se puede. */
export function callExtraction(state: RunState): boolean {
  if (!canCallExtraction(state)) return false;
  const ex = state.missions.extraction;
  ex.phase = 'inbound';
  ex.status = 'active';
  ex.etaRemaining = MISSIONS.extraction.etaS;
  ex.boardRemaining = 0;
  ex.boardProgress = 0;
  ex.departRemaining = 0;
  return true;
}

export interface ExtractionInput {
  /** El jugador está a menos de MAP.lz.boardRadius del helicóptero posado. */
  near: boolean;
  /** El jugador mantiene la acción de abordar (E). */
  holding: boolean;
}

export type ExtractionEvent =
  | { type: 'landed' }
  | { type: 'boarded' }
  | { type: 'departing'; boarded: boolean }
  | { type: 'departed'; boarded: boolean };

const NO_EVENTS: readonly ExtractionEvent[] = Object.freeze([]);

function beginDeparture(ex: ExtractionMissionState, boarded: boolean): void {
  ex.phase = 'departing';
  ex.boarded = boarded;
  ex.status = boarded ? 'completed' : 'failed';
  ex.departRemaining = MISSIONS.extraction.departDurationS;
  ex.boardProgress = boarded ? 1 : 0;
  if (!boarded) ex.boardRemaining = 0;
}

/**
 * Embarca al jugador de inmediato (fin de la retención de E o QA). Sólo desde landed/boarding.
 * Devuelve true si esta llamada produce el abordaje.
 */
export function forceBoard(state: RunState): boolean {
  const ex = state.missions.extraction;
  if (ex.phase !== 'landed' && ex.phase !== 'boarding') return false;
  beginDeparture(ex, true);
  return true;
}

/**
 * Avanza la máquina de extracción y devuelve los eventos de transición ocurridos
 * (lista compartida vacía si no hay ninguno: no asigna memoria en el caso habitual).
 *  - inbound: cuenta atrás de la ETA; al llegar a 0 aterriza y abre la ventana de abordaje.
 *  - landed/boarding: la ventana cuenta atrás (se congela mientras se aborda activamente);
 *    mantener E cerca acumula progreso (boardHoldS), soltar o alejarse lo decae; al 100 % → abordado.
 *    Si la ventana vence sin abordar, el helicóptero despega sin el jugador.
 *  - departing: cuenta atrás del despegue; al terminar → departed.
 */
export function tickExtraction(state: RunState, dt: number, input: ExtractionInput): readonly ExtractionEvent[] {
  const ex = state.missions.extraction;
  const step = dt > 0 ? dt : 0;
  switch (ex.phase) {
    case 'idle':
    case 'departed':
      return NO_EVENTS;

    case 'inbound': {
      ex.etaRemaining = Math.max(0, ex.etaRemaining - step);
      if (ex.etaRemaining > 0) return NO_EVENTS;
      ex.phase = 'landed';
      ex.boardRemaining = MISSIONS.extraction.boardWindowS;
      ex.boardProgress = 0;
      return [{ type: 'landed' }];
    }

    case 'landed':
    case 'boarding': {
      const engaged = input.near && input.holding;
      if (engaged) {
        ex.phase = 'boarding';
        ex.boardProgress = Math.min(1, ex.boardProgress + step / MISSIONS.extraction.boardHoldS);
      } else {
        // Soltar o alejarse: el progreso se pierde al doble de velocidad de lo que se gana.
        ex.boardProgress = Math.max(0, ex.boardProgress - (2 * step) / MISSIONS.extraction.boardHoldS);
        if (ex.boardProgress <= 0) ex.phase = 'landed';
      }
      if (ex.boardProgress >= 1) {
        beginDeparture(ex, true);
        return [{ type: 'boarded' }, { type: 'departing', boarded: true }];
      }
      // La ventana sólo corre mientras no se está abordando activamente.
      if (ex.boardProgress <= 0) ex.boardRemaining = Math.max(0, ex.boardRemaining - step);
      if (ex.boardRemaining <= 0) {
        beginDeparture(ex, false);
        return [{ type: 'departing', boarded: false }];
      }
      return NO_EVENTS;
    }

    case 'departing': {
      ex.departRemaining = Math.max(0, ex.departRemaining - step);
      if (ex.departRemaining > 0) return NO_EVENTS;
      ex.phase = 'departed';
      return [{ type: 'departed', boarded: ex.boarded }];
    }
  }
}

// ── Completar por la vía de reglas (QA / debugComplete) ──────────────────────

/**
 * Completa un contrato saltándose el juego, usando las MISMAS reglas y el mismo libro de
 * pagos. Devuelve lo pagado en esta llamada (0 si ya estaba pagado). Para la extracción
 * fuerza el abordaje (relé y llamada incluidos) sin importar dónde esté el jugador.
 */
export function completeContract(state: RunState, id: MissionId): number {
  switch (id) {
    case 'relay':
      if (state.missions.relay.status !== 'completed') completeRelay(state);
      break;
    case 'warden':
      onWardenKilled(state);
      break;
    case 'extraction': {
      if (state.missions.relay.status !== 'completed') completeRelay(state);
      const ex = state.missions.extraction;
      if (ex.phase === 'idle' && canCallExtraction(state)) callExtraction(state);
      if (ex.phase === 'inbound') {
        ex.phase = 'landed';
        ex.boardRemaining = MISSIONS.extraction.boardWindowS;
      }
      forceBoard(state);
      // Si el helicóptero ya se fue sin el jugador no hay contrato que pagar.
      if (!ex.boarded) return 0;
      break;
    }
  }
  return payContract(state, id);
}
