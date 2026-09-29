import * as THREE from 'three';
import type { CharacterAnchor, CharacterApi, CharacterPose, GameContext } from '../core/context';
import { damp, wrapAngle } from '../core/util';
import { resolveLook } from '../rules/character';
import { buildCharacterModel } from './model';
import type { CharacterModel } from './model';
import { anchorToPlacement } from './placement';

export { anchorToPlacement, PREVIEW_DISTANCE } from './placement';
export type { CharacterPlacement } from './placement';
export { buildCharacterModel } from './model';
export type { CharacterModel } from './model';

/** Giro automático de la peana (rad/s), pausa tras arrastrar (s), inercia (1/s). */
const AUTO_SPIN = 0.5;
const DRAG_PAUSE = 2;
const INERTIA = 3.2;
const POP_DURATION = 0.42;
const START_YAW = 0.35;
/** Altura de referencia (m) para escalar: ambos géneros comparten escala, así ella queda ~6 % más baja con los pies en el mismo suelo. */
const REF_HEIGHT = 1.78;

const easeOutBack = (t: number): number => {
  const c = 1.9;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

/** Extras de depuración (páginas dev y tests); el contrato CharacterApi no cambia. */
export interface CharacterDevApi {
  /** Modelo actual (sólo lectura). */
  readonly model: CharacterModel | null;
  readonly yaw: number;
  /** Número de reconstrucciones del modelo desde la creación. */
  readonly rebuilds: number;
  /** Fija el ángulo de giro y detiene la velocidad residual. */
  setYaw(yaw: number): void;
  /** Giro automático de la peana (true por defecto). */
  autoSpin: boolean;
}

/**
 * Módulo del personaje: presenta el maniquí del operativo en la viewScene (se dibuja sobre el mundo, con la
 * iluminación fija del motor) como una peana giratoria. Se reconstruye cuando cambia el perfil.
 */
export function createCharacter(ctx: GameContext): CharacterApi & CharacterDevApi {
  const group = new THREE.Group();
  group.name = 'character-preview';
  group.visible = false;
  const pivot = new THREE.Group();
  group.add(pivot);
  ctx.viewScene.add(group);

  let model: CharacterModel | null = null;
  let visible = false;
  let dirty = true;
  let pose: CharacterPose = 'idle';
  const anchor: CharacterAnchor = { x: 0.72, y: 0.5, height: 0.8 };
  // Última colocación aplicada (para recalcular sólo si cambia el aspecto, el fov, el ancla o el modelo).
  const placed = { aspect: -1, fov: -1, x: NaN, y: NaN, height: NaN };

  // Giro: yaw, velocidad angular, arrastre acumulado este frame y tiempo desde el último arrastre.
  let yaw = START_YAW;
  let omega = 0;
  let frameDrag = 0;
  let dragVel = 0;
  let sinceDrag = DRAG_PAUSE + 1;
  let time = 0;
  let pop = 1;
  let rebuilds = 0;
  let autoSpin = true;

  const place = (): void => {
    const cam = ctx.viewCamera;
    const h = REF_HEIGHT;
    const p = anchorToPlacement(cam.fov, cam.aspect, anchor, h);
    group.position.set(p.x, p.y, p.z);
    group.scale.setScalar(p.scale);
    placed.aspect = cam.aspect;
    placed.fov = cam.fov;
    placed.x = anchor.x;
    placed.y = anchor.y;
    placed.height = anchor.height;
  };

  const rebuild = (): void => {
    const old = model;
    model = buildCharacterModel(resolveLook(ctx.state.profile));
    pivot.add(model.root);
    model.setPose(pose, true);
    old?.dispose();
    dirty = false;
    rebuilds++;
    pop = 0;
    place();
  };

  const scope = ctx.bus.scope();
  scope
    .on('profile:changed', (e) => {
      // Sólo el nombre no cambia el aspecto: nada que reconstruir. Varios eventos por frame = una reconstrucción.
      if (e.genderChanged || e.appearanceChanged) dirty = true;
    })
    .on('flow:started', () => api.hidePreview());

  const api: CharacterApi & CharacterDevApi = {
    get model() {
      return model;
    },
    get yaw() {
      return yaw;
    },
    get rebuilds() {
      return rebuilds;
    },
    get autoSpin() {
      return autoSpin;
    },
    set autoSpin(v: boolean) {
      autoSpin = v;
    },
    setYaw(v) {
      yaw = wrapAngle(v);
      omega = 0;
      dragVel = 0;
    },
    showPreview(a) {
      anchor.x = a.x;
      anchor.y = a.y;
      anchor.height = a.height;
      visible = true;
      group.visible = true;
      if (dirty || !model) rebuild();
      else place();
    },
    hidePreview() {
      visible = false;
      group.visible = false;
    },
    get previewVisible() {
      return visible;
    },
    setAnchor(a) {
      anchor.x = a.x;
      anchor.y = a.y;
      anchor.height = a.height;
      if (visible) place();
    },
    rotate(dyaw) {
      yaw += dyaw;
      frameDrag += dyaw;
      sinceDrag = 0;
    },
    setPose(p) {
      pose = p;
      model?.setPose(p, false);
    },
    update(dt) {
      if (!visible || dt <= 0) return;
      time += dt;
      if (dirty) rebuild();
      const cam = ctx.viewCamera;
      if (
        cam.aspect !== placed.aspect || cam.fov !== placed.fov || anchor.x !== placed.x || anchor.y !== placed.y
        || anchor.height !== placed.height
      ) place();

      // Giro tipo peana.
      if (frameDrag !== 0) {
        dragVel = damp(dragVel, frameDrag / dt, 18, dt);
        frameDrag = 0;
        omega = 0;
      } else {
        sinceDrag += dt;
        if (sinceDrag < DRAG_PAUSE) {
          dragVel = damp(dragVel, 0, INERTIA, dt);
          yaw += dragVel * dt;
        } else if (!autoSpin) {
          dragVel = 0;
          omega = 0;
        } else if (pose === 'idle') {
          dragVel = 0;
          omega = damp(omega, AUTO_SPIN, 1.2, dt);
          yaw += omega * dt;
        } else {
          // Poses: oscila de frente en lugar de girar, para que la pose se lea bien.
          dragVel = 0;
          const target = START_YAW + 0.5 * Math.sin(time * 0.55);
          omega = damp(omega, wrapAngle(target - yaw) * 2.2, 4, dt);
          yaw += omega * dt;
        }
      }
      yaw = wrapAngle(yaw);
      pivot.rotation.y = yaw;

      // Aparición con «pop» (rebote).
      if (pop < 1) {
        pop = Math.min(1, pop + dt / POP_DURATION);
        pivot.scale.setScalar(0.84 + 0.16 * easeOutBack(pop));
      } else if (pivot.scale.x !== 1) {
        pivot.scale.setScalar(1);
      }
      model?.update(dt);
    },
    dispose() {
      scope.dispose();
      ctx.viewScene.remove(group);
      model?.dispose();
      model = null;
    },
  };
  return api;
}
