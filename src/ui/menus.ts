/**
 * Piezas reutilizables de los menús (título y pausa): pestañas accesibles, panel de
 * ajustes, briefing de contratos y lista de controles.
 */
import { formatObjective } from '../rules/markers';
import type { RunState } from '../core/state';
import { CONTROLS, TOUCH_GUIDE, contractBriefs, matchRules } from './content';
import { AttrCell, TextCell, el } from './dom';
import type { Disposer } from './dom';
import { formatMoney } from './format';
import { icon } from './icons';
import type { IconName } from './icons';
import { QUALITY_LABEL, QUALITY_LEVELS } from './settings';
import type { SettingsStore } from './settings';

// ─────────────────────────────────────────────────────────────────────────────
// Pestañas (patrón ARIA tablist con navegación por flechas)
// ─────────────────────────────────────────────────────────────────────────────
export interface TabSpec {
  id: string;
  label: string;
  icon?: IconName;
  panel: HTMLElement;
}

export interface Tabs {
  el: HTMLElement;
  select(id: string): void;
  readonly current: string;
}

export function createTabs(prefix: string, specs: TabSpec[], dis: Disposer, onSelect?: (id: string) => void): Tabs {
  const list = el('div', { class: 'tablist', attrs: { role: 'tablist' } });
  const panels = el('div', 'tabpanels');
  const buttons: HTMLButtonElement[] = [];
  let current = specs[0]?.id ?? '';

  specs.forEach((spec) => {
    const btn = el(
      'button',
      {
        class: 'tab',
        id: `${prefix}-tab-${spec.id}`,
        attrs: { type: 'button', role: 'tab', 'aria-controls': `${prefix}-panel-${spec.id}`, 'aria-selected': 'false', tabindex: '-1' },
      },
      spec.icon ? icon(spec.icon) : null,
      el('span', { text: spec.label }),
    );
    spec.panel.className = `${spec.panel.className} tabpanel`.trim();
    spec.panel.id = `${prefix}-panel-${spec.id}`;
    spec.panel.setAttribute('role', 'tabpanel');
    spec.panel.setAttribute('aria-labelledby', btn.id);
    spec.panel.tabIndex = 0;
    spec.panel.hidden = true;
    buttons.push(btn);
    list.append(btn);
    panels.append(spec.panel);
    dis.listen(btn, 'click', () => select(spec.id));
  });

  function select(id: string, focus = false): void {
    if (!specs.some((s) => s.id === id)) return;
    current = id;
    specs.forEach((spec, i) => {
      const on = spec.id === id;
      const b = buttons[i]!;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      spec.panel.hidden = !on;
      if (on && focus) b.focus();
    });
    onSelect?.(id);
  }

  dis.listen(list, 'keydown', (e) => {
    const i = specs.findIndex((s) => s.id === current);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % specs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + specs.length) % specs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = specs.length - 1;
    if (next >= 0) {
      e.preventDefault();
      select(specs[next]!.id, true);
    }
  });

  select(current);
  return {
    el: el('div', 'tabs', list, panels),
    select: (id) => select(id),
    get current() {
      return current;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ajustes
// ─────────────────────────────────────────────────────────────────────────────
export function createSettingsPanel(store: SettingsStore, prefix: string, dis: Disposer): HTMLElement {
  const s = store.value;

  // Volumen maestro
  const volId = `${prefix}-vol`;
  const vol = el('input', { class: 'range', id: volId, attrs: { type: 'range', min: '0', max: '100', step: '1' } });
  const volOut = el('output', { class: 'range-out', attrs: { for: volId } });
  const paintVol = (v: number): void => {
    vol.value = String(Math.round(v * 100));
    vol.style.setProperty('--fill', `${Math.round(v * 100)}%`);
    vol.setAttribute('aria-valuetext', `${Math.round(v * 100)} %`);
    volOut.textContent = `${Math.round(v * 100)} %`;
  };
  dis.listen(vol, 'input', () => store.set({ volume: Number(vol.value) / 100 }));

  // Silenciar
  const mute = el('input', { class: 'switch-input', id: `${prefix}-mute`, attrs: { type: 'checkbox', role: 'switch' } });
  dis.listen(mute, 'change', () => store.set({ muted: mute.checked }));

  // Calidad gráfica (grupo de radios)
  const radios = QUALITY_LEVELS.map((q) => {
    const input = el('input', { class: 'seg-input', id: `${prefix}-q-${q}`, attrs: { type: 'radio', name: `${prefix}-quality`, value: q } });
    dis.listen(input, 'change', () => {
      if (input.checked) store.set({ quality: q });
    });
    const label = el('label', { class: 'seg-label', attrs: { for: input.id } }, QUALITY_LABEL[q]);
    return { q, input, label };
  });

  const paint = (v: Readonly<typeof s>): void => {
    paintVol(v.volume);
    mute.checked = v.muted;
    for (const r of radios) r.input.checked = r.q === v.quality;
  };
  paint(s);
  const off = store.subscribe(paint);
  dis.add(off);

  return el(
    'div',
    'settings',
    el(
      'div',
      'set-row',
      el('label', { class: 'set-label', attrs: { for: volId } }, icon('speaker'), 'Volumen maestro'),
      el('div', 'set-control', vol, volOut),
    ),
    el(
      'div',
      'set-row',
      el('label', { class: 'set-label', attrs: { for: mute.id } }, icon('mute'), 'Silenciar audio'),
      el('div', 'set-control', el('label', 'switch', mute, el('span', { class: 'switch-ui', attrs: { 'aria-hidden': 'true' } }))),
    ),
    el(
      'fieldset',
      'set-row set-fieldset',
      el('legend', 'set-label', icon('chart'), 'Calidad gráfica'),
      el('div', 'seg', ...radios.flatMap((r) => [r.input, r.label])),
    ),
    el('p', { class: 'set-note', text: 'Los ajustes se recuerdan en este navegador.' }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Briefing (contratos + reglas)
// ─────────────────────────────────────────────────────────────────────────────
export interface BriefingPanel {
  el: HTMLElement;
  /** Con `live`, actualiza el estado dinámico de cada contrato. */
  refresh(state: RunState): void;
}

export function createBriefingPanel(live: boolean): BriefingPanel {
  const briefs = contractBriefs();
  const cards = briefs.map((b, i) => {
    const liveEl = el('p', 'contract-live');
    liveEl.hidden = !live;
    const badge = el('span', { class: 'contract-state', attrs: { 'aria-hidden': 'true' } }, icon('check'));
    const card = el(
      'article',
      { class: 'contract', attrs: { 'data-id': b.id, 'data-status': 'todo' } },
      el('header', 'contract-head', el('span', { class: 'contract-n', text: String(i + 1).padStart(2, '0') }), el('h3', { class: 'contract-title', text: b.title }), badge, el('span', { class: 'contract-reward', text: formatMoney(b.reward) })),
      el('p', { class: 'contract-desc', text: b.desc }),
      liveEl,
    );
    return { card, live: new TextCell(liveEl), status: new AttrCell(card, 'data-status') };
  });

  const rules = el(
    'ul',
    'rules',
    ...matchRules().map((r) =>
      el('li', { class: 'rule', attrs: { 'data-tone': r.tone } }, el('span', { class: 'rule-tag', text: r.tag }), el('span', { class: 'rule-text', text: r.text })),
    ),
  );

  const root = el(
    'div',
    'briefing',
    el('h3', { class: 'sec-title', text: live ? 'Contratos activos' : 'Contratos' }),
    el('div', 'contracts', ...cards.map((c) => c.card)),
    el('h3', { class: 'sec-title', text: 'Reglas de la operación' }),
    rules,
  );

  return {
    el: root,
    refresh(state) {
      if (!live) return;
      const lines = formatObjective(state);
      lines.forEach((line, i) => {
        const c = cards[i];
        if (!c) return;
        c.live.set(line.text);
        c.status.set(line.status);
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Controles
// ─────────────────────────────────────────────────────────────────────────────
export function createControlsPanel(): HTMLElement {
  const groups = CONTROLS.map((g) =>
    el(
      'section',
      'ctl-group',
      el('h3', { class: 'sec-title', text: g.title }),
      el(
        'dl',
        'ctl-list',
        ...g.items.flatMap((item) => {
          const keys = el('dt', 'ctl-keys');
          item.keys.forEach((combo, i) => {
            if (i > 0) keys.append(el('span', { class: 'ctl-or', text: '/', attrs: { 'aria-hidden': 'true' } }));
            const grp = el('span', 'kbd-group');
            for (const k of combo) grp.append(el('kbd', { text: k }));
            keys.append(grp);
          });
          return [keys, el('dd', { class: 'ctl-action', text: item.action })];
        }),
      ),
    ),
  );
  return el('div', 'controls', ...groups);
}

// ─────────────────────────────────────────────────────────────────────────────
// Guía de gestos (táctil)
// ─────────────────────────────────────────────────────────────────────────────
export function createTouchGuidePanel(): HTMLElement {
  return el(
    'div',
    'controls touch-guide',
    el('h3', { class: 'sec-title', text: 'Controles táctiles' }),
    el(
      'ul',
      'gestures',
      ...TOUCH_GUIDE.map((g) =>
        el('li', 'gesture', el('span', 'gesture-ico', icon(g.icon)), el('div', 'gesture-body', el('b', { class: 'gesture-title', text: g.title }), el('span', { class: 'gesture-text', text: g.text }))),
      ),
    ),
  );
}
