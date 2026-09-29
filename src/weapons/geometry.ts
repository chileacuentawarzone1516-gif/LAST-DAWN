/**
 * Constructor de piezas procedurales para los modelos de armas: acumula cajas y cilindros por
 * (grupo, material) y los fusiona en una sola malla por par, para minimizar draw calls del
 * viewmodel. Sin texturas ni assets: todo es geometría de three.js.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MaterialsApi } from '../core/context';
import type { MaterialKey } from '../core/types';

export type V3 = readonly [number, number, number];

interface Bucket {
  group: string;
  mat: MaterialKey;
  geos: THREE.BufferGeometry[];
}

export class PartBuilder {
  private readonly buckets = new Map<string, Bucket>();
  private readonly pivots = new Map<string, V3>();
  private readonly groupNames: string[] = [];
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);

  /** El grupo rotará/se moverá alrededor de `pivot` (coordenadas del modelo). */
  setPivot(group: string, pivot: V3): void {
    this.pivots.set(group, pivot);
  }

  private push(group: string, mat: MaterialKey, geo: THREE.BufferGeometry, pos: V3, rot?: V3): void {
    this.e.set(rot?.[0] ?? 0, rot?.[1] ?? 0, rot?.[2] ?? 0, 'YXZ');
    this.q.setFromEuler(this.e);
    this.p.set(pos[0], pos[1], pos[2]);
    this.m4.compose(this.p, this.q, this.s);
    geo.applyMatrix4(this.m4);
    const key = `${group}|${mat}`;
    let b = this.buckets.get(key);
    if (!b) {
      b = { group, mat, geos: [] };
      this.buckets.set(key, b);
      if (!this.groupNames.includes(group)) this.groupNames.push(group);
    }
    b.geos.push(geo);
  }

  /** Caja de tamaño (w, h, d) centrada en `pos`. */
  box(group: string, mat: MaterialKey, size: V3, pos: V3, rot?: V3): this {
    this.push(group, mat, new THREE.BoxGeometry(size[0], size[1], size[2]), pos, rot);
    return this;
  }

  /** Cilindro con eje Z (radio `rFront` hacia −Z, `rBack` hacia +Z) de longitud `len` centrado en `pos`. */
  cylZ(group: string, mat: MaterialKey, rFront: number, rBack: number, len: number, pos: V3, seg = 8, rot?: V3): this {
    const g = new THREE.CylinderGeometry(rBack, rFront, len, seg, 1);
    g.rotateX(Math.PI / 2);
    this.push(group, mat, g, pos, rot);
    return this;
  }

  /** Cilindro con eje Y (radio `rTop` arriba) de altura `h` centrado en `pos`. */
  cylY(group: string, mat: MaterialKey, rTop: number, rBottom: number, h: number, pos: V3, seg = 8, rot?: V3): this {
    this.push(group, mat, new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1), pos, rot);
    return this;
  }

  /** Cilindro con eje X. */
  cylX(group: string, mat: MaterialKey, r: number, len: number, pos: V3, seg = 8, rot?: V3): this {
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
    g.rotateZ(Math.PI / 2);
    this.push(group, mat, g, pos, rot);
    return this;
  }

  /** Esfera (para nudillos, cabezas de tornillo, lentes…). */
  sphere(group: string, mat: MaterialKey, r: number, pos: V3, seg = 8, scale?: V3): this {
    const g = new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1));
    if (scale) g.scale(scale[0], scale[1], scale[2]);
    this.push(group, mat, g, pos);
    return this;
  }

  /**
   * Fusiona todo y crea un THREE.Group por grupo dentro de `parent`. Devuelve los grupos por
   * nombre y añade las geometrías fusionadas a `geometries` (para dispose).
   */
  build(materials: MaterialsApi, parent: THREE.Object3D, geometries: THREE.BufferGeometry[]): Record<string, THREE.Group> {
    const groups: Record<string, THREE.Group> = {};
    for (const name of this.groupNames) {
      const g = new THREE.Group();
      g.name = name;
      const pv = this.pivots.get(name);
      if (pv) g.position.set(pv[0], pv[1], pv[2]);
      parent.add(g);
      groups[name] = g;
    }
    for (const b of this.buckets.values()) {
      const merged = b.geos.length === 1 ? (b.geos[0] as THREE.BufferGeometry) : mergeGeometries(b.geos, false);
      if (b.geos.length > 1) for (const g of b.geos) g.dispose();
      if (!merged) continue;
      const pv = this.pivots.get(b.group);
      if (pv) merged.translate(-pv[0], -pv[1], -pv[2]);
      const mesh = new THREE.Mesh(merged, materials.get(b.mat));
      mesh.frustumCulled = false;
      mesh.userData.matKey = b.mat;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      (groups[b.group] as THREE.Group).add(mesh);
      geometries.push(merged);
    }
    this.buckets.clear();
    return groups;
  }
}
