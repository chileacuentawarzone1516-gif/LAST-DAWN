/**
 * Preview de los controles táctiles sobre el mundo real: jugador y armas reales, sin enemigos, con dos
 * interactuables de prueba (retención de 3 s y pulsación) y un panel de depuración de stick/mirada/acciones.
 * Fuerza el modo táctil (?touch=1). Parámetros: ?qa=1 (sin pointer lock, window.__qa), ?nodbg=1 (sin panel).
 */
import { MAP } from '../src/config';
import type { Action, GameContext, MissionsApi } from '../src/core/context';
import { createDevGame, devPageStyles } from '../src/dev/harness';
import type { Game } from '../src/game/Game';
import type { TouchSystem } from '../src/touch';

const params = new URLSearchParams(location.search);
// El modo táctil se decide en el constructor de Game a partir de la URL: se fuerza antes de crearlo.
if (!params.has('touch')) {
  params.set('touch', '1');
  history.replaceState(null, '', `${location.pathname}?${params.toString()}${location.hash}`);
}
document.documentElement.dataset.input = 'touch';

const style = document.createElement('style');
style.textContent = `${devPageStyles}
  #dbg { position: fixed; left: 50%; top: 4px; transform: translateX(-50%); z-index: 30; pointer-events: none; width: max-content; max-width: 46vw;
    padding: 3px 7px; font: 10px/1.35 ui-monospace, monospace; color: #cfe; background: rgba(0,0,0,.55); border: 1px solid #2b3b55; white-space: pre; }
  #dbg-btns { position: fixed; left: 50%; top: 4px; transform: translate(-50%, 0); z-index: 30; display: none; }
  .tools { position: fixed; left: 50%; bottom: 4px; transform: translateX(-50%); z-index: 30; display: flex; gap: 4px; }
  .tools button { font: 10px ui-monospace, monospace; padding: 4px 8px; background: #16233a; color: #d6e4f5; border: 1px solid #35507a; border-radius: 4px; }`;
document.head.append(style);

/** Misiones de mentira: sólo registran interactuables para probar el botón de interactuar. */
function createMockMissions(ctx: GameContext): MissionsApi {
  const sp = MAP.spawn;
  const offs = [
    ctx.interactions.register({
      id: 'dev-relay', position: () => ({ x: sp.x, y: 0, z: sp.z - 6 }), radius: 4, holdSeconds: 3,
      prompt: () => 'Activar transmisor', onComplete: () => ctx.bus.emit('ui:notify', { text: 'Transmisor activado', kind: 'reward' }),
    }),
    ctx.interactions.register({
      id: 'dev-armory', position: () => ({ x: MAP.armory.x, y: 0, z: MAP.armory.z }), radius: 5, holdSeconds: 0,
      prompt: () => 'Abrir armería', onComplete: () => ctx.bus.emit('ui:notify', { text: 'Armería (prueba)', kind: 'info' }),
    }),
  ];
  return {
    helicopter: null,
    openShop() {},
    closeShop() {},
    debugComplete() {},
    update() {},
    dispose() {
      for (const off of offs) off();
    },
  };
}

const game: Game = createDevGame({ use: ['touch', 'player', 'world'], overrides: { missions: createMockMissions } });
const { ctx } = game;
const touch = ctx.touch as TouchSystem;

if (params.get('nodbg') !== '1') {
  const dbg = document.createElement('div');
  dbg.id = 'dbg';
  document.body.append(dbg);
  const ACTIONS: Action[] = ['fire', 'aim', 'jump', 'crouch', 'reload', 'grenade', 'plate', 'slot1', 'slot2', 'interact', 'map'];
  const f = (v: number, d = 2): string => v.toFixed(d).padStart(5 + (d > 0 ? 0 : -1));
  setInterval(() => {
    const s = ctx.state;
    const d = touch.debug;
    const down = ACTIONS.filter((a) => ctx.input.isDown(a)).join(' ') || '-';
    const cur = ctx.interactions.current;
    dbg.textContent =
      `stick ${f(d.stickX)},${f(d.stickY)} |${f(d.stickMag)}| ${d.sprint ? 'CORRER' : '------'}   ptrs ${d.pointers}\n` +
      `mira  ${f(d.lookDX, 1)},${f(d.lookDY, 1)}  Σ ${f(d.lookTotalX, 0)},${f(d.lookTotalY, 0)}\n` +
      `move  ${f(ctx.input.moveX)},${f(ctx.input.moveY)}   acciones: ${down}\n` +
      `pos ${f(s.player.pos.x, 1)},${f(s.player.pos.z, 1)} yaw ${f(s.player.yaw)}  disparos ${s.match.shotsFired}\n` +
      `flow ${s.flow} modo ${d.mode}${d.portrait ? ' VERTICAL' : ''}  ads ${s.player.aiming ? 'sí' : 'no'} agach ${s.player.crouched ? 'sí' : 'no'}  ${d.fps} fps\n` +
      `interact ${cur ? `${cur.id} ${(ctx.interactions.progress * 100).toFixed(0)}%` : '-'}`;
  }, 100);

  const tools = document.createElement('div');
  tools.className = 'tools';
  const add = (label: string, fn: () => void): void => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', fn);
    tools.append(b);
  };
  add('zurdo', () => touch.setSettings({ lefty: !touch.settings.lefty }));
  add('→ relé', () => ctx.player.teleport(MAP.spawn.x, MAP.spawn.z - 3, 0));
  add('→ armería', () => ctx.player.teleport(MAP.armory.x + 2, MAP.armory.z, 0));
  add('inicio', () => ctx.player.teleport(MAP.spawn.x, MAP.spawn.z, MAP.spawn.yaw));
  add('dios', () => {
    ctx.player.godMode = !ctx.player.godMode;
  });
  document.body.append(tools);
}
