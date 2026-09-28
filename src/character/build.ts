/** Tipos compartidos por los constructores de geometría del maniquí (cuerpo, cara, pelo, ropa, accesorios). */
import type { ResolvedLook } from '../rules/character';
import type { BodySpec } from './body';
import type { Kit } from './geo';
import type { OutfitSpec } from './outfitSpec';
import type { SkinSet } from './rig';

/** Roles de material: cada rol se resuelve a un MeshStandardMaterial cacheado por color dentro del modelo. */
export type Role = 'skin' | 'lips' | 'hair' | 'jacket' | 'pants' | 'accent' | 'glove' | 'dark' | 'white' | 'metal' | 'lens';

export interface BuildCtx {
  readonly look: ResolvedLook;
  readonly body: BodySpec;
  readonly kit: Kit<Role>;
  readonly skins: SkinSet;
  readonly outfit: OutfitSpec;
}
