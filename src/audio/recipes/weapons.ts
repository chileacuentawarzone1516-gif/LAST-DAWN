/** Recetas de armas: disparos, recargas, disparo en seco, cambio de arma, granada y placa de armadura. */
import { WEAPONS } from '../../config';
import type { WeaponId } from '../../core/types';
import { between, chance, vary } from '../pure';
import { noiseBurst, partials, pingScatter, scatter, tone } from '../synth';
import type { Recipe, RecipeDef } from '../types';
import { defineRecipe, mechClick, rasp, thunk, whoosh } from './define';

// ─────────────────────────────────────────────────────────────────────────────
// Disparos
// ─────────────────────────────────────────────────────────────────────────────
interface GunSpec {
  /** Frecuencia del chasquido (paso-alto) y su nivel. */
  snapF: number;
  crack: number;
  /** Cuerpo: ráfaga de ruido con paso-bajo que cae. */
  bodyDur: number;
  bodyF0: number;
  bodyF1: number;
  body: number;
  /** Golpe grave. */
  thumpF0: number;
  thumpF1: number;
  thumpDur: number;
  thump: number;
  /** Cola de sala. */
  tailDur: number;
  tailF0: number;
  tailF1: number;
  tail: number;
  /** Reflexiones: [retardo, nivel, frecuencia, duración]. */
  echoes: ReadonlyArray<readonly [number, number, number, number]>;
  pellets?: number;
  /** Ping supersónico agudo (rifles de precisión). */
  ping?: number;
  /** Timbre extra de cadencia (subfusil): zumbido del mecanismo. */
  buzz?: number;
  dur: number;
  trim: number;
  priority: number;
}

const GUNS: Record<WeaponId, GunSpec> = {
  pistol: {
    snapF: 2600, crack: 0.5, bodyDur: 0.09, bodyF0: 6500, bodyF1: 900, body: 0.5,
    thumpF0: 260, thumpF1: 90, thumpDur: 0.07, thump: 0.45,
    tailDur: 0.42, tailF0: 2400, tailF1: 500, tail: 0.16, echoes: [[0.09, 0.05, 1400, 0.25]],
    dur: 0.55, trim: 1, priority: 88,
  },
  revolver: {
    snapF: 2200, crack: 0.55, bodyDur: 0.26, bodyF0: 5200, bodyF1: 320, body: 0.7,
    thumpF0: 150, thumpF1: 38, thumpDur: 0.24, thump: 0.85,
    tailDur: 1.1, tailF0: 1800, tailF1: 250, tail: 0.28, echoes: [[0.16, 0.14, 900, 0.5], [0.33, 0.07, 600, 0.6]],
    dur: 1.5, trim: 1, priority: 92,
  },
  carbine: {
    snapF: 3000, crack: 0.45, bodyDur: 0.14, bodyF0: 6000, bodyF1: 700, body: 0.55,
    thumpF0: 190, thumpF1: 62, thumpDur: 0.09, thump: 0.5,
    tailDur: 0.55, tailF0: 2200, tailF1: 400, tail: 0.17, echoes: [[0.11, 0.06, 1200, 0.3]],
    dur: 0.7, trim: 1, priority: 88,
  },
  smg: {
    snapF: 4200, crack: 0.4, bodyDur: 0.07, bodyF0: 7000, bodyF1: 1200, body: 0.45,
    thumpF0: 300, thumpF1: 110, thumpDur: 0.05, thump: 0.35,
    tailDur: 0.28, tailF0: 3000, tailF1: 700, tail: 0.11, echoes: [],
    buzz: 0.06, dur: 0.4, trim: 1, priority: 86,
  },
  assault: {
    snapF: 3400, crack: 0.5, bodyDur: 0.16, bodyF0: 6500, bodyF1: 600, body: 0.6,
    thumpF0: 165, thumpF1: 52, thumpDur: 0.11, thump: 0.55,
    tailDur: 0.75, tailF0: 2000, tailF1: 350, tail: 0.2, echoes: [[0.13, 0.08, 1000, 0.4]],
    dur: 0.95, trim: 1, priority: 90,
  },
  shotgun: {
    snapF: 2000, crack: 0.5, bodyDur: 0.28, bodyF0: 7500, bodyF1: 260, body: 0.85,
    thumpF0: 120, thumpF1: 32, thumpDur: 0.26, thump: 0.9,
    tailDur: 1.25, tailF0: 1700, tailF1: 220, tail: 0.3, echoes: [[0.14, 0.12, 800, 0.5], [0.3, 0.06, 500, 0.6]],
    pellets: 2, dur: 1.7, trim: 1, priority: 94,
  },
  dmr: {
    snapF: 5200, crack: 0.7, bodyDur: 0.2, bodyF0: 5500, bodyF1: 500, body: 0.6,
    thumpF0: 150, thumpF1: 46, thumpDur: 0.18, thump: 0.6,
    tailDur: 1.6, tailF0: 1600, tailF1: 200, tail: 0.24,
    echoes: [[0.21, 0.14, 1100, 0.7], [0.43, 0.08, 750, 0.8], [0.7, 0.04, 500, 0.9]],
    ping: 0.16, dur: 2.4, trim: 1, priority: 92,
  },
};

/** Disparo por capas: chasquido + cuerpo + golpe grave + cola + reflexiones, con variación de tono/timbre. */
function gunRecipe(s: GunSpec): Recipe {
  return (ac, dest, t0, p) => {
    const r = p.rng;
    const k = vary(r, 1, 0.045) * p.pitch;
    const br = vary(r, 1, 0.14);
    const sup = p.alt;
    const q = sup ? 0.5 : 1;
    const pellets = s.pellets ?? 1;
    if (!sup) {
      for (let i = 0; i < pellets; i++) {
        noiseBurst(ac, dest, t0, {
          delay: i * between(r, 0.0005, 0.0024), dur: 0.011 + i * 0.002, peak: (s.crack * (pellets > 1 ? 0.75 : 1)) * vary(r, 1, 0.1),
          attack: 0.0005, type: 'highpass', f0: s.snapF * br, q: 0.8, rng: r,
        });
      }
      tone(ac, dest, t0, { type: 'square', f0: s.snapF * 0.55 * k, f1: s.snapF * 0.08 * k, dur: 0.012, peak: s.crack * 0.2, attack: 0.0004 });
      if (s.ping) partials(ac, dest, t0, { f: 6400 * br, ratios: [1, 1.5], decay: 0.05, peak: s.ping, attack: 0.0006 });
    } else {
      noiseBurst(ac, dest, t0, { dur: 0.02, peak: s.crack * 0.28, attack: 0.001, type: 'bandpass', f0: s.snapF * 0.5, q: 0.9, rng: r });
    }
    noiseBurst(ac, dest, t0, {
      dur: s.bodyDur * (sup ? 1.3 : 1), peak: s.body * q, attack: 0.0012, type: 'lowpass',
      f0: s.bodyF0 * br * (sup ? 0.4 : 1), f1: s.bodyF1, q: 0.9, rng: r,
    });
    tone(ac, dest, t0, { f0: s.thumpF0 * k, f1: s.thumpF1 * k, dur: s.thumpDur, peak: s.thump * (sup ? 0.7 : 1), attack: 0.0015, sat: 0.3 });
    if (s.buzz) tone(ac, dest, t0, { type: 'square', f0: 205 * k, dur: 0.035, peak: s.buzz, attack: 0.002, lp: 900 });
    noiseBurst(ac, dest, t0, {
      kind: 'pink', dur: s.tailDur * (sup ? 0.7 : 1), peak: s.tail * (sup ? 0.6 : 1), attack: 0.012, type: 'lowpass',
      f0: s.tailF0 * br * (sup ? 0.5 : 1), f1: s.tailF1, q: 0.6, rng: r,
    });
    for (const [dt, pk, f, d] of s.echoes) {
      noiseBurst(ac, dest, t0, {
        kind: 'pink', delay: dt * vary(r, 1, 0.06), dur: d, peak: pk * (sup ? 0.5 : 1), attack: 0.012, type: 'bandpass', f0: f, f1: f * 0.5, q: 0.7, rng: r,
      });
    }
  };
}

function gunDefs(): RecipeDef[] {
  return (Object.keys(GUNS) as WeaponId[]).map((id) => {
    const s = GUNS[id];
    return defineRecipe(`gun.${id}`, 'gun', s.priority, s.dur, gunRecipe(s), { trim: s.trim, send: id === 'smg' ? 0.16 : 0.24, minDur: s.dur * 0.25 });
  });
}

/** Bombeo de la escopeta (corredera atrás y adelante). Se programa ~0.4 s después del disparo. */
const shotgunPump: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  rasp(ac, dest, t0, r, { dur: 0.07, peak: 0.1, f0: 600, f1: 1500 });
  mechClick(ac, dest, t0 + 0.075, r, { peak: 0.3, f: 1500 });
  thunk(ac, dest, t0 + 0.078, r, { peak: 0.22, f: 110, noise: false });
  rasp(ac, dest, t0 + 0.17, r, { dur: 0.06, peak: 0.09, f0: 1500, f1: 700 });
  mechClick(ac, dest, t0 + 0.235, r, { peak: 0.36, f: 1300, ring: 1.4 });
  thunk(ac, dest, t0 + 0.24, r, { peak: 0.32, f: 95, dur: 0.09 });
};

// ─────────────────────────────────────────────────────────────────────────────
// Recargas (sincronizadas con la duración pedida)
// ─────────────────────────────────────────────────────────────────────────────
type ReloadKind = 'pistol' | 'revolver' | 'rifle' | 'dmr' | 'shotgun';

function reloadRecipe(kind: ReloadKind, defaultS: number): Recipe {
  return (ac, dest, t0, p) => {
    const r = p.rng;
    const D = p.duration > 0 ? p.duration : defaultS;
    const at = (f: number): number => t0 + D * f;
    const k = p.pitch * vary(r, 1, 0.05);
    switch (kind) {
      case 'pistol':
        mechClick(ac, dest, at(0.14), r, { peak: 0.16, f: 2200 });
        rasp(ac, dest, at(0.2), r, { dur: 0.09, peak: 0.08, f0: 900, f1: 2200 });
        rasp(ac, dest, at(0.55), r, { dur: 0.08, peak: 0.08, f0: 2200, f1: 1000 });
        thunk(ac, dest, at(0.62), r, { peak: 0.26, f: 170 * k });
        mechClick(ac, dest, at(0.62), r, { peak: 0.2, f: 1700 });
        mechClick(ac, dest, at(0.88), r, { peak: 0.3, f: 1250, ring: 1.3 });
        thunk(ac, dest, at(0.885), r, { peak: 0.18, f: 120, noise: false });
        break;
      case 'revolver':
        mechClick(ac, dest, at(0.08), r, { peak: 0.2, f: 1600 });
        rasp(ac, dest, at(0.11), r, { dur: 0.1, peak: 0.07, f0: 700, f1: 1500 });
        scatter(ac, dest, at(0.22), { count: 6, span: 0.3, peak: 0.14, fLo: 2600, fHi: 5200, q: 3, hitDur: 0.035, bias: 1.4, rng: r });
        rasp(ac, dest, at(0.5), r, { dur: 0.1, peak: 0.09, f0: 1200, f1: 2600 });
        scatter(ac, dest, at(0.56), { count: 5, span: 0.16, peak: 0.1, fLo: 2400, fHi: 4600, q: 3, hitDur: 0.03, rng: r });
        thunk(ac, dest, at(0.7), r, { peak: 0.24, f: 190 * k });
        mechClick(ac, dest, at(0.91), r, { peak: 0.34, f: 1350, ring: 1.6 });
        thunk(ac, dest, at(0.915), r, { peak: 0.24, f: 130 });
        break;
      case 'rifle':
      case 'dmr': {
        const heavy = kind === 'dmr' ? 1.25 : 1;
        mechClick(ac, dest, at(0.1), r, { peak: 0.2, f: 2000 });
        rasp(ac, dest, at(0.16), r, { dur: 0.1, peak: 0.09, f0: 800, f1: 2000 });
        thunk(ac, dest, at(0.3), r, { peak: 0.12, f: 120, noise: false });
        rasp(ac, dest, at(0.52), r, { dur: 0.09, peak: 0.1, f0: 2200, f1: 900 });
        thunk(ac, dest, at(0.61), r, { peak: 0.3 * heavy, f: 160 * k });
        mechClick(ac, dest, at(0.61), r, { peak: 0.22, f: 1800 });
        mechClick(ac, dest, at(0.8), r, { peak: 0.26 * heavy, f: 1100, ring: 1.2 });
        rasp(ac, dest, at(0.78), r, { dur: 0.05, peak: 0.07, f0: 700, f1: 1400 });
        mechClick(ac, dest, at(0.9), r, { peak: 0.38 * heavy, f: 1300, ring: 1.5 });
        thunk(ac, dest, at(0.905), r, { peak: 0.28 * heavy, f: 100, dur: 0.08 });
        break;
      }
      case 'shotgun':
        // un cartucho: plástico contra la boca del cargador + resorte
        rasp(ac, dest, at(0.22), r, { dur: 0.06, peak: 0.07, f0: 1800, f1: 900 });
        mechClick(ac, dest, at(0.36), r, { peak: 0.22, f: 2400 });
        thunk(ac, dest, at(0.37), r, { peak: 0.22, f: 220 * k, dur: 0.05 });
        partials(ac, dest, at(0.37), { f: 2600, ratios: [1, 2.3], decay: 0.05, peak: 0.08 });
        mechClick(ac, dest, at(0.6), r, { peak: 0.14, f: 1500 });
        break;
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Disparo en seco y cambio de arma
// ─────────────────────────────────────────────────────────────────────────────
const dryLight: Recipe = (ac, dest, t0, p) => {
  mechClick(ac, dest, t0, p.rng, { peak: 0.2, f: 2300 * p.pitch, ring: 0.6 });
  thunk(ac, dest, t0 + 0.002, p.rng, { peak: 0.1, f: 190, dur: 0.03, noise: false });
};
const dryRifle: Recipe = (ac, dest, t0, p) => {
  mechClick(ac, dest, t0, p.rng, { peak: 0.24, f: 1700 * p.pitch, ring: 0.8 });
  thunk(ac, dest, t0 + 0.002, p.rng, { peak: 0.14, f: 130, dur: 0.04, noise: false });
};
const dryHeavy: Recipe = (ac, dest, t0, p) => {
  mechClick(ac, dest, t0, p.rng, { peak: 0.26, f: 1300 * p.pitch, ring: 1.2 });
  thunk(ac, dest, t0 + 0.003, p.rng, { peak: 0.2, f: 105, dur: 0.05 });
};

const weaponSwitch: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  rasp(ac, dest, t0, r, { dur: 0.11, peak: 0.1, f0: 500, f1: 1800, q: 0.9 });
  mechClick(ac, dest, t0 + 0.11, r, { peak: 0.2, f: 1500 });
  thunk(ac, dest, t0 + 0.115, r, { peak: 0.16, f: 140, noise: false });
  rasp(ac, dest, t0 + 0.15, r, { dur: 0.08, peak: 0.05, f0: 1500, f1: 700 });
};

// ─────────────────────────────────────────────────────────────────────────────
// Granada
// ─────────────────────────────────────────────────────────────────────────────
const grenadeThrow: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  partials(ac, dest, t0, { f: 3400 * vary(r, 1, 0.03), ratios: [1, 2.4], decay: 0.09, peak: 0.22, attack: 0.0008 });
  mechClick(ac, dest, t0 + 0.005, r, { peak: 0.15, f: 3000 });
  mechClick(ac, dest, t0 + 0.07, r, { peak: 0.22, f: 1500 });
  partials(ac, dest, t0 + 0.07, { f: 1800, ratios: [1, 2.7], decay: 0.06, peak: 0.1 });
  whoosh(ac, dest, t0 + 0.06, r, { dur: 0.3, peak: 0.24, f0: 300, f1: 1500 });
};

const grenadeBounce: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  const f = between(r, 620, 980) * p.pitch;
  partials(ac, dest, t0, { f, ratios: [1, 2.76, 5.4], decay: 0.18, peak: 0.24 * (0.5 + 0.5 * p.intensity), attack: 0.0008 });
  thunk(ac, dest, t0, r, { peak: 0.3, f: 150, dur: 0.05 });
  mechClick(ac, dest, t0, r, { peak: 0.16, f: 3200, ring: 0 });
};

/** Explosión grande: chasquido, bola de fuego, sub-grave, escombros y estruendo. ≤ 38 nodos. */
const grenadeExplode: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  const k = vary(r, 1, 0.06) * p.pitch;
  noiseBurst(ac, dest, t0, { dur: 0.03, peak: 0.9, attack: 0.0005, type: 'highpass', f0: 800, rng: r });
  noiseBurst(ac, dest, t0, { dur: 0.95, peak: 0.7, attack: 0.002, type: 'lowpass', f0: 9000, f1: 260, q: 0.6, rng: r });
  tone(ac, dest, t0, { f0: 95 * k, f1: 24, dur: 1.5, peak: 0.85, attack: 0.004, sat: 0.35 });
  tone(ac, dest, t0, { type: 'triangle', f0: 230 * k, f1: 58, dur: 0.28, peak: 0.45, attack: 0.002 });
  noiseBurst(ac, dest, t0, { kind: 'brown', dur: 3.1, peak: 0.55, attack: 0.09, type: 'lowpass', f0: 240, f1: 80, q: 0.5, rng: r });
  noiseBurst(ac, dest, t0, { kind: 'pink', delay: 0.12, dur: 2.5, peak: 0.24, attack: 0.16, type: 'lowpass', f0: 1500, f1: 240, q: 0.5, rng: r });
  scatter(ac, dest, t0 + 0.14, { count: 22, span: 1.5, peak: 0.24, fLo: 900, fHi: 5200, q: 1.6, hitDur: 0.05, bias: 1.5, fall: 0.5, rng: r });
  scatter(ac, dest, t0 + 0.2, { kind: 'brown', count: 8, span: 1.2, peak: 0.34, fLo: 160, fHi: 420, q: 1.2, hitDur: 0.07, bias: 1.3, rng: r });
  pingScatter(ac, dest, t0 + 0.25, { count: 5, span: 1.3, peak: 0.05, fLo: 2500, fHi: 5200, hitDur: 0.12, bias: 1.5, rng: r });
};

// ─────────────────────────────────────────────────────────────────────────────
// Placa de armadura
// ─────────────────────────────────────────────────────────────────────────────
const plateApply: Recipe = (ac, dest, t0, p) => {
  const r = p.rng;
  const D = p.duration > 0 ? p.duration : 1.4;
  // velcro/correa al inicio
  noiseBurst(ac, dest, t0, { dur: 0.22, peak: 0.12, attack: 0.02, type: 'highpass', f0: 2600, q: 0.6, rng: r });
  scatter(ac, dest, t0, { count: 26, span: 0.2, peak: 0.1, fLo: 2500, fHi: 4500, q: 0.8, hitDur: 0.006, rng: r });
  // matraca (clics que se aceleran y suben de tono)
  const n = 6;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const t = t0 + D * (0.2 + 0.6 * f * f * 0.5 + 0.3 * f);
    mechClick(ac, dest, t, r, { peak: 0.16 + 0.05 * f, f: 1300 + 900 * f, ring: 0.5 });
  }
  // asiento final de la placa
  const te = t0 + D * 0.93;
  partials(ac, dest, te, { f: 380 * p.pitch, ratios: [1, 2.3, 4.1], decay: 0.2, peak: 0.16, attack: 0.001 });
  thunk(ac, dest, te, r, { peak: 0.36, f: 105, dur: 0.1 });
};

const plateDone: Recipe = (ac, dest, t0, p) => {
  mechClick(ac, dest, t0, p.rng, { peak: 0.24, f: 1700 });
  partials(ac, dest, t0, { f: 520, ratios: [1, 1.5, 2.5], decay: 0.24, peak: 0.1 });
  tone(ac, dest, t0 + 0.02, { f0: 330, f1: 495, dur: 0.16, peak: 0.07, attack: 0.02, lp: 1800, curve: 'lin' });
};

// ─────────────────────────────────────────────────────────────────────────────
// Registro
// ─────────────────────────────────────────────────────────────────────────────
export function weaponRecipes(): RecipeDef[] {
  const rel = (w: WeaponId): number => WEAPONS[w].reloadTacticalS ?? WEAPONS[w].reloadS;
  return [
    ...gunDefs(),
    defineRecipe('gun.shotgun.pump', 'foley', 70, 0.4, shotgunPump, { send: 0.12, trim: 1 }),
    defineRecipe('reload.pistol', 'foley', 60, rel('pistol'), reloadRecipe('pistol', rel('pistol')), { send: 0.08 }),
    defineRecipe('reload.revolver', 'foley', 60, WEAPONS.revolver.reloadS, reloadRecipe('revolver', WEAPONS.revolver.reloadS), { send: 0.08 }),
    defineRecipe('reload.rifle', 'foley', 60, rel('carbine'), reloadRecipe('rifle', rel('carbine')), { send: 0.08 }),
    defineRecipe('reload.dmr', 'foley', 60, rel('dmr'), reloadRecipe('dmr', rel('dmr')), { send: 0.08 }),
    defineRecipe('reload.shotgun', 'foley', 60, WEAPONS.shotgun.reloadPerShellS ?? 0.55, reloadRecipe('shotgun', WEAPONS.shotgun.reloadPerShellS ?? 0.55), { send: 0.08 }),
    defineRecipe('dry.light', 'foley', 55, 0.12, dryLight, { send: 0.05 }),
    defineRecipe('dry.rifle', 'foley', 55, 0.12, dryRifle, { send: 0.05 }),
    defineRecipe('dry.heavy', 'foley', 55, 0.14, dryHeavy, { send: 0.06 }),
    defineRecipe('weapon.switch', 'foley', 50, 0.3, weaponSwitch, { send: 0.05 }),
    defineRecipe('grenade.throw', 'foley', 65, 0.5, grenadeThrow, { send: 0.1 }),
    defineRecipe('grenade.bounce', 'enemy', 62, 0.3, grenadeBounce, { send: 0.22, range: 60 }),
    defineRecipe('grenade.explode', 'explosion', 98, 3.6, grenadeExplode, { send: 0.34, trim: 1, range: 190, minDur: 1.5 }),
    defineRecipe('plate.apply', 'foley', 58, 1.4, plateApply, { send: 0.06 }),
    defineRecipe('plate.done', 'foley', 58, 0.35, plateDone, { send: 0.06 }),
  ];
}

/** Receta de disparo por arma (para bindings). */
export const gunId = (w: WeaponId): string => `gun.${w}`;
export const dryId = (w: WeaponId): string => (w === 'pistol' || w === 'smg' ? 'dry.light' : w === 'carbine' || w === 'assault' ? 'dry.rifle' : 'dry.heavy');
export const reloadId = (w: WeaponId): string =>
  w === 'pistol' ? 'reload.pistol' : w === 'revolver' ? 'reload.revolver' : w === 'shotgun' ? 'reload.shotgun' : w === 'dmr' ? 'reload.dmr' : 'reload.rifle';

export { chance };
