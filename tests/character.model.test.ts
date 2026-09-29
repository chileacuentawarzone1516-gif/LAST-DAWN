import { describe, expect, it } from 'vitest';
import { anchorToPlacement, buildCharacterModel } from '../src/character';
import type { CharacterModel } from '../src/character';
import { CHARACTER } from '../src/config';
import type { Appearance, Gender } from '../src/core/types';
import { defaultProfile, resolveLook } from '../src/rules/character';

const FOV = 58;
const project = (fov: number, aspect: number, p: { x: number; y: number; z: number }): { x: number; y: number } => {
  const halfH = -p.z * Math.tan((fov * Math.PI) / 360);
  return { x: (p.x / (halfH * aspect) + 1) / 2, y: (1 - p.y / halfH) / 2 };
};

describe('anchorToPlacement', () => {
  it('centra el modelo en el ancla y ocupa la altura pedida para varios aspectos', () => {
    for (const aspect of [0.5, 1, 16 / 9, 2.4]) {
      for (const a of [{ x: 0.5, y: 0.5, height: 0.8 }, { x: 0.72, y: 0.4, height: 0.6 }, { x: 0.2, y: 0.65, height: 1 }]) {
        const p = anchorToPlacement(FOV, aspect, a, 1.78);
        const c = project(FOV, aspect, { x: p.x, y: p.y + (p.scale * 1.78) / 2, z: p.z });
        expect(c.x).toBeCloseTo(a.x, 6);
        expect(c.y).toBeCloseTo(a.y, 6);
        const top = project(FOV, aspect, { x: p.x, y: p.y + p.scale * 1.78, z: p.z });
        const bottom = project(FOV, aspect, { x: p.x, y: p.y, z: p.z });
        expect(bottom.y - top.y).toBeCloseTo(a.height, 6);
        expect(p.z).toBeLessThan(0);
      }
    }
  });
  it('es monótona: más altura = más escala; más a la derecha = mayor x; más abajo = menor y', () => {
    const s = (h: number) => anchorToPlacement(FOV, 1.6, { x: 0.5, y: 0.5, height: h }, 1.7).scale;
    expect(s(0.4)).toBeLessThan(s(0.8));
    const px = (x: number) => anchorToPlacement(FOV, 1.6, { x, y: 0.5, height: 0.5 }, 1.7).x;
    expect(px(0.3)).toBeLessThan(px(0.7));
    const py = (y: number) => anchorToPlacement(FOV, 1.6, { x: 0.5, y, height: 0.5 }, 1.7).y;
    expect(py(0.7)).toBeLessThan(py(0.3));
  });
  it('el aspecto sólo afecta al desplazamiento horizontal', () => {
    const a = anchorToPlacement(FOV, 1, { x: 0.8, y: 0.5, height: 0.7 }, 1.7);
    const b = anchorToPlacement(FOV, 2, { x: 0.8, y: 0.5, height: 0.7 }, 1.7);
    expect(b.scale).toBeCloseTo(a.scale, 9);
    expect(b.x).toBeCloseTo(a.x * 2, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
  });
});

const app = (g: Gender, o: Partial<Appearance>) => ({ ...defaultProfile(g), appearance: { ...defaultProfile(g).appearance, ...o } });
const geoDisposed = (m: CharacterModel): boolean[] => m.meshes.map(() => false);

describe('buildCharacterModel', () => {
  it('construye todas las combinaciones sin errores y dentro de presupuesto', () => {
    for (const g of ['male', 'female'] as const) {
      for (let h = 0; h < CHARACTER.hairStyles[g].length; h++) {
        for (let ac = 0; ac < CHARACTER.accessories.length; ac++) {
          for (let o = 0; o < CHARACTER.outfits.length; o++) {
            const m = buildCharacterModel(resolveLook(app(g, { hairStyle: h, accessory: ac, outfit: o, skin: (h + o) % 6, hairColor: (ac + o) % 8 })));
            expect(m.stats.meshes).toBeLessThanOrEqual(14);
            expect(m.stats.triangles).toBeLessThanOrEqual(25000);
            expect(m.stats.triangles).toBeGreaterThan(3000);
            for (const mesh of m.meshes) {
              const pos = mesh.geometry.getAttribute('position').array;
              expect(pos.every(Number.isFinite)).toBe(true);
            }
            m.dispose();
          }
        }
      }
    }
  }, 20_000); // 576 modelos: ~4,4 s aislado; con la suite en paralelo puede superar el límite por defecto (5 s)
  it('las dimensiones cambian por género', () => {
    const m = buildCharacterModel(resolveLook(app('male', { hairStyle: 0, accessory: 0 })));
    const f = buildCharacterModel(resolveLook(app('female', { hairStyle: 0, accessory: 0 })));
    expect(m.height).toBeGreaterThan(1.74);
    expect(m.height).toBeLessThan(1.84);
    expect(f.height).toBeGreaterThan(1.64);
    expect(f.height).toBeLessThan(1.74);
    expect(m.height - f.height).toBeGreaterThan(0.05);
    expect(m.body.shoulderX).toBeGreaterThan(f.body.shoulderX + 0.03);
    expect(m.bounds.max.x - m.bounds.min.x).toBeGreaterThan(f.bounds.max.x - f.bounds.min.x);
    m.dispose();
    f.dispose();
  });
  it('el color de piel, pelo y ropa aparece en los materiales', () => {
    const look = resolveLook(app('female', { skin: 3, hairColor: 4, outfit: 3, hairStyle: 1, accessory: 0 }));
    const m = buildCharacterModel(look);
    const hexes = m.materials.map((x) => x.color.getHex());
    for (const c of [look.skin, look.hair, look.jacket, look.pants, look.accent, look.glove]) expect(hexes).toContain(c);
    m.dispose();
  });
  it('las gafas añaden una lente emisiva', () => {
    const on = buildCharacterModel(resolveLook(app('male', { accessory: 3 })));
    const off = buildCharacterModel(resolveLook(app('male', { accessory: 0 })));
    expect(on.materials.some((x) => x.emissive.getHex() === 0x5fe3ff)).toBe(true);
    expect(off.materials.some((x) => x.emissive.getHex() === 0x5fe3ff)).toBe(false);
    on.dispose();
    off.dispose();
  });
  it('las poses y la animación no producen NaN', () => {
    const m = buildCharacterModel(resolveLook(defaultProfile('male')));
    for (const p of ['salute', 'ready', 'idle'] as const) {
      m.setPose(p);
      for (let i = 0; i < 120; i++) m.update(1 / 60);
    }
    m.root.updateMatrixWorld(true);
    m.root.traverse((o) => {
      expect(Number.isFinite(o.matrixWorld.elements[13]!)).toBe(true);
    });
    m.dispose();
  });
  it('dispose libera geometrías y materiales', () => {
    const m = buildCharacterModel(resolveLook(defaultProfile('female')));
    const done = geoDisposed(m);
    let mats = 0;
    m.meshes.forEach((mesh, i) => mesh.geometry.addEventListener('dispose', () => { done[i] = true; }));
    m.materials.forEach((x) => x.addEventListener('dispose', () => { mats++; }));
    m.dispose();
    expect(done.every(Boolean)).toBe(true);
    expect(mats).toBe(m.materials.length);
  });
});
