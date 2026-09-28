import { describe, expect, it } from 'vitest';
import { RENDER } from '../src/config';
import type { QualityLevel } from '../src/config';
import { createAdaptiveScale } from '../src/engine/adaptive';
import { clampToDevice, resolvePreset } from '../src/engine/preset';

const LEVELS: QualityLevel[] = ['low', 'medium', 'high'];

describe('perfil móvil', () => {
  it('en escritorio el preset no cambia', () => {
    for (const q of LEVELS) expect(resolvePreset(q, false)).toEqual(RENDER.presets[q]);
  });

  it('en táctiles limita resolución y anisotropía incluso en high', () => {
    for (const q of LEVELS) {
      const p = resolvePreset(q, true);
      expect(p.pixelRatioMax).toBeLessThanOrEqual(1.5);
      expect(p.anisotropy).toBeLessThanOrEqual(2);
    }
  });

  it('sin MSAA en low/medium y sin sombras ni bloom en low', () => {
    expect(resolvePreset('low', true).msaa).toBe(0);
    expect(resolvePreset('medium', true).msaa).toBe(0);
    const low = resolvePreset('low', true);
    expect(low.shadows).toBe(false);
    expect(low.bloom).toBe(false);
    expect(low.lowTextures).toBe(true);
  });

  it('reduce distancia de dibujo, partículas y decals respecto a escritorio', () => {
    for (const q of LEVELS) {
      const m = resolvePreset(q, true);
      const d = RENDER.presets[q];
      expect(m.viewDistance).toBeLessThan(d.viewDistance);
      expect(m.particles).toBeLessThan(d.particles);
      expect(m.decals).toBeLessThan(d.decals);
    }
  });

  it('clampToDevice desactiva MSAA sin HDR y recorta el shadow map', () => {
    const p = clampToDevice(RENDER.presets.high, { maxTextureSize: 1024, hdr: false, msaaHdr: false });
    expect(p.msaa).toBe(0);
    expect(p.shadowMapSize).toBe(1024);
    expect(clampToDevice(RENDER.presets.high, { maxTextureSize: 8192, hdr: true, msaaHdr: false }).msaa).toBe(0);
    expect(clampToDevice(RENDER.presets.high, { maxTextureSize: 8192, hdr: true, msaaHdr: true }).msaa).toBe(4);
  });
});

describe('escala dinámica móvil', () => {
  const cfg = { ...RENDER.mobile.adaptive };
  it('arranca en startScale y reset() vuelve a él (1 si está desactivada)', () => {
    const c = createAdaptiveScale(cfg);
    expect(c.scale).toBeCloseTo(0.85, 5);
    c.enabled = false;
    c.reset();
    expect(c.scale).toBe(1);
    expect(createAdaptiveScale({ ...cfg, enabled: false }).scale).toBe(1);
  });

  it('baja hasta minScale con FPS bajos y sube si sobran', () => {
    const c = createAdaptiveScale(cfg);
    for (let i = 0; i < 30 * 40; i++) c.push(1 / 30);
    expect(c.scale).toBeCloseTo(cfg.minScale, 5);
    for (let i = 0; i < 60 * 60; i++) c.push(1 / 60);
    expect(c.scale).toBeGreaterThan(cfg.minScale + 0.2);
  });
});
