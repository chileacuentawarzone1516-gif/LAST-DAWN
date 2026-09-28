import { describe, expect, it } from 'vitest';
import { DIRECTOR, ENEMIES, HORDES, SPAWN_MIX, THREAT_SCALE, WARDEN } from '../src/config';
import { createRng } from '../src/core/util';
import {
  clampThreat, createLife, createHitResult, explosionDamage, knockbackSpeed, resolveHit, rollSpeed, rollStagger,
  scaleEnemyStats, zoneMultiplier,
} from '../src/rules/enemies';
import type { InfectedType } from '../src/rules/enemies';
import {
  ambientDeficit, filterMix, hordeProgress, hordeWave, inViewCone, packSize, pickFromMix, pickSpawnType, ringPoint,
  simState, summonsDue, ZONES,
} from '../src/rules/director';

describe('scaleEnemyStats', () => {
  it('threat 1 deja las cifras base y threat 4 aplica THREAT_SCALE', () => {
    const w1 = scaleEnemyStats('walker', 1);
    expect(w1.maxHp).toBe(ENEMIES.walker.hp);
    expect(w1.speed).toBeCloseTo(ENEMIES.walker.speed);
    expect(w1.damage).toBeCloseTo(ENEMIES.walker.damage);
    expect(w1.sight).toBeCloseTo(ENEMIES.walker.sightRange);
    const w4 = scaleEnemyStats('walker', 4);
    expect(w4.maxHp).toBe(Math.round(ENEMIES.walker.hp * THREAT_SCALE.hp[4]!));
    expect(w4.speed).toBeCloseTo(ENEMIES.walker.speed * THREAT_SCALE.speed[4]!);
    expect(w4.damage).toBeCloseTo(ENEMIES.walker.damage * THREAT_SCALE.damage[4]!);
    expect(w4.sight).toBeCloseTo(ENEMIES.walker.sightRange * THREAT_SCALE.sight[4]!);
  });

  it('crece de forma monótona de threat 1 a 4 para todos los tipos', () => {
    for (const type of ['walker', 'runner', 'brute', 'spitter'] as const) {
      for (let t = 2; t <= 4; t++) {
        const a = scaleEnemyStats(type, t - 1);
        const b = scaleEnemyStats(type, t);
        expect(b.maxHp).toBeGreaterThanOrEqual(a.maxHp);
        expect(b.speed).toBeGreaterThanOrEqual(a.speed);
        expect(b.damage).toBeGreaterThanOrEqual(a.damage);
        expect(b.sight).toBeGreaterThanOrEqual(a.sight);
      }
    }
  });

  it('acota amenazas fuera de rango o no finitas', () => {
    expect(clampThreat(0)).toBe(1);
    expect(clampThreat(99)).toBe(4);
    expect(clampThreat(2.6)).toBe(3);
    expect(clampThreat(Number.NaN)).toBe(1);
    expect(scaleEnemyStats('runner', -5)).toEqual(scaleEnemyStats('runner', 1));
    expect(scaleEnemyStats('runner', 12)).toEqual(scaleEnemyStats('runner', 4));
  });

  it('el Warden no se escala por amenaza', () => {
    for (let t = 1; t <= 4; t++) {
      const s = scaleEnemyStats('warden', t);
      expect(s.maxHp).toBe(WARDEN.hp);
      expect(s.damage).toBe(WARDEN.meleeDamage);
      expect(s.speed).toBe(WARDEN.speed);
    }
  });

  it('la velocidad individual queda dentro de ± speedJitter y es determinista', () => {
    const stats = scaleEnemyStats('walker', 1);
    const a = createRng(11);
    const b = createRng(11);
    for (let i = 0; i < 200; i++) {
      const va = rollSpeed(stats, a);
      expect(va).toBe(rollSpeed(stats, b));
      expect(va).toBeGreaterThanOrEqual(stats.speed * (1 - stats.speedJitter) - 1e-9);
      expect(va).toBeLessThanOrEqual(stats.speed * (1 + stats.speedJitter) + 1e-9);
    }
  });
});

describe('resolveHit: infectados', () => {
  it('aplica multiplicadores de zona', () => {
    const head = createLife('walker', 1);
    expect(resolveHit(head, 'head', 10).scaled).toBeCloseTo(10 * ENEMIES.walker.headMult);
    const body = createLife('walker', 1);
    expect(resolveHit(body, 'body', 10).scaled).toBeCloseTo(10 * ENEMIES.walker.bodyMult);
    const limb = createLife('walker', 1);
    expect(resolveHit(limb, 'limb', 10).scaled).toBeCloseTo(10 * ENEMIES.walker.limbMult);
  });

  it('headshot sin casco en un infectado normal: mata y cuenta como headshot', () => {
    const life = createLife('walker', 1);
    const r = resolveHit(life, 'head', 40); // 40 × 3 = 120 ≥ 100 de vida
    expect(r.killed).toBe(true);
    expect(r.headshotKill).toBe(true);
    expect(r.helmetHit).toBe(false);
    expect(r.helmetDamage).toBe(0);
    expect(life.hp).toBe(0);
  });

  it('un disparo al cuerpo que mata no es headshot', () => {
    const life = createLife('runner', 1);
    const r = resolveHit(life, 'body', 500);
    expect(r.killed).toBe(true);
    expect(r.headshotKill).toBe(false);
  });

  it('overkill: applied se acota a la vida restante pero scaled conserva el exceso', () => {
    const life = createLife('walker', 1);
    const r = resolveHit(life, 'body', 1000);
    expect(r.applied).toBe(ENEMIES.walker.hp);
    expect(r.scaled).toBe(1000);
    expect(life.hp).toBe(0);
  });

  it('un cadáver no recibe más daño ni vuelve a morir', () => {
    const life = createLife('walker', 1);
    resolveHit(life, 'body', 1000);
    const again = resolveHit(life, 'head', 1000);
    expect(again.killed).toBe(false);
    expect(again.applied).toBe(0);
  });

  it('daño 0, negativo o NaN no hace nada', () => {
    const life = createLife('brute', 2);
    const hp = life.hp;
    for (const amount of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = resolveHit(life, 'head', amount);
      expect(r.applied).toBe(0);
      expect(r.killed).toBe(false);
    }
    expect(life.hp).toBe(hp);
  });

  it('el bruto aguanta más y su cabeza multiplica menos', () => {
    const brute = createLife('brute', 1);
    const r = resolveHit(brute, 'head', 100);
    expect(r.scaled).toBeCloseTo(100 * ENEMIES.brute.headMult);
    expect(brute.hp).toBeCloseTo(ENEMIES.brute.hp - 100 * ENEMIES.brute.headMult);
    expect(r.killed).toBe(false);
  });

  it('la vida escala con la amenaza del individuo', () => {
    expect(createLife('walker', 4).maxHp).toBeGreaterThan(createLife('walker', 1).maxHp);
  });

  it('reutiliza el objeto de resultado sin arrastrar valores anteriores', () => {
    const out = createHitResult();
    const life = createLife('walker', 1);
    resolveHit(life, 'head', 500, out);
    expect(out.killed).toBe(true);
    const other = createLife('walker', 1);
    resolveHit(other, 'limb', 1, out);
    expect(out.killed).toBe(false);
    expect(out.headshotKill).toBe(false);
  });
});

describe('resolveHit: Warden y casco', () => {
  it('con casco, la cabeza daña SOLO el casco (sin multiplicador de headshot)', () => {
    const life = createLife('warden', 4);
    const r = resolveHit(life, 'head', 100);
    expect(r.helmetHit).toBe(true);
    expect(r.helmetDamage).toBeCloseTo(100 * WARDEN.helmetDamageMult);
    expect(life.helmetHp).toBeCloseTo(WARDEN.helmetHp - 100 * WARDEN.helmetDamageMult);
    expect(life.hp).toBe(WARDEN.hp);
    expect(r.helmetBroken).toBe(false);
    expect(r.killed).toBe(false);
  });

  it('el casco se rompe justo al llegar a 0 (impacto exacto) y solo en ese impacto', () => {
    const life = createLife('warden', 4);
    const first = resolveHit(life, 'head', WARDEN.helmetHp);
    expect(first.helmetBroken).toBe(true);
    expect(life.helmetBroken).toBe(true);
    expect(life.helmetHp).toBe(0);
    expect(life.hp).toBe(WARDEN.hp);
    const second = resolveHit(life, 'head', 10);
    expect(second.helmetBroken).toBe(false);
    expect(second.helmetHit).toBe(false);
  });

  it('un golpe que deja el casco a 1 punto no lo rompe; el siguiente sí', () => {
    const life = createLife('warden', 4);
    const almost = resolveHit(life, 'head', WARDEN.helmetHp - 1);
    expect(almost.helmetBroken).toBe(false);
    expect(life.helmetHp).toBeCloseTo(1);
    const finisher = resolveHit(life, 'head', 1);
    expect(finisher.helmetBroken).toBe(true);
  });

  it('el exceso al romper el casco NO pasa a la vida', () => {
    const life = createLife('warden', 4);
    const r = resolveHit(life, 'head', WARDEN.helmetHp * 10);
    expect(r.helmetBroken).toBe(true);
    expect(r.helmetDamage).toBe(WARDEN.helmetHp);
    expect(r.applied).toBe(WARDEN.helmetHp);
    expect(r.scaled).toBeCloseTo(WARDEN.helmetHp * 10 * WARDEN.helmetDamageMult);
    expect(life.hp).toBe(WARDEN.hp);
    expect(r.killed).toBe(false);
  });

  it('sin casco, la cabeza multiplica por headMultAfterHelmet', () => {
    const life = createLife('warden', 4);
    resolveHit(life, 'head', WARDEN.helmetHp);
    const r = resolveHit(life, 'head', 100);
    expect(r.scaled).toBeCloseTo(100 * WARDEN.headMultAfterHelmet);
    expect(life.hp).toBeCloseTo(WARDEN.hp - 100 * WARDEN.headMultAfterHelmet);
    expect(r.helmetHit).toBe(false);
  });

  it('el blindaje: cuerpo ×0.22 y extremidades ×0.12, con el casco intacto o roto', () => {
    const life = createLife('warden', 4);
    expect(resolveHit(life, 'body', 100).applied).toBeCloseTo(100 * WARDEN.bodyMult);
    expect(resolveHit(life, 'limb', 100).applied).toBeCloseTo(100 * WARDEN.limbMult);
    expect(life.helmetHp).toBe(WARDEN.helmetHp);
    resolveHit(life, 'head', WARDEN.helmetHp);
    const hp = life.hp;
    expect(resolveHit(life, 'body', 100).applied).toBeCloseTo(100 * WARDEN.bodyMult);
    expect(life.hp).toBeCloseTo(hp - 100 * WARDEN.bodyMult);
  });

  it('con el casco intacto es imposible matar al Warden por la cabeza', () => {
    const life = createLife('warden', 4);
    for (let i = 0; i < 3; i++) {
      const r = resolveHit(life, 'head', 20);
      expect(r.killed).toBe(false);
    }
    expect(life.hp).toBe(WARDEN.hp);
  });

  it('muerte del Warden por headshot tras romper el casco', () => {
    const life = createLife('warden', 4);
    resolveHit(life, 'head', WARDEN.helmetHp);
    life.hp = 30;
    const r = resolveHit(life, 'head', 20); // 20 × 3.5 = 70 ≥ 30
    expect(r.killed).toBe(true);
    expect(r.headshotKill).toBe(true);
    expect(r.applied).toBe(30);
  });

  it('muerte del Warden por el cuerpo no es headshot', () => {
    const life = createLife('warden', 4);
    life.hp = 5;
    const r = resolveHit(life, 'body', 1000);
    expect(r.killed).toBe(true);
    expect(r.headshotKill).toBe(false);
  });

  it('zoneMultiplier refleja el estado del casco', () => {
    expect(zoneMultiplier('warden', 'head', false)).toBe(WARDEN.helmetDamageMult);
    expect(zoneMultiplier('warden', 'head', true)).toBe(WARDEN.headMultAfterHelmet);
    expect(zoneMultiplier('warden', 'body')).toBe(WARDEN.bodyMult);
    expect(zoneMultiplier('walker', 'limb')).toBe(ENEMIES.walker.limbMult);
  });
});

describe('aturdimiento, empuje y explosiones', () => {
  it('el Warden solo se aturde al romperse el casco', () => {
    const rng = createRng(3);
    const life = createLife('warden', 4);
    const hit = resolveHit(life, 'body', 100);
    expect(rollStagger('warden', hit, rng)).toBe(0);
    const brk = resolveHit(life, 'head', WARDEN.helmetHp);
    expect(rollStagger('warden', brk, rng)).toBe(WARDEN.helmetBreakStaggerS);
  });

  it('los infectados se aturden con la probabilidad configurada (determinista por semilla)', () => {
    const hit = createHitResult();
    let staggered = 0;
    const rng = createRng(99);
    for (let i = 0; i < 1000; i++) if (rollStagger('walker', hit, rng) > 0) staggered++;
    expect(staggered / 1000).toBeGreaterThan(ENEMIES.walker.staggerChance - 0.08);
    expect(staggered / 1000).toBeLessThan(ENEMIES.walker.staggerChance + 0.08);
    const a = createRng(5);
    const b = createRng(5);
    expect(rollStagger('runner', hit, a)).toBe(rollStagger('runner', hit, b));
  });

  it('un impacto mortal no aturde', () => {
    const life = createLife('walker', 1);
    const hit = resolveHit(life, 'head', 500);
    expect(rollStagger('walker', hit, () => 0)).toBe(0);
  });

  it('el empuje crece con el daño, el bruto pesa y el Warden no se mueve', () => {
    expect(knockbackSpeed('walker', 50, 100)).toBeGreaterThan(knockbackSpeed('walker', 5, 100));
    expect(knockbackSpeed('brute', 50, 100)).toBeLessThan(knockbackSpeed('walker', 50, 100));
    expect(knockbackSpeed('warden', 50, 100)).toBe(0);
    expect(knockbackSpeed('walker', 5000, 100)).toBeLessThanOrEqual(4.2);
  });

  it('la explosión cae linealmente y es 0 fuera del radio', () => {
    expect(explosionDamage(280, 0.12, 0, 8)).toBeCloseTo(280);
    expect(explosionDamage(280, 0.12, 8, 8)).toBeCloseTo(280 * 0.12);
    expect(explosionDamage(280, 0.12, 4, 8)).toBeCloseTo(280 * 0.56);
    expect(explosionDamage(280, 0.12, 8.01, 8)).toBe(0);
    expect(explosionDamage(280, 0.12, 1, 0)).toBe(0);
  });
});

describe('director: mezcla de tipos', () => {
  const sample = (threat: number, n = 4000, seed = 1): Record<string, number> => {
    const rng = createRng(seed);
    const counts: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const t = pickSpawnType(rng, threat);
      counts[t] = (counts[t] ?? 0) + 1;
    }
    return counts;
  };

  it('threat 1 solo genera walker/runner (minThreat)', () => {
    const c = sample(1);
    expect(Object.keys(c).sort()).toEqual(['runner', 'walker']);
    expect(c.walker!).toBeGreaterThan(c.runner! * 5);
  });

  it('threat 2 añade brutos pero no escupidores; threat 3-4 los añaden', () => {
    expect(sample(2).spitter).toBeUndefined();
    expect(sample(2).brute).toBeGreaterThan(0);
    expect(sample(3).spitter).toBeGreaterThan(0);
    expect(sample(4).spitter!).toBeGreaterThan(sample(3).spitter!);
  });

  it('es determinista por semilla y respeta amenazas fuera de rango', () => {
    expect(sample(3, 500, 7)).toEqual(sample(3, 500, 7));
    expect(Object.keys(sample(0, 200)).every((k) => k === 'walker' || k === 'runner')).toBe(true);
    expect(Object.keys(sample(9, 400)).length).toBeGreaterThanOrEqual(3);
  });

  it('filterMix descarta tipos por minThreat y pesos no positivos', () => {
    const f = filterMix({ walker: 10, brute: 5, spitter: 5, runner: 0 }, 1);
    expect(f).toEqual({ walker: 10 });
    expect(pickFromMix(() => 0.5, { spitter: 10 }, 1)).toBe('walker'); // sin candidatos válidos
  });

  it('las mezclas de horda solo generan tipos válidos a su amenaza', () => {
    for (const id of ['relay', 'extraction'] as const) {
      const rng = createRng(21);
      for (let i = 0; i < 300; i++) {
        const t = pickFromMix(rng, HORDES[id].mix, HORDES[id].threat) as InfectedType;
        expect(ENEMIES[t].minThreat).toBeLessThanOrEqual(HORDES[id].threat);
      }
    }
    for (const t of [1, 2, 3, 4]) expect(Object.keys(SPAWN_MIX[t] ?? {}).length).toBeGreaterThan(0);
  });
});

describe('director: hordas', () => {
  it('interpola intervalo y tamaño con el progreso y lo acota a [0,1]', () => {
    const def = HORDES.relay;
    const start = hordeWave(def, 0);
    const end = hordeWave(def, 1);
    expect(start.intervalS).toBeCloseTo(def.waveIntervalS[0]);
    expect(start.size).toBe(def.waveSize[0]);
    expect(end.intervalS).toBeCloseTo(def.waveIntervalS[1]);
    expect(end.size).toBe(def.waveSize[1]);
    const mid = hordeWave(def, 0.5);
    expect(mid.intervalS).toBeLessThan(start.intervalS);
    expect(mid.intervalS).toBeGreaterThan(end.intervalS);
    expect(hordeWave(def, -3)).toEqual(start);
    expect(hordeWave(def, 42)).toEqual(end);
  });

  it('la cadencia solo se acelera y el tamaño solo crece', () => {
    for (const id of ['relay', 'extraction'] as const) {
      let prev = hordeWave(HORDES[id], 0);
      for (let p = 0.05; p <= 1.0001; p += 0.05) {
        const w = hordeWave(HORDES[id], p);
        expect(w.intervalS).toBeLessThanOrEqual(prev.intervalS + 1e-9);
        expect(w.size).toBeGreaterThanOrEqual(prev.size);
        prev = w;
      }
    }
  });

  it('el progreso de la horda del relé llega a 1 a los 55 s', () => {
    expect(hordeProgress(HORDES.relay, 0)).toBe(0);
    expect(hordeProgress(HORDES.relay, 27.5)).toBeCloseTo(0.5);
    expect(hordeProgress(HORDES.relay, 55)).toBe(1);
    expect(hordeProgress(HORDES.relay, 500)).toBe(1);
    expect(hordeProgress({ ...HORDES.relay, rampS: 0 }, 1)).toBe(1);
  });
});

describe('director: población ambiental', () => {
  const zero = { perimeter: 0, warehouses: 0, refinery: 0, complex: 0 };

  it('el déficit es objetivo − vivos, nunca negativo', () => {
    const d = ambientDeficit({ perimeter: 4, warehouses: 20, refinery: 0, complex: 0 }, DIRECTOR.ambientTarget, 999);
    expect(d.perimeter).toBe(DIRECTOR.ambientTarget.perimeter - 4);
    expect(d.warehouses).toBe(0);
    expect(d.refinery).toBe(DIRECTOR.ambientTarget.refinery);
  });

  it('respeta el tope global maxAlive priorizando los mayores déficits', () => {
    const d = ambientDeficit(zero, DIRECTOR.ambientTarget, 30);
    const total = ZONES.reduce((s, z) => s + d[z], 0);
    expect(total).toBe(30);
    expect(d.complex).toBe(DIRECTOR.ambientTarget.complex);
    expect(d.refinery).toBe(2);
  });

  it('descuenta los infectados no ambientales (totalAlive)', () => {
    const d = ambientDeficit(zero, DIRECTOR.ambientTarget, 48, 40);
    expect(ZONES.reduce((s, z) => s + d[z], 0)).toBe(8);
    const none = ambientDeficit(zero, DIRECTOR.ambientTarget, 48, 48);
    expect(ZONES.reduce((s, z) => s + none[z], 0)).toBe(0);
    const over = ambientDeficit(zero, DIRECTOR.ambientTarget, 48, 60);
    expect(ZONES.reduce((s, z) => s + over[z], 0)).toBe(0);
  });

  it('con la población completa no hay déficit', () => {
    const d = ambientDeficit({ ...DIRECTOR.ambientTarget }, DIRECTOR.ambientTarget, 999);
    expect(ZONES.every((z) => d[z] === 0)).toBe(true);
  });

  it('packSize respeta el rango, el presupuesto y la semilla', () => {
    const rng = createRng(4);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const n = packSize(rng, 99);
      expect(n).toBeGreaterThanOrEqual(DIRECTOR.packSize[0]);
      expect(n).toBeLessThanOrEqual(DIRECTOR.packSize[1]);
      seen.add(n);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
    expect(packSize(createRng(1), 2)).toBeLessThanOrEqual(2);
    expect(packSize(createRng(1), 0)).toBe(0);
    expect(packSize(createRng(8), 99)).toBe(packSize(createRng(8), 99));
  });
});

describe('director: refuerzos del Warden', () => {
  it('invoca una vez por umbral cruzado', () => {
    expect(summonsDue(1, 0)).toBe(0);
    expect(summonsDue(0.67, 0)).toBe(0);
    expect(summonsDue(0.66, 0)).toBe(1);
    expect(summonsDue(0.5, 1)).toBe(0);
    expect(summonsDue(0.33, 1)).toBe(1);
    expect(summonsDue(0.05, 2)).toBe(0);
  });

  it('si baja de golpe de vida cruza varios umbrales a la vez', () => {
    expect(summonsDue(0.2, 0)).toBe(2);
    expect(summonsDue(0, 0)).toBe(2);
  });

  it('nunca es negativo aunque ya se hayan invocado de más', () => {
    expect(summonsDue(0.9, 5)).toBe(0);
  });
});

describe('director: geometría de spawn', () => {
  it('ringPoint queda dentro del anillo y es determinista', () => {
    const rng = createRng(2);
    for (let i = 0; i < 500; i++) {
      const p = ringPoint(rng, 10, -20, 38, 62);
      const d = Math.hypot(p.x - 10, p.z + 20);
      expect(d).toBeGreaterThanOrEqual(38 - 1e-9);
      expect(d).toBeLessThanOrEqual(62 + 1e-9);
    }
    expect(ringPoint(createRng(3), 0, 0, 5, 9)).toEqual(ringPoint(createRng(3), 0, 0, 5, 9));
  });

  it('inViewCone usa el yaw del jugador (0 mira al norte, -Z)', () => {
    expect(inViewCone(0, 0, 0, 0, -30, 60)).toBe(true);
    expect(inViewCone(0, 0, 0, 0, 30, 60)).toBe(false);
    expect(inViewCone(0, 0, Math.PI, 0, 30, 60)).toBe(true);
    expect(inViewCone(0, 0, 0, 30, -1, 60)).toBe(false);
    expect(inViewCone(0, 0, 0, 0, 0, 10)).toBe(true);
  });

  it('simState distingue activo, dormido y reciclable con histéresis', () => {
    expect(simState(10)).toBe('active');
    expect(simState(DIRECTOR.simRadius)).toBe('active');
    expect(simState(DIRECTOR.simRadius + 5)).toBe('dormant');
    expect(simState(DIRECTOR.simRadius + 40)).toBe('recycle');
  });
});
