import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BOOTS_BY_OUTFIT, BOOTS_DEFAULT, HAT_ACCESSORIES, TINT_ROLES, bootsColor, glbUrl, isPieceVisible, isTintRole, materialRole,
  parsePieceName, resolveTints, shadeHex,
} from '../src/character/glbRules';
import { CHARACTER } from '../src/config';
import type { Gender } from '../src/core/types';
import { shadeColor } from '../src/ui/portrait';
import { resolveLook } from '../src/rules/character';

interface Fixture { boots: Record<string, number>; bootsDefault: number; hatAccessories: string[]; tintableRoles: string[] }
const fixture = JSON.parse(readFileSync(new URL('./fixtures/ld_character_data.json', import.meta.url), 'utf8')) as Fixture;

interface Gltf {
  nodes: { name: string; mesh?: number; skin?: number }[];
  meshes: { name: string; primitives: { material: number }[] }[];
  materials: { name: string }[];
  skins: { joints: number[] }[];
  images: { name: string }[];
}
function readGlb(file: string): Gltf {
  const b = readFileSync(new URL(`../public/models/characters/${file}`, import.meta.url));
  expect(b.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  const jsonLen = b.readUInt32LE(12);
  expect(b.readUInt32LE(16)).toBe(0x4e4f534a); // 'JSON'
  return JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8')) as Gltf;
}

const looks = (g: Gender) => {
  const out: ReturnType<typeof resolveLook>[] = [];
  for (let h = 0; h < CHARACTER.hairStyles[g].length; h++)
    for (let o = 0; o < CHARACTER.outfits.length; o++)
      for (let a = 0; a < CHARACTER.accessories.length; a++)
        out.push(resolveLook({ name: 'X', gender: g, appearance: { skin: (h + o) % 6, hairStyle: h, hairColor: (a + o) % 8, outfit: o, accessory: a } }));
  return out;
};

describe('parsePieceName / materialRole', () => {
  it('interpreta piezas, partes y sufijos numéricos', () => {
    expect(parsePieceName('LD_M_Hair_corto_Top')).toEqual({ gender: 'M', slot: 'Hair', item: 'corto', part: 'top' });
    expect(parsePieceName('LD_F_Hair_coleta_Tie_2')).toEqual({ gender: 'F', slot: 'Hair', item: 'coleta', part: 'tie' });
    expect(parsePieceName('LD_M_Outfit_Base_Boots_1')).toMatchObject({ slot: 'Outfit', item: 'Base' });
    expect(parsePieceName('LD_M_Acc_cap_3')).toEqual({ gender: 'M', slot: 'Acc', item: 'cap', part: 'main' });
    expect(parsePieceName('LD_M_EyeL')).toMatchObject({ slot: 'EyeL', item: '' });
    expect(parsePieceName('Hips')).toBeNull();
  });
  it('roles de material', () => {
    expect(materialRole('LD_M_Skin')).toBe('Skin');
    expect(materialRole('LD_F_JacketShade')).toBe('JacketShade');
    expect(materialRole('Skin')).toBe('');
    expect(isTintRole('Boots')).toBe(true);
    expect(isTintRole('Sclera')).toBe(false);
  });
});

describe('visibilidad por apariencia (2 × 6 × 6 × 8)', () => {
  const outfits = CHARACTER.outfits.map((o) => o.id);
  const pieces = (g: Gender) => {
    const G = g === 'male' ? 'M' : 'F';
    const names = ['Body', 'Brows', 'EyeL', 'EyeR', ...CHARACTER.accessories.filter((a) => a.id !== 'none').map((a) => `Acc_${a.id}`),
      ...outfits.map((o) => `Outfit_${o}`), ...['Boots', 'Gloves', 'Jacket', 'Pants'].map((b) => `Outfit_Base_${b}`)];
    for (const h of CHARACTER.hairStyles[g]) names.push(`Hair_${h.id}`);
    // Partes extra por género (según los GLB): _Top en el masculino, _Tie en el femenino.
    const extra = g === 'male' ? ['corto', 'mohicano', 'rizado'].map((h) => `Hair_${h}_Top`) : ['coleta', 'mono', 'trenzas'].map((h) => `Hair_${h}_Tie`);
    return [...names, ...extra].map((n) => `LD_${G}_${n}`);
  };
  it('exactamente un peinado, un conjunto y (salvo none) un accesorio', () => {
    for (const g of ['male', 'female'] as const) {
      for (const look of looks(g)) {
        const vis = pieces(g).map((n) => parsePieceName(n)!).filter((p) => isPieceVisible(p, look));
        const hairMain = vis.filter((p) => p.slot === 'Hair' && p.part === 'main');
        expect(hairMain).toHaveLength(1);
        expect(hairMain[0]!.item).toBe(look.hairStyle);
        const outfit = vis.filter((p) => p.slot === 'Outfit' && p.item !== 'Base');
        expect(outfit.map((p) => p.item)).toEqual([look.outfit]);
        expect(vis.filter((p) => p.slot === 'Outfit' && p.item === 'Base')).toHaveLength(4);
        const acc = vis.filter((p) => p.slot === 'Acc');
        expect(acc.map((p) => p.item)).toEqual(look.accessory === 'none' ? [] : [look.accessory]);
        for (const s of ['Body', 'Brows', 'EyeL', 'EyeR']) expect(vis.some((p) => p.slot === s)).toBe(true);
      }
    }
  });
  it('la parte _Top del pelo se oculta con gorra o gorro y sólo entonces', () => {
    for (const look of looks('male')) {
      const top = parsePieceName(`LD_M_Hair_${look.hairStyle}_Top`)!;
      expect(isPieceVisible(top, look)).toBe(!HAT_ACCESSORIES.includes(look.accessory));
      // La parte principal del peinado nunca se oculta por el sombrero.
      expect(isPieceVisible(parsePieceName(`LD_M_Hair_${look.hairStyle}`)!, look)).toBe(true);
    }
  });
  it('el _Tie del pelo femenino se ve siempre con su peinado', () => {
    for (const look of looks('female')) {
      const tie = parsePieceName(`LD_F_Hair_${look.hairStyle}_Tie`)!;
      expect(isPieceVisible(tie, look)).toBe(true);
    }
  });
});

describe('colores resueltos', () => {
  it('coinciden con las tablas de CHARACTER', () => {
    for (const g of ['male', 'female'] as const) {
      for (const look of looks(g)) {
        const t = resolveTints(look);
        expect(t.Skin).toBe(look.skin);
        expect(t.Hair).toBe(look.hair);
        expect(t.Jacket).toBe(look.jacket);
        expect(t.Pants).toBe(look.pants);
        expect(t.Accent).toBe(look.accent);
        expect(t.Glove).toBe(look.glove);
        expect(Object.keys(t)).toEqual([...TINT_ROLES]);
      }
    }
  });
  it('JacketShade es más oscuro que la chaqueta y usa la misma fórmula que el retrato', () => {
    for (const o of CHARACTER.outfits) {
      const sh = shadeHex(o.jacket, -0.3);
      const lum = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
      expect(lum(sh)).toBeLessThan(lum(o.jacket));
      expect(`#${sh.toString(16).padStart(6, '0')}`).toBe(shadeColor(o.jacket, -0.3));
    }
    expect(shadeHex(0xffffff, 0.5)).toBe(0xffffff);
    expect(shadeHex(0x000000, -1)).toBe(0);
  });
  it('botas por conjunto = fixture', () => {
    expect(BOOTS_BY_OUTFIT).toEqual(fixture.boots);
    expect(BOOTS_DEFAULT).toBe(fixture.bootsDefault);
    expect([...HAT_ACCESSORIES]).toEqual(fixture.hatAccessories);
    expect([...TINT_ROLES]).toEqual(fixture.tintableRoles);
    for (const o of CHARACTER.outfits) expect(bootsColor(o.id)).toBe(fixture.boots[o.id] ?? fixture.bootsDefault);
    expect(bootsColor('desierto')).not.toBe(bootsColor('militar'));
  });
  it('glbUrl respeta la base', () => {
    expect(glbUrl('/', 'models/a.glb')).toBe('/models/a.glb');
    expect(glbUrl('/game', 'models/a.glb')).toBe('/game/models/a.glb');
    expect(glbUrl('./', 'models/a.glb')).toBe('./models/a.glb');
  });
});

describe('integridad de los GLB (sin WebGL)', () => {
  for (const [g, file] of [['male', 'LD_Character_Male.glb'], ['female', 'LD_Character_Female.glb']] as const) {
    it(`${file}: piezas, roles, esqueleto y coherencia con CHARACTER`, () => {
      const j = readGlb(file);
      const G = g === 'male' ? 'M' : 'F';
      expect(j.meshes).toHaveLength(30);
      expect(j.skins).toHaveLength(1);
      expect(j.skins[0]!.joints).toHaveLength(56);
      const boneNames = new Set(j.skins[0]!.joints.map((i) => j.nodes[i]!.name));
      for (const b of ['Root', 'Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head', 'LeftUpperArm', 'RightUpperArm', 'LeftLowerArm', 'RightLowerArm',
        'LeftHand', 'RightHand', 'LeftUpperLeg', 'RightUpperLeg', 'LeftLowerLeg', 'RightLowerLeg', 'LeftFoot', 'RightFoot', 'LeftEye', 'RightEye', 'Jaw']) {
        expect(boneNames.has(b)).toBe(true);
      }
      // Materiales LD_<G>_<Rol> con todos los roles tintables presentes.
      const roles = j.materials.map((m) => materialRole(m.name));
      expect(roles.every((r) => r !== '')).toBe(true);
      for (const r of TINT_ROLES) expect(roles).toContain(r);
      for (const r of ['Gear', 'Lens', 'Sole', 'Metal', 'Pupil', 'Iris', 'Sclera', 'Fur']) expect(roles).toContain(r);
      // Piezas: nombres LD_<G>_… con la nomenclatura de three (sin puntos).
      const pieces = j.meshes.map((m) => m.name.replace(/\./g, ''));
      expect(pieces.every((n) => n.startsWith(`LD_${G}_`))).toBe(true);
      const parsed = pieces.map((n) => parsePieceName(n)!);
      expect(parsed.every((p) => p !== null)).toBe(true);
      // Un conjunto por id de CHARACTER + 4 prendas base; un accesorio por id (salvo none); un peinado por id.
      for (const o of CHARACTER.outfits) expect(parsed.some((p) => p.slot === 'Outfit' && p.item === o.id)).toBe(true);
      expect(parsed.filter((p) => p.slot === 'Outfit' && p.item === 'Base')).toHaveLength(4);
      for (const a of CHARACTER.accessories) if (a.id !== 'none') expect(parsed.some((p) => p.slot === 'Acc' && p.item === a.id)).toBe(true);
      for (const h of CHARACTER.hairStyles[g]) expect(parsed.some((p) => p.slot === 'Hair' && p.item === h.id && p.part === 'main')).toBe(true);
      expect(parsed.some((p) => p.slot === 'Body')).toBe(true);
      expect(j.images.map((i) => i.name)).toEqual([`LD_${G}_Skin_Normal`, `LD_${G}_Skin_Detail`]);
    });
  }
});
