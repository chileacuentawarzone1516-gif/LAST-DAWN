/**
 * Animación procedural sobre el esqueleto REAL de los GLB (56 huesos, nombres de SkeletonProfileHumanoid,
 * pose A, sin animaciones). Sólo se manejan ~22 huesos (cadera, columna, cuello, cabeza, ojos, hombros,
 * brazos y piernas); los demás (dedos, mandíbula, dedos del pie) siguen a su padre.
 *
 * Método: cada hueso recibe una rotación RELATIVA A SU PADRE expresada en ejes del MODELO (Y arriba, +Z al
 * frente), independiente de los ejes locales de cada hueso (que vienen de Godot). Con Pw0 = rotación de mundo
 * en reposo del padre y q0 = rotación local en reposo, la rotación local es  Pw0⁻¹·rel·Pw0·q0.
 * Brazos y piernas se resuelven con IK de dos huesos (mundo del modelo): los pies se quedan plantados
 * mientras la cadera se balancea y las manos siguen al torso.
 * Sin asignaciones por frame.
 */
import * as THREE from 'three';
import type { CharacterPose } from '../core/context';
import { clamp, damp } from '../core/util';

const CHAIN = [
  'Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head', 'LeftEye', 'RightEye',
  'LeftShoulder', 'LeftUpperArm', 'LeftLowerArm', 'LeftHand',
  'RightShoulder', 'RightUpperArm', 'RightLowerArm', 'RightHand',
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'RightUpperLeg', 'RightLowerLeg', 'RightFoot',
] as const;
type BoneKey = (typeof CHAIN)[number];

const PARENT: Record<BoneKey, BoneKey | null> = {
  Hips: null, Spine: 'Hips', Chest: 'Spine', UpperChest: 'Chest', Neck: 'UpperChest', Head: 'Neck',
  LeftEye: 'Head', RightEye: 'Head',
  LeftShoulder: 'UpperChest', LeftUpperArm: 'LeftShoulder', LeftLowerArm: 'LeftUpperArm', LeftHand: 'LeftLowerArm',
  RightShoulder: 'UpperChest', RightUpperArm: 'RightShoulder', RightLowerArm: 'RightUpperArm', RightHand: 'RightLowerArm',
  LeftUpperLeg: 'Hips', LeftLowerLeg: 'LeftUpperLeg', LeftFoot: 'LeftLowerLeg',
  RightUpperLeg: 'Hips', RightLowerLeg: 'RightUpperLeg', RightFoot: 'RightLowerLeg',
};

const IDX = {} as Record<BoneKey, number>;
CHAIN.forEach((n, i) => {
  IDX[n] = i;
});

// ── Esquema de parámetros ────────────────────────────────────────────────────
const P_HIPS = 0; // x, y, z, yaw, pitch, roll
const P_TORSO = 6; // pitch, yaw, roll (se reparte entre Spine, Chest y UpperChest)
const P_NECK = 9;
const P_HEAD = 12;
const P_FOOT_L = 15; // desplazamiento hacia fuera, hacia delante, guiñada de la punta (hacia fuera +)
const P_FOOT_R = 18;
const P_ARM_L = 21; // objetivo de la muñeca (x,y,z en el espacio de reposo), pista del codo (x,y,z), giro, mano rx,ry,rz
const P_ARM_R = 31;
const P_AMP = 41; // respiración, balanceo, mirada
const N_PARAMS = 44;

type Vec10 = readonly [number, number, number, number, number, number, number, number, number, number];
type V3 = readonly [number, number, number];

interface PoseDef {
  hips: readonly [number, number, number, number, number, number];
  torso: V3; neck: V3; head: V3;
  footL: V3; footR: V3;
  armL: Vec10; armR: Vec10;
  amp: V3;
}

/** Dirección unitaria de reposo y longitud del tramo. */
interface Seg { dir: THREE.Vector3; len: number }

export interface GlbAnimator {
  setPose(pose: CharacterPose, instant: boolean): void;
  update(dt: number): void;
}

const _v = new THREE.Vector3();

/** IK analítico de dos huesos: direcciones (unitarias) del hueso superior e inferior. */
function ikDirs(
  s: THREE.Vector3, t: THREE.Vector3, hint: THREE.Vector3, l1: number, l2: number,
  outU: THREE.Vector3, outF: THREE.Vector3, tmpA: THREE.Vector3, tmpB: THREE.Vector3,
): void {
  tmpA.subVectors(t, s);
  const dist = Math.max(1e-4, tmpA.length());
  tmpA.divideScalar(dist);
  const dc = clamp(dist, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const a = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  tmpB.copy(hint);
  tmpB.addScaledVector(tmpA, -tmpB.dot(tmpA));
  if (tmpB.lengthSq() < 1e-8) tmpB.set(0, 0, 1).addScaledVector(tmpA, -tmpA.z);
  tmpB.normalize();
  // Codo E = S + dir·a + pista⊥·h ; muñeca W = S + dir·dc.
  outU.copy(tmpA).multiplyScalar(a).addScaledVector(tmpB, h).normalize(); // dirección superior
  _v.copy(tmpA).multiplyScalar(dc);
  outF.copy(_v).addScaledVector(outU, -l1).normalize(); // W − E
}

export function createGlbAnimator(root: THREE.Object3D, heightM: number): GlbAnimator | null {
  const n = CHAIN.length;
  const bone: THREE.Object3D[] = [];
  for (const name of CHAIN) {
    const b = root.getObjectByName(name);
    if (!b) return null;
    bone.push(b);
  }
  root.updateMatrixWorld(true);

  const parent = CHAIN.map((k) => {
    const p = PARENT[k];
    return p ? IDX[p] : -1;
  });
  const w0 = bone.map((b) => b.getWorldPosition(new THREE.Vector3()));
  const q0 = bone.map((b) => b.quaternion.clone());
  const pos0 = bone.map((b) => b.position.clone());
  const pw0 = bone.map((b) => (b.parent ? b.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion()));
  const pw0i = pw0.map((q) => q.clone().invert());
  const off = bone.map((_b, i) => (parent[i]! >= 0 ? w0[i]!.clone().sub(w0[parent[i]!]!) : new THREE.Vector3()));

  const seg = (a: BoneKey, b: BoneKey): Seg => {
    const d = w0[IDX[b]]!.clone().sub(w0[IDX[a]]!);
    const len = d.length();
    return { dir: d.divideScalar(len || 1), len };
  };
  // Tramos de reposo [superior, inferior] por lado: índice 0 = izquierda (+X), 1 = derecha (−X).
  const armSeg: readonly (readonly [Seg, Seg])[] = [
    [seg('LeftUpperArm', 'LeftLowerArm'), seg('LeftLowerArm', 'LeftHand')],
    [seg('RightUpperArm', 'RightLowerArm'), seg('RightLowerArm', 'RightHand')],
  ];
  const legSeg: readonly (readonly [Seg, Seg])[] = [
    [seg('LeftUpperLeg', 'LeftLowerLeg'), seg('LeftLowerLeg', 'LeftFoot')],
    [seg('RightUpperLeg', 'RightLowerLeg'), seg('RightLowerLeg', 'RightFoot')],
  ];

  const restAt = (k: BoneKey): THREE.Vector3 => w0[IDX[k]]!;
  const k = heightM / 1.87;
  const handLen = 0.092 * heightM;

  // ── Poses ─────────────────────────────────────────────────────────────────
  const dirs = { u: new THREE.Vector3(), f: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3() };
  const target = new THREE.Vector3();
  const hintV = new THREE.Vector3();
  const armDef = (side: 1 | -1, tx: number, ty: number, tz: number, hint: V3, twist = 0, hand: V3 = [0, 0, 0]): Vec10 =>
    [tx, ty, tz, hint[0] * side, hint[1], hint[2], twist, hand[0], hand[1], hand[2]];

  /** Muñeca que deja la punta de los dedos en `tip` (iteración de punto fijo con el IK de reposo). */
  const wristForTip = (side: 1 | -1, tip: THREE.Vector3, hint: V3): THREE.Vector3 => {
    const s = restAt(side === 1 ? 'LeftUpperArm' : 'RightUpperArm');
    const [u, f] = armSeg[side === 1 ? 0 : 1]!;
    const w = tip.clone().addScaledVector(new THREE.Vector3(-side * 0.8, -0.2, 0.5).normalize(), -handLen);
    hintV.set(hint[0] * side, hint[1], hint[2]);
    for (let i = 0; i < 6; i++) {
      ikDirs(s, w, hintV, u.len, f.len, dirs.u, dirs.f, dirs.a, dirs.b);
      w.copy(tip).addScaledVector(dirs.f, -handLen);
    }
    return w;
  };

  const eyeR = restAt('RightEye');
  const shL = restAt('LeftUpperArm');
  const shR = restAt('RightUpperArm');
  const wristL = restAt('LeftHand');
  const wristR = restAt('RightHand');

  const idleHint: V3 = [0.35, -0.15, -1];
  const idleArm = (side: 1 | -1): Vec10 => {
    const w = side === 1 ? wristL : wristR;
    return armDef(side, w.x - side * 0.11 * k, w.y + 0.05 * k, w.z + 0.035 * k, idleHint, 0, [-0.1, 0, 0]);
  };

  const saluteTip = new THREE.Vector3(eyeR.x - 0.05 * k, eyeR.y + 0.055 * k, eyeR.z + 0.03 * k);
  const saluteHint: V3 = [1, -0.1, 0.15]; // el hint se multiplica por side (derecha = −1 → codo hacia −X)
  const saluteW = wristForTip(-1, saluteTip, saluteHint);

  const poses: Record<CharacterPose, PoseDef> = {
    idle: {
      hips: [0, -0.012, 0, 0, 0, 0], torso: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
      footL: [-0.045 * k, 0, 0.06], footR: [-0.045 * k, 0, 0.06],
      armL: idleArm(1), armR: idleArm(-1), amp: [1, 1, 1],
    },
    salute: {
      hips: [0, -0.004, 0, 0, 0, 0], torso: [-0.03, 0, 0], neck: [-0.02, 0, 0], head: [-0.05, 0, 0],
      footL: [-0.075 * k, 0, 0.42], footR: [-0.075 * k, 0, 0.42],
      armL: armDef(1, wristL.x - 0.05 * k, wristL.y + 0.1 * k, wristL.z + 0.02, [0.35, -0.15, -1], 0, [-0.15, 0, 0]),
      armR: armDef(-1, saluteW.x, saluteW.y, saluteW.z, saluteHint, 1.1, [0, 0, 0]),
      amp: [0.55, 0.12, 0.1],
    },
    ready: {
      hips: [0, -0.11 * k, 0.02, -0.4, 0.07, 0], torso: [0.07, -0.1, 0], neck: [-0.06, 0.1, 0], head: [-0.1, 0.5, 0],
      footL: [0.03 * k, 0.24 * k, 0.05], footR: [0.03 * k, -0.22 * k, 0.75],
      armL: armDef(1, shL.x - 0.12 * k, shL.y - 0.08 * k, shL.z + 0.3 * k, [0.4, -1, -0.2], 0, [-0.2, 0, 0]),
      armR: armDef(-1, shR.x + 0.1 * k, shR.y - 0.03 * k, shR.z + 0.22 * k, [0.4, -1, -0.3], 0, [-0.2, 0, 0]),
      amp: [1.5, 0.3, 0.35],
    },
  };

  // ── Estado ────────────────────────────────────────────────────────────────
  const cur = new Float32Array(N_PARAMS);
  const tgt = new Float32Array(N_PARAMS);
  const flat = (d: PoseDef, out: Float32Array): void => {
    out.set(d.hips, P_HIPS);
    out.set(d.torso, P_TORSO);
    out.set(d.neck, P_NECK);
    out.set(d.head, P_HEAD);
    out.set(d.footL, P_FOOT_L);
    out.set(d.footR, P_FOOT_R);
    out.set(d.armL, P_ARM_L);
    out.set(d.armR, P_ARM_R);
    out.set(d.amp, P_AMP);
  };

  const rw = bone.map(() => new THREE.Quaternion());
  const pos = bone.map(() => new THREE.Vector3());
  const rel = new THREE.Quaternion();
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const eu = new THREE.Euler(0, 0, 0, 'YXZ');
  const upV = new THREE.Vector3(0, 1, 0);
  const ikU = new THREE.Vector3();
  const ikF = new THREE.Vector3();
  const t1 = new THREE.Vector3();
  const t2 = new THREE.Vector3();
  /** Rotación de mundo pendiente del hueso inferior (izquierda/derecha) calculada por el IK del superior. */
  const pend = [new THREE.Quaternion(), new THREE.Quaternion()];
  let time = 0;

  const iUC = IDX.UpperChest;
  const euler = (q: THREE.Quaternion, x: number, y: number, z: number): THREE.Quaternion => q.setFromEuler(eu.set(x, y, z, 'YXZ'));

  const solveArm = (side: 1 | -1, o: number, iU: number): void => {
    const [su, sf] = armSeg[side === 1 ? 0 : 1]!;
    // Objetivo y pista viajan con el torso (marco de UpperChest).
    target.set(cur[o]!, cur[o + 1]!, cur[o + 2]!).sub(w0[iUC]!).applyQuaternion(rw[iUC]!).add(pos[iUC]!);
    hintV.set(cur[o + 3]!, cur[o + 4]!, cur[o + 5]!).applyQuaternion(rw[iUC]!);
    ikDirs(pos[iU]!, target, hintV, su.len, sf.len, ikU, ikF, t1, t2);
    rw[iU]!.setFromUnitVectors(su.dir, ikU);
    const twist = cur[o + 6]!;
    qa.setFromUnitVectors(sf.dir, ikF);
    if (twist !== 0) qa.premultiply(qb.setFromAxisAngle(ikF, twist));
    const slot = side === 1 ? 0 : 1;
    pend[slot]!.copy(qa);
  };

  const solveLeg = (side: 1 | -1, o: number, iU: number): void => {
    const [su, sf] = legSeg[side === 1 ? 0 : 1]!;
    const ankle0 = restAt(side === 1 ? 'LeftFoot' : 'RightFoot');
    target.set(ankle0.x + side * cur[o]!, ankle0.y, ankle0.z + cur[o + 1]!);
    const yawW = side * cur[o + 2]!;
    hintV.set(Math.sin(yawW) + side * 0.08, 0, Math.cos(yawW));
    ikDirs(pos[iU]!, target, hintV, su.len, sf.len, ikU, ikF, t1, t2);
    rw[iU]!.setFromUnitVectors(su.dir, ikU);
    const slot = side === 1 ? 0 : 1;
    pend[slot]!.setFromUnitVectors(sf.dir, ikF);
  };

  const apply = (): void => {
    const amp = cur[P_AMP]!;
    const swayAmp = cur[P_AMP + 1]!;
    const lookAmp = cur[P_AMP + 2]!;
    const breath = Math.sin(time * (1.75 + amp * 0.35));
    const ws = Math.sin(time * 0.83) * swayAmp;
    const ws2 = Math.sin(time * 0.83 + 1.1) * swayAmp;
    const ly = (0.2 * Math.sin(time * 0.31) + 0.09 * Math.sin(time * 0.83 + 1.7)) * lookAmp;
    const lp = 0.035 * Math.sin(time * 0.47 + 0.4) * lookAmp;
    const ex = 0.06 * Math.sin(time * 1.9 + 0.5) * lookAmp;
    const ey = 0.04 * Math.sin(time * 1.3) * lookAmp;

    for (let i = 0; i < n; i++) {
      const p = parent[i]!;
      const key = CHAIN[i]!;
      // Rotación relativa al padre (ejes del modelo).
      rel.identity();
      switch (key) {
        case 'Hips':
          euler(rel, cur[P_HIPS + 4]!, cur[P_HIPS + 3]!, cur[P_HIPS + 5]! + 0.022 * ws);
          break;
        case 'Spine':
          euler(rel, cur[P_TORSO]! * 0.3 - 0.008 * breath * amp, cur[P_TORSO + 1]! * 0.3, cur[P_TORSO + 2]! * 0.3 - 0.03 * ws2);
          break;
        case 'Chest':
          euler(rel, cur[P_TORSO]! * 0.4 - 0.018 * breath * amp, cur[P_TORSO + 1]! * 0.4, cur[P_TORSO + 2]! * 0.4 + 0.012 * ws2);
          break;
        case 'UpperChest':
          euler(rel, cur[P_TORSO]! * 0.3 - 0.014 * breath * amp, cur[P_TORSO + 1]! * 0.3, cur[P_TORSO + 2]! * 0.3);
          break;
        case 'Neck':
          euler(rel, cur[P_NECK]! + lp * 0.4, cur[P_NECK + 1]! + ly * 0.4, cur[P_NECK + 2]! - 0.012 * ws);
          break;
        case 'Head':
          euler(rel, cur[P_HEAD]! + lp * 0.6, cur[P_HEAD + 1]! + ly * 0.6, cur[P_HEAD + 2]! + 0.012 * ws);
          break;
        case 'LeftEye':
        case 'RightEye':
          // Los ojos compensan parte del giro de la cabeza y hacen pequeños sacádicos.
          euler(rel, ey - lp * 0.5, ex - ly * 0.4, 0);
          break;
        default:
          break;
      }

      if (p < 0) {
        rw[i]!.copy(rel);
        pos[i]!.set(w0[i]!.x + cur[P_HIPS]! + 0.012 * ws, w0[i]!.y + cur[P_HIPS + 1]!, w0[i]!.z + cur[P_HIPS + 2]!);
      } else {
        rw[i]!.copy(rw[p]!).multiply(rel);
        pos[i]!.copy(off[i]!).applyQuaternion(rw[p]!).add(pos[p]!);
      }

      // IK de brazos y piernas.
      switch (key) {
        case 'LeftUpperArm': solveArm(1, P_ARM_L, i); break;
        case 'RightUpperArm': solveArm(-1, P_ARM_R, i); break;
        case 'LeftUpperLeg': solveLeg(1, P_FOOT_L, i); break;
        case 'RightUpperLeg': solveLeg(-1, P_FOOT_R, i); break;
        case 'LeftLowerArm':
        case 'LeftLowerLeg':
          rw[i]!.copy(pend[0]!);
          pos[i]!.copy(off[i]!).applyQuaternion(rw[p]!).add(pos[p]!);
          break;
        case 'RightLowerArm':
        case 'RightLowerLeg':
          rw[i]!.copy(pend[1]!);
          pos[i]!.copy(off[i]!).applyQuaternion(rw[p]!).add(pos[p]!);
          break;
        case 'LeftHand':
          euler(qa, cur[P_ARM_L + 7]!, cur[P_ARM_L + 8]!, cur[P_ARM_L + 9]!);
          rw[i]!.copy(rw[p]!).multiply(qa);
          break;
        case 'RightHand':
          euler(qa, cur[P_ARM_R + 7]!, cur[P_ARM_R + 8]!, cur[P_ARM_R + 9]!);
          rw[i]!.copy(rw[p]!).multiply(qa);
          break;
        case 'LeftFoot':
          rw[i]!.setFromAxisAngle(upV, cur[P_FOOT_L + 2]!);
          break;
        case 'RightFoot':
          rw[i]!.setFromAxisAngle(upV, -cur[P_FOOT_R + 2]!);
          break;
        default:
          break;
      }
    }

    // Rotaciones locales:  Pw0⁻¹ · (Rw[p]⁻¹ · Rw[i]) · Pw0 · q0
    for (let i = 0; i < n; i++) {
      const p = parent[i]!;
      if (p >= 0) rel.copy(rw[p]!).invert().multiply(rw[i]!);
      else rel.copy(rw[i]!);
      bone[i]!.quaternion.copy(pw0i[i]!).multiply(rel).multiply(pw0[i]!).multiply(q0[i]!);
    }
    bone[0]!.position.set(pos0[0]!.x + cur[P_HIPS]! + 0.012 * ws, pos0[0]!.y + cur[P_HIPS + 1]!, pos0[0]!.z + cur[P_HIPS + 2]!);
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
      time += dt;
      for (let i = 0; i < N_PARAMS; i++) cur[i] = damp(cur[i]!, tgt[i]!, 7, dt);
      apply();
    },
  };
}
