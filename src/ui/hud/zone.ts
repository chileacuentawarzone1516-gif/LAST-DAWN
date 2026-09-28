/** Etiqueta de zona con píldoras de amenaza (abajo-centro) y banner al entrar en una zona nueva. */
import { HUD, THEME } from '../../config';
import type { ZoneId } from '../../core/types';
import { threatPips } from '../../rules/markers';
import { threatOf, zoneName } from '../../rules/zones';
import { AttrCell, StyleCell, TextCell, el, play } from '../dom';
import type { HudEnv, Widget } from './types';

function pips(): { box: HTMLElement; set: (threat: number) => void } {
  const items = [0, 1, 2, 3].map(() => el('i', 'pip'));
  const box = el('span', { class: 'pips', attrs: { 'aria-hidden': 'true' } }, ...items);
  let last = -1;
  return {
    box,
    set(threat) {
      if (threat === last) return;
      last = threat;
      const on = threatPips(threat, items.length);
      items.forEach((it, i) => it.classList.toggle('on', on[i] === true));
    },
  };
}

export function createZoneLabel(env: HudEnv): Widget {
  const { ctx } = env;
  const nameEl = el('span', 'zone-name');
  const threatEl = el('span', 'zone-threat');
  const p = pips();
  const root = el(
    'div',
    { class: 'zone', attrs: { role: 'group', 'aria-label': 'Zona actual' } },
    el('span', { class: 'zone-tag', text: 'ZONA' }),
    nameEl,
    p.box,
    threatEl,
  );
  const name = new TextCell(nameEl);
  const threatText = new TextCell(threatEl);
  const color = new StyleCell(root, '--zc');
  let lastZone: ZoneId | null = null;

  return {
    el: root,
    update() {
      const z = ctx.state.player.zone;
      if (z === lastZone) return;
      lastZone = z;
      const threat = threatOf(z);
      name.set(zoneName(z));
      threatText.set(`Amenaza ${threat}/4`);
      color.set(THEME.zoneColors[z]);
      p.set(threat);
    },
  };
}

export function createZoneBanner(env: HudEnv): Widget {
  const nameEl = el('div', 'zb-name');
  const p = pips();
  const threatEl = el('span', 'zb-threat');
  const root = el(
    'div',
    { class: 'zone-banner', attrs: { role: 'status', 'aria-live': 'polite' } },
    el('div', { class: 'zb-tag', text: 'ENTRANDO EN' }),
    nameEl,
    el('div', 'zb-meta', p.box, threatEl),
  );
  root.style.opacity = '0';
  const name = new TextCell(nameEl);
  const threatText = new TextCell(threatEl);
  const color = new StyleCell(root, '--zc');
  const kind = new AttrCell(root, 'data-zone');
  let anim: Animation | null = null;

  env.scope.on('zone:entered', ({ zone, threat }) => {
    if (!env.isVisible()) return;
    name.set(zoneName(zone));
    threatText.set(`Amenaza ${threat}/4`);
    color.set(THEME.zoneColors[zone]);
    kind.set(zone);
    p.set(threat);
    anim?.cancel();
    const total = HUD.zoneBannerS * 1000;
    anim = play(
      root,
      [
        { opacity: 0, transform: 'translateY(-0.5em)' },
        { opacity: 1, transform: 'translateY(0)', offset: 0.1 },
        { opacity: 1, transform: 'translateY(0)', offset: 0.8 },
        { opacity: 0, transform: 'translateY(0.3em)' },
      ],
      { duration: total, easing: 'ease-out' },
    );
  });

  return {
    el: root,
    update() {},
    dispose() {
      anim?.cancel();
    },
  };
}
