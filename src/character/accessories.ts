/**
 * Accesorios de cabeza y cuello (6 opciones): ninguno, gorra con visera, gorro con vuelta, gafas tácticas
 * con lentes emisivas, pañuelo anudado al cuello y auriculares con micrófono. Se colocan sobre la
 * superficie real de la cabeza (misma tabla de secciones que el cráneo), por lo que valen para ambos géneros.
 */
import { headFront } from './body';
import type { BuildCtx } from './build';
import { dirXf, newRow, sgnPow } from './geo';
import type { Painter, Station, StationZ, TubePoint } from './geo';
import { HAT_THICK, hatOf, hatRim } from './hat';
import type { HatKind } from './hat';
import type { OutfitInfo } from './outfit';

const TAU = Math.PI * 2;

export function buildAccessory(c: BuildCtx, info: OutfitInfo, hairClear: number): void {
  const { body: b, look, kit } = c;
  const h = b.head;
  const e = b.eye;
  const tmp = newRow();
  const kk = h.H / 0.238;
  const head = (role: 'jacket' | 'accent' | 'dark' | 'metal' | 'lens'): Painter => kit.paint(role, 'head');
  const ex = 2 / h.p;

  /** Cúpula que cubre el cráneo hasta el borde del sombrero (rim por ángulo). */
  const dome = (p: Painter, kind: HatKind, thick: number, extra: number): void => {
    const rim = hatRim(h, kind);
    const cols = 24;
    const rows = 9;
    p.grid(cols, rows, (j, k, out) => {
      const th = (j / cols) * TAU;
      const s = k / (rows - 1);
      const yCut = rim(th) + extra;
      const yTop = h.crownY + thick * 0.95;
      const y = yTop + (yCut - yTop) * s;
      h.table.at(Math.min(y, h.crownY), tmp);
      const r = k === 0 ? 0 : 1;
      out[0] = r * (tmp.rx + thick) * sgnPow(Math.sin(th), ex);
      out[1] = y;
      out[2] = tmp.cz + r * (tmp.rz + thick) * sgnPow(Math.cos(th), ex);
    }, { wrap: true, flip: true });
  };

  /** Banda que sigue el borde del sombrero entre rim+dy0 y rim+dy1. */
  const rimBand = (p: Painter, kind: HatKind, thick: number, dy0: number, dy1: number): void => {
    const rim = hatRim(h, kind);
    const cols = 24;
    p.grid(cols, 5, (j, k, out) => {
      const th = (j / cols) * TAU;
      const s = k / 4;
      const y = rim(th) + dy0 + (dy1 - dy0) * s;
      const g = thick * (k === 0 || k === 4 ? 0.55 : 1);
      h.table.at(Math.min(y, h.crownY), tmp);
      out[0] = (tmp.rx + g) * sgnPow(Math.sin(th), ex);
      out[1] = y;
      out[2] = tmp.cz + (tmp.rz + g) * sgnPow(Math.cos(th), ex);
    }, { wrap: true });
  };

  const hat = hatOf(look);
  if (hat === 'cap') {
    dome(head('jacket'), 'cap', HAT_THICK.cap, 0);
    // Franja interior/ribete inferior y botón superior.
    rimBand(head('accent'), 'cap', HAT_THICK.cap + 0.002, -0.006, 0.008);
    head('accent').blob(0.01, 0.007, 0.01, { y: h.crownY + HAT_THICK.cap + 0.004, z: -0.01 }, 7, 5);
    // Visera.
    const rf = hatRim(h, 'cap')(0);
    const z0 = headFront(h, 0, rf) + HAT_THICK.cap - 0.012;
    const vis: StationZ[] = [
      { z: z0 - 0.012, rx: h.W * 1.02, ry: 0.0045, cy: rf + 0.004, p: 3.2 },
      { z: z0 + 0.03, rx: h.W * 1.0, ry: 0.0045, cy: rf - 0.001, p: 3.2 },
      { z: z0 + 0.068, rx: h.W * 0.88, ry: 0.0045, cy: rf - 0.014, p: 3.2 },
      { z: z0 + 0.098, rx: h.W * 0.62, ry: 0.0045, cy: rf - 0.03, p: 3.2 },
    ];
    head('dark').loftZ(vis, { seg: 14, caps: 'both' });
    // Escudo frontal.
    const yl = rf + 0.045;
    head('accent').box(0.044 * kk, 0.028 * kk, 0.005, { y: yl, z: headFront(h, 0, yl) + HAT_THICK.cap + 0.0035, rx: -0.42 });
  } else if (hat === 'beanie') {
    dome(head('jacket'), 'beanie', HAT_THICK.beanie, 0.012);
    rimBand(head('accent'), 'beanie', HAT_THICK.beanie + 0.006, -0.008, 0.036);
    // Vuelta: costilla horizontal en el borde de la cuña.
    rimBand(head('jacket'), 'beanie', HAT_THICK.beanie + 0.008, 0.034, 0.042);
  }

  switch (look.accessory) {
    case 'goggles': {
      h.table.at(e.y, tmp);
      const ring = (y: number, g: number): Station => {
        h.table.at(y, tmp);
        return { y, rx: tmp.rx + g, rz: tmp.rz + g, cz: tmp.cz, p: h.p };
      };
      // Correa alrededor de la cabeza.
      head('dark').loftY([ring(e.y - 0.015, 0.011), ring(e.y - 0.011, 0.014), ring(e.y + 0.011, 0.014), ring(e.y + 0.015, 0.011)], { seg: 26 });
      // Lente curvada (emisiva) + marco superior e inferior.
      const arc = [-1.02, 1.02] as const;
      head('lens').loftY([ring(e.y - 0.026, 0.02), ring(e.y - 0.008, 0.023), ring(e.y + 0.008, 0.023), ring(e.y + 0.024, 0.02)], { seg: 16, arc });
      const frame = head('dark');
      frame.loftY([ring(e.y + 0.022, 0.019), ring(e.y + 0.027, 0.026), ring(e.y + 0.036, 0.024), ring(e.y + 0.039, 0.018)], { seg: 16, arc: [-1.08, 1.08] });
      frame.loftY([ring(e.y - 0.041, 0.018), ring(e.y - 0.038, 0.024), ring(e.y - 0.029, 0.026), ring(e.y - 0.024, 0.019)], { seg: 16, arc: [-1.08, 1.08] });
      for (const sd of [1, -1]) {
        h.table.at(e.y, tmp);
        const th = sd * 1.08;
        frame.box(0.012, 0.075, 0.02, {
          x: (tmp.rx + 0.024) * sgnPow(Math.sin(th), ex), y: e.y - 0.001, z: tmp.cz + (tmp.rz + 0.024) * sgnPow(Math.cos(th), ex), ry: th,
        });
      }
      break;
    }

    case 'bandana': {
      const nr = b.neckR;
      const r = Math.max(info.collarR, nr) + 0.014;
      const y0 = b.neckBaseY - 0.012;
      const y1 = Math.min(b.chinY - 0.006, Math.max(info.collarTopY, b.neckBaseY) + 0.03);
      const sk = c.skins.neck;
      const st: Station[] = [
        { y: y0, rx: r * 0.95, rz: r * 0.9, cz: 0.0, p: 2.2 },
        { y: y0 + 0.012, rx: r * 1.04, rz: r * 0.98, cz: 0.0, p: 2.2 },
        { y: (y0 + y1) / 2, rx: r * 1.02, rz: r * 0.97, cz: 0.0, p: 2.2 },
        { y: y1, rx: r * 0.94, rz: r * 0.9, cz: 0.0, p: 2.2 },
      ];
      const acc = kit.paint('accent', sk);
      acc.loftY(st, { seg: 18 });
      // Pico del pañuelo sobre el pecho y nudo.
      const yt = y0 - 0.055;
      const zf = info.frontZ(0, yt) + 0.008;
      acc.tbox(0.11 * kk, 0.012, 0.014, 0.008, 0.125 * kk, { y: yt, z: zf, rx: -0.2 });
      acc.blob(0.02, 0.018, 0.014, { y: y0 + 0.004, z: r * 0.92 + 0.004 }, 7, 5);
      kit.paint('dark', sk).blob(0.005, 0.005, 0.003, { y: yt + 0.03, z: zf + 0.009 }, 5, 4);
      break;
    }

    case 'headset': {
      const yEar = e.y - 0.008;
      h.table.at(yEar, tmp);
      const cx = tmp.rx + 0.024;
      const cz = tmp.cz - 0.006;
      const dark = head('dark');
      const acc = head('accent');
      for (const sd of [1, -1]) {
        dark.cyl(0.037 * kk, 0.037 * kk, 0.026, 14, { x: sd * cx, y: yEar, z: cz, rz: Math.PI / 2 });
        acc.cyl(0.028 * kk, 0.028 * kk, 0.006, 12, { x: sd * (cx + 0.014), y: yEar, z: cz, rz: Math.PI / 2 });
        dark.blob(0.02 * kk, 0.03 * kk, 0.02 * kk, { x: sd * (cx - 0.016), y: yEar, z: cz }, 8, 6);
      }
      // Diadema por encima del pelo.
      const ay = h.crownY + hairClear + 0.014 - yEar;
      const bandPts: TubePoint[] = [];
      for (let i = 0; i <= 12; i++) {
        const a = (i / 12) * Math.PI;
        bandPts.push({ x: Math.cos(a) * (cx - 0.004), y: yEar + Math.sin(a) * ay, z: cz + 0.004, ra: 0.0075, rb: 0.0055 });
      }
      dark.tube(bandPts, { seg: 7, ref: [0, 0, 1] });
      // Micrófono articulado hasta la comisura.
      const ym = h.chinY + 0.2 * h.H;
      const mic: TubePoint[] = [
        { x: cx + 0.005, y: yEar - 0.03, z: cz + 0.018, ra: 0.0028 },
        { x: 0.086 * kk, y: h.chinY + 0.075 * kk, z: headFront(h, 0.086 * kk, h.chinY + 0.075 * kk) + 0.006, ra: 0.0028 },
        { x: 0.06 * kk, y: ym + 0.004, z: headFront(h, 0.06 * kk, ym) + 0.014, ra: 0.0028 },
        { x: 0.032 * kk, y: ym + 0.004, z: headFront(h, 0.032 * kk, ym) + 0.026, ra: 0.0028 },
      ];
      dark.tube(mic, { seg: 5 });
      dark.blob(0.0085, 0.0085, 0.0085, { x: 0.026 * kk, y: ym + 0.004, z: headFront(h, 0.026 * kk, ym) + 0.028 }, 7, 5);
      acc.blob(0.004, 0.004, 0.003, { x: 0.02 * kk, y: ym + 0.004, z: headFront(h, 0.02 * kk, ym) + 0.03 }, 5, 4);
      void dirXf;
      break;
    }
    default:
      break;
  }
}
