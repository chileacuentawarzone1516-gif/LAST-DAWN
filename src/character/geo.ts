/**
 * Kit de geometría low-poly del maniquí: primitivas (cajas, esferas, cilindros, «lofts» por secciones,
 * tubos, cintas) que se acumulan en UN único buffer por material y con pesos de esqueleto por vértice.
 * Todo se expresa en el espacio del modelo en reposo (pies en y=0, frente = +Z, izquierda del personaje = +X).
 *
 * El resultado son BufferGeometry con skinIndex/skinWeight listas para un SkinnedMesh por material.
 */
import * as THREE from 'three';
import type { BoneName } from './rig';

const TAU = Math.PI * 2;

// ─────────────────────────────────────────────────────────────────────────────
// Transformaciones
// ─────────────────────────────────────────────────────────────────────────────
export interface Xf {
  x?: number; y?: number; z?: number;
  rx?: number; ry?: number; rz?: number;
  sx?: number; sy?: number; sz?: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Matrix3();
const _v = new THREE.Vector3();

function composeXf(t: Xf, out: THREE.Matrix4): THREE.Matrix4 {
  return out.compose(
    _p.set(t.x ?? 0, t.y ?? 0, t.z ?? 0),
    _q.setFromEuler(_e.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0, 'XYZ')),
    _s.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1),
  );
}

/** Aplica una transformación a arrays de posiciones y normales (in situ). */
function transformArrays(pos: number[], nor: number[], t: Xf): void {
  composeXf(t, _m);
  _n.getNormalMatrix(_m);
  for (let i = 0; i < pos.length; i += 3) {
    _v.set(pos[i]!, pos[i + 1]!, pos[i + 2]!).applyMatrix4(_m);
    pos[i] = _v.x;
    pos[i + 1] = _v.y;
    pos[i + 2] = _v.z;
    _v.set(nor[i]!, nor[i + 1]!, nor[i + 2]!).applyMatrix3(_n).normalize();
    nor[i] = _v.x;
    nor[i + 1] = _v.y;
    nor[i + 2] = _v.z;
  }
}

/** Normales suaves (promedio ponderado por área) de una malla indexada. */
function smoothNormals(pos: number[], idx: number[]): number[] {
  const nor = new Array<number>(pos.length).fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]! * 3;
    const b = idx[t + 1]! * 3;
    const c = idx[t + 2]! * 3;
    const ux = pos[b]! - pos[a]!;
    const uy = pos[b + 1]! - pos[a + 1]!;
    const uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!;
    const vy = pos[c + 1]! - pos[a + 1]!;
    const vz = pos[c + 2]! - pos[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      nor[k] = nor[k]! + nx;
      nor[k + 1] = nor[k + 1]! + ny;
      nor[k + 2] = nor[k + 2]! + nz;
    }
  }
  for (let i = 0; i < nor.length; i += 3) {
    const l = Math.hypot(nor[i]!, nor[i + 1]!, nor[i + 2]!);
    if (l > 1e-12) {
      nor[i] = nor[i]! / l;
      nor[i + 1] = nor[i + 1]! / l;
      nor[i + 2] = nor[i + 2]! / l;
    } else {
      nor[i] = 0;
      nor[i + 1] = 1;
      nor[i + 2] = 0;
    }
  }
  return nor;
}

/** |s|^e con el signo de s (superelipse). */
export const sgnPow = (s: number, e: number): number => (s < 0 ? -1 : 1) * Math.abs(s) ** e;

// ─────────────────────────────────────────────────────────────────────────────
// Pesos de esqueleto
// ─────────────────────────────────────────────────────────────────────────────
export interface SkinOut { i0: number; w0: number; i1: number; w1: number }
export type SkinFn = (x: number, y: number, z: number, out: SkinOut) => void;
/** Un hueso (rígido) o una función que reparte pesos entre dos huesos según la posición. */
export type Skin = BoneName | SkinFn;

// ─────────────────────────────────────────────────────────────────────────────
// Secciones (rings) interpolables
// ─────────────────────────────────────────────────────────────────────────────
export interface RingRow { y: number; rx: number; rz: number; cz: number; cx?: number }

const hermite = (p0: number, a: number, b: number, p3: number, y0: number, ya: number, yb: number, y3: number, t: number): number => {
  const h = yb - ya;
  const m1 = ((b - p0) / Math.max(1e-6, yb - y0)) * h;
  const m2 = ((p3 - a) / Math.max(1e-6, y3 - ya)) * h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * b + (t3 - t2) * m2;
};

/** Tabla de secciones elípticas ordenadas por y ascendente, con interpolación cúbica suave. */
export class RingTable {
  constructor(readonly rows: readonly RingRow[]) {}

  get minY(): number {
    return this.rows[0]!.y;
  }

  get maxY(): number {
    return this.rows[this.rows.length - 1]!.y;
  }

  at(y: number, out: RingRow): RingRow {
    const r = this.rows;
    const n = r.length;
    if (y <= r[0]!.y) return copyRow(r[0]!, out);
    if (y >= r[n - 1]!.y) return copyRow(r[n - 1]!, out);
    let i = 0;
    while (i < n - 2 && y > r[i + 1]!.y) i++;
    const a = r[i]!;
    const b = r[i + 1]!;
    const p0 = r[Math.max(i - 1, 0)]!;
    const p3 = r[Math.min(i + 2, n - 1)]!;
    const t = (y - a.y) / (b.y - a.y);
    out.y = y;
    out.rx = Math.max(0.001, hermite(p0.rx, a.rx, b.rx, p3.rx, p0.y, a.y, b.y, p3.y, t));
    out.rz = Math.max(0.001, hermite(p0.rz, a.rz, b.rz, p3.rz, p0.y, a.y, b.y, p3.y, t));
    out.cz = hermite(p0.cz, a.cz, b.cz, p3.cz, p0.y, a.y, b.y, p3.y, t);
    out.cx = 0;
    return out;
  }
}

function copyRow(s: RingRow, out: RingRow): RingRow {
  out.y = s.y;
  out.rx = s.rx;
  out.rz = s.rz;
  out.cz = s.cz;
  out.cx = s.cx ?? 0;
  return out;
}

export const newRow = (): RingRow => ({ y: 0, rx: 0, rz: 0, cz: 0, cx: 0 });

/** z de la superficie (superelipse de exponente p) en la abscisa x de una sección. */
export function ringZ(r: RingRow, x: number, front: boolean, p = 2.4): number {
  const k = Math.min(0.999, Math.abs(x - (r.cx ?? 0)) / r.rx);
  const d = r.rz * (1 - k ** p) ** (1 / p);
  return front ? r.cz + d : r.cz - d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Descripciones de primitivas
// ─────────────────────────────────────────────────────────────────────────────
export interface Station { y: number; rx: number; rz: number; cx?: number; cz?: number; p?: number }
export interface StationZ { z: number; rx: number; ry: number; cx?: number; cy?: number; p?: number }
export interface LoftOpts {
  seg?: number;
  /** Exponente de la superelipse (2 = elipse; >2 = más «cuadrada»). */
  p?: number;
  caps?: 'none' | 'top' | 'bottom' | 'both';
  /** Arco parcial [θ0, θ1] (θ=0 mira a +Z / +X en loftZ); sin arco = anillo completo. */
  arc?: readonly [number, number];
  /** Recorta la altura máxima por ángulo (escotes, cuellos en V). */
  yMax?: (theta: number) => number;
  /** Con yMax: devuelve la sección (rx, rz, cx, cz) a la altura recortada, para que el borde siga la superficie. */
  rowAt?: (y: number, out: Station) => void;
  xf?: Xf;
}
export interface TubePoint { x: number; y: number; z: number; ra: number; rb?: number }
export interface RibbonPoint { x: number; y: number; z: number; nx: number; ny: number; nz: number }

// ─────────────────────────────────────────────────────────────────────────────
// Acumulador por material
// ─────────────────────────────────────────────────────────────────────────────
class Bin {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly idx: number[] = [];
  readonly skinI: number[] = [];
  readonly skinW: number[] = [];
}

export interface KitMesh { material: THREE.Material; geometry: THREE.BufferGeometry; triangles: number }

export class Kit<R extends string> {
  private readonly bins = new Map<THREE.Material, Bin>();

  constructor(
    private readonly resolve: (role: R) => THREE.Material,
    private readonly boneIndex: (name: BoneName) => number,
  ) {}

  /** Pincel para un material (por rol) y unos pesos de esqueleto. */
  paint(role: R, skin: Skin): Painter {
    const mat = this.resolve(role);
    let bin = this.bins.get(mat);
    if (!bin) {
      bin = new Bin();
      this.bins.set(mat, bin);
    }
    return new Painter(bin, typeof skin === 'string' ? this.boneIndex(skin) : skin);
  }

  /** Convierte los buffers acumulados en geometrías (una por material con datos). */
  finish(): KitMesh[] {
    const out: KitMesh[] = [];
    for (const [material, bin] of this.bins) {
      if (bin.idx.length === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(bin.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(bin.nor, 3));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(bin.skinI, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(bin.skinW, 4));
      g.setIndex(bin.pos.length / 3 > 65000 ? new THREE.Uint32BufferAttribute(bin.idx, 1) : new THREE.Uint16BufferAttribute(bin.idx, 1));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      out.push({ material, geometry: g, triangles: bin.idx.length / 3 });
    }
    return out;
  }
}

const _skin: SkinOut = { i0: 0, w0: 1, i1: 0, w1: 0 };

const _up = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
const _q2 = new THREE.Quaternion();

/**
 * Transformación que orienta el eje +Y de una primitiva a lo largo de (dx,dy,dz), con su base en P
 * (el centro queda a `len/2` de P). `roll` gira la pieza sobre su propio eje.
 */
export function dirXf(px: number, py: number, pz: number, dx: number, dy: number, dz: number, len = 0, roll = 0): Xf {
  _d.set(dx, dy, dz).normalize();
  _q.setFromUnitVectors(_up, _d);
  if (roll !== 0) _q.multiply(_q2.setFromAxisAngle(_up, roll));
  _e.setFromQuaternion(_q, 'XYZ');
  return { x: px + (_d.x * len) / 2, y: py + (_d.y * len) / 2, z: pz + (_d.z * len) / 2, rx: _e.x, ry: _e.y, rz: _e.z };
}

export class Painter {
  constructor(private readonly bin: Bin, private readonly skin: number | SkinFn) {}

  /** Añade una malla ya calculada (con normales) al buffer, asignando pesos por vértice. */
  private push(pos: ArrayLike<number>, nor: ArrayLike<number>, idx: ArrayLike<number>): void {
    const b = this.bin;
    const base = b.pos.length / 3;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i]!;
      const y = pos[i + 1]!;
      const z = pos[i + 2]!;
      b.pos.push(x, y, z);
      b.nor.push(nor[i]!, nor[i + 1]!, nor[i + 2]!);
      if (typeof this.skin === 'number') {
        b.skinI.push(this.skin, 0, 0, 0);
        b.skinW.push(1, 0, 0, 0);
      } else {
        this.skin(x, y, z, _skin);
        b.skinI.push(_skin.i0, _skin.i1, 0, 0);
        b.skinW.push(_skin.w0, _skin.w1, 0, 0);
      }
    }
    for (let i = 0; i < idx.length; i++) b.idx.push(idx[i]! + base);
  }

  private pushGeo(g: THREE.BufferGeometry, xf: Xf): void {
    g.applyMatrix4(composeXf(xf, _m));
    this.push(g.getAttribute('position').array, g.getAttribute('normal').array, g.index!.array);
    g.dispose();
  }

  /** Caja centrada (aristas vivas). */
  box(w: number, h: number, d: number, xf: Xf = {}): this {
    this.pushGeo(new THREE.BoxGeometry(w, h, d), xf);
    return this;
  }

  /** Caja cónica centrada: ancho/fondo superiores (wt, dt) e inferiores (wb, db). */
  tbox(wt: number, dt: number, wb: number, db: number, h: number, xf: Xf = {}): this {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const top = p.getY(i) > 0;
      p.setXYZ(i, p.getX(i) * (top ? wt : wb), p.getY(i) * h, p.getZ(i) * (top ? dt : db));
    }
    g.computeVertexNormals();
    this.pushGeo(g, xf);
    return this;
  }

  /** Elipsoide (esfera escalada) de radios rx/ry/rz. */
  blob(rx: number, ry: number, rz: number, xf: Xf = {}, ws = 9, hs = 6): this {
    this.pushGeo(new THREE.SphereGeometry(1, ws, hs), { ...xf, sx: (xf.sx ?? 1) * rx, sy: (xf.sy ?? 1) * ry, sz: (xf.sz ?? 1) * rz });
    return this;
  }

  /** Cilindro/cono centrado (eje Y). */
  cyl(rt: number, rb: number, h: number, seg = 10, xf: Xf = {}, open = false): this {
    this.pushGeo(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), xf);
    return this;
  }

  /**
   * Superficie por secciones elípticas apiladas en Y (torsos, miembros, prendas). `stations` de abajo a arriba.
   * Las normales son suaves; las tapas (si las hay) son planas.
   */
  loftY(stations: readonly Station[], o: LoftOpts = {}): this {
    const clip: Station = { y: 0, rx: 0, rz: 0 };
    return this.loft(
      stations.length,
      o,
      (k, th, out) => {
        let s = stations[k]!;
        const e = 2 / (s.p ?? o.p ?? 2);
        if (o.yMax) {
          const ym = o.yMax(th);
          if (ym < s.y) {
            if (o.rowAt) {
              clip.y = ym;
              o.rowAt(ym, clip);
              clip.p = s.p;
              s = clip;
            } else {
              out[0] = (s.cx ?? 0) + s.rx * sgnPow(Math.sin(th), e);
              out[1] = ym;
              out[2] = (s.cz ?? 0) + s.rz * sgnPow(Math.cos(th), e);
              return;
            }
          }
        }
        out[0] = (s.cx ?? 0) + s.rx * sgnPow(Math.sin(th), e);
        out[1] = s.y;
        out[2] = (s.cz ?? 0) + s.rz * sgnPow(Math.cos(th), e);
      },
      (k, out) => {
        const s = stations[k]!;
        out[0] = s.cx ?? 0;
        out[1] = s.y;
        out[2] = s.cz ?? 0;
      },
    );
  }

  /** Igual que loftY pero apilado en Z (calzado, viseras): sección elíptica en el plano XY. */
  loftZ(stations: readonly StationZ[], o: LoftOpts = {}): this {
    return this.loft(
      stations.length,
      o,
      (k, th, out) => {
        const s = stations[k]!;
        const e = 2 / (s.p ?? o.p ?? 2);
        out[0] = (s.cx ?? 0) + s.rx * sgnPow(Math.cos(th), e);
        out[1] = (s.cy ?? 0) + s.ry * sgnPow(Math.sin(th), e);
        out[2] = s.z;
      },
      (k, out) => {
        const s = stations[k]!;
        out[0] = s.cx ?? 0;
        out[1] = s.cy ?? 0;
        out[2] = s.z;
      },
    );
  }

  private loft(
    count: number,
    o: LoftOpts,
    point: (k: number, th: number, out: number[]) => void,
    center: (k: number, out: number[]) => void,
  ): this {
    if (count < 2) return this;
    const seg = o.seg ?? 14;
    const full = !o.arc;
    const cols = full ? seg : seg + 1;
    const th0 = o.arc ? o.arc[0] : 0;
    const th1 = o.arc ? o.arc[1] : TAU;
    const pos: number[] = [];
    const idx: number[] = [];
    const tmp = [0, 0, 0];
    for (let k = 0; k < count; k++) {
      for (let j = 0; j < cols; j++) {
        point(k, th0 + ((th1 - th0) * j) / seg, tmp);
        pos.push(tmp[0]!, tmp[1]!, tmp[2]!);
      }
    }
    for (let k = 0; k < count - 1; k++) {
      for (let j = 0; j < seg; j++) {
        const j1 = full ? (j + 1) % cols : j + 1;
        const a = k * cols + j;
        const b = k * cols + j1;
        const c = (k + 1) * cols + j1;
        const d = (k + 1) * cols + j;
        idx.push(a, b, c, a, c, d);
      }
    }
    let nor = smoothNormals(pos, idx);
    // Tapas planas (vértices duplicados para que la arista sea viva).
    const caps = full ? (o.caps ?? 'none') : 'none';
    if (caps !== 'none') {
      const addCap = (k: number, up: boolean): void => {
        const base = pos.length / 3;
        center(k, tmp);
        pos.push(tmp[0]!, tmp[1]!, tmp[2]!);
        for (let j = 0; j < cols; j++) {
          const s = (k * cols + j) * 3;
          pos.push(pos[s]!, pos[s + 1]!, pos[s + 2]!);
        }
        for (let j = 0; j < cols; j++) {
          const a = base + 1 + j;
          const b = base + 1 + ((j + 1) % cols);
          if (up) idx.push(base, a, b);
          else idx.push(base, b, a);
        }
      };
      if (caps === 'top' || caps === 'both') addCap(count - 1, true);
      if (caps === 'bottom' || caps === 'both') addCap(0, false);
      nor = smoothNormals(pos, idx);
    }
    if (o.xf) transformArrays(pos, nor, o.xf);
    this.push(pos, nor, idx);
    return this;
  }

  /** Malla libre `cols × rows` (p. ej. casquetes de pelo o de gorro). `flip` invierte el sentido de las caras. */
  grid(cols: number, rows: number, point: (j: number, k: number, out: number[]) => void, o: { wrap?: boolean; flip?: boolean } = {}): this {
    const pos: number[] = [];
    const idx: number[] = [];
    const tmp = [0, 0, 0];
    for (let k = 0; k < rows; k++) {
      for (let j = 0; j < cols; j++) {
        point(j, k, tmp);
        pos.push(tmp[0]!, tmp[1]!, tmp[2]!);
      }
    }
    const quads = o.wrap ? cols : cols - 1;
    for (let k = 0; k < rows - 1; k++) {
      for (let j = 0; j < quads; j++) {
        const j1 = o.wrap ? (j + 1) % cols : j + 1;
        const a = k * cols + j;
        const b = k * cols + j1;
        const c = (k + 1) * cols + j1;
        const d = (k + 1) * cols + j;
        if (o.flip) idx.push(a, c, b, a, d, c);
        else idx.push(a, b, c, a, c, d);
      }
    }
    this.push(pos, smoothNormals(pos, idx), idx);
    return this;
  }

  /**
   * Tubo que sigue una polilínea con sección elíptica variable (coletas, trenzas, mechones, patillas
   * de auriculares). `ra` es el radio en el eje N del marco transportado, `rb` (por defecto ra) en el otro.
   */
  tube(points: readonly TubePoint[], o: { seg?: number; caps?: boolean; ref?: readonly [number, number, number] } = {}): this {
    const n = points.length;
    if (n < 2) return this;
    const seg = o.seg ?? 8;
    const pos: number[] = [];
    const idx: number[] = [];
    const T = new THREE.Vector3();
    const N = new THREE.Vector3();
    const B = new THREE.Vector3();
    const ref = new THREE.Vector3(...(o.ref ?? [0, 0, 1]));
    for (let i = 0; i < n; i++) {
      const a = points[Math.max(i - 1, 0)]!;
      const b = points[Math.min(i + 1, n - 1)]!;
      T.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
      if (i === 0) {
        if (Math.abs(T.dot(ref)) > 0.95) ref.set(1, 0, 0);
        N.copy(ref).addScaledVector(T, -ref.dot(T)).normalize();
      } else {
        N.addScaledVector(T, -N.dot(T)).normalize();
      }
      B.crossVectors(T, N);
      const p = points[i]!;
      const rb = p.rb ?? p.ra;
      for (let j = 0; j < seg; j++) {
        const th = (j / seg) * TAU;
        const c = Math.cos(th) * p.ra;
        const s = Math.sin(th) * rb;
        pos.push(p.x + N.x * c + B.x * s, p.y + N.y * c + B.y * s, p.z + N.z * c + B.z * s);
      }
    }
    for (let k = 0; k < n - 1; k++) {
      for (let j = 0; j < seg; j++) {
        const j1 = (j + 1) % seg;
        const a = k * seg + j;
        const b = k * seg + j1;
        const c = (k + 1) * seg + j1;
        const d = (k + 1) * seg + j;
        idx.push(a, b, c, a, c, d);
      }
    }
    if (o.caps ?? true) {
      const cap = (k: number, end: boolean): void => {
        const base = pos.length / 3;
        const p = points[k]!;
        pos.push(p.x, p.y, p.z);
        for (let j = 0; j < seg; j++) {
          const s = (k * seg + j) * 3;
          pos.push(pos[s]!, pos[s + 1]!, pos[s + 2]!);
        }
        for (let j = 0; j < seg; j++) {
          const a = base + 1 + j;
          const b = base + 1 + ((j + 1) % seg);
          if (end) idx.push(base, a, b);
          else idx.push(base, b, a);
        }
      };
      cap(n - 1, true);
      cap(0, false);
    }
    this.push(pos, smoothNormals(pos, idx), idx);
    return this;
  }

  /** Cinta plana sobre una superficie (correas, costuras, bandas): cada punto lleva su normal. */
  ribbon(points: readonly RibbonPoint[], width: number, off = 0.004): this {
    const n = points.length;
    if (n < 2) return this;
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    const T = new THREE.Vector3();
    const Nn = new THREE.Vector3();
    const W = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const a = points[Math.max(i - 1, 0)]!;
      const b = points[Math.min(i + 1, n - 1)]!;
      const p = points[i]!;
      T.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
      Nn.set(p.nx, p.ny, p.nz).normalize();
      W.crossVectors(T, Nn).normalize();
      for (const sgn of [-1, 1]) {
        pos.push(
          p.x + Nn.x * off + W.x * sgn * width * 0.5,
          p.y + Nn.y * off + W.y * sgn * width * 0.5,
          p.z + Nn.z * off + W.z * sgn * width * 0.5,
        );
        nor.push(Nn.x, Nn.y, Nn.z);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const l0 = i * 2;
      const r0 = l0 + 1;
      const l1 = l0 + 2;
      const r1 = l0 + 3;
      idx.push(l0, r0, r1, l0, r1, l1);
    }
    this.push(pos, nor, idx);
    return this;
  }
}

/** Mezcla lineal de dos colores 0xRRGGBB (en sRGB, suficiente para tintes de labios/sombras). */
export function mixHex(a: number, b: number, t: number): number {
  const ch = (s: number): number => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export const scaleHex = (c: number, k: number): number => {
  const ch = (s: number): number => Math.min(255, Math.max(0, Math.round(((c >> s) & 255) * k)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
