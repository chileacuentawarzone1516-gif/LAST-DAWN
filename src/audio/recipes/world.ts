/** Recetas de mundo y partida: UI, tienda, radio, relé, extracción, alarmas, stingers y ambientales sueltos. */
import { between, midiToHz } from '../pure';
import { biquad, formantVoice, gainNode, link, noiseBurst, osc, partials, ramp, saturator, scatter, sweep, tone } from '../synth';
import type { Recipe, RecipeDef } from '../types';
import { defineRecipe, mechClick, thunk } from './define';

// ── UI ──────────────────────────────────────────────────────────────────────
const uiClick: Recipe = (ac, dest, t0, p) => {
  mechClick(ac, dest, t0, p.rng, { peak: 0.14, f: 3200, ring: 0 });
  tone(ac, dest, t0, { f0: 900 * p.pitch, f1: 700 * p.pitch, dur: 0.05, peak: 0.12, attack: 0.002, lp: 3500 });
};
const notify = (notes: readonly number[], type: OscillatorType, peak: number, gap = 0.09): Recipe => (ac, dest, t0, p) => {
  notes.forEach((f, i) => tone(ac, dest, t0 + i * gap, { type, f0: f * p.pitch, dur: 0.16, peak, attack: 0.004, lp: 3200 }));
};
const notifyDanger: Recipe = (ac, dest, t0) => {
  for (let i = 0; i < 2; i++) tone(ac, dest, t0 + i * 0.15, { type: 'sawtooth', f0: 220, f1: 200, dur: 0.12, peak: 0.13, attack: 0.004, lp: 900 });
};
const holdTick: Recipe = (ac, dest, t0, p) => {
  const f = 420 * 2 ** (p.level * 1.6);
  tone(ac, dest, t0, { type: 'triangle', f0: f, dur: 0.035, peak: 0.13, attack: 0.001, lp: 4000 });
};
const shopOpen: Recipe = (ac, dest, t0, p) => {
  mechClick(ac, dest, t0, p.rng, { peak: 0.3, f: 1200 });
  thunk(ac, dest, t0 + 0.01, p.rng, { peak: 0.25, f: 100 });
  tone(ac, dest, t0 + 0.1, { f0: 660, dur: 0.1, peak: 0.08, attack: 0.004, lp: 3000 });
  tone(ac, dest, t0 + 0.18, { f0: 990, dur: 0.14, peak: 0.08, attack: 0.004, lp: 3000 });
};
const shopClose: Recipe = (ac, dest, t0, p) => {
  tone(ac, dest, t0, { f0: 800, dur: 0.08, peak: 0.08, attack: 0.004, lp: 3000 });
  mechClick(ac, dest, t0 + 0.09, p.rng, { peak: 0.26, f: 1100 });
};
const shopPurchase: Recipe = (ac, dest, t0, p) => {
  scatter(ac, dest, t0, { count: 7, span: 0.16, peak: 0.12, fLo: 2200, fHi: 4200, q: 3, hitDur: 0.012, rng: p.rng });
  mechClick(ac, dest, t0 + 0.17, p.rng, { peak: 0.3, f: 1500 });
  partials(ac, dest, t0 + 0.19, { f: 2093, ratios: [1, 1.5, 2.71], decay: 0.6, peak: 0.16 });
  partials(ac, dest, t0 + 0.27, { f: 3136, ratios: [1, 2.71], decay: 0.5, peak: 0.11 });
};
const shopDenied: Recipe = (ac, dest, t0) => {
  for (let i = 0; i < 2; i++) tone(ac, dest, t0 + i * 0.16, { type: 'square', f0: 110, dur: 0.12, peak: 0.16, attack: 0.004, lp: 700 });
};

// ── Radio / relé / extracción ───────────────────────────────────────────────
/** Charla de radio ininteligible: sílabas con formantes en banda telefónica. */
const radioBabble: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  const dur = 1.5;
  const o = osc(ac, 'sawtooth', 120, t0, t0 + dur + 0.1);
  const f1 = biquad(ac, 'bandpass', 600, 5);
  const f2 = biquad(ac, 'bandpass', 1500, 6);
  const amp = gainNode(ac, 0);
  const sum = gainNode(ac, 1);
  o.connect(f1); o.connect(f2);
  link(f1, sum); link(f2, sum);
  const bp = biquad(ac, 'bandpass', 1400, 0.7);
  const sh = saturator(ac, 0.3);
  link(sum, amp, bp, sh, dest);
  let t = t0 + 0.12;
  while (t < t0 + dur) {
    const d = between(r, 0.06, 0.15);
    o.frequency.setValueAtTime(between(r, 100, 150), t);
    f1.frequency.setValueAtTime(between(r, 350, 800), t);
    f2.frequency.setValueAtTime(between(r, 1000, 2400), t);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.16, t + 0.015);
    amp.gain.setValueAtTime(0.16, t + d * 0.8);
    amp.gain.linearRampToValueAtTime(0, t + d);
    t += d + (r() < 0.2 ? between(r, 0.1, 0.25) : 0.02);
  }
  noiseBurst(ac, dest, t0, { dur: dur + 0.1, peak: 0.05, attack: 0.05, type: 'bandpass', f0: 1800, q: 0.6, rng: r });
};
const radioCall: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  noiseBurst(ac, dest, t0, { dur: 0.08, peak: 0.25, attack: 0.002, type: 'bandpass', f0: 2200, q: 0.8, rng: r });
  radioBabble(ac, dest, t0 + 0.1, p);
  for (let i = 0; i < 3; i++) tone(ac, dest, t0 + 1.75 + i * 0.16, { f0: 1000, dur: 0.09, peak: 0.1, attack: 0.003, lp: 3000 });
  noiseBurst(ac, dest, t0 + 2.3, { dur: 0.12, peak: 0.2, attack: 0.002, type: 'bandpass', f0: 2000, q: 0.8, rng: r });
};
const relayActivated: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  thunk(ac, dest, t0, r, { peak: 0.5, f: 80, dur: 0.15 });
  mechClick(ac, dest, t0, r, { peak: 0.3, f: 1000 });
  tone(ac, dest, t0 + 0.1, { type: 'sawtooth', f0: 60, f1: 240, dur: 1.4, peak: 0.16, attack: 0.3, lp: 1400, curve: 'lin' });
  noiseBurst(ac, dest, t0 + 0.2, { dur: 0.6, peak: 0.14, attack: 0.1, type: 'bandpass', f0: 1500, f1: 3000, q: 0.8, rng: r });
  for (let i = 0; i < 3; i++) tone(ac, dest, t0 + 1.2 + i * 0.13, { f0: 880 * (1 + i * 0.25), dur: 0.1, peak: 0.1, attack: 0.003, lp: 3500 });
};
const extractionBoarding: Recipe = (ac, dest, t0, p) => {
  thunk(ac, dest, t0, p.rng, { peak: 0.3, f: 90, dur: 0.1 });
  tone(ac, dest, t0, { f0: 660, dur: 0.1, peak: 0.08, attack: 0.004, lp: 3000 });
};
const extractionLanded: Recipe = (ac, dest, t0, p) => {
  thunk(ac, dest, t0, p.rng, { peak: 0.6, f: 60, dur: 0.35 });
  scatter(ac, dest, t0, { count: 10, span: 0.5, peak: 0.14, fLo: 500, fHi: 2500, q: 1.2, hitDur: 0.05, rng: p.rng });
  partials(ac, dest, t0 + 0.05, { f: 200, ratios: [1, 2.4, 3.9], decay: 0.6, peak: 0.16 });
};
const extractionDeparted: Recipe = (ac, dest, t0, p) => {
  mechClick(ac, dest, t0, p.rng, { peak: 0.26, f: 1200 });
  for (let i = 0; i < 2; i++) tone(ac, dest, t0 + 0.15 + i * 0.18, { f0: 740 - i * 180, dur: 0.14, peak: 0.1, attack: 0.004, lp: 3000 });
};

// ── Partida ─────────────────────────────────────────────────────────────────
const hordeSting: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  tone(ac, dest, t0, { f0: 62, f1: 32, dur: 0.9, peak: 0.7, attack: 0.004, sat: 0.3 });
  noiseBurst(ac, dest, t0, { kind: 'brown', dur: 1.8, peak: 0.35, attack: 0.05, type: 'lowpass', f0: 300, f1: 90, rng: r });
  const fs = [110, 116.5, 164.8];
  fs.forEach((f) => tone(ac, dest, t0 + 0.05, { type: 'sawtooth', f0: f * 0.9, f1: f * 1.05, dur: 2.0, peak: 0.07, attack: 0.9, lp: 700, curve: 'lin' }));
  noiseBurst(ac, dest, t0 + 0.8, { dur: 0.35, peak: 0.3, attack: 0.001, type: 'bandpass', f0: 1800, q: 0.8, rng: r });
};
const siren: Recipe = (ac, dest, t0, p) => {
  const dur = 8.5;
  const o = osc(ac, 'sawtooth', 500, t0, t0 + dur + 0.1);
  const lfo = osc(ac, 'sine', 1 / 3.2, t0, t0 + dur + 0.1);
  const lg = gainNode(ac, 170);
  link(lfo, lg);
  lg.connect(o.frequency);
  o.frequency.setValueAtTime(560, t0);
  const lp = biquad(ac, 'lowpass', 1800, 0.7);
  const env = gainNode(ac, 0);
  ramp(env.gain, t0, [[0, 0], [0.8, 0.2], [dur - 1.6, 0.2], [dur, 0]]);
  link(o, lp, env, dest);
  tone(ac, dest, t0, { f0: 45, dur: dur, peak: 0.25, attack: 1.5, lp: 90, curve: 'lin' });
  noiseBurst(ac, dest, t0, { kind: 'brown', dur: dur, peak: 0.2, attack: 1.2, type: 'lowpass', f0: 200, rng: p.rng });
};
const warning = (n: number, f: number, gap: number): Recipe => (ac, dest, t0) => {
  for (let i = 0; i < n; i++) {
    tone(ac, dest, t0 + i * gap, { type: 'square', f0: f, dur: gap * 0.6, peak: 0.13, attack: 0.004, lp: 2400 });
    tone(ac, dest, t0 + i * gap, { f0: f * 2, dur: gap * 0.5, peak: 0.05, attack: 0.004 });
  }
};
const sealedHorn: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  [82.4, 123.5, 164.8].forEach((f, i) => {
    const o = osc(ac, 'sawtooth', f, t0, t0 + 3.9);
    o.frequency.setValueAtTime(f, t0);
    o.frequency.linearRampToValueAtTime(f * 0.96, t0 + 3.8);
    const lp = biquad(ac, 'lowpass', 520, 0.8);
    const g = gainNode(ac, 0);
    ramp(g.gain, t0, [[0, 0], [0.25, 0.22 - i * 0.05], [2.4, 0.2 - i * 0.05], [3.8, 0]]);
    link(o, lp, g, dest);
  });
  thunk(ac, dest, t0, r, { peak: 0.5, f: 70, dur: 0.3 });
  partials(ac, dest, t0 + 0.05, { f: 150, ratios: [1, 2.4, 3.9], decay: 1.2, peak: 0.12 });
};
const zoneEnter = (threat: number): Recipe => (ac, dest, t0, p) => {
  const base = midiToHz(45 + threat * 1.5);
  tone(ac, dest, t0, { f0: base, dur: 2.2, peak: 0.12, attack: 0.9, lp: 500, curve: 'lin' });
  tone(ac, dest, t0, { f0: base * 1.5, dur: 2.0, peak: 0.06, attack: 1.0, lp: 700, curve: 'lin' });
  if (threat >= 3) noiseBurst(ac, dest, t0, { kind: 'brown', dur: 2.2, peak: 0.16, attack: 0.9, type: 'lowpass', f0: 200, rng: p.rng });
  if (threat >= 4) {
    tone(ac, dest, t0, { f0: 78, f1: 34, dur: 1.4, peak: 0.3, attack: 0.02, sat: 0.2 });
    tone(ac, dest, t0 + 0.2, { type: 'sawtooth', f0: 233, dur: 1.8, peak: 0.04, attack: 0.8, lp: 900, curve: 'lin' });
  }
};
const stingerWon: Recipe = (ac, dest, t0) => {
  [57, 64, 69, 73].forEach((m, i) => {
    const f = midiToHz(m);
    tone(ac, dest, t0 + i * 0.12, { type: 'sawtooth', f0: f, dur: 3.6, peak: 0.1, attack: 0.35, lp: 1600, curve: 'lin' });
    partials(ac, dest, t0 + 0.3 + i * 0.25, { f: f * 4, ratios: [1, 2.76], decay: 1.4, peak: 0.05 });
  });
  tone(ac, dest, t0, { f0: 55, dur: 4, peak: 0.25, attack: 0.1, lp: 120, curve: 'lin' });
};
const stingerLost: Recipe = (ac, dest, t0, p) => {
  tone(ac, dest, t0, { f0: 70, f1: 30, dur: 1.4, peak: 0.6, attack: 0.005, sat: 0.3 });
  [55, 58.3, 82].forEach((f) => tone(ac, dest, t0, { type: 'sawtooth', f0: f, f1: f * 0.66, dur: 4.4, peak: 0.09, attack: 0.5, lp: 500, curve: 'lin' }));
  noiseBurst(ac, dest, t0, { kind: 'brown', dur: 4.4, peak: 0.25, attack: 0.4, type: 'lowpass', f0: 240, f1: 60, rng: p.rng });
};
const missionComplete: Recipe = (ac, dest, t0) => {
  [72, 76, 79, 84].forEach((m, i) => partials(ac, dest, t0 + i * 0.1, { f: midiToHz(m), ratios: [1, 2.01, 3], decay: 0.8, peak: 0.1, attack: 0.003 }));
};
const tinnitus: Recipe = (ac, dest, t0, p) => {
  tone(ac, dest, t0, { f0: 7400, dur: 3.2 * (0.5 + 0.5 * p.intensity), peak: 0.05, attack: 0.05 });
  tone(ac, dest, t0, { f0: 5900, dur: 2.6 * (0.5 + 0.5 * p.intensity), peak: 0.03, attack: 0.05 });
};

// ── Ambientales sueltos ─────────────────────────────────────────────────────
const ambCreak: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  const dur = between(r, 1.2, 2.4);
  const f = between(r, 55, 95);
  const o = osc(ac, 'sawtooth', f, t0, t0 + dur + 0.1);
  o.frequency.linearRampToValueAtTime(f * between(r, 0.8, 1.35), t0 + dur);
  const bp = biquad(ac, 'bandpass', 300, 8);
  sweep(bp.frequency, t0, 300, between(r, 600, 1100), dur);
  const g = gainNode(ac, 0);
  ramp(g.gain, t0, [[0, 0], [dur * 0.3, 0.3], [dur * 0.7, 0.2], [dur, 0]]);
  link(o, saturator(ac, 0.3), bp, g, dest);
  scatter(ac, dest, t0, { count: 8, span: dur, peak: 0.05, fLo: 900, fHi: 2200, q: 8, hitDur: 0.03, rng: r });
};
const ambBang: Recipe = (ac, dest, t0, p) => {
  partials(ac, dest, t0, { f: between(p.rng, 150, 260), ratios: [1, 2.32, 3.7, 5.1], decay: 1.4, peak: 0.3, damp: 0.7 });
  noiseBurst(ac, dest, t0, { dur: 0.3, peak: 0.3, attack: 0.001, type: 'lowpass', f0: 3000, f1: 300, rng: p.rng });
};
const ambSirenFar: Recipe = (ac, dest, t0) => {
  const dur = 6;
  const o = osc(ac, 'sine', 600, t0, t0 + dur + 0.1);
  o.frequency.setValueAtTime(450, t0);
  o.frequency.linearRampToValueAtTime(760, t0 + dur * 0.5);
  o.frequency.linearRampToValueAtTime(450, t0 + dur);
  const g = gainNode(ac, 0);
  ramp(g.gain, t0, [[0, 0], [1.5, 0.2], [dur - 1.5, 0.2], [dur, 0]]);
  link(o, biquad(ac, 'lowpass', 1200, 0.7), g, dest);
};
const ambDrip: Recipe = (ac, dest, t0, p) => {
  const f = between(p.rng, 900, 1500);
  tone(ac, dest, t0, { f0: f, f1: f * 0.6, dur: 0.05, peak: 0.16, attack: 0.001 });
};
const ambHowl: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  formantVoice(ac, dest, t0, {
    dur: 2.2, peak: 0.2, f0: [between(r, 90, 110), between(r, 120, 150), between(r, 85, 100)],
    formants: [{ from: 450, to: 700, q: 5, gain: 1 }, { from: 850, to: 1100, q: 7, gain: 0.5 }],
    vib: { rate: 5, depth: 0.025 }, breath: 0.4, env: [[0, 0], [0.4, 1], [0.7, 0.8], [1, 0]], rng: r,
  });
};

export function worldRecipes(): RecipeDef[] {
  const ui = { bus: 'ui' as const, send: 0.04 };
  return [
    defineRecipe('ui.click', 'ui', 60, 0.1, uiClick, ui),
    defineRecipe('ui.notify.info', 'ui', 40, 0.3, notify([880, 1175], 'sine', 0.09), ui),
    defineRecipe('ui.notify.warn', 'ui', 50, 0.4, notify([660, 660, 660], 'square', 0.07, 0.11), ui),
    defineRecipe('ui.notify.danger', 'ui', 55, 0.4, notifyDanger, ui),
    defineRecipe('ui.notify.reward', 'ui', 50, 0.5, notify([784, 988, 1319], 'triangle', 0.1, 0.08), ui),
    defineRecipe('ui.hold', 'ui', 35, 0.07, holdTick, { bus: 'ui', send: 0, minDur: 0.02 }),
    defineRecipe('shop.open', 'ui', 55, 0.4, shopOpen, ui),
    defineRecipe('shop.close', 'ui', 55, 0.3, shopClose, ui),
    defineRecipe('shop.purchase', 'ui', 60, 1.0, shopPurchase, { bus: 'ui', send: 0.1, minDur: 0.3 }),
    defineRecipe('shop.denied', 'ui', 60, 0.4, shopDenied, ui),
    defineRecipe('radio.call', 'alarm', 70, 2.5, radioCall, { send: 0.08, minDur: 1 }),
    defineRecipe('relay.activated', 'alarm', 72, 2.0, relayActivated, { send: 0.15, minDur: 0.8 }),
    defineRecipe('extraction.boarding', 'ui', 50, 0.3, extractionBoarding, { ...ui, minDur: 0.05 }),
    defineRecipe('extraction.landed', 'alarm', 70, 1.2, extractionLanded, { send: 0.2, minDur: 0.3 }),
    defineRecipe('extraction.departed', 'alarm', 60, 0.5, extractionDeparted, { send: 0.1 }),
    defineRecipe('horde.sting', 'stinger', 90, 2.6, hordeSting, { send: 0.3, minDur: 1 }),
    defineRecipe('match.siren', 'stinger', 88, 9, siren, { send: 0.4, minDur: 4 }),
    defineRecipe('match.warning2', 'alarm', 66, 0.8, warning(2, 880, 0.3), { send: 0.06 }),
    defineRecipe('match.warning3', 'alarm', 66, 1.0, warning(3, 740, 0.3), { send: 0.06 }),
    defineRecipe('match.warningUrgent', 'alarm', 72, 0.9, warning(5, 1175, 0.17), { send: 0.06 }),
    defineRecipe('match.sealed', 'stinger', 92, 4.1, sealedHorn, { send: 0.35, minDur: 2 }),
    defineRecipe('zone.enter.1', 'ui', 35, 2.7, zoneEnter(1), { bus: 'ui', send: 0.2, minDur: 0.8 }),
    defineRecipe('zone.enter.2', 'ui', 35, 2.7, zoneEnter(2), { bus: 'ui', send: 0.2, minDur: 0.8 }),
    defineRecipe('zone.enter.3', 'ui', 35, 2.7, zoneEnter(3), { bus: 'ui', send: 0.2, minDur: 0.8 }),
    defineRecipe('zone.enter.4', 'ui', 38, 2.7, zoneEnter(4), { bus: 'ui', send: 0.22, minDur: 0.8 }),
    defineRecipe('stinger.won', 'stinger', 95, 4.6, stingerWon, { bus: 'ui', send: 0.35, minDur: 1.5 }),
    defineRecipe('stinger.lost', 'stinger', 95, 5, stingerLost, { bus: 'ui', send: 0.35, minDur: 1.5 }),
    defineRecipe('mission.complete', 'stinger', 80, 1.6, missionComplete, { bus: 'ui', send: 0.25, minDur: 0.5 }),
    defineRecipe('fx.tinnitus', 'ui', 40, 3.4, tinnitus, { bus: 'ui', send: 0, minDur: 1 }),
    defineRecipe('amb.creak', 'ambient', 20, 2.6, ambCreak, { bus: 'ambience', send: 0.3, range: 90, minDur: 0.6 }),
    defineRecipe('amb.bang', 'ambient', 20, 1.7, ambBang, { bus: 'ambience', send: 0.4, range: 120, minDur: 0.4 }),
    defineRecipe('amb.siren', 'ambient', 15, 6.2, ambSirenFar, { bus: 'ambience', send: 0.4, range: 200, minDur: 3 }),
    defineRecipe('amb.drip', 'ambient', 10, 0.2, ambDrip, { bus: 'ambience', send: 0.5, range: 40, minDur: 0.02 }),
    defineRecipe('amb.howl', 'ambient', 15, 2.5, ambHowl, { bus: 'ambience', send: 0.4, range: 150, minDur: 0.6 }),
  ];
}
