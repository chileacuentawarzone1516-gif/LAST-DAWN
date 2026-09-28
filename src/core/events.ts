import type {
  DamageSource, EndReason, EnemyType, HitZone, MissionId, NotifyKind, SurfaceKind, Vec2, Vec3,
  VendorKind, WeaponId, ZoneId,
} from './types';
import type { PickupKind } from '../config';

/**
 * Catálogo de eventos del juego. Los payloads son datos planos (Vec3 = {x,y,z}):
 * el emisor puede reutilizar sus vectores; los oyentes NO deben guardar referencias.
 *
 * Regla de acoplamiento: audio, fx y ui reaccionan a estos eventos. Los módulos de
 * juego emiten el evento y no llaman directamente a audio/fx salvo API explícita.
 */
export interface GameEvents {
  // ── Flujo ────────────────────────────────────────────────────────────────
  'flow:started': Record<string, never>;
  'flow:paused': Record<string, never>;
  'flow:resumed': Record<string, never>;
  'flow:ended': { result: 'won' | 'lost'; reason: EndReason };
  // Peticiones de la UI a Game
  'ui:startRequested': Record<string, never>;
  'ui:resumeRequested': Record<string, never>;
  'ui:restartRequested': Record<string, never>;
  'ui:titleRequested': Record<string, never>;

  // ── Entrada ──────────────────────────────────────────────────────────────
  /** Tecla 1-6 pulsada (flanco). Player usa 1/2 para armas salvo que la tienda esté abierta. */
  'input:digit': { n: number };
  'input:lockChanged': { locked: boolean };

  // ── Jugador ──────────────────────────────────────────────────────────────
  'player:shot': { weapon: WeaponId; origin: Vec3; dir: Vec3; end: Vec3; hit: 'none' | 'world' | 'enemy'; noise: number; suppressed: boolean };
  'player:reloadStarted': { weapon: WeaponId; durationS: number };
  'player:reloadFinished': { weapon: WeaponId };
  'player:dryFire': { weapon: WeaponId };
  'player:weaponSwitched': { slot: 0 | 1; weapon: WeaponId };
  'player:damaged': { amount: number; hpDamage: number; armorDamage: number; source: DamageSource; from: Vec3 | null; hp: number; armor: number };
  'player:healed': { amount: number; hp: number };
  'player:plateStarted': { durationS: number };
  'player:plateUsed': { armor: number };
  'player:died': { source: DamageSource };
  'player:jumped': Record<string, never>;
  'player:landed': { impact: number };
  'player:footstep': { surface: SurfaceKind; speed: number; crouched: boolean; sprinting: boolean; pos: Vec3 };
  'player:grenadeThrown': { origin: Vec3; velocity: Vec3 };
  /** Confirmación de impacto para el punto de mira. */
  'player:hitConfirm': { zone: HitZone; killed: boolean; helmet: boolean };

  // ── Mundo / balística ───────────────────────────────────────────────────
  'bullet:impact': { point: Vec3; normal: Vec3; surface: SurfaceKind };
  'grenade:bounce': { pos: Vec3 };
  'grenade:exploded': { pos: Vec3; radius: number };

  // ── Enemigos ─────────────────────────────────────────────────────────────
  'enemy:spawned': { id: number; type: EnemyType; pos: Vec3; zone: ZoneId };
  'enemy:alerted': { id: number; type: EnemyType; pos: Vec3 };
  'enemy:vocal': { id: number; type: EnemyType; pos: Vec3; kind: 'idle' | 'alert' | 'attack' | 'hurt' | 'death' };
  'enemy:attack': { id: number; type: EnemyType; pos: Vec3; kind: 'melee' | 'spit' | 'slam' };
  'enemy:hit': {
    id: number; type: EnemyType; pos: Vec3; point: Vec3; normal: Vec3; zone: HitZone;
    damage: number; killed: boolean; helmetHit: boolean; helmetBroken: boolean;
  };
  'enemy:died': { id: number; type: EnemyType; pos: Vec3; zone: ZoneId; threat: number; headshot: boolean };
  'warden:helmetBroken': { pos: Vec3 };
  'warden:roar': { pos: Vec3 };

  // ── Botín y economía ────────────────────────────────────────────────────
  'pickup:collected': { kind: PickupKind; amount: number; pos: Vec3 };
  /** La economía modificó armas/munición/consumibles: el jugador debe resincronizar. */
  'loadout:changed': Record<string, never>;
  'money:changed': { balance: number; delta: number; reason: string };
  'shop:opened': { vendor: VendorKind };
  'shop:closed': { vendor: VendorKind };
  'shop:purchase': { vendor: VendorKind; itemId: string; price: number };
  'shop:denied': { vendor: VendorKind; itemId: string; reason: 'funds' | 'full' | 'owned' };

  // ── Misiones ─────────────────────────────────────────────────────────────
  'mission:updated': { id: MissionId };
  'mission:completed': { id: MissionId; reward: number };
  'relay:activated': Record<string, never>;
  'relay:progress': { seconds: number; required: number; inside: boolean };
  'horde:started': { id: 'relay' | 'extraction'; center: Vec2 };
  'horde:ended': { id: 'relay' | 'extraction' };
  'extraction:called': { etaS: number };
  'extraction:landed': Record<string, never>;
  'extraction:boarding': { progress: number };
  'extraction:departed': { boarded: boolean };

  // ── Partida ──────────────────────────────────────────────────────────────
  'match:contaminationStarted': Record<string, never>;
  'match:sealed': Record<string, never>;
  /** Aviso de hito: 'contamination' o 'seal' con los segundos restantes. */
  'match:warning': { kind: 'contamination' | 'seal'; secondsLeft: number };
  'zone:entered': { zone: ZoneId; threat: number };

  // ── UI ───────────────────────────────────────────────────────────────────
  'ui:notify': { text: string; kind: NotifyKind };
}

type Handler<T> = (payload: T) => void;

/** Bus de eventos tipado y síncrono. */
export class EventBus {
  private readonly handlers = new Map<keyof GameEvents, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(type: K, handler: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(type, handler);
  }

  once<K extends keyof GameEvents>(type: K, handler: Handler<GameEvents[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      handler(p);
    });
    return off;
  }

  off<K extends keyof GameEvents>(type: K, handler: Handler<GameEvents[K]>): void {
    this.handlers.get(type)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of [...set]) (h as Handler<GameEvents[K]>)(payload);
  }

  /**
   * Crea un ámbito de suscripciones: todas se cancelan con scope.dispose().
   * Imprescindible en módulos por-partida para poder reiniciar sin fugas.
   */
  scope(): EventScope {
    return new EventScope(this);
  }
}

export class EventScope {
  private readonly offs: Array<() => void> = [];
  constructor(private readonly bus: EventBus) {}

  on<K extends keyof GameEvents>(type: K, handler: Handler<GameEvents[K]>): this {
    this.offs.push(this.bus.on(type, handler));
    return this;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}
