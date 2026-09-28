/** Registro de todas las recetas de sonido, por id. */
import { enemyRecipes } from './recipes/enemies';
import { foleyRecipes } from './recipes/foley';
import { weaponRecipes } from './recipes/weapons';
import { worldRecipes } from './recipes/world';
import type { RecipeDef } from './types';

/** Compensación de nivel por patrón de id (calibrada con scripts/qa/audio-render.mjs). */
const BOOST: ReadonlyArray<readonly [RegExp, number]> = [
  [/^vocal\.walker\.(idle|alert|attack|hurt|death)$/, 2.0],
  [/^vocal\.spitter\./, 2.4],
  [/^vocal\.runner\.(idle)$/, 3.2],
  [/^vocal\.runner\.hurt$/, 1.8],
  [/^vocal\.brute\.hurt$/, 1.6],
  [/^impact\.(concrete|asphalt|dirt|wood|water|glass)$/, 1.6],
  [/^hit\.(body|limb)$/, 3],
  [/^hit\.(head|kill|helmet)$/, 1.6],
  [/^ui\.(click|hold)$/, 2.5],
  [/^ui\.notify\./, 1.5],
  [/^shop\.(close|denied)$/, 1.4],
  [/^amb\.drip$/, 3],
  [/^amb\.creak$/, 1.6],
  [/^heart\.beat$/, 0.5],
  [/^step\./, 1.3],
  [/^impact\.ricochet$/, 1.8],
  [/^player\.(jump|heal)$/, 1.6],
  [/^dry\./, 1.8],
  [/^fx\.tinnitus$/, 1.5],
];

function build(): Record<string, RecipeDef> {
  const out: Record<string, RecipeDef> = {};
  for (const d of [...weaponRecipes(), ...foleyRecipes(), ...enemyRecipes(), ...worldRecipes()]) {
    for (const [re, k] of BOOST) if (re.test(d.id)) d.trim *= k;
    out[d.id] = d;
  }
  return out;
}

export const RECIPES: Record<string, RecipeDef> = build();
export const RECIPE_IDS: readonly string[] = Object.keys(RECIPES);
