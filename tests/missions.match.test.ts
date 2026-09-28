import { describe, expect, it } from 'vitest';
import { CONTAMINATION, TIMERS } from '../src/config';
import { createRunState } from '../src/core/state';
import type { RunState } from '../src/core/state';
import {
  contaminationDepth, contaminationDps, contaminationRadius, evaluateEnd, isInContamination, isSealed, tickMatch,
} from '../src/rules/match';
import type { MatchEvent } from '../src/rules/match';

const C = CONTAMINATION.center;

describe('contaminationRadius', () => {
  it('está inactiva antes de contaminationStartS', () => {
    expect(contaminationRadius(0)).toBe(0);
    expect(contaminationRadius(TIMERS.contaminationStartS - 0.001)).toBe(0);
    expect(contaminationRadius(-5)).toBe(0);
    expect(contaminationRadius(Number.NaN)).toBe(0);
  });
  it('arranca en startRadius y llega a endRadius al sellarse', () => {
    expect(contaminationRadius(TIMERS.contaminationStartS)).toBeCloseTo(CONTAMINATION.startRadius, 9);
    expect(contaminationRadius(TIMERS.sealS)).toBeCloseTo(CONTAMINATION.endRadius, 9);
  });
  it('es lineal entre ambos hitos', () => {
    const mid = (TIMERS.contaminationStartS + TIMERS.sealS) / 2;
    expect(contaminationRadius(mid)).toBeCloseTo((CONTAMINATION.startRadius + CONTAMINATION.endRadius) / 2, 9);
  });
  it('se mantiene en endRadius después del sellado y nunca decrece', () => {
    expect(contaminationRadius(TIMERS.sealS + 500)).toBe(CONTAMINATION.endRadius);
    let prev = 0;
    for (let t = 0; t <= TIMERS.sealS + 60; t += 5) {
      const r = contaminationRadius(t);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });
});

describe('isInContamination / contaminationDepth / contaminationDps', () => {
  it('con radio 0 (inactiva) nada está contaminado, ni siquiera el centro', () => {
    expect(isInContamination(C.x, C.z, 0)).toBe(false);
    expect(contaminationDepth(C.x, C.z, 0)).toBeLessThan(0);
    expect(contaminationDps(contaminationDepth(C.x, C.z, 0))).toBe(0);
  });
  it('detecta dentro, borde y fuera', () => {
    expect(isInContamination(C.x, C.z, 25)).toBe(true);
    expect(isInContamination(C.x + 25, C.z, 25)).toBe(true); // borde incluido
    expect(isInContamination(C.x + 25.01, C.z, 25)).toBe(false);
    expect(isInContamination(C.x + 10, C.z + 10, 25)).toBe(true);
  });
  it('la profundidad es radio − distancia al centro', () => {
    expect(contaminationDepth(C.x + 10, C.z, 25)).toBeCloseTo(15, 9);
    expect(contaminationDepth(C.x, C.z, 25)).toBeCloseTo(25, 9);
    expect(contaminationDepth(C.x + 30, C.z, 25)).toBeCloseTo(-5, 9);
  });
  it('el daño por segundo vale dpsEdge en el borde, crece con la profundidad y tiene tope', () => {
    expect(contaminationDps(0)).toBe(CONTAMINATION.dpsEdge);
    expect(contaminationDps(10)).toBeCloseTo(CONTAMINATION.dpsEdge + 10 * CONTAMINATION.dpsPerMeterDeep, 9);
    expect(contaminationDps(1e6)).toBe(CONTAMINATION.dpsMax);
    expect(contaminationDps(-0.001)).toBe(0);
    expect(contaminationDps(Number.NaN)).toBe(0);
    let prev = 0;
    for (let d = 0; d <= 300; d += 10) {
      const v = contaminationDps(d);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(CONTAMINATION.dpsMax);
      prev = v;
    }
  });
  it('el LZ no queda nunca dentro de la nube (a 315 m del centro)', () => {
    expect(isInContamination(0, 165, CONTAMINATION.endRadius)).toBe(false);
  });
});

/** Ejecuta la partida a `dt` fijo hasta `until` y recoge los eventos. */
function run(state: RunState, until: number, dt = 1 / 30): MatchEvent[] {
  const all: MatchEvent[] = [];
  while (state.match.elapsed < until - 1e-9) {
    state.match.elapsed = Math.min(until, state.match.elapsed + dt);
    all.push(...tickMatch(state, dt));
  }
  return all;
}

describe('tickMatch', () => {
  it('sin hitos cercanos no emite nada y devuelve la lista vacía compartida', () => {
    const s = createRunState();
    const a = tickMatch(s, 0.016);
    const b = tickMatch(s, 0.016);
    expect(a).toHaveLength(0);
    expect(a).toBe(b);
    expect(s.match.contamination).toEqual({ active: false, radius: 0 });
  });

  it('emite cada aviso exactamente una vez, en su momento', () => {
    const s = createRunState();
    const ev = run(s, TIMERS.sealS + 5);
    const warnings = ev.filter((e) => e.type === 'warning');
    expect(warnings).toHaveLength(TIMERS.warnings.length * 2);
    for (const w of TIMERS.warnings) {
      expect(warnings.filter((e) => e.type === 'warning' && e.kind === 'contamination' && e.secondsLeft === w)).toHaveLength(1);
      expect(warnings.filter((e) => e.type === 'warning' && e.kind === 'seal' && e.secondsLeft === w)).toHaveLength(1);
    }
    expect(ev.filter((e) => e.type === 'contaminationStarted')).toHaveLength(1);
    expect(ev.filter((e) => e.type === 'sealed')).toHaveLength(1);
  });

  it('los avisos de contaminación llegan a 60/30/10 s antes de las 7:30', () => {
    const s = createRunState();
    s.match.elapsed = TIMERS.contaminationStartS - 60;
    expect(tickMatch(s, 0.1)).toEqual([{ type: 'warning', kind: 'contamination', secondsLeft: 60 }]);
    expect(tickMatch(s, 0.1)).toHaveLength(0);
    s.match.elapsed = TIMERS.contaminationStartS - 30;
    expect(tickMatch(s, 0.1)).toEqual([{ type: 'warning', kind: 'contamination', secondsLeft: 30 }]);
    s.match.elapsed = TIMERS.contaminationStartS - 10;
    expect(tickMatch(s, 0.1)).toEqual([{ type: 'warning', kind: 'contamination', secondsLeft: 10 }]);
  });

  it('contaminationStarted y sealed ocurren una vez y actualizan el estado', () => {
    const s = createRunState();
    s.match.elapsed = TIMERS.contaminationStartS;
    const ev = tickMatch(s, 0.1);
    expect(ev.filter((e) => e.type === 'contaminationStarted')).toHaveLength(1);
    expect(s.match.contamination.active).toBe(true);
    expect(s.match.contamination.radius).toBeCloseTo(CONTAMINATION.startRadius, 9);
    expect(tickMatch(s, 0.1).filter((e) => e.type === 'contaminationStarted')).toHaveLength(0);
    expect(s.match.sealed).toBe(false);

    s.match.elapsed = TIMERS.sealS;
    const ev2 = tickMatch(s, 0.1);
    expect(ev2.filter((e) => e.type === 'sealed')).toHaveLength(1);
    expect(s.match.sealed).toBe(true);
    expect(s.match.contamination.radius).toBeCloseTo(CONTAMINATION.endRadius, 9);
    expect(tickMatch(s, 0.1).filter((e) => e.type === 'sealed')).toHaveLength(0);
  });

  it('un salto de reloj anuncia sólo el aviso más urgente y marca los demás en silencio', () => {
    const s = createRunState();
    s.match.elapsed = TIMERS.contaminationStartS - 20; // vencidos 60 y 30, no 10
    const ev = tickMatch(s, 0.1);
    expect(ev).toEqual([{ type: 'warning', kind: 'contamination', secondsLeft: 30 }]);
    expect(s.match.warned[`contamination:60`]).toBe(true);
    expect(s.match.warned[`contamination:30`]).toBe(true);
    expect(s.match.warned[`contamination:10`]).toBeFalsy();
  });

  it('un salto por encima del hito no anuncia avisos obsoletos', () => {
    const s = createRunState();
    s.match.elapsed = TIMERS.sealS + 100;
    const ev = tickMatch(s, 0.1);
    expect(ev.filter((e) => e.type === 'warning')).toHaveLength(0);
    expect(ev.map((e) => e.type).sort()).toEqual(['contaminationStarted', 'sealed']);
  });

  it('no avanza nada cuando la partida ya terminó', () => {
    const s = createRunState();
    s.match.phase = 'lost';
    s.match.elapsed = TIMERS.sealS + 1;
    expect(tickMatch(s, 0.1)).toHaveLength(0);
    expect(s.match.sealed).toBe(false);
  });

  it('es determinista: dos partidas idénticas producen los mismos eventos', () => {
    const a = run(createRunState(), TIMERS.sealS + 1, 1 / 20);
    const b = run(createRunState(), TIMERS.sealS + 1, 1 / 20);
    expect(a).toEqual(b);
  });
});

describe('isSealed', () => {
  it('se cumple por bandera o por reloj', () => {
    const s = createRunState();
    expect(isSealed(s)).toBe(false);
    s.match.elapsed = TIMERS.sealS;
    expect(isSealed(s)).toBe(true);
    const t = createRunState();
    t.match.sealed = true;
    expect(isSealed(t)).toBe(true);
  });
});

describe('evaluateEnd', () => {
  it('sin novedades no hay veredicto', () => {
    expect(evaluateEnd(createRunState())).toBeNull();
  });
  it('la muerte pierde con motivo dead', () => {
    const s = createRunState();
    s.player.alive = false;
    expect(evaluateEnd(s)).toEqual({ result: 'lost', reason: 'dead' });
  });
  it('sellado sin llamar a la extracción pierde con motivo sealed', () => {
    const s = createRunState();
    s.match.elapsed = TIMERS.sealS;
    tickMatch(s, 0.1);
    expect(evaluateEnd(s)).toEqual({ result: 'lost', reason: 'sealed' });
  });
  it('llamar a la extracción ANTES del sellado evita perder por sellado', () => {
    const s = createRunState();
    s.missions.extraction.phase = 'inbound';
    s.match.elapsed = TIMERS.sealS + 30;
    tickMatch(s, 0.1);
    expect(s.match.sealed).toBe(true);
    expect(evaluateEnd(s)).toBeNull();
    s.missions.extraction.phase = 'landed';
    expect(evaluateEnd(s)).toBeNull();
  });
  it('el helicóptero que parte sin el jugador pierde con motivo heli_left', () => {
    const s = createRunState();
    s.missions.extraction.phase = 'departing';
    expect(evaluateEnd(s)).toEqual({ result: 'lost', reason: 'heli_left' });
    s.missions.extraction.phase = 'departed';
    expect(evaluateEnd(s)).toEqual({ result: 'lost', reason: 'heli_left' });
  });
  it('abordar gana con motivo extracted', () => {
    const s = createRunState();
    s.missions.extraction.phase = 'departing';
    s.missions.extraction.boarded = true;
    expect(evaluateEnd(s)).toEqual({ result: 'won', reason: 'extracted' });
    s.missions.extraction.phase = 'departed';
    expect(evaluateEnd(s)).toEqual({ result: 'won', reason: 'extracted' });
  });
  it('la muerte tiene prioridad sobre el resto', () => {
    const s = createRunState();
    s.player.alive = false;
    s.missions.extraction.boarded = true;
    s.match.elapsed = TIMERS.sealS + 1;
    expect(evaluateEnd(s)?.reason).toBe('dead');
  });
  it('no vuelve a dar veredicto cuando la partida ya terminó', () => {
    const s = createRunState();
    s.player.alive = false;
    s.match.phase = 'lost';
    expect(evaluateEnd(s)).toBeNull();
  });
});
