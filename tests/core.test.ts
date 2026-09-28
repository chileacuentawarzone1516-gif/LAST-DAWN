import { describe, expect, it } from 'vitest';
import { MAP, SHOP, THREAT_SCALE, WEAPONS, ZONE_IDS } from '../src/config';
import { EventBus } from '../src/core/events';
import { createRunState, resetRunState } from '../src/core/state';
import { clamp, createRng, formatClock, pickWeighted, wrapAngle } from '../src/core/util';
import { threatOf, zoneAt } from '../src/rules/zones';

describe('zonas', () => {
  it('asigna la zona correcta a los puntos clave del mapa', () => {
    expect(zoneAt(MAP.spawn.x, MAP.spawn.z)).toBe('perimeter');
    expect(zoneAt(MAP.relay.x, MAP.relay.z)).toBe('refinery');
    expect(zoneAt(MAP.complex.wardenSpawn.x, MAP.complex.wardenSpawn.z)).toBe('complex');
    expect(zoneAt(60, 35)).toBe('warehouses');
  });
  it('la amenaza crece hacia el complejo', () => {
    const t = ZONE_IDS.map(threatOf);
    expect(t).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < THREAT_SCALE.loot.length; i++) {
      expect(THREAT_SCALE.loot[i]!).toBeGreaterThanOrEqual(THREAT_SCALE.loot[i - 1]!);
    }
  });
  it('las jaulas están en la zona que declaran', () => {
    for (const c of MAP.cages) expect(zoneAt(c.x, c.z)).toBe(c.zone);
  });
});

describe('config', () => {
  it('cada tienda tiene exactamente 6 artículos (teclas 1-6) con precio positivo', () => {
    for (const v of Object.values(SHOP)) {
      expect(v.items).toHaveLength(6);
      for (const it of v.items) expect(it.price).toBeGreaterThan(0);
    }
  });
  it('las armas de tienda existen', () => {
    for (const it of SHOP.bench.items) if (it.weapon) expect(WEAPONS[it.weapon]).toBeDefined();
  });
});

describe('bus y estado', () => {
  it('emite, cancela y agrupa suscripciones', () => {
    const bus = new EventBus();
    let n = 0;
    const scope = bus.scope();
    scope.on('money:changed', () => n++);
    bus.emit('money:changed', { balance: 1, delta: 1, reason: 't' });
    scope.dispose();
    bus.emit('money:changed', { balance: 2, delta: 1, reason: 't' });
    expect(n).toBe(1);
  });
  it('resetRunState conserva la identidad del objeto', () => {
    const s = createRunState();
    const ref = s;
    s.player.money = 99999;
    resetRunState(s, 'playing');
    expect(ref).toBe(s);
    expect(s.player.money).toBe(400);
    expect(s.flow).toBe('playing');
  });
});

describe('util', () => {
  it('formatClock, clamp, wrapAngle', () => {
    expect(formatClock(452)).toBe('7:32');
    expect(clamp(5, 0, 3)).toBe(3);
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
  });
  it('rng determinista y pickWeighted respeta pesos', () => {
    const a = createRng(7);
    const b = createRng(7);
    expect(a()).toBe(b());
    const rng = createRng(1);
    const counts = { x: 0, y: 0 };
    for (let i = 0; i < 2000; i++) counts[pickWeighted(rng, { x: 90, y: 10 })!]++;
    expect(counts.x).toBeGreaterThan(counts.y * 5);
    expect(pickWeighted(rng, {})).toBeUndefined();
  });
});
