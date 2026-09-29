import type { EventBus } from './events';
import type { Action, InputApi } from './context';

const KEY_MAP: Record<string, Action> = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  Space: 'jump',
  KeyC: 'crouch',
  KeyE: 'interact',
  KeyR: 'reload',
  Digit1: 'slot1', Numpad1: 'slot1',
  Digit2: 'slot2', Numpad2: 'slot2',
  KeyG: 'grenade',
  KeyQ: 'plate',
  KeyM: 'map',
};

const ACTIONS: Action[] = [
  'forward', 'back', 'left', 'right', 'sprint', 'jump', 'crouch', 'interact',
  'fire', 'aim', 'reload', 'slot1', 'slot2', 'grenade', 'plate', 'map',
];

/** Entrada de teclado/ratón con pointer lock. Los flancos se limpian en endFrame(). */
export class Input implements InputApi {
  enabled = true;
  wheelDelta = 0;
  lookDX = 0;
  lookDY = 0;
  private stickX = 0;
  private stickY = 0;
  private lockedNow = false;
  private readonly down = new Set<Action>();
  private readonly pressed = new Set<Action>();
  private readonly released = new Set<Action>();
  private readonly cleanups: Array<() => void> = [];
  /** En modo QA no se exige pointer lock. */
  private readonly qa: boolean;
  readonly touch: boolean;

  constructor(private readonly canvas: HTMLElement, private readonly bus: EventBus, qa = false, touch = false) {
    this.qa = qa;
    this.touch = touch;
    const on = <K extends keyof DocumentEventMap>(t: K, h: (e: DocumentEventMap[K]) => void, target: Document | Window = document) => {
      target.addEventListener(t, h as EventListener);
      this.cleanups.push(() => target.removeEventListener(t, h as EventListener));
    };
    on('keydown', (e) => this.onKey(e, true));
    on('keyup', (e) => this.onKey(e, false));
    on('mousedown', (e) => this.onMouse(e, true));
    on('mouseup', (e) => this.onMouse(e, false));
    on('mousemove', (e) => this.onMove(e));
    on('wheel', (e) => this.onWheel(e), window);
    on('contextmenu', (e) => e.preventDefault());
    on('pointerlockchange', () => {
      this.lockedNow = document.pointerLockElement === this.canvas;
      if (!this.lockedNow) this.releaseAll();
      this.bus.emit('input:lockChanged', { locked: this.lockedNow });
    });
    on('blur', () => this.releaseAll(), window);
  }

  get locked(): boolean {
    return this.lockedNow || this.qa || this.touch;
  }

  get moveX(): number {
    if (!this.enabled) return 0;
    const k = (this.down.has('right') ? 1 : 0) - (this.down.has('left') ? 1 : 0);
    return Math.max(-1, Math.min(1, k + this.stickX));
  }

  get moveY(): number {
    if (!this.enabled) return 0;
    const k = (this.down.has('forward') ? 1 : 0) - (this.down.has('back') ? 1 : 0);
    return Math.max(-1, Math.min(1, k + this.stickY));
  }

  setStick(x: number, y: number): void {
    this.stickX = Math.max(-1, Math.min(1, x));
    this.stickY = Math.max(-1, Math.min(1, y));
  }

  addLook(dx: number, dy: number): void {
    if (!this.enabled) return;
    this.lookDX += dx;
    this.lookDY += dy;
  }

  isDown(action: Action): boolean {
    return this.enabled && this.down.has(action);
  }
  wasPressed(action: Action): boolean {
    return this.enabled && this.pressed.has(action);
  }
  wasReleased(action: Action): boolean {
    return this.enabled && this.released.has(action);
  }

  /** Fija una acción (botones táctiles, scripts de QA / tests). */
  inject(action: Action, isDown: boolean): void {
    this.set(action, isDown);
  }

  async requestLock(): Promise<boolean> {
    if (this.qa) return true;
    if (this.touch) {
      // Sin pointer lock en táctil: pantalla completa y bloqueo de orientación (best-effort, requiere gesto).
      try {
        const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
        if (!document.fullscreenElement) await (el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.());
      } catch {
        /* iOS Safari no permite fullscreen en iPhone: se ignora */
      }
      try {
        await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
      } catch {
        /* no soportado o no permitido */
      }
      return true;
    }
    try {
      // Algunos navegadores devuelven una promesa; otros undefined.
      const r = (this.canvas.requestPointerLock as unknown as (o?: unknown) => Promise<void> | void).call(this.canvas, { unadjustedMovement: true });
      if (r && typeof (r as Promise<void>).then === 'function') await r;
    } catch {
      try {
        const r2 = this.canvas.requestPointerLock() as unknown as Promise<void> | void;
        if (r2 && typeof (r2 as Promise<void>).then === 'function') await r2;
      } catch {
        return false;
      }
    }
    return document.pointerLockElement === this.canvas;
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.wheelDelta = 0;
    this.lookDX = 0;
    this.lookDY = 0;
  }

  dispose(): void {
    for (const c of this.cleanups) c();
    this.cleanups.length = 0;
  }

  private set(action: Action, isDown: boolean): void {
    if (isDown) {
      if (!this.down.has(action)) {
        this.down.add(action);
        this.pressed.add(action);
      }
    } else if (this.down.delete(action)) {
      this.released.add(action);
    }
  }

  private releaseAll(): void {
    for (const a of ACTIONS) this.set(a, false);
    this.stickX = 0;
    this.stickY = 0;
  }

  private onKey(e: KeyboardEvent, isDown: boolean): void {
    if (e.repeat) return;
    const action = KEY_MAP[e.code];
    if (action) {
      if (this.locked) e.preventDefault();
      this.set(action, isDown);
    }
    if (isDown) {
      const m = /^(?:Digit|Numpad)([1-6])$/.exec(e.code);
      if (m) this.bus.emit('input:digit', { n: Number(m[1]) });
    }
  }

  private onMouse(e: MouseEvent, isDown: boolean): void {
    // En táctil los toques generan mousedown/up sintéticos: se ignoran (los botones inyectan acciones).
    if (this.touch || !this.locked) return;
    if (e.button === 0) this.set('fire', isDown);
    else if (e.button === 2) this.set('aim', isDown);
  }

  private onMove(e: MouseEvent): void {
    if (this.touch || !this.lockedNow) return;
    this.lookDX += e.movementX;
    this.lookDY += e.movementY;
  }

  private onWheel(e: WheelEvent): void {
    if (this.touch || !this.locked) return;
    this.wheelDelta += Math.sign(e.deltaY);
  }
}
