/** Utilidades compartidas por los submódulos de misiones (sin estado de juego propio). */
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { NotifyKind, Vec3 } from '../core/types';

/** Notificación de HUD por el bus (la UI escucha 'ui:notify'). */
export function notify(ctx: GameContext, text: string, kind: NotifyKind = 'info'): void {
  ctx.bus.emit('ui:notify', { text, kind });
}

/** Emite 'money:changed' si el saldo cambió respecto a `before`. */
export function announceMoney(ctx: GameContext, before: number, reason: string): void {
  const balance = ctx.state.player.money;
  const delta = balance - before;
  if (delta !== 0) ctx.bus.emit('money:changed', { balance, delta, reason });
}

/** Distancia en el plano XZ desde los pies del jugador a un punto. */
export function distToPlayer(ctx: GameContext, x: number, z: number): number {
  const p = ctx.state.player.pos;
  return Math.hypot(p.x - x, p.z - z);
}

export function makeVec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/** Texturas de brillo procedurales compartidas (se liberan con `dispose`). */
export interface GlowTextures {
  /** Degradado vertical: opaco abajo → transparente arriba (columnas de luz). */
  readonly vertical: THREE.CanvasTexture;
  /** Degradado radial: centro brillante → borde transparente (halos, sprites). */
  readonly radial: THREE.CanvasTexture;
  /** Degradado radial al revés: centro transparente → borde brillante (disco de zona). */
  readonly disc: THREE.CanvasTexture;
  dispose(): void;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (g) draw(g, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createGlowTextures(): GlowTextures {
  // Vertical: la fila superior del canvas es el extremo superior del cilindro (uv.y = 1).
  const vertical = canvasTexture(4, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.22)');
    grad.addColorStop(0.8, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  const radial = canvasTexture(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  const disc = canvasTexture(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0.85)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
  return {
    vertical, radial, disc,
    dispose() {
      vertical.dispose();
      radial.dispose();
      disc.dispose();
    },
  };
}

/** Libera geometrías y materiales propios de un subárbol (NO los materiales compartidos del motor). */
export function disposeOwned(root: THREE.Object3D, shared: ReadonlySet<THREE.Material>): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) if (!shared.has(m)) m.dispose();
  });
}
