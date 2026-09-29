/** Reloj de partida, aviso de contaminación y barra de jefe (Warden). */
import { WARDEN } from '../../config';
import { contaminationDepth, contaminationInside, matchClock } from '../../rules/markers';
import { AttrCell, ClassCell, StyleCell, TextCell, el, num, play, quant } from '../dom';
import { formatClock } from '../../core/util';
import { icon } from '../icons';
import type { HudEnv, Widget } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Reloj
// ─────────────────────────────────────────────────────────────────────────────
export function createClock(env: HudEnv): Widget {
  const { ctx } = env;
  const timeEl = el('div', { class: 'clock-time', attrs: { role: 'timer', 'aria-label': 'Tiempo de partida' } });
  const nextEl = el('div', 'clock-next');
  const root = el('div', 'clock', timeEl, nextEl);
  const time = new TextCell(timeEl);
  const next = new TextCell(nextEl);
  const tone = new AttrCell(root, 'data-tone');
  const kind = new AttrCell(root, 'data-kind');
  let lastSecond = -1;

  env.scope.on('match:warning', () => {
    if (!env.isVisible()) return;
    play(root, [{ transform: 'scale(1)' }, { transform: 'scale(1.12)', offset: 0.25 }, { transform: 'scale(1)' }], { duration: 700, easing: 'ease-out' });
  });

  return {
    el: root,
    update(_dt, slow) {
      const sec = Math.floor(ctx.state.match.elapsed);
      if (sec !== lastSecond) {
        lastSecond = sec;
        time.set(formatClock(sec));
      }
      if (slow) {
        const info = matchClock(ctx.state);
        next.set(info.label);
        tone.set(info.tone);
        kind.set(info.kind);
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Contaminación: borde verde pulsante + aviso central
// ─────────────────────────────────────────────────────────────────────────────
export function createContamination(env: HudEnv): { frame: HTMLElement; banner: Widget } {
  const { ctx } = env;
  const frame = el('div', { class: 'contam-frame', attrs: { 'aria-hidden': 'true' } });
  const edgeEl = el('span', 'contam-edge');
  const banner = el(
    'div',
    { class: 'contam', attrs: { role: 'alert' } },
    el('span', 'contam-ico', icon('toxic')),
    el('span', 'contam-text', el('b', { text: 'CONTAMINACIÓN' }), ' — sal de la zona'),
    edgeEl,
  );
  const frameOn = new ClassCell(frame, 'on');
  const bannerOn = new ClassCell(banner, 'on');
  const edge = new TextCell(edgeEl);
  let lastMeters = -1;

  return {
    frame,
    banner: {
      el: banner,
      update(_dt, slow) {
        const p = ctx.state.player;
        const inside = ctx.state.flow !== 'title' && contaminationInside(p.pos, ctx.state);
        frameOn.set(inside);
        bannerOn.set(inside);
        if (inside && slow) {
          const m = Math.ceil(contaminationDepth(p.pos, ctx.state));
          if (m !== lastMeters) {
            lastMeters = m;
            edge.set(`borde a ${m} m`);
          }
        }
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Barra de jefe
// ─────────────────────────────────────────────────────────────────────────────
export function createBoss(env: HudEnv): Widget {
  const { ctx } = env;
  const hpFill = el('div', 'boss-fill');
  const hpGhost = el('div', 'boss-ghost');
  const helmFill = el('div', 'boss-helm-fill');
  const helmLabel = el('span', 'boss-helm-label');
  const hpTrack = el('div', 'boss-track', hpGhost, hpFill);
  const helmTrack = el('div', 'boss-helm', helmFill);
  const root = el(
    'div',
    { class: 'boss', attrs: { role: 'group', 'aria-label': `${WARDEN.name}: barra de vida` } },
    el('div', 'boss-head', el('span', 'boss-ico', icon('skull')), el('span', { class: 'boss-name', text: WARDEN.name.toUpperCase() }), helmLabel),
    helmTrack,
    hpTrack,
  );
  const on = new ClassCell(root, 'on');
  const broken = new ClassCell(root, 'broken');
  const hp = new StyleCell(hpFill, '--v');
  const ghost = new StyleCell(hpGhost, '--v');
  const helm = new StyleCell(helmFill, '--v');
  const label = new TextCell(helmLabel);
  const meter = new AttrCell(hpTrack, 'aria-valuenow');
  hpTrack.setAttribute('role', 'meter');
  hpTrack.setAttribute('aria-label', 'Vida del Warden');
  hpTrack.setAttribute('aria-valuemin', '0');
  hpTrack.setAttribute('aria-valuemax', '100');
  let ghostV = 1;

  return {
    el: root,
    update(dt) {
      const w = ctx.state.missions.warden;
      const visible = w.engaged && !w.killed && w.status !== 'completed';
      on.set(visible);
      if (!visible) {
        ghostV = 1;
        return;
      }
      const f = Math.min(1, Math.max(0, w.hpFraction));
      ghostV = f >= ghostV ? f : ghostV + (f - ghostV) * Math.min(1, dt * 2.5);
      hp.set(num(quant(f, 0.004)));
      ghost.set(num(quant(ghostV, 0.01)));
      helm.set(num(quant(Math.min(1, Math.max(0, w.helmetBroken ? 0 : w.helmetFraction)), 0.005)));
      broken.set(w.helmetBroken);
      label.set(w.helmetBroken ? 'Casco destruido: apunta a la cabeza' : 'CASCO');
      meter.set(String(Math.round(f * 100)));
    },
  };
}
