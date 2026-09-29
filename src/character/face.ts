/**
 * Cara del maniquí: ojos con párpado animable (parpadeo), cejas, nariz, boca con ligera sonrisa,
 * orejas y rasgos por género. Simple pero con carácter: formas grandes y limpias, sin poros ni dientes,
 * para no caer en el valle inquietante.
 */
import { headFront } from './body';
import type { BuildCtx } from './build';
import { newRow } from './geo';
import type { TubePoint } from './geo';
import { sideBone } from './rig';
import type { Side } from './rig';

/** Guiñada (rad, con signo) de la superficie de la cara en (x, y): orienta piezas pegadas a la cara. */
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
  const k = h.H / 0.238;
  const skin = kit.paint('skin', 'head');
  const white = kit.paint('white', 'head');
  const dark = kit.paint('dark', 'head');
  const lips = kit.paint('lips', 'head');
  const hair = kit.paint('hair', 'head');
  const ring = newRow();

  for (const s of [1, -1] as Side[]) {
    const ex = s * e.x;
    // Globo ocular (mira al frente) + iris grande + brillo.
    white.blob(e.rx, e.ry, e.rz, { x: ex, y: e.y, z: e.z }, 12, 8);
    dark.blob(e.rx * 0.54, e.ry * 0.62, e.rz * 0.5, { x: ex, y: e.y - e.ry * 0.06, z: e.z + e.rz * 0.7 }, 10, 7);
    white.blob(e.rx * 0.17, e.ry * 0.17, e.rz * 0.12, { x: ex + s * e.rx * 0.22, y: e.y + e.ry * 0.3, z: e.z + e.rz * 1.02 }, 5, 4);
    // Párpado superior (hueso propio: el hueso escala en Y para parpadear).
    kit.paint('skin', sideBone('lid', s)).blob(e.rx * 1.14, e.ry * 1.16, e.rz * 1.22, { x: ex, y: e.y, z: e.z }, 12, 8);

    // Cejas (siguen la curvatura de la frente).
    const bx = s * (e.x + 0.001);
    if (fem) {
      const by = e.y + e.ry + 0.0135 * k;
      for (const [dx, dy, rz] of [[-0.0085, -0.0006, 0.06], [0.0085, 0.0013, -0.1]] as const) {
        const x = bx + s * dx * k;
        hair.blob(0.0105 * k, 0.0027, 0.0045, { x, y: by + dy, z: headFront(h, x, by) + 0.0005, ry: faceYaw(c, x, by), rz: s * rz }, 7, 4);
      }
    } else {
      const by = e.y + e.ry + 0.0105 * k;
      for (const [dx, rz] of [[-0.011, 0.0], [0.011, 0.1]] as const) {
        const x = bx + s * dx * k;
        hair.blob(0.0135 * k, 0.0047, 0.0062, { x, y: by + (rz ? 0.0012 : 0), z: headFront(h, x, by) + 0.0003, ry: faceYaw(c, x, by), rz: s * (rz + 0.05) }, 7, 4);
      }
    }

    // Pestañas (mujer): trazo oscuro en el borde exterior del párpado.
    if (fem) dark.box(0.011 * k, 0.0022, 0.004, { x: ex + s * e.rx * 0.86, y: e.y + e.ry * 0.72, z: e.z + e.rz * 0.8, rz: s * 0.4 });

    // Oreja.
    h.table.at(e.y - 0.006, ring);
    skin.blob(0.0068, 0.021 * k, 0.014 * k, { x: s * (ring.rx + 0.0012), y: e.y - 0.004, z: ring.cz - 0.014, ry: s * 0.3 }, 8, 6);
  }

  // Nariz: puente ovalado, punta y aletas redondeadas.
  const nk = k * (fem ? 0.72 : 0.86);
  const ny = e.y - 0.04 * nk;
  const nz = headFront(h, 0, ny);
  const bridgeY = e.y - 0.018 * nk;
  skin.blob(0.0082 * nk, 0.023 * nk, 0.0088 * nk, { y: bridgeY, z: headFront(h, 0, bridgeY) + 0.0032 * nk, rx: -0.3 }, 9, 7);
  skin.blob(0.0112 * nk, 0.0092 * nk, 0.0108 * nk, { y: ny, z: nz + 0.0092 * nk }, 9, 7);
  for (const s of [1, -1] as Side[]) skin.blob(0.0064 * nk, 0.0054 * nk, 0.0064 * nk, { x: s * 0.0102 * nk, y: ny + 0.0012, z: nz + 0.0034 * nk }, 7, 5);

  // Boca: labios como dos tubos curvos (comisuras algo elevadas) + línea oscura entre ambos.
  const ym = h.chinY + 0.2 * h.H;
  const lk = k * (fem ? 1.08 : 1.02);
  const fullness = fem ? 1.25 : 0.95;
  const mouthPts = (dy: number, ra: number): TubePoint[] => {
    const pts: TubePoint[] = [];
    for (let i = -3; i <= 3; i++) {
      const x = (i / 3) * 0.0175 * lk;
      const lift = (Math.abs(i) / 3) ** 2 * 0.0026 * lk;
      const taper = 1 - 0.55 * (Math.abs(i) / 3) ** 2;
      pts.push({ x, y: ym + dy + lift, z: headFront(h, x, ym) + 0.0028, ra: ra * taper, rb: ra * 1.25 * taper });
    }
    return pts;
  };
  dark.box(0.033 * lk, 0.0019, 0.004, { y: ym + 0.0005, z: headFront(h, 0, ym) + 0.0006 });
  lips.tube(mouthPts(0.0032 * lk, 0.0031 * lk * fullness), { seg: 6, ref: [0, 0, 1] });
  lips.tube(mouthPts(-0.0034 * lk, 0.0036 * lk * fullness), { seg: 6, ref: [0, 0, 1] });
}
