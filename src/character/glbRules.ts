/**
 * Reglas PURAS (sin three.js ni DOM) de los modelos GLB de personaje: qué pieza es visible para cada
 * apariencia y qué color lleva cada rol de material. Portadas de godot/ld_character.gd; los datos de botas
 * coinciden con tests/fixtures/ld_character_data.json (lo comprueba tests/character.glb.test.ts).
 *
 * Nomenclatura de piezas: `LD_<M|F>_<Slot>_<id>[_Top|_Tie]` (three elimina los puntos de los nombres:
 * `LD_M_Eye.L` → `LD_M_EyeL`) y, si la pieza tiene varias primitivas, three añade un sufijo numérico `_<n>`.
 * Materiales: `LD_<G>_<Rol>`.
 */
import type { Gender } from '../core/types';
import type { ResolvedLook } from '../rules/character';

export const HAT_ACCESSORIES: readonly string[] = ['cap', 'beanie'];

/** Roles de material que se tiñen (el resto —Gear, Lens, Sole, Metal, Pupil, Iris, Sclera, Fur— no). */
export const TINT_ROLES = ['Skin', 'Hair', 'Jacket', 'JacketShade', 'Pants', 'Accent', 'Glove', 'Boots'] as const;
export type TintRole = (typeof TINT_ROLES)[number];

/** Botas por conjunto (las que no aparecen usan BOOTS_DEFAULT). */
export const BOOTS_BY_OUTFIT: Readonly<Record<string, number>> = {
  desierto: 0x6b5234,
  artico: 0x3a4450,
  sanitario: 0x2b3a4a,
  obrero: 0x3b2e22,
};
export const BOOTS_DEFAULT = 0x2a2622;

/** Factor de oscurecimiento de la chaqueta para el rol JacketShade. */
export const JACKET_SHADE_K = -0.3;

export const gender1 = (g: Gender): 'M' | 'F' => (g === 'male' ? 'M' : 'F');

/** Igual que shadeColor de ui/portrait.ts: k > 0 aclara hacia blanco, k < 0 oscurece (v·(1+k)) por canal. */
export function shadeHex(n: number, k: number): number {
  const f = Math.max(-1, Math.min(1, k));
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))));
  return (ch((n >> 16) & 255) << 16) | (ch((n >> 8) & 255) << 8) | ch(n & 255);
}

export interface PieceName {
  gender: 'M' | 'F';
  /** Body, Brows, Eye…, Hair, Acc, Outfit. */
  slot: string;
  /** Identificador del estilo/accesorio/conjunto ('Base' en las prendas siempre visibles); '' si no aplica. */
  item: string;
  /** Parte en minúsculas: 'main', 'top', 'tie'… */
  part: string;
}

const PIECE_RE = /^LD_([MF])_([A-Za-z]+)((?:_[A-Za-z0-9]+)*)$/;

/**
 * Interpreta el nombre de una pieza. Devuelve null si no sigue la nomenclatura LD_*.
 * Tolera el sufijo numérico de las mallas con varias primitivas (`…_1`).
 */
export function parsePieceName(name: string): PieceName | null {
  const m = PIECE_RE.exec(name);
  if (!m) return null;
  const tokens = (m[3] ?? '').split('_').filter((t) => t.length > 0);
  if (tokens.length > 0 && /^\d+$/.test(tokens[tokens.length - 1]!)) tokens.pop();
  const slot = m[2]!;
  const item = tokens[0] ?? '';
  // `Outfit_Base_Boots` → item 'Base', part 'boots' (irrelevante para la visibilidad).
  const part = (tokens[1] ?? 'main').toLowerCase();
  return { gender: m[1] as 'M' | 'F', slot, item, part };
}

/** ¿Debe verse esta pieza con esta apariencia? Piezas desconocidas: visibles (cuerpo, ojos, cejas…). */
export function isPieceVisible(p: PieceName, look: Pick<ResolvedLook, 'outfit' | 'accessory' | 'hairStyle'>): boolean {
  switch (p.slot) {
    case 'Outfit':
      return p.item === 'Base' || p.item === look.outfit;
    case 'Acc':
      return p.item === look.accessory;
    case 'Hair':
      if (p.item !== look.hairStyle) return false;
      return !(p.part === 'top' && HAT_ACCESSORIES.includes(look.accessory));
    default:
      return true;
  }
}

/** Visibilidad por nombre de pieza (nombres que no siguen LD_* se dejan visibles). */
export function isNameVisible(name: string, look: Pick<ResolvedLook, 'outfit' | 'accessory' | 'hairStyle'>): boolean {
  const p = parsePieceName(name);
  return p ? isPieceVisible(p, look) : true;
}

/** Rol de un material `LD_<G>_<Rol>` ('' si no sigue la nomenclatura). */
export function materialRole(name: string): string {
  const m = /^LD_[MF]_([A-Za-z]+)$/.exec(name);
  return m ? m[1]! : '';
}

export const isTintRole = (role: string): role is TintRole => (TINT_ROLES as readonly string[]).includes(role);

export const bootsColor = (outfit: string): number => BOOTS_BY_OUTFIT[outfit] ?? BOOTS_DEFAULT;

/** Color (0xRRGGBB, sRGB) de cada rol tintable para una apariencia. */
export function resolveTints(look: ResolvedLook): Record<TintRole, number> {
  return {
    Skin: look.skin,
    Hair: look.hair,
    Jacket: look.jacket,
    JacketShade: shadeHex(look.jacket, JACKET_SHADE_K),
    Pants: look.pants,
    Accent: look.accent,
    Glove: look.glove,
    Boots: bootsColor(look.outfit),
  };
}

/** Nombre de archivo del GLB según el género (relativo a BASE_URL). */
export const glbUrl = (base: string, file: string): string => `${base.endsWith('/') ? base : `${base}/`}${file}`;

export type CharacterLod = 'high' | 'low';

/**
 * Variante del GLB según el dispositivo: la ligera (`*_low.glb`: 24–40 % menos triángulos visibles con el rostro intacto, texturas 1024) en
 * táctiles, con calidad gráfica 'low' o con poca memoria (`deviceMemory` ≤ lowMemoryGb); si no, la alta.
 */
export function pickCharacterLod(o: { touch: boolean; quality: string; deviceMemory?: number | undefined }, lowMemoryGb = 4): CharacterLod {
  if (o.touch || o.quality === 'low') return 'low';
  if (typeof o.deviceMemory === 'number' && o.deviceMemory > 0 && o.deviceMemory <= lowMemoryGb) return 'low';
  return 'high';
}
