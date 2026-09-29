/**
 * HUD: compone los widgets en las cuatro esquinas y el centro. Los widgets escriben en el
 * DOM sólo cuando cambia el valor; los cálculos con asignaciones corren a ~10 Hz (`slow`).
 */
import type { GameContext } from '../../core/context';
import type { Disposer } from '../dom';
import { el } from '../dom';
import { createBoss, createClock, createContamination } from './clock';
import { createCompass } from './compass';
import { createDamage } from './damage';
import { createInteract } from './interact';
import { createMoney } from './money';
import { createNotifications } from './notify';
import { createOperative } from './operative';
import { createReticle } from './reticle';
import { createTracker } from './tracker';
import type { HudEnv, Widget } from './types';
import { createVitals } from './vitals';
import { createWeapon } from './weapon';
import { createZoneBanner, createZoneLabel } from './zone';

export interface Hud {
  readonly el: HTMLElement;
  readonly visible: boolean;
  setVisible(visible: boolean): void;
  update(dt: number): void;
  dispose(): void;
}

/** Periodo (s) de la actualización lenta de textos y contratos. */
const SLOW_PERIOD = 0.1;

export function createHud(ctx: GameContext, dis: Disposer): Hud {
  const scope = ctx.bus.scope();
  let visible = false;
  const env: HudEnv = { ctx, scope, dis, isVisible: () => visible };

  const tracker = createTracker(env);
  const compass = createCompass(env);
  const clock = createClock(env);
  const contam = createContamination(env);
  const boss = createBoss(env);
  const money = createMoney(env);
  const notes = createNotifications(env);
  const vitals = createVitals(env);
  const operative = createOperative(env, vitals.el);
  const weapon = createWeapon(env);
  const zoneLabel = createZoneLabel(env);
  const zoneBanner = createZoneBanner(env);
  const reticle = createReticle(env);
  const damage = createDamage(env);
  const interact = createInteract(env);

  const widgets: Widget[] = [
    tracker, compass, clock, contam.banner, boss, money, notes, vitals, operative, weapon, zoneLabel, zoneBanner,
    reticle, damage, interact,
  ];

  const root = el(
    'div',
    { class: 'hud', attrs: { hidden: '' } },
    contam.frame,
    el('div', 'hud-tl', tracker.el),
    el('div', 'hud-tc', compass.el, clock.el, contam.banner.el, boss.el),
    el('div', 'hud-tr', money.el, notes.el),
    el('div', 'hud-bl', operative.el),
    el('div', 'hud-br', weapon.el),
    el('div', 'hud-bc', zoneLabel.el),
    el('div', 'hud-banner', zoneBanner.el),
    el('div', 'hud-center', damage.el, reticle.el, interact.el),
  );

  let slowAcc = SLOW_PERIOD;

  return {
    el: root,
    get visible() {
      return visible;
    },
    setVisible(v) {
      if (v === visible) return;
      visible = v;
      root.hidden = !v;
      // Al reaparecer se refresca todo de inmediato.
      slowAcc = SLOW_PERIOD;
    },
    update(dt) {
      if (!visible) return;
      slowAcc += dt;
      const slow = slowAcc >= SLOW_PERIOD;
      if (slow) slowAcc = 0;
      for (const w of widgets) w.update(dt, slow);
    },
    dispose() {
      scope.dispose();
      for (const w of widgets) w.dispose?.();
      root.remove();
    },
  };
}
