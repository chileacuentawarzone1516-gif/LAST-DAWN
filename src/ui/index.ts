/**
 * Módulo UI: HUD, pantallas de flujo (título/pausa/fin), tienda y mapa táctico.
 * Todo el DOM cuelga de una raíz propia dentro de #app; `dispose()` la elimina junto con
 * todos los listeners y suscripciones al bus.
 */
import { THEME } from '../config';
import type { GameContext, UiApi } from '../core/context';
import type { NotifyKind } from '../core/types';
import { Disposer, el } from './dom';
import { createHud } from './hud';
import { createTacticalMap } from './map';
import { createScreens } from './screens';
import { createSettingsStore } from './settings';
import { createShop } from './shop';
import './styles.css';

export interface UiPerf {
  /** Duración del último update() de la UI (ms). */
  lastMs: number;
  /** Media móvil (ms). */
  avgMs: number;
  /** Máximo desde el último reinicio (ms). */
  maxMs: number;
  frames: number;
}

export interface UiHandle extends UiApi {
  readonly perf: UiPerf;
  readonly root: HTMLElement;
}

export function createUi(ctx: GameContext): UiHandle {
  const dis = new Disposer();
  const scope = ctx.bus.scope();
  const settings = createSettingsStore(ctx);

  const root = el('div', { id: 'ds-ui', class: 'ds-ui' });
  // Modo de entrada para el CSS (targets táctiles, ocultar pistas de teclado, layout móvil).
  root.dataset.input = ctx.input.touch ? 'touch' : 'mouse';
  // Variables de tema desde THEME (única fuente de colores).
  const vars: Record<string, string> = {
    '--c-bg': THEME.bg, '--c-panel': THEME.panel, '--c-text': THEME.text, '--c-dim': THEME.textDim,
    '--c-accent': THEME.accent, '--c-warn': THEME.warn, '--c-danger': THEME.danger, '--c-reward': THEME.reward,
    '--c-info': THEME.info,
    '--z-perimeter': THEME.zoneColors.perimeter, '--z-warehouses': THEME.zoneColors.warehouses,
    '--z-refinery': THEME.zoneColors.refinery, '--z-complex': THEME.zoneColors.complex,
  };
  for (const k of Object.keys(vars)) root.style.setProperty(k, vars[k] as string);

  const hud = createHud(ctx, dis);
  const shop = createShop(ctx, dis);
  const map = createTacticalMap(ctx, dis);
  const screens = createScreens(ctx, settings, dis);
  root.append(hud.el, shop.el, map.el, screens.el);
  (document.getElementById('app') ?? document.body).append(root);

  let audioApplied = false;
  scope.on('flow:started', () => settings.applyAudio());

  // Escape cierra el mapa (con pointer lock el navegador ya pausa la partida).
  dis.listen(document, 'keydown', (e) => {
    if (e.key === 'Escape' && ctx.state.ui.modal === 'map') ctx.state.ui.modal = null;
  });

  const perf: UiPerf = { lastMs: 0, avgMs: 0, maxMs: 0, frames: 0 };

  const api: UiHandle = {
    perf,
    root,
    notify(text: string, kind: NotifyKind = 'info') {
      // Un único camino: el bus. Así también lo oye el audio y no se duplica.
      ctx.bus.emit('ui:notify', { text, kind });
    },
    setHudVisible(visible: boolean) {
      hud.setVisible(visible);
    },
    update(dt: number) {
      const t0 = performance.now();
      const s = ctx.state;
      if (!audioApplied && (ctx as { audio?: unknown }).audio) {
        audioApplied = true;
        settings.applyAudio();
      }
      // El mapa (M) sólo en partida y sin tienda abierta; se cierra al salir de 'playing'.
      if (s.ui.modal === 'map' && (s.flow !== 'playing' || !s.player.alive)) s.ui.modal = null;
      if (s.flow === 'playing' && s.player.alive && ctx.input.wasPressed('map')) {
        if (s.ui.modal === 'map') s.ui.modal = null;
        else if (s.ui.modal === null) s.ui.modal = 'map';
      }
      const playing = s.flow === 'playing';
      shop.setOpen(playing && s.ui.modal === 'shop');
      map.setOpen(playing && s.ui.modal === 'map');
      hud.update(dt);
      shop.update(dt);
      map.update(dt);
      screens.update(dt);

      const ms = performance.now() - t0;
      perf.lastMs = ms;
      perf.avgMs = perf.frames === 0 ? ms : perf.avgMs * 0.98 + ms * 0.02;
      if (ms > perf.maxMs) perf.maxMs = ms;
      perf.frames++;
    },
    dispose() {
      scope.dispose();
      dis.dispose();
      hud.dispose();
      shop.dispose();
      screens.dispose();
      root.remove();
    },
  };
  return api;
}
