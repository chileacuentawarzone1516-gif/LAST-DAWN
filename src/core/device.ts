import type { QualityLevel } from '../config';
import { TOUCH } from '../config';

/**
 * Detección de dispositivo. `?touch=1|0` fuerza el modo (pruebas). Un portátil con pantalla táctil y
 * ratón NO se considera táctil (su puntero principal es fino).
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

/** Calidad inicial: la de la URL si existe; si no, la de móvil en táctiles y la del motor en escritorio. */
export function initialQuality(touch: boolean, search: string = window.location.search): QualityLevel | undefined {
  const q = new URLSearchParams(search).get('q');
  if (q === 'low' || q === 'medium' || q === 'high') return q;
  return touch ? TOUCH.defaultQuality : undefined;
}
