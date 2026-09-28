import type * as THREE from 'three';
import type { EventBus } from './events';
import type { RunState } from './state';
import type {
  EnemyType, HitZone, MaterialKey, MissionId, SurfaceKind, System, Vec2, Vec3, ZoneId, DamageSource, NotifyKind,
} from './types';
import type { VendorId } from '../config';

// ─────────────────────────────────────────────────────────────────────────────
// ENTRADA (implementada en core/input.ts)
// ─────────────────────────────────────────────────────────────────────────────
export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'sprint' | 'jump' | 'crouch' | 'interact'
  | 'fire' | 'aim' | 'reload' | 'slot1' | 'slot2' | 'grenade' | 'plate' | 'map';

export interface InputApi {
  /** ¿Se mantiene pulsada la acción ahora? */
  isDown(action: Action): boolean;
  /** ¿Se pulsó en este frame (flanco de subida)? */
  wasPressed(action: Action): boolean;
  wasReleased(action: Action): boolean;
  /** Rueda del ratón acumulada en este frame (>0 hacia abajo). */
  readonly wheelDelta: number;
  /** Delta de ratón acumulado en este frame (px); 0 si no hay pointer lock. */
  readonly lookDX: number;
  readonly lookDY: number;
  readonly locked: boolean;
  /** Si es false, las acciones no se registran (menús/pausa). */
  enabled: boolean;
  /** true en dispositivos táctiles (sin pointer lock: `locked` es siempre true). */
  readonly touch: boolean;
  /**
   * Movimiento analógico en [-1,1] (x = derecha, y = adelante): combina teclado (digital) y joystick
   * táctil. El jugador debe usar estos ejes (no isDown('forward')…) para que el joystick escale la velocidad.
   */
  readonly moveX: number;
  readonly moveY: number;
  /** Joystick táctil: fija el vector de movimiento analógico (0,0 lo suelta). */
  setStick(x: number, y: number): void;
  /** Suma un delta de mirada expresado en píxeles equivalentes de ratón (arrastre táctil, giroscopio). */
  addLook(dx: number, dy: number): void;
  /** Fija una acción como pulsada/soltada (botones táctiles, scripts de QA). */
  inject(action: Action, down: boolean): void;
  /** Pide pointer lock; DEBE llamarse dentro de un gesto del usuario. Nunca lanza. */
  requestLock(): Promise<boolean>;
  releaseLock(): void;
  /** Llamado por Game al final de cada frame para limpiar flancos. */
  endFrame(): void;
  dispose(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERACCIÓN (implementada en core/interaction.ts) — tecla E
// ─────────────────────────────────────────────────────────────────────────────
export interface Interactable {
  id: string;
  /** Posición de referencia en el mundo (se lee cada frame; puede ser dinámica). */
  position: () => Vec3;
  /** Distancia máxima al jugador (m, en el plano XZ + altura razonable). */
  radius: number;
  /** Texto de la indicación ('Activar transmisor'); null = no disponible/oculto ahora. */
  prompt: () => string | null;
  /** 0 = pulsar; >0 = mantener E durante estos segundos. */
  holdSeconds: number;
  /** Se ejecuta al completar (pulsación o fin de la retención). */
  onComplete: () => void;
  /** Mayor prioridad gana cuando hay varios en rango. Por defecto 0. */
  priority?: number;
}

export interface InteractionApi extends System {
  /** Registra un interactuable; devuelve la función para eliminarlo. */
  register(item: Interactable): () => void;
  readonly current: Interactable | null;
  /** 0..1 mientras se mantiene E sobre `current` con holdSeconds > 0. */
  readonly progress: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOTOR (src/engine)
// ─────────────────────────────────────────────────────────────────────────────
export interface MaterialsApi {
  /** Material compartido (NO clonar ni mutar). Las texturas ya vienen escaladas: ver tile(). */
  get(key: MaterialKey): THREE.Material;
  /** Metros de mundo que cubre una repetición de la textura (para generar UVs). */
  tile(key: MaterialKey): number;
}

export type FxKind = 'sparks' | 'dust' | 'blood' | 'acid' | 'explosion' | 'smoke' | 'muzzle' | 'heliDust' | 'toxic';

export interface FxApi extends System {
  /** Ráfaga de partículas puntual. `dir` (normal/dirección) es opcional. */
  burst(kind: FxKind, pos: Vec3, dir?: Vec3, scale?: number): void;
  /** Trazador de bala visible desde `from` hasta `to`. */
  tracer(from: Vec3, to: Vec3, color?: number): void;
  /** Decal (agujero de bala, mancha) sobre una superficie. */
  decal(kind: 'bullet' | 'blood' | 'scorch' | 'acid', point: Vec3, normal: Vec3, size?: number): void;
  /** Luz puntual efímera (fogonazo, explosión). Usa un pool: no crea luces nuevas por llamada. */
  flash(pos: Vec3, color: number, intensity: number, durationS: number, distance?: number): void;
}

export interface EngineStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
  quality: string;
}

export interface EngineApi extends System {
  readonly renderer: THREE.WebGLRenderer;
  /** Escena principal del mundo. */
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Escena/cámara del viewmodel (arma en primera persona): se dibuja encima con el depth limpio. */
  readonly viewScene: THREE.Scene;
  readonly viewCamera: THREE.PerspectiveCamera;
  readonly materials: MaterialsApi;
  readonly fx: FxApi;
  readonly stats: EngineStats;
  resize(width: number, height: number): void;
  /** Dibuja el frame (escena + viewmodel + post). */
  render(): void;
  setQuality(level: 'low' | 'medium' | 'high'): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// MUNDO (src/world)
// ─────────────────────────────────────────────────────────────────────────────
export interface RayHit {
  distance: number;
  point: Vec3;
  normal: Vec3;
  surface: SurfaceKind;
}

export interface MoveResult {
  x: number;
  z: number;
  /** Se chocó contra algo en X / en Z durante el movimiento. */
  blockedX: boolean;
  blockedZ: boolean;
}

/** Malla de navegación 2D: celdas de `cell` m. index = row * cols + col. */
export interface NavGrid {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly originX: number;
  readonly originZ: number;
  /** 1 = transitable, 0 = bloqueado (edificios, muros, obstáculos). */
  readonly walkable: Uint8Array;
  cellIndex(x: number, z: number): number;
  isWalkable(x: number, z: number): boolean;
  cellCenter(index: number, out: Vec2): Vec2;
}

export interface WorldApi extends System {
  /** Raíz de toda la geometría del mundo (ya añadida a la escena). */
  readonly group: THREE.Group;
  readonly nav: NavGrid;
  /** Posiciones transitables y a cielo abierto, útiles para generar infectados, por zona. */
  readonly spawnPoints: Record<ZoneId, Vec2[]>;
  /** Puntos donde repartir botín estático, por zona (dentro de edificios/callejones). */
  readonly lootSpots: Record<ZoneId, Vec2[]>;
  zoneAt(x: number, z: number): ZoneId;
  /**
   * Mueve un círculo (radio `radius`) de (x,z) en (dx,dz) deslizando contra los
   * colisionadores estáticos. `footY`/`headY` = altura de los pies y de la cabeza (los
   * obstáculos bajos < footY + stepHeight no bloquean). No asigna memoria si se pasa `out`.
   */
  moveCircle(x: number, z: number, dx: number, dz: number, radius: number, footY: number, headY: number, out?: MoveResult): MoveResult;
  /** Altura de la superficie más alta pisable bajo (x,z) que no exceda footY + stepHeight. */
  groundHeight(x: number, z: number, radius: number, footY: number): number;
  /** Rayo contra la geometría estática (muros, suelo). Devuelve el impacto más cercano. */
  raycast(origin: Vec3, dir: Vec3, maxDist: number): RayHit | null;
  hasLineOfSight(a: Vec3, b: Vec3): boolean;
  surfaceAt(x: number, z: number): SurfaceKind;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENEMIGOS (src/enemies)
// ─────────────────────────────────────────────────────────────────────────────
export interface EnemyHandle {
  readonly id: number;
  readonly type: EnemyType;
  readonly position: Vec3;
  readonly alive: boolean;
  readonly hp: number;
  readonly maxHp: number;
}

export interface EnemyRayHit {
  enemy: EnemyHandle;
  zone: HitZone;
  distance: number;
  point: Vec3;
  normal: Vec3;
}

export interface EnemyDamageInfo {
  /** Daño ya resuelto por el arma (con caída de distancia, sin multiplicador de zona). */
  amount: number;
  zone: HitZone;
  point: Vec3;
  normal: Vec3;
  /** Dirección del proyectil (para empuje/retroceso). */
  dir: Vec3;
}

export interface EnemiesApi extends System {
  /** Rayo contra las hitboxes de enemigos vivos: el más cercano dentro de maxDist. */
  raycast(origin: Vec3, dir: Vec3, maxDist: number): EnemyRayHit | null;
  /** Aplica daño a un enemigo (resuelve multiplicadores de zona, casco del Warden, muerte, eventos). */
  applyDamage(enemy: EnemyHandle, info: EnemyDamageInfo): void;
  /** Daño en área (granadas). Aplica caída lineal y línea de visión. */
  explode(center: Vec3, radius: number, maxDamage: number, minMult: number): void;
  readonly aliveCount: number;
  readonly list: readonly EnemyHandle[];
  /** Genera un enemigo (QA, hordas, refuerzos). */
  spawn(type: EnemyType, x: number, z: number): EnemyHandle | null;
  killAll(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// JUGADOR (src/player + src/weapons)
// ─────────────────────────────────────────────────────────────────────────────
export interface PlayerApi extends System {
  /** Pies. */
  readonly position: Vec3;
  /** Ojos (cámara). */
  readonly eye: Vec3;
  /** Dirección de la mirada (unitaria). */
  readonly forward: Vec3;
  readonly velocity: Vec3;
  /** Aplica daño (blindaje incluido). Emite player:damaged / player:died. */
  damage(amount: number, source: DamageSource, from?: Vec3 | null): void;
  heal(amount: number): void;
  teleport(x: number, z: number, yaw?: number): void;
  /** Bloquea/desbloquea el control (menús, muerte, cinemáticas). */
  setControlEnabled(enabled: boolean): void;
  godMode: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// MISIONES / ECONOMÍA (src/missions + src/rules)
// ─────────────────────────────────────────────────────────────────────────────
export interface HelicopterInfo {
  readonly object: THREE.Object3D;
  readonly position: Vec3;
  readonly active: boolean;
  /** 0 = parado, 1 = rotor a plena potencia (para audio/efectos). */
  readonly rotorSpeed: number;
  readonly landed: boolean;
}

export interface MissionsApi extends System {
  readonly helicopter: HelicopterInfo | null;
  /** Abre la tienda del vendedor si el jugador está en rango (usada por interactuables). */
  openShop(vendor: VendorId): void;
  closeShop(): void;
  /** Utilidad de QA: completa un contrato sin jugarlo. */
  debugComplete(id: MissionId): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI / AUDIO
// ─────────────────────────────────────────────────────────────────────────────
export interface UiApi extends System {
  notify(text: string, kind?: NotifyKind): void;
  /** Muestra u oculta el HUD (p. ej. durante el título). */
  setHudVisible(visible: boolean): void;
}

export interface AudioApi extends System {
  /** Crea/reanuda el AudioContext. Llamar dentro de un gesto del usuario. */
  unlock(): void;
  setMasterVolume(v: number): void;
  setMuted(muted: boolean): void;
  /** Sonido puntual por nombre (uso interno de audio y herramientas de dev). */
  readonly ready: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSONAJE (src/character) — maniquí 3D del operativo para la personalización
// ─────────────────────────────────────────────────────────────────────────────
export interface CharacterAnchor {
  /** Centro del área donde se ve el modelo, en fracciones de pantalla (0,0 = arriba-izquierda; 1,1 = abajo-derecha). */
  x: number;
  y: number;
  /** Altura del modelo como fracción de la altura de pantalla (p. ej. 0.8). */
  height: number;
}

export type CharacterPose = 'idle' | 'salute' | 'ready';

export interface CharacterApi extends System {
  /** Muestra el maniquí giratorio (se dibuja en viewScene, encima del mundo). */
  showPreview(anchor: CharacterAnchor): void;
  hidePreview(): void;
  readonly previewVisible: boolean;
  /** Recoloca el modelo (cambio de layout/orientación) sin reconstruirlo. */
  setAnchor(anchor: CharacterAnchor): void;
  /** Gira el modelo (arrastre del usuario), en radianes. */
  rotate(dyaw: number): void;
  setPose(pose: CharacterPose): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXTO
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Contexto compartido. Orden de construcción (un módulo sólo puede usar en su
 * FACTORY los anteriores; el resto está disponible en update()):
 *   bus, state, input, interactions, engine  (persistentes, siempre presentes)
 *   world → character → ui → audio → touch    (persistentes; touch sólo si input.touch)
 *   player → enemies → missions               (por partida: se recrean al reiniciar)
 *
 * Orden de update por frame: interactions, player, enemies, missions, world, fx, character, ui, audio, touch.
 */
export interface GameContext {
  readonly bus: EventBus;
  readonly state: RunState;
  readonly input: InputApi;
  readonly interactions: InteractionApi;
  readonly engine: EngineApi;
  // Atajos al motor
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly viewScene: THREE.Scene;
  readonly viewCamera: THREE.PerspectiveCamera;
  readonly materials: MaterialsApi;
  readonly fx: FxApi;
  world: WorldApi;
  character: CharacterApi;
  ui: UiApi;
  audio: AudioApi;
  /** Controles táctiles (sólo existe en dispositivos táctiles; en escritorio es un sistema vacío). */
  touch: System;
  player: PlayerApi;
  enemies: EnemiesApi;
  missions: MissionsApi;
  /** true con ?qa=1: sin pointer lock obligatorio y con window.__qa expuesto. */
  readonly qa: boolean;
}

/** Firma de las factorías de módulo. */
export type ModuleFactory<T> = (ctx: GameContext) => T;
export type { Vec2, Vec3 };
