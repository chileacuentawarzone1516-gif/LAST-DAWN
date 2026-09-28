/**
 * Motor de audio: AudioContext perezoso (se crea en unlock(), dentro del gesto), cadena maestra,
 * buses, reverb global, filtro de apagado, listener espacial, limitador de voces y limpieza de nodos.
 * La cadena (`buildChain`) se comparte con el renderizado offline de QA.
 */
import { Quaternion, Vector3 } from 'three';
import type { Camera } from 'three';
import { AUDIO } from '../config';
import type { Vec3 } from '../core/types';
import { clamp, clamp01, createRng } from '../core/util';
import type { Rng } from '../core/util';
import { DEFAULT_LIMITER, VoiceLimiter, airCutoff, rangeFade, reverbSendFor, soundDelay } from './pure';
import { RECIPES } from './sfx';
import { biquad, createReverb, gainNode, makeParams, safetyClipper } from './synth';
import type { BusName, RecipeDef, RecipeParams, VoiceHandle } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Cadena maestra
// ─────────────────────────────────────────────────────────────────────────────
export interface Levels {
  master: number;
  sfx: number;
  music: number;
  ambience: number;
  ui: number;
}

export interface Bus {
  /** Entrada (aquí se conectan las voces); su ganancia es el «duck» dinámico. */
  input: GainNode;
  /** Fader del bus (AUDIO.*). */
  level: GainNode;
}

export interface Chain {
  ac: BaseAudioContext;
  master: GainNode;
  muffle: BiquadFilterNode;
  comp: DynamicsCompressorNode;
  clip: WaveShaperNode;
  analyser: AnalyserNode;
  reverbIn: GainNode;
  reverbOut: GainNode;
  buses: Record<BusName, Bus>;
}

export const DEFAULT_LEVELS: Levels = {
  master: AUDIO.master, sfx: AUDIO.sfx, music: AUDIO.music, ambience: AUDIO.ambience, ui: 0.9,
};

/** Envío base de cada bus a la reverb global (sfx y ui lo llevan por voz). */
const BUS_SEND: Record<BusName, number> = { sfx: 0, ui: 0, music: 0.32, ambience: 0.22 };

/**
 * bus.input → bus.level → master → muffle → compresor → recortador → destino.
 * La reverb (convolver con IR generada) recibe los envíos y vuelve a `master`.
 */
export function buildChain(ac: BaseAudioContext, dest: AudioNode, levels: Levels = DEFAULT_LEVELS): Chain {
  const master = gainNode(ac, levels.master);
  const muffle = biquad(ac, 'lowpass', 20000, 0.55);
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 14;
  comp.ratio.value = 5;
  comp.attack.value = 0.004;
  comp.release.value = 0.22;
  const clip = safetyClipper(ac);
  const analyser = ac.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.7;
  master.connect(muffle);
  muffle.connect(comp);
  comp.connect(clip);
  clip.connect(dest);
  clip.connect(analyser);

  const reverbIn = gainNode(ac, 1);
  const rhp = biquad(ac, 'highpass', 170, 0.6);
  const conv = createReverb(ac);
  const reverbOut = gainNode(ac, 0.6);
  reverbIn.connect(rhp);
  rhp.connect(conv);
  conv.connect(reverbOut);
  reverbOut.connect(master);

  const make = (name: BusName): Bus => {
    const input = gainNode(ac, 1);
    const level = gainNode(ac, levels[name]);
    input.connect(level);
    level.connect(master);
    if (BUS_SEND[name] > 0) {
      const s = gainNode(ac, BUS_SEND[name]);
      level.connect(s);
      s.connect(reverbIn);
    }
    return { input, level };
  };
  const buses: Record<BusName, Bus> = { sfx: make('sfx'), music: make('music'), ambience: make('ambience'), ui: make('ui') };
  return { ac, master, muffle, comp, clip, analyser, reverbIn, reverbOut, buses };
}

/** Conecta la salida de una receta a un bus, añadiendo su envío de reverb. Usada por el motor y por QA offline. */
export function connectVoice(ac: BaseAudioContext, chain: Chain, def: RecipeDef, trim = 1): GainNode {
  const g = gainNode(ac, def.trim * trim);
  g.connect(chain.buses[def.bus].input);
  if (def.send > 0.005) {
    const s = gainNode(ac, def.send);
    g.connect(s);
    s.connect(chain.reverbIn);
  }
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistencia (mute / volumen)
// ─────────────────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'deadsignal.audio.v1';

interface Stored {
  master?: number;
  muted?: boolean;
  sfx?: number;
  music?: number;
  ambience?: number;
  ui?: number;
}

function loadStored(): Stored {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as Stored;
    return typeof v === 'object' && v !== null ? v : {};
  } catch {
    return {};
  }
}

function saveStored(s: Stored): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* almacenamiento bloqueado: se ignora */
  }
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : fallback);

// ─────────────────────────────────────────────────────────────────────────────
// Motor
// ─────────────────────────────────────────────────────────────────────────────
export interface PlayOptions {
  /** Posición del emisor: si se da, el sonido es espacial (PannerNode). */
  pos?: Vec3 | null;
  intensity?: number;
  pitch?: number;
  duration?: number;
  alt?: boolean;
  level?: number;
  /** Multiplicador de ganancia. */
  gain?: number;
  /** Retardo (s). */
  delay?: number;
  /** Clave para la tasa por tipo (por defecto, el id de la receta). */
  key?: string;
  /** Grupo cancelable (recargas, placa…). */
  group?: string;
  rng?: Rng;
  /** Aplica el retardo de la velocidad del sonido según la distancia. */
  soundDelay?: boolean;
  /** Ignora gap/ráfaga del limitador (eventos críticos). */
  force?: boolean;
}

interface AudioCtor {
  new (opts?: AudioContextOptions): AudioContext;
}

const MAX_HRTF = 8;

export class AudioEngine {
  ac: AudioContext | null = null;
  chain: Chain | null = null;
  readonly limiter = new VoiceLimiter(DEFAULT_LIMITER);
  readonly levels: Levels;
  /** Posición/orientación del oyente (actualizadas por update). */
  readonly listenerPos = new Vector3();
  readonly listenerVel = new Vector3();
  private readonly listenerFwd = new Vector3(0, 0, -1);
  private readonly listenerUp = new Vector3(0, 1, 0);
  private readonly quat = new Quaternion();
  private readonly prevPos = new Vector3();
  private hasPrev = false;

  private readonly voices = new Map<number, VoiceHandle & { hrtf: boolean }>();
  private muted: boolean;
  private muffleTarget = 0;
  private muffleTc = 0.25;
  private stunLevel = 0;
  private stunHold = 0;
  private stunRelease = 2;
  private muffleApplied = -1;
  private resumeCooldown = 0;
  private disposed = false;
  private gestureOff: Array<() => void> = [];
  private readonly rng: Rng = createRng((Date.now() ^ 0x9e3779b9) >>> 0);

  errorCount = 0;
  lastError = '';
  /** Contadores de diagnóstico. */
  stats = { played: 0, rejected: 0, stolen: 0, culled: 0 };

  constructor(private readonly camera: Camera | null) {
    const s = loadStored();
    this.levels = {
      master: num(s.master, DEFAULT_LEVELS.master),
      sfx: num(s.sfx, DEFAULT_LEVELS.sfx),
      music: num(s.music, DEFAULT_LEVELS.music),
      ambience: num(s.ambience, DEFAULT_LEVELS.ambience),
      ui: num(s.ui, DEFAULT_LEVELS.ui),
    };
    this.muted = s.muted === true;
  }

  // ── Estado ────────────────────────────────────────────────────────────────
  get ready(): boolean {
    return this.ac !== null && this.ac.state === 'running';
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get now(): number {
    return this.ac ? this.ac.currentTime : 0;
  }

  get voiceCount(): number {
    return this.voices.size;
  }

  reportError(e: unknown): void {
    this.errorCount++;
    this.lastError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }

  // ── Creación del contexto (dentro del gesto del usuario) ─────────────────
  unlock(): void {
    if (this.disposed) return;
    if (!this.ac) {
      const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ac = new Ctor({ latencyHint: 'interactive' });
      } catch (e) {
        this.reportError(e);
        return;
      }
      this.chain = buildChain(this.ac, this.ac.destination, this.levels);
      this.applyMaster();
      // Si el navegador dejó el contexto suspendido (sin gesto válido), se reintenta en el siguiente gesto.
      const retry = (): void => this.tryResume();
      for (const type of ['pointerdown', 'keydown', 'touchend', 'click'] as const) {
        window.addEventListener(type, retry, { capture: true });
        this.gestureOff.push(() => window.removeEventListener(type, retry, { capture: true }));
      }
    }
    this.tryResume();
  }

  private tryResume(): void {
    const ac = this.ac;
    if (!ac || ac.state === 'running' || ac.state === 'closed') return;
    try {
      void ac.resume().catch(() => undefined);
    } catch {
      /* Safari antiguo */
    }
  }

  // ── Volúmenes / mute ─────────────────────────────────────────────────────
  private persist(): void {
    saveStored({ master: this.levels.master, muted: this.muted, sfx: this.levels.sfx, music: this.levels.music, ambience: this.levels.ambience, ui: this.levels.ui });
  }

  private applyMaster(): void {
    if (!this.chain || !this.ac) return;
    const target = this.muted ? 0 : this.levels.master;
    this.chain.master.gain.setTargetAtTime(target, this.ac.currentTime, 0.03);
  }

  setMasterVolume(v: number): void {
    this.levels.master = clamp01(Number.isFinite(v) ? v : 0);
    this.applyMaster();
    this.persist();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyMaster();
    this.persist();
  }

  setBusVolume(bus: BusName, v: number): void {
    const val = clamp01(Number.isFinite(v) ? v : 0);
    this.levels[bus] = val;
    if (this.chain && this.ac) this.chain.buses[bus].level.gain.setTargetAtTime(val, this.ac.currentTime, 0.03);
    this.persist();
  }

  // ── Efectos globales ─────────────────────────────────────────────────────
  /** Apagado del sonido (pausa/muerte): 0 = limpio, 1 = muy amortiguado. */
  setMuffle(amount: number, tc = 0.25): void {
    this.muffleTarget = clamp01(amount);
    this.muffleTc = tc;
  }

  /** Aturdimiento breve (explosión cercana): amortigua y se recupera solo. */
  stun(amount: number, holdS = 0.25, releaseS = 2.2): void {
    if (amount >= this.stunLevel) {
      this.stunLevel = clamp01(amount);
      this.stunHold = holdS;
      this.stunRelease = releaseS;
    }
  }

  /** Baja temporalmente un bus (`amount` = ganancia mínima) y lo recupera con `releaseS`. */
  duck(bus: BusName, amount: number, holdS: number, releaseS: number): void {
    if (!this.chain || !this.ac) return;
    const p = this.chain.buses[bus].input.gain;
    const t = this.ac.currentTime;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(clamp(amount, 0, 1), t, 0.03);
    p.setTargetAtTime(1, t + holdS, Math.max(0.05, releaseS / 3));
  }

  // ── Voces ────────────────────────────────────────────────────────────────
  /** Crea un PannerNode configurado (la distancia/atenuación se calcula con el modelo estándar 'inverse'). */
  createPanner(range: number, hrtf: boolean, rolloff = 1, ref: number = AUDIO.refDistance): PannerNode | null {
    const ac = this.ac;
    if (!ac) return null;
    const p = ac.createPanner();
    p.panningModel = hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.maxDistance = Math.max(range, ref + 1);
    p.rolloffFactor = rolloff;
    p.coneInnerAngle = 360;
    p.coneOuterAngle = 360;
    p.coneOuterGain = 0;
    return p;
  }

  /** Coloca un panner (compatible con Safari antiguo sin AudioParams de posición). */
  setPannerPos(p: PannerNode, x: number, y: number, z: number): void {
    if (p.positionX !== undefined) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      p.setPosition(x, y, z);
    }
  }

  distanceTo(pos: Vec3): number {
    return Math.hypot(pos.x - this.listenerPos.x, pos.y - this.listenerPos.y, pos.z - this.listenerPos.z);
  }

  private countHrtf(): number {
    let n = 0;
    for (const v of this.voices.values()) if (v.hrtf) n++;
    return n;
  }

  /** Reproduce una receta por id. Devuelve el id de voz o 0 si se descartó. */
  play(id: string, o: PlayOptions = {}): number {
    const def = RECIPES[id];
    if (!def) return 0;
    return this.playDef(def, o);
  }

  playDef(def: RecipeDef, o: PlayOptions = {}): number {
    const ac = this.ac;
    const chain = this.chain;
    if (!ac || !chain || this.muted || ac.state !== 'running') return 0;
    const now = ac.currentTime;

    let dist = 0;
    let fade = 1;
    if (o.pos) {
      dist = this.distanceTo(o.pos);
      const range = def.range ?? AUDIO.maxDistance;
      if (dist > range) {
        this.stats.culled++;
        return 0;
      }
      fade = rangeFade(dist, range);
    }
    const gainValue = def.trim * (o.gain ?? 1) * fade;
    if (gainValue < 0.003) {
      this.stats.culled++;
      return 0;
    }

    const delay = Math.max(0, o.delay ?? 0) + (o.soundDelay ? soundDelay(dist) : 0);
    const priority = def.priority - (o.pos ? Math.min(30, dist * 0.25) : 0) + (o.force ? 100 : 0);
    const decision = this.limiter.request({
      key: o.key ?? def.id, category: def.category, priority, dur: def.dur + delay, now,
    });
    if (!decision.accepted) {
      this.stats.rejected++;
      return 0;
    }
    for (const sid of decision.steal) {
      this.stats.stolen++;
      this.cancelVoice(sid, 0.04, false);
    }

    const g = gainNode(ac, gainValue);
    const extra: AudioNode[] = [];
    const bus = chain.buses[def.bus];
    let hrtf = false;
    const wet = reverbSendFor(def.send, dist, fade);
    if (wet > 0.005) {
      const s = gainNode(ac, wet);
      g.connect(s);
      s.connect(chain.reverbIn);
      extra.push(s);
    }
    if (o.pos) {
      hrtf = dist < 32 && this.countHrtf() < MAX_HRTF;
      const air = biquad(ac, 'lowpass', airCutoff(dist), 0.5);
      const panner = this.createPanner(def.range ?? AUDIO.maxDistance, hrtf);
      if (panner) {
        this.setPannerPos(panner, o.pos.x, o.pos.y, o.pos.z);
        g.connect(air);
        air.connect(panner);
        panner.connect(bus.input);
        extra.push(air, panner);
      } else {
        g.connect(bus.input);
      }
    } else {
      g.connect(bus.input);
    }

    const params: RecipeParams = makeParams(o.rng ?? this.rng, {
      intensity: o.intensity, pitch: o.pitch, duration: o.duration, alt: o.alt, level: o.level, distance: dist,
    });
    const t0 = now + 0.008 + delay;
    try {
      def.play(ac, g, t0, params);
    } catch (e) {
      this.reportError(e);
      try {
        g.disconnect();
        for (const n of extra) n.disconnect();
      } catch {
        /* nada */
      }
      this.limiter.release(decision.id);
      return 0;
    }
    const dur = Math.max(def.dur, o.duration ?? 0);
    this.voices.set(decision.id, {
      id: decision.id, gain: g, extra, end: t0 + dur + 0.35, category: def.category, group: o.group ?? '', hrtf,
    });
    this.stats.played++;
    return decision.id;
  }

  /** Corta una voz con un fundido corto. */
  cancelVoice(id: number, fade = 0.04, release = true): void {
    const v = this.voices.get(id);
    const ac = this.ac;
    if (!v || !ac) return;
    const t = ac.currentTime;
    try {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, fade / 3);
    } catch {
      /* nada */
    }
    v.end = Math.min(v.end, t + fade * 3);
    if (release) this.limiter.release(id);
  }

  /** Corta todas las voces de un grupo (p. ej. recarga en curso al cambiar de arma). */
  cancelGroup(group: string, fade = 0.05): void {
    for (const v of this.voices.values()) if (v.group === group) this.cancelVoice(v.id, fade);
  }

  /** Corta todas las voces (reinicio de partida). */
  cancelAll(fade = 0.08): void {
    for (const v of this.voices.values()) this.cancelVoice(v.id, fade, false);
    this.limiter.reset();
  }

  private purge(now: number): void {
    for (const [id, v] of this.voices) {
      if (v.end > now) continue;
      try {
        v.gain.disconnect();
        for (const n of v.extra) n.disconnect();
      } catch {
        /* ya desconectado */
      }
      this.voices.delete(id);
    }
  }

  // ── Frame ────────────────────────────────────────────────────────────────
  update(dt: number): void {
    const ac = this.ac;
    const chain = this.chain;
    if (!ac || !chain || this.disposed) return;
    if (ac.state !== 'running') {
      this.resumeCooldown -= dt;
      if (this.resumeCooldown <= 0) {
        this.resumeCooldown = 0.6;
        this.tryResume();
      }
      return;
    }
    const now = ac.currentTime;
    this.updateListener(ac, dt);
    this.purge(now);

    // aturdimiento: mantiene y luego se relaja
    if (this.stunHold > 0) this.stunHold -= dt;
    else this.stunLevel *= Math.exp(-dt / Math.max(0.1, this.stunRelease / 3));
    if (this.stunLevel < 0.01) this.stunLevel = 0;
    const eff = Math.max(this.muffleTarget, this.stunLevel);
    if (Math.abs(eff - this.muffleApplied) > 0.004) {
      this.muffleApplied = eff;
      const cutoff = 20000 * (520 / 20000) ** eff;
      chain.muffle.frequency.setTargetAtTime(cutoff, now, this.stunLevel > this.muffleTarget ? 0.05 : this.muffleTc);
    }
  }

  private updateListener(ac: AudioContext, dt: number): void {
    const cam = this.camera;
    if (!cam) return;
    cam.getWorldPosition(this.listenerPos);
    cam.getWorldQuaternion(this.quat);
    this.listenerFwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.listenerUp.set(0, 1, 0).applyQuaternion(this.quat);
    if (this.hasPrev && dt > 1e-4) {
      this.listenerVel.copy(this.listenerPos).sub(this.prevPos).divideScalar(dt);
      // un salto grande (teletransporte) no es una velocidad real
      if (this.listenerVel.lengthSq() > 60 * 60) this.listenerVel.set(0, 0, 0);
    }
    this.prevPos.copy(this.listenerPos);
    this.hasPrev = true;
    const l = ac.listener;
    const p = this.listenerPos;
    const f = this.listenerFwd;
    const u = this.listenerUp;
    if (l.positionX !== undefined) {
      l.positionX.value = p.x;
      l.positionY.value = p.y;
      l.positionZ.value = p.z;
      l.forwardX.value = f.x;
      l.forwardY.value = f.y;
      l.forwardZ.value = f.z;
      l.upX.value = u.x;
      l.upY.value = u.y;
      l.upZ.value = u.z;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  // ── Cierre ───────────────────────────────────────────────────────────────
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.gestureOff) off();
    this.gestureOff = [];
    for (const v of this.voices.values()) {
      try {
        v.gain.disconnect();
      } catch {
        /* nada */
      }
    }
    this.voices.clear();
    const ac = this.ac;
    this.ac = null;
    this.chain = null;
    if (ac && ac.state !== 'closed') {
      try {
        void ac.close().catch(() => undefined);
      } catch {
        /* nada */
      }
    }
  }
}
