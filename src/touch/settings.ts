/** Preferencias de los controles táctiles (persisten en localStorage; cualquier fallo de almacenamiento se ignora). */

export interface TouchSettings {
  /** Layout espejado para zurdos. */
  lefty: boolean;
  /** Apuntar mientras se mantiene el botón (en vez de alternar con cada toque). */
  aimHold: boolean;
  /** Vibración háptica. */
  haptics: boolean;
  /** Indicador de FPS. */
  fps: boolean;
}

export const SETTINGS_KEY = 'lastdawn.touch.v1';

export const DEFAULT_SETTINGS: Readonly<TouchSettings> = { lefty: false, aimHold: false, haptics: true, fps: false };

/** Interpreta el JSON guardado: ignora campos ajenos o de tipo incorrecto y completa con los valores por defecto. */
export function parseSettings(raw: string | null | undefined): TouchSettings {
  const out: TouchSettings = { ...DEFAULT_SETTINGS };
  if (!raw) return out;
  try {
    const data: unknown = JSON.parse(raw);
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      if (typeof d.lefty === 'boolean') out.lefty = d.lefty;
      if (typeof d.aimHold === 'boolean') out.aimHold = d.aimHold;
      if (typeof d.haptics === 'boolean') out.haptics = d.haptics;
      if (typeof d.fps === 'boolean') out.fps = d.fps;
    }
  } catch {
    /* JSON corrupto: valores por defecto */
  }
  return out;
}

export function loadSettings(): TouchSettings {
  try {
    return parseSettings(window.localStorage.getItem(SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Readonly<TouchSettings>): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* almacenamiento bloqueado o lleno: la preferencia sólo dura la sesión */
  }
}
