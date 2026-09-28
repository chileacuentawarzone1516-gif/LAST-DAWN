/**
 * Piezas de UI del operativo: campo de nombre con validación/feedback y ficha con retrato.
 * Toda escritura del perfil pasa por `updateProfile` (core/profile). Nunca se usa innerHTML.
 */
import { CHARACTER } from '../config';
import type { GameContext } from '../core/context';
import { updateProfile } from '../core/profile';
import { matchingPreset } from '../rules/character';
import { TextCell, el } from './dom';
import type { Disposer } from './dom';
import { NAME_RULE, nameFeedback } from './naming';
import { createPortrait } from './portrait';

type ProfileCtx = Pick<GameContext, 'state' | 'bus'>;

export interface NameField {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  /** Vuelca el nombre actual del perfil en el campo (si no se está editando). */
  sync(): void;
}

export interface NameFieldOptions {
  id: string;
  /** true: cada pulsación válida se aplica al instante; false: sólo al confirmar (Enter / botón). */
  live: boolean;
  /** Se llama tras confirmar un nombre válido. */
  onCommit?: () => void;
}

export function createNameField(ctx: ProfileCtx, dis: Disposer, opts: NameFieldOptions): NameField {
  const input = el('input', {
    class: 'name-input',
    id: opts.id,
    attrs: {
      type: 'text', maxlength: String(CHARACTER.nameMaxLen), autocomplete: 'off', autocapitalize: 'words',
      spellcheck: 'false', enterkeyhint: 'done', 'aria-describedby': `${opts.id}-msg`, 'aria-label': 'Nombre del operativo',
    },
  });
  const countEl = el('span', { class: 'name-count', attrs: { 'aria-hidden': 'true' } });
  const msgEl = el('p', { class: 'name-msg', id: `${opts.id}-msg`, attrs: { 'aria-live': 'polite' } });
  const count = new TextCell(countEl);
  const msg = new TextCell(msgEl);
  let saveBtn: HTMLButtonElement | null = null;

  const paintHint = (): void => {
    msg.set(NAME_RULE);
    msgEl.dataset.tone = 'hint';
  };

  const sync = (): void => {
    if (document.activeElement !== input) input.value = ctx.state.profile.name;
    count.set(`${Array.from(input.value).length}/${CHARACTER.nameMaxLen}`);
  };

  /** Aplica el saneado en vivo al texto y actualiza contador y mensaje. Devuelve el feedback. */
  const check = (): ReturnType<typeof nameFeedback> => {
    const fb = nameFeedback(input.value);
    if (fb.clean !== input.value) {
      input.value = fb.clean;
      input.setSelectionRange(fb.clean.length, fb.clean.length);
    }
    count.set(`${fb.count}/${CHARACTER.nameMaxLen}`);
    msg.set(fb.message);
    msgEl.dataset.tone = fb.tone;
    input.setAttribute('aria-invalid', String(!fb.ok));
    if (saveBtn) saveBtn.disabled = !fb.ok;
    return fb;
  };

  const commit = (): boolean => {
    const fb = check();
    if (!fb.ok) return false;
    updateProfile(ctx, { name: fb.committed });
    input.value = ctx.state.profile.name;
    count.set(`${Array.from(input.value).length}/${CHARACTER.nameMaxLen}`);
    msg.set('Nombre guardado.');
    msgEl.dataset.tone = 'ok';
    input.setAttribute('aria-invalid', 'false');
    opts.onCommit?.();
    return true;
  };

  dis.listen(input, 'input', () => {
    const fb = check();
    if (opts.live && fb.ok) updateProfile(ctx, { name: fb.committed });
  });
  dis.listen(input, 'keydown', (e) => {
    // El módulo de entrada mapea W/A/S/D/E/R/Q…: el texto escrito no debe llegar a él (salvo Esc).
    if (e.key !== 'Escape') e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      if (commit()) input.blur();
    }
  });
  dis.listen(input, 'keyup', (e) => e.stopPropagation());
  dis.listen(input, 'blur', () => {
    // Al salir, un valor inválido o sin confirmar vuelve al nombre real del perfil.
    input.value = ctx.state.profile.name;
    input.setAttribute('aria-invalid', 'false');
    count.set(`${Array.from(input.value).length}/${CHARACTER.nameMaxLen}`);
    if (msgEl.dataset.tone !== 'ok') paintHint();
    if (saveBtn) saveBtn.disabled = false;
  });

  const row = el('div', 'name-row', input, countEl);
  if (!opts.live) {
    saveBtn = el('button', { class: 'btn btn-ghost btn-sm', attrs: { type: 'button' } }, el('span', { class: 'btn-label', text: 'Guardar' }));
    // pointerdown antes del blur del campo: evita que el blur restaure el valor antes del clic.
    dis.listen(saveBtn, 'pointerdown', (e) => e.preventDefault());
    dis.listen(saveBtn, 'click', () => {
      if (commit()) input.blur();
    });
    row.append(saveBtn);
  }
  const root = el('div', 'namefield', el('label', { class: 'set-label', attrs: { for: opts.id } }, 'Nombre del operativo'), row, msgEl);

  const scope = ctx.bus.scope().on('profile:changed', () => {
    if (msgEl.dataset.tone === 'ok' && document.activeElement !== input) paintHint();
    sync();
  });
  dis.add(() => scope.dispose());
  paintHint();
  sync();
  return { el: root, input, sync };
}

export interface OperativeChip {
  readonly el: HTMLElement;
  dispose(): void;
}

/** Ficha compacta: retrato + nombre + lema del preset (o «Personalizado»). */
export function createOperativeChip(ctx: ProfileCtx, className = 'op-chip'): OperativeChip {
  const portrait = createPortrait(ctx, 'portrait op-portrait');
  const nameEl = el('span', 'op-name');
  const tagEl = el('span', 'op-tag');
  const root = el('div', className, portrait.el, el('div', 'op-text', nameEl, tagEl));
  const name = new TextCell(nameEl);
  const tag = new TextCell(tagEl);
  const paint = (): void => {
    const p = ctx.state.profile;
    name.set(p.name);
    const i = matchingPreset(p);
    tag.set(i >= 0 ? `${CHARACTER.presets[p.gender][i]!.name} · ${CHARACTER.presets[p.gender][i]!.tagline}` : 'Aspecto personalizado');
  };
  const scope = ctx.bus.scope().on('profile:changed', paint);
  paint();
  return {
    el: root,
    dispose() {
      scope.dispose();
      portrait.dispose();
      root.remove();
    },
  };
}
