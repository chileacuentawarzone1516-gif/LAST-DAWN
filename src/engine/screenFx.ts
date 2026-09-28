/**
 * Estado de los efectos de pantalla (daño, vida baja, contaminación, muerte).
 * Lógica pura sin three.js: el post-proceso sólo lee los valores 0..1 resultantes.
 */
import { clamp01, smoothstep } from '../core/util';

/** Fracción de vida por debajo de la cual empieza el efecto de «vida baja». */
export const LOW_HP_START = 0.4;
/** Metros de profundidad dentro de la contaminación para alcanzar el tinte máximo. */
export const TOXIC_FULL_DEPTH = 9;

/** 0 con vida sana → 1 con vida casi nula. */
export function lowHpIntensity(hp: number, maxHp: number): number {
  if (maxHp <= 0) return 0;
  return clamp01(1 - hp / maxHp / LOW_HP_START);
}

/**
 * Intensidad del tinte tóxico: 0 fuera del radio; sube suavemente al internarse.
 * `dist` = distancia del jugador al centro de la contaminación; `radius` = radio actual.
 */
export function contaminationIntensity(active: boolean, radius: number, dist: number): number {
  if (!active || radius <= 0) return 0;
  return smoothstep(0, TOXIC_FULL_DEPTH, radius - dist);
}

/** Latido doble (dos golpes por ciclo) en 0..1. `phase` en ciclos. */
export function heartbeat(phase: number): number {
  const p = phase - Math.floor(phase);
  const thump = (c: number, w: number): number => {
    const d = (p - c) / w;
    return Math.exp(-d * d);
  };
  return Math.min(1, thump(0.08, 0.055) + 0.7 * thump(0.27, 0.06));
}

export interface ScreenFxInputs {
  hp: number;
  maxHp: number;
  alive: boolean;
  contaminationActive: boolean;
  contaminationRadius: number;
  /** Distancia del jugador al centro de la contaminación (m). */
  contaminationDist: number;
}

export interface ScreenFxState {
  /** Pulso rojo por daño reciente 0..1 (decae rápido). */
  hurt: number;
  /** Intensidad de vida baja 0..1. */
  lowHp: number;
  /** Latido 0..1 (sólo con vida baja). */
  pulse: number;
  /** Tinte verde por contaminación 0..1 (suavizado). */
  toxic: number;
  /** Fundido de muerte 0..1. */
  death: number;
  /** Desaturación total 0..1 (vida baja + muerte + toxicidad leve). */
  desat: number;
  /** Registra daño recibido (hp ya restada). */
  onDamaged(hpDamage: number, armorDamage: number, fromContamination: boolean): void;
  onDied(): void;
  /** Nueva partida / volver al título. */
  reset(): void;
  update(dt: number, input: ScreenFxInputs): void;
}

const HURT_DECAY = 2.6; // 1/s (semivida ≈ 0.27 s)
const TOXIC_RISE = 2.2;
const TOXIC_FALL = 1.4;
const DEATH_RISE = 0.9;
const LOW_HP_RATE = 1.15; // latidos por segundo

export function createScreenFxState(): ScreenFxState {
  let diedFlag = false;
  let phase = 0;
  const s: ScreenFxState = {
    hurt: 0,
    lowHp: 0,
    pulse: 0,
    toxic: 0,
    death: 0,
    desat: 0,
    onDamaged(hpDamage, armorDamage, fromContamination) {
      // La contaminación hace daño continuo: no debe disparar un pulso por tick.
      if (fromContamination) return;
      const mag = hpDamage > 0 ? 0.32 + hpDamage / 32 : 0.12 + armorDamage / 160;
      s.hurt = Math.min(1, s.hurt + mag * 0.75);
    },
    onDied() {
      diedFlag = true;
      s.hurt = 1;
    },
    reset() {
      diedFlag = false;
      s.hurt = 0;
      s.death = 0;
      s.toxic = 0;
      s.lowHp = 0;
      s.pulse = 0;
      s.desat = 0;
    },
    update(dt, input) {
      s.hurt *= Math.exp(-HURT_DECAY * dt);
      if (s.hurt < 0.002) s.hurt = 0;

      const dead = diedFlag || !input.alive;
      const deathTarget = dead ? 1 : 0;
      s.death += (deathTarget - s.death) * Math.min(1, dt * (dead ? DEATH_RISE : 4));
      if (Math.abs(s.death - deathTarget) < 0.002) s.death = deathTarget;

      s.lowHp = dead ? 0 : lowHpIntensity(input.hp, input.maxHp);
      if (s.lowHp > 0) {
        phase += dt * LOW_HP_RATE * (1 + s.lowHp * 0.6);
        s.pulse = heartbeat(phase) * s.lowHp;
      } else {
        s.pulse = 0;
      }

      const toxicTarget = dead
        ? 0
        : contaminationIntensity(input.contaminationActive, input.contaminationRadius, input.contaminationDist);
      const rate = toxicTarget > s.toxic ? TOXIC_RISE : TOXIC_FALL;
      s.toxic += (toxicTarget - s.toxic) * Math.min(1, dt * rate);
      if (s.toxic < 0.002 && toxicTarget === 0) s.toxic = 0;

      s.desat = clamp01(Math.max(s.lowHp * 0.55, s.death * 0.92, s.toxic * 0.18));
    },
  };
  return s;
}
