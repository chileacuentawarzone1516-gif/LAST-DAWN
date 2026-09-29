/**
 * Validación y feedback del nombre del operativo (puro, sin DOM). El saneado definitivo es
 * `sanitizeName` (rules/character); aquí se añade la variante «en vivo» que no recorta espacios
 * finales (para poder escribir «Ana María») y los mensajes en español.
 */
import { CHARACTER } from '../config';
import { sanitizeName } from '../rules/character';

/** Regla mostrada al usuario. */
export const NAME_RULE = `${CHARACTER.nameMinLen}-${CHARACTER.nameMaxLen} caracteres; letras, números, espacios y - _ . '`;

const INVALID = /[^\p{L}\p{N} _.'-]/gu;

/** Cuenta caracteres Unicode reales (no unidades UTF-16). */
export const charCount = (s: string): number => Array.from(s).length;

/** Saneado mientras se escribe: quita símbolos no permitidos, colapsa espacios y recorta a la longitud máxima. */
export function liveSanitizeName(raw: string): string {
  const s = raw.normalize('NFC').replace(INVALID, '').replace(/^ +/, '').replace(/ {2,}/g, ' ');
  return Array.from(s).slice(0, CHARACTER.nameMaxLen).join('');
}

export type NameTone = 'hint' | 'ok' | 'warn' | 'error';

export interface NameFeedback {
  /** Texto para mostrar en el campo (saneado en vivo). */
  clean: string;
  /** Nombre definitivo (sanitizeName) o '' si no es válido. */
  committed: string;
  ok: boolean;
  /** Caracteres del texto mostrado. */
  count: number;
  /** Se eliminaron símbolos no permitidos. */
  invalidRemoved: boolean;
  /** Se recortó por superar el máximo. */
  truncated: boolean;
  message: string;
  tone: NameTone;
}

export function nameFeedback(raw: string): NameFeedback {
  const normalized = raw.normalize('NFC');
  const stripped = normalized.replace(INVALID, '');
  const invalidRemoved = stripped.length !== normalized.length;
  const clean = liveSanitizeName(raw);
  const truncated = charCount(stripped.replace(/^ +/, '').replace(/ {2,}/g, ' ')) > CHARACTER.nameMaxLen;
  const committed = sanitizeName(clean);
  const ok = committed !== '';
  let message = NAME_RULE;
  let tone: NameTone = 'hint';
  if (!ok) {
    tone = 'error';
    message = raw.trim() === '' ? `El nombre no puede estar vacío. ${NAME_RULE}` : `No queda ningún carácter válido. ${NAME_RULE}`;
  } else if (invalidRemoved) {
    tone = 'warn';
    message = `Se quitaron símbolos no permitidos. ${NAME_RULE}`;
  } else if (truncated) {
    tone = 'warn';
    message = `Máximo ${CHARACTER.nameMaxLen} caracteres.`;
  }
  return { clean, committed, ok, count: charCount(clean), invalidRemoved, truncated, message, tone };
}

/** ¿Es un nombre «de fábrica» (por defecto o de la lista aleatoria)? Sirve para no pisar nombres personalizados. */
export function isStockName(name: string): boolean {
  const all = [
    ...Object.values(CHARACTER.defaultName),
    ...CHARACTER.randomNames.male,
    ...CHARACTER.randomNames.female,
  ];
  return all.includes(name);
}
