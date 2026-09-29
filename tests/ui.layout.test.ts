import { describe, expect, it } from 'vitest';
import { HUD } from '../src/config';
import { anchorFromBox, anchorsEqual, fallbackAnchor, isWideLayout } from '../src/ui/layout';

const vp = { width: 1280, height: 720 };

describe('isWideLayout / fallbackAnchor', () => {
  it('escritorio y móvil apaisado usan dos columnas; vertical y muy estrecho no', () => {
    expect(isWideLayout({ width: 1280, height: 720 })).toBe(true);
    expect(isWideLayout({ width: 844, height: 390 })).toBe(true);
    expect(isWideLayout({ width: 390, height: 844 })).toBe(false);
    expect(isWideLayout({ width: 600, height: 300 })).toBe(false);
    expect(isWideLayout({ width: 800, height: 800 })).toBe(false);
  });
  it('el respaldo apaisado apunta al área derecha y el vertical arriba', () => {
    const w = fallbackAnchor(vp);
    expect(w.x).toBeGreaterThan(0.6);
    expect(w.height).toBeGreaterThan(0.6);
    const p = fallbackAnchor({ width: 390, height: 844 });
    expect(p.x).toBe(0.5);
    expect(p.y).toBeLessThan(0.4);
  });
});

describe('anchorFromBox', () => {
  it('centra el modelo en el rectángulo dado (fracciones de pantalla)', () => {
    const a = anchorFromBox({ left: 640, top: 0, width: 640, height: 720 }, vp);
    expect(a.x).toBeCloseTo(0.75, 6);
    expect(a.y).toBeCloseTo(0.5, 6);
    expect(a.height).toBeCloseTo(HUD.preview.fill, 6);
  });
  it('limita la altura por la anchura de un área estrecha', () => {
    const a = anchorFromBox({ left: 1000, top: 0, width: 140, height: 720 }, vp);
    expect(a.height * vp.height).toBeCloseTo(140 / HUD.preview.modelAspect, 6);
  });
  it('acota x, y y altura a rangos válidos', () => {
    const a = anchorFromBox({ left: 1200, top: 600, width: 400, height: 400 }, vp);
    expect(a.x).toBeLessThanOrEqual(1);
    expect(a.y).toBeLessThanOrEqual(1);
    expect(a.height).toBeGreaterThanOrEqual(0.15);
    expect(a.height).toBeLessThanOrEqual(0.95);
  });
  it('áreas degeneradas o viewport nulo devuelven el respaldo', () => {
    expect(anchorFromBox({ left: 0, top: 0, width: 0, height: 0 }, vp)).toEqual(fallbackAnchor(vp));
    expect(anchorFromBox({ left: 0, top: 0, width: 500, height: 500 }, { width: 0, height: 0 })).toEqual(fallbackAnchor({ width: 0, height: 0 }));
  });
  it('funciona en móvil apaisado (844×390) con el modelo a la derecha', () => {
    const m = { width: 844, height: 390 };
    const a = anchorFromBox({ left: 460, top: 0, width: 384, height: 300 }, m);
    expect(a.x).toBeGreaterThan(0.6);
    expect(a.height).toBeGreaterThan(0.5);
    expect(a.height).toBeLessThan(0.95);
  });
});

describe('anchorsEqual', () => {
  it('tolera diferencias mínimas', () => {
    expect(anchorsEqual({ x: 0.5, y: 0.5, height: 0.8 }, { x: 0.501, y: 0.5, height: 0.8 })).toBe(true);
    expect(anchorsEqual({ x: 0.5, y: 0.5, height: 0.8 }, { x: 0.6, y: 0.5, height: 0.8 })).toBe(false);
  });
});
