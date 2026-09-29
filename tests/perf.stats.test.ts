import { describe, expect, it } from 'vitest';
import {
  classifyErrorSource, FrameRing, HITCH_MS, jsonSafe, percentileSorted, RAF_CADENCE_LABEL, rafCadence, summarizeFrames,
} from '../src/game/perfStats';

const scratch = (n: number): Float32Array => new Float32Array(n);
const series = (...parts: Array<[number, number]>): Float32Array => {
  const out: number[] = [];
  for (const [value, count] of parts) for (let i = 0; i < count; i++) out.push(value);
  return Float32Array.from(out);
};

describe('percentileSorted (rango más cercano)', () => {
  it('devuelve null sin datos', () => {
    expect(percentileSorted([], 50)).toBeNull();
  });
  it('p50/p95/p99/p100 sobre 1..100', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentileSorted(v, 50)).toBe(50);
    expect(percentileSorted(v, 95)).toBe(95);
    expect(percentileSorted(v, 99)).toBe(99);
    expect(percentileSorted(v, 100)).toBe(100);
    expect(percentileSorted(v, 0)).toBe(1);
  });
});

describe('summarizeFrames', () => {
  it('serie vacía: sin percentiles ni FPS', () => {
    const s = summarizeFrames([], 0, scratch(4));
    expect(s.frames).toBe(0);
    expect(s.fps).toBeNull();
    expect(s.p50).toBeNull();
    expect(s.over2TPct).toBeNull();
  });

  it('serie estable de ~16,7 ms: FPS ≈ 60, sin frames > 2T ni pausas', () => {
    const v = series([16.667, 120]);
    const s = summarizeFrames(v, v.length, scratch(v.length));
    expect(s.frames).toBe(120);
    expect(s.fps).toBeCloseTo(60, 1);
    expect(s.p50).toBeCloseTo(16.667, 2);
    expect(s.p99).toBeCloseTo(16.667, 2);
    expect(s.over2T).toBe(0);
    expect(s.hitches100).toBe(0);
    expect(s.stutterBursts).toBe(0);
  });

  it('cuenta frames > 2T (T = mediana), pausas > 100/250 ms y rachas de stutter', () => {
    // 100 frames de 16 ms, una racha de 2 frames de 40 ms, un frame aislado de 120 ms y otro de 300 ms.
    const v = Float32Array.from([...Array(50).fill(16), 40, 40, ...Array(50).fill(16), 120, 16, 300]);
    const s = summarizeFrames(v, v.length, scratch(v.length));
    expect(s.p50).toBe(16);
    expect(s.over2T).toBe(4); // 40, 40, 120, 300 (> 32 ms)
    expect(s.hitches100).toBe(2); // 120 y 300
    expect(s.hitches250).toBe(1); // 300
    expect(s.stutterBursts).toBe(1); // sólo la racha 40,40 (120 y 300 no son consecutivos)
    expect(s.max).toBe(300);
    expect(HITCH_MS).toEqual([100, 250]);
  });

  it('no altera el orden de la serie original (ordena en el buffer auxiliar)', () => {
    const v = Float32Array.from([30, 10, 20]);
    summarizeFrames(v, v.length, scratch(3));
    expect(Array.from(v)).toEqual([30, 10, 20]);
  });

  it('respeta `count` y la capacidad del buffer auxiliar', () => {
    const v = Float32Array.from([10, 10, 10, 999]);
    expect(summarizeFrames(v, 3, scratch(8)).max).toBe(10);
    expect(summarizeFrames(v, 4, scratch(2)).frames).toBe(2);
  });
});

describe('rafCadence (dato experimental, NO frecuencia física)', () => {
  it('siempre lleva la etiqueta «rAF observed cadence»', () => {
    expect(RAF_CADENCE_LABEL).toBe('rAF observed cadence');
    expect(rafCadence([], 0, scratch(1)).label).toBe(RAF_CADENCE_LABEL);
    expect(rafCadence([], 0, scratch(1)).hz).toBeNull();
  });
  it('cadencia estable de 8,333 ms → ~120 Hz observados en rAF, 100 % dentro de ±10 %', () => {
    const v = series([8.333, 200]);
    const c = rafCadence(v, v.length, scratch(v.length));
    expect(c.hz).toBeCloseTo(120, 0);
    expect(c.withinTenPct).toBe(1);
  });
  it('cadencia irregular: baja la proporción dentro de ±10 %', () => {
    const v = Float32Array.from([...Array(60).fill(16.7), ...Array(40).fill(33.3)]);
    const c = rafCadence(v, v.length, scratch(v.length));
    expect(c.medianMs).toBeCloseTo(16.7, 1);
    expect(c.withinTenPct).toBeCloseTo(0.6, 5);
  });
});

describe('FrameRing', () => {
  it('conserva el orden cronológico y sobrescribe lo más antiguo al llenarse', () => {
    const r = new FrameRing(3);
    r.push(1, 10);
    r.push(2, 20);
    r.push(3, 30);
    r.push(4, 40);
    expect(r.length).toBe(3);
    expect(r.total).toBe(4);
    expect(r.oldestAt()).toBe(20);
    expect(r.toArrays()).toEqual({ dtMs: [2, 3, 4], atMs: [20, 30, 40] });
  });
  it('copyRange filtra por instante de fin del intervalo', () => {
    const r = new FrameRing(10);
    for (let i = 1; i <= 5; i++) r.push(i, i * 100);
    const out = new Float32Array(10);
    const n = r.copyRange(200, 400, out);
    expect(Array.from(out.subarray(0, n))).toEqual([2, 3, 4]);
    expect(r.copyRange(-Infinity, Infinity, out)).toBe(5);
  });
  it('clear vacía el buffer', () => {
    const r = new FrameRing(2);
    r.push(1, 1);
    r.clear();
    expect(r.length).toBe(0);
    expect(r.oldestAt()).toBeNull();
  });
});

describe('classifyErrorSource', () => {
  const origin = 'http://localhost:4173';
  it('mismo origen = aplicación', () => {
    expect(classifyErrorSource('http://localhost:4173/assets/index-abc.js', origin)).toBe('app');
  });
  it('otro origen o extensiones/DevTools = externo', () => {
    expect(classifyErrorSource('https://cdn.example.com/x.js', origin)).toBe('external');
    expect(classifyErrorSource('chrome-extension://abc/content.js', origin)).toBe('external');
    expect(classifyErrorSource('devtools://devtools/bundled/x.js', origin)).toBe('external');
  });
  it('sin fichero = desconocido', () => {
    expect(classifyErrorSource('', origin)).toBe('unknown');
    expect(classifyErrorSource(undefined, origin)).toBe('unknown');
  });
});

describe('jsonSafe', () => {
  it('convierte NaN/Infinity en null y omite funciones', () => {
    expect(jsonSafe({ a: NaN, b: Infinity, c: 1, d: () => 1, e: [NaN, 2] })).toEqual({ a: null, b: null, c: 1, e: [null, 2] });
  });
  it('rompe ciclos', () => {
    const o: Record<string, unknown> = { x: 1 };
    o.self = o;
    expect(jsonSafe(o)).toEqual({ x: 1, self: null });
  });
  it('serializa arrays tipados', () => {
    expect(jsonSafe(Float32Array.from([1, 2]))).toEqual([1, 2]);
  });
});
