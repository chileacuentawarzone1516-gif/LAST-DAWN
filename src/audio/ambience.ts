/** Ambiente: viento con ráfagas, zumbido industrial, retumbar de contaminación y sonidos sueltos aleatorios. */
import { CONTAMINATION } from '../config';
import type { RunState } from '../core/state';
import { clamp01, smoothstep } from '../core/util';
import type { Rng } from '../core/util';
import { between } from './pure';
import { biquad, gainNode, link, noiseBuffer } from './synth';
import type { AudioEngine } from './engine';

function src(ac: BaseAudioContext, kind: 'white' | 'pink' | 'brown', off: number): AudioBufferSourceNode {
  const s = ac.createBufferSource();
  s.buffer = noiseBuffer(ac, kind);
  s.loop = true;
  s.start(ac.currentTime, off);
  return s;
}

export interface AmbienceLayers {
  wind: boolean;
  hum: boolean;
  rumble: boolean;
  oneshots: boolean;
}

export class Ambience {
  readonly enabled: AmbienceLayers = { wind: true, hum: true, rumble: true, oneshots: true };
  private ac: AudioContext | null = null;
  private out: GainNode | null = null;
  private windLow: GainNode | null = null;
  private windHi: GainNode | null = null;
  private windLowLp: BiquadFilterNode | null = null;
  private whistle: GainNode | null = null;
  private whistleBp: BiquadFilterNode | null = null;
  private humGain: GainNode | null = null;
  private rumbleGain: GainNode | null = null;
  private rumbleLp: BiquadFilterNode | null = null;
  private crackle: GainNode | null = null;
  private sources: AudioScheduledSourceNode[] = [];
  private gustT = 2;
  private oneT = 6;
  private gust = 0;
  /** Nivel global 0..1 (flujo). */
  level = 0;

  constructor(private readonly engine: AudioEngine, private readonly rng: Rng) {}

  private build(): void {
    const eng = this.engine;
    const ac = eng.ac;
    const chain = eng.chain;
    if (!ac || !chain || this.out) return;
    this.ac = ac;
    const out = gainNode(ac, 0);
    out.connect(chain.buses.ambience.input);
    this.out = out;
    const track = <T extends AudioScheduledSourceNode>(n: T): T => {
      this.sources.push(n);
      return n;
    };
    // viento grave + siseo
    this.windLowLp = biquad(ac, 'lowpass', 500, 0.6);
    this.windLow = gainNode(ac, 0.3);
    link(track(src(ac, 'brown', 0.2)), this.windLowLp, this.windLow, out);
    this.windHi = gainNode(ac, 0.04);
    link(track(src(ac, 'pink', 1.1)), biquad(ac, 'bandpass', 1400, 0.5), this.windHi, out);
    // silbido a través de vallas
    this.whistleBp = biquad(ac, 'bandpass', 700, 14);
    this.whistle = gainNode(ac, 0.02);
    link(track(src(ac, 'pink', 0.6)), this.whistleBp, this.whistle, out);
    // zumbido industrial 50 Hz
    this.humGain = gainNode(ac, 0.05);
    for (const [f, g] of [[50, 1], [100.4, 0.5], [150.2, 0.25]] as const) {
      const o = track(ac.createOscillator());
      o.frequency.value = f;
      o.start();
      const gg = gainNode(ac, g);
      link(o, gg, this.humGain);
    }
    this.humGain.connect(out);
    link(track(src(ac, 'brown', 1.7)), biquad(ac, 'lowpass', 160, 0.7), gainNode(ac, 0.5), this.humGain);
    // retumbar de contaminación
    this.rumbleLp = biquad(ac, 'lowpass', 180, 0.7);
    this.rumbleGain = gainNode(ac, 0);
    link(track(src(ac, 'brown', 0.9)), this.rumbleLp, this.rumbleGain, out);
    const sub = track(ac.createOscillator());
    sub.frequency.value = 34;
    sub.start();
    link(sub, gainNode(ac, 0.6), this.rumbleGain);
    this.crackle = gainNode(ac, 0);
    link(track(src(ac, 'white', 0.4)), biquad(ac, 'highpass', 4500, 0.7), this.crackle, out);
  }

  update(dt: number, s: RunState, flowGain: number): void {
    const eng = this.engine;
    if (!eng.ready || !eng.ac) return;
    if (!this.out) this.build();
    const ac = this.ac;
    if (!ac || !this.out) return;
    const now = ac.currentTime;
    this.level += (flowGain - this.level) * Math.min(1, dt * 1.2);
    this.out.gain.setTargetAtTime(this.level, now, 0.2);

    const threat = { perimeter: 1, warehouses: 2, refinery: 3, complex: 4 }[s.player.zone] ?? 1;
    this.gustT -= dt;
    if (this.gustT <= 0) {
      this.gustT = between(this.rng, 3, 9);
      this.gust = between(this.rng, 0.4, 1);
    }
    this.gust *= Math.exp(-dt / 2.2);
    const w = this.enabled.wind ? 1 : 0;
    const windBase = (0.42 - 0.07 * threat) * w;
    this.windLow?.gain.setTargetAtTime(windBase * (0.6 + 0.9 * this.gust), now, 0.5);
    this.windLowLp?.frequency.setTargetAtTime(350 + 700 * this.gust, now, 0.4);
    this.windHi?.gain.setTargetAtTime(0.03 * w + 0.07 * this.gust * w, now, 0.4);
    this.whistle?.gain.setTargetAtTime(0.01 * w + 0.03 * this.gust * w, now, 0.4);
    this.whistleBp?.frequency.setTargetAtTime(600 + 700 * this.gust, now, 0.6);
    this.humGain?.gain.setTargetAtTime((0.02 + 0.03 * (threat - 1)) * (this.enabled.hum ? 1 : 0), now, 0.8);

    // contaminación: dentro = retumbar fuerte; fuera = se nota cerca del borde
    let rum = 0;
    let inside = 0;
    if (s.match.contamination.active && this.enabled.rumble) {
      const d = Math.hypot(s.player.pos.x - CONTAMINATION.center.x, s.player.pos.z - CONTAMINATION.center.z);
      const depth = s.match.contamination.radius - d;
      if (depth > 0) {
        inside = smoothstep(0, 40, depth);
        rum = 0.4 + 0.5 * inside;
      } else {
        rum = 0.35 * (1 - clamp01(-depth / 90)) ** 2;
      }
    }
    this.rumbleGain?.gain.setTargetAtTime(rum, now, 0.6);
    this.rumbleLp?.frequency.setTargetAtTime(150 + 250 * inside, now, 0.6);
    this.crackle?.gain.setTargetAtTime(0.03 * inside * (0.5 + 0.5 * Math.sin(now * 9) ** 2), now, 0.2);

    // sonidos sueltos
    this.oneT -= dt;
    if (this.oneT <= 0 && this.enabled.oneshots && this.level > 0.3) {
      this.oneT = between(this.rng, 7, 17) / (0.7 + 0.15 * threat);
      const az = between(this.rng, 0, Math.PI * 2);
      const cam = eng.listenerPos;
      const pos = (d: number) => ({ x: cam.x + Math.sin(az) * d, y: 2, z: cam.z - Math.cos(az) * d });
      const roll = this.rng();
      if (roll < 0.34) eng.play('amb.creak', { pos: pos(between(this.rng, 12, 45)) });
      else if (roll < 0.52) eng.play('amb.bang', { pos: pos(between(this.rng, 40, 110)) });
      else if (roll < 0.66 && threat <= 2) eng.play('amb.siren', { pos: pos(between(this.rng, 100, 180)) });
      else if (roll < 0.8) eng.play('amb.drip', { pos: pos(between(this.rng, 4, 20)) });
      else if (threat >= 2) eng.play('amb.howl', { pos: pos(between(this.rng, 60, 130)), gain: 0.6 });
    }
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* nada */
      }
    }
    this.sources = [];
    this.out?.disconnect();
    this.out = null;
  }
}

