/** Registro de todas las recetas de sonido, por id. */
import { enemyRecipes } from './recipes/enemies';
import { foleyRecipes } from './recipes/foley';
import { weaponRecipes } from './recipes/weapons';
import { worldRecipes } from './recipes/world';
import type { RecipeDef } from './types';

function build(): Record<string, RecipeDef> {
  const out: Record<string, RecipeDef> = {};
  for (const d of [...weaponRecipes(), ...foleyRecipes(), ...enemyRecipes(), ...worldRecipes()]) out[d.id] = d;
  return out;
}

export const RECIPES: Record<string, RecipeDef> = build();
export const RECIPE_IDS: readonly string[] = Object.keys(RECIPES);
