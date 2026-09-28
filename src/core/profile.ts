import { CHARACTER } from '../config';
import { cloneProfile, normalizeProfile, parseProfile, profilesEqual, serializeProfile } from '../rules/character';
import type { EventBus } from './events';
import type { RunState } from './state';
import type { Appearance, PlayerProfile } from './types';

/** Persistencia del perfil en localStorage (todo con try/catch: puede estar bloqueado o vacío). */
export function loadProfile(): PlayerProfile {
  try {
    return parseProfile(window.localStorage.getItem(CHARACTER.storageKey));
  } catch {
    return parseProfile(null);
  }
}

export function saveProfile(profile: PlayerProfile): void {
  try {
    window.localStorage.setItem(CHARACTER.storageKey, serializeProfile(profile));
  } catch {
    /* almacenamiento no disponible: el perfil sólo vive en memoria */
  }
}

/** Copia `next` dentro del objeto de perfil existente conservando su identidad (state.profile es estable). */
export function assignProfile(target: PlayerProfile, next: PlayerProfile): void {
  target.name = next.name;
  target.gender = next.gender;
  Object.assign(target.appearance, next.appearance);
}

export type ProfilePatch = Partial<Omit<PlayerProfile, 'appearance'>> & { appearance?: Partial<Appearance> };

/**
 * Único punto de escritura del perfil en juego: valida y sanea el parche (nombre, índices),
 * actualiza `state.profile` in-place, lo guarda y emite 'profile:changed' sólo si algo cambió.
 * Devuelve el perfil resultante.
 */
export function updateProfile(ctx: { state: RunState; bus: EventBus }, patch: ProfilePatch): PlayerProfile {
  const current = ctx.state.profile;
  const merged = normalizeProfile(
    {
      name: patch.name ?? current.name,
      gender: patch.gender ?? current.gender,
      appearance: { ...current.appearance, ...patch.appearance },
    },
    current,
  );
  // Un nombre inválido (vacío tras sanear) conserva el actual en lugar de reponer el de por defecto.
  if (patch.name !== undefined && merged.name !== patch.name && patch.name.trim() === '') merged.name = current.name;
  if (profilesEqual(current, merged)) return current;
  const before = cloneProfile(current);
  assignProfile(current, merged);
  saveProfile(current);
  ctx.bus.emit('profile:changed', {
    nameChanged: before.name !== merged.name,
    genderChanged: before.gender !== merged.gender,
    appearanceChanged: (Object.keys(merged.appearance) as (keyof Appearance)[]).some((k) => before.appearance[k] !== merged.appearance[k]),
  });
  return current;
}
