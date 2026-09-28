/**
 * Decoración reutilizable (PURA): conjuntos de props (barriles, cajas, vehículos, barricadas, contenedores)
 * y pequeñas estructuras que los constructores de zona combinan para dar variedad al distrito.
 */
import type { LayoutKit } from './kit';
import { OCC } from './kit';
import type { Rect } from './types';

const HALF_PI = Math.PI / 2;

/** Barril ardiendo: llama emisiva + halo parpadeante. */
export function fireBarrel(k: LayoutKit, x: number, z: number): boolean {
  if (!k.prop('barrel', x, z, 0, { variant: 4 })) return false;
  k.cyl(x, z, 0.24, 0.95, 1.45, 'emissiveAmber', { rTop: 0.03, seg: 8, collide: false, cast: false, capTop: false });
  k.glow(x, 1.3, z, 5, 0xff8a3a, 'flicker', 6, 1.0);
  return true;
}

export function barrelCluster(k: LayoutKit, x: number, z: number, n: number, spread = 1.6, toxic = false): number {
  let ok = 0;
  for (let i = 0; i < n; i++) {
    const a = k.rand(0, Math.PI * 2);
    const d = k.rand(0.2, spread);
    const type = toxic && k.chance(0.7) ? 'barrelToxic' : 'barrel';
    if (k.prop(type, x + Math.cos(a) * d, z + Math.sin(a) * d, 0, { variant: k.int(0, 4) })) ok++;
  }
  return ok;
}

/** Pila de cajas de madera/metal de tamaños variados (1-3 niveles). */
export function crateStack(k: LayoutKit, x: number, z: number, rot = k.rand(0, 3), metal = false): boolean {
  const w = k.rand(0.8, 1.4);
  const d = k.rand(0.8, 1.3);
  const h = k.rand(0.7, 1.1);
  const type = metal ? 'crateMetal' : 'crate';
  if (!k.prop(type, x, z, rot, { sx: w, sz: d, sy: h, variant: k.int(0, 2) })) return false;
  if (k.chance(0.45)) {
    k.prop(type, x + k.rand(-0.1, 0.1), z + k.rand(-0.1, 0.1), rot + k.rand(-0.3, 0.3), { y: h, sx: w * 0.8, sz: d * 0.8, sy: k.rand(0.6, 0.9), check: false, variant: k.int(0, 2) });
  }
  return true;
}

export function palletLoad(k: LayoutKit, x: number, z: number, rot = 0): boolean {
  if (!k.prop('cartons', x, z, rot, { variant: k.int(0, 2), sy: k.rand(0.8, 1.15) })) return false;
  k.prop('pallet', x, z, rot, { check: false });
  return true;
}

export function parkCar(k: LayoutKit, x: number, z: number, rot: number, check = true): boolean {
  return k.prop('car', x, z, rot, { variant: k.int(0, 5), check });
}

export function parkTruck(k: LayoutKit, x: number, z: number, rot: number): boolean {
  return k.prop('truck', x, z, rot, { variant: k.int(0, 3) });
}

/** Línea de barreras New Jersey entre dos puntos (extremos incluidos), con huecos opcionales (índices). */
export function jerseyLine(k: LayoutKit, x0: number, z0: number, x1: number, z1: number, skip: readonly number[] = []): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 3.1));
  const rot = Math.atan2(-(z1 - z0), x1 - x0);
  for (let i = 0; i < n; i++) {
    if (skip.includes(i)) continue;
    const t = (i + 0.5) / n;
    k.prop('jersey', x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, rot, { check: false });
  }
}

export function sandbagLine(k: LayoutKit, x0: number, z0: number, x1: number, z1: number): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 1.8));
  const rot = Math.atan2(-(z1 - z0), x1 - x0);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    k.prop('sandbag', x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, rot, { check: false, variant: i % 3 });
  }
}

/** Semicírculo de sacos de arena alrededor de (cx,cz), abierto hacia `openAngle`. */
export function sandbagArc(k: LayoutKit, cx: number, cz: number, radius: number, openAngle: number, openWidth = 1.4): void {
  const n = Math.round((Math.PI * 2 * radius) / 1.8);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const diff = Math.abs(Math.atan2(Math.sin(a - openAngle), Math.cos(a - openAngle)));
    if (diff * radius < openWidth / 2) continue;
    // tangente: el eje local X del saco es perpendicular al radio
    const x = cx + Math.cos(a) * radius;
    const z = cz + Math.sin(a) * radius;
    k.prop('sandbag', x, z, Math.atan2(-Math.cos(a), -Math.sin(a)), { check: false, variant: i % 3 });
  }
}

/**
 * Contenedor(es) apilados. `along` = eje del largo. Devuelve el número de niveles colocados.
 * Los niveles superiores no comprueban ocupación (comparten huella con el inferior).
 */
export function containerStack(k: LayoutKit, x: number, z: number, along: 'x' | 'z', len: 20 | 40, levels: number, variant = k.int(0, 4)): number {
  const type = len === 40 ? 'container40' : 'container20';
  const rot = along === 'x' ? 0 : HALF_PI;
  if (!k.prop(type, x, z, rot, { variant })) return 0;
  let n = 1;
  for (let l = 1; l < levels; l++) {
    k.prop(type, x + k.rand(-0.08, 0.08), z + k.rand(-0.08, 0.08), rot + k.rand(-0.015, 0.015), { y: 2.59 * l, variant: k.int(0, 4), check: false });
    n++;
  }
  return n;
}

/** Contenedor de un nivel con escalera y barandillas: su techo es una plataforma pisable. */
export function climbableContainer(k: LayoutKit, x: number, z: number, along: 'x' | 'z', len: 20 | 40, stairEnd: 1 | -1): boolean {
  const type = len === 40 ? 'container40' : 'container20';
  const L = len === 40 ? 12.19 : 6.06;
  const rot = along === 'x' ? 0 : HALF_PI;
  const dirX = along === 'x';
  const need: Rect = dirX
    ? { minX: x - L / 2 - 4.4, maxX: x + L / 2 + 4.4, minZ: z - 2.2, maxZ: z + 2.2 }
    : { minX: x - 2.2, maxX: x + 2.2, minZ: z - L / 2 - 4.4, maxZ: z + L / 2 + 4.4 };
  if (!k.isFree(need, OCC.struct | OCC.prop | OCC.keep | OCC.lane)) return false;
  if (!k.prop(type, x, z, rot, { variant: k.int(0, 4) })) return false;
  const top = 2.59;
  // escalera desde el extremo elegido, subiendo hacia el contenedor
  const endPos = (dirX ? x : z) + stairEnd * (L / 2);
  const startPos = endPos + stairEnd * 3.45;
  const dir = dirX ? (stairEnd > 0 ? 2 : 0) : (stairEnd > 0 ? 3 : 1);
  const w = 1.3;
  k.stairs(dirX ? startPos : x, dirX ? z : startPos, dir as 0 | 1 | 2 | 3, w, top, 'metalPanel');
  // barandillas (colisionan, no bloquean disparos)
  const railH = 1.0;
  const hz = 1.16;
  const stairSide = stairEnd;
  const railLen = L - 0.2;
  if (dirX) {
    k.box(x, z - hz, railLen, 0.07, top, top + railH, 'steelDark', { ray: false, cast: false });
    k.box(x, z + hz, railLen, 0.07, top, top + railH, 'steelDark', { ray: false, cast: false });
    k.box(x - stairSide * (L / 2 - 0.1), z, 0.07, hz * 2, top, top + railH, 'steelDark', { ray: false, cast: false });
  } else {
    k.box(x - hz, z, 0.07, railLen, top, top + railH, 'steelDark', { ray: false, cast: false });
    k.box(x + hz, z, 0.07, railLen, top, top + railH, 'steelDark', { ray: false, cast: false });
    k.box(x, z - stairSide * (L / 2 - 0.1), hz * 2, 0.07, top, top + railH, 'steelDark', { ray: false, cast: false });
  }
  k.loot(x, z + (dirX ? 3 : 0));
  return true;
}

/** Barricada de carretera: barreras + sacos + un coche atravesado, dejando ≥ `gap` m libres en el centro. */
export function roadBarricade(k: LayoutKit, cx: number, cz: number, alongX: boolean, roadWidth: number, gap = 5.4): void {
  const half = roadWidth / 2;
  const side = half - gap / 2;
  if (side < 0.8) return;
  for (const s of [-1, 1]) {
    const off = s * (gap / 2 + side / 2);
    const x = alongX ? cx : cx + off;
    const z = alongX ? cz + off : cz;
    const a: [number, number] = alongX ? [x, z - side / 2] : [x - side / 2, z];
    const b: [number, number] = alongX ? [x, z + side / 2] : [x + side / 2, z];
    jerseyLine(k, a[0], a[1], b[0], b[1]);
    const ox = alongX ? 1.3 : 0;
    const oz = alongX ? 0 : 1.3;
    sandbagLine(k, a[0] + ox, a[1] + oz, b[0] + ox, b[1] + oz);
  }
}

/** Coches abandonados repartidos por los arcenes de una carretera (fuera del carril central). */
export function roadCars(k: LayoutKit, r: Rect, axis: 'x' | 'z', count: number): void {
  const width = axis === 'x' ? r.maxZ - r.minZ : r.maxX - r.minX;
  if (width < 9.5) return;
  const a0 = axis === 'x' ? r.minX : r.minZ;
  const a1 = axis === 'x' ? r.maxX : r.maxZ;
  const c = axis === 'x' ? (r.minZ + r.maxZ) / 2 : (r.minX + r.maxX) / 2;
  const shoulder = (width - 4.8) / 2;
  let placed = 0;
  for (let i = 0; i < count * 6 && placed < count; i++) {
    const u = k.rand(a0 + 12, a1 - 12);
    const side = k.chance(0.5) ? -1 : 1;
    const lat = side * (2.4 + shoulder / 2 + k.rand(-0.15, 0.15));
    const crash = k.chance(0.3) ? k.rand(-0.5, 0.5) : k.rand(-0.06, 0.06);
    const x = axis === 'x' ? u : c + lat;
    const z = axis === 'x' ? c + lat : u;
    const rot = (axis === 'x' ? 0 : HALF_PI) + (k.chance(0.5) ? 0 : Math.PI) + crash;
    if (k.prop('car', x, z, rot, { variant: k.int(0, 5) })) placed++;
  }
}

/** Tienda de campaña militar con caja y farol. */
export function tentCamp(k: LayoutKit, x: number, z: number, rot: number): boolean {
  if (!k.prop('tent', x, z, rot, { variant: k.int(0, 1) })) return false;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  crateStack(k, x + c * 3.6, z - s * 3.6, rot, false);
  return true;
}

/** Fila de estanterías de almacén a lo largo de X entre x0..x1 (paso 3.2 m). */
export function shelfRow(k: LayoutKit, x0: number, x1: number, z: number, rot = 0): void {
  for (let x = x0 + 1.6; x < x1; x += 3.15) {
    if (!k.prop('shelf', x, z, rot, { variant: k.int(0, 2), check: false })) continue;
  }
}

/** Charco decorativo (disco/mancha plana). */
export function puddle(k: LayoutKit, x: number, z: number, r: number, toxic = false): void {
  k.flat(x, z, r, r, 0.045, toxic ? 'toxic' : 'glass', 'blob');
}
