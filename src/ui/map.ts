/**
 * Mapa táctico (tecla M): overlay a pantalla completa con canvas 2D nítido (DPR), norte
 * arriba, rejilla con ejes, las cuatro zonas, la nube de contaminación y los marcadores de
 * contratos. NO muestra enemigos. La capa estática se dibuja una vez por tamaño.
 */
import { CONTAMINATION, MAP, THEME } from '../config';
import type { GameContext } from '../core/context';
import { formatClock } from '../core/util';
import { getMarkers, headingDeg, matchClock, threatPips, formatObjective } from '../rules/markers';
import type { Marker } from '../rules/markers';
import { zoneAt, zoneName } from '../rules/zones';
import { AttrCell, MONO_FONT, TextCell, el, observeSize, svgEl } from './dom';
import type { Disposer } from './dom';
import { drawIcon, icon } from './icons';
import type { IconName } from './icons';

const MARKER_ICON: Record<Marker['kind'], IconName> = {
  relay: 'relay', warden: 'skull', lz: 'lz', radio: 'radio', heli: 'heli', armory: 'crate', cage: 'cage', gate: 'gate',
};

/** Leyenda: una entrada por tipo de marcador (id del marcador representativo). */
const LEGEND: Array<{ id: string; kind: Marker['kind']; text: string }> = [
  { id: 'relay', kind: 'relay', text: 'Relé de comunicaciones' },
  { id: 'warden', kind: 'warden', text: 'El Warden' },
  { id: 'lz', kind: 'lz', text: 'Zona de extracción (LZ)' },
  { id: 'radio', kind: 'radio', text: 'Radio del LZ' },
  { id: 'heli', kind: 'heli', text: 'Helicóptero' },
  { id: 'armory', kind: 'armory', text: 'Banco de armería' },
  { id: 'cage_perimeter', kind: 'cage', text: 'Jaula de suministro' },
  { id: 'gate', kind: 'gate', text: 'Puerta del complejo' },
];

/** Nombres cortos de zona para mapas pequeños (móvil). */
const SHORT_ZONE: Record<string, string> = { perimeter: 'Perímetro Sur', warehouses: 'Almacenes', refinery: 'Refinería', complex: 'Complejo' };
/** Por debajo de este lado (px) el mapa se considera compacto: menos rótulos para que no se solapen. */
const COMPACT_PX = 560;

const B = MAP.bounds;
const SPAN = B.maxX - B.minX;
/** Margen (px CSS) para los rótulos de los ejes. */
const MARGIN = 22;
const GRID_M = 50;

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export interface TacticalMap {
  readonly el: HTMLElement;
  /** Visibilidad (la decide index.ts a partir de state.ui.modal). */
  setOpen(open: boolean): void;
  update(dt: number): void;
}

export function createTacticalMap(ctx: GameContext, dis: Disposer): TacticalMap {
  const canvas = el('canvas', {
    class: 'map-canvas',
    attrs: { role: 'img', 'aria-label': 'Mapa táctico del distrito, norte arriba' },
  });
  const wrap = el('div', 'map-canvas-wrap', canvas);
  const g = canvas.getContext('2d');
  const stat = document.createElement('canvas');
  const sg = stat.getContext('2d');

  // ── Panel lateral ─────────────────────────────────────────────────────────
  const legendItems = new Map<string, HTMLElement>();
  const legendList = el('ul', 'legend');
  const youIcon = svgEl(
    'svg',
    { viewBox: '0 0 24 24', class: 'ico', 'aria-hidden': 'true' },
    svgEl('path', { d: 'M12 3 19 20l-7-4-7 4z', fill: THEME.accent }),
  );
  legendList.append(el('li', 'legend-item', el('span', 'legend-ico', youIcon), el('span', { text: 'Tú (rumbo y campo de visión)' })));
  for (const e of LEGEND) {
    const color = getMarkers(ctx.state).find((m) => m.id === e.id)?.color ?? THEME.text;
    const item = el('li', { class: 'legend-item', attrs: { 'data-id': e.id } }, el('span', { class: 'legend-ico', attrs: { style: `color:${color}` } }, icon(MARKER_ICON[e.kind])), el('span', { text: e.text }));
    legendItems.set(e.id, item);
    legendList.append(item);
  }
  const contamStatusEl = el('span', 'legend-status');
  legendList.append(
    el('li', { class: 'legend-item', attrs: { 'data-id': 'contam' } }, el('span', { class: 'legend-ico', attrs: { style: `color:${THEME.accent}` } }, icon('toxic')), el('span', { text: 'Contaminación' }), contamStatusEl),
  );

  const zoneList = el(
    'ul',
    'legend zone-legend',
    ...[...MAP.zones].reverse().map((z) => {
      const items = threatPips(z.threat).map((on) => el('i', { class: on ? 'pip on' : 'pip' }));
      return el(
        'li',
        { class: 'legend-item', attrs: { 'data-zone': z.id } },
        el('span', { class: 'swatch', attrs: { style: `background:${THEME.zoneColors[z.id]}` } }),
        el('span', { class: 'zone-legend-name', text: z.name }),
        el('span', { class: 'pips', attrs: { 'aria-hidden': 'true' } }, ...items),
      );
    }),
  );

  const objectivesEl = el('ul', 'map-objectives');
  const objCells = [0, 1, 2].map(() => {
    const titleEl = el('span', 'obj-title');
    const textEl = el('span', 'obj-text');
    const li = el('li', 'obj', titleEl, textEl);
    objectivesEl.append(li);
    return { title: new TextCell(titleEl), text: new TextCell(textEl), status: new AttrCell(li, 'data-status') };
  });

  const side = el(
    'aside',
    'map-side',
    el('h3', { class: 'sec-title', text: 'Contratos' }),
    objectivesEl,
    el('h3', { class: 'sec-title', text: 'Leyenda' }),
    legendList,
    el('h3', { class: 'sec-title', text: 'Zonas' }),
    zoneList,
  );

  // ── Cabecera ──────────────────────────────────────────────────────────────
  const whereEl = el('span', 'map-where');
  const clockEl = el('span', 'map-clock');
  const srEl = el('p', { class: 'sr-only', attrs: { 'aria-live': 'off' } });
  const closeBtn = el('button', { class: 'btn btn-ghost btn-icon map-close-btn', attrs: { type: 'button', 'aria-label': 'Cerrar mapa' } }, icon('cross'), el('span', { class: 'btn-label', text: 'Cerrar' }));
  dis.listen(closeBtn, 'click', () => {
    if (ctx.state.ui.modal === 'map') ctx.state.ui.modal = null;
  });
  const head = el(
    'header',
    'map-head',
    el('h2', { class: 'map-title', id: 'ds-map-h' }, 'MAPA TÁCTICO'),
    whereEl,
    clockEl,
    el('span', 'map-close', el('kbd', { text: 'M' }), ' / ', el('kbd', { text: 'Esc' }), ' cerrar'),
    closeBtn,
  );
  const root = el(
    'section',
    { class: 'map', attrs: { role: 'dialog', 'aria-labelledby': 'ds-map-h', hidden: '' } },
    el('div', 'map-frame', head, el('div', 'map-body', wrap, side), srEl),
  );

  const where = new TextCell(whereEl);
  const clock = new TextCell(clockEl);
  const clockTone = new AttrCell(clockEl, 'data-tone');
  const contamStatus = new TextCell(contamStatusEl);
  const sr = new TextCell(srEl);

  // ── Geometría ────────────────────────────────────────────────────────────
  let size = 0;
  let dpr = 1;
  let k = 1;
  let staticDirty = true;
  let open = false;
  const wx = (x: number): number => MARGIN + (x - B.minX) * k;
  const wz = (z: number): number => MARGIN + (z - B.minZ) * k;

  dis.add(
    observeSize(wrap, (w, h) => {
      const s = Math.floor(Math.max(120, Math.min(w, h)));
      if (s === size) return;
      size = s;
      dpr = Math.min(3, window.devicePixelRatio || 1);
      k = (size - MARGIN * 2) / SPAN;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      stat.width = canvas.width;
      stat.height = canvas.height;
      staticDirty = true;
    }),
  );

  const halo = (c: CanvasRenderingContext2D, text: string, x: number, y: number): void => {
    c.lineWidth = 3.5;
    c.strokeStyle = 'rgba(7, 11, 20, 0.92)';
    c.lineJoin = 'round';
    c.strokeText(text, x, y);
    c.fillText(text, x, y);
  };

  /** Capa estática: fondo, zonas, rejilla, ejes, rótulos de zona, escala y rosa de los vientos. */
  const paintStatic = (): void => {
    if (!sg || size <= 0) return;
    const c = sg;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, size, size);
    const x0 = wx(B.minX);
    const z0 = wz(B.minZ);
    const wpx = SPAN * k;

    c.fillStyle = '#0a1120';
    c.fillRect(x0, z0, wpx, wpx);

    // Zonas: se pintan de menor a mayor prioridad (la primera de MAP.zones gana al solaparse).
    for (const z of [...MAP.zones].reverse()) {
      const r = z.rect;
      const col = THEME.zoneColors[z.id];
      c.fillStyle = rgba(col, 0.12 + z.threat * 0.02);
      c.fillRect(wx(r.minX), wz(r.minZ), (r.maxX - r.minX) * k, (r.maxZ - r.minZ) * k);
      c.strokeStyle = rgba(col, 0.55);
      c.lineWidth = 1.5;
      c.setLineDash([6, 4]);
      c.strokeRect(wx(r.minX) + 0.75, wz(r.minZ) + 0.75, (r.maxX - r.minX) * k - 1.5, (r.maxZ - r.minZ) * k - 1.5);
      c.setLineDash([]);
    }

    // Rejilla cada 50 m; líneas mayores cada 100 m.
    for (let m = B.minX; m <= B.maxX + 0.001; m += GRID_M) {
      const major = Math.abs(m) % 100 === 0;
      c.strokeStyle = major ? 'rgba(168, 196, 235, 0.16)' : 'rgba(168, 196, 235, 0.07)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(Math.round(wx(m)) + 0.5, z0);
      c.lineTo(Math.round(wx(m)) + 0.5, z0 + wpx);
      c.moveTo(x0, Math.round(wz(m)) + 0.5);
      c.lineTo(x0 + wpx, Math.round(wz(m)) + 0.5);
      c.stroke();
    }

    // Ejes: columnas A–H (oeste→este) y filas 1–8 (norte→sur).
    c.fillStyle = THEME.textDim;
    c.font = `600 ${Math.max(10, size * 0.017)}px ${MONO_FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const cells = SPAN / GRID_M;
    for (let i = 0; i < cells; i++) {
      const mid = B.minX + (i + 0.5) * GRID_M;
      c.fillText(String.fromCharCode(65 + i), wx(mid), MARGIN * 0.5);
      c.fillText(String(i + 1), MARGIN * 0.5, wz(B.minZ + (i + 0.5) * GRID_M));
      c.fillText(String.fromCharCode(65 + i), wx(mid), size - MARGIN * 0.5);
      c.fillText(String(i + 1), size - MARGIN * 0.5, wz(B.minZ + (i + 0.5) * GRID_M));
    }

    // Marco.
    c.strokeStyle = 'rgba(214, 228, 245, 0.45)';
    c.lineWidth = 1.5;
    c.strokeRect(x0 + 0.5, z0 + 0.5, wpx - 1, wpx - 1);

    // Rótulos de zona (esquina noroeste visible de cada una) con píldoras de amenaza.
    c.textAlign = 'left';
    c.textBaseline = 'top';
    const fs = Math.max(10, size * 0.0175);
    for (const z of MAP.zones) {
      const r = z.rect;
      const col = THEME.zoneColors[z.id];
      const tx = wx(r.minX) + 8;
      const ty = wz(r.minZ) + 8;
      c.font = `700 ${fs}px ${MONO_FONT}`;
      c.fillStyle = col;
      halo(c, (size < COMPACT_PX ? (SHORT_ZONE[z.id] ?? z.name) : z.name).toUpperCase(), tx, ty);
      const pips = threatPips(z.threat);
      for (let i = 0; i < pips.length; i++) {
        c.fillStyle = pips[i] ? col : 'rgba(214, 228, 245, 0.2)';
        c.fillRect(tx + i * (fs * 0.9), ty + fs * 1.35, fs * 0.62, fs * 0.42);
      }
    }

    // Barra de escala (100 m) y flecha norte.
    const barY = z0 + wpx - 12;
    const barX = x0 + 12;
    c.strokeStyle = THEME.text;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(barX, barY - 4);
    c.lineTo(barX, barY);
    c.lineTo(barX + 100 * k, barY);
    c.lineTo(barX + 100 * k, barY - 4);
    c.stroke();
    c.font = `600 ${Math.max(9, size * 0.016)}px ${MONO_FONT}`;
    c.fillStyle = THEME.text;
    c.textAlign = 'left';
    c.textBaseline = 'bottom';
    halo(c, '100 m', barX + 100 * k + 6, barY + 4);

    const nx = x0 + wpx - 20;
    const ny = z0 + 14;
    c.fillStyle = THEME.text;
    c.beginPath();
    c.moveTo(nx, ny);
    c.lineTo(nx + 6, ny + 18);
    c.lineTo(nx, ny + 14);
    c.lineTo(nx - 6, ny + 18);
    c.closePath();
    c.fill();
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.font = `700 ${Math.max(10, size * 0.02)}px ${MONO_FONT}`;
    halo(c, 'N', nx, ny + 20);
    staticDirty = false;
  };

  const labelFor = (m: Marker): { dx: number; dy: number; align: CanvasTextAlign; base: CanvasTextBaseline } => {
    switch (m.kind) {
      case 'lz': return { dx: 0, dy: 15, align: 'center', base: 'top' };
      case 'armory': return { dx: -14, dy: 0, align: 'right', base: 'middle' };
      case 'radio': return { dx: 14, dy: 4, align: 'left', base: 'middle' };
      case 'heli': return { dx: 14, dy: 0, align: 'left', base: 'middle' };
      case 'gate': return { dx: 0, dy: -15, align: 'center', base: 'bottom' };
      default: return { dx: 14, dy: 0, align: 'left', base: 'middle' };
    }
  };

  const paint = (t: number): void => {
    if (!g || size <= 0) return;
    if (staticDirty) paintStatic();
    const st = ctx.state;
    const c = g;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, size, size);
    c.drawImage(stat, 0, 0, size, size);

    const x0 = wx(B.minX);
    const z0 = wz(B.minZ);
    const wpx = SPAN * k;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);

    // Contaminación (recortada al distrito).
    const cont = st.match.contamination;
    if (cont.active && cont.radius > 0) {
      c.save();
      c.beginPath();
      c.rect(x0, z0, wpx, wpx);
      c.clip();
      const cx = wx(CONTAMINATION.center.x);
      const cz = wz(CONTAMINATION.center.z);
      const r = cont.radius * k;
      const grad = c.createRadialGradient(cx, cz, r * 0.2, cx, cz, r);
      grad.addColorStop(0, rgba(THEME.accent, 0.1 + pulse * 0.05));
      grad.addColorStop(1, rgba(THEME.accent, 0.26 + pulse * 0.08));
      c.fillStyle = grad;
      c.beginPath();
      c.arc(cx, cz, r, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = rgba(THEME.accent, 0.95);
      c.lineWidth = 2.2;
      c.setLineDash([9, 6]);
      c.lineDashOffset = -t * 14;
      c.stroke();
      c.setLineDash([]);
      c.lineDashOffset = 0;
      c.restore();
      if (size >= COMPACT_PX) {
        c.font = `700 ${Math.max(10, size * 0.017)}px ${MONO_FONT}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = THEME.accent;
        const ly = Math.max(z0 + 30, cz - r + 14);
        halo(c, 'CONTAMINACIÓN', cx, Math.min(ly, z0 + wpx - 14));
      }
    }

    // Marcadores.
    const markers = getMarkers(st);
    const hasHeli = markers.some((m) => m.kind === 'heli');
    c.font = `700 ${Math.max(10, size * 0.0165)}px ${MONO_FONT}`;
    const isz = Math.max(16, size * 0.034);

    // Círculos asociados (relé y helipuerto) bajo los iconos.
    for (const m of markers) {
      if (!m.radius) continue;
      const cx = wx(m.x);
      const cz = wz(m.z);
      const rr = Math.max(m.radius * k, 10);
      c.strokeStyle = rgba(m.color, m.active ? 0.5 + pulse * 0.45 : 0.3);
      c.fillStyle = rgba(m.color, m.active ? 0.14 : 0.05);
      c.lineWidth = m.active ? 2 : 1.2;
      c.setLineDash(m.kind === 'relay' ? [4, 3] : []);
      c.beginPath();
      c.arc(cx, cz, rr, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.setLineDash([]);
    }

    for (const m of markers) {
      const cx = wx(m.x);
      let cz = wz(m.z);
      if (m.kind === 'heli' && hasHeli) cz -= isz * 1.05;
      const dim = !m.active && m.kind !== 'lz';
      c.globalAlpha = dim ? 0.78 : 1;
      // Disco de fondo para que el icono se lea sobre cualquier zona.
      c.fillStyle = 'rgba(7, 11, 20, 0.88)';
      c.beginPath();
      c.arc(cx, cz, isz * 0.72, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = rgba(m.color, m.active ? 0.6 + pulse * 0.4 : 0.55);
      c.lineWidth = m.active ? 2 : 1.3;
      c.stroke();
      drawIcon(c, MARKER_ICON[m.kind], cx, cz, isz, m.color);
      // En mapas compactos sólo se rotulan los objetivos (la leyenda explica el resto de iconos).
      if (size >= COMPACT_PX || m.active || m.kind === 'lz') {
        const lab = labelFor(m);
        c.textAlign = lab.align;
        c.textBaseline = lab.base;
        c.fillStyle = m.active ? THEME.text : THEME.textDim;
        halo(c, m.short, cx + lab.dx, cz + lab.dy);
      }
      c.globalAlpha = 1;
    }

    // Jugador: cono de visión + flecha de rumbo.
    const p = st.player;
    const px = wx(Math.min(B.maxX, Math.max(B.minX, p.pos.x)));
    const pz = wz(Math.min(B.maxZ, Math.max(B.minZ, p.pos.z)));
    c.save();
    c.translate(px, pz);
    c.rotate(-p.yaw);
    const coneR = 70 * k;
    const half = (48 * Math.PI) / 180;
    const cone = c.createRadialGradient(0, 0, 0, 0, 0, coneR);
    cone.addColorStop(0, rgba(THEME.accent, 0.42));
    cone.addColorStop(1, rgba(THEME.accent, 0));
    c.fillStyle = cone;
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, coneR, -Math.PI / 2 - half, -Math.PI / 2 + half);
    c.closePath();
    c.fill();
    c.fillStyle = THEME.accent;
    c.strokeStyle = 'rgba(7, 11, 20, 0.95)';
    c.lineWidth = 2;
    const a = Math.max(7, size * 0.016);
    c.beginPath();
    c.moveTo(0, -a * 1.25);
    c.lineTo(a * 0.85, a);
    c.lineTo(0, a * 0.45);
    c.lineTo(-a * 0.85, a);
    c.closePath();
    c.stroke();
    c.fill();
    c.restore();
    c.strokeStyle = rgba(THEME.accent, 0.35 + pulse * 0.4);
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(px, pz, Math.max(9, size * 0.022) + pulse * 3, 0, Math.PI * 2);
    c.stroke();
    // Nombre del operativo junto a la flecha (a la izquierda si estamos pegados al borde derecho).
    c.font = `700 ${Math.max(10, size * 0.0165)}px ${MONO_FONT}`;
    const nameW = c.measureText(st.profile.name).width;
    const right = px + Math.max(14, size * 0.03) + nameW < wx(B.maxX) - 4;
    c.textAlign = right ? 'left' : 'right';
    c.textBaseline = 'middle';
    c.fillStyle = THEME.accent;
    halo(c, st.profile.name, px + (right ? 1 : -1) * Math.max(14, size * 0.03), pz + Math.max(12, size * 0.026));
  };

  const slowUpdate = (): void => {
    const st = ctx.state;
    const p = st.player;
    const heading = Math.round(headingDeg(p.yaw));
    const cardinal = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(heading / 45) % 8] ?? 'N';
    const zone = zoneAt(p.pos.x, p.pos.z);
    where.set(`${zoneName(zone)} · rumbo ${String(heading).padStart(3, '0')}° ${cardinal}`);
    const info = matchClock(st);
    clock.set(`${formatClock(st.match.elapsed)} · ${info.label}`);
    clockTone.set(info.tone);
    const cont = st.match.contamination;
    contamStatus.set(cont.active ? `radio ${Math.round(cont.radius)} m` : 'aún inactiva');
    sr.set(`Estás en ${zoneName(zone)}, mirando al ${cardinal}.`);

    const present = new Set(getMarkers(st).map((m) => m.id));
    for (const [id, item] of legendItems) item.toggleAttribute('data-off', !present.has(id) && id !== 'cage_perimeter');
    const lines = formatObjective(st);
    for (let i = 0; i < lines.length; i++) {
      const cell = objCells[i]!;
      const line = lines[i]!;
      cell.title.set(line.title);
      cell.text.set(line.text);
      cell.status.set(line.status);
    }
  };

  let acc = 1;
  return {
    el: root,
    setOpen(v) {
      if (v === open) return;
      open = v;
      root.hidden = !v;
      if (v) {
        acc = 1;
        staticDirty = true;
      }
    },
    update(dt) {
      if (!open) return;
      acc += dt;
      if (acc >= 0.2) {
        acc = 0;
        slowUpdate();
      }
      paint(performance.now() / 1000);
    },
  };
}
