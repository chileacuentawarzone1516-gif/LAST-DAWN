import { describe, expect, it } from 'vitest';
import { createAdaptiveScale } from '../src/engine/adaptive';
import { lightAxes, snapToTexel, texelSize } from '../src/engine/shadowSnap';
import type { V3 } from '../src/engine/shadowSnap';
import {
  contaminationIntensity, createScreenFxState, heartbeat, lowHpIntensity,
} from '../src/engine/screenFx';

const CFG = { enabled: true, lowFps: 52, highFps: 58, windowS: 2, minScale: 0.6, step: 0.1 };

function run(ctl: ReturnType<typeof createAdaptiveScale>, fps: number, seconds: number): number {
  let changes = 0;
  for (let t = 0; t < seconds * fps; t++) if (ctl.push(1 / fps)) changes++;
  return changes;
}

describe('escala dinámica de resolución', () => {
  it('baja la escala con FPS bajos y respeta el mínimo', () => {
    const c = createAdaptiveScale(CFG);
    run(c, 30, 40);
    expect(c.scale).toBeCloseTo(0.6, 5);
  });
  it('no cambia con FPS estables', () => {
    const c = createAdaptiveScale(CFG);
    expect(run(c, 60, 20)).toBe(0);
    expect(c.scale).toBe(1);
  });
  it('sube de nuevo tras varias ventanas buenas', () => {
    const c = createAdaptiveScale(CFG);
    run(c, 30, 6);
    const low = c.scale;
    expect(low).toBeLessThan(1);
    run(c, 60, 60);
    expect(c.scale).toBeGreaterThan(low);
  });
  it('ignora tirones y respeta enabled=false', () => {
    const c = createAdaptiveScale(CFG);
    for (let i = 0; i < 100; i++) c.push(1);
    expect(c.scale).toBe(1);
    c.enabled = false;
    run(c, 10, 30);
    expect(c.scale).toBe(1);
  });
});

describe('cuantización de la sombra', () => {
  const toLight: V3 = { x: -0.44, y: 0.62, z: -0.65 };
  const len = Math.hypot(toLight.x, toLight.y, toLight.z);
  toLight.x /= len; toLight.y /= len; toLight.z /= len;
  const right: V3 = { x: 0, y: 0, z: 0 };
  const up: V3 = { x: 0, y: 0, z: 0 };
  lightAxes(toLight, right, up);
  const out: V3 = { x: 0, y: 0, z: 0 };

  it('los ejes son ortonormales y perpendiculares a la luz', () => {
    const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
    expect(dot(right, right)).toBeCloseTo(1, 6);
    expect(dot(up, up)).toBeCloseTo(1, 6);
    expect(dot(right, up)).toBeCloseTo(0, 6);
    expect(dot(right, toLight)).toBeCloseTo(0, 6);
    expect(dot(up, toLight)).toBeCloseTo(0, 6);
  });

  it('el centro queda en múltiplos de texel y se desplaza menos de medio texel', () => {
    const texel = texelSize(38, 2048);
    for (let i = 0; i < 50; i++) {
      const px = -100 + i * 3.71;
      const pz = 55 - i * 1.93;
      snapToTexel(px, 0, pz, right, up, texel, out);
      const u = out.x * right.x + out.y * right.y + out.z * right.z;
      const v = out.x * up.x + out.y * up.y + out.z * up.z;
      expect(Math.abs(u / texel - Math.round(u / texel))).toBeLessThan(1e-3);
      expect(Math.abs(v / texel - Math.round(v / texel))).toBeLessThan(1e-3);
      expect(Math.hypot(out.x - px, out.y, out.z - pz)).toBeLessThan(texel * 1.5);
    }
  });

  it('movimientos sub-texel no cambian el resultado (sin parpadeo)', () => {
    const texel = texelSize(38, 2048);
    snapToTexel(10, 0, 10, right, up, texel, out);
    const a = { ...out };
    snapToTexel(10 + texel * 0.05, 0, 10, right, up, texel, out);
    expect(out.x).toBeCloseTo(a.x, 6);
    expect(out.z).toBeCloseTo(a.z, 6);
  });
});

describe('efectos de pantalla', () => {
  const base = { hp: 100, maxHp: 100, alive: true, contaminationActive: false, contaminationRadius: 0, contaminationDist: 500 };

  it('vida baja: 0 con vida sana, crece al bajar', () => {
    expect(lowHpIntensity(100, 100)).toBe(0);
    expect(lowHpIntensity(20, 100)).toBeGreaterThan(lowHpIntensity(35, 100));
    expect(lowHpIntensity(0, 100)).toBe(1);
  });
  it('contaminación: sólo dentro del radio y sólo si está activa', () => {
    expect(contaminationIntensity(false, 100, 10)).toBe(0);
    expect(contaminationIntensity(true, 100, 150)).toBe(0);
    expect(contaminationIntensity(true, 100, 10)).toBe(1);
    expect(contaminationIntensity(true, 100, 95)).toBeGreaterThan(0);
  });
  it('el latido está en [0,1]', () => {
    for (let i = 0; i < 100; i++) {
      const h = heartbeat(i / 37);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
  });
  it('daño: pulso que decae; la contaminación no dispara pulso', () => {
    const s = createScreenFxState();
    s.onDamaged(0, 0, true);
    expect(s.hurt).toBe(0);
    s.onDamaged(30, 0, false);
    expect(s.hurt).toBeGreaterThan(0.3);
    const h0 = s.hurt;
    s.update(0.5, base);
    expect(s.hurt).toBeLessThan(h0);
  });
  it('muerte: se funde y reset() limpia', () => {
    const s = createScreenFxState();
    s.onDied();
    for (let i = 0; i < 300; i++) s.update(1 / 30, { ...base, alive: false });
    expect(s.death).toBeGreaterThan(0.9);
    expect(s.desat).toBeGreaterThan(0.8);
    s.reset();
    s.update(0.1, base);
    expect(s.death).toBe(0);
  });
  it('tinte tóxico sube dentro y baja al salir', () => {
    const s = createScreenFxState();
    const inside = { ...base, contaminationActive: true, contaminationRadius: 100, contaminationDist: 40 };
    for (let i = 0; i < 90; i++) s.update(1 / 30, inside);
    expect(s.toxic).toBeGreaterThan(0.8);
    for (let i = 0; i < 300; i++) s.update(1 / 30, base);
    expect(s.toxic).toBe(0);
  });
});
