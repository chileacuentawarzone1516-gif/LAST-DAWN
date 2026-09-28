/**
 * Tabla de datos de los 8 conjuntos (ids de CHARACTER.outfits). Cada fila describe la FORMA de las prendas;
 * los colores llegan resueltos en ResolvedLook (jacket / pants / accent / glove). outfit.ts convierte esta
 * tabla en geometría.
 */
export type CollarKind = 'stand' | 'fold' | 'high' | 'vneck' | 'mandarin';
export type SleeveKind = 'long' | 'short' | 'rolled';
export type BeltKind = 'none' | 'web' | 'tool' | 'sash' | 'utility';
export type StrapKind = 'none' | 'harness' | 'diag';
export type ButtonKind = 'none' | 'single' | 'double';

export interface OutfitSpec {
  /** Borde inferior de la chaqueta respecto a la cadera (m; negativo = más largo). */
  hem: number;
  /** Ensanche del dobladillo (m). */
  flare: number;
  /** Grosor extra de relleno (parka, bombers) sobre la holgura base. */
  puff: number;
  /** Altura de cada gajo acolchado (m); 0 = liso. */
  baffle: number;
  sleeve: SleeveKind;
  collar: CollarKind;
  /** Capucha caída sobre la espalda. */
  hood: boolean;
  zipper: boolean;
  buttons: ButtonKind;
  chestPockets: boolean;
  hipPockets: boolean;
  /** Bolsillos con solapa (en lugar de cremallera/parche liso). */
  flaps: boolean;
  epaulettes: boolean;
  /** Chaleco portaplacas con cargadores. */
  vest: boolean;
  /** Mochila con petates (sacos enrollados). */
  pack: boolean;
  belt: BeltKind;
  straps: StrapKind;
  /** Bandas reflectantes (torso, mangas y piernas). */
  bands: boolean;
  /** Cruz sanitaria (pecho, espalda y manga). */
  cross: boolean;
  /** Ribetes con el color de detalle en cuello, puños y bajo. */
  trim: boolean;
  kneePads: boolean;
  /** Bolsillos laterales en los muslos. */
  cargo: boolean;
  /** Holgura extra de las perneras (m). */
  pantsBag: number;
  glove: 'half' | 'full';
  /** Altura de la caña de la bota (m). */
  bootHeight: number;
  /** Detalles emisivos (costuras luminosas). */
  glow: boolean;
  /** Camiseta bajo el escote en V. */
  undershirt: boolean;
  /** El borde cuelga bajo la cadera: sus pesos siguen parcialmente a los muslos. */
  skirt: boolean;
}

const BASE: OutfitSpec = {
  hem: 0, flare: 0.006, puff: 0.004, baffle: 0, sleeve: 'long', collar: 'stand', hood: false, zipper: false, buttons: 'none',
  chestPockets: false, hipPockets: false, flaps: false, epaulettes: false, vest: false, pack: false, belt: 'none',
  straps: 'none', bands: false, cross: false, trim: false, kneePads: false, cargo: false, pantsBag: 0.004, glove: 'half',
  bootHeight: 0.26, glow: false, undershirt: false, skirt: false,
};

const o = (p: Partial<OutfitSpec>): OutfitSpec => ({ ...BASE, ...p });

export const OUTFIT_SPECS: Record<string, OutfitSpec> = {
  militar: o({
    hem: -0.03, zipper: true, chestPockets: true, flaps: true, vest: true, pack: true, belt: 'web', kneePads: true,
    cargo: true, pantsBag: 0.014, bootHeight: 0.30,
  }),
  urbano: o({
    hem: 0.045, puff: 0.014, flare: 0, collar: 'fold', zipper: true, chestPockets: true, hipPockets: true, epaulettes: true,
    trim: true, bootHeight: 0.2,
  }),
  sanitario: o({
    hem: -0.1, flare: 0.02, collar: 'vneck', buttons: 'single', chestPockets: true, hipPockets: true, cross: true,
    glove: 'full', bootHeight: 0.15, undershirt: true, skirt: true,
  }),
  obrero: o({
    hem: 0.0, puff: 0.008, collar: 'fold', zipper: true, chestPockets: true, hipPockets: true, flaps: true, bands: true,
    belt: 'tool', straps: 'harness', kneePads: true, cargo: true, pantsBag: 0.012, bootHeight: 0.27,
  }),
  sigilo: o({
    hem: 0.02, flare: 0, puff: 0, collar: 'stand', hood: true, zipper: true, belt: 'utility', straps: 'diag', trim: true,
    glow: true, kneePads: true, pantsBag: 0, glove: 'full', bootHeight: 0.28,
  }),
  desierto: o({
    hem: 0.0, puff: 0.006, sleeve: 'rolled', collar: 'stand', buttons: 'single', chestPockets: true, hipPockets: true,
    flaps: true, epaulettes: true, straps: 'diag', belt: 'web', cargo: true, pantsBag: 0.016, bootHeight: 0.24,
  }),
  artico: o({
    hem: -0.04, flare: 0.02, puff: 0.03, baffle: 0.085, collar: 'high', hood: true, zipper: true, hipPockets: true,
    trim: true, pantsBag: 0.022, glove: 'full', bootHeight: 0.3,
  }),
  carmesi: o({
    hem: -0.2, flare: 0.045, collar: 'mandarin', buttons: 'double', epaulettes: true, trim: true, belt: 'sash',
    glove: 'full', bootHeight: 0.42, skirt: true,
  }),
};

export const outfitSpec = (id: string): OutfitSpec => OUTFIT_SPECS[id] ?? OUTFIT_SPECS.militar!;
