/** Indicación de interacción 'E — …' con anillo de retención (ctx.interactions). */
import { AttrCell, ClassCell, StyleCell, TextCell, el, num, quant, svgEl } from '../dom';
import type { HudEnv, Widget } from './types';

/** Circunferencia del anillo en unidades del viewBox (r = 15.5). */
const CIRC = 2 * Math.PI * 15.5;

export function createInteract(env: HudEnv): Widget {
  const { ctx } = env;
  const ring = svgEl('circle', {
    class: 'ring-fg', cx: 18, cy: 18, r: 15.5, fill: 'none', 'stroke-width': 3, 'stroke-linecap': 'round',
    'stroke-dasharray': CIRC.toFixed(2), 'stroke-dashoffset': CIRC.toFixed(2), transform: 'rotate(-90 18 18)',
  });
  const svg = svgEl(
    'svg',
    { viewBox: '0 0 36 36', class: 'prompt-ring', 'aria-hidden': 'true' },
    svgEl('circle', { class: 'ring-bg', cx: 18, cy: 18, r: 15.5, fill: 'none', 'stroke-width': 3 }),
    ring,
  );
  const textEl = el('span', 'prompt-text');
  const hintEl = el('span', { class: 'prompt-hint', text: 'MANTÉN' });
  const root = el(
    'div',
    { class: 'prompt', attrs: { 'aria-hidden': 'true' } },
    el('span', 'prompt-key', svg, el('b', { text: 'E' })),
    el('span', 'prompt-body', hintEl, textEl),
  );

  const text = new TextCell(textEl);
  const on = new ClassCell(root, 'on');
  const hold = new ClassCell(root, 'hold');
  const holding = new ClassCell(root, 'holding');
  const offset = new StyleCell(ring as unknown as SVGElement, 'stroke-dashoffset');
  const label = new AttrCell(root, 'data-label');
  let lastPrompt = '';

  return {
    el: root,
    update() {
      const s = ctx.state;
      const cur = s.flow === 'playing' && s.player.alive && s.ui.modal === null ? ctx.interactions.current : null;
      const prompt = cur ? cur.prompt() : null;
      if (!cur || prompt === null) {
        on.set(false);
        return;
      }
      on.set(true);
      if (prompt !== lastPrompt) {
        lastPrompt = prompt;
        text.set(prompt);
        label.set(`E — ${prompt}`);
      }
      const isHold = cur.holdSeconds > 0;
      hold.set(isHold);
      const progress = isHold ? Math.min(1, Math.max(0, ctx.interactions.progress)) : 0;
      holding.set(progress > 0);
      offset.set(num(quant(CIRC * (1 - progress), 0.4), 1));
    },
  };
}
