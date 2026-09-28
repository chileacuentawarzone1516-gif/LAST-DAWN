/**
 * Iconos SVG en línea (viewBox 24×24, trazo `currentColor`). Cadenas estáticas propias: nunca se les
 * concatena texto externo. Se insertan con innerHTML una sola vez al construir los controles.
 */
const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  /** Cartucho: disparo. */
  fire: svg('<path d="M9 21V10.5c0-3 1.5-5.5 3-7.5 1.5 2 3 4.5 3 7.5V21z"/><path d="M9 16.5h6"/>'),
  /** Mira: apuntar. */
  aim: svg('<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'),
  jump: svg('<path d="M12 20V5M5.5 11.5 12 5l6.5 6.5"/>'),
  crouch: svg('<path d="M12 4v11M6.5 10.5 12 16l5.5-5.5M5 20h14"/>'),
  reload: svg('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.5h-4.5"/>'),
  grenade: svg('<circle cx="12" cy="14.5" r="6.5"/><path d="M10 8V4.5h4V8M14 5l3.5-2"/>'),
  plate: svg('<path d="M12 3 20 6v6c0 4.8-3.3 8-8 9-4.7-1-8-4.2-8-9V6z"/><path d="M12 9v6M9 12h6"/>'),
  swap: svg('<path d="M4 8h13.5l-3-3M20 16H6.5l3 3"/>'),
  /** Mano: interactuar. */
  interact: svg('<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10"/><path d="M12 9.5v-2a1.5 1.5 0 0 1 3 0V11"/><path d="M15 9.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1.2a6 6 0 0 1-5-2.7L4.2 14a1.5 1.5 0 0 1 2.4-1.8L9 14.5"/>'),
  pause: svg('<path d="M8.5 5v14M15.5 5v14" stroke-width="3"/>'),
  map: svg('<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/>'),
  settings: svg('<circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>'),
  /** Doble chevrón: indicador de correr. */
  run: svg('<path d="M6 11.5 12 5.5l6 6M6 18.5l6-6 6 6"/>'),
  /** Dispositivo girando: aviso de orientación. */
  rotate: svg('<rect x="7" y="3" width="10" height="18" rx="2.2"/><path d="M11 18h2"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
};

export type IconName = keyof typeof ICONS;
