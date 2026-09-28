import type { GameContext } from '../../core/context';
import type { EventScope } from '../../core/events';
import type { Disposer } from '../dom';

/** Entorno compartido por los widgets del HUD. */
export interface HudEnv {
  readonly ctx: GameContext;
  /** Suscripciones al bus: se cancelan todas al destruir el HUD. */
  readonly scope: EventScope;
  /** Listeners/observadores de DOM: se cancelan todos al destruir el HUD. */
  readonly dis: Disposer;
  /** ¿Está el HUD visible ahora? (los widgets ignoran eventos si no). */
  isVisible(): boolean;
}

/** Elemento del HUD con actualización por frame. */
export interface Widget {
  readonly el: HTMLElement;
  /** `slow` es true ~10 veces por segundo: para textos y cálculos con asignaciones. */
  update(dt: number, slow: boolean): void;
  dispose?(): void;
}
