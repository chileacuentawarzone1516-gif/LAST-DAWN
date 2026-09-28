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
import type { Appearance, EnemyType, Gender, MissionId, WeaponId, ZoneId } from './core/types';

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
  /** Pausa entre un final «no letal» (sellado, extracción, helicóptero perdido) y la pantalla final. */
  endDelayS: 1.2,
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
  /** El daño por contaminación se agrupa en golpes de al menos este intervalo (s). */
  damageStepS: 0.25,
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
  /** Multiplicador de velocidad de movimiento mientras se coloca una placa de armadura. */
  plateMoveMult: 0.6,
  /** Metros recorridos por paso (evento player:footstep) al andar / correr / agachado. */
  strideWalk: 0.8,
  strideSprint: 1.05,
  strideCrouch: 0.58,
  /** FOV extra (grados) al correr, para sensación de velocidad. */
  sprintFovBoost: 4,
  /** Tiempo de gracia (s) para saltar justo después de perder el suelo y de adelantar la pulsación. */
  coyoteS: 0.08,
  jumpBufferS: 0.12,
  /** Segundos que tarda en caer la cámara al morir. */
  deathFallS: 0.8,
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

/** Manejo común de las armas (cadencia de cambio, dispersión por postura, retroceso…). */
export const WEAPON_HANDLING = {
  /** Alcance máximo de un disparo (m). */
  maxRange: 250,
  /** Cambio de arma: bajar la actual / subir la nueva (s). */
  switchLowerS: 0.14,
  switchRaiseS: 0.26,
  /** Retardo (s) entre vaciar el cargador y empezar la recarga automática. */
  autoReloadDelayS: 0.22,
  /** Un clic pulsado hasta este tiempo antes de poder disparar se encola y sale en cuanto se puede (s). */
  fireBufferS: 0.15,
  /** La dispersión por disparo no se recupera hasta pasado max(minDelay, fireInterval × mult). */
  spreadRecoveryDelayMult: 1.4,
  spreadRecoveryMinDelayS: 0.09,
  /** La dispersión acumulada por disparo se reduce a esta fracción al apuntar. */
  adsShotSpreadMult: 0.5,
  /** Multiplicadores de dispersión por postura. */
  spreadCrouchMult: 0.7,
  spreadStillMult: 0.92,
  /** Extra al caminar (1 + moveMult): moderado para poder disparar andando. Correr y saltar penalizan más. */
  spreadMoveMult: 0.22,
  /** Velocidad normalizada a partir de la cual la penalización de movimiento es completa (transición continua). */
  spreadMoveRamp: 0.6,
  spreadSprintMult: 1.5,
  spreadAirMult: 2.0,
  /** Microimpulso instantáneo al apretar el gatillo: cámara (grados, sólo visual) y fracción de la patada que se aplica al instante. */
  triggerPunchDeg: 0.16,
  recoilInstantFrac: 0.45,
  /** Retroceso de cámara: multiplicadores y recuperación. */
  recoilAdsMult: 0.72,
  recoilCrouchMult: 0.82,
  recoilRecoverDelayS: 0.05,
  recoilRecoverRate: 8,
  recoilMaxPitch: 16,
  recoilMaxYaw: 6,
} as const;

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
  /** Segundos desde pulsar G hasta soltar la granada, y hasta recuperar el arma. */
  throwWindupS: 0.3,
  throwRecoverS: 0.32,
  /** Radio de colisión (m) y fracción de la velocidad del jugador que hereda al lanzar. */
  collisionRadius: 0.07,
  inheritVelocity: 0.5,
  /** Por debajo de esta velocidad de impacto (m/s) el rebote no emite evento. */
  bounceEventMinSpeed: 1.8,
  /** Distancia (m) a la que la explosión aún sacude la cámara. */
  shakeRadius: 32,
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
  // — Comportamiento (enemigos): combo, embestida, pisotón, furia, refuerzos —
  /** Golpes por combo cuerpo a cuerpo, tiempo de preparación de cada uno y pausa entre golpes. */
  comboHits: 2,
  comboWindupS: 0.6,
  comboGapS: 0.42,
  /** Embestida: distancias mín./máx. al jugador para iniciarla, telegrafía, duración, daño y aturdimiento al estrellarse. */
  chargeMinRange: 7,
  chargeMaxRange: 26,
  chargeTelegraphS: 1.0,
  chargeDurationS: 1.4,
  chargeDamage: 48,
  chargeRecoverS: 1.2,
  /** Pisotón: telegrafía y distancia al jugador a la que lo inicia. */
  slamTelegraphS: 0.85,
  slamTriggerRange: 5.2,
  /** Multiplicador de velocidad al enfurecerse (casco roto). */
  enrageSpeedMult: 1.15,
  /** Rugido al invocar refuerzos (s) y mezcla de los invocados. */
  summonRoarS: 1.3,
  summonMix: { walker: 55, runner: 45 },
  /** Un disparo del jugador a menos de esta distancia lo despierta. */
  shotAlertRange: 60,
  /** Si el jugador se aleja más de esto durante 8 s, abandona la persecución y vuelve a su puesto. */
  leashRange: 115,
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

/** Ajustes finos de IA, animación y rendimiento de los enemigos (sección de enemigos). */
export const ENEMY_AI = {
  /** Cono de visión total (grados) y radio de detección cercana (m; requiere línea de visión). */
  sightConeDeg: 150,
  senseRadius: 4.5,
  /** Multiplicadores de la visión sobre un jugador agachado / corriendo. */
  sightCrouchMult: 0.7,
  sightSprintMult: 1.2,
  /** Periodo del «cerebro» de cada infectado (s) y tope de consultas de línea de visión por frame. */
  brainTickS: 0.15,
  losPerFrame: 10,
  /** Tiempo investigando un ruido antes de abandonar (s). */
  investigateS: 8,
  /** Radio en el que un infectado que detecta al jugador alerta a sus vecinos. */
  alertShareRadius: 12,
  /** Fracción del alcance de oído por debajo de la cual el disparo delata la posición exacta del jugador. */
  hearingExactFrac: 0.35,
  /** Velocidad de giro (rad/s) y fuerza de separación entre vecinos. */
  turnRate: 7,
  separationStrength: 1.5,
  /** Campo de flujo hacia el jugador: refresco (s), desplazamiento que fuerza el refresco (m) y radio calculado (m). */
  flow: { rebuildS: 0.35, moveThresholdM: 1.5, radiusM: 80 },
  /** Nivel de detalle: animación completa < fullM, reducida < midM; no se dibuja a más de drawM. */
  lod: { fullM: 30, midM: 62, drawM: 190 },
  /** Cadáveres: tiempo tendidos (s), hundimiento final (s) y máximo simultáneo. */
  corpse: { lifetimeS: 9, sinkS: 2.4, max: 20 },
  /** Voces: separación de los gruñidos ociosos por individuo (s), global (s) y alcance (m). */
  vocal: { idleGapS: [5, 11] as [number, number], globalGapS: 0.9, hearRangeM: 55 },
  /** Escupidor: banda de distancia preferida, proyectil (m/s, gravedad), salpicadura (m) y tope de proyectiles. */
  spitter: { minRange: 12, maxRange: 18, projectileSpeed: 17, gravity: 14, splashRadius: 1.6, maxProjectiles: 10, leadFactor: 0.55 },
  /** Bruto: embestida (distancias, telegrafía, duración, multiplicador de velocidad y de daño, recarga, empuje al jugador, aturdimiento). */
  brute: { chargeMinRange: 5, chargeMaxRange: 15, telegraphS: 0.8, durationS: 1.25, speedMult: 3.3, damageMult: 1.15, cooldownS: 7.5, knockback: 7, recoverS: 1.1 },
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
  /** Segundos de horda hasta alcanzar la intensidad máxima (relay = MISSIONS.relay.requiredS; extraction: ~hasta aterrizar). */
  rampS: number;
}

export const HORDES: Record<'relay' | 'extraction', HordeDef> = {
  relay: {
    firstWaveDelayS: 3, spawnRingMin: 38, spawnRingMax: 62, waveIntervalS: [8, 4.2], waveSize: [4, 9],
    maxAlive: 34, mix: { walker: 52, runner: 34, brute: 5, spitter: 9 }, threat: 3, rampS: 55,
  },
  extraction: {
    firstWaveDelayS: 2, spawnRingMin: 36, spawnRingMax: 60, waveIntervalS: [7, 3.4], waveSize: [5, 12],
    maxAlive: 40, mix: { walker: 40, runner: 32, brute: 14, spitter: 14 }, threat: 3, rampS: 60,
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
    /** Altura de crucero del helicóptero (m) y distancia de la que parte al llamarlo (m). */
    heliAltitude: 60,
    heliStartDistance: 520,
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
  /** Muestras MSAA del render target HDR del post-proceso (0 = sin MSAA; 'low' no usa post). */
  msaa: number;
  /** Anisotropía máxima de las texturas. */
  anisotropy: number;
  /** Reflejos ambientales (PMREM del cielo) en los materiales PBR. */
  envMap: boolean;
  /** Texturas procedurales baratas (128 px, sin mapas de normales). */
  lowTextures: boolean;
}

export const RENDER = {
  targetFps: 60,
  /** Reajuste dinámico de resolución si los FPS bajan de `lowFps` durante `windowS` s. */
  adaptive: { enabled: true, lowFps: 52, highFps: 58, windowS: 2, minScale: 0.6, step: 0.1 },
  presets: {
    low: { pixelRatioMax: 1, shadows: false, shadowMapSize: 1024, bloom: false, viewDistance: 170, particles: 250, decals: 40, msaa: 0, anisotropy: 2, envMap: false, lowTextures: true },
    medium: { pixelRatioMax: 1.5, shadows: true, shadowMapSize: 1536, bloom: true, viewDistance: 230, particles: 600, decals: 80, msaa: 2, anisotropy: 4, envMap: true, lowTextures: false },
    high: { pixelRatioMax: 2, shadows: true, shadowMapSize: 2048, bloom: true, viewDistance: 300, particles: 1200, decals: 160, msaa: 4, anisotropy: 8, envMap: true, lowTextures: false },
  } as Record<QualityLevel, QualityPreset>,
  defaultQuality: 'high' as QualityLevel,
  /** Paleta de la hora azul (hex). */
  sky: { top: 0x0a1428, horizon: 0x2f5085, ground: 0x0e1420, fog: 0x172640, moon: 0xa9c4ff, ambient: 0x3b5583 },
  fogNear: 30,
  fogDensity: 0.0085,
  exposure: 1.15,
  /** Presupuestos que vigilan los scripts de QA (renderer.info). */
  budget: { drawCalls: 900, triangles: 1_200_000 },
  /** Luna: dirección de la luz direccional y del disco del cielo (grados; azimut 0 = norte, + hacia el este). */
  moon: { azimuthDeg: -34, elevationDeg: 38 },
  /** Frustum de sombra de la luna: semilado (m) y adelanto hacia donde mira el jugador (m). */
  shadowFrustum: 38,
  shadowLead: 10,
  /** Pool fijo de luces puntuales para fogonazos/explosiones (nunca cambia: no recompila shaders). */
  flashLights: 3,
  /** Bloom: intensidad, umbral (HDR lineal) y rodilla. */
  bloom: { strength: 0.2, threshold: 1.05, knee: 0.5 },
  /** Post: viñeta base, grano y aberración cromática leve. */
  post: { vignette: 0.5, grain: 0.035, chroma: 0.006 },
  /**
   * Perfil móvil (dispositivos táctiles): sustituye campos de RENDER.presets[nivel], se limita
   * `pixelRatioMax`/`anisotropy` y el escalado dinámico de resolución es más agresivo.
   */
  mobile: {
    pixelRatioMax: 1.5,
    anisotropyMax: 2,
    /** Niveles de la cadena de bloom (desktop: 5). */
    bloomLevels: 3,
    presets: {
      low: { viewDistance: 135, particles: 120, decals: 24 },
      medium: { pixelRatioMax: 1.25, shadowMapSize: 1024, viewDistance: 175, particles: 250, decals: 40, msaa: 0, anisotropy: 2, envMap: false },
      high: { pixelRatioMax: 1.5, shadowMapSize: 1536, viewDistance: 220, particles: 500, decals: 80, msaa: 2, anisotropy: 2 },
    } as Record<QualityLevel, Partial<QualityPreset>>,
    /** Escalado dinámico: arranca en `startScale`, ventana corta, sube si sobran FPS. */
    adaptive: { enabled: true, lowFps: 50, highFps: 57, windowS: 1, minScale: 0.5, step: 0.1, startScale: 0.85, goodWindows: 2 },
  },
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

// ─────────────────────────────────────────────────────────────────────────────
// HUD / INTERFAZ (sección del módulo ui)
// ─────────────────────────────────────────────────────────────────────────────
export const HUD = {
  /** Clave de localStorage donde se recuerdan volumen, silencio y calidad. */
  storageKey: 'deadsignal.settings.v1',
  /** Notificaciones apiladas: máximo simultáneo y duración (s). */
  notify: { max: 4, durationS: 4 },
  /** Punto de mira: hueco base y ampliación por unidad de dispersión (en "unidades de interfaz"). */
  crosshair: { baseGap: 4, gapPerSpread: 22, hideAimingWith: ['dmr'] as readonly WeaponId[] },
  /** Marcadores de impacto: duración normal y al matar (s). */
  hit: { durationS: 0.3, killDurationS: 0.55 },
  /** Indicadores direccionales de daño: vida (s), máximo simultáneo y ángulo de fusión (grados). */
  damage: { lifeS: 1.6, max: 6, mergeDeg: 14 },
  /** Brújula: semicampo visible (grados) y separación de marcas (grados). */
  compass: { halfFovDeg: 90, tickDeg: 15 },
  /** Banner de zona: duración total (s). */
  zoneBannerS: 3.4,
  /** Munición baja (fracción del cargador) y vida baja (fracción). */
  lowAmmoFraction: 0.25,
  lowHpFraction: 0.3,
  /** Tiempo (ms) tras mostrarse la pantalla final durante el que se ignoran los clics (evita reinicios accidentales). */
  endGuardMs: 700,
  /** Espera (ms) tras «Continuar» antes de pedir «Haz clic para continuar». */
  resumeHintMs: 650,
  /** Vista previa 3D del operativo: rad por px de arrastre, paso de teclado (rad), relación ancho/alto y relleno del área. */
  preview: { rotatePerPx: 0.011, keyStepRad: 0.3, modelAspect: 0.5, fill: 0.92 },
  /** Lado (px) del lienzo de los retratos 2D (se escala por CSS). */
  portraitPx: 192,
  /** Tamaño mínimo (px CSS) de los objetivos táctiles. */
  touchTargetPx: 44,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// MUNDO (sección del módulo world: layout procedural, colisión, navegación, render)
// ─────────────────────────────────────────────────────────────────────────────
export const WORLD = {
  /** Semilla fija: el distrito es idéntico en cada partida. */
  seed: 0xdead516,
  /** Muro perimetral del distrito: cara interior a `bounds ∓ wallThickness`. */
  wallThickness: 3,
  wallHeight: 6.5,
  /** Celda del hash espacial de colisiones (m). */
  hashCell: 8,
  /** Celda del ráster de suelo (material + superficie), m. */
  groundCell: 2,
  /** Malla de navegación: radio del agente y rango vertical que bloquea el paso. */
  nav: { agentRadius: 0.6, blockMinY: 0.45, blockMaxY: 1.8 },
  /** Objetivos de puntos de aparición y botín por zona (mínimos garantizados). */
  spawnPointsPerZone: 60,
  lootSpotsPerZone: 30,
  /** Distancia mínima entre un punto de aparición y el jugador al inicio (m). */
  spawnMinPlayerDist: 25,
  /** Radio libre de colisionadores alrededor de cada punto clave (m). */
  poiClearRadius: 3.2,
  /** Tamaño (m) de los lotes de geometría estática fusionada (frustum culling por lote). */
  chunkSize: 134,
  /** Luces puntuales estáticas sin sombra en puntos críticos (0 = sólo emisivo). */
  pointLights: true,
  /** Presupuestos que vigila el test de rendimiento del mundo. */
  budget: { drawCalls: 300, triangles: 600_000, buildMs: 1500 },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// PERSONAJE (personalización del operativo)
// ─────────────────────────────────────────────────────────────────────────────
export interface CharacterPreset {
  name: string;
  tagline: string;
  appearance: Appearance;
}

export const CHARACTER = {
  storageKey: 'deadsignal.profile.v1',
  nameMinLen: 1,
  nameMaxLen: 16,
  defaultName: { male: 'Marcos', female: 'Lucía' } as Record<Gender, string>,
  randomNames: {
    male: ['Marcos', 'Diego', 'Iván', 'Rubén', 'Adrián', 'Hugo', 'Nico', 'Sergio', 'Álex', 'Bruno'],
    female: ['Lucía', 'Elena', 'Marta', 'Valeria', 'Noa', 'Irene', 'Paula', 'Sara', 'Alba', 'Nerea'],
  } as Record<Gender, string[]>,
  genders: [
    { id: 'male', name: 'Masculino' },
    { id: 'female', name: 'Femenino' },
  ] as { id: Gender; name: string }[],
  skinTones: [
    { id: 'clara', name: 'Clara', color: 0xf1cfb0 },
    { id: 'trigueña', name: 'Trigueña', color: 0xdcae86 },
    { id: 'canela', name: 'Canela', color: 0xc08a5c },
    { id: 'morena', name: 'Morena', color: 0x96623d },
    { id: 'oscura', name: 'Oscura', color: 0x6b4229 },
    { id: 'ebano', name: 'Ébano', color: 0x452b1f },
  ],
  hairColors: [
    { id: 'negro', name: 'Negro', color: 0x15110f },
    { id: 'castano-oscuro', name: 'Castaño oscuro', color: 0x3a271b },
    { id: 'castano', name: 'Castaño', color: 0x5b3a22 },
    { id: 'rubio', name: 'Rubio', color: 0xc9a25a },
    { id: 'pelirrojo', name: 'Pelirrojo', color: 0x9a3f1e },
    { id: 'gris', name: 'Gris', color: 0x8c8f94 },
    { id: 'blanco', name: 'Blanco', color: 0xd8dade },
    { id: 'verde', name: 'Verde señal', color: 0x2fbf8a },
  ],
  hairStyles: {
    male: [
      { id: 'rapado', name: 'Rapado' },
      { id: 'corto', name: 'Corto' },
      { id: 'peinado', name: 'Peinado atrás' },
      { id: 'rizado', name: 'Rizado' },
      { id: 'melena', name: 'Melena' },
      { id: 'mohicano', name: 'Mohicano' },
    ],
    female: [
      { id: 'pixie', name: 'Corte pixie' },
      { id: 'media', name: 'Media melena' },
      { id: 'larga', name: 'Larga' },
      { id: 'coleta', name: 'Coleta' },
      { id: 'trenzas', name: 'Trenzas' },
      { id: 'mono', name: 'Moño' },
    ],
  } as Record<Gender, { id: string; name: string }[]>,
  /** jacket/pants: ropa; accent: detalles; glove: guantes y puños del viewmodel. */
  outfits: [
    { id: 'militar', name: 'Militar', jacket: 0x4a5236, pants: 0x33382a, accent: 0x8a7a4a, glove: 0x22241f },
    { id: 'urbano', name: 'Urbano', jacket: 0x2b3442, pants: 0x1e232b, accent: 0xd0d6de, glove: 0x15181c },
    { id: 'sanitario', name: 'Sanitario', jacket: 0xd9dde2, pants: 0x8fa3b4, accent: 0xd93a3a, glove: 0x2b3a4a },
    { id: 'obrero', name: 'Obrero', jacket: 0xc9791a, pants: 0x2c3038, accent: 0xe8e04a, glove: 0x3b342a },
    { id: 'sigilo', name: 'Sigilo', jacket: 0x15181d, pants: 0x101216, accent: 0x3fe0b0, glove: 0x0b0c0e },
    { id: 'desierto', name: 'Desierto', jacket: 0x9a8360, pants: 0x6f5f45, accent: 0x3a2f20, glove: 0x4a3f2c },
    { id: 'artico', name: 'Ártico', jacket: 0xc8d2dc, pants: 0x5e6b78, accent: 0x3b82c4, glove: 0x2a3540 },
    { id: 'carmesi', name: 'Carmesí', jacket: 0x6d1f26, pants: 0x25181a, accent: 0xe0b34a, glove: 0x1a1113 },
  ],
  accessories: [
    { id: 'none', name: 'Ninguno' },
    { id: 'cap', name: 'Gorra' },
    { id: 'beanie', name: 'Gorro' },
    { id: 'goggles', name: 'Gafas tácticas' },
    { id: 'bandana', name: 'Pañuelo' },
    { id: 'headset', name: 'Auriculares' },
  ],
  presets: {
    male: [
      { name: 'Veterano', tagline: 'Ex-militar curtido', appearance: { skin: 1, hairStyle: 0, hairColor: 5, outfit: 0, accessory: 0 } },
      { name: 'Rastreador', tagline: 'Habla poco, dispara mejor', appearance: { skin: 3, hairStyle: 3, hairColor: 0, outfit: 5, accessory: 3 } },
      { name: 'Técnico', tagline: 'Arregla lo que otros rompen', appearance: { skin: 0, hairStyle: 2, hairColor: 2, outfit: 3, accessory: 1 } },
      { name: 'Médico', tagline: 'Juró no hacer daño… a los vivos', appearance: { skin: 2, hairStyle: 1, hairColor: 1, outfit: 2, accessory: 5 } },
      { name: 'Fantasma', tagline: 'Entra y sale sin dejar rastro', appearance: { skin: 4, hairStyle: 5, hairColor: 7, outfit: 4, accessory: 4 } },
      { name: 'Polar', tagline: 'Llegó desde la base ártica', appearance: { skin: 5, hairStyle: 4, hairColor: 6, outfit: 6, accessory: 2 } },
    ],
    female: [
      { name: 'Capitana', tagline: 'Lidera desde el frente', appearance: { skin: 1, hairStyle: 3, hairColor: 2, outfit: 0, accessory: 0 } },
      { name: 'Exploradora', tagline: 'Conoce cada callejón', appearance: { skin: 3, hairStyle: 4, hairColor: 0, outfit: 5, accessory: 3 } },
      { name: 'Ingeniera', tagline: 'Un soplete y un plan', appearance: { skin: 2, hairStyle: 5, hairColor: 4, outfit: 3, accessory: 1 } },
      { name: 'Doctora', tagline: 'Cura primero, pregunta después', appearance: { skin: 0, hairStyle: 1, hairColor: 3, outfit: 2, accessory: 5 } },
      { name: 'Sombra', tagline: 'Invisible hasta que es tarde', appearance: { skin: 4, hairStyle: 0, hairColor: 7, outfit: 4, accessory: 4 } },
      { name: 'Ventisca', tagline: 'Fría, precisa, implacable', appearance: { skin: 5, hairStyle: 2, hairColor: 6, outfit: 6, accessory: 2 } },
    ],
  } as Record<Gender, CharacterPreset[]>,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// TÁCTIL / MÓVIL
// ─────────────────────────────────────────────────────────────────────────────
export const TOUCH = {
  /** Multiplicador sobre los px de arrastre para igualarlos a los px de ratón (PLAYER.mouseSensitivity). */
  lookMult: 1.7,
  /** Multiplicador adicional al apuntar (ADS) con el dedo. */
  lookAdsMult: 0.6,
  /** Radio del joystick (px CSS) y zona muerta (0..1). */
  stickRadius: 58,
  stickDeadZone: 0.12,
  /** Empujar el joystick más allá de este umbral (0..1) activa correr automáticamente. */
  autoSprintThreshold: 0.92,
  /** Vibración háptica (ms) al disparar / recibir daño / recoger (si el dispositivo la soporta). */
  haptics: { fire: 8, hit: 25, damage: 60, pickup: 12 },
  /** Preset gráfico por defecto en dispositivos táctiles (se puede cambiar en Ajustes). */
  defaultQuality: 'low' as QualityLevel,
  /** Pantalla mínima recomendada (px CSS) para el modo apaisado. */
  minLandscapeHeight: 320,
} as const;
