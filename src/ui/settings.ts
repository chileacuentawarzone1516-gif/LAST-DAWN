/**
 * Ajustes del jugador (volumen, silencio, calidad gráfica): se recuerdan en localStorage
 * (siempre con try/catch: puede estar bloqueado o lleno) y se aplican a audio y motor.
 */
import { AUDIO, HUD, RENDER } from '../config';
import type { QualityLevel } from '../config';
import type { GameContext } from '../core/context';
import { clamp01 } from '../core/util';

export interface Settings {
  /** Volumen maestro 0..1. */
  volume: number;
  muted: boolean;
  quality: QualityLevel;
}

export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];
export const QUALITY_LABEL: Record<QualityLevel, string> = { low: 'Baja', medium: 'Media', high: 'Alta' };

export const isQuality = (v: unknown): v is QualityLevel => v === 'low' || v === 'medium' || v === 'high';

/** Valida un objeto arbitrario (JSON almacenado) y lo completa con los valores por defecto. */
export function sanitizeSettings(raw: unknown, defaults: Settings): Settings {
  const out: Settings = { ...defaults };
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (typeof r.volume === 'number' && Number.isFinite(r.volume)) out.volume = clamp01(r.volume);
    if (typeof r.muted === 'boolean') out.muted = r.muted;
    if (isQuality(r.quality)) out.quality = r.quality;
  }
  return out;
}

function readStored(): unknown {
  try {
    const text = window.localStorage.getItem(HUD.storageKey);
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

function writeStored(s: Settings): void {
  try {
    window.localStorage.setItem(HUD.storageKey, JSON.stringify(s));
  } catch {
    /* almacenamiento no disponible: los ajustes sólo duran esta sesión */
  }
}

export interface SettingsStore {
  readonly value: Readonly<Settings>;
  set(patch: Partial<Settings>): void;
  subscribe(fn: (s: Readonly<Settings>) => void): () => void;
  /** Aplica volumen/silencio al audio (puede no existir aún al construir la UI). */
  applyAudio(): void;
}

export function createSettingsStore(ctx: GameContext): SettingsStore {
  // La calidad de la URL (?q=low) manda sobre la guardada durante esta sesión.
  const urlQuality = new URLSearchParams(window.location.search).get('q');
  const engineQuality = isQuality(ctx.engine.stats.quality) ? ctx.engine.stats.quality : RENDER.defaultQuality;
  const defaults: Settings = { volume: AUDIO.master, muted: false, quality: engineQuality };
  const value = sanitizeSettings(readStored(), defaults);
  if (isQuality(urlQuality)) value.quality = urlQuality;

  const listeners = new Set<(s: Readonly<Settings>) => void>();

  const applyQuality = (): void => {
    if (ctx.engine.stats.quality !== value.quality) ctx.engine.setQuality(value.quality);
  };
  applyQuality();

  const store: SettingsStore = {
    value,
    set(patch) {
      const before = { ...value };
      if (patch.volume !== undefined) value.volume = clamp01(patch.volume);
      if (patch.muted !== undefined) value.muted = patch.muted;
      if (patch.quality !== undefined && isQuality(patch.quality)) value.quality = patch.quality;
      if (value.quality !== before.quality) applyQuality();
      if (value.volume !== before.volume || value.muted !== before.muted) store.applyAudio();
      writeStored(value);
      for (const fn of listeners) fn(value);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    applyAudio() {
      // ctx.audio se construye después que la UI: sólo existe a partir del primer update().
      const audio = (ctx as { audio?: GameContext['audio'] }).audio;
      if (!audio) return;
      audio.setMasterVolume(value.volume);
      audio.setMuted(value.muted);
    },
  };
  return store;
}
