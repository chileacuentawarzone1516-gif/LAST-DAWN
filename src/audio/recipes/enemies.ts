/**
 * Recetas de enemigos: vocalizaciones por tipo y kind (FM + formantes con mucha variación),
 * ataques, pasos y sonidos del Warden.
 */
import type { EnemyType } from '../../core/types';
import type { Rng } from '../../core/util';
import { between, vary } from '../pure';
import { fmTone, formantVoice, noiseBurst, partials, pingScatter, scatter, tone } from '../synth';
import type { FormantSpec } from '../synth';
import type { Recipe, RecipeDef } from '../types';
import { defineRecipe, mechClick, thunk, whoosh } from './define';

export type VocalKind = 'idle' | 'alert' | 'attack' | 'hurt' | 'death';
export const VOCAL_KINDS: readonly VocalKind[] = ['idle', 'alert', 'attack', 'hurt', 'death'];
export const ENEMY_TYPES: readonly EnemyType[] = ['walker', 'runner', 'brute', 'spitter', 'warden'];

type Range = readonly [number, number];
/** Vocal (formantes) de partida y llegada: [F1, F2, F3] → [F1, F2, F3]. */
type Vowel = readonly [number, number, number, number, number, number];

const V = {
  a: [750, 1200, 2600], o: [480, 860, 2500], u: [330, 800, 2400], e: [540, 1800, 2600], i: [320, 2200, 3000], ae: [660, 1700, 2500],
  ah: [700, 1000, 2400], metal: [300, 720, 1900], hiss: [420, 2600, 3600],
} as const satisfies Record<string, readonly [number, number, number]>;
const glide = (a: readonly [number, number, number], b: readonly [number, number, number]): Vowel => [a[0], a[1], a[2], b[0], b[1], b[2]];

interface VocalSpec {
  dur: Range;
  peak: number;
  /** Contorno de f0: cada punto es un rango del que se sortea. */
  f0: readonly Range[];
  wave?: OscillatorType;
  vowels: readonly Vowel[];
  q: Range;
  vib?: { rate: Range; depth: Range };
  rasp?: { rate: Range; depth: Range };
  fm?: { ratio: Range; index: Range };
  breath: Range;
  sat?: number;
  env?: ReadonlyArray<readonly [number, number]>;
  /** Capas adicionales (burbujas, chasquidos, subgrave). */
  extra?: (ac: BaseAudioContext, dest: AudioNode, t0: number, r: Rng, dur: number, p: { pitch: number; intensity: number }) => void;
}

const pick = <T>(r: Rng, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)] as T;
const rr = (r: Rng, [lo, hi]: Range): number => between(r, lo, hi);

function vocalRecipe(spec: VocalSpec): Recipe {
  return (ac, dest, t0, p) => {
    const r = p.rng;
    const dur = rr(r, spec.dur);
    const v = pick(r, spec.vowels);
    const pitch = p.pitch * vary(r, 1, 0.04);
    const q = rr(r, spec.q);
    const formants: FormantSpec[] = [
      { from: v[0], to: v[3], q, gain: 1 },
      { from: v[1], to: v[4], q: q * 1.3, gain: 0.55 },
      { from: v[2], to: v[5], q: q * 1.6, gain: 0.22 },
    ];
    formantVoice(ac, dest, t0, {
      dur, peak: spec.peak * (0.85 + 0.3 * r()), f0: spec.f0.map((f) => rr(r, f) * pitch), wave: spec.wave ?? 'sawtooth',
      formants,
      vib: spec.vib ? { rate: rr(r, spec.vib.rate), depth: rr(r, spec.vib.depth) } : undefined,
      rasp: spec.rasp ? { rate: rr(r, spec.rasp.rate), depth: rr(r, spec.rasp.depth) } : undefined,
      fm: spec.fm ? { ratio: rr(r, spec.fm.ratio), index: rr(r, spec.fm.index) } : undefined,
      breath: rr(r, spec.breath), sat: spec.sat, env: spec.env, rng: r,
    });
    spec.extra?.(ac, dest, t0, r, dur, { pitch, intensity: p.intensity });
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Especificaciones por tipo
// ─────────────────────────────────────────────────────────────────────────────
const MOAN_ENV = [[0, 0], [0.25, 1], [0.7, 0.8], [1, 0]] as const;
const BURST_ENV = [[0, 0], [0.08, 1], [0.5, 0.8], [1, 0]] as const;
const DEATH_ENV = [[0, 0], [0.1, 1], [0.55, 0.85], [0.85, 0.5], [1, 0]] as const;

/** Burbujas húmedas (escupidor). */
const bubbles = (n: number, peak: number) => (ac: BaseAudioContext, dest: AudioNode, t0: number, r: Rng, dur: number): void => {
  pingScatter(ac, dest, t0, { count: n, span: dur * 0.9, peak, fLo: 380, fHi: 1300, hitDur: 0.05, rng: r });
};

/** Subgrave de pecho. */
const chest = (f: number, peak: number) => (ac: BaseAudioContext, dest: AudioNode, t0: number, r: Rng, dur: number, p: { pitch: number }): void => {
  tone(ac, dest, t0, { f0: f * p.pitch * vary(r, 1, 0.05), f1: f * 0.7 * p.pitch, dur, peak, attack: dur * 0.15, curve: 'lin', sat: 0.15 });
};

const SPECS: Record<Exclude<EnemyType, 'warden'>, Record<VocalKind, VocalSpec>> = {
  walker: {
    idle: {
      dur: [1.0, 1.9], peak: 0.3, f0: [[95, 125], [105, 140], [80, 110]], vowels: [glide(V.o, V.a), glide(V.u, V.o), glide(V.a, V.o)],
      q: [4, 7], vib: { rate: [4, 6.5], depth: [0.012, 0.03] }, rasp: { rate: [24, 40], depth: [0.25, 0.45] }, breath: [0.25, 0.5], sat: 0.12, env: MOAN_ENV,
    },
    alert: {
      dur: [0.7, 1.1], peak: 0.4, f0: [[130, 170], [200, 260], [180, 230]], vowels: [glide(V.a, V.ae), glide(V.ah, V.e)],
      q: [4, 7], vib: { rate: [6, 9], depth: [0.02, 0.05] }, rasp: { rate: [45, 70], depth: [0.35, 0.6] }, fm: { ratio: [1.5, 2.5], index: [0.06, 0.2] }, breath: [0.2, 0.4], sat: 0.2, env: BURST_ENV,
    },
    attack: {
      dur: [0.3, 0.5], peak: 0.4, f0: [[190, 230], [120, 150]], vowels: [glide(V.a, V.o), glide(V.ae, V.ah)],
      q: [4, 6], rasp: { rate: [55, 80], depth: [0.45, 0.6] }, breath: [0.25, 0.4], sat: 0.2, env: BURST_ENV,
    },
    hurt: {
      dur: [0.2, 0.36], peak: 0.34, f0: [[200, 260], [130, 170]], vowels: [glide(V.e, V.ah), glide(V.ae, V.o)],
      q: [4, 6], rasp: { rate: [30, 50], depth: [0.25, 0.4] }, breath: [0.25, 0.4], sat: 0.1, env: BURST_ENV,
    },
    death: {
      dur: [1.0, 1.6], peak: 0.36, f0: [[150, 190], [120, 150], [60, 85]], vowels: [glide(V.a, V.u), glide(V.ae, V.o)],
      q: [4, 6], vib: { rate: [3, 5], depth: [0.02, 0.04] }, rasp: { rate: [20, 45], depth: [0.45, 0.65] }, breath: [0.45, 0.7], sat: 0.15, env: DEATH_ENV,
      extra: bubbles(4, 0.03),
    },
  },
  runner: {
    idle: {
      dur: [0.7, 1.2], peak: 0.09, f0: [[210, 260], [190, 240]], vowels: [glide(V.i, V.e)],
      q: [5, 8], vib: { rate: [7, 10], depth: [0.02, 0.04] }, rasp: { rate: [55, 80], depth: [0.4, 0.6] }, breath: [0.9, 1.4], env: MOAN_ENV,
      extra: (ac, dest, t0, r, dur) => {
        // jadeo: dos «hah» de aire con banda media-alta
        for (let i = 0; i < 2; i++) {
          noiseBurst(ac, dest, t0 + i * dur * 0.45, {
            dur: dur * 0.36, peak: 0.16 - i * 0.03, attack: dur * 0.12, type: 'bandpass', f0: 1300 + i * 400, f1: 900 + i * 300, q: 1.2, rng: r,
          });
        }
      },
    },
    alert: {
      dur: [0.7, 1.0], peak: 0.4, f0: [[380, 460], [520, 640], [460, 560]], vowels: [glide(V.a, V.i), glide(V.ae, V.i)],
      q: [5, 8], vib: { rate: [9, 13], depth: [0.03, 0.06] }, rasp: { rate: [60, 90], depth: [0.25, 0.4] }, fm: { ratio: [2, 3], index: [0.04, 0.12] }, breath: [0.25, 0.45], sat: 0.2, env: BURST_ENV,
    },
    attack: {
      dur: [0.28, 0.42], peak: 0.38, f0: [[520, 600], [330, 400]], vowels: [glide(V.ae, V.a), glide(V.e, V.ah)],
      q: [5, 8], rasp: { rate: [70, 95], depth: [0.45, 0.6] }, breath: [0.3, 0.5], sat: 0.2, env: BURST_ENV,
    },
    hurt: {
      dur: [0.16, 0.28], peak: 0.33, f0: [[500, 600], [300, 380]], vowels: [glide(V.e, V.ae)],
      q: [5, 8], rasp: { rate: [40, 60], depth: [0.25, 0.4] }, breath: [0.3, 0.5], env: BURST_ENV,
    },
    death: {
      dur: [0.8, 1.2], peak: 0.36, f0: [[520, 600], [400, 480], [120, 180]], vowels: [glide(V.a, V.o), glide(V.i, V.a)],
      q: [5, 8], vib: { rate: [8, 12], depth: [0.03, 0.06] }, rasp: { rate: [30, 60], depth: [0.4, 0.6] }, breath: [0.45, 0.7], sat: 0.15, env: DEATH_ENV,
    },
  },
  brute: {
    idle: {
      dur: [1.3, 2.2], peak: 0.42, f0: [[52, 68], [58, 74], [48, 62]], vowels: [glide(V.o, V.u), glide(V.u, V.o)],
      q: [3, 5], vib: { rate: [2, 3.5], depth: [0.02, 0.04] }, rasp: { rate: [16, 26], depth: [0.5, 0.7] }, breath: [0.25, 0.4], sat: 0.25, env: MOAN_ENV,
      extra: chest(40, 0.22),
    },
    alert: {
      dur: [1.3, 1.9], peak: 0.55, f0: [[62, 78], [95, 120], [70, 90]], vowels: [glide(V.o, V.a), glide(V.u, V.ah)],
      q: [2.5, 4], vib: { rate: [3, 5], depth: [0.02, 0.05] }, rasp: { rate: [20, 32], depth: [0.55, 0.7] }, fm: { ratio: [0.5, 1], index: [0.1, 0.3] }, breath: [0.3, 0.5], sat: 0.35, env: BURST_ENV,
      extra: chest(45, 0.3),
    },
    attack: {
      dur: [0.45, 0.7], peak: 0.5, f0: [[95, 115], [60, 75]], vowels: [glide(V.a, V.o), glide(V.ah, V.u)],
      q: [3, 5], rasp: { rate: [20, 28], depth: [0.5, 0.65] }, breath: [0.3, 0.4], sat: 0.3, env: BURST_ENV,
      extra: chest(50, 0.26),
    },
    hurt: {
      dur: [0.3, 0.45], peak: 0.45, f0: [[95, 115], [55, 70]], vowels: [glide(V.o, V.a), glide(V.ae, V.o)],
      q: [3, 5], rasp: { rate: [18, 26], depth: [0.4, 0.55] }, breath: [0.3, 0.4], sat: 0.25, env: BURST_ENV,
    },
    death: {
      dur: [1.6, 2.4], peak: 0.5, f0: [[90, 105], [70, 85], [28, 40]], vowels: [glide(V.a, V.u), glide(V.o, V.u)],
      q: [3, 5], vib: { rate: [2.5, 4], depth: [0.02, 0.04] }, rasp: { rate: [14, 22], depth: [0.55, 0.7] }, breath: [0.4, 0.6], sat: 0.3, env: DEATH_ENV,
      extra: chest(38, 0.28),
    },
  },
  spitter: {
    idle: {
      dur: [0.9, 1.6], peak: 0.26, f0: [[130, 170], [120, 160]], vowels: [glide(V.u, V.o), glide(V.o, V.u)],
      q: [4, 6], fm: { ratio: [0.25, 0.5], index: [0.3, 0.6] }, rasp: { rate: [13, 20], depth: [0.7, 0.9] }, breath: [0.4, 0.6], sat: 0.1, env: MOAN_ENV,
      extra: bubbles(6, 0.05),
    },
    alert: {
      dur: [0.7, 1.0], peak: 0.3, f0: [[290, 340], [260, 310]], vowels: [glide(V.hiss, V.i)],
      q: [3, 5], vib: { rate: [8, 12], depth: [0.02, 0.05] }, rasp: { rate: [25, 40], depth: [0.4, 0.6] }, breath: [1.0, 1.5], sat: 0.1, env: BURST_ENV,
    },
    attack: {
      dur: [0.3, 0.45], peak: 0.34, f0: [[200, 240], [150, 180]], vowels: [glide(V.ah, V.o)],
      q: [4, 6], fm: { ratio: [0.3, 0.6], index: [0.3, 0.5] }, rasp: { rate: [14, 20], depth: [0.7, 0.9] }, breath: [0.5, 0.7], env: BURST_ENV,
      extra: bubbles(4, 0.05),
    },
    hurt: {
      dur: [0.2, 0.32], peak: 0.3, f0: [[350, 420], [220, 280]], vowels: [glide(V.e, V.ah)],
      q: [4, 6], rasp: { rate: [14, 20], depth: [0.5, 0.7] }, breath: [0.4, 0.6], env: BURST_ENV,
    },
    death: {
      dur: [1.0, 1.4], peak: 0.32, f0: [[220, 260], [140, 180], [70, 100]], vowels: [glide(V.a, V.u), glide(V.o, V.u)],
      q: [4, 6], fm: { ratio: [0.3, 0.6], index: [0.4, 0.8] }, rasp: { rate: [12, 18], depth: [0.75, 0.9] }, breath: [0.6, 0.9], env: DEATH_ENV,
      extra: (ac, dest, t0, r, dur) => {
        bubbles(9, 0.06)(ac, dest, t0, r, dur);
        noiseBurst(ac, dest, t0 + dur * 0.55, { kind: 'pink', dur: 0.35, peak: 0.16, attack: 0.02, type: 'bandpass', f0: 1200, f1: 400, q: 1.5, rng: r });
      },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Warden (blindado, mecánico)
// ─────────────────────────────────────────────────────────────────────────────
/** Servo hidráulico: barrido de diente de sierra filtrado. */
function servo(ac: BaseAudioContext, dest: AudioNode, t: number, o: { f0: number; f1: number; dur: number; peak: number }): void {
  tone(ac, dest, t, { type: 'sawtooth', f0: o.f0, f1: o.f1, dur: o.dur, peak: o.peak, attack: o.dur * 0.25, lp: 1100, curve: 'lin' });
}

const wardenIdle: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  // respirador: inhalar y exhalar con siseo grave
  noiseBurst(ac, dest, t0, { kind: 'pink', dur: 0.75, peak: 0.24, attack: 0.3, type: 'bandpass', f0: 500, f1: 900, q: 1.2, rng: r });
  noiseBurst(ac, dest, t0 + 0.85, { kind: 'pink', dur: 0.9, peak: 0.28, attack: 0.15, type: 'bandpass', f0: 800, f1: 380, q: 1.2, rng: r });
  servo(ac, dest, t0 + 0.05, { f0: 90 * p.pitch, f1: 150 * p.pitch, dur: 0.7, peak: 0.06 });
  servo(ac, dest, t0 + 0.85, { f0: 150 * p.pitch, f1: 80 * p.pitch, dur: 0.9, peak: 0.06 });
  tone(ac, dest, t0, { f0: 48, dur: 1.75, peak: 0.16, attack: 0.3, curve: 'lin', lp: 120 });
};

const wardenAlert = vocalRecipe({
  dur: [1.2, 1.6], peak: 0.6, f0: [[45, 55], [75, 95], [55, 65]], vowels: [glide(V.metal, V.o), glide(V.o, V.metal)],
  q: [5, 9], vib: { rate: [3, 5], depth: [0.02, 0.04] }, rasp: { rate: [30, 45], depth: [0.6, 0.75] }, fm: { ratio: [0.5, 1], index: [0.2, 0.5] }, breath: [0.2, 0.35], sat: 0.55, env: BURST_ENV,
  extra: (ac, dest, t0, r, dur) => servo(ac, dest, t0, { f0: 120, f1: 320, dur: dur * 0.8, peak: 0.07 }),
});
const wardenAttack = vocalRecipe({
  dur: [0.5, 0.7], peak: 0.55, f0: [[80, 95], [55, 65]], vowels: [glide(V.o, V.metal)],
  q: [5, 8], rasp: { rate: [26, 36], depth: [0.6, 0.75] }, breath: [0.2, 0.3], sat: 0.5, env: BURST_ENV,
  extra: (ac, dest, t0, r) => servo(ac, dest, t0, { f0: 200, f1: 420, dur: 0.3, peak: 0.08 }),
});
const wardenHurt = vocalRecipe({
  dur: [0.3, 0.4], peak: 0.5, f0: [[70, 85], [50, 60]], vowels: [glide(V.metal, V.o)],
  q: [5, 8], rasp: { rate: [22, 32], depth: [0.5, 0.65] }, breath: [0.2, 0.3], sat: 0.45, env: BURST_ENV,
  extra: (ac, dest, t0) => partials(ac, dest, t0, { f: 260, ratios: [1, 2.4], decay: 0.16, peak: 0.16 }),
});
const wardenDeath = vocalRecipe({
  dur: [2.2, 2.8], peak: 0.55, f0: [[80, 95], [60, 70], [22, 32]], vowels: [glide(V.o, V.u), glide(V.metal, V.u)],
  q: [4, 7], vib: { rate: [2, 3], depth: [0.02, 0.04] }, rasp: { rate: [16, 26], depth: [0.6, 0.75] }, fm: { ratio: [0.5, 0.8], index: [0.2, 0.4] }, breath: [0.3, 0.5], sat: 0.5, env: DEATH_ENV,
  extra: (ac, dest, t0, r, dur) => {
    servo(ac, dest, t0, { f0: 700, f1: 70, dur: dur * 0.9, peak: 0.07 });
    pingScatter(ac, dest, t0 + dur * 0.3, { count: 6, span: dur * 0.6, peak: 0.05, fLo: 800, fHi: 2400, hitDur: 0.12, fall: 0.5, rng: r });
  },
});

/** Rugido del Warden (evento 'warden:roar'). ≤ 33 nodos. */
const wardenRoar: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  const k = p.pitch * vary(r, 1, 0.04);
  formantVoice(ac, dest, t0, {
    dur: 2.5, peak: 0.66, f0: [46 * k, 80 * k, 96 * k, 54 * k], wave: 'sawtooth', sat: 0.55,
    formants: [
      { from: 320, to: 760, q: 5, gain: 1 },
      { from: 760, to: 1250, q: 7, gain: 0.55 },
      { from: 1900, to: 2500, q: 8, gain: 0.25 },
    ],
    vib: { rate: 3.4, depth: 0.03 }, rasp: { rate: 27, depth: 0.75 }, fm: { ratio: 0.5, index: 0.3 }, breath: 0.3,
    env: [[0, 0], [0.08, 1], [0.6, 0.95], [1, 0]], rng: r,
  });
  tone(ac, dest, t0, { f0: 75, f1: 28, dur: 0.6, peak: 0.6, attack: 0.004, sat: 0.3 });
  tone(ac, dest, t0 + 0.05, { f0: 42, dur: 2.3, peak: 0.28, attack: 0.15, curve: 'lin', lp: 100 });
  noiseBurst(ac, dest, t0 + 0.25, { dur: 1.3, peak: 0.14, attack: 0.25, type: 'bandpass', f0: 400, f1: 2100, q: 5, rng: r });
  noiseBurst(ac, dest, t0, { kind: 'brown', dur: 2.6, peak: 0.34, attack: 0.1, type: 'lowpass', f0: 180, f1: 70, rng: r });
};

/** Rotura del casco del Warden. */
const wardenHelmetBroken: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  noiseBurst(ac, dest, t0, { dur: 0.06, peak: 0.85, attack: 0.0005, type: 'highpass', f0: 700, rng: r });
  partials(ac, dest, t0, { f: 480 * p.pitch, ratios: [1, 2.32, 3.7, 5.1, 7.3], decay: 1.1, peak: 0.42, attack: 0.0007, damp: 0.8 });
  tone(ac, dest, t0, { f0: 95, f1: 38, dur: 0.32, peak: 0.7, attack: 0.002, sat: 0.3 });
  noiseBurst(ac, dest, t0 + 0.05, { kind: 'pink', dur: 1.6, peak: 0.14, attack: 0.06, type: 'highpass', f0: 4200, f1: 2600, rng: r });
  scatter(ac, dest, t0 + 0.05, { count: 12, span: 0.7, peak: 0.16, fLo: 1500, fHi: 5200, q: 3, hitDur: 0.05, bias: 1.3, rng: r });
  servo(ac, dest, t0 + 0.1, { f0: 400, f1: 60, dur: 1.0, peak: 0.06 });
};

// ─────────────────────────────────────────────────────────────────────────────
// Ataques
// ─────────────────────────────────────────────────────────────────────────────
function meleeRecipe(type: EnemyType): Recipe {
  return (ac, dest, t0, p) => {
    const r = p.rng;
    const k = p.pitch * vary(r, 1, 0.07);
    switch (type) {
      case 'runner':
        whoosh(ac, dest, t0, r, { dur: 0.1, peak: 0.15, f0: 600 * k, f1: 2400 * k });
        noiseBurst(ac, dest, t0 + 0.08, { kind: 'pink', dur: 0.05, peak: 0.16, attack: 0.001, type: 'lowpass', f0: 1500, f1: 600, rng: r });
        tone(ac, dest, t0 + 0.08, { f0: 140 * k, f1: 85, dur: 0.05, peak: 0.16, attack: 0.001 });
        break;
      case 'brute':
        whoosh(ac, dest, t0, r, { dur: 0.3, peak: 0.28, f0: 180 * k, f1: 900 * k, q: 0.9 });
        thunk(ac, dest, t0 + 0.2, r, { peak: 0.42, f: 85 * k, dur: 0.13 });
        noiseBurst(ac, dest, t0 + 0.2, { kind: 'pink', dur: 0.1, peak: 0.24, attack: 0.002, type: 'lowpass', f0: 900, f1: 300, rng: r });
        break;
      case 'warden':
        whoosh(ac, dest, t0, r, { dur: 0.32, peak: 0.3, f0: 150 * k, f1: 1000 * k, q: 0.9 });
        servo(ac, dest, t0, { f0: 200, f1: 430, dur: 0.28, peak: 0.07 });
        partials(ac, dest, t0 + 0.24, { f: 190 * k, ratios: [1, 2.4, 3.9], decay: 0.24, peak: 0.2, damp: 0.9 });
        thunk(ac, dest, t0 + 0.24, r, { peak: 0.5, f: 78 * k, dur: 0.15 });
        break;
      default:
        whoosh(ac, dest, t0, r, { dur: 0.16, peak: 0.16, f0: 400 * k, f1: 1500 * k });
        noiseBurst(ac, dest, t0 + 0.12, { kind: 'pink', dur: 0.07, peak: 0.18, attack: 0.002, type: 'lowpass', f0: 1300, f1: 500, rng: r });
        tone(ac, dest, t0 + 0.12, { f0: 130 * k, f1: 78, dur: 0.07, peak: 0.2, attack: 0.001 });
        break;
    }
  };
}

const attackSpit: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  const k = p.pitch * vary(r, 1, 0.06);
  fmTone(ac, dest, t0, { fc: 220 * k, fc1: 380 * k, ratio: 0.5, index: 0.8, dur: 0.22, peak: 0.1, attack: 0.03, type: 'sine' });
  pingScatter(ac, dest, t0, { count: 6, span: 0.22, peak: 0.06, fLo: 400, fHi: 1300, hitDur: 0.04, rng: r });
  noiseBurst(ac, dest, t0 + 0.22, { dur: 0.05, peak: 0.28, attack: 0.001, type: 'bandpass', f0: 950 * k, q: 1.5, rng: r });
  tone(ac, dest, t0 + 0.22, { f0: 820 * k, f1: 250, dur: 0.09, peak: 0.28, attack: 0.001 });
  noiseBurst(ac, dest, t0 + 0.24, { kind: 'pink', dur: 0.4, peak: 0.09, attack: 0.02, type: 'highpass', f0: 3200, f1: 1600, rng: r });
};

const attackSlam: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  const k = p.pitch * vary(r, 1, 0.05);
  tone(ac, dest, t0, { f0: 84 * k, f1: 26, dur: 0.55, peak: 0.85, attack: 0.003, sat: 0.3 });
  noiseBurst(ac, dest, t0, { dur: 0.4, peak: 0.5, attack: 0.002, type: 'lowpass', f0: 1800, f1: 200, rng: r });
  noiseBurst(ac, dest, t0, { dur: 0.04, peak: 0.42, attack: 0.0006, type: 'bandpass', f0: 2000, q: 1.2, rng: r });
  noiseBurst(ac, dest, t0, { kind: 'brown', dur: 1.1, peak: 0.42, attack: 0.03, type: 'lowpass', f0: 220, f1: 80, rng: r });
  scatter(ac, dest, t0 + 0.06, { count: 18, span: 0.7, peak: 0.16, fLo: 600, fHi: 3200, q: 1.4, hitDur: 0.05, bias: 1.4, fall: 0.5, rng: r });
};

// ─────────────────────────────────────────────────────────────────────────────
// Pasos de enemigos
// ─────────────────────────────────────────────────────────────────────────────
function enemyStep(type: EnemyType): Recipe {
  return (ac, dest, t0, p) => {
    const r = p.rng;
    const k = p.pitch * vary(r, 1, 0.1);
    switch (type) {
      case 'runner':
        noiseBurst(ac, dest, t0, { dur: 0.05, peak: 0.2, attack: 0.001, type: 'bandpass', f0: 1400 * k, f1: 800, q: 0.9, rng: r });
        tone(ac, dest, t0, { f0: 125 * k, f1: 70, dur: 0.05, peak: 0.2, attack: 0.001 });
        break;
      case 'brute':
        tone(ac, dest, t0, { f0: 66 * k, f1: 34, dur: 0.2, peak: 0.55, attack: 0.002, sat: 0.15 });
        noiseBurst(ac, dest, t0, { kind: 'brown', dur: 0.14, peak: 0.3, attack: 0.002, type: 'lowpass', f0: 520, f1: 200, rng: r });
        scatter(ac, dest, t0 + 0.02, { count: 4, span: 0.1, peak: 0.06, fLo: 800, fHi: 2200, hitDur: 0.025, rng: r });
        break;
      case 'spitter':
        noiseBurst(ac, dest, t0, { kind: 'pink', dur: 0.1, peak: 0.2, attack: 0.004, type: 'lowpass', f0: 750 * k, f1: 320, rng: r });
        noiseBurst(ac, dest, t0, { dur: 0.09, peak: 0.07, attack: 0.02, type: 'bandpass', f0: 500, f1: 1200, q: 3, rng: r });
        tone(ac, dest, t0, { f0: 90 * k, f1: 55, dur: 0.07, peak: 0.16, attack: 0.002 });
        break;
      case 'warden':
        tone(ac, dest, t0, { f0: 56 * k, f1: 28, dur: 0.26, peak: 0.66, attack: 0.002, sat: 0.3 });
        noiseBurst(ac, dest, t0, { kind: 'brown', dur: 0.16, peak: 0.3, attack: 0.002, type: 'lowpass', f0: 700, f1: 220, rng: r });
        partials(ac, dest, t0, { f: 190 * k, ratios: [1, 2.4, 3.9], decay: 0.3, peak: 0.15, damp: 0.9 });
        servo(ac, dest, t0 + 0.02, { f0: 160, f1: 290, dur: 0.22, peak: 0.07 });
        mechClick(ac, dest, t0 + 0.12, r, { peak: 0.16, f: 1200 });
        break;
      default:
        noiseBurst(ac, dest, t0, { kind: 'pink', dur: 0.13, peak: 0.2, attack: 0.02, type: 'lowpass', f0: 950 * k, f1: 350, rng: r });
        tone(ac, dest, t0 + 0.01, { f0: 82 * k, f1: 50, dur: 0.08, peak: 0.18, attack: 0.002 });
        scatter(ac, dest, t0 + 0.03, { count: 3, span: 0.08, peak: 0.04, fLo: 1500, fHi: 3500, hitDur: 0.015, rng: r });
        break;
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Registro
// ─────────────────────────────────────────────────────────────────────────────
/** Alcance (m) de cada kind de vocalización. */
const VOCAL_RANGE: Record<VocalKind, number> = { idle: 55, alert: 100, attack: 65, hurt: 70, death: 85 };
const VOCAL_PRIO: Record<VocalKind, number> = { idle: 30, alert: 62, attack: 66, hurt: 54, death: 64 };

export function enemyRecipes(): RecipeDef[] {
  const defs: RecipeDef[] = [];
  for (const type of ['walker', 'runner', 'brute', 'spitter'] as const) {
    for (const kind of VOCAL_KINDS) {
      const spec = SPECS[type][kind];
      const dur = spec.dur[1] + 0.25;
      defs.push(defineRecipe(`vocal.${type}.${kind}`, 'vocal', VOCAL_PRIO[kind] + (type === 'brute' ? 6 : 0), dur, vocalRecipe(spec), {
        send: 0.18, range: VOCAL_RANGE[kind] * (type === 'brute' ? 1.25 : 1), minDur: spec.dur[0] * 0.6,
      }));
    }
  }
  const wardenVocals: Record<VocalKind, Recipe> = { idle: wardenIdle, alert: wardenAlert, attack: wardenAttack, hurt: wardenHurt, death: wardenDeath };
  const wardenDur: Record<VocalKind, number> = { idle: 1.9, alert: 2.0, attack: 1.0, hurt: 0.7, death: 3.2 };
  for (const kind of VOCAL_KINDS) {
    defs.push(defineRecipe(`vocal.warden.${kind}`, 'vocal', 80 + (kind === 'idle' ? -40 : 0), wardenDur[kind], wardenVocals[kind], {
      send: 0.22, range: VOCAL_RANGE[kind] * 1.5, minDur: 0.25,
    }));
  }
  defs.push(
    defineRecipe('warden.roar', 'vocal', 98, 3.2, wardenRoar, { send: 0.3, range: 180, minDur: 1.2 }),
    defineRecipe('warden.helmetBroken', 'enemy', 96, 2.2, wardenHelmetBroken, { send: 0.3, range: 160, minDur: 0.8 }),
    defineRecipe('attack.spit', 'enemy', 60, 0.75, attackSpit, { send: 0.18, range: 80 }),
    defineRecipe('attack.slam', 'enemy', 88, 1.5, attackSlam, { send: 0.28, range: 130, minDur: 0.4 }),
  );
  for (const type of ENEMY_TYPES) {
    defs.push(defineRecipe(`attack.melee.${type}`, 'enemy', type === 'warden' ? 82 : 56, type === 'warden' ? 0.9 : 0.5, meleeRecipe(type), { send: 0.12, range: 70 }));
    const heavy = type === 'brute' || type === 'warden';
    defs.push(defineRecipe(`step.enemy.${type}`, 'step', heavy ? 55 : 22, type === 'warden' ? 0.6 : heavy ? 0.4 : 0.22, enemyStep(type), {
      send: 0.14, range: heavy ? 55 : 30, minDur: 0.04,
    }));
  }
  return defs;
}

export const vocalId = (type: EnemyType, kind: VocalKind): string => `vocal.${type}.${kind}`;
