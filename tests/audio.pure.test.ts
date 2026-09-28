import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/util';
import {
  CombatMeter, DEFAULT_LIMITER, StrideTracker, VariationPicker, VoiceLimiter, adsrAt, adsrBreakpoints, airCutoff, analyzeSignal,
  dopplerRatio, fillNoise, generateIr, heartbeatParams, hzToMidi, holdTickFreq, holdTickInterval, midiToHz, musicIntensity,
  musicLayers, noteToHz, noteToMidi, pulseBpm, rangeFade, saturationCurve, scaleDegreeToMidi, softClipCurve, SCALES,
  DEFAULT_IR, LITE_IR, LITE_LIMITER, NEUTRAL_VOICE, playerVoice,
} from '../src/audio/pure';

describe('notas y frecuencias', () => {
  it('A4 = 440 Hz y octavas', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 6);
    expect(midiToHz(81)).toBeCloseTo(880, 6);
    expect(noteToHz('A4')).toBeCloseTo(440, 6);
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('C#3')).toBe(49);
    expect(noteToMidi('Bb2')).toBe(46);
    expect(hzToMidi(midiToHz(53))).toBeCloseTo(53, 9);
  });
  it('rechaza notas inválidas', () => {
    expect(() => noteToMidi('H9')).toThrow(RangeError);
  });
  it('grados de escala saltan de octava', () => {
    expect(scaleDegreeToMidi(45, SCALES.minor, 0)).toBe(45);
    expect(scaleDegreeToMidi(45, SCALES.minor, 7)).toBe(57);
    expect(scaleDegreeToMidi(45, SCALES.minor, -1)).toBe(45 - 2);
  });
});

describe('envolventes', () => {
  const env = { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3 };
  it('ADSR sube, cae al sostén y se libera a 0', () => {
    expect(adsrAt(env, 0, 1)).toBe(0);
    expect(adsrAt(env, 0.1, 1)).toBeCloseTo(1, 6);
    expect(adsrAt(env, 0.9, 1)).toBeCloseTo(0.5, 1);
    expect(adsrAt(env, 1.3, 1)).toBe(0);
    for (let t = 0; t < 1.5; t += 0.01) {
      const v = adsrAt(env, t, 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1.0001);
    }
  });
  it('puntos de quiebre crecientes en t y terminan en 0', () => {
    const pts = adsrBreakpoints(env, 0.02, 0.8);
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.t).toBeGreaterThan(pts[i - 1]!.t);
    expect(pts[pts.length - 1]!.v).toBe(0);
    expect(pts[1]!.v).toBe(0.8);
  });
});

describe('curvas', () => {
  it('saturación: impar, monótona, acotada', () => {
    const c = saturationCurve(257, 0.6);
    expect(c[0]).toBeCloseTo(-1, 6);
    expect(c[c.length - 1]).toBeCloseTo(1, 6);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]!);
  });
  it('recortador suave nunca supera ±1 y es lineal bajo la rodilla', () => {
    const c = softClipCurve(2049);
    for (const v of c) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    const mid = (c.length - 1) / 2;
    expect(c[mid + 200]!).toBeCloseTo(200 / mid, 3);
  });
});

describe('espacialidad', () => {
  it('desvanece a 0 en el alcance y filtra con la distancia', () => {
    expect(rangeFade(0, 100)).toBe(1);
    expect(rangeFade(100, 100)).toBeCloseTo(0, 6);
    expect(airCutoff(0)).toBeGreaterThan(airCutoff(100));
    expect(dopplerRatio(0)).toBe(1);
    expect(dopplerRatio(30)).toBeGreaterThan(1);
    expect(dopplerRatio(-30)).toBeLessThan(1);
  });
});

describe('variaciones', () => {
  it('nunca repite el índice anterior y es determinista', () => {
    const a = new VariationPicker(createRng(7));
    const b = new VariationPicker(createRng(7));
    let prev = -1;
    for (let i = 0; i < 200; i++) {
      const x = a.pick('k', 4);
      expect(x).not.toBe(prev);
      expect(x).toBe(b.pick('k', 4));
      prev = x;
    }
  });
});

describe('limitador de voces', () => {
  const mk = () => new VoiceLimiter({
    total: 4,
    criticalPriority: 90,
    fallback: { max: 3, gap: 0, burstMax: 0, burstWindowS: 0 },
    categories: { a: { max: 2, gap: 0.1, burstMax: 0, burstWindowS: 0 }, b: { max: 3, gap: 0, burstMax: 2, burstWindowS: 1 } },
  });
  it('respeta la tasa por clave', () => {
    const l = mk();
    expect(l.request({ key: 'x', category: 'a', priority: 10, dur: 1, now: 0 }).accepted).toBe(true);
    const r = l.request({ key: 'x', category: 'a', priority: 10, dur: 1, now: 0.05 });
    expect(r).toEqual({ accepted: false, reason: 'gap' });
  });
  it('roba la voz de menor prioridad y rechaza si la nueva es peor', () => {
    const l = mk();
    l.request({ key: 'l', category: 'a', priority: 10, dur: 5, now: 0 });
    l.request({ key: 'm', category: 'a', priority: 50, dur: 5, now: 0.2 });
    const hi = l.request({ key: 'h', category: 'a', priority: 80, dur: 5, now: 0.4 });
    expect(hi.accepted && hi.steal.length).toBe(1);
    expect(l.request({ key: 'w', category: 'a', priority: 5, dur: 5, now: 0.6 })).toEqual({ accepted: false, reason: 'priority' });
    expect(l.count('a')).toBe(2);
  });
  it('limita ráfagas salvo prioridad crítica y libera al terminar', () => {
    const l = mk();
    expect(l.request({ key: '1', category: 'b', priority: 10, dur: 0.1, now: 0 }).accepted).toBe(true);
    expect(l.request({ key: '2', category: 'b', priority: 10, dur: 0.1, now: 0.01 }).accepted).toBe(true);
    expect(l.request({ key: '3', category: 'b', priority: 10, dur: 0.1, now: 0.02 })).toEqual({ accepted: false, reason: 'burst' });
    expect(l.request({ key: '4', category: 'b', priority: 95, dur: 0.1, now: 0.03 }).accepted).toBe(true);
    expect(l.prune(5).length).toBeGreaterThan(0);
    expect(l.count()).toBe(0);
  });
  it('el tope total se cumple', () => {
    const l = new VoiceLimiter(DEFAULT_LIMITER);
    for (let i = 0; i < 200; i++) l.request({ key: `k${i}`, category: 'ui', priority: 50, dur: 10, now: i * 0.001 });
    expect(l.count()).toBeLessThanOrEqual(DEFAULT_LIMITER.total);
  });
});

describe('música y jugador', () => {
  const base = { threat: 1, combat: 0, contaminationS: null, sealFraction: 0, hordeActive: false, wardenEngaged: false, extractionActive: false };
  it('la intensidad crece con amenaza, combate y contaminación y se acota a [0,1]', () => {
    const calm = musicIntensity(base);
    expect(musicIntensity({ ...base, threat: 4 })).toBeGreaterThan(calm);
    expect(musicIntensity({ ...base, combat: 1 })).toBeGreaterThan(calm);
    expect(musicIntensity({ ...base, contaminationS: 60 })).toBeGreaterThan(calm);
    expect(musicIntensity({ ...base, threat: 4, combat: 1, hordeActive: true, wardenEngaged: true, contaminationS: 99, sealFraction: 1 })).toBe(1);
  });
  it('las capas se activan por umbrales y el tempo sube', () => {
    expect(musicLayers(0).pulse).toBe(0);
    expect(musicLayers(1).combat).toBe(1);
    expect(pulseBpm(1)).toBeGreaterThan(pulseBpm(0));
  });
  it('el medidor de combate decae', () => {
    const m = new CombatMeter(2);
    m.add(1);
    const a = m.level;
    m.update(2);
    expect(m.level).toBeLessThan(a);
  });
  it('latido: sólo con poca vida, más rápido cuanto menos', () => {
    expect(heartbeatParams(0.8).active).toBe(false);
    expect(heartbeatParams(0.3, false).active).toBe(false);
    expect(heartbeatParams(0.05).bpm).toBeGreaterThan(heartbeatParams(0.35).bpm);
  });
  it('tic de retención: más rápido y agudo con el progreso', () => {
    expect(holdTickInterval(1)).toBeLessThan(holdTickInterval(0));
    expect(holdTickFreq(1)).toBeGreaterThan(holdTickFreq(0));
  });
  it('zancadas: un paso por longitud y no cuentan los saltos', () => {
    const t = new StrideTracker();
    let steps = 0;
    t.beginFrame();
    t.step(1, 0, 0, 1);
    for (let i = 1; i <= 10; i++) {
      t.beginFrame();
      if (t.step(1, i * 0.5, 0, 1)) steps++;
    }
    expect(steps).toBe(5);
    t.beginFrame();
    expect(t.step(1, 500, 0, 1)).toBe(false);
    t.endFrame();
    t.beginFrame();
    t.endFrame();
    expect(t.size).toBe(0);
  });
});

describe('ruido, IR y análisis', () => {
  it('ruido determinista, sin NaN, RMS pedido y sin DC', () => {
    for (const kind of ['white', 'pink', 'brown'] as const) {
      const a = fillNoise(kind, 8192, 3, 0.3);
      const b = fillNoise(kind, 8192, 3, 0.3);
      expect(a).toEqual(b);
      const s = analyzeSignal([a], 44100);
      expect(s.nan).toBe(0);
      expect(s.rms).toBeCloseTo(0.3, 2);
      expect(s.dc).toBeLessThan(1e-3);
    }
  });
  it('IR estéreo decae y es finita', () => {
    const ir = generateIr(8000);
    expect(ir.left).toHaveLength(ir.right.length);
    const q = ir.left.length >> 2;
    const e = (from: number, to: number): number => {
      let s = 0;
      for (let i = from; i < to; i++) s += ir.left[i]! ** 2;
      return s;
    };
    expect(e(0, q)).toBeGreaterThan(e(3 * q, 4 * q) * 5);
    expect(analyzeSignal([ir.left, ir.right], 8000).nan).toBe(0);
  });
  it('analyzeSignal detecta NaN, pico y duración audible', () => {
    const x = new Float32Array(1000);
    x[100] = 0.5;
    x[200] = NaN;
    const s = analyzeSignal([x], 1000);
    expect(s.nan).toBe(1);
    expect(s.peak).toBe(0.5);
    expect(s.audibleS).toBeCloseTo(0.101, 3);
  });
});

describe('voz del jugador por género', () => {
  const semis = (r: number): number => 12 * Math.log2(r);
  it('la voz femenina es +4..6 semitonos más aguda con formantes desplazados y menos áspera', () => {
    const rng = createRng(5);
    for (let i = 0; i < 300; i++) {
      const f = playerVoice('female', rng);
      const m = playerVoice('male', rng);
      expect(semis(f.pitch)).toBeGreaterThanOrEqual(4 - 1e-9);
      expect(semis(f.pitch)).toBeLessThanOrEqual(6 + 1e-9);
      expect(semis(m.pitch)).toBeGreaterThanOrEqual(-1 - 1e-9);
      expect(semis(m.pitch)).toBeLessThanOrEqual(1 + 1e-9);
      expect(f.formantScale).toBeGreaterThan(m.formantScale);
      expect(f.rasp).toBeLessThan(m.rasp);
      expect(f.breathiness).toBeGreaterThan(m.breathiness);
    }
  });
  it('es determinista con la misma semilla, varía entre llamadas y tolera géneros desconocidos', () => {
    expect(playerVoice('female', createRng(1))).toEqual(playerVoice('female', createRng(1)));
    const r = createRng(2);
    expect(playerVoice('female', r).pitch).not.toBe(playerVoice('female', r).pitch);
    expect(semis(playerVoice('otro', createRng(3)).pitch)).toBeLessThanOrEqual(1);
    expect(semis(playerVoice(undefined, createRng(3)).pitch)).toBeGreaterThanOrEqual(-1);
    expect(NEUTRAL_VOICE.pitch).toBe(1);
  });
});

describe('modo ligero (móvil)', () => {
  it('el limitador ligero tiene ~24 voces y topes por categoría menores o iguales', () => {
    expect(LITE_LIMITER.total).toBe(24);
    for (const [k, v] of Object.entries(DEFAULT_LIMITER.categories)) {
      const lite = LITE_LIMITER.categories[k]!;
      expect(lite.max).toBeLessThanOrEqual(v.max);
      expect(lite.max).toBeGreaterThanOrEqual(1);
    }
    const l = new VoiceLimiter(LITE_LIMITER);
    for (let i = 0; i < 100; i++) l.request({ key: `k${i}`, category: 'ui', priority: 50, dur: 10, now: i * 0.01 });
    expect(l.count()).toBeLessThanOrEqual(24);
  });
  it('la IR ligera es más corta y sigue siendo finita', () => {
    expect(LITE_IR.seconds).toBeLessThan(DEFAULT_IR.seconds);
    const ir = generateIr(8000, LITE_IR);
    expect(ir.left.length).toBeLessThan(generateIr(8000).left.length);
    expect(analyzeSignal([ir.left, ir.right], 8000).nan).toBe(0);
  });
});
