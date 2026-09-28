import * as THREE from 'three';
import type { MaterialsApi } from '../core/context';
import type { MaterialKey } from '../core/types';

/**
 * BASE PROVISIONAL (colores planos). El agente de motor/render lo sustituye por
 * texturas procedurales manteniendo la API: get(key) y tile(key).
 */
const COLORS: Record<MaterialKey, number> = {
  asphalt: 0x2a2d33, asphaltWorn: 0x34373d, roadLine: 0xc9c27a, concrete: 0x777c84, concreteDark: 0x50555c, concreteStained: 0x62676d,
  dirt: 0x4a3f33, gravel: 0x5a5a58, tile: 0x8a9096, brick: 0x6b3f34, plaster: 0x9a968c, metalPanel: 0x59626c, corrugated: 0x6a7480,
  rustMetal: 0x74432c, steelDark: 0x2c3138, labWall: 0xc8d2da, labFloor: 0x9fb0bb, glass: 0x5a86a0, wood: 0x6b4b2e, fence: 0x3b4148,
  hazard: 0xd9b400, pipe: 0x4b545e, rubber: 0x141414, containerRed: 0x8e2b25, containerBlue: 0x23509a, containerGreen: 0x2f6b3f,
  containerYellow: 0xb8931f, containerGrey: 0x606870, emissiveRed: 0xff2a2a, emissiveBlue: 0x3f8cff, emissiveAmber: 0xffb020,
  emissiveGreen: 0x3dff9c, emissiveWhite: 0xffffff, toxic: 0x7dff3a, gunMetal: 0x2b2f35, gunPolymer: 0x1c1f23, gunWood: 0x5b3d24,
  brass: 0xb08d3a, skinPale: 0xa9b3a0, skinGrey: 0x8a9488, skinGreen: 0x7d9a70, clothDark: 0x23272e, clothOlive: 0x3a4230,
  clothRag: 0x4b463d, bone: 0xd8d2bd, blood: 0x6a0d0d, armorPlate: 0x3d4650, wardenArmor: 0x2f363f, wardenHelmet: 0x556270,
  helicopterBody: 0x3a4a3d,
};

const EMISSIVE = new Set<MaterialKey>(['emissiveRed', 'emissiveBlue', 'emissiveAmber', 'emissiveGreen', 'emissiveWhite', 'toxic']);

export function createMaterials(): MaterialsApi {
  const cache = new Map<MaterialKey, THREE.Material>();
  return {
    get(key) {
      let m = cache.get(key);
      if (!m) {
        const emissive = EMISSIVE.has(key);
        m = new THREE.MeshStandardMaterial({
          color: COLORS[key],
          roughness: 0.85,
          metalness: key.startsWith('gun') || key === 'metalPanel' ? 0.6 : 0.05,
          emissive: emissive ? COLORS[key] : 0x000000,
          emissiveIntensity: emissive ? 1.6 : 0,
          transparent: key === 'glass',
          opacity: key === 'glass' ? 0.5 : 1,
        });
        m.name = key;
        cache.set(key, m);
      }
      return m;
    },
    tile: () => 4,
  };
}
