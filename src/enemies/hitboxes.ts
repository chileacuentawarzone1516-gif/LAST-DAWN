/**
 * Hitboxes baratos: esferas/cápsulas ligadas a los nodos del rig (siguen la pose actual).
 * Broadphase por esfera envolvente; el test fino sólo se hace con los enemigos cuyo volumen corta el rayo.
 */
import type { HitZone } from '../core/types';
import { getHitbox } from './models';
import type { Rig } from './models';

/** Resultado del último test (evita asignar): normal del impacto y zona. */
export const hitOut = { t: 0, nx: 0, ny: 1, nz: 0, zone: 'body' as HitZone };

/** Rayo (o,d unitario) contra esfera; devuelve t o -1. */
export function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const lx = ox - cx;
  const ly = oy - cy;
  const lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const h = b * b - c;
  if (h < 0) return -1;
  const s = Math.sqrt(h);
  const t = -b - s;
  if (t >= 0) return t;
  return c < 0 ? 0 : -1; // origen dentro de la esfera
}

/** Rayo contra cápsula a-b de radio r; devuelve t o -1. */
export function rayCapsule(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number,
): number {
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const baba = bax * bax + bay * bay + baz * baz;
  if (baba < 1e-8) return raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r);
  const oax = ox - ax;
  const oay = oy - ay;
  const oaz = oz - az;
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const A = baba - bard * bard;
  const B = baba * rdoa - baoa * bard;
  const C = baba * oaoa - baoa * baoa - r * r * baba;
  if (A > 1e-9) {
    const h = B * B - A * C;
    if (h >= 0) {
      const t = (-B - Math.sqrt(h)) / A;
      const y = baoa + t * bard;
      if (y > 0 && y < baba && t >= 0) return t;
    }
  }
  // Tapas semiesféricas.
  const t1 = raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r);
  const t2 = raySphere(ox, oy, oz, dx, dy, dz, bx, by, bz, r);
  if (t1 < 0) return t2;
  if (t2 < 0) return t1;
  return Math.min(t1, t2);
}

const W = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0 };

function toWorld(rig: Rig, node: number, x: number, y: number, z: number, isB: boolean): void {
  const e = rig.node(node as 0).matrixWorld.elements;
  const wx = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
  const wy = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
  const wz = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
  if (isB) {
    W.bx = wx; W.by = wy; W.bz = wz;
  } else {
    W.ax = wx; W.ay = wy; W.az = wz;
  }
}

/**
 * Test fino contra las primitivas del rig (matrixWorld vigente). Devuelve la t mínima (o -1) y deja en
 * `hitOut` la normal y la zona.
 */
export function rayRig(rig: Rig, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, headOnlyIfHelm = false): number {
  const prims = getHitbox(rig.type);
  const sc = rig.girth;
  let best = -1;
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i]!;
    if (headOnlyIfHelm && p.zone !== 'head') continue;
    toWorld(rig, p.node, p.ax, p.ay, p.az, false);
    toWorld(rig, p.node, p.bx, p.by, p.bz, true);
    const r = p.r * sc;
    const t = rayCapsule(ox, oy, oz, dx, dy, dz, W.ax, W.ay, W.az, W.bx, W.by, W.bz, r);
    if (t >= 0 && t <= maxDist && (best < 0 || t < best)) {
      best = t;
      hitOut.zone = p.zone;
      // Normal: desde el punto más cercano del eje al punto de impacto.
      const px = ox + dx * t;
      const py = oy + dy * t;
      const pz = oz + dz * t;
      const abx = W.bx - W.ax;
      const aby = W.by - W.ay;
      const abz = W.bz - W.az;
      const l2 = abx * abx + aby * aby + abz * abz;
      let s = l2 > 1e-8 ? ((px - W.ax) * abx + (py - W.ay) * aby + (pz - W.az) * abz) / l2 : 0;
      s = s < 0 ? 0 : s > 1 ? 1 : s;
      let nx = px - (W.ax + abx * s);
      let ny = py - (W.ay + aby * s);
      let nz = pz - (W.az + abz * s);
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      hitOut.nx = nx; hitOut.ny = ny; hitOut.nz = nz;
    }
  }
  hitOut.t = best;
  return best;
}
