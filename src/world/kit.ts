/**
 * Kit de generación del layout (PURO, sin three.js): emite piezas estáticas, props, ventanas y luces,
 * mantiene un ráster de suelo y una rejilla de ocupación para colocar cosas sin solaparlas, y ofrece
 * constructores de alto nivel (muros con huecos, vallas, edificios con aberturas, escaleras, carreteras).
 */
import { MAP, WORLD } from '../config';
import type { MaterialKey, SurfaceKind, ZoneId } from '../core/types';
import type { Rng } from '../core/util';
import { createRng } from '../core/util';
import { zoneAt } from '../rules/zones';
import type {
  BeamPiece, BoxPiece, BuildingInfo, ColliderDef, CylPiece, DomePiece, FlatPiece, GlowKind, GlowSpec, GroundGrid,
  LootAnchor, PointLightSpec, PoiDef, Piece, PrismPiece, PropInstance, PropType, RampPiece, Rect, RoadInfo,
  VQuadPiece, WindowSpec, WorldLayout,
} from './types';
import { GK, PROP_SPECS } from './types';

/** Flags de la rejilla de ocupación (1 m). */
export const OCC = { struct: 1, road: 2, keep: 4, prop: 8, lane: 16 } as const;

export const SURFACE_OF: Partial<Record<MaterialKey, SurfaceKind>> = {
  asphalt: 'asphalt', asphaltWorn: 'asphalt', dirt: 'dirt', gravel: 'dirt', wood: 'wood', glass: 'glass', rubber: 'dirt',
  metalPanel: 'metal', corrugated: 'metal', rustMetal: 'metal', steelDark: 'metal', fence: 'metal', hazard: 'metal', pipe: 'metal',
  containerRed: 'metal', containerBlue: 'metal', containerGreen: 'metal', containerYellow: 'metal', containerGrey: 'metal',
  emissiveRed: 'metal', emissiveBlue: 'metal', emissiveAmber: 'metal', emissiveGreen: 'metal', emissiveWhite: 'metal',
};

export interface BoxOpts {
  rot?: number;
  surface?: SurfaceKind;
  collide?: boolean;
  ray?: boolean;
  cast?: boolean;
  top?: boolean;
}
export interface CylOpts {
  rTop?: number;
  seg?: number;
  matTop?: MaterialKey;
  surface?: SurfaceKind;
  collide?: boolean;
  ray?: boolean;
  cast?: boolean;
  capTop?: boolean;
}
export interface PropOpts {
  y?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  variant?: number;
  /** Comprobar ocupación (true por defecto): devuelve false si no cabe. */
  check?: boolean;
  /** Máscara de OCC que impide colocar. */
  avoid?: number;
}

export interface DoorDef {
  side: 'n' | 's' | 'e' | 'w';
  /** Desplazamiento del centro de la puerta respecto al centro de la fachada (m). */
  off: number;
  w: number;
  h: number;
}

export interface WindowStyle {
  rows: number;
  /** Probabilidad de ventana encendida. */
  lit: number;
  tone: 0 | 1 | 2 | 3;
  /** Separación entre ventanas (m). */
  every: number;
  /** Altura del primer nivel de ventanas. */
  y: number;
  w?: number;
  h?: number;
}

export interface BuildingOpts {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  wall: MaterialKey;
  roofMat?: MaterialKey;
  enterable?: boolean;
  doors?: DoorDef[];
  windows?: WindowStyle | false;
  roof?: 'flat' | 'gable';
  ridgeAlongX?: boolean;
  wallT?: number;
  floor?: number;
  cast?: boolean;
  /** Pilastros exteriores cada n metros (0 = ninguno). */
  pilasters?: number;
  /** Materiales de detalle. */
  trim?: MaterialKey;
}

const clampN = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class LayoutKit {
  readonly bounds: Rect = MAP.bounds;
  readonly rng: Rng;
  readonly pieces: Piece[] = [];
  readonly props: PropInstance[] = [];
  readonly windows: WindowSpec[] = [];
  readonly glows: GlowSpec[] = [];
  readonly pointLights: PointLightSpec[] = [];
  readonly pois: PoiDef[] = [];
  readonly lootAnchors: LootAnchor[] = [];
  readonly buildings: BuildingInfo[] = [];
  readonly roads: RoadInfo[] = [];
  readonly ground: GroundGrid;
  private readonly occ: Uint8Array;
  private readonly occCols: number;
  private readonly occRows: number;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
    this.rng = createRng(seed);
    const b = this.bounds;
    const cell = WORLD.groundCell;
    const cols = Math.ceil((b.maxX - b.minX) / cell);
    const rows = Math.ceil((b.maxZ - b.minZ) / cell);
    this.ground = { cell, cols, rows, originX: b.minX, originZ: b.minZ, data: new Uint8Array(cols * rows).fill(GK.concrete) };
    this.occCols = b.maxX - b.minX;
    this.occRows = b.maxZ - b.minZ;
    this.occ = new Uint8Array(this.occCols * this.occRows);
  }

  // ── Azar ───────────────────────────────────────────────────────────────────
  rand(a: number, b: number): number {
    return a + (b - a) * this.rng();
  }
  int(a: number, b: number): number {
    return Math.floor(a + (b - a + 1) * this.rng());
  }
  chance(p: number): boolean {
    return this.rng() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.rng() * arr.length)] as T;
  }

  // ── Suelo ──────────────────────────────────────────────────────────────────
  paintGround(r: Rect, kind: number): void {
    const g = this.ground;
    const c0 = Math.max(0, Math.floor((r.minX - g.originX) / g.cell));
    const c1 = Math.min(g.cols - 1, Math.ceil((r.maxX - g.originX) / g.cell) - 1);
    const r0 = Math.max(0, Math.floor((r.minZ - g.originZ) / g.cell));
    const r1 = Math.min(g.rows - 1, Math.ceil((r.maxZ - g.originZ) / g.cell) - 1);
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) g.data[rr * g.cols + cc] = kind;
  }

  paintDisc(cx: number, cz: number, radius: number, kind: number): void {
    const g = this.ground;
    const r2 = radius * radius;
    const c0 = Math.max(0, Math.floor((cx - radius - g.originX) / g.cell));
    const c1 = Math.min(g.cols - 1, Math.ceil((cx + radius - g.originX) / g.cell));
    const r0 = Math.max(0, Math.floor((cz - radius - g.originZ) / g.cell));
    const r1 = Math.min(g.rows - 1, Math.ceil((cz + radius - g.originZ) / g.cell));
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        const px = g.originX + (cc + 0.5) * g.cell;
        const pz = g.originZ + (rr + 0.5) * g.cell;
        if ((px - cx) * (px - cx) + (pz - cz) * (pz - cz) <= r2) g.data[rr * g.cols + cc] = kind;
      }
    }
  }

  /** Manchas de suelo irregulares en celdas (parches de tierra/grava/asfalto gastado). */
  paintBlobs(r: Rect, n: number, kinds: readonly number[], minR: number, maxR: number): void {
    for (let i = 0; i < n; i++) {
      const cx = this.rand(r.minX, r.maxX);
      const cz = this.rand(r.minZ, r.maxZ);
      const radius = this.rand(minR, maxR);
      const kind = this.pick(kinds);
      // sólo pinta sobre celdas no ocupadas por carretera
      const g = this.ground;
      const c0 = Math.max(0, Math.floor((cx - radius - g.originX) / g.cell));
      const c1 = Math.min(g.cols - 1, Math.ceil((cx + radius - g.originX) / g.cell));
      const r0 = Math.max(0, Math.floor((cz - radius - g.originZ) / g.cell));
      const r1 = Math.min(g.rows - 1, Math.ceil((cz + radius - g.originZ) / g.cell));
      for (let rr = r0; rr <= r1; rr++) {
        for (let cc = c0; cc <= c1; cc++) {
          const px = g.originX + (cc + 0.5) * g.cell;
          const pz = g.originZ + (rr + 0.5) * g.cell;
          const d = Math.hypot(px - cx, pz - cz);
          if (d > radius * (0.75 + 0.25 * this.rng())) continue;
          if (this.occAt(px, pz) & OCC.road) continue;
          g.data[rr * g.cols + cc] = kind;
        }
      }
    }
  }

  // ── Ocupación ──────────────────────────────────────────────────────────────
  private occIndex(x: number, z: number): number {
    const c = Math.floor(x - this.bounds.minX);
    const r = Math.floor(z - this.bounds.minZ);
    return c < 0 || r < 0 || c >= this.occCols || r >= this.occRows ? -1 : r * this.occCols + c;
  }
  occAt(x: number, z: number): number {
    const i = this.occIndex(x, z);
    return i < 0 ? OCC.struct : (this.occ[i] as number);
  }
  mark(r: Rect, flag: number, margin = 0): void {
    const c0 = Math.max(0, Math.floor(r.minX - margin - this.bounds.minX));
    const c1 = Math.min(this.occCols - 1, Math.ceil(r.maxX + margin - this.bounds.minX) - 1);
    const r0 = Math.max(0, Math.floor(r.minZ - margin - this.bounds.minZ));
    const r1 = Math.min(this.occRows - 1, Math.ceil(r.maxZ + margin - this.bounds.minZ) - 1);
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) this.occ[rr * this.occCols + cc]! |= flag;
  }
  markDisc(cx: number, cz: number, radius: number, flag: number): void {
    const c0 = Math.max(0, Math.floor(cx - radius - this.bounds.minX));
    const c1 = Math.min(this.occCols - 1, Math.ceil(cx + radius - this.bounds.minX));
    const r0 = Math.max(0, Math.floor(cz - radius - this.bounds.minZ));
    const r1 = Math.min(this.occRows - 1, Math.ceil(cz + radius - this.bounds.minZ));
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        const px = this.bounds.minX + cc + 0.5;
        const pz = this.bounds.minZ + rr + 0.5;
        if ((px - cx) * (px - cx) + (pz - cz) * (pz - cz) <= radius * radius) this.occ[rr * this.occCols + cc]! |= flag;
      }
    }
  }
  /** ¿El rectángulo (más margen) está libre de los flags de `mask`? */
  isFree(r: Rect, mask: number, margin = 0): boolean {
    const c0 = Math.floor(r.minX - margin - this.bounds.minX);
    const c1 = Math.ceil(r.maxX + margin - this.bounds.minX) - 1;
    const r0 = Math.floor(r.minZ - margin - this.bounds.minZ);
    const r1 = Math.ceil(r.maxZ + margin - this.bounds.minZ) - 1;
    if (c0 < 0 || r0 < 0 || c1 >= this.occCols || r1 >= this.occRows) return false;
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) if ((this.occ[rr * this.occCols + cc] as number) & mask) return false;
    return true;
  }
  isFreeDisc(cx: number, cz: number, radius: number, mask: number): boolean {
    const c0 = Math.floor(cx - radius - this.bounds.minX);
    const c1 = Math.ceil(cx + radius - this.bounds.minX) - 1;
    const r0 = Math.floor(cz - radius - this.bounds.minZ);
    const r1 = Math.ceil(cz + radius - this.bounds.minZ) - 1;
    if (c0 < 0 || r0 < 0 || c1 >= this.occCols || r1 >= this.occRows) return false;
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) if ((this.occ[rr * this.occCols + cc] as number) & mask) return false;
    return true;
  }

  // ── POIs ───────────────────────────────────────────────────────────────────
  poi(id: string, x: number, z: number, clear: number = WORLD.poiClearRadius): void {
    this.pois.push({ id, x, z, clear });
    this.markDisc(x, z, clear + 0.5, OCC.keep);
  }
  nearPoi(x: number, z: number, radius: number): boolean {
    for (const p of this.pois) if (Math.hypot(p.x - x, p.z - z) < p.clear + radius) return true;
    return false;
  }

  // ── Emisión de piezas ──────────────────────────────────────────────────────
  box(cx: number, cz: number, sx: number, sz: number, y0: number, y1: number, mat: MaterialKey, o: BoxOpts = {}): BoxPiece {
    const vol = sx * sz * (y1 - y0);
    const p: BoxPiece = {
      t: 'box', cx, cz, sx, sz, y0, y1, rot: o.rot ?? 0, mat,
      surface: o.surface ?? SURFACE_OF[mat] ?? 'concrete',
      collide: o.collide ?? true, ray: o.ray ?? true,
      cast: o.cast ?? (vol > 45 && y1 - y0 >= 2.5),
      top: o.top ?? true,
    };
    this.pieces.push(p);
    return p;
  }
  /** Caja definida por rectángulo de esquinas. */
  boxR(r: Rect, y0: number, y1: number, mat: MaterialKey, o: BoxOpts = {}): BoxPiece {
    return this.box((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2, r.maxX - r.minX, r.maxZ - r.minZ, y0, y1, mat, o);
  }
  cyl(cx: number, cz: number, r: number, y0: number, y1: number, mat: MaterialKey, o: CylOpts = {}): CylPiece {
    const p: CylPiece = {
      t: 'cyl', cx, cz, r, rTop: o.rTop ?? r, y0, y1, seg: o.seg ?? (r > 3 ? 40 : r > 1 ? 24 : 12), mat,
      matTop: o.matTop ?? mat, surface: o.surface ?? SURFACE_OF[mat] ?? 'concrete',
      collide: o.collide ?? true, ray: o.ray ?? true,
      cast: o.cast ?? (r > 2 && y1 - y0 > 3), capTop: o.capTop ?? true,
    };
    this.pieces.push(p);
    return p;
  }
  ramp(cx: number, cz: number, len: number, wid: number, y0: number, y1: number, rot: number, mat: MaterialKey, surface?: SurfaceKind): RampPiece {
    const p: RampPiece = { t: 'ramp', cx, cz, sx: len, sz: wid, y0, y1, rot, mat, surface: surface ?? SURFACE_OF[mat] ?? 'concrete', cast: false };
    this.pieces.push(p);
    return p;
  }
  flat(cx: number, cz: number, sx: number, sz: number, y: number, mat: MaterialKey, shape: FlatPiece['shape'] = 'rect', rot = 0, r0 = 0): FlatPiece {
    const p: FlatPiece = { t: 'flat', cx, cz, sx, sz, r0, y, rot, shape, mat, seed: Math.floor(this.rng() * 1e6) };
    this.pieces.push(p);
    return p;
  }
  vquad(x: number, y: number, z: number, w: number, h: number, rot: number, mat: MaterialKey): VQuadPiece {
    const p: VQuadPiece = { t: 'vquad', x, y, z, w, h, rot, mat };
    this.pieces.push(p);
    return p;
  }
  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, mat: MaterialKey, round = false, cast = false): BeamPiece {
    const p: BeamPiece = { t: 'beam', ax, ay, az, bx, by, bz, w, round, mat, cast };
    this.pieces.push(p);
    return p;
  }
  dome(cx: number, cz: number, r: number, y0: number, h: number, mat: MaterialKey, cast = false): DomePiece {
    const p: DomePiece = { t: 'dome', cx, cz, r, y0, h, mat, cast };
    this.pieces.push(p);
    return p;
  }
  prism(cx: number, cz: number, sx: number, sz: number, y0: number, h: number, mat: MaterialKey, ridgeZ = false, rot = 0): PrismPiece {
    const p: PrismPiece = { t: 'prism', cx, cz, sx, sz, y0, h, rot, ridgeZ, mat, cast: sx * sz > 300 };
    this.pieces.push(p);
    return p;
  }

  // ── Props ──────────────────────────────────────────────────────────────────
  /** Coloca un prop; comprueba ocupación y puntos clave. Devuelve false si no cabe. */
  prop(type: PropType, x: number, z: number, rot = 0, o: PropOpts = {}): boolean {
    const spec = PROP_SPECS[type];
    const sx = o.sx ?? 1;
    const sy = o.sy ?? 1;
    const sz = o.sz ?? 1;
    const w = spec.box ? spec.box.w * sx : spec.cyl ? spec.cyl.r * 2 * sx : 1;
    const d = spec.box ? spec.box.d * sz : spec.cyl ? spec.cyl.r * 2 * sx : 1;
    const ext = Math.hypot(w, d) / 2;
    const hasCol = !!(spec.box || spec.cyl);
    if (o.check !== false) {
      const avoid = o.avoid ?? (OCC.struct | OCC.prop | OCC.keep | OCC.lane);
      // Huella aproximada (caja orientada → AABB)
      const c = Math.abs(Math.cos(rot));
      const s = Math.abs(Math.sin(rot));
      const hx = (c * w + s * d) / 2;
      const hz = (s * w + c * d) / 2;
      const r: Rect = { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
      if (!this.isFree(r, avoid)) return false;
      if (hasCol && this.nearPoi(x, z, ext)) return false;
      this.mark(r, OCC.prop);
    }
    this.props.push({ type, x, y: o.y ?? 0, z, rot, sx, sy, sz, variant: o.variant ?? 0 });
    if (spec.loot && (o.y ?? 0) < 0.5 && this.rng() < 0.32) {
      const a = this.rng() * Math.PI * 2;
      this.loot(x + Math.cos(a) * (ext + 1.4), z + Math.sin(a) * (ext + 1.4));
    }
    return true;
  }

  /** Reparte hasta `count` intentos exitosos en `r` llamando a `fn(x, z)`. */
  scatter(r: Rect, count: number, fn: (x: number, z: number) => boolean, triesPer = 8): number {
    let ok = 0;
    for (let i = 0; i < count * triesPer && ok < count; i++) {
      if (fn(this.rand(r.minX, r.maxX), this.rand(r.minZ, r.maxZ))) ok++;
    }
    return ok;
  }

  // ── Luces y ventanas ───────────────────────────────────────────────────────
  glow(x: number, y: number, z: number, size: number, color: number, kind: GlowKind = 'steady', rate = 1, intensity = 1, phase = -1): void {
    this.glows.push({ x, y, z, size, color, kind, rate, phase: phase < 0 ? this.rng() * 6.283 : phase, intensity });
  }
  pointLight(id: string, x: number, y: number, z: number, color: number, intensity: number, distance: number, flicker = 0): void {
    this.pointLights.push({ id, x, y, z, color, intensity, distance, flicker });
  }
  window(x: number, y: number, z: number, rot: number, w: number, h: number, tone: 0 | 1 | 2 | 3): void {
    this.windows.push({ x, y, z, rot, w, h, tone });
  }
  loot(x: number, z: number): void {
    this.lootAnchors.push({ x, z, zone: zoneAt(x, z) });
  }

  // ── Muros y vallas ─────────────────────────────────────────────────────────
  /**
   * Muro axial (x0==x1 ó z0==z1) de espesor `t` entre alturas y0..y1, troceado en segmentos ≤ `segLen`.
   * `gaps` = intervalos [a,b] (m desde el inicio) sin muro; `gapH` = altura del dintel sobre el hueco.
   */
  wall(x0: number, z0: number, x1: number, z1: number, t: number, y0: number, y1: number, mat: MaterialKey,
    gaps: ReadonlyArray<readonly [number, number]> = [], gapH = 0, o: BoxOpts & { segLen?: number } = {}): void {
    const alongX = Math.abs(z1 - z0) < 1e-6;
    const a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1);
    const a1 = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
    const fixed = alongX ? z0 : x0;
    const segLen = o.segLen ?? 16;
    const sorted = [...gaps].sort((p, q) => p[0] - q[0]);
    const emit = (s: number, e: number, yy0: number, yy1: number): void => {
      if (e - s < 0.05) return;
      const n = Math.max(1, Math.ceil((e - s) / segLen));
      const step = (e - s) / n;
      for (let i = 0; i < n; i++) {
        const p = s + step * i;
        const q = p + step;
        const mid = (p + q) / 2;
        if (alongX) this.box(mid, fixed, q - p, t, yy0, yy1, mat, o);
        else this.box(fixed, mid, t, q - p, yy0, yy1, mat, o);
      }
    };
    let cur = a0;
    for (const g of sorted) {
      const gs = a0 + g[0];
      const ge = a0 + g[1];
      emit(cur, gs, y0, y1);
      if (gapH > 0 && gapH < y1) emit(gs, ge, Math.max(y0, gapH), y1);
      cur = ge;
    }
    emit(cur, a1, y0, y1);
  }

  /** Valla de tela metálica: paneles finos (bloquean el paso, no los disparos) + postes y travesaño. */
  fence(x0: number, z0: number, x1: number, z1: number, h = 2.4, gaps: ReadonlyArray<readonly [number, number]> = [], postEvery = 4, mat: MaterialKey = 'fence'): void {
    const alongX = Math.abs(z1 - z0) < 1e-6;
    const a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1);
    const a1 = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
    const fixed = alongX ? z0 : x0;
    const sorted = [...gaps].sort((p, q) => p[0] - q[0]);
    const seg = (s: number, e: number): void => {
      if (e - s < 0.3) return;
      const n = Math.max(1, Math.ceil((e - s) / 8));
      const step = (e - s) / n;
      for (let i = 0; i < n; i++) {
        const p = s + step * i;
        const q = p + step;
        const mid = (p + q) / 2;
        if (alongX) this.box(mid, fixed, q - p, 0.06, 0, h, mat, { ray: false, cast: false });
        else this.box(fixed, mid, 0.06, q - p, 0, h, mat, { ray: false, cast: false });
      }
      // postes
      const np = Math.max(1, Math.round((e - s) / postEvery));
      for (let i = 0; i <= np; i++) {
        const u = s + ((e - s) * i) / np;
        if (alongX) this.box(u, fixed, 0.14, 0.14, 0, h + 0.25, 'steelDark', { collide: false, top: false });
        else this.box(fixed, u, 0.14, 0.14, 0, h + 0.25, 'steelDark', { collide: false, top: false });
      }
      // travesaño superior
      if (alongX) this.box((s + e) / 2, fixed, e - s, 0.08, h - 0.05, h + 0.05, 'steelDark', { collide: false });
      else this.box(fixed, (s + e) / 2, 0.08, e - s, h - 0.05, h + 0.05, 'steelDark', { collide: false });
    };
    let cur = a0;
    for (const g of sorted) {
      seg(cur, a0 + g[0]);
      cur = a0 + g[1];
    }
    seg(cur, a1);
    // huella en la rejilla de ocupación
    if (alongX) this.mark({ minX: a0, maxX: a1, minZ: fixed - 0.5, maxZ: fixed + 0.5 }, OCC.struct);
    else this.mark({ minX: fixed - 0.5, maxX: fixed + 0.5, minZ: a0, maxZ: a1 }, OCC.struct);
  }

  // ── Escaleras ──────────────────────────────────────────────────────────────
  /**
   * Escalera de peldaños ≤ 0.29 m (pisables sin saltar). Empieza en (x,z) sobre el suelo y sube en la
   * dirección `dir` (0=+X, 1=+Z, 2=-X, 3=-Z) hasta `rise`. Devuelve su longitud.
   */
  stairs(x: number, z: number, dir: 0 | 1 | 2 | 3, width: number, rise: number, mat: MaterialKey = 'concrete', base = 0): number {
    const n = Math.ceil((rise - base) / 0.28);
    const riser = (rise - base) / n;
    const tread = 0.34;
    const dx = dir === 0 ? 1 : dir === 2 ? -1 : 0;
    const dz = dir === 1 ? 1 : dir === 3 ? -1 : 0;
    for (let i = 1; i <= n; i++) {
      const d = (i - 0.5) * tread;
      const cx = x + dx * d;
      const cz = z + dz * d;
      const sx = dx !== 0 ? tread : width;
      const sz = dz !== 0 ? tread : width;
      this.box(cx, cz, sx, sz, 0, base + riser * i, mat, { cast: false });
    }
    const len = n * tread;
    const ex = dx !== 0 ? [x, x + dx * len] : [x - width / 2, x + width / 2];
    const ez = dz !== 0 ? [z, z + dz * len] : [z - width / 2, z + width / 2];
    this.mark({ minX: Math.min(ex[0] as number, ex[1] as number), maxX: Math.max(ex[0] as number, ex[1] as number), minZ: Math.min(ez[0] as number, ez[1] as number), maxZ: Math.max(ez[0] as number, ez[1] as number) }, OCC.struct);
    return len;
  }

  // ── Carreteras ─────────────────────────────────────────────────────────────
  road(r: Rect, axis: 'x' | 'z', worn = false): void {
    const width = axis === 'x' ? r.maxZ - r.minZ : r.maxX - r.minX;
    this.roads.push({ rect: r, axis, width });
    this.paintGround(r, worn ? GK.asphaltWorn : GK.asphalt);
    this.mark(r, OCC.road);
    // carril central libre de 4.8 m (coches/barricadas no cierran la vía; garantiza paso del Warden)
    const m = Math.max(0, (width - 4.8) / 2);
    if (axis === 'x') this.mark({ minX: r.minX, maxX: r.maxX, minZ: r.minZ + m, maxZ: r.maxZ - m }, OCC.lane);
    else this.mark({ minX: r.minX + m, maxX: r.maxX - m, minZ: r.minZ, maxZ: r.maxZ }, OCC.lane);
  }

  private inAnyRoad(x: number, z: number, except: RoadInfo | null, margin = 0): boolean {
    for (const rd of this.roads) {
      if (rd === except) continue;
      const r = rd.rect;
      if (x >= r.minX - margin && x <= r.maxX + margin && z >= r.minZ - margin && z <= r.maxZ + margin) return true;
    }
    return false;
  }

  /** Marcas viales, bordillos y farolas de todas las carreteras registradas. */
  paintRoadDetails(): void {
    for (const rd of this.roads) {
      const r = rd.rect;
      const alongX = rd.axis === 'x';
      const a0 = alongX ? r.minX : r.minZ;
      const a1 = alongX ? r.maxX : r.maxZ;
      const c = alongX ? (r.minZ + r.maxZ) / 2 : (r.minX + r.maxX) / 2;
      const half = rd.width / 2;
      const px = (u: number, v: number): [number, number] => (alongX ? [u, c + v] : [c + v, u]);
      // línea central discontinua
      for (let u = a0 + 2; u < a1 - 3; u += 8) {
        const [mx, mz] = px(u + 1.5, 0);
        if (this.inAnyRoad(mx, mz, rd, 1)) continue;
        this.flat(mx, mz, alongX ? 3 : 0.22, alongX ? 0.22 : 3, 0.04, 'roadLine');
      }
      // líneas de borde continuas por tramos
      for (const side of [-1, 1]) {
        for (let u = a0; u < a1; u += 6) {
          const ue = Math.min(a1, u + 6);
          const [mx, mz] = px((u + ue) / 2, side * (half - 0.7));
          if (this.inAnyRoad(mx, mz, rd, 0.6)) continue;
          this.flat(mx, mz, alongX ? ue - u : 0.16, alongX ? 0.16 : ue - u, 0.04, 'roadLine');
        }
      }
      // bordillos (sólo visuales, 0.15 m)
      for (const side of [-1, 1]) {
        for (let u = a0; u < a1; u += 8) {
          const ue = Math.min(a1, u + 8);
          const [mx, mz] = px((u + ue) / 2, side * (half + 0.12));
          if (this.inAnyRoad(mx, mz, rd, 0.5)) continue;
          this.box(mx, mz, alongX ? ue - u : 0.24, alongX ? 0.24 : ue - u, 0, 0.15, 'concreteDark', { collide: false, cast: false });
        }
      }
      // farolas escalonadas
      let k = 0;
      for (let u = a0 + 10; u < a1 - 4; u += 26) {
        const side = k++ % 2 === 0 ? -1 : 1;
        const [mx, mz] = px(u, side * (half + 1.6));
        if (this.inAnyRoad(mx, mz, rd, 1.5) || (this.occAt(mx, mz) & (OCC.struct | OCC.keep))) continue;
        this.streetLamp(mx, mz, alongX ? (side < 0 ? Math.PI / 2 : -Math.PI / 2) : (side < 0 ? 0 : Math.PI));
      }
    }
  }

  /** Farola: prop instanciado (poste + brazo + bombilla) + halo. `rot` orienta el brazo. */
  streetLamp(x: number, z: number, rot: number, color = 0xffc98a, broken = false): void {
    if (!this.prop('lamp', x, z, rot, { avoid: OCC.struct | OCC.keep | OCC.prop })) return;
    // La bombilla queda a 6.85 m de altura y 1.15 m en la dirección del brazo (eje local +X del prop).
    const bx = x + Math.cos(rot) * 1.15;
    const bz = z - Math.sin(rot) * 1.15;
    this.glow(bx, 6.7, bz, broken ? 2.2 : 5.5, color, broken ? 'flicker' : 'steady', broken ? 3 : 1, broken ? 0.7 : 1);
  }

  // ── Edificios ──────────────────────────────────────────────────────────────
  building(o: BuildingOpts): void {
    const T = o.wallT ?? 0.5;
    const hw = o.w / 2;
    const hd = o.d / 2;
    const rect: Rect = { minX: o.x - hw, maxX: o.x + hw, minZ: o.z - hd, maxZ: o.z + hd };
    const zone = zoneAt(o.x, o.z);
    const enterable = !!o.enterable;
    this.buildings.push({ id: o.id, zone, rect, enterable, height: o.h });
    this.mark(rect, OCC.struct, 1.2);
    const doors = o.doors ?? [];
    const roofMat = o.roofMat ?? 'concreteDark';
    const trim = o.trim ?? 'concreteDark';
    const cast = o.cast ?? true;
    const wallOpts: BoxOpts = { cast };

    if (!enterable) {
      this.box(o.x, o.z, o.w, o.d, 0, o.h, o.wall, { cast, top: false });
    } else {
      const gapsFor = (side: 'n' | 's' | 'e' | 'w', len: number): Array<[number, number]> =>
        doors.filter((d) => d.side === side).map((d) => [len / 2 + d.off - d.w / 2, len / 2 + d.off + d.w / 2] as [number, number]);
      const dh = doors.length ? Math.min(...doors.map((d) => d.h)) : 0;
      // muros (cara exterior alineada con el rectángulo)
      this.wall(rect.minX, rect.minZ + T / 2, rect.maxX, rect.minZ + T / 2, T, 0, o.h, o.wall, gapsFor('n', o.w), dh, wallOpts);
      this.wall(rect.minX, rect.maxZ - T / 2, rect.maxX, rect.maxZ - T / 2, T, 0, o.h, o.wall, gapsFor('s', o.w), dh, wallOpts);
      this.wall(rect.minX + T / 2, rect.minZ + T, rect.minX + T / 2, rect.maxZ - T, T, 0, o.h, o.wall, gapsFor('w', o.d - 2 * T), dh, wallOpts);
      this.wall(rect.maxX - T / 2, rect.minZ + T, rect.maxX - T / 2, rect.maxZ - T, T, 0, o.h, o.wall, gapsFor('e', o.d - 2 * T), dh, wallOpts);
      // suelo interior
      this.paintGround({ minX: rect.minX + T, maxX: rect.maxX - T, minZ: rect.minZ + T, maxZ: rect.maxZ - T }, o.floor ?? GK.concreteDark);
      // marcos de puerta
      for (const d of doors) this.doorFrame(rect, d, T);
    }

    // Tejado: losa (colisiona para los disparos, no es transitable) + parapeto/dos aguas
    this.box(o.x, o.z, o.w + 0.2, o.d + 0.2, o.h, o.h + 0.3, roofMat, { cast, top: true });
    if ((o.roof ?? 'flat') === 'gable') {
      const ridgeZ = !(o.ridgeAlongX ?? o.w >= o.d);
      this.prism(o.x, o.z, o.w + 0.6, o.d + 0.6, o.h + 0.3, Math.min(o.w, o.d) * 0.16, 'corrugated', ridgeZ);
    } else {
      // parapeto
      const pw = 0.3;
      const py = o.h + 0.3;
      const ph = 0.7;
      this.box(o.x, rect.minZ + pw / 2, o.w + 0.2, pw, py, py + ph, trim, { collide: false, cast: false });
      this.box(o.x, rect.maxZ - pw / 2, o.w + 0.2, pw, py, py + ph, trim, { collide: false, cast: false });
      this.box(rect.minX + pw / 2, o.z, pw, o.d - 2 * pw, py, py + ph, trim, { collide: false, cast: false });
      this.box(rect.maxX - pw / 2, o.z, pw, o.d - 2 * pw, py, py + ph, trim, { collide: false, cast: false });
    }
    // Zócalo (con huecos en las puertas si es enterable)
    if (!enterable) {
      this.box(o.x, o.z, o.w + 0.24, o.d + 0.24, 0, 0.9, 'concreteDark', { collide: false, cast: false, top: false });
    } else {
      const zg = (side: 'n' | 's' | 'e' | 'w', len: number): Array<[number, number]> =>
        doors.filter((d) => d.side === side).map((d) => [len / 2 + d.off - d.w / 2, len / 2 + d.off + d.w / 2] as [number, number]);
      const zo = { collide: false, cast: false, top: false } as const;
      this.wall(rect.minX - 0.12, rect.minZ - 0.12, rect.maxX + 0.12, rect.minZ - 0.12, 0.24, 0, 0.9, 'concreteDark', zg('n', o.w + 0.24), 0, zo);
      this.wall(rect.minX - 0.12, rect.maxZ + 0.12, rect.maxX + 0.12, rect.maxZ + 0.12, 0.24, 0, 0.9, 'concreteDark', zg('s', o.w + 0.24), 0, zo);
      this.wall(rect.minX - 0.12, rect.minZ, rect.minX - 0.12, rect.maxZ, 0.24, 0, 0.9, 'concreteDark', zg('w', o.d), 0, zo);
      this.wall(rect.maxX + 0.12, rect.minZ, rect.maxX + 0.12, rect.maxZ, 0.24, 0, 0.9, 'concreteDark', zg('e', o.d), 0, zo);
    }
    // Pilastros
    if (o.pilasters && o.pilasters > 0) {
      for (let u = rect.minX + o.pilasters / 2; u < rect.maxX - 0.5; u += o.pilasters) {
        this.box(u, rect.minZ - 0.1, 0.5, 0.36, 0, o.h, trim, { collide: false, cast: false, top: false });
        this.box(u, rect.maxZ + 0.1, 0.5, 0.36, 0, o.h, trim, { collide: false, cast: false, top: false });
      }
    }
    // Puertas pintadas (edificios macizos) y ventanas
    if (!enterable) for (const d of doors) this.paintedDoor(rect, d);
    if (o.windows !== false) this.facadeWindows(rect, o.h, o.windows ?? { rows: 1, lit: 0.25, tone: 0, every: 4.5, y: 3.4 }, doors);
    // luces junto a las puertas
    for (const d of doors) this.doorLamp(rect, d);
  }

  private facePoint(rect: Rect, side: 'n' | 's' | 'e' | 'w', off: number, out = 0): { x: number; z: number; nx: number; nz: number } {
    const cx = (rect.minX + rect.maxX) / 2;
    const cz = (rect.minZ + rect.maxZ) / 2;
    switch (side) {
      case 'n': return { x: cx + off, z: rect.minZ - out, nx: 0, nz: -1 };
      case 's': return { x: cx + off, z: rect.maxZ + out, nx: 0, nz: 1 };
      case 'e': return { x: rect.maxX + out, z: cz + off, nx: 1, nz: 0 };
      default: return { x: rect.minX - out, z: cz + off, nx: -1, nz: 0 };
    }
  }

  private doorFrame(rect: Rect, d: DoorDef, T: number): void {
    const p = this.facePoint(rect, d.side, d.off, 0);
    const alongX = d.side === 'n' || d.side === 's';
    const inward = alongX ? { x: 0, z: -p.nz * T / 2 } : { x: -p.nx * T / 2, z: 0 };
    const cx = p.x + inward.x;
    const cz = p.z + inward.z;
    const fw = 0.35;
    if (alongX) {
      this.box(cx - d.w / 2 - fw / 2, cz, fw, T + 0.3, 0, d.h, 'steelDark', { collide: false, cast: false });
      this.box(cx + d.w / 2 + fw / 2, cz, fw, T + 0.3, 0, d.h, 'steelDark', { collide: false, cast: false });
      this.box(cx, cz, d.w + fw * 2, T + 0.3, d.h - 0.15, d.h + 0.2, 'steelDark', { collide: false, cast: false });
      // hoja abierta (cortina enrollable recogida) — decorativa
      this.box(cx, cz, d.w, 0.12, d.h - 0.02, d.h + 0.55, 'corrugated', { collide: false, cast: false });
    } else {
      this.box(cx, cz - d.w / 2 - fw / 2, T + 0.3, fw, 0, d.h, 'steelDark', { collide: false, cast: false });
      this.box(cx, cz + d.w / 2 + fw / 2, T + 0.3, fw, 0, d.h, 'steelDark', { collide: false, cast: false });
      this.box(cx, cz, T + 0.3, d.w + fw * 2, d.h - 0.15, d.h + 0.2, 'steelDark', { collide: false, cast: false });
      this.box(cx, cz, 0.12, d.w, d.h - 0.02, d.h + 0.55, 'corrugated', { collide: false, cast: false });
    }
  }

  private paintedDoor(rect: Rect, d: DoorDef): void {
    const p = this.facePoint(rect, d.side, d.off, 0.04);
    const rot = Math.atan2(p.nx, p.nz);
    this.vquad(p.x, 0, p.z, d.w, d.h, rot, 'steelDark');
    this.vquad(p.x + p.nx * 0.01, 0.9, p.z + p.nz * 0.01, 0.6, 0.35, rot, 'hazard');
  }

  private doorLamp(rect: Rect, d: DoorDef): void {
    const p = this.facePoint(rect, d.side, d.off + d.w / 2 + 0.9, 0.25);
    this.box(p.x, p.z, 0.3, 0.3, d.h + 0.25, d.h + 0.4, 'steelDark', { collide: false, cast: false });
    this.glow(p.x + p.nx * 0.2, d.h + 0.15, p.z + p.nz * 0.2, 3.2, 0xffc890, 'steady', 1, 0.9);
  }

  private facadeWindows(rect: Rect, h: number, st: WindowStyle, doors: readonly DoorDef[]): void {
    const w = st.w ?? 1.5;
    const wh = st.h ?? 1.1;
    const faces: Array<'n' | 's' | 'e' | 'w'> = ['n', 's', 'e', 'w'];
    for (const side of faces) {
      const alongX = side === 'n' || side === 's';
      const len = alongX ? rect.maxX - rect.minX : rect.maxZ - rect.minZ;
      const n = Math.max(0, Math.floor((len - 2) / st.every));
      if (n <= 0) continue;
      const rot = Math.atan2(side === 'e' ? 1 : side === 'w' ? -1 : 0, side === 's' ? 1 : side === 'n' ? -1 : 0);
      for (let row = 0; row < st.rows; row++) {
        const y = st.y + row * (wh + 1.3);
        if (y + wh > h - 0.4) break;
        for (let i = 0; i < n; i++) {
          const off = (i - (n - 1) / 2) * st.every;
          if (doors.some((d) => d.side === side && Math.abs(d.off - off) < d.w / 2 + w / 2 + 0.4 && y < d.h + 0.6)) continue;
          const p = this.facePoint(rect, side, off, 0.05);
          if (this.chance(st.lit)) this.window(p.x, y, p.z, rot, w, wh, st.tone);
          else this.vquad(p.x, y, p.z, w, wh, rot, 'steelDark');
        }
      }
    }
  }

  // ── Finalización ───────────────────────────────────────────────────────────
  buildColliders(): ColliderDef[] {
    const out: ColliderDef[] = [];
    for (const p of this.pieces) {
      if (p.t === 'box' && p.collide) {
        out.push({ shape: 'box', x: p.cx, z: p.cz, hx: p.sx / 2, hz: p.sz / 2, r: 0, rot: p.rot, y0: p.y0, y1: p.y1, rampLow: 0, surface: p.surface, ray: p.ray });
      } else if (p.t === 'cyl' && p.collide) {
        out.push({ shape: 'cyl', x: p.cx, z: p.cz, hx: p.r, hz: p.r, r: p.r, rot: 0, y0: p.y0, y1: p.y1, rampLow: 0, surface: p.surface, ray: p.ray });
      } else if (p.t === 'ramp') {
        out.push({ shape: 'ramp', x: p.cx, z: p.cz, hx: p.sx / 2, hz: p.sz / 2, r: 0, rot: p.rot, y0: 0, y1: p.y1, rampLow: p.y0, surface: p.surface, ray: true });
      }
    }
    for (const q of this.props) {
      const spec = PROP_SPECS[q.type];
      if (spec.box) {
        out.push({ shape: 'box', x: q.x, z: q.z, hx: (spec.box.w * q.sx) / 2, hz: (spec.box.d * q.sz) / 2, r: 0, rot: q.rot, y0: q.y, y1: q.y + spec.box.h * q.sy, rampLow: 0, surface: spec.surface, ray: true });
      } else if (spec.cyl) {
        out.push({ shape: 'cyl', x: q.x, z: q.z, hx: spec.cyl.r * q.sx, hz: spec.cyl.r * q.sx, r: spec.cyl.r * q.sx, rot: 0, y0: q.y, y1: q.y + spec.cyl.h * q.sy, rampLow: 0, surface: spec.surface, ray: true });
      }
    }
    return out;
  }

  finish(): WorldLayout {
    const colliders = this.buildColliders();
    let boxes = 0;
    let cyls = 0;
    let ramps = 0;
    for (const p of this.pieces) {
      if (p.t === 'box') boxes++;
      else if (p.t === 'cyl') cyls++;
      else if (p.t === 'ramp') ramps++;
    }
    return {
      seed: this.seed, bounds: this.bounds, pieces: this.pieces, props: this.props, windows: this.windows, glows: this.glows,
      pointLights: this.pointLights, colliders, ground: this.ground, pois: this.pois, lootAnchors: this.lootAnchors,
      buildings: this.buildings, roads: this.roads,
      counts: { boxes, cyls, ramps, props: this.props.length, colliders: colliders.length },
    };
  }

  /** Utilidad: recorta un valor a los límites jugables. */
  clampX(x: number, m = 4): number {
    return clampN(x, this.bounds.minX + WORLD.wallThickness + m, this.bounds.maxX - WORLD.wallThickness - m);
  }
  clampZ(z: number, m = 4): number {
    return clampN(z, this.bounds.minZ + WORLD.wallThickness + m, this.bounds.maxZ - WORLD.wallThickness - m);
  }
}

export type { ZoneId };
