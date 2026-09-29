/**
 * Reglas PURAS de interfaz: marcadores del mapa/brújula, rumbos, texto de contratos,
 * contaminación y reloj de hitos. Sin three.js ni DOM: sólo datos planos (testeable).
 *
 * Convenciones angulares (las mismas que `state.player.yaw`):
 *  - 0 = norte (-Z). El yaw crece hacia la IZQUIERDA (antihorario visto desde arriba):
 *    con yaw = +π/2 el jugador mira al oeste (-X).
 *  - `bearingTo` devuelve el yaw que habría que tener para mirar directamente al objetivo.
 *  - `compassOffset` devuelve el ángulo relativo respecto a la vista: positivo = a la
 *    DERECHA, negativo = a la izquierda, 0 = de frente, ±π = a la espalda.
 */
import { CONTAMINATION, MAP, MISSIONS, SHOP, THEME, TIMERS } from '../config';
import type { RunState } from '../core/state';
import type { MissionId } from '../core/types';
import { dist2D, formatClock, wrapAngle } from '../core/util';

// ─────────────────────────────────────────────────────────────────────────────
// Marcadores
// ─────────────────────────────────────────────────────────────────────────────
export type MarkerKind = 'relay' | 'warden' | 'lz' | 'radio' | 'heli' | 'armory' | 'cage' | 'gate';

export interface Marker {
  id: string;
  kind: MarkerKind;
  x: number;
  z: number;
  /** Nombre completo (leyenda, accesibilidad). */
  label: string;
  /** Nombre corto (rótulo sobre el mapa). */
  short: string;
  color: string;
  /** true = objetivo vigente ahora (pulsa en el mapa y aparece en la brújula). */
  active: boolean;
  /** Radio de la zona asociada en metros (círculo del relé). */
  radius?: number;
}

type MissionsView = Pick<RunState, 'missions'>;

/** Fases de la extracción en las que el helicóptero existe en el mundo. */
const HELI_PHASES = ['inbound', 'landed', 'boarding', 'departing'] as const;

/** ¿Se puede usar la radio del LZ? (requiere el relé restaurado). */
export function hasRadioSignal(state: MissionsView): boolean {
  const { relay } = state.missions;
  return !MISSIONS.extraction.requiresRelay || relay.status === 'completed' || relay.paid;
}

/**
 * Marcadores del mundo según el estado de los contratos. El Warden sólo aparece mientras
 * vive; el helicóptero sólo mientras existe. El orden es estable (relevantes primero).
 */
export function getMarkers(state: MissionsView): Marker[] {
  const { relay, warden, extraction } = state.missions;
  const out: Marker[] = [];

  const relayDone = relay.status === 'completed' || relay.paid;
  out.push({
    id: 'relay', kind: 'relay', x: MAP.relay.x, z: MAP.relay.z,
    label: relayDone ? 'Relé restaurado' : 'Relé de comunicaciones', short: 'Relé',
    color: THEME.info, active: !relayDone, radius: MAP.relay.circleRadius,
  });

  const wardenAlive = !warden.killed && warden.status !== 'completed' && !warden.paid;
  if (wardenAlive) {
    out.push({
      id: 'warden', kind: 'warden', x: MAP.complex.wardenSpawn.x, z: MAP.complex.wardenSpawn.z,
      label: 'El Warden', short: 'Warden', color: THEME.danger, active: true,
    });
  }

  const extractionOver = extraction.status === 'completed' || extraction.paid || extraction.phase === 'departed';
  const heliPresent = (HELI_PHASES as readonly string[]).includes(extraction.phase);
  const signal = hasRadioSignal(state);
  const lz = MAP.lz;
  out.push({
    id: 'lz', kind: 'lz', x: lz.center.x, z: lz.center.z,
    label: 'Zona de extracción (LZ)', short: 'LZ', color: THEME.accent,
    active: signal && !extractionOver && !heliPresent, radius: lz.padRadius,
  });
  out.push({
    id: 'radio', kind: 'radio', x: lz.radio.x, z: lz.radio.z,
    label: signal ? 'Radio del LZ' : 'Radio del LZ (sin señal)', short: 'Radio', color: THEME.accent,
    active: signal && extraction.phase === 'idle' && !extractionOver,
  });
  if (heliPresent) {
    out.push({
      id: 'heli', kind: 'heli', x: lz.center.x, z: lz.center.z,
      label: 'Helicóptero de extracción', short: 'Helicóptero', color: THEME.reward,
      active: extraction.phase !== 'departing',
    });
  }

  out.push({
    id: 'armory', kind: 'armory', x: MAP.armory.x, z: MAP.armory.z,
    label: 'Banco de armería', short: 'Armería', color: THEME.reward, active: false,
  });
  for (const cage of MAP.cages) {
    out.push({
      id: cage.id, kind: 'cage', x: cage.x, z: cage.z,
      label: SHOP.cage.title, short: 'Jaula', color: THEME.warn, active: false,
    });
  }
  out.push({
    id: 'gate', kind: 'gate', x: MAP.complex.gate.x, z: MAP.complex.gate.z,
    label: 'Puerta del complejo', short: 'Puerta', color: THEME.textDim, active: false,
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rumbos
// ─────────────────────────────────────────────────────────────────────────────
interface XZ {
  x: number;
  z: number;
}

/** Yaw (rad, en (-π, π]) que apunta desde `from` hacia `to`. Coincidentes → 0. */
export function bearingTo(from: XZ, to: XZ): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || (dx === 0 && dz === 0)) return 0;
  return wrapAngle(Math.atan2(-dx, -dz));
}

/**
 * Ángulo relativo (rad, en (-π, π]) de un rumbo respecto a la vista: positivo = a la derecha.
 * Con envoltura correcta en ±π (el ángulo a la espalda es siempre +π).
 */
export function compassOffset(yaw: number, bearing: number): number {
  if (!Number.isFinite(yaw) || !Number.isFinite(bearing)) return 0;
  return wrapAngle(yaw - bearing);
}

/** Ángulo relativo del punto `to` visto por un jugador en `from` con orientación `yaw`. */
export function relativeAngle(yaw: number, from: XZ, to: XZ): number {
  return compassOffset(yaw, bearingTo(from, to));
}

/** Rumbo de brújula en grados [0, 360): 0 = N, 90 = E, 180 = S, 270 = O (sentido horario). */
export function headingDeg(yaw: number): number {
  if (!Number.isFinite(yaw)) return 0;
  const deg = ((-yaw * 180) / Math.PI) % 360;
  const h = (deg + 360) % 360;
  // Evita devolver 360 por redondeo de coma flotante.
  return h >= 360 ? 0 : h;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contaminación
// ─────────────────────────────────────────────────────────────────────────────
type MatchView = Pick<RunState, 'match'>;

/** Metros de profundidad dentro de la nube (0 fuera o si aún no está activa). */
export function contaminationDepth(pos: XZ, state: MatchView): number {
  const c = state.match.contamination;
  if (!c.active || c.radius <= 0) return 0;
  const d = dist2D(pos.x, pos.z, CONTAMINATION.center.x, CONTAMINATION.center.z);
  return Math.max(0, c.radius - d);
}

/** ¿Está la posición dentro de la nube activa? (el borde cuenta como dentro). */
export function contaminationInside(pos: XZ, state: MatchView): boolean {
  const c = state.match.contamination;
  if (!c.active || c.radius <= 0) return false;
  return dist2D(pos.x, pos.z, CONTAMINATION.center.x, CONTAMINATION.center.z) <= c.radius;
}

/** Píldoras de amenaza encendidas: [true, true, false, false] para amenaza 2 de 4. */
export function threatPips(threat: number, max = 4): boolean[] {
  const n = Number.isFinite(threat) ? Math.max(0, Math.min(max, Math.round(threat))) : 0;
  const pips: boolean[] = [];
  for (let i = 0; i < max; i++) pips.push(i < n);
  return pips;
}

// ─────────────────────────────────────────────────────────────────────────────
// Texto de contratos
// ─────────────────────────────────────────────────────────────────────────────
export type ObjectiveStatus = 'locked' | 'todo' | 'active' | 'done' | 'failed';
export type Tone = 'normal' | 'warn' | 'danger';

export interface ObjectiveLine {
  id: MissionId;
  title: string;
  /** Instrucción dinámica en español. */
  text: string;
  status: ObjectiveStatus;
  /** 0..1 para la barra fina del contrato; null si no aplica. */
  progress: number | null;
  tone: Tone;
  reward: number;
  paid: boolean;
}

const clock = (s: number): string => formatClock(Math.ceil(Math.max(0, s)));
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);

function statusOf(s: string, done: boolean): ObjectiveStatus {
  if (done || s === 'completed') return 'done';
  if (s === 'active') return 'active';
  if (s === 'locked') return 'locked';
  if (s === 'failed') return 'failed';
  return 'todo';
}

/** Una línea por contrato (relé, Warden, extracción) con el texto que verá el jugador. */
export function formatObjective(state: MissionsView): ObjectiveLine[] {
  const { relay, warden, extraction } = state.missions;
  const R = MISSIONS.relay;
  const E = MISSIONS.extraction;

  // ── Relé ───────────────────────────────────────────────────────────────
  const relayDone = relay.status === 'completed' || relay.paid;
  let relayText: string;
  let relayProgress: number | null = null;
  let relayTone: Tone = 'normal';
  if (relayDone) {
    relayText = 'Relé restaurado';
    relayProgress = 1;
  } else if (!relay.activated) {
    relayText = 'Activa el transmisor';
  } else {
    const secs = Math.floor(Math.max(0, Math.min(R.requiredS, relay.progress)));
    relayText = relay.insideCircle
      ? `Permanece en el círculo ${secs}/${R.requiredS} s`
      : `Vuelve al círculo ${secs}/${R.requiredS} s`;
    relayProgress = clamp01(relay.progress / R.requiredS);
    if (!relay.insideCircle) relayTone = 'warn';
  }

  // ── Warden ─────────────────────────────────────────────────────────────
  const wardenDone = warden.killed || warden.status === 'completed' || warden.paid;
  let wardenText: string;
  if (wardenDone) wardenText = 'Warden eliminado';
  else if (warden.helmetBroken) wardenText = 'Casco destruido: apunta a la cabeza';
  else wardenText = 'Elimina al Warden';

  // ── Extracción ─────────────────────────────────────────────────────────
  const exDone = extraction.status === 'completed' || extraction.paid;
  let exText: string;
  let exProgress: number | null = null;
  let exTone: Tone = 'normal';
  let exStatus = statusOf(extraction.status, exDone);
  if (exDone) {
    exText = 'Extracción completada';
    exProgress = 1;
  } else if (!hasRadioSignal(state) && extraction.phase === 'idle') {
    exText = 'Sin señal: restaura el relé';
    exStatus = 'locked';
  } else {
    switch (extraction.phase) {
      case 'idle':
        exText = 'Llama al helicóptero en la radio del LZ';
        if (exStatus === 'locked') exStatus = 'todo';
        break;
      case 'inbound':
        exText = `Llegada en ${clock(extraction.etaRemaining)}`;
        exProgress = clamp01(1 - extraction.etaRemaining / E.etaS);
        exStatus = 'active';
        break;
      case 'landed':
      case 'boarding':
        exText = `Aborda: quedan ${clock(extraction.boardRemaining)}`;
        exProgress = clamp01(extraction.boardRemaining / E.boardWindowS);
        exTone = extraction.boardRemaining <= TIMERS.warnings[2] ? 'danger' : extraction.boardRemaining <= TIMERS.warnings[1] ? 'warn' : 'normal';
        exStatus = 'active';
        break;
      case 'departing':
        exText = extraction.boarded ? 'Despegando: extracción en curso' : 'El helicóptero se va sin ti';
        exStatus = extraction.boarded ? 'active' : 'failed';
        break;
      case 'departed':
        exText = extraction.boarded ? 'Extracción completada' : 'El helicóptero se fue sin ti';
        exStatus = extraction.boarded ? 'done' : 'failed';
        break;
    }
  }

  return [
    {
      id: 'relay', title: R.title, text: relayText, status: statusOf(relay.status, relayDone),
      progress: relayProgress, tone: relayTone, reward: R.reward, paid: relay.paid,
    },
    {
      id: 'warden', title: MISSIONS.warden.title, text: wardenText, status: statusOf(warden.status, wardenDone),
      progress: null, tone: 'normal', reward: MISSIONS.warden.reward, paid: warden.paid,
    },
    {
      id: 'extraction', title: E.title, text: exText, status: exStatus,
      progress: exProgress, tone: exTone, reward: E.reward, paid: extraction.paid,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Reloj de hitos
// ─────────────────────────────────────────────────────────────────────────────
export type ClockKind = 'contamination' | 'seal' | 'sealed' | 'heli' | 'board' | 'departing' | 'departed';

export interface ClockInfo {
  kind: ClockKind;
  /** Texto listo para mostrar: 'CONTAMINACIÓN en 2:10'. */
  label: string;
  /** Segundos restantes hasta el hito (0 si no aplica). */
  remaining: number;
  tone: Tone;
}

function toneFor(remaining: number, warn: number, danger: number): Tone {
  return remaining <= danger ? 'danger' : remaining <= warn ? 'warn' : 'normal';
}

/**
 * Cuenta atrás al siguiente hito: contaminación (7:30) → sellado (12:00). Una vez llamada
 * la extracción, el hito relevante pasa a ser la llegada / la ventana de abordaje.
 */
export function matchClock(state: Pick<RunState, 'match' | 'missions'>): ClockInfo {
  const { match } = state;
  const ex = state.missions.extraction;
  switch (ex.phase) {
    case 'inbound':
      return { kind: 'heli', label: `HELICÓPTERO en ${clock(ex.etaRemaining)}`, remaining: ex.etaRemaining, tone: 'normal' };
    case 'landed':
    case 'boarding':
      return {
        kind: 'board', label: `ABORDAJE — quedan ${clock(ex.boardRemaining)}`, remaining: ex.boardRemaining,
        tone: toneFor(ex.boardRemaining, TIMERS.warnings[1], TIMERS.warnings[2]),
      };
    case 'departing':
      return { kind: 'departing', label: ex.boarded ? 'DESPEGANDO' : 'HELICÓPTERO EN VUELO', remaining: 0, tone: 'normal' };
    case 'departed':
      return { kind: 'departed', label: ex.boarded ? 'EXTRACCIÓN COMPLETADA' : 'HELICÓPTERO PERDIDO', remaining: 0, tone: ex.boarded ? 'normal' : 'danger' };
    default:
      break;
  }
  if (match.sealed || match.elapsed >= TIMERS.sealS) {
    return { kind: 'sealed', label: 'DISTRITO SELLADO', remaining: 0, tone: 'danger' };
  }
  if (match.contamination.active || match.elapsed >= TIMERS.contaminationStartS) {
    const left = TIMERS.sealS - match.elapsed;
    return {
      kind: 'seal', label: `SELLADO en ${clock(left)}`, remaining: left,
      tone: toneFor(left, TIMERS.warnings[0], TIMERS.warnings[1]),
    };
  }
  const left = TIMERS.contaminationStartS - match.elapsed;
  return {
    kind: 'contamination', label: `CONTAMINACIÓN en ${clock(left)}`, remaining: left,
    tone: toneFor(left, TIMERS.warnings[0], TIMERS.warnings[1]),
  };
}
