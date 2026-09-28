/**
 * Lógica PURA del audio: sin WebAudio, sin DOM, sin three.js.
 * Todo lo que se puede decidir con números (notas, envolventes, limitador de voces,
 * variaciones con RNG, intensidad musical, latido, generación de ruido/IR/curvas) vive
 * aquí para poder testearlo con vitest (tests/audio.*.test.ts).
 */
import { clamp, clamp01, createRng, lerp, smoothstep } from '../core/util';
import type { Rng } from '../core/util';

// ─────────────────────────────────────────────────────────────────────────────
// Notas y frecuencias
// ─────────────────────────────────────────────────────────────────────────────
export const A4_HZ = 440;
export const A4_MIDI = 69;

const NOTE_OFFSET: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Nota MIDI → Hz (afinación temperada, A4 = 440). */
export function midiToHz(midi: number): number {
  return A4_HZ * 2 ** ((midi - A4_MIDI) / 12);
}

export function hzToMidi(hz: number): number {
  return A4_MIDI + 12 * Math.log2(hz / A4_HZ);
}

/** 'A4' | 'C#3' | 'Bb2' → número MIDI. Lanza RangeError si el formato no es válido. */
export function noteToMidi(note: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(note.trim());
  if (!m) throw new RangeError(`Nota inválida: "${note}"`);
  const base = NOTE_OFFSET[(m[1] as string).toUpperCase()] as number;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + base + acc;
}

export function noteToHz(note: string): number {
  return midiToHz(noteToMidi(note));
}

/** Razón de frecuencias para un intervalo en semitonos. */
export const semitoneRatio = (semitones: number): number => 2 ** (semitones / 12);
/** Razón de frecuencias para un desafinado en cents. */
export const centsRatio = (cents: number): number => 2 ** (cents / 1200);

export const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  pentatonicMinor: [0, 3, 5, 7, 10],
} as const satisfies Record<string, readonly number[]>;

/** Grado de escala (admite negativos y > longitud: salta de octava) → nota MIDI. */
export function scaleDegreeToMidi(root: number, scale: readonly number[], degree: number): number {
  const n = scale.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return root + oct * 12 + (scale[idx] as number);
}

// ─────────────────────────────────────────────────────────────────────────────
// Envolventes (puntos de quiebre) — la parte WebAudio sólo los aplica a un AudioParam
// ─────────────────────────────────────────────────────────────────────────────
export interface Adsr {
  attack: number;
  decay: number;
  /** Nivel de sostén relativo al pico (0..1). */
  sustain: number;
  release: number;
}

/** Nivel (0..1) de un ADSR lineal-exponencial `t` s tras el note-on con la puerta abierta `gate` s. */
export function adsrAt(env: Adsr, t: number, gate: number): number {
  if (t <= 0) return 0;
  const level = (tt: number): number => {
    if (tt < env.attack) return env.attack <= 0 ? 1 : tt / env.attack;
    const d = tt - env.attack;
    if (env.decay <= 0) return env.sustain;
    // decaimiento exponencial hacia el sostén (llega a ~1 % del salto en `decay`)
    return env.sustain + (1 - env.sustain) * Math.exp((-4.6 * d) / env.decay);
  };
  if (t <= gate) return level(t);
  const atGate = level(gate);
  const r = t - gate;
  if (env.release <= 0 || r >= env.release) return 0;
  return atGate * (1 - r / env.release) ** 2;
}

export type BreakpointCurve = 'lin' | 'exp';
export interface Breakpoint {
  /** Tiempo relativo al note-on (s). */
  t: number;
  v: number;
}

/**
 * Puntos de quiebre de un ADSR (para programar rampas lineales sobre un AudioParam).
 * Siempre estrictamente crecientes en t; el último punto vale 0.
 */
export function adsrBreakpoints(env: Adsr, gate: number, peak = 1): Breakpoint[] {
  const a = Math.max(0.001, env.attack);
  const d = Math.max(0.001, env.decay);
  const g = Math.max(a + d + 0.001, gate);
  const r = Math.max(0.001, env.release);
  return [
    { t: 0, v: 0 },
    { t: a, v: peak },
    { t: a + d, v: peak * env.sustain },
    { t: g, v: peak * env.sustain },
    { t: g + r, v: 0 },
  ];
}

/** Duración total de un ADSR con la puerta abierta `gate` s. */
export const adsrDuration = (env: Adsr, gate: number): number => Math.max(gate, env.attack + env.decay) + env.release;

/** Envolvente percusiva: puntos (subida lineal + caída exponencial discretizada). */
export function percBreakpoints(peak: number, attack: number, decay: number, steps = 6): Breakpoint[] {
  const pts: Breakpoint[] = [{ t: 0, v: 0 }, { t: Math.max(0.0005, attack), v: peak }];
  const a = pts[1]?.t ?? attack;
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    pts.push({ t: a + decay * k, v: peak * Math.exp(-6.9 * k) });
  }
  return pts;
}

/** Curva (0..1) de `n` muestras para setValueCurveAtTime: caída exponencial normalizada. */
export function decayCurve(n: number, sharpness = 5): Float32Array {
  const out = new Float32Array(Math.max(2, n));
  for (let i = 0; i < out.length; i++) out[i] = Math.exp((-sharpness * i) / (out.length - 1));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Curvas de distorsión / limitación (WaveShaper)
// ─────────────────────────────────────────────────────────────────────────────
/** Saturación suave: y = (1+k)x / (1+k|x|); k = amount*50. Impar, monótona, acotada por [-1,1]. */
export function saturationCurve(n: number, amount: number): Float32Array {
  const size = Math.max(3, n | 1);
  const k = Math.max(0, amount) * 50;
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    out[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return out;
}

/**
 * Recortador de seguridad: lineal hasta `knee`, después un cuarto de seno que llega a ±1
 * con pendiente 0. Cualquier entrada queda dentro de [-1, 1] por construcción.
 */
export function softClipCurve(n: number, knee = 0.75): Float32Array {
  const size = Math.max(3, n | 1);
  const out = new Float32Array(size);
  const span = 1 - knee;
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    const ax = Math.abs(x);
    const y = ax <= knee ? ax : knee + span * Math.sin(((ax - knee) / span) * (Math.PI / 2));
    out[i] = x < 0 ? -y : y;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Espacialidad
// ─────────────────────────────────────────────────────────────────────────────
export const SPEED_OF_SOUND = 343;

/** Atenuación del modelo 'inverse' de WebAudio (para estimar volumen sin crear nodos). */
export function inverseDistanceGain(dist: number, ref: number, max: number, rolloff = 1): number {
  const d = clamp(dist, ref, max);
  return ref / (ref + rolloff * (d - ref));
}

/** Desvanecimiento adicional cerca del alcance máximo para que llegue a 0 (no queda cola audible). */
export const rangeFade = (dist: number, max: number): number => 1 - smoothstep(0.62 * max, max, dist);

/** Frecuencia de corte del paso-bajo que simula la absorción del aire con la distancia. */
export function airCutoff(dist: number): number {
  return clamp(16000 * Math.exp(-Math.max(0, dist) / 55), 1200, 16000);
}

/** Retardo por velocidad del sonido (acotado para que un estruendo lejano no llegue demasiado tarde). */
export const soundDelay = (dist: number, cap = 0.45): number => Math.min(Math.max(0, dist) / SPEED_OF_SOUND, cap);

/** Razón de tono Doppler: `vToward` > 0 si la fuente se acerca al oyente (m/s). */
export function dopplerRatio(vToward: number, c = SPEED_OF_SOUND): number {
  return clamp(c / (c - clamp(vToward, -c * 0.5, c * 0.5)), 0.8, 1.25);
}

/** Envío de reverb de un sonido: crece con la distancia (más «lejano» = más húmedo). */
export function reverbSendFor(base: number, dist: number, fade = 1): number {
  return base * (0.35 + 0.65 * Math.min(1, dist / 50)) * fade;
}

// ─────────────────────────────────────────────────────────────────────────────
// Variaciones con RNG determinista
// ─────────────────────────────────────────────────────────────────────────────
/** Factor multiplicativo en [1-amount, 1+amount]. */
export const vary = (rng: Rng, base: number, amount: number): number => base * (1 + (rng() * 2 - 1) * amount);
export const between = (rng: Rng, lo: number, hi: number): number => lo + (hi - lo) * rng();
export const chance = (rng: Rng, p: number): boolean => rng() < p;

/**
 * Elige un índice de variación sin repetir el inmediatamente anterior (por clave).
 * Determinista dado el RNG.
 */
export class VariationPicker {
  private readonly last = new Map<string, number>();
  constructor(private readonly rng: Rng) {}

  pick(key: string, n: number): number {
    if (n <= 1) return 0;
    const prev = this.last.get(key) ?? -1;
    let i = Math.floor(this.rng() * n);
    if (i === prev) i = (i + 1 + Math.floor(this.rng() * (n - 1))) % n;
    this.last.set(key, i);
    return i;
  }

  reset(): void {
    this.last.clear();
  }
}

/** Elige un elemento evitando repetir el último (por clave). */
export function pickVariant<T>(picker: VariationPicker, key: string, items: readonly T[]): T {
  return items[picker.pick(key, items.length)] as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Limitador de voces (polifonía, prioridades, tasa por tipo)
// ─────────────────────────────────────────────────────────────────────────────
export interface CategoryLimit {
  /** Voces simultáneas máximas de la categoría. */
  max: number;
  /** Separación mínima (s) entre dos voces de la MISMA clave. */
  gap: number;
  /** Ráfaga: como máximo `burstMax` voces de la categoría cada `burstWindowS` s (0 = sin límite). */
  burstMax: number;
  burstWindowS: number;
}

export interface LimiterConfig {
  total: number;
  categories: Record<string, CategoryLimit>;
  fallback: CategoryLimit;
  /** Prioridad a partir de la cual se ignoran gap y ráfaga (sonidos críticos). */
  criticalPriority: number;
}

export interface VoiceRequest {
  key: string;
  category: string;
  /** 0..100: mayor gana al robar voz. */
  priority: number;
  /** Duración esperada (s). */
  dur: number;
  /** Tiempo actual (s, reloj del AudioContext). */
  now: number;
}

export type VoiceDecision =
  | { accepted: true; id: number; steal: number[] }
  | { accepted: false; reason: 'gap' | 'burst' | 'full' | 'priority' };

interface LimVoice {
  id: number;
  key: string;
  category: string;
  priority: number;
  start: number;
  end: number;
}

export class VoiceLimiter {
  private voices: LimVoice[] = [];
  private readonly lastByKey = new Map<string, number>();
  private readonly bursts = new Map<string, number[]>();
  private nextId = 1;

  constructor(private readonly cfg: LimiterConfig) {}

  private limitOf(category: string): CategoryLimit {
    return this.cfg.categories[category] ?? this.cfg.fallback;
  }

  /** Quita las voces terminadas; devuelve las que caducaron. */
  prune(now: number): number[] {
    const gone: number[] = [];
    const keep: LimVoice[] = [];
    for (const v of this.voices) {
      if (v.end <= now) gone.push(v.id);
      else keep.push(v);
    }
    this.voices = keep;
    return gone;
  }

  count(category?: string): number {
    if (category === undefined) return this.voices.length;
    let n = 0;
    for (const v of this.voices) if (v.category === category) n++;
    return n;
  }

  /** Voz de menor valor entre `pool` (menor prioridad; a igualdad, la más antigua). */
  private weakest(pool: LimVoice[]): LimVoice | null {
    let w: LimVoice | null = null;
    for (const v of pool) {
      if (!w || v.priority < w.priority || (v.priority === w.priority && v.start < w.start)) w = v;
    }
    return w;
  }

  /**
   * Pide una voz. Si acepta, `steal` lista las voces que deben cortarse (ya retiradas del registro).
   * `accepted:false` = descartar el sonido (no se crea ningún nodo).
   */
  request(req: VoiceRequest): VoiceDecision {
    this.prune(req.now);
    const lim = this.limitOf(req.category);
    const critical = req.priority >= this.cfg.criticalPriority;

    if (!critical) {
      const last = this.lastByKey.get(req.key);
      if (last !== undefined && req.now - last < lim.gap) return { accepted: false, reason: 'gap' };
      if (lim.burstMax > 0) {
        const arr = this.bursts.get(req.category);
        if (arr) {
          while (arr.length && (arr[0] as number) < req.now - lim.burstWindowS) arr.shift();
          if (arr.length >= lim.burstMax) return { accepted: false, reason: 'burst' };
        }
      }
    }

    const steal: number[] = [];
    const inCat = this.voices.filter((v) => v.category === req.category);
    if (inCat.length >= lim.max) {
      const w = this.weakest(inCat);
      if (!w || w.priority > req.priority) return { accepted: false, reason: 'priority' };
      steal.push(w.id);
    }
    if (this.voices.length - steal.length >= this.cfg.total) {
      const w = this.weakest(this.voices.filter((v) => !steal.includes(v.id)));
      if (!w || w.priority > req.priority) return { accepted: false, reason: 'full' };
      steal.push(w.id);
    }
    if (steal.length) this.voices = this.voices.filter((v) => !steal.includes(v.id));

    const id = this.nextId++;
    this.voices.push({ id, key: req.key, category: req.category, priority: req.priority, start: req.now, end: req.now + Math.max(0.02, req.dur) });
    this.lastByKey.set(req.key, req.now);
    let arr = this.bursts.get(req.category);
    if (!arr) {
      arr = [];
      this.bursts.set(req.category, arr);
    }
    arr.push(req.now);
    return { accepted: true, id, steal };
  }

  /** Libera una voz antes de tiempo (cancelada). */
  release(id: number): void {
    this.voices = this.voices.filter((v) => v.id !== id);
  }

  reset(): void {
    this.voices = [];
    this.lastByKey.clear();
    this.bursts.clear();
  }
}

/** Configuración por defecto del limitador (categorías del juego). */
export const DEFAULT_LIMITER: LimiterConfig = {
  total: 40,
  criticalPriority: 92,
  fallback: { max: 6, gap: 0.03, burstMax: 0, burstWindowS: 0 },
  categories: {
    gun: { max: 6, gap: 0.025, burstMax: 0, burstWindowS: 0 },
    impact: { max: 10, gap: 0.02, burstMax: 7, burstWindowS: 0.14 },
    step: { max: 5, gap: 0.09, burstMax: 0, burstWindowS: 0 },
    foley: { max: 7, gap: 0.05, burstMax: 0, burstWindowS: 0 },
    vocal: { max: 8, gap: 0.12, burstMax: 5, burstWindowS: 0.6 },
    enemy: { max: 9, gap: 0.04, burstMax: 6, burstWindowS: 0.3 },
    explosion: { max: 3, gap: 0.05, burstMax: 0, burstWindowS: 0 },
    ui: { max: 6, gap: 0.04, burstMax: 0, burstWindowS: 0 },
    pickup: { max: 5, gap: 0.04, burstMax: 0, burstWindowS: 0 },
    alarm: { max: 3, gap: 0.2, burstMax: 0, burstWindowS: 0 },
    stinger: { max: 3, gap: 0.5, burstMax: 0, burstWindowS: 0 },
    ambient: { max: 4, gap: 0.5, burstMax: 0, burstWindowS: 0 },
    body: { max: 4, gap: 0.08, burstMax: 3, burstWindowS: 0.4 },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Música adaptativa
// ─────────────────────────────────────────────────────────────────────────────
/** Medidor de combate con caída exponencial (alertas, disparos, daño recibido). */
export class CombatMeter {
  private v = 0;
  constructor(private readonly tau = 7, private readonly cap = 1.25) {}

  add(amount: number): void {
    this.v = Math.min(this.cap, this.v + Math.max(0, amount));
  }

  update(dt: number): void {
    this.v *= Math.exp(-Math.max(0, dt) / this.tau);
    if (this.v < 1e-4) this.v = 0;
  }

  /** 0..1 */
  get level(): number {
    return clamp01(this.v);
  }

  reset(): void {
    this.v = 0;
  }
}

export interface MusicInputs {
  /** Amenaza de la zona actual (1..4). */
  threat: number;
  /** 0..1 (CombatMeter.level). */
  combat: number;
  /** Segundos desde 'match:contaminationStarted' (null = aún no). */
  contaminationS: number | null;
  /** 0..1 de progreso entre el inicio de la contaminación y el sellado. */
  sealFraction: number;
  hordeActive: boolean;
  wardenEngaged: boolean;
  extractionActive: boolean;
}

const THREAT_BASE = [0.1, 0.14, 0.27, 0.42, 0.56] as const;

/** Intensidad musical objetivo (0..1). */
export function musicIntensity(i: MusicInputs): number {
  const threat = clamp(Math.round(i.threat), 1, 4);
  let v: number = THREAT_BASE[threat] ?? 0.14;
  v += clamp01(i.combat) * 0.5;
  if (i.hordeActive) v += 0.22;
  if (i.wardenEngaged) v += 0.28;
  if (i.extractionActive) v += 0.12;
  if (i.contaminationS !== null) {
    v += smoothstep(0, 45, i.contaminationS) * (0.16 + 0.22 * clamp01(i.sealFraction));
  }
  return clamp01(v);
}

export interface MusicLayers {
  pad: number;
  tension: number;
  pulse: number;
  combat: number;
}

/** Ganancia (0..1) de cada capa musical según la intensidad. */
export function musicLayers(intensity: number): MusicLayers {
  const i = clamp01(intensity);
  return {
    pad: 0.5 + 0.3 * i,
    tension: smoothstep(0.2, 0.62, i),
    pulse: smoothstep(0.4, 0.78, i),
    combat: smoothstep(0.7, 0.95, i),
  };
}

/** Tempo del pulso percusivo (BPM) según la intensidad. */
export const pulseBpm = (intensity: number): number => lerp(64, 132, clamp01(intensity));

/** Suavizado asimétrico: sube con `up` s y baja con `down` s (constantes de tiempo). */
export function asymmetricSmooth(current: number, target: number, dt: number, up: number, down: number): number {
  const tc = target > current ? up : down;
  return target + (current - target) * Math.exp(-Math.max(0, dt) / Math.max(1e-3, tc));
}

/** Peso de combate por tipo de enemigo alertado. */
export const ALERT_WEIGHT: Record<string, number> = { walker: 0.06, runner: 0.1, brute: 0.2, spitter: 0.12, warden: 0.5 };

// ─────────────────────────────────────────────────────────────────────────────
// Jugador: latido, pasos, retención de interacción
// ─────────────────────────────────────────────────────────────────────────────
export const HEARTBEAT_HP_FRACTION = 0.4;

export interface HeartbeatParams {
  active: boolean;
  bpm: number;
  /** 0..1 */
  gain: number;
}

/** Latido dirigido por la vida: por encima del 40 % no suena; se acelera y sube al bajar. */
export function heartbeatParams(hpFraction: number, alive = true): HeartbeatParams {
  if (!alive || hpFraction >= HEARTBEAT_HP_FRACTION) return { active: false, bpm: 0, gain: 0 };
  const k = 1 - clamp01(hpFraction / HEARTBEAT_HP_FRACTION);
  return { active: true, bpm: lerp(64, 132, k), gain: lerp(0.28, 0.85, k) };
}

/** Intensidad de un paso: agachado suave, andar normal, correr fuerte. */
export function stepIntensity(crouched: boolean, sprinting: boolean, speed: number): number {
  if (crouched) return 0.42;
  if (sprinting) return clamp(0.85 + speed * 0.02, 0.85, 1);
  return clamp(0.6 + speed * 0.03, 0.6, 0.8);
}

/** Intervalo (s) entre tics de retención: se acelera con el progreso. */
export const holdTickInterval = (progress: number): number => lerp(0.24, 0.07, clamp01(progress));
/** Frecuencia (Hz) del tic de retención: sube ~1.6 octavas con el progreso. */
export const holdTickFreq = (progress: number): number => 420 * 2 ** (clamp01(progress) * 1.6);

/** Vida → 0..1 de «visión de túnel» sonora (paso-bajo suave con poca vida). */
export const tunnelAmount = (hpFraction: number, alive: boolean): number =>
  alive ? smoothstep(0.25, 0.04, hpFraction) * 0.3 : 0;

// ─────────────────────────────────────────────────────────────────────────────
// Pasos de enemigos por distancia recorrida
// ─────────────────────────────────────────────────────────────────────────────
/** Longitud de zancada (m) por tipo de enemigo. */
export const STRIDE: Record<string, number> = { walker: 1.15, runner: 1.9, brute: 1.7, spitter: 1.2, warden: 2.1 };

/**
 * Convierte el desplazamiento de cada entidad en pasos (uno por zancada).
 * Devuelve el número de pasos a emitir (0 o 1 por llamada: no acumula ráfagas si hay teletransporte).
 */
export class StrideTracker {
  private readonly state = new Map<number, { x: number; z: number; acc: number; seen: number }>();
  private frame = 0;

  beginFrame(): void {
    this.frame++;
  }

  step(id: number, x: number, z: number, stride: number): boolean {
    let s = this.state.get(id);
    if (!s) {
      this.state.set(id, { x, z, acc: 0, seen: this.frame });
      return false;
    }
    const d = Math.hypot(x - s.x, z - s.z);
    s.x = x;
    s.z = z;
    s.seen = this.frame;
    // saltos grandes (aparición/teletransporte) no cuentan como paso
    if (d > 6) {
      s.acc = 0;
      return false;
    }
    s.acc += d;
    if (s.acc >= stride) {
      s.acc %= stride;
      return true;
    }
    return false;
  }

  /** Olvida las entidades no vistas en este frame. */
  endFrame(): void {
    for (const [id, s] of this.state) if (s.seen !== this.frame) this.state.delete(id);
  }

  get size(): number {
    return this.state.size;
  }

  clear(): void {
    this.state.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generación de ruido e IR de reverb (Float32Array, sin AudioBuffer)
// ─────────────────────────────────────────────────────────────────────────────
export type NoiseKind = 'white' | 'pink' | 'brown';

/**
 * Ruido normalizado a RMS `rms`, sin DC y con el final fundido con el inicio
 * (se puede reproducir en bucle sin clic).
 */
export function fillNoise(kind: NoiseKind, length: number, seed: number, rms = 0.3): Float32Array {
  const rng = createRng(seed);
  const xf = Math.min(2048, length >> 2);
  const total = length + xf;
  const ext = new Float32Array(total);
  if (kind === 'white') {
    for (let i = 0; i < total; i++) ext[i] = rng() * 2 - 1;
  } else if (kind === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < total; i++) {
      const w = rng() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      ext[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  } else {
    let last = 0;
    for (let i = 0; i < total; i++) {
      last = (last + 0.02 * (rng() * 2 - 1)) / 1.02;
      ext[i] = last * 3.5;
    }
  }
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = ext[i] as number;
  // fundido en el empalme: el inicio pasa a mezclar la cola extra con el arranque original
  for (let i = 0; i < xf; i++) {
    const w = i / xf;
    out[i] = Math.sqrt(w) * (ext[i] as number) + Math.sqrt(1 - w) * (ext[length + i] as number);
  }
  let mean = 0;
  for (let i = 0; i < length; i++) mean += out[i] as number;
  mean /= length;
  let sum = 0;
  for (let i = 0; i < length; i++) {
    const v = (out[i] as number) - mean;
    out[i] = v;
    sum += v * v;
  }
  const k = sum > 0 ? rms / Math.sqrt(sum / length) : 0;
  for (let i = 0; i < length; i++) out[i] = (out[i] as number) * k;
  return out;
}

export interface IrSpec {
  /** Duración total (s). */
  seconds: number;
  /** Tiempo (s) en que la cola cae 60 dB. */
  decayS: number;
  preDelayS: number;
  /** Corte del paso-bajo de amortiguación: [inicio, fin] en Hz. */
  dampingHz: [number, number];
  earlyReflections: number;
  seed: number;
}

export const DEFAULT_IR: IrSpec = {
  seconds: 2.6, decayS: 2.1, preDelayS: 0.012, dampingHz: [9000, 1400], earlyReflections: 10, seed: 0x5eed,
};

/** Respuesta al impulso estéreo generada por código (ruido con caída exponencial y amortiguación creciente). */
export function generateIr(sampleRate: number, spec: IrSpec = DEFAULT_IR): { left: Float32Array; right: Float32Array } {
  const n = Math.max(16, Math.floor(spec.seconds * sampleRate));
  const make = (seed: number): Float32Array => {
    const rng = createRng(seed);
    const out = new Float32Array(n);
    let y = 0;
    const pre = Math.floor(spec.preDelayS * sampleRate);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      const w = rng() * 2 - 1;
      const cutoff = lerp(spec.dampingHz[0], spec.dampingHz[1], Math.min(1, t / spec.decayS));
      const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
      y += a * (w - y);
      if (i < pre) continue;
      const env = Math.exp((-6.9 * t) / spec.decayS);
      const fadeIn = Math.min(1, (t - spec.preDelayS) / 0.02);
      out[i] = y * env * fadeIn;
    }
    // reflexiones tempranas dispersas en los primeros ~90 ms
    for (let k = 0; k < spec.earlyReflections; k++) {
      const tt = spec.preDelayS + 0.004 + rng() * 0.085;
      const idx = Math.min(n - 1, Math.floor(tt * sampleRate));
      out[idx] = (out[idx] as number) + (rng() < 0.5 ? -1 : 1) * (0.55 - 0.4 * (tt / 0.09)) * 0.8;
    }
    return out;
  };
  return { left: make(spec.seed), right: make(spec.seed ^ 0x9e3779b9) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades de análisis (QA offline y tests)
// ─────────────────────────────────────────────────────────────────────────────
export interface SignalStats {
  rms: number;
  peak: number;
  nan: number;
  /** Instante (s) de la última muestra por encima de `floor`. */
  audibleS: number;
  dc: number;
}

/** Estadísticas de una señal mono (o varios canales concatenados por separado y combinados). */
export function analyzeSignal(channels: readonly Float32Array[], sampleRate: number, floor = 1e-3): SignalStats {
  let sum = 0;
  let count = 0;
  let peak = 0;
  let nan = 0;
  let last = -1;
  let dcSum = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i] as number;
      if (!Number.isFinite(v)) {
        nan++;
        continue;
      }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (a > floor && i > last) last = i;
      sum += v * v;
      dcSum += v;
      count++;
    }
  }
  const audibleEnd = last < 0 ? 0 : (last + 1) / sampleRate;
  // RMS sólo sobre la ventana audible (para que colas de silencio no penalicen a sonidos cortos)
  let winSum = 0;
  let winCount = 0;
  const lim = Math.floor(audibleEnd * sampleRate);
  for (const ch of channels) {
    for (let i = 0; i < Math.min(lim, ch.length); i++) {
      const v = ch[i] as number;
      if (Number.isFinite(v)) {
        winSum += v * v;
        winCount++;
      }
    }
  }
  return {
    rms: winCount ? Math.sqrt(winSum / winCount) : 0,
    peak,
    nan,
    audibleS: audibleEnd,
    dc: count ? Math.abs(dcSum / count) : 0,
  };
}

/** Convierte amplitud lineal a dBFS. */
export const toDb = (v: number): number => 20 * Math.log10(Math.max(1e-9, v));
