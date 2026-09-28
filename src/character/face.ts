/**
 * Cara del maniquí: ojos con párpado animable (parpadeo), cejas, nariz, boca con ligera sonrisa,
 * orejas y rasgos por género. Simple pero con carácter: formas grandes y limpias, sin poros ni dientes,
 * para no caer en el valle inquietante.
 */
import { headFront, headRing } from './body';
import type { BuildCtx } from './build';
import { newRow } from './geo';
import { sideBone } from './rig';
import type { Side } from './rig';

/** Guiñada (rad) de la superficie de la cara en (x, y): orienta piezas pegadas a la cara. */
export function faceYaw(c: BuildCtx, x: number, y: number): number {
  const h = c.body.head;
  const d = 0.004;
  return Math.atan2(-(headFront(h, x + d, y) - headFront(h, x - d, y)) / (2 * d), 1);
}

export function buildFace(c: BuildCtx): void {
  const { body: b, kit } = c;
  const h = b.head;
  const e = b.eye;
  const fem = b.gender === 'female';
  const k = h.H / 0.236;
  const skin = kit.paint('skin', 'head');
  const white = kit.paint('white', 'head');
  const dark = kit.paint('dark', 'head');
  const lips = kit.paint('lips', 'head');
  const hair = kit.paint('hair', 'head');
  const ring = newRow();

  for (const s of [1, -1] as Side[]) {
    const ex = s * e.x;
    // Globo ocular + iris/pupila + brillo.
    white.blob(e.rx, e.ry, e.rz, { x: ex, y: e.y, z: e.z, ry: s * faceYaw(c, ex, e.y) }, 10, 7);
    dark.blob(e.rx * 0.6, e.ry * 0.7, e.rz * 0.5, { x: ex, y: e.y - e.ry * 0.03, z: e.z + e.rz * 0.72 }, 8, 6);
    white.blob(e.rx * 0.17, e.ry * 0.17, e.rz * 0.12, { x: ex + s * e.rx * 0.2, y: e.y + e.ry * 0.28, z: e.z + e.rz * 1.06 }, 4, 3);
    // Párpado superior (hueso propio: el hueso escala en Y para parpadear).
    kit.paint('skin', sideBone('lid', s)).blob(e.rx * 1.12, e.ry * 1.14, e.rz * 1.2, { x: ex, y: e.y, z: e.z, ry: s * faceYaw(c, ex, e.y) }, 10, 7);

    // Cejas.
    const bx = s * (e.x + 0.001);
    if (fem) {
      const by = e.y + e.ry + 0.019 * k;
      const yaw = faceYaw(c, bx, by);
      hair.box(0.017 * k, 0.0048, 0.006, { x: bx - s * 0.0085 * k, y: by - 0.0006, z: headFront(h, bx - s * 0.0085 * k, by) + 0.001, ry: s * yaw, rz: s * 0.06 });
      hair.box(0.017 * k, 0.0046, 0.006, { x: bx + s * 0.0085 * k, y: by + 0.0016, z: headFront(h, bx + s * 0.0085 * k, by) + 0.001, ry: s * yaw, rz: -s * 0.22 });
    } else {
      const by = e.y + e.ry + 0.0135 * k;
      hair.box(0.036 * k, 0.0078, 0.008, { x: bx, y: by, z: headFront(h, bx, by) + 0.0012, ry: s * faceYaw(c, bx, by), rz: s * 0.09 });
    }

    // Pestañas (mujer): trazo oscuro en el borde exterior del párpado.
    if (fem) dark.box(0.012 * k, 0.0026, 0.004, { x: ex + s * e.rx * 0.78, y: e.y + e.ry * 0.62, z: e.z + e.rz * 0.92, ry: s * faceYaw(c, ex, e.y), rz: s * 0.5 });

    // Oreja.
    h.table.at(e.y - 0.006, ring);
    skin.blob(0.0075, 0.025 * k, 0.0165 * k, { x: s * (ring.rx + 0.0015), y: e.y - 0.006, z: ring.cz - 0.008, ry: s * 0.32 }, 7, 5);
  }

  // Arcos superciliares (hombre): frente algo más marcada.
  if (!fem) skin.blob(0.036 * k, 0.0075, 0.0095, { y: e.y + e.ry + 0.0055 * k, z: headFront(h, 0, e.y + e.ry + 0.0055 * k) - 0.0015 }, 10, 5);

  // Nariz.
  const nk = k * (fem ? 0.88 : 1.04);
  const ny = e.y - 0.047 * nk;
  const nz = headFront(h, 0, ny);
  skin.tbox(0.010 * nk, 0.006 * nk, 0.017 * nk, 0.014 * nk, 0.046 * nk, { y: e.y - 0.023 * nk, z: headFront(h, 0, e.y - 0.023 * nk) + 0.0035 * nk, rx: -0.3 });
  skin.blob(0.0115 * nk, 0.0095 * nk, 0.011 * nk, { y: ny, z: nz + 0.0105 * nk }, 8, 6);
  for (const s of [1, -1] as Side[]) skin.blob(0.0068 * nk, 0.0055 * nk, 0.0068 * nk, { x: s * 0.0105 * nk, y: ny + 0.001, z: nz + 0.0035 * nk }, 6, 4);

  // Boca: labios en dos tramos por lado (curvos) con las comisuras algo elevadas + línea oscura.
  const ym = h.chinY + 0.215 * h.H;
  const lk = k * (fem ? 1.0 : 0.94);
  const fullness = fem ? 1.3 : 1.0;
  dark.box(0.031 * lk, 0.0019, 0.004, { y: ym + 0.0005, z: headFront(h, 0, ym) + 0.0004 });
  for (const s of [1, -1] as Side[]) {
    for (const part of [0, 1]) {
      const px = s * (0.0072 + part * 0.0105) * lk;
      const lift = part * 0.0011 * lk;
      const z = headFront(h, px, ym);
      const yaw = s * faceYaw(c, px, ym);
      const w = (part === 0 ? 0.0095 : 0.0075) * lk;
      lips.blob(w, 0.0033 * lk * fullness, 0.0056 * lk, { x: px, y: ym + 0.0036 * lk + lift, z: z + 0.0006, ry: yaw, rz: -s * part * 0.35 }, 7, 4);
      lips.blob(w, 0.0037 * lk * fullness, 0.0060 * lk, { x: px, y: ym - 0.0038 * lk + lift * 0.8, z: z + 0.0006, ry: yaw, rz: s * part * 0.25 }, 7, 4);
    }
  }
  void headRing;
}
