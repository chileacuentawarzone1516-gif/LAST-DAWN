import * as THREE from 'three';
import { CONTAMINATION, PLAYER, RENDER } from '../config';
import type { QualityLevel } from '../config';
import type { EngineApi, EngineStats } from '../core/context';
import type { EventBus } from '../core/events';
import type { RunState } from '../core/state';
import { createAdaptiveScale } from './adaptive';
import { createFx } from './fx';
import { installFogPatch } from './glsl';
import { createLightRig, createViewLights } from './lighting';
import { createMaterials } from './materials';
import { getNoiseLayers } from './noise';
import { PostStack } from './post';
import { createScreenFxState } from './screenFx';
import type { ScreenFxState } from './screenFx';
import { createSky } from './sky';

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  bus: EventBus;
  state: RunState;
  qa: boolean;
  quality?: QualityLevel;
  /** Dispositivo táctil (móvil/tablet): el motor puede ajustar resolución, MSAA y texturas. */
  touch?: boolean;
}

/** Extras opcionales del motor (herramientas de dev y QA); `EngineApi` no cambia. */
export interface EngineExtras {
  /** Activa/desactiva la escala dinámica de resolución (desactivada por defecto con ?qa=1). */
  setAdaptive(enabled: boolean): void;
  /** Escala de resolución dinámica actual (0.6..1). */
  readonly resolutionScale: number;
  /** Estado de los efectos de pantalla (sólo lectura/depuración). */
  readonly screenFx: ScreenFxState;
  /** Llamadas de dibujo de los pases de post del último frame. */
  readonly postCalls: number;
  /** Dirección unitaria hacia la luna. */
  readonly moonDir: THREE.Vector3;
}

export type Engine = EngineApi & EngineExtras;

/**
 * Motor de render: WebGL2, sRGB + ACES, cielo/luz de hora azul, post-proceso propio,
 * materiales y fx procedurales, calidad low/medium/high con escala dinámica de resolución.
 */
export function createEngine(opts: EngineOptions): Engine {
  const { canvas, bus, state } = opts;
  installFogPatch();
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: opts.qa,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = RENDER.exposure;
  renderer.info.autoReset = false;
  renderer.autoClear = false;
  renderer.setClearColor(RENDER.sky.fog);
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const ext = renderer.extensions;
  const hdr = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
  const msaaOk = ext.has('EXT_color_buffer_float') || !hdr;

  const layers = getNoiseLayers();
  const scene = new THREE.Scene();
  const fogColor = new THREE.Color(RENDER.sky.fog);
  const fog = new THREE.FogExp2(fogColor, RENDER.fogDensity);
  scene.fog = fog;
  scene.background = fogColor;

  const camera = new THREE.PerspectiveCamera(PLAYER.fov, 16 / 9, 0.05, RENDER.presets.high.viewDistance);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  const viewScene = new THREE.Scene();
  createViewLights(viewScene);
  const viewCamera = new THREE.PerspectiveCamera(58, 16 / 9, 0.01, 10);

  const sky = createSky(layers);
  scene.add(sky.dome);
  const rig = createLightRig(scene, renderer, sky.moonDir);

  const materials = createMaterials();
  const fx = createFx({ scene, camera, bus, state });
  const post = new PostStack(renderer, hdr);
  const screenFx = createScreenFxState();
  const adaptive = createAdaptiveScale({ ...RENDER.adaptive, enabled: RENDER.adaptive.enabled && !opts.qa });

  let quality: QualityLevel = opts.quality ?? RENDER.defaultQuality;
  const stats: EngineStats = { fps: 60, frameMs: 16.7, drawCalls: 0, triangles: 0, pixelRatio: 1, quality };
  let envRT: THREE.WebGLRenderTarget | null = null;
  let logicalW = canvas.clientWidth || 960;
  let logicalH = canvas.clientHeight || 540;
  let time = 0;
  let lastNow = 0;
  let accT = 0;
  let accFrames = 0;

  const off = [
    bus.on('player:damaged', (e) => screenFx.onDamaged(e.hpDamage, e.armorDamage, e.source === 'contamination')),
    bus.on('player:died', () => screenFx.onDied()),
    bus.on('flow:started', () => screenFx.reset()),
    bus.on('ui:titleRequested', () => screenFx.reset()),
    bus.on('ui:restartRequested', () => screenFx.reset()),
  ];

  const applySize = (): void => {
    const preset = RENDER.presets[quality];
    const pr = Math.min(window.devicePixelRatio || 1, preset.pixelRatioMax) * adaptive.scale;
    stats.pixelRatio = pr;
    renderer.setPixelRatio(pr);
    renderer.setSize(logicalW, logicalH, false);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    post.resize(size.x, size.y);
    fx.setViewportHeight(size.y);
    camera.aspect = logicalW / logicalH;
    camera.updateProjectionMatrix();
    viewCamera.aspect = logicalW / logicalH;
    viewCamera.updateProjectionMatrix();
  };

  const applyQuality = (): void => {
    const p = RENDER.presets[quality];
    stats.quality = quality;
    camera.far = p.viewDistance;
    camera.updateProjectionMatrix();
    // La niebla debe cubrir casi por completo la distancia de dibujo (evita ver el recorte).
    fog.density = Math.max(RENDER.fogDensity, Math.sqrt(3) / p.viewDistance);
    sky.dome.scale.setScalar(Math.min(80, p.viewDistance * 0.4));
    const wantEnv = p.envMap;
    if (wantEnv && !envRT) envRT = sky.bakeEnvironment(renderer);
    scene.environment = wantEnv && envRT ? envRT.texture : null;
    viewScene.environment = scene.environment;
    viewScene.environmentIntensity = 1;
    rig.applyQuality(p, scene.environment !== null);
    post.configure({ mode: p.msaa === 0 && !p.bloom ? 'direct' : 'hdr', msaa: msaaOk ? p.msaa : 0, bloom: p.bloom });
    materials.configure({
      lowTextures: p.lowTextures,
      anisotropy: Math.min(p.anisotropy, renderer.capabilities.getMaxAnisotropy()),
      alphaToCoverage: p.msaa > 0 && msaaOk,
    });
    fx.setQuality(p);
    adaptive.reset();
    applySize();
  };

  const engine: Engine = {
    renderer, scene, camera, viewScene, viewCamera, materials, fx, stats, screenFx,
    moonDir: sky.moonDir,
    get resolutionScale() {
      return adaptive.scale;
    },
    get postCalls() {
      return post.postCalls;
    },
    setAdaptive(enabled) {
      adaptive.enabled = enabled;
      if (!enabled && adaptive.scale !== 1) {
        adaptive.reset();
        applySize();
      }
    },
    resize(w, h) {
      if (w <= 0 || h <= 0) return;
      logicalW = w;
      logicalH = h;
      applySize();
    },
    render() {
      const now = performance.now() / 1000;
      const dt = lastNow > 0 ? now - lastNow : 0;
      lastNow = now;
      if (dt > 0 && dt < 0.25) {
        accT += dt;
        accFrames++;
        if (accT >= 0.5) {
          stats.fps = accFrames / accT;
          stats.frameMs = (accT / accFrames) * 1000;
          accT = 0;
          accFrames = 0;
        }
      }
      if (adaptive.push(dt)) applySize();
      renderer.info.reset();
      post.render(scene, camera, viewScene, viewCamera, screenFx, time);
      stats.drawCalls = post.sceneCalls;
      stats.triangles = post.sceneTriangles;
    },
    setQuality(level) {
      if (level === quality) return;
      quality = level;
      applyQuality();
    },
    update(dt) {
      time += dt;
      const p = state.player;
      rig.follow(p.pos.x, p.pos.y, p.pos.z, p.yaw);
      sky.update(camera.position, time);
      const c = state.match.contamination;
      screenFx.update(dt, {
        hp: p.hp,
        maxHp: p.maxHp,
        alive: p.alive,
        contaminationActive: c.active,
        contaminationRadius: c.radius,
        contaminationDist: Math.hypot(p.pos.x - CONTAMINATION.center.x, p.pos.z - CONTAMINATION.center.z),
      });
    },
    dispose() {
      for (const o of off) o();
      fx.dispose();
      materials.dispose();
      post.dispose();
      rig.dispose();
      sky.dispose();
      envRT?.dispose();
      renderer.dispose();
    },
  };

  applyQuality();
  return engine;
}
