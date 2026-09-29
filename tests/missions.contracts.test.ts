import { describe, expect, it } from 'vitest';
import { MAP, MISSIONS, PLAYER } from '../src/config';
import { createRunState } from '../src/core/state';
import type { RunState } from '../src/core/state';
import {
  activateRelay, activateWardenContract, callExtraction, canCallExtraction, completeContract, completeRelay,
  contractReward, forceBoard, isInsideRelay, onWardenHelmetBroken, onWardenKilled, payContract, tickExtraction,
  tickRelay,
} from '../src/rules/missions';
import type { ExtractionEvent } from '../src/rules/missions';
import { TIMERS } from '../src/config';

const R = MISSIONS.relay;
const X = MISSIONS.extraction;
const DT = 1 / 30;
const START_MONEY = PLAYER.start.money;

/** Estado con el relé restaurado (extracción disponible). */
function relayDone(): RunState {
  const s = createRunState();
  activateRelay(s);
  for (let i = 0; i < R.requiredS * 40; i++) if (tickRelay(s, DT, true) === 'completed') break;
  return s;
}

describe('isInsideRelay', () => {
  it('usa el círculo del mapa (borde incluido)', () => {
    expect(isInsideRelay(MAP.relay.x, MAP.relay.z)).toBe(true);
    expect(isInsideRelay(MAP.relay.x + MAP.relay.circleRadius, MAP.relay.z)).toBe(true);
    expect(isInsideRelay(MAP.relay.x + MAP.relay.circleRadius + 0.01, MAP.relay.z)).toBe(false);
    expect(isInsideRelay(0, 0)).toBe(false);
  });
});

describe('relé', () => {
  it('estado inicial: disponible, sin activar', () => {
    const s = createRunState();
    expect(s.missions.relay).toMatchObject({ status: 'available', activated: false, progress: 0, paid: false });
  });
  it('activateRelay lo activa una sola vez y no se reactiva', () => {
    const s = createRunState();
    expect(activateRelay(s)).toBe(true);
    expect(s.missions.relay).toMatchObject({ status: 'active', activated: true, progress: 0 });
    s.missions.relay.progress = 12;
    expect(activateRelay(s)).toBe(false);
    expect(s.missions.relay.progress).toBe(12); // no se reinicia
  });
  it('un relé completado no se puede reactivar', () => {
    const s = relayDone();
    expect(activateRelay(s)).toBe(false);
    expect(s.missions.relay.status).toBe('completed');
  });
  it('sin activar, tickRelay no hace nada', () => {
    const s = createRunState();
    expect(tickRelay(s, 10, true)).toBe('idle');
    expect(s.missions.relay.progress).toBe(0);
  });
  it('el progreso sube sólo dentro del círculo', () => {
    const s = createRunState();
    activateRelay(s);
    expect(tickRelay(s, 5, true)).toBe('progress');
    expect(s.missions.relay.progress).toBeCloseTo(5, 9);
    expect(s.missions.relay.insideCircle).toBe(true);
    tickRelay(s, 0, false);
    expect(s.missions.relay.insideCircle).toBe(false);
  });
  it('fuera del círculo el progreso decae a decayPerS y no baja de 0', () => {
    const s = createRunState();
    activateRelay(s);
    tickRelay(s, 20, true);
    tickRelay(s, 4, false);
    expect(s.missions.relay.progress).toBeCloseTo(20 - R.decayPerS * 4, 9);
    tickRelay(s, 1000, false);
    expect(s.missions.relay.progress).toBe(0);
    expect(s.missions.relay.status).toBe('active');
  });
  it('completa exactamente al acumular requiredS dentro y sólo devuelve completed una vez', () => {
    const s = createRunState();
    activateRelay(s);
    expect(tickRelay(s, R.requiredS - 0.5, true)).toBe('progress');
    expect(s.missions.relay.status).toBe('active');
    expect(tickRelay(s, 0.5, true)).toBe('completed');
    expect(s.missions.relay).toMatchObject({ status: 'completed', progress: R.requiredS });
    expect(tickRelay(s, 10, true)).toBe('idle');
    expect(s.missions.relay.progress).toBe(R.requiredS);
  });
  it('completar el relé desbloquea la extracción', () => {
    const s = createRunState();
    expect(s.missions.extraction.status).toBe('locked');
    activateRelay(s);
    tickRelay(s, R.requiredS, true);
    expect(s.missions.extraction.status).toBe('available');
  });
  it('con ticks pequeños (60 fps) también completa en ~requiredS', () => {
    const s = createRunState();
    activateRelay(s);
    let t = 0;
    while (tickRelay(s, 1 / 60, true) !== 'completed') t += 1 / 60;
    expect(t).toBeGreaterThan(R.requiredS - 0.1);
    expect(t).toBeLessThan(R.requiredS + 0.1);
  });
  it('salir a mitad retrasa la finalización', () => {
    const s = createRunState();
    activateRelay(s);
    tickRelay(s, 30, true);
    tickRelay(s, 10, false); // pierde 7.5
    tickRelay(s, 25, true);
    expect(s.missions.relay.status).toBe('active');
    expect(s.missions.relay.progress).toBeCloseTo(47.5, 9);
  });
  it('dt negativo o NaN no rompe el progreso', () => {
    const s = createRunState();
    activateRelay(s);
    tickRelay(s, -5, true);
    tickRelay(s, Number.NaN, true);
    expect(s.missions.relay.progress).toBe(0);
  });
});

describe('libro de pagos', () => {
  it('payContract paga la recompensa la primera vez y suma dinero', () => {
    const s = createRunState();
    expect(payContract(s, 'relay')).toBe(R.reward);
    expect(s.player.money).toBe(START_MONEY + R.reward);
    expect(s.match.moneyEarned).toBe(R.reward);
    expect(s.missions.relay.paid).toBe(true);
  });
  it('NUNCA paga dos veces, se repita lo que se repita', () => {
    const s = createRunState();
    for (const id of ['relay', 'warden', 'extraction'] as const) {
      expect(payContract(s, id)).toBe(contractReward(id));
      for (let i = 0; i < 5; i++) expect(payContract(s, id)).toBe(0);
    }
    expect(s.player.money).toBe(START_MONEY + R.reward + MISSIONS.warden.reward + X.reward);
  });
  it('las recompensas son las de la configuración', () => {
    expect(contractReward('relay')).toBe(MISSIONS.relay.reward);
    expect(contractReward('warden')).toBe(MISSIONS.warden.reward);
    expect(contractReward('extraction')).toBe(MISSIONS.extraction.reward);
  });
  it('completar el relé dos veces (o reactivarlo) sólo paga una', () => {
    const s = createRunState();
    activateRelay(s);
    tickRelay(s, R.requiredS, true);
    expect(payContract(s, 'relay')).toBe(R.reward);
    activateRelay(s);
    completeRelay(s);
    tickRelay(s, R.requiredS, true);
    expect(payContract(s, 'relay')).toBe(0);
    expect(s.player.money).toBe(START_MONEY + R.reward);
  });
});

describe('Warden', () => {
  it('romper el casco activa el contrato', () => {
    const s = createRunState();
    expect(onWardenHelmetBroken(s)).toBe(true);
    expect(s.missions.warden.status).toBe('active');
    expect(onWardenHelmetBroken(s)).toBe(false);
    expect(s.missions.warden.status).toBe('active');
  });
  it('activateWardenContract sólo cambia desde available', () => {
    const s = createRunState();
    expect(activateWardenContract(s)).toBe(true);
    expect(activateWardenContract(s)).toBe(false);
  });
  it('matar al Warden completa el contrato una sola vez y el pago es único', () => {
    const s = createRunState();
    expect(onWardenKilled(s)).toBe(true);
    expect(s.missions.warden.status).toBe('completed');
    expect(onWardenKilled(s)).toBe(false);
    expect(payContract(s, 'warden')).toBe(MISSIONS.warden.reward);
    expect(payContract(s, 'warden')).toBe(0);
  });
  it('un casco roto tardío no reabre un contrato completado', () => {
    const s = createRunState();
    onWardenKilled(s);
    expect(onWardenHelmetBroken(s)).toBe(false);
    expect(s.missions.warden.status).toBe('completed');
  });
  it('no toca las banderas que escribe el módulo de enemigos', () => {
    const s = createRunState();
    onWardenHelmetBroken(s);
    onWardenKilled(s);
    expect(s.missions.warden.killed).toBe(false);
    expect(s.missions.warden.helmetBroken).toBe(false);
  });
});

describe('extracción — condiciones de llamada', () => {
  it('sin relé restaurado no se puede llamar', () => {
    const s = createRunState();
    expect(canCallExtraction(s)).toBe(false);
    expect(callExtraction(s)).toBe(false);
    expect(s.missions.extraction.phase).toBe('idle');
  });
  it('con el relé restaurado sí', () => {
    const s = relayDone();
    expect(canCallExtraction(s)).toBe(true);
  });
  it('con el distrito sellado no', () => {
    const s = relayDone();
    s.match.sealed = true;
    expect(canCallExtraction(s)).toBe(false);
    const t = relayDone();
    t.match.elapsed = TIMERS.sealS;
    expect(canCallExtraction(t)).toBe(false);
  });
  it('sólo desde la fase idle y con la partida en curso', () => {
    const s = relayDone();
    expect(callExtraction(s)).toBe(true);
    expect(canCallExtraction(s)).toBe(false);
    expect(callExtraction(s)).toBe(false);
    const t = relayDone();
    t.match.phase = 'lost';
    expect(canCallExtraction(t)).toBe(false);
  });
  it('llamar deja la fase inbound con la ETA completa y el contrato activo', () => {
    const s = relayDone();
    callExtraction(s);
    expect(s.missions.extraction).toMatchObject({ phase: 'inbound', status: 'active', etaRemaining: X.etaS });
  });
});

/** Avanza la extracción a paso fijo hasta que `stop` sea cierto; devuelve los eventos. */
function runExtraction(
  s: RunState, input: { near: boolean; holding: boolean }, maxS: number, stop: () => boolean,
): { events: ExtractionEvent[]; time: number } {
  const events: ExtractionEvent[] = [];
  let time = 0;
  while (time < maxS && !stop()) {
    events.push(...tickExtraction(s, DT, input));
    time += DT;
  }
  return { events, time };
}

describe('extracción — secuencia completa', () => {
  it('idle y departed no hacen nada', () => {
    const s = createRunState();
    expect(tickExtraction(s, 1, { near: true, holding: true })).toHaveLength(0);
    s.missions.extraction.phase = 'departed';
    expect(tickExtraction(s, 1, { near: true, holding: true })).toHaveLength(0);
  });

  it('inbound → landed tras la ETA (etaS) y abre la ventana de abordaje', () => {
    const s = relayDone();
    callExtraction(s);
    const { events, time } = runExtraction(s, { near: false, holding: false }, 100, () => s.missions.extraction.phase !== 'inbound');
    expect(events).toEqual([{ type: 'landed' }]);
    expect(time).toBeGreaterThanOrEqual(X.etaS - DT);
    expect(time).toBeLessThanOrEqual(X.etaS + DT);
    expect(s.missions.extraction.phase).toBe('landed');
    expect(s.missions.extraction.boardRemaining).toBe(X.boardWindowS);
  });

  it('la ETA baja monótonamente y nunca queda negativa', () => {
    const s = relayDone();
    callExtraction(s);
    let prev = s.missions.extraction.etaRemaining;
    for (let i = 0; i < 2000; i++) {
      tickExtraction(s, DT, { near: false, holding: false });
      expect(s.missions.extraction.etaRemaining).toBeLessThanOrEqual(prev);
      expect(s.missions.extraction.etaRemaining).toBeGreaterThanOrEqual(0);
      prev = s.missions.extraction.etaRemaining;
    }
  });

  it('la ventana cuenta atrás y, si vence, el helicóptero se va SIN el jugador (heli_left)', () => {
    const s = relayDone();
    callExtraction(s);
    runExtraction(s, { near: true, holding: false }, 100, () => s.missions.extraction.phase === 'landed');
    const { events, time } = runExtraction(s, { near: true, holding: false }, 100, () => s.missions.extraction.phase !== 'landed');
    expect(events).toEqual([{ type: 'departing', boarded: false }]);
    expect(time).toBeGreaterThanOrEqual(X.boardWindowS - DT);
    expect(time).toBeLessThanOrEqual(X.boardWindowS + DT);
    expect(s.missions.extraction).toMatchObject({ phase: 'departing', boarded: false, status: 'failed', boardRemaining: 0 });
    const dep = runExtraction(s, { near: true, holding: true }, 100, () => s.missions.extraction.phase === 'departed');
    expect(dep.events).toEqual([{ type: 'departed', boarded: false }]);
    expect(dep.time).toBeGreaterThanOrEqual(X.departDurationS - DT);
    expect(s.missions.extraction.boarded).toBe(false);
  });

  it('mantener E cerca durante boardHoldS aborda; luego despega y parte con el jugador', () => {
    const s = relayDone();
    callExtraction(s);
    runExtraction(s, { near: true, holding: false }, 100, () => s.missions.extraction.phase === 'landed');
    const { events, time } = runExtraction(s, { near: true, holding: true }, 20, () => s.missions.extraction.phase === 'departing');
    expect(events).toEqual([{ type: 'boarded' }, { type: 'departing', boarded: true }]);
    expect(time).toBeGreaterThanOrEqual(X.boardHoldS - DT);
    expect(time).toBeLessThanOrEqual(X.boardHoldS + 2 * DT);
    expect(s.missions.extraction).toMatchObject({ phase: 'departing', boarded: true, status: 'completed', boardProgress: 1 });
    const dep = runExtraction(s, { near: false, holding: false }, 100, () => s.missions.extraction.phase === 'departed');
    expect(dep.events).toEqual([{ type: 'departed', boarded: true }]);
  });

  it('durante el abordaje la fase es boarding y el progreso avanza 0..1', () => {
    const s = relayDone();
    callExtraction(s);
    runExtraction(s, { near: true, holding: false }, 100, () => s.missions.extraction.phase === 'landed');
    tickExtraction(s, X.boardHoldS / 2, { near: true, holding: true });
    expect(s.missions.extraction.phase).toBe('boarding');
    expect(s.missions.extraction.boardProgress).toBeCloseTo(0.5, 6);
  });

  it('soltar E o alejarse hace decaer el progreso y vuelve a landed', () => {
    const s = relayDone();
    callExtraction(s);
    runExtraction(s, { near: true, holding: false }, 100, () => s.missions.extraction.phase === 'landed');
    tickExtraction(s, X.boardHoldS / 2, { near: true, holding: true });
    tickExtraction(s, X.boardHoldS / 8, { near: true, holding: false });
    expect(s.missions.extraction.boardProgress).toBeCloseTo(0.25, 6);
    tickExtraction(s, X.boardHoldS, { near: false, holding: true }); // lejos: no cuenta aunque mantenga
    expect(s.missions.extraction.boardProgress).toBe(0);
    expect(s.missions.extraction.phase).toBe('landed');
  });

  it('la ventana se congela mientras se aborda activamente', () => {
    const s = relayDone();
    callExtraction(s);
    runExtraction(s, { near: true, holding: false }, 100, () => s.missions.extraction.phase === 'landed');
    tickExtraction(s, 10, { near: true, holding: false });
    const left = s.missions.extraction.boardRemaining;
    tickExtraction(s, X.boardHoldS / 2, { near: true, holding: true });
    expect(s.missions.extraction.boardRemaining).toBe(left);
  });

  it('un jugador lejos no aborda aunque mantenga E toda la ventana', () => {
    const s = relayDone();
    callExtraction(s);
    runExtraction(s, { near: false, holding: true }, 100, () => s.missions.extraction.phase === 'landed');
    runExtraction(s, { near: false, holding: true }, 100, () => s.missions.extraction.phase !== 'landed');
    expect(s.missions.extraction.boarded).toBe(false);
    expect(s.missions.extraction.phase).toBe('departing');
  });

  it('forceBoard sólo funciona posado (landed/boarding)', () => {
    const s = relayDone();
    expect(forceBoard(s)).toBe(false);
    callExtraction(s);
    expect(forceBoard(s)).toBe(false);
    s.missions.extraction.phase = 'landed';
    expect(forceBoard(s)).toBe(true);
    expect(s.missions.extraction).toMatchObject({ phase: 'departing', boarded: true });
    expect(forceBoard(s)).toBe(false);
  });
});

describe('completeContract (debugComplete por la vía de reglas)', () => {
  it('completa el relé, desbloquea la extracción y paga una vez', () => {
    const s = createRunState();
    expect(completeContract(s, 'relay')).toBe(R.reward);
    expect(s.missions.relay.status).toBe('completed');
    expect(s.missions.extraction.status).toBe('available');
    expect(completeContract(s, 'relay')).toBe(0);
    expect(s.player.money).toBe(START_MONEY + R.reward);
  });
  it('completa el Warden y paga una vez', () => {
    const s = createRunState();
    expect(completeContract(s, 'warden')).toBe(MISSIONS.warden.reward);
    expect(completeContract(s, 'warden')).toBe(0);
    expect(s.missions.warden.status).toBe('completed');
  });
  it('completa la extracción encadenando relé + llamada + abordaje, y paga sólo una vez cada contrato', () => {
    const s = createRunState();
    expect(completeContract(s, 'extraction')).toBe(X.reward);
    expect(s.missions.relay.status).toBe('completed');
    expect(s.missions.extraction).toMatchObject({ phase: 'departing', boarded: true, status: 'completed' });
    expect(completeContract(s, 'extraction')).toBe(0);
    // el relé no se pagó (no se pidió): su pago sigue disponible una única vez
    expect(payContract(s, 'relay')).toBe(R.reward);
    expect(payContract(s, 'relay')).toBe(0);
  });
  it('no paga la extracción si el distrito ya está sellado (no se puede llamar)', () => {
    const s = createRunState();
    s.match.sealed = true;
    expect(completeContract(s, 'extraction')).toBe(0);
    expect(s.missions.extraction.paid).toBe(false);
    expect(s.missions.extraction.boarded).toBe(false);
  });
  it('completar tras un contrato ya jugado normalmente no duplica el pago', () => {
    const s = createRunState();
    activateRelay(s);
    tickRelay(s, R.requiredS, true);
    expect(payContract(s, 'relay')).toBe(R.reward);
    expect(completeContract(s, 'relay')).toBe(0);
    expect(s.player.money).toBe(START_MONEY + R.reward);
  });
});
