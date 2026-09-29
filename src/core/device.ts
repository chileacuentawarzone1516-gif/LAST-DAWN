import type { QualityLevel } from '../config';
import { TOUCH } from '../config';

/**
 * Detección de dispositivo y calidad gráfica inicial. `?touch=1|0` y `?q=low|medium|high` fuerzan el
 * modo (pruebas, usuarios avanzados). Un portátil con pantalla táctil y ratón NO se considera táctil.
 */
export function isTouchDevice(search: string = window.location.search): boolean {
  const q = new URLSearchParams(search).get('touch');
  if (q === '1') return true;
  if (q === '0') return false;
  try {
    return navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export interface DeviceProfile {
  touch: boolean;
  /** Núcleos lógicos (navigator.hardwareConcurrency; 0 si se desconoce). */
  cores: number;
  /** GB de RAM aproximados (navigator.deviceMemory, sólo Chromium); null si se desconoce. */
  memoryGb: number | null;
  /** El usuario pidió ahorrar datos (navigator.connection.saveData). */
  saveData: boolean;
  /** Cadena UNMASKED_RENDERER_WEBGL ('' si no está disponible). */
  gpu: string;
}

export type GpuClass = 'software' | 'apple' | 'integrated' | 'mobile' | 'discrete' | 'unknown';

/** Clasifica la GPU por su cadena de renderer (heurística; nunca falla, sólo degrada a 'unknown'). */
export function classifyGpu(renderer: string): GpuClass {
  const r = renderer.toLowerCase();
  if (!r) return 'unknown';
  if (/swiftshader|llvmpipe|softpipe|software|microsoft basic|basic render/.test(r)) return 'software';
  if (/apple/.test(r)) return 'apple';
  if (/adreno|mali|powervr|immortalis|videocore/.test(r)) return 'mobile';
  if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|arc a\d|arc\(tm\) a\d/.test(r)) return 'discrete';
  if (/intel|uhd|iris|hd graphics|radeon\(tm\) graphics|radeon graphics|vega \d|mesa/.test(r)) return 'integrated';
  return 'unknown';
}

/**
 * Calidad inicial recomendada, o `undefined` para dejar la del motor (alta). El escalado dinámico de
 * resolución sigue corrigiendo en marcha, y el jugador puede cambiarla en Ajustes.
 */
export function pickQuality(d: DeviceProfile): QualityLevel | undefined {
  const gpu = classifyGpu(d.gpu);
  if (gpu === 'software' || d.saveData) return 'low';
  if (d.touch) {
    // Móviles: bajo por defecto; medio en Apple GPU o en equipos con mucha RAM y núcleos.
    if (gpu === 'apple') return 'medium';
    if ((d.memoryGb ?? 0) >= 6 && d.cores >= 8) return 'medium';
    return TOUCH.defaultQuality;
  }
  if (gpu === 'discrete') return undefined;
  const weak = (d.memoryGb !== null && d.memoryGb <= 4) || (d.cores > 0 && d.cores <= 4);
  if (gpu === 'integrated' || weak) return 'medium';
  return undefined;
}

/** Lee la GPU con un contexto WebGL desechable. */
export function probeGpu(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  } catch {
    return '';
  }
}

export function readDevice(touch: boolean): DeviceProfile {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return {
    touch,
    cores: nav.hardwareConcurrency ?? 0,
    memoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    saveData: nav.connection?.saveData === true,
    gpu: probeGpu(),
  };
}

/**
 * Calidad inicial: la de la URL si existe; en modo QA (?qa=1) siempre la del motor (mediciones
 * reproducibles); si no, la recomendada para el dispositivo.
 */
export function initialQuality(touch: boolean, search: string = window.location.search): QualityLevel | undefined {
  const params = new URLSearchParams(search);
  const q = params.get('q');
  if (q === 'low' || q === 'medium' || q === 'high') return q;
  if (params.get('qa') === '1') return touch ? TOUCH.defaultQuality : undefined;
  return pickQuality(readDevice(touch));
}
