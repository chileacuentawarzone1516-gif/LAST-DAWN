/**
 * Indicadores direccionales de daño: arcos alrededor del punto de mira que giran con la
 * cámara. No hay viñeta a pantalla completa (la aplica el motor).
 */
import { HUD, THEME } from '../../config';
import { relativeAngle } from '../../rules/markers';
import { StyleCell, el, num, play, quant, svgEl } from '../dom';
import type { HudEnv, Widget } from './types';

interface Arc {
  el: HTMLElement;
  rot: StyleCell;
  /** Posición del atacante en el momento del golpe (los arcos siguen apuntando ahí al girar). */
  x: number;
  z: number;
  busy: boolean;
  anim: Animation | null;
  /** Ángulo mostrado (grados) para fusionar golpes cercanos. */
  deg: number;
}

/** Arco de ~46° en la parte superior de un anillo de radio 46 (viewBox 100). */
const ARC_PATH = (() => {
  const r = 46;
  const half = (23 * Math.PI) / 180;
  const x = (s: number): string => (50 + s * r * Math.sin(half)).toFixed(2);
  const y = (50 - r * Math.cos(half)).toFixed(2);
  return `M${x(-1)} ${y}A${r} ${r} 0 0 1 ${x(1)} ${y}`;
})();

export function createDamage(env: HudEnv): Widget {
  const { ctx } = env;
  const root = el('div', { class: 'dmg', attrs: { 'aria-hidden': 'true' } });
  const arcs: Arc[] = [];
  for (let i = 0; i < HUD.damage.max; i++) {
    const path = svgEl('path', { d: ARC_PATH, fill: 'none', 'stroke-width': 5, 'stroke-linecap': 'round', stroke: 'currentColor' });
    const glow = svgEl('path', { d: ARC_PATH, fill: 'none', 'stroke-width': 9, 'stroke-linecap': 'round', stroke: 'currentColor', opacity: 0.25 });
    const node = el('div', 'dmg-arc', svgEl('svg', { viewBox: '0 0 100 100' }, glow, path));
    node.style.opacity = '0';
    root.append(node);
    arcs.push({ el: node, rot: new StyleCell(node, 'transform'), x: 0, z: 0, busy: false, anim: null, deg: 0 });
  }

  /** Ángulo (grados, + = derecha) hacia un punto del mundo respecto a la vista actual. */
  const angleTo = (x: number, z: number): number => {
    const p = ctx.state.player;
    return (relativeAngle(p.yaw, p.pos, { x, z }) * 180) / Math.PI;
  };

  env.scope.on('player:damaged', ({ from, amount, hpDamage }) => {
    if (!env.isVisible() || !from) return;
    const p = ctx.state.player;
    // Un atacante encima del jugador no tiene dirección útil.
    if (Math.hypot(from.x - p.pos.x, from.z - p.pos.z) < 0.4) return;
    const deg = angleTo(from.x, from.z);
    // Fusiona con un arco vivo que apunte casi a la misma dirección.
    let arc = arcs.find((a) => {
      if (!a.busy) return false;
      const d = Math.abs(((angleTo(a.x, a.z) - deg + 540) % 360) - 180);
      return d < HUD.damage.mergeDeg;
    });
    arc ??= arcs.find((a) => !a.busy) ?? arcs[0]!;
    arc.x = from.x;
    arc.z = from.z;
    arc.deg = deg;
    arc.busy = true;
    arc.el.style.color = hpDamage > 0 ? THEME.danger : THEME.info;
    arc.rot.set(`rotate(${num(quant(deg, 0.5), 1)}deg)`);
    arc.anim?.cancel();
    const peak = 0.55 + 0.45 * Math.min(1, amount / 30);
    const self = arc;
    const a = play(
      arc.el,
      [{ opacity: peak }, { opacity: peak, offset: 0.35 }, { opacity: 0 }],
      { duration: HUD.damage.lifeS * 1000, easing: 'ease-out' },
    );
    self.anim = a;
    if (a) {
      a.onfinish = () => {
        if (self.anim === a) {
          self.busy = false;
          self.anim = null;
        }
      };
    } else {
      self.busy = false;
    }
  });

  return {
    el: root,
    update() {
      for (const a of arcs) {
        if (!a.busy) continue;
        a.rot.set(`rotate(${num(quant(angleTo(a.x, a.z), 0.5), 1)}deg)`);
      }
    },
    dispose() {
      for (const a of arcs) a.anim?.cancel();
    },
  };
}
