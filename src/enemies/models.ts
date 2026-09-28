/**
 * Modelos procedurales de los enemigos.
 *
 * Diseño (rendimiento): cada tipo se compone de unas pocas «clases de pieza» (torso, cabeza, brazos,
 * piernas, accesorios) con geometría FUSIONADA de low-poly y UN material compartido. Cada clase se
 * dibuja con un THREE.InstancedMesh para todos los individuos de ese tipo → el coste en draw calls no
 * depende de cuántos enemigos haya, sólo de cuántas clases distintas se ven.
 *
 * Cada individuo tiene un «rig» de nodos Object3D (no añadidos a la escena) que la animación mueve;
 * cada frame las matrices de mundo de los nodos se copian a las instancias visibles. La variación
 * entre individuos (escala, tono de piel y de tela) se aplica con instanceColor y escala del nodo raíz,
 * sin crear materiales nuevos.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIRECTOR, ENEMY_AI } from '../config';
import type { MaterialsApi } from '../core/context';
import type { EnemyType, HitZone, MaterialKey, Vec3 } from '../core/types';
import type { Rng } from '../core/util';

// ─────────────────────────────────────────────────────────────────────────────
// Nodos del rig
// ─────────────────────────────────────────────────────────────────────────────
export const N = {
  root: 0, hips: 1, torso: 2, head: 3, shL: 4, shR: 5, elL: 6, elR: 7, hpL: 8, hpR: 9, knL: 10, knR: 11, aux: 12, helm: 13,
} as const;
export type NodeIndex = (typeof N)[keyof typeof N];
export const NODE_COUNT = 14;

/** Medidas del esqueleto (m). Las extremidades cuelgan hacia -Y desde su pivote; el frente es -Z. */
export interface Skeleton {
  hipY: number;
  hipX: number;
  thigh: number;
  shin: number;
  shoulderX: number;
  shoulderY: number;
  neckY: number;
  neckZ: number;
  upperArm: number;
  foreArm: number;
  /** Nodo auxiliar (p. ej. garganta del escupidor), hijo del torso. */
  auxX: number;
  auxY: number;
  auxZ: number;
}

type Tint = 'skin' | 'cloth' | 'none';

/** Cápsula/esfera de impacto en coordenadas locales de un nodo del rig. */
export interface HitPrim {
  node: NodeIndex;
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  r: number;
  zone: HitZone;
}

interface PartSpec {
  id: string;
  material: MaterialKey;
  nodes: NodeIndex[];
  tint: Tint;
  /** true → la geometría cambia con la variante (una clase por variante). */
  perVariant: boolean;
  shadow?: boolean;
  build: (b: GeoBuilder, variant: number) => void;
}

interface ModelSpec {
  variants: number;
  skeleton: Skeleton;
  /** Multiplicadores de la variación individual (altura y anchura). */
  heightJitter: number;
  girthJitter: number;
  parts: PartSpec[];
  hitbox: HitPrim[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constructor de geometría low-poly
// ─────────────────────────────────────────────────────────────────────────────
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(Math.round(x * 4000) | 0, 73856093) ^ Math.imul(Math.round(y * 4000) | 0, 19349663)
    ^ Math.imul(Math.round(z * 4000) | 0, 83492791) ^ seed) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

interface Xf {
  x?: number; y?: number; z?: number;
  rx?: number; ry?: number; rz?: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * Acumula primitivas (cajas cónicas, cilindros, blobs) con vértices ligeramente desplazados para
 * romper la regularidad, normales planas (aspecto low-poly) y las fusiona en UNA geometría.
 */
class GeoBuilder {
  private readonly parts: THREE.BufferGeometry[] = [];
  constructor(private readonly seed: number, private readonly jitter = 0.012) {}

  private push(g: THREE.BufferGeometry, t: Xf, sx = 1, sy = 1, sz = 1, jit = this.jitter): void {
    _m.compose(_v.set(t.x ?? 0, t.y ?? 0, t.z ?? 0), _q.setFromEuler(_e.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0)), _s.set(sx, sy, sz));
    g.applyMatrix4(_m);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    if (jit > 0) {
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        pos.setXYZ(
          i,
          x + (hash3(x, y, z, this.seed) - 0.5) * 2 * jit,
          y + (hash3(x, y, z, this.seed + 17) - 0.5) * 2 * jit,
          z + (hash3(x, y, z, this.seed + 31) - 0.5) * 2 * jit,
        );
      }
    }
    const flat = g.index ? g.toNonIndexed() : g;
    if (flat !== g) g.dispose();
    flat.deleteAttribute('uv');
    flat.computeVertexNormals();
    this.parts.push(flat);
  }

  /** Caja centrada en (x,y,z). */
  box(w: number, h: number, d: number, t: Xf = {}, jit?: number): this {
    this.push(new THREE.BoxGeometry(w, h, d), t, 1, 1, 1, jit);
    return this;
  }

  /** Caja cónica centrada: ancho/fondo superior e inferior distintos. */
  tbox(wt: number, dt: number, wb: number, db: number, h: number, t: Xf = {}, jit?: number): this {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const top = p.getY(i) > 0;
      p.setXYZ(i, p.getX(i) * (top ? wt : wb), p.getY(i) * h, p.getZ(i) * (top ? dt : db));
    }
    this.push(g, t, 1, 1, 1, jit);
    return this;
  }

  /** Miembro colgante: la cara superior está en `t.y` y baja `len` (top = ancho/fondo arriba, bot = abajo). */
  limb(len: number, wt: number, dt: number, wb: number, db: number, t: Xf = {}, jit?: number): this {
    return this.tbox(wt, dt, wb, db, len, { ...t, y: (t.y ?? 0) - len / 2 }, jit);
  }

  /** Elipsoide de 80 caras. */
  blob(rx: number, ry: number, rz: number, t: Xf = {}, detail = 1, jit?: number): this {
    this.push(new THREE.IcosahedronGeometry(1, detail), t, rx, ry, rz, jit);
    return this;
  }

  /** Cilindro / cono (rt = 0). */
  cyl(rt: number, rb: number, h: number, seg: number, t: Xf = {}, jit?: number): this {
    this.push(new THREE.CylinderGeometry(rt, rb, h, seg, 1, false), t, 1, 1, 1, jit);
    return this;
  }

  build(): THREE.BufferGeometry {
    const geo = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Especificaciones por tipo
// ─────────────────────────────────────────────────────────────────────────────
const cap = (
  skel: Skeleton,
  o: { headR: number; headY: number; headZ?: number; torsoR: number; torsoTop: number; torsoBot?: number; torsoZ?: number; armR: number; foreR: number; thighR: number; shinR: number; foreExtra?: number },
): HitPrim[] => {
  const arm = (sh: NodeIndex, el: NodeIndex): HitPrim[] => [
    { node: sh, ax: 0, ay: 0, az: 0, bx: 0, by: -skel.upperArm, bz: 0, r: o.armR, zone: 'limb' },
    { node: el, ax: 0, ay: 0, az: 0, bx: 0, by: -(skel.foreArm + (o.foreExtra ?? 0.06)), bz: 0, r: o.foreR, zone: 'limb' },
  ];
  const leg = (hp: NodeIndex, kn: NodeIndex): HitPrim[] => [
    { node: hp, ax: 0, ay: 0, az: 0, bx: 0, by: -skel.thigh, bz: 0, r: o.thighR, zone: 'limb' },
    { node: kn, ax: 0, ay: 0, az: 0, bx: 0, by: -skel.shin, bz: 0, r: o.shinR, zone: 'limb' },
  ];
  return [
    { node: N.head, ax: 0, ay: o.headY, az: o.headZ ?? 0, bx: 0, by: o.headY, bz: o.headZ ?? 0, r: o.headR, zone: 'head' },
    { node: N.torso, ax: 0, ay: o.torsoBot ?? -0.02, az: o.torsoZ ?? 0, bx: 0, by: o.torsoTop, bz: o.torsoZ ?? 0, r: o.torsoR, zone: 'body' },
    ...arm(N.shL, N.elL), ...arm(N.shR, N.elR), ...leg(N.hpL, N.knL), ...leg(N.hpR, N.knR),
  ];
};

// — WALKER ————————————————————————————————————————————————————————————————
const WALKER_SKEL: Skeleton = {
  hipY: 0.93, hipX: 0.1, thigh: 0.47, shin: 0.46, shoulderX: 0.21, shoulderY: 0.5, neckY: 0.585, neckZ: 0,
  upperArm: 0.29, foreArm: 0.28, auxX: 0, auxY: 0, auxZ: 0,
};

const WALKER: ModelSpec = {
  variants: 3,
  skeleton: WALKER_SKEL,
  heightJitter: 0.06,
  girthJitter: 0.1,
  hitbox: cap(WALKER_SKEL, { headR: 0.15, headY: 0.13, torsoR: 0.23, torsoTop: 0.5, armR: 0.085, foreR: 0.075, thighR: 0.12, shinR: 0.1 }),
  parts: [
    {
      id: 'torso', material: 'clothRag', nodes: [N.torso], tint: 'cloth', perVariant: true, shadow: true,
      build(b, v) {
        // Silueta común: pecho estrecho y pelvis; varía la prenda.
        b.tbox(0.44, 0.24, 0.34, 0.21, 0.58, { y: 0.27 });
        b.box(0.33, 0.16, 0.2, { y: -0.06 });
        if (v === 0) {
          // Chaqueta: cuello alzado, faldones rotos y hombreras caídas.
          b.box(0.3, 0.07, 0.2, { y: 0.57 });
          b.box(0.1, 0.18, 0.025, { x: -0.1, y: -0.17, z: -0.115, rx: 0.15 });
          b.box(0.12, 0.22, 0.025, { x: 0.08, y: -0.19, z: -0.11, rx: 0.1, rz: 0.08 });
          b.box(0.14, 0.2, 0.025, { x: 0.02, y: -0.16, z: 0.115, rx: -0.12 });
          b.box(0.09, 0.07, 0.24, { x: -0.235, y: 0.5, rz: 0.4 });
          b.box(0.09, 0.07, 0.24, { x: 0.235, y: 0.49, rz: -0.3 });
        } else if (v === 1) {
          // Sudadera con capucha caída por la espalda.
          b.blob(0.16, 0.11, 0.13, { y: 0.56, z: 0.11 });
          b.box(0.22, 0.12, 0.04, { y: 0.1, z: -0.125 });
          b.box(0.36, 0.14, 0.23, { y: -0.04 });
          b.box(0.06, 0.28, 0.02, { x: -0.06, y: 0.35, z: -0.125, rx: 0.05 });
        } else {
          // Chaleco hecho jirones: tiras largas colgando y un hombro descubierto.
          b.box(0.12, 0.34, 0.025, { x: -0.13, y: -0.08, z: -0.11, rx: 0.2 });
          b.box(0.1, 0.42, 0.025, { x: 0.0, y: -0.14, z: -0.105, rx: 0.1, rz: -0.05 });
          b.box(0.09, 0.36, 0.025, { x: 0.12, y: -0.1, z: -0.11, rx: 0.22 });
          b.box(0.13, 0.3, 0.025, { x: -0.06, y: -0.1, z: 0.115, rx: -0.2 });
          b.box(0.1, 0.32, 0.025, { x: 0.1, y: -0.12, z: 0.12, rx: -0.15 });
          b.box(0.06, 0.1, 0.24, { x: 0.22, y: 0.5, rz: -0.6 });
        }
      },
    },
    {
      id: 'blood', material: 'blood', nodes: [N.torso], tint: 'none', perVariant: false,
      build(b) {
        b.box(0.18, 0.22, 0.03, { x: -0.06, y: 0.3, z: -0.118, rz: 0.2 });
        b.box(0.1, 0.16, 0.03, { x: 0.13, y: 0.14, z: -0.108, rz: -0.3 });
        b.box(0.03, 0.34, 0.03, { x: 0.02, y: 0.02, z: -0.12 });
        b.box(0.2, 0.06, 0.03, { x: 0.1, y: 0.5, z: -0.09, rz: -0.5 });
        b.box(0.14, 0.2, 0.03, { x: 0.05, y: 0.3, z: 0.12, rz: 0.4 });
      },
    },
    {
      id: 'head', material: 'skinGrey', nodes: [N.head], tint: 'skin', perVariant: false,
      build(b) {
        b.blob(0.105, 0.125, 0.115, { y: 0.125 });
        b.tbox(0.09, 0.1, 0.075, 0.08, 0.06, { y: 0.02, z: -0.035 });
        b.cyl(0.045, 0.052, 0.1, 5, { y: 0.0 });
        b.box(0.022, 0.035, 0.035, { y: 0.095, z: -0.115 });
        b.box(0.135, 0.022, 0.035, { y: 0.157, z: -0.085 });
        b.box(0.02, 0.05, 0.03, { x: -0.11, y: 0.11 });
        b.box(0.02, 0.05, 0.03, { x: 0.11, y: 0.115 });
      },
    },
    {
      id: 'upperArm', material: 'skinGrey', nodes: [N.shL, N.shR], tint: 'skin', perVariant: false,
      build(b) {
        b.blob(0.06, 0.06, 0.06, {}, 0);
        b.limb(0.29, 0.095, 0.095, 0.075, 0.075);
      },
    },
    {
      id: 'foreArm', material: 'skinGrey', nodes: [N.elL, N.elR], tint: 'skin', perVariant: false,
      build(b) {
        b.limb(0.28, 0.072, 0.072, 0.056, 0.056);
        b.tbox(0.07, 0.035, 0.05, 0.03, 0.09, { y: -0.325 });
        b.box(0.012, 0.075, 0.012, { x: -0.02, y: -0.4, z: -0.02, rx: 0.4 });
        b.box(0.012, 0.085, 0.012, { x: 0.0, y: -0.41, z: -0.025, rx: 0.4 });
        b.box(0.012, 0.075, 0.012, { x: 0.02, y: -0.4, z: -0.02, rx: 0.4 });
      },
    },
    {
      id: 'thigh', material: 'clothDark', nodes: [N.hpL, N.hpR], tint: 'cloth', perVariant: false, shadow: true,
      build(b) {
        b.limb(0.47, 0.16, 0.17, 0.125, 0.13);
      },
    },
    {
      id: 'shin', material: 'clothDark', nodes: [N.knL, N.knR], tint: 'cloth', perVariant: false, shadow: true,
      build(b) {
        b.limb(0.46, 0.125, 0.13, 0.09, 0.095);
        b.tbox(0.11, 0.22, 0.115, 0.24, 0.1, { y: -0.41, z: -0.035 });
        b.box(0.14, 0.04, 0.03, { y: -0.03, z: -0.06, rx: 0.2 });
      },
    },
  ],
};

// — RUNNER ————————————————————————————————————————————————————————————————
const RUNNER_SKEL: Skeleton = {
  hipY: 0.9, hipX: 0.09, thigh: 0.46, shin: 0.44, shoulderX: 0.185, shoulderY: 0.48, neckY: 0.55, neckZ: 0,
  upperArm: 0.3, foreArm: 0.31, auxX: 0, auxY: 0, auxZ: 0,
};

const RUNNER: ModelSpec = {
  variants: 2,
  skeleton: RUNNER_SKEL,
  heightJitter: 0.07,
  girthJitter: 0.08,
  hitbox: cap(RUNNER_SKEL, { headR: 0.14, headY: 0.115, torsoR: 0.2, torsoTop: 0.48, armR: 0.07, foreR: 0.06, thighR: 0.1, shinR: 0.085, foreExtra: 0.1 }),
  parts: [
    {
      id: 'torso', material: 'skinPale', nodes: [N.torso], tint: 'skin', perVariant: false, shadow: true,
      build(b) {
        b.tbox(0.36, 0.19, 0.26, 0.16, 0.56, { y: 0.26 });
        b.box(0.26, 0.13, 0.17, { y: -0.06 });
        // Costillas marcadas, clavículas, columna y omóplatos.
        for (let i = 0; i < 5; i++) b.box(0.3 - i * 0.012, 0.014, 0.02, { y: 0.4 - i * 0.065, z: -0.088 + i * 0.006 });
        b.box(0.34, 0.03, 0.05, { y: 0.47, z: -0.03 });
        for (let i = 0; i < 6; i++) b.box(0.03, 0.03, 0.03, { y: 0.44 - i * 0.075, z: 0.094 });
        b.box(0.09, 0.14, 0.03, { x: -0.09, y: 0.38, z: 0.095, rz: 0.2 });
        b.box(0.09, 0.14, 0.03, { x: 0.09, y: 0.38, z: 0.095, rz: -0.2 });
      },
    },
    {
      id: 'shreds', material: 'clothRag', nodes: [N.torso], tint: 'cloth', perVariant: true,
      build(b, v) {
        if (v === 0) {
          // Restos de camiseta de tirantes.
          b.tbox(0.3, 0.2, 0.28, 0.18, 0.2, { y: 0.02 });
          b.box(0.06, 0.34, 0.02, { x: -0.09, y: 0.33, z: -0.095 });
          b.box(0.1, 0.16, 0.02, { x: 0.05, y: -0.13, z: -0.09, rx: 0.15 });
          b.box(0.12, 0.2, 0.02, { x: -0.03, y: -0.14, z: 0.09, rx: -0.15 });
        } else {
          // Sólo un cinturón raído y una tira cruzada.
          b.box(0.3, 0.06, 0.2, { y: -0.02 });
          b.box(0.05, 0.52, 0.02, { x: 0.0, y: 0.26, z: -0.098, rz: 0.75 });
          b.box(0.07, 0.24, 0.02, { x: 0.1, y: -0.14, z: -0.09, rx: 0.2 });
        }
      },
    },
    {
      id: 'head', material: 'skinPale', nodes: [N.head], tint: 'skin', perVariant: false,
      build(b) {
        b.blob(0.09, 0.115, 0.1, { y: 0.115 });
        // Mandíbula desencajada, pómulos hundidos y cuello tendinoso.
        b.tbox(0.08, 0.09, 0.06, 0.07, 0.075, { y: -0.005, z: -0.05, rx: 0.4 });
        b.box(0.12, 0.03, 0.04, { y: 0.09, z: -0.09 });
        b.cyl(0.036, 0.045, 0.1, 5, { y: 0.0 });
        b.cyl(0.011, 0.011, 0.16, 4, { x: -0.03, y: 0.0, z: -0.03, rz: 0.15 });
        b.cyl(0.011, 0.011, 0.16, 4, { x: 0.03, y: 0.0, z: -0.03, rz: -0.15 });
      },
    },
    {
      id: 'eyes', material: 'emissiveRed', nodes: [N.head], tint: 'none', perVariant: false,
      build(b) {
        b.box(0.034, 0.02, 0.02, { x: -0.04, y: 0.125, z: -0.096, rz: -0.25 }, 0);
        b.box(0.034, 0.02, 0.02, { x: 0.04, y: 0.125, z: -0.096, rz: 0.25 }, 0);
      },
    },
    {
      id: 'upperArm', material: 'skinPale', nodes: [N.shL, N.shR], tint: 'skin', perVariant: false,
      build(b) {
        b.blob(0.05, 0.05, 0.05, {}, 0);
        b.limb(0.3, 0.07, 0.07, 0.058, 0.058);
        b.box(0.016, 0.24, 0.016, { x: 0.03, y: -0.15, z: -0.02 });
      },
    },
    {
      id: 'foreArm', material: 'skinPale', nodes: [N.elL, N.elR], tint: 'skin', perVariant: false,
      build(b) {
        b.limb(0.31, 0.056, 0.056, 0.044, 0.044);
        b.box(0.014, 0.2, 0.014, { x: 0.025, y: -0.16, z: -0.02 });
        b.box(0.06, 0.07, 0.03, { y: -0.335 });
        for (let i = 0; i < 4; i++) b.box(0.01, 0.09, 0.01, { x: -0.022 + i * 0.015, y: -0.42, z: -0.024, rx: 0.5 });
      },
    },
    {
      id: 'thigh', material: 'clothDark', nodes: [N.hpL, N.hpR], tint: 'cloth', perVariant: false, shadow: true,
      build(b) {
        b.limb(0.46, 0.125, 0.135, 0.095, 0.105);
        b.box(0.03, 0.12, 0.03, { x: 0.05, y: -0.5, z: -0.03 });
      },
    },
    {
      id: 'shin', material: 'skinPale', nodes: [N.knL, N.knR], tint: 'skin', perVariant: false, shadow: true,
      build(b) {
        b.limb(0.44, 0.095, 0.1, 0.066, 0.07);
        b.tbox(0.075, 0.2, 0.08, 0.22, 0.06, { y: -0.41, z: -0.045 });
        b.box(0.05, 0.04, 0.05, { y: -0.06, z: -0.06 });
      },
    },
  ],
};

// — BRUTE —————————————————————————————————————————————————————————————————
const BRUTE_SKEL: Skeleton = {
  hipY: 0.95, hipX: 0.21, thigh: 0.45, shin: 0.5, shoulderX: 0.56, shoulderY: 0.74, neckY: 0.9, neckZ: -0.12,
  upperArm: 0.46, foreArm: 0.52, auxX: 0, auxY: 0, auxZ: 0,
};

const BRUTE: ModelSpec = {
  variants: 2,
  skeleton: BRUTE_SKEL,
  heightJitter: 0.07,
  girthJitter: 0.08,
  hitbox: cap(BRUTE_SKEL, { headR: 0.22, headY: 0.14, torsoR: 0.42, torsoTop: 0.72, torsoBot: 0.02, torsoZ: -0.02, armR: 0.17, foreR: 0.16, thighR: 0.2, shinR: 0.16, foreExtra: 0.2 }),
  parts: [
    {
      id: 'torso', material: 'skinGreen', nodes: [N.torso], tint: 'skin', perVariant: false, shadow: true,
      build(b) {
        b.tbox(1.02, 0.56, 0.7, 0.42, 0.95, { y: 0.4 });
        b.blob(0.42, 0.3, 0.34, { y: 0.06, z: -0.17 });
        b.blob(0.4, 0.22, 0.28, { y: 0.78, z: 0.14 });
        b.box(0.64, 0.24, 0.42, { y: -0.1 });
      },
    },
    {
      id: 'boils', material: 'skinPale', nodes: [N.torso], tint: 'skin', perVariant: false,
      build(b) {
        b.blob(0.11, 0.1, 0.09, { x: -0.3, y: 0.55, z: -0.26 }, 1);
        b.blob(0.08, 0.07, 0.07, { x: 0.22, y: 0.3, z: -0.32 }, 1);
        b.blob(0.13, 0.11, 0.1, { x: 0.32, y: 0.82, z: 0.22 }, 1);
        b.blob(0.09, 0.08, 0.08, { x: -0.18, y: 0.7, z: 0.3 }, 1);
        b.blob(0.07, 0.06, 0.06, { x: -0.1, y: 0.02, z: -0.42 }, 1);
      },
    },
    {
      id: 'plates', material: 'armorPlate', nodes: [N.torso], tint: 'none', perVariant: true,
      build(b, v) {
        // Placas de chatarra sujetas con correas: pecho, espalda y pinchos en la joroba.
        b.tbox(0.7, 0.06, 0.56, 0.06, 0.5, { y: 0.5, z: -0.36, rx: -0.12, rz: v === 0 ? 0.08 : -0.1 });
        b.box(0.66, 0.2, 0.06, { y: 0.06, z: -0.45, rx: 0.15 });
        b.box(0.52, 0.42, 0.06, { y: 0.55, z: 0.36, rx: 0.08, rz: 0.1 });
        for (let i = 0; i < 4; i++) {
          b.cyl(0, 0.05, 0.24, 4, { x: (i - 1.5) * 0.17, y: 0.9 + (i === 1 || i === 2 ? 0.05 : 0), z: 0.22, rx: -0.5 });
        }
        if (v === 1) {
          b.box(0.06, 0.5, 0.05, { x: -0.3, y: 0.55, z: -0.36, rz: 0.6 });
          b.box(0.4, 0.3, 0.05, { x: 0.28, y: 0.15, z: -0.44, rz: -0.2 });
        } else {
          b.box(0.2, 0.34, 0.05, { x: -0.36, y: 0.32, z: -0.3, ry: 0.5 });
        }
      },
    },
    {
      id: 'rags', material: 'clothRag', nodes: [N.torso], tint: 'cloth', perVariant: false,
      build(b) {
        b.box(0.7, 0.22, 0.44, { y: -0.16 });
        b.box(0.16, 0.34, 0.03, { x: -0.16, y: -0.4, z: -0.24, rx: 0.15 });
        b.box(0.2, 0.4, 0.03, { x: 0.12, y: -0.42, z: -0.24, rx: 0.1 });
        b.box(0.24, 0.36, 0.03, { x: 0.0, y: -0.38, z: 0.24, rx: -0.12 });
      },
    },
    {
      id: 'head', material: 'skinGreen', nodes: [N.head], tint: 'skin', perVariant: false,
      build(b) {
        b.blob(0.15, 0.15, 0.16, { y: 0.14 });
        b.tbox(0.19, 0.16, 0.15, 0.14, 0.1, { y: 0.0, z: -0.08 });
        b.box(0.25, 0.05, 0.07, { y: 0.19, z: -0.13 });
        b.cyl(0.11, 0.13, 0.12, 6, { y: -0.01 });
      },
    },
    {
      id: 'tusks', material: 'bone', nodes: [N.head], tint: 'none', perVariant: false,
      build(b) {
        b.cyl(0, 0.03, 0.12, 4, { x: -0.075, y: 0.08, z: -0.17, rx: -0.2 });
        b.cyl(0, 0.03, 0.12, 4, { x: 0.075, y: 0.08, z: -0.17, rx: -0.2 });
      },
    },
    {
      id: 'eyes', material: 'emissiveAmber', nodes: [N.head], tint: 'none', perVariant: false,
      build(b) {
        b.box(0.04, 0.025, 0.02, { x: -0.07, y: 0.17, z: -0.155 }, 0);
        b.box(0.04, 0.025, 0.02, { x: 0.07, y: 0.17, z: -0.155 }, 0);
      },
    },
    {
      id: 'upperArm', material: 'skinGreen', nodes: [N.shL, N.shR], tint: 'skin', perVariant: false, shadow: true,
      build(b) {
        b.blob(0.19, 0.17, 0.18, { y: 0.0 });
        b.limb(0.46, 0.27, 0.27, 0.21, 0.21);
      },
    },
    {
      id: 'foreArm', material: 'skinGreen', nodes: [N.elL, N.elR], tint: 'skin', perVariant: false,
      build(b) {
        b.limb(0.52, 0.22, 0.22, 0.2, 0.2);
        b.blob(0.17, 0.16, 0.17, { y: -0.62 });
        for (let i = 0; i < 3; i++) b.box(0.05, 0.05, 0.05, { x: -0.07 + i * 0.07, y: -0.69, z: -0.13 });
      },
    },
    {
      id: 'pauldron', material: 'armorPlate', nodes: [N.shL, N.shR], tint: 'none', perVariant: false,
      build(b) {
        b.tbox(0.38, 0.34, 0.5, 0.42, 0.1, { y: 0.2 });
        b.cyl(0, 0.06, 0.22, 4, { y: 0.34 });
      },
    },
    {
      id: 'guard', material: 'armorPlate', nodes: [N.elR], tint: 'none', perVariant: false,
      build(b) {
        b.tbox(0.3, 0.26, 0.3, 0.26, 0.36, { y: -0.26 });
        b.box(0.34, 0.05, 0.3, { y: -0.08 });
        b.cyl(0, 0.04, 0.14, 4, { x: 0.15, y: -0.24, rz: -1.2 });
        b.cyl(0, 0.04, 0.14, 4, { x: -0.15, y: -0.24, rz: 1.2 });
      },
    },
    {
      id: 'wrap', material: 'clothRag', nodes: [N.elL], tint: 'cloth', perVariant: false,
      build(b) {
        b.tbox(0.27, 0.27, 0.25, 0.25, 0.3, { y: -0.2 });
        b.box(0.08, 0.3, 0.03, { x: 0.13, y: -0.45, z: -0.05 });
      },
    },
    {
      id: 'thigh', material: 'clothRag', nodes: [N.hpL, N.hpR], tint: 'cloth', perVariant: false, shadow: true,
      build(b) {
        b.limb(0.45, 0.32, 0.34, 0.25, 0.27);
      },
    },
    {
      id: 'shin', material: 'skinGreen', nodes: [N.knL, N.knR], tint: 'skin', perVariant: false, shadow: true,
      build(b) {
        b.limb(0.5, 0.25, 0.27, 0.18, 0.2);
        b.tbox(0.22, 0.42, 0.25, 0.46, 0.13, { y: -0.44, z: -0.06 });
        b.box(0.27, 0.05, 0.05, { y: -0.02, z: -0.12 });
      },
    },
  ],
};

// — SPITTER ———————————————————————————————————————————————————————————————
const SPITTER_SKEL: Skeleton = {
  hipY: 0.93, hipX: 0.1, thigh: 0.47, shin: 0.46, shoulderX: 0.2, shoulderY: 0.48, neckY: 0.56, neckZ: -0.02,
  upperArm: 0.3, foreArm: 0.3, auxX: 0, auxY: 0.55, auxZ: -0.1,
};

const SPITTER: ModelSpec = {
  variants: 2,
  skeleton: SPITTER_SKEL,
  heightJitter: 0.06,
  girthJitter: 0.1,
  hitbox: cap(SPITTER_SKEL, { headR: 0.16, headY: 0.13, torsoR: 0.24, torsoTop: 0.5, armR: 0.075, foreR: 0.065, thighR: 0.11, shinR: 0.09 }),
  parts: [
    {
      id: 'torso', material: 'clothOlive', nodes: [N.torso], tint: 'cloth', perVariant: true, shadow: true,
      build(b, v) {
        b.tbox(0.4, 0.22, 0.32, 0.2, 0.56, { y: 0.27 });
        b.box(0.3, 0.15, 0.19, { y: -0.06 });
        if (v === 0) {
          b.box(0.34, 0.06, 0.2, { y: 0.57 });
          b.box(0.1, 0.2, 0.025, { x: -0.08, y: -0.17, z: -0.11, rx: 0.15 });
          b.box(0.12, 0.24, 0.025, { x: 0.09, y: -0.18, z: -0.105, rx: 0.12 });
          b.box(0.14, 0.2, 0.025, { x: 0, y: -0.15, z: 0.11, rx: -0.1 });
        } else {
          b.box(0.06, 0.4, 0.22, { x: -0.13, y: 0.3, z: 0.0 });
          b.box(0.06, 0.36, 0.22, { x: 0.13, y: 0.3, z: 0.0 });
          b.box(0.3, 0.3, 0.02, { y: 0.32, z: 0.105 });
          b.box(0.16, 0.22, 0.025, { x: 0.05, y: -0.16, z: -0.105, rx: 0.1 });
        }
      },
    },
    {
      id: 'belly', material: 'skinGreen', nodes: [N.torso], tint: 'skin', perVariant: false,
      build(b) {
        b.blob(0.19, 0.2, 0.18, { y: 0.16, z: -0.1 });
        b.blob(0.06, 0.05, 0.05, { x: 0.12, y: 0.26, z: -0.2 }, 1);
        b.blob(0.05, 0.05, 0.05, { x: -0.1, y: 0.06, z: -0.24 }, 1);
      },
    },
    {
      id: 'head', material: 'skinGreen', nodes: [N.head], tint: 'skin', perVariant: false,
      build(b) {
        b.blob(0.1, 0.12, 0.11, { y: 0.13, z: 0.01 });
        // Mandíbula muy abierta y cuello dilatado.
        b.tbox(0.09, 0.11, 0.07, 0.09, 0.05, { y: 0.0, z: -0.06, rx: 0.65 });
        b.cyl(0.075, 0.085, 0.12, 6, { y: -0.01 });
        b.box(0.135, 0.022, 0.035, { y: 0.16, z: -0.09 });
      },
    },
    {
      id: 'eyes', material: 'emissiveGreen', nodes: [N.head], tint: 'none', perVariant: false,
      build(b) {
        b.box(0.03, 0.02, 0.02, { x: -0.04, y: 0.14, z: -0.108 }, 0);
        b.box(0.03, 0.02, 0.02, { x: 0.04, y: 0.14, z: -0.108 }, 0);
      },
    },
    {
      id: 'sac', material: 'toxic', nodes: [N.aux], tint: 'none', perVariant: false,
      build(b) {
        b.blob(0.13, 0.17, 0.12, {}, 1, 0.01);
        b.blob(0.06, 0.06, 0.06, { x: -0.1, y: 0.06, z: -0.05 }, 1, 0.006);
        b.blob(0.05, 0.05, 0.05, { x: 0.09, y: -0.06, z: -0.08 }, 1, 0.006);
      },
    },
    {
      id: 'upperArm', material: 'skinGreen', nodes: [N.shL, N.shR], tint: 'skin', perVariant: false,
      build(b) {
        b.blob(0.055, 0.055, 0.055, {}, 0);
        b.limb(0.3, 0.085, 0.085, 0.066, 0.066);
      },
    },
    {
      id: 'foreArm', material: 'skinGreen', nodes: [N.elL, N.elR], tint: 'skin', perVariant: false,
      build(b) {
        b.limb(0.3, 0.064, 0.064, 0.05, 0.05);
        b.tbox(0.065, 0.03, 0.045, 0.028, 0.09, { y: -0.34 });
        for (let i = 0; i < 3; i++) b.box(0.011, 0.08, 0.011, { x: -0.02 + i * 0.02, y: -0.41, z: -0.02, rx: 0.35 });
      },
    },
    {
      id: 'thigh', material: 'clothDark', nodes: [N.hpL, N.hpR], tint: 'cloth', perVariant: false, shadow: true,
      build(b) {
        b.limb(0.47, 0.145, 0.155, 0.115, 0.12);
      },
    },
    {
      id: 'shin', material: 'clothDark', nodes: [N.knL, N.knR], tint: 'cloth', perVariant: false, shadow: true,
      build(b) {
        b.limb(0.46, 0.115, 0.12, 0.085, 0.09);
        b.tbox(0.1, 0.21, 0.105, 0.23, 0.1, { y: -0.41, z: -0.035 });
      },
    },
  ],
};

// — WARDEN ————————————————————————————————————————————————————————————————
const WARDEN_SKEL: Skeleton = {
  hipY: 1.1, hipX: 0.19, thigh: 0.58, shin: 0.52, shoulderX: 0.58, shoulderY: 0.93, neckY: 1.04, neckZ: -0.04,
  upperArm: 0.52, foreArm: 0.5, auxX: 0, auxY: 0, auxZ: 0,
};

const WARDEN: ModelSpec = {
  variants: 1,
  skeleton: WARDEN_SKEL,
  heightJitter: 0,
  girthJitter: 0,
  hitbox: [
    // Con casco, la esfera de cabeza cubre el casco entero.
    { node: N.head, ax: 0, ay: 0.16, az: -0.02, bx: 0, by: 0.16, bz: -0.02, r: 0.25, zone: 'head' },
    { node: N.torso, ax: 0, ay: 0.0, az: 0, bx: 0, by: 0.86, bz: 0, r: 0.44, zone: 'body' },
    { node: N.shL, ax: 0, ay: 0, az: 0, bx: 0, by: -WARDEN_SKEL.upperArm, bz: 0, r: 0.17, zone: 'limb' },
    { node: N.shR, ax: 0, ay: 0, az: 0, bx: 0, by: -WARDEN_SKEL.upperArm, bz: 0, r: 0.17, zone: 'limb' },
    { node: N.elL, ax: 0, ay: 0, az: 0, bx: 0, by: -0.5, bz: 0, r: 0.16, zone: 'limb' },
    { node: N.elR, ax: 0, ay: 0, az: 0, bx: 0, by: -0.56, bz: 0, r: 0.17, zone: 'limb' },
    { node: N.hpL, ax: 0, ay: 0, az: 0, bx: 0, by: -WARDEN_SKEL.thigh, bz: 0, r: 0.18, zone: 'limb' },
    { node: N.hpR, ax: 0, ay: 0, az: 0, bx: 0, by: -WARDEN_SKEL.thigh, bz: 0, r: 0.18, zone: 'limb' },
    { node: N.knL, ax: 0, ay: 0, az: 0, bx: 0, by: -WARDEN_SKEL.shin, bz: 0, r: 0.16, zone: 'limb' },
    { node: N.knR, ax: 0, ay: 0, az: 0, bx: 0, by: -WARDEN_SKEL.shin, bz: 0, r: 0.16, zone: 'limb' },
  ],
  parts: [
    {
      id: 'torso', material: 'wardenArmor', nodes: [N.torso], tint: 'none', perVariant: false, shadow: true,
      build(b) {
        b.tbox(0.92, 0.5, 0.66, 0.42, 1.05, { y: 0.46 });
        b.box(0.7, 0.24, 0.44, { y: -0.12 });
        for (let i = 0; i < 3; i++) b.box(0.56 - i * 0.04, 0.1, 0.46, { y: 0.08 + i * 0.13, z: -0.01 });
        b.box(0.3, 0.4, 0.07, { x: -0.19, y: -0.3, z: -0.2, rx: 0.12 });
        b.box(0.3, 0.4, 0.07, { x: 0.19, y: -0.3, z: -0.2, rx: 0.12 });
        b.box(0.26, 0.34, 0.06, { x: 0, y: -0.3, z: 0.22, rx: -0.1 });
        b.cyl(0.19, 0.22, 0.14, 8, { y: 0.98 });
      },
    },
    {
      id: 'plates', material: 'armorPlate', nodes: [N.torso], tint: 'none', perVariant: false, shadow: true,
      build(b) {
        b.tbox(0.82, 0.12, 0.62, 0.12, 0.58, { y: 0.7, z: -0.3, rx: -0.1 });
        b.box(0.62, 0.16, 0.1, { y: 0.28, z: -0.33 });
        b.box(0.5, 0.72, 0.3, { y: 0.55, z: 0.42 });
        b.cyl(0.11, 0.11, 0.74, 8, { x: -0.36, y: 0.55, z: 0.44 });
        b.cyl(0.11, 0.11, 0.74, 8, { x: 0.36, y: 0.55, z: 0.44 });
        b.cyl(0.04, 0.04, 0.6, 5, { x: -0.36, y: 0.98, z: 0.2, rz: 1.1, rx: 0.5 });
        b.cyl(0.04, 0.04, 0.6, 5, { x: 0.36, y: 0.98, z: 0.2, rz: -1.1, rx: 0.5 });
        b.box(0.26, 0.09, 0.16, { y: 0.02, z: -0.31 });
      },
    },
    {
      id: 'core', material: 'emissiveAmber', nodes: [N.torso], tint: 'none', perVariant: false,
      build(b) {
        b.box(0.16, 0.16, 0.05, { y: 0.68, z: -0.345 }, 0);
        b.box(0.34, 0.03, 0.03, { y: 0.55, z: -0.33 }, 0);
        b.box(0.3, 0.04, 0.02, { y: 0.66, z: 0.575 }, 0);
        b.box(0.3, 0.04, 0.02, { y: 0.5, z: 0.575 }, 0);
      },
    },
    {
      id: 'head', material: 'skinGrey', nodes: [N.head], tint: 'none', perVariant: false,
      build(b) {
        b.blob(0.13, 0.155, 0.145, { y: 0.15 });
        b.tbox(0.12, 0.13, 0.1, 0.11, 0.08, { y: 0.03, z: -0.05 });
        b.cyl(0.075, 0.09, 0.14, 6, { y: 0.0 });
      },
    },
    {
      id: 'eyes', material: 'emissiveRed', nodes: [N.head], tint: 'none', perVariant: false,
      build(b) {
        b.box(0.03, 0.02, 0.02, { x: -0.05, y: 0.17, z: -0.135 }, 0);
        b.box(0.03, 0.02, 0.02, { x: 0.05, y: 0.17, z: -0.135 }, 0);
      },
    },
    {
      id: 'helm', material: 'wardenHelmet', nodes: [N.helm], tint: 'none', perVariant: false, shadow: true,
      build(b) {
        b.tbox(0.44, 0.44, 0.38, 0.4, 0.36, { y: 0.19, z: -0.01 });
        b.tbox(0.34, 0.06, 0.3, 0.05, 0.26, { y: 0.09, z: -0.21 });
        b.box(0.07, 0.11, 0.46, { y: 0.4, z: -0.01 });
        b.box(0.05, 0.26, 0.22, { x: -0.23, y: 0.16 });
        b.box(0.05, 0.26, 0.22, { x: 0.23, y: 0.16 });
        b.box(0.36, 0.16, 0.05, { y: 0.0, z: 0.2 });
        b.box(0.44, 0.05, 0.08, { y: 0.32, z: -0.2 });
      },
    },
    {
      id: 'visor', material: 'emissiveRed', nodes: [N.helm], tint: 'none', perVariant: false,
      build(b) {
        b.box(0.32, 0.05, 0.03, { y: 0.16, z: -0.222 }, 0);
        b.box(0.14, 0.03, 0.03, { y: 0.1, z: -0.25 }, 0);
      },
    },
    {
      id: 'pauldron', material: 'wardenHelmet', nodes: [N.shL, N.shR], tint: 'none', perVariant: false, shadow: true,
      build(b) {
        b.tbox(0.52, 0.46, 0.62, 0.52, 0.16, { y: 0.2 });
        b.box(0.66, 0.05, 0.56, { y: 0.09 });
        for (let i = 0; i < 3; i++) b.cyl(0, 0.05, 0.16, 4, { x: (i - 1) * 0.16, y: 0.36 });
      },
    },
    {
      id: 'upperArm', material: 'wardenArmor', nodes: [N.shL, N.shR], tint: 'none', perVariant: false, shadow: true,
      build(b) {
        b.limb(0.52, 0.3, 0.3, 0.25, 0.25);
        b.box(0.32, 0.08, 0.32, { y: -0.5 });
      },
    },
    {
      id: 'foreArm', material: 'wardenArmor', nodes: [N.elL, N.elR], tint: 'none', perVariant: false,
      build(b) {
        b.limb(0.5, 0.25, 0.25, 0.21, 0.23);
        b.box(0.28, 0.08, 0.3, { y: -0.48 });
      },
    },
    {
      id: 'shield', material: 'armorPlate', nodes: [N.elL], tint: 'none', perVariant: false, shadow: true,
      build(b) {
        b.tbox(0.78, 0.12, 0.66, 0.12, 0.92, { x: -0.22, y: -0.22, z: -0.26 });
        b.blob(0.16, 0.16, 0.08, { x: -0.22, y: -0.18, z: -0.36 });
        b.box(0.72, 0.06, 0.16, { x: -0.22, y: 0.24, z: -0.28 });
        b.box(0.05, 0.05, 0.05, { x: -0.5, y: 0.1, z: -0.34 });
        b.box(0.05, 0.05, 0.05, { x: 0.06, y: 0.1, z: -0.34 });
        b.box(0.05, 0.05, 0.05, { x: -0.5, y: -0.55, z: -0.34 });
        b.box(0.05, 0.05, 0.05, { x: 0.06, y: -0.55, z: -0.34 });
      },
    },
    {
      id: 'fist', material: 'armorPlate', nodes: [N.elR], tint: 'none', perVariant: false,
      build(b) {
        b.box(0.28, 0.32, 0.32, { y: -0.66 });
        for (let i = 0; i < 4; i++) b.cyl(0, 0.035, 0.12, 4, { x: -0.1 + i * 0.067, y: -0.66, z: -0.22, rx: -1.57 });
      },
    },
    {
      id: 'thigh', material: 'wardenArmor', nodes: [N.hpL, N.hpR], tint: 'none', perVariant: false, shadow: true,
      build(b) {
        b.limb(0.58, 0.31, 0.33, 0.26, 0.28);
        b.box(0.28, 0.3, 0.06, { y: -0.2, z: -0.19, rx: 0.05 });
      },
    },
    {
      id: 'shin', material: 'wardenArmor', nodes: [N.knL, N.knR], tint: 'none', perVariant: false, shadow: true,
      build(b) {
        b.limb(0.52, 0.26, 0.28, 0.21, 0.23);
        b.tbox(0.26, 0.42, 0.28, 0.48, 0.15, { y: -0.44, z: -0.09 });
        b.box(0.3, 0.05, 0.06, { y: -0.08, z: -0.17 });
      },
    },
    {
      id: 'kneePad', material: 'armorPlate', nodes: [N.knL, N.knR], tint: 'none', perVariant: false,
      build(b) {
        b.box(0.25, 0.2, 0.1, { y: 0.02, z: -0.16 });
        b.cyl(0, 0.04, 0.12, 4, { y: 0.02, z: -0.24, rx: -1.57 });
      },
    },
  ],
};

const SPECS: Record<EnemyType, ModelSpec> = { walker: WALKER, runner: RUNNER, brute: BRUTE, spitter: SPITTER, warden: WARDEN };

export function getSkeleton(type: EnemyType): Skeleton {
  return SPECS[type].skeleton;
}
export function getHitbox(type: EnemyType): readonly HitPrim[] {
  return SPECS[type].hitbox;
}
export function variantCount(type: EnemyType): number {
  return SPECS[type].variants;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rig de un individuo
// ─────────────────────────────────────────────────────────────────────────────
interface ClassGL {
  key: string;
  mesh: THREE.InstancedMesh;
  nodes: NodeIndex[];
  tint: Tint;
  capacity: number;
  count: number;
}

export class Rig {
  readonly type: EnemyType;
  readonly skeleton: Skeleton;
  readonly nodes: THREE.Object3D[] = [];
  variant = 0;
  /** Clases de pieza (InstancedMesh) que dibujan a este individuo. */
  gl: ClassGL[] = [];
  /** Tintes multiplicativos (lineales) por individuo. */
  readonly skin = new Float32Array([1, 1, 1]);
  readonly cloth = new Float32Array([1, 1, 1]);
  /** Fogonazo de daño 0..1 y oscurecimiento del cadáver 0..1. */
  flash = 0;
  dim = 0;
  /** Escala individual (altura, anchura). */
  height = 1;
  girth = 1;
  helmetOn: boolean;

  constructor(type: EnemyType) {
    this.type = type;
    this.skeleton = SPECS[type].skeleton;
    this.helmetOn = type === 'warden';
    for (let i = 0; i < NODE_COUNT; i++) this.nodes.push(new THREE.Object3D());
    const n = this.nodes;
    const s = this.skeleton;
    const root = n[N.root]!;
    root.rotation.order = 'YXZ';
    n[N.hips]!.position.set(0, s.hipY, 0);
    n[N.torso]!.position.set(0, 0, 0);
    n[N.head]!.position.set(0, s.neckY, s.neckZ);
    n[N.shL]!.position.set(-s.shoulderX, s.shoulderY, 0);
    n[N.shR]!.position.set(s.shoulderX, s.shoulderY, 0);
    n[N.elL]!.position.set(0, -s.upperArm, 0);
    n[N.elR]!.position.set(0, -s.upperArm, 0);
    n[N.hpL]!.position.set(-s.hipX, 0, 0);
    n[N.hpR]!.position.set(s.hipX, 0, 0);
    n[N.knL]!.position.set(0, -s.thigh, 0);
    n[N.knR]!.position.set(0, -s.thigh, 0);
    n[N.aux]!.position.set(s.auxX, s.auxY, s.auxZ);
    root.add(n[N.hips]!);
    n[N.hips]!.add(n[N.torso]!, n[N.hpL]!, n[N.hpR]!);
    n[N.torso]!.add(n[N.head]!, n[N.shL]!, n[N.shR]!, n[N.aux]!);
    n[N.shL]!.add(n[N.elL]!);
    n[N.shR]!.add(n[N.elR]!);
    n[N.hpL]!.add(n[N.knL]!);
    n[N.hpR]!.add(n[N.knR]!);
    if (this.helmetOn) n[N.head]!.add(n[N.helm]!);
  }

  node(i: NodeIndex): THREE.Object3D {
    return this.nodes[i]!;
  }

  get root(): THREE.Object3D {
    return this.nodes[N.root]!;
  }

  /** Variación individual determinista: escala y tonos. */
  randomize(rng: Rng, variant: number): void {
    const spec = SPECS[this.type];
    this.variant = variant;
    this.height = 1 + (rng() * 2 - 1) * spec.heightJitter;
    this.girth = 1 + (rng() * 2 - 1) * spec.girthJitter;
    const skinB = 0.78 + rng() * 0.36;
    this.skin[0] = skinB * (0.94 + rng() * 0.16);
    this.skin[1] = skinB * (0.94 + rng() * 0.12);
    this.skin[2] = skinB * (0.9 + rng() * 0.16);
    const clothB = 0.62 + rng() * 0.6;
    this.cloth[0] = clothB * (0.9 + rng() * 0.2);
    this.cloth[1] = clothB * (0.9 + rng() * 0.2);
    this.cloth[2] = clothB * (0.9 + rng() * 0.2);
    this.flash = 0;
    this.dim = 0;
    this.root.scale.set(this.girth, this.height, this.girth);
  }

  /** Escala media horizontal (para radios de impacto). */
  get radiusScale(): number {
    return this.girth;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Kit: geometrías, InstancedMeshes y pools de rigs
// ─────────────────────────────────────────────────────────────────────────────
export interface SceneLike {
  add(...objects: THREE.Object3D[]): unknown;
  remove(...objects: THREE.Object3D[]): unknown;
}

const TYPES: readonly EnemyType[] = ['walker', 'runner', 'brute', 'spitter', 'warden'];

export class ModelKit {
  private readonly classes = new Map<string, ClassGL>();
  private readonly variantClasses = new Map<string, ClassGL[]>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly pools = new Map<EnemyType, Rig[]>();
  private readonly group = new THREE.Group();
  private readonly shadow: ShadowBlobs;
  private readonly capacity: number;
  private readonly ordered: ClassGL[] = [];

  constructor(private readonly scene: SceneLike, materials: MaterialsApi, castShadows: boolean) {
    this.capacity = DIRECTOR.maxAlive + ENEMY_AI.corpse.max + 6;
    this.group.name = 'enemies';
    let seed = 1337;
    for (const type of TYPES) {
      const spec = SPECS[type];
      this.pools.set(type, []);
      for (let v = 0; v < spec.variants; v++) this.variantClasses.set(`${type}:${v}`, []);
      for (const part of spec.parts) {
        const build = (variant: number): THREE.BufferGeometry => {
          const b = new GeoBuilder(seed++);
          part.build(b, variant);
          const g = b.build();
          this.geometries.push(g);
          return g;
        };
        const makeClass = (key: string, geo: THREE.BufferGeometry): ClassGL => {
          const capacity = this.capacity * part.nodes.length * (type === 'warden' ? 1 : 1);
          const mesh = new THREE.InstancedMesh(geo, materials.get(part.material), capacity);
          mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
          mesh.frustumCulled = false;
          mesh.castShadow = castShadows && !!part.shadow;
          mesh.receiveShadow = false;
          mesh.count = 0;
          mesh.visible = false;
          mesh.name = key;
          this.group.add(mesh);
          const cls: ClassGL = { key, mesh, nodes: part.nodes, tint: part.tint, capacity, count: 0 };
          this.classes.set(key, cls);
          this.ordered.push(cls);
          return cls;
        };
        if (part.perVariant) {
          for (let v = 0; v < spec.variants; v++) this.variantClasses.get(`${type}:${v}`)!.push(makeClass(`${type}:${part.id}:${v}`, build(v)));
        } else {
          const cls = makeClass(`${type}:${part.id}`, build(0));
          for (let v = 0; v < spec.variants; v++) this.variantClasses.get(`${type}:${v}`)!.push(cls);
        }
      }
    }
    this.shadow = new ShadowBlobs(this.capacity);
    this.group.add(this.shadow.mesh);
    scene.add(this.group);
  }

  /** Obtiene un rig (reutiliza uno del pool). El llamador aplica `randomize`. */
  acquire(type: EnemyType, rng: Rng): Rig {
    const pool = this.pools.get(type)!;
    const rig = pool.pop() ?? new Rig(type);
    const v = Math.floor(rng() * variantCount(type));
    rig.gl = this.variantClasses.get(`${type}:${v}`)!;
    rig.randomize(rng, v);
    if (type === 'warden' && !rig.helmetOn) this.attachHelmet(rig);
    return rig;
  }

  release(rig: Rig): void {
    this.pools.get(rig.type)!.push(rig);
  }

  /** Vuelve a colocar el casco en la cabeza (al reciclar el rig del Warden). */
  attachHelmet(rig: Rig): void {
    const helm = rig.node(N.helm);
    helm.position.set(0, 0, 0);
    helm.quaternion.identity();
    helm.scale.set(1, 1, 1);
    rig.node(N.head).add(helm);
    rig.helmetOn = true;
  }

  /** Desprende el casco: pasa a ser un nodo huérfano con transformación de mundo propia. */
  detachHelmet(rig: Rig): THREE.Object3D {
    const helm = rig.node(N.helm);
    rig.root.updateMatrixWorld(true);
    helm.matrixWorld.decompose(helm.position, helm.quaternion, helm.scale);
    rig.node(N.head).remove(helm);
    rig.helmetOn = false;
    return helm;
  }

  // — Dibujo por frame —
  beginFrame(): void {
    for (const c of this.ordered) c.count = 0;
    this.shadow.count = 0;
  }

  /** Copia las matrices de mundo del rig a las instancias de cada clase. `matricesReady`: el rig tiene matrixWorld vigente. */
  draw(rig: Rig): void {
    const f = 1 + rig.flash * 0.9;
    const dim = 1 - rig.dim * 0.4;
    const n = rig.nodes;
    for (const g of rig.gl) {
      const mats = g.mesh.instanceMatrix.array as Float32Array;
      const cols = (g.mesh.instanceColor as THREE.InstancedBufferAttribute).array as Float32Array;
      let r = 1;
      let gg = 1;
      let b = 1;
      if (g.tint === 'skin') {
        r = rig.skin[0]!; gg = rig.skin[1]!; b = rig.skin[2]!;
      } else if (g.tint === 'cloth') {
        r = rig.cloth[0]!; gg = rig.cloth[1]!; b = rig.cloth[2]!;
      }
      const k = f * (g.tint === 'none' ? 1 : dim);
      const flashWarm = rig.flash * 0.35;
      for (let i = 0; i < g.nodes.length; i++) {
        if (g.count >= g.capacity) break;
        const slot = g.count++;
        mats.set(n[g.nodes[i]!]!.matrixWorld.elements, slot * 16);
        const o = slot * 3;
        cols[o] = r * k + flashWarm;
        cols[o + 1] = gg * k;
        cols[o + 2] = b * k;
      }
    }
  }

  drawShadow(x: number, y: number, z: number, radius: number): void {
    this.shadow.add(x, y, z, radius);
  }

  endFrame(): void {
    for (const c of this.ordered) {
      const m = c.mesh;
      m.count = c.count;
      m.visible = c.count > 0;
      if (c.count > 0) {
        m.instanceMatrix.needsUpdate = true;
        (m.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
      }
    }
    this.shadow.flush();
  }

  /** Nº de clases dibujadas este frame (≈ draw calls de enemigos). */
  get visibleClasses(): number {
    let n = this.shadow.count > 0 ? 1 : 0;
    for (const c of this.ordered) if (c.count > 0) n++;
    return n;
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const c of this.ordered) c.mesh.dispose();
    for (const g of this.geometries) g.dispose();
    this.shadow.dispose();
    this.classes.clear();
    this.variantClasses.clear();
    this.ordered.length = 0;
    this.geometries.length = 0;
    this.pools.clear();
    this.group.clear();
  }
}

/** Manchas de sombra circulares bajo los enemigos: un único InstancedMesh para todos. */
class ShadowBlobs {
  readonly mesh: THREE.InstancedMesh;
  count = 0;
  private readonly geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly tex: THREE.CanvasTexture;
  private readonly mtx = new THREE.Matrix4();

  constructor(capacity: number) {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const c = canvas.getContext('2d');
    if (c) {
      const grad = c.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
      grad.addColorStop(0, 'rgba(0,0,0,0.62)');
      grad.addColorStop(0.55, 'rgba(0,0,0,0.34)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grad;
      c.fillRect(0, 0, size, size);
    }
    this.tex = new THREE.CanvasTexture(canvas);
    this.mat = new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.name = 'enemy-shadows';
  }

  add(x: number, y: number, z: number, radius: number): void {
    if (this.count >= (this.mesh.instanceMatrix.array.length >> 4)) return;
    const s = radius * 2.6;
    const e = this.mtx.elements;
    e[0] = s; e[1] = 0; e[2] = 0; e[3] = 0;
    e[4] = 0; e[5] = 1; e[6] = 0; e[7] = 0;
    e[8] = 0; e[9] = 0; e[10] = s; e[11] = 0;
    e[12] = x; e[13] = y + 0.035; e[14] = z; e[15] = 1;
    (this.mesh.instanceMatrix.array as Float32Array).set(e, this.count * 16);
    this.count++;
  }

  flush(): void {
    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    if (this.count > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.dispose();
    this.geo.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}

/** Comodidad: posición del nodo en coordenadas de mundo (requiere matrixWorld vigente). */
export function nodeWorldPos(rig: Rig, node: NodeIndex, lx: number, ly: number, lz: number, out: Vec3): Vec3 {
  const e = rig.node(node).matrixWorld.elements;
  out.x = e[0]! * lx + e[4]! * ly + e[8]! * lz + e[12]!;
  out.y = e[1]! * lx + e[5]! * ly + e[9]! * lz + e[13]!;
  out.z = e[2]! * lx + e[6]! * ly + e[10]! * lz + e[14]!;
  return out;
}
