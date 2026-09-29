import type { CharacterAnchor } from '../core/context';

/** Distancia (m) a la que se coloca el maniquí delante de la viewCamera (rango del motor: near 0,01, far 10). */
export const PREVIEW_DISTANCE = 3;

export interface CharacterPlacement {
  /** Posición del origen del modelo (los pies) en el espacio de la viewCamera (en el origen, mirando −Z). */
  x: number;
  y: number;
  z: number;
  /** Escala uniforme del modelo. */
  scale: number;
}

/**
 * Función PURA de colocación. La cámara está en el origen mirando −Z con fov vertical `fovDeg` y relación de
 * aspecto `aspect`. Devuelve posición (pies) y escala para que el modelo, de altura `modelHeight` con los pies
 * en y=0, ocupe `anchor.height` de la altura de pantalla y quede CENTRADO (a media altura) en (anchor.x, anchor.y),
 * expresados en fracciones de pantalla con (0,0) arriba a la izquierda. Tiene en cuenta el aspecto para el
 * desplazamiento horizontal (pantallas anchas y verticales).
 */
export function anchorToPlacement(
  fovDeg: number,
  aspect: number,
  anchor: CharacterAnchor,
  modelHeight: number,
  distance: number = PREVIEW_DISTANCE,
): CharacterPlacement {
  const halfH = distance * Math.tan((fovDeg * Math.PI) / 360);
  const halfW = halfH * aspect;
  const h = Math.max(1e-3, modelHeight);
  const scale = (anchor.height * 2 * halfH) / h;
  const cx = (anchor.x * 2 - 1) * halfW;
  const cy = (1 - anchor.y * 2) * halfH;
  return { x: cx, y: cy - (scale * h) / 2, z: -distance, scale };
}
