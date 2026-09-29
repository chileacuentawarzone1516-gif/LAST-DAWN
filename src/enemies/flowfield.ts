/**
 * Campo de flujo sobre la malla de navegación (NavGrid.walkable): Dijkstra con 8 vecinos (sin cortar
 * esquinas) desde un objetivo, acotado a un radio. Se comparte entre todos los infectados: cada uno sólo
 * consulta el gradiente de su celda con `sample()`. Sin asignaciones tras el constructor.
 */
import type { NavGrid } from '../core/context';

const SQRT2 = Math.SQRT2;
/** Vecinos: desplazamientos de columna/fila y si son diagonales. */
const DC = [1, -1, 0, 0, 1, 1, -1, -1];
const DR = [0, 0, 1, -1, 1, -1, 1, -1];

export interface FlowDir {
  x: number;
  z: number;
}

export class FlowField {
  private readonly dist: Float32Array;
  private readonly stamp: Uint32Array;
  private readonly heapKey: Float32Array;
  private readonly heapIdx: Int32Array;
  private heapN = 0;
  private cur = 0;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cell: number;
  private readonly ox: number;
  private readonly oz: number;
  private readonly walk: Uint8Array;

  /** Objetivo real (m) de la última construcción y si hay campo válido. */
  targetX = 0;
  targetZ = 0;
  valid = false;
  /** Estadísticas de la última construcción. */
  lastBuildMs = 0;
  cellsReached = 0;
  builds = 0;

  constructor(nav: NavGrid) {
    this.cols = nav.cols;
    this.rows = nav.rows;
    this.cell = nav.cell;
    this.ox = nav.originX;
    this.oz = nav.originZ;
    this.walk = nav.walkable;
    const n = nav.cols * nav.rows;
    this.dist = new Float32Array(n);
    this.stamp = new Uint32Array(n);
    const cap = Math.min(n * 4, 1 << 18);
    this.heapKey = new Float32Array(cap);
    this.heapIdx = new Int32Array(cap);
  }

  private push(key: number, idx: number): void {
    if (this.heapN >= this.heapKey.length) return;
    let i = this.heapN++;
    const hk = this.heapKey;
    const hi = this.heapIdx;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p]! <= key) break;
      hk[i] = hk[p]!;
      hi[i] = hi[p]!;
      i = p;
    }
    hk[i] = key;
    hi[i] = idx;
  }

  private popIdx(): number {
    const hk = this.heapKey;
    const hi = this.heapIdx;
    const top = hi[0]!;
    const n = --this.heapN;
    if (n > 0) {
      const key = hk[n]!;
      const idx = hi[n]!;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && hk[c + 1]! < hk[c]!) c++;
        if (hk[c]! >= key) break;
        hk[i] = hk[c]!;
        hi[i] = hi[c]!;
        i = c;
      }
      hk[i] = key;
      hi[i] = idx;
    }
    return top;
  }

  /** Celda transitable más cercana a (x,z) en un radio de `maxCells`; -1 si no hay ninguna. */
  nearestWalkableCell(x: number, z: number, maxCells: number): number {
    const c0 = Math.floor((x - this.ox) / this.cell);
    const r0 = Math.floor((z - this.oz) / this.cell);
    let best = -1;
    let bestD = Infinity;
    for (let dr = -maxCells; dr <= maxCells; dr++) {
      for (let dc = -maxCells; dc <= maxCells; dc++) {
        const c = c0 + dc;
        const r = r0 + dr;
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
        const i = r * this.cols + c;
        if (this.walk[i] !== 1) continue;
        const d = dc * dc + dr * dr;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    return best;
  }

  /** Reconstruye el campo hacia (tx,tz) sin salir de `radiusM` metros de recorrido. */
  build(tx: number, tz: number, radiusM: number): void {
    const t0 = performance.now();
    this.builds++;
    this.cur++;
    if (this.cur > 0xfffffff0) {
      this.stamp.fill(0);
      this.cur = 1;
    }
    this.heapN = 0;
    this.targetX = tx;
    this.targetZ = tz;
    this.cellsReached = 0;
    const start = this.nearestWalkableCell(tx, tz, 4);
    if (start < 0) {
      this.valid = false;
      this.lastBuildMs = performance.now() - t0;
      return;
    }
    const cols = this.cols;
    const rows = this.rows;
    const cell = this.cell;
    const dist = this.dist;
    const stamp = this.stamp;
    const walk = this.walk;
    const cur = this.cur;
    const sc = start % cols;
    const sr = (start - sc) / cols;
    const d0 = Math.hypot((sc + 0.5) * cell + this.ox - tx, (sr + 0.5) * cell + this.oz - tz);
    dist[start] = d0;
    stamp[start] = cur;
    this.push(d0, start);
    const diag = cell * SQRT2;
    let reached = 0;
    while (this.heapN > 0) {
      const key = this.heapKey[0]!;
      const i = this.popIdx();
      if (key > dist[i]!) continue; // entrada obsoleta
      if (key > radiusM) break;
      reached++;
      const c = i % cols;
      const r = (i - c) / cols;
      for (let k = 0; k < 8; k++) {
        const nc = c + DC[k]!;
        const nr = r + DR[k]!;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (walk[ni] !== 1) continue;
        let step = cell;
        if (k >= 4) {
          // Diagonal: sólo si las dos celdas ortogonales adyacentes están libres.
          if (walk[r * cols + nc] !== 1 || walk[nr * cols + c] !== 1) continue;
          step = diag;
        }
        const nd = key + step;
        if (stamp[ni] === cur && dist[ni]! <= nd) continue;
        stamp[ni] = cur;
        dist[ni] = nd;
        this.push(nd, ni);
      }
    }
    this.cellsReached = reached;
    this.valid = true;
    this.lastBuildMs = performance.now() - t0;
  }

  /** Distancia de recorrido (m) desde (x,z) al objetivo; Infinity si la celda no fue alcanzada. */
  distanceAt(x: number, z: number): number {
    const c = Math.floor((x - this.ox) / this.cell);
    const r = Math.floor((z - this.oz) / this.cell);
    if (!this.valid || c < 0 || r < 0 || c >= this.cols || r >= this.rows) return Infinity;
    const i = r * this.cols + c;
    return this.stamp[i] === this.cur ? this.dist[i]! : Infinity;
  }

  /**
   * Dirección unitaria de descenso desde (x,z). Devuelve false si la celda no está en el campo
   * (el llamador cae a movimiento directo).
   */
  sample(x: number, z: number, out: FlowDir): boolean {
    if (!this.valid) return false;
    const cols = this.cols;
    const rows = this.rows;
    const c = Math.floor((x - this.ox) / this.cell);
    const r = Math.floor((z - this.oz) / this.cell);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
    const i = r * cols + c;
    const stamp = this.stamp;
    const cur = this.cur;
    const walk = this.walk;
    if (stamp[i] !== cur) return false;
    const d = this.dist[i]!;
    let sx = 0;
    let sz = 0;
    for (let k = 0; k < 8; k++) {
      const nc = c + DC[k]!;
      const nr = r + DR[k]!;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (stamp[ni] !== cur || walk[ni] !== 1) continue;
      if (k >= 4 && (walk[r * cols + nc] !== 1 || walk[nr * cols + c] !== 1)) continue;
      const gain = d - this.dist[ni]!;
      if (gain <= 0) continue;
      const inv = k >= 4 ? 1 / SQRT2 : 1;
      sx += DC[k]! * inv * gain;
      sz += DR[k]! * inv * gain;
    }
    const len = Math.hypot(sx, sz);
    if (len < 1e-5) {
      // En la propia celda objetivo: ir directo.
      const dx = this.targetX - x;
      const dz = this.targetZ - z;
      const l = Math.hypot(dx, dz);
      if (l < 1e-5) return false;
      out.x = dx / l;
      out.z = dz / l;
      return true;
    }
    out.x = sx / len;
    out.z = sz / len;
    return true;
  }

  isWalkable(x: number, z: number): boolean {
    const c = Math.floor((x - this.ox) / this.cell);
    const r = Math.floor((z - this.oz) / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    return this.walk[r * this.cols + c] === 1;
  }

  get cellSize(): number {
    return this.cell;
  }
  get originX(): number {
    return this.ox;
  }
  get originZ(): number {
    return this.oz;
  }
}

/** Hash espacial de enemigos para la separación entre vecinos (sin asignaciones por frame). */
export class SpatialHash {
  private readonly head: Int32Array;
  private readonly next: Int32Array;
  private readonly cx: Int32Array;
  private readonly cz: Int32Array;
  private readonly mask: number;
  private readonly inv: number;

  constructor(cellSize: number, buckets: number, capacity: number) {
    this.inv = 1 / cellSize;
    this.mask = buckets - 1;
    this.head = new Int32Array(buckets).fill(-1);
    this.next = new Int32Array(capacity);
    this.cx = new Int32Array(capacity);
    this.cz = new Int32Array(capacity);
  }

  clear(): void {
    this.head.fill(-1);
  }

  private bucket(cx: number, cz: number): number {
    return (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) & this.mask;
  }

  insert(id: number, x: number, z: number): void {
    if (id >= this.next.length) return;
    const cx = Math.floor(x * this.inv);
    const cz = Math.floor(z * this.inv);
    const b = this.bucket(cx, cz);
    this.cx[id] = cx;
    this.cz[id] = cz;
    this.next[id] = this.head[b]!;
    this.head[b] = id;
  }

  /** Escribe en `out` los ids de las 9 celdas vecinas de (x,z) y devuelve cuántos. */
  query(x: number, z: number, out: Int32Array): number {
    const cx = Math.floor(x * this.inv);
    const cz = Math.floor(z * this.inv);
    let n = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ccx = cx + dx;
        const ccz = cz + dz;
        for (let id = this.head[this.bucket(ccx, ccz)]!; id !== -1; id = this.next[id]!) {
          if (this.cx[id] === ccx && this.cz[id] === ccz && n < out.length) out[n++] = id;
        }
      }
    }
    return n;
  }
}
