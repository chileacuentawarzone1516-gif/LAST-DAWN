/**
 * Esqueleto del maniquí: nombres de hueso, jerarquía, posiciones de reposo y repartos de pesos.
 * Todos los huesos tienen rotación identidad en reposo (brazos colgando, piernas rectas), de modo que
 * la geometría se construye directamente en coordenadas de modelo y la pose es sólo rotación de huesos.
 */
import * as THREE from 'three';
import type { SkinFn } from './geo';

export const BONE_NAMES = [
  'hips', 'spine', 'chest', 'neck', 'head', 'lidL', 'lidR', 'tailA', 'tailB',
  'uArmL', 'fArmL', 'handL', 'uArmR', 'fArmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

export const BONE_PARENT: Record<BoneName, BoneName | null> = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  lidL: 'head', lidR: 'head', tailA: 'head', tailB: 'tailA',
  uArmL: 'chest', fArmL: 'uArmL', handL: 'fArmL',
  uArmR: 'chest', fArmR: 'uArmR', handR: 'fArmR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL',
  thighR: 'hips', shinR: 'thighR', footR: 'shinR',
};

/** Lado del personaje: L = +X (a la derecha de la pantalla mirando de frente), R = −X. */
export type Side = 1 | -1;
export const sideName = (s: Side): 'L' | 'R' => (s === 1 ? 'L' : 'R');
export const sideBone = <K extends 'uArm' | 'fArm' | 'hand' | 'thigh' | 'shin' | 'foot' | 'lid'>(k: K, s: Side): BoneName =>
  `${k}${sideName(s)}` as BoneName;

export type RigLayout = Record<BoneName, readonly [number, number, number]>;

export interface Rig {
  readonly root: THREE.Group;
  readonly skeleton: THREE.Skeleton;
  readonly bones: readonly THREE.Bone[];
  readonly byName: Record<BoneName, THREE.Bone>;
  readonly index: Record<BoneName, number>;
  /** Posición de reposo (mundo del modelo) de cada hueso. */
  readonly rest: Record<BoneName, THREE.Vector3>;
}

/** Crea los huesos con su jerarquía y calcula la pose de reposo (bind). */
export function buildRig(layout: RigLayout): Rig {
  const root = new THREE.Group();
  root.name = 'character';
  const byName = {} as Record<BoneName, THREE.Bone>;
  const index = {} as Record<BoneName, number>;
  const rest = {} as Record<BoneName, THREE.Vector3>;
  const bones: THREE.Bone[] = [];
  BONE_NAMES.forEach((name, i) => {
    const bone = new THREE.Bone();
    bone.name = name;
    byName[name] = bone;
    index[name] = i;
    const w = layout[name];
    rest[name] = new THREE.Vector3(w[0], w[1], w[2]);
    const parent = BONE_PARENT[name];
    if (parent) {
      const pw = layout[parent];
      bone.position.set(w[0] - pw[0], w[1] - pw[1], w[2] - pw[2]);
      byName[parent].add(bone);
    } else {
      bone.position.set(w[0], w[1], w[2]);
      root.add(bone);
    }
    bones.push(bone);
  });
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  return { root, skeleton, bones, byName, index, rest };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pesos
// ─────────────────────────────────────────────────────────────────────────────
const smooth = (t: number): number => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

/**
 * Reparto de pesos a lo largo de una cadena vertical de huesos (de arriba abajo). `joints[i]` es la
 * altura de la articulación entre names[i] y names[i+1]; `half[i]` es el semiancho de su zona de mezcla.
 */
export function chainSkin(index: Record<BoneName, number>, names: readonly BoneName[], joints: readonly number[], half: readonly number[]): SkinFn {
  const ids = names.map((n) => index[n]);
  return (_x, y, _z, out) => {
    let i = 0;
    while (i < joints.length && y < joints[i]! - half[i]!) i++;
    if (i >= joints.length || y >= joints[i]! + half[i]!) {
      const id = ids[Math.min(i, ids.length - 1)]!;
      out.i0 = id;
      out.w0 = 1;
      out.i1 = id;
      out.w1 = 0;
      return;
    }
    const t = smooth((joints[i]! + half[i]! - y) / (2 * half[i]!));
    out.i0 = ids[i]!;
    out.w0 = 1 - t;
    out.i1 = ids[i + 1]!;
    out.w1 = t;
  };
}

/** Alturas de articulación necesarias para repartir pesos. */
export interface Joints {
  hipY: number; kneeY: number; ankleY: number; waistJ: number; chestJ: number;
  neckBaseY: number; headJ: number; elbowY: number; wristY: number;
}

export interface SkinSet {
  torso: SkinFn;
  neck: SkinFn;
  arm: (s: Side) => SkinFn;
  leg: (s: Side) => SkinFn;
  /** Caña de la bota: mezcla shin → foot en el tobillo. */
  boot: (s: Side) => SkinFn;
  /** Prenda que cuelga bajo la cadera (abrigos): parte del peso pasa al muslo del lado correspondiente. */
  skirt: SkinFn;
  /** Torso + cuello + cabeza (capuchas, cuellos altos, melenas): mezcla hacia la cabeza por arriba. */
  upper: SkinFn;
}

export function makeSkins(index: Record<BoneName, number>, j: Joints): SkinSet {
  const arms = ([1, -1] as Side[]).map((s) => chainSkin(index, [sideBone('uArm', s), sideBone('fArm', s), sideBone('hand', s)], [j.elbowY, j.wristY], [0.035, 0.025]));
  const legs = ([1, -1] as Side[]).map((s) => chainSkin(index, ['hips', sideBone('thigh', s), sideBone('shin', s), sideBone('foot', s)], [j.hipY, j.kneeY, j.ankleY], [0.05, 0.045, 0.03]));
  const boots = ([1, -1] as Side[]).map((s) => chainSkin(index, [sideBone('shin', s), sideBone('foot', s)], [j.ankleY], [0.03]));
  const torso = chainSkin(index, ['chest', 'spine', 'hips'], [j.chestJ, j.waistJ], [0.07, 0.07]);
  const upper = chainSkin(index, ['head', 'neck', 'chest', 'spine', 'hips'], [j.headJ, j.neckBaseY, j.chestJ, j.waistJ], [0.02, 0.03, 0.07, 0.07]);
  const hips = index.hips;
  const thighL = index.thighL;
  const thighR = index.thighR;
  const skirt: SkinFn = (x, y, z, out) => {
    if (y >= j.hipY) {
      torso(x, y, z, out);
      return;
    }
    // Bajo la cadera: 65 % hacia el muslo del lado (a más profundidad, más se mueve con la pierna).
    const k = smooth((j.hipY - y) / 0.14) * 0.65;
    out.i0 = hips;
    out.w0 = 1 - k;
    out.i1 = x >= 0 ? thighL : thighR;
    out.w1 = k;
  };
  return { torso, neck: chainSkin(index, ['head', 'neck', 'chest'], [j.headJ, j.neckBaseY], [0.02, 0.03]), arm: (s) => arms[s === 1 ? 0 : 1]!, leg: (s) => legs[s === 1 ? 0 : 1]!, boot: (s) => boots[s === 1 ? 0 : 1]!, skirt, upper };
}
