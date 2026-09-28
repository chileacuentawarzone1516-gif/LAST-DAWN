/**
 * DEAD SIGNAL: EXCLUSION ZONE — configuración y balance.
 *
 * ÚNICA fuente de verdad de números de juego (daños, precios, tiempos, mapa).
 * Ningún módulo debe hardcodear cifras de balance: se leen de aquí.
 *
 * Convenciones:
 *  - Unidades: metros, segundos, grados (salvo que el nombre indique otra cosa).
 *  - Eje Y arriba. El norte es -Z. El complejo está al norte; el LZ al sur.
 *  - Cada agente/módulo edita SÓLO su sección; para añadir claves nuevas, usar
 *    ediciones puntuales (nunca reescribir el fichero entero).
 */
import type { EnemyType, MissionId, WeaponId, ZoneId } from './core/types';

// ─────────────────────────────────────────────────────────────────────────────
// TEMA (UI + colores de juego compartidos)
// ─────────────────────────────────────────────────────────────────────────────
export const THEME = {
  bg: '#070b14',
  panel: 'rgba(9, 15, 28, 0.78)',
  text: '#d6e4f5',
  textDim: '#8298b4',
  accent: '#5fe0b7', // verde señal
  warn: '#ffb020',
  danger: '#ff4d4d',
  reward: '#ffd866',
  info: '#6fb4ff',
  zoneColors: {
    perimeter: '#4fc38a',
    warehouses: '#e0c04f',
    refinery: '#ff8a3d',
    complex: '#ff3d55',
  } as Record<ZoneId, string>,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// MAPA — distrito de 400 × 400 m. x ∈ [-200, 200], z ∈ [-200, 200]. Norte = -Z.
// ─────────────────────────────────────────────────────────────────────────────
export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const MAP = {
  bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 } as Rect,
  /** Tamaño de celda de la malla de navegación. */
  navCell: 2,
  /** Punto de inicio del jugador (pies) y orientación (yaw en radianes; 0 mira al norte, -Z). */
  spawn: { x: -22, z: 172, yaw: 0 },
  lz: {
    center: { x: 0, z: 165 },
    padRadius: 14,
    /** Terminal de radio con la que se llama al helicóptero. */
    radio: { x: 19, z: 163 },
    /** Distancia máxima al helicóptero posado para poder abordar. */
    boardRadius: 12,
  },
  armory: { x: -30, z: 160 },
  cages: [
    { id: 'cage_perimeter', x: -70, z: 125, zone: 'perimeter' },
    { id: 'cage_warehouses', x: 60, z: 35, zone: 'warehouses' },
    { id: 'cage_refinery', x: -72, z: -68, zone: 'refinery' },
    { id: 'cage_complex', x: -24, z: -120, zone: 'complex' },
  ] as { id: string; x: number; z: number; zone: ZoneId }[],
  relay: { x: 92, z: -62, circleRadius: 9 },
  complex: {
    center: { x: 0, z: -155 },
    /** Apertura del muro sur del complejo. */
    gate: { x: 0, z: -105, width: 12 },
    wardenSpawn: { x: 0, z: -170 },
  },
  /**
   * Zonas: la PRIMERA que contenga el punto gana (el orden importa).
   * threat: 1 (baja) … 4 (máxima).
   */
  zones: [
    { id: 'complex', name: 'Complejo de Investigación', threat: 4, rect: { minX: -75, maxX: 75, minZ: -200, maxZ: -105 } },
    { id: 'refinery', name: 'Refinería y Patio de Contenedores', threat: 3, rect: { minX: -200, maxX: 200, minZ: -200, maxZ: -25 } },
    { id: 'warehouses', name: 'Polígono de Almacenes', threat: 2, rect: { minX: -200, maxX: 200, minZ: -25, maxZ: 85 } },
    { id: 'perimeter', name: 'Perímetro Sur', threat: 1, rect: { minX: -200, maxX: 200, minZ: 85, maxZ: 200 } },
  ] as { id: ZoneId; name: string; threat: number; rect: Rect }[],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// TEMPORIZADORES / REGLAS DE PARTIDA
// ─────────────────────────────────────────────────────────────────────────────
export const TIMERS = {
  /** 7:30 — se extiende la contaminación desde el complejo. */
  contaminationStartS: 7 * 60 + 30,
  /** 12:00 — el distrito se sella. */
  sealS: 12 * 60,
  /** Pausa entre la muerte/derrota y la pantalla final (cámara cae). */
  endScreenDelayS: 1.8,
  /** Avisos de tiempo (segundos restantes) antes de cada hito. */
  warnings: [60, 30, 10],
} as const;

export const CONTAMINATION = {
  center: MAP.complex.center,
  startRadius: 25,
  /** Radio alcanzado justo al sellarse el distrito (no llega al LZ: está a 315 m). */
  endRadius: 250,
  /** Daño por segundo en el borde y aumento por metro de profundidad. */
  dpsEdge: 3,
  dpsPerMeterDeep: 0.06,
  dpsMax: 14,
  /** El blindaje NO protege de la contaminación. */
  armorProtects: false,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// JUGADOR
// ─────────────────────────────────────────────────────────────────────────────
export const PLAYER = {
  maxHp: 100,
  maxArmor: 100,
  armorPerPlate: 50,
  plateUseS: 1.4,
  /** Fracción del daño que absorbe el blindaje mientras dura (el resto pasa a la vida). */
  armorAbsorb: 0.6,
  /** Regeneración: 0 = desactivada (no hay botiquín instantáneo con tecla; se compra). */
  regenPerS: 0,
  start: { plates: 1, grenades: 2, money: 400 },
  cap: { plates: 4, grenades: 4, platesPack: 6, grenadesPack: 6 },
  eyeHeight: 1.7,
  crouchEyeHeight: 1.1,
  radius: 0.35,
  height: 1.8,
  crouchHeight: 1.2,
  walkSpeed: 4.3,
  sprintSpeed: 7.0,
  crouchSpeed: 2.2,
  aimSpeedMult: 0.65,
  accel: 42,
  airControl: 0.35,
  gravity: 18,
  jumpSpeed: 5.6,
  stepHeight: 0.45,
  /** FOV vertical base (grados). */
  fov: 75,
  fallDamageMinSpeed: 11,
  fallDamagePerMps: 6,
  mouseSensitivity: 0.0022,
  adsSensitivityMult: 0.55,
  interactReach: 3.2,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// ARMAS
// ─────────────────────────────────────────────────────────────────────────────
export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** 0 = principal (tecla 1), 1 = secundaria (tecla 2). */
  slot: 0 | 1;
  fireMode: 'semi' | 'auto' | 'pump';
  /** Daño por proyectil (cuerpo, sin caída). */
  damage: number;
  pellets: number;
  rpm: number;
  magSize: number;
  reserveMax: number;
  reloadS: number;
  /** Recarga táctica (cargador con bala en recámara) — si falta, usa reloadS. */
  reloadTacticalS?: number;
  /** Escopeta: recarga cartucho a cartucho. */
  reloadPerShellS?: number;
  /** Dispersión (grados, cono completo) sin apuntar / apuntando. */
  spreadHip: number;
  spreadAds: number;
  spreadPerShot: number;
  spreadRecoverPerS: number;
  spreadMax: number;
  /** Retroceso por disparo (grados). */
  recoilPitch: number;
  recoilYaw: number;
  /** Distancias de caída de daño (m): pleno hasta start; mínimo desde end. */
  falloffStart: number;
  falloffEnd: number;
  minDamageMult: number;
  /** Multiplicador de zoom al apuntar (fov × adsFovMult). */
  adsFovMult: number;
  adsTimeS: number;
  /** Radio (m) en el que los infectados oyen el disparo. */
  noise: number;
  moveSpeedMult: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    id: 'pistol', name: 'P-9 "Vector"', slot: 1, fireMode: 'semi',
    damage: 24, pellets: 1, rpm: 380, magSize: 15, reserveMax: 105, reloadS: 1.6, reloadTacticalS: 1.3,
    spreadHip: 2.4, spreadAds: 0.7, spreadPerShot: 0.7, spreadRecoverPerS: 5, spreadMax: 5,
    recoilPitch: 1.5, recoilYaw: 0.5, falloffStart: 18, falloffEnd: 45, minDamageMult: 0.55,
    adsFovMult: 0.85, adsTimeS: 0.12, noise: 45, moveSpeedMult: 1.0,
  },
  revolver: {
    id: 'revolver', name: 'Magnum .44 "Marshal"', slot: 1, fireMode: 'semi',
    damage: 82, pellets: 1, rpm: 135, magSize: 6, reserveMax: 42, reloadS: 2.7,
    spreadHip: 3.0, spreadAds: 0.5, spreadPerShot: 1.6, spreadRecoverPerS: 4, spreadMax: 6,
    recoilPitch: 5.5, recoilYaw: 1.4, falloffStart: 25, falloffEnd: 70, minDamageMult: 0.6,
    adsFovMult: 0.82, adsTimeS: 0.16, noise: 75, moveSpeedMult: 0.98,
  },
  carbine: {
    id: 'carbine', name: 'CR-5 Carabina', slot: 0, fireMode: 'auto',
    damage: 21, pellets: 1, rpm: 450, magSize: 25, reserveMax: 175, reloadS: 2.1, reloadTacticalS: 1.8,
    spreadHip: 3.2, spreadAds: 0.9, spreadPerShot: 0.55, spreadRecoverPerS: 6, spreadMax: 6.5,
    recoilPitch: 1.05, recoilYaw: 0.55, falloffStart: 28, falloffEnd: 70, minDamageMult: 0.5,
    adsFovMult: 0.78, adsTimeS: 0.16, noise: 60, moveSpeedMult: 0.96,
  },
  smg: {
    id: 'smg', name: 'MP-9 Subfusil', slot: 0, fireMode: 'auto',
    damage: 17, pellets: 1, rpm: 860, magSize: 32, reserveMax: 224, reloadS: 1.8, reloadTacticalS: 1.5,
    spreadHip: 4.2, spreadAds: 1.6, spreadPerShot: 0.5, spreadRecoverPerS: 7, spreadMax: 8,
    recoilPitch: 0.75, recoilYaw: 0.7, falloffStart: 14, falloffEnd: 40, minDamageMult: 0.42,
    adsFovMult: 0.85, adsTimeS: 0.12, noise: 55, moveSpeedMult: 1.02,
  },
  assault: {
    id: 'assault', name: 'AR-12 Fusil de asalto', slot: 0, fireMode: 'auto',
    damage: 31, pellets: 1, rpm: 640, magSize: 30, reserveMax: 210, reloadS: 2.3, reloadTacticalS: 1.9,
    spreadHip: 3.4, spreadAds: 0.8, spreadPerShot: 0.5, spreadRecoverPerS: 6, spreadMax: 6,
    recoilPitch: 1.2, recoilYaw: 0.65, falloffStart: 35, falloffEnd: 95, minDamageMult: 0.55,
    adsFovMult: 0.72, adsTimeS: 0.18, noise: 80, moveSpeedMult: 0.94,
  },
  shotgun: {
    id: 'shotgun', name: 'SG-8 Pump', slot: 0, fireMode: 'pump',
    damage: 12, pellets: 9, rpm: 78, magSize: 6, reserveMax: 42, reloadS: 0.6, reloadPerShellS: 0.55,
    spreadHip: 7.5, spreadAds: 5.0, spreadPerShot: 0, spreadRecoverPerS: 0, spreadMax: 7.5,
    recoilPitch: 6.5, recoilYaw: 1.2, falloffStart: 7, falloffEnd: 26, minDamageMult: 0.12,
    adsFovMult: 0.88, adsTimeS: 0.16, noise: 90, moveSpeedMult: 0.93,
  },
  dmr: {
    id: 'dmr', name: 'SR-25 Marksman', slot: 0, fireMode: 'semi',
    damage: 70, pellets: 1, rpm: 200, magSize: 10, reserveMax: 60, reloadS: 2.5, reloadTacticalS: 2.1,
    spreadHip: 4.0, spreadAds: 0.12, spreadPerShot: 1.2, spreadRecoverPerS: 5, spreadMax: 6,
    recoilPitch: 3.2, recoilYaw: 0.6, falloffStart: 80, falloffEnd: 200, minDamageMult: 0.7,
    adsFovMult: 0.38, adsTimeS: 0.24, noise: 100, moveSpeedMult: 0.9,
  },
};

/** Arma inicial de cada ranura y munición inicial (cargadores completos en reserva). */
export const STARTING_LOADOUT: { slot0: WeaponId; slot1: WeaponId; reserveMags: number } = {
  slot0: 'carbine',
  slot1: 'pistol',
  reserveMags: 3,
};

export const GRENADE = {
  fuseS: 2.4,
  throwSpeed: 17,
  upBias: 0.18,
  gravity: 18,
  bounce: 0.42,
  friction: 0.7,
  radius: 8,
  /** Daño máx. en el centro; cae linealmente hasta minMult en el borde. */
  damage: 280,
  minMult: 0.12,
  /** El jugador recibe este % del daño de su propia granada. */
  selfMult: 0.55,
  /** Requiere línea de visión para dañar (los muros protegen). */
  needsLineOfSight: true,
  cooldownS: 0.9,
  noise: 110,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// ENEMIGOS
// ─────────────────────────────────────────────────────────────────────────────
export interface EnemyDef {
  type: EnemyType;
  name: string;
  hp: number;
  /** Velocidad de marcha al perseguir (m/s); se varía ±speedJitter por individuo. */
  speed: number;
  wanderSpeed: number;
  speedJitter: number;
  radius: number;
  height: number;
  /** Daño por golpe cuerpo a cuerpo (o proyectil para spitter). */
  damage: number;
  attackRange: number;
  attackWindupS: number;
  attackCooldownS: number;
  /** Multiplicadores de daño recibido por zona. */
  headMult: number;
  bodyMult: number;
  limbMult: number;
  /** Dinero base al morir (× multiplicador de zona). */
  bounty: number;
  /** Radio de visión y oído base. */
  sightRange: number;
  hearingMult: number;
  /** Aturdimiento al recibir un impacto (prob. y duración). */
  staggerChance: number;
  staggerS: number;
  /** Aparece sólo desde esta amenaza de zona. */
  minThreat: number;
}

export const ENEMIES: Record<Exclude<EnemyType, 'warden'>, EnemyDef> = {
  walker: {
    type: 'walker', name: 'Infectado', hp: 100, speed: 1.75, wanderSpeed: 0.7, speedJitter: 0.25, radius: 0.38, height: 1.75,
    damage: 14, attackRange: 1.55, attackWindupS: 0.45, attackCooldownS: 1.25,
    headMult: 3.0, bodyMult: 1.0, limbMult: 0.6, bounty: 25, sightRange: 28, hearingMult: 1.0,
    staggerChance: 0.5, staggerS: 0.45, minThreat: 1,
  },
  runner: {
    type: 'runner', name: 'Corredor', hp: 58, speed: 4.9, wanderSpeed: 1.1, speedJitter: 0.15, radius: 0.36, height: 1.7,
    damage: 10, attackRange: 1.5, attackWindupS: 0.25, attackCooldownS: 0.85,
    headMult: 3.0, bodyMult: 1.0, limbMult: 0.6, bounty: 35, sightRange: 34, hearingMult: 1.2,
    staggerChance: 0.35, staggerS: 0.3, minThreat: 1,
  },
  brute: {
    type: 'brute', name: 'Bruto', hp: 440, speed: 2.05, wanderSpeed: 0.8, speedJitter: 0.12, radius: 0.6, height: 2.25,
    damage: 38, attackRange: 2.1, attackWindupS: 0.7, attackCooldownS: 1.9,
    headMult: 1.6, bodyMult: 1.0, limbMult: 0.7, bounty: 120, sightRange: 30, hearingMult: 0.9,
    staggerChance: 0.12, staggerS: 0.35, minThreat: 2,
  },
  spitter: {
    type: 'spitter', name: 'Escupidor', hp: 72, speed: 2.3, wanderSpeed: 0.8, speedJitter: 0.15, radius: 0.4, height: 1.75,
    damage: 13, attackRange: 19, attackWindupS: 0.8, attackCooldownS: 2.6,
    headMult: 3.0, bodyMult: 1.0, limbMult: 0.6, bounty: 60, sightRange: 34, hearingMult: 1.0,
    staggerChance: 0.5, staggerS: 0.5, minThreat: 3,
  },
};

export const WARDEN = {
  name: 'El Warden',
  hp: 1800,
  /** Vida del casco: mientras exista, los impactos en la cabeza dañan SÓLO el casco. */
  helmetHp: 450,
  /** Con casco, el daño a la cabeza va al casco con este multiplicador (sin multiplicador de headshot). */
  helmetDamageMult: 1.0,
  /** Tras romper el casco, los impactos en la cabeza multiplican el daño. */
  headMultAfterHelmet: 3.5,
  /** Blindaje de cuerpo/extremidades: sólo pasa esta fracción del daño. */
  bodyMult: 0.22,
  limbMult: 0.12,
  speed: 2.4,
  chargeSpeed: 7.5,
  radius: 0.75,
  height: 2.5,
  meleeDamage: 55,
  attackRange: 2.6,
  attackCooldownS: 1.6,
  slamDamage: 40,
  slamRadius: 6,
  slamCooldownS: 9,
  chargeCooldownS: 12,
  /** Invoca refuerzos al perder cada fracción de vida. */
  summonAtHpFractions: [0.66, 0.33],
  summonCount: 4,
  aggroRange: 42,
  /** Inmune a aturdimiento salvo al romperse el casco. */
  helmetBreakStaggerS: 1.6,
} as const;

/** Escalado por amenaza de zona (índice = threat). El 0 no se usa. */
export const THREAT_SCALE = {
  hp: [1, 1.0, 1.25, 1.55, 1.9],
  speed: [1, 1.0, 1.06, 1.12, 1.2],
  damage: [1, 1.0, 1.15, 1.35, 1.6],
  sight: [1, 1.0, 1.1, 1.2, 1.35],
  /** Multiplicador de dinero/botín: mejor botín en zonas peligrosas. */
  loot: [1, 1.0, 1.5, 2.2, 3.2],
  /** Multiplicador de probabilidad de soltar botín. */
  dropChance: [1, 1.0, 1.2, 1.5, 1.9],
} as const;

/** Mezcla de tipos por nivel de amenaza (pesos, no necesitan sumar 1). */
export const SPAWN_MIX: Record<number, Partial<Record<Exclude<EnemyType, 'warden'>, number>>> = {
  1: { walker: 90, runner: 10 },
  2: { walker: 70, runner: 24, brute: 6 },
  3: { walker: 46, runner: 28, brute: 12, spitter: 14 },
  4: { walker: 30, runner: 28, brute: 20, spitter: 22 },
};

export const DIRECTOR = {
  /** Población ambiental objetivo por zona (con el jugador cerca). */
  ambientTarget: { perimeter: 10, warehouses: 16, refinery: 22, complex: 28 } as Record<ZoneId, number>,
  /** Máximo de infectados vivos y simulados a la vez (rendimiento). */
  maxAlive: 48,
  /** Sólo se simulan/dibujan infectados a menos de esta distancia del jugador. */
  simRadius: 95,
  /** Radio alrededor del jugador donde NO se generan infectados nuevos. */
  noSpawnRadius: 30,
  /** Los grupos ambientales se reponen cada tanto si faltan (s). */
  refillIntervalS: 6,
  /** Grupos (hordas pequeñas) al generar de inicio. */
  packSize: [1, 4] as [number, number],
  /** Distancia a la que un infectado deja de perseguir si pierde al jugador (s sin verlo). */
  loseTargetS: 9,
  /** Tiempo de gracia inicial sin ambiente cercano al spawn del jugador (s). */
  spawnGraceS: 8,
} as const;

export interface HordeDef {
  /** Segundos hasta la primera oleada tras iniciar. */
  firstWaveDelayS: number;
  spawnRingMin: number;
  spawnRingMax: number;
  /** [inicio, fin]: intervalo entre oleadas (s) — se interpola con el progreso. */
  waveIntervalS: [number, number];
  /** [inicio, fin]: infectados por oleada. */
  waveSize: [number, number];
  maxAlive: number;
  mix: Partial<Record<Exclude<EnemyType, 'warden'>, number>>;
  /** Amenaza efectiva usada para escalar stats de esta horda. */
  threat: number;
}

export const HORDES: Record<'relay' | 'extraction', HordeDef> = {
  relay: {
    firstWaveDelayS: 3, spawnRingMin: 38, spawnRingMax: 62, waveIntervalS: [8, 4.2], waveSize: [4, 9],
    maxAlive: 34, mix: { walker: 52, runner: 34, brute: 5, spitter: 9 }, threat: 3,
  },
  extraction: {
    firstWaveDelayS: 2, spawnRingMin: 36, spawnRingMax: 60, waveIntervalS: [7, 3.4], waveSize: [5, 12],
    maxAlive: 40, mix: { walker: 40, runner: 32, brute: 14, spitter: 14 }, threat: 3,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// MISIONES / CONTRATOS  (cada contrato paga UNA sola vez)
// ─────────────────────────────────────────────────────────────────────────────
export const MISSIONS = {
  relay: {
    id: 'relay' as MissionId,
    title: 'Restaurar el relé',
    reward: 3000,
    /** Mantener E sobre el transmisor para activarlo. */
    activateHoldS: 3,
    /** Segundos acumulados DENTRO del círculo para completar. */
    requiredS: 55,
    /** Si sales del círculo el progreso baja a este ritmo (s de progreso por s). 0 = sólo pausa. */
    decayPerS: 0.75,
  },
  warden: {
    id: 'warden' as MissionId,
    title: 'Eliminar al Warden',
    reward: 7500,
  },
  extraction: {
    id: 'extraction' as MissionId,
    title: 'Extracción',
    reward: 5000,
    /** Requiere el relé restaurado para tener señal de radio. */
    requiresRelay: true,
    callHoldS: 4,
    /** Tiempo hasta que el helicóptero aterriza tras la llamada. */
    etaS: 40,
    /** Ventana para abordar tras aterrizar; si vence, el helicóptero se va. */
    boardWindowS: 45,
    boardHoldS: 2.5,
    departDurationS: 6,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// ECONOMÍA / TIENDAS / BOTÍN
// ─────────────────────────────────────────────────────────────────────────────
export type ShopItemKind =
  | 'ammoSlot0'
  | 'ammoSlot1'
  | 'grenade'
  | 'plate'
  | 'medkit'
  | 'armorFull'
  | 'weapon'
  | 'pack';

export interface ShopItem {
  /** Tecla 1-6 = índice + 1. */
  id: string;
  name: string;
  desc: string;
  kind: ShopItemKind;
  price: number;
  weapon?: WeaponId;
  /** Cantidad (granadas, placas…) o puntos de vida (medkit). */
  amount?: number;
}

export type VendorId = 'cage' | 'bench';

export const SHOP: Record<VendorId, { title: string; items: ShopItem[] }> = {
  cage: {
    title: 'Jaula de suministro',
    items: [
      { id: 'ammo0', name: 'Munición · arma principal', desc: 'Rellena la reserva del arma 1', kind: 'ammoSlot0', price: 150 },
      { id: 'ammo1', name: 'Munición · arma secundaria', desc: 'Rellena la reserva del arma 2', kind: 'ammoSlot1', price: 80 },
      { id: 'grenade', name: 'Granada de fragmentación', desc: '+1 granada (tecla G)', kind: 'grenade', price: 200, amount: 1 },
      { id: 'plate', name: 'Placa de armadura', desc: '+1 placa (tecla Q)', kind: 'plate', price: 350, amount: 1 },
      { id: 'medkit', name: 'Botiquín', desc: 'Cura 60 de vida al instante', kind: 'medkit', price: 250, amount: 60 },
      { id: 'armorFull', name: 'Kit de blindaje', desc: 'Blindaje al máximo al instante', kind: 'armorFull', price: 550 },
    ],
  },
  bench: {
    title: 'Banco de armería',
    items: [
      { id: 'w_assault', name: 'AR-12 Fusil de asalto', desc: 'Principal · automático · versátil', kind: 'weapon', weapon: 'assault', price: 2600 },
      { id: 'w_smg', name: 'MP-9 Subfusil', desc: 'Principal · cadencia altísima', kind: 'weapon', weapon: 'smg', price: 1400 },
      { id: 'w_shotgun', name: 'SG-8 Pump', desc: 'Principal · devastadora de cerca', kind: 'weapon', weapon: 'shotgun', price: 2000 },
      { id: 'w_dmr', name: 'SR-25 Marksman', desc: 'Principal · precisión · ideal para cascos', kind: 'weapon', weapon: 'dmr', price: 3800 },
      { id: 'w_revolver', name: 'Magnum .44 "Marshal"', desc: 'Secundaria · un tiro, un problema', kind: 'weapon', weapon: 'revolver', price: 1800 },
      { id: 'pack', name: 'Mochila táctica', desc: '+2 capacidad de placas y granadas', kind: 'pack', price: 1200 },
    ],
  },
};

export const ECONOMY = {
  /** Al comprar un arma nueva: cargadores completos de reserva incluidos. */
  newWeaponReserveMags: 2,
  /** Radio máx. (m) para mantener abierta la tienda. */
  shopRange: 4.5,
  /** Pago por muerte = bounty × THREAT_SCALE.loot[threat] (redondeado). */
  bountyRounding: 5,
} as const;

export type PickupKind = 'cash' | 'ammo' | 'plate' | 'grenade' | 'medkit';

export const LOOT = {
  /** Probabilidad base de soltar botín por tipo (× THREAT_SCALE.dropChance). */
  dropChance: { walker: 0.16, runner: 0.2, brute: 0.65, spitter: 0.32, warden: 1 } as Record<EnemyType, number>,
  /** Pesos por tipo de objeto y amenaza. */
  weights: {
    1: { cash: 50, ammo: 34, medkit: 8, grenade: 5, plate: 3 },
    2: { cash: 44, ammo: 30, medkit: 9, grenade: 9, plate: 8 },
    3: { cash: 38, ammo: 26, medkit: 10, grenade: 12, plate: 14 },
    4: { cash: 34, ammo: 22, medkit: 10, grenade: 14, plate: 20 },
  } as Record<number, Record<PickupKind, number>>,
  /** Rango de dinero base de un objeto 'cash' (× THREAT_SCALE.loot). */
  cash: [30, 90] as [number, number],
  /** Fracción del cargador de reserva que da un objeto 'ammo'. */
  ammoFraction: 0.6,
  medkitHeal: 35,
  /** Botín estático repartido al iniciar: cantidad por zona (× amenaza). */
  staticPerZone: { perimeter: 8, warehouses: 10, refinery: 12, complex: 14 } as Record<ZoneId, number>,
  pickupRadius: 1.6,
  lifetimeS: 90,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// RENDER / RENDIMIENTO
// ─────────────────────────────────────────────────────────────────────────────
export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityPreset {
  pixelRatioMax: number;
  shadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  /** Distancia de dibujo (m) — niebla + far plane. */
  viewDistance: number;
  particles: number;
  decals: number;
}

export const RENDER = {
  targetFps: 60,
  /** Reajuste dinámico de resolución si los FPS bajan de `lowFps` durante `windowS` s. */
  adaptive: { enabled: true, lowFps: 52, highFps: 58, windowS: 2, minScale: 0.6, step: 0.1 },
  presets: {
    low: { pixelRatioMax: 1, shadows: false, shadowMapSize: 1024, bloom: false, viewDistance: 170, particles: 250, decals: 40 },
    medium: { pixelRatioMax: 1.5, shadows: true, shadowMapSize: 1536, bloom: true, viewDistance: 230, particles: 600, decals: 80 },
    high: { pixelRatioMax: 2, shadows: true, shadowMapSize: 2048, bloom: true, viewDistance: 300, particles: 1200, decals: 160 },
  } as Record<QualityLevel, QualityPreset>,
  defaultQuality: 'high' as QualityLevel,
  /** Paleta de la hora azul (hex). */
  sky: { top: 0x0a1428, horizon: 0x2f5085, ground: 0x0e1420, fog: 0x172640, moon: 0xa9c4ff, ambient: 0x3b5583 },
  fogNear: 30,
  fogDensity: 0.0085,
  exposure: 0.95,
  /** Presupuestos que vigilan los scripts de QA (renderer.info). */
  budget: { drawCalls: 900, triangles: 1_200_000 },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO
// ─────────────────────────────────────────────────────────────────────────────
export const AUDIO = {
  master: 0.8,
  sfx: 1.0,
  music: 0.5,
  ambience: 0.7,
  /** Distancia a la que un sonido posicional cae a ~0 (m). */
  maxDistance: 120,
  refDistance: 4,
} as const;

/** Claves comprobadas por los tests: todos los pesos y precios deben ser válidos. */
export const ZONE_IDS: readonly ZoneId[] = ['perimeter', 'warehouses', 'refinery', 'complex'];
