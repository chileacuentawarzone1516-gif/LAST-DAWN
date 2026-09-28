import { describe, expect, it } from 'vitest';
import { createNoiseLayers, fillFbm, fillWorley, hash2 } from '../src/engine/noise';

describe('noise', () => {
  it('hash2 es determinista y está en [0,1)', () => {
    for (let i = 0; i < 200; i++) {
      const v = hash2(i, i * 7, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(hash2(i, i * 7, 3)).toBe(v);
    }
    expect(hash2(1, 2, 3)).not.toBe(hash2(2, 1, 3));
  });

  it('fillFbm normaliza a [0,1] y es periódico (costura sin salto)', () => {
    const n = 64;
    const a = fillFbm(new Float32Array(n * n), n, 4, 3, 5);
    expect(Math.min(...a)).toBeCloseTo(0, 5);
    expect(Math.max(...a)).toBeCloseTo(1, 5);
    let seam = 0;
    let inner = 0;
    for (let y = 0; y < n; y++) {
      seam += Math.abs((a[y * n + n - 1] as number) - (a[y * n] as number));
      inner += Math.abs((a[y * n + n / 2] as number) - (a[y * n + n / 2 - 1] as number));
    }
    expect(seam / n).toBeLessThan(0.15);
    expect(inner / n).toBeLessThan(0.15);
  });

  it('fillWorley: distancia acotada e id estable por celda', () => {
    const n = 64;
    const d = new Float32Array(n * n);
    const id = new Float32Array(n * n);
    fillWorley(d, id, n, 8, 1);
    expect(Math.max(...d)).toBeLessThanOrEqual(1);
    expect(Math.min(...d)).toBeGreaterThanOrEqual(0);
    expect(new Set(id).size).toBeGreaterThan(20);
  });

  it('createNoiseLayers genera todas las capas con el tamaño pedido', () => {
    const l = createNoiseLayers(32);
    for (const k of ['lo', 'mid', 'hi', 'ridge', 'white'] as const) expect(l[k]).toHaveLength(32 * 32);
  });
});
