/** Rastreador de contratos (arriba-izquierda): estado, texto dinámico y barra fina de progreso. */
import { THEME } from '../../config';
import { formatObjective } from '../../rules/markers';
import type { ObjectiveStatus } from '../../rules/markers';
import type { MissionId } from '../../core/types';
import { AttrCell, StyleCell, TextCell, el, num, play, quant } from '../dom';
import { formatMoney } from '../format';
import { icon } from '../icons';
import type { HudEnv, Widget } from './types';

interface Row {
  id: MissionId;
  li: HTMLElement;
  title: TextCell;
  text: TextCell;
  reward: TextCell;
  sr: TextCell;
  status: AttrCell;
  tone: AttrCell;
  fill: StyleCell;
  bar: HTMLElement;
  lastStatus: ObjectiveStatus | null;
  lastProgress: number;
}

const STATUS_LABEL: Record<ObjectiveStatus, string> = {
  locked: 'bloqueado', todo: 'pendiente', active: 'en curso', done: 'completado', failed: 'fallido',
};

export function createTracker(env: HudEnv): Widget {
  const { ctx } = env;
  const list = el('ol', { class: 'tracker', attrs: { 'aria-label': 'Contratos' } });
  const heading = el('div', { class: 'tracker-head', text: 'CONTRATOS', attrs: { 'aria-hidden': 'true' } });
  const rows: Row[] = [];

  const ids: MissionId[] = ['relay', 'warden', 'extraction'];
  for (const id of ids) {
    const title = el('span', 'trk-title');
    const reward = el('span', 'trk-reward');
    const text = el('div', 'trk-text');
    const fill = el('div', 'trk-fill');
    const sr = el('span', 'sr-only');
    const bar = el('div', { class: 'trk-bar', attrs: { 'aria-hidden': 'true' } }, fill);
    const li = el(
      'li',
      { class: 'trk', attrs: { 'data-id': id } },
      el('span', { class: 'trk-state', attrs: { 'aria-hidden': 'true' } }, icon('check', 'ico ico-done'), icon('lock', 'ico ico-lock'), icon('warning', 'ico ico-fail')),
      el('div', 'trk-body', el('div', 'trk-line', title, reward, sr), text, bar),
    );
    list.append(li);
    rows.push({
      id, li,
      title: new TextCell(title), text: new TextCell(text), reward: new TextCell(reward), sr: new TextCell(sr),
      status: new AttrCell(li, 'data-status'), tone: new AttrCell(li, 'data-tone'),
      fill: new StyleCell(fill, '--v'), bar, lastStatus: null, lastProgress: -1,
    });
  }
  const root = el('div', 'tracker-wrap', heading, list);

  // Destello al completarse un contrato (además del dinero, que anuncia la economía).
  env.scope.on('mission:completed', ({ id }) => {
    const row = rows.find((r) => r.id === id);
    if (row && env.isVisible()) {
      play(row.li, [{ backgroundColor: 'rgba(255, 216, 102, 0.28)' }, { backgroundColor: 'rgba(255, 216, 102, 0)' }], { duration: 1400, easing: 'ease-out' });
    }
  });

  return {
    el: root,
    update(_dt, slow) {
      if (!slow) return;
      const lines = formatObjective(ctx.state);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const row = rows[i]!;
        row.title.set(line.title);
        row.text.set(line.text);
        row.reward.set(line.paid ? 'COBRADO' : `+${formatMoney(line.reward)}`);
        row.status.set(line.status);
        row.tone.set(line.tone);
        if (line.progress === null) {
          if (row.lastProgress !== -1) {
            row.lastProgress = -1;
            row.bar.hidden = true;
          }
        } else {
          const v = quant(line.progress, 0.005);
          if (v !== row.lastProgress) {
            row.lastProgress = v;
            row.bar.hidden = false;
            row.fill.set(num(v));
          }
        }
        if (row.lastStatus !== line.status) {
          if (row.lastStatus !== null && line.status === 'done') {
            play(row.li, [{ boxShadow: `inset 0 0 0 1px ${THEME.reward}` }, { boxShadow: 'inset 0 0 0 1px transparent' }], { duration: 1200, easing: 'ease-out' });
          }
          row.lastStatus = line.status;
          row.sr.set(`, ${STATUS_LABEL[line.status]}`);
        }
      }
    },
  };
}
