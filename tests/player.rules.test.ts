import { describe, expect, it } from 'vitest';
import { CONTAMINATION, GRENADE, PLAYER, WEAPON_HANDLING, WEAPONS } from '../src/config';
import type { WeaponDef } from '../src/config';
import { createRng } from '../src/core/util';
import type { WeaponId } from '../src/core/types';
import {
  adsFov, ammoToLoad, approachLinear, baseSpreadDeg, currentSpreadDeg, damageAfterFalloff, easeAds, fireIntervalS,
  generatePellets, isAutomatic, planReload, recoverSpread, spread01, spreadAfterShot, spreadMultiplier,
  spreadRecoveryDelayS, transferAmmo, transferShell,
} from '../src/rules/weapons';
import type { SpreadContext } from '../src/rules/weapons';
import {
  applyDamageToPlayer, applyHeal, applyPlate, armorProtectsFrom, canUsePlate, explosionDamage, fallDamage, splitDamage,
} from '../src/rules/combat';

const ids = Object.keys(WEAPONS) as WeaponId[];
const still: SpreadContext = { adsT: 0, crouched: false, speed01: 0, airborne: false, sprinting: false, shotSpread: 0 };

describe('config de armas', () => {
  it('las 7 armas tienen datos coherentes', () => {
    expect(ids).toHaveLength(7);
    for (const id of ids) {
      const d = WEAPONS[id];
      expect(d.id).toBe(id);
      expect(d.rpm).toBeGreaterThan(0);
      expect(d.magSize).toBeGreaterThan(0);
      expect(d.falloffEnd).toBeGreaterThan(d.falloffStart);
      expect(d.minDamageMult).toBeGreaterThan(0);
      expect(d.minDamageMult).toBeLessThanOrEqual(1);
      expect(d.spreadMax).toBeGreaterThanOrEqual(d.spreadAds);
      expect(d.adsFovMult).toBeGreaterThan(0);
      expect(d.adsFovMult).toBeLessThanOrEqual(1);
    }
  });
});

describe('cadencia', () => {
  it('convierte rpm en intervalo', () => {
    expect(fireIntervalS({ rpm: 600 })).toBeCloseTo(0.1, 10);
    expect(fireIntervalS(WEAPONS.smg)).toBeCloseTo(60 / 860, 10);
    expect(fireIntervalS({ rpm: 0 })).toBe(Infinity);
  });
  it('sólo el modo auto es automático', () => {
    expect(isAutomatic(WEAPONS.carbine)).toBe(true);
    expect(isAutomatic(WEAPONS.pistol)).toBe(false);
    expect(isAutomatic(WEAPONS.shotgun)).toBe(false);
  });
});

describe('dispersión', () => {
  it('interpola cadera → ADS', () => {
    const d = WEAPONS.carbine;
    expect(baseSpreadDeg(d, 0)).toBe(d.spreadHip);
    expect(baseSpreadDeg(d, 1)).toBe(d.spreadAds);
    expect(baseSpreadDeg(d, 0.5)).toBeCloseTo((d.spreadHip + d.spreadAds) / 2, 10);
    expect(baseSpreadDeg(d, 7)).toBe(d.spreadAds);
    expect(baseSpreadDeg(d, -3)).toBe(d.spreadHip);
  });
  it('agacharse y estar quieto reducen; correr y saltar aumentan', () => {
    const base = { crouched: false, speed01: 1, airborne: false, sprinting: false };
    const walking = spreadMultiplier(base);
    expect(spreadMultiplier({ ...base, speed01: 0 })).toBeLessThan(1);
    expect(spreadMultiplier({ ...base, speed01: 0, crouched: true })).toBeLessThan(spreadMultiplier({ ...base, speed01: 0 }));
    expect(walking).toBeGreaterThan(1);
    expect(spreadMultiplier({ ...base, sprinting: true })).toBeGreaterThan(walking);
    expect(spreadMultiplier({ ...base, airborne: true })).toBeGreaterThan(walking);
  });
  it('la dispersión total respeta el máximo del arma', () => {
    for (const id of ids) {
      const d = WEAPONS[id];
      const worst = currentSpreadDeg(d, { adsT: 0, crouched: false, speed01: 1, airborne: true, sprinting: true, shotSpread: 99 });
      expect(worst).toBeLessThanOrEqual(Math.max(d.spreadMax, d.spreadHip) + 1e-9);
      expect(currentSpreadDeg(d, still)).toBeGreaterThan(0);
    }
  });
  it('spread01 está en 0..1', () => {
    const d = WEAPONS.pistol;
    expect(spread01(d, 0)).toBe(0);
    expect(spread01(d, d.spreadMax)).toBe(1);
    expect(spread01(d, d.spreadMax * 3)).toBe(1);
    expect(spread01({ spreadMax: 0 }, 2)).toBe(0);
  });
  it('acumula por disparo, menos al apuntar, y se detiene en el techo', () => {
    const d = WEAPONS.carbine;
    let hip = 0;
    let ads = 0;
    for (let i = 0; i < 3; i++) {
      hip = spreadAfterShot(hip, d, 0);
      ads = spreadAfterShot(ads, d, 1);
    }
    expect(hip).toBeCloseTo(d.spreadPerShot * 3, 10);
    expect(ads).toBeCloseTo(d.spreadPerShot * WEAPON_HANDLING.adsShotSpreadMult * 3, 10);
    for (let i = 0; i < 200; i++) hip = spreadAfterShot(hip, d, 0);
    expect(baseSpreadDeg(d, 0) + hip).toBeLessThanOrEqual(d.spreadMax + 1e-9);
  });
  it('la escopeta no acumula dispersión', () => {
    expect(spreadAfterShot(0, WEAPONS.shotgun, 0)).toBe(0);
    expect(spreadAfterShot(0, WEAPONS.shotgun, 1)).toBe(0);
  });
  it('se recupera sólo tras el retardo y nunca baja de 0', () => {
    const d = WEAPONS.assault;
    const delay = spreadRecoveryDelayS(d);
    expect(delay).toBeGreaterThanOrEqual(WEAPON_HANDLING.spreadRecoveryMinDelayS);
    expect(recoverSpread(2, d, delay * 0.5, 0.1)).toBe(2);
    expect(recoverSpread(2, d, delay + 0.01, 0.1)).toBeCloseTo(2 - d.spreadRecoverPerS * 0.1, 10);
    expect(recoverSpread(0.1, d, 5, 1)).toBe(0);
    expect(recoverSpread(0, d, 5, 1)).toBe(0);
  });
});

describe('caída de daño', () => {
  const d = WEAPONS.carbine;
  it('daño pleno hasta falloffStart', () => {
    expect(damageAfterFalloff(d, 0)).toBe(d.damage);
    expect(damageAfterFalloff(d, d.falloffStart)).toBe(d.damage);
    expect(damageAfterFalloff(d, -5)).toBe(d.damage);
  });
  it('mínimo desde falloffEnd', () => {
    expect(damageAfterFalloff(d, d.falloffEnd)).toBeCloseTo(d.damage * d.minDamageMult, 10);
    expect(damageAfterFalloff(d, d.falloffEnd * 10)).toBeCloseTo(d.damage * d.minDamageMult, 10);
  });
  it('lineal entre medias y monótono decreciente', () => {
    const mid = (d.falloffStart + d.falloffEnd) / 2;
    expect(damageAfterFalloff(d, mid)).toBeCloseTo((d.damage + d.damage * d.minDamageMult) / 2, 10);
    let prev = Infinity;
    for (let x = 0; x <= 120; x += 3) {
      const v = damageAfterFalloff(d, x);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
  });
  it('la escopeta cae muy rápido; el DMR casi nada a 50 m', () => {
    expect(damageAfterFalloff(WEAPONS.shotgun, 20)).toBeLessThan(WEAPONS.shotgun.damage * 0.4);
    expect(damageAfterFalloff(WEAPONS.dmr, 50)).toBe(WEAPONS.dmr.damage);
  });
  it('rango degenerado (end <= start) devuelve el mínimo pasado el inicio', () => {
    const odd = { damage: 10, falloffStart: 5, falloffEnd: 5, minDamageMult: 0.5 };
    expect(damageAfterFalloff(odd, 5)).toBe(10);
    expect(damageAfterFalloff(odd, 6)).toBe(5);
  });
});

describe('plan de recarga y munición', () => {
  it('sin nada que recargar: cargador lleno o reserva vacía', () => {
    for (const id of ids) {
      const d = WEAPONS[id];
      expect(planReload(d, d.magSize, 50).kind).toBe('none');
      expect(planReload(d, 0, 0).kind).toBe('none');
      expect(planReload(d, 1, 0).kind).toBe('none');
      expect(planReload(d, 1, 0).durationS).toBe(0);
    }
  });
  it('recarga táctica si queda bala y el arma la define', () => {
    const d = WEAPONS.carbine;
    const tac = planReload(d, 5, 100);
    const empty = planReload(d, 0, 100);
    expect(tac.kind).toBe('magazine');
    expect(tac.tactical).toBe(true);
    expect(tac.durationS).toBe(d.reloadTacticalS);
    expect(empty.tactical).toBe(false);
    expect(empty.durationS).toBe(d.reloadS);
    expect(tac.durationS).toBeLessThan(empty.durationS);
  });
  it('el revólver no tiene táctica: siempre reloadS', () => {
    const d = WEAPONS.revolver;
    expect(planReload(d, 3, 20).durationS).toBe(d.reloadS);
    expect(planReload(d, 3, 20).tactical).toBe(false);
  });
  it('escopeta: cartucho a cartucho, limitado por hueco y reserva', () => {
    const d = WEAPONS.shotgun;
    const full = planReload(d, 0, 42);
    expect(full.kind).toBe('shells');
    expect(full.shells).toBe(d.magSize);
    expect(full.durationS).toBeCloseTo(d.reloadS + (d.magSize - 1) * (d.reloadPerShellS as number), 10);
    const one = planReload(d, d.magSize - 1, 42);
    expect(one.shells).toBe(1);
    expect(one.durationS).toBeCloseTo(d.reloadS, 10);
    const partial = planReload(d, 0, 2);
    expect(partial.shells).toBe(2);
    expect(partial.durationS).toBeCloseTo(d.reloadS + (d.reloadPerShellS as number), 10);
  });
  it('transferAmmo: cargador vacío, parcial, reserva insuficiente y exacta', () => {
    expect(transferAmmo(0, 100, 25)).toEqual({ mag: 25, reserve: 75 });
    expect(transferAmmo(10, 100, 25)).toEqual({ mag: 25, reserve: 85 });
    expect(transferAmmo(0, 7, 25)).toEqual({ mag: 7, reserve: 0 });
    expect(transferAmmo(20, 5, 25)).toEqual({ mag: 25, reserve: 0 });
    expect(transferAmmo(25, 50, 25)).toEqual({ mag: 25, reserve: 50 });
    expect(transferAmmo(0, 0, 25)).toEqual({ mag: 0, reserve: 0 });
  });
  it('transferAmmo conserva la munición total', () => {
    for (let mag = 0; mag <= 25; mag += 5) {
      for (const reserve of [0, 1, 12, 40, 200]) {
        const r = transferAmmo(mag, reserve, 25);
        expect(r.mag + r.reserve).toBe(mag + reserve);
        expect(r.mag).toBeLessThanOrEqual(25);
      }
    }
  });
  it('transferAmmo reutiliza el objeto de salida', () => {
    const out = { mag: 0, reserve: 0 };
    const r = transferAmmo(3, 10, 6, out);
    expect(r).toBe(out);
    expect(out).toEqual({ mag: 6, reserve: 7 });
  });
  it('transferShell mueve de uno en uno', () => {
    expect(transferShell(0, 10, 6)).toEqual({ mag: 1, reserve: 9 });
    expect(transferShell(6, 10, 6)).toEqual({ mag: 6, reserve: 10 });
    expect(transferShell(2, 0, 6)).toEqual({ mag: 2, reserve: 0 });
  });
  it('ammoToLoad nunca es negativo', () => {
    expect(ammoToLoad(30, 10, 25)).toBe(0);
    expect(ammoToLoad(0, -5, 25)).toBe(0);
  });
});

describe('perdigones y cono', () => {
  const buf = new Float64Array(64);
  it('es determinista dado el mismo rng', () => {
    const a = new Float64Array(20);
    const b = new Float64Array(20);
    generatePellets(9, 7.5, createRng(42), a);
    generatePellets(9, 7.5, createRng(42), b);
    expect(Array.from(a)).toEqual(Array.from(b));
    generatePellets(9, 7.5, createRng(43), b);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
  it('todos los perdigones caen dentro del cono', () => {
    const rng = createRng(7);
    for (const spread of [0.12, 2.4, 7.5]) {
      const radius = Math.tan((spread * Math.PI) / 360);
      for (let k = 0; k < 200; k++) {
        const n = generatePellets(9, spread, rng, buf);
        expect(n).toBe(9);
        for (let i = 0; i < n; i++) expect(Math.hypot(buf[i * 2]!, buf[i * 2 + 1]!)).toBeLessThanOrEqual(radius + 1e-12);
      }
    }
  });
  it('un solo proyectil se reparte de forma uniforme por el disco', () => {
    const rng = createRng(11);
    const spread = 6;
    const radius = Math.tan((spread * Math.PI) / 360);
    let inner = 0;
    const N = 4000;
    for (let k = 0; k < N; k++) {
      generatePellets(1, spread, rng, buf);
      const r = Math.hypot(buf[0]!, buf[1]!);
      expect(r).toBeLessThanOrEqual(radius + 1e-12);
      if (r < radius * 0.5) inner++;
    }
    // Área del disco interior = 25 % del total.
    expect(inner / N).toBeGreaterThan(0.21);
    expect(inner / N).toBeLessThan(0.29);
  });
  it('los perdigones estratificados cubren el cono (no se apelotonan)', () => {
    const rng = createRng(5);
    const radius = Math.tan((7.5 * Math.PI) / 360);
    let maxR = 0;
    for (let k = 0; k < 100; k++) {
      generatePellets(9, 7.5, rng, buf);
      for (let i = 0; i < 9; i++) maxR = Math.max(maxR, Math.hypot(buf[i * 2]!, buf[i * 2 + 1]!));
    }
    expect(maxR).toBeGreaterThan(radius * 0.85);
  });
  it('dispersión 0 → todos al centro; count 0 → nada; negativos se tratan como 0', () => {
    expect(generatePellets(3, 0, createRng(1), buf)).toBe(3);
    for (let i = 0; i < 6; i++) expect(buf[i]).toBe(0);
    expect(generatePellets(0, 5, createRng(1), buf)).toBe(0);
    expect(generatePellets(-2, 5, createRng(1), buf)).toBe(0);
    expect(generatePellets(2, -5, createRng(1), buf)).toBe(2);
    expect(buf[0]).toBe(0);
  });
  it('funciona con arrays normales', () => {
    const out: number[] = new Array<number>(4).fill(0);
    expect(generatePellets(2, 3, createRng(9), out)).toBe(2);
    expect(out.some((v) => v !== 0)).toBe(true);
  });
});

describe('apuntado y FOV', () => {
  it('approachLinear recorre 0..1 en durationS y no se pasa', () => {
    let t = 0;
    for (let i = 0; i < 10; i++) t = approachLinear(t, 1, 0.01, 0.1);
    expect(t).toBeCloseTo(1, 10);
    expect(approachLinear(0.995, 1, 0.5, 0.1)).toBe(1);
    expect(approachLinear(1, 0, 0.05, 0.1)).toBeCloseTo(0.5, 10);
    expect(approachLinear(0.2, 0, 1, 0.1)).toBe(0);
    expect(approachLinear(0, 1, 0.016, 0)).toBe(1);
  });
  it('easeAds está acotada y es monótona', () => {
    expect(easeAds(-1)).toBe(0);
    expect(easeAds(2)).toBe(1);
    expect(easeAds(0.5)).toBeCloseTo(0.5, 10);
  });
  it('adsFov: base en cadera, base × adsFovMult apuntando', () => {
    for (const id of ids) {
      const d = WEAPONS[id];
      expect(adsFov(PLAYER.fov, d, 0)).toBe(PLAYER.fov);
      expect(adsFov(PLAYER.fov, d, 1)).toBeCloseTo(PLAYER.fov * d.adsFovMult, 10);
    }
    expect(adsFov(PLAYER.fov, WEAPONS.dmr, 1)).toBeLessThan(adsFov(PLAYER.fov, WEAPONS.pistol, 1));
  });
});

describe('daño al jugador', () => {
  it('sin armadura todo va a la vida', () => {
    const p = { hp: 100, armor: 0 };
    const r = applyDamageToPlayer(p, 30, 'melee');
    expect(r).toEqual({ armorDamage: 0, hpDamage: 30 });
    expect(p).toEqual({ hp: 70, armor: 0 });
  });
  it('con armadura absorbe armorAbsorb del daño', () => {
    const p = { hp: 100, armor: 100 };
    const r = applyDamageToPlayer(p, 50, 'melee');
    expect(r.armorDamage).toBeCloseTo(50 * PLAYER.armorAbsorb, 10);
    expect(r.hpDamage).toBeCloseTo(50 * (1 - PLAYER.armorAbsorb), 10);
    expect(p.armor).toBeCloseTo(100 - 50 * PLAYER.armorAbsorb, 10);
    expect(p.hp).toBeCloseTo(100 - 50 * (1 - PLAYER.armorAbsorb), 10);
  });
  it('la armadura se agota a mitad de golpe: el resto pasa a la vida', () => {
    const p = { hp: 100, armor: 10 };
    const r = applyDamageToPlayer(p, 50, 'melee');
    expect(r.armorDamage).toBe(10);
    expect(r.hpDamage).toBe(40);
    expect(p).toEqual({ hp: 60, armor: 0 });
  });
  it('armorDamage + hpDamage === amount siempre', () => {
    for (const armor of [0, 5, 30, 100]) {
      for (const amount of [0.5, 1, 20, 99, 400]) {
        const r = splitDamage(armor, amount, 'slam');
        expect(r.armorDamage + r.hpDamage).toBeCloseTo(amount, 10);
        expect(r.armorDamage).toBeLessThanOrEqual(armor + 1e-12);
      }
    }
  });
  it('daño 0, negativo o no finito no hace nada', () => {
    for (const amount of [0, -10, NaN, Infinity]) {
      const p = { hp: 80, armor: 40 };
      const r = applyDamageToPlayer(p, amount, 'melee');
      expect(r).toEqual({ armorDamage: 0, hpDamage: 0 });
      expect(p).toEqual({ hp: 80, armor: 40 });
    }
  });
  it('la vida no baja de 0 (sobredaño)', () => {
    const p = { hp: 10, armor: 0 };
    const r = applyDamageToPlayer(p, 500, 'melee');
    expect(p.hp).toBe(0);
    expect(r.hpDamage).toBe(500);
  });
  it('la contaminación ignora el blindaje si CONTAMINATION.armorProtects es false', () => {
    expect(armorProtectsFrom('contamination')).toBe(CONTAMINATION.armorProtects);
    const p = { hp: 100, armor: 100 };
    const r = applyDamageToPlayer(p, 10, 'contamination');
    if (CONTAMINATION.armorProtects) expect(r.armorDamage).toBeGreaterThan(0);
    else {
      expect(r.armorDamage).toBe(0);
      expect(p).toEqual({ hp: 90, armor: 100 });
    }
  });
  it('la caída no pasa por el blindaje', () => {
    expect(armorProtectsFrom('fall')).toBe(false);
    const p = { hp: 100, armor: 100 };
    applyDamageToPlayer(p, 20, 'fall');
    expect(p).toEqual({ hp: 80, armor: 100 });
  });
  it('melee, spit, slam y explosion sí protegen', () => {
    for (const s of ['melee', 'spit', 'slam', 'explosion'] as const) expect(armorProtectsFrom(s)).toBe(true);
  });
  it('reutiliza el objeto de salida', () => {
    const out = { armorDamage: 0, hpDamage: 0 };
    const r = applyDamageToPlayer({ hp: 100, armor: 50 }, 10, 'melee', out);
    expect(r).toBe(out);
  });
});

describe('caída', () => {
  it('sin daño por debajo del umbral', () => {
    expect(fallDamage(0)).toBe(0);
    expect(fallDamage(PLAYER.fallDamageMinSpeed)).toBe(0);
    expect(fallDamage(-20)).toBe(0);
    expect(fallDamage(NaN)).toBe(0);
  });
  it('lineal por encima del umbral', () => {
    expect(fallDamage(PLAYER.fallDamageMinSpeed + 1)).toBeCloseTo(PLAYER.fallDamagePerMps, 10);
    expect(fallDamage(PLAYER.fallDamageMinSpeed + 5)).toBeCloseTo(PLAYER.fallDamagePerMps * 5, 10);
  });
  it('un salto normal no hace daño', () => {
    const jumpImpact = PLAYER.jumpSpeed; // mismo nivel: cae con la velocidad de salida
    expect(fallDamage(jumpImpact)).toBe(0);
  });
});

describe('explosión', () => {
  const { radius, damage, minMult, selfMult } = GRENADE;
  it('máximo en el centro y mínimo en el borde', () => {
    expect(explosionDamage(0, radius, damage, minMult)).toBe(damage);
    expect(explosionDamage(radius, radius, damage, minMult)).toBeCloseTo(damage * minMult, 10);
  });
  it('nada fuera del radio', () => {
    expect(explosionDamage(radius + 0.01, radius, damage, minMult)).toBe(0);
    expect(explosionDamage(500, radius, damage, minMult)).toBe(0);
    expect(explosionDamage(NaN, radius, damage, minMult)).toBe(0);
    expect(explosionDamage(1, 0, damage, minMult)).toBe(0);
  });
  it('caída lineal y monótona', () => {
    expect(explosionDamage(radius / 2, radius, damage, minMult)).toBeCloseTo((damage + damage * minMult) / 2, 10);
    let prev = Infinity;
    for (let d = 0; d <= radius; d += 0.5) {
      const v = explosionDamage(d, radius, damage, minMult);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
  it('selfMult escala el autodaño', () => {
    expect(explosionDamage(2, radius, damage, minMult, selfMult)).toBeCloseTo(explosionDamage(2, radius, damage, minMult) * selfMult, 10);
  });
  it('distancia negativa se trata como el centro', () => {
    expect(explosionDamage(-1, radius, damage, minMult)).toBe(damage);
  });
});

describe('placas y curación', () => {
  it('canUsePlate: necesita placas y hueco de blindaje', () => {
    expect(canUsePlate(1, 0, 100)).toBe(true);
    expect(canUsePlate(0, 0, 100)).toBe(false);
    expect(canUsePlate(2, 100, 100)).toBe(false);
    expect(canUsePlate(2, 99, 100)).toBe(true);
  });
  it('applyPlate suma armorPerPlate hasta el máximo', () => {
    expect(applyPlate(0, 100)).toBe(PLAYER.armorPerPlate);
    expect(applyPlate(80, 100)).toBe(100);
    expect(applyPlate(100, 100)).toBe(100);
    expect(applyPlate(-5, 100)).toBe(PLAYER.armorPerPlate);
    expect(applyPlate(10, 100, 30)).toBe(40);
  });
  it('applyHeal: limitada al máximo y sin curar al tope', () => {
    expect(applyHeal(50, 100, 30)).toEqual({ hp: 80, healed: 30 });
    expect(applyHeal(90, 100, 30)).toEqual({ hp: 100, healed: 10 });
    expect(applyHeal(100, 100, 30)).toEqual({ hp: 100, healed: 0 });
    expect(applyHeal(50, 100, 0)).toEqual({ hp: 50, healed: 0 });
    expect(applyHeal(50, 100, -10)).toEqual({ hp: 50, healed: 0 });
  });
});

describe('coherencia entre armas', () => {
  it('cada arma mata a un infectado base en un número razonable de disparos a quemarropa', () => {
    for (const id of ids) {
      const d: WeaponDef = WEAPONS[id];
      const perShot = d.damage * d.pellets;
      expect(perShot).toBeGreaterThan(10);
      expect(Math.ceil(100 / perShot)).toBeLessThanOrEqual(6);
    }
  });
});
