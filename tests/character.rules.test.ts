import { describe, expect, it } from 'vitest';
import { CHARACTER } from '../src/config';
import { EventBus } from '../src/core/events';
import { updateProfile } from '../src/core/profile';
import { createRunState, resetRunState } from '../src/core/state';
import { createRng } from '../src/core/util';
import {
  applyPreset, clampAppearance, defaultProfile, matchingPreset, normalizeProfile, parseProfile, randomProfile,
  resolveLook, sanitizeName, serializeProfile, withGender,
} from '../src/rules/character';

describe('sanitizeName', () => {
  it('recorta, colapsa espacios y respeta el máximo', () => {
    expect(sanitizeName('  Ana   María  ')).toBe('Ana María');
    expect(sanitizeName('a'.repeat(40))).toHaveLength(CHARACTER.nameMaxLen);
  });
  it('elimina HTML, control y símbolos peligrosos', () => {
    expect(sanitizeName('<img src=x onerror=alert(1)>')).toBe('img srcx onerror'); // sin <>=() y recortado a 16
    expect(sanitizeName('Ru\u0000bén\n\t')).toBe('Rubén');
    expect(sanitizeName('"; DROP TABLE--')).toBe('DROP TABLE--');
    expect(sanitizeName('<script>')).toBe('script');
  });
  it('acepta acentos, ñ y dígitos; rechaza vacío y no-cadenas', () => {
    expect(sanitizeName('Núñez_07')).toBe('Núñez_07');
    expect(sanitizeName('   ')).toBe('');
    expect(sanitizeName('<>&')).toBe('');
    expect(sanitizeName(42)).toBe('');
    expect(sanitizeName(null)).toBe('');
  });
  it('no parte pares sustitutos al recortar', () => {
    const s = sanitizeName('𝒜'.repeat(30));
    expect(Array.from(s).every((c) => c === '𝒜' || /\p{L}/u.test(c))).toBe(true);
  });
});

describe('apariencia y perfil', () => {
  it('clampAppearance acota índices y el pelo depende del género', () => {
    const a = clampAppearance('male', { skin: 99, hairStyle: -3, hairColor: NaN, outfit: 1.9, accessory: 1e9 });
    expect(a).toEqual({ skin: CHARACTER.skinTones.length - 1, hairStyle: 0, hairColor: 0, outfit: 1, accessory: CHARACTER.accessories.length - 1 });
  });
  it('normalizeProfile repara datos corruptos', () => {
    const p = normalizeProfile({ name: 5, gender: 'x', appearance: 'no' });
    expect(p.gender).toBe('male');
    expect(p.name.length).toBeGreaterThan(0);
    expect(normalizeProfile(undefined)).toEqual(defaultProfile());
  });
  it('parseProfile tolera JSON inválido y serializeProfile es estable', () => {
    expect(parseProfile('{no json')).toEqual(defaultProfile());
    expect(parseProfile(null)).toEqual(defaultProfile());
    const f = { ...defaultProfile('female'), name: 'Noa' };
    expect(parseProfile(serializeProfile(f))).toEqual(f);
  });
  it('withGender conserva lo compartido y cambia el nombre sólo si era el de por defecto', () => {
    const m = { ...defaultProfile('male'), appearance: { skin: 4, hairStyle: 5, hairColor: 6, outfit: 3, accessory: 2 } };
    const f = withGender(m, 'female');
    expect(f.gender).toBe('female');
    expect(f.name).toBe(CHARACTER.defaultName.female);
    expect(f.appearance).toMatchObject({ skin: 4, hairColor: 6, outfit: 3, accessory: 2 });
    expect(f.appearance.hairStyle).toBeLessThan(CHARACTER.hairStyles.female.length);
    expect(withGender({ ...m, name: 'Rex' }, 'female').name).toBe('Rex');
  });
  it('cada preset es válido y reconocible', () => {
    for (const g of ['male', 'female'] as const) {
      CHARACTER.presets[g].forEach((pr, i) => {
        expect(clampAppearance(g, pr.appearance)).toEqual(pr.appearance);
        const p = applyPreset(defaultProfile(g), i);
        expect(matchingPreset(p)).toBe(i);
      });
    }
    expect(matchingPreset({ ...defaultProfile(), appearance: { skin: 5, hairStyle: 5, hairColor: 5, outfit: 5, accessory: 5 } })).toBe(-1);
  });
  it('hay apariencias distintas: presets únicos por género', () => {
    for (const g of ['male', 'female'] as const) {
      const keys = CHARACTER.presets[g].map((p) => JSON.stringify(p.appearance));
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys.length).toBeGreaterThanOrEqual(6);
    }
  });
  it('randomProfile es determinista con semilla y siempre válido', () => {
    expect(randomProfile(createRng(3))).toEqual(randomProfile(createRng(3)));
    const rng = createRng(11);
    for (let i = 0; i < 200; i++) {
      const p = randomProfile(rng);
      expect(normalizeProfile(p)).toEqual(p);
    }
  });
  it('resolveLook devuelve colores y ids de las tablas', () => {
    const look = resolveLook(applyPreset(defaultProfile('female'), 3));
    expect(look.gender).toBe('female');
    expect(look.outfit).toBe('sanitario');
    expect(look.accessory).toBe('headset');
    expect(look.hairStyle).toBe('media');
    expect(look.skin).toBe(CHARACTER.skinTones[0]!.color);
  });
});

describe('updateProfile', () => {
  const setup = () => ({ state: createRunState(), bus: new EventBus() });
  it('aplica, sanea y emite un único evento; conserva la identidad', () => {
    const ctx = setup();
    const ref = ctx.state.profile;
    const events: unknown[] = [];
    ctx.bus.on('profile:changed', (e) => events.push(e));
    updateProfile(ctx, { name: '  <b>Luna</b> ' });
    expect(ctx.state.profile).toBe(ref);
    expect(ctx.state.profile.name).toBe('bLunab');
    expect(events).toEqual([{ nameChanged: true, genderChanged: false, appearanceChanged: false }]);
  });
  it('sin cambios reales no emite; nombre vacío conserva el actual', () => {
    const ctx = setup();
    let n = 0;
    ctx.bus.on('profile:changed', () => n++);
    updateProfile(ctx, { name: ctx.state.profile.name });
    updateProfile(ctx, { name: '   ' });
    updateProfile(ctx, { name: '<>' });
    expect(n).toBe(0);
    expect(ctx.state.profile.name).toBe(CHARACTER.defaultName.male);
  });
  it('cambiar de género reajusta el pelo y marca el cambio', () => {
    const ctx = setup();
    const events: { genderChanged: boolean }[] = [];
    ctx.bus.on('profile:changed', (e) => events.push(e));
    updateProfile(ctx, { gender: 'female', appearance: { hairStyle: 99 } });
    expect(ctx.state.profile.gender).toBe('female');
    expect(ctx.state.profile.appearance.hairStyle).toBe(CHARACTER.hairStyles.female.length - 1);
    expect(events[0]?.genderChanged).toBe(true);
  });
  it('resetRunState conserva el perfil', () => {
    const ctx = setup();
    updateProfile(ctx, { name: 'Zoe', gender: 'female' });
    const ref = ctx.state.profile;
    resetRunState(ctx.state, 'playing');
    expect(ctx.state.profile).toBe(ref);
    expect(ctx.state.profile.name).toBe('Zoe');
  });
});
