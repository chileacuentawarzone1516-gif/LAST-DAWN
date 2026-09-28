/**
 * Apariencia del viewmodel a partir del perfil del operativo (parte PURA, sin three.js).
 * Manga = chaqueta, guantes/puños = guante del conjunto, piel visible (muñeca y yemas) = tono de piel.
 */
import type { PlayerProfile } from '../core/types';
import { resolveLook } from '../rules/character';

export interface ArmLookColors {
  sleeve: number;
  glove: number;
  skin: number;
  /** Escala lateral de manos y antebrazos: las manos femeninas son ligeramente más finas. */
  handScale: number;
}

/** Factor de finura de las manos femeninas. */
export const FEMALE_HAND_SCALE = 0.93;

export function resolveArmLook(profile: PlayerProfile): ArmLookColors {
  const l = resolveLook(profile);
  return { sleeve: l.jacket, glove: l.glove, skin: l.skin, handScale: l.gender === 'female' ? FEMALE_HAND_SCALE : 1 };
}
