import { EventBus } from '../core/events';
import type { EventScope } from '../core/events';
import { createRunState, resetRunState } from '../core/state';
import type { FlowState } from '../core/state';
import type { GameContext, ModuleFactory } from '../core/context';
import type { AudioApi, CharacterApi, EnemiesApi, MissionsApi, PlayerApi, UiApi, WorldApi } from '../core/context';
import type { System } from '../core/types';
import { Input } from '../core/input';
import { InteractionSystem } from '../core/interaction';
import { isTouchDevice } from '../core/device';
import { assignProfile, loadProfile } from '../core/profile';
import { createEngine } from '../engine';
import { createWorld } from '../world';
import { createUi } from '../ui';
import { createAudio } from '../audio';
import { createPlayer } from '../player';
import { createEnemies } from '../enemies';
import { createMissions } from '../missions';
import { createCharacter } from '../character';
import { createTouch } from '../touch';

export interface ModuleFactories {
  world: ModuleFactory<WorldApi>;
  character: ModuleFactory<CharacterApi>;
  touch: ModuleFactory<System>;
  ui: ModuleFactory<UiApi>;
  audio: ModuleFactory<AudioApi>;
  player: ModuleFactory<PlayerApi>;
  enemies: ModuleFactory<EnemiesApi>;
  missions: ModuleFactory<MissionsApi>;
}

export interface GameOptions {
  canvas: HTMLCanvasElement;
  qa?: boolean;
  quality?: 'low' | 'medium' | 'high';
  /** Fuerza (true/false) el modo táctil; por defecto se detecta (isTouchDevice). */
  touch?: boolean;
  /** Sustituye factorías de módulo (páginas dev/ y tests). */
  modules?: Partial<ModuleFactories>;
}

/** Tope de dt (s) para que una pestaña en segundo plano no dispare la simulación. */
const MAX_DT = 0.05;

/**
 * Orquestador: construye el contexto, crea los módulos en orden y ejecuta el bucle.
 * Módulos persistentes: input, interacciones, motor, world, ui, audio.
 * Módulos por partida (se recrean al reiniciar): player, enemies, missions.
 */
export class Game {
  readonly ctx: GameContext;
  private readonly factories: ModuleFactories;
  private runSystems: System[] = [];
  private readonly scope: EventScope;
  private raf = 0;
  private last = 0;
  private runDirty = false;
  private disposed = false;
  private readonly cleanups: Array<() => void> = [];

  constructor(opts: GameOptions) {
    const qa = opts.qa ?? false;
    const bus = new EventBus();
    const state = createRunState();
    assignProfile(state.profile, loadProfile());
    const touch = opts.touch ?? isTouchDevice();
    const input = new Input(opts.canvas, bus, qa, touch);
    const interactions = new InteractionSystem({ input, state });
    const engine = createEngine({ canvas: opts.canvas, bus, state, qa, quality: opts.quality });

    this.factories = {
      world: createWorld, character: createCharacter, touch: createTouch, ui: createUi, audio: createAudio,
      player: createPlayer, enemies: createEnemies, missions: createMissions,
      ...opts.modules,
    };

    // Los módulos no construidos aún se asignan justo después; se tipan como definidos.
    this.ctx = {
      bus, state, input, interactions, engine,
      scene: engine.scene, camera: engine.camera, viewScene: engine.viewScene, viewCamera: engine.viewCamera,
      materials: engine.materials, fx: engine.fx, qa,
    } as unknown as GameContext;

    const { ctx } = this;
    ctx.world = this.factories.world(ctx);
    ctx.character = this.factories.character(ctx);
    ctx.ui = this.factories.ui(ctx);
    ctx.audio = this.factories.audio(ctx);
    ctx.touch = input.touch ? this.factories.touch(ctx) : { update() {} };
    this.buildRun();

    this.scope = bus.scope();
    this.scope
      .on('ui:startRequested', () => this.beginRun())
      .on('ui:restartRequested', () => this.beginRun())
      .on('ui:resumeRequested', () => void this.resume())
      .on('ui:titleRequested', () => this.toTitle())
      .on('ui:pauseRequested', () => this.pause())
      .on('input:lockChanged', ({ locked }) => this.onLockChanged(locked))
      .on('flow:ended', () => this.onEnded());

    const onResize = () => engine.resize(window.innerWidth, window.innerHeight);
    const onVisibility = () => {
      if (document.hidden && ctx.state.flow === 'playing') this.pause();
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanups.push(
      () => window.removeEventListener('resize', onResize),
      () => document.removeEventListener('visibilitychange', onVisibility),
    );
    onResize();
    this.setFlow('title');
  }

  // ── Bucle ────────────────────────────────────────────────────────────────
  start(): void {
    this.last = performance.now() / 1000;
    const frame = (t: number) => {
      if (this.disposed) return;
      const now = t / 1000;
      const dt = Math.min(MAX_DT, Math.max(0, now - this.last));
      this.last = now;
      this.update(dt);
      this.render();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  update(dt: number): void {
    const { ctx } = this;
    const s = ctx.state;
    switch (s.flow) {
      case 'playing':
        if (s.match.phase === 'playing') s.match.elapsed += dt;
        ctx.interactions.update(dt);
        ctx.player.update(dt);
        ctx.enemies.update(dt);
        ctx.missions.update(dt);
        ctx.world.update(dt);
        ctx.fx.update(dt);
        break;
      case 'title':
      case 'ended':
        ctx.world.update(dt);
        ctx.fx.update(dt);
        break;
      case 'paused':
        break;
    }
    ctx.character.update(dt);
    ctx.ui.update(dt);
    ctx.audio.update(dt);
    ctx.touch.update(dt);
    ctx.engine.update(dt);
    ctx.input.endFrame();
  }

  render(): void {
    this.ctx.engine.render();
  }

  /** Avanza la simulación sin dibujar (QA: acelera partidas completas). */
  step(seconds: number, dt = 1 / 30): void {
    if (!(dt > 0) || !Number.isFinite(seconds)) return;
    let left = seconds;
    while (left > 1e-6) {
      const d = Math.min(dt, left);
      this.update(d);
      left -= d;
    }
  }

  // ── Flujo ────────────────────────────────────────────────────────────────
  /** Empieza una partida nueva. Debe invocarse dentro del gesto del usuario (pointer lock). */
  beginRun(): void {
    const { ctx } = this;
    // Siempre se recrean los módulos por partida: resetRunState sustituye los sub-objetos
    // de state, así que un módulo construido antes cachearía referencias obsoletas.
    this.disposeRun();
    resetRunState(ctx.state, 'playing');
    this.buildRun();
    this.runDirty = true;
    ctx.interactions.update(0);
    ctx.audio.unlock();
    this.setFlow('playing');
    ctx.bus.emit('flow:started', {});
    void ctx.input.requestLock().then((ok) => {
      if (!ok && !ctx.qa && ctx.state.flow === 'playing') this.pause();
    });
  }

  pause(): void {
    if (this.ctx.state.flow !== 'playing') return;
    this.setFlow('paused');
    this.ctx.input.releaseLock();
    this.ctx.bus.emit('flow:paused', {});
  }

  async resume(): Promise<void> {
    const { ctx } = this;
    if (ctx.state.flow !== 'paused') return;
    const ok = await ctx.input.requestLock();
    if (ok || ctx.qa) {
      this.setFlow('playing');
      ctx.bus.emit('flow:resumed', {});
    }
  }

  private toTitle(): void {
    this.ctx.input.releaseLock();
    if (this.runDirty) {
      this.disposeRun();
      resetRunState(this.ctx.state, 'title');
      this.buildRun();
      this.runDirty = false;
    }
    this.setFlow('title');
  }

  private onLockChanged(locked: boolean): void {
    const { state } = this.ctx;
    if (!locked && state.flow === 'playing' && !this.ctx.qa) this.pause();
    else if (locked && state.flow === 'paused') {
      this.setFlow('playing');
      this.ctx.bus.emit('flow:resumed', {});
    }
  }

  private onEnded(): void {
    this.setFlow('ended');
    this.ctx.input.releaseLock();
  }

  private setFlow(flow: FlowState): void {
    this.ctx.state.flow = flow;
    this.ctx.input.enabled = flow === 'playing';
    this.ctx.ui.setHudVisible(flow === 'playing' || flow === 'paused');
  }

  // ── Módulos por partida ──────────────────────────────────────────────────
  private buildRun(): void {
    const { ctx } = this;
    ctx.player = this.factories.player(ctx);
    ctx.enemies = this.factories.enemies(ctx);
    ctx.missions = this.factories.missions(ctx);
    this.runSystems = [ctx.player, ctx.enemies, ctx.missions];
    ctx.player.update(0);
  }

  private disposeRun(): void {
    for (const s of this.runSystems.reverse()) s.dispose?.();
    this.runSystems = [];
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.scope.dispose();
    this.disposeRun();
    const { ctx } = this;
    for (const s of [ctx.touch, ctx.audio, ctx.ui, ctx.character, ctx.world, ctx.interactions, ctx.engine]) s.dispose?.();
    ctx.input.dispose();
    for (const c of this.cleanups) c();
  }
}
