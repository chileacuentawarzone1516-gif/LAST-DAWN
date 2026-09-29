import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHARACTER } from '../src/config';
import type { Gender } from '../src/core/types';

/**
 * Los modelos GLB de personajes (public/models/characters) se entregan con sus tablas de datos
 * (tests/fixtures/ld_character_data.json). Este test garantiza que coinciden EXACTAMENTE con
 * CHARACTER (config.ts): si cambia uno de los dos lados, el otro debe regenerarse.
 */
interface Data {
  skinTones: { id: string; color: number }[];
  hairColors: { id: string; color: number }[];
  hairStyles: Record<Gender, { id: string }[]>;
  outfits: { id: string; jacket: number; pants: number; accent: number; glove: number }[];
  accessories: { id: string }[];
  presets: Record<Gender, { name: string; appearance: Record<string, number> }[]>;
  hatAccessories: string[];
  boots: Record<string, number>;
  bootsDefault: number;
  tintableRoles: string[];
}

const data = JSON.parse(readFileSync(new URL('./fixtures/ld_character_data.json', import.meta.url), 'utf8')) as Data;

describe('datos de los modelos GLB = CHARACTER (config.ts)', () => {
  it('pieles, colores de pelo y accesorios', () => {
    expect(data.skinTones.map((s) => [s.id, s.color])).toEqual(CHARACTER.skinTones.map((s) => [s.id, s.color]));
    expect(data.hairColors.map((s) => [s.id, s.color])).toEqual(CHARACTER.hairColors.map((s) => [s.id, s.color]));
    expect(data.accessories.map((a) => a.id)).toEqual(CHARACTER.accessories.map((a) => a.id));
  });
  it('estilos de pelo por género', () => {
    for (const g of ['male', 'female'] as const) {
      expect(data.hairStyles[g].map((h) => h.id)).toEqual(CHARACTER.hairStyles[g].map((h) => h.id));
    }
  });
  it('conjuntos de ropa (ids y 4 colores)', () => {
    expect(data.outfits.map((o) => [o.id, o.jacket, o.pants, o.accent, o.glove])).toEqual(
      CHARACTER.outfits.map((o) => [o.id, o.jacket, o.pants, o.accent, o.glove]),
    );
  });
  it('presets (nombre y apariencia) por género', () => {
    for (const g of ['male', 'female'] as const) {
      expect(data.presets[g].map((p) => [p.name, p.appearance])).toEqual(CHARACTER.presets[g].map((p) => [p.name, { ...p.appearance }]));
    }
  });
  it('reglas de botas, sombreros y roles tintables', () => {
    expect(data.hatAccessories).toEqual(['cap', 'beanie']);
    expect(Object.keys(data.boots).every((id) => CHARACTER.outfits.some((o) => o.id === id))).toBe(true);
    expect(data.tintableRoles).toEqual(['Skin', 'Hair', 'Jacket', 'JacketShade', 'Pants', 'Accent', 'Glove', 'Boots']);
  });
});
