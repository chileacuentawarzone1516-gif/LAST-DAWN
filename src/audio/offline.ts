/** Renderizado offline de recetas y bucles (QA: RMS, pico, NaN, duración, nodos). */
import { createRng } from '../core/util';
import { DEFAULT_LEVELS, buildChain, connectVoice } from './engine';
import { createHeliLoop, createRelayLoop } from './loops';
import { analyzeSignal, playerVoice, toDb } from './pure';
import { RECIPES, RECIPE_IDS } from './sfx';
import { makeParams } from './synth';

export interface RenderResult {
  id: string;
  ok: boolean;
  rms: number;
  peakRaw: number;
  peakOut: number;
  nan: number;
  audibleS: number;
  expectedS: number;
  nodes: number;
  dc: number;
  problems: string[];
  error?: string;
}

const SR = 44100;
const LOOPS = ['loop.heli', 'loop.heli.lite', 'loop.relay'] as const;

/** Recetas que usan la voz del jugador: se renderizan también con voz femenina (sufijo @f). */
export const VOICE_IDS = [
  'hurt.melee', 'hurt.armor', 'hurt.spit', 'hurt.heavy', 'hurt.toxic', 'hurt.fall', 'player.death', 'player.jump', 'player.land',
  'plate.apply', 'grenade.throw',
] as const;

export const soundIds = (): string[] => [...RECIPE_IDS, ...LOOPS, ...VOICE_IDS.map((i) => `${i}@f`)];

/** Cuenta los nodos creados por métodos create* durante `fn`. */
function countNodes(ac: OfflineAudioContext, fn: () => void): number {
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(ac)) as Record<string, unknown>;
  let n = 0;
  const restore: Array<() => void> = [];
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (!name.startsWith('create') || name === 'createBuffer' || typeof proto[name] !== 'function') continue;
    const orig = proto[name] as (...a: unknown[]) => unknown;
    proto[name] = function (this: unknown, ...a: unknown[]) {
      n++;
      return orig.apply(this, a);
    };
    restore.push(() => {
      proto[name] = orig;
    });
  }
  try {
    fn();
  } finally {
    for (const r of restore) r();
  }
  return n;
}

async function renderOnce(fullId: string, chained: boolean): Promise<{ data: Float32Array[]; nodes: number; expected: number }> {
  const female = fullId.endsWith('@f');
  const id = female ? fullId.slice(0, -2) : fullId;
  const isLoop = (LOOPS as readonly string[]).includes(id);
  const def = RECIPES[id];
  const expected = isLoop ? 2 : (def?.dur ?? 1);
  const len = Math.ceil(SR * (expected + 0.6));
  const ac = new OfflineAudioContext(2, len, SR);
  const chain = buildChain(ac, ac.destination, DEFAULT_LEVELS);
  let nodes = 0;
  nodes = countNodes(ac, () => {
    if (id === 'loop.heli' || id === 'loop.heli.lite') {
      const l = createHeliLoop(ac, chained ? chain.buses.sfx.input : ac.destination, 0, id.endsWith('lite'));
      l.set(1, 1, 0.5, 0);
      l.out.gain.setValueAtTime(0.8, 0);
    } else if (id === 'loop.relay') {
      const l = createRelayLoop(ac, chained ? chain.buses.sfx.input : ac.destination, 0);
      l.set(0.6, true, 0);
    } else if (def) {
      const rng = createRng(1234);
      const params = makeParams(rng, female ? { voice: playerVoice('female', createRng(99)) } : {});
      if (chained) def.play(ac, connectVoice(ac, chain, def), 0.01, params);
      else {
        const g = ac.createGain();
        g.gain.value = def.trim;
        g.connect(ac.destination);
        def.play(ac, g, 0.01, params);
      }
    }
  });
  const buf = await ac.startRendering();
  return { data: [buf.getChannelData(0), buf.getChannelData(1)], nodes, expected };
}

export async function renderSound(fullId: string): Promise<RenderResult> {
  const id = fullId;
  const baseId = fullId.endsWith('@f') ? fullId.slice(0, -2) : fullId;
  const problems: string[] = [];
  try {
    const raw = await renderOnce(id, false);
    const full = await renderOnce(id, true);
    const sr = analyzeSignal(raw.data, SR);
    const so = analyzeSignal(full.data, SR);
    const isLoop = (LOOPS as readonly string[]).includes(baseId);
    const def = RECIPES[baseId];
    if (so.nan + sr.nan > 0) problems.push('NaN');
    if (so.rms < 0.004) problems.push('silencio');
    if (so.peak > 1.0) problems.push('satura');
    if (sr.peak > 2.5) problems.push('demasiado fuerte (pre-cadena)');
    if (so.dc > 0.02) problems.push('DC');
    if (!isLoop) {
      if (sr.audibleS > raw.expected * 1.05 + 0.1) problems.push('dura de más');
      if (sr.audibleS < (def?.minDur ?? 0.03)) problems.push('dura de menos');
    }
    if (raw.nodes > 50) problems.push(`nodos ${raw.nodes}`);
    return {
      id, ok: problems.length === 0, rms: so.rms, peakRaw: sr.peak, peakOut: so.peak, nan: so.nan + sr.nan,
      audibleS: sr.audibleS, expectedS: raw.expected, nodes: raw.nodes, dc: so.dc, problems,
    };
  } catch (e) {
    return {
      id, ok: false, rms: 0, peakRaw: 0, peakOut: 0, nan: 0, audibleS: 0, expectedS: 0, nodes: 0, dc: 0,
      problems: ['excepción'], error: e instanceof Error ? e.message : String(e),
    };
  }
}

export { toDb };
