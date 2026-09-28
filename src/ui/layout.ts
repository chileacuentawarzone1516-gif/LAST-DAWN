/**
 * Geometría pura de la pantalla de personalización: convierte el rectángulo de la zona libre
 * (donde se ve el maniquí 3D) en el ancla `CharacterAnchor` (fracciones de pantalla).
 */
import { HUD } from '../config';
import type { CharacterAnchor } from '../core/context';
import { clamp } from '../core/util';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** ¿Se usa la disposición de dos columnas (panel a la izquierda, modelo a la derecha)? */
export function isWideLayout(vp: Viewport): boolean {
  return vp.width >= 640 && vp.width >= vp.height * 1.05;
}

/** Ancla estimada sin medir el DOM (respaldo y tests). */
export function fallbackAnchor(vp: Viewport): CharacterAnchor {
  return isWideLayout(vp) ? { x: 0.72, y: 0.52, height: 0.78 } : { x: 0.5, y: 0.27, height: 0.4 };
}

/**
 * Ancla del modelo centrada en `box`, con la altura limitada por la altura del área y por su
 * anchura (el maniquí mide ~`modelAspect` de ancho respecto a su alto). Áreas degeneradas → respaldo.
 */
export function anchorFromBox(box: Box, vp: Viewport, opts: { aspect?: number; fill?: number } = {}): CharacterAnchor {
  const aspect = opts.aspect ?? HUD.preview.modelAspect;
  const fill = opts.fill ?? HUD.preview.fill;
  if (!(vp.width > 0 && vp.height > 0) || !(box.width > 8 && box.height > 8)) return fallbackAnchor(vp);
  const hPx = Math.min(box.height * fill, box.width / aspect);
  return {
    x: clamp((box.left + box.width / 2) / vp.width, 0, 1),
    y: clamp((box.top + box.height / 2) / vp.height, 0, 1),
    height: clamp(hPx / vp.height, 0.15, 0.95),
  };
}

export function anchorsEqual(a: CharacterAnchor, b: CharacterAnchor, eps = 0.004): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.height - b.height) < eps;
}
