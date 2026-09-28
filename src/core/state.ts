import { MAP, PLAYER, STARTING_LOADOUT, WEAPONS } from '../config';
import type { VendorId } from '../config';
import type { EndReason, MissionStatus, Vec3, WeaponId, ZoneId } from './types';

/**
 * Estado de la partida: DATOS PLANOS serializables (sin three.js) — fuente única de
 * verdad para las reglas (src/rules), la UI y los tests.
 *
 * Reglas de uso:
 *  - `ctx.state` es una referencia ESTABLE: nunca se reemplaza, se reinicia in-place
 *    con resetRunState(). Los módulos persistentes (ui, audio, engine, world) deben
 *    leer siempre `ctx.state.x.y` y NO cachear sub-objetos.
 *  - Sólo el dueño de cada sección debe escribirla (ver comentarios).
 *  - Añadir campos es aditivo y permitido en la sección propia.
 */

export interface WeaponSlotState {
  id: WeaponId;
  mag: number;
  reserve: number;
}

/** Escrito por: player (pos, hp, armor, alive, ranuras/ammo al disparar) y rules/economy (dinero, compras). */
export interface PlayerState {
  alive: boolean;
  hp: number;
  maxHp: number;
  armor: number;
  maxArmor: number;
  plates: number;
  grenades: number;
  /** [0] principal (tecla 1) · [1] secundaria (tecla 2). */
  slots: [WeaponSlotState | null, WeaponSlotState | null];
  activeSlot: 0 | 1;
  /** Mochila táctica comprada: sube el máximo de placas/granadas. */
  hasPack: boolean;
  money: number;
  /** Posición de los pies (actualizada por el jugador cada frame). */
  pos: Vec3;
  /** Yaw en radianes (0 = norte/-Z). */
  yaw: number;
  zone: ZoneId;
  crouched: boolean;
  sprinting: boolean;
  aiming: boolean;
  reloading: boolean;
  usingPlate: boolean;
  /** 0..1: pico de dispersión actual (para mostrar el punto de mira dinámico). */
  spread: number;
}

export interface MatchState {
  /** Segundos de partida jugados (la pausa no cuenta). */
  elapsed: number;
  phase: 'playing' | 'won' | 'lost';
  endReason: EndReason | null;
  contamination: { active: boolean; radius: number };
  sealed: boolean;
  /** Avisos ya emitidos (claves 'contamination:60', 'seal:30'…). */
  warned: Record<string, boolean>;
  kills: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  moneyEarned: number;
  moneySpent: number;
}

export interface RelayMissionState {
  status: MissionStatus;
  activated: boolean;
  /** Segundos acumulados dentro del círculo (0..required). */
  progress: number;
  insideCircle: boolean;
  paid: boolean;
}

export interface WardenMissionState {
  status: MissionStatus;
  spawned: boolean;
  helmetBroken: boolean;
  killed: boolean;
  /** 0..1 vida restante (para la barra de jefe). */
  hpFraction: number;
  helmetFraction: number;
  engaged: boolean;
  paid: boolean;
}

export type ExtractionPhase = 'idle' | 'inbound' | 'landed' | 'boarding' | 'departing' | 'departed';

export interface ExtractionMissionState {
  status: MissionStatus;
  phase: ExtractionPhase;
  /** Segundos restantes hasta el aterrizaje (fase inbound). */
  etaRemaining: number;
  /** Segundos restantes de la ventana de abordaje (fase landed/boarding). */
  boardRemaining: number;
  /** 0..1 mientras se mantiene E para abordar. */
  boardProgress: number;
  boarded: boolean;
  paid: boolean;
  /** Segundos restantes de despegue (fase departing). Añadido por misiones. */
  departRemaining: number;
}

export interface MissionsState {
  relay: RelayMissionState;
  warden: WardenMissionState;
  extraction: ExtractionMissionState;
}

export type FlowState = 'title' | 'playing' | 'paused' | 'ended';
export type ModalKind = 'shop' | 'map' | null;

export interface UiState {
  modal: ModalKind;
  vendor: VendorId | null;
}

export interface RunState {
  flow: FlowState;
  player: PlayerState;
  match: MatchState;
  missions: MissionsState;
  ui: UiState;
}

export function createWeaponSlot(id: WeaponId, reserveMags: number): WeaponSlotState {
  const def = WEAPONS[id];
  return { id, mag: def.magSize, reserve: Math.min(def.reserveMax, def.magSize * reserveMags) };
}

export function createRunState(): RunState {
  return {
    flow: 'title',
    player: {
      alive: true,
      hp: PLAYER.maxHp,
      maxHp: PLAYER.maxHp,
      armor: 0,
      maxArmor: PLAYER.maxArmor,
      plates: PLAYER.start.plates,
      grenades: PLAYER.start.grenades,
      slots: [
        createWeaponSlot(STARTING_LOADOUT.slot0, STARTING_LOADOUT.reserveMags),
        createWeaponSlot(STARTING_LOADOUT.slot1, STARTING_LOADOUT.reserveMags),
      ],
      activeSlot: 0,
      hasPack: false,
      money: PLAYER.start.money,
      pos: { x: MAP.spawn.x, y: 0, z: MAP.spawn.z },
      yaw: MAP.spawn.yaw,
      zone: 'perimeter',
      crouched: false,
      sprinting: false,
      aiming: false,
      reloading: false,
      usingPlate: false,
      spread: 0,
    },
    match: {
      elapsed: 0,
      phase: 'playing',
      endReason: null,
      contamination: { active: false, radius: 0 },
      sealed: false,
      warned: {},
      kills: 0,
      headshots: 0,
      shotsFired: 0,
      shotsHit: 0,
      moneyEarned: 0,
      moneySpent: 0,
    },
    missions: {
      relay: { status: 'available', activated: false, progress: 0, insideCircle: false, paid: false },
      warden: { status: 'available', spawned: false, helmetBroken: false, killed: false, hpFraction: 1, helmetFraction: 1, engaged: false, paid: false },
      extraction: { status: 'locked', phase: 'idle', etaRemaining: 0, boardRemaining: 0, boardProgress: 0, boarded: false, paid: false, departRemaining: 0 },
    },
    ui: { modal: null, vendor: null },
  };
}

/** Reinicia el estado in-place conservando la identidad del objeto raíz. */
export function resetRunState(state: RunState, flow: FlowState = state.flow): void {
  Object.assign(state, createRunState());
  state.flow = flow;
}
