/**
 * Contrato mínimo que el sistema de armas necesita del anfitrión (el controlador del jugador).
 * Se declara aquí para que `weapons` no dependa del módulo `player` (las fronteras de módulo
 * sólo permiten core/, config, rules/ y three). PlayerController lo cumple estructuralmente.
 */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface WeaponHost {
  readonly eye: Vec3Like;
  readonly forward: Vec3Like;
  readonly right: Vec3Like;
  readonly up: Vec3Like;
  readonly velocity: Vec3Like;
  readonly alive: boolean;
  readonly controlEnabled: boolean;
  readonly grounded: boolean;
  readonly crouched: boolean;
  readonly sprinting: boolean;
  readonly speed01: number;
  readonly sprint01: number;
  readonly bobPhase: number;
  readonly bobAmp: number;
  readonly yawVel: number;
  readonly pitchVel: number;
  /** Patada de cámara por disparo (grados) con topes acumulados. */
  kick(pitchDeg: number, yawDeg: number, maxP: number, maxY: number): void;
  /** Sacudida de cámara (explosiones). */
  shake(amount: number): void;
}
