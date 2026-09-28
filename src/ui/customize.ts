/**
 * Pantalla «PERSONALIZAR OPERATIVO»: género, apariencias predefinidas, ajuste fino (piel, pelo,
 * ropa, accesorio), nombre y vista previa 3D (ctx.character). Cada cambio se aplica al instante
 * con `updateProfile` (único punto de escritura del perfil). Grupos de radio accesibles con flechas.
 */
import { CHARACTER, HUD } from '../config';
import type { GameContext } from '../core/context';
import { updateProfile } from '../core/profile';
import type { Appearance, Gender } from '../core/types';
import {
  applyPreset, clampAppearance, defaultName, matchingPreset, randomProfile, resolveLook, withGender,
} from '../rules/character';
import { el } from './dom';
import type { Disposer } from './dom';
import { hexColor, createStaticPortrait } from './portrait';
import { anchorFromBox, anchorsEqual, fallbackAnchor } from './layout';
import { icon } from './icons';
import { isStockName } from './naming';
import { createNameField, createOperativeChip } from './operative';

interface RadioOpt {
  label: string;
  nodes: Node[];
}

interface Radios {
  readonly el: HTMLElement;
  setItems(items: RadioOpt[]): void;
  setValue(index: number): void;
}

/** Grupo de radio ARIA con tabindex móvil y navegación por flechas (la selección sigue al foco). */
function createRadios(dis: Disposer, label: string, cls: string, onSelect: (index: number) => void): Radios {
  const root = el('div', { class: `radios ${cls}`, attrs: { role: 'radiogroup', 'aria-label': label } });
  let buttons: HTMLButtonElement[] = [];
  let value = -1;

  const setValue = (i: number): void => {
    value = i;
    buttons.forEach((b, k) => {
      b.setAttribute('aria-checked', String(k === i));
      b.tabIndex = k === i || (i < 0 && k === 0) ? 0 : -1;
    });
  };
  const indexOf = (t: EventTarget | null): number => {
    const b = t instanceof Element ? t.closest<HTMLButtonElement>('button[data-i]') : null;
    return b ? Number(b.dataset.i) : -1;
  };

  dis.listen(root, 'click', (e) => {
    const i = indexOf(e.target);
    if (i >= 0) onSelect(i);
  });
  dis.listen(root, 'keydown', (e) => {
    const cur = indexOf(e.target);
    if (cur < 0 || buttons.length === 0) return;
    const n = buttons.length;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (cur + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (cur - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next >= 0) {
      e.preventDefault();
      buttons[next]?.focus();
      onSelect(next);
    }
  });

  return {
    el: root,
    setItems(items) {
      buttons = items.map((o, i) =>
        el(
          'button',
          { class: 'radio', attrs: { type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': o.label, title: o.label, 'data-i': String(i), tabindex: '-1' } },
          ...o.nodes,
        ),
      );
      root.replaceChildren(...buttons);
      setValue(value);
    },
    setValue,
  };
}

const dot = (color: number): HTMLElement => el('span', { class: 'sw-dot', attrs: { style: `background:${hexColor(color)}` } });
const txt = (t: string): HTMLElement => el('span', { class: 'radio-text', text: t });

export interface CustomizeView {
  readonly el: HTMLElement;
  /** Foco inicial al mostrarse. */
  readonly primary: HTMLElement;
  onShow(): void;
  /** Se llama con la pantalla ya visible (mide el área del modelo y muestra la vista previa 3D). */
  onShown(): void;
  onHide(): void;
  update(dt: number): void;
}

export function createCustomize(ctx: GameContext, dis: Disposer, back: () => void): CustomizeView {
  const rng = (): number => Math.random();
  const profile = (): GameContext['state']['profile'] => ctx.state.profile;
  const setAppearance = (patch: Partial<Appearance>): void => void updateProfile(ctx, { appearance: patch });

  // ── Grupos ────────────────────────────────────────────────────────────────
  const gender = createRadios(dis, 'Género', 'radios-gender', (i) => {
    const g = CHARACTER.genders[i]?.id;
    if (!g) return;
    const n = withGender(profile(), g);
    updateProfile(ctx, { gender: n.gender, name: n.name, appearance: n.appearance });
    salute();
  });
  gender.setItems(CHARACTER.genders.map((g) => ({ label: g.name, nodes: [icon('user'), txt(g.name)] })));

  const presets = createRadios(dis, 'Apariencias predefinidas', 'radios-presets', (i) => {
    updateProfile(ctx, { appearance: applyPreset(profile(), i).appearance });
    salute();
  });
  const skin = createRadios(dis, 'Tono de piel', 'radios-swatch', (i) => setAppearance({ skin: i }));
  skin.setItems(CHARACTER.skinTones.map((t) => ({ label: t.name, nodes: [dot(t.color)] })));
  const hairStyle = createRadios(dis, 'Estilo de pelo', 'radios-pills', (i) => setAppearance({ hairStyle: i }));
  const hairColor = createRadios(dis, 'Color de pelo', 'radios-swatch', (i) => setAppearance({ hairColor: i }));
  hairColor.setItems(CHARACTER.hairColors.map((c) => ({ label: c.name, nodes: [dot(c.color)] })));
  const outfit = createRadios(dis, 'Ropa', 'radios-outfit', (i) => setAppearance({ outfit: i }));
  outfit.setItems(
    CHARACTER.outfits.map((o) => ({
      label: o.name,
      nodes: [el('span', 'outfit-chips', dot(o.jacket), dot(o.pants), dot(o.accent)), txt(o.name)],
    })),
  );
  const accessory = createRadios(dis, 'Accesorio', 'radios-pills', (i) => setAppearance({ accessory: i }));
  accessory.setItems(CHARACTER.accessories.map((a) => ({ label: a.name, nodes: [txt(a.name)] })));

  const rebuildForGender = (g: Gender): void => {
    presets.setItems(
      CHARACTER.presets[g].map((p) => ({
        label: `${p.name}: ${p.tagline}`,
        nodes: [
          createStaticPortrait(resolveLook({ name: '', gender: g, appearance: clampAppearance(g, p.appearance) }), 'portrait preset-portrait', 96),
          el('span', 'preset-text', el('b', { class: 'preset-name', text: p.name }), el('span', { class: 'preset-tag', text: p.tagline })),
        ],
      })),
    );
    hairStyle.setItems(CHARACTER.hairStyles[g].map((h) => ({ label: h.name, nodes: [txt(h.name)] })));
  };

  // ── Nombre y ficha ────────────────────────────────────────────────────────
  const nameField = createNameField(ctx, dis, { id: 'custom-name', live: true });
  const chip = createOperativeChip(ctx, 'op-chip op-chip-large');
  dis.add(() => chip.dispose());
  const customBadge = el('span', { class: 'custom-badge', text: 'Personalizado' });

  // ── Acciones ──────────────────────────────────────────────────────────────
  const randomBtn = el('button', { class: 'btn btn-ghost', attrs: { type: 'button' } }, icon('shuffle'), el('span', { class: 'btn-label', text: 'Aleatorio' }));
  const resetBtn = el('button', { class: 'btn btn-ghost', attrs: { type: 'button', title: 'Vuelve al primer aspecto predefinido del género' } }, icon('reset'), el('span', { class: 'btn-label', text: 'Restablecer' }));
  const doneBtn = el('button', { class: 'btn btn-primary', attrs: { type: 'button' } }, el('span', { class: 'btn-label', text: 'Hecho' }));
  const backBtn = el('button', { class: 'btn btn-ghost btn-icon', attrs: { type: 'button', 'aria-label': 'Volver' } }, icon('back'));
  dis.listen(randomBtn, 'click', () => {
    const cur = profile();
    const r = randomProfile(rng);
    // No se pisa un nombre personalizado: sólo se sustituyen los nombres de fábrica.
    updateProfile(ctx, { gender: r.gender, name: isStockName(cur.name) ? r.name : cur.name, appearance: r.appearance });
    salute();
  });
  dis.listen(resetBtn, 'click', () => {
    const cur = profile();
    updateProfile(ctx, { name: isStockName(cur.name) ? defaultName(cur.gender) : cur.name, appearance: applyPreset(cur, 0).appearance });
    salute();
  });
  dis.listen(doneBtn, 'click', back);
  dis.listen(backBtn, 'click', back);

  const section = (title: string, ...children: Node[]): HTMLElement => el('section', 'custom-sec', el('h3', { class: 'sec-title', text: title }), ...children);
  const panel = el(
    'div',
    'custom-panel panel',
    el('header', 'custom-head', backBtn, el('div', 'custom-titles', el('div', { class: 'eyebrow', text: 'EXPEDIENTE' }), el('h2', { id: 'ds-custom-h', class: 'screen-h', text: 'PERSONALIZAR OPERATIVO' }))),
    el('div', 'custom-scroll',
      el('section', 'custom-sec', nameField.el),
      section('Género', gender.el),
      section('Apariencias', presets.el, customBadge),
      section('Ajuste fino', el('div', 'fine-grid',
        el('div', 'fine-row', el('span', { class: 'fine-label', text: 'Tono de piel' }), skin.el),
        el('div', 'fine-row', el('span', { class: 'fine-label', text: 'Estilo de pelo' }), hairStyle.el),
        el('div', 'fine-row', el('span', { class: 'fine-label', text: 'Color de pelo' }), hairColor.el),
        el('div', 'fine-row', el('span', { class: 'fine-label', text: 'Ropa' }), outfit.el),
        el('div', 'fine-row', el('span', { class: 'fine-label', text: 'Accesorio' }), accessory.el),
      )),
    ),
    el('footer', 'custom-actions', randomBtn, resetBtn, doneBtn),
  );

  // ── Escenario (zona libre donde el motor dibuja al maniquí) ─────────────────
  const stage = el('div', {
    class: 'custom-stage',
    attrs: {
      role: 'group', tabindex: '0',
      'aria-label': 'Vista previa del operativo. Arrastra para girarlo o usa las flechas izquierda y derecha.',
    },
  }, el('div', 'stage-hint', icon('touch'), el('span', { text: 'Arrastra para girar' })), el('div', 'stage-card', chip.el));
  const root = el(
    'section',
    { class: 'screen screen-custom', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ds-custom-h', hidden: '' } },
    el('div', 'custom-wrap', panel, stage),
  );

  // ── Vista previa 3D ─────────────────────────────────────────────────────────
  let shown = false;
  let lastAnchor = fallbackAnchor({ width: window.innerWidth, height: window.innerHeight });
  let poseTimer = 0;

  const measure = (): typeof lastAnchor => {
    const vp = { width: window.innerWidth, height: window.innerHeight };
    const r = stage.getBoundingClientRect();
    // El rótulo de la ficha ocupa la parte baja: el modelo se centra en el resto.
    const card = stage.querySelector<HTMLElement>('.stage-card')?.getBoundingClientRect();
    const cardH = card ? Math.max(0, r.bottom - card.top) : 0;
    return anchorFromBox({ left: r.left, top: r.top, width: r.width, height: Math.max(0, r.height - cardH) }, vp);
  };
  const reanchor = (): void => {
    if (!shown) return;
    const a = measure();
    if (anchorsEqual(a, lastAnchor)) return;
    lastAnchor = a;
    ctx.character.setAnchor(a);
  };
  const salute = (): void => {
    ctx.character.setPose('salute');
    poseTimer = 1.6;
  };

  let ro: ResizeObserver | null = null;
  dis.listen(window, 'resize', reanchor);
  dis.listen(window, 'orientationchange', () => window.setTimeout(reanchor, 250));

  // Arrastre: cada píxel horizontal gira el modelo.
  let dragId: number | null = null;
  let lastX = 0;
  dis.listen(stage, 'pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragId = e.pointerId;
    lastX = e.clientX;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
  });
  dis.listen(stage, 'pointermove', (e) => {
    if (dragId !== e.pointerId) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    if (dx !== 0) ctx.character.rotate(dx * HUD.preview.rotatePerPx);
  });
  const endDrag = (e: PointerEvent): void => {
    if (dragId !== e.pointerId) return;
    dragId = null;
    stage.classList.remove('dragging');
  };
  dis.listen(stage, 'pointerup', endDrag);
  dis.listen(stage, 'pointercancel', endDrag);
  dis.listen(stage, 'keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      ctx.character.rotate(-HUD.preview.keyStepRad);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      ctx.character.rotate(HUD.preview.keyStepRad);
    }
  });

  // ── Sincronización con el perfil ─────────────────────────────────────────────
  let builtGender: Gender | null = null;
  const sync = (): void => {
    const p = profile();
    if (builtGender !== p.gender) {
      builtGender = p.gender;
      rebuildForGender(p.gender);
    }
    gender.setValue(CHARACTER.genders.findIndex((g) => g.id === p.gender));
    const m = matchingPreset(p);
    presets.setValue(m);
    customBadge.hidden = m >= 0;
    const a = clampAppearance(p.gender, p.appearance);
    skin.setValue(a.skin);
    hairStyle.setValue(a.hairStyle);
    hairColor.setValue(a.hairColor);
    outfit.setValue(a.outfit);
    accessory.setValue(a.accessory);
    nameField.sync();
  };
  const scope = ctx.bus.scope().on('profile:changed', sync);
  dis.add(() => scope.dispose());
  sync();

  return {
    el: root,
    primary: doneBtn,
    onShow() {
      builtGender = null;
      sync();
    },
    onShown() {
      shown = true;
      lastAnchor = measure();
      ctx.character.showPreview(lastAnchor);
      ctx.character.setPose('idle');
      ro?.disconnect();
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => reanchor());
        ro.observe(stage);
      }
    },
    onHide() {
      shown = false;
      ro?.disconnect();
      ro = null;
      ctx.character.hidePreview();
      ctx.character.setPose('idle');
    },
    update(dt) {
      if (poseTimer > 0) {
        poseTimer -= dt;
        if (poseTimer <= 0) ctx.character.setPose('idle');
      }
    },
  };
}
