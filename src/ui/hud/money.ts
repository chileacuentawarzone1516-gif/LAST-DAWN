/** Dinero (arriba-derecha) con importes flotantes ('+$150') al cambiar el saldo. */
import { THEME } from '../../config';
import { TextCell, el, play } from '../dom';
import { formatDelta, formatMoney } from '../format';
import { icon } from '../icons';
import type { HudEnv, Widget } from './types';

const POOL = 5;
/** Ventana (ms) en la que varios cobros seguidos se suman en un solo importe flotante. */
const MERGE_MS = 380;

interface Floater {
  node: HTMLElement;
  busy: boolean;
  anim: Animation | null;
  delta: number;
  at: number;
}

export function createMoney(env: HudEnv): Widget {
  const { ctx } = env;
  const valueEl = el('span', 'money-val');
  const floats = el('div', { class: 'money-floats', attrs: { 'aria-hidden': 'true' } });
  const root = el(
    'div',
    { class: 'money', attrs: { role: 'group', 'aria-label': 'Dinero' } },
    el('span', 'money-ico', icon('money')),
    valueEl,
    floats,
  );
  const value = new TextCell(valueEl);
  let lastMoney = Number.NaN;

  const pool: Floater[] = [];
  for (let i = 0; i < POOL; i++) {
    const node = el('span', 'money-float');
    node.hidden = true;
    floats.append(node);
    pool.push({ node, busy: false, anim: null, delta: 0, at: 0 });
  }
  let last: Floater | null = null;

  const show = (f: Floater): void => {
    f.node.textContent = formatDelta(f.delta);
    f.node.dataset.sign = f.delta >= 0 ? 'gain' : 'loss';
    f.node.hidden = false;
    f.anim?.cancel();
    const a = play(
      f.node,
      [
        { opacity: 0, transform: 'translateY(0.6em)' },
        { opacity: 1, transform: 'translateY(0)', offset: 0.14 },
        { opacity: 1, transform: 'translateY(-0.5em)', offset: 0.7 },
        { opacity: 0, transform: 'translateY(-1.2em)' },
      ],
      { duration: 1500, easing: 'ease-out' },
    );
    f.anim = a;
    f.busy = true;
    if (a) {
      a.onfinish = () => {
        if (f.anim === a) {
          f.busy = false;
          f.node.hidden = true;
          if (last === f) last = null;
        }
      };
    } else {
      f.busy = false;
    }
  };

  env.scope.on('money:changed', ({ delta }) => {
    if (!env.isVisible() || delta === 0) return;
    const now = performance.now();
    // Suma cobros consecutivos del mismo signo en un único flotante.
    if (last && last.busy && now - last.at < MERGE_MS && Math.sign(last.delta) === Math.sign(delta)) {
      last.delta += delta;
      last.at = now;
      show(last);
    } else {
      const free = pool.find((f) => !f.busy) ?? pool[0]!;
      free.delta = delta;
      free.at = now;
      last = free;
      show(free);
    }
    play(valueEl, [{ color: delta > 0 ? THEME.reward : THEME.danger }, { color: THEME.text }], { duration: 650, easing: 'ease-out' });
  });

  return {
    el: root,
    update() {
      const m = ctx.state.player.money;
      if (m !== lastMoney) {
        lastMoney = m;
        value.set(formatMoney(m));
      }
    },
    dispose() {
      for (const f of pool) f.anim?.cancel();
    },
  };
}
