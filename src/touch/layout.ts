/**
 * Lógica PURA de reparto de la pantalla táctil (sin DOM): decisión de zona de un toque, orientación y
 * cálculo de tamaños/posiciones de los botones según el tamaño de pantalla, las áreas seguras y el modo zurdo.
 * Todas las coordenadas son px CSS con origen arriba-izquierda.
 *
 * Reparto (apaisado, diestro; el modo zurdo lo refleja en horizontal):
 *   · joystick flotante: abajo-izquierda (zona de toque ~38 % del ancho, desde el 40 % de la altura hacia abajo);
 *   · cluster de botones: abajo-derecha, en dos arcos alrededor del botón de DISPARO;
 *   · pausa / mapa / ajustes: arriba-derecha.
 * El resto de la pantalla es zona de mirada.
 */
import { TOUCH } from '../config';

export type ButtonId =
  | 'fire' | 'aim' | 'jump' | 'crouch' | 'reload' | 'grenade' | 'plate' | 'swap' | 'interact'
  | 'pause' | 'map' | 'settings';

/** Botones de partida (se ocultan con un modal abierto) y del sistema (pausa, mapa, ajustes). */
export const GAMEPLAY_BUTTONS: readonly ButtonId[] = ['fire', 'aim', 'jump', 'crouch', 'reload', 'grenade', 'plate', 'swap', 'interact'];
export const SYSTEM_BUTTONS: readonly ButtonId[] = ['pause', 'map', 'settings'];

/** Parámetros de reparto (fracciones de pantalla y límites en px). Única fuente de estos números. */
export const TOUCH_UI = {
  /** Zona de toque del joystick: fracción del ancho y fracción de la altura donde EMPIEZA (hacia abajo). */
  stickZoneWidth: 0.38,
  stickZoneTop: 0.4,
  /** Diámetro del botón de disparo, de los secundarios y de los de sistema: fracción de la altura y clamp (px). */
  fire: { k: 0.26, min: 78, max: 128 },
  small: { k: 0.155, min: 48, max: 82 },
  system: { k: 0.11, min: 40, max: 56 },
  /** El botón de interactuar es algo mayor que los secundarios. */
  interactScale: 1.15,
  /** Margen a los bordes y hueco entre botones (fracción de la altura y clamp). */
  margin: { k: 0.045, min: 10, max: 26 },
  gap: { k: 0.02, min: 6, max: 12 },
  /** Radio libre alrededor del centro de la pantalla (fracción de la altura): la mirilla nunca se tapa. */
  crosshairClear: 0.1,
  /** Holgura (px) antes de que un dedo sobre el botón de disparo empiece a girar la cámara. */
  fireLookSlop: 6,
} as const;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Botón circular: centro y diámetro. */
export interface ButtonRect {
  id: ButtonId;
  cx: number;
  cy: number;
  size: number;
}

export interface TouchLayout {
  width: number;
  height: number;
  lefty: boolean;
  /** Botones en orden fijo (los de partida y luego los del sistema). */
  buttons: ButtonRect[];
  /** Zona de toque del joystick (rectángulo). */
  stickZone: Rect;
  /** Centro del aro fantasma que indica dónde apoyar el pulgar. */
  stickHome: { x: number; y: number };
  /** Rectángulo mínimo que contiene el cluster de partida (para que el HUD no lo solape). */
  cluster: Rect;
  /** Rectángulo mínimo de los botones de sistema (arriba). */
  topBar: Rect;
}

export const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const scaled = (h: number, s: { k: number; min: number; max: number }): number => clamp(h * s.k, s.min, s.max);

/** En vertical (alto > ancho) se muestra el aviso «Gira el dispositivo». */
export function isPortrait(width: number, height: number): boolean {
  return height > width;
}

export type TouchZone = 'stick' | 'look';

/** ¿A qué mando pertenece un toque que empieza en (x, y) sobre el fondo? */
export function decideZone(x: number, y: number, width: number, height: number, lefty: boolean): TouchZone {
  const zoneW = width * TOUCH_UI.stickZoneWidth;
  const inX = lefty ? x >= width - zoneW : x <= zoneW;
  const inY = y >= height * TOUCH_UI.stickZoneTop;
  return inX && inY ? 'stick' : 'look';
}

/** Sitio (anillo y ángulo en grados: 0 = derecha, 90 = arriba, 180 = izquierda) de cada botón del cluster. */
interface Slot {
  id: ButtonId;
  ring: 1 | 2;
  deg: number;
}
const SLOTS: readonly Slot[] = [
  { id: 'jump', ring: 1, deg: 90 },
  { id: 'reload', ring: 1, deg: 135 },
  { id: 'aim', ring: 1, deg: 180 },
  { id: 'crouch', ring: 2, deg: 90 },
  { id: 'grenade', ring: 2, deg: 120 },
  { id: 'plate', ring: 2, deg: 150 },
  { id: 'swap', ring: 2, deg: 180 },
];

/** Rectángulo mínimo que contiene círculos. */
function boundsOf(list: readonly ButtonRect[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of list) {
    minX = Math.min(minX, b.cx - b.size / 2);
    minY = Math.min(minY, b.cy - b.size / 2);
    maxX = Math.max(maxX, b.cx + b.size / 2);
    maxY = Math.max(maxY, b.cy + b.size / 2);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Calcula el reparto para una pantalla de `width` × `height` px CSS. `insets` son las áreas seguras (muesca,
 * barra de inicio). En modo zurdo todo se refleja en horizontal (y los márgenes laterales se intercambian).
 */
export function computeLayout(
  width: number,
  height: number,
  lefty = false,
  insets: Insets = ZERO_INSETS,
  stickRadius: number = TOUCH.stickRadius,
): TouchLayout {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  // Se calcula siempre en diestro y se refleja al final: el cluster mira hacia el lado de la mano.
  const ins: Insets = lefty ? { top: insets.top, bottom: insets.bottom, left: insets.right, right: insets.left } : insets;
  const F = Math.round(scaled(h, TOUCH_UI.fire));
  const S = Math.round(scaled(h, TOUCH_UI.small));
  const I = Math.round(S * TOUCH_UI.interactScale);
  const T = Math.round(scaled(h, TOUCH_UI.system));
  const m = Math.round(scaled(h, TOUCH_UI.margin));
  const g = Math.round(scaled(h, TOUCH_UI.gap));

  const fx = w - ins.right - m - F / 2;
  const fy = h - ins.bottom - m - F / 2;
  const r1 = F / 2 + S / 2 + g;
  const r2 = r1 + S + g;

  const list: ButtonRect[] = [{ id: 'fire', cx: fx, cy: fy, size: F }];
  for (const s of SLOTS) {
    const r = s.ring === 1 ? r1 : r2;
    const a = (s.deg * Math.PI) / 180;
    list.push({ id: s.id, cx: fx + r * Math.cos(a), cy: fy - r * Math.sin(a), size: S });
  }
  // Interactuar: en la fila inferior, a la izquierda del cluster (el botón que aparece sólo cuando hace falta).
  list.push({ id: 'interact', cx: fx - r2 - (S + I) / 2 - g, cy: fy, size: I });
  const cluster = boundsOf(list);

  // Botones de sistema: arriba a la derecha, pausa en la esquina.
  const ty = ins.top + m + T / 2;
  const tx = w - ins.right - m - T / 2;
  const sys: ButtonRect[] = [
    { id: 'pause', cx: tx, cy: ty, size: T },
    { id: 'map', cx: tx - (T + g), cy: ty, size: T },
    { id: 'settings', cx: tx - 2 * (T + g), cy: ty, size: T },
  ];
  const topBar = boundsOf(sys);

  const zoneW = w * TOUCH_UI.stickZoneWidth;
  const stickZone: Rect = { x: 0, y: h * TOUCH_UI.stickZoneTop, w: zoneW, h: h - h * TOUCH_UI.stickZoneTop };
  const home = { x: ins.left + m + stickRadius * 1.3, y: h - ins.bottom - m - stickRadius * 1.3 };

  const all = [...list, ...sys];
  if (lefty) {
    for (const b of all) b.cx = w - b.cx;
    for (const r of [cluster, topBar]) r.x = w - r.x - r.w;
    stickZone.x = w - zoneW;
    home.x = w - home.x;
  }
  return { width: w, height: h, lefty, buttons: all, stickZone, stickHome: home, cluster, topBar };
}

/** Busca un botón por id en un reparto. */
export function findButton(layout: TouchLayout, id: ButtonId): ButtonRect | undefined {
  return layout.buttons.find((b) => b.id === id);
}

/** ¿Se solapan dos botones circulares (con un hueco mínimo opcional)? */
export function buttonsOverlap(a: ButtonRect, b: ButtonRect, minGap = 0): boolean {
  return Math.hypot(a.cx - b.cx, a.cy - b.cy) < (a.size + b.size) / 2 + minGap;
}
