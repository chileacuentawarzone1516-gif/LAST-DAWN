/** Retrato 2D + nombre del operativo, junto a las barras de vida (abajo-izquierda / abajo-centro en táctil). */
import { TextCell, el } from '../dom';
import { createPortrait } from '../portrait';
import type { HudEnv, Widget } from './types';

export function createOperative(env: HudEnv, vitals: HTMLElement): Widget {
  const { ctx } = env;
  const portrait = createPortrait(ctx, 'portrait hud-portrait');
  const nameEl = el('div', { class: 'operative-name' });
  const root = el('div', 'operative', portrait.el, el('div', 'operative-body', nameEl, vitals));
  const name = new TextCell(nameEl);
  name.set(ctx.state.profile.name);
  const paint = (): void => name.set(ctx.state.profile.name);
  env.scope.on('profile:changed', paint);
  return {
    el: root,
    update(_dt, slow) {
      if (slow) paint();
    },
    dispose() {
      portrait.dispose();
    },
  };
}
