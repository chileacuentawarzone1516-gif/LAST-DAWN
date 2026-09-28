/**
 * Música oscura adaptativa generada por código: pad grave + capas de tensión + pulso percusivo + bajo de combate.
 * La intensidad (0..1) sale de `musicIntensity` (pura) y se suaviza con crossfades lentos.
 */
import { clamp01 } from '../core/util';
import type { Rng } from '../core/util';
import { SCALES, asymmetricSmooth, midiToHz, musicLayers, pulseBpm, scaleDegreeToMidi } from './pure';
import { biquad, gainNode, link, noiseBurst, tone } from './synth';
import type { AudioEngine } from './engine';

const ROOT = 33; // A1
/** Progresión (semitonos sobre la raíz): i · bII · i · bVII. */
const PROG = [0, 1, 0, -2] as const;
const CHORD = [0, 7, 12, 15] as const;

export class Music {
  /** Intensidad forzada (dev) o null = automática. */
  override: number | null = null;
  intensity = 0;
  private ac: AudioContext | null = null;
  private out: GainNode | null = null;
  private padGain: GainNode | null = null;
  private padLp: BiquadFilterNode | null = null;
  private padOscs: OscillatorNode[] = [];
  private tenGain: GainNode | null = null;
  private tenOscs: OscillatorNode[] = [];
  private tenTrem: OscillatorNode | null = null;
  private srcs: OscillatorNode[] = [];
  private chord = 0;
  private chordT = 0;
  private stepT = 0;
  private step = 0;
  private bar = 0;
  private master = 0;
  private smoothed = 0;
  private layers = { pad: 0, tension: 0, pulse: 0, combat: 0 };

  constructor(private readonly engine: AudioEngine, private readonly rng: Rng) {}

  private build(): void {
    const ac = this.engine.ac;
    const chain = this.engine.chain;
    if (!ac || !chain || this.out) return;
    this.ac = ac;
    this.out = gainNode(ac, 0);
    this.out.connect(chain.buses.music.input);
    const t = ac.currentTime;
    // pad: 4 voces × 2 sierras desafinadas
    this.padLp = biquad(ac, 'lowpass', 380, 0.9);
    this.padGain = gainNode(ac, 0);
    for (let v = 0; v < 4; v++) {
      for (const det of [-6, 6]) {
        const o = ac.createOscillator();
        o.type = 'sawtooth';
        o.detune.value = det;
        o.frequency.value = midiToHz(ROOT + (CHORD[v] as number));
        o.start(t);
        o.connect(this.padLp);
        this.padOscs.push(o);
        this.srcs.push(o);
      }
    }
    link(this.padLp, this.padGain, this.out);
    // tensión: cluster agudo con trémolo
    const ten = biquad(ac, 'bandpass', 1800, 0.8);
    const trem = gainNode(ac, 0.6);
    this.tenGain = gainNode(ac, 0);
    for (const m of [69, 70, 76]) {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midiToHz(m);
      o.detune.value = (this.rng() - 0.5) * 16;
      o.start(t);
      o.connect(ten);
      this.tenOscs.push(o);
      this.srcs.push(o);
    }
    this.tenTrem = ac.createOscillator();
    this.tenTrem.frequency.value = 5.5;
    this.tenTrem.start(t);
    const td = gainNode(ac, 0.4);
    link(this.tenTrem, td);
    td.connect(trem.gain);
    this.srcs.push(this.tenTrem);
    link(ten, biquad(ac, 'lowpass', 3500, 0.5), trem, this.tenGain, this.out);
    this.stepT = t + 0.2;
    this.chordT = t;
  }

  private setChord(idx: number, now: number): void {
    for (let v = 0; v < 4; v++) {
      const f = midiToHz(ROOT + (PROG[idx % PROG.length] as number) + (CHORD[v] as number));
      for (let d = 0; d < 2; d++) (this.padOscs[v * 2 + d] as OscillatorNode).frequency.setTargetAtTime(f, now, 1.2);
    }
  }

  /** Programa notas percusivas con antelación (rejilla de semicorcheas). */
  private schedule(now: number): void {
    const ac = this.ac;
    const out = this.out;
    if (!ac || !out) return;
    const bpm = pulseBpm(this.intensity);
    const stepDur = 60 / bpm / 4;
    while (this.stepT < now + 0.4) {
      const s = this.step % 16;
      const t = this.stepT;
      if (this.layers.pulse > 0.03) {
        const g = this.layers.pulse;
        if (s === 0 || s === 6 || s === 10) {
          tone(ac, out, t, { f0: 95, f1: 38, dur: 0.22, peak: 0.55 * g, attack: 0.003, sat: 0.2 });
        }
        if (s % 2 === 1) noiseBurst(ac, out, t, { dur: 0.03, peak: 0.07 * g, attack: 0.001, type: 'highpass', f0: 6500, rng: this.rng });
        if (s === 8) noiseBurst(ac, out, t, { dur: 0.35, peak: 0.16 * g, attack: 0.002, type: 'bandpass', f0: 2200, f1: 900, q: 3, rng: this.rng });
      }
      if (this.layers.combat > 0.03 && s % 2 === 0) {
        const c = this.layers.combat;
        const root = ROOT + 12 + (PROG[this.chord % PROG.length] as number);
        const deg = [0, 0, 1, 0, 4, 0, 3, 1][(s >> 1) % 8] as number;
        const f = midiToHz(scaleDegreeToMidi(root, SCALES.phrygian, deg));
        tone(ac, out, t, { type: 'sawtooth', f0: f, dur: stepDur * 1.6, peak: 0.16 * c, attack: 0.004, lp: 500 + 700 * c });
      }
      this.stepT += stepDur;
      this.step++;
      if (this.step % 16 === 0) this.bar++;
    }
  }

  update(dt: number, target: number, enabled: boolean): void {
    if (!this.engine.ready || !this.engine.ac) return;
    if (!this.out) this.build();
    const ac = this.ac;
    if (!ac || !this.out) return;
    const now = ac.currentTime;
    const want = this.override ?? target;
    this.smoothed = asymmetricSmooth(this.smoothed, clamp01(want), dt, 1.6, 5);
    this.intensity = this.smoothed;
    this.master = asymmetricSmooth(this.master, enabled ? 1 : 0, dt, 2.5, 0.5);
    this.out.gain.setTargetAtTime(this.master, now, 0.15);
    const L = musicLayers(this.intensity);
    this.layers = L;
    this.padGain?.gain.setTargetAtTime(0.11 * L.pad, now, 0.6);
    this.padLp?.frequency.setTargetAtTime(260 + 700 * this.intensity, now, 0.8);
    this.tenGain?.gain.setTargetAtTime(0.06 * L.tension, now, 0.8);
    this.tenTrem?.frequency.setTargetAtTime(4.5 + 6 * this.intensity, now, 0.8);
    if (this.master > 0.02) {
      if (now - this.chordT > 8 * (1.3 - this.intensity * 0.6)) {
        this.chordT = now;
        this.chord++;
        this.setChord(this.chord, now);
      }
      this.schedule(now);
    } else {
      this.stepT = Math.max(this.stepT, now);
    }
  }

  dispose(): void {
    for (const s of this.srcs) {
      try {
        s.stop();
      } catch {
        /* nada */
      }
    }
    this.srcs = [];
    this.out?.disconnect();
    this.out = null;
  }
}
