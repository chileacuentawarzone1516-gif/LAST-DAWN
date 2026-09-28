/** Estado en ejecución de un enemigo y contexto compartido que usan la IA y el director. */
import type { EnemyHandle, GameContext, MoveResult } from '../core/context';
import type { EnemyType, Vec3 } from '../core/types';
import type { Rng } from '../core/util';
import { createLife, type EnemyLife, type EnemyStats, scaleEnemyStats } from '../rules/enemies';
import { AnimState } from './animation';
import type { FlowDir, FlowField, SpatialHash } from './flowfield';
import type { Rig } from './models';
import type { SpitPool } from './spit';

export type AiState =
  | 'guard' | 'idle' | 'wander' | 'investigate' | 'chase' | 'attack' | 'stagger'
  | 'telegraph' | 'charge' | 'recover' | 'roar' | 'dead';

export class Enemy implements EnemyHandle {
  id = 0;
  type: EnemyType;
  alive = false;
  readonly position: Vec3 = { x: 0, y: 0, z: 0 };
  yaw = 0;
  /** Empuje (retroceso) en m/s. */
  kx = 0;
  kz = 0;
  life: EnemyLife;
  stats: EnemyStats;
  threat = 1;
  /** Velocidad individual de persecución. */
  speed = 1;
  state: AiState = 'idle';
  stateT = 0;
  /** Destino de movimiento (ruido investigado, punto de deambulación). */
  tx = 0;
  tz = 0;
  homeX = 0;
  homeZ = 0;
  lastSeenX = 0;
  lastSeenZ = 0;
  sinceSeen = 0;
  seesPlayer = false;
  brainT = 0;
  cooldown = 0;
  /** Fase de ataque: 0 ninguna, 1 windup, 2 golpe/recuperación. */
  atkPhase = 0;
  atkT = 0;
  atkHit = 0;
  atkKind = 0;
  /** Horda/refuerzo: percepción forzada, no pierde el objetivo. */
  forced = false;
  /** Anclado por la API (QA): nunca se recicla por lejanía. */
  pinned = false;
  /** Generado por el director ambiental (se puede reciclar). */
  ambient = false;
  hordeId = '';
  stuckT = 0;
  lastX = 0;
  lastZ = 0;
  flowUntil = 0;
  strafe = 1;
  vocalT = 0;
  hurtT = 0;
  corpseT = 0;
  awake = false;
  lodT = 0;
  poseFrame = -1;
  // Específicos de bruto/Warden
  chargeCd = 0;
  slamCd = 0;
  chargeX = 0;
  chargeZ = 0;
  combo = 0;
  summonsDone = 0;
  enraged = false;
  engaged = false;
  leashT = 0;
  telegraphKind = 0;
  hitFlash = 0;
  // Casco desprendido (Warden)
  helmVx = 0;
  helmVy = 0;
  helmVz = 0;
  helmSpin = 0;
  helmDetached = false;
  helmRest = false;
  rig!: Rig;
  readonly anim = new AnimState();

  constructor(type: EnemyType) {
    this.type = type;
    this.stats = scaleEnemyStats(type, 1);
    this.life = createLife(type, 1);
  }

  get hp(): number {
    return this.life.hp;
  }
  get maxHp(): number {
    return this.life.maxHp;
  }
}

/** Contexto que la IA y el director comparten (lo implementa el sistema en index.ts). */
export interface AiSys {
  readonly ctx: GameContext;
  readonly rng: Rng;
  readonly flow: FlowField;
  readonly hash: SpatialHash;
  readonly spit: SpitPool;
  readonly enemies: Enemy[];
  readonly neighbors: Int32Array;
  readonly dir: FlowDir;
  readonly moveRes: MoveResult;
  time: number;
  px: number;
  py: number;
  pz: number;
  pAlive: boolean;
  grace: boolean;
  losBudget: number;
  vocal(e: Enemy, kind: 'idle' | 'alert' | 'attack' | 'hurt' | 'death'): void;
  attackEvent(e: Enemy, kind: 'melee' | 'spit' | 'slam'): void;
  alerted(e: Enemy): void;
  spawn(type: EnemyType, x: number, z: number, opts?: { forced?: boolean; pinned?: boolean; ambient?: boolean; threat?: number; hordeId?: string }): Enemy | null;
  /** Retira sitio (recicla ambientales lejanos) para `n` nuevos; devuelve cuántos caben. */
  makeRoom(n: number): number;
  /** Devuelve un enemigo vivo al pool sin cadáver (reciclado). */
  despawn(e: Enemy): void;
}
