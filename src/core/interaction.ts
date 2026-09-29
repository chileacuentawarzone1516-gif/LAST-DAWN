import type { GameContext, Interactable, InteractionApi } from './context';
import { PLAYER } from '../config';

/** Gestiona la tecla E: prioriza el interactuable más cercano y su retención. */
export class InteractionSystem implements InteractionApi {
  current: Interactable | null = null;
  progress = 0;
  private readonly items = new Set<Interactable>();
  /** Tras completar una retención hay que soltar E antes de volver a empezar. */
  private needRelease = false;
  private heldOn: Interactable | null = null;

  constructor(private readonly ctx: Pick<GameContext, 'input' | 'state'>) {}

  register(item: Interactable): () => void {
    this.items.add(item);
    return () => {
      this.items.delete(item);
      if (this.current === item) {
        this.current = null;
        this.progress = 0;
      }
    };
  }

  update(dt: number): void {
    const { input, state } = this.ctx;
    const p = state.player.pos;
    if (state.flow !== 'playing' || !state.player.alive) {
      this.current = null;
      this.progress = 0;
      return;
    }
    let best: Interactable | null = null;
    let bestScore = -Infinity;
    for (const it of this.items) {
      if (it.prompt() === null) continue;
      const pos = it.position();
      const d = Math.hypot(pos.x - p.x, pos.z - p.z);
      const dy = Math.abs(pos.y - p.y);
      if (d > it.radius || dy > PLAYER.interactReach + 3) continue;
      const score = (it.priority ?? 0) * 1000 - d;
      if (score > bestScore) {
        best = it;
        bestScore = score;
      }
    }
    if (best !== this.current) {
      this.current = best;
      this.progress = 0;
      this.heldOn = null;
    }
    if (!best) return;

    if (!input.isDown('interact')) {
      this.needRelease = false;
      this.progress = 0;
      this.heldOn = null;
      return;
    }
    if (this.needRelease) return;

    if (best.holdSeconds <= 0) {
      if (input.wasPressed('interact')) {
        this.needRelease = true;
        best.onComplete();
      }
      return;
    }
    if (this.heldOn !== best) {
      this.heldOn = best;
      this.progress = 0;
    }
    this.progress = Math.min(1, this.progress + dt / best.holdSeconds);
    if (this.progress >= 1) {
      this.progress = 0;
      this.needRelease = true;
      this.heldOn = null;
      best.onComplete();
    }
  }
}
