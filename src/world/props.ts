/**
 * Props repetidos como InstancedMesh: cada modelo son una o varias partes (geometría + material de
 * `ctx.materials`); las instancias se agrupan por (tipo, parte, material según variante).
 */
import * as THREE from 'three';
import type { MaterialsApi } from '../core/context';
import type { MaterialKey } from '../core/types';
import { createRng } from '../core/util';
import { Batch, emitBeam, emitBox, emitCyl, emitPrism } from './builders';
import type { PropInstance, PropType } from './types';
import { PROP_SPECS } from './types';

interface Part {
  batch: Batch;
  /** Material por variante (módulo). */
  mats: MaterialKey[];
}

const CONTAINER_MATS: MaterialKey[] = ['containerRed', 'containerBlue', 'containerGreen', 'containerYellow', 'containerGrey'];
const CAR_MATS: MaterialKey[] = ['containerGrey', 'rustMetal', 'containerBlue', 'containerRed', 'containerGreen', 'steelDark'];

/** Caja alineada con base en y0 centrada en (x,z). */
function bx(b: Batch, x: number, z: number, sx: number, sz: number, y0: number, y1: number, tile: number, top = true, rot = 0): void {
  emitBox(b, { cx: x, cz: z, sx, sz, y0, y1, rot, top }, tile);
}

function buildModel(type: PropType, tile: (m: MaterialKey) => number): Part[] {
  const t = tile('metalPanel');
  const P = (mats: MaterialKey[]): Part => ({ batch: new Batch(), mats });
  const spec = PROP_SPECS[type];
  switch (type) {
    case 'barrel': {
      const a = P(['rustMetal', 'containerBlue', 'containerRed', 'containerYellow', 'steelDark']);
      emitCyl(a.batch, { cx: 0, cz: 0, r: 0.3, rTop: 0.3, y0: 0, y1: 0.95, seg: 12, capTop: true }, t);
      for (const y of [0.15, 0.8]) emitCyl(a.batch, { cx: 0, cz: 0, r: 0.315, rTop: 0.315, y0: y, y1: y + 0.07, seg: 12, capTop: false }, t);
      return [a];
    }
    case 'barrelToxic': {
      const a = P(['hazard']);
      emitCyl(a.batch, { cx: 0, cz: 0, r: 0.3, rTop: 0.3, y0: 0, y1: 0.95, seg: 12, capTop: true }, t);
      const b = P(['toxic']);
      emitCyl(b.batch, { cx: 0, cz: 0, r: 0.31, rTop: 0.31, y0: 0.6, y1: 0.72, seg: 12, capTop: false }, t);
      return [a, b];
    }
    case 'crate':
    case 'crateMetal': {
      const a = P(type === 'crate' ? ['wood', 'wood', 'plaster'] : ['metalPanel', 'containerGrey', 'containerGreen']);
      bx(a.batch, 0, 0, 1, 1, 0, 1, tile('wood'));
      for (const [sx, sz] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as const) bx(a.batch, sx, sz, 0.1, 0.1, 0, 1.01, tile('wood'));
      return [a];
    }
    case 'pallet': {
      const a = P(['wood']);
      for (const z of [-0.4, 0, 0.4]) bx(a.batch, 0, z, 1.2, 0.14, 0.08, 0.16, tile('wood'));
      for (const x of [-0.5, 0, 0.5]) bx(a.batch, x, 0, 0.14, 1, 0, 0.08, tile('wood'));
      return [a];
    }
    case 'cartons': {
      const a = P(['plaster', 'wood', 'concreteStained']);
      bx(a.batch, 0, 0, 1.2, 1.0, 0.15, 1.3, tile('plaster'));
      return [a];
    }
    case 'lamp': {
      const a = P(['steelDark']);
      emitCyl(a.batch, { cx: 0, cz: 0, r: 0.12, rTop: 0.08, y0: 0, y1: 7, seg: 8, capTop: true }, t);
      emitBeam(a.batch, { t: 'beam', ax: 0, ay: 6.95, az: 0, bx: 1.2, by: 6.95, bz: 0, w: 0.09, round: false, mat: 'steelDark', cast: false }, t);
      bx(a.batch, 1.15, 0, 0.9, 0.35, 6.98, 7.1, t);
      const b = P(['emissiveAmber']);
      bx(b.batch, 1.15, 0, 0.7, 0.25, 6.86, 6.98, t);
      return [a, b];
    }
    case 'jersey': {
      const a = P(['concrete', 'concreteStained']);
      bx(a.batch, 0, 0, 3, 0.6, 0, 0.3, tile('concrete'));
      bx(a.batch, 0, 0, 3, 0.36, 0.3, 0.8, tile('concrete'));
      return [a];
    }
    case 'sandbag': {
      const a = P(['plaster', 'dirt', 'gravel']);
      bx(a.batch, 0, 0, 1.8, 0.75, 0, 0.38, tile('plaster'));
      bx(a.batch, 0, 0, 1.6, 0.55, 0.38, 0.75, tile('plaster'));
      return [a];
    }
    case 'dumpster': {
      const a = P(['containerGreen', 'containerBlue', 'rustMetal']);
      bx(a.batch, 0, 0, 2.2, 1.3, 0.25, 1.2, tile('containerGreen'));
      bx(a.batch, 0, 0, 2.3, 1.4, 1.2, 1.35, tile('containerGreen'));
      const w = P(['rubber']);
      for (const x of [-0.9, 0.9]) bx(w.batch, x, 0, 0.25, 1.1, 0, 0.25, t);
      return [a, w];
    }
    case 'car': {
      const a = P(CAR_MATS);
      bx(a.batch, 0, 0, 4.3, 1.8, 0.3, 0.95, tile('containerGrey'));
      bx(a.batch, -0.2, 0, 2.3, 1.6, 0.95, 1.45, tile('containerGrey'));
      const g = P(['glass']);
      bx(g.batch, -0.2, 0, 2.32, 1.62, 1.02, 1.38, t);
      const w = P(['rubber']);
      for (const x of [-1.4, 1.4]) for (const z of [-0.85, 0.85]) bx(w.batch, x, z, 0.7, 0.28, 0, 0.7, t);
      return [a, g, w];
    }
    case 'truck': {
      const a = P(['corrugated', 'containerGrey', 'containerBlue', 'containerRed']);
      bx(a.batch, -1.2, 0, 6.0, 2.5, 0.7, 3.3, tile('corrugated'));
      const c = P(CAR_MATS);
      bx(c.batch, 3.4, 0, 2.0, 2.4, 0.7, 2.2, tile('containerGrey'));
      bx(c.batch, 3.9, 0, 1.0, 2.4, 0.7, 1.4, tile('containerGrey'));
      const g = P(['glass']);
      bx(g.batch, 3.5, 0, 2.02, 2.42, 1.5, 2.1, t);
      const w = P(['rubber']);
      for (const x of [-3.2, -1.8, 3.4]) for (const z of [-1.1, 1.1]) bx(w.batch, x, z, 1.0, 0.4, 0, 1.0, t);
      return [a, c, g, w];
    }
    case 'shelf': {
      const f = P(['steelDark']);
      for (const x of [-1.5, 1.5]) for (const z of [-0.42, 0.42]) bx(f.batch, x, z, 0.08, 0.08, 0, 3, t);
      const s = P(['metalPanel', 'rustMetal', 'containerGrey']);
      for (const y of [0.25, 1.1, 1.95, 2.8]) bx(s.batch, 0, 0, 3, 0.9, y, y + 0.05, t);
      const c = P(['wood', 'plaster', 'concreteStained']);
      const rng = createRng(7);
      for (const y of [0.3, 1.15, 2.0]) for (let x = -1.3; x < 1.3; x += 0.75) if (rng() > 0.25) bx(c.batch, x, 0, 0.6, 0.7, y, y + 0.35 + rng() * 0.25, t);
      return [f, s, c];
    }
    case 'acUnit': {
      const a = P(['metalPanel', 'containerGrey']);
      bx(a.batch, 0, 0, 1.8, 1.2, 0, 1.0, t);
      emitCyl(a.batch, { cx: 0, cz: 0, r: 0.45, rTop: 0.45, y0: 1.0, y1: 1.1, seg: 10, capTop: true }, t);
      return [a];
    }
    case 'tires': {
      const a = P(['rubber']);
      for (let i = 0; i < 3; i++) emitCyl(a.batch, { cx: 0, cz: 0, r: 0.45, rTop: 0.45, y0: i * 0.33, y1: i * 0.33 + 0.3, seg: 10, capTop: true }, t);
      return [a];
    }
    case 'reel': {
      const a = P(['wood']);
      emitCyl(a.batch, { cx: 0, cz: 0, r: 0.8, rTop: 0.8, y0: 0, y1: 0.15, seg: 14, capTop: true }, t);
      emitCyl(a.batch, { cx: 0, cz: 0, r: 0.8, rTop: 0.8, y0: 0.95, y1: 1.1, seg: 14, capTop: true }, t);
      const c = P(['rubber']);
      emitCyl(c.batch, { cx: 0, cz: 0, r: 0.5, rTop: 0.5, y0: 0.15, y1: 0.95, seg: 12, capTop: false }, t);
      return [a, c];
    }
    case 'cone': {
      const a = P(['hazard']);
      emitCyl(a.batch, { cx: 0, cz: 0, r: 0.2, rTop: 0.04, y0: 0, y1: 0.65, seg: 8, capTop: true }, t);
      bx(a.batch, 0, 0, 0.42, 0.42, 0, 0.04, t);
      return [a];
    }
    case 'container20':
    case 'container40': {
      const L = spec.box?.w ?? 6.06;
      const a = P(CONTAINER_MATS);
      const tl = tile('containerRed');
      bx(a.batch, 0, 0, L, 2.44, 0, 2.59, tl);
      for (const x of [-L / 2 + 0.1, L / 2 - 0.1]) for (const z of [-1.2, 1.2]) bx(a.batch, x, z, 0.2, 0.08, 0, 2.6, tl, false);
      for (let x = -L / 2 + 1.5; x < L / 2 - 1; x += 1.5) bx(a.batch, x, -1.23, 0.1, 0.05, 0.1, 2.5, tl, false);
      const d = P(['steelDark']);
      bx(d.batch, L / 2 + 0.01, 0, 0.04, 2.0, 0.15, 2.4, t, false);
      return [a, d];
    }
    case 'benchLab': {
      const a = P(['labWall', 'metalPanel']);
      bx(a.batch, 0, 0, 2.4, 0.9, 0.8, 0.9, tile('labWall'));
      const l = P(['steelDark']);
      for (const x of [-1.1, 1.1]) for (const z of [-0.38, 0.38]) bx(l.batch, x, z, 0.08, 0.08, 0, 0.8, t);
      const e = P(['emissiveBlue', 'emissiveGreen']);
      bx(e.batch, -0.5, 0, 0.5, 0.3, 0.9, 1.0, t);
      return [a, l, e];
    }
    case 'generator': {
      const a = P(['containerGreen', 'containerYellow']);
      bx(a.batch, 0, 0, 1.9, 1.0, 0.15, 1.2, tile('containerGreen'));
      const b = P(['steelDark']);
      emitCyl(b.batch, { cx: 0.7, cz: 0, r: 0.08, rTop: 0.08, y0: 1.2, y1: 1.6, seg: 6, capTop: true }, t);
      bx(b.batch, 0, 0, 2.0, 1.1, 0, 0.15, t);
      return [a, b];
    }
    case 'tent': {
      const a = P(['clothOlive', 'clothRag', 'clothDark']);
      bx(a.batch, 0, 0, 5, 4, 0, 1.0, tile('clothOlive'), false);
      emitPrism(a.batch, { t: 'prism', cx: 0, cz: 0, sx: 5, sz: 4, y0: 1.0, h: 1.6, rot: 0, ridgeZ: false, mat: 'clothOlive', cast: false }, tile('clothOlive'));
      return [a];
    }
    case 'bollard': {
      const a = P(['concrete']);
      emitCyl(a.batch, { cx: 0, cz: 0, r: 0.14, rTop: 0.14, y0: 0, y1: 0.9, seg: 8, capTop: true }, t);
      return [a];
    }
  }
}

export interface PropsBuild {
  meshes: THREE.InstancedMesh[];
  triangles: number;
  dispose(): void;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);

export function buildProps(props: readonly PropInstance[], materials: MaterialsApi, group: THREE.Group): PropsBuild {
  const models = new Map<PropType, Part[]>();
  const geos: THREE.BufferGeometry[] = [];
  const groups = new Map<string, { type: PropType; part: number; mat: MaterialKey; items: PropInstance[] }>();
  for (const p of props) {
    let model = models.get(p.type);
    if (!model) {
      model = buildModel(p.type, (m) => materials.tile(m));
      models.set(p.type, model);
    }
    for (let i = 0; i < model.length; i++) {
      const part = model[i] as Part;
      const mat = part.mats[p.variant % part.mats.length] as MaterialKey;
      const key = `${p.type}|${i}|${mat}`;
      let g = groups.get(key);
      if (!g) {
        g = { type: p.type, part: i, mat, items: [] };
        groups.set(key, g);
      }
      g.items.push(p);
    }
  }
  const partGeo = new Map<Part, THREE.BufferGeometry>();
  const meshes: THREE.InstancedMesh[] = [];
  let triangles = 0;
  const rng = createRng(4242);
  for (const g of groups.values()) {
    const part = (models.get(g.type) as Part[])[g.part] as Part;
    let geo = partGeo.get(part);
    if (!geo) {
      geo = part.batch.toGeometry();
      partGeo.set(part, geo);
      geos.push(geo);
    }
    const mesh = new THREE.InstancedMesh(geo, materials.get(g.mat), g.items.length);
    const cyl = !!PROP_SPECS[g.type].cyl;
    for (let i = 0; i < g.items.length; i++) {
      const it = g.items[i] as PropInstance;
      _q.setFromAxisAngle(_up, it.rot);
      _p.set(it.x, it.y, it.z);
      _s.set(it.sx, it.sy, cyl ? it.sx : it.sz);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
      const v = 0.78 + rng() * 0.22;
      mesh.setColorAt(i, _c.setRGB(v, v, v));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = PROP_SPECS[g.type].cast;
    mesh.receiveShadow = true;
    mesh.name = `props:${g.type}`;
    mesh.computeBoundingSphere();
    group.add(mesh);
    meshes.push(mesh);
    triangles += (part.batch.triangles) * g.items.length;
  }
  return {
    meshes,
    triangles,
    dispose() {
      for (const m of meshes) m.dispose();
      for (const g of geos) g.dispose();
    },
  };
}
