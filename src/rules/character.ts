import { CHARACTER } from '../config';
import type { Appearance, Gender, PlayerProfile } from '../core/types';
import { pickOne } from '../core/util';
import type { Rng } from '../core/util';

/**
 * Reglas puras del perfil del operativo: validación, saneado del nombre, apariencia y colores
 * resueltos. Sin three.js ni DOM (testeable en node).
 */

const GENDERS: readonly Gender[] = ['male', 'female'];

export const isGender = (v: unknown): v is Gender => typeof v === 'string' && (GENDERS as readonly string[]).includes(v);

/** Índice entero acotado a [0, count-1]; valores no numéricos → 0. */
function clampIndex(v: unknown, count: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
  return Math.min(Math.max(n, 0), Math.max(0, count - 1));
}

/**
 * Sanea un nombre escrito por el usuario: normaliza Unicode, elimina caracteres de control y
 * cualquier símbolo fuera de letras, dígitos, espacio y `- _ . '`, colapsa espacios y recorta a
 * `nameMaxLen`. Devuelve '' si no queda nada válido (el llamador decide el valor por defecto).
 * Nunca se inserta como HTML (la UI usa textContent), pero se filtra igualmente por defensa en profundidad.
 */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let s = raw.normalize('NFC');
  s = s.replace(/[^\p{L}\p{N} _.'-]/gu, '');
  s = s.replace(/\s+/g, ' ').trim();
  // Recorta por caracteres (no por unidades UTF-16) para no partir pares sustitutos.
  s = Array.from(s).slice(0, CHARACTER.nameMaxLen).join('').trim();
  return s.length >= CHARACTER.nameMinLen ? s : '';
}

export const defaultName = (gender: Gender): string => CHARACTER.defaultName[gender];

export function defaultAppearance(gender: Gender): Appearance {
  return { ...CHARACTER.presets[gender][0]!.appearance };
}

export function defaultProfile(gender: Gender = 'male'): PlayerProfile {
  return { name: defaultName(gender), gender, appearance: defaultAppearance(gender) };
}

/** Acota cada índice de la apariencia a su tabla (el estilo de pelo depende del género). */
export function clampAppearance(gender: Gender, a: Partial<Appearance> | null | undefined): Appearance {
  const src = a ?? {};
  return {
    skin: clampIndex(src.skin, CHARACTER.skinTones.length),
    hairStyle: clampIndex(src.hairStyle, CHARACTER.hairStyles[gender].length),
    hairColor: clampIndex(src.hairColor, CHARACTER.hairColors.length),
    outfit: clampIndex(src.outfit, CHARACTER.outfits.length),
    accessory: clampIndex(src.accessory, CHARACTER.accessories.length),
  };
}

/** Reconstruye un perfil válido a partir de datos no confiables (localStorage, JSON, parches). */
export function normalizeProfile(raw: unknown, fallback: PlayerProfile = defaultProfile()): PlayerProfile {
  if (typeof raw !== 'object' || raw === null) return cloneProfile(fallback);
  const r = raw as { name?: unknown; gender?: unknown; appearance?: unknown };
  const gender = isGender(r.gender) ? r.gender : fallback.gender;
  const appearance = clampAppearance(
    gender,
    typeof r.appearance === 'object' && r.appearance !== null ? (r.appearance as Partial<Appearance>) : fallback.appearance,
  );
  const name = sanitizeName(r.name) || (r.name === undefined ? fallback.name : defaultName(gender));
  return { name, gender, appearance };
}

export function cloneProfile(p: PlayerProfile): PlayerProfile {
  return { name: p.name, gender: p.gender, appearance: { ...p.appearance } };
}

export const profilesEqual = (a: PlayerProfile, b: PlayerProfile): boolean =>
  a.name === b.name && a.gender === b.gender && (Object.keys(a.appearance) as (keyof Appearance)[]).every((k) => a.appearance[k] === b.appearance[k]);

/**
 * Cambia el género: conserva lo compartido (piel, color de pelo, ropa, accesorio) y cambia el
 * estilo de pelo al equivalente por posición. Si el nombre era el nombre por defecto del género
 * anterior, pasa al del nuevo (no se pisa un nombre personalizado).
 */
export function withGender(p: PlayerProfile, gender: Gender): PlayerProfile {
  if (p.gender === gender) return cloneProfile(p);
  const appearance = clampAppearance(gender, p.appearance);
  const wasDefault = p.name === defaultName(p.gender);
  return { name: wasDefault ? defaultName(gender) : p.name, gender, appearance };
}

export const presetCount = (gender: Gender): number => CHARACTER.presets[gender].length;

export function applyPreset(p: PlayerProfile, presetIndex: number): PlayerProfile {
  const list = CHARACTER.presets[p.gender];
  const preset = list[clampIndex(presetIndex, list.length)]!;
  return { ...cloneProfile(p), appearance: { ...preset.appearance } };
}

/** Índice del preset cuya apariencia coincide exactamente con la del perfil, o -1 (personalizado). */
export function matchingPreset(p: PlayerProfile): number {
  return CHARACTER.presets[p.gender].findIndex((pr) =>
    (Object.keys(pr.appearance) as (keyof Appearance)[]).every((k) => pr.appearance[k] === p.appearance[k]),
  );
}

export function randomAppearance(rng: Rng, gender: Gender): Appearance {
  const r = (n: number) => Math.floor(rng() * n);
  return {
    skin: r(CHARACTER.skinTones.length),
    hairStyle: r(CHARACTER.hairStyles[gender].length),
    hairColor: r(CHARACTER.hairColors.length),
    outfit: r(CHARACTER.outfits.length),
    accessory: r(CHARACTER.accessories.length),
  };
}

export function randomProfile(rng: Rng, gender?: Gender): PlayerProfile {
  const g = gender ?? pickOne(rng, GENDERS);
  return { name: pickOne(rng, CHARACTER.randomNames[g]), gender: g, appearance: randomAppearance(rng, g) };
}

/** Colores e identificadores ya resueltos para dibujar al personaje (modelo, viewmodel, HUD). */
export interface ResolvedLook {
  gender: Gender;
  skin: number;
  hair: number;
  hairStyle: string;
  jacket: number;
  pants: number;
  accent: number;
  glove: number;
  accessory: string;
  outfit: string;
}

export function resolveLook(p: PlayerProfile): ResolvedLook {
  const a = clampAppearance(p.gender, p.appearance);
  const outfit = CHARACTER.outfits[a.outfit]!;
  return {
    gender: p.gender,
    skin: CHARACTER.skinTones[a.skin]!.color,
    hair: CHARACTER.hairColors[a.hairColor]!.color,
    hairStyle: CHARACTER.hairStyles[p.gender][a.hairStyle]!.id,
    jacket: outfit.jacket,
    pants: outfit.pants,
    accent: outfit.accent,
    glove: outfit.glove,
    accessory: CHARACTER.accessories[a.accessory]!.id,
    outfit: outfit.id,
  };
}

/** Serialización estable para persistir el perfil. */
export const serializeProfile = (p: PlayerProfile): string => JSON.stringify(normalizeProfile(p));

/** Lectura segura: JSON inválido o campos corruptos → perfil por defecto/normalizado. */
export function parseProfile(json: string | null | undefined, fallback: PlayerProfile = defaultProfile()): PlayerProfile {
  if (!json) return cloneProfile(fallback);
  try {
    return normalizeProfile(JSON.parse(json) as unknown, fallback);
  } catch {
    return cloneProfile(fallback);
  }
}
