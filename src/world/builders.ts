/**
 * Generadores de geometría (three.js): acumula vértices en lotes por (chunk, material, sombra) con UVs a
 * escala de mundo (`tile` metros por repetición) y los convierte en mallas estáticas fusionadas.
 */
import * as THREE from 'three';
import type { MaterialsApi } from '../core/context';
import type { MaterialKey } from '../core/types';
import { createRng } from '../core/util';
import type { BeamPiece, DomePiece, FlatPiece, GroundGrid, Piece, PrismPiece, RampPiece, Rect, VQuadPiece } from './types';
import { GROUND_KINDS } from './types';

/** Acumulador de vértices indexados. */
export class Batch {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  count = 0;

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    return this.count++;
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }
  /** Doble cara (formas cuyo devanado no se garantiza). */
  tri2(a: number, b: number, c: number): void {
    this.idx.push(a, b, c, a, c, b);
  }
  quad2(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d, a, c, b, a, d, c);
  }
  get triangles(): number {
    return this.idx.length / 3;
  }
  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ── Emisores ─────────────────────────────────────────────────────────────────
/** Quad con normal dada; u a lo largo de (tx,tz) en coordenadas de mundo, v = y. */
function wallQuad(b: Batch, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, nx: number, nz: number, tile: number): void {
  const ux = bx - ax;
  const uz = bz - az;
  const len = Math.hypot(ux, uz) || 1;
  const tx = ux / len;
  const tz = uz / len;
  const ua = (ax * tx + az * tz) / tile;
  const ub = (bx * tx + bz * tz) / tile;
  const i = b.vert(ax, y0, az, nx, 0, nz, ua, y0 / tile);
  b.vert(bx, y0, bz, nx, 0, nz, ub, y0 / tile);
  b.vert(bx, y1, bz, nx, 0, nz, ub, y1 / tile);
  b.vert(ax, y1, az, nx, 0, nz, ua, y1 / tile);
  b.quad(i, i + 1, i + 2, i + 3);
}

export function emitBox(b: Batch, p: { cx: number; cz: number; sx: number; sz: number; y0: number; y1: number; rot: number; top: boolean }, tile: number): void {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const hx = p.sx / 2;
  const hz = p.sz / 2;
  const W = (lx: number, lz: number): [number, number] => [p.cx + lx * c + lz * s, p.cz - lx * s + lz * c];
  const [x00, z00] = W(-hx, -hz);
  const [x10, z10] = W(hx, -hz);
  const [x11, z11] = W(hx, hz);
  const [x01, z01] = W(-hx, hz);
  // caras laterales, orden antihorario visto desde fuera
  wallQuad(b, x10, z10, x00, z00, p.y0, p.y1, -s * 0 - s, -c, tile); // -Z local (normal (-s? ) ver abajo)
  wallQuad(b, x01, z01, x11, z11, p.y0, p.y1, s, c, tile);
  wallQuad(b, x00, z00, x01, z01, p.y0, p.y1, -c, s, tile);
  wallQuad(b, x11, z11, x10, z10, p.y0, p.y1, c, -s, tile);
  if (p.top) {
    const y = p.y1;
    const i = b.vert(x00, y, z00, 0, 1, 0, x00 / tile, z00 / tile);
    b.vert(x01, y, z01, 0, 1, 0, x01 / tile, z01 / tile);
    b.vert(x11, y, z11, 0, 1, 0, x11 / tile, z11 / tile);
    b.vert(x10, y, z10, 0, 1, 0, x10 / tile, z10 / tile);
    b.quad(i, i + 1, i + 2, i + 3);
  }
}

export function emitCyl(b: Batch, p: { cx: number; cz: number; r: number; rTop: number; y0: number; y1: number; seg: number; capTop: boolean }, tile: number): void {
  const n = p.seg;
  const first = b.count;
  const slope = (p.r - p.rTop) / Math.max(0.001, p.y1 - p.y0);
  const nl = Math.hypot(1, slope);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const u = (a * p.r) / tile;
    b.vert(p.cx + ca * p.r, p.y0, p.cz + sa * p.r, ca / nl, slope / nl, sa / nl, u, p.y0 / tile);
    b.vert(p.cx + ca * p.rTop, p.y1, p.cz + sa * p.rTop, ca / nl, slope / nl, sa / nl, u, p.y1 / tile);
  }
  for (let i = 0; i < n; i++) {
    const a = first + i * 2;
    // orientación exterior (antihoraria vista desde fuera)
    b.tri(a, a + 1, a + 3);
    b.tri(a, a + 3, a + 2);
  }
  if (p.capTop) {
    const ci = b.vert(p.cx, p.y1, p.cz, 0, 1, 0, p.cx / tile, p.cz / tile);
    const f2 = b.count;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = p.cx + Math.cos(a) * p.rTop;
      const z = p.cz + Math.sin(a) * p.rTop;
      b.vert(x, p.y1, z, 0, 1, 0, x / tile, z / tile);
    }
    for (let i = 0; i < n; i++) b.tri(ci, f2 + i + 1, f2 + i);
  }
}

export function emitRamp(b: Batch, p: RampPiece, tile: number): void {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const hx = p.sx / 2;
  const hz = p.sz / 2;
  const W = (lx: number, lz: number): [number, number] => [p.cx + lx * c + lz * s, p.cz - lx * s + lz * c];
  const [a0x, a0z] = W(-hx, -hz);
  const [a1x, a1z] = W(-hx, hz);
  const [b0x, b0z] = W(hx, -hz);
  const [b1x, b1z] = W(hx, hz);
  const slope = (p.y1 - p.y0) / p.sx;
  const nl = Math.hypot(1, slope);
  const nx = (-slope * c) / nl;
  const nz = (slope * s) / nl;
  const ny = 1 / nl;
  const i = b.vert(a0x, p.y0, a0z, nx, ny, nz, a0x / tile, a0z / tile);
  b.vert(a1x, p.y0, a1z, nx, ny, nz, a1x / tile, a1z / tile);
  b.vert(b1x, p.y1, b1z, nx, ny, nz, b1x / tile, b1z / tile);
  b.vert(b0x, p.y1, b0z, nx, ny, nz, b0x / tile, b0z / tile);
  b.quad(i, i + 1, i + 2, i + 3);
  wallQuad(b, b1x, b1z, b0x, b0z, 0, p.y1, c, -s, tile);
  wallQuad(b, a1x, a1z, b1x, b1z, 0, p.y0 + 0.001, s, c, tile);
  // laterales triangulares
  for (const side of [-1, 1]) {
    const [ax, az] = W(-hx, side * hz);
    const [bx, bz] = W(hx, side * hz);
    const n0x = side * s;
    const n0z = side * c;
    const j = b.vert(ax, 0, az, n0x, 0, n0z, ax / tile, 0);
    b.vert(bx, 0, bz, n0x, 0, n0z, bx / tile, 0);
    b.vert(bx, p.y1, bz, n0x, 0, n0z, bx / tile, p.y1 / tile);
    b.vert(ax, p.y0, az, n0x, 0, n0z, ax / tile, p.y0 / tile);
    b.quad2(j, j + 1, j + 2, j + 3);
  }
}

export function emitFlat(b: Batch, p: FlatPiece, tile: number): void {
  const y = p.y;
  const put = (x: number, z: number): number => b.vert(x, y, z, 0, 1, 0, x / tile, z / tile);
  if (p.shape === 'rect') {
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    const hx = p.sx / 2;
    const hz = p.sz / 2;
    const W = (lx: number, lz: number): [number, number] => [p.cx + lx * c + lz * s, p.cz - lx * s + lz * c];
    const [x0, z0] = W(-hx, -hz);
    const [x1, z1] = W(-hx, hz);
    const [x2, z2] = W(hx, hz);
    const [x3, z3] = W(hx, -hz);
    const i = put(x0, z0);
    put(x1, z1);
    put(x2, z2);
    put(x3, z3);
    b.quad(i, i + 1, i + 2, i + 3);
    return;
  }
  const seg = p.shape === 'blob' ? 14 : 48;
  const rng = createRng(p.seed);
  const radii: number[] = [];
  for (let i = 0; i < seg; i++) radii.push(p.shape === 'blob' ? p.sx * (0.65 + 0.35 * rng()) : p.sx);
  if (p.shape === 'ring') {
    const first = b.count;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      put(p.cx + Math.cos(a) * p.sx, p.cz + Math.sin(a) * p.sx);
      put(p.cx + Math.cos(a) * p.r0, p.cz + Math.sin(a) * p.r0);
    }
    for (let i = 0; i < seg; i++) {
      const a = first + i * 2;
      b.tri(a, a + 1, a + 3);
      b.tri(a, a + 3, a + 2);
    }
    return;
  }
  const ci = put(p.cx, p.cz);
  const f = b.count;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const r = radii[i % seg] as number;
    put(p.cx + Math.cos(a) * r, p.cz + Math.sin(a) * r);
  }
  for (let i = 0; i < seg; i++) b.tri(ci, f + i + 1, f + i);
}

export function emitVQuad(b: Batch, p: VQuadPiece, tile: number): void {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const hw = p.w / 2;
  // tangente local X = (c, -s); normal local Z = (s, c)
  const ax = p.x - c * hw;
  const az = p.z + s * hw;
  const bx = p.x + c * hw;
  const bz = p.z - s * hw;
  wallQuad(b, ax, az, bx, bz, p.y, p.y + p.h, s, c, tile);
}

export function emitBeam(b: Batch, p: BeamPiece, tile: number): void {
  const dx = p.bx - p.ax;
  const dy = p.by - p.ay;
  const dz = p.bz - p.az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  const ax = dx / len;
  const ay = dy / len;
  const az = dz / len;
  // perpendiculares
  let ux = 0;
  let uy = 1;
  let uz = 0;
  if (Math.abs(ay) > 0.95) {
    ux = 1;
    uy = 0;
  }
  let vx = ay * uz - az * uy;
  let vy = az * ux - ax * uz;
  let vz = ax * uy - ay * ux;
  const vl = Math.hypot(vx, vy, vz);
  vx /= vl;
  vy /= vl;
  vz /= vl;
  ux = vy * az - vz * ay;
  uy = vz * ax - vx * az;
  uz = vx * ay - vy * ax;
  const sides = p.round ? 8 : 4;
  const first = b.count;
  for (let i = 0; i <= sides; i++) {
    const a = p.round ? (i / sides) * Math.PI * 2 : ((i + 0.5) / sides) * Math.PI * 2;
    let ca = Math.cos(a);
    let sa = Math.sin(a);
    let rad = p.w;
    if (!p.round) {
      const m = Math.max(Math.abs(ca), Math.abs(sa));
      ca /= m;
      sa /= m;
      rad = p.w / 2;
    }
    const ox = ux * ca + vx * sa;
    const oy = uy * ca + vy * sa;
    const oz = uz * ca + vz * sa;
    const on = Math.hypot(ox, oy, oz) || 1;
    const uu = (i / sides) * (p.w * 4) / tile;
    b.vert(p.ax + ox * rad, p.ay + oy * rad, p.az + oz * rad, ox / on, oy / on, oz / on, uu, 0);
    b.vert(p.bx + ox * rad, p.by + oy * rad, p.bz + oz * rad, ox / on, oy / on, oz / on, uu, len / tile);
  }
  for (let i = 0; i < sides; i++) {
    const a = first + i * 2;
    b.tri2(a, a + 1, a + 3);
    b.tri2(a, a + 3, a + 2);
  }
}

export function emitDome(b: Batch, p: DomePiece, tile: number): void {
  const rings = 6;
  const seg = 24;
  const first = b.count;
  for (let j = 0; j <= rings; j++) {
    const phi = (j / rings) * (Math.PI / 2);
    const rr = Math.cos(phi) * p.r;
    const y = p.y0 + Math.sin(phi) * p.h;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const nx = Math.cos(a) * Math.cos(phi);
      const nz = Math.sin(a) * Math.cos(phi);
      const ny = Math.sin(phi) * (p.r / Math.max(p.h, 0.1)) * 0.5 + 0.2;
      const nl = Math.hypot(nx, ny, nz);
      b.vert(p.cx + Math.cos(a) * rr, y, p.cz + Math.sin(a) * rr, nx / nl, ny / nl, nz / nl, (a * p.r) / tile, (phi * p.r) / tile);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = first + j * (seg + 1) + i;
      b.tri2(a, a + seg + 2, a + 1);
      b.tri2(a, a + seg + 1, a + seg + 2);
    }
  }
}

export function emitPrism(b: Batch, p: PrismPiece, tile: number): void {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const hx = p.sx / 2;
  const hz = p.sz / 2;
  const W = (lx: number, lz: number, y: number): [number, number, number] => [p.cx + lx * c + lz * s, y, p.cz - lx * s + lz * c];
  const y0 = p.y0;
  const y1 = p.y0 + p.h;
  const face = (a: [number, number, number], bb: [number, number, number], cc: [number, number, number], d: [number, number, number]): void => {
    const e1 = [bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]];
    const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let nx = (e1[1] as number) * (e2[2] as number) - (e1[2] as number) * (e2[1] as number);
    let ny = (e1[2] as number) * (e2[0] as number) - (e1[0] as number) * (e2[2] as number);
    let nz = (e1[0] as number) * (e2[1] as number) - (e1[1] as number) * (e2[0] as number);
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const i = b.vert(a[0], a[1], a[2], nx, ny, nz, a[0] / tile, a[2] / tile + a[1] / tile);
    b.vert(bb[0], bb[1], bb[2], nx, ny, nz, bb[0] / tile, bb[2] / tile + bb[1] / tile);
    b.vert(cc[0], cc[1], cc[2], nx, ny, nz, cc[0] / tile, cc[2] / tile + cc[1] / tile);
    b.vert(d[0], d[1], d[2], nx, ny, nz, d[0] / tile, d[2] / tile + d[1] / tile);
    b.quad2(i, i + 1, i + 2, i + 3);
  };
  const endTri = (t: Array<[number, number, number]>, nx: number, nz: number): void => {
    const [v0, v1, v2] = t as [[number, number, number], [number, number, number], [number, number, number]];
    const i = b.vert(v0[0], v0[1], v0[2], nx, 0, nz, v0[0] / tile, v0[1] / tile);
    b.vert(v1[0], v1[1], v1[2], nx, 0, nz, v1[0] / tile, v1[1] / tile);
    b.vert(v2[0], v2[1], v2[2], nx, 0, nz, v2[0] / tile, v2[1] / tile);
    b.tri2(i, i + 1, i + 2);
  };
  if (!p.ridgeZ) {
    face(W(-hx, -hz, y0), W(hx, -hz, y0), W(hx, 0, y1), W(-hx, 0, y1));
    face(W(-hx, hz, y0), W(-hx, 0, y1), W(hx, 0, y1), W(hx, hz, y0));
    endTri([W(-hx, -hz, y0), W(-hx, 0, y1), W(-hx, hz, y0)], -c, s);
    endTri([W(hx, hz, y0), W(hx, 0, y1), W(hx, -hz, y0)], c, -s);
  } else {
    face(W(-hx, hz, y0), W(-hx, -hz, y0), W(0, -hz, y1), W(0, hz, y1));
    face(W(hx, -hz, y0), W(hx, hz, y0), W(0, hz, y1), W(0, -hz, y1));
    endTri([W(-hx, -hz, y0), W(0, -hz, y1), W(hx, -hz, y0)], -s, -c);
    endTri([W(hx, hz, y0), W(0, hz, y1), W(-hx, hz, y0)], s, c);
  }
}

/** Emite cualquier pieza en el lote dado. */
export function emitPiece(b: Batch, p: Piece, tile: number): void {
  switch (p.t) {
    case 'box': emitBox(b, p, tile); break;
    case 'cyl': emitCyl(b, p, tile); break;
    case 'ramp': emitRamp(b, p, tile); break;
    case 'flat': emitFlat(b, p, tile); break;
    case 'vquad': emitVQuad(b, p, tile); break;
    case 'beam': emitBeam(b, p, tile); break;
    case 'dome': emitDome(b, p, tile); break;
    case 'prism': emitPrism(b, p, tile); break;
  }
}

// ── Mallas estáticas ─────────────────────────────────────────────────────────
export interface StaticStats {
  meshes: number;
  triangles: number;
}

function pieceCenter(p: Piece): [number, number] {
  switch (p.t) {
    case 'beam': return [(p.ax + p.bx) / 2, (p.az + p.bz) / 2];
    case 'vquad': return [p.x, p.z];
    default: return [p.cx, p.cz];
  }
}
function pieceCast(p: Piece): boolean {
  return p.t === 'box' || p.t === 'cyl' || p.t === 'dome' || p.t === 'prism' || p.t === 'beam' ? p.cast : false;
}
function pieceMat(p: Piece): MaterialKey {
  return p.mat;
}

/** Fusiona las piezas en mallas por (chunk, material, sombra). */
export function buildStaticMeshes(pieces: readonly Piece[], bounds: Rect, chunk: number, materials: MaterialsApi, group: THREE.Group, stats: StaticStats): void {
  const cols = Math.ceil((bounds.maxX - bounds.minX) / chunk);
  const rows = Math.ceil((bounds.maxZ - bounds.minZ) / chunk);
  const batches = new Map<string, { b: Batch; mat: MaterialKey; cast: boolean; recv: boolean }>();
  const get = (cx: number, cz: number, mat: MaterialKey, cast: boolean, recv = true): Batch => {
    const c = Math.min(cols - 1, Math.max(0, Math.floor((cx - bounds.minX) / chunk)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor((cz - bounds.minZ) / chunk)));
    const key = `${c},${r},${mat},${cast ? 1 : 0}${recv ? 1 : 0}`;
    let e = batches.get(key);
    if (!e) {
      e = { b: new Batch(), mat, cast, recv };
      batches.set(key, e);
    }
    return e.b;
  };
  for (const p of pieces) {
    const [cx, cz] = pieceCenter(p);
    emitPiece(get(cx, cz, pieceMat(p), pieceCast(p)), p, materials.tile(pieceMat(p)));
  }
  for (const e of batches.values()) {
    if (e.b.count === 0) continue;
    const mesh = new THREE.Mesh(e.b.toGeometry(), materials.get(e.mat));
    mesh.castShadow = e.cast;
    mesh.receiveShadow = e.recv;
    mesh.matrixAutoUpdate = false;
    mesh.name = `static:${e.mat}`;
    group.add(mesh);
    stats.meshes++;
    stats.triangles += e.b.triangles;
  }
}

/** Suelo: fusión voraz de celdas del ráster (sin solapes) + anillo exterior. */
export function buildGround(ground: GroundGrid, bounds: Rect, chunk: number, materials: MaterialsApi, group: THREE.Group, stats: StaticStats): void {
  const { cols, rows, cell, data } = ground;
  const chunkCells = Math.max(1, Math.round(chunk / cell));
  const used = new Uint8Array(cols * rows);
  const batches = new Map<string, Batch>();
  const matOf = new Map<string, MaterialKey>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (used[i]) continue;
      const kind = data[i] as number;
      const cc = Math.floor(c / chunkCells);
      const rc = Math.floor(r / chunkCells);
      const cEnd = Math.min(cols, (cc + 1) * chunkCells);
      const rEnd = Math.min(rows, (rc + 1) * chunkCells);
      let w = 1;
      while (c + w < cEnd && !used[r * cols + c + w] && data[r * cols + c + w] === kind) w++;
      let h = 1;
      outer: while (r + h < rEnd) {
        for (let x = 0; x < w; x++) if (used[(r + h) * cols + c + x] || data[(r + h) * cols + c + x] !== kind) break outer;
        h++;
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) used[(r + y) * cols + c + x] = 1;
      const def = GROUND_KINDS[kind] ?? GROUND_KINDS[0]!;
      const key = `${cc},${rc},${def.mat}`;
      let b = batches.get(key);
      if (!b) {
        b = new Batch();
        batches.set(key, b);
        matOf.set(key, def.mat);
      }
      const x0 = bounds.minX + c * cell;
      const z0 = bounds.minZ + r * cell;
      const x1 = x0 + w * cell;
      const z1 = z0 + h * cell;
      const t = materials.tile(def.mat);
      const v = b.vert(x0, 0, z0, 0, 1, 0, x0 / t, z0 / t);
      b.vert(x0, 0, z1, 0, 1, 0, x0 / t, z1 / t);
      b.vert(x1, 0, z1, 0, 1, 0, x1 / t, z1 / t);
      b.vert(x1, 0, z0, 0, 1, 0, x1 / t, z0 / t);
      b.quad(v, v + 1, v + 2, v + 3);
    }
  }
  for (const [key, b] of batches) {
    const mesh = new THREE.Mesh(b.toGeometry(), materials.get(matOf.get(key) as MaterialKey));
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'ground';
    group.add(mesh);
    stats.meshes++;
    stats.triangles += b.triangles;
  }
  // Terreno exterior (bajo el muro y hasta el horizonte)
  const ob = new Batch();
  const E = 900;
  const t = materials.tile('dirt');
  const ring: Array<[number, number, number, number]> = [
    [-E, E, -E, bounds.minZ], [-E, E, bounds.maxZ, E], [-E, bounds.minX, bounds.minZ, bounds.maxZ], [bounds.maxX, E, bounds.minZ, bounds.maxZ],
  ];
  for (const [x0, x1, z0, z1] of ring) {
    const v = ob.vert(x0, -0.02, z0, 0, 1, 0, x0 / t, z0 / t);
    ob.vert(x0, -0.02, z1, 0, 1, 0, x0 / t, z1 / t);
    ob.vert(x1, -0.02, z1, 0, 1, 0, x1 / t, z1 / t);
    ob.vert(x1, -0.02, z0, 0, 1, 0, x1 / t, z0 / t);
    ob.quad(v, v + 1, v + 2, v + 3);
  }
  const om = new THREE.Mesh(ob.toGeometry(), materials.get('dirt'));
  om.matrixAutoUpdate = false;
  om.frustumCulled = false;
  om.name = 'outer-ground';
  group.add(om);
  stats.meshes++;
  stats.triangles += ob.triangles;
}
