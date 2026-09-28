import { describe, expect, it } from 'vitest';
import { PLAYER, SHOP } from '../src/config';
import { createRunState } from '../src/core/state';
import {
  END_REASON_DETAIL, END_REASON_TEXT, endReasonText, formatAccuracy, formatDelta, formatMoney, resultFor,
  shopItemStatus, summarizeRun,
} from '../src/ui/format';

describe('formatMoney / formatDelta', () => {
  it('agrupa miles con punto', () => {
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(400)).toBe('$400');
    expect(formatMoney(3000)).toBe('$3.000');
    expect(formatMoney(7500)).toBe('$7.500');
    expect(formatMoney(1234567)).toBe('$1.234.567');
  });
  it('redondea y tolera negativos y no finitos', () => {
    expect(formatMoney(12.6)).toBe('$13');
    expect(formatMoney(-200)).toBe('-$200');
    expect(formatMoney(-0.2)).toBe('$0');
    expect(formatMoney(NaN)).toBe('$0');
    expect(formatMoney(Infinity)).toBe('$0');
  });
  it('variaciones con signo explícito', () => {
    expect(formatDelta(150)).toBe('+$150');
    expect(formatDelta(-1200)).toBe('-$1.200');
    expect(formatDelta(0)).toBe('+$0');
  });
});

describe('textos de fin de partida', () => {
  it('cubren los cuatro motivos en español', () => {
    expect(END_REASON_TEXT.extracted).toBe('Extracción completada');
    expect(END_REASON_TEXT.dead).toBe('Has muerto');
    expect(END_REASON_TEXT.sealed).toBe('El distrito fue sellado');
    expect(END_REASON_TEXT.heli_left).toBe('El helicóptero se fue sin ti');
    for (const k of Object.keys(END_REASON_TEXT) as (keyof typeof END_REASON_TEXT)[]) {
      expect(END_REASON_DETAIL[k].length).toBeGreaterThan(10);
    }
  });
  it('motivo desconocido o ausente tiene texto de reserva', () => {
    expect(endReasonText(null)).toBe('Partida terminada');
    expect(endReasonText(undefined)).toBe('Partida terminada');
    expect(endReasonText('dead')).toBe('Has muerto');
  });
  it('sólo la extracción es victoria', () => {
    expect(resultFor('extracted')).toBe('won');
    expect(resultFor('dead')).toBe('lost');
    expect(resultFor('sealed')).toBe('lost');
    expect(resultFor('heli_left')).toBe('lost');
    expect(resultFor(null)).toBe('lost');
  });
});

describe('summarizeRun', () => {
  it('sin disparos la precisión es null', () => {
    const s = summarizeRun(createRunState());
    expect(s.accuracy).toBeNull();
    expect(formatAccuracy(s.accuracy)).toBe('—');
    expect(s.contractsDone).toBe(0);
    expect(s.contractsTotal).toBe(3);
  });
  it('calcula precisión, contratos y dinero', () => {
    const st = createRunState();
    st.match.elapsed = 452;
    st.match.kills = 31;
    st.match.headshots = 9;
    st.match.shotsFired = 200;
    st.match.shotsHit = 123;
    st.match.moneyEarned = 4200;
    st.match.moneySpent = 1800;
    st.missions.relay.status = 'completed';
    st.missions.warden.paid = true;
    const s = summarizeRun(st);
    expect(s.timeS).toBe(452);
    expect(s.accuracy).toBeCloseTo(0.615, 6);
    expect(formatAccuracy(s.accuracy)).toBe('62 %');
    expect(s.contractsDone).toBe(2);
    expect(s.contracts).toEqual({ relay: true, warden: true, extraction: false });
    expect(s.moneyEarned).toBe(4200);
    expect(s.moneySpent).toBe(1800);
  });
  it('acota la precisión a 0..1 con datos incoherentes', () => {
    const st = createRunState();
    st.match.shotsFired = 10;
    st.match.shotsHit = 30;
    expect(summarizeRun(st).accuracy).toBe(1);
    st.match.shotsHit = -5;
    expect(summarizeRun(st).accuracy).toBe(0);
  });
});

describe('shopItemStatus', () => {
  const item = (vendor: 'cage' | 'bench', id: string) => SHOP[vendor].items.find((i) => i.id === id)!;

  it('asequible / fondos insuficientes', () => {
    const p = createRunState().player;
    p.hp = 40; // el botiquín no está lleno
    p.money = 300;
    expect(shopItemStatus(item('cage', 'medkit'), p)).toBe('ok');
    p.money = 100;
    expect(shopItemStatus(item('cage', 'medkit'), p)).toBe('funds');
  });
  it('armas ya poseídas y mochila comprada', () => {
    const p = createRunState().player;
    p.money = 99999;
    expect(shopItemStatus(item('bench', 'w_dmr'), p)).toBe('ok');
    p.slots[0] = { id: 'dmr', mag: 10, reserve: 30 };
    expect(shopItemStatus(item('bench', 'w_dmr'), p)).toBe('owned');
    expect(shopItemStatus(item('bench', 'pack'), p)).toBe('ok');
    p.hasPack = true;
    expect(shopItemStatus(item('bench', 'pack'), p)).toBe('owned');
  });
  it('lleno: placas y granadas respetan el tope (con y sin mochila)', () => {
    const p = createRunState().player;
    p.money = 99999;
    p.plates = PLAYER.cap.plates;
    p.grenades = PLAYER.cap.grenades;
    expect(shopItemStatus(item('cage', 'plate'), p)).toBe('full');
    expect(shopItemStatus(item('cage', 'grenade'), p)).toBe('full');
    p.hasPack = true;
    expect(shopItemStatus(item('cage', 'plate'), p)).toBe('ok');
    expect(shopItemStatus(item('cage', 'grenade'), p)).toBe('ok');
  });
  it('lleno: vida, blindaje y munición al máximo', () => {
    const p = createRunState().player;
    p.money = 99999;
    p.hp = p.maxHp;
    p.armor = p.maxArmor;
    expect(shopItemStatus(item('cage', 'medkit'), p)).toBe('full');
    expect(shopItemStatus(item('cage', 'armorFull'), p)).toBe('full');
    p.slots[0]!.reserve = 175;
    expect(shopItemStatus(item('cage', 'ammo0'), p)).toBe('full');
    p.slots[0]!.reserve = 10;
    expect(shopItemStatus(item('cage', 'ammo0'), p)).toBe('ok');
    p.slots[1] = null;
    expect(shopItemStatus(item('cage', 'ammo1'), p)).toBe('full');
  });
  it('lleno/poseído tiene prioridad sobre fondos insuficientes', () => {
    const p = createRunState().player;
    p.money = 0;
    p.hp = p.maxHp;
    expect(shopItemStatus(item('cage', 'medkit'), p)).toBe('full');
  });
});
