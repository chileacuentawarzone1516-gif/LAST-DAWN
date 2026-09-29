import * as THREE from 'three';
import { CONTAMINATION, PLAYER, RENDER } from '../config';
import type { QualityLevel, QualityPreset } from '../config';
import type { EngineApi, EngineStats } from '../core/context';
import type { EventBus } from '../core/events';
import type { RunState } from '../core/state';
import { createAdaptiveScale } from './adaptive';
import { probeRenderCaps } from './caps';
import { createFx } from './fx';
import { installFogPatch } from './glsl';
import { createLightRig, createViewLights } from './lighting';
import { createMaterials } from './materials';
import { getNoiseLayers } from './noise';
import { PostStack } from './post';
import { clampToDevice, resolvePreset } from './preset';
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
  /** Preset efectivo (tras perfil móvil y capacidades del dispositivo). */
  readonly preset: QualityPreset;
  /** El contexto WebGL está perdido (no se dibuja hasta que se restaure). */
  readonly contextLost: boolean;
  /** Capacidades detectadas: HDR half-float, MSAA sobre HDR. */
  readonly caps: { hdr: boolean; msaaHdr: boolean; touch: boolean };
}

export type Engine = EngineApi & EngineExtras;

/**
 * Motor de render: WebGL2, sRGB + ACES, cielo/luz de hora azul, post-proceso propio,
 * materiales y fx procedurales, calidad low/medium/high con escala dinámica de resolución.
 */
export function createEngine(opts: EngineOptions): Engine {
  const { canvas, bus, state } = opts;
  const touch = opts.touch ?? false;
  installFogPatch();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    // En móviles el MSAA del framebuffer por defecto es caro: el AA lo decide el preset (target HDR).
    antialias: !touch,
    powerPreference: touch ? 'default' : 'high-performance',
    stencil: false,
    preserveDrawingBuffer: opts.qa,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = RENDER.exposure;
  renderer.info.autoReset = false;
  renderer.autoClear = false;
  renderer.setClearColor(RENDER.sky.fog);
  renderer.shadowMap.type = THREE.PCFShadowMap;

  // Sondeo real de HDR/MSAA (sin depender sólo de las extensiones): degrada a render directo.
  const caps = probeRenderCaps(renderer.getContext() as WebGL2RenderingContext);

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
  const post = new PostStack(renderer, caps.hdr);
  const screenFx = createScreenFxState();
  const adaptiveCfg = touch ? RENDER.mobile.adaptive : RENDER.adaptive;
  const adaptive = createAdaptiveScale({ ...adaptiveCfg, enabled: adaptiveCfg.enabled && !opts.qa });

  let quality: QualityLevel = opts.quality ?? RENDER.defaultQuality;
  let preset = clampToDevice(resolvePreset(quality, touch), caps);
  const stats: EngineStats = { fps: 60, frameMs: 16.7, drawCalls: 0, triangles: 0, pixelRatio: 1, quality };
  let envRT: THREE.WebGLRenderTarget | null = null;
  let logicalW = canvas.clientWidth || 960;
  let logicalH = canvas.clientHeight || 540;
  let time = 0;
  let lastNow = 0;
  let accT = 0;
  let accFrames = 0;
  let contextLost = false;
  let disposed = false;

  const off = [
    bus.on('player:damaged', (e) => screenFx.onDamaged(e.hpDamage, e.armorDamage, e.source === 'contamination')),
    bus.on('player:died', () => screenFx.onDied()),
    bus.on('flow:started', () => screenFx.reset()),
    bus.on('ui:titleRequested', () => screenFx.reset()),
    bus.on('ui:restartRequested', () => screenFx.reset()),
  ];

  const applySize = (): void => {
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
    const p = preset;
    stats.quality = quality;
    camera.far = p.viewDistance;
    camera.updateProjectionMatrix();
    // La niebla debe cubrir casi por completo la distancia de dibujo (evita ver el recorte).
    fog.density = Math.max(RENDER.fogDensity, Math.sqrt(3) / p.viewDistance);
    sky.dome.scale.setScalar(Math.min(80, p.viewDistance * 0.4));
    if (p.envMap && !envRT) envRT = sky.bakeEnvironment(renderer);
    scene.environment = p.envMap && envRT ? envRT.texture : null;
    viewScene.environment = scene.environment;
    viewScene.environmentIntensity = 1;
    rig.applyQuality(p, scene.environment !== null);
    // Sin HDR renderizable o sin necesidad de post: render directo (tone mapping por material).
    const useHdr = caps.hdr && (p.msaa > 0 || p.bloom);
    post.configure({
      mode: useHdr ? 'hdr' : 'direct',
      msaa: p.msaa,
      bloom: p.bloom && caps.hdr,
      bloomLevels: touch ? RENDER.mobile.bloomLevels : 5,
      lite: touch,
    });
    materials.configure({
      lowTextures: p.lowTextures,
      anisotropy: Math.min(p.anisotropy, renderer.capabilities.getMaxAnisotropy()),
      alphaToCoverage: p.msaa > 0 && useHdr,
      env: scene.environment !== null,
    });
    fx.setQuality(p);
    adaptive.reset();
    applySize();
  };

  // ── Robustez: pérdida de contexto, tamaño, DPR y visibilidad ────────────────
  const onContextLost = (e: Event): void => {
    e.preventDefault();
    contextLost = true;
  };
  const onContextRestored = (): void => {
    // three reinicializa sus recursos de GPU: texturas, buffers y render targets se recrean solos al
    // usarse. Sólo el entorno PMREM (contenido horneado) hay que regenerarlo; el objeto viejo se
    // descarta SIN dispose() (sus handles pertenecen al contexto perdido y darían avisos de GL).
    envRT = null;
    lastNow = 0;
    contextLost = false;
    applyQuality();
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  /** Tamaño lógico real: el del canvas si lo escala el CSS; si no, el de la ventana. */
  const measure = (): [number, number] => {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const cssScaled = cw !== canvas.width || ch !== canvas.height;
    if (cw > 0 && ch > 0 && cssScaled) return [cw, ch];
    return [window.innerWidth, window.innerHeight];
  };
  let resizeRaf = 0;
  let lastDpr = window.devicePixelRatio || 1;
  const scheduleResize = (): void => {
    if (resizeRaf !== 0 || disposed) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      const [w, h] = measure();
      const dpr = window.devicePixelRatio || 1;
      if (w <= 0 || h <= 0 || (w === logicalW && h === logicalH && dpr === lastDpr)) return;
      logicalW = w;
      logicalH = h;
      lastDpr = dpr;
      applySize();
    });
  };
  const cleanups: Array<() => void> = [];
  const listen = (target: EventTarget | null | undefined, type: string): void => {
    if (!target) return;
    target.addEventListener(type, scheduleResize);
    cleanups.push(() => target.removeEventListener(type, scheduleResize));
  };
  listen(window, 'resize');
  listen(window, 'orientationchange');
  listen(window.visualViewport, 'resize');
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(scheduleResize);
    ro.observe(canvas);
    cleanups.push(() => ro.disconnect());
  }
  // El DPR cambia con el zoom del navegador o al mover la ventana entre pantallas.
  const watchDpr = (): void => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const handler = (): void => {
      scheduleResize();
      watchDpr();
    };
    mq.addEventListener('change', handler, { once: true });
    cleanups.push(() => mq.removeEventListener('change', handler));
  };
  watchDpr();
  const onVisibility = (): void => {
    // Al volver de segundo plano el primer dt sería enorme: se reinicia la medición.
    lastNow = 0;
    accT = 0;
    accFrames = 0;
  };
  document.addEventListener('visibilitychange', onVisibility);
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

  const engine: Engine = {
    renderer, scene, camera, viewScene, viewCamera, materials, fx, stats, screenFx,
    moonDir: sky.moonDir,
    caps: { hdr: caps.hdr, msaaHdr: caps.msaaHdr, touch },
    get preset() {
      return preset;
    },
    get contextLost() {
      return contextLost;
    },
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
      lastDpr = window.devicePixelRatio || 1;
      applySize();
    },
    render() {
      // Sin contexto o con la pestaña oculta no se dibuja (evita errores y gasto de batería).
      if (contextLost || document.hidden) {
        lastNow = 0;
        return;
      }
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
      preset = clampToDevice(resolvePreset(quality, touch), caps);
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
      disposed = true;
      cancelAnimationFrame(resizeRaf);
      for (const c of cleanups) c();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
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
