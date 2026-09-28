/** Punto de mira dinámico (dispersión) y marcadores de impacto (hit markers). */
import { HUD, THEME } from '../../config';
import type { HitZone } from '../../core/types';
import { ClassCell, StyleCell, el, num, play, quant, svgEl } from '../dom';
import type { HudEnv, Widget } from './types';

interface HitStyle {
  color: string;
  scale: number;
  ring: boolean;
  ms: number;
}

/** Aspecto del marcador: blanco cuerpo, amarillo casco, rojo muerte; la cabeza es más grande. */
function hitStyle(zone: HitZone, killed: boolean, helmet: boolean): HitStyle {
  const head = zone === 'head';
  const scale = (head ? 1.5 : zone === 'limb' ? 0.9 : 1) * (killed ? 1.2 : 1);
  const color = killed ? THEME.danger : helmet ? THEME.reward : '#ffffff';
  return { color, scale, ring: head || helmet, ms: (killed ? HUD.hit.killDurationS : HUD.hit.durationS) * 1000 };
}

export function createReticle(env: HudEnv): Widget {
  const { ctx } = env;

  // Cuatro marcas + punto central.
  const ticks = ['t', 'b', 'l', 'r'].map((k) => el('i', `rt rt-${k}`));
  const dot = el('i', 'rt-dot');
  const root = el('div', { class: 'reticle', attrs: { 'aria-hidden': 'true' } }, ...ticks, dot);

  // Marcador de impacto: aspa de cuatro trazos + anillo (cabeza).
  const arms = svgEl(
    'g',
    { stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linecap': 'round', fill: 'none' },
    ...[45, 135, 225, 315].map((deg) => {
      const a = (deg * Math.PI) / 180;
      const p = (r: number, f: (n: number) => number): string => (24 + f(a) * r).toFixed(2);
      return svgEl('line', { x1: p(6, Math.cos), y1: p(6, Math.sin), x2: p(13, Math.cos), y2: p(13, Math.sin) });
    }),
  );
  const ring = svgEl('circle', { cx: 24, cy: 24, r: 3.2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 });
  const hit = svgEl('svg', { viewBox: '0 0 48 48', class: 'hitmark', 'aria-hidden': 'true' }, arms, ring);
  hit.style.opacity = '0';
  root.append(hit);

  const gap = new StyleCell(root, '--g');
  const hidden = new ClassCell(root, 'scoped');
  const aiming = new ClassCell(root, 'aiming');
  let shown = HUD.crosshair.baseGap;
  let hitAnim: Animation | null = null;

  env.scope.on('player:hitConfirm', ({ zone, killed, helmet }) => {
    if (!env.isVisible()) return;
    const s = hitStyle(zone, killed, helmet);
    hit.style.color = s.color;
    ring.style.display = s.ring ? '' : 'none';
    hitAnim?.cancel();
    hitAnim = play(
      hit,
      [
        { opacity: 1, transform: `translate(-50%, -50%) scale(${num(s.scale * 1.35)})` },
        { opacity: 1, transform: `translate(-50%, -50%) scale(${num(s.scale)})`, offset: 0.22 },
        { opacity: 1, transform: `translate(-50%, -50%) scale(${num(s.scale)})`, offset: 0.7 },
        { opacity: 0, transform: `translate(-50%, -50%) scale(${num(s.scale * 0.95)})` },
      ],
      { duration: s.ms, easing: 'ease-out' },
    );
  });

  return {
    el: root,
    update(dt) {
      const p = ctx.state.player;
      const slot = p.slots[p.activeSlot];
      const scoped = p.aiming && !!slot && HUD.crosshair.hideAimingWith.includes(slot.id);
      hidden.set(scoped);
      aiming.set(p.aiming);
      if (scoped) return;
      const target = HUD.crosshair.baseGap + Math.min(1, Math.max(0, p.spread)) * HUD.crosshair.gapPerSpread;
      // Suavizado exponencial (independiente del framerate) para que la apertura no "salte".
      shown += (target - shown) * (1 - Math.exp(-28 * Math.min(dt, 0.05)));
      gap.set(num(quant(shown, 0.15), 2));
    },
    dispose() {
      hitAnim?.cancel();
    },
  };
}
