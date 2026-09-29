/**
 * Maniquí procedural del operativo: humanoide low-poly de cuerpo entero con esqueleto (SkinnedMesh por
 * material, geometría fusionada), reflejando todas las opciones de ResolvedLook (piel, pelo, ropa,
 * accesorio) y con poses/animación procedural. Sin assets.
 */
import * as THREE from 'three';
import type { CharacterPose } from '../core/context';
import type { ResolvedLook } from '../rules/character';
import { buildAccessory } from './accessories';
import { buildBody, makeBody, rigLayout } from './body';
import type { BodySpec } from './body';
import type { BuildCtx, Role } from './build';
import { buildFace } from './face';
import { Kit, mixHex } from './geo';
import { buildHair } from './hair';
import { buildOutfit } from './outfit';
import { outfitSpec } from './outfitSpec';
import type { OutfitSpec } from './outfitSpec';
import { createAnimator } from './pose';
import { buildRig, makeSkins } from './rig';

export interface CharacterModelStats {
  meshes: number;
  triangles: number;
  vertices: number;
  bones: number;
  materials: number;
  /** Tiempo de construcción (ms). */
  buildMs: number;
}

export interface CharacterModel {
  /** Raíz del modelo: pies en y=0, mira a +Z (de frente a la cámara con yaw 0). */
  readonly root: THREE.Group;
  /** Altura nominal del cuerpo hasta la coronilla (m). */
  readonly height: number;
  readonly look: ResolvedLook;
  readonly body: BodySpec;
  readonly meshes: readonly THREE.SkinnedMesh[];
  readonly materials: readonly THREE.MeshStandardMaterial[];
  readonly stats: CharacterModelStats;
  /** Caja de reposo (m) que envuelve todo el modelo (incluye pelo y accesorios). */
  readonly bounds: THREE.Box3;
  /** Cambia de pose; con `instant` salta directamente (sin transición). */
  setPose(pose: CharacterPose, instant?: boolean): void;
  update(dt: number): void;
  /** Libera geometrías, materiales y esqueleto. */
  dispose(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Materiales (cacheados por parámetros dentro del modelo: los colores son dinámicos)
// ─────────────────────────────────────────────────────────────────────────────
interface MatParams {
  color: number;
  roughness: number;
  metalness?: number;
  emissive?: number;
  emissiveIntensity?: number;
}

const DARK = 0x1a1816;
const WHITE = 0xebe7de;

/** Aporte emisivo (fracción del color propio): rellena las sombras de la iluminación fija sin añadir luces. */
const FILL = 0.07;

function roleParams(role: Role, look: ResolvedLook, outfit: OutfitSpec): MatParams {
  const p = baseParams(role, look, outfit);
  if (p.emissive === undefined && role !== 'metal') return { ...p, emissive: p.color, emissiveIntensity: FILL };
  return p;
}

function baseParams(role: Role, look: ResolvedLook, outfit: OutfitSpec): MatParams {
  switch (role) {
    case 'skin': return { color: look.skin, roughness: 0.62 };
    case 'lips': return { color: mixHex(look.skin, 0x8a2f34, 0.42), roughness: 0.45 };
    case 'hair': return { color: look.hair, roughness: 0.48 };
    case 'jacket': return { color: look.jacket, roughness: 0.88 };
    case 'pants': return { color: look.pants, roughness: 0.9 };
    case 'accent':
      return outfit.glow
        ? { color: mixHex(look.accent, 0x000000, 0.25), roughness: 0.5, emissive: look.accent, emissiveIntensity: 1.1 }
        : { color: look.accent, roughness: 0.62 };
    case 'glove': return { color: look.glove, roughness: 0.72 };
    case 'dark': return { color: DARK, roughness: 0.7 };
    case 'white': return { color: WHITE, roughness: 0.42 };
    case 'metal': return { color: 0xb9bec6, roughness: 0.4, metalness: 0.5 };
    case 'lens': return { color: 0x0c1a22, roughness: 0.15, emissive: 0x5fe3ff, emissiveIntensity: 1.35 };
  }
}

class MaterialSet {
  private readonly cache = new Map<string, THREE.MeshStandardMaterial>();

  constructor(private readonly look: ResolvedLook, private readonly outfit: OutfitSpec) {}

  get(role: Role): THREE.MeshStandardMaterial {
    const p = roleParams(role, this.look, this.outfit);
    const key = `${p.color}|${p.roughness}|${p.metalness ?? 0}|${p.emissive ?? 0}|${p.emissiveIntensity ?? 0}`;
    let m = this.cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: p.color, roughness: p.roughness, metalness: p.metalness ?? 0,
        ...(p.emissive !== undefined ? { emissive: p.emissive, emissiveIntensity: p.emissiveIntensity ?? 1 } : {}),
      });
      m.name = role;
      this.cache.set(key, m);
    }
    return m;
  }

  get list(): THREE.MeshStandardMaterial[] {
    return [...this.cache.values()];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Construcción
// ─────────────────────────────────────────────────────────────────────────────
/** Fracción de la altura de la cabeza a la que nace la coleta según el gorro (el gorro la deja salir por debajo). */
const tailU = (look: ResolvedLook): number => (look.accessory === 'beanie' ? 0.5 : look.accessory === 'cap' ? 0.6 : 0.7);

export function buildCharacterModel(look: ResolvedLook): CharacterModel {
  const t0 = performance.now();
  const body = makeBody(look.gender, tailU(look));
  const rig = buildRig(rigLayout(body));
  const skins = makeSkins(rig.index, body);
  const outfit = outfitSpec(look.outfit);
  const mats = new MaterialSet(look, outfit);
  const kit = new Kit<Role>((r) => mats.get(r), (n) => rig.index[n]);
  const ctx: BuildCtx = { look, body, kit, skins, index: rig.index, outfit };

  buildBody(ctx);
  buildFace(ctx);
  const info = buildOutfit(ctx);
  const hairClear = buildHair(ctx, info);
  buildAccessory(ctx, info, hairClear);

  const parts = kit.finish();
  const identity = new THREE.Matrix4();
  const meshes: THREE.SkinnedMesh[] = [];
  const bounds = new THREE.Box3();
  let triangles = 0;
  let vertices = 0;
  for (const part of parts) {
    const mesh = new THREE.SkinnedMesh(part.geometry, part.material);
    mesh.name = (part.material as THREE.Material).name;
    mesh.frustumCulled = false;
    rig.root.add(mesh);
    mesh.bind(rig.skeleton, identity);
    meshes.push(mesh);
    triangles += part.triangles;
    vertices += part.geometry.getAttribute('position').count;
    bounds.union(part.geometry.boundingBox!);
  }

  const anim = createAnimator(rig, body);
  anim.setPose('idle', true);
  rig.root.updateMatrixWorld(true);

  const materials = mats.list;
  const stats: CharacterModelStats = {
    meshes: meshes.length, triangles, vertices, bones: rig.bones.length, materials: materials.length,
    buildMs: performance.now() - t0,
  };

  return {
    root: rig.root,
    height: body.height,
    look,
    body,
    meshes,
    materials,
    stats,
    bounds,
    setPose: (pose, instant = false) => anim.setPose(pose, instant),
    update: (dt) => anim.update(dt),
    dispose() {
      rig.root.removeFromParent();
      for (const m of meshes) m.geometry.dispose();
      for (const m of materials) m.dispose();
      rig.skeleton.dispose();
    },
  };
}
