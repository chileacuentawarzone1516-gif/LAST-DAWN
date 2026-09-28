import * as THREE from 'three';
import { MAP, RENDER } from '../config';
import type { QualityPreset } from '../config';
import type { FxApi, FxKind } from '../core/context';
import type { EventBus } from '../core/events';
import type { RunState } from '../core/state';
import type { SurfaceKind, Vec3 } from '../core/types';
import { createDecalAtlas, createDecals, createTracers } from './fxDecals';
import type { DecalKind, TimeUniform } from './fxDecals';
import { createParticleAtlas, createParticles } from './fxParticles';
import { getNoiseLayers } from './noise';

export interface FxOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  bus: EventBus;
  state: RunState;
}

export interface Fx extends FxApi {
  setQuality(p: QualityPreset): void;
  setViewportHeight(px: number): void;
  /** Partículas vivas (depuración). */
  readonly aliveParticles: number;
  dispose(): void;
}

/** Ganancia de las luces puntuales: `intensity` de flash() en unidades «suaves» (1 ≈ luz tenue). */
const FLASH_GAIN = 14;
const TRACER_POOL = 48;
/** Distancia mínima (m) para dibujar el trazador de un disparo. */
const TRACER_MIN_DIST = 6;
const MAX_PARTICLES = RENDER.presets.high.particles;
const MAX_DECALS = RENDER.presets.high.decals;

interface Impact {
  sparks: number;
  dust: number;
  dustTint: number;
  decal: boolean;
  blood?: boolean;
}

const IMPACTS: Record<SurfaceKind, Impact> = {
  concrete: { sparks: 0.4, dust: 1, dustTint: 0xb4bac6, decal: true },
  metal: { sparks: 1.2, dust: 0, dustTint: 0, decal: true },
  dirt: { sparks: 0, dust: 1.2, dustTint: 0x8a6c4c, decal: true },
  asphalt: { sparks: 0.3, dust: 0.9, dustTint: 0x8a8e9a, decal: true },
  flesh: { sparks: 0, dust: 0, dustTint: 0, decal: false, blood: true },
  glass: { sparks: 0.5, dust: 0.3, dustTint: 0xcfe6f2, decal: true },
  wood: { sparks: 0.1, dust: 0.9, dustTint: 0xa07a52, decal: true },
  water: { sparks: 0, dust: 1.1, dustTint: 0xdbe8f4, decal: false },
};

const UP: Vec3 = { x: 0, y: 1, z: 0 };
const BLOOD_SIZE: Record<string, number> = { walker: 1.3, runner: 1.1, brute: 2, spitter: 1.2, warden: 2.6 };

export function createFx(opts: FxOptions): Fx {
  const { scene, camera, bus } = opts;
  const layers = getNoiseLayers();
  const time: TimeUniform = { value: 0 };
  const pAtlas = createParticleAtlas(layers);
  const dAtlas = createDecalAtlas(layers);
  const particles = createParticles(MAX_PARTICLES, pAtlas);
  const decals = createDecals(MAX_DECALS, dAtlas, time);
  const tracers = createTracers(TRACER_POOL, time);
  const group = new THREE.Group();
  group.name = 'fx';
  group.add(decals.mesh, particles.mesh, tracers.mesh);
  scene.add(group);

  // Pool FIJO de luces: nunca cambia el número de luces de la escena (no recompila shaders).
  const nLights = RENDER.flashLights;
  const lights: THREE.PointLight[] = [];
  const peak = new Float32Array(nLights);
  const remain = new Float32Array(nLights);
  const total = new Float32Array(nLights);
  for (let i = 0; i < nLights; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 12, 2);
    l.name = `flash${i}`;
    lights.push(l);
    group.add(l);
  }

  const tmp = new THREE.Color();
  const tStart: Vec3 = { x: 0, y: 0, z: 0 };
  let heliT = 0;
  let heliAcc = 0;

  const fx: Fx = {
    burst(kind: FxKind, pos, dir, scale = 1) {
      particles.emit(kind, pos, dir, scale);
    },
    tracer(from, to, color = 0xffd890) {
      tmp.set(color);
      tracers.add(from, to, tmp, 2.6);
    },
    decal(kind: DecalKind, point, normal, size = 0.15) {
      decals.add(kind, point, normal, size);
    },
    flash(pos, color, intensity, durationS, distance = 12) {
      // Reutiliza la luz libre o, si no hay, la más débil.
      let k = 0;
      let best = Infinity;
      for (let i = 0; i < nLights; i++) {
        const r = remain[i] as number;
        if (r <= 0) { k = i; break; }
        const e = (r / (total[i] as number)) * (peak[i] as number);
        if (e < best) { best = e; k = i; }
      }
      const l = lights[k] as THREE.PointLight;
      l.position.set(pos.x, pos.y, pos.z);
      l.color.set(color);
      l.distance = distance;
      peak[k] = intensity;
      total[k] = Math.max(durationS, 0.01);
      remain[k] = total[k] as number;
      l.intensity = intensity * FLASH_GAIN;
    },
    update(dt) {
      time.value += dt;
      particles.update(dt);
      for (let i = 0; i < nLights; i++) {
        const r = remain[i] as number;
        if (r <= 0) continue;
        const nr = r - dt;
        remain[i] = nr;
        const l = lights[i] as THREE.PointLight;
        if (nr <= 0) l.intensity = 0;
        else {
          const t = nr / (total[i] as number);
          l.intensity = (peak[i] as number) * FLASH_GAIN * t * t;
        }
      }
      if (heliT > 0) {
        heliT -= dt;
        heliAcc += dt;
        while (heliAcc > 0.12) {
          heliAcc -= 0.12;
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * MAP.lz.padRadius * 0.6;
          particles.emit('heliDust', { x: MAP.lz.center.x + Math.cos(a) * r, y: 0.3, z: MAP.lz.center.z + Math.sin(a) * r }, undefined, 1);
        }
      }
    },
    setQuality(p) {
      particles.setCapacity(p.particles);
      decals.setCapacity(p.decals);
    },
    setViewportHeight(px) {
      tracers.setViewportHeight(px);
    },
    get aliveParticles() {
      return particles.alive;
    },
    dispose() {
      for (const o of offs) o();
      scene.remove(group);
      particles.dispose();
      decals.dispose();
      tracers.dispose();
      pAtlas.dispose();
      dAtlas.dispose();
      for (const l of lights) l.dispose();
    },
  };

  const clearAll = (): void => {
    particles.clear();
    decals.clear();
    tracers.clear();
    heliT = 0;
    for (let i = 0; i < nLights; i++) {
      remain[i] = 0;
      (lights[i] as THREE.PointLight).intensity = 0;
    }
  };

  const offs = [
    bus.on('bullet:impact', ({ point, normal, surface }) => {
      const im = IMPACTS[surface];
      if (im.sparks > 0) particles.emit('sparks', point, normal, im.sparks);
      if (im.dust > 0) particles.emit('dust', point, normal, im.dust * 0.8, im.dustTint);
      if (im.blood) particles.emit('blood', point, normal, 0.7);
      if (im.decal) decals.add('bullet', point, normal, 0.11 + Math.random() * 0.05);
    }),
    bus.on('enemy:hit', ({ point, normal, zone, killed, damage }) => {
      const k = (zone === 'head' ? 1.3 : 1) * (killed ? 1.4 : 1) * Math.min(1.6, 0.7 + damage / 90);
      particles.emit('blood', point, normal, k);
    }),
    bus.on('enemy:died', ({ type, pos }) => {
      decals.add('blood', { x: pos.x, y: pos.y + 0.03, z: pos.z }, UP, (BLOOD_SIZE[type] ?? 1.2) * (0.85 + Math.random() * 0.3), 3);
      particles.emit('blood', { x: pos.x, y: pos.y + 0.9, z: pos.z }, UP, 1.2);
    }),
    bus.on('grenade:exploded', ({ pos, radius }) => {
      const k = radius / 8;
      particles.emit('explosion', pos, UP, k);
      fx.flash(pos, 0xffa050, 9, 0.35, radius * 4);
      if (pos.y < 3) decals.add('scorch', { x: pos.x, y: 0.03, z: pos.z }, UP, radius * 1.5);
    }),
    bus.on('player:shot', ({ origin, dir, end, suppressed }) => {
      const dx = end.x - origin.x;
      const dy = end.y - origin.y;
      const dz = end.z - origin.z;
      if (dx * dx + dy * dy + dz * dz < TRACER_MIN_DIST * TRACER_MIN_DIST) return;
      // Arranca ligeramente delante, abajo y a la derecha de la cámara (cañón del arma).
      const m = camera.matrixWorld.elements;
      tStart.x = origin.x + dir.x * 0.9 - (m[4] as number) * 0.14 + (m[0] as number) * 0.1;
      tStart.y = origin.y + dir.y * 0.9 - (m[5] as number) * 0.14 + (m[1] as number) * 0.1;
      tStart.z = origin.z + dir.z * 0.9 - (m[6] as number) * 0.14 + (m[2] as number) * 0.1;
      tmp.set(0xffd890);
      tracers.add(tStart, end, tmp, suppressed ? 1 : 2.6);
    }),
    bus.on('extraction:landed', () => {
      heliT = 6;
    }),
    bus.on('extraction:departed', () => {
      heliT = 4;
    }),
    bus.on('flow:started', clearAll),
    bus.on('ui:titleRequested', clearAll),
  ];

  return fx;
}
