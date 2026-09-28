import type { Action } from '../core/context';
import type { EnemyType, MissionId } from '../core/types';
import type { Game } from './Game';

/**
 * API de control para los scripts de QA (Chrome headless), expuesta como
 * `window.__qa` SÓLO con ?qa=1. Permite jugar partidas completas de forma
 * determinista y rápida sin pointer lock ni renderizado.
 */
export interface QaApi {
  readonly game: Game;
  /** Foto JSON del estado de partida. */
  snapshot(): unknown;
  /** Empieza la partida (equivale a pulsar «Iniciar»). */
  start(): void;
  /** Simula `seconds` sin dibujar. */
  step(seconds: number, dt?: number): void;
  teleport(x: number, z: number, yaw?: number): void;
  setElapsed(seconds: number): void;
  god(on: boolean): void;
  giveMoney(amount: number): void;
  spawnEnemy(type: EnemyType, x: number, z: number): number | null;
  killAllEnemies(): void;
  /** Mantiene/suelta una acción de entrada (p. ej. 'interact'). */
  input(action: Action, down: boolean): void;
  /** Joystick analógico (x derecha, y adelante, en [-1,1]) y mirada en px equivalentes de ratón. */
  stick(x: number, y: number): void;
  look(dx: number, dy: number): void;
  digit(n: number): void;
  complete(id: MissionId): void;
  stats(): unknown;
}

declare global {
  interface Window {
    __qa?: QaApi;
  }
}

export function installQa(game: Game): QaApi {
  const { ctx } = game;
  const input = ctx.input;
  const qa: QaApi = {
    game,
    // structuredClone conserva NaN/Infinity (JSON los convertiría en null y los ocultaría).
    snapshot: () => structuredClone(ctx.state),
    start: () => game.beginRun(),
    step: (s, dt) => game.step(s, dt),
    teleport: (x, z, yaw) => ctx.player.teleport(x, z, yaw),
    setElapsed: (s) => {
      ctx.state.match.elapsed = s;
    },
    god: (on) => {
      ctx.player.godMode = on;
    },
    giveMoney: (n) => {
      ctx.state.player.money += n;
    },
    spawnEnemy: (type, x, z) => ctx.enemies.spawn(type, x, z)?.id ?? null,
    killAllEnemies: () => ctx.enemies.killAll(),
    input: (a, d) => input.inject(a, d),
    stick: (x, y) => input.setStick(x, y),
    look: (dx, dy) => input.addLook(dx, dy),
    digit: (n) => ctx.bus.emit('input:digit', { n }),
    complete: (id) => ctx.missions.debugComplete(id),
    stats: () => ({ ...ctx.engine.stats, enemies: ctx.enemies.aliveCount }),
  };
  window.__qa = qa;
  return qa;
}
