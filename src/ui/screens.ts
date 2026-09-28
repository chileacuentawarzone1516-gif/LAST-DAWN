/**
 * Pantallas de flujo: TÍTULO, PAUSA y FIN DE PARTIDA. Se muestran según `state.flow`;
 * las peticiones al orquestador se emiten por el bus de forma SÍNCRONA dentro del gesto
 * del usuario (imprescindible para poder pedir el bloqueo del puntero).
 */
import { HUD, MISSIONS } from '../config';
import type { GameContext } from '../core/context';
import type { EndReason } from '../core/types';
import { formatClock } from '../core/util';
import { SLOGAN, TAGLINE } from './content';
import { TextCell, el, svgEl } from './dom';
import type { Disposer } from './dom';
import {
  END_HEADLINE, END_REASON_DETAIL, endReasonText, formatAccuracy, formatMoney, resultFor, summarizeRun,
} from './format';
import type { RunSummary } from './format';
import { icon } from './icons';
import type { IconName } from './icons';
import { createBriefingPanel, createControlsPanel, createSettingsPanel, createTabs } from './menus';
import type { BriefingPanel } from './menus';
import type { SettingsStore } from './settings';

export interface Screens {
  readonly el: HTMLElement;
  update(dt: number): void;
  dispose(): void;
}

type ScreenKind = 'title' | 'pause' | 'end';

interface ScreenView {
  el: HTMLElement;
  /** Elemento que recibe el foco al mostrarse. */
  primary: HTMLElement;
  /** Se llama al mostrarse (rellenar contenido, reiniciar estado interno). */
  onShow(): void;
  onHide?(): void;
  update?(dt: number): void;
}

function button(label: string, kind: 'primary' | 'ghost' | 'danger', onClick: () => void, dis: Disposer, extra?: Node): HTMLButtonElement {
  const b = el('button', { class: `btn btn-${kind}`, attrs: { type: 'button' } }, el('span', { class: 'btn-label', text: label }), extra);
  dis.listen(b, 'click', onClick);
  return b;
}

/** Aviso claro si el navegador no puede ofrecer la experiencia completa. */
function detectIssues(ctx: GameContext): string[] {
  const issues: string[] = [];
  try {
    const gl = ctx.engine.renderer.getContext();
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) {
      issues.push('Tu navegador no ofrece WebGL 2: el juego puede no verse correctamente. Activa la aceleración por hardware o prueba con un navegador actualizado.');
    }
  } catch {
    issues.push('No se pudo comprobar WebGL 2. Si ves una pantalla negra, activa la aceleración por hardware.');
  }
  const canLock = 'pointerLockElement' in document && typeof Element.prototype.requestPointerLock === 'function';
  if (!canLock) {
    issues.push('Tu navegador no admite el bloqueo del puntero (Pointer Lock): no podrás apuntar con el ratón. Usa una versión reciente de Chrome, Edge o Firefox en un ordenador.');
  }
  try {
    if (window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches) {
      issues.push('No se detecta ratón: este juego requiere teclado y ratón.');
    }
  } catch {
    /* matchMedia no disponible */
  }
  return issues;
}

/** Glifo de señal (ondas) para el título. */
function signalGlyph(): SVGSVGElement {
  const arc = (r: number): string => `M${(50 - r * 0.8).toFixed(1)} ${(58 - r * 0.6).toFixed(1)}A${r} ${r} 0 0 1 ${(50 + r * 0.8).toFixed(1)} ${(58 - r * 0.6).toFixed(1)}`;
  return svgEl(
    'svg',
    { viewBox: '0 0 100 70', class: 'title-glyph', 'aria-hidden': 'true', fill: 'none', 'stroke': 'currentColor', 'stroke-width': 3, 'stroke-linecap': 'round' },
    svgEl('path', { d: arc(14), opacity: 1 }),
    svgEl('path', { d: arc(27), opacity: 0.7 }),
    svgEl('path', { d: arc(40), opacity: 0.4 }),
    svgEl('path', { d: 'M50 44v22M42 66h16', 'stroke-width': 4 }),
    svgEl('circle', { cx: 50, cy: 40, r: 3.4, fill: 'currentColor', stroke: 'none' }),
  );
}

export function createScreens(ctx: GameContext, settings: SettingsStore, dis: Disposer): Screens {
  const root = el('div', 'screens');
  const emit = {
    start: (): void => ctx.bus.emit('ui:startRequested', {}),
    resume: (): void => ctx.bus.emit('ui:resumeRequested', {}),
    restart: (): void => ctx.bus.emit('ui:restartRequested', {}),
    title: (): void => ctx.bus.emit('ui:titleRequested', {}),
  };

  // ── TÍTULO ───────────────────────────────────────────────────────────────
  const buildTitle = (): ScreenView => {
    const startBtn = button('Iniciar operación', 'primary', emit.start, dis, el('kbd', { class: 'btn-kbd', text: 'Enter' }));
    const noticeBox = el('div', { class: 'notices', attrs: { role: 'alert' } });
    const briefing = createBriefingPanel(false);
    const tabs = createTabs(
      'title',
      [
        { id: 'briefing', label: 'Briefing', icon: 'contract', panel: briefing.el },
        { id: 'controls', label: 'Controles', icon: 'target', panel: createControlsPanel() },
        { id: 'settings', label: 'Ajustes', icon: 'speaker', panel: createSettingsPanel(settings, 'title-set', dis) },
      ],
      dis,
    );
    const node = el(
      'section',
      { class: 'screen screen-title', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ds-title-h', hidden: '' } },
      el('div', { class: 'title-bg', attrs: { 'aria-hidden': 'true' } }),
      el(
        'div',
        'title-wrap',
        el(
          'div',
          'title-hero',
          el('div', { class: 'title-eyebrow', text: TAGLINE }),
          signalGlyph(),
          el(
            'h1',
            { id: 'ds-title-h', class: 'title-name' },
            el('span', { class: 'title-main', text: 'DEAD SIGNAL' }),
            el('span', { class: 'sr-only', text: ' — ' }),
            el('span', { class: 'title-sub', text: 'EXCLUSION ZONE' }),
          ),
          el('p', { class: 'title-slogan', text: SLOGAN }),
          el('div', 'title-cta', startBtn, el('p', { class: 'title-hint', text: 'Esc pausa y libera el ratón. Al iniciar, el navegador capturará el puntero.' })),
          noticeBox,
        ),
        el('div', 'title-side panel', tabs.el),
      ),
      el('footer', { class: 'title-foot', text: 'Todo el juego se genera por código: sin imágenes, fuentes ni sonidos descargados.' }),
    );
    return {
      el: node,
      primary: startBtn,
      onShow() {
        noticeBox.replaceChildren(...detectIssues(ctx).map((t) => el('p', 'notice', icon('warning'), el('span', { text: t }))));
        noticeBox.hidden = noticeBox.childElementCount === 0;
        tabs.select('briefing');
      },
    };
  };

  // ── PAUSA ────────────────────────────────────────────────────────────────
  let resumeWait = -1;
  const buildPause = (): ScreenView => {
    const hint = el('p', { class: 'pause-hint', attrs: { role: 'status', 'aria-live': 'polite' } });
    const resumeLabel = new TextCell(el('span', { class: 'btn-label' }));
    const resumeBtn = el('button', { class: 'btn btn-primary', attrs: { type: 'button' } }, resumeLabel.node as HTMLElement, el('kbd', { class: 'btn-kbd', text: 'Enter' }));
    resumeLabel.set('Continuar');
    dis.listen(resumeBtn, 'click', () => {
      emit.resume();
      // Si el navegador tarda en conceder el bloqueo del puntero, pedirá un clic explícito.
      resumeWait = HUD.resumeHintMs / 1000;
    });
    const restartBtn = button('Reiniciar', 'ghost', emit.restart, dis);
    const titleBtn = button('Volver al título', 'ghost', emit.title, dis);
    const briefing: BriefingPanel = createBriefingPanel(true);
    const tabs = createTabs(
      'pause',
      [
        { id: 'contracts', label: 'Contratos', icon: 'contract', panel: briefing.el },
        { id: 'controls', label: 'Controles', icon: 'target', panel: createControlsPanel() },
        { id: 'settings', label: 'Ajustes', icon: 'speaker', panel: createSettingsPanel(settings, 'pause-set', dis) },
      ],
      dis,
    );
    let acc = 1;
    const node = el(
      'section',
      { class: 'screen screen-pause', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ds-pause-h', hidden: '' } },
      el(
        'div',
        'pause-wrap',
        el(
          'div',
          'pause-main panel',
          el('div', { class: 'eyebrow', text: 'OPERACIÓN EN CURSO' }),
          el('h2', { id: 'ds-pause-h', class: 'screen-h', text: 'PAUSA' }),
          el('p', { class: 'screen-sub', text: 'La simulación está detenida.' }),
          el('div', 'actions', resumeBtn, restartBtn, titleBtn),
          hint,
        ),
        el('div', 'pause-side panel', tabs.el),
      ),
    );
    return {
      el: node,
      primary: resumeBtn,
      onShow() {
        resumeWait = -1;
        hint.textContent = '';
        resumeLabel.set('Continuar');
        tabs.select('contracts');
        briefing.refresh(ctx.state);
        acc = 0;
      },
      onHide() {
        resumeWait = -1;
      },
      update(dt) {
        if (resumeWait >= 0) {
          resumeWait -= dt;
          if (resumeWait < 0) {
            resumeLabel.set('Haz clic para continuar');
            hint.textContent = 'El navegador aún no permite capturar el ratón. Haz clic en «Continuar» para volver a la partida.';
          }
        }
        acc += dt;
        if (acc >= 0.25) {
          acc = 0;
          briefing.refresh(ctx.state);
        }
      },
    };
  };

  // ── FIN DE PARTIDA ───────────────────────────────────────────────────────
  let focusTimer = 0;
  let endInfo: { result: 'won' | 'lost'; reason: EndReason } | null = null;
  const buildEnd = (): ScreenView => {
    const badge = el('div', { class: 'end-badge', attrs: { 'aria-hidden': 'true' } });
    const headline = el('h2', { id: 'ds-end-h', class: 'end-headline' });
    const reasonEl = el('p', 'end-reason');
    const detailEl = el('p', 'end-detail');
    const stats = el('dl', 'stats');
    const contracts = el('ul', { class: 'end-contracts', attrs: { 'aria-label': 'Contratos' } });
    const retry = button('Reintentar', 'primary', emit.restart, dis);
    const title = button('Título', 'ghost', emit.title, dis);
    const node = el(
      'section',
      { class: 'screen screen-end', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ds-end-h', 'aria-describedby': 'ds-end-r', hidden: '', tabindex: '-1' } },
      el(
        'div',
        'end-wrap panel',
        badge,
        el('div', { class: 'eyebrow', text: 'INFORME DE OPERACIÓN' }),
        headline,
        el('div', { id: 'ds-end-r' }, reasonEl, detailEl),
        stats,
        contracts,
        el('div', 'actions', retry, title),
      ),
    );

    const stat = (ico: IconName, label: string, value: string): HTMLElement =>
      el('div', 'stat', el('dt', 'stat-label', icon(ico), label), el('dd', { class: 'stat-value', text: value }));

    const fill = (result: 'won' | 'lost', reason: EndReason, s: RunSummary): void => {
      node.dataset.result = result;
      badge.replaceChildren(icon(result === 'won' ? 'check' : 'skull'));
      headline.textContent = END_HEADLINE[result].toUpperCase();
      reasonEl.textContent = endReasonText(reason);
      detailEl.textContent = END_REASON_DETAIL[reason];
      stats.replaceChildren(
        stat('clock', 'Tiempo', formatClock(s.timeS)),
        stat('skull', 'Bajas', String(s.kills)),
        stat('headshot', 'Disparos a la cabeza', String(s.headshots)),
        stat('target', 'Precisión', formatAccuracy(s.accuracy)),
        stat('money', 'Dinero ganado', formatMoney(s.moneyEarned)),
        stat('money', 'Dinero gastado', formatMoney(s.moneySpent)),
        stat('contract', 'Contratos completados', `${s.contractsDone}/${s.contractsTotal}`),
      );
      contracts.replaceChildren(
        ...(Object.keys(s.contracts) as Array<keyof RunSummary['contracts']>).map((id) =>
          el(
            'li',
            { class: 'end-contract', attrs: { 'data-done': String(s.contracts[id]) } },
            icon(s.contracts[id] ? 'check' : 'cross'),
            el('span', { text: MISSIONS[id].title }),
            el('span', { class: 'sr-only', text: s.contracts[id] ? ' (completado)' : ' (sin completar)' }),
          ),
        ),
      );
    };

    return {
      el: node,
      // Foco inicial en el diálogo (no en un botón): así un Espacio/Enter pulsado en el momento
      // de morir no reinicia la partida por accidente. El foco pasa a «Reintentar» tras la guarda.
      primary: node,
      onShow() {
        const info = endInfo ?? { result: resultFor(ctx.state.match.endReason), reason: ctx.state.match.endReason ?? 'dead' };
        fill(info.result, info.reason, summarizeRun(ctx.state));
        window.clearTimeout(focusTimer);
        focusTimer = window.setTimeout(() => {
          if (shown === 'end') retry.focus({ preventScroll: true });
        }, HUD.endGuardMs);
      },
    };
  };

  const views: Record<ScreenKind, ScreenView> = { title: buildTitle(), pause: buildPause(), end: buildEnd() };
  for (const v of Object.values(views)) root.append(v.el);

  // ── Sincronización con state.flow ───────────────────────────────────────
  let shown: ScreenKind | null = null;

  const kindFor = (flow: GameContext['state']['flow']): ScreenKind | null =>
    flow === 'title' ? 'title' : flow === 'paused' ? 'pause' : flow === 'ended' ? 'end' : null;

  const focusables = (node: HTMLElement): HTMLElement[] =>
    Array.from(node.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]')).filter(
      (n) => !n.closest('[hidden]'),
    );

  const show = (next: ScreenKind | null): void => {
    if (next === shown) return;
    window.clearTimeout(focusTimer);
    if (shown) {
      const prev = views[shown];
      prev.el.hidden = true;
      prev.onHide?.();
      if (document.activeElement instanceof HTMLElement && prev.el.contains(document.activeElement)) document.activeElement.blur();
    }
    shown = next;
    if (!next) return;
    const v = views[next];
    v.onShow();
    v.el.hidden = false;
    v.primary.focus({ preventScroll: true });
  };

  // Trampa de foco ligera dentro del diálogo visible.
  dis.listen(root, 'keydown', (e) => {
    if (e.key !== 'Tab' || !shown) return;
    const items = focusables(views[shown].el);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === views[shown].el)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // Enter / Escape globales (sólo si el foco no está en un control que ya los gestiona).
  dis.listen(document, 'keydown', (e) => {
    if (e.defaultPrevented || e.repeat) return;
    const t = e.target instanceof Element ? e.target : null;
    const interactive = !!t && t.matches('button, input, select, textarea, a[href], [role="tab"]');
    const flow = ctx.state.flow;
    if (e.key === 'Enter' && !interactive) {
      if (flow === 'title') {
        e.preventDefault();
        emit.start();
      } else if (flow === 'paused') {
        e.preventDefault();
        emit.resume();
        resumeWait = HUD.resumeHintMs / 1000;
      }
    } else if (e.key === 'Escape' && flow === 'paused') {
      emit.resume();
      resumeWait = HUD.resumeHintMs / 1000;
    }
  });

  const scope = ctx.bus.scope();
  scope
    .on('flow:ended', ({ result, reason }) => {
      endInfo = { result, reason };
      // Game cambia el flujo justo después de este evento; se sincroniza ya para no perder un frame.
      show(kindFor('ended'));
    })
    .on('flow:started', () => {
      endInfo = null;
      show(kindFor(ctx.state.flow));
    })
    .on('flow:paused', () => show('pause'))
    .on('flow:resumed', () => show(null));

  // Pantalla inicial coherente con el estado actual (normalmente 'title').
  show(kindFor(ctx.state.flow));

  return {
    el: root,
    update(dt) {
      // `paused`/`ended` reflejan a Game con un frame de retraso como máximo.
      show(kindFor(ctx.state.flow));
      if (shown) views[shown].update?.(dt);
    },
    dispose() {
      window.clearTimeout(focusTimer);
      scope.dispose();
      root.remove();
    },
  };
}
