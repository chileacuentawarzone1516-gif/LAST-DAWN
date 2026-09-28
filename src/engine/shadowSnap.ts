/**
 * Cuantización de la sombra de la luna al texel del shadow map (lógica pura, sin three.js).
 *
 * El frustum de sombra sigue al jugador; si su centro se moviese de forma continua, los bordes
 * de las sombras «nadarían» (parpadeo). Se proyecta el centro sobre los ejes del espacio de la
 * luz, se redondea a múltiplos del tamaño de texel y se reconstruye: el mapa sólo se desplaza
 * en pasos enteros de texel.
 */
export interface V3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Ejes del espacio de la luz para una luz direccional. `toLight` = dirección unitaria desde el
 * objetivo hacia la luz. Coinciden con los de la cámara de sombra de three (lookAt con up = +Y).
 */
export function lightAxes(toLight: V3, right: V3, up: V3): void {
  // right = normalize(cross(worldUp, toLight))
  let rx = toLight.z;
  let ry = 0;
  let rz = -toLight.x;
  let len = Math.hypot(rx, rz);
  if (len < 1e-6) {
    // Luz casi vertical: eje arbitrario estable.
    rx = 1;
    rz = 0;
    len = 1;
  }
  rx /= len;
  rz /= len;
  right.x = rx;
  right.y = ry;
  right.z = rz;
  // up = cross(toLight, right)
  up.x = toLight.y * rz - toLight.z * ry;
  up.y = toLight.z * rx - toLight.x * rz;
  up.z = toLight.x * ry - toLight.y * rx;
}

/** Tamaño de un texel en metros para un frustum ortográfico de lado `2·radius`. */
export const texelSize = (radius: number, mapSize: number): number => (2 * radius) / mapSize;

/**
 * Redondea (cx,cy,cz) al retículo de texels en el plano perpendicular a la luz.
 * Escribe el resultado en `out` (sin asignaciones).
 */
export function snapToTexel(cx: number, cy: number, cz: number, right: V3, up: V3, texel: number, out: V3): V3 {
  const u = cx * right.x + cy * right.y + cz * right.z;
  const v = cx * up.x + cy * up.y + cz * up.z;
  const du = Math.round(u / texel) * texel - u;
  const dv = Math.round(v / texel) * texel - v;
  out.x = cx + right.x * du + up.x * dv;
  out.y = cy + right.y * du + up.y * dv;
  out.z = cz + right.z * du + up.z * dv;
  return out;
}
