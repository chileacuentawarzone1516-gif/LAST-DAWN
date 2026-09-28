/**
 * Primitivas de síntesis sobre WebAudio. Todo recibe el contexto base (`BaseAudioContext`) para
 * funcionar igual con AudioContext y OfflineAudioContext. La lógica pura (envolventes, tablas,
 * generación de ruido/IR/curvas) vive en `pure.ts`.
 */
import type { Rng } from '../core/util';
import { NEUTRAL_VOICE, fillNoise, generateIr, saturationCurve, softClipCurve } from './pure';
import type { IrSpec, NoiseKind } from './pure';
import type { RecipeParams } from './types';

/** Suelo de las rampas exponenciales (−80 dB). */
export const FLOOR = 1e-4;
const NOISE_SECONDS = 2;
const NOISE_SEED: Record<NoiseKind, number> = { white: 0x1a2b3c, pink: 0x4d5e6f, brown: 0x778899 };

// ─────────────────────────────────────────────────────────────────────────────
// Buffers cacheados por contexto
// ─────────────────────────────────────────────────────────────────────────────
const noiseBanks = new WeakMap<BaseAudioContext, Partial<Record<NoiseKind, AudioBuffer>>>();

/** Buffer de ruido (blanco/rosa/marrón) de 2 s, generado una vez por contexto y apto para bucle. */
export function noiseBuffer(ac: BaseAudioContext, kind: NoiseKind): AudioBuffer {
  let bank = noiseBanks.get(ac);
  if (!bank) {
    bank = {};
    noiseBanks.set(ac, bank);
  }
  let buf = bank[kind];
  if (!buf) {
    const len = Math.floor(ac.sampleRate * NOISE_SECONDS);
    buf = ac.createBuffer(1, len, ac.sampleRate);
    buf.getChannelData(0).set(fillNoise(kind, len, NOISE_SEED[kind]));
    bank[kind] = buf;
  }
  return buf;
}

/** Modo ligero (móvil): sin sobremuestreo en los WaveShaper. */
let liteMode = false;
export function setLiteMode(v: boolean): void {
  liteMode = v;
}

const curveCache = new Map<string, Float32Array<ArrayBuffer>>();

function cachedCurve(key: string, make: () => Float32Array): Float32Array<ArrayBuffer> {
  let c = curveCache.get(key);
  if (!c) {
    const src = make();
    c = new Float32Array(new ArrayBuffer(src.length * 4));
    c.set(src);
    curveCache.set(key, c);
  }
  return c;
}

/** WaveShaper de saturación suave (curva cacheada por cantidad redondeada a 0.05). */
export function saturator(ac: BaseAudioContext, amount: number): WaveShaperNode {
  const a = Math.round(Math.max(0.02, amount) * 20) / 20;
  const sh = ac.createWaveShaper();
  sh.curve = cachedCurve(`sat:${a}`, () => saturationCurve(1025, a));
  sh.oversample = liteMode ? 'none' : '2x';
  return sh;
}

/** Recortador de seguridad final (nunca supera ±1). */
export function safetyClipper(ac: BaseAudioContext): WaveShaperNode {
  const sh = ac.createWaveShaper();
  sh.curve = cachedCurve('clip', () => softClipCurve(2049));
  sh.oversample = liteMode ? 'none' : '2x';
  return sh;
}

/** Reverb por convolución con IR generada por código (estéreo, cola de ~2 s). */
export function createReverb(ac: BaseAudioContext, spec?: IrSpec): ConvolverNode {
  const ir = generateIr(ac.sampleRate, spec);
  const buf = ac.createBuffer(2, ir.left.length, ac.sampleRate);
  buf.getChannelData(0).set(ir.left);
  buf.getChannelData(1).set(ir.right);
  const conv = ac.createConvolver();
  conv.buffer = buf;
  return conv;
}

// ─────────────────────────────────────────────────────────────────────────────
// Nodos básicos
// ─────────────────────────────────────────────────────────────────────────────
export function osc(ac: BaseAudioContext, type: OscillatorType, freq: number, t0: number, t1: number): OscillatorNode {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  o.start(t0);
  o.stop(t1);
  return o;
}

/** Fuente de ruido en bucle con desplazamiento aleatorio (cada uso suena distinto). */
export function noiseSrc(ac: BaseAudioContext, kind: NoiseKind, t0: number, dur: number, rng: Rng): AudioBufferSourceNode {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, kind);
  src.loop = true;
  src.start(t0, rng() * NOISE_SECONDS * 0.95);
  src.stop(t0 + dur);
  return src;
}

export function gainNode(ac: BaseAudioContext, value = 1): GainNode {
  const g = ac.createGain();
  g.gain.value = value;
  return g;
}

export function biquad(ac: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** Conecta en serie y devuelve el último nodo. */
export function link(...nodes: AudioNode[]): AudioNode {
  for (let i = 0; i < nodes.length - 1; i++) (nodes[i] as AudioNode).connect(nodes[i + 1] as AudioNode);
  return nodes[nodes.length - 1] as AudioNode;
}

// ─────────────────────────────────────────────────────────────────────────────
// Automatización de parámetros
// ─────────────────────────────────────────────────────────────────────────────
/** Barrido de un parámetro de `from` a `to` durante `dur` s (exponencial por defecto). */
export function sweep(p: AudioParam, t0: number, from: number, to: number, dur: number, curve: 'exp' | 'lin' = 'exp'): void {
  if (curve === 'exp') {
    p.setValueAtTime(Math.max(FLOOR, from), t0);
    p.exponentialRampToValueAtTime(Math.max(FLOOR, to), t0 + Math.max(0.001, dur));
  } else {
    p.setValueAtTime(from, t0);
    p.linearRampToValueAtTime(to, t0 + Math.max(0.001, dur));
  }
}

/** Puntos [dt, valor] relativos a t0, unidos por rampas lineales o exponenciales. */
export function ramp(p: AudioParam, t0: number, pts: ReadonlyArray<readonly [number, number]>, curve: 'lin' | 'exp' = 'lin'): void {
  for (let i = 0; i < pts.length; i++) {
    const [dt, v0] = pts[i] as readonly [number, number];
    const v = curve === 'exp' ? Math.max(FLOOR, v0) : v0;
    if (i === 0) p.setValueAtTime(v, t0 + dt);
    else if (curve === 'exp') p.exponentialRampToValueAtTime(v, t0 + dt);
    else p.linearRampToValueAtTime(v, t0 + dt);
  }
}

/** Ganancia con envolvente percusiva: subida lineal + caída exponencial. Devuelve el nodo. */
export function percGain(ac: BaseAudioContext, t0: number, peak: number, attack: number, decay: number): GainNode {
  const g = ac.createGain();
  const a = Math.max(0.0008, attack);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(Math.max(FLOOR * 2, peak), t0 + a);
  g.gain.exponentialRampToValueAtTime(FLOOR, t0 + a + Math.max(0.005, decay));
  g.gain.setValueAtTime(0, t0 + a + Math.max(0.005, decay) + 0.004);
  return g;
}

/** Ganancia con envolvente por puntos [dt, nivel] (lineal). */
export function shapeGain(ac: BaseAudioContext, t0: number, pts: ReadonlyArray<readonly [number, number]>): GainNode {
  const g = ac.createGain();
  ramp(g.gain, t0, pts, 'lin');
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bloques de construcción de recetas
// ─────────────────────────────────────────────────────────────────────────────
export interface NoiseBurstOpts {
  kind?: NoiseKind;
  dur: number;
  peak: number;
  attack?: number;
  type?: BiquadFilterType;
  f0: number;
  /** Frecuencia final del barrido (exponencial en `dur`). */
  f1?: number;
  q?: number;
  /** Segundo filtro en serie (para acotar banda). */
  type2?: BiquadFilterType;
  f2?: number;
  q2?: number;
  /** Retardo (s) respecto a t0. */
  delay?: number;
  rng: Rng;
}

/** Ráfaga de ruido filtrada con envolvente percusiva. 3–4 nodos. */
export function noiseBurst(ac: BaseAudioContext, dest: AudioNode, t0: number, o: NoiseBurstOpts): void {
  const t = t0 + (o.delay ?? 0);
  const src = noiseSrc(ac, o.kind ?? 'white', t, o.dur + 0.03, o.rng);
  const f = ac.createBiquadFilter();
  f.type = o.type ?? 'lowpass';
  f.Q.value = o.q ?? 0.7;
  if (o.f1 !== undefined) sweep(f.frequency, t, o.f0, o.f1, o.dur);
  else f.frequency.setValueAtTime(o.f0, t);
  const g = percGain(ac, t, o.peak, o.attack ?? 0.002, o.dur);
  src.connect(f);
  if (o.type2 && o.f2 !== undefined) {
    const f2 = biquad(ac, o.type2, o.f2, o.q2 ?? 0.7);
    f.connect(f2);
    f2.connect(g);
  } else {
    f.connect(g);
  }
  g.connect(dest);
}

export interface ToneOpts {
  type?: OscillatorType;
  f0: number;
  f1?: number;
  dur: number;
  peak: number;
  attack?: number;
  /** Saturación 0..1 previa a la envolvente. */
  sat?: number;
  /** Paso-bajo opcional. */
  lp?: number;
  delay?: number;
  curve?: 'exp' | 'lin';
  detune?: number;
}

/** Tono con barrido de frecuencia y envolvente percusiva. 2–4 nodos. */
export function tone(ac: BaseAudioContext, dest: AudioNode, t0: number, o: ToneOpts): void {
  const t = t0 + (o.delay ?? 0);
  const end = t + (o.attack ?? 0.002) + o.dur + 0.02;
  const os = osc(ac, o.type ?? 'sine', o.f0, t, end);
  if (o.detune) os.detune.value = o.detune;
  if (o.f1 !== undefined) sweep(os.frequency, t, o.f0, o.f1, o.dur, o.curve ?? 'exp');
  const g = percGain(ac, t, o.peak, o.attack ?? 0.002, o.dur);
  let last: AudioNode = os;
  if (o.sat) last = link(last, saturator(ac, o.sat));
  if (o.lp) last = link(last, biquad(ac, 'lowpass', o.lp));
  link(last, g, dest);
}

export interface PartialsOpts {
  f: number;
  ratios: readonly number[];
  amps?: readonly number[];
  decay: number;
  peak: number;
  attack?: number;
  delay?: number;
  /** Cuánto más rápido decaen los parciales agudos (0 = igual). */
  damp?: number;
  type?: OscillatorType;
}

/** Parciales inarmónicos (metal, campana, moneda). 2 nodos por parcial. */
export function partials(ac: BaseAudioContext, dest: AudioNode, t0: number, o: PartialsOpts): void {
  const t = t0 + (o.delay ?? 0);
  const damp = o.damp ?? 0.6;
  for (let i = 0; i < o.ratios.length; i++) {
    const r = o.ratios[i] as number;
    const amp = o.amps?.[i] ?? 1 / (1 + i * 0.6);
    const dec = o.decay / (1 + i * damp);
    const os = osc(ac, o.type ?? 'sine', o.f * r, t, t + (o.attack ?? 0.001) + dec + 0.02);
    const g = percGain(ac, t, o.peak * amp, o.attack ?? 0.001, dec);
    link(os, g, dest);
  }
}

/** Clic seco: ráfaga de ruido agudo de 1–4 ms. */
export function click(ac: BaseAudioContext, dest: AudioNode, t0: number, o: { peak: number; f?: number; dur?: number; delay?: number; q?: number; rng: Rng }): void {
  noiseBurst(ac, dest, t0, {
    dur: o.dur ?? 0.006, peak: o.peak, attack: 0.0006, type: 'highpass', f0: o.f ?? 3000, q: o.q ?? 0.7, delay: o.delay, rng: o.rng,
  });
}

export interface ScatterOpts {
  kind?: NoiseKind;
  /** Número de golpecitos. */
  count: number;
  /** Ventana (s) en la que se reparten. */
  span: number;
  peak: number;
  /** Rango de frecuencia central de cada golpecito. */
  fLo: number;
  fHi: number;
  q?: number;
  type?: BiquadFilterType;
  /** Duración de cada golpecito (s). */
  hitDur: number;
  /** >1 concentra los golpes al principio (escombros, gravilla). */
  bias?: number;
  /** Cada golpe decae a esta fracción hacia el final (0..1). */
  fall?: number;
  delay?: number;
  rng: Rng;
}

/**
 * Muchos golpecitos de ruido (escombros, gravilla, casquillos, cristal) con SÓLO 3 nodos:
 * una fuente + un filtro + una ganancia con picos automatizados.
 */
export function scatter(ac: BaseAudioContext, dest: AudioNode, t0: number, o: ScatterOpts): void {
  const t = t0 + (o.delay ?? 0);
  const src = noiseSrc(ac, o.kind ?? 'white', t, o.span + o.hitDur * 2 + 0.05, o.rng);
  const f = ac.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.Q.value = o.q ?? 1.2;
  f.frequency.setValueAtTime(o.fLo, t);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  const times: number[] = [];
  for (let i = 0; i < o.count; i++) times.push(o.rng() ** (o.bias ?? 1) * o.span);
  times.sort((a, b) => a - b);
  let free = 0;
  for (let i = 0; i < times.length; i++) {
    const dur = o.hitDur * (0.6 + 0.8 * o.rng());
    const dt = Math.max(times[i] as number, free);
    if (dt > o.span + o.hitDur) break;
    const tt = t + dt;
    const k = 1 - (o.fall ?? 0) * (dt / Math.max(0.001, o.span));
    f.frequency.setValueAtTime(o.fLo + (o.fHi - o.fLo) * o.rng(), tt);
    g.gain.setValueAtTime(0, tt);
    g.gain.linearRampToValueAtTime(o.peak * k * (0.45 + 0.55 * o.rng()), tt + 0.0009);
    g.gain.exponentialRampToValueAtTime(FLOOR, tt + dur);
    free = dt + dur + 0.002;
  }
  link(src, f, g, dest);
}

export interface PingScatterOpts {
  type?: OscillatorType;
  count: number;
  span: number;
  peak: number;
  fLo: number;
  fHi: number;
  hitDur: number;
  bias?: number;
  fall?: number;
  delay?: number;
  rng: Rng;
}

/** Como `scatter`, pero con tonos (tintineo de cristal, monedas): un oscilador + una ganancia. */
export function pingScatter(ac: BaseAudioContext, dest: AudioNode, t0: number, o: PingScatterOpts): void {
  const t = t0 + (o.delay ?? 0);
  const os = osc(ac, o.type ?? 'sine', o.fLo, t, t + o.span + o.hitDur * 2 + 0.05);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  const times: number[] = [];
  for (let i = 0; i < o.count; i++) times.push(o.rng() ** (o.bias ?? 1) * o.span);
  times.sort((a, b) => a - b);
  let free = 0;
  for (let i = 0; i < times.length; i++) {
    const dur = o.hitDur * (0.7 + 0.6 * o.rng());
    const dt = Math.max(times[i] as number, free);
    if (dt > o.span + o.hitDur) break;
    const tt = t + dt;
    const k = 1 - (o.fall ?? 0) * (dt / Math.max(0.001, o.span));
    os.frequency.setValueAtTime(o.fLo + (o.fHi - o.fLo) * o.rng(), tt);
    g.gain.setValueAtTime(0, tt);
    g.gain.linearRampToValueAtTime(o.peak * k * (0.5 + 0.5 * o.rng()), tt + 0.0012);
    g.gain.exponentialRampToValueAtTime(FLOOR, tt + dur);
    free = dt + dur + 0.002;
  }
  link(os, g, dest);
}

export interface FmOpts {
  fc: number;
  fc1?: number;
  ratio: number;
  index: number;
  index1?: number;
  dur: number;
  peak: number;
  attack?: number;
  delay?: number;
  type?: OscillatorType;
}

/** Síntesis FM simple (portadora + moduladora). 5 nodos. */
export function fmTone(ac: BaseAudioContext, dest: AudioNode, t0: number, o: FmOpts): void {
  const t = t0 + (o.delay ?? 0);
  const end = t + (o.attack ?? 0.004) + o.dur + 0.03;
  const car = osc(ac, o.type ?? 'sine', o.fc, t, end);
  const mod = osc(ac, 'sine', o.fc * o.ratio, t, end);
  const mg = ac.createGain();
  mg.gain.setValueAtTime(o.fc * o.index, t);
  if (o.index1 !== undefined) mg.gain.linearRampToValueAtTime(o.fc * o.index1, t + o.dur);
  if (o.fc1 !== undefined) {
    sweep(car.frequency, t, o.fc, o.fc1, o.dur);
    sweep(mod.frequency, t, o.fc * o.ratio, o.fc1 * o.ratio, o.dur);
  }
  mod.connect(mg);
  mg.connect(car.frequency);
  link(car, percGain(ac, t, o.peak, o.attack ?? 0.004, o.dur), dest);
}

export interface FormantSpec {
  from: number;
  to: number;
  q: number;
  gain: number;
}

export interface VoiceOpts {
  dur: number;
  peak: number;
  /** Contorno de f0 (Hz) repartido uniformemente en `dur`. */
  f0: readonly number[];
  wave?: OscillatorType;
  formants: readonly FormantSpec[];
  vib?: { rate: number; depth: number };
  /** Modulación de amplitud áspera (gruñido). */
  rasp?: { rate: number; depth: number };
  fm?: { ratio: number; index: number };
  /** Ruido mezclado antes de los formantes (0..1 relativo). */
  breath?: number;
  sat?: number;
  /** Envolvente: puntos [t/dur, nivel]. */
  env?: ReadonlyArray<readonly [number, number]>;
  delay?: number;
  rng: Rng;
}

const DEFAULT_VOICE_ENV: ReadonlyArray<readonly [number, number]> = [[0, 0], [0.12, 1], [0.7, 0.75], [1, 0]];

/**
 * Voz sintética: portadora (con FM/vibrato opcionales) + ruido → saturación → banco de formantes
 * (pasa-banda en paralelo con barrido de vocal) → modulación de amplitud áspera → envolvente.
 * ≤ 22 nodos.
 */
export function formantVoice(ac: BaseAudioContext, dest: AudioNode, t0: number, o: VoiceOpts): void {
  const t = t0 + (o.delay ?? 0);
  const end = t + o.dur + 0.05;
  const n = o.f0.length;
  const meanF0 = o.f0.reduce((a, b) => a + b, 0) / n;

  const car = osc(ac, o.wave ?? 'sawtooth', o.f0[0] as number, t, end);
  for (let i = 1; i < n; i++) car.frequency.linearRampToValueAtTime(Math.max(20, o.f0[i] as number), t + (o.dur * i) / (n - 1));

  if (o.vib) {
    const lfo = osc(ac, 'sine', o.vib.rate, t, end);
    const lg = gainNode(ac, meanF0 * o.vib.depth);
    link(lfo, lg);
    lg.connect(car.frequency);
  }
  if (o.fm) {
    const mod = osc(ac, 'sine', (o.f0[0] as number) * o.fm.ratio, t, end);
    for (let i = 1; i < n; i++) mod.frequency.linearRampToValueAtTime(Math.max(20, (o.f0[i] as number) * o.fm.ratio), t + (o.dur * i) / (n - 1));
    const mg = gainNode(ac, meanF0 * o.fm.index);
    link(mod, mg);
    mg.connect(car.frequency);
  }

  const pre = gainNode(ac, 1);
  car.connect(pre);
  if (o.breath && o.breath > 0) {
    const ns = noiseSrc(ac, 'white', t, o.dur + 0.06, o.rng);
    const ng = gainNode(ac, o.breath * 0.9);
    link(ns, ng, pre);
  }
  let bankIn: AudioNode = pre;
  if (o.sat) bankIn = link(pre, saturator(ac, o.sat));

  const sum = gainNode(ac, 1);
  for (const f of o.formants) {
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = f.q;
    sweep(bp.frequency, t, f.from, f.to, o.dur);
    const fg = gainNode(ac, f.gain);
    bankIn.connect(bp);
    link(bp, fg, sum);
  }

  let tail: AudioNode = sum;
  if (o.rasp) {
    const am = gainNode(ac, 1 - o.rasp.depth * 0.5);
    const rl = osc(ac, 'sine', o.rasp.rate, t, end);
    const rg = gainNode(ac, o.rasp.depth * 0.5);
    link(rl, rg);
    rg.connect(am.gain);
    tail = link(sum, am);
  }
  const envPts = o.env ?? DEFAULT_VOICE_ENV;
  const env = ac.createGain();
  for (let i = 0; i < envPts.length; i++) {
    const [k, v] = envPts[i] as readonly [number, number];
    if (i === 0) env.gain.setValueAtTime(v * o.peak, t + k * o.dur);
    else env.gain.linearRampToValueAtTime(v * o.peak, t + k * o.dur);
  }
  link(tail, env, dest);
}

// ─────────────────────────────────────────────────────────────────────────────
// Parámetros de receta
// ─────────────────────────────────────────────────────────────────────────────
export function makeParams(rng: Rng, partial: Partial<Omit<RecipeParams, 'rng'>> = {}): RecipeParams {
  return {
    rng,
    intensity: partial.intensity ?? 1,
    pitch: partial.pitch ?? 1,
    duration: partial.duration ?? 0,
    alt: partial.alt ?? false,
    distance: partial.distance ?? 0,
    level: partial.level ?? 0,
    voice: partial.voice ?? NEUTRAL_VOICE,
  };
}
