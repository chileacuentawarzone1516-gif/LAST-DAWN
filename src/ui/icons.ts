/**
 * Iconos vectoriales dibujados en código (viewBox 24×24). Cada icono se compone de
 * trazos (`s`) y/o rellenos (`f`) con sintaxis de path SVG, de modo que sirven tanto
 * para SVG inline como para `Path2D` en los canvas (brújula y mapa).
 */
import { svgEl } from './dom';

export type IconName =
  | 'health' | 'shield' | 'plate' | 'grenade' | 'bullet' | 'money' | 'skull' | 'relay' | 'heli' | 'crate' | 'cage'
  | 'gate' | 'radio' | 'lz' | 'check' | 'lock' | 'target' | 'clock' | 'speaker' | 'mute' | 'warning' | 'toxic'
  | 'headshot' | 'chart' | 'contract' | 'cross' | 'shuffle' | 'reset' | 'user' | 'back' | 'touch';

interface IconDef {
  /** Trazos (stroke). */
  s?: string;
  /** Rellenos (fill). */
  f?: string;
}

/** Trébol de radiación: tres sectores de 60° centrados en -90°, 30° y 150°. */
function trefoil(): string {
  const rOut = 10;
  const rIn = 3.6;
  const pt = (r: number, deg: number): string => {
    const a = (deg * Math.PI) / 180;
    return `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
  };
  let d = '';
  for (const c of [-90, 30, 150]) {
    d += `M${pt(rIn, c - 30)}L${pt(rOut, c - 30)}A${rOut} ${rOut} 0 0 1 ${pt(rOut, c + 30)}L${pt(rIn, c + 30)}A${rIn} ${rIn} 0 0 0 ${pt(rIn, c - 30)}z`;
  }
  return d;
}

const ICONS: Record<IconName, IconDef> = {
  health: { s: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z' },
  shield: { s: 'M12 3 4.5 6v6c0 4.6 3.1 7.7 7.5 9 4.4-1.3 7.5-4.4 7.5-9V6z' },
  plate: { s: 'M6 4h12l2.5 3v10L18 20H6l-2.5-3V7zM8 9h8M8 12h8M8 15h5' },
  grenade: { s: 'M12 9a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM10 9V5.5h4V9M14 5.5l3.5-2M9 14.5a3 3 0 0 1 2-2' },
  bullet: { s: 'M8.5 21V10.5C8.5 8 10 5 12 3c2 2 3.5 5 3.5 7.5V21zM8.5 17h7' },
  money: {
    s: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM14.6 9.4c-.6-.9-1.5-1.3-2.6-1.3-1.4 0-2.6.8-2.6 2 0 2.7 5.3 1.4 5.3 4.1 0 1.2-1.2 2.1-2.7 2.1-1.3 0-2.3-.5-2.9-1.5M12 6.2v1.9M12 16.2v1.6',
  },
  skull: {
    s: 'M12 3C7.6 3 4 6 4 10.2c0 2.4 1.1 4.2 2.8 5.3V19h3v-2h4v2h3v-3.5c1.7-1.1 2.8-2.9 2.8-5.3C20 6 16.4 3 12 3z',
    f: 'M9 10.1a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM15 10.1a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z',
  },
  relay: {
    s: 'M12 11 8 21M12 11l4 10M9.6 17h4.8M8 4.6a5.4 5.4 0 0 0 0 4.4M16 4.6a5.4 5.4 0 0 1 0 4.4M5.4 2.6a8.6 8.6 0 0 0 0 8.4M18.6 2.6a8.6 8.6 0 0 1 0 8.4',
    f: 'M12 6.2a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z',
  },
  heli: { s: 'M3 5h18M12 5v3M6.5 8h9A4.5 4.5 0 0 1 20 12.5V14h-5.5L13 16H8a3.5 3.5 0 0 1-3.5-3.5v-1A3.5 3.5 0 0 1 6.5 8zM5 19.5h12M9 16v3.5M14 16v3.5' },
  crate: { s: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9' },
  cage: { s: 'M4 4h16v16H4zM8 4v16M12 4v16M16 4v16' },
  gate: { s: 'M4 21V10a8 8 0 0 1 16 0v11M9 21v-8h6v8M12 13v8' },
  radio: { s: 'M4 9h16v11H4zM8 9l8-5.5M7 13h5M7 16.5h10', f: 'M16.4 12.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z' },
  lz: { s: 'M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19zM9 7v10M15 7v10M9 12h6' },
  check: { s: 'M5 12.5 9.5 17 19 7.5' },
  lock: { s: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3M12 14.5v2.5' },
  target: { s: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4' },
  clock: { s: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5.5l3.5 2' },
  speaker: { s: 'M4 9.5h3.8L13 5v14l-5.2-4.5H4zM16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11' },
  mute: { s: 'M4 9.5h3.8L13 5v14l-5.2-4.5H4zM16.5 9.5l5 5M21.5 9.5l-5 5' },
  warning: { s: 'M12 3.2 22 20.5H2zM12 10v4.6M12 17.4v.4' },
  toxic: { f: trefoil(), s: 'M12 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z' },
  headshot: { s: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5v9M7.5 12h9' },
  chart: { s: 'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6' },
  contract: { s: 'M6 3h9l4 4v14H6zM14.5 3v4.5H19M9 12h7M9 15.5h7M9 8.5h3' },
  cross: { s: 'M6 6l12 12M18 6 6 18' },
  shuffle: { s: 'M3 7h4l10 10h4M3 17h4l3-3.2M13.5 10.2 17 7h4M18 4l3 3-3 3M18 14l3 3-3 3' },
  reset: { s: 'M4 12a8 8 0 1 0 2.6-5.9M4 4v5h5' },
  user: { s: 'M12 11.5a4.3 4.3 0 1 0 0-8.6 4.3 4.3 0 0 0 0 8.6zM4 21c0-4.3 3.6-6.8 8-6.8s8 2.5 8 6.8' },
  back: { s: 'M14 5l-7 7 7 7M7 12h13' },
  touch: { s: 'M9 11V5.5a1.6 1.6 0 0 1 3.2 0V11m0-1.6a1.6 1.6 0 0 1 3.2 0V11m0-.6a1.6 1.6 0 0 1 3.2 0V16a5 5 0 0 1-5 5h-1.4a5 5 0 0 1-4-2L4.6 15a1.6 1.6 0 0 1 2.5-2L9 15' },
};

/** Icono SVG inline (hereda `currentColor`); decorativo: aria-hidden. */
export function icon(name: IconName, className = 'ico'): SVGSVGElement {
  const def = ICONS[name];
  const svg = svgEl('svg', {
    viewBox: '0 0 24 24', class: className, 'aria-hidden': 'true', focusable: 'false',
    fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  if (def.f) svg.append(svgEl('path', { d: def.f, fill: 'currentColor', stroke: 'none' }));
  if (def.s) svg.append(svgEl('path', { d: def.s }));
  return svg;
}

interface IconPaths {
  stroke: Path2D | null;
  fill: Path2D | null;
}
const path2dCache = new Map<IconName, IconPaths>();

function paths(name: IconName): IconPaths {
  let p = path2dCache.get(name);
  if (!p) {
    const def = ICONS[name];
    p = { stroke: def.s ? new Path2D(def.s) : null, fill: def.f ? new Path2D(def.f) : null };
    path2dCache.set(name, p);
  }
  return p;
}

/**
 * Dibuja un icono en un canvas 2D centrado en (cx, cy) con lado `size` (px CSS).
 * `color` se usa para trazo y relleno; el grosor del trazo escala con el tamaño.
 */
export function drawIcon(
  g: CanvasRenderingContext2D,
  name: IconName,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const p = paths(name);
  const k = size / 24;
  g.save();
  g.translate(cx - size / 2, cy - size / 2);
  g.scale(k, k);
  g.strokeStyle = color;
  g.fillStyle = color;
  // El grosor se expresa en el espacio 24×24 (escala con el tamaño del icono).
  g.lineWidth = size < 16 ? 2.4 : 1.9;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (p.fill) g.fill(p.fill);
  if (p.stroke) g.stroke(p.stroke);
  g.restore();
}
