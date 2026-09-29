/**
 * Carga y personalización de los modelos GLB semirrealistas (public/models/characters).
 *
 *  - `loadGlbAsset`: descarga + parseo con GLTFLoader (import dinámico: no entra en el bundle inicial).
 *  - `instantiateGlb`: clona el esqueleto/mallas del asset (geometrías y texturas compartidas), clona UNA vez
 *    cada material tintable y expone `applyLook` (sólo visibilidad + colores: no reconstruye nada).
 *  - `GlbLibrary`: caché por género con política de memoria (release/releaseAll) y fallos silenciosos.
 * Las reglas de qué se ve y de qué color están en glbRules.ts (puras y testeadas).
 */
import * as THREE from 'three';
import { CHARACTER } from '../config';
import type { CharacterPose } from '../core/context';
import type { Gender } from '../core/types';
import type { ResolvedLook } from '../rules/character';
import { createGlbAnimator } from './glbPose';
import { glbUrl, isPieceVisible, isTintRole, materialRole, parsePieceName, resolveTints } from './glbRules';
import type { PieceName, TintRole } from './glbRules';

/** Altura de referencia (m) para escalar ambos géneros con el mismo factor (GLB masculino sin pelo, con botas ≈ 1,83–1,87). */
export const GLB_REF_HEIGHT = 1.87;

export interface GlbAsset {
  readonly gender: Gender;
  /** true = variante ligera (`*_low.glb`). */
  readonly low: boolean;
  readonly scene: THREE.Group;
  /** Tiempo de descarga + parseo (ms). */
  readonly loadMs: number;
  /** Bytes descargados del GLB (Resource Timing; 0 si no está disponible). */
  readonly downloadBytes: number;
  /** Memoria estimada de texturas en GPU (bytes, con mipmaps). */
  readonly textureBytes: number;
  readonly clone: (o: THREE.Object3D) => THREE.Object3D;
  dispose(): void;
}

export interface GlbLoadOptions {
  anisotropy: number;
  /** Usa la variante ligera (móviles / calidad baja). */
  low?: boolean;
}

interface Part {
  mesh: THREE.Mesh;
  piece: PieceName | null;
  tris: number;
}

export interface GlbInstanceStats {
  visibleMeshes: number;
  triangles: number;
  totalMeshes: number;
}

export interface GlbInstance {
  readonly gender: Gender;
  readonly root: THREE.Group;
  /** Altura del cuerpo con botas (m), sin pelo ni accesorios (estable entre apariencias). */
  readonly height: number;
  readonly stats: GlbInstanceStats;
  /** Materiales tintables clonados (por rol). */
  readonly tintMaterials: ReadonlyMap<TintRole, THREE.MeshStandardMaterial>;
  applyLook(look: ResolvedLook): void;
  setPose(pose: CharacterPose, instant?: boolean): void;
  update(dt: number): void;
  dispose(): void;
}

const triCount = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0)) / 3;

function textureBytes(tex: THREE.Texture): number {
  const img = tex.image as { width?: number; height?: number } | null | undefined;
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  return Math.round(w * h * 4 * (tex.generateMipmaps ? 1.34 : 1));
}

/** Descarga y parsea el GLB del género. Lanza si falla (GlbLibrary lo captura). */
export async function loadGlbAsset(gender: Gender, opts: GlbLoadOptions): Promise<GlbAsset> {
  const [{ GLTFLoader }, { clone }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/utils/SkeletonUtils.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ]);
  const t0 = performance.now();
  const low = opts.low === true;
  const url = glbUrl(import.meta.env.BASE_URL, (low ? CHARACTER.glb.lowFiles : CHARACTER.glb.files)[gender]);
  // Los GLB llevan geometría meshopt + cuantizada y texturas WebP (ver tools/optimize-characters.mjs).
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  const scene = gltf.scene;
  const textures = new Set<THREE.Texture>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.frustumCulled = false;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      for (const v of Object.values(mat)) {
        if (v && (v as THREE.Texture).isTexture) textures.add(v as THREE.Texture);
      }
    }
  });
  let bytes = 0;
  for (const t of textures) {
    t.anisotropy = Math.max(1, opts.anisotropy);
    bytes += textureBytes(t);
  }
  const loadMs = performance.now() - t0;
  let downloadBytes = 0;
  try {
    const e = performance.getEntriesByName(new URL(url, window.location.href).href).pop() as PerformanceResourceTiming | undefined;
    downloadBytes = e ? e.encodedBodySize || e.transferSize || 0 : 0;
  } catch {
    /* Resource Timing no disponible */
  }
  return {
    gender,
    low,
    scene,
    loadMs,
    downloadBytes,
    textureBytes: bytes,
    clone,
    dispose() {
      const mats = new Set<THREE.Material>();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mat);
      });
      for (const mat of mats) mat.dispose();
      for (const t of textures) t.dispose();
    },
  };
}

/** Crea una instancia personalizable del asset (comparte geometría y texturas; clona esqueleto y materiales tintables). */
export function instantiateGlb(asset: GlbAsset): GlbInstance {
  const root = asset.clone(asset.scene) as THREE.Group;
  const parts: Part[] = [];
  const skinned: THREE.SkinnedMesh[] = [];
  const tint = new Map<TintRole, THREE.MeshStandardMaterial>();

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(mesh as THREE.SkinnedMesh);
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const role = materialRole(mat.name);
    if (isTintRole(role)) {
      let c = tint.get(role);
      if (!c) {
        c = mat.clone();
        tint.set(role, c);
      }
      mesh.material = c;
    }
    // La pieza se identifica por el nombre de la malla (o, si three añadió un sufijo, por el del nodo padre).
    const piece = parsePieceName(mesh.name) ?? (mesh.parent ? parsePieceName(mesh.parent.name) : null);
    parts.push({ mesh, piece, tris: triCount(mesh.geometry) });
  });

  // Ojo: cada malla lleva su propio Skeleton (matrices inversas propias por la cuantización del GLB optimizado);
  // los HUESOS son nodos compartidos del árbol, así que las poses se aplican por nombre sobre el árbol (glbPose).
  void skinned;

  // Altura estable: cuerpo + prendas base (botas), sin pelo ni accesorios.
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  root.updateMatrixWorld(true);
  for (const p of parts) {
    if (p.piece && (p.piece.slot === 'Body' || (p.piece.slot === 'Outfit' && p.piece.item === 'Base'))) box.union(tmp.setFromObject(p.mesh));
  }
  const height = Math.max(0.5, box.max.y - Math.min(0, box.min.y));
  const stats: GlbInstanceStats = { visibleMeshes: 0, triangles: 0, totalMeshes: parts.length };
  const anim = createGlbAnimator(root, height);
  anim?.setPose('idle', true);

  return {
    gender: asset.gender,
    root,
    height,
    stats,
    tintMaterials: tint,
    applyLook(look) {
      let vis = 0;
      let tris = 0;
      for (const p of parts) {
        const v = p.piece ? isPieceVisible(p.piece, look) : true;
        p.mesh.visible = v;
        if (v) {
          vis++;
          tris += p.tris;
        }
      }
      stats.visibleMeshes = vis;
      stats.triangles = Math.round(tris);
      const colors = resolveTints(look);
      for (const [role, mat] of tint) mat.color.setHex(colors[role]);
    },
    setPose: (pose, instant = false) => anim?.setPose(pose, instant),
    update: (dt) => anim?.update(dt),
    dispose() {
      root.removeFromParent();
      for (const m of tint.values()) m.dispose();
      for (const m of skinned) m.skeleton.dispose();
      tint.clear();
      parts.length = 0;
    },
  };
}

/** Caché por género con política de memoria; los fallos son silenciosos (el llamador usa el maniquí procedural). */
export class GlbLibrary {
  private readonly assets = new Map<Gender, GlbAsset>();
  private readonly pending = new Map<Gender, Promise<GlbAsset | null>>();
  private readonly generation: Record<Gender, number> = { male: 0, female: 0 };
  private readonly failed = new Set<Gender>();

  constructor(private readonly options: () => GlbLoadOptions) {}

  get(g: Gender): GlbAsset | null {
    return this.assets.get(g) ?? null;
  }

  hasFailed(g: Gender): boolean {
    return this.failed.has(g);
  }

  isLoading(g: Gender): boolean {
    return this.pending.has(g);
  }

  /** Vuelve a permitir la carga de un género que había fallado. */
  resetFailures(): void {
    this.failed.clear();
  }

  load(g: Gender): Promise<GlbAsset | null> {
    const have = this.assets.get(g);
    if (have) return Promise.resolve(have);
    const inflight = this.pending.get(g);
    if (inflight) return inflight;
    if (this.failed.has(g)) return Promise.resolve(null);
    const gen = this.generation[g];
    const p: Promise<GlbAsset | null> = loadGlbAsset(g, this.options()).then(
      (asset) => {
        if (this.pending.get(g) === p) this.pending.delete(g);
        if (this.generation[g] !== gen) {
          asset.dispose(); // se liberó mientras descargaba
          return null;
        }
        this.assets.set(g, asset);
        return asset;
      },
      () => {
        if (this.pending.get(g) === p) this.pending.delete(g);
        if (this.generation[g] === gen) this.failed.add(g);
        return null;
      },
    );
    this.pending.set(g, p);
    return p;
  }

  release(g: Gender): void {
    this.generation[g]++;
    this.pending.delete(g);
    const a = this.assets.get(g);
    if (a) {
      a.dispose();
      this.assets.delete(g);
    }
  }

  releaseAll(): void {
    this.release('male');
    this.release('female');
  }
}
