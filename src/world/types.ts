/**
 * Tipos de DATOS del mundo (sin three.js): piezas de geometría estática, props instanciables,
 * colisionadores, luces y ráster de suelo. El layout los genera de forma determinista y tanto
 * la colisión/navegación (puras) como el render los consumen.
 *
 * Convención de rotación: `rot` es el yaw de three.js (`object.rotation.y`): el eje local +X apunta
 * en el mundo a (cos rot, -sin rot) y el eje local +Z a (sin rot, cos rot). Norte = -Z.
 */
import type { MaterialKey, SurfaceKind, ZoneId } from '../core/types';
import type { Rect } from '../config';

export type { Rect };

// ── Suelo ────────────────────────────────────────────────────────────────────
export interface GroundKindDef {
  mat: MaterialKey;
  surface: SurfaceKind;
}

/** Índices del ráster de suelo. */
export const GK = {
  concrete: 0, concreteDark: 1, concreteStained: 2, asphalt: 3, asphaltWorn: 4, dirt: 5, gravel: 6, labFloor: 7, tile: 8, metal: 9,
} as const;

export const GROUND_KINDS: readonly GroundKindDef[] = [
  { mat: 'concrete', surface: 'concrete' },
  { mat: 'concreteDark', surface: 'concrete' },
  { mat: 'concreteStained', surface: 'concrete' },
  { mat: 'asphalt', surface: 'asphalt' },
  { mat: 'asphaltWorn', surface: 'asphalt' },
  { mat: 'dirt', surface: 'dirt' },
  { mat: 'gravel', surface: 'dirt' },
  { mat: 'labFloor', surface: 'concrete' },
  { mat: 'tile', surface: 'concrete' },
  { mat: 'metalPanel', surface: 'metal' },
];

export interface GroundGrid {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly originX: number;
  readonly originZ: number;
  /** Índice GK por celda (row * cols + col). */
  readonly data: Uint8Array;
}

// ── Piezas estáticas ─────────────────────────────────────────────────────────
export interface BoxPiece {
  t: 'box';
  cx: number;
  cz: number;
  /** Tamaños completos en los ejes locales X y Z. */
  sx: number;
  sz: number;
  y0: number;
  y1: number;
  rot: number;
  mat: MaterialKey;
  surface: SurfaceKind;
  collide: boolean;
  /** Bloquea rayos y línea de visión (false en vallas). */
  ray: boolean;
  cast: boolean;
  /** Pinta la cara superior (false en piezas cuyo techo queda oculto). */
  top: boolean;
}

export interface CylPiece {
  t: 'cyl';
  cx: number;
  cz: number;
  r: number;
  /** Radio en la parte superior (cono truncado); igual a r para cilindro. */
  rTop: number;
  y0: number;
  y1: number;
  seg: number;
  mat: MaterialKey;
  /** Material de la tapa superior (por defecto el mismo). */
  matTop: MaterialKey;
  surface: SurfaceKind;
  collide: boolean;
  ray: boolean;
  cast: boolean;
  capTop: boolean;
}

/** Rampa: sube a lo largo del eje local +X, de la altura y0 (extremo -X) a y1 (extremo +X). */
export interface RampPiece {
  t: 'ramp';
  cx: number;
  cz: number;
  /** Longitud (eje local X) y anchura (eje local Z). */
  sx: number;
  sz: number;
  y0: number;
  y1: number;
  rot: number;
  mat: MaterialKey;
  surface: SurfaceKind;
  cast: boolean;
}

/** Quad plano horizontal a altura `y` (marcas, parches, charcos, anillos). */
export interface FlatPiece {
  t: 'flat';
  cx: number;
  cz: number;
  /** Rect: tamaño X/Z. Disco/anillo/mancha: sx = radio exterior. */
  sx: number;
  sz: number;
  /** Radio interior (sólo anillo). */
  r0: number;
  y: number;
  rot: number;
  shape: 'rect' | 'disc' | 'ring' | 'blob';
  mat: MaterialKey;
  seed: number;
}

/** Quad vertical (cartel, ventana, puerta pintada) que mira hacia el eje local +Z (rot). */
export interface VQuadPiece {
  t: 'vquad';
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  rot: number;
  mat: MaterialKey;
}

/** Viga (caja) o tubería (cilindro) entre dos puntos. */
export interface BeamPiece {
  t: 'beam';
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  /** Grosor (viga) o radio (tubería). */
  w: number;
  round: boolean;
  mat: MaterialKey;
  cast: boolean;
}

/** Cúpula (segmento de esfera achatado). */
export interface DomePiece {
  t: 'dome';
  cx: number;
  cz: number;
  r: number;
  y0: number;
  /** Altura de la cúpula. */
  h: number;
  mat: MaterialKey;
  cast: boolean;
}

/** Tejado a dos aguas (visual): cumbrera a lo largo del eje local X (o Z si `ridgeZ`). */
export interface PrismPiece {
  t: 'prism';
  cx: number;
  cz: number;
  sx: number;
  sz: number;
  y0: number;
  h: number;
  rot: number;
  ridgeZ: boolean;
  mat: MaterialKey;
  cast: boolean;
}

export type Piece = BoxPiece | CylPiece | RampPiece | FlatPiece | VQuadPiece | BeamPiece | DomePiece | PrismPiece;

// ── Props instanciables ──────────────────────────────────────────────────────
export type PropType =
  | 'barrel' | 'barrelToxic' | 'crate' | 'crateMetal' | 'pallet' | 'cartons' | 'lamp' | 'jersey' | 'sandbag'
  | 'dumpster' | 'car' | 'truck' | 'shelf' | 'acUnit' | 'tires' | 'reel' | 'cone' | 'container20' | 'container40'
  | 'benchLab' | 'generator' | 'tent' | 'bollard';

export interface PropSpec {
  /** Colisionador: caja (w×d×h, centrada en x,z) o cilindro; null = decorativo. */
  box?: { w: number; d: number; h: number };
  cyl?: { r: number; h: number };
  surface: SurfaceKind;
  /** ¿Proyecta sombra? (sólo volúmenes grandes). */
  cast: boolean;
  /** ¿Es buen sitio de botín en su entorno? */
  loot: boolean;
}

export const PROP_SPECS: Record<PropType, PropSpec> = {
  barrel: { cyl: { r: 0.3, h: 0.95 }, surface: 'metal', cast: false, loot: true },
  barrelToxic: { cyl: { r: 0.3, h: 0.95 }, surface: 'metal', cast: false, loot: true },
  crate: { box: { w: 1, d: 1, h: 1 }, surface: 'wood', cast: false, loot: true },
  crateMetal: { box: { w: 1, d: 1, h: 1 }, surface: 'metal', cast: false, loot: true },
  pallet: { surface: 'wood', cast: false, loot: false },
  cartons: { box: { w: 1.2, d: 1.0, h: 1.3 }, surface: 'wood', cast: false, loot: true },
  lamp: { cyl: { r: 0.12, h: 7 }, surface: 'metal', cast: false, loot: false },
  jersey: { box: { w: 3.0, d: 0.6, h: 0.8 }, surface: 'concrete', cast: false, loot: false },
  sandbag: { box: { w: 1.8, d: 0.75, h: 0.75 }, surface: 'dirt', cast: false, loot: false },
  dumpster: { box: { w: 2.2, d: 1.3, h: 1.35 }, surface: 'metal', cast: false, loot: true },
  car: { box: { w: 4.3, d: 1.8, h: 1.45 }, surface: 'metal', cast: true, loot: true },
  truck: { box: { w: 8.4, d: 2.55, h: 3.3 }, surface: 'metal', cast: true, loot: true },
  shelf: { box: { w: 3.0, d: 0.9, h: 3.0 }, surface: 'metal', cast: false, loot: true },
  acUnit: { box: { w: 1.8, d: 1.2, h: 1.1 }, surface: 'metal', cast: false, loot: false },
  tires: { cyl: { r: 0.45, h: 1.0 }, surface: 'dirt', cast: false, loot: false },
  reel: { cyl: { r: 0.8, h: 1.1 }, surface: 'wood', cast: false, loot: false },
  cone: { surface: 'dirt', cast: false, loot: false },
  container20: { box: { w: 6.06, d: 2.44, h: 2.59 }, surface: 'metal', cast: true, loot: true },
  container40: { box: { w: 12.19, d: 2.44, h: 2.59 }, surface: 'metal', cast: true, loot: true },
  benchLab: { box: { w: 2.4, d: 0.9, h: 0.95 }, surface: 'metal', cast: false, loot: true },
  generator: { box: { w: 1.9, d: 1.0, h: 1.3 }, surface: 'metal', cast: false, loot: true },
  tent: { box: { w: 5.0, d: 4.0, h: 2.6 }, surface: 'wood', cast: true, loot: true },
  bollard: { cyl: { r: 0.14, h: 0.9 }, surface: 'concrete', cast: false, loot: false },
};

export interface PropInstance {
  type: PropType;
  x: number;
  y: number;
  z: number;
  rot: number;
  sx: number;
  sy: number;
  sz: number;
  /** Variante (color, modelo) interpretada por props.ts. */
  variant: number;
}

// ── Colisionadores ───────────────────────────────────────────────────────────
export interface ColliderDef {
  shape: 'box' | 'cyl' | 'ramp';
  x: number;
  z: number;
  /** Semiejes locales (caja, rampa). */
  hx: number;
  hz: number;
  /** Radio (cilindro). */
  r: number;
  rot: number;
  y0: number;
  y1: number;
  /** Rampa: altura en el extremo -X (rampLow) y +X (y1). Para caja/cilindro se ignora. */
  rampLow: number;
  surface: SurfaceKind;
  ray: boolean;
}

// ── Luces ────────────────────────────────────────────────────────────────────
export type GlowKind = 'steady' | 'blink' | 'flicker' | 'pulse';

/** Halo aditivo barato (billboard). */
export interface GlowSpec {
  x: number;
  y: number;
  z: number;
  /** Diámetro del halo (m). */
  size: number;
  color: number;
  kind: GlowKind;
  /** Frecuencia (Hz) de parpadeo/pulso. */
  rate: number;
  phase: number;
  intensity: number;
}

/** Ventana emisiva instanciada. tone: 0 ámbar, 1 blanca, 2 azul, 3 roja. */
export interface WindowSpec {
  x: number;
  y: number;
  z: number;
  rot: number;
  w: number;
  h: number;
  tone: 0 | 1 | 2 | 3;
}

export interface PointLightSpec {
  id: string;
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  distance: number;
  flicker: number;
}

// ── Puntos clave y metadatos ─────────────────────────────────────────────────
export interface PoiDef {
  id: string;
  x: number;
  z: number;
  /** Radio que debe quedar libre de colisionadores. */
  clear: number;
}

export interface LootAnchor {
  x: number;
  z: number;
  zone: ZoneId;
}

export interface BuildingInfo {
  id: string;
  zone: ZoneId;
  rect: Rect;
  enterable: boolean;
  /** Alto de los muros. */
  height: number;
}

export interface RoadInfo {
  rect: Rect;
  /** Eje longitudinal. */
  axis: 'x' | 'z';
  width: number;
}

export interface WorldLayout {
  seed: number;
  bounds: Rect;
  pieces: Piece[];
  props: PropInstance[];
  windows: WindowSpec[];
  glows: GlowSpec[];
  pointLights: PointLightSpec[];
  colliders: ColliderDef[];
  ground: GroundGrid;
  pois: PoiDef[];
  lootAnchors: LootAnchor[];
  buildings: BuildingInfo[];
  roads: RoadInfo[];
  /** Rectángulos de la ciudad que NO son suelo del distrito (para el render de depuración). */
  counts: { boxes: number; cyls: number; ramps: number; props: number; colliders: number };
}
