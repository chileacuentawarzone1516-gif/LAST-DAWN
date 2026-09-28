import { Game } from '../game/Game';
import type { ModuleFactories } from '../game/Game';
import { installQa } from '../game/qa';
import { createWorld } from '../world';
import { createUi } from '../ui';
import { createAudio } from '../audio';
import { createPlayer } from '../player';
import { createEnemies } from '../enemies';
import { createMissions } from '../missions';
import {
  createStubAudio, createStubEnemies, createStubMissions, createStubPlayer, createStubUi, createStubWorld,
} from './stubs';

export type ModuleName = 'world' | 'ui' | 'audio' | 'player' | 'enemies' | 'missions';

const REAL: ModuleFactories = {
  world: createWorld, ui: createUi, audio: createAudio, player: createPlayer, enemies: createEnemies, missions: createMissions,
};
const STUB: ModuleFactories = {
  world: createStubWorld, ui: createStubUi, audio: createStubAudio, player: createStubPlayer,
  enemies: createStubEnemies, missions: createStubMissions,
};

export interface DevOptions {
  /** Módulos REALES a usar; el resto son stubs. El motor siempre es el real. */
  use: ModuleName[];
  /** Sustituciones a medida (mocks propios de la preview). */
  overrides?: Partial<ModuleFactories>;
  /** Empieza la partida al instante (por defecto true). */
  autoStart?: boolean;
  /** Elemento donde insertar el canvas (por defecto #app o body). */
  mount?: HTMLElement;
}

/**
 * Arranca una instancia de Game para una página de preview de dev/.
 * `?qa=1` en la URL: sin pointer lock y con window.__qa (para capturas headless).
 * Clic en el canvas: pide pointer lock (mouse-look).
 */
export function createDevGame(opts: DevOptions): Game {
  const params = new URLSearchParams(window.location.search);
  const qa = params.get('qa') === '1';
  const q = params.get('q');
  const quality = q === 'low' || q === 'medium' || q === 'high' ? q : undefined;
  const mount = opts.mount ?? document.getElementById('app') ?? document.body;
  const canvas = document.createElement('canvas');
  canvas.id = 'game-canvas';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none';
  mount.prepend(canvas);

  const modules = { ...STUB } as ModuleFactories;
  for (const name of opts.use) (modules as unknown as Record<string, unknown>)[name] = REAL[name];
  Object.assign(modules, opts.overrides);

  const game = new Game({ canvas, qa, quality, modules });
  if (qa) installQa(game);
  canvas.addEventListener('click', () => {
    if (game.ctx.state.flow === 'playing') void game.ctx.input.requestLock();
  });
  if (opts.autoStart ?? true) game.beginRun();
  game.start();
  return game;
}

export const devPageStyles = `
  html, body { margin: 0; height: 100%; background: #070b14; color: #d6e4f5; overflow: hidden; font: 12px/1.4 ui-monospace, monospace; }
  #app { position: fixed; inset: 0; }
  .dev-panel { position: fixed; top: 8px; left: 8px; z-index: 10; background: rgba(0,0,0,.6); padding: 8px 10px; border: 1px solid #2b3b55; max-width: 360px; }
  .dev-panel button { font: inherit; margin: 2px; padding: 3px 8px; background: #16233a; color: #d6e4f5; border: 1px solid #35507a; cursor: pointer; }
  .dev-panel button:hover { background: #21365a; }
`;
