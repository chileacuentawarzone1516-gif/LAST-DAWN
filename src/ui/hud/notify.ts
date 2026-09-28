/** Notificaciones apiladas (región aria-live): máx. 4, 4 s, color por tipo. */
import { HUD } from '../../config';
import type { NotifyKind } from '../../core/types';
import { el } from '../dom';
import { icon } from '../icons';
import type { IconName } from '../icons';
import type { HudEnv, Widget } from './types';

interface Note {
  node: HTMLElement;
  textNode: HTMLElement;
  countNode: HTMLElement;
  text: string;
  kind: NotifyKind;
  ttl: number;
  count: number;
}

const KIND_ICON: Record<NotifyKind, IconName | null> = {
  info: null, warn: 'warning', danger: 'warning', reward: 'money',
};

/** Segundos antes del final en los que empieza el fundido de salida. */
const FADE_S = 0.45;

export function createNotifications(env: HudEnv): Widget & { push(text: string, kind: NotifyKind): void } {
  const root = el('div', {
    class: 'notes',
    attrs: { role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions text', 'aria-label': 'Avisos' },
  });
  const notes: Note[] = [];

  const remove = (n: Note): void => {
    n.node.remove();
    const i = notes.indexOf(n);
    if (i >= 0) notes.splice(i, 1);
  };

  const push = (text: string, kind: NotifyKind): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Un aviso idéntico y reciente se fusiona (×2, ×3…) en lugar de apilarse.
    const dup = notes.find((n) => n.text === trimmed && n.kind === kind && n.ttl > FADE_S);
    if (dup) {
      dup.count++;
      dup.ttl = HUD.notify.durationS;
      dup.countNode.textContent = `×${dup.count}`;
      dup.countNode.hidden = false;
      dup.node.classList.remove('out');
      return;
    }
    const ico = KIND_ICON[kind];
    const textNode = el('span', { class: 'note-text', text: trimmed });
    const countNode = el('span', { class: 'note-count' });
    countNode.hidden = true;
    const node = el('div', { class: 'note', attrs: { 'data-kind': kind } }, ico ? icon(ico, 'ico note-ico') : el('i', 'note-dot'), textNode, countNode);
    const note: Note = { node, textNode, countNode, text: trimmed, kind, ttl: HUD.notify.durationS, count: 1 };
    // Las más nuevas arriba; el exceso descarta las más antiguas.
    root.prepend(node);
    notes.unshift(note);
    while (notes.length > HUD.notify.max) remove(notes[notes.length - 1]!);
  };

  env.scope.on('ui:notify', ({ text, kind }) => {
    if (env.isVisible()) push(text, kind);
  });

  return {
    el: root,
    push,
    update(dt) {
      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i]!;
        n.ttl -= dt;
        if (n.ttl <= 0) remove(n);
        else if (n.ttl < FADE_S) n.node.classList.add('out');
      }
    },
    dispose() {
      for (const n of [...notes]) remove(n);
    },
  };
}
