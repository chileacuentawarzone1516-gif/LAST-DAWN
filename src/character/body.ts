/**
 * Anatomía del maniquí: proporciones por género (tablas de datos) y geometría de la piel
 * (torso, cuello, cabeza, brazos y manos). La cara vive en face.ts.
 *
 * Silueta masculina: hombros anchos en V, cintura recta, cuello grueso y mandíbula cuadrada (≈1,78 m).
 * Silueta femenina: hombros estrechos, cintura marcada, caderas anchas, cuello largo y fino, cabeza
 * más redonda y ligeramente mayor en proporción (≈1,68 m).
 */
import type { Gender } from '../core/types';
import type { BuildCtx } from './build';
import { RingTable, newRow } from './geo';
import type { RingRow, Station } from './geo';
import { sideBone } from './rig';
import type { Joints, RigLayout, Side } from './rig';

export interface HeadSpec {
  /** Alto (mentón→coronilla), semiancho, semiprofundidad y exponente de la sección. */
  H: number; W: number; D: number; p: number;
  chinY: number; crownY: number;
  table: RingTable;
}

export interface EyeSpec {
  x: number; y: number; z: number;
  rx: number; ry: number; rz: number;
}

/** Sección de la suela/bota: z, semiancho, altura superior e inferior. */
export type FootRow = readonly [number, number, number, number];

export interface BodySpec extends Joints {
  gender: Gender;
  /** Altura nominal hasta la coronilla (m). */
  height: number;
  shoulderY: number; chinY: number; crownY: number;
  hipX: number; shoulderX: number; neckR: number;
  upperArm: number; foreArm: number; armScale: number;
  handLen: number; handK: number;
  torso: RingTable;
  leg: RingTable;
  /** Brazo normalizado: y = s (0 hombro … 1 muñeca). */
  arm: RingTable;
  hand: RingTable;
  head: HeadSpec;
  eye: EyeSpec;
  foot: readonly FootRow[];
  tailA: readonly [number, number, number];
  tailB: readonly [number, number, number];
}

const row = (y: number, rx: number, rz: number, cz: number): RingRow => ({ y, rx, rz, cz });

// ─────────────────────────────────────────────────────────────────────────────
// Tablas de proporciones
// ─────────────────────────────────────────────────────────────────────────────
const TORSO: Record<Gender, RingRow[]> = {
  male: [
    row(0.80, 0.128, 0.100, -0.004), row(0.85, 0.160, 0.108, -0.004), row(0.90, 0.172, 0.110, -0.003),
    row(0.96, 0.166, 0.104, 0.0), row(1.02, 0.156, 0.097, 0.0), row(1.08, 0.150, 0.093, 0.0),
    row(1.15, 0.156, 0.098, 0.004), row(1.23, 0.168, 0.106, 0.008), row(1.31, 0.176, 0.113, 0.010),
    row(1.39, 0.176, 0.108, 0.005), row(1.44, 0.160, 0.092, -0.002), row(1.475, 0.115, 0.076, -0.006),
    row(1.50, 0.070, 0.064, -0.006),
  ],
  female: [
    row(0.755, 0.125, 0.100, -0.006), row(0.80, 0.158, 0.110, -0.008), row(0.855, 0.168, 0.114, -0.008),
    row(0.92, 0.155, 0.106, -0.004), row(0.985, 0.120, 0.088, -0.002), row(1.02, 0.110, 0.083, 0.0),
    row(1.09, 0.118, 0.089, 0.006), row(1.16, 0.128, 0.100, 0.014), row(1.225, 0.136, 0.108, 0.020),
    row(1.29, 0.140, 0.100, 0.012), row(1.35, 0.140, 0.088, 0.002), row(1.395, 0.118, 0.072, -0.003),
    row(1.418, 0.075, 0.058, -0.004), row(1.435, 0.050, 0.052, -0.004),
  ],
};

const LEG: Record<Gender, RingRow[]> = {
  male: [
    row(0.04, 0.036, 0.040, 0.0), row(0.085, 0.035, 0.040, 0.0), row(0.16, 0.037, 0.041, -0.001),
    row(0.26, 0.044, 0.048, -0.004), row(0.36, 0.054, 0.060, -0.008), row(0.44, 0.056, 0.062, -0.002),
    row(0.50, 0.055, 0.064, 0.008), row(0.56, 0.058, 0.066, 0.005), row(0.68, 0.073, 0.080, 0.004),
    row(0.80, 0.086, 0.094, 0.002), row(0.90, 0.088, 0.096, 0.0), row(0.96, 0.082, 0.090, 0.0),
  ],
  female: [
    row(0.04, 0.032, 0.036, 0.0), row(0.08, 0.031, 0.036, 0.0), row(0.155, 0.033, 0.037, -0.001),
    row(0.25, 0.040, 0.044, -0.004), row(0.345, 0.048, 0.055, -0.008), row(0.42, 0.051, 0.058, -0.002),
    row(0.475, 0.050, 0.060, 0.008), row(0.53, 0.054, 0.062, 0.005), row(0.64, 0.070, 0.076, 0.004),
    row(0.76, 0.083, 0.090, 0.002), row(0.855, 0.086, 0.094, 0.0), row(0.915, 0.079, 0.088, 0.0),
  ],
};

/** Brazo normalizado (y = s): deltoides, bíceps, codo (s≈0,53), antebrazo, muñeca. */
const ARM_ROWS: RingRow[] = [
  row(-0.09, 0.044, 0.046, 0), row(0.0, 0.056, 0.058, 0), row(0.11, 0.054, 0.056, 0), row(0.25, 0.049, 0.051, 0),
  row(0.43, 0.043, 0.046, 0), row(0.535, 0.039, 0.042, 0), row(0.66, 0.040, 0.042, 0), row(0.84, 0.033, 0.034, 0),
  row(1.0, 0.028, 0.030, 0),
];

/** Mano (y = distancia desde la muñeca en m para una mano de 0,18): muñeca, palma, nudillos, dedos curvados. */
const HAND_ROWS: RingRow[] = [
  row(0.0, 0.031, 0.027, 0.0), row(0.025, 0.036, 0.025, 0.001), row(0.06, 0.042, 0.021, 0.002),
  row(0.10, 0.043, 0.020, 0.004), row(0.13, 0.041, 0.020, 0.012), row(0.155, 0.036, 0.018, 0.020),
  row(0.172, 0.028, 0.014, 0.027), row(0.18, 0.012, 0.008, 0.030),
];

/** Perfil de la cabeza: u (0 mentón … 1 coronilla), factores de semiancho (M, F), semiprofundidad (M, F) y centro z. */
const HEAD_U: readonly (readonly number[])[] = [
  [0.00, 0.26, 0.22, 0.30, 0.28, 0.30],
  [0.05, 0.50, 0.42, 0.48, 0.44, 0.26],
  [0.14, 0.80, 0.66, 0.72, 0.68, 0.15],
  [0.28, 0.93, 0.85, 0.88, 0.86, 0.07],
  [0.44, 0.99, 0.96, 0.97, 0.96, 0.02],
  [0.60, 1.00, 1.00, 1.00, 1.00, 0.0],
  [0.76, 0.95, 0.96, 0.97, 0.97, -0.02],
  [0.89, 0.78, 0.80, 0.82, 0.82, -0.03],
  [0.965, 0.50, 0.52, 0.55, 0.55, -0.03],
  [1.00, 0.06, 0.06, 0.06, 0.06, -0.03],
];

/** Zapato: z, semiancho, altura superior e inferior (M). La mujer escala en z/ancho/alto. */
const FOOT_M: readonly FootRow[] = [
  [-0.080, 0.028, 0.100, 0.006], [-0.060, 0.038, 0.128, 0.004], [0.0, 0.046, 0.118, 0.004], [0.06, 0.050, 0.088, 0.004],
  [0.12, 0.052, 0.064, 0.004], [0.18, 0.044, 0.050, 0.004], [0.215, 0.028, 0.038, 0.006], [0.228, 0.010, 0.028, 0.010],
];

interface Raw {
  height: number; ankleY: number; kneeY: number; hipY: number; waistJ: number; chestJ: number;
  shoulderY: number; neckBaseY: number; headH: number; headW: number; headD: number; headP: number;
  hipX: number; shoulderX: number; neckR: number; upperArm: number; foreArm: number; armScale: number;
  handLen: number; footK: number;
  eye: { x: number; rx: number; ry: number; rz: number };
}

const RAW: Record<Gender, Raw> = {
  male: {
    height: 1.78, ankleY: 0.085, kneeY: 0.50, hipY: 0.93, waistJ: 1.05, chestJ: 1.22, shoulderY: 1.455, neckBaseY: 1.485,
    headH: 0.236, headW: 0.079, headD: 0.098, headP: 2.5, hipX: 0.088, shoulderX: 0.197, neckR: 0.056,
    upperArm: 0.30, foreArm: 0.26, armScale: 1, handLen: 0.18, footK: 1,
    eye: { x: 0.037, rx: 0.0128, ry: 0.0108, rz: 0.0088 },
  },
  female: {
    height: 1.68, ankleY: 0.08, kneeY: 0.475, hipY: 0.885, waistJ: 0.99, chestJ: 1.16, shoulderY: 1.375, neckBaseY: 1.412,
    headH: 0.228, headW: 0.071, headD: 0.090, headP: 2.15, hipX: 0.085, shoulderX: 0.158, neckR: 0.040,
    upperArm: 0.265, foreArm: 0.235, armScale: 0.76, handLen: 0.156, footK: 0.9,
    eye: { x: 0.033, rx: 0.0142, ry: 0.0128, rz: 0.0088 },
  },
};

const _r = newRow();

export function headRing(h: HeadSpec, y: number, out: RingRow): RingRow {
  return h.table.at(y, out);
}

/** z de la superficie frontal de la cabeza en (x, y). */
export function headFront(h: HeadSpec, x: number, y: number): number {
  const r = h.table.at(y, _r);
  const k = Math.min(0.999, Math.abs(x) / r.rx);
  return r.cz + r.rz * (1 - k ** h.p) ** (1 / h.p);
}

/** z de la superficie trasera de la cabeza en (x, y) (negativa). */
export function headBack(h: HeadSpec, x: number, y: number): number {
  const r = h.table.at(y, _r);
  const k = Math.min(0.999, Math.abs(x) / r.rx);
  return r.cz - r.rz * (1 - k ** h.p) ** (1 / h.p);
}

export function makeBody(gender: Gender): BodySpec {
  const r = RAW[gender];
  const g = gender === 'male' ? 0 : 1;
  const chinY = r.shoulderY + (gender === 'male' ? 0.089 : 0.077);
  const crownY = chinY + r.headH;
  const rows: RingRow[] = HEAD_U.map((u) => row(chinY + u[0]! * r.headH, r.headW * u[1 + g]!, r.headD * u[3 + g]!, r.headD * u[5]!));
  const head: HeadSpec = { H: r.headH, W: r.headW, D: r.headD, p: r.headP, chinY, crownY, table: new RingTable(rows) };
  const eyeY = chinY + 0.53 * r.headH;
  const eyeZ = headFront(head, r.eye.x, eyeY) - 0.0035;
  const elbowY = r.shoulderY - r.upperArm;
  const wristY = elbowY - r.foreArm;
  const handK = r.handLen / 0.18;
  const tailY = chinY + 0.70 * r.headH;
  const tailZ = -r.headD * 0.98;
  return {
    gender, height: r.height, ankleY: r.ankleY, kneeY: r.kneeY, hipY: r.hipY, waistJ: r.waistJ, chestJ: r.chestJ,
    shoulderY: r.shoulderY, neckBaseY: r.neckBaseY, headJ: chinY + 0.06, chinY, crownY,
    elbowY, wristY, hipX: r.hipX, shoulderX: r.shoulderX, neckR: r.neckR,
    upperArm: r.upperArm, foreArm: r.foreArm, armScale: r.armScale, handLen: r.handLen, handK,
    torso: new RingTable(TORSO[gender]), leg: new RingTable(LEG[gender]), arm: new RingTable(ARM_ROWS),
    hand: new RingTable(HAND_ROWS.map((h) => row(h.y * handK, h.rx * handK, h.rz * handK, h.cz * handK))),
    head,
    eye: { x: r.eye.x, y: eyeY, z: eyeZ, rx: r.eye.rx, ry: r.eye.ry, rz: r.eye.rz },
    foot: FOOT_M.map((f): FootRow => [f[0] * r.footK, f[1] * r.footK, f[2] * (gender === 'male' ? 1 : 0.94), f[3]]),
    tailA: [0, tailY, tailZ],
    tailB: [0, tailY - 0.13, tailZ - 0.075],
  };
}

/** Posiciones de reposo de los huesos. */
export function rigLayout(b: BodySpec): RigLayout {
  const lid = (s: Side): readonly [number, number, number] => [s * b.eye.x, b.eye.y + b.eye.ry * 1.2, b.eye.z];
  return {
    hips: [0, b.hipY, 0], spine: [0, b.waistJ, 0], chest: [0, b.chestJ, 0], neck: [0, b.neckBaseY, 0],
    head: [0, b.headJ, -0.006], lidL: lid(1), lidR: lid(-1), tailA: b.tailA, tailB: b.tailB,
    uArmL: [b.shoulderX, b.shoulderY, 0], fArmL: [b.shoulderX, b.elbowY, 0], handL: [b.shoulderX, b.wristY, 0],
    uArmR: [-b.shoulderX, b.shoulderY, 0], fArmR: [-b.shoulderX, b.elbowY, 0], handR: [-b.shoulderX, b.wristY, 0],
    thighL: [b.hipX, b.hipY, 0], shinL: [b.hipX, b.kneeY, 0], footL: [b.hipX, b.ankleY, 0],
    thighR: [-b.hipX, b.hipY, 0], shinR: [-b.hipX, b.kneeY, 0], footR: [-b.hipX, b.ankleY, 0],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Muestreo de secciones (para que las prendas sigan al cuerpo)
// ─────────────────────────────────────────────────────────────────────────────
/** Sección del brazo a la altura y (cx en el eje del brazo del lado s). */
export function armRing(b: BodySpec, y: number, s: Side, out: RingRow): RingRow {
  const t = (b.shoulderY - y) / (b.upperArm + b.foreArm);
  b.arm.at(t, out);
  out.y = y;
  out.rx *= b.armScale;
  out.rz *= b.armScale;
  out.cx = s * b.shoulderX;
  return out;
}

/** Secciones de la mano (ascendentes en y) entre las distancias w0 y w1 desde la muñeca. */
export function handStations(b: BodySpec, s: Side, w0: number, w1: number, grow: number, n = 6): Station[] {
  const out: Station[] = [];
  const t = newRow();
  for (let i = n; i >= 0; i--) {
    const w = w0 + ((w1 - w0) * i) / n;
    b.hand.at(w, t);
    out.push({ y: b.wristY - w, rx: t.rx + grow, rz: t.rz + grow, cx: s * b.shoulderX, cz: t.cz });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometría de la piel
// ─────────────────────────────────────────────────────────────────────────────
export function buildBody(c: BuildCtx): void {
  const { body: b, kit, skins } = c;

  // Torso (bajo la ropa; cierra huecos entre prendas).
  kit.paint('skin', skins.torso).loftY(
    b.torso.rows.map((r): Station => ({ y: r.y, rx: r.rx, rz: r.rz, cz: r.cz })),
    { seg: 16, p: 2.4, caps: 'bottom' },
  );

  // Cuello.
  const nb = b.neckBaseY;
  const nr = b.neckR;
  const neck = [
    { y: nb - 0.03, k: 1.16 }, { y: nb + 0.012, k: 1.06 }, { y: (nb + b.chinY) / 2, k: 1.0 }, { y: b.chinY + 0.02, k: 0.98 },
    { y: b.chinY + 0.055, k: 0.98 },
  ];
  kit.paint('skin', skins.neck).loftY(
    neck.map((n): Station => ({ y: n.y, rx: nr * n.k, rz: nr * n.k * 0.94, cz: 0.004 })),
    { seg: 12, p: 2.2, caps: 'bottom' },
  );
  if (b.gender === 'male') {
    // Nuez.
    kit.paint('skin', skins.neck).blob(0.011, 0.014, 0.011, { y: nb + 0.03, z: nr * 0.94 + 0.004 }, 7, 5);
  }

  // Cabeza (cráneo + mandíbula).
  kit.paint('skin', 'head').loftY(
    b.head.table.rows.map((r): Station => ({ y: r.y, rx: r.rx, rz: r.rz, cz: r.cz })),
    { seg: 20, p: b.head.p, caps: 'both' },
  );

  // Brazos y manos.
  const t = newRow();
  for (const s of [1, -1] as Side[]) {
    const armSkin = skins.arm(s);
    const arm: Station[] = [];
    for (let i = b.arm.rows.length - 1; i >= 0; i--) {
      const r = b.arm.rows[i]!;
      arm.push({ y: b.shoulderY - r.y * (b.upperArm + b.foreArm), rx: r.rx * b.armScale, rz: r.rz * b.armScale, cx: s * b.shoulderX });
    }
    kit.paint('skin', armSkin).loftY(arm, { seg: 10, caps: 'bottom' });

    const hand = kit.paint('skin', sideBone('hand', s));
    hand.loftY(handStations(b, s, 0, b.handLen, 0, 7), { seg: 10, p: 2.6, caps: 'bottom' });
    // Pulgar: hacia delante y ligeramente hacia dentro.
    const k = b.handK;
    const xi = s * (b.shoulderX - 0.033 * k);
    hand.tube(
      [
        { x: xi, y: b.wristY - 0.03 * k, z: 0.014 * k, ra: 0.0135 * k },
        { x: xi - s * 0.004 * k, y: b.wristY - 0.07 * k, z: 0.03 * k, ra: 0.0118 * k },
        { x: xi - s * 0.008 * k, y: b.wristY - 0.103 * k, z: 0.043 * k, ra: 0.0085 * k },
      ],
      { seg: 6 },
    );
  }
  void t;
}
