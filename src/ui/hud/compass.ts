/**
 * Brújula superior (canvas 2D): rumbo actual, puntos cardinales y marcadores de objetivos
 * con su distancia. Sólo se redibuja cuando cambia el rumbo, la posición (±1 m) o los objetivos.
 */
import { HUD, THEME } from '../../config';
import { dist2D } from '../../core/util';
import { getMarkers, headingDeg, relativeAngle } from '../../rules/markers';
import type { Marker } from '../../rules/markers';
import { el, observeSize } from '../dom';
import { drawIcon } from '../icons';
import type { IconName } from '../icons';
import type { HudEnv, Widget } from './types';

const MARKER_ICON: Record<Marker['kind'], IconName> = {
  relay: 'relay', warden: 'skull', lz: 'lz', radio: 'radio', heli: 'heli', armory: 'crate', cage: 'cage', gate: 'gate',
};

/** Etiquetas cada 45°, en español (Oeste = O). */
const LABELS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };

/** Distancia (m) por debajo de la cual dos marcadores se consideran el mismo punto. */
const DEDUPE_M = 6;

export function createCompass(env: HudEnv): Widget {
  const { ctx } = env;
  const canvas = el('canvas', { class: 'compass-canvas', attrs: { 'aria-hidden': 'true' } });
  const root = el('div', { class: 'compass' }, canvas);
  const g = canvas.getContext('2d');

  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let unit = 13;
  let dirty = true;
  let lastHeadingQ = Number.NaN;
  let lastPx = Number.NaN;
  let lastPz = Number.NaN;
  let markers: Marker[] = [];
  let signature = '';

  env.dis.add(
    observeSize(canvas, (w, h) => {
      dpr = Math.min(3, window.devicePixelRatio || 1);
      cssW = w;
      cssH = h;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      unit = parseFloat(getComputedStyle(root).fontSize) || 13;
      dirty = true;
    }),
  );

  const refreshMarkers = (): void => {
    const all = getMarkers(ctx.state);
    const chosen: Marker[] = [];
    let sig = '';
    // Prioridad: helicóptero y objetivos activos; los duplicados por posición se descartan.
    for (const m of all) {
      if (!m.active) continue;
      if (chosen.some((c) => dist2D(c.x, c.z, m.x, m.z) < DEDUPE_M)) continue;
      chosen.push(m);
      sig += `${m.id};`;
    }
    if (sig !== signature) {
      signature = sig;
      markers = chosen;
      dirty = true;
    }
  };

  const draw = (heading: number, px: number, pz: number, yaw: number): void => {
    if (!g || cssW <= 0) return;
    const u = unit;
    const W = cssW;
    const H = cssH;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const half = HUD.compass.halfFovDeg;
    const pad = u * 1.4;
    const usable = W / 2 - pad;
    const cx = W / 2;
    const tickBase = H - u * 0.35;
    const labelY = H - u * 1.55;

    // Línea base.
    g.strokeStyle = 'rgba(214, 228, 245, 0.28)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(pad * 0.4, tickBase + 0.5);
    g.lineTo(W - pad * 0.4, tickBase + 0.5);
    g.stroke();

    // Marcas y letras.
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const step = HUD.compass.tickDeg;
    const first = Math.ceil((heading - half) / step) * step;
    for (let deg = first; deg <= heading + half; deg += step) {
      const x = cx + ((deg - heading) / half) * usable;
      const norm = ((deg % 360) + 360) % 360;
      const label = LABELS[norm];
      const major = norm % 45 === 0;
      const edgeFade = 1 - Math.pow(Math.abs(deg - heading) / half, 3);
      g.globalAlpha = Math.max(0.15, edgeFade);
      g.strokeStyle = major ? THEME.text : 'rgba(214, 228, 245, 0.55)';
      g.lineWidth = major ? 1.6 : 1;
      g.beginPath();
      g.moveTo(x, tickBase);
      g.lineTo(x, tickBase - (major ? u * 0.7 : u * 0.4));
      g.stroke();
      if (label) {
        const cardinal = norm % 90 === 0;
        g.fillStyle = norm === 0 ? THEME.danger : cardinal ? THEME.text : THEME.textDim;
        g.font = `${cardinal ? 700 : 600} ${cardinal ? u * 1.05 : u * 0.8}px ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace`;
        g.fillText(label, x, labelY);
      }
    }
    g.globalAlpha = 1;

    // Marcadores de objetivos (los lejanos primero para que los cercanos queden encima).
    const iconY = u * 0.95;
    const textY = u * 2.25;
    const size = u * 1.25;
    const view: Array<{ m: Marker; off: number; d: number }> = [];
    for (const m of markers) {
      view.push({ m, off: relativeAngle(yaw, { x: px, z: pz }, m), d: dist2D(px, pz, m.x, m.z) });
    }
    view.sort((a, b) => b.d - a.d);
    g.font = `600 ${u * 0.72}px ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace`;
    for (const { m, off, d } of view) {
      const relDeg = (off * 180) / Math.PI;
      const clamped = Math.abs(relDeg) > half;
      const x = cx + Math.max(-1, Math.min(1, relDeg / half)) * usable;
      g.globalAlpha = clamped ? 0.5 : 1;
      drawIcon(g, MARKER_ICON[m.kind], x, iconY, size, m.color);
      g.fillStyle = THEME.text;
      g.fillText(d >= 1000 ? `${(d / 1000).toFixed(1)}km` : `${Math.round(d)}m`, x, textY);
      if (clamped) {
        // Chevron hacia el lado por el que hay que girar.
        const s = relDeg > 0 ? 1 : -1;
        g.strokeStyle = m.color;
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(x + s * u * 0.95, iconY - u * 0.35);
        g.lineTo(x + s * u * 1.3, iconY);
        g.lineTo(x + s * u * 0.95, iconY + u * 0.35);
        g.stroke();
      }
    }
    g.globalAlpha = 1;

    // Pastilla central con el rumbo numérico + muesca.
    const txt = `${String(Math.round(heading) % 360).padStart(3, '0')}°`;
    g.font = `700 ${u * 0.95}px ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace`;
    const tw = g.measureText(txt).width + u * 0.9;
    g.fillStyle = 'rgba(7, 11, 20, 0.92)';
    g.fillRect(cx - tw / 2, labelY - u * 0.75, tw, u * 1.5);
    g.strokeStyle = 'rgba(95, 224, 183, 0.6)';
    g.lineWidth = 1;
    g.strokeRect(cx - tw / 2 + 0.5, labelY - u * 0.75 + 0.5, tw - 1, u * 1.5 - 1);
    g.fillStyle = THEME.accent;
    g.fillText(txt, cx, labelY + 0.5);
    g.beginPath();
    g.moveTo(cx - u * 0.42, tickBase + u * 0.05);
    g.lineTo(cx + u * 0.42, tickBase + u * 0.05);
    g.lineTo(cx, tickBase - u * 0.5);
    g.closePath();
    g.fillStyle = THEME.accent;
    g.fill();
  };

  return {
    el: root,
    update(_dt, slow) {
      if (slow) refreshMarkers();
      const p = ctx.state.player;
      const h = headingDeg(p.yaw);
      const hq = Math.round(h * 4) / 4;
      const px = Math.round(p.pos.x);
      const pz = Math.round(p.pos.z);
      if (!dirty && hq === lastHeadingQ && px === lastPx && pz === lastPz) return;
      dirty = false;
      lastHeadingQ = hq;
      lastPx = px;
      lastPz = pz;
      draw(hq, p.pos.x, p.pos.z, p.yaw);
    },
  };
}
