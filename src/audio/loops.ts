/**
 * Bucles continuos con parámetros controlables: helicóptero y zumbido del relé.
 * Se construyen sobre BaseAudioContext (renderizables offline en QA).
 */
import { biquad, gainNode, link, noiseBuffer } from './synth';
import type { LoopHandle } from './types';

function loopNoise(ac: BaseAudioContext, kind: 'white' | 'pink' | 'brown', t0: number, offset: number): AudioBufferSourceNode {
  const s = ac.createBufferSource();
  s.buffer = noiseBuffer(ac, kind);
  s.loop = true;
  s.start(t0, offset);
  return s;
}

/** Onda periódica de pulso estrecho: «whop» seco del rotor al usarla como LFO. */
function pulseWave(ac: BaseAudioContext): PeriodicWave {
  const n = 14;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) imag[k] = 1 / k ** 0.7;
  return ac.createPeriodicWave(real, imag);
}

export interface HeliLoop extends LoopHandle {
  /** rotor 0..1, doppler (razón de tono), wash 0..1 (cercanía: viento del rotor). */
  set(rotor: number, doppler: number, wash: number, when: number): void;
}

export function createHeliLoop(ac: BaseAudioContext, dest: AudioNode, t0: number): HeliLoop {
  const out = gainNode(ac, 0);
  out.connect(dest);
  const srcs: AudioScheduledSourceNode[] = [];

  const lfo = ac.createOscillator();
  lfo.setPeriodicWave(pulseWave(ac));
  lfo.frequency.value = 6;
  lfo.start(t0);
  srcs.push(lfo);

  const rotorNoise = loopNoise(ac, 'brown', t0, 0.3);
  const bp = biquad(ac, 'bandpass', 480, 0.8);
  const chop = gainNode(ac, 0.55);
  const chopDepth = gainNode(ac, 0.45);
  lfo.connect(chopDepth);
  chopDepth.connect(chop.gain);
  const rotorGain = gainNode(ac, 0.9);
  link(rotorNoise, bp, chop, rotorGain, out);

  const thump = ac.createOscillator();
  thump.frequency.value = 48;
  thump.start(t0);
  const thumpChop = gainNode(ac, 0.5);
  const thumpDepth = gainNode(ac, 0.5);
  lfo.connect(thumpDepth);
  thumpDepth.connect(thumpChop.gain);
  const thumpGain = gainNode(ac, 0.5);
  link(thump, thumpChop, thumpGain, out);

  const turbine = ac.createOscillator();
  turbine.type = 'sawtooth';
  turbine.frequency.value = 900;
  turbine.start(t0);
  const tbp = biquad(ac, 'bandpass', 1300, 6);
  const turbGain = gainNode(ac, 0.05);
  link(turbine, tbp, turbGain, out);

  const wash = loopNoise(ac, 'pink', t0, 0.9);
  const washBp = biquad(ac, 'bandpass', 520, 0.6);
  const washGain = gainNode(ac, 0);
  link(wash, washBp, washGain, out);

  srcs.push(rotorNoise, thump, turbine, wash);
  let stopped = false;
  return {
    out,
    nodeCount: 22,
    set(rotor, doppler, washAmt, when) {
      if (stopped) return;
      const r = Math.max(0, Math.min(1, rotor));
      const tc = 0.08;
      lfo.frequency.setTargetAtTime((5 + 8.5 * r) * doppler, when, tc);
      turbine.frequency.setTargetAtTime((520 + 900 * r) * doppler, when, tc);
      tbp.frequency.setTargetAtTime((800 + 900 * r) * doppler, when, tc);
      out.gain.setTargetAtTime(0.85 * r ** 1.3, when, 0.15);
      turbGain.gain.setTargetAtTime(0.03 + 0.09 * r * r, when, tc);
      washGain.gain.setTargetAtTime(0.5 * washAmt * r, when, 0.2);
      bp.frequency.setTargetAtTime((300 + 350 * r) * doppler, when, tc);
    },
    stop(when, fade = 0.6) {
      if (stopped) return;
      stopped = true;
      out.gain.cancelScheduledValues(when);
      out.gain.setTargetAtTime(0, when, fade / 3);
      for (const s of srcs) {
        try {
          s.stop(when + fade * 2);
        } catch {
          /* ya parado */
        }
      }
    },
  };
}

export interface RelayLoop extends LoopHandle {
  /** progreso 0..1 y si el jugador está dentro del círculo. */
  set(progress: number, inside: boolean, when: number): void;
}

export function createRelayLoop(ac: BaseAudioContext, dest: AudioNode, t0: number): RelayLoop {
  const out = gainNode(ac, 0);
  out.connect(dest);
  const mk = (type: OscillatorType, f: number): OscillatorNode => {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.start(t0);
    return o;
  };
  const a = mk('sawtooth', 70);
  const b = mk('sawtooth', 70.5);
  const sub = mk('sine', 35);
  const lp = biquad(ac, 'lowpass', 400, 1.5);
  const trem = gainNode(ac, 0.7);
  const tremLfo = mk('sine', 6);
  const tremDepth = gainNode(ac, 0.3);
  tremLfo.connect(tremDepth);
  tremDepth.connect(trem.gain);
  a.connect(lp);
  b.connect(lp);
  link(lp, trem, out);
  const subGain = gainNode(ac, 0.6);
  link(sub, subGain, out);
  const buzz = mk('square', 100);
  const buzzGain = gainNode(ac, 0);
  link(buzz, biquad(ac, 'bandpass', 900, 3), buzzGain, out);
  const nodes: OscillatorNode[] = [a, b, sub, tremLfo, buzz];
  let stopped = false;
  return {
    out,
    nodeCount: 16,
    set(progress, inside, when) {
      if (stopped) return;
      const p = Math.max(0, Math.min(1, progress));
      const f = 70 + 170 * p;
      const tc = 0.25;
      a.frequency.setTargetAtTime(f, when, tc);
      b.frequency.setTargetAtTime(f * (1.004 + 0.004 * p), when, tc);
      sub.frequency.setTargetAtTime(f / 2, when, tc);
      buzz.frequency.setTargetAtTime(f * 1.5, when, tc);
      lp.frequency.setTargetAtTime(350 + 1500 * p, when, tc);
      tremLfo.frequency.setTargetAtTime(5 + 9 * p, when, tc);
      buzzGain.gain.setTargetAtTime(0.02 + 0.06 * p, when, tc);
      out.gain.setTargetAtTime(inside ? 0.32 + 0.18 * p : 0.1, when, 0.3);
    },
    stop(when, fade = 0.5) {
      if (stopped) return;
      stopped = true;
      out.gain.cancelScheduledValues(when);
      out.gain.setTargetAtTime(0, when, fade / 3);
      for (const o of nodes) {
        try {
          o.stop(when + fade * 2);
        } catch {
          /* ya parado */
        }
      }
    },
  };
}
