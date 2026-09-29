import { describe, expect, it } from 'vitest';
import { CHARACTER } from '../src/config';
import { NAME_RULE, charCount, isStockName, liveSanitizeName, nameFeedback } from '../src/ui/naming';

describe('liveSanitizeName', () => {
  it('conserva espacios intermedios y finales mientras se escribe', () => {
    expect(liveSanitizeName('Ana ')).toBe('Ana ');
    expect(liveSanitizeName('Ana  María')).toBe('Ana María');
    expect(liveSanitizeName('   Ana')).toBe('Ana');
  });
  it('quita símbolos peligrosos y de control', () => {
    expect(liveSanitizeName('<b>Rubén</b>')).toBe('bRubénb');
    expect(liveSanitizeName('a\u0000b\nc')).toBe('abc');
    expect(liveSanitizeName("O'Neil-Jr_2.0")).toBe("O'Neil-Jr_2.0");
  });
  it('recorta al máximo por caracteres Unicode', () => {
    expect(charCount(liveSanitizeName('x'.repeat(50)))).toBe(CHARACTER.nameMaxLen);
    expect(charCount(liveSanitizeName('𝒜'.repeat(30)))).toBeLessThanOrEqual(CHARACTER.nameMaxLen);
  });
});

describe('nameFeedback', () => {
  it('nombre válido: ok, sin avisos y con la regla como pista', () => {
    const f = nameFeedback('Lucía');
    expect(f).toMatchObject({ ok: true, committed: 'Lucía', clean: 'Lucía', count: 5, invalidRemoved: false, truncated: false, tone: 'hint' });
    expect(f.message).toBe(NAME_RULE);
  });
  it('vacío o sólo espacios: error', () => {
    for (const raw of ['', '   ']) {
      const f = nameFeedback(raw);
      expect(f.ok).toBe(false);
      expect(f.committed).toBe('');
      expect(f.tone).toBe('error');
      expect(f.message).toMatch(/vacío/);
    }
  });
  it('sólo símbolos inválidos: error distinto al de vacío', () => {
    const f = nameFeedback('<>&%');
    expect(f.ok).toBe(false);
    expect(f.invalidRemoved).toBe(true);
    expect(f.message).toMatch(/ningún carácter válido/);
  });
  it('símbolos mezclados: aviso pero válido', () => {
    const f = nameFeedback('Ru<b>én');
    expect(f.ok).toBe(true);
    expect(f.invalidRemoved).toBe(true);
    expect(f.tone).toBe('warn');
    expect(f.committed).toBe('Rubén');
  });
  it('demasiado largo: recorta y avisa', () => {
    const f = nameFeedback('A'.repeat(30));
    expect(f.ok).toBe(true);
    expect(f.truncated).toBe(true);
    expect(f.count).toBe(CHARACTER.nameMaxLen);
    expect(f.message).toContain(String(CHARACTER.nameMaxLen));
  });
  it('la regla menciona el rango y los caracteres permitidos', () => {
    expect(NAME_RULE).toBe("1-16 caracteres; letras, números, espacios y - _ . '");
  });
});

describe('isStockName', () => {
  it('reconoce nombres por defecto y aleatorios, no los personalizados', () => {
    expect(isStockName('Marcos')).toBe(true);
    expect(isStockName('Lucía')).toBe(true);
    expect(isStockName('Nerea')).toBe(true);
    expect(isStockName('Capitana Núñez')).toBe(false);
    expect(isStockName('')).toBe(false);
  });
});
