import * as THREE from 'three';
import type { MaterialsApi } from '../core/context';
import type { MaterialKey } from '../core/types';
import { RECIPES, bake, flipRows, heightToNormal, packOrm } from './textures';

export interface MaterialsConfig {
  /** Texturas baratas: 128 px, sin mapas de normales ni de rugosidad. */
  lowTextures: boolean;
  anisotropy: number;
  /** Con MSAA disponible la valla usa alpha-to-coverage (velo a distancia) en vez de alphaTest duro. */
  alphaToCoverage: boolean;
}

export interface Materials extends MaterialsApi {
  configure(cfg: Partial<MaterialsConfig>): void;
  /** Tiempo acumulado (ms) generando texturas. */
  readonly generationMs: number;
  dispose(): void;
}

interface Entry {
  material: THREE.MeshStandardMaterial;
  textures: THREE.Texture[];
}

/**
 * Materiales compartidos con texturas procedurales generadas de forma PEREZOSA por clave.
 * `get(key)` devuelve siempre el mismo material (no clonar); al cambiar de calidad se
 * regeneran sus texturas in-place para que las referencias existentes sigan siendo válidas.
 */
export function createMaterials(): Materials {
  const cache = new Map<MaterialKey, Entry>();
  const cfg: MaterialsConfig = { lowTextures: false, anisotropy: 4, alphaToCoverage: true };
  let ms = 0;

  const dataTex = (data: Uint8Array, size: number, srgb: boolean, aniso: boolean): THREE.DataTexture => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = aniso ? cfg.anisotropy : 1;
    t.needsUpdate = true;
    return t;
  };

  const build = (key: MaterialKey, e: Entry): void => {
    const t0 = performance.now();
    const r = RECIPES[key];
    const low = cfg.lowTextures;
    const size = low ? Math.min(128, r.size ?? 128) : (r.size ?? 128);
    for (const t of e.textures) t.dispose();
    e.textures = [];
    const surf = bake(r, size, !low);
    const m = e.material;
    const map = dataTex(flipRows(surf.albedo, size), size, true, true);
    e.textures.push(map);
    m.color.set(r.tint ?? 0xffffff);
    if (r.emissive) {
      m.emissive.set(r.emissive.color);
      m.emissiveIntensity = r.emissive.intensity;
      m.emissiveMap = map;
      m.map = null;
    } else {
      m.map = map;
    }
    m.normalMap = null;
    m.roughnessMap = null;
    m.metalnessMap = null;
    if (surf.height && r.normal) {
      const n = dataTex(heightToNormal(surf.height, size, r.normal), size, false, true);
      e.textures.push(n);
      m.normalMap = n;
      m.normalScale.set(1, 1);
    }
    if (surf.rough) {
      const orm = packOrm(surf.rough, surf.metal, size);
      const t = dataTex(orm.data, orm.size, false, false);
      e.textures.push(t);
      m.roughnessMap = t;
      m.roughness = 1;
      if (surf.metal) {
        m.metalnessMap = t;
        m.metalness = 1;
      } else {
        m.metalness = 0;
      }
    } else {
      m.roughness = r.ro;
      m.metalness = r.me;
    }
    if (r.alpha === 'blend') {
      m.transparent = true;
      m.depthWrite = false;
    } else if (r.alpha === 'test') {
      m.side = THREE.DoubleSide;
    }
    applyAlpha(m, r.alpha);
    m.needsUpdate = true;
    ms += performance.now() - t0;
  };

  const applyAlpha = (m: THREE.MeshStandardMaterial, mode: 'blend' | 'test' | undefined): void => {
    if (mode !== 'test') return;
    if (cfg.alphaToCoverage) {
      m.alphaToCoverage = true;
      m.alphaTest = 0;
    } else {
      m.alphaToCoverage = false;
      m.alphaTest = 0.4;
    }
  };

  return {
    get(key) {
      let e = cache.get(key);
      if (!e) {
        const m = new THREE.MeshStandardMaterial();
        m.name = key;
        e = { material: m, textures: [] };
        cache.set(key, e);
        build(key, e);
      }
      return e.material;
    },
    tile: (key) => RECIPES[key].tile,
    configure(next) {
      const rebuild = (next.lowTextures !== undefined && next.lowTextures !== cfg.lowTextures)
        || (next.anisotropy !== undefined && next.anisotropy !== cfg.anisotropy);
      const alphaChanged = next.alphaToCoverage !== undefined && next.alphaToCoverage !== cfg.alphaToCoverage;
      Object.assign(cfg, next);
      if (rebuild) for (const [k, e] of cache) build(k, e);
      else if (alphaChanged) {
        for (const [k, e] of cache) {
          applyAlpha(e.material, RECIPES[k].alpha);
          e.material.needsUpdate = true;
        }
      }
    },
    get generationMs() {
      return ms;
    },
    dispose() {
      for (const e of cache.values()) {
        for (const t of e.textures) t.dispose();
        e.material.dispose();
      }
      cache.clear();
    },
  };
}
