/**
 * Retrato 2D del operativo dibujado por código (canvas) a partir de `resolveLook(profile)`:
 * cuello/ropa, cabeza, pelo por estilo, tono de piel y accesorio. Distinto en masculino y
 * femenino. La parte de datos (`portraitSpec`, colores) es pura y está testeada; el dibujo sólo
 * necesita un contexto 2D.
 */
import { CHARACTER, HUD } from '../config';
import type { EventBus } from '../core/events';
import type { RunState } from '../core/state';
import type { Gender } from '../core/types';
import { resolveLook } from '../rules/character';
import type { ResolvedLook } from '../rules/character';
import { el } from './dom';

// ─────────────────────────────────────────────────────────────────────────────
// Datos puros
// ─────────────────────────────────────────────────────────────────────────────
/** 0xrrggbb → '#rrggbb'. */
export const hexColor = (n: number): string => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;

/** Aclara (k > 0) u oscurece (k < 0) un color 0xrrggbb; k en [-1, 1]. */
export function shadeColor(n: number, k: number): string {
  const f = Math.max(-1, Math.min(1, k));
  const ch = (v: number): number => Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return hexColor((r << 16) | (g << 8) | b);
}

export interface PortraitSpec {
  gender: Gender;
  skin: string;
  skinShade: string;
  skinLight: string;
  hair: string;
  hairShade: string;
  hairLight: string;
  jacket: string;
  jacketShade: string;
  accent: string;
  hairStyle: string;
  accessory: string;
  /** Semianchura de la cabeza y ancho del mentón (unidades del lienzo de 100). */
  headHalfW: number;
  chinHalfW: number;
  chinY: number;
  /** Grosor de las cejas y presencia de pestañas. */
  brow: number;
  lashes: boolean;
}

export function portraitSpec(look: ResolvedLook): PortraitSpec {
  const male = look.gender === 'male';
  return {
    gender: look.gender,
    skin: hexColor(look.skin),
    skinShade: shadeColor(look.skin, -0.22),
    skinLight: shadeColor(look.skin, 0.12),
    hair: hexColor(look.hair),
    hairShade: shadeColor(look.hair, -0.35),
    hairLight: shadeColor(look.hair, 0.28),
    jacket: hexColor(look.jacket),
    jacketShade: shadeColor(look.jacket, -0.3),
    accent: hexColor(look.accent),
    hairStyle: look.hairStyle,
    accessory: look.accessory,
    headHalfW: male ? 17.5 : 16,
    chinHalfW: male ? 8 : 4.6,
    chinY: male ? 66 : 67,
    brow: male ? 2.3 : 1.4,
    lashes: !male,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dibujo
// ─────────────────────────────────────────────────────────────────────────────
type G = CanvasRenderingContext2D;
type Drawer = (g: G, s: PortraitSpec) => void;

const path = (g: G, d: string, fill: string, alpha = 1): void => {
  g.globalAlpha = alpha;
  g.fillStyle = fill;
  g.fill(new Path2D(d));
  g.globalAlpha = 1;
};
const circle = (g: G, x: number, y: number, r: number, fill: string): void => {
  g.fillStyle = fill;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
};
const ellipse = (g: G, x: number, y: number, rx: number, ry: number, fill: string, rot = 0): void => {
  g.fillStyle = fill;
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  g.fill();
};
const mirror = (d: string): string =>
  // Refleja un path compuesto sólo de comandos absolutos M/L/C/Q/Z respecto a x = 50.
  d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_m, x: string, y: string) => `${(100 - Number(x)).toFixed(2)} ${y}`);
const both = (g: G, d: string, fill: string, alpha = 1): void => {
  path(g, d, fill, alpha);
  path(g, mirror(d), fill, alpha);
};

// Cuerpo, cuello y cabeza -----------------------------------------------------
function drawBody(g: G, s: PortraitSpec): void {
  // Fondo.
  const bg = g.createLinearGradient(0, 0, 0, 100);
  bg.addColorStop(0, '#16223a');
  bg.addColorStop(1, '#0a1120');
  g.fillStyle = bg;
  g.fillRect(0, 0, 100, 100);
  // Hombros / chaqueta.
  path(g, 'M2 100 C4 82 22 73 40 70.5 L60 70.5 C78 73 96 82 98 100 Z', s.jacket);
  path(g, 'M2 100 C4 90 12 83 22 78.5 L26 100 Z', s.jacketShade, 0.55);
  // Franja de detalle.
  g.strokeStyle = s.accent;
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(9, 88);
  g.quadraticCurveTo(28, 80, 40, 82);
  g.moveTo(91, 88);
  g.quadraticCurveTo(72, 80, 60, 82);
  g.stroke();
  // Cuello.
  path(g, 'M43 56 L57 56 L58 74 C54 78 46 78 42 74 Z', s.skinShade);
  // Cuello de la chaqueta en V.
  path(g, 'M40 70.5 L50 84 L60 70.5 L56 69 L50 77 L44 69 Z', s.jacketShade);
  g.strokeStyle = s.accent;
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(40 + 1, 71.5);
  g.lineTo(50, 84);
  g.lineTo(60 - 1, 71.5);
  g.stroke();
}

function headShape(g: G, s: PortraitSpec): void {
  const hw = s.headHalfW;
  const cw = s.chinHalfW;
  const top = 21;
  g.beginPath();
  g.moveTo(50, top);
  g.bezierCurveTo(50 + hw * 0.92, top, 50 + hw, 31, 50 + hw, 44);
  g.bezierCurveTo(50 + hw, 55, 50 + cw + 4, s.chinY - 1.5, 50 + cw, s.chinY);
  g.lineTo(50 - cw, s.chinY);
  g.bezierCurveTo(50 - cw - 4, s.chinY - 1.5, 50 - hw, 55, 50 - hw, 44);
  g.bezierCurveTo(50 - hw, 31, 50 - hw * 0.92, top, 50, top);
  g.closePath();
}

function drawHead(g: G, s: PortraitSpec): void {
  // Orejas.
  ellipse(g, 50 - s.headHalfW - 0.6, 46, 3, 4.6, s.skinShade);
  ellipse(g, 50 + s.headHalfW + 0.6, 46, 3, 4.6, s.skinShade);
  // Cabeza.
  headShape(g, s);
  const grad = g.createLinearGradient(30, 20, 70, 68);
  grad.addColorStop(0, s.skinLight);
  grad.addColorStop(1, s.skin);
  g.fillStyle = grad;
  g.fill();
  // Sombra bajo el mentón.
  path(g, `M${50 - s.chinHalfW - 6} ${s.chinY - 2} Q50 ${s.chinY + 5} ${50 + s.chinHalfW + 6} ${s.chinY - 2} Q50 ${s.chinY + 1} ${50 - s.chinHalfW - 6} ${s.chinY - 2} Z`, s.skinShade, 0.5);
}

function drawFace(g: G, s: PortraitSpec): void {
  const male = s.gender === 'male';
  // Cejas.
  g.strokeStyle = s.hairShade;
  g.lineCap = 'round';
  g.lineWidth = s.brow;
  g.beginPath();
  g.moveTo(37, male ? 39.6 : 39.2);
  g.lineTo(46.5, male ? 38.6 : 38);
  g.moveTo(53.5, male ? 38.6 : 38);
  g.lineTo(63, male ? 39.6 : 39.2);
  g.stroke();
  // Ojos.
  const ry = male ? 1.7 : 2.1;
  ellipse(g, 42.2, 45, 2.3, ry, '#0d1117');
  ellipse(g, 57.8, 45, 2.3, ry, '#0d1117');
  circle(g, 42.9, 44.3, 0.6, '#ffffff');
  circle(g, 58.5, 44.3, 0.6, '#ffffff');
  if (s.lashes) {
    g.strokeStyle = '#0d1117';
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(39.6, 44.4);
    g.lineTo(38.4, 43.2);
    g.moveTo(60.4, 44.4);
    g.lineTo(61.6, 43.2);
    g.stroke();
  }
  // Nariz.
  g.strokeStyle = s.skinShade;
  g.lineWidth = 1.3;
  g.beginPath();
  g.moveTo(50, 46);
  g.lineTo(48.6, 53.5);
  g.lineTo(51.4, 53.5);
  g.stroke();
  // Boca.
  g.lineWidth = male ? 1.6 : 1.9;
  g.strokeStyle = male ? s.skinShade : '#a04a55';
  g.beginPath();
  g.moveTo(45.5, 59);
  g.quadraticCurveTo(50, male ? 59.6 : 61.6, 54.5, 59);
  g.stroke();
}

// Pelo -------------------------------------------------------------------------
// Casquete base compartido (parte superior de la cabeza).
const CAP_SHORT = 'M31 43 C28.5 24 40 16 50 16 C60 16 71.5 24 69 43 C66.5 34 60 29 50 29 C40 29 33.5 34 31 43 Z';
const CAP_FRINGE = 'M30.5 45 C27 22 41 14.5 51 15.5 C64 16.5 72 26 69.5 45 C65 35 58 29.5 47 30.5 C40 31.5 34 36 30.5 45 Z';

const stroke = (g: G, color: string, w: number, d: string): void => {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.stroke(new Path2D(d));
};

const HAIR: Record<string, { back?: Drawer; front?: Drawer }> = {
  // Masculino
  rapado: { front: (g, s) => path(g, 'M32 42 C31.5 26 41 20.5 50 20.5 C59 20.5 68.5 26 68 42 C64.5 33 58 30 50 30 C42 30 35.5 33 32 42 Z', s.hair, 0.5) },
  corto: {
    front: (g, s) => {
      path(g, CAP_SHORT, s.hair);
      both(g, 'M31 43 L33.5 50 L35.5 50 L35.5 40 Z', s.hair);
      stroke(g, s.hairShade, 1, 'M42 21 C46 18 54 18 58 21');
    },
  },
  peinado: {
    front: (g, s) => {
      path(g, 'M30.5 43 C26 22 37 11.5 51 12 C65 12.5 73 24 69.5 43 C66 32 60 25.5 50 25.5 C41 25.5 35 32 30.5 43 Z', s.hair);
      both(g, 'M31 43 L33 50 L35 50 L35 40 Z', s.hair);
      for (const d of ['M38 27 C44 17 54 15 62 20', 'M35 32 C42 21 55 18 66 26', 'M45 24 C50 19 57 18 62 21']) stroke(g, s.hairLight, 1.1, d);
    },
  },
  rizado: {
    front: (g, s) => {
      path(g, CAP_SHORT, s.hair);
      for (let i = 0; i < 9; i++) {
        const a = (Math.PI * (200 + i * 17.5)) / 180;
        circle(g, 50 + Math.cos(a) * 19.5, 37 + Math.sin(a) * 20, 7.4, s.hair);
      }
      for (let i = 0; i < 4; i++) circle(g, 41 + i * 6, 22 + (i % 2) * 2, 5.6, s.hairShade);
      for (let i = 0; i < 4; i++) circle(g, 41 + i * 6, 21 + (i % 2) * 2, 5.2, s.hair);
    },
  },
  melena: {
    back: (g, s) => both(g, 'M30 40 C22 58 24 82 29 94 L46 86 L44 50 Z', s.hair),
    front: (g, s) => {
      path(g, CAP_FRINGE, s.hair);
      both(g, 'M31 44 C29 56 30 66 33 74 L36 60 L35 44 Z', s.hair);
      stroke(g, s.hairShade, 1, 'M50 16 C49 22 46 27 41 31');
    },
  },
  mohicano: {
    front: (g, s) => {
      path(g, 'M32 42 C31.5 27 41 21.5 50 21.5 C59 21.5 68.5 27 68 42 C64.5 34 58 31 50 31 C42 31 35.5 34 32 42 Z', s.hair, 0.32);
      path(g, 'M44.5 30 C43.5 20 44.5 10 47 5 L53 5 C55.5 10 56.5 20 55.5 30 Z', s.hair);
      stroke(g, s.hairLight, 1, 'M50 8 L50 27');
      for (let i = 0; i < 4; i++) path(g, `M${45 + i * 2.5} 9 L${46.2 + i * 2.5} 3 L${47.4 + i * 2.5} 9 Z`, s.hair);
    },
  },
  // Femenino
  pixie: {
    front: (g, s) => {
      path(g, CAP_FRINGE, s.hair);
      path(g, 'M31 42 C33 36 40 33 49 33 C44 37 42 43 40 50 C37 47 33 45 31 42 Z', s.hair);
      both(g, 'M31 44 L33 52 L35.5 50 L35 40 Z', s.hair);
      stroke(g, s.hairLight, 1, 'M40 20 C47 15 58 16 65 24');
    },
  },
  media: {
    back: (g, s) => both(g, 'M29.5 42 C24 56 26 68 33 73.5 L46 70 L44 46 Z', s.hair),
    front: (g, s) => {
      path(g, CAP_FRINGE, s.hair);
      both(g, 'M31 44 C29 54 30 62 34 68 L36 56 L35 44 Z', s.hair);
      stroke(g, s.hairShade, 1, 'M50 16 C50 23 47 28 42 32');
    },
  },
  larga: {
    back: (g, s) => both(g, 'M30 40 C21 60 23 84 28 97 L47 92 L44 48 Z', s.hair),
    front: (g, s) => {
      path(g, CAP_FRINGE, s.hair);
      both(g, 'M31 44 C28 60 29 76 32 90 L37 88 L36 60 L35 44 Z', s.hair);
      stroke(g, s.hairShade, 1, 'M50 16 C50 23 46 28 41 32');
      stroke(g, s.hairLight, 1, 'M31.5 62 C31 72 31.5 80 33 86');
    },
  },
  coleta: {
    back: (g, s) => {
      path(g, 'M64 30 C80 30 88 44 82 62 C80 70 77 76 74 80 C73 68 74 56 68 46 Z', s.hair);
      stroke(g, s.hairShade, 1, 'M76 48 C79 58 78 68 75 76');
    },
    front: (g, s) => {
      path(g, CAP_FRINGE, s.hair);
      circle(g, 68, 33, 3, s.hairShade);
      stroke(g, s.hairLight, 1, 'M40 19 C47 15 58 16 65 23');
    },
  },
  trenzas: {
    back: (g, s) => {
      for (const side of [0, 1]) {
        for (let i = 0; i < 7; i++) {
          const x = side === 0 ? 30 - i * 0.55 : 70 + i * 0.55;
          ellipse(g, x, 52 + i * 6.4, 3.6, 3.7, i % 2 ? s.hairShade : s.hair);
        }
      }
    },
    front: (g, s) => {
      path(g, CAP_FRINGE, s.hair);
      stroke(g, s.hairShade, 1, 'M50 16 C50 23 47 28 42 32');
      circle(g, 26.8, 94, 2.4, s.hairShade);
      circle(g, 73.2, 94, 2.4, s.hairShade);
    },
  },
  mono: {
    back: (g, s) => {
      circle(g, 50, 11.5, 9.5, s.hair);
      stroke(g, s.hairShade, 1, 'M44 9 C48 12 52 12 56 9 M43 13 C48 16 52 16 57 13');
    },
    front: (g, s) => {
      path(g, CAP_SHORT, s.hair);
      g.strokeStyle = s.accent;
      g.lineWidth = 1.6;
      g.beginPath();
      g.ellipse(50, 19.5, 8.6, 2.4, 0, 0, Math.PI * 2);
      g.stroke();
    },
  },
};

// Accesorios --------------------------------------------------------------------
const ACCESSORY: Record<string, Drawer> = {
  none: () => undefined,
  cap: (g, s) => {
    path(g, 'M30 36 C29 12 71 12 70 36 C62 30 38 30 30 36 Z', s.jacket);
    path(g, 'M30 36 C29 12 50 12 50 14 C42 18 36 26 34 36 Z', s.jacketShade, 0.45);
    path(g, 'M27.5 35.5 C40 30 60 30 72.5 35.5 C73.5 38 71 39.5 68 38 C56 34.5 44 34.5 32 38 C29 39.5 26.5 38 27.5 35.5 Z', s.jacketShade);
    circle(g, 50, 22, 2.2, s.accent);
  },
  beanie: (g, s) => {
    path(g, 'M30 37 C28.5 10 71.5 10 70 37 Z', s.jacketShade);
    path(g, 'M29.5 37.5 L70.5 37.5 L70.5 30 L29.5 30 Z', s.accent);
    for (let i = 0; i < 6; i++) stroke(g, s.jacketShade, 1, `M${33 + i * 6.8} 30 L${33 + i * 6.8} 37.5`);
    circle(g, 50, 11.5, 3.6, s.accent);
  },
  goggles: (g) => {
    path(g, 'M29.5 30 L70.5 30 L70.5 34.2 L29.5 34.2 Z', '#161a20');
    for (const x of [34, 52.5]) {
      path(g, `M${x} 25.5 L${x + 13.5} 25.5 Q${x + 15} 25.5 ${x + 15} 27 L${x + 15} 33 Q${x + 15} 34.5 ${x + 13.5} 34.5 L${x} 34.5 Q${x - 1.5} 34.5 ${x - 1.5} 33 L${x - 1.5} 27 Q${x - 1.5} 25.5 ${x} 25.5 Z`, '#1a2028');
      path(g, `M${x + 0.6} 26.8 L${x + 12.9} 26.8 L${x + 12.9} 33.2 L${x + 0.6} 33.2 Z`, '#3fe0b0', 0.72);
      path(g, `M${x + 1.5} 27.5 L${x + 6} 27.5 L${x + 3.5} 32.5 L${x + 1.5} 32.5 Z`, '#ffffff', 0.35);
    }
  },
  bandana: (g, s) => {
    path(g, 'M35.5 66.5 C44 70.5 56 70.5 64.5 66.5 L50 83 Z', s.accent);
    path(g, 'M35.5 66.5 C44 70.5 56 70.5 64.5 66.5 L63 64.5 C55 68 45 68 37 64.5 Z', s.accent);
    for (const [x, y] of [[44, 72], [50, 76], [56, 72], [50, 71]] as const) circle(g, x, y, 0.9, '#ffffff33');
  },
  headset: (g) => {
    g.strokeStyle = '#1b2027';
    g.lineWidth = 3.2;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(31, 46);
    g.bezierCurveTo(28, 14, 72, 14, 69, 46);
    g.stroke();
    for (const x of [26.5, 69]) {
      path(g, `M${x} 40 Q${x} 38.5 ${x + 1.7} 38.5 L${x + 3.4} 38.5 Q${x + 4.4} 38.5 ${x + 4.4} 40 L${x + 4.4} 53 Q${x + 4.4} 54.5 ${x + 3.4} 54.5 L${x + 1.7} 54.5 Q${x} 54.5 ${x} 53 Z`, '#242b34');
    }
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(30, 53);
    g.quadraticCurveTo(33, 64, 43, 62);
    g.stroke();
    circle(g, 43.5, 62, 1.9, '#2f3844');
  },
};

/** Ids con dibujo definido (los tests comprueban que cubren toda la tabla de CHARACTER). */
export const HAIR_STYLE_IDS: readonly string[] = Object.keys(HAIR);
export const ACCESSORY_IDS: readonly string[] = Object.keys(ACCESSORY);

/** Dibuja el retrato completo en un lienzo de `size` px (el contenido se define en 100×100). */
export function drawPortrait(g: G, look: ResolvedLook, size: number): void {
  const s = portraitSpec(look);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, size, size);
  g.scale(size / 100, size / 100);
  drawBody(g, s);
  const hair = HAIR[s.hairStyle] ?? HAIR.corto;
  hair?.back?.(g, s);
  drawHead(g, s);
  drawFace(g, s);
  hair?.front?.(g, s);
  (ACCESSORY[s.accessory] ?? ACCESSORY.none)?.(g, s);
  g.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────
export interface Portrait {
  readonly el: HTMLCanvasElement;
  refresh(): void;
  dispose(): void;
}

/** Retrato que se redibuja solo con 'profile:changed'. Se puede pasar un perfil fijo (tarjetas de preset). */
export function createPortrait(ctx: { bus: EventBus; state: RunState }, className = 'portrait', sizePx: number = HUD.portraitPx): Portrait {
  const canvas = el('canvas', { class: className, attrs: { 'aria-hidden': 'true' } });
  canvas.width = sizePx;
  canvas.height = sizePx;
  const g = canvas.getContext('2d');
  const refresh = (): void => {
    if (g) drawPortrait(g, resolveLook(ctx.state.profile), sizePx);
  };
  const scope = ctx.bus.scope().on('profile:changed', refresh);
  refresh();
  return {
    el: canvas,
    refresh,
    dispose() {
      scope.dispose();
      canvas.remove();
    },
  };
}

/** Retrato estático de una apariencia concreta (tarjetas de la rejilla de presets). */
export function createStaticPortrait(look: ResolvedLook, className = 'portrait', sizePx = 96): HTMLCanvasElement {
  const canvas = el('canvas', { class: className, attrs: { 'aria-hidden': 'true' } });
  canvas.width = sizePx;
  canvas.height = sizePx;
  const g = canvas.getContext('2d');
  if (g) drawPortrait(g, look, sizePx);
  return canvas;
}

/** Ids de estilos de pelo y accesorios que la tabla de config declara (para comprobar cobertura). */
export const CONFIG_HAIR_IDS = (): string[] => [...CHARACTER.hairStyles.male, ...CHARACTER.hairStyles.female].map((h) => h.id);
export const CONFIG_ACCESSORY_IDS = (): string[] => CHARACTER.accessories.map((a) => a.id);
