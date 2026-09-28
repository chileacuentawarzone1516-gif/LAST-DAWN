/** Tipos compartidos por todos los módulos. Sin dependencias de three.js. */

export interface Vec2 {
  x: number;
  z: number;
}
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type WeaponId = 'pistol' | 'revolver' | 'carbine' | 'smg' | 'assault' | 'shotgun' | 'dmr';
export type EnemyType = 'walker' | 'runner' | 'brute' | 'spitter' | 'warden';
export type ZoneId = 'perimeter' | 'warehouses' | 'refinery' | 'complex';
export type MissionId = 'relay' | 'warden' | 'extraction';
export type HitZone = 'head' | 'body' | 'limb';
export type SurfaceKind = 'concrete' | 'metal' | 'dirt' | 'asphalt' | 'flesh' | 'glass' | 'wood' | 'water';
export type DamageSource = 'melee' | 'spit' | 'slam' | 'explosion' | 'contamination' | 'fall';
export type EndReason = 'extracted' | 'dead' | 'sealed' | 'heli_left';
export type MissionStatus = 'locked' | 'available' | 'active' | 'completed' | 'failed';
export type NotifyKind = 'info' | 'warn' | 'danger' | 'reward';
export type VendorKind = 'cage' | 'bench';

/** Todo módulo de juego implementa System; Game llama update(dt) cada frame. */
export interface System {
  update(dt: number): void;
  /** Debe quitar objetos de la escena, liberar geometrías y cancelar suscripciones. */
  dispose?(): void;
}

/**
 * Claves de materiales compartidos (engine/materials). El motor puede AÑADIR claves
 * (en este union) pero no quitarlas ni renombrarlas.
 */
export type MaterialKey =
  // suelos
  | 'asphalt' | 'asphaltWorn' | 'roadLine' | 'concrete' | 'concreteDark' | 'concreteStained' | 'dirt' | 'gravel' | 'tile'
  // muros y estructuras
  | 'brick' | 'plaster' | 'metalPanel' | 'corrugated' | 'rustMetal' | 'steelDark' | 'labWall' | 'labFloor' | 'glass' | 'wood'
  | 'fence' | 'hazard' | 'pipe' | 'rubber'
  // contenedores
  | 'containerRed' | 'containerBlue' | 'containerGreen' | 'containerYellow' | 'containerGrey'
  // emisivos / señalización
  | 'emissiveRed' | 'emissiveBlue' | 'emissiveAmber' | 'emissiveGreen' | 'emissiveWhite' | 'toxic'
  // armas y personajes
  | 'gunMetal' | 'gunPolymer' | 'gunWood' | 'brass'
  | 'skinPale' | 'skinGrey' | 'skinGreen' | 'clothDark' | 'clothOlive' | 'clothRag' | 'bone' | 'blood'
  | 'armorPlate' | 'wardenArmor' | 'wardenHelmet' | 'helicopterBody'
  // añadidos por el motor
  | 'grass' | 'water' | 'roofing';

// ── Perfil del jugador (personalización) ───────────────────────────────────
export type Gender = 'male' | 'female';

/**
 * Apariencia del operativo. Todos los campos son ÍNDICES en las tablas de `CHARACTER`
 * (config.ts): skin → skinTones, hairStyle → hairStyles[gender], hairColor → hairColors,
 * outfit → outfits, accessory → accessories.
 */
export interface Appearance {
  skin: number;
  hairStyle: number;
  hairColor: number;
  outfit: number;
  accessory: number;
}

export interface PlayerProfile {
  name: string;
  gender: Gender;
  appearance: Appearance;
}
