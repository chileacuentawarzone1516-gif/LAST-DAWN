/** Utilidades de sombreros compartidas por el pelo y los accesorios (borde del gorro/gorra por ángulo). */
import type { ResolvedLook } from '../rules/character';
import type { HeadSpec } from './body';

export type HatKind = 'cap' | 'beanie';

export const hatOf = (look: ResolvedLook): HatKind | null => (look.accessory === 'cap' ? 'cap' : look.accessory === 'beanie' ? 'beanie' : null);

/** Fracción de altura de la cabeza (0 mentón … 1 coronilla) del borde del sombrero: frente, lados, nuca. */
const RIM: Record<HatKind, readonly [number, number, number]> = {
  cap: [0.735, 0.64, 0.6],
  beanie: [0.71, 0.6, 0.5],
};

/** Altura (m) del borde inferior del sombrero en el ángulo th (0 = frente). */
export function hatRim(h: HeadSpec, kind: HatKind): (th: number) => number {
  const [front, side, back] = RIM[kind];
  return (th) => {
    const c = Math.cos(th);
    const u = c >= 0 ? side + (front - side) * c ** 1.3 : side + (back - side) * (-c) ** 1.3;
    return h.chinY + u * h.H;
  };
}

/** Holgura de la cúpula del sombrero sobre la cabeza. */
export const HAT_THICK: Record<HatKind, number> = { cap: 0.026, beanie: 0.032 };
