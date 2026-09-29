/**
 * Peinados (6 por género) sobre la cabeza del maniquí. Base común: un casquete que sigue el cráneo con
 * línea de nacimiento configurable por ángulo (frente/lados/nuca) y grosor que se funde con la piel;
 * encima, mechones, rizos, crestas, melenas (masas apoyadas en la espalda por fuera de la ropa), coletas,
 * trenzas y moños. Con gorra o gorro se omite todo el volumen que quedaría bajo la prenda.
 */
import { createRng, lerp, smoothstep } from '../core/util';
import { headBack, headFront, headNormal, headPoint } from './body';
import type { P3 } from './body';
import type { BuildCtx } from './build';
import { dirXf, newRow, sgnPow } from './geo';
import type { TubePoint } from './geo';
import { hatOf, hatRim } from './hat';
import type { OutfitInfo } from './outfit';
import { chainSkin } from './rig';
import type { Side } from './rig';

const TAU = Math.PI * 2;
const GOLDEN = 2.399963;
const SIDES: readonly Side[] = [1, -1];

interface CapOpts {
  thick: number;
  /** Volumen extra en la coronilla. */
  top?: number;
  /** Alturas de la línea de nacimiento (fracción de la cabeza) en la frente, los lados y la nuca. */
  front: number;
  side: number;
  back: number;
  /** Bajada de las patillas (fracción). */
  sideburn?: number;
  /** Cuánto se afina el borde (0 = grosor constante, 1 = se funde con la piel). */
  fade?: number;
  /** Línea de nacimiento personalizada (altura y por ángulo); sustituye a front/side/back. */
  hairlineFn?: (th: number) => number;
}

/** Construye el pelo y devuelve la holgura (m) que necesitan los accesorios que lo cruzan (diadema de auriculares). */
export function buildHair(c: BuildCtx, info: OutfitInfo): number {
  const { body: b, look, kit } = c;
  const h = b.head;
  const fem = b.gender === 'female';
  const hat = hatOf(look);
  const rim = hat ? hatRim(h, hat) : null;
  const hair = kit.paint('hair', 'head');
  const tmp = newRow();
  const yU = (u: number): number => h.chinY + u * h.H;
  const nb = b.neckBaseY;
  const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
  const visible = (th: number, y: number): boolean => !rim || y < rim(th) - 0.01;
  const e = 2 / h.p;
  const P: P3 = { x: 0, y: 0, z: 0 };
  const N: P3 = { x: 0, y: 0, z: 0 };

  // ── Casquete base ─────────────────────────────────────────────────────────
  const hairline = (o: CapOpts) => (th: number): number => {
    const cs = Math.cos(th);
    let u = cs >= 0 ? o.side + (o.front - o.side) * cs ** 1.6 : o.side + (o.back - o.side) * (-cs) ** 1.3;
    if (o.sideburn) u -= o.sideburn * Math.exp(-((Math.abs(wrap(th)) - 1.35) ** 2) / 0.03);
    return yU(u);
  };

  const cap = (o: CapOpts): void => {
    const cols = 22;
    const rows = 8;
    const kk = hat ? 0.6 : 1;
    const hl = o.hairlineFn ?? hairline(o);
    hair.grid(cols, rows, (j, k, out) => {
      const th = (j / cols) * TAU;
      const s = k / (rows - 1);
      const yCut = hl(th);
      const t = (o.thick * (1 - (o.fade ?? 0.6) * smoothstep(0.45, 1, s)) + (hat ? 0 : (o.top ?? 0) * (1 - smoothstep(0, 0.55, s)))) * kk;
      const yTop = h.crownY + o.thick * 0.9 * kk;
      const y = yTop + (yCut - yTop) * s;
      h.table.at(Math.min(y, h.crownY), tmp);
      const r = k === 0 ? 0 : 1;
      out[0] = r * (tmp.rx + t) * sgnPow(Math.sin(th), e);
      out[1] = y;
      out[2] = tmp.cz + r * (tmp.rz + t) * sgnPow(Math.cos(th), e);
    }, { wrap: true, flip: true });
  };

  // ── Mechones (tubos cónicos con la punta redondeada) ───────────────────────
  /** Mechón que nace en la superficie (th, y) y sale según normal + sesgo; `wide` en el eje N del marco, `thin` en el otro. */
  const strand = (th: number, y: number, len: number, wide: number, thin: number, bias: P3, ref: readonly [number, number, number] = [1, 0, 0], lift = 0.004): void => {
    if (!visible(th, y)) return;
    headPoint(h, th, y, lift, P);
    headNormal(h, th, y, N);
    let dx = N.x + bias.x;
    let dy = N.y + bias.y;
    let dz = N.z + bias.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    hair.tube(
      [
        { x: P.x, y: P.y, z: P.z, ra: wide, rb: thin },
        { x: P.x + dx * len * 0.55, y: P.y + dy * len * 0.55, z: P.z + dz * len * 0.55, ra: wide * 0.85, rb: thin * 0.8 },
        { x: P.x + dx * len, y: P.y + dy * len, z: P.z + dz * len, ra: wide * 0.28, rb: thin * 0.3 },
      ],
      { seg: 6, ref },
    );
  };

  // ── Melenas y curtinas (mechones largos superpuestos) ─────────────────────
  const backZAt = (y: number): number => (y >= h.chinY ? Math.min(headBack(h, 0, Math.min(y, h.crownY)) - 0.004, info.backZ(y)) : info.backZ(y));
  const hairSkin = c.skins.neck;

  /** Manto trasero: 2·count+1 mechones paralelos de longitudes escalonadas que caen apoyados en la ropa. */
  const backMass = (bottomY: number, count: number, spacing: number, width: number, thick: number): void => {
    const yTop = yU(0.74);
    const p = kit.paint('hair', hairSkin);
    const n = 9;
    for (let i = -count; i <= count; i++) {
      const bot = bottomY + Math.abs(i) * 0.03 + (i % 2 !== 0 ? 0.02 : 0);
      const pts: TubePoint[] = [];
      // Arranque dentro del casquete (el mechón emerge de él sin borde plano).
      {
        const y0 = yU(0.88);
        pts.push({ x: i * spacing * 0.55, y: y0, z: backZAt(y0) - thick * 0.15, ra: thick * 0.35, rb: width * 0.5 });
      }
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const y = yTop + (bot - yTop) * t;
        const conv = lerp(0.7, 1, smoothstep(h.chinY + 0.12, h.chinY - 0.06, y));
        const tip = t > 0.8 ? 1 - ((t - 0.8) / 0.2) * 0.72 : 1;
        pts.push({
          x: i * spacing * conv,
          y,
          z: backZAt(y) - thick * tip - 0.003,
          ra: (thick * (1 - 0.25 * t) * tip),
          rb: width * (1 - 0.2 * t) * tip,
        });
      }
      p.tube(pts, { seg: 8, ref: [0, 0, 1] });
    }
  };

  /** Mechones laterales que enmarcan la cara y caen hasta bottomY. */
  const curtains = (bottomY: number, flare: number): void => {
    const p = kit.paint('hair', hairSkin);
    for (const sd of SIDES) {
      for (const [dz, len] of [[0.012, 0], [-0.03, 0.035]] as const) {
        const pts: TubePoint[] = [];
        const yTop = yU(0.7);
        const bot = bottomY + len;
        const n = 8;
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const y = yTop + (bot - yTop) * t;
          h.table.at(Math.max(y, h.chinY), tmp);
          const xh = y >= h.chinY ? tmp.rx * 0.97 + 0.012 : b.neckR + 0.024 + (h.chinY - y) * 0.9 + flare * t;
          const tip = t > 0.78 ? 1 - ((t - 0.78) / 0.22) * 0.75 : 1;
          pts.push({ x: sd * xh, y, z: (y >= h.chinY ? tmp.cz : 0) + dz, ra: 0.014 * tip, rb: (0.036 - 0.008 * t) * tip });
        }
        p.tube(pts, { seg: 8, ref: [1, 0, 0] });
      }
    }
  };

  // ── Cadenas de esferas (trenzas) ─────────────────────────────────────────
  const chain = (pts: readonly P3[], radius: number, alt: number, tie: boolean): void => {
    const seg: number[] = [];
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y, pts[i]!.z - pts[i - 1]!.z);
      seg.push(l);
      len += l;
    }
    const step = radius * 1.35;
    const n = Math.max(2, Math.round(len / step));
    const p = kit.paint('hair', c.skins.neck);
    let last: { x: number; y: number; z: number; tx: number; ty: number; tz: number } | null = null;
    for (let i = 0; i <= n; i++) {
      let d = (len * i) / n;
      let s = 0;
      while (s < seg.length - 1 && d > seg[s]!) {
        d -= seg[s]!;
        s++;
      }
      const a = pts[s]!;
      const q = pts[s + 1]!;
      const f = seg[s]! > 0 ? Math.min(1, d / seg[s]!) : 0;
      let tx = q.x - a.x;
      let ty = q.y - a.y;
      let tz = q.z - a.z;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      // Vector lateral: perpendicular al tramo y a Z.
      let px = ty * 1 - tz * 0;
      let pz = -tx * 1;
      const pl = Math.hypot(px, pz) || 1;
      px /= pl;
      pz /= pl;
      const sg = i % 2 === 0 ? 1 : -1;
      const x = a.x + (q.x - a.x) * f + px * sg * alt;
      const y = a.y + (q.y - a.y) * f;
      const z = a.z + (q.z - a.z) * f + pz * sg * alt;
      const r = radius * (1 - 0.4 * (i / n));
      p.blob(r, r * 1.25, r * 0.95, dirXf(x, y, z, tx, ty, tz, 0, sg * 0.55), 7, 5);
      last = { x, y, z, tx, ty, tz };
    }
    if (tie && last) {
      const t = kit.paint('accent', c.skins.neck);
      t.cyl(radius * 0.8, radius * 0.7, radius * 1.1, 8, dirXf(last.x, last.y, last.z, last.tx, last.ty, last.tz, 0.001));
    }
  };

  // ── Estilos ───────────────────────────────────────────────────────────────
  switch (look.hairStyle) {
    // ── Masculinos ──
    case 'rapado':
      cap({ thick: 0.0065, front: 0.88, side: 0.7, back: 0.6, fade: 0.6 });
      return 0.008;

    case 'corto': {
      cap({ thick: 0.017, top: 0.008, front: 0.84, side: 0.64, back: 0.5, sideburn: 0.07, fade: 0.65 });
      // Flequillo corto hacia delante y abajo.
      for (let i = 0; i < 5; i++) {
        const th = -0.62 + i * 0.31;
        strand(th, yU(0.86), 0.038, 0.021, 0.0085, { x: 0, y: -0.7, z: 0.35 }, [1, 0, 0], 0.006);
      }
      return 0.026;
    }

    case 'peinado': {
      cap({ thick: 0.02, top: 0.014, front: 0.9, side: 0.6, back: 0.4, sideburn: 0.05, fade: 0.5 });
      if (!hat) {
        // Tupé peinado hacia atrás: volumen sobre la frente y la coronilla.
        hair.blob(h.W * 0.62, 0.03, h.D * 0.5, { y: yU(0.96), z: h.D * 0.3, rx: -0.4 }, 10, 7);
      }
      return 0.036;
    }

    case 'rizado': {
      cap({ thick: 0.02, front: 0.84, side: 0.58, back: 0.34, fade: 0.5 });
      const rng = createRng(7);
      const n = 78;
      for (let i = 0; i < n; i++) {
        const v = (i + 0.5) / n;
        const u = 1 - 0.6 * v;
        const th = i * GOLDEN;
        const y = yU(u);
        const w = Math.abs(wrap(th));
        if (w < 0.95 && u < 0.88) continue; // frente despejada
        if (Math.abs(Math.sin(th)) > 0.9 && Math.abs(w) < 2.2 && u < 0.62) continue; // orejas libres
        if (!visible(th, y)) continue;
        headPoint(h, th, y, 0.012, P);
        headNormal(h, th, y, N);
        const r = 0.02 + rng() * 0.009;
        hair.blob(r, r * 0.9, r, { x: P.x + N.x * 0.008, y: P.y + N.y * 0.008, z: P.z + N.z * 0.008 }, 6, 4);
      }
      return 0.046;
    }

    case 'melena': {
      cap({ thick: 0.02, front: 0.85, side: 0.42, back: 0.3, fade: 0.5 });
      backMass(nb - 0.06, 2, 0.036, 0.04, 0.026);
      curtains(h.chinY - 0.03, 0);
      return 0.026;
    }

    case 'mohicano': {
      cap({ thick: 0.005, front: 0.9, side: 0.72, back: 0.5, fade: 0.6 });
      if (!hat) {
        // Cresta: conos de base ancha a lo largo del plano sagital, de la frente a la nuca.
        const path: P3[] = [];
        const add = (u: number, front: boolean): void => {
          const y = yU(u);
          path.push({ x: 0, y, z: front ? headFront(h, 0, y) : headBack(h, 0, y) });
        };
        for (const u of [0.9, 0.95, 0.985]) add(u, true);
        path.push({ x: 0, y: h.crownY, z: -0.003 });
        for (const u of [0.985, 0.95, 0.9, 0.82, 0.74, 0.66, 0.58]) add(u, false);
        const cy = yU(0.55);
        const nBlades = 11;
        for (let i = 0; i < nBlades; i++) {
          const t = i / (nBlades - 1);
          const f = t * (path.length - 1);
          const sIdx = Math.min(path.length - 2, Math.floor(f));
          const a = path[sIdx]!;
          const q = path[sIdx + 1]!;
          const py = lerp(a.y, q.y, f - sIdx);
          const pz = lerp(a.z, q.z, f - sIdx);
          let ty = q.y - a.y;
          let tz = q.z - a.z;
          const tl = Math.hypot(ty, tz) || 1;
          ty /= tl;
          tz /= tl;
          let ny = tz;
          let nz = -ty;
          if (ny * (py - cy) + nz * (pz - headBack(h, 0, cy) * 0.2) < 0) {
            ny = -ny;
            nz = -nz;
          }
          const len = 0.03 + 0.05 * Math.sin(Math.PI * t) ** 0.8;
          const dy = ny + 0.3;
          const dl = Math.hypot(dy, nz);
          const ux = 0;
          const uy = dy / dl;
          const uz = nz / dl;
          hair.tube(
            [
              { x: ux, y: py - uy * 0.006, z: pz - uz * 0.006, ra: 0.0125, rb: 0.026 },
              { x: ux, y: py + uy * len * 0.55, z: pz + uz * len * 0.55, ra: 0.011, rb: 0.02 },
              { x: ux, y: py + uy * len, z: pz + uz * len, ra: 0.004, rb: 0.005 },
            ],
            { seg: 7, ref: [1, 0, 0] },
          );
        }
      }
      return 0.075;
    }

    // ── Femeninos ──
    case 'pixie': {
      // Flequillo lateral: la línea de nacimiento baja en diagonal sobre la frente.
      const base = hairline({ thick: 0, front: 0.8, side: 0.6, back: 0.46, sideburn: 0.05 });
      cap({
        thick: 0.017, top: 0.005, front: 0.8, side: 0.6, back: 0.46, sideburn: 0.05, fade: 0.25,
        hairlineFn: (th) => base(th) - h.H * 0.13 * smoothstep(-0.3, 0.85, wrap(th)) * (1 - smoothstep(0.85, 1.5, wrap(th))),
      });
      for (const sd of SIDES) {
        strand(sd * 1.5, yU(0.56), 0.032, 0.012, 0.009, { x: 0, y: -1.6, z: 0.2 });
        strand(sd * 2.7, yU(0.47), 0.028, 0.014, 0.009, { x: 0, y: -1.5, z: -0.2 });
      }
      return 0.022;
    }

    case 'media': {
      cap({ thick: 0.02, front: 0.84, side: 0.5, back: 0.36, fade: 0.5 });
      backMass(nb + 0.014, 2, 0.038, 0.042, 0.024);
      curtains(nb + 0.014, 0.012);
      return 0.026;
    }

    case 'larga': {
      cap({ thick: 0.02, front: 0.84, side: 0.5, back: 0.36, fade: 0.5 });
      backMass(b.waistJ + 0.06, 2, 0.038, 0.042, 0.026);
      curtains(nb + 0.01, 0.012);
      // Mechones delanteros sobre los hombros.
      for (const sd of SIDES) {
        const kx = fem ? 0.9 : 1;
        const pts: TubePoint[] = [];
        const at = (x: number, y: number, dz: number, ra: number): void => {
          pts.push({ x: sd * x, y, z: info.frontZ(x, y) + dz, ra, rb: ra * 1.7 });
        };
        pts.push({ x: sd * (h.W * 0.9), y: h.chinY + 0.06, z: -0.004, ra: 0.012, rb: 0.02 });
        pts.push({ x: sd * (h.W * 0.95 + 0.006), y: h.chinY, z: 0.004, ra: 0.012, rb: 0.022 });
        at(0.09 * kx, nb + 0.02, 0.0, 0.013);
        at(0.108 * kx, nb - 0.03, 0.022, 0.013);
        at(0.112 * kx, nb - 0.11, 0.024, 0.012);
        at(0.112 * kx, nb - 0.19, 0.026, 0.004);
        kit.paint('hair', hairSkin).tube(pts, { seg: 8 });
      }
      return 0.026;
    }

    case 'coleta': {
      cap({ thick: 0.016, front: 0.87, side: 0.62, back: 0.55, sideburn: 0.03, fade: 0.6 });
      const A = b.tailA;
      const B = b.tailB;
      const pts: TubePoint[] = [
        { x: 0, y: A[1], z: A[2] + 0.014, ra: 0.03 },
        { x: 0, y: A[1] - 0.02, z: A[2] - 0.038, ra: 0.036 },
        { x: 0, y: B[1] + 0.03, z: B[2], ra: 0.039 },
        { x: 0, y: B[1] - 0.05, z: B[2] - 0.012, ra: 0.033 },
        { x: 0, y: B[1] - 0.12, z: B[2] + 0.0, ra: 0.021 },
        { x: 0, y: B[1] - 0.17, z: B[2] + 0.012, ra: 0.004 },
      ];
      const skin = chainSkin(c.index, ['tailA', 'tailB'], [(A[1] + B[1]) / 2], [0.05]);
      kit.paint('hair', skin).tube(pts, { seg: 9 });
      const tieDir = dirXf(A[0], A[1] - 0.004, A[2] - 0.004, 0, -0.35, -1, 0.016);
      kit.paint('accent', 'tailA').cyl(0.035, 0.035, 0.018, 10, tieDir);
      return 0.018;
    }

    case 'trenzas': {
      cap({ thick: 0.016, front: 0.83, side: 0.6, back: 0.5, fade: 0.6 });
      const kx = fem ? 0.92 : 1;
      for (const sd of SIDES) {
        const s0 = headPoint(h, sd * (Math.PI / 2 + 0.3), yU(0.5), 0.014, { x: 0, y: 0, z: 0 });
        const pts: P3[] = [
          s0,
          { x: sd * (h.W * 0.9 + 0.008), y: h.chinY + 0.012, z: 0.0 },
          { x: sd * 0.088 * kx, y: nb + 0.03, z: 0.014 },
        ];
        for (const [x, y, dz] of [[0.108, nb - 0.02, 0.02], [0.112, nb - 0.1, 0.022], [0.114, nb - 0.18, 0.024]] as const) {
          pts.push({ x: sd * x * kx, y, z: info.frontZ(x * kx, y) + dz });
        }
        chain(pts, 0.0175, 0.0045, true);
      }
      return 0.02;
    }

    case 'mono': {
      cap({ thick: 0.016, front: 0.86, side: 0.6, back: 0.5, fade: 0.6 });
      const u = hat === 'beanie' ? 0.44 : hat === 'cap' ? 0.6 : 0.86;
      const y = yU(u);
      const zb = headBack(h, 0, y) - 0.034;
      hair.blob(0.054, 0.05, 0.052, { y: y + (hat ? 0 : 0.02), z: zb }, 9, 7);
      kit.paint('accent', 'head').cyl(0.034, 0.038, 0.014, 10, dirXf(0, y + (hat ? 0 : 0.012), zb + 0.036, 0, 0.35, -1, 0.001));
      return 0.022;
    }

    default:
      cap({ thick: 0.012, front: 0.86, side: 0.64, back: 0.55 });
      return 0.016;
  }
}

/** Referencia para tests de forma: ids de estilos soportados. */
export const HAIR_STYLE_IDS: readonly string[] = [
  'rapado', 'corto', 'peinado', 'rizado', 'melena', 'mohicano', 'pixie', 'media', 'larga', 'coleta', 'trenzas', 'mono',
];

