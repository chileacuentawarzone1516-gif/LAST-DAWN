import { describe, expect, it } from 'vitest';
import { CONTAMINATION, MAP, MISSIONS, TIMERS } from '../src/config';
import { createRunState } from '../src/core/state';
import type { RunState } from '../src/core/state';
import {
  bearingTo, compassOffset, contaminationDepth, contaminationInside, formatObjective, getMarkers, hasRadioSignal,
  headingDeg, matchClock, relativeAngle, threatPips,
} from '../src/rules/markers';

const fresh = (): RunState => createRunState();
const near = (a: number, b: number, eps = 1e-9): void => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('bearingTo / compassOffset', () => {
  it('usa la convención del yaw: 0 = norte (-Z), +π/2 = oeste (-X)', () => {
    near(bearingTo({ x: 0, z: 0 }, { x: 0, z: -10 }), 0);
    near(bearingTo({ x: 0, z: 0 }, { x: -10, z: 0 }), Math.PI / 2);
    near(bearingTo({ x: 0, z: 0 }, { x: 10, z: 0 }), -Math.PI / 2);
    near(Math.abs(bearingTo({ x: 0, z: 0 }, { x: 0, z: 10 })), Math.PI);
  });

  it('puntos coincidentes o datos no finitos devuelven 0 sin NaN', () => {
    expect(bearingTo({ x: 3, z: 4 }, { x: 3, z: 4 })).toBe(0);
    expect(bearingTo({ x: NaN, z: 0 }, { x: 1, z: 1 })).toBe(0);
    expect(compassOffset(NaN, 1)).toBe(0);
    expect(compassOffset(1, Infinity)).toBe(0);
  });

  it('el offset es positivo a la derecha y negativo a la izquierda', () => {
    // Mirando al norte, un objetivo al este (+X) está a la derecha.
    const east = relativeAngle(0, { x: 0, z: 0 }, { x: 10, z: 0 });
    const west = relativeAngle(0, { x: 0, z: 0 }, { x: -10, z: 0 });
    near(east, Math.PI / 2);
    near(west, -Math.PI / 2);
    // De frente = 0.
    near(relativeAngle(0, { x: 0, z: 0 }, { x: 0, z: -50 }), 0);
  });

  it('envuelve los ángulos en ±π: siempre en (-π, π]', () => {
    // Justo a la espalda: el resultado es +π sea cual sea el lado del que venga.
    near(compassOffset(0, Math.PI), Math.PI);
    near(compassOffset(0, -Math.PI), Math.PI);
    near(compassOffset(Math.PI, 0), Math.PI);
    near(compassOffset(-Math.PI, 0), Math.PI);
    // Cruce de la costura: yaw ligeramente por debajo de π y rumbo por encima.
    near(compassOffset(Math.PI - 0.1, -Math.PI + 0.1), -0.2);
    near(compassOffset(-Math.PI + 0.1, Math.PI - 0.1), 0.2);
    // Ángulos acumulados enormes (giros completos repetidos).
    near(compassOffset(100 * Math.PI + 0.3, 0), 0.3, 1e-6);
    near(compassOffset(-7 * Math.PI * 2 - 0.3, 0), -0.3, 1e-6);
    for (let yaw = -10; yaw <= 10; yaw += 0.37) {
      for (let b = -4; b <= 4; b += 0.41) {
        const o = compassOffset(yaw, b);
        expect(o).toBeGreaterThan(-Math.PI - 1e-12);
        expect(o).toBeLessThanOrEqual(Math.PI + 1e-12);
      }
    }
  });

  it('headingDeg da 0=N, 90=E, 180=S, 270=O en [0, 360)', () => {
    near(headingDeg(0), 0);
    near(headingDeg(-Math.PI / 2), 90);
    near(headingDeg(Math.PI), 180);
    near(headingDeg(Math.PI / 2), 270);
    expect(headingDeg(-1e-16)).toBeLessThan(360);
    expect(headingDeg(NaN)).toBe(0);
    expect(headingDeg(Math.PI * 2)).toBeLessThan(1e-9 + 360);
  });
});

describe('getMarkers', () => {
  const ids = (s: RunState): string[] => getMarkers(s).map((m) => m.id);
  const find = (s: RunState, id: string) => getMarkers(s).find((m) => m.id === id);

  it('incluye los puntos fijos del mapa con sus coordenadas', () => {
    const s = fresh();
    const all = ids(s);
    for (const id of ['relay', 'warden', 'lz', 'radio', 'armory', 'gate']) expect(all).toContain(id);
    for (const c of MAP.cages) expect(all).toContain(c.id);
    expect(find(s, 'relay')).toMatchObject({ x: MAP.relay.x, z: MAP.relay.z, radius: MAP.relay.circleRadius });
    expect(find(s, 'armory')).toMatchObject({ x: MAP.armory.x, z: MAP.armory.z, active: false });
    expect(find(s, 'gate')).toMatchObject({ x: MAP.complex.gate.x, z: MAP.complex.gate.z });
  });

  it('relé sin activar: marcador activo y LZ inactivo (sin señal)', () => {
    const s = fresh();
    expect(find(s, 'relay')?.active).toBe(true);
    expect(find(s, 'lz')?.active).toBe(false);
    expect(find(s, 'radio')?.active).toBe(false);
    expect(find(s, 'radio')?.label).toMatch(/sin señal/i);
    expect(find(s, 'heli')).toBeUndefined();
  });

  it('relé completado: sigue en el mapa pero inactivo, y el LZ pasa a ser el objetivo', () => {
    const s = fresh();
    s.missions.relay.status = 'completed';
    s.missions.relay.paid = true;
    expect(find(s, 'relay')?.active).toBe(false);
    expect(find(s, 'relay')?.label).toBe('Relé restaurado');
    expect(find(s, 'lz')?.active).toBe(true);
    expect(find(s, 'radio')?.active).toBe(true);
  });

  it('el Warden sólo aparece mientras vive', () => {
    const s = fresh();
    expect(find(s, 'warden')?.active).toBe(true);
    s.missions.warden.killed = true;
    expect(find(s, 'warden')).toBeUndefined();
    const s2 = fresh();
    s2.missions.warden.status = 'completed';
    expect(find(s2, 'warden')).toBeUndefined();
  });

  it('extracción por fases: helicóptero presente sólo mientras existe y radio inactiva tras llamar', () => {
    const s = fresh();
    s.missions.relay.status = 'completed';
    s.missions.extraction.status = 'available';
    expect(find(s, 'heli')).toBeUndefined();
    expect(find(s, 'radio')?.active).toBe(true);

    s.missions.extraction.status = 'active';
    s.missions.extraction.phase = 'inbound';
    expect(find(s, 'heli')?.active).toBe(true);
    expect(find(s, 'lz')?.active).toBe(false);
    expect(find(s, 'radio')?.active).toBe(false);

    s.missions.extraction.phase = 'landed';
    expect(find(s, 'heli')?.active).toBe(true);

    s.missions.extraction.phase = 'departing';
    expect(find(s, 'heli')?.active).toBe(false);

    s.missions.extraction.phase = 'departed';
    expect(find(s, 'heli')).toBeUndefined();
    expect(find(s, 'lz')?.active).toBe(false);
  });

  it('todos los marcadores tienen color, etiqueta y coordenadas finitas', () => {
    const s = fresh();
    s.missions.extraction.phase = 'boarding';
    for (const m of getMarkers(s)) {
      expect(m.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.short.length).toBeGreaterThan(0);
      expect(Number.isFinite(m.x) && Number.isFinite(m.z)).toBe(true);
    }
    expect(new Set(getMarkers(s).map((m) => m.id)).size).toBe(getMarkers(s).length);
  });

  it('hasRadioSignal exige el relé restaurado', () => {
    const s = fresh();
    expect(hasRadioSignal(s)).toBe(false);
    s.missions.relay.paid = true;
    expect(hasRadioSignal(s)).toBe(true);
  });
});

describe('formatObjective', () => {
  const lines = (s: RunState) => formatObjective(s);

  it('estado inicial: relé por activar, Warden pendiente, extracción sin señal', () => {
    const [relay, warden, ex] = lines(fresh());
    expect(relay).toMatchObject({ id: 'relay', text: 'Activa el transmisor', status: 'todo', progress: null });
    expect(warden).toMatchObject({ id: 'warden', text: 'Elimina al Warden', status: 'todo' });
    expect(ex).toMatchObject({ id: 'extraction', text: 'Sin señal: restaura el relé', status: 'locked' });
    expect(lines(fresh())).toHaveLength(3);
  });

  it('muestra el precio de cada contrato desde la config', () => {
    const [relay, warden, ex] = lines(fresh());
    expect(relay?.reward).toBe(MISSIONS.relay.reward);
    expect(warden?.reward).toBe(MISSIONS.warden.reward);
    expect(ex?.reward).toBe(MISSIONS.extraction.reward);
  });

  it('relé activado: progreso dentro y fuera del círculo', () => {
    const s = fresh();
    s.missions.relay.status = 'active';
    s.missions.relay.activated = true;
    s.missions.relay.progress = 34.7;
    s.missions.relay.insideCircle = true;
    let r = lines(s)[0]!;
    expect(r.text).toBe('Permanece en el círculo 34/55 s');
    expect(r.status).toBe('active');
    expect(r.progress).toBeCloseTo(34.7 / 55, 6);
    expect(r.tone).toBe('normal');

    s.missions.relay.insideCircle = false;
    r = lines(s)[0]!;
    expect(r.text).toBe('Vuelve al círculo 34/55 s');
    expect(r.tone).toBe('warn');
  });

  it('relé: progreso fuera de rango se acota', () => {
    const s = fresh();
    s.missions.relay.activated = true;
    s.missions.relay.insideCircle = true;
    s.missions.relay.progress = 999;
    expect(lines(s)[0]!.text).toBe('Permanece en el círculo 55/55 s');
    expect(lines(s)[0]!.progress).toBe(1);
    s.missions.relay.progress = -5;
    expect(lines(s)[0]!.text).toBe('Permanece en el círculo 0/55 s');
    expect(lines(s)[0]!.progress).toBe(0);
  });

  it('contratos completados: texto final, estado done y progreso lleno', () => {
    const s = fresh();
    s.missions.relay.status = 'completed';
    s.missions.warden.status = 'completed';
    s.missions.extraction.status = 'completed';
    const [r, w, e] = lines(s);
    expect(r).toMatchObject({ text: 'Relé restaurado', status: 'done', progress: 1 });
    expect(w).toMatchObject({ text: 'Warden eliminado', status: 'done' });
    expect(e).toMatchObject({ text: 'Extracción completada', status: 'done', progress: 1 });
  });

  it('Warden: casco destruido cambia la instrucción', () => {
    const s = fresh();
    s.missions.warden.status = 'active';
    s.missions.warden.engaged = true;
    expect(lines(s)[1]!.text).toBe('Elimina al Warden');
    s.missions.warden.helmetBroken = true;
    expect(lines(s)[1]!.text).toBe('Casco destruido: apunta a la cabeza');
    s.missions.warden.killed = true;
    expect(lines(s)[1]!.text).toBe('Warden eliminado');
    expect(lines(s)[1]!.status).toBe('done');
  });

  it('extracción por fases', () => {
    const s = fresh();
    s.missions.relay.status = 'completed';
    s.missions.extraction.status = 'available';
    expect(lines(s)[2]!.text).toBe('Llama al helicóptero en la radio del LZ');
    expect(lines(s)[2]!.status).toBe('todo');

    s.missions.extraction.status = 'active';
    s.missions.extraction.phase = 'inbound';
    s.missions.extraction.etaRemaining = 31.2;
    expect(lines(s)[2]!.text).toBe('Llegada en 0:32');
    expect(lines(s)[2]!.progress).toBeCloseTo(1 - 31.2 / MISSIONS.extraction.etaS, 6);

    s.missions.extraction.phase = 'landed';
    s.missions.extraction.boardRemaining = 38;
    expect(lines(s)[2]!.text).toBe('Aborda: quedan 0:38');
    expect(lines(s)[2]!.tone).toBe('normal');

    s.missions.extraction.phase = 'boarding';
    s.missions.extraction.boardRemaining = 8;
    expect(lines(s)[2]!.tone).toBe('danger');
    s.missions.extraction.boardRemaining = 25;
    expect(lines(s)[2]!.tone).toBe('warn');

    s.missions.extraction.phase = 'departed';
    s.missions.extraction.boarded = false;
    expect(lines(s)[2]!.text).toBe('El helicóptero se fue sin ti');
    expect(lines(s)[2]!.status).toBe('failed');
  });

  it('la cuenta atrás redondea hacia arriba y nunca es negativa', () => {
    const s = fresh();
    s.missions.relay.status = 'completed';
    s.missions.extraction.phase = 'inbound';
    s.missions.extraction.etaRemaining = 0.01;
    expect(lines(s)[2]!.text).toBe('Llegada en 0:01');
    s.missions.extraction.etaRemaining = -3;
    expect(lines(s)[2]!.text).toBe('Llegada en 0:00');
  });
});

describe('contaminación', () => {
  const c = CONTAMINATION.center;

  it('inactiva: nunca dentro', () => {
    const s = fresh();
    expect(contaminationInside(c, s)).toBe(false);
    expect(contaminationDepth(c, s)).toBe(0);
  });

  it('activa: dentro/fuera según el radio, con el borde como dentro', () => {
    const s = fresh();
    s.match.contamination = { active: true, radius: 40 };
    expect(contaminationInside({ x: c.x, z: c.z }, s)).toBe(true);
    expect(contaminationInside({ x: c.x + 40, z: c.z }, s)).toBe(true);
    expect(contaminationInside({ x: c.x + 40.01, z: c.z }, s)).toBe(false);
    expect(contaminationInside({ x: c.x, z: c.z + 100 }, s)).toBe(false);
    expect(contaminationDepth({ x: c.x + 10, z: c.z }, s)).toBeCloseTo(30, 9);
    expect(contaminationDepth({ x: c.x + 60, z: c.z }, s)).toBe(0);
  });

  it('radio 0 con la nube activa no contamina a nadie', () => {
    const s = fresh();
    s.match.contamination = { active: true, radius: 0 };
    expect(contaminationInside(c, s)).toBe(false);
  });

  it('el LZ queda fuera incluso al radio final', () => {
    const s = fresh();
    s.match.contamination = { active: true, radius: CONTAMINATION.endRadius };
    expect(contaminationInside(MAP.lz.center, s)).toBe(false);
    expect(contaminationInside(MAP.complex.wardenSpawn, s)).toBe(true);
  });
});

describe('threatPips', () => {
  it('enciende tantas píldoras como amenaza', () => {
    expect(threatPips(1)).toEqual([true, false, false, false]);
    expect(threatPips(2)).toEqual([true, true, false, false]);
    expect(threatPips(4)).toEqual([true, true, true, true]);
  });
  it('acota valores fuera de rango y no finitos', () => {
    expect(threatPips(0)).toEqual([false, false, false, false]);
    expect(threatPips(-3)).toEqual([false, false, false, false]);
    expect(threatPips(9)).toEqual([true, true, true, true]);
    expect(threatPips(NaN)).toEqual([false, false, false, false]);
    expect(threatPips(2.6)).toEqual([true, true, true, false]);
    expect(threatPips(2, 6)).toHaveLength(6);
  });
});

describe('matchClock', () => {
  const at = (elapsed: number, mut?: (s: RunState) => void) => {
    const s = fresh();
    s.match.elapsed = elapsed;
    mut?.(s);
    return matchClock(s);
  };

  it('antes de 7:30 cuenta atrás a la contaminación', () => {
    const t = at(TIMERS.contaminationStartS - 130);
    expect(t.kind).toBe('contamination');
    expect(t.label).toBe('CONTAMINACIÓN en 2:10');
    expect(t.tone).toBe('normal');
  });

  it('ámbar a 60 s y rojo a 30 s del hito', () => {
    expect(at(TIMERS.contaminationStartS - 61).tone).toBe('normal');
    expect(at(TIMERS.contaminationStartS - 60).tone).toBe('warn');
    expect(at(TIMERS.contaminationStartS - 31).tone).toBe('warn');
    expect(at(TIMERS.contaminationStartS - 30).tone).toBe('danger');
  });

  it('desde 7:30 cuenta atrás al sellado', () => {
    const t = at(TIMERS.sealS - 190, (s) => {
      s.match.contamination = { active: true, radius: 100 };
    });
    expect(t.kind).toBe('seal');
    expect(t.label).toBe('SELLADO en 3:10');
    // Sin el flag activo pero pasado el instante, también.
    expect(at(TIMERS.contaminationStartS).kind).toBe('seal');
  });

  it('a las 12:00 el distrito está sellado', () => {
    expect(at(TIMERS.sealS).kind).toBe('sealed');
    expect(at(10, (s) => { s.match.sealed = true; }).label).toBe('DISTRITO SELLADO');
  });

  it('tras llamar a la extracción manda el helicóptero', () => {
    const inbound = at(TIMERS.sealS + 5, (s) => {
      s.missions.extraction.phase = 'inbound';
      s.missions.extraction.etaRemaining = 32;
    });
    expect(inbound.kind).toBe('heli');
    expect(inbound.label).toBe('HELICÓPTERO en 0:32');

    const board = at(100, (s) => {
      s.missions.extraction.phase = 'landed';
      s.missions.extraction.boardRemaining = 9;
    });
    expect(board.kind).toBe('board');
    expect(board.tone).toBe('danger');

    const lost = at(100, (s) => {
      s.missions.extraction.phase = 'departed';
      s.missions.extraction.boarded = false;
    });
    expect(lost.tone).toBe('danger');
  });
});
