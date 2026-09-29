/**
 * Animación procedural del maniquí (sin asignaciones por frame).
 *
 * Las poses se describen con parámetros de alto nivel (cadera, columna, cabeza, posición de los pies y de
 * las muñecas) que se suavizan hacia el objetivo con amortiguación exponencial (transiciones suaves).
 * Las piernas y los brazos se resuelven con IK analítico de dos huesos: los pies permanecen plantados
 * mientras la cadera se balancea y las manos siguen al pecho cuando respira.
 * Encima de la pose se suman movimientos de reposo: respiración, balanceo de peso, mirada, parpadeo y
 * oscilación de la coleta.
 */
import * as THREE from 'three';
import type { CharacterPose } from '../core/context';
import { clamp, damp } from '../core/util';
import type { BodySpec } from './body';
import type { Rig } from './rig';

// ─────────────────────────────────────────────────────────────────────────────
// Esquema de parámetros
// ─────────────────────────────────────────────────────────────────────────────
const P_HIPS = 0; // x, y, z, yaw, pitch, roll
const P_SPINE = 6; // pitch, yaw, roll
const P_CHEST = 9;
const P_NECK = 12;
const P_HEAD = 15;
const P_FOOT_L = 18; // spread (hacia fuera), z, yaw (puntas hacia fuera)
const P_FOOT_R = 21;
const P_ARM_L = 24; // objetivo muñeca (chest-local) x,y,z · pista de codo x,y,z · mano rx, giro, rz
const P_ARM_R = 33;
const P_AMP = 42; // amplitud de respiración, balanceo y mirada
const N_PARAMS = 45;

type Vec9 = readonly [number, number, number, number, number, number, number, number, number];
type Vec3T = readonly [number, number, number];

interface PoseDef {
  hips: readonly [number, number, number, number, number, number];
  spine: Vec3T; chest: Vec3T; neck: Vec3T; head: Vec3T;
  footL: Vec3T; footR: Vec3T;
  armL: Vec9; armR: Vec9;
  amp: Vec3T;
}

/** Objetivos de brazo en reposo colgando (muñeca junto al muslo, codo ligeramente atrás). */
function hang(b: BodySpec, side: 1 | -1, out = 0.03, forward = 0.02): Vec9 {
  const sy = b.shoulderY - b.chestJ;
  return [side * (b.shoulderX + out), sy - (b.upperArm + b.foreArm) * 0.955, forward, side * 0.25, -0.15, -1, -0.16, 0, 0];
}

function makePoses(b: BodySpec): Record<CharacterPose, PoseDef> {
  const sy = b.shoulderY - b.chestJ;
  const brow = b.eye.y + 0.035 - b.chestJ;
  const k = b.gender === 'female' ? 0.9 : 1;

  const idle: PoseDef = {
    hips: [0, -0.012, 0, 0, 0, 0],
    spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
    footL: [0.015, 0, 0.16], footR: [0.015, 0, 0.16],
    armL: hang(b, 1), armR: hang(b, -1),
    amp: [1, 1, 1],
  };

  // Saludo militar: firmes, pecho hacia fuera, mano derecha (−X) a la sien.
  const salute: PoseDef = {
    hips: [0, -0.002, 0, 0, 0, 0],
    spine: [-0.03, 0, 0], chest: [-0.05, 0, 0], neck: [-0.02, 0, 0], head: [-0.06, 0, 0],
    footL: [-0.035, 0, 0.42], footR: [-0.035, 0, 0.42],
    armL: [b.shoulderX + 0.012, sy - (b.upperArm + b.foreArm) * 0.985, 0.005, 0.1, -0.1, -1, -0.05, 0, 0],
    armR: [-0.152 * k, brow + 0.045, 0.028, -1, -0.12, 0.05, -0.15, 0.95, 0],
    amp: [0.55, 0.15, 0.1],
  };

  // Guardia de combate: postura escalonada, torso ligeramente inclinado, puños a la altura de la barbilla.
  const ready: PoseDef = {
    hips: [0, -0.1, 0.02, -0.42, 0.06, 0],
    spine: [0.06, -0.12, 0], chest: [0.08, -0.12, 0], neck: [-0.06, 0.1, 0], head: [-0.1, 0.56, 0],
    footL: [0.045, 0.21, 0.1], footR: [0.06, -0.22, 0.75],
    armL: [0.085 * k, sy - 0.075, 0.33 * k, 0.55, -1, -0.15, -0.35, 0, 0],
    armR: [-0.075 * k, sy - 0.03, 0.2 * k, -0.35, -1, -0.35, -0.3, 0, 0],
    amp: [1.5, 0.3, 0.35],
  };
  return { idle, salute, ready };
}

// ─────────────────────────────────────────────────────────────────────────────
// Animador
// ─────────────────────────────────────────────────────────────────────────────
export interface Animator {
  setPose(pose: CharacterPose, instant: boolean): void;
  update(dt: number): void;
}

const DOWN = new THREE.Vector3(0, -1, 0);
const LID_OPEN = 0.2;

export function createAnimator(rig: Rig, b: BodySpec): Animator {
  const poses = makePoses(b);
  const cur = new Float32Array(N_PARAMS);
  const tgt = new Float32Array(N_PARAMS);
  const bone = rig.byName;
  for (const n of ['hips', 'spine', 'chest', 'neck', 'head'] as const) bone[n].rotation.order = 'YXZ';

  const flat = (d: PoseDef, out: Float32Array): void => {
    out.set(d.hips, P_HIPS);
    out.set(d.spine, P_SPINE);
    out.set(d.chest, P_CHEST);
    out.set(d.neck, P_NECK);
    out.set(d.head, P_HEAD);
    out.set(d.footL, P_FOOT_L);
    out.set(d.footR, P_FOOT_R);
    out.set(d.armL, P_ARM_L);
    out.set(d.armR, P_ARM_R);
    out.set(d.amp, P_AMP);
  };

  // Escalares y objetos reutilizables (sin asignaciones por frame).
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const v4 = new THREE.Vector3();
  const v5 = new THREE.Vector3();
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const qc = new THREE.Quaternion();
  const qh = new THREE.Quaternion();
  const eu = new THREE.Euler(0, 0, 0, 'YXZ');
  const armL1 = b.upperArm;
  const armL2 = b.foreArm;
  const legL1 = b.hipY - b.kneeY;
  const legL2 = b.kneeY - b.ankleY;
  const shoulderY = b.shoulderY - b.chestJ;

  let t = 0;
  let blinkT = 3;
  let blinkPhase = -1;
  let seed = 12345;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  /** IK de dos huesos: rota `up` y `fo` para que la muñeca alcance (tx,ty,tz) en el espacio del padre del hombro/cadera. */
  const solve2 = (
    sx: number, sy: number, sz: number, tx: number, ty: number, tz: number,
    hx: number, hy: number, hz: number, l1: number, l2: number, up: THREE.Bone, fo: THREE.Bone,
  ): void => {
    v1.set(tx - sx, ty - sy, tz - sz);
    const dist = Math.max(1e-4, v1.length());
    v1.divideScalar(dist);
    const dc = clamp(dist, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
    const a = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
    const hh = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    v2.set(hx, hy, hz);
    v2.addScaledVector(v1, -v2.dot(v1));
    if (v2.lengthSq() < 1e-8) v2.set(0, 0, 1).addScaledVector(v1, -v1.z);
    v2.normalize();
    // Codo E = S + dir·a + pista⊥·hh ; muñeca W = S + dir·dc.
    v3.set(sx, sy, sz).addScaledVector(v1, a).addScaledVector(v2, hh);
    v4.set(sx, sy, sz).addScaledVector(v1, dc);
    v5.subVectors(v3, v1.set(sx, sy, sz)).normalize(); // dirección del hueso superior
    qa.setFromUnitVectors(DOWN, v5);
    v5.subVectors(v4, v3).normalize(); // dirección del hueso inferior
    qb.setFromUnitVectors(DOWN, v5);
    up.quaternion.copy(qa);
    fo.quaternion.copy(qa).invert().multiply(qb);
  };

  const arm = (side: 1 | -1, o: number, hand: THREE.Bone, up: THREE.Bone, fo: THREE.Bone): void => {
    solve2(side * b.shoulderX, shoulderY, 0, cur[o]!, cur[o + 1]!, cur[o + 2]!, cur[o + 3]!, cur[o + 4]!, cur[o + 5]!, armL1, armL2, up, fo);
    eu.set(cur[o + 6]!, cur[o + 7]!, cur[o + 8]!, 'XYZ');
    hand.quaternion.setFromEuler(eu);
    eu.order = 'YXZ';
  };

  const leg = (side: 1 | -1, o: number, thigh: THREE.Bone, shin: THREE.Bone, foot: THREE.Bone): void => {
    const hipsPos = bone.hips.position;
    // Tobillo objetivo (raíz) → espacio local de la cadera → relativo al origen del muslo.
    v1.set(side * (b.hipX + cur[o]!), b.ankleY, cur[o + 1]!).sub(v2.set(hipsPos.x, hipsPos.y, hipsPos.z));
    v1.applyQuaternion(qc.copy(bone.hips.quaternion).invert());
    v1.x -= side * b.hipX;
    v1.y += 0; // origen del muslo a la altura de la cadera
    const yawWorld = side * cur[o + 2]!;
    const yawLocal = yawWorld - cur[P_HIPS + 3]!;
    solve2(0, 0, 0, v1.x, v1.y, v1.z, Math.sin(yawLocal) + side * 0.06, 0, Math.cos(yawLocal), legL1, legL2, thigh, shin);
    // Pie plano en el mundo: q_pie = (q_muslo · q_espinilla)⁻¹ · q_cadera⁻¹ · Ry(yaw).
    qh.copy(thigh.quaternion).multiply(shin.quaternion).invert();
    qb.copy(bone.hips.quaternion).invert();
    qa.setFromAxisAngle(v3.set(0, 1, 0), yawWorld);
    foot.quaternion.copy(qh).multiply(qb).multiply(qa);
  };

  const apply = (): void => {
    const amp = cur[P_AMP]!;
    const swayAmp = cur[P_AMP + 1]!;
    const lookAmp = cur[P_AMP + 2]!;
    const breath = Math.sin(t * (1.75 + amp * 0.35));
    const ws = Math.sin(t * 0.83) * swayAmp;
    const ws2 = Math.sin(t * 0.83 + 1.1) * swayAmp;

    // Cadera y columna.
    const h = bone.hips;
    h.position.set(cur[P_HIPS]! + 0.012 * ws, b.hipY + cur[P_HIPS + 1]! + 0.004 * breath * amp * 0.3, cur[P_HIPS + 2]!);
    eu.set(cur[P_HIPS + 4]!, cur[P_HIPS + 3]!, cur[P_HIPS + 5]! + 0.022 * ws, 'YXZ');
    h.quaternion.setFromEuler(eu);
    bone.spine.rotation.set(cur[P_SPINE]! - 0.008 * breath * amp, cur[P_SPINE + 1]!, cur[P_SPINE + 2]! - 0.03 * ws2);
    bone.chest.rotation.set(cur[P_CHEST]! - 0.02 * breath * amp, cur[P_CHEST + 1]!, cur[P_CHEST + 2]! + 0.012 * ws2);
    const sc = 1 + 0.006 * breath * amp;
    bone.chest.scale.set(sc, 1 + 0.008 * breath * amp, sc);

    // Mirada.
    const ly = (0.2 * Math.sin(t * 0.31) + 0.09 * Math.sin(t * 0.83 + 1.7)) * lookAmp;
    const lp = 0.035 * Math.sin(t * 0.47 + 0.4) * lookAmp;
    bone.neck.rotation.set(cur[P_NECK]! + lp * 0.4, cur[P_NECK + 1]! + ly * 0.4, cur[P_NECK + 2]! - 0.012 * ws);
    bone.head.rotation.set(cur[P_HEAD]! + lp * 0.6 + 0.01 * breath * amp, cur[P_HEAD + 1]! + ly * 0.6, cur[P_HEAD + 2]! + 0.012 * ws);

    // Piernas (IK con los pies plantados) y brazos.
    leg(1, P_FOOT_L, bone.thighL, bone.shinL, bone.footL);
    leg(-1, P_FOOT_R, bone.thighR, bone.shinR, bone.footR);
    arm(1, P_ARM_L, bone.handL, bone.uArmL, bone.fArmL);
    arm(-1, P_ARM_R, bone.handR, bone.uArmR, bone.fArmR);

    // Parpadeo.
    let lid = LID_OPEN;
    if (blinkPhase >= 0) lid += (1 - LID_OPEN) * Math.sin(Math.PI * Math.min(1, blinkPhase / 0.17));
    bone.lidL.scale.set(1, lid, 1);
    bone.lidR.scale.set(1, lid, 1);

    // Coleta / trenzas: oscilación con retardo.
    bone.tailA.rotation.set(0.05 * Math.sin(t * 1.3 + 0.6) + 0.08 * ws, 0, 0.06 * Math.sin(t * 1.7));
    bone.tailB.rotation.set(0.09 * Math.sin(t * 1.3 - 0.3), 0, 0.12 * Math.sin(t * 1.7 - 0.8));
  };

  return {
    setPose(pose, instant) {
      flat(poses[pose], tgt);
      if (instant) {
        cur.set(tgt);
        apply();
      }
    },
    update(dt) {
      t += dt;
      for (let i = 0; i < N_PARAMS; i++) cur[i] = damp(cur[i]!, tgt[i]!, 7, dt);
      blinkT -= dt;
      if (blinkPhase >= 0) {
        blinkPhase += dt;
        if (blinkPhase > 0.17) blinkPhase = -1;
      } else if (blinkT <= 0) {
        blinkPhase = 0;
        blinkT = 2.4 + rnd() * 3.6;
      }
      apply();
    },
  };
}
