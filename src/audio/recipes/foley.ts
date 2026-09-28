/**
 * Foley del jugador y del mundo: pasos, saltos, daño, latido, recogidas, impactos de bala,
 * marcadores de impacto y caídas de cuerpos.
 */
import type { SurfaceKind } from '../../core/types';
import { between, chance, vary } from '../pure';
import { formantVoice, noiseBurst, partials, pingScatter, scatter, tone } from '../synth';
import type { Recipe, RecipeDef } from '../types';
import { defineRecipe, mechClick, rasp, thunk } from './define';

export const SURFACES: readonly SurfaceKind[] = ['concrete', 'metal', 'dirt', 'asphalt', 'flesh', 'glass', 'wood', 'water'];

// ─────────────────────────────────────────────────────────────────────────────
// Pasos por superficie (intensidad: agachado suave · andar · correr fuerte)
// ─────────────────────────────────────────────────────────────────────────────
function stepRecipe(surface: SurfaceKind): Recipe {
  return (ac, dest, t0, p) => {
    const r = p.rng;
    const I = p.intensity;
    const k = p.pitch * vary(r, 1, 0.1);
    const soft = I < 0.5;
    switch (surface) {
      case 'concrete':
        noiseBurst(ac, dest, t0, { dur: 0.05, peak: 0.3 * I, attack: 0.001, type: 'bandpass', f0: 1700 * k * (soft ? 0.7 : 1), f1: 750, q: 0.9, rng: r });
        tone(ac, dest, t0, { f0: 125 * k, f1: 65, dur: 0.07, peak: 0.34 * I, attack: 0.001 });
        scatter(ac, dest, t0 + 0.004, { count: 5, span: 0.07, peak: 0.05 * I, fLo: 4000, fHi: 7500, type: 'highpass', q: 0.7, hitDur: 0.008, rng: r });
        break;
      case 'asphalt':
        noiseBurst(ac, dest, t0, { dur: 0.055, peak: 0.28 * I, attack: 0.001, type: 'lowpass', f0: 2300 * k, f1: 650, q: 0.7, rng: r });
        tone(ac, dest, t0, { f0: 105 * k, f1: 60, dur: 0.08, peak: 0.34 * I, attack: 0.001 });
        scatter(ac, dest, t0 + 0.006, { count: 4, span: 0.06, peak: 0.035 * I, fLo: 3000, fHi: 5500, type: 'highpass', hitDur: 0.007, rng: r });
        break;
      case 'metal':
        noiseBurst(ac, dest, t0, { dur: 0.03, peak: 0.24 * I, attack: 0.0008, type: 'bandpass', f0: 2700 * k, q: 1.6, rng: r });
        tone(ac, dest, t0, { f0: 150 * k, f1: 80, dur: 0.06, peak: 0.26 * I, attack: 0.001 });
        partials(ac, dest, t0, { f: between(r, 330, 520) * k, ratios: [1, 2.32, 4.18, 6.1], decay: 0.17, peak: 0.16 * I, attack: 0.0008, damp: 0.9 });
        break;
      case 'dirt':
        noiseBurst(ac, dest, t0, { kind: 'pink', dur: 0.1, peak: 0.3 * I, attack: 0.004, type: 'lowpass', f0: 950 * k, f1: 380, q: 0.6, rng: r });
        tone(ac, dest, t0, { f0: 92 * k, f1: 55, dur: 0.09, peak: 0.3 * I, attack: 0.002 });
        scatter(ac, dest, t0 + 0.01, { count: 8, span: 0.13, peak: 0.055 * I, fLo: 2000, fHi: 5000, q: 0.9, hitDur: 0.012, rng: r });
        break;
      case 'wood':
        tone(ac, dest, t0, { type: 'triangle', f0: 190 * k, f1: 120, dur: 0.09, peak: 0.3 * I, attack: 0.001 });
        partials(ac, dest, t0, { f: 260 * k, ratios: [1, 2.1], decay: 0.11, peak: 0.13 * I });
        noiseBurst(ac, dest, t0, { dur: 0.05, peak: 0.18 * I, attack: 0.001, type: 'bandpass', f0: 720 * k, q: 2, rng: r });
        if (chance(r, 0.16)) tone(ac, dest, t0 + 0.03, { type: 'sawtooth', f0: 220 * k, f1: 300 * k, dur: 0.2, peak: 0.04 * I, attack: 0.03, lp: 900, curve: 'lin' });
        break;
      case 'glass':
        scatter(ac, dest, t0, { count: 16, span: 0.15, peak: 0.13 * I, fLo: 3500, fHi: 9000, type: 'highpass', q: 0.8, hitDur: 0.014, rng: r });
        pingScatter(ac, dest, t0, { count: 4, span: 0.13, peak: 0.05 * I, fLo: 3500, fHi: 7500, hitDur: 0.06, rng: r });
        tone(ac, dest, t0, { f0: 125 * k, f1: 70, dur: 0.07, peak: 0.2 * I, attack: 0.001 });
        break;
      case 'flesh':
        noiseBurst(ac, dest, t0, { kind: 'pink', dur: 0.1, peak: 0.3 * I, attack: 0.003, type: 'lowpass', f0: 720 * k, f1: 300, q: 0.7, rng: r });
        tone(ac, dest, t0, { f0: 100 * k, f1: 50, dur: 0.1, peak: 0.3 * I, attack: 0.002 });
        noiseBurst(ac, dest, t0 + 0.01, { dur: 0.08, peak: 0.1 * I, attack: 0.01, type: 'bandpass', f0: 300, f1: 900, q: 3, rng: r });
        break;
      case 'water':
        noiseBurst(ac, dest, t0, { dur: 0.13, peak: 0.25 * I, attack: 0.008, type: 'bandpass', f0: 1200 * k, f1: 3000, q: 0.9, rng: r });
        pingScatter(ac, dest, t0 + 0.02, { count: 3, span: 0.1, peak: 0.06 * I, fLo: 500, fHi: 1400, hitDur: 0.04, rng: r });
        tone(ac, dest, t0, { f0: 100 * k, f1: 60, dur: 0.1, peak: 0.2 * I, attack: 0.002 });
        break;
    }
  };
}

const playerJump: Recipe = (ac, dest, t0, p) => {
  rasp(ac, dest, t0, p.rng, { dur: 0.07, peak: 0.08, f0: 900, f1: 1700, q: 0.8 });
  thunk(ac, dest, t0 + 0.02, p.rng, { peak: 0.15, f: 90, dur: 0.05, noise: false });
};

/** Aterrizaje: `intensity` 0..1 según el impacto. */
const playerLand: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  const I = p.intensity;
  tone(ac, dest, t0, { f0: 115 * p.pitch, f1: 42, dur: 0.14 + 0.08 * I, peak: 0.28 + 0.4 * I, attack: 0.001, sat: 0.15 });
  noiseBurst(ac, dest, t0, { kind: 'pink', dur: 0.1 + 0.05 * I, peak: 0.18 + 0.2 * I, attack: 0.002, type: 'lowpass', f0: 900, f1: 300, rng: r });
  scatter(ac, dest, t0 + 0.02, { count: 4 + Math.round(4 * I), span: 0.12, peak: 0.06 * I, fLo: 1500, fHi: 4200, q: 3, hitDur: 0.025, rng: r });
};

// ─────────────────────────────────────────────────────────────────────────────
// Daño al jugador
// ─────────────────────────────────────────────────────────────────────────────
/** Gruñido corto del jugador (voz masculina grave con aire). ~19 nodos. */
function grunt(ac: BaseAudioContext, dest: AudioNode, t: number, r: () => number, o: { peak: number; f0: number; f1: number; dur: number; breath?: number }): void {
  formantVoice(ac, dest, t, {
    dur: o.dur, peak: o.peak, f0: [o.f0 * vary(r, 1, 0.05), o.f1], wave: 'sawtooth', sat: 0.12,
    formants: [
      { from: 650, to: 520, q: 5, gain: 0.9 },
      { from: 1100, to: 950, q: 7, gain: 0.5 },
      { from: 2500, to: 2400, q: 8, gain: 0.18 },
    ],
    vib: { rate: 22, depth: 0.012 }, breath: o.breath ?? 0.2, env: [[0, 0], [0.1, 1], [0.55, 0.7], [1, 0]], rng: r,
  });
}

const hurtMelee: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  const I = 0.55 + 0.45 * p.intensity;
  thunk(ac, dest, t0, r, { peak: 0.42 * I, f: 105, dur: 0.09 });
  noiseBurst(ac, dest, t0, { kind: 'pink', dur: 0.09, peak: 0.2 * I, attack: 0.002, type: 'lowpass', f0: 1000, f1: 350, rng: r });
  grunt(ac, dest, t0 + 0.02, r, { peak: 0.3 * I, f0: 128 * p.pitch, f1: 92, dur: 0.24 });
};

const hurtArmor: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  const I = 0.55 + 0.45 * p.intensity;
  thunk(ac, dest, t0, r, { peak: 0.46 * I, f: 88, dur: 0.11 });
  partials(ac, dest, t0, { f: 210 * p.pitch, ratios: [1, 2.5, 4.2], decay: 0.17, peak: 0.16 * I });
  scatter(ac, dest, t0 + 0.01, { count: 5, span: 0.1, peak: 0.08 * I, fLo: 1800, fHi: 4200, q: 2.5, hitDur: 0.02, rng: r });
  grunt(ac, dest, t0 + 0.03, r, { peak: 0.16 * I, f0: 118 * p.pitch, f1: 90, dur: 0.2, breath: 0.1 });
};

const hurtSpit: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  noiseBurst(ac, dest, t0, { kind: 'pink', dur: 0.1, peak: 0.28, attack: 0.002, type: 'lowpass', f0: 1400, f1: 400, rng: r });
  noiseBurst(ac, dest, t0 + 0.02, { dur: 0.42, peak: 0.13, attack: 0.02, type: 'highpass', f0: 3200, f1: 5200, q: 0.6, rng: r });
  pingScatter(ac, dest, t0 + 0.03, { count: 6, span: 0.35, peak: 0.05, fLo: 600, fHi: 1700, hitDur: 0.05, bias: 1.4, rng: r });
  grunt(ac, dest, t0 + 0.03, r, { peak: 0.22, f0: 150 * p.pitch, f1: 105, dur: 0.22 });
};

const hurtHeavy: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  tone(ac, dest, t0, { f0: 78, f1: 34, dur: 0.32, peak: 0.6, attack: 0.002, sat: 0.25 });
  noiseBurst(ac, dest, t0, { kind: 'pink', dur: 0.26, peak: 0.3, attack: 0.002, type: 'lowpass', f0: 700, f1: 220, rng: r });
  grunt(ac, dest, t0 + 0.03, r, { peak: 0.34, f0: 135 * p.pitch, f1: 78, dur: 0.34, breath: 0.35 });
  tone(ac, dest, t0 + 0.04, { f0: 3400, dur: 0.7, peak: 0.028, attack: 0.02, curve: 'exp' });
};

const hurtToxic: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  scatter(ac, dest, t0, { count: 14, span: 0.22, peak: 0.1, fLo: 3000, fHi: 7000, type: 'highpass', q: 0.7, hitDur: 0.012, rng: r });
  noiseBurst(ac, dest, t0, { dur: 0.3, peak: 0.1, attack: 0.02, type: 'highpass', f0: 2800, rng: r });
  for (let i = 0; i < 2; i++) {
    noiseBurst(ac, dest, t0 + 0.04 + i * 0.16, { kind: 'pink', dur: 0.13, peak: 0.2, attack: 0.008, type: 'bandpass', f0: 900 * vary(r, 1, 0.1), f1: 500, q: 2, rng: r });
    tone(ac, dest, t0 + 0.04 + i * 0.16, { type: 'sawtooth', f0: 150, f1: 95, dur: 0.12, peak: 0.07, attack: 0.008, lp: 900 });
  }
};

const hurtFall: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  const I = 0.55 + 0.45 * p.intensity;
  tone(ac, dest, t0, { f0: 95, f1: 42, dur: 0.18, peak: 0.5 * I, attack: 0.001, sat: 0.2 });
  noiseBurst(ac, dest, t0, { kind: 'pink', dur: 0.13, peak: 0.25 * I, attack: 0.002, type: 'lowpass', f0: 800, f1: 260, rng: r });
  scatter(ac, dest, t0 + 0.005, { count: 3, span: 0.06, peak: 0.14 * I, fLo: 1500, fHi: 2400, q: 3, hitDur: 0.015, rng: r });
  grunt(ac, dest, t0 + 0.04, r, { peak: 0.22 * I, f0: 150, f1: 80, dur: 0.3, breath: 0.55 });
};

const playerDeath: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  tone(ac, dest, t0, { f0: 100, f1: 30, dur: 0.6, peak: 0.6, attack: 0.004, sat: 0.2 });
  noiseBurst(ac, dest, t0, { kind: 'brown', dur: 0.9, peak: 0.5, attack: 0.01, type: 'lowpass', f0: 380, f1: 100, rng: r });
  formantVoice(ac, dest, t0 + 0.15, {
    dur: 0.9, peak: 0.12, f0: [110, 70], wave: 'sawtooth', breath: 0.9,
    formants: [{ from: 600, to: 400, q: 4, gain: 0.8 }, { from: 1000, to: 800, q: 6, gain: 0.4 }],
    env: [[0, 0], [0.2, 1], [1, 0]], rng: r,
  });
  tone(ac, dest, t0 + 0.3, { f0: 330, f1: 110, dur: 1.1, peak: 0.05, attack: 0.05, lp: 1200, curve: 'exp' });
};

const playerHeal: Recipe = (ac, dest, t0, p) => {
  tone(ac, dest, t0, { f0: 440 * p.pitch, dur: 0.32, peak: 0.07, attack: 0.03, lp: 2400 });
  tone(ac, dest, t0 + 0.08, { f0: 660 * p.pitch, dur: 0.4, peak: 0.06, attack: 0.04, lp: 2600 });
  pingScatter(ac, dest, t0 + 0.05, { count: 4, span: 0.3, peak: 0.03, fLo: 2600, fHi: 4200, hitDur: 0.18, rng: p.rng });
};

/** Un latido «lub-dub» grave. */
const heartBeat: Recipe = (ac, dest, t0, p) => {
  const I = p.intensity;
  tone(ac, dest, t0, { f0: 66, f1: 40, dur: 0.12, peak: 0.85 * I, attack: 0.008, lp: 160 });
  tone(ac, dest, t0 + 0.14, { f0: 58, f1: 38, dur: 0.14, peak: 0.6 * I, attack: 0.008, lp: 150 });
  noiseBurst(ac, dest, t0, { kind: 'brown', dur: 0.1, peak: 0.2 * I, attack: 0.006, type: 'lowpass', f0: 180, rng: p.rng });
};

// ─────────────────────────────────────────────────────────────────────────────
// Recogidas
// ─────────────────────────────────────────────────────────────────────────────
const pickupCash: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  const f = 2400 * vary(r, 1, 0.05) * p.pitch;
  partials(ac, dest, t0, { f, ratios: [1, 2.71, 5.1], decay: 0.3, peak: 0.16, attack: 0.0008, damp: 0.8 });
  partials(ac, dest, t0 + 0.065, { f: f * 1.26, ratios: [1, 2.71, 5.1], decay: 0.34, peak: 0.13, attack: 0.0008, damp: 0.8 });
  pingScatter(ac, dest, t0 + 0.03, { count: 4, span: 0.16, peak: 0.05, fLo: 3200, fHi: 5400, hitDur: 0.08, rng: r });
  mechClick(ac, dest, t0, r, { peak: 0.1, f: 3200, ring: 0 });
};

const pickupAmmo: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  scatter(ac, dest, t0, { count: 7, span: 0.14, peak: 0.16, fLo: 3000, fHi: 6200, q: 4, hitDur: 0.03, rng: r });
  mechClick(ac, dest, t0 + 0.05, r, { peak: 0.26, f: 1400 });
  thunk(ac, dest, t0 + 0.052, r, { peak: 0.18, f: 170, dur: 0.04, noise: false });
};

const pickupPlate: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  partials(ac, dest, t0, { f: 300 * p.pitch, ratios: [1, 2.32, 4.18], decay: 0.26, peak: 0.2, damp: 0.9 });
  rasp(ac, dest, t0 + 0.04, r, { dur: 0.12, peak: 0.09, f0: 2200, f1: 3800, q: 0.7 });
  thunk(ac, dest, t0, r, { peak: 0.3, f: 120, dur: 0.07 });
};

const pickupGrenade: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  partials(ac, dest, t0, { f: 900 * p.pitch, ratios: [1, 2.76, 5.4], decay: 0.26, peak: 0.18, damp: 0.9 });
  mechClick(ac, dest, t0, r, { peak: 0.2, f: 2400 });
  partials(ac, dest, t0 + 0.07, { f: 3400, ratios: [1, 2.4], decay: 0.1, peak: 0.08 });
};

const pickupMedkit: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  mechClick(ac, dest, t0, r, { peak: 0.2, f: 900, ring: 0 });
  thunk(ac, dest, t0, r, { peak: 0.16, f: 240, dur: 0.05, noise: false });
  rasp(ac, dest, t0 + 0.05, r, { dur: 0.16, peak: 0.07, f0: 2500, f1: 5000, q: 0.8 });
  tone(ac, dest, t0 + 0.12, { f0: 523 * p.pitch, dur: 0.3, peak: 0.07, attack: 0.015, lp: 2600 });
  tone(ac, dest, t0 + 0.2, { f0: 784 * p.pitch, dur: 0.32, peak: 0.06, attack: 0.015, lp: 2800 });
};

// ─────────────────────────────────────────────────────────────────────────────
// Impactos de bala por superficie (posicionales)
// ─────────────────────────────────────────────────────────────────────────────
function impactRecipe(surface: SurfaceKind): Recipe {
  return (ac, dest, t0, p) => {
    const r = p.rng;
    const k = p.pitch * vary(r, 1, 0.08);
    const I = 0.6 + 0.4 * p.intensity;
    switch (surface) {
      case 'concrete':
        noiseBurst(ac, dest, t0, { dur: 0.014, peak: 0.34 * I, attack: 0.0005, type: 'bandpass', f0: 3200 * k, q: 1.2, rng: r });
        noiseBurst(ac, dest, t0, { kind: 'pink', dur: 0.11, peak: 0.16 * I, attack: 0.003, type: 'lowpass', f0: 2200, f1: 800, rng: r });
        scatter(ac, dest, t0 + 0.02, { count: 6, span: 0.17, peak: 0.07 * I, fLo: 1800, fHi: 5200, q: 1.6, hitDur: 0.014, bias: 1.6, rng: r });
        tone(ac, dest, t0, { f0: 180 * k, f1: 90, dur: 0.035, peak: 0.16 * I, attack: 0.001 });
        break;
      case 'asphalt':
        noiseBurst(ac, dest, t0, { dur: 0.016, peak: 0.3 * I, attack: 0.0005, type: 'bandpass', f0: 2400 * k, q: 1.0, rng: r });
        noiseBurst(ac, dest, t0, { kind: 'pink', dur: 0.12, peak: 0.16 * I, attack: 0.003, type: 'lowpass', f0: 1600, f1: 600, rng: r });
        scatter(ac, dest, t0 + 0.02, { count: 5, span: 0.14, peak: 0.06 * I, fLo: 1500, fHi: 3600, q: 1.2, hitDur: 0.014, bias: 1.5, rng: r });
        tone(ac, dest, t0, { f0: 150 * k, f1: 80, dur: 0.04, peak: 0.18 * I, attack: 0.001 });
        break;
      case 'metal':
        noiseBurst(ac, dest, t0, { dur: 0.009, peak: 0.3 * I, attack: 0.0004, type: 'bandpass', f0: 3800 * k, q: 2, rng: r });
        partials(ac, dest, t0, { f: between(r, 1000, 1700) * k, ratios: [1, 2.39, 3.83, 5.4], decay: 0.24, peak: 0.24 * I, attack: 0.0006, damp: 1.1 });
        thunk(ac, dest, t0, r, { peak: 0.16 * I, f: 200, dur: 0.03, noise: false });
        break;
      case 'dirt':
        tone(ac, dest, t0, { f0: 115 * k, f1: 55, dur: 0.1, peak: 0.3 * I, attack: 0.002 });
        noiseBurst(ac, dest, t0, { kind: 'pink', dur: 0.12, peak: 0.24 * I, attack: 0.003, type: 'lowpass', f0: 800 * k, f1: 320, rng: r });
        scatter(ac, dest, t0 + 0.02, { count: 7, span: 0.14, peak: 0.045 * I, fLo: 1500, fHi: 3500, q: 0.9, hitDur: 0.012, rng: r });
        break;
      case 'flesh':
        noiseBurst(ac, dest, t0, { kind: 'pink', dur: 0.1, peak: 0.32 * I, attack: 0.002, type: 'lowpass', f0: 900 * k, f1: 300, rng: r });
        tone(ac, dest, t0, { f0: 135 * k, f1: 60, dur: 0.1, peak: 0.34 * I, attack: 0.001 });
        noiseBurst(ac, dest, t0 + 0.008, { dur: 0.09, peak: 0.1 * I, attack: 0.012, type: 'bandpass', f0: 400, f1: 1100, q: 3, rng: r });
        break;
      case 'glass':
        noiseBurst(ac, dest, t0, { dur: 0.035, peak: 0.32 * I, attack: 0.0005, type: 'highpass', f0: 3000, rng: r });
        pingScatter(ac, dest, t0 + 0.01, { count: 9, span: 0.35, peak: 0.1 * I, fLo: 3000, fHi: 8500, hitDur: 0.09, fall: 0.4, rng: r });
        scatter(ac, dest, t0 + 0.01, { count: 16, span: 0.28, peak: 0.08 * I, fLo: 5000, fHi: 9500, type: 'highpass', q: 0.7, hitDur: 0.012, bias: 1.3, rng: r });
        break;
      case 'wood':
        tone(ac, dest, t0, { type: 'triangle', f0: 270 * k, f1: 150, dur: 0.06, peak: 0.3 * I, attack: 0.001 });
        partials(ac, dest, t0, { f: 480 * k, ratios: [1, 1.6], decay: 0.08, peak: 0.12 * I });
        noiseBurst(ac, dest, t0, { dur: 0.022, peak: 0.22 * I, attack: 0.0005, type: 'bandpass', f0: 2500 * k, q: 1.5, rng: r });
        scatter(ac, dest, t0 + 0.02, { count: 3, span: 0.08, peak: 0.04 * I, fLo: 2000, fHi: 4000, hitDur: 0.012, rng: r });
        break;
      case 'water':
        noiseBurst(ac, dest, t0, { dur: 0.1, peak: 0.2 * I, attack: 0.004, type: 'bandpass', f0: 1400 * k, f1: 3000, q: 0.9, rng: r });
        pingScatter(ac, dest, t0 + 0.01, { count: 3, span: 0.08, peak: 0.09 * I, fLo: 700, fHi: 1600, hitDur: 0.04, rng: r });
        noiseBurst(ac, dest, t0, { kind: 'pink', dur: 0.16, peak: 0.1 * I, attack: 0.01, type: 'lowpass', f0: 1000, f1: 400, rng: r });
        break;
    }
  };
}

/** Rebote/zumbido de bala (metal, hormigón): barrido descendente con leve vibrato. */
const ricochet: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  const f = between(r, 2600, 3800) * p.pitch;
  tone(ac, dest, t0 + 0.004, { f0: f, f1: f * 0.38, dur: between(r, 0.18, 0.32), peak: 0.1, attack: 0.002, lp: 5000 });
  noiseBurst(ac, dest, t0 + 0.004, { dur: 0.15, peak: 0.05, attack: 0.002, type: 'bandpass', f0: f * 0.8, f1: f * 0.3, q: 4, rng: r });
};

// Cabeza / casco / armadura (golpes sobre enemigos)
const impactHead: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  noiseBurst(ac, dest, t0, { kind: 'pink', dur: 0.09, peak: 0.34, attack: 0.001, type: 'lowpass', f0: 1100, f1: 320, rng: r });
  tone(ac, dest, t0, { f0: 150, f1: 62, dur: 0.1, peak: 0.36, attack: 0.001 });
  noiseBurst(ac, dest, t0, { dur: 0.03, peak: 0.28, attack: 0.0005, type: 'bandpass', f0: 2300 * vary(r, 1, 0.1), q: 3, rng: r });
  noiseBurst(ac, dest, t0 + 0.012, { dur: 0.1, peak: 0.1, attack: 0.012, type: 'bandpass', f0: 450, f1: 1200, q: 3, rng: r });
};

const impactHelmet: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  const k = p.pitch * vary(r, 1, 0.06);
  partials(ac, dest, t0, { f: 620 * k, ratios: [1, 2.32, 3.7, 5.1], decay: 0.42, peak: 0.34, attack: 0.0006, damp: 0.8 });
  noiseBurst(ac, dest, t0, { dur: 0.012, peak: 0.36, attack: 0.0004, type: 'bandpass', f0: 3400, q: 1.4, rng: r });
  thunk(ac, dest, t0, r, { peak: 0.26, f: 130, dur: 0.05, noise: false });
};

const impactArmor: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  const k = p.pitch * vary(r, 1, 0.06);
  partials(ac, dest, t0, { f: 240 * k, ratios: [1, 2.4, 3.9], decay: 0.22, peak: 0.26, attack: 0.0008, damp: 0.9 });
  thunk(ac, dest, t0, r, { peak: 0.34, f: 110, dur: 0.06 });
  noiseBurst(ac, dest, t0, { dur: 0.014, peak: 0.24, attack: 0.0005, type: 'bandpass', f0: 2600, q: 1.6, rng: r });
};

// ─────────────────────────────────────────────────────────────────────────────
// Marcadores de impacto (retroalimentación del punto de mira, no espacial)
// ─────────────────────────────────────────────────────────────────────────────
const hitTick = (f: number, peak: number): Recipe => (ac, dest, t0, p) => {
  tone(ac, dest, t0, { type: 'square', f0: f * p.pitch, f1: f * 0.6 * p.pitch, dur: 0.028, peak: peak * 0.5, attack: 0.0006, lp: 5200 });
  mechClick(ac, dest, t0, p.rng, { peak: peak * 0.7, f: 3400, ring: 0 });
};

const hitHead: Recipe = (ac, dest, t0, p) => {
  partials(ac, dest, t0, { f: 1760 * p.pitch, ratios: [1, 1.5, 2.01], amps: [1, 0.5, 0.35], decay: 0.16, peak: 0.2, attack: 0.0007 });
  mechClick(ac, dest, t0, p.rng, { peak: 0.14, f: 4000, ring: 0 });
};

const hitKill: Recipe = (ac, dest, t0, p) => {
  tone(ac, dest, t0, { f0: 230 * p.pitch, f1: 110, dur: 0.11, peak: 0.26, attack: 0.001, sat: 0.1 });
  mechClick(ac, dest, t0, p.rng, { peak: 0.16, f: 2400, ring: 0 });
  tone(ac, dest, t0 + 0.05, { f0: 880 * p.pitch, dur: 0.1, peak: 0.07, attack: 0.002, lp: 3000 });
};

const hitHelmet: Recipe = (ac, dest, t0, p) => {
  partials(ac, dest, t0, { f: 2900 * p.pitch, ratios: [1, 2.6, 4.4], decay: 0.14, peak: 0.16, attack: 0.0006 });
  mechClick(ac, dest, t0, p.rng, { peak: 0.14, f: 4200, ring: 0 });
};

// ─────────────────────────────────────────────────────────────────────────────
// Caídas de cuerpos
// ─────────────────────────────────────────────────────────────────────────────
const bodyFall: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  tone(ac, dest, t0, { f0: 92 * p.pitch, f1: 46, dur: 0.17, peak: 0.42, attack: 0.002 });
  noiseBurst(ac, dest, t0, { kind: 'pink', dur: 0.15, peak: 0.26, attack: 0.004, type: 'lowpass', f0: 620, f1: 240, rng: r });
  scatter(ac, dest, t0 + 0.03, { kind: 'pink', count: 5, span: 0.14, peak: 0.06, fLo: 700, fHi: 1800, q: 1.0, hitDur: 0.03, rng: r });
};

const bodyFallHeavy: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  tone(ac, dest, t0, { f0: 62 * p.pitch, f1: 30, dur: 0.34, peak: 0.62, attack: 0.003, sat: 0.2 });
  noiseBurst(ac, dest, t0, { kind: 'brown', dur: 0.3, peak: 0.42, attack: 0.006, type: 'lowpass', f0: 450, f1: 150, rng: r });
  scatter(ac, dest, t0 + 0.05, { count: 8, span: 0.3, peak: 0.1, fLo: 500, fHi: 1600, q: 1.0, hitDur: 0.05, bias: 1.4, rng: r });
};

const bodyFallWarden: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  tone(ac, dest, t0, { f0: 55 * p.pitch, f1: 25, dur: 0.5, peak: 0.75, attack: 0.004, sat: 0.3 });
  noiseBurst(ac, dest, t0, { kind: 'brown', dur: 0.6, peak: 0.5, attack: 0.008, type: 'lowpass', f0: 420, f1: 110, rng: r });
  partials(ac, dest, t0 + 0.02, { f: 160, ratios: [1, 2.4, 3.9, 5.5], decay: 0.6, peak: 0.28, damp: 0.9 });
  pingScatter(ac, dest, t0 + 0.1, { count: 7, span: 0.55, peak: 0.06, fLo: 800, fHi: 2600, hitDur: 0.12, fall: 0.5, rng: r });
  scatter(ac, dest, t0 + 0.05, { count: 10, span: 0.5, peak: 0.12, fLo: 500, fHi: 2200, q: 1.2, hitDur: 0.05, bias: 1.4, rng: r });
};

// ─────────────────────────────────────────────────────────────────────────────
export function foleyRecipes(): RecipeDef[] {
  const defs: RecipeDef[] = [];
  for (const s of SURFACES) {
    defs.push(defineRecipe(`step.${s}`, 'step', 45, s === 'water' ? 0.22 : 0.26, stepRecipe(s), { send: 0.1, minDur: 0.06 }));
    defs.push(defineRecipe(`impact.${s}`, 'impact', 40, s === 'glass' ? 0.6 : 0.4, impactRecipe(s), { send: 0.2, range: 90, minDur: 0.05 }));
  }
  defs.push(
    defineRecipe('player.jump', 'foley', 40, 0.14, playerJump, { send: 0.05 }),
    defineRecipe('player.land', 'foley', 55, 0.3, playerLand, { send: 0.1 }),
    defineRecipe('hurt.melee', 'foley', 80, 0.4, hurtMelee, { send: 0.08 }),
    defineRecipe('hurt.armor', 'foley', 80, 0.4, hurtArmor, { send: 0.08 }),
    defineRecipe('hurt.spit', 'foley', 80, 0.55, hurtSpit, { send: 0.08 }),
    defineRecipe('hurt.heavy', 'foley', 90, 0.8, hurtHeavy, { send: 0.14 }),
    defineRecipe('hurt.toxic', 'foley', 70, 0.5, hurtToxic, { send: 0.06 }),
    defineRecipe('hurt.fall', 'foley', 85, 0.5, hurtFall, { send: 0.08 }),
    defineRecipe('player.death', 'foley', 96, 1.9, playerDeath, { send: 0.18, minDur: 0.5 }),
    defineRecipe('player.heal', 'foley', 45, 0.55, playerHeal, { send: 0.12 }),
    defineRecipe('heart.beat', 'foley', 66, 0.4, heartBeat, { send: 0.03, minDur: 0.1 }),
    defineRecipe('pickup.cash', 'pickup', 50, 0.55, pickupCash, { send: 0.14 }),
    defineRecipe('pickup.ammo', 'pickup', 50, 0.3, pickupAmmo, { send: 0.08 }),
    defineRecipe('pickup.plate', 'pickup', 50, 0.45, pickupPlate, { send: 0.08 }),
    defineRecipe('pickup.grenade', 'pickup', 50, 0.4, pickupGrenade, { send: 0.1 }),
    defineRecipe('pickup.medkit', 'pickup', 50, 0.55, pickupMedkit, { send: 0.1 }),
    defineRecipe('impact.ricochet', 'impact', 30, 0.4, ricochet, { send: 0.3, range: 90 }),
    defineRecipe('impact.head', 'impact', 46, 0.2, impactHead, { send: 0.18, range: 90 }),
    defineRecipe('impact.helmet', 'impact', 60, 0.5, impactHelmet, { send: 0.26, range: 100 }),
    defineRecipe('impact.armor', 'impact', 52, 0.3, impactArmor, { send: 0.2, range: 90 }),
    defineRecipe('hit.body', 'ui', 62, 0.06, hitTick(1900, 0.2), { bus: 'ui', send: 0 }),
    defineRecipe('hit.limb', 'ui', 62, 0.06, hitTick(1300, 0.16), { bus: 'ui', send: 0 }),
    defineRecipe('hit.head', 'ui', 66, 0.25, hitHead, { bus: 'ui', send: 0.05 }),
    defineRecipe('hit.kill', 'ui', 66, 0.2, hitKill, { bus: 'ui', send: 0.03 }),
    defineRecipe('hit.helmet', 'ui', 66, 0.2, hitHelmet, { bus: 'ui', send: 0.03 }),
    defineRecipe('body.fall', 'body', 44, 0.4, bodyFall, { send: 0.15, range: 60 }),
    defineRecipe('body.fall.heavy', 'body', 55, 0.65, bodyFallHeavy, { send: 0.2, range: 90 }),
    defineRecipe('body.fall.warden', 'body', 80, 1.2, bodyFallWarden, { send: 0.25, range: 120 }),
  );
  return defs;
}
