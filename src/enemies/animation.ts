/**
 * Animación procedural de los rigs: ciclo de marcha/carrera con arrastre de pies, brazos extendidos al
 * perseguir, golpes con anticipación y follow-through, aturdimiento, escupitajo, embestida, pisotón,
 * rugido y muerte. Todo son fórmulas sobre los pivotes del rig (sin keyframes ni asignaciones).
 *
 * Convenciones de signo (frente = -Z, arriba = +Y):
 *  - hombros y caderas: X positivo → el miembro se balancea hacia delante;
 *  - torso y cabeza: X positivo → se inclinan hacia ATRÁS (inclinarse adelante es negativo);
 *  - rodillas: X negativo → flexión natural; codos: X positivo → flexión natural;
 *  - hombros/caderas «Z» de la pose = separación hacia fuera (positivo abre el miembro).
 */
import { clamp, damp, lerp, smoothstep } from '../core/util';
import type { EnemyType } from '../core/types';
import { N } from './models';
import type { Rig } from './models';

const TAU = Math.PI * 2;

/** Acciones que sobrescriben la locomoción (el AI las asigna, la animación las representa). */
export const ACT = {
  none: 0, windup: 1, strike: 2, spitWind: 3, spitThrow: 4, stagger: 5, chargeTele: 6, charge: 7,
  slamWind: 8, slamHit: 9, roar: 10, recover: 11,
} as const;
export type Act = (typeof ACT)[keyof typeof ACT];

export class AnimState {
  act: number = ACT.none;
  /** Acción que se está mostrando (persiste mientras se funde de vuelta a la locomoción). */
  actShow: number = ACT.none;
  actT = 0;
  actDur = 1;
  /** Alterna golpes (0 = derecha, 1 = izquierda) en combos y remolinos. */
  actAlt = 0;
  actW = 0;
  phase = 0;
  /** Velocidad horizontal real (m/s) que fija el AI cada frame. */
  speed = 0;
  aggroTarget = 0;
  aggro = 0;
  hitKick = 0;
  hitSide = 0;
  clock = 0;
  /** Semilla individual 0..1 y cojera 0..0.5 (arrastra una pierna). */
  seed = 0;
  limp = 0;
  /** dt acumulado desde la última evaluación de pose (LOD). */
  acc = 0;
  dead = false;
  deathT = 0;
  deathDir = 1;
  deathRoll = 0;
  deathYaw = 0;
  /** Hundimiento del cadáver (m). */
  sink = 0;
  /** true tras la primera evaluación (para no saltar de pose al entrar en cámara). */
  posed = false;

  reset(seed: number): void {
    this.act = ACT.none;
    this.actShow = ACT.none;
    this.actT = 0;
    this.actDur = 1;
    this.actAlt = 0;
    this.actW = 0;
    this.phase = seed * TAU;
    this.speed = 0;
    this.aggroTarget = 0;
    this.aggro = 0;
    this.hitKick = 0;
    this.hitSide = 0;
    this.clock = seed * 40;
    this.seed = seed;
    this.limp = seed > 0.55 ? 0.15 + (seed - 0.55) * 0.9 : 0;
    this.acc = 0;
    this.dead = false;
    this.deathT = 0;
    this.deathDir = 1;
    this.deathRoll = 0;
    this.deathYaw = 0;
    this.sink = 0;
    this.posed = false;
  }

  /** Inicia una acción; `dur` es la duración de su fase principal (p. ej. el windup). */
  start(act: Act, dur: number, alt = 0): void {
    this.act = act;
    this.actT = 0;
    this.actDur = Math.max(0.01, dur);
    this.actAlt = alt;
  }

  clearAct(): void {
    this.act = ACT.none;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pose (vector de floats reutilizable)
// ─────────────────────────────────────────────────────────────────────────────
const F = {
  hipsY: 0, hipsZ: 1, hipsR: 2, torsoX: 3, torsoY: 4, torsoZ: 5, headX: 6, headY: 7, headZ: 8,
  shLX: 9, shLZ: 10, shLY: 11, shRX: 12, shRZ: 13, shRY: 14, elLX: 15, elRX: 16,
  hpLX: 17, hpLZ: 18, hpRX: 19, hpRZ: 20, knLX: 21, knRX: 22, rootX: 23, rootZ: 24, rootY: 25, auxS: 26,
} as const;
const FIELDS = 27;

const P = new Float32Array(FIELDS);
const Q = new Float32Array(FIELDS);

interface Gait {
  /** Metros recorridos por ciclo completo (dos pasos). */
  cycle: number;
  /** Velocidad de referencia para la amplitud plena. */
  ref: number;
  hip: number;
  knee: number;
  bob: number;
  arm: number;
  armBase: number;
  elbow: number;
  lean: number;
  slouch: number;
  /** Cuánto se extienden los brazos al perseguir (0..1) y hasta qué ángulo. */
  reachMix: number;
  reach: number;
}

const GAIT: Record<EnemyType, Gait> = {
  walker: { cycle: 1.25, ref: 1.9, hip: 0.4, knee: 0.5, bob: 1, arm: 0.22, armBase: 0.12, elbow: 0.35, lean: 0.16, slouch: 0.26, reachMix: 1, reach: 1.32 },
  runner: { cycle: 2.9, ref: 5.0, hip: 0.85, knee: 1.25, bob: 1.2, arm: 0.95, armBase: 0.25, elbow: 1.35, lean: 0.4, slouch: 0.12, reachMix: 0.2, reach: 1.0 },
  brute: { cycle: 1.6, ref: 2.2, hip: 0.36, knee: 0.42, bob: 1.4, arm: 0.16, armBase: 0.1, elbow: 0.18, lean: 0.18, slouch: 0.34, reachMix: 0.55, reach: 0.75 },
  spitter: { cycle: 1.3, ref: 2.4, hip: 0.38, knee: 0.5, bob: 1, arm: 0.2, armBase: 0.2, elbow: 0.5, lean: 0.14, slouch: 0.3, reachMix: 0.5, reach: 0.9 },
  warden: { cycle: 1.9, ref: 2.6, hip: 0.34, knee: 0.5, bob: 1.2, arm: 0.1, armBase: 0.06, elbow: 0.2, lean: 0.05, slouch: 0.03, reachMix: 0.3, reach: 0.5 },
};

/** Marcha a la carrera de los pesados (embestida): se mezcla con la de andar según la velocidad. */
const RUN_GAIT: Partial<Record<EnemyType, { lo: number; hi: number; g: Gait }>> = {
  brute: { lo: 3.2, hi: 5.6, g: { cycle: 3.3, ref: 7, hip: 0.85, knee: 1.05, bob: 1.6, arm: 0.5, armBase: -0.5, elbow: 0.9, lean: 0.8, slouch: 0.1, reachMix: 0, reach: 0 } },
  warden: { lo: 3.6, hi: 6.2, g: { cycle: 3.6, ref: 7.5, hip: 0.8, knee: 1.0, bob: 1.5, arm: 0.35, armBase: 0.3, elbow: 0.8, lean: 0.75, slouch: 0.05, reachMix: 0, reach: 0 } },
};

const G: Gait = { cycle: 1, ref: 1, hip: 0, knee: 0, bob: 0, arm: 0, armBase: 0, elbow: 0, lean: 0, slouch: 0, reachMix: 0, reach: 0 };

/** Elevación del cadáver por tipo (m): mitad del grosor del cuerpo tendido. */
const LIE_LIFT: Record<EnemyType, number> = { walker: 0.13, runner: 0.11, brute: 0.32, spitter: 0.14, warden: 0.3 };
const FALL_S: Record<EnemyType, number> = { walker: 0.8, runner: 0.6, brute: 1.0, spitter: 0.8, warden: 1.4 };

function mixGait(a: Gait, b: Gait, t: number, out: Gait): void {
  out.cycle = lerp(a.cycle, b.cycle, t);
  out.ref = lerp(a.ref, b.ref, t);
  out.hip = lerp(a.hip, b.hip, t);
  out.knee = lerp(a.knee, b.knee, t);
  out.bob = lerp(a.bob, b.bob, t);
  out.arm = lerp(a.arm, b.arm, t);
  out.armBase = lerp(a.armBase, b.armBase, t);
  out.elbow = lerp(a.elbow, b.elbow, t);
  out.lean = lerp(a.lean, b.lean, t);
  out.slouch = lerp(a.slouch, b.slouch, t);
  out.reachMix = lerp(a.reachMix, b.reachMix, t);
  out.reach = lerp(a.reach, b.reach, t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Locomoción
// ─────────────────────────────────────────────────────────────────────────────
function locomotion(rig: Rig, a: AnimState, dt: number): void {
  const type = rig.type;
  const sk = rig.skeleton;
  const base = GAIT[type];
  const run = RUN_GAIT[type];
  let rw = 0;
  if (run) {
    rw = smoothstep(run.lo, run.hi, a.speed);
    mixGait(base, run.g, rw, G);
  } else {
    mixGait(base, base, 0, G);
  }
  const speed = a.speed;
  const amp = clamp(speed / G.ref, 0, 1.25);
  if (speed > 0.05) a.phase = (a.phase + (speed / G.cycle) * TAU * dt) % (TAU * 64);
  const th = a.phase;
  const s = Math.sin(th);
  const c = Math.cos(th);
  const t = a.clock;
  const seed = a.seed * 6.28;
  const aggro = a.aggro;
  const moving = smoothstep(0.05, 0.5, speed);
  P.fill(0);
  P[F.auxS] = 1;

  // Piernas: la izquierda va con sin(θ); la derecha en oposición y con cojera (arrastra el pie).
  const limpR = 1 - a.limp;
  const hipA = G.hip * amp;
  const angL = hipA * s;
  const angR = -hipA * s * limpR;
  P[F.hpLX] = angL;
  P[F.hpRX] = angR;
  const swingL = Math.max(0, c);
  const swingR = Math.max(0, -c);
  const kn = G.knee * amp;
  P[F.knLX] = -(kn * swingL + kn * 0.12);
  P[F.knRX] = -((kn * swingR + kn * 0.12) * (1 - a.limp * 0.7));
  P[F.hpLZ] = 0.03 + 0.02 * amp;
  P[F.hpRZ] = 0.03 + 0.02 * amp;
  // Cadera: baja lo justo para que la pierna de apoyo toque el suelo y se balancea.
  const legLen = sk.thigh + sk.shin;
  const stance = Math.max(Math.abs(angL), Math.abs(angR));
  P[F.hipsY] = -legLen * (1 - Math.cos(stance)) * 0.85 * G.bob * 0.8 - 0.012 * amp * G.bob * (0.5 + 0.5 * Math.cos(2 * th));
  P[F.hipsR] = 0.045 * amp * s;

  // Torso y cabeza.
  const lean = G.slouch + G.lean * amp;
  P[F.torsoX] = -lean + 0.012 * Math.sin(t * 1.7 + seed);
  P[F.torsoY] = 0.14 * amp * s * moving;
  P[F.torsoZ] = -0.05 * amp * s + 0.03 * Math.sin(t * 0.8 + seed) * (1 - moving);
  P[F.headX] = lean * 0.55 + 0.05 * Math.sin(t * 0.9 + seed * 2) + (type === 'runner' ? 0.05 * Math.sin(t * 11 + seed) : 0);
  P[F.headY] = 0.4 * Math.sin(t * 0.45 + seed) * (1 - aggro) * (1 - moving * 0.5) - 0.1 * amp * s * moving;
  P[F.headZ] = 0.12 * Math.sin(t * 0.8 + seed * 3) + 0.05 * amp * s;

  // Brazos: colgando con balanceo o extendidos hacia delante al perseguir.
  const idleSway = 0.06 * Math.sin(t * 0.9 + seed);
  const swL = G.armBase - G.arm * amp * s + idleSway;
  const swR = G.armBase + G.arm * amp * s - idleSway;
  const ag = aggro * G.reachMix;
  const rL = G.reach + 0.12 + 0.07 * Math.sin(t * 2.3 + seed);
  const rR = G.reach - 0.16 + 0.07 * Math.sin(t * 2.0 + seed * 2);
  P[F.shLX] = lerp(swL, rL, ag);
  P[F.shRX] = lerp(swR, rR, ag);
  P[F.shLZ] = lerp(0.06, 0.2, ag);
  P[F.shRZ] = lerp(0.06, 0.16, ag);
  P[F.elLX] = lerp(G.elbow + 0.1 * Math.max(0, -s) * amp, 0.28, ag * 0.8);
  P[F.elRX] = lerp(G.elbow + 0.1 * Math.max(0, s) * amp, 0.4, ag * 0.8);
  if (type === 'spitter') P[F.auxS] = 1 + 0.07 * Math.sin(t * 3.1 + seed);
  if (type === 'warden') {
    // El escudo va siempre algo adelantado: el brazo izquierdo apenas balancea.
    P[F.shLX] = lerp(0.35, 0.9, ag) + 0.05 * s;
    P[F.elLX] = lerp(0.7, 1.0, ag);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Acciones: modifican Q (copia de la locomoción) con poses absolutas
// ─────────────────────────────────────────────────────────────────────────────
const ease = (p: number): number => p * p * (3 - 2 * p);
const easeOut = (p: number): number => 1 - (1 - p) * (1 - p);

function actionPose(rig: Rig, a: AnimState): void {
  const type = rig.type;
  const t = a.actT;
  const dur = a.actDur;
  const p = clamp(t / dur, 0, 1);
  const alt = a.actAlt;
  switch (a.actShow) {
    case ACT.windup: {
      const e = ease(p);
      if (type === 'runner') {
        // Zarpazo: el brazo hostigador se echa atrás con torsión del torso.
        const side = alt === 0 ? 1 : -1;
        Q[F.torsoY] = -0.55 * side * e;
        Q[F.torsoX] = lerp(Q[F.torsoX]!, -0.55, e);
        Q[F.headX] = lerp(Q[F.headX]!, 0.2, e);
        if (alt === 0) {
          Q[F.shRX] = lerp(Q[F.shRX]!, -0.9, e); Q[F.shRZ] = lerp(Q[F.shRZ]!, 0.55, e); Q[F.elRX] = lerp(Q[F.elRX]!, 1.1, e);
          Q[F.shLX] = lerp(Q[F.shLX]!, 1.25, e);
        } else {
          Q[F.shLX] = lerp(Q[F.shLX]!, -0.9, e); Q[F.shLZ] = lerp(Q[F.shLZ]!, 0.55, e); Q[F.elLX] = lerp(Q[F.elLX]!, 1.1, e);
          Q[F.shRX] = lerp(Q[F.shRX]!, 1.25, e);
        }
        Q[F.hipsY] = Q[F.hipsY]! - 0.05 * e;
      } else if (type === 'warden') {
        if (alt === 0) {
          // Gancho de derecha.
          Q[F.shRX] = lerp(Q[F.shRX]!, -0.7, e); Q[F.shRZ] = lerp(Q[F.shRZ]!, 1.05, e); Q[F.elRX] = lerp(Q[F.elRX]!, 0.7, e);
          Q[F.torsoY] = -0.7 * e; Q[F.torsoX] = lerp(Q[F.torsoX]!, 0.12, e);
        } else {
          // Embestida de escudo.
          Q[F.shLX] = lerp(Q[F.shLX]!, 0.25, e); Q[F.elLX] = lerp(Q[F.elLX]!, 1.9, e);
          Q[F.torsoY] = 0.6 * e; Q[F.torsoX] = lerp(Q[F.torsoX]!, 0.05, e);
        }
        Q[F.hipsY] = Q[F.hipsY]! - 0.08 * e;
        Q[F.headX] = lerp(Q[F.headX]!, 0.2, e);
      } else {
        // Golpe cenital a dos manos (infectado, bruto, escupidor a quemarropa).
        const up = type === 'brute' ? 2.85 : 2.5;
        Q[F.shLX] = lerp(Q[F.shLX]!, up, e); Q[F.shRX] = lerp(Q[F.shRX]!, up - 0.1, e);
        Q[F.shLZ] = lerp(Q[F.shLZ]!, 0.28, e); Q[F.shRZ] = lerp(Q[F.shRZ]!, 0.24, e);
        Q[F.elLX] = lerp(Q[F.elLX]!, 0.9, e); Q[F.elRX] = lerp(Q[F.elRX]!, 0.8, e);
        Q[F.torsoX] = lerp(Q[F.torsoX]!, 0.28, e);
        Q[F.headX] = lerp(Q[F.headX]!, 0.3, e);
        Q[F.hipsY] = Q[F.hipsY]! - 0.05 * e;
      }
      break;
    }
    case ACT.strike: {
      const k = easeOut(clamp(t / 0.13, 0, 1));
      const settle = smoothstep(0.16, 0.5, t);
      if (type === 'runner') {
        const side = alt === 0 ? 1 : -1;
        Q[F.torsoY] = lerp(-0.55 * side, 0.6 * side, k) * (1 - settle);
        Q[F.torsoX] = lerp(-0.55, -0.5, k);
        if (alt === 0) {
          Q[F.shRX] = lerp(-0.9, 1.55, k); Q[F.shRZ] = lerp(0.55, 0.1, k); Q[F.elRX] = lerp(1.1, 0.25, k);
          Q[F.shLX] = 0.5;
        } else {
          Q[F.shLX] = lerp(-0.9, 1.55, k); Q[F.shLZ] = lerp(0.55, 0.1, k); Q[F.elLX] = lerp(1.1, 0.25, k);
          Q[F.shRX] = 0.5;
        }
        Q[F.hipsZ] = -0.16 * k * (1 - settle);
      } else if (type === 'warden') {
        if (alt === 0) {
          Q[F.shRX] = lerp(-0.7, 1.5, k); Q[F.shRZ] = lerp(1.05, 0.15, k); Q[F.elRX] = lerp(0.7, 0.2, k);
          Q[F.torsoY] = lerp(-0.7, 0.75, k) * (1 - settle * 0.6);
        } else {
          Q[F.shLX] = lerp(0.25, 1.45, k); Q[F.elLX] = lerp(1.9, 0.3, k);
          Q[F.torsoY] = lerp(0.6, -0.5, k) * (1 - settle * 0.6);
        }
        Q[F.torsoX] = lerp(0.1, -0.35, k);
        Q[F.hipsZ] = -0.32 * k * (1 - settle * 0.7);
        Q[F.hipsY] = -0.1 * k;
        Q[F.headX] = lerp(0.2, -0.1, k);
      } else {
        const up = type === 'brute' ? 2.85 : 2.5;
        const down = type === 'brute' ? 0.15 : 0.3;
        const sh = lerp(up, down, k);
        Q[F.shLX] = sh; Q[F.shRX] = sh + 0.1;
        Q[F.shLZ] = lerp(0.28, 0.1, k); Q[F.shRZ] = lerp(0.24, 0.1, k);
        Q[F.elLX] = lerp(0.9, 0.2, k); Q[F.elRX] = lerp(0.8, 0.2, k);
        Q[F.torsoX] = lerp(0.28, type === 'brute' ? -0.72 : -0.55, k);
        Q[F.headX] = lerp(0.3, -0.25, k);
        Q[F.hipsZ] = -(type === 'brute' ? 0.24 : 0.16) * k * (1 - settle);
        Q[F.hipsY] = Q[F.hipsY]! - 0.07 * k;
      }
      break;
    }
    case ACT.spitWind: {
      const e = ease(p);
      Q[F.torsoX] = lerp(Q[F.torsoX]!, 0.5, e);
      Q[F.headX] = lerp(Q[F.headX]!, 0.95, e);
      Q[F.shLX] = lerp(Q[F.shLX]!, 0.9, e); Q[F.shRX] = lerp(Q[F.shRX]!, 0.9, e);
      Q[F.shLZ] = lerp(Q[F.shLZ]!, -0.05, e); Q[F.shRZ] = lerp(Q[F.shRZ]!, -0.05, e);
      Q[F.elLX] = lerp(Q[F.elLX]!, 1.6, e); Q[F.elRX] = lerp(Q[F.elRX]!, 1.6, e);
      Q[F.auxS] = 1 + 0.75 * e + 0.05 * Math.sin(t * 30) * e;
      Q[F.hipsY] = Q[F.hipsY]! - 0.05 * e;
      Q[F.torsoZ] = 0.03 * Math.sin(t * 34) * e;
      break;
    }
    case ACT.spitThrow: {
      const k = easeOut(clamp(t / 0.14, 0, 1));
      Q[F.torsoX] = lerp(0.5, -0.6, k);
      Q[F.headX] = lerp(0.95, -0.25, k);
      Q[F.shLX] = lerp(0.9, 1.15, k); Q[F.shRX] = lerp(0.9, 1.15, k);
      Q[F.elLX] = lerp(1.6, 0.3, k); Q[F.elRX] = lerp(1.6, 0.3, k);
      Q[F.auxS] = lerp(1.75, 0.85, k);
      Q[F.hipsZ] = -0.12 * k;
      Q[F.hipsY] = Q[F.hipsY]! - 0.06 * k;
      break;
    }
    case ACT.stagger: {
      const e = (1 - p) * (1 - p);
      const flail = Math.sin(t * 22) * 0.08 * e;
      Q[F.torsoX] = Q[F.torsoX]! + 0.55 * e;
      Q[F.torsoZ] = Q[F.torsoZ]! + a.hitSide * 0.35 * e;
      Q[F.headX] = Q[F.headX]! + 0.6 * e;
      Q[F.headZ] = Q[F.headZ]! + a.hitSide * 0.3 * e;
      Q[F.shLX] = Q[F.shLX]! + 0.7 * e + flail; Q[F.shRX] = Q[F.shRX]! + 0.55 * e - flail;
      Q[F.shLZ] = Q[F.shLZ]! + 0.55 * e; Q[F.shRZ] = Q[F.shRZ]! + 0.55 * e;
      Q[F.hipsY] = Q[F.hipsY]! - 0.07 * e;
      Q[F.knLX] = Q[F.knLX]! - 0.35 * e; Q[F.knRX] = Q[F.knRX]! - 0.25 * e;
      break;
    }
    case ACT.chargeTele: {
      const e = ease(p);
      const paw = Math.sin(t * 13) * 0.55 * e;
      Q[F.torsoX] = lerp(Q[F.torsoX]!, type === 'warden' ? -0.55 : -0.5, e);
      Q[F.headX] = lerp(Q[F.headX]!, 0.55, e);
      Q[F.hipsY] = Q[F.hipsY]! - (type === 'warden' ? 0.24 : 0.12) * e;
      Q[F.knLX] = -0.5 * e; Q[F.knRX] = -0.5 * e;
      Q[F.hpLX] = Q[F.hpLX]! * (1 - e) + (0.35 + paw) * e;
      Q[F.hpRX] = Q[F.hpRX]! * (1 - e) + 0.25 * e;
      if (type === 'warden') {
        Q[F.shLX] = lerp(Q[F.shLX]!, 1.35, e); Q[F.elLX] = lerp(Q[F.elLX]!, 1.1, e);
        Q[F.shRX] = lerp(Q[F.shRX]!, -0.5, e); Q[F.shRZ] = lerp(Q[F.shRZ]!, 0.7, e); Q[F.elRX] = lerp(Q[F.elRX]!, 0.9, e);
      } else {
        Q[F.shLX] = lerp(Q[F.shLX]!, 0.4, e); Q[F.shRX] = lerp(Q[F.shRX]!, 0.4, e);
        Q[F.shLZ] = lerp(Q[F.shLZ]!, 0.95, e); Q[F.shRZ] = lerp(Q[F.shRZ]!, 0.95, e);
        Q[F.elLX] = lerp(Q[F.elLX]!, 0.5, e); Q[F.elRX] = lerp(Q[F.elRX]!, 0.5, e);
      }
      Q[F.torsoZ] = Q[F.torsoZ]! + 0.02 * Math.sin(t * 40) * e;
      break;
    }
    case ACT.charge: {
      // Cabeza baja, brazos hacia atrás: la marcha rápida ya hace el resto.
      Q[F.torsoX] = type === 'warden' ? -0.78 : -0.85;
      Q[F.headX] = 0.6;
      Q[F.shLX] = type === 'warden' ? 1.35 : -0.55;
      Q[F.shRX] = -0.55;
      Q[F.elLX] = type === 'warden' ? 1.1 : 0.9; Q[F.elRX] = 0.9;
      Q[F.shLZ] = 0.25; Q[F.shRZ] = 0.25;
      break;
    }
    case ACT.slamWind: {
      const e = ease(p);
      Q[F.shLX] = lerp(Q[F.shLX]!, 2.9, e); Q[F.shRX] = lerp(Q[F.shRX]!, 2.9, e);
      Q[F.shLZ] = lerp(Q[F.shLZ]!, 0.3, e); Q[F.shRZ] = lerp(Q[F.shRZ]!, 0.3, e);
      Q[F.elLX] = lerp(Q[F.elLX]!, 0.6, e); Q[F.elRX] = lerp(Q[F.elRX]!, 0.6, e);
      Q[F.torsoX] = lerp(Q[F.torsoX]!, 0.35, e);
      Q[F.headX] = lerp(Q[F.headX]!, 0.5, e);
      Q[F.hipsY] = Q[F.hipsY]! - 0.12 * e;
      Q[F.knLX] = -0.4 * e; Q[F.knRX] = -0.4 * e;
      Q[F.torsoZ] = 0.02 * Math.sin(t * 36) * e;
      break;
    }
    case ACT.slamHit: {
      const k = easeOut(clamp(t / 0.12, 0, 1));
      const settle = smoothstep(0.2, 0.7, t);
      Q[F.shLX] = lerp(2.9, 0.2, k); Q[F.shRX] = lerp(2.9, 0.2, k);
      Q[F.shLZ] = 0.15; Q[F.shRZ] = 0.15;
      Q[F.elLX] = lerp(0.6, 0.15, k); Q[F.elRX] = lerp(0.6, 0.15, k);
      Q[F.torsoX] = lerp(0.35, -0.65, k);
      Q[F.headX] = lerp(0.5, -0.2, k);
      Q[F.hipsY] = lerp(-0.12, -0.28, k) * (1 - settle * 0.5);
      Q[F.knLX] = -0.7 * k; Q[F.knRX] = -0.7 * k;
      Q[F.hpLX] = 0.4 * k; Q[F.hpRX] = 0.4 * k;
      break;
    }
    case ACT.roar: {
      const inn = ease(clamp(t / 0.35, 0, 1));
      const out = 1 - smoothstep(dur - 0.35, dur, t);
      const e = inn * out;
      const tremble = Math.sin(t * 45) * 0.03 * e;
      Q[F.headX] = lerp(Q[F.headX]!, 0.85, e);
      Q[F.torsoX] = lerp(Q[F.torsoX]!, 0.32, e) + tremble;
      Q[F.shLX] = lerp(Q[F.shLX]!, 0.55, e); Q[F.shRX] = lerp(Q[F.shRX]!, 0.55, e);
      Q[F.shLZ] = lerp(Q[F.shLZ]!, 1.15, e); Q[F.shRZ] = lerp(Q[F.shRZ]!, 1.15, e);
      Q[F.elLX] = lerp(Q[F.elLX]!, 0.7, e); Q[F.elRX] = lerp(Q[F.elRX]!, 0.7, e);
      Q[F.hipsY] = Q[F.hipsY]! - 0.05 * e;
      Q[F.auxS] = Q[F.auxS]! + 0.3 * e;
      break;
    }
    case ACT.recover: {
      const e = ease(clamp(t / 0.25, 0, 1)) * (1 - smoothstep(dur - 0.3, dur, t));
      const breath = Math.sin(t * 7) * 0.03;
      Q[F.torsoX] = lerp(Q[F.torsoX]!, -0.55, e) + breath;
      Q[F.headX] = lerp(Q[F.headX]!, -0.35, e);
      Q[F.shLX] = lerp(Q[F.shLX]!, 0.1, e); Q[F.shRX] = lerp(Q[F.shRX]!, 0.1, e);
      Q[F.shLZ] = lerp(Q[F.shLZ]!, 0.12, e); Q[F.shRZ] = lerp(Q[F.shRZ]!, 0.12, e);
      Q[F.elLX] = lerp(Q[F.elLX]!, 0.15, e); Q[F.elRX] = lerp(Q[F.elRX]!, 0.15, e);
      Q[F.hipsY] = Q[F.hipsY]! - 0.09 * e;
      Q[F.knLX] = Q[F.knLX]! - 0.3 * e; Q[F.knRX] = Q[F.knRX]! - 0.3 * e;
      break;
    }
    default:
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Muerte
// ─────────────────────────────────────────────────────────────────────────────
function deathPose(rig: Rig, a: AnimState): void {
  const type = rig.type;
  const t = a.deathT;
  const D = FALL_S[type];
  const p = clamp(t / D, 0, 1);
  const fall = p * p;
  const sign = a.deathDir;
  P.fill(0);
  P[F.auxS] = 1;
  P[F.rootX] = sign * (Math.PI / 2 - 0.06) * fall;
  P[F.rootZ] = a.deathRoll * fall;
  P[F.rootY] = LIE_LIFT[type] * fall;
  const buckle = easeOut(clamp(t / (D * 0.6), 0, 1));
  P[F.knLX] = -1.05 * buckle + 0.7 * fall;
  P[F.knRX] = -0.85 * buckle + 0.55 * fall;
  P[F.hpLX] = 0.55 * buckle * (1 - fall);
  P[F.hpRX] = 0.35 * buckle * (1 - fall);
  P[F.hpLZ] = 0.2 * fall; P[F.hpRZ] = 0.28 * fall;
  P[F.hipsY] = -0.32 * buckle * (1 - fall);
  const fling = easeOut(clamp(t / (D * 0.7), 0, 1));
  P[F.shLX] = lerp(0.3, sign > 0 ? 1.0 : -0.2, fling);
  P[F.shRX] = lerp(0.3, sign > 0 ? 0.7 : 0.1, fling);
  P[F.shLZ] = 0.95 * fling; P[F.shRZ] = 0.7 * fling;
  P[F.elLX] = 0.5 * fling; P[F.elRX] = 0.25 * fling;
  P[F.torsoX] = (sign > 0 ? 0.25 : -0.3) * fling;
  P[F.torsoZ] = a.deathRoll * 0.5 * fling;
  P[F.headX] = 0.25 * fling * sign;
  P[F.headZ] = a.deathRoll * 1.3 * fling;
  // Espasmos finales que se apagan.
  const late = Math.max(0, t - D);
  const tw = Math.exp(-late * 2.2);
  P[F.shLX] = P[F.shLX]! + Math.sin(late * 21) * 0.09 * tw;
  P[F.elRX] = P[F.elRX]! + Math.sin(late * 17 + 1) * 0.12 * tw;
  P[F.hpRX] = P[F.hpRX]! + Math.sin(late * 15) * 0.08 * tw;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluación
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Evalúa la pose y actualiza las matrices de mundo del rig. `dt` = tiempo acumulado desde la última
 * evaluación (el LOD puede saltar frames). `(x,y,z,yaw)` = transformación de la raíz.
 */
export function poseRig(rig: Rig, a: AnimState, x: number, y: number, z: number, yaw: number, dt: number): void {
  a.clock += dt;
  if (a.dead) {
    a.deathT += dt;
    deathPose(rig, a);
  } else {
    locomotion(rig, a, dt);
    a.aggro = damp(a.aggro, a.aggroTarget, 5, dt);
    // Acción: se funde con la locomoción.
    if (a.act !== ACT.none) a.actShow = a.act;
    if (a.actShow !== ACT.none) {
      a.actT += dt;
      const target = a.act !== ACT.none ? 1 : 0;
      a.actW = damp(a.actW, target, target > a.actW ? 26 : 9, dt);
      if (a.act === ACT.none && a.actW < 0.02) {
        a.actShow = ACT.none;
        a.actW = 0;
      } else {
        Q.set(P);
        actionPose(rig, a);
        const w = a.actW;
        for (let i = 0; i < FIELDS; i++) P[i] = P[i]! + (Q[i]! - P[i]!) * w;
      }
    }
    // Sacudida por impacto (aditiva).
    if (a.hitKick > 0.001) {
      const k = a.hitKick;
      a.hitKick = Math.max(0, a.hitKick - dt * 4.5);
      P[F.torsoX] = P[F.torsoX]! + 0.32 * k;
      P[F.headX] = P[F.headX]! + 0.45 * k;
      P[F.torsoZ] = P[F.torsoZ]! + a.hitSide * 0.22 * k;
      P[F.headZ] = P[F.headZ]! + a.hitSide * 0.25 * k;
      P[F.shLX] = P[F.shLX]! + 0.3 * k;
      P[F.shRX] = P[F.shRX]! + 0.3 * k;
    }
  }

  const n = rig.nodes;
  const sk = rig.skeleton;
  const root = n[N.root]!;
  root.position.set(x, y + P[F.rootY]! - a.sink, z);
  root.rotation.set(P[F.rootX]!, yaw + (a.dead ? a.deathYaw * easeOut(clamp(a.deathT / 0.9, 0, 1)) : 0), P[F.rootZ]!);
  const hips = n[N.hips]!;
  hips.position.set(0, sk.hipY + P[F.hipsY]!, P[F.hipsZ]!);
  hips.rotation.z = P[F.hipsR]!;
  n[N.torso]!.rotation.set(P[F.torsoX]!, P[F.torsoY]!, P[F.torsoZ]!);
  n[N.head]!.rotation.set(P[F.headX]!, P[F.headY]!, P[F.headZ]!);
  n[N.shL]!.rotation.set(P[F.shLX]!, P[F.shLY]!, -P[F.shLZ]!);
  n[N.shR]!.rotation.set(P[F.shRX]!, P[F.shRY]!, P[F.shRZ]!);
  n[N.elL]!.rotation.x = P[F.elLX]!;
  n[N.elR]!.rotation.x = P[F.elRX]!;
  n[N.hpL]!.rotation.set(P[F.hpLX]!, 0, -P[F.hpLZ]!);
  n[N.hpR]!.rotation.set(P[F.hpRX]!, 0, P[F.hpRZ]!);
  n[N.knL]!.rotation.x = P[F.knLX]!;
  n[N.knR]!.rotation.x = P[F.knRX]!;
  n[N.aux]!.scale.setScalar(P[F.auxS]!);
  root.updateMatrixWorld(true);
  a.posed = true;
}
