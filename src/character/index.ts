import * as THREE from 'three';
import { CHARACTER } from '../config';
import type { CharacterAnchor, CharacterApi, CharacterPose, GameContext } from '../core/context';
import type { Gender } from '../core/types';
import { damp, wrapAngle } from '../core/util';
import { resolveLook } from '../rules/character';
import type { ResolvedLook } from '../rules/character';
import { GLB_REF_HEIGHT, GlbLibrary, instantiateGlb } from './glbModel';
import { pickCharacterLod } from './glbRules';
import type { CharacterLod } from './glbRules';
export type { CharacterLod } from './glbRules';
export { pickCharacterLod } from './glbRules';
import type { GlbInstance } from './glbModel';
import { buildCharacterModel } from './model';
import type { CharacterModel } from './model';
import { anchorToPlacement } from './placement';

export { anchorToPlacement, PREVIEW_DISTANCE } from './placement';
export type { CharacterPlacement } from './placement';
export { buildCharacterModel } from './model';
export type { CharacterModel } from './model';
export { GLB_REF_HEIGHT, GlbLibrary, instantiateGlb, loadGlbAsset } from './glbModel';
export type { GlbAsset, GlbInstance } from './glbModel';

/** Giro automático de la peana (rad/s), pausa tras arrastrar (s), inercia (1/s). */
const AUTO_SPIN = 0.5;
const DRAG_PAUSE = 2;
const INERTIA = 3.2;
const POP_DURATION = 0.42;
const START_YAW = 0.35;
/** Altura de referencia (m) del maniquí procedural: ambos géneros comparten escala (ella queda ~6 % más baja, mismo suelo). */
const PROC_REF_HEIGHT = 1.78;

const QUALITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

const easeOutBack = (t: number): number => {
  const c = 1.9;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

/** Lo que se ve en la peana: el GLB semirrealista o el maniquí procedural de respaldo. */
interface Actor {
  readonly kind: 'glb' | 'procedural';
  readonly gender: Gender;
  readonly root: THREE.Object3D;
  readonly refHeight: number;
  setPose(pose: CharacterPose, instant: boolean): void;
  update(dt: number): void;
  dispose(): void;
  /** Sólo GLB: cambia visibilidad y colores sin reconstruir. */
  applyLook?(look: ResolvedLook): void;
}

export type CharacterSource = 'auto' | 'glb' | 'procedural';

/** Extras de depuración (páginas dev y tests); el contrato CharacterApi no cambia. */
export interface CharacterDevApi {
  /** Modelo procedural actual (null si se muestra el GLB o no hay modelo). */
  readonly model: CharacterModel | null;
  /** Instancia GLB actual (null si se muestra el procedural). */
  readonly glb: GlbInstance | null;
  readonly actorKind: 'glb' | 'procedural' | null;
  readonly yaw: number;
  /** Número de cambios de actor / reconstrucciones desde la creación. */
  readonly rebuilds: number;
  /** Biblioteca de GLB (caché por género). */
  readonly library: GlbLibrary;
  /** Fuerza el origen del modelo ('auto' = reglas de config, calidad y ahorro de datos). */
  source: CharacterSource;
  /** Fuerza la variante del GLB (null = automática); recarga el GLB si cambia. */
  lod: CharacterLod | null;
  /** Resuelve cuando no hay descargas GLB pendientes. */
  settled(): Promise<void>;
  /** Fija el ángulo de giro y detiene la velocidad residual. */
  setYaw(yaw: number): void;
  /** Giro automático de la peana (true por defecto). */
  autoSpin: boolean;
}

const saveData = (): boolean =>
  typeof navigator !== 'undefined' && (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;

/**
 * Módulo del personaje: presenta el maniquí del operativo en la viewScene (se dibuja sobre el mundo, con la
 * iluminación fija del motor) como una peana giratoria.
 *
 * Origen del modelo: el GLB semirrealista (carga perezosa por género; sólo se mantiene el género activo y se
 * libera todo al empezar la partida). Mientras baja —o si falla, o con ahorro de datos / calidad insuficiente—
 * se muestra el maniquí procedural, y al terminar la carga se cambia al GLB con el mismo giro y pose.
 * Los cambios de perfil sobre un GLB sólo actualizan visibilidad y colores.
 */
export function createCharacter(ctx: GameContext): CharacterApi & CharacterDevApi {
  const group = new THREE.Group();
  group.name = 'character-preview';
  group.visible = false;
  const pivot = new THREE.Group();
  group.add(pivot);
  ctx.viewScene.add(group);

  const library = new GlbLibrary(() => {
    const cap = ctx.engine.renderer.capabilities.getMaxAnisotropy();
    const want = ctx.input.touch ? CHARACTER.glb.touchMaxAnisotropy : CHARACTER.glb.maxAnisotropy;
    return { anisotropy: Math.max(1, Math.min(want, cap)), low: useLow() };
  });

  let actor: Actor | null = null;
  let procedural: CharacterModel | null = null;
  let glbInstance: GlbInstance | null = null;
  let visible = false;
  let dirty = true;
  let pose: CharacterPose = 'idle';
  let source: CharacterSource = 'auto';
  let lodOverride: CharacterLod | null = null;
  const anchor: CharacterAnchor = { x: 0.72, y: 0.5, height: 0.8 };
  // Última colocación aplicada (para recalcular sólo si cambia el aspecto, el fov, el ancla o el actor).
  const placed = { aspect: -1, fov: -1, x: NaN, y: NaN, height: NaN, ref: NaN };
  const loads: Promise<unknown>[] = [];

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
  let disposed = false;

  const place = (): void => {
    const cam = ctx.viewCamera;
    const ref = actor?.refHeight ?? PROC_REF_HEIGHT;
    const p = anchorToPlacement(cam.fov, cam.aspect, anchor, ref);
    group.position.set(p.x, p.y, p.z);
    group.scale.setScalar(p.scale);
    placed.aspect = cam.aspect;
    placed.fov = cam.fov;
    placed.x = anchor.x;
    placed.y = anchor.y;
    placed.height = anchor.height;
    placed.ref = ref;
  };

  /** Variante del GLB: ligera en móviles, calidad 'low' o poca memoria (ver pickCharacterLod). */
  const useLow = (): boolean => {
    if (lodOverride) return lodOverride === 'low';
    const dm = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
    return pickCharacterLod({ touch: ctx.input.touch, quality: ctx.engine.stats.quality, deviceMemory: dm }, CHARACTER.glb.lowDeviceMemoryGb) === 'low';
  };

  const glbAllowed = (): boolean => {
    if (source === 'procedural') return false;
    if (source === 'glb') return true;
    if (!CHARACTER.glb.enabled || saveData()) return false;
    const q = QUALITY_RANK[ctx.engine.stats.quality] ?? 2;
    return q >= (QUALITY_RANK[CHARACTER.glb.minQuality] ?? 0);
  };

  const setActor = (next: Actor, popFrom: number): void => {
    const old = actor;
    pivot.add(next.root);
    next.setPose(pose, true);
    if (old) {
      pivot.remove(old.root);
      old.dispose();
    }
    actor = next;
    pop = popFrom;
    place();
  };

  const makeProcedural = (look: ResolvedLook): Actor => {
    const m = buildCharacterModel(look);
    procedural = m;
    glbInstance = null;
    return {
      kind: 'procedural', gender: look.gender, root: m.root, refHeight: PROC_REF_HEIGHT,
      setPose: (p, instant) => m.setPose(p, instant),
      update: (dt) => m.update(dt),
      dispose: () => {
        m.dispose();
        if (procedural === m) procedural = null;
      },
    };
  };

  const makeGlb = (g: Gender, look: ResolvedLook): Actor | null => {
    const asset = library.get(g);
    if (!asset) return null;
    const inst = instantiateGlb(asset);
    inst.applyLook(look);
    glbInstance = inst;
    procedural = null;
    return {
      kind: 'glb', gender: g, root: inst.root, refHeight: Math.max(GLB_REF_HEIGHT, inst.height),
      setPose: (p, instant) => inst.setPose(p, instant),
      update: (dt) => inst.update(dt),
      dispose: () => {
        inst.dispose();
        if (glbInstance === inst) glbInstance = null;
      },
      applyLook: (l) => inst.applyLook(l),
    };
  };

  const startLoad = (g: Gender): void => {
    if (!glbAllowed() || library.hasFailed(g) || library.get(g) || library.isLoading(g)) return;
    const p = library.load(g).then((asset) => {
      if (disposed || !asset) return;
      // Política de memoria: sólo el género activo. Si el perfil cambió mientras bajaba, este asset sobra.
      if (ctx.state.profile.gender !== g) {
        library.release(g);
        return;
      }
      if (actor?.kind === 'procedural' && actor.gender === g) dirty = true; // se cambia al GLB en el próximo update
    });
    loads.push(p);
  };

  const rebuild = (): void => {
    const look = resolveLook(ctx.state.profile);
    const g = look.gender;
    dirty = false;
    rebuilds++;
    // Cambio de género: libera el otro (tras retirar su actor, más abajo).
    if (actor?.kind === 'glb' && actor.gender === g && actor.applyLook && glbAllowed()) {
      actor.applyLook(look); // sólo visibilidad y colores
      pop = 0.6;
      return;
    }
    let next: Actor | null = null;
    if (glbAllowed() && !library.hasFailed(g)) next = makeGlb(g, look);
    const wasGlb = next !== null;
    next ??= makeProcedural(look);
    // El GLB nuevo entra suave (pop pequeño) si sustituye a otro actor del mismo género; el resto, pop normal.
    const same = actor?.gender === g;
    setActor(next, wasGlb && same ? 0.55 : 0);
    const other: Gender = g === 'male' ? 'female' : 'male';
    if (library.get(other) || library.isLoading(other)) library.release(other);
    if (!wasGlb) startLoad(g);
  };

  const scope = ctx.bus.scope();
  scope
    .on('profile:changed', (e) => {
      // Sólo el nombre no cambia el aspecto: nada que reconstruir. Varios eventos por frame = una reconstrucción.
      if (e.genderChanged || e.appearanceChanged) dirty = true;
    })
    .on('flow:started', () => {
      // Empieza la partida: se oculta y se libera todo (recarga bajo demanda al volver a título/personalizar).
      api.hidePreview();
      if (actor) {
        pivot.remove(actor.root);
        actor.dispose();
        actor = null;
      }
      library.releaseAll();
      dirty = true;
    });

  const api: CharacterApi & CharacterDevApi = {
    get model() {
      return procedural;
    },
    get glb() {
      return glbInstance;
    },
    get actorKind() {
      return actor?.kind ?? null;
    },
    get yaw() {
      return yaw;
    },
    get rebuilds() {
      return rebuilds;
    },
    get library() {
      return library;
    },
    get source() {
      return source;
    },
    set source(v: CharacterSource) {
      if (v === source) return;
      source = v;
      dirty = true;
      if (actor && (v === 'procedural') === (actor.kind === 'glb')) {
        // Fuerza el cambio de actor aunque el género no varíe.
        pivot.remove(actor.root);
        actor.dispose();
        actor = null;
      }
      if (visible) rebuild();
    },
    get lod() {
      return lodOverride;
    },
    set lod(v: CharacterLod | null) {
      if (v === lodOverride) return;
      lodOverride = v;
      if (actor?.kind === 'glb') {
        pivot.remove(actor.root);
        actor.dispose();
        actor = null;
      }
      library.releaseAll();
      dirty = true;
      if (visible) rebuild();
    },
    settled: async () => {
      while (loads.length > 0) await loads.shift();
      // La carga marca `dirty`; un frame de update lo aplica. Espera a que se aplique si hay ventana visible.
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
      if (dirty || !actor) rebuild();
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
      actor?.setPose(p, false);
    },
    update(dt) {
      if (!visible || dt <= 0) return;
      time += dt;
      if (dirty) rebuild();
      const cam = ctx.viewCamera;
      if (
        cam.aspect !== placed.aspect || cam.fov !== placed.fov || anchor.x !== placed.x || anchor.y !== placed.y
        || anchor.height !== placed.height || (actor?.refHeight ?? PROC_REF_HEIGHT) !== placed.ref
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
      actor?.update(dt);
    },
    dispose() {
      disposed = true;
      scope.dispose();
      ctx.viewScene.remove(group);
      actor?.dispose();
      actor = null;
      library.releaseAll();
    },
  };
  return api;
}
