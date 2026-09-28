import * as THREE from 'three';
import { PLAYER, RENDER } from '../config';
import type { EngineApi, EngineStats } from '../core/context';
import type { EventBus } from '../core/events';
import type { RunState } from '../core/state';
import { createFx } from './fx';
import { createMaterials } from './materials';

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  bus: EventBus;
  state: RunState;
  qa: boolean;
  quality?: 'low' | 'medium' | 'high';
}

/**
 * BASE PROVISIONAL del motor (renderer + luces + dos pasadas). El agente de
 * motor/render lo reemplaza conservando EngineApi: scene, camera, viewScene, viewCamera,
 * materials, fx, stats, resize(), render(), setQuality().
 */
export function createEngine(opts: EngineOptions): EngineApi {
  const { canvas } = opts;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = RENDER.exposure;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(RENDER.sky.horizon);
  scene.fog = new THREE.FogExp2(RENDER.sky.fog, RENDER.fogDensity);
  scene.add(new THREE.HemisphereLight(RENDER.sky.ambient, RENDER.sky.ground, 1.4));
  const moon = new THREE.DirectionalLight(RENDER.sky.moon, 1.6);
  moon.position.set(-60, 90, 40);
  scene.add(moon);

  const camera = new THREE.PerspectiveCamera(PLAYER.fov, 16 / 9, 0.05, RENDER.presets.high.viewDistance);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  const viewScene = new THREE.Scene();
  viewScene.add(new THREE.HemisphereLight(0x9fb4d8, 0x1a2030, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(0.5, 1, 0.6);
  viewScene.add(key);
  const viewCamera = new THREE.PerspectiveCamera(58, 16 / 9, 0.01, 10);

  const materials = createMaterials();
  const fx = createFx();
  const stats: EngineStats = { fps: 60, frameMs: 16.7, drawCalls: 0, triangles: 0, pixelRatio: 1, quality: opts.quality ?? RENDER.defaultQuality };
  let acc = 0;
  let frames = 0;

  const engine: EngineApi = {
    renderer, scene, camera, viewScene, viewCamera, materials, fx, stats,
    resize(w, h) {
      const pr = Math.min(window.devicePixelRatio || 1, RENDER.presets[stats.quality as 'low' | 'medium' | 'high'].pixelRatioMax);
      stats.pixelRatio = pr;
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      viewCamera.aspect = w / h;
      viewCamera.updateProjectionMatrix();
    },
    render() {
      renderer.info.reset();
      renderer.autoClear = true;
      renderer.render(scene, camera);
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(viewScene, viewCamera);
      stats.drawCalls = renderer.info.render.calls;
      stats.triangles = renderer.info.render.triangles;
    },
    setQuality(level) {
      stats.quality = level;
      engine.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
    },
    update(dt) {
      acc += dt;
      frames++;
      if (acc >= 0.5) {
        stats.fps = frames / acc;
        stats.frameMs = (acc / frames) * 1000;
        acc = 0;
        frames = 0;
      }
    },
  };
  return engine;
}
