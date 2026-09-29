import { describe, expect, it } from 'vitest';
import { CHARACTER } from '../src/config';
import { defaultProfile, resolveLook } from '../src/rules/character';
import {
  ACCESSORY_IDS, CONFIG_ACCESSORY_IDS, CONFIG_HAIR_IDS, HAIR_STYLE_IDS, hexColor, portraitSpec, shadeColor,
} from '../src/ui/portrait';

describe('colores', () => {
  it('hexColor formatea 0xrrggbb con ceros a la izquierda', () => {
    expect(hexColor(0x15110f)).toBe('#15110f');
    expect(hexColor(0x0000ff)).toBe('#0000ff');
    expect(hexColor(0)).toBe('#000000');
  });
  it('shadeColor oscurece, aclara y acota', () => {
    expect(shadeColor(0x808080, -1)).toBe('#000000');
    expect(shadeColor(0x808080, 1)).toBe('#ffffff');
    expect(shadeColor(0x808080, 0)).toBe('#808080');
    expect(shadeColor(0x808080, 9)).toBe('#ffffff');
    const d = parseInt(shadeColor(0xc08a5c, -0.3).slice(1), 16);
    expect((d >> 16) & 255).toBeLessThan(0xc0);
  });
});

describe('cobertura de dibujo', () => {
  it('hay dibujo para todos los estilos de pelo y accesorios de la config', () => {
    for (const id of CONFIG_HAIR_IDS()) expect(HAIR_STYLE_IDS).toContain(id);
    for (const id of CONFIG_ACCESSORY_IDS()) expect(ACCESSORY_IDS).toContain(id);
  });
});

describe('portraitSpec', () => {
  it('toma piel, pelo y ropa de la apariencia resuelta', () => {
    const p = defaultProfile('male');
    const spec = portraitSpec(resolveLook(p));
    const look = resolveLook(p);
    expect(spec.skin).toBe(hexColor(look.skin));
    expect(spec.hair).toBe(hexColor(look.hair));
    expect(spec.jacket).toBe(hexColor(look.jacket));
    expect(spec.hairStyle).toBe(look.hairStyle);
    expect(spec.accessory).toBe(look.accessory);
  });
  it('masculino y femenino tienen rasgos distintos', () => {
    const m = portraitSpec(resolveLook(defaultProfile('male')));
    const f = portraitSpec(resolveLook(defaultProfile('female')));
    expect(m.gender).toBe('male');
    expect(f.gender).toBe('female');
    expect(m.headHalfW).toBeGreaterThan(f.headHalfW);
    expect(m.chinHalfW).toBeGreaterThan(f.chinHalfW);
    expect(m.brow).toBeGreaterThan(f.brow);
    expect(m.lashes).toBe(false);
    expect(f.lashes).toBe(true);
  });
  it('cada tono de piel y color de pelo produce colores válidos y sombras más oscuras', () => {
    for (let s = 0; s < CHARACTER.skinTones.length; s++) {
      const look = resolveLook({ name: 'x', gender: 'female', appearance: { skin: s, hairStyle: 0, hairColor: s % CHARACTER.hairColors.length, outfit: 0, accessory: 0 } });
      const spec = portraitSpec(look);
      for (const c of [spec.skin, spec.skinShade, spec.skinLight, spec.hair, spec.hairShade, spec.hairLight, spec.jacket, spec.accent]) {
        expect(c).toMatch(/^#[0-9a-f]{6}$/);
      }
      const lum = (h: string): number => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
      expect(lum(spec.skinShade)).toBeLessThan(lum(spec.skin));
      expect(lum(spec.skinLight)).toBeGreaterThanOrEqual(lum(spec.skin));
    }
  });
  it('todas las combinaciones de género y apariencia resuelven sin lanzar', () => {
    for (const g of ['male', 'female'] as const) {
      for (let h = 0; h < CHARACTER.hairStyles[g].length; h++) {
        for (let a = 0; a < CHARACTER.accessories.length; a++) {
          const spec = portraitSpec(resolveLook({ name: 'x', gender: g, appearance: { skin: 0, hairStyle: h, hairColor: 0, outfit: 0, accessory: a } }));
          expect(HAIR_STYLE_IDS).toContain(spec.hairStyle);
          expect(ACCESSORY_IDS).toContain(spec.accessory);
        }
      }
    }
  });
});
