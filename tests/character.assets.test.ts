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

// ── Modelos optimizados (tools/optimize-characters.mjs) ─────────────────────────────────────────
interface GltfJson {
  extensionsUsed?: string[];
  nodes: { name?: string; mesh?: number; skin?: number }[];
  skins?: { joints: number[] }[];
  materials: { name: string }[];
  images?: { mimeType?: string }[];
}

/** Lee sólo el chunk JSON de un GLB (no hace falta decodificar meshopt para inspeccionar la estructura). */
function readGlbJson(file: string): { json: GltfJson; bytes: number } {
  const buf = readFileSync(new URL(`../${file}`, import.meta.url));
  const jsonLen = buf.readUInt32LE(12);
  return { json: JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as GltfJson, bytes: buf.length };
}

const MB = 1024 * 1024;
const MODELS = [
  { g: 'Male', high: 'public/models/characters/LD_Character_Male.glb', low: 'public/models/characters/LD_Character_Male_low.glb', src: 'assets-src/characters/LD_Character_Male.glb' },
  { g: 'Female', high: 'public/models/characters/LD_Character_Female.glb', low: 'public/models/characters/LD_Character_Female_low.glb', src: 'assets-src/characters/LD_Character_Female.glb' },
];

describe('modelos GLB optimizados', () => {
  for (const m of MODELS) {
    it(`${m.g}: presupuesto de peso (alta ≤ 2.5 MB, baja ≤ 1.6 MB) y mucho menor que el original`, () => {
      const orig = readGlbJson(m.src).bytes;
      const high = readGlbJson(m.high).bytes;
      const low = readGlbJson(m.low).bytes;
      expect(high).toBeLessThan(2.5 * MB);
      expect(low).toBeLessThan(1.6 * MB);
      expect(low).toBeLessThan(high);
      expect(high).toBeLessThan(orig * 0.35);
    });

    it(`${m.g}: usa meshopt + WebP y conserva esqueleto, piezas y materiales del original`, () => {
      const orig = readGlbJson(m.src).json;
      for (const f of [m.high, m.low]) {
        const { json } = readGlbJson(f);
        expect(json.extensionsUsed).toEqual(expect.arrayContaining(['EXT_meshopt_compression', 'EXT_texture_webp']));
        // La cuantización genera un skin por malla (matrices inversas compensadas); todos con los 56 huesos.
        expect(json.skins!.length).toBeGreaterThanOrEqual(1);
        expect(json.skins!.every((sk) => sk.joints.length === 56)).toBe(true);
        expect((json.images ?? []).every((i) => i.mimeType === 'image/webp')).toBe(true);
        const pieces = (j: GltfJson) => j.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name).sort();
        expect(pieces(json)).toEqual(pieces(orig));
        expect(json.materials.map((x) => x.name).sort()).toEqual(orig.materials.map((x) => x.name).sort());
      }
    });
  }
});
