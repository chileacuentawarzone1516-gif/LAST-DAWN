/**
 * Recetas de texturas procedurales (una por MaterialKey). Cada receta es un «pixel shader» en
 * JS: recibe (x, y, u, v) y escribe albedo, altura, rugosidad, metalicidad y alfa en un `Px`
 * reutilizado (sin asignaciones). Todo es PERIÓDICO (tileable): ruido por capas compartidas
 * con desplazamientos enteros y patrones analíticos con periodo entero.
 *
 * Convención de orientación: u = horizontal, v = vertical (arriba en muros; z en suelos).
 * Costillas/tablones/ladrillos son horizontales/verticales según el nombre de la receta.
 */
import type { MaterialKey } from '../core/types';
import { fillWorley, getNoiseLayers, hash2 } from './noise';
import type { NoiseLayers } from './noise';

export type RGB = readonly [number, number, number];

/** Píxel de trabajo: color 0..255, altura/rugosidad/metal 0..1, alfa 0..255. */
export interface Px {
  r: number;
  g: number;
  b: number;
  h: number;
  ro: number;
  me: number;
  a: number;
}

/** Muestreador del banco de ruido (índices enteros, periódico). */
export class Sampler {
  private readonly st: number;
  constructor(private readonly l: NoiseLayers, size: number) {
    this.st = l.size / size;
  }
  private at(a: Float32Array, x: number, y: number, kx: number, ky: number, ox: number, oy: number): number {
    const xi = (((x * this.st * kx) | 0) + ox) & 255;
    const yi = (((y * this.st * ky) | 0) + oy) & 255;
    return a[(yi << 8) | xi] as number;
  }
  lo(x: number, y: number, kx = 1, ky = kx, ox = 0, oy = 0): number { return this.at(this.l.lo, x, y, kx, ky, ox, oy); }
  mid(x: number, y: number, kx = 1, ky = kx, ox = 0, oy = 0): number { return this.at(this.l.mid, x, y, kx, ky, ox, oy); }
  hi(x: number, y: number, kx = 1, ky = kx, ox = 0, oy = 0): number { return this.at(this.l.hi, x, y, kx, ky, ox, oy); }
  ridge(x: number, y: number, kx = 1, ky = kx, ox = 0, oy = 0): number { return this.at(this.l.ridge, x, y, kx, ky, ox, oy); }
  white(x: number, y: number, ox = 0, oy = 0): number { return this.at(this.l.white, x, y, 1, 1, ox, oy); }
}

export type PxFn = (x: number, y: number, u: number, v: number, p: Px, s: Sampler) => void;

export interface Recipe {
  /** Metros de mundo por repetición. */
  tile: number;
  px: PxFn;
  /** Rugosidad/metalicidad constantes (modo barato sin mapas). */
  ro: number;
  me: number;
  /** Fuerza del mapa de normales (0 = sin normal map). */
  normal?: number;
  /** El alfa del albedo es real (cristal, valla). */
  alpha?: 'blend' | 'test';
  /** Material emisivo: color emisivo e intensidad. */
  emissive?: { color: number; intensity: number };
  /** Color base del material (multiplica el mapa; blanco por defecto). */
  tint?: number;
  /** Lado de generación en px (por defecto 128; 256 para superficies grandes del mundo; 64 emisivos). */
  size?: number;
}

const sat = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const ss = (a: number, b: number, v: number): number => {
  const t = sat((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const fr = (v: number): number => v - Math.floor(v);

let worley: { d: Float32Array; id: Float32Array } | null = null;
function getWorley(): { d: Float32Array; id: Float32Array } {
  if (!worley) {
    const d = new Float32Array(256 * 256);
    const id = new Float32Array(256 * 256);
    fillWorley(d, id, 256, 24, 91);
    worley = { d, id };
  }
  return worley;
}
const worleyAt = (a: Float32Array, x: number, y: number, S: number): number => {
  const st = 256 / S;
  return a[((((y * st) | 0) & 255) << 8) | (((x * st) | 0) & 255)] as number;
};

/** Escribe un color con variación multiplicativa por ruido y altura. */
function base(p: Px, c: RGB, v: number, h: number): void {
  p.r = c[0] * v;
  p.g = c[1] * v;
  p.b = c[2] * v;
  p.h = h;
}
const vary = (s: Sampler, x: number, y: number, a: number, b: number, c: number): number =>
  1 + (s.lo(x, y) - 0.5) * a + (s.mid(x, y, 2, 2, 40, 90) - 0.5) * b + (s.hi(x, y) - 0.5) * c;
const tintTo = (p: Px, c: RGB, k: number): void => {
  p.r += (c[0] - p.r) * k;
  p.g += (c[1] - p.g) * k;
  p.b += (c[2] - p.b) * k;
};
const darken = (p: Px, k: number): void => {
  p.r *= k;
  p.g *= k;
  p.b *= k;
};
const RUST: RGB = [132, 70, 38];

/** Hormigón con juntas de losa. */
function concrete(c: RGB, seam: number, stain: number): PxFn {
  return (x, y, u, v, p, s) => {
    base(p, c, vary(s, x, y, 0.28, 0.2, 0.3), s.hi(x, y) * 0.6 + s.mid(x, y) * 0.4);
    if (s.white(x, y) > 0.985) darken(p, 0.6);
    const seamD = Math.min(u, v, 1 - u, 1 - v);
    if (seamD < 0.006) { darken(p, seam); p.h = 0.1; }
    if (stain > 0) {
      const st = ss(0.55, 0.85, s.mid(x, y * 0.3, 2, 1, 10, 30)) * stain * (0.5 + 0.5 * (1 - v));
      darken(p, 1 - st * 0.45);
      tintTo(p, [60, 90, 70], st * 0.12);
    }
    p.ro = 0.88;
    p.me = 0;
  };
}

/** Contenedor: costillas verticales (16/tile), pintura desgastada y óxido. */
function container(c: RGB): PxFn {
  return (x, y, u, v, p, s) => {
    const rib = Math.sin(u * 16 * Math.PI * 2);
    const val = 1 + rib * 0.12 + (s.lo(x, y) - 0.5) * 0.25 + (s.hi(x, y) - 0.5) * 0.12;
    base(p, c, val, rib * 0.5 + 0.5);
    const wear = ss(0.6, 0.85, s.mid(x, y * 0.4, 2, 1, 70, 5)) * (0.3 + 0.7 * (1 - v));
    tintTo(p, RUST, wear * 0.55);
    darken(p, 1 - ss(0.75, 1, 1 - v) * 0.25 * s.mid(x, y));
    p.ro = 0.55 + wear * 0.35;
    p.me = 0.35;
  };
}

/** Piel/tela/hueso: manchas y venas sutiles. */
function organic(c: RGB, vein: RGB, veins: number, ro: number): PxFn {
  return (x, y, _u, _v, p, s) => {
    base(p, c, vary(s, x, y, 0.3, 0.25, 0.14), s.mid(x, y));
    const ve = ss(0.86, 0.97, s.ridge(x, y, 2, 2, 20, 77)) * veins;
    tintTo(p, vein, ve * 0.55);
    tintTo(p, [110, 60, 90], ss(0.7, 0.9, s.lo(x, y, 1, 1, 90, 40)) * 0.18);
    p.ro = ro;
    p.me = 0;
  };
}

function cloth(c: RGB, dirt: number): PxFn {
  return (x, y, _u, _v, p, s) => {
    const weave = ((x >> 1) + (y >> 1)) & 1 ? 1.07 : 0.93;
    base(p, c, weave * vary(s, x, y, 0.35, 0.25, 0.1), weave * 0.5);
    darken(p, 1 - ss(0.6, 0.9, s.lo(x, y, 1, 1, 30, 130)) * dirt);
    p.ro = 0.95;
    p.me = 0;
  };
}

function metalPaint(c: RGB, ro: number, me: number, panels: number, wear: number): PxFn {
  return (x, y, u, v, p, s) => {
    base(p, c, vary(s, x, y, 0.2, 0.16, 0.14), s.hi(x, y));
    const fu = fr(u * panels);
    const fv = fr(v * panels);
    const edge = Math.min(fu, fv, 1 - fu, 1 - fv);
    if (edge < 0.02) { darken(p, 0.55); p.h = 0.05; } else if (edge < 0.05) p.h = 0.75;
    const rivet = Math.hypot(fr(u * panels * 4) - 0.5, fr(v * panels * 4) - 0.5);
    if (rivet < 0.12 && edge < 0.22) { darken(p, 1.25); p.h = 1; }
    const scr = ss(0.94, 0.99, s.ridge(x, y, 3, 3, 5, 9)) * 0.35;
    p.r += 40 * scr; p.g += 40 * scr; p.b += 40 * scr;
    const rust = ss(0.62, 0.85, s.mid(x, y, 2, 2, 5, 60)) * wear;
    tintTo(p, RUST, rust);
    p.ro = ro + rust * 0.3;
    p.me = me * (1 - rust);
  };
}

function glow(c: RGB): PxFn {
  return (x, y, _u, _v, p, s) => {
    const v = 0.8 + s.mid(x, y) * 0.35;
    p.r = c[0] * v; p.g = c[1] * v; p.b = c[2] * v; p.h = 0.5; p.ro = 0.4; p.me = 0;
  };
}

const R = (tile: number, px: PxFn, ro: number, me: number, normal?: number, extra: Partial<Recipe> = {}): Recipe =>
  ({ tile, px, ro, me, normal, ...extra });

export const RECIPES: Record<MaterialKey, Recipe> = {
  asphalt: R(4, (x, y, _u, _v, p, s) => {
    base(p, [72, 75, 82], vary(s, x, y, 0.25, 0.2, 0.55), s.hi(x, y));
    if (s.white(x, y) > 0.97) tintTo(p, [150, 150, 158], 0.35);
    darken(p, 1 - ss(0.92, 0.985, s.ridge(x, y, 2, 2, 3, 3)) * 0.6);
    p.ro = 0.9; p.me = 0;
  }, 0.9, 0, 1.4),
  asphaltWorn: R(4, (x, y, _u, _v, p, s) => {
    base(p, [92, 94, 100], vary(s, x, y, 0.4, 0.25, 0.5), s.hi(x, y));
    darken(p, 1 - ss(0.62, 0.85, s.lo(x, y, 1, 1, 60, 20)) * 0.4);
    darken(p, 1 - ss(0.9, 0.98, s.ridge(x, y, 2, 2, 90, 44)) * 0.6);
    p.ro = 0.82; p.me = 0;
  }, 0.85, 0, 1.2),
  roadLine: R(2, (x, y, _u, _v, p, s) => {
    base(p, [218, 190, 78], vary(s, x, y, 0.2, 0.25, 0.2), s.hi(x, y));
    const chip = ss(0.45, 0.28, s.mid(x, y, 2, 2, 10, 10)) * ss(0.35, 0.6, s.hi(x, y, 1, 1, 50, 50) + 0.1);
    tintTo(p, [72, 74, 80], chip);
    p.ro = 0.7; p.me = 0;
  }, 0.75, 0, 0.6),
  concrete: R(3, concrete([124, 128, 134], 0.55, 0), 0.88, 0, 1),
  concreteDark: R(3, concrete([88, 92, 100], 0.55, 0), 0.8, 0, 1),
  concreteStained: R(3, concrete([112, 115, 120], 0.6, 1), 0.88, 0, 1),
  dirt: R(3, (x, y, _u, _v, p, s) => {
    base(p, [106, 86, 63], vary(s, x, y, 0.4, 0.3, 0.3), s.mid(x, y) * 0.7 + s.hi(x, y) * 0.3);
    const peb = ss(0.86, 0.95, s.hi(x, y, 1, 1, 100, 30));
    tintTo(p, [150, 138, 120], peb * 0.5);
    p.ro = 0.98; p.me = 0;
  }, 0.98, 0, 2),
  gravel: R(3, (x, y, _u, _v, p, s) => {
    const w = getWorley();
    const d = worleyAt(w.d, x, y, 256);
    const id = worleyAt(w.id, x, y, 256);
    const tone = 0.55 + id * 0.65;
    base(p, [120, 116, 108], tone * (0.85 + s.hi(x, y) * 0.3), 1 - ss(0.1, 0.5, d));
    darken(p, 0.55 + 0.45 * ss(0.62, 0.35, d));
    p.ro = 0.95; p.me = 0;
  }, 0.95, 0, 3),
  tile: R(2, (x, y, u, v, p, s) => {
    const fu = fr(u * 4);
    const fv = fr(v * 4);
    const tone = 0.9 + hash2(Math.floor(u * 4), Math.floor(v * 4), 3) * 0.2;
    base(p, [152, 158, 164], tone * vary(s, x, y, 0.2, 0.15, 0.1), 0.8);
    if (Math.min(fu, fv, 1 - fu, 1 - fv) < 0.035) { base(p, [70, 74, 78], 0.9 + s.hi(x, y) * 0.2, 0); }
    darken(p, 1 - ss(0.65, 0.9, s.lo(x, y, 1, 1, 15, 15)) * 0.25);
    p.ro = 0.5; p.me = 0;
  }, 0.5, 0, 1),
  brick: R(1.2, (x, y, u, v, p, s) => {
    const row = Math.floor(v * 16);
    const fv = fr(v * 16);
    const uu = u * 5 + (row & 1 ? 0.5 : 0);
    const fu = fr(uu);
    const id = hash2(Math.floor(uu), row, 5);
    const mortar = fu < 0.035 || fu > 0.965 || fv < 0.09 || fv > 0.91;
    if (mortar) {
      base(p, [146, 142, 134], vary(s, x, y, 0.2, 0.2, 0.3), 0.15);
      p.ro = 0.95;
    } else {
      base(p, [138, 80, 64], (0.78 + id * 0.44) * vary(s, x, y, 0.15, 0.25, 0.3), 0.7 + s.hi(x, y) * 0.3);
      tintTo(p, [90, 60, 52], id > 0.8 ? 0.4 : 0);
      p.ro = 0.88;
    }
    darken(p, 1 - ss(0.6, 0.9, s.mid(x, y * 0.4, 2, 1, 33, 8)) * 0.3);
    p.me = 0;
  }, 0.9, 0, 2.2),
  plaster: R(3, (x, y, _u, _v, p, s) => {
    base(p, [176, 170, 156], vary(s, x, y, 0.22, 0.16, 0.12), s.mid(x, y));
    const peel = ss(0.66, 0.72, s.lo(x, y, 1, 1, 70, 90));
    tintTo(p, [128, 92, 76], peel * 0.8);
    darken(p, 1 - ss(0.93, 0.99, s.ridge(x, y, 2, 2, 12, 60)) * 0.5);
    darken(p, 1 - ss(0.6, 0.9, s.mid(x, y * 0.35, 1, 1, 0, 0)) * 0.22 * (1 - fr(y / 256)));
    p.h = peel > 0.5 ? 0.2 : p.h;
    p.ro = 0.92; p.me = 0;
  }, 0.92, 0, 1.2),
  metalPanel: R(2, metalPaint([116, 126, 138], 0.5, 0.6, 2, 0.5), 0.5, 0.6, 1.6),
  corrugated: R(2.56, (x, y, u, _v, p, s) => {
    const a = Math.sin(u * 32 * Math.PI * 2);
    base(p, [132, 142, 154], (1 + a * 0.14) * vary(s, x, y, 0.2, 0.18, 0.12), a * 0.5 + 0.5);
    const rust = ss(0.6, 0.85, s.mid(x, y * 0.5, 2, 1, 44, 4)) * 0.8;
    tintTo(p, RUST, rust);
    p.ro = 0.55 + rust * 0.3; p.me = 0.7 * (1 - rust);
  }, 0.6, 0.6, 2),
  rustMetal: R(2, (x, y, _u, _v, p, s) => {
    base(p, [126, 68, 38], vary(s, x, y, 0.5, 0.4, 0.3), s.mid(x, y));
    tintTo(p, [176, 96, 48], ss(0.6, 0.85, s.lo(x, y, 1, 1, 20, 20)) * 0.6);
    tintTo(p, [66, 34, 22], ss(0.7, 0.9, s.hi(x, y, 1, 1, 8, 8)) * 0.6);
    tintTo(p, [92, 106, 120], ss(0.86, 0.95, s.mid(x, y, 2, 2, 90, 90)) * 0.5);
    p.ro = 0.85; p.me = 0.3;
  }, 0.85, 0.3, 2),
  steelDark: R(1.5, (x, y, _u, _v, p, s) => {
    const brush = s.hi(x, 0, 1, 1, 0, (y * 7) & 255) * 0.5 + s.white(0, y, 40, 0) * 0.5;
    base(p, [58, 64, 72], 0.85 + brush * 0.3 + (s.lo(x, y) - 0.5) * 0.2, brush);
    const scr = ss(0.94, 0.99, s.ridge(x, y, 3, 3, 15, 19)) * 0.5;
    p.r += 50 * scr; p.g += 50 * scr; p.b += 55 * scr;
    p.ro = 0.42; p.me = 0.85;
  }, 0.45, 0.85, 0.6),
  labWall: R(3, (x, y, u, v, p, s) => {
    base(p, [206, 216, 224], vary(s, x, y, 0.1, 0.08, 0.06), 0.8);
    const fu = fr(u * 4);
    const fv = fr(v * 4);
    if (Math.min(fu, fv, 1 - fu, 1 - fv) < 0.012) { darken(p, 0.62); p.h = 0.1; }
    darken(p, 1 - ss(0.55, 0.9, s.mid(x, y * 0.3, 2, 1, 5, 5)) * 0.14);
    p.ro = 0.55; p.me = 0;
  }, 0.55, 0, 0.6),
  labFloor: R(2, (x, y, u, v, p, s) => {
    base(p, [156, 172, 184], vary(s, x, y, 0.1, 0.1, 0.16), 0.7);
    const fu = fr(u * 2);
    const fv = fr(v * 2);
    if (Math.min(fu, fv, 1 - fu, 1 - fv) < 0.012) { darken(p, 0.6); p.h = 0.1; }
    const scuff = ss(0.9, 0.98, s.ridge(x, y, 2, 2, 50, 20));
    darken(p, 1 - scuff * 0.2);
    p.ro = 0.32 + scuff * 0.4; p.me = 0;
  }, 0.4, 0, 0.5),
  glass: R(1.5, (x, y, _u, _v, p, s) => {
    base(p, [150, 196, 214], 1, 0.5);
    const dirt = ss(0.55, 0.9, s.mid(x, y * 0.4, 2, 1, 12, 12)) * 0.5 + ss(0.94, 0.99, s.ridge(x, y, 2, 2, 8, 8)) * 0.4;
    darken(p, 1 - dirt * 0.4);
    p.a = 255 * (0.22 + dirt * 0.5);
    p.ro = 0.08 + dirt * 0.4; p.me = 0;
  }, 0.1, 0, 0, { alpha: 'blend' }),
  wood: R(1.2, (x, y, _u, v, p, s) => {
    const plank = Math.floor(v * 8);
    const id = hash2(plank, 2, 8);
    const grain = s.mid(x, y, 1, 6, plank * 37, 0) * 0.6 + s.hi(x, y, 1, 8, plank * 11, 0) * 0.4;
    base(p, [124, 88, 56], (0.8 + id * 0.35) * (0.8 + grain * 0.4), grain);
    tintTo(p, [110, 104, 96], ss(0.5, 0.9, s.lo(x, y, 1, 1, 30, 30)) * 0.35);
    if (fr(v * 8) < 0.04 || fr(v * 8) > 0.97) { darken(p, 0.4); p.h = 0; }
    p.ro = 0.8; p.me = 0;
  }, 0.8, 0, 1.4),
  fence: R(0.8, (x, y, _u, _v, p, s) => {
    const a = Math.abs(fr((x + y) / 16) - 0.5);
    const b = Math.abs(fr((x - y) / 16) - 0.5);
    const wire = Math.min(a, b) * 16 * Math.SQRT1_2;
    const on = wire < 1.35 ? 1 : wire < 2 ? 1 - (wire - 1.35) / 0.65 : 0;
    const t = 0.85 + s.hi(x, y) * 0.3;
    p.r = 150 * t; p.g = 158 * t; p.b = 164 * t;
    p.a = on * 255; p.h = on; p.ro = 0.5; p.me = 0.6;
  }, 0.5, 0.6, 0, { alpha: 'test' }),
  hazard: R(1, (x, y, _u, _v, p, s) => {
    const stripe = fr((x + y) / 64) < 0.5;
    base(p, stripe ? [236, 192, 22] : [30, 30, 34], vary(s, x, y, 0.15, 0.2, 0.15), 0.6);
    const chip = ss(0.7, 0.85, s.mid(x, y, 2, 2, 20, 70)) * ss(0.45, 0.7, s.hi(x, y));
    tintTo(p, [112, 116, 122], chip * 0.8);
    p.ro = 0.6 + chip * 0.3; p.me = 0.25;
  }, 0.6, 0.25, 0.8),
  pipe: R(2, metalPaint([98, 108, 118], 0.55, 0.65, 1, 0.45), 0.55, 0.65, 0.8),
  rubber: R(1, (x, y, _u, _v, p, s) => {
    base(p, [46, 48, 54], 0.8 + s.hi(x, y) * 0.4 + s.white(x, y) * 0.15, s.hi(x, y));
    p.ro = 0.92; p.me = 0;
  }, 0.92, 0, 1),
  containerRed: R(2.56, container([158, 46, 38]), 0.6, 0.3, 1.8),
  containerBlue: R(2.56, container([40, 92, 166]), 0.6, 0.3, 1.8),
  containerGreen: R(2.56, container([50, 118, 70]), 0.6, 0.3, 1.8),
  containerYellow: R(2.56, container([204, 164, 40]), 0.6, 0.3, 1.8),
  containerGrey: R(2.56, container([118, 126, 134]), 0.6, 0.3, 1.8),
  emissiveRed: R(1, glow([255, 42, 42]), 0.4, 0, 0, { emissive: { color: 0xff2a2a, intensity: 2.4 }, tint: 0x3a0808 }),
  emissiveBlue: R(1, glow([70, 150, 255]), 0.4, 0, 0, { emissive: { color: 0x3f8cff, intensity: 2.4 }, tint: 0x0a1a3a }),
  emissiveAmber: R(1, glow([255, 176, 32]), 0.4, 0, 0, { emissive: { color: 0xffb020, intensity: 2.6 }, tint: 0x3a2500 }),
  emissiveGreen: R(1, glow([61, 255, 156]), 0.4, 0, 0, { emissive: { color: 0x3dff9c, intensity: 2.4 }, tint: 0x0a3a20 }),
  emissiveWhite: R(1, glow([255, 255, 255]), 0.4, 0, 0, { emissive: { color: 0xffffff, intensity: 2.8 }, tint: 0x555555 }),
  toxic: R(1.5, (x, y, _u, _v, p, s) => {
    const n = s.mid(x, y) * 0.6 + s.lo(x, y, 1, 1, 40, 40) * 0.4;
    p.r = 90 + n * 60; p.g = 230 + n * 25; p.b = 40 + n * 30; p.h = n; p.ro = 0.25; p.me = 0;
  }, 0.25, 0, 0.5, { emissive: { color: 0x7dff3a, intensity: 1.5 }, tint: 0x1a4a10 }),
  gunMetal: R(0.5, (x, y, _u, _v, p, s) => {
    base(p, [62, 68, 76], vary(s, x, y, 0.2, 0.2, 0.2), s.hi(x, y));
    const wear = ss(0.9, 0.98, s.ridge(x, y, 2, 2, 5, 5));
    tintTo(p, [150, 154, 160], wear * 0.6);
    p.ro = 0.38 + wear * 0.1; p.me = 0.92;
  }, 0.4, 0.9, 0.5),
  gunPolymer: R(0.5, (x, y, _u, _v, p, s) => {
    base(p, [42, 45, 52], 0.85 + s.white(x, y) * 0.25 + s.mid(x, y) * 0.1, s.white(x, y));
    p.ro = 0.72; p.me = 0;
  }, 0.72, 0, 0.9),
  gunWood: R(0.5, (x, y, _u, _v, p, s) => {
    const g = s.mid(x, y, 1, 8) * 0.6 + s.hi(x, y, 1, 10) * 0.4;
    base(p, [104, 66, 38], 0.75 + g * 0.5, g);
    p.ro = 0.45; p.me = 0;
  }, 0.45, 0, 0.8),
  brass: R(0.5, (x, y, _u, _v, p, s) => {
    base(p, [204, 162, 70], vary(s, x, y, 0.25, 0.2, 0.12), s.hi(x, y));
    tintTo(p, [96, 74, 40], ss(0.65, 0.9, s.lo(x, y)) * 0.4);
    p.ro = 0.32; p.me = 0.95;
  }, 0.35, 0.9, 0.3),
  skinPale: R(1, organic([184, 192, 176], [70, 96, 100], 0.6, 0.6), 0.6, 0, 0.7),
  skinGrey: R(1, organic([146, 154, 146], [60, 74, 84], 0.7, 0.65), 0.65, 0, 0.7),
  skinGreen: R(1, organic([124, 156, 108], [50, 86, 60], 0.8, 0.55), 0.55, 0, 0.7),
  clothDark: R(1, cloth([54, 60, 72], 0.3), 0.95, 0, 0.9),
  clothOlive: R(1, cloth([86, 98, 66], 0.3), 0.95, 0, 0.9),
  clothRag: R(1, cloth([122, 112, 94], 0.55), 0.95, 0, 0.9),
  bone: R(1, (x, y, _u, _v, p, s) => {
    base(p, [222, 214, 190], vary(s, x, y, 0.15, 0.2, 0.1), s.mid(x, y));
    darken(p, 1 - ss(0.9, 0.98, s.ridge(x, y, 2, 2, 60, 60)) * 0.5);
    p.ro = 0.6; p.me = 0;
  }, 0.6, 0, 0.6),
  blood: R(1, (x, y, _u, _v, p, s) => {
    base(p, [122, 18, 18], vary(s, x, y, 0.3, 0.3, 0.1), s.mid(x, y));
    darken(p, 1 - ss(0.7, 0.9, s.lo(x, y, 1, 1, 20, 90)) * 0.4);
    p.ro = 0.22; p.me = 0;
  }, 0.25, 0, 0.6),
  armorPlate: R(1, metalPaint([82, 92, 104], 0.55, 0.55, 2, 0.15), 0.55, 0.55, 1),
  wardenArmor: R(1, metalPaint([68, 76, 88], 0.5, 0.65, 3, 0.25), 0.5, 0.65, 1.2),
  wardenHelmet: R(1, metalPaint([104, 118, 132], 0.4, 0.75, 1, 0.1), 0.4, 0.75, 1),
  helicopterBody: R(2, (x, y, u, v, p, s) => {
    base(p, [82, 102, 88], vary(s, x, y, 0.2, 0.18, 0.12), s.hi(x, y));
    const fu = fr(u * 3);
    const fv = fr(v * 3);
    if (Math.min(fu, fv, 1 - fu, 1 - fv) < 0.01) { darken(p, 0.55); p.h = 0.05; }
    tintTo(p, [30, 30, 30], ss(0.6, 0.85, s.mid(x, y * 0.3, 2, 1, 80, 3)) * 0.35);
    tintTo(p, RUST, ss(0.75, 0.9, s.lo(x, y, 1, 1, 70, 70)) * 0.3);
    p.ro = 0.5; p.me = 0.35;
  }, 0.5, 0.35, 1),
  grass: R(2, (x, y, _u, _v, p, s) => {
    const blade = s.hi(x, y, 1, 3, 20, 0);
    base(p, [64, 88, 52], (0.7 + blade * 0.6) * vary(s, x, y, 0.4, 0.3, 0), blade);
    tintTo(p, [120, 110, 70], ss(0.7, 0.9, s.lo(x, y, 1, 1, 50, 10)) * 0.4);
    p.ro = 1; p.me = 0;
  }, 1, 0, 1.6),
  water: R(3, (x, y, _u, _v, p, s) => {
    base(p, [26, 48, 62], 0.85 + s.mid(x, y, 2, 2) * 0.3, s.mid(x, y, 2, 2) * 0.5 + s.hi(x, y) * 0.5);
    p.a = 255 * 0.86; p.ro = 0.06; p.me = 0;
  }, 0.06, 0, 0.5, { alpha: 'blend' }),
  roofing: R(2, (x, y, _u, v, p, s) => {
    base(p, [66, 68, 74], vary(s, x, y, 0.3, 0.2, 0.4), s.hi(x, y));
    if (fr(v * 4) < 0.02) { darken(p, 0.5); p.h = 0.1; }
    if (s.white(x, y) > 0.98) tintTo(p, [140, 140, 146], 0.4);
    p.ro = 0.92; p.me = 0;
  }, 0.92, 0, 1),
};

export interface Surface {
  size: number;
  /** RGBA, fila 0 = arriba. */
  albedo: Uint8ClampedArray;
  height: Float32Array | null;
  rough: Float32Array | null;
  metal: Float32Array | null;
  hasAlpha: boolean;
}

const px: Px = { r: 0, g: 0, b: 0, h: 0, ro: 0.8, me: 0, a: 255 };

/** Ejecuta una receta sobre un lienzo de `size`² (128 o 256). `full` = genera mapas PBR. */
export function bake(recipe: Recipe, size: number, full: boolean): Surface {
  const s = new Sampler(getNoiseLayers(), size);
  const n = size * size;
  const albedo = new Uint8ClampedArray(n * 4);
  const height = full && recipe.normal ? new Float32Array(n) : null;
  const rough = full ? new Float32Array(n) : null;
  const metal = full && recipe.me > 0 ? new Float32Array(n) : null;
  const fn = recipe.px;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      px.a = 255;
      fn(x, y, x / size, v, px, s);
      const i = y * size + x;
      const o = i * 4;
      albedo[o] = px.r;
      albedo[o + 1] = px.g;
      albedo[o + 2] = px.b;
      albedo[o + 3] = px.a;
      if (height) height[i] = px.h;
      if (rough) rough[i] = px.ro;
      if (metal) metal[i] = px.me;
    }
  }
  return { size, albedo, height, rough, metal, hasAlpha: recipe.alpha !== undefined };
}

/** Mapa de normales (RGBA8, fila 0 = ABAJO: orden de textura de three) a partir de alturas periódicas. */
export function heightToNormal(h: Float32Array, size: number, strength: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const m = size - 1;
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1) & m) * size;
    const yp = ((y + 1) & m) * size;
    const row = y * size;
    const oRow = (m - y) * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1) & m;
      const xp = (x + 1) & m;
      const dx = ((h[row + xp] as number) - (h[row + xm] as number)) * strength;
      const dy = ((h[yp + x] as number) - (h[ym + x] as number)) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const o = (oRow + x) * 4;
      out[o] = (-dx * inv * 0.5 + 0.5) * 255;
      out[o + 1] = (dy * inv * 0.5 + 0.5) * 255;
      out[o + 2] = (inv * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
  }
  return out;
}

// Superficies grandes del mundo a 256 px; emisivos a 64 px; el resto a 128 px (presupuesto de generación).
const BIG: MaterialKey[] = [
  'asphalt', 'asphaltWorn', 'concrete', 'concreteDark', 'concreteStained', 'dirt', 'gravel', 'brick', 'corrugated',
  'metalPanel', 'containerRed', 'containerBlue', 'containerGreen', 'containerYellow', 'containerGrey', 'plaster', 'fence', 'rustMetal',
];
for (const k of BIG) RECIPES[k].size = 256;
for (const k of ['emissiveRed', 'emissiveBlue', 'emissiveAmber', 'emissiveGreen', 'emissiveWhite'] as MaterialKey[]) RECIPES[k].size = 64;

/** Albedo en orden de textura (fila 0 = abajo). */
export function flipRows(src: Uint8ClampedArray, size: number): Uint8Array {
  const out = new Uint8Array(src.length);
  const stride = size * 4;
  for (let y = 0; y < size; y++) out.set(src.subarray(y * stride, (y + 1) * stride), (size - 1 - y) * stride);
  return out;
}

/** Rugosidad (G) y metalicidad (B) empaquetadas a media resolución, orden de textura. */
export function packOrm(rough: Float32Array, metal: Float32Array | null, size: number): { data: Uint8Array; size: number } {
  const half = size >> 1;
  const data = new Uint8Array(half * half * 4);
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      const i = (y * 2) * size + x * 2;
      const o = ((half - 1 - y) * half + x) * 4;
      data[o] = 255;
      data[o + 1] = (rough[i] as number) * 255;
      data[o + 2] = metal ? (metal[i] as number) * 255 : 0;
      data[o + 3] = 255;
    }
  }
  return { data, size: half };
}
