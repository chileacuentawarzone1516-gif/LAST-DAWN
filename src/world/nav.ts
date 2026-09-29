/**
 * Navegación PURA: rejilla de celdas de `MAP.navCell` m construida inflando los colisionadores por el
 * radio del agente, flood-fill de conectividad y selección de puntos de aparición / botín.
 */
import { MAP, WORLD } from '../config';
import type { NavGrid } from '../core/context';
import type { Vec2, ZoneId } from '../core/types';
import { createRng } from '../core/util';
import { zoneAt } from '../rules/zones';
import type { ColliderDef, LootAnchor, PoiDef, Rect } from './types';

export class Grid2D implements NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly originX: number;
  readonly originZ: number;

  constructor(bounds: Rect, readonly cell: number, readonly walkable: Uint8Array) {
    this.cols = Math.ceil((bounds.maxX - bounds.minX) / cell);
    this.rows = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
    this.originX = bounds.minX;
    this.originZ = bounds.minZ;
  }

  cellIndex(x: number, z: number): number {
    const c = Math.floor((x - this.originX) / this.cell);
    const r = Math.floor((z - this.originZ) / this.cell);
    return c < 0 || r < 0 || c >= this.cols || r >= this.rows ? -1 : r * this.cols + c;
  }

  isWalkable(x: number, z: number): boolean {
    const i = this.cellIndex(x, z);
    return i >= 0 && this.walkable[i] === 1;
  }

  cellCenter(index: number, out: Vec2): Vec2 {
    out.x = this.originX + ((index % this.cols) + 0.5) * this.cell;
    out.z = this.originZ + (Math.floor(index / this.cols) + 0.5) * this.cell;
    return out;
  }
}

export interface NavBuildOptions {
  cell: number;
  agentRadius: number;
  blockMinY: number;
  blockMaxY: number;
}

export const defaultNavOptions = (): NavBuildOptions => ({
  cell: MAP.navCell,
  agentRadius: WORLD.nav.agentRadius,
  blockMinY: WORLD.nav.blockMinY,
  blockMaxY: WORLD.nav.blockMaxY,
});

/** ¿El colisionador bloquea el paso a pie (su tramo vertical cruza [minY, maxY])? */
export function blocksNav(c: ColliderDef, minY: number, maxY: number): boolean {
  return c.y1 > minY && c.y0 < maxY;
}

/** Distancia del punto a la huella del colisionador (0 dentro). */
function footprintDist(c: ColliderDef, cs: number, sn: number, x: number, z: number): number {
  const dx = x - c.x;
  const dz = z - c.z;
  if (c.shape === 'cyl') return Math.max(0, Math.hypot(dx, dz) - c.r);
  const lx = dx * cs - dz * sn;
  const lz = dx * sn + dz * cs;
  return Math.hypot(Math.max(0, Math.abs(lx) - c.hx), Math.max(0, Math.abs(lz) - c.hz));
}

/** Construye la rejilla de transitabilidad (1 = libre) para un agente de radio `agentRadius`. */
export function buildNav(colliders: readonly ColliderDef[], bounds: Rect, opts: NavBuildOptions = defaultNavOptions()): Grid2D {
  const { cell, agentRadius } = opts;
  const cols = Math.ceil((bounds.maxX - bounds.minX) / cell);
  const rows = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
  const walkable = new Uint8Array(cols * rows).fill(1);
  const half = cell * 0.5;
  for (const c of colliders) {
    if (!blocksNav(c, opts.blockMinY, opts.blockMaxY)) continue;
    const cs = Math.cos(c.rot);
    const sn = Math.sin(c.rot);
    const ex = c.shape === 'cyl' ? c.r : Math.abs(cs) * c.hx + Math.abs(sn) * c.hz;
    const ez = c.shape === 'cyl' ? c.r : Math.abs(sn) * c.hx + Math.abs(cs) * c.hz;
    // Barreras finas (vallas, muretes): conservador, evalúa el cuadrado entero de la celda.
    const thin = c.shape !== 'cyl' && Math.min(c.hx, c.hz) * 2 < 1.1 && Math.max(c.hx, c.hz) * 2 > 2.5;
    const margin = agentRadius + (thin ? half : 0);
    const limit = agentRadius + (thin ? half * 0.8 : 0);
    const c0 = Math.max(0, Math.floor((c.x - ex - margin - bounds.minX) / cell));
    const c1 = Math.min(cols - 1, Math.floor((c.x + ex + margin - bounds.minX) / cell));
    const r0 = Math.max(0, Math.floor((c.z - ez - margin - bounds.minZ) / cell));
    const r1 = Math.min(rows - 1, Math.floor((c.z + ez + margin - bounds.minZ) / cell));
    for (let r = r0; r <= r1; r++) {
      for (let cc = c0; cc <= c1; cc++) {
        const idx = r * cols + cc;
        if (walkable[idx] === 0) continue;
        const px = bounds.minX + (cc + 0.5) * cell;
        const pz = bounds.minZ + (r + 0.5) * cell;
        const d = footprintDist(c, cs, sn, px, pz);
        if (d < limit) walkable[idx] = 0;
      }
    }
  }
  return new Grid2D(bounds, cell, walkable);
}

/** Celdas cubiertas por un techo/voladizo (colisionador con base por encima de la cabeza). */
export function buildCovered(colliders: readonly ColliderDef[], nav: NavGrid, minBase: number): Uint8Array {
  const covered = new Uint8Array(nav.cols * nav.rows);
  for (const c of colliders) {
    if (c.y0 < minBase || c.shape === 'ramp') continue;
    const cs = Math.cos(c.rot);
    const sn = Math.sin(c.rot);
    const ex = c.shape === 'cyl' ? c.r : Math.abs(cs) * c.hx + Math.abs(sn) * c.hz;
    const ez = c.shape === 'cyl' ? c.r : Math.abs(sn) * c.hx + Math.abs(cs) * c.hz;
    const c0 = Math.max(0, Math.floor((c.x - ex - nav.originX) / nav.cell));
    const c1 = Math.min(nav.cols - 1, Math.floor((c.x + ex - nav.originX) / nav.cell));
    const r0 = Math.max(0, Math.floor((c.z - ez - nav.originZ) / nav.cell));
    const r1 = Math.min(nav.rows - 1, Math.floor((c.z + ez - nav.originZ) / nav.cell));
    for (let r = r0; r <= r1; r++) {
      for (let cc = c0; cc <= c1; cc++) {
        const px = nav.originX + (cc + 0.5) * nav.cell;
        const pz = nav.originZ + (r + 0.5) * nav.cell;
        if (footprintDist(c, cs, sn, px, pz) <= 0) covered[r * nav.cols + cc] = 1;
      }
    }
  }
  return covered;
}

const NEIGH: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Celda transitable más cercana a (x,z) dentro de `maxRing` anillos; -1 si no hay. */
export function nearestWalkable(nav: NavGrid, x: number, z: number, maxRing = 4): number {
  const c0 = Math.floor((x - nav.originX) / nav.cell);
  const r0 = Math.floor((z - nav.originZ) / nav.cell);
  let best = -1;
  let bestD = Infinity;
  for (let dr = -maxRing; dr <= maxRing; dr++) {
    for (let dc = -maxRing; dc <= maxRing; dc++) {
      const c = c0 + dc;
      const r = r0 + dr;
      if (c < 0 || r < 0 || c >= nav.cols || r >= nav.rows) continue;
      const idx = r * nav.cols + c;
      if (nav.walkable[idx] !== 1) continue;
      const px = nav.originX + (c + 0.5) * nav.cell;
      const pz = nav.originZ + (r + 0.5) * nav.cell;
      const d = (px - x) * (px - x) + (pz - z) * (pz - z);
      if (d < bestD) {
        bestD = d;
        best = idx;
      }
    }
  }
  return best;
}

/**
 * Celdas alcanzables desde (x,z) (8 vecinos sin cortar esquinas). Devuelve una máscara (1 = alcanzable).
 * Si el punto de partida no es transitable se usa la celda libre más cercana.
 */
export function floodReachable(nav: NavGrid, x: number, z: number): Uint8Array {
  const reach = new Uint8Array(nav.cols * nav.rows);
  const start = nav.isWalkable(x, z) ? nav.cellIndex(x, z) : nearestWalkable(nav, x, z, 6);
  if (start < 0) return reach;
  const queue = new Int32Array(nav.cols * nav.rows);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  reach[start] = 1;
  const { cols, rows, walkable } = nav;
  while (head < tail) {
    const cur = queue[head++] as number;
    const cx = cur % cols;
    const cy = (cur - cx) / cols;
    for (let k = 0; k < 8; k++) {
      const d = NEIGH[k] as readonly [number, number];
      const nx = cx + d[0];
      const ny = cy + d[1];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (reach[ni] === 1 || walkable[ni] !== 1) continue;
      if (d[0] !== 0 && d[1] !== 0 && (walkable[cy * cols + nx] !== 1 || walkable[ny * cols + cx] !== 1)) continue;
      reach[ni] = 1;
      queue[tail++] = ni;
    }
  }
  return reach;
}

export interface PointSets {
  spawnPoints: Record<ZoneId, Vec2[]>;
  lootSpots: Record<ZoneId, Vec2[]>;
}

const ZONES: readonly ZoneId[] = ['perimeter', 'warehouses', 'refinery', 'complex'];

/**
 * Selecciona puntos de aparición (a cielo abierto, con holgura, lejos del jugador y del pad) y de
 * botín (junto a props y dentro de naves), todos alcanzables desde el punto de inicio del jugador.
 */
export function pickPoints(
  nav: NavGrid, reach: Uint8Array, covered: Uint8Array, anchors: readonly LootAnchor[], pois: readonly PoiDef[], seed: number,
): PointSets {
  const rng = createRng(seed ^ 0x51ed);
  const spawnPoints = { perimeter: [], warehouses: [], refinery: [], complex: [] } as Record<ZoneId, Vec2[]>;
  const lootSpots = { perimeter: [], warehouses: [], refinery: [], complex: [] } as Record<ZoneId, Vec2[]>;
  const { cols, rows, walkable } = nav;
  const cellC = (idx: number): Vec2 => nav.cellCenter(idx, { x: 0, z: 0 });
  const free8 = (idx: number): boolean => {
    const cx = idx % cols;
    const cy = (idx - cx) / cols;
    for (let k = 0; k < 8; k++) {
      const d = NEIGH[k] as readonly [number, number];
      const nx = cx + d[0];
      const ny = cy + d[1];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || walkable[ny * cols + nx] !== 1) return false;
    }
    return true;
  };
  const nearPoi = (x: number, z: number, r: number): boolean => pois.some((p) => Math.hypot(p.x - x, p.z - z) < r);
  const lz = MAP.lz;
  const pad = lz.padRadius + 4;

  // ── Aparición ──────────────────────────────────────────────────────────────
  const cand: Record<ZoneId, Vec2[]> = { perimeter: [], warehouses: [], refinery: [], complex: [] };
  for (let idx = 0; idx < cols * rows; idx++) {
    if (walkable[idx] !== 1 || reach[idx] !== 1 || covered[idx] === 1 || !free8(idx)) continue;
    const p = cellC(idx);
    if (Math.hypot(p.x - MAP.spawn.x, p.z - MAP.spawn.z) < WORLD.spawnMinPlayerDist) continue;
    if (Math.hypot(p.x - lz.center.x, p.z - lz.center.z) < pad) continue;
    if (nearPoi(p.x, p.z, 6)) continue;
    cand[zoneAt(p.x, p.z)].push(p);
  }
  for (const zone of ZONES) {
    const list = cand[zone];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j] as Vec2, list[i] as Vec2];
    }
    let spacing = 14;
    while (spawnPoints[zone].length < WORLD.spawnPointsPerZone && spacing >= 2) {
      const out: Vec2[] = [];
      for (const p of list) {
        if (out.length >= WORLD.spawnPointsPerZone * 2) break;
        let ok = true;
        for (const q of out) {
          if (Math.hypot(p.x - q.x, p.z - q.z) < spacing) {
            ok = false;
            break;
          }
        }
        if (ok) out.push(p);
      }
      spawnPoints[zone] = out;
      spacing -= 1.5;
    }
  }

  // ── Botín ──────────────────────────────────────────────────────────────────
  const taken = new Set<number>();
  const addLoot = (zone: ZoneId, idx: number, minSep: number): boolean => {
    const p = cellC(idx);
    for (const q of lootSpots[zone]) if (Math.hypot(p.x - q.x, p.z - q.z) < minSep) return false;
    if (Math.hypot(p.x - MAP.spawn.x, p.z - MAP.spawn.z) < 6 || nearPoi(p.x, p.z, 3.5)) return false;
    if (zoneAt(p.x, p.z) !== zone) return false;
    taken.add(idx);
    lootSpots[zone].push(p);
    return true;
  };
  for (const a of anchors) {
    const idx = nearestWalkable(nav, a.x, a.z, 3);
    if (idx < 0 || reach[idx] !== 1 || taken.has(idx)) continue;
    addLoot(a.zone, idx, 2.5);
  }
  // Relleno: celdas junto a paredes/props (vecino ortogonal bloqueado), alcanzables.
  const edge: Record<ZoneId, number[]> = { perimeter: [], warehouses: [], refinery: [], complex: [] };
  for (let idx = 0; idx < cols * rows; idx++) {
    if (walkable[idx] !== 1 || reach[idx] !== 1 || taken.has(idx)) continue;
    const cx = idx % cols;
    const cy = (idx - cx) / cols;
    const near = (cx > 0 && walkable[idx - 1] !== 1) || (cx < cols - 1 && walkable[idx + 1] !== 1) ||
      (cy > 0 && walkable[idx - cols] !== 1) || (cy < rows - 1 && walkable[idx + cols] !== 1);
    if (near) edge[zoneAt(cellC(idx).x, cellC(idx).z)].push(idx);
  }
  for (const zone of ZONES) {
    const list = edge[zone];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j] as number, list[i] as number];
    }
    let sep = 8;
    while (lootSpots[zone].length < WORLD.lootSpotsPerZone && sep >= 2) {
      for (const idx of list) {
        if (lootSpots[zone].length >= WORLD.lootSpotsPerZone) break;
        if (!taken.has(idx)) addLoot(zone, idx, sep);
      }
      sep -= 1.5;
    }
  }
  return { spawnPoints, lootSpots };
}
