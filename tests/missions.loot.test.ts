import { describe, expect, it } from 'vitest';
import { ECONOMY, LOOT, PLAYER, THREAT_SCALE, WEAPONS, ZONE_IDS } from '../src/config';
import type { PickupKind } from '../src/config';
import { createRunState } from '../src/core/state';
import { createRng } from '../src/core/util';
import type { EnemyType } from '../src/core/types';
import { applyPickup, dropChance, rollDrop, staticLootCount, staticLootPlan } from '../src/rules/loot';
import type { PickupDrop } from '../src/rules/loot';
import { threatOf } from '../src/rules/zones';

const KINDS: PickupKind[] = ['cash', 'ammo', 'plate', 'grenade', 'medkit'];
const TYPES: EnemyType[] = ['walker', 'runner', 'brute', 'spitter', 'warden'];

function sample(type: EnemyType, threat: number, n: number, seed = 1): (PickupDrop | null)[] {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rollDrop(rng, type, threat));
}

describe('dropChance', () => {
  it('= LOOT.dropChance × THREAT_SCALE.dropChance acotado a 1', () => {
    expect(dropChance('walker', 1)).toBeCloseTo(LOOT.dropChance.walker * THREAT_SCALE.dropChance[1]!, 9);
    expect(dropChance('brute', 4)).toBeCloseTo(Math.min(1, LOOT.dropChance.brute * THREAT_SCALE.dropChance[4]!), 9);
    expect(dropChance('warden', 4)).toBe(1);
  });
  it('crece con la amenaza y nunca supera 1', () => {
    for (const type of TYPES) {
      for (let t = 2; t <= 4; t++) expect(dropChance(type, t)).toBeGreaterThanOrEqual(dropChance(type, t - 1));
      for (let t = 1; t <= 4; t++) expect(dropChance(type, t)).toBeLessThanOrEqual(1);
    }
  });
});

describe('rollDrop', () => {
  it('es determinista con la misma semilla', () => {
    expect(sample('runner', 3, 200, 42)).toEqual(sample('runner', 3, 200, 42));
    expect(sample('runner', 3, 200, 42)).not.toEqual(sample('runner', 3, 200, 43));
  });
  it('sólo devuelve tipos válidos con cantidades positivas y enteras', () => {
    for (const type of TYPES) {
      for (let t = 1; t <= 4; t++) {
        for (const d of sample(type, t, 300, t * 7)) {
          if (!d) continue;
          expect(KINDS).toContain(d.kind);
          expect(d.amount).toBeGreaterThan(0);
          expect(Number.isInteger(d.amount)).toBe(true);
        }
      }
    }
  });
  it('el Warden siempre suelta algo', () => {
    expect(sample('warden', 4, 200).every((d) => d !== null)).toBe(true);
  });
  it('la frecuencia de drops se acerca a la probabilidad teórica', () => {
    const n = 20_000;
    for (const [type, t] of [['walker', 1], ['brute', 2], ['spitter', 3]] as const) {
      const hits = sample(type, t, n, 99).filter((d) => d !== null).length;
      expect(hits / n).toBeGreaterThan(dropChance(type, t) - 0.02);
      expect(hits / n).toBeLessThan(dropChance(type, t) + 0.02);
    }
  });
  it('los pesos por amenaza se respetan (más placas y granadas en zonas peligrosas)', () => {
    const frac = (threat: number, kind: PickupKind): number => {
      const drops = sample('warden', threat, 12_000, 5).filter((d): d is PickupDrop => d !== null);
      return drops.filter((d) => d.kind === kind).length / drops.length;
    };
    expect(frac(4, 'plate')).toBeGreaterThan(frac(1, 'plate') * 3);
    expect(frac(4, 'grenade')).toBeGreaterThan(frac(1, 'grenade'));
    expect(frac(1, 'cash')).toBeGreaterThan(frac(4, 'cash'));
  });
  it('el dinero escala con la amenaza (rango base × THREAT_SCALE.loot, redondeado)', () => {
    const cash = (threat: number): number[] =>
      sample('warden', threat, 5000, 3).filter((d): d is PickupDrop => d?.kind === 'cash').map((d) => d.amount);
    for (let t = 1; t <= 4; t++) {
      const amounts = cash(t);
      const lo = LOOT.cash[0] * THREAT_SCALE.loot[t]!;
      const hi = LOOT.cash[1] * THREAT_SCALE.loot[t]!;
      expect(Math.min(...amounts)).toBeGreaterThanOrEqual(lo - ECONOMY.bountyRounding);
      expect(Math.max(...amounts)).toBeLessThanOrEqual(hi + ECONOMY.bountyRounding);
      for (const a of amounts) expect(a % ECONOMY.bountyRounding).toBe(0);
    }
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(cash(4))).toBeGreaterThan(mean(cash(1)) * 2.5);
  });
  it('el botiquín cura LOOT.medkitHeal y el resto son 1 unidad', () => {
    for (const d of sample('warden', 3, 2000, 8)) {
      if (!d) continue;
      if (d.kind === 'medkit') expect(d.amount).toBe(LOOT.medkitHeal);
      if (d.kind === 'plate' || d.kind === 'grenade' || d.kind === 'ammo') expect(d.amount).toBe(1);
    }
  });
  it('amenaza fuera de rango no rompe la tirada', () => {
    expect(() => sample('walker', 99, 50)).not.toThrow();
    expect(() => sample('walker', -1, 50)).not.toThrow();
    expect(() => sample('walker', Number.NaN, 50)).not.toThrow();
  });
});

describe('applyPickup', () => {
  it('cash suma dinero y lo contabiliza', () => {
    const s = createRunState();
    expect(applyPickup(s, 'cash', 120)).toEqual({ collected: true, amount: 120 });
    expect(s.player.money).toBe(PLAYER.start.money + 120);
    expect(s.match.moneyEarned).toBe(120);
  });
  it('cantidades no positivas nunca se recogen', () => {
    const s = createRunState();
    for (const kind of KINDS) {
      expect(applyPickup(s, kind, 0).collected).toBe(false);
      expect(applyPickup(s, kind, -3).collected).toBe(false);
    }
    expect(s.player.money).toBe(PLAYER.start.money);
  });
  it('un jugador muerto no recoge nada', () => {
    const s = createRunState();
    s.player.alive = false;
    expect(applyPickup(s, 'cash', 100).collected).toBe(false);
  });
  it('munición: reparte LOOT.ammoFraction de cargador a cada arma con hueco', () => {
    const s = createRunState();
    const [a, b] = [s.player.slots[0]!, s.player.slots[1]!];
    const [ra, rb] = [a.reserve, b.reserve];
    const out = applyPickup(s, 'ammo', 1);
    const giveA = Math.ceil(WEAPONS[a.id].magSize * LOOT.ammoFraction);
    const giveB = Math.ceil(WEAPONS[b.id].magSize * LOOT.ammoFraction);
    expect(out).toEqual({ collected: true, amount: giveA + giveB });
    expect(a.reserve).toBe(ra + giveA);
    expect(b.reserve).toBe(rb + giveB);
  });
  it('munición: con las reservas llenas NO se consume', () => {
    const s = createRunState();
    for (const slot of s.player.slots) if (slot) slot.reserve = WEAPONS[slot.id].reserveMax;
    expect(applyPickup(s, 'ammo', 1)).toEqual({ collected: false, amount: 0 });
  });
  it('munición: nunca supera reserveMax y sirve aunque sólo una arma tenga hueco', () => {
    const s = createRunState();
    const [a, b] = [s.player.slots[0]!, s.player.slots[1]!];
    a.reserve = WEAPONS[a.id].reserveMax;
    b.reserve = WEAPONS[b.id].reserveMax - 1;
    expect(applyPickup(s, 'ammo', 5)).toEqual({ collected: true, amount: 1 });
    expect(b.reserve).toBe(WEAPONS[b.id].reserveMax);
    expect(a.reserve).toBe(WEAPONS[a.id].reserveMax);
  });
  it('munición: sin armas equipadas no se recoge', () => {
    const s = createRunState();
    s.player.slots = [null, null];
    expect(applyPickup(s, 'ammo', 1).collected).toBe(false);
  });
  it('placas: respeta el tope y la mochila', () => {
    const s = createRunState();
    s.player.plates = PLAYER.cap.plates;
    expect(applyPickup(s, 'plate', 1).collected).toBe(false);
    expect(s.player.plates).toBe(PLAYER.cap.plates);
    s.player.hasPack = true;
    expect(applyPickup(s, 'plate', 1)).toEqual({ collected: true, amount: 1 });
    expect(s.player.plates).toBe(PLAYER.cap.plates + 1);
    s.player.plates = PLAYER.cap.platesPack;
    expect(applyPickup(s, 'plate', 1).collected).toBe(false);
  });
  it('granadas: respeta el tope y la mochila', () => {
    const s = createRunState();
    s.player.grenades = PLAYER.cap.grenades;
    expect(applyPickup(s, 'grenade', 1).collected).toBe(false);
    s.player.hasPack = true;
    expect(applyPickup(s, 'grenade', 1).collected).toBe(true);
    expect(s.player.grenades).toBe(PLAYER.cap.grenades + 1);
  });
  it('granadas/placas: nunca superan el tope aunque la cantidad sea mayor', () => {
    const s = createRunState();
    s.player.grenades = PLAYER.cap.grenades - 1;
    expect(applyPickup(s, 'grenade', 10)).toEqual({ collected: true, amount: 1 });
    expect(s.player.grenades).toBe(PLAYER.cap.grenades);
  });
  it('botiquín: con vida completa NO se consume; cura sin pasar del máximo', () => {
    const s = createRunState();
    expect(applyPickup(s, 'medkit', LOOT.medkitHeal).collected).toBe(false);
    s.player.hp = 90;
    expect(applyPickup(s, 'medkit', LOOT.medkitHeal)).toEqual({ collected: true, amount: 10 });
    expect(s.player.hp).toBe(s.player.maxHp);
    s.player.hp = 10;
    expect(applyPickup(s, 'medkit', LOOT.medkitHeal)).toEqual({ collected: true, amount: LOOT.medkitHeal });
    expect(s.player.hp).toBe(10 + LOOT.medkitHeal);
  });
});

describe('staticLootPlan', () => {
  const spots = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i * 3, z: 100 - i * 5 }));

  it('reparte staticLootCount(zona) objetos en posiciones distintas de la lista', () => {
    for (const zone of ZONE_IDS) {
      const s = spots(200);
      const plan = staticLootPlan(createRng(11), zone, s);
      expect(plan).toHaveLength(staticLootCount(zone));
      const keys = new Set(plan.map((p) => `${p.x},${p.z}`));
      expect(keys.size).toBe(plan.length);
      for (const p of plan) expect(s.some((q) => q.x === p.x && q.z === p.z)).toBe(true);
      for (const p of plan) {
        expect(KINDS).toContain(p.kind);
        expect(p.amount).toBeGreaterThan(0);
      }
    }
  });
  it('más amenaza = más objetos (staticPerZone × amenaza)', () => {
    const counts = ZONE_IDS.map((z) => staticLootCount(z));
    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThan(counts[i - 1]!);
    expect(staticLootCount('complex')).toBe(Math.round(LOOT.staticPerZone.complex * THREAT_SCALE.dropChance[threatOf('complex')]!));
  });
  it('con pocos puntos usa todos, sin repetir, y con ninguno devuelve vacío', () => {
    expect(staticLootPlan(createRng(1), 'complex', spots(3))).toHaveLength(3);
    expect(staticLootPlan(createRng(1), 'complex', [])).toEqual([]);
  });
  it('es determinista y no muta la lista de entrada', () => {
    const s = spots(50);
    const copy = JSON.parse(JSON.stringify(s)) as typeof s;
    const a = staticLootPlan(createRng(5), 'refinery', s);
    const b = staticLootPlan(createRng(5), 'refinery', s);
    expect(a).toEqual(b);
    expect(s).toEqual(copy);
    expect(staticLootPlan(createRng(6), 'refinery', s)).not.toEqual(a);
  });
  it('el botín de zonas peligrosas vale más dinero por objeto de cash', () => {
    const avgCash = (zone: (typeof ZONE_IDS)[number]): number => {
      let total = 0;
      let n = 0;
      for (let seed = 0; seed < 60; seed++) {
        for (const p of staticLootPlan(createRng(seed), zone, spots(300))) {
          if (p.kind === 'cash') {
            total += p.amount;
            n++;
          }
        }
      }
      return total / n;
    };
    expect(avgCash('complex')).toBeGreaterThan(avgCash('perimeter') * 2.5);
  });
});
