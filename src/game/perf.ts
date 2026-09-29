/**
 * Instrumentación PASIVA de rendimiento y diagnóstico — sólo con `?perf=1`.
 *
 * main.ts carga este módulo con import() dinámico únicamente cuando la URL lleva `?perf=1`: en modo normal
 * ni se descarga ni se ejecuta. Con él activo:
 *  - NO toca el bucle del juego, requestAnimationFrame, el paso de simulación, la calidad, la resolución
 *    dinámica, el render ni el audio: sólo observa. Mide con su PROPIO callback de rAF (uno por frame).
 *  - NO activa los efectos de `?qa=1` (preserveDrawingBuffer, escalado adaptativo desactivado): así sirve
 *    para medir en un dispositivo real. Con `?qa=1&perf=1` el informe marca `validForDeviceFps = false`.
 *  - Expone `window.__perf` (snapshot/summary/download) y un distintivo «PERF» sin interacción.
 * Las estadísticas puras (percentiles, cadencia, buffer) están en perfStats.ts (con tests).
 */
import type { AudioDevApi } from '../audio';
import type { CharacterDevApi } from '../character';
import type { Engine } from '../engine';
import type { TouchSystem } from '../touch';
import type { World } from '../world';
import type { Game } from './Game';
import {
  classifyErrorSource, FrameRing, jsonSafe, RAF_CADENCE_LABEL, rafCadence, round3, summarizeFrames,
} from './perfStats';
import type { ErrorOrigin, FrameSummary, RafCadence } from './perfStats';

/** Versión del formato del informe exportado. */
export const PERF_SCHEMA = 1;
/** Duración de cada ventana de agregación (ms). */
const WINDOW_MS = 5000;
/** Intervalos conservados en bruto (≈ 36 min a 120 Hz; 1 MB + 2 MB de marcas de tiempo). */
const RING_CAPACITY = 1 << 18;
/** Máximo de frames por ventana (sobra para 240 Hz × 5 s). */
const WINDOW_CAPACITY = 4096;
const MAX_EVENTS = 2000;
const MAX_ERRORS = 200;
const MAX_WINDOWS = 2000;
/** Un intervalo mayor que esto se trata como hueco (pestaña congelada, depurador), no como frame. */
const GAP_MS = 10_000;
/** Ventana tras el inicio de cada partida en la que se registra el peor frame (compilación de shaders). */
const RUN_START_WATCH_MS = 5000;
/** Sondeo (ms) de estado discreto: audio, calidad, resolución dinámica, pérdida de contexto. */
const POLL_MS = 250;
/** Marca que main.ts emite al retirar la pantalla de carga (título interactivo). */
export const BOOT_REMOVED_MARK = 'boot:removed';

export interface PerfOptions {
  qa: boolean;
  touch: boolean;
  /** Calidad inicial pedida por main.ts (undefined = la del motor). */
  quality: string | undefined;
}

/** Enganches que usa main.ts (en modo normal no existen: main.ts recibe null). */
export interface PerfHooks {
  mark(label: string): void;
  attachGame(game: Game): void;
  bootFailed(message: string): void;
}

interface PerfEvent {
  t: number;
  type: string;
  detail?: unknown;
}

interface PerfError {
  t: number;
  kind: 'error' | 'resource' | 'promise' | 'csp';
  origin: ErrorOrigin;
  message: string;
  source?: string;
  line?: number;
}

interface WindowSample {
  visibility: string;
  flow: string | null;
  matchElapsed: number | null;
  playerAlive: boolean | null;
  enemiesAlive: number | null;
  quality: string | null;
  engineFps: number | null;
  pixelRatio: number | null;
  resolutionScale: number | null;
  drawCalls: number | null;
  triangles: number | null;
  postCalls: number | null;
  drawingBuffer: [number, number] | null;
  viewport: [number, number];
  dpr: number;
  gpuResources: { geometries: number; textures: number; programs: number | null } | null;
  /** performance.memory (sólo Chromium, cuantizado): dato de clase C, NO es memoria real del proceso. */
  heapMB: { used: number; total: number; limit: number } | null;
  audioState: string | null;
  touchMode: string | null;
  contextLost: boolean | null;
}

interface PerfWindow extends FrameSummary {
  index: number;
  tStart: number;
  tEnd: number;
  flowStart: string | null;
  flowEnd: string | null;
  /** Frames descartados por exceder la capacidad de la ventana. */
  overflow: number;
  sample: WindowSample | null;
}

interface RunStart {
  index: number;
  t: number;
  /** Peor intervalo en los primeros 5 s de la partida (incluye compilación de shaders). */
  maxFrameMsFirst5s: number;
  framesFirst5s: number;
}

interface CharacterLoad {
  t: number;
  gender: string;
  low: boolean;
  loadMs: number;
  downloadBytes: number;
  textureBytesEstimate: number;
}

export interface PerfApi {
  readonly mode: 'instrumented';
  readonly schema: number;
  /** Marca con nombre (escenas, inicio/fin de un tramo de medición). */
  mark(label: string): void;
  /** Resumen de frames en [fromMs, toMs] (ms de performance.now); por defecto todo lo conservado. */
  summary(fromMs?: number, toMs?: number): FrameSummary & { cadence: RafCadence };
  /** Informe completo apto para JSON. `raw: true` incluye todos los intervalos conservados. */
  snapshot(opts?: { raw?: boolean }): unknown;
  /** Descarga el informe como JSON y devuelve el nombre del fichero. */
  download(opts?: { raw?: boolean }): string;
  /** Descarta frames y ventanas (p. ej. tras el calentamiento); conserva arranque, eventos y errores. */
  resetFrames(): void;
}

declare global {
  interface Window {
    __perf?: PerfApi;
  }
}

const r1 = (v: number): number => Math.round(v * 10) / 10;
const now = (): number => performance.now();
const truncate = (s: string, n = 240): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Instala la instrumentación. Sólo debe llamarse con `?perf=1` (main.ts). */
export function installPerf(opts: PerfOptions): PerfHooks {
  const installedAt = now();
  const origin = window.location.origin;
  const events: PerfEvent[] = [];
  let droppedEvents = 0;
  const errors: PerfError[] = [];
  const errorCounts: Record<string, number> = {};
  let instrumentationErrors = 0;
  const marks: Record<string, number> = {};

  const ring = new FrameRing(RING_CAPACITY);
  const winValues = new Float32Array(WINDOW_CAPACITY);
  const winScratch = new Float32Array(WINDOW_CAPACITY);
  // Buffers del resumen por rango: se reservan sólo al pedir un informe (nunca en el bucle).
  let rangeValues: Float32Array | null = null;
  let rangeScratch: Float32Array | null = null;
  let winCount = 0;
  let winOverflow = 0;
  let winStart = 0;
  let winFlowStart: string | null = null;
  const windows: PerfWindow[] = [];
  let droppedWindows = 0;
  let windowIndex = 0;

  let lastTs = 0;
  let gap = true;
  let gaps = 0;
  let pollT = 0;
  let bootRemovedAt: number | null = null;
  let firstFrameAfterBoot: { t: number; frameMs: number | null } | null = null;
  const runs: RunStart[] = [];
  const characterLoads: CharacterLoad[] = [];
  const seenLoads = new Set<string>();
  let bootError: string | null = null;

  const overhead = { callbackMs: 0, callbacks: 0, maxCallbackMs: 0, flushMs: 0, flushes: 0 };
  let game: Game | null = null;
  let device: Record<string, unknown> = {};
  let highEntropy: Record<string, unknown> | null = null;
  const lastPolled = { audio: '', quality: '', scale: -1, lost: false };
  let lastSize = '';

  const pushEvent = (type: string, detail?: unknown): void => {
    if (events.length >= MAX_EVENTS) {
      droppedEvents++;
      return;
    }
    events.push(detail === undefined ? { t: r1(now()), type } : { t: r1(now()), type, detail });
  };

  const pushError = (e: Omit<PerfError, 't'>): void => {
    const key = `${e.kind}:${e.origin}`;
    errorCounts[key] = (errorCounts[key] ?? 0) + 1;
    if (errors.length < MAX_ERRORS) errors.push({ t: r1(now()), ...e, message: truncate(e.message) });
  };

  // ── Acceso de sólo lectura al juego (todo protegido: la instrumentación nunca debe romper el juego) ──
  const engineOf = (): Engine | null => (game ? (game.ctx.engine as Engine) : null);

  const sample = (): WindowSample | null => {
    try {
      const ctx = game?.ctx;
      const engine = engineOf();
      const s = ctx?.state;
      const info = engine?.renderer.info;
      const gl = engine ? engine.renderer.getContext() : null;
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
      const audio = ctx ? (ctx.audio as Partial<AudioDevApi>) : null;
      const touch = ctx ? (ctx.touch as Partial<TouchSystem>) : null;
      const enemies = ctx ? (ctx.enemies as { aliveCount?: number } | undefined) : undefined;
      return {
        visibility: document.visibilityState,
        flow: s ? s.flow : null,
        matchElapsed: s ? round3(s.match.elapsed) : null,
        playerAlive: s ? s.player.alive : null,
        enemiesAlive: typeof enemies?.aliveCount === 'number' ? enemies.aliveCount : null,
        quality: engine ? engine.stats.quality : null,
        engineFps: engine ? r1(engine.stats.fps) : null,
        pixelRatio: engine ? round3(engine.stats.pixelRatio) : null,
        resolutionScale: engine ? engine.resolutionScale : null,
        drawCalls: engine ? engine.stats.drawCalls : null,
        triangles: engine ? engine.stats.triangles : null,
        postCalls: engine ? engine.postCalls : null,
        drawingBuffer: gl ? [gl.drawingBufferWidth, gl.drawingBufferHeight] : null,
        viewport: [window.innerWidth, window.innerHeight],
        dpr: window.devicePixelRatio || 1,
        gpuResources: info ? { geometries: info.memory.geometries, textures: info.memory.textures, programs: Array.isArray(info.programs) ? info.programs.length : null } : null,
        heapMB: mem ? { used: r1(mem.usedJSHeapSize / 1048576), total: r1(mem.totalJSHeapSize / 1048576), limit: r1(mem.jsHeapSizeLimit / 1048576) } : null,
        audioState: audio?.engine ? audio.engine.state : null,
        touchMode: touch?.debug ? touch.debug.mode : null,
        contextLost: engine ? engine.contextLost : null,
      };
    } catch {
      instrumentationErrors++;
      return null;
    }
  };

  const flowNow = (): string | null => (game ? game.ctx.state.flow : null);

  const flushWindow = (ts: number): void => {
    const f0 = now();
    if (winCount > 0) {
      const w: PerfWindow = {
        index: windowIndex++,
        tStart: r1(winStart),
        tEnd: r1(ts),
        flowStart: winFlowStart,
        flowEnd: flowNow(),
        overflow: winOverflow,
        ...summarizeFrames(winValues, winCount, winScratch),
        sample: sample(),
      };
      if (windows.length < MAX_WINDOWS) windows.push(w);
      else droppedWindows++;
    }
    winCount = 0;
    winOverflow = 0;
    winStart = ts;
    winFlowStart = flowNow();
    overhead.flushMs += now() - f0;
    overhead.flushes++;
  };

  /** Estado discreto que interesa como evento cuando cambia (audio, calidad, escala, contexto). */
  const poll = (): void => {
    try {
      const engine = engineOf();
      if (!engine || !game) return;
      const audio = game.ctx.audio as Partial<AudioDevApi>;
      const a = audio.engine ? audio.engine.state : 'n/a';
      if (a !== lastPolled.audio) {
        pushEvent('audio:state', { state: a });
        lastPolled.audio = a;
      }
      const q = engine.stats.quality;
      if (q !== lastPolled.quality) {
        pushEvent('engine:quality', { quality: q, preset: { ...engine.preset } });
        lastPolled.quality = q;
      }
      const sc = engine.resolutionScale;
      if (sc !== lastPolled.scale) {
        pushEvent('engine:resolutionScale', { scale: sc, pixelRatio: round3(engine.stats.pixelRatio) });
        lastPolled.scale = sc;
      }
      if (engine.contextLost !== lastPolled.lost) {
        pushEvent('engine:contextLost', { lost: engine.contextLost });
        lastPolled.lost = engine.contextLost;
      }
      const lib = (game.ctx.character as Partial<CharacterDevApi>).library;
      if (lib) {
        for (const g of ['male', 'female'] as const) {
          const asset = lib.get(g);
          if (!asset) continue;
          const key = `${g}:${asset.low ? 'low' : 'high'}:${asset.loadMs}`;
          if (seenLoads.has(key)) continue;
          seenLoads.add(key);
          characterLoads.push({
            t: r1(now()), gender: g, low: asset.low, loadMs: r1(asset.loadMs), downloadBytes: asset.downloadBytes, textureBytesEstimate: asset.textureBytes,
          });
        }
      }
    } catch {
      instrumentationErrors++;
    }
  };

  // ── Bucle de medición: callback de rAF PROPIO (el del juego no se toca) ────────────────────
  const measure = (ts: number): void => {
    if (lastTs > 0 && !gap) {
      const dt = ts - lastTs;
      if (dt > GAP_MS) {
        gaps++;
        pushEvent('perf:gap', { ms: r1(dt) });
      } else if (dt > 0) {
        ring.push(dt, ts);
        if (winCount < WINDOW_CAPACITY) winValues[winCount++] = dt;
        else winOverflow++;
        const run = runs.length > 0 ? (runs[runs.length - 1] as RunStart) : null;
        if (run && ts - run.t <= RUN_START_WATCH_MS) {
          run.framesFirst5s++;
          if (dt > run.maxFrameMsFirst5s) run.maxFrameMsFirst5s = r1(dt);
        }
        if (bootRemovedAt !== null && firstFrameAfterBoot === null) firstFrameAfterBoot = { t: r1(ts), frameMs: r1(dt) };
      }
    } else if (gap) {
      if (winStart === 0) {
        winStart = ts;
        winFlowStart = flowNow();
      }
    }
    gap = false;
    lastTs = ts;
    if (ts - winStart >= WINDOW_MS) flushWindow(ts);
    if (ts - pollT >= POLL_MS) {
      pollT = ts;
      poll();
    }
  };

  const tick = (ts: number): void => {
    const c0 = now();
    // Un fallo de la instrumentación nunca debe romper su bucle ni aparecer como error del juego.
    try {
      measure(ts);
    } catch {
      instrumentationErrors++;
    }
    const spent = now() - c0;
    overhead.callbackMs += spent;
    overhead.callbacks++;
    if (spent > overhead.maxCallbackMs) overhead.maxCallbackMs = spent;
    requestAnimationFrame(tick);
  };

  // ── Ciclo de vida y errores (escucha pasiva; nunca preventDefault) ────────────────────────
  const markGap = (): void => {
    gap = true;
  };
  document.addEventListener('visibilitychange', () => {
    pushEvent('lifecycle:visibility', { state: document.visibilityState });
    markGap();
  });
  window.addEventListener('pagehide', (e) => {
    pushEvent('lifecycle:pagehide', { persisted: e.persisted });
    markGap();
  });
  window.addEventListener('pageshow', (e) => {
    pushEvent('lifecycle:pageshow', { persisted: e.persisted });
    markGap();
  });
  document.addEventListener('freeze', () => {
    pushEvent('lifecycle:freeze');
    markGap();
  });
  document.addEventListener('resume', () => {
    pushEvent('lifecycle:resume');
    markGap();
  });
  window.addEventListener('blur', () => pushEvent('lifecycle:blur'));
  window.addEventListener('focus', () => pushEvent('lifecycle:focus'));
  document.addEventListener('fullscreenchange', () => pushEvent('display:fullscreen', { active: document.fullscreenElement !== null }));
  document.addEventListener('fullscreenerror', () => pushEvent('display:fullscreenError'));
  const orient = (screen as Screen & { orientation?: ScreenOrientation }).orientation;
  const orientation = (): { type: string; angle: number } | null => (orient ? { type: orient.type, angle: orient.angle } : null);
  if (orient) orient.addEventListener('change', () => pushEvent('display:orientation', orientation()));
  window.addEventListener('resize', () => {
    const key = `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio || 1}`;
    if (key === lastSize) return;
    lastSize = key;
    pushEvent('display:resize', { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 });
  });
  window.addEventListener(
    'error',
    (e: Event) => {
      if (e instanceof ErrorEvent) {
        pushError({ kind: 'error', origin: classifyErrorSource(e.filename, origin), message: e.message || String(e.error), source: e.filename || undefined, line: e.lineno || undefined });
        return;
      }
      const t = e.target as (Element & { src?: string; href?: string }) | null;
      if (t && t !== (window as unknown as EventTarget) && typeof t.tagName === 'string') {
        const src = t.src || t.href || '';
        pushError({ kind: 'resource', origin: classifyErrorSource(src, origin), message: `${t.tagName.toLowerCase()} no cargó`, source: src || undefined });
      }
    },
    true,
  );
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const reason = e.reason instanceof Error ? `${e.reason.name}: ${e.reason.message}` : String(e.reason);
    const stack = e.reason instanceof Error ? (e.reason.stack ?? '') : '';
    pushError({ kind: 'promise', origin: stack.includes(origin) ? 'app' : 'unknown', message: reason });
  });
  document.addEventListener('securitypolicyviolation', (e: SecurityPolicyViolationEvent) => {
    pushError({ kind: 'csp', origin: 'unknown', message: `${e.effectiveDirective} bloqueó ${e.blockedURI || '(inline)'}`, source: e.sourceFile || undefined });
  });

  // ── Dispositivo ───────────────────────────────────────────────────────────
  const readDevice = (): Record<string, unknown> => {
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { effectiveType?: string; saveData?: boolean };
      userAgentData?: { brands?: Array<{ brand: string; version: string }>; mobile?: boolean; platform?: string };
    };
    const mm = (q: string): boolean | null => {
      try {
        return window.matchMedia(q).matches;
      } catch {
        return null;
      }
    };
    return {
      userAgent: nav.userAgent,
      uaBrands: nav.userAgentData?.brands ?? null,
      uaMobile: nav.userAgentData?.mobile ?? null,
      uaPlatform: nav.userAgentData?.platform ?? null,
      hardwareConcurrency: nav.hardwareConcurrency ?? null,
      deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
      maxTouchPoints: nav.maxTouchPoints,
      connection: nav.connection ? { effectiveType: nav.connection.effectiveType ?? null, saveData: nav.connection.saveData ?? null } : null,
      secureContext: window.isSecureContext,
      dpr: window.devicePixelRatio || 1,
      screen: { w: screen.width, h: screen.height, availW: screen.availWidth, availH: screen.availHeight },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      orientation: orientation(),
      media: {
        pointerCoarse: mm('(pointer: coarse)'), anyPointerFine: mm('(any-pointer: fine)'), reducedMotion: mm('(prefers-reduced-motion: reduce)'),
      },
    };
  };

  const readWebgl = (engine: Engine): Record<string, unknown> => {
    const gl = engine.renderer.getContext() as WebGL2RenderingContext;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const attrs = gl.getContextAttributes();
    return {
      version: String(gl.getParameter(gl.VERSION)),
      glsl: String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)),
      vendor: String(gl.getParameter(gl.VENDOR)),
      renderer: String(gl.getParameter(gl.RENDERER)),
      unmaskedVendor: dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : null,
      unmaskedRenderer: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : null,
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      maxSamples: gl.getParameter(gl.MAX_SAMPLES) as number,
      contextAttributes: attrs ? { antialias: attrs.antialias, preserveDrawingBuffer: attrs.preserveDrawingBuffer, powerPreference: attrs.powerPreference, alpha: attrs.alpha } : null,
      timerQueryExtension: gl.getSupportedExtensions()?.includes('EXT_disjoint_timer_query_webgl2') ?? false,
      caps: { ...engine.caps },
      preset: { ...engine.preset },
    };
  };

  const buildId = (): string | null => {
    const s = document.querySelector('script[type="module"][src]') as HTMLScriptElement | null;
    return s ? new URL(s.src).pathname : null;
  };

  // ── Informe ───────────────────────────────────────────────────────────────
  const rangeSummary = (fromMs = -Infinity, toMs = Infinity): FrameSummary & { cadence: RafCadence } => {
    rangeValues ??= new Float32Array(RING_CAPACITY);
    rangeScratch ??= new Float32Array(RING_CAPACITY);
    const n = ring.copyRange(fromMs, toMs, rangeValues);
    return { ...summarizeFrames(rangeValues, n, rangeScratch), cadence: rafCadence(rangeValues, n, rangeScratch) };
  };

  const startup = (): Record<string, unknown> => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const paints: Record<string, number> = {};
    for (const p of performance.getEntriesByType('paint')) paints[p.name] = r1(p.startTime);
    const world = game ? (game.ctx.world as Partial<World>).stats : undefined;
    const models = performance
      .getEntriesByType('resource')
      .filter((e) => e.name.includes('/models/'))
      .map((e) => {
        const r = e as PerformanceResourceTiming;
        return { path: new URL(r.name).pathname, startMs: r1(r.startTime), durationMs: r1(r.duration), transferSize: r.transferSize, encodedBodySize: r.encodedBodySize };
      });
    return {
      navigation: nav
        ? {
          type: nav.type, responseEndMs: r1(nav.responseEnd), domInteractiveMs: r1(nav.domInteractive), domContentLoadedMs: r1(nav.domContentLoadedEventEnd),
          loadEventMs: r1(nav.loadEventEnd), transferSize: nav.transferSize,
        }
        : null,
      paint: paints,
      perfInstalledMs: r1(installedAt),
      marks,
      gameConstructMs: marks['game:construct'] !== undefined && marks['game:attached'] !== undefined ? r1(marks['game:attached'] - marks['game:construct']) : null,
      world: world ? { buildMs: r1(world.buildMs), phases: { layout: r1(world.phases.layout), nav: r1(world.phases.nav), render: r1(world.phases.render) }, drawCalls: world.drawCalls, triangles: world.triangles, colliders: world.colliders } : null,
      bootRemovedMs: bootRemovedAt,
      firstFrameAfterBoot,
      bootError,
      runs: runs.map((r) => ({ ...r })),
      characterLoads: characterLoads.map((c) => ({ ...c })),
      modelResources: models,
    };
  };

  const snapshot = (o: { raw?: boolean } = {}): unknown => {
    const engine = engineOf();
    const attrs = engine ? (engine.renderer.getContext().getContextAttributes() ?? null) : null;
    const validForDeviceFps = !opts.qa && attrs !== null && attrs.preserveDrawingBuffer === false;
    const notes: string[] = [];
    if (opts.qa) notes.push('?qa=1 activo: preserveDrawingBuffer y escalado adaptativo desactivado alteran el render; FPS NO válidos como medición de dispositivo.');
    notes.push(`La cadencia de rAF se etiqueta como «${RAF_CADENCE_LABEL}»: NO es la frecuencia física de la pantalla.`);
    notes.push('heapMB procede de performance.memory (Chromium, cuantizado): no es la memoria real del proceso ni de la GPU.');
    const report = {
      schema: PERF_SCHEMA,
      mode: 'instrumented',
      capturedAtMs: r1(now()),
      capturedAtIso: new Date().toISOString(),
      page: { path: window.location.pathname, search: window.location.search, buildId: buildId() },
      flags: { qa: opts.qa, touch: opts.touch, qualityParam: opts.quality ?? null },
      validForDeviceFps,
      notes,
      device: { ...device, highEntropy },
      webgl: engine ? readWebgl(engine) : null,
      startup: startup(),
      frames: {
        recorded: ring.total,
        retained: ring.length,
        gaps,
        windowMs: WINDOW_MS,
        session: rangeSummary(),
        windows,
        droppedWindows,
        raw: o.raw ? ring.toArrays() : undefined,
      },
      events,
      droppedEvents,
      errors: { counts: { ...errorCounts }, list: errors },
      overhead: {
        callbacks: overhead.callbacks,
        callbackMsTotal: round3(overhead.callbackMs),
        callbackUsAvg: overhead.callbacks > 0 ? round3((overhead.callbackMs * 1000) / overhead.callbacks) : null,
        callbackMsMax: round3(overhead.maxCallbackMs),
        flushes: overhead.flushes,
        flushMsTotal: round3(overhead.flushMs),
        note: 'Tiempo medido dentro de los callbacks de la instrumentación; no incluye el coste del navegador por programar un rAF adicional.',
      },
      instrumentationErrors,
    };
    return jsonSafe(report);
  };

  const api: PerfApi = {
    mode: 'instrumented',
    schema: PERF_SCHEMA,
    mark(label) {
      const l = truncate(String(label), 80);
      const t = r1(now());
      marks[l] = t;
      if (l === BOOT_REMOVED_MARK && bootRemovedAt === null) bootRemovedAt = t;
      pushEvent('mark', { label: l });
    },
    summary: (fromMs, toMs) => jsonSafe(rangeSummary(fromMs, toMs)) as FrameSummary & { cadence: RafCadence },
    snapshot,
    download(o = {}) {
      const name = `lastdawn-perf-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const blob = new Blob([JSON.stringify(snapshot(o))], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return name;
    },
    resetFrames() {
      ring.clear();
      windows.length = 0;
      droppedWindows = 0;
      winCount = 0;
      winOverflow = 0;
      gap = true;
      pushEvent('perf:resetFrames');
    },
  };
  window.__perf = api;

  // Distintivo visible del modo instrumentado (sin interacción: no captura toques).
  document.documentElement.dataset.perf = '1';
  const badge = document.createElement('div');
  badge.className = 'perf-badge';
  badge.textContent = 'PERF';
  badge.setAttribute('aria-hidden', 'true');
  badge.style.cssText =
    'position:fixed;left:calc(env(safe-area-inset-left,0px) + 2px);top:50%;z-index:60;pointer-events:none;' +
    'font:700 9px/1 system-ui,sans-serif;letter-spacing:.08em;color:#5fe0b7;opacity:.6;transform:translateY(-50%)';
  document.body.appendChild(badge);

  device = readDevice();
  lastSize = `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio || 1}`;
  const uad = (navigator as Navigator & { userAgentData?: { getHighEntropyValues?: (h: string[]) => Promise<Record<string, unknown>> } }).userAgentData;
  if (uad?.getHighEntropyValues) {
    uad.getHighEntropyValues(['model', 'platformVersion', 'fullVersionList', 'architecture']).then(
      (v) => {
        highEntropy = { ...v };
      },
      () => {
        highEntropy = { unavailable: true };
      },
    );
  }
  pushEvent('perf:installed', { qa: opts.qa, touch: opts.touch });
  requestAnimationFrame(tick);

  return {
    mark: api.mark,
    attachGame(g) {
      game = g;
      marks['game:attached'] = r1(now());
      const { bus } = g.ctx;
      bus.on('flow:started', () => {
        runs.push({ index: runs.length, t: now(), maxFrameMsFirst5s: 0, framesFirst5s: 0 });
        pushEvent('flow:started');
      });
      bus.on('flow:paused', () => pushEvent('flow:paused'));
      bus.on('flow:resumed', () => pushEvent('flow:resumed'));
      bus.on('flow:ended', (e) => pushEvent('flow:ended', { result: e.result, reason: e.reason }));
      bus.on('ui:titleRequested', () => pushEvent('flow:titleRequested'));
      bus.on('input:lockChanged', (e) => pushEvent('input:lockChanged', { locked: e.locked }));
      bus.on('player:died', () => pushEvent('player:died'));
      const engine = g.ctx.engine as Engine;
      g.ctx.engine.renderer.domElement.addEventListener('webglcontextlost', () => pushEvent('webgl:contextlost'));
      g.ctx.engine.renderer.domElement.addEventListener('webglcontextrestored', () => pushEvent('webgl:contextrestored'));
      lastPolled.quality = engine.stats.quality;
      lastPolled.scale = engine.resolutionScale;
      pushEvent('engine:initial', { quality: engine.stats.quality, resolutionScale: engine.resolutionScale, preset: { ...engine.preset }, caps: { ...engine.caps } });
    },
    bootFailed(message) {
      bootError = truncate(message);
      pushEvent('boot:error', { message: bootError });
    },
  };
}
