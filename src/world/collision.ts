/**
 * Colisión PURA del mundo (sin three.js): hash espacial 2D de cajas orientadas (OBB), cilindros y
 * rampas, con alturas. Implementa moveCircle (deslizamiento sin memoria), groundHeight, raycast
 * (DDA sobre el hash), línea de visión y superficie del suelo.
 *
 * Convención: `rot` es el yaw de three.js. Mundo→local: lx = dx·cos − dz·sin, lz = dx·sin + dz·cos;
 * local→mundo: wx = lx·cos + lz·sin, wz = −lx·sin + lz·cos.
 */
import { PLAYER } from '../config';
import type { MoveResult, RayHit } from '../core/context';
import type { SurfaceKind, Vec3 } from '../core/types';
import type { ColliderDef, GroundGrid, Rect } from './types';
import { GROUND_KINDS } from './types';

const SURFACES: readonly SurfaceKind[] = ['concrete', 'metal', 'dirt', 'asphalt', 'flesh', 'glass', 'wood', 'water'];
const SHAPE_BOX = 0;
const SHAPE_CYL = 1;
const SHAPE_RAMP = 2;
const EPS = 1e-9;
/** Avance máximo por subpaso (m): evita atravesar muros finos a 7-8 m/s con dt de 0.05 s. */
const MAX_SUB = 0.16;
const MAX_SUBSTEPS = 32;
const PUSH_ITERS = 5;
/** Radio efectivo con el que se busca suelo pisable (evita "flotar" junto a los bordes). */
const GROUND_PROBE_R = 0.2;

export class CollisionWorld {
  readonly count: number;
  private readonly shape: Uint8Array;
  private readonly cx: Float64Array;
  private readonly cz: Float64Array;
  private readonly hx: Float64Array;
  private readonly hz: Float64Array;
  private readonly cosR: Float64Array;
  private readonly sinR: Float64Array;
  private readonly y0: Float64Array;
  private readonly y1: Float64Array;
  private readonly rampLow: Float64Array;
  private readonly surf: Uint8Array;
  private readonly rayFlag: Uint8Array;
  private readonly minX: Float64Array;
  private readonly maxX: Float64Array;
  private readonly minZ: Float64Array;
  private readonly maxZ: Float64Array;

  // Hash espacial
  private readonly cellSize: number;
  private readonly gx0: number;
  private readonly gz0: number;
  private readonly gcols: number;
  private readonly grows: number;
  private readonly cellStart: Int32Array;
  private readonly cellItems: Int32Array;
  private readonly stamp: Uint32Array;
  private stampId = 0;

  // Suelo
  private readonly ground: GroundGrid | null;
  private readonly groundSurf: Uint8Array;
  private readonly bounds: Rect;

  // Estado de trabajo (sin asignaciones en caliente)
  private px = 0;
  private pz = 0;
  private hitNx = 0;
  private hitNy = 0;
  private hitNz = 0;
  private hitSurf = 0;
  private readonly planeBuf = new Float64Array(24);

  constructor(defs: readonly ColliderDef[], bounds: Rect, ground: GroundGrid | null, cellSize = 8) {
    const n = defs.length;
    this.count = n;
    this.bounds = bounds;
    this.ground = ground;
    this.shape = new Uint8Array(n);
    this.cx = new Float64Array(n);
    this.cz = new Float64Array(n);
    this.hx = new Float64Array(n);
    this.hz = new Float64Array(n);
    this.cosR = new Float64Array(n);
    this.sinR = new Float64Array(n);
    this.y0 = new Float64Array(n);
    this.y1 = new Float64Array(n);
    this.rampLow = new Float64Array(n);
    this.surf = new Uint8Array(n);
    this.rayFlag = new Uint8Array(n);
    this.minX = new Float64Array(n);
    this.maxX = new Float64Array(n);
    this.minZ = new Float64Array(n);
    this.maxZ = new Float64Array(n);
    this.stamp = new Uint32Array(n);

    for (let i = 0; i < n; i++) {
      const d = defs[i] as ColliderDef;
      this.shape[i] = d.shape === 'box' ? SHAPE_BOX : d.shape === 'cyl' ? SHAPE_CYL : SHAPE_RAMP;
      this.cx[i] = d.x;
      this.cz[i] = d.z;
      this.cosR[i] = Math.cos(d.rot);
      this.sinR[i] = Math.sin(d.rot);
      this.y0[i] = d.y0;
      this.y1[i] = d.y1;
      this.rampLow[i] = d.rampLow;
      this.surf[i] = Math.max(0, SURFACES.indexOf(d.surface));
      this.rayFlag[i] = d.ray ? 1 : 0;
      if (d.shape === 'cyl') {
        this.hx[i] = d.r;
        this.hz[i] = d.r;
        this.minX[i] = d.x - d.r;
        this.maxX[i] = d.x + d.r;
        this.minZ[i] = d.z - d.r;
        this.maxZ[i] = d.z + d.r;
      } else {
        this.hx[i] = d.hx;
        this.hz[i] = d.hz;
        const c = Math.abs(this.cosR[i] as number);
        const s = Math.abs(this.sinR[i] as number);
        const ex = c * d.hx + s * d.hz;
        const ez = s * d.hx + c * d.hz;
        this.minX[i] = d.x - ex;
        this.maxX[i] = d.x + ex;
        this.minZ[i] = d.z - ez;
        this.maxZ[i] = d.z + ez;
      }
    }

    // Hash: rejilla uniforme con margen alrededor de los límites.
    this.cellSize = cellSize;
    this.gx0 = bounds.minX - cellSize;
    this.gz0 = bounds.minZ - cellSize;
    this.gcols = Math.ceil((bounds.maxX - bounds.minX + 2 * cellSize) / cellSize);
    this.grows = Math.ceil((bounds.maxZ - bounds.minZ + 2 * cellSize) / cellSize);
    const cells = this.gcols * this.grows;
    const counts = new Int32Array(cells + 1);
    for (let i = 0; i < n; i++) this.forCells(i, (ci) => counts[ci + 1]!++);
    for (let c = 0; c < cells; c++) counts[c + 1]! += counts[c]!;
    this.cellStart = counts;
    this.cellItems = new Int32Array(counts[cells]!);
    const fill = new Int32Array(cells);
    for (let i = 0; i < n; i++) {
      this.forCells(i, (ci) => {
        this.cellItems[this.cellStart[ci]! + fill[ci]!] = i;
        fill[ci]!++;
      });
    }

    this.groundSurf = new Uint8Array(GROUND_KINDS.length);
    for (let k = 0; k < GROUND_KINDS.length; k++) {
      this.groundSurf[k] = Math.max(0, SURFACES.indexOf((GROUND_KINDS[k] as { surface: SurfaceKind }).surface));
    }
  }

  private forCells(i: number, fn: (cellIndex: number) => void): void {
    const cs = this.cellSize;
    const c0 = Math.max(0, Math.floor(((this.minX[i] as number) - this.gx0) / cs));
    const c1 = Math.min(this.gcols - 1, Math.floor(((this.maxX[i] as number) - this.gx0) / cs));
    const r0 = Math.max(0, Math.floor(((this.minZ[i] as number) - this.gz0) / cs));
    const r1 = Math.min(this.grows - 1, Math.floor(((this.maxZ[i] as number) - this.gz0) / cs));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r * this.gcols + c);
  }

  // ── Superficie ─────────────────────────────────────────────────────────────
  surfaceIndexAt(x: number, z: number): number {
    const g = this.ground;
    if (!g) return 3;
    const c = Math.floor((x - g.originX) / g.cell);
    const r = Math.floor((z - g.originZ) / g.cell);
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return 2;
    return this.groundSurf[g.data[r * g.cols + c] as number] as number;
  }

  /** Superficie del suelo bajo (x,z); con `footY` > 0 considera también la cima de cajas/plataformas. */
  surfaceAt(x: number, z: number, footY = 0): SurfaceKind {
    if (footY > 0.05) {
      const s = this.topSurface(x, z, footY);
      if (s >= 0) return SURFACES[s] as SurfaceKind;
    }
    return SURFACES[this.surfaceIndexAt(x, z)] as SurfaceKind;
  }

  private topSurface(x: number, z: number, footY: number): number {
    const cs = this.cellSize;
    const c = Math.floor((x - this.gx0) / cs);
    const r = Math.floor((z - this.gz0) / cs);
    if (c < 0 || r < 0 || c >= this.gcols || r >= this.grows) return -1;
    const ci = r * this.gcols + c;
    const a = this.cellStart[ci] as number;
    const b = this.cellStart[ci + 1] as number;
    for (let k = a; k < b; k++) {
      const i = this.cellItems[k] as number;
      if (Math.abs((this.y1[i] as number) - footY) > 0.2) continue;
      if (this.footprintDist(i, x, z) < GROUND_PROBE_R) return this.surf[i] as number;
    }
    return -1;
  }

  /** Distancia (≥ 0) del punto a la huella del colisionador; 0 si está dentro. */
  private footprintDist(i: number, x: number, z: number): number {
    const dx = x - (this.cx[i] as number);
    const dz = z - (this.cz[i] as number);
    if (this.shape[i] === SHAPE_CYL) return Math.max(0, Math.hypot(dx, dz) - (this.hx[i] as number));
    const c = this.cosR[i] as number;
    const s = this.sinR[i] as number;
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    const ex = Math.max(0, Math.abs(lx) - (this.hx[i] as number));
    const ez = Math.max(0, Math.abs(lz) - (this.hz[i] as number));
    return Math.hypot(ex, ez);
  }

  // ── Movimiento ─────────────────────────────────────────────────────────────
  moveCircle(
    x: number, z: number, dx: number, dz: number, radius: number, footY: number, headY: number, out?: MoveResult,
  ): MoveResult {
    const res = out ?? { x: 0, z: 0, blockedX: false, blockedZ: false };
    const dist = Math.hypot(dx, dz);
    const sub = Math.min(MAX_SUB, radius * 0.5);
    const n = dist > EPS ? Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dist / sub))) : 1;
    const sx = dx / n;
    const sz = dz / n;
    this.px = x;
    this.pz = z;
    for (let s = 0; s < n; s++) {
      this.px += sx;
      this.pz += sz;
      this.pushOut(radius, footY, headY);
    }
    const b = this.bounds;
    const m = 0.4;
    this.px = Math.min(b.maxX - m, Math.max(b.minX + m, this.px));
    this.pz = Math.min(b.maxZ - m, Math.max(b.minZ + m, this.pz));
    res.x = this.px;
    res.z = this.pz;
    res.blockedX = Math.abs(this.px - (x + dx)) > 1e-4;
    res.blockedZ = Math.abs(this.pz - (z + dz)) > 1e-4;
    return res;
  }

  /** Expulsa el círculo (this.px, this.pz) de los colisionadores que bloquean a esa altura. */
  private pushOut(r: number, footY: number, headY: number): void {
    const stepTop = footY + PLAYER.stepHeight;
    const cs = this.cellSize;
    const r2 = r * r;
    for (let it = 0; it < PUSH_ITERS; it++) {
      let moved = false;
      const id = ++this.stampId;
      const px = this.px;
      const pz = this.pz;
      const c0 = Math.max(0, Math.floor((px - r - this.gx0) / cs));
      const c1 = Math.min(this.gcols - 1, Math.floor((px + r - this.gx0) / cs));
      const r0 = Math.max(0, Math.floor((pz - r - this.gz0) / cs));
      const r1 = Math.min(this.grows - 1, Math.floor((pz + r - this.gz0) / cs));
      for (let rr = r0; rr <= r1; rr++) {
        for (let cc = c0; cc <= c1; cc++) {
          const ci = rr * this.gcols + cc;
          const end = this.cellStart[ci + 1] as number;
          for (let k = this.cellStart[ci] as number; k < end; k++) {
            const i = this.cellItems[k] as number;
            if (this.stamp[i] === id) continue;
            this.stamp[i] = id;
            if (this.y0[i]! >= headY) continue;
            if (this.px + r <= this.minX[i]! || this.px - r >= this.maxX[i]! || this.pz + r <= this.minZ[i]! || this.pz - r >= this.maxZ[i]!) continue;
            const sh = this.shape[i] as number;
            if (sh === SHAPE_CYL) {
              if (this.y1[i]! <= stepTop) continue;
              const ddx = this.px - this.cx[i]!;
              const ddz = this.pz - this.cz[i]!;
              const rad = this.hx[i]! + r;
              const d2 = ddx * ddx + ddz * ddz;
              if (d2 >= rad * rad) continue;
              if (d2 > EPS) {
                const d = Math.sqrt(d2);
                const push = rad - d;
                this.px += (ddx / d) * push;
                this.pz += (ddz / d) * push;
              } else {
                this.px += rad;
              }
              moved = true;
              continue;
            }
            // Caja / rampa (espacio local)
            const c = this.cosR[i] as number;
            const s = this.sinR[i] as number;
            const ddx = this.px - this.cx[i]!;
            const ddz = this.pz - this.cz[i]!;
            const lx = ddx * c - ddz * s;
            const lz = ddx * s + ddz * c;
            const bx = this.hx[i] as number;
            const bz = this.hz[i] as number;
            if (sh === SHAPE_BOX) {
              if (this.y1[i]! <= stepTop) continue;
            } else {
              const dzOut = Math.max(0, Math.abs(lz) - bz);
              if (dzOut >= r) continue;
              const reach = Math.sqrt(r2 - dzOut * dzOut);
              if (lx - reach > bx || lx + reach < -bx) continue;
              const lxMax = Math.min(bx, lx + reach);
              const h = this.rampLow[i]! + (this.y1[i]! - this.rampLow[i]!) * ((lxMax + bx) / (2 * bx));
              if (h <= stepTop) continue;
            }
            const qx = lx < -bx ? -bx : lx > bx ? bx : lx;
            const qz = lz < -bz ? -bz : lz > bz ? bz : lz;
            const ex = lx - qx;
            const ez = lz - qz;
            const d2 = ex * ex + ez * ez;
            if (d2 >= r2) continue;
            let nx: number;
            let nz: number;
            let push: number;
            if (d2 > EPS) {
              const d = Math.sqrt(d2);
              nx = ex / d;
              nz = ez / d;
              push = r - d;
            } else {
              const penX = bx - Math.abs(lx);
              const penZ = bz - Math.abs(lz);
              if (penX < penZ) {
                nx = lx >= 0 ? 1 : -1;
                nz = 0;
                push = penX + r;
              } else {
                nx = 0;
                nz = lz >= 0 ? 1 : -1;
                push = penZ + r;
              }
            }
            this.px += (nx * c + nz * s) * push;
            this.pz += (-nx * s + nz * c) * push;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
  }

  // ── Suelo pisable ──────────────────────────────────────────────────────────
  groundHeight(x: number, z: number, radius: number, footY: number): number {
    const r = Math.min(radius, GROUND_PROBE_R);
    const limit = footY + PLAYER.stepHeight + 1e-4;
    let best = 0;
    const cs = this.cellSize;
    const c0 = Math.max(0, Math.floor((x - r - this.gx0) / cs));
    const c1 = Math.min(this.gcols - 1, Math.floor((x + r - this.gx0) / cs));
    const r0 = Math.max(0, Math.floor((z - r - this.gz0) / cs));
    const r1 = Math.min(this.grows - 1, Math.floor((z + r - this.gz0) / cs));
    const id = ++this.stampId;
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        const ci = rr * this.gcols + cc;
        const end = this.cellStart[ci + 1] as number;
        for (let k = this.cellStart[ci] as number; k < end; k++) {
          const i = this.cellItems[k] as number;
          if (this.stamp[i] === id) continue;
          this.stamp[i] = id;
          const sh = this.shape[i] as number;
          let top: number;
          if (sh === SHAPE_RAMP) {
            const dx = x - this.cx[i]!;
            const dz = z - this.cz[i]!;
            const c = this.cosR[i] as number;
            const s = this.sinR[i] as number;
            const lx = dx * c - dz * s;
            const lz = dx * s + dz * c;
            const bx = this.hx[i] as number;
            const bz = this.hz[i] as number;
            const ex = Math.max(0, Math.abs(lx) - bx);
            const ez = Math.max(0, Math.abs(lz) - bz);
            if (ex * ex + ez * ez >= r * r) continue;
            const lc = lx < -bx ? -bx : lx > bx ? bx : lx;
            top = this.rampLow[i]! + (this.y1[i]! - this.rampLow[i]!) * ((lc + bx) / (2 * bx));
          } else {
            top = this.y1[i] as number;
            if (top > limit || top <= best) continue;
            if (this.footprintDist(i, x, z) >= r) continue;
          }
          if (top <= limit && top > best) best = top;
        }
      }
    }
    return best;
  }

  // ── Rayos ──────────────────────────────────────────────────────────────────
  raycast(origin: Vec3, dir: Vec3, maxDist: number): RayHit | null {
    let dx = dir.x;
    let dy = dir.y;
    let dz = dir.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < EPS || maxDist <= 0) return null;
    if (Math.abs(len - 1) > 1e-6) {
      dx /= len;
      dy /= len;
      dz /= len;
    }
    const t = this.trace(origin.x, origin.y, origin.z, dx, dy, dz, maxDist, true);
    if (t < 0) return null;
    return {
      distance: t,
      point: { x: origin.x + dx * t, y: origin.y + dy * t, z: origin.z + dz * t },
      normal: { x: this.hitNx, y: this.hitNy, z: this.hitNz },
      surface: SURFACES[this.hitSurf] as SurfaceKind,
    };
  }

  /** Distancia al primer impacto o -1. No asigna memoria (sin objeto de resultado). */
  rayDistance(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number {
    return this.trace(ox, oy, oz, dx, dy, dz, maxDist, true);
  }

  hasLineOfSight(a: Vec3, b: Vec3): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    const inv = 1 / len;
    return this.trace(a.x, a.y, a.z, dx * inv, dy * inv, dz * inv, len - 0.02, false) < 0;
  }

  /** DDA sobre el hash 2D; devuelve t del impacto más cercano (≤ maxDist) o -1. */
  private trace(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, useGround: boolean): number {
    let best = maxDist;
    let found = false;
    this.hitSurf = 3;
    if (useGround && dy < 0 && oy > 0) {
      const t = -oy / dy;
      if (t <= best) {
        best = t;
        found = true;
        this.hitNx = 0;
        this.hitNy = 1;
        this.hitNz = 0;
        this.hitSurf = this.surfaceIndexAt(ox + dx * t, oz + dz * t);
      }
    }
    const cs = this.cellSize;
    const gx1 = this.gx0 + this.gcols * cs;
    const gz1 = this.gz0 + this.grows * cs;
    // Recorte del rayo a la rejilla del hash
    let t0 = 0;
    if (ox < this.gx0 || ox >= gx1 || oz < this.gz0 || oz >= gz1) {
      let tn = 0;
      let tf = best;
      if (Math.abs(dx) < EPS) {
        if (ox < this.gx0 || ox >= gx1) return found ? best : -1;
      } else {
        let a = (this.gx0 - ox) / dx;
        let b = (gx1 - ox) / dx;
        if (a > b) [a, b] = [b, a];
        tn = Math.max(tn, a);
        tf = Math.min(tf, b);
      }
      if (Math.abs(dz) < EPS) {
        if (oz < this.gz0 || oz >= gz1) return found ? best : -1;
      } else {
        let a = (this.gz0 - oz) / dz;
        let b = (gz1 - oz) / dz;
        if (a > b) [a, b] = [b, a];
        tn = Math.max(tn, a);
        tf = Math.min(tf, b);
      }
      if (tn > tf) return found ? best : -1;
      t0 = tn + 1e-6;
    }
    const sxp = ox + dx * t0;
    const szp = oz + dz * t0;
    let ix = Math.min(this.gcols - 1, Math.max(0, Math.floor((sxp - this.gx0) / cs)));
    let iz = Math.min(this.grows - 1, Math.max(0, Math.floor((szp - this.gz0) / cs)));
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) > EPS ? cs / Math.abs(dx) : Infinity;
    const tDeltaZ = Math.abs(dz) > EPS ? cs / Math.abs(dz) : Infinity;
    let tMaxX = Math.abs(dx) > EPS ? ((dx > 0 ? this.gx0 + (ix + 1) * cs - ox : ox - (this.gx0 + ix * cs)) / Math.abs(dx)) : Infinity;
    let tMaxZ = Math.abs(dz) > EPS ? ((dz > 0 ? this.gz0 + (iz + 1) * cs - oz : oz - (this.gz0 + iz * cs)) / Math.abs(dz)) : Infinity;
    const id = ++this.stampId;
    for (;;) {
      const ci = iz * this.gcols + ix;
      const end = this.cellStart[ci + 1] as number;
      for (let k = this.cellStart[ci] as number; k < end; k++) {
        const i = this.cellItems[k] as number;
        if (this.stamp[i] === id) continue;
        this.stamp[i] = id;
        if (this.rayFlag[i] === 0) continue;
        const sh = this.shape[i] as number;
        const t = sh === SHAPE_BOX ? this.rayBox(i, ox, oy, oz, dx, dy, dz, best)
          : sh === SHAPE_CYL ? this.rayCyl(i, ox, oy, oz, dx, dy, dz, best)
            : this.rayRamp(i, ox, oy, oz, dx, dy, dz, best);
        if (t >= 0) {
          best = t;
          found = true;
          this.hitSurf = this.surf[i] as number;
        }
      }
      if (tMaxX < tMaxZ) {
        if (tMaxX > best) break;
        ix += stepX;
        tMaxX += tDeltaX;
        if (ix < 0 || ix >= this.gcols) break;
      } else {
        if (tMaxZ > best) break;
        if (tMaxZ === Infinity) break;
        iz += stepZ;
        tMaxZ += tDeltaZ;
        if (iz < 0 || iz >= this.grows) break;
      }
    }
    return found ? best : -1;
  }

  /** Rayo vs. caja orientada. Devuelve t < best o -1 (origen dentro = ignorado). Escribe la normal. */
  private rayBox(i: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, best: number): number {
    const c = this.cosR[i] as number;
    const s = this.sinR[i] as number;
    const px = ox - (this.cx[i] as number);
    const pz = oz - (this.cz[i] as number);
    const lox = px * c - pz * s;
    const loz = px * s + pz * c;
    const ldx = dx * c - dz * s;
    const ldz = dx * s + dz * c;
    const bx = this.hx[i] as number;
    const bz = this.hz[i] as number;
    let tmin = -Infinity;
    let tmax = Infinity;
    let axis = -1;
    let sgn = 0;
    // X
    if (Math.abs(ldx) < EPS) {
      if (Math.abs(lox) > bx) return -1;
    } else {
      const inv = 1 / ldx;
      let t1 = (-bx - lox) * inv;
      let t2 = (bx - lox) * inv;
      let sg = -1;
      if (t1 > t2) {
        const tt = t1;
        t1 = t2;
        t2 = tt;
        sg = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        axis = 0;
        sgn = sg;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    // Y
    const y0 = this.y0[i] as number;
    const y1 = this.y1[i] as number;
    if (Math.abs(dy) < EPS) {
      if (oy < y0 || oy > y1) return -1;
    } else {
      const inv = 1 / dy;
      let t1 = (y0 - oy) * inv;
      let t2 = (y1 - oy) * inv;
      let sg = -1;
      if (t1 > t2) {
        const tt = t1;
        t1 = t2;
        t2 = tt;
        sg = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        axis = 1;
        sgn = sg;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    // Z
    if (Math.abs(ldz) < EPS) {
      if (Math.abs(loz) > bz) return -1;
    } else {
      const inv = 1 / ldz;
      let t1 = (-bz - loz) * inv;
      let t2 = (bz - loz) * inv;
      let sg = -1;
      if (t1 > t2) {
        const tt = t1;
        t1 = t2;
        t2 = tt;
        sg = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        axis = 2;
        sgn = sg;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    if (tmin < 0 || tmin >= best || axis < 0) return -1;
    if (axis === 0) {
      this.hitNx = sgn * c;
      this.hitNy = 0;
      this.hitNz = -sgn * s;
    } else if (axis === 1) {
      this.hitNx = 0;
      this.hitNy = sgn;
      this.hitNz = 0;
    } else {
      this.hitNx = sgn * s;
      this.hitNy = 0;
      this.hitNz = sgn * c;
    }
    return tmin;
  }

  private rayCyl(i: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, best: number): number {
    const R = this.hx[i] as number;
    const y0 = this.y0[i] as number;
    const y1 = this.y1[i] as number;
    const px = ox - (this.cx[i] as number);
    const pz = oz - (this.cz[i] as number);
    let tHit = best;
    let ok = false;
    const a = dx * dx + dz * dz;
    if (a > EPS) {
      const b = px * dx + pz * dz;
      const cc = px * px + pz * pz - R * R;
      const disc = b * b - a * cc;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / a;
        if (t >= 0 && t < tHit) {
          const y = oy + dy * t;
          if (y >= y0 && y <= y1) {
            tHit = t;
            ok = true;
            const hx = px + dx * t;
            const hz = pz + dz * t;
            this.hitNx = hx / R;
            this.hitNy = 0;
            this.hitNz = hz / R;
          }
        }
      }
    }
    if (Math.abs(dy) > EPS) {
      // Tapa superior (dy<0) e inferior (dy>0)
      const plane = dy < 0 ? y1 : y0;
      const t = (plane - oy) / dy;
      if (t >= 0 && t < tHit) {
        const hx = px + dx * t;
        const hz = pz + dz * t;
        if (hx * hx + hz * hz <= R * R) {
          tHit = t;
          ok = true;
          this.hitNx = 0;
          this.hitNy = dy < 0 ? 1 : -1;
          this.hitNz = 0;
        }
      }
    }
    return ok ? tHit : -1;
  }

  /** Rayo vs. cuña de rampa por recorte de semiespacios (sólido convexo). */
  private rayRamp(i: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, best: number): number {
    const c = this.cosR[i] as number;
    const s = this.sinR[i] as number;
    const px = ox - (this.cx[i] as number);
    const pz = oz - (this.cz[i] as number);
    const lox = px * c - pz * s;
    const loz = px * s + pz * c;
    const ldx = dx * c - dz * s;
    const ldz = dx * s + dz * c;
    const bx = this.hx[i] as number;
    const bz = this.hz[i] as number;
    const yb = this.y0[i] as number;
    const low = this.rampLow[i] as number;
    const k = (((this.y1[i] as number) - low) / (2 * bx));
    let tmin = -Infinity;
    let tmax = Infinity;
    let nlx = 0;
    let nly = 0;
    let nlz = 0;
    // Planos (nx, ny, nz, d) con n·p <= d, en un buffer reutilizable (sin asignaciones).
    const pb = this.planeBuf;
    pb.set([-1, 0, 0, bx, 1, 0, 0, bx, 0, 0, -1, bz, 0, 0, 1, bz, 0, -1, 0, -yb, -k, 1, 0, low + k * bx]);
    for (let p = 0; p < 24; p += 4) {
      const pnx = pb[p] as number;
      const pny = pb[p + 1] as number;
      const pnz = pb[p + 2] as number;
      const pd = pb[p + 3] as number;
      const nd = pnx * ldx + pny * dy + pnz * ldz;
      const no = pnx * lox + pny * oy + pnz * loz;
      if (Math.abs(nd) < EPS) {
        if (no > pd) return -1;
        continue;
      }
      const t = (pd - no) / nd;
      if (nd < 0) {
        if (t > tmin) {
          tmin = t;
          nlx = pnx;
          nly = pny;
          nlz = pnz;
        }
      } else if (t < tmax) tmax = t;
      if (tmin > tmax) return -1;
    }
    if (tmin < 0 || tmin >= best) return -1;
    const inv = 1 / Math.hypot(nlx, nly, nlz);
    nlx *= inv;
    nly *= inv;
    nlz *= inv;
    this.hitNx = nlx * c + nlz * s;
    this.hitNy = nly;
    this.hitNz = -nlx * s + nlz * c;
    return tmin;
  }
}
