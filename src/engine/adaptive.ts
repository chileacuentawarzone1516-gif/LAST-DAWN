/**
 * Controlador de escala dinámica de resolución (lógica pura, sin three.js).
 *
 * Se alimenta con el tiempo REAL de cada frame dibujado. Cada `windowS` segundos calcula el
 * FPS medio: si cae por debajo de `lowFps` baja la escala un `step`; si se mantiene por encima
 * de `highFps` durante varias ventanas seguidas la sube (con retroceso exponencial si la
 * subida provoca una nueva bajada, para evitar oscilaciones).
 */
export interface AdaptiveConfig {
  enabled: boolean;
  lowFps: number;
  highFps: number;
  windowS: number;
  minScale: number;
  step: number;
  /** Escala inicial y tras reset() cuando está activo (por defecto 1). */
  startScale?: number;
  /** Ventanas buenas seguidas para subir la escala (por defecto 3). */
  goodWindows?: number;
}

export interface AdaptiveScale {
  /** Escala actual (minScale..1). */
  readonly scale: number;
  enabled: boolean;
  /** Registra un frame; devuelve true si la escala ha cambiado. */
  push(dt: number): boolean;
  /** Vuelve a la escala inicial (1 si está desactivado) y descarta la ventana en curso. */
  reset(): void;
}

/** Frames más largos que esto (pestaña en segundo plano, carga de shaders…) no cuentan. */
const HITCH_S = 0.25;
/** Ventanas «buenas» seguidas necesarias para subir la escala (crece si oscila). */
const MAX_GOOD_WINDOWS = 24;

export function createAdaptiveScale(cfg: AdaptiveConfig): AdaptiveScale {
  const baseGood = cfg.goodWindows ?? 3;
  const start = Math.min(1, Math.max(cfg.minScale, cfg.startScale ?? 1));
  let frames = 0;
  let time = 0;
  let good = 0;
  let needGood = baseGood;
  /** Ventanas tras una subida en las que una bajada penaliza (retroceso). */
  let sinceRaise = 99;
  /** Tras cambiar de escala se descarta una ventana para dejar que la medición se estabilice. */
  let settle = 0;
  let scale = cfg.enabled ? start : 1;

  const state: AdaptiveScale = {
    get scale() {
      return scale;
    },
    enabled: cfg.enabled,
    push(dt) {
      if (!state.enabled) return false;
      if (dt <= 0 || dt > HITCH_S) return false;
      frames++;
      time += dt;
      if (time < cfg.windowS) return false;
      const fps = frames / time;
      frames = 0;
      time = 0;
      if (settle > 0) {
        settle--;
        return false;
      }
      sinceRaise++;
      if (fps < cfg.lowFps && scale > cfg.minScale + 1e-6) {
        if (sinceRaise <= 2) needGood = Math.min(MAX_GOOD_WINDOWS, needGood * 2);
        scale = Math.max(cfg.minScale, round2(scale - cfg.step));
        good = 0;
        settle = 1;
        return true;
      }
      if (fps > cfg.highFps && scale < 1 - 1e-6) {
        good++;
        if (good >= needGood) {
          scale = Math.min(1, round2(scale + cfg.step));
          good = 0;
          sinceRaise = 0;
          settle = 1;
          return true;
        }
      } else {
        good = 0;
      }
      return false;
    },
    reset() {
      scale = state.enabled ? start : 1;
      frames = 0;
      time = 0;
      good = 0;
      needGood = baseGood;
      sinceRaise = 99;
      settle = 0;
    },
  };
  return state;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
