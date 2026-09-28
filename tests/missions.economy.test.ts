import { describe, expect, it } from 'vitest';
import { ECONOMY, ENEMIES, PLAYER, SHOP, THREAT_SCALE, WEAPONS } from '../src/config';
import type { VendorId } from '../src/config';
import { createRunState } from '../src/core/state';
import type { RunState } from '../src/core/state';
import { addMoney, clampThreat, grenadeCap, killReward, plateCap, purchase, spend } from '../src/rules/economy';

function rich(): RunState {
  const s = createRunState();
  s.player.money = 100_000;
  return s;
}
const idx = (vendor: VendorId, id: string): number => SHOP[vendor].items.findIndex((i) => i.id === id);

describe('addMoney / spend', () => {
  it('addMoney suma y lleva la contabilidad de ingresos', () => {
    const s = createRunState();
    expect(addMoney(s, 250)).toBe(250);
    expect(s.player.money).toBe(PLAYER.start.money + 250);
    expect(s.match.moneyEarned).toBe(250);
  });
  it('addMoney ignora importes negativos, cero, NaN e infinitos', () => {
    const s = createRunState();
    for (const v of [-50, 0, Number.NaN, Infinity, -Infinity]) expect(addMoney(s, v)).toBe(0);
    expect(s.player.money).toBe(PLAYER.start.money);
    expect(s.match.moneyEarned).toBe(0);
  });
  it('addMoney redondea a entero', () => {
    const s = createRunState();
    addMoney(s, 10.6);
    expect(Number.isInteger(s.player.money)).toBe(true);
  });
  it('spend cobra, contabiliza y nunca deja el dinero negativo', () => {
    const s = createRunState();
    expect(spend(s, 150)).toBe(true);
    expect(s.player.money).toBe(PLAYER.start.money - 150);
    expect(s.match.moneySpent).toBe(150);
    expect(spend(s, 10_000)).toBe(false);
    expect(s.player.money).toBe(PLAYER.start.money - 150);
    expect(s.match.moneySpent).toBe(150);
  });
  it('spend rechaza importes inválidos y admite gastar exactamente todo', () => {
    const s = createRunState();
    expect(spend(s, -1)).toBe(false);
    expect(spend(s, Number.NaN)).toBe(false);
    expect(spend(s, s.player.money)).toBe(true);
    expect(s.player.money).toBe(0);
    expect(spend(s, 1)).toBe(false);
    expect(s.player.money).toBe(0);
  });
});

describe('killReward', () => {
  it('= bounty × THREAT_SCALE.loot redondeado a bountyRounding', () => {
    expect(killReward('walker', 1)).toBe(25);
    expect(killReward('runner', 1)).toBe(35);
    expect(killReward('brute', 2)).toBe(180);
    expect(killReward('spitter', 3)).toBe(130); // 60 × 2.2 = 132 → 130
    for (const type of ['walker', 'runner', 'brute', 'spitter'] as const) {
      for (let t = 1; t <= 4; t++) {
        const raw = ENEMIES[type].bounty * THREAT_SCALE.loot[t]!;
        const expected = Math.round(raw / ECONOMY.bountyRounding) * ECONOMY.bountyRounding;
        expect(killReward(type, t)).toBe(expected);
        expect(killReward(type, t) % ECONOMY.bountyRounding).toBe(0);
      }
    }
  });
  it('crece con la amenaza de la zona', () => {
    for (const type of ['walker', 'runner', 'brute', 'spitter'] as const) {
      for (let t = 2; t <= 4; t++) expect(killReward(type, t)).toBeGreaterThanOrEqual(killReward(type, t - 1));
    }
    expect(killReward('walker', 4)).toBeGreaterThan(killReward('walker', 1));
  });
  it('el Warden no paga bounty (paga el contrato) y la amenaza fuera de rango se acota', () => {
    expect(killReward('warden', 4)).toBe(0);
    expect(killReward('walker', 99)).toBe(killReward('walker', 4));
    expect(killReward('walker', -3)).toBe(killReward('walker', 1));
    expect(killReward('walker', Number.NaN)).toBe(killReward('walker', 1));
    expect(clampThreat(0)).toBe(1);
    expect(clampThreat(7)).toBe(4);
  });
});

describe('capacidades', () => {
  it('la mochila amplía placas y granadas', () => {
    const s = createRunState();
    expect(plateCap(s)).toBe(PLAYER.cap.plates);
    expect(grenadeCap(s)).toBe(PLAYER.cap.grenades);
    s.player.hasPack = true;
    expect(plateCap(s)).toBe(PLAYER.cap.platesPack);
    expect(grenadeCap(s)).toBe(PLAYER.cap.grenadesPack);
  });
});

describe('purchase — validación', () => {
  it('índices fuera de 0..5 o no enteros no compran nada', () => {
    const s = rich();
    for (const i of [-1, 6, 100, 1.5, Number.NaN]) {
      const r = purchase(s, 'cage', i);
      expect(r.ok).toBe(false);
      expect(r.item).toBeNull();
      expect(r.reason).toBeUndefined();
    }
    expect(s.player.money).toBe(100_000);
  });
  it('devuelve siempre el artículo consultado', () => {
    const s = rich();
    s.player.slots[0]!.reserve = 0;
    expect(purchase(s, 'cage', 0).item?.id).toBe('ammo0');
  });
  it('sin fondos → funds y no cambia nada (compra atómica)', () => {
    const s = createRunState();
    s.player.money = 149;
    s.player.slots[0]!.reserve = 0;
    const r = purchase(s, 'cage', idx('cage', 'ammo0'));
    expect(r).toMatchObject({ ok: false, reason: 'funds' });
    expect(s.player.money).toBe(149);
    expect(s.player.slots[0]!.reserve).toBe(0);
    expect(s.match.moneySpent).toBe(0);
  });
  it('cobra exactamente el precio y lo contabiliza', () => {
    const s = createRunState();
    s.player.money = 150;
    s.player.slots[0]!.reserve = 0;
    expect(purchase(s, 'cage', idx('cage', 'ammo0')).ok).toBe(true);
    expect(s.player.money).toBe(0);
    expect(s.match.moneySpent).toBe(150);
  });
  it('nunca deja el dinero negativo ni siquiera comprando en cadena', () => {
    const s = createRunState();
    s.player.slots[0]!.reserve = 0;
    s.player.slots[1]!.reserve = 0;
    for (let round = 0; round < 6; round++) {
      for (let i = 0; i < 6; i++) purchase(s, 'cage', i);
      s.player.hp = 1;
      s.player.armor = 0;
      s.player.plates = 0;
      s.player.grenades = 0;
    }
    expect(s.player.money).toBeGreaterThanOrEqual(0);
    expect(s.match.moneySpent).toBeGreaterThan(0);
  });
});

describe('purchase — jaula', () => {
  it('munición del arma 1 rellena la reserva al máximo; llena → full', () => {
    const s = rich();
    const slot = s.player.slots[0]!;
    slot.reserve = 10;
    expect(purchase(s, 'cage', idx('cage', 'ammo0')).ok).toBe(true);
    expect(slot.reserve).toBe(WEAPONS[slot.id].reserveMax);
    const before = s.player.money;
    expect(purchase(s, 'cage', idx('cage', 'ammo0'))).toMatchObject({ ok: false, reason: 'full' });
    expect(s.player.money).toBe(before);
  });
  it('munición del arma 2 rellena la reserva de la secundaria', () => {
    const s = rich();
    const slot = s.player.slots[1]!;
    slot.reserve = 0;
    expect(purchase(s, 'cage', idx('cage', 'ammo1')).ok).toBe(true);
    expect(slot.reserve).toBe(WEAPONS[slot.id].reserveMax);
    expect(s.player.slots[0]!.reserve).toBeLessThan(WEAPONS[s.player.slots[0]!.id].reserveMax);
  });
  it('ranura vacía → full (nada que rellenar)', () => {
    const s = rich();
    s.player.slots[1] = null;
    expect(purchase(s, 'cage', idx('cage', 'ammo1'))).toMatchObject({ ok: false, reason: 'full' });
    expect(s.player.money).toBe(100_000);
  });
  it('granada respeta el tope y la mochila lo amplía', () => {
    const s = rich();
    s.player.grenades = PLAYER.cap.grenades - 1;
    expect(purchase(s, 'cage', idx('cage', 'grenade')).ok).toBe(true);
    expect(s.player.grenades).toBe(PLAYER.cap.grenades);
    expect(purchase(s, 'cage', idx('cage', 'grenade'))).toMatchObject({ ok: false, reason: 'full' });
    s.player.hasPack = true;
    expect(purchase(s, 'cage', idx('cage', 'grenade')).ok).toBe(true);
    expect(s.player.grenades).toBe(PLAYER.cap.grenades + 1);
  });
  it('placa respeta el tope y la mochila lo amplía', () => {
    const s = rich();
    s.player.plates = PLAYER.cap.plates;
    expect(purchase(s, 'cage', idx('cage', 'plate'))).toMatchObject({ ok: false, reason: 'full' });
    s.player.hasPack = true;
    expect(purchase(s, 'cage', idx('cage', 'plate')).ok).toBe(true);
    expect(s.player.plates).toBe(PLAYER.cap.plates + 1);
    s.player.plates = PLAYER.cap.platesPack;
    expect(purchase(s, 'cage', idx('cage', 'plate'))).toMatchObject({ ok: false, reason: 'full' });
  });
  it('botiquín cura `amount` sin pasar del máximo y se deniega con vida completa', () => {
    const s = rich();
    expect(purchase(s, 'cage', idx('cage', 'medkit'))).toMatchObject({ ok: false, reason: 'full' });
    expect(s.player.money).toBe(100_000);
    s.player.hp = 20;
    expect(purchase(s, 'cage', idx('cage', 'medkit')).ok).toBe(true);
    expect(s.player.hp).toBe(80);
    expect(purchase(s, 'cage', idx('cage', 'medkit')).ok).toBe(true);
    expect(s.player.hp).toBe(s.player.maxHp);
  });
  it('kit de blindaje sube el blindaje al máximo y se deniega con blindaje completo', () => {
    const s = rich();
    s.player.armor = 10;
    expect(purchase(s, 'cage', idx('cage', 'armorFull')).ok).toBe(true);
    expect(s.player.armor).toBe(s.player.maxArmor);
    expect(purchase(s, 'cage', idx('cage', 'armorFull'))).toMatchObject({ ok: false, reason: 'full' });
  });
});

describe('purchase — banco de armería', () => {
  it('un arma nueva reemplaza la ranura correcta con cargador lleno y reservas', () => {
    const s = rich();
    const before1 = { ...s.player.slots[1]! };
    expect(purchase(s, 'bench', idx('bench', 'w_assault')).ok).toBe(true);
    const def = WEAPONS.assault;
    expect(s.player.slots[0]).toEqual({
      id: 'assault', mag: def.magSize, reserve: Math.min(def.reserveMax, def.magSize * ECONOMY.newWeaponReserveMags),
    });
    expect(s.player.slots[1]).toEqual(before1); // la secundaria no se toca
    expect(s.match.moneySpent).toBe(SHOP.bench.items[idx('bench', 'w_assault')]!.price);
  });
  it('el revólver va a la ranura secundaria', () => {
    const s = rich();
    expect(purchase(s, 'bench', idx('bench', 'w_revolver')).ok).toBe(true);
    expect(s.player.slots[1]!.id).toBe('revolver');
    expect(s.player.slots[0]!.id).toBe('carbine');
    expect(s.player.slots[1]!.mag).toBe(WEAPONS.revolver.magSize);
  });
  it('cada arma del banco cae en su ranura y la reserva nunca supera reserveMax', () => {
    for (const item of SHOP.bench.items) {
      if (item.kind !== 'weapon' || !item.weapon) continue;
      const s = rich();
      const def = WEAPONS[item.weapon];
      expect(purchase(s, 'bench', SHOP.bench.items.indexOf(item)).ok).toBe(true);
      const slot = s.player.slots[def.slot]!;
      expect(slot.id).toBe(item.weapon);
      expect(slot.mag).toBe(def.magSize);
      expect(slot.reserve).toBeLessThanOrEqual(def.reserveMax);
      expect(slot.reserve).toBeGreaterThan(0);
    }
  });
  it('un arma que ya llevas → owned y no se cobra', () => {
    const s = rich();
    s.player.slots[0]!.id = 'smg';
    expect(purchase(s, 'bench', idx('bench', 'w_smg'))).toMatchObject({ ok: false, reason: 'owned' });
    expect(s.player.money).toBe(100_000);
    expect(purchase(s, 'bench', idx('bench', 'w_assault')).ok).toBe(true);
    expect(purchase(s, 'bench', idx('bench', 'w_assault'))).toMatchObject({ ok: false, reason: 'owned' });
  });
  it('sin fondos para un arma → funds', () => {
    const s = createRunState();
    expect(purchase(s, 'bench', idx('bench', 'w_dmr'))).toMatchObject({ ok: false, reason: 'funds' });
    expect(s.player.slots[0]!.id).toBe('carbine');
  });
  it('la mochila se compra una vez (owned después) y activa las capacidades ampliadas', () => {
    const s = rich();
    expect(purchase(s, 'bench', idx('bench', 'pack')).ok).toBe(true);
    expect(s.player.hasPack).toBe(true);
    expect(purchase(s, 'bench', idx('bench', 'pack'))).toMatchObject({ ok: false, reason: 'owned' });
    expect(s.player.money).toBe(100_000 - SHOP.bench.items[idx('bench', 'pack')]!.price);
  });
  it('todos los artículos de ambos vendedores son comprables en un estado adecuado', () => {
    for (const vendor of ['cage', 'bench'] as const) {
      for (let i = 0; i < SHOP[vendor].items.length; i++) {
        const s = rich();
        s.player.hp = 10;
        s.player.armor = 0;
        s.player.plates = 0;
        s.player.grenades = 0;
        s.player.slots[0]!.reserve = 0;
        s.player.slots[1]!.reserve = 0;
        const r = purchase(s, vendor, i);
        expect(r.ok, `${vendor}[${i}]`).toBe(true);
      }
    }
  });
});
