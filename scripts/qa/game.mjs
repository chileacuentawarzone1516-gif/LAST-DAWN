// Ayudas para controlar el juego desde Node a través de window.__qa (src/game/qa.ts).
//  - openGame(): abre /?qa=1, congela el bucle rAF (simulación 100 % determinista por step()),
//    instala la sonda de eventos en la página y devuelve un `Bot`.
//  - Bot: envoltorio con timeouts de las acciones típicas (step, stepUntil, teleport, hold, tap…).
// Todo lo que corre "en la página" se define como función normal y Playwright la serializa.
import { openPage, readEventNames, withTimeout } from './lib.mjs';

// ── Código que se ejecuta EN LA PÁGINA ───────────────────────────────────────

/** Init-script: envuelve requestAnimationFrame para poder congelar/reanudar el bucle del juego. */
function rafGateScript() {
  const orig = window.requestAnimationFrame.bind(window);
  const gate = { open: true, queue: [], calls: 0, orig };
  window.__raf = gate;
  window.requestAnimationFrame = (cb) => {
    if (gate.open) {
      return orig((t) => {
        gate.calls++;
        cb(t);
      });
    }
    gate.queue.push(cb);
    return -1;
  };
}

/** Init-script: sustituye Math.random por un PRNG con semilla (mulberry32). */
function seedScript(seed) {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Instala window.__qaBot: registro de eventos, esperas por predicado y sondas de estado. */
function installBot(eventNames) {
  const q = window.__qa;
  const ctx = q.game.ctx;
  const COUNT_ONLY = new Set(['player:footstep', 'enemy:vocal', 'bullet:impact', 'enemy:attack', 'grenade:bounce', 'player:shot', 'player:hitConfirm', 'enemy:alerted']);
  const LAST_ONLY = new Set(['relay:progress']);
  const log = { counts: {}, events: [], last: {} };
  const clone = (p) => {
    try {
      return JSON.parse(JSON.stringify(p ?? {}));
    } catch {
      return {};
    }
  };
  for (const name of eventNames) {
    ctx.bus.on(name, (p) => {
      log.counts[name] = (log.counts[name] ?? 0) + 1;
      if (COUNT_ONLY.has(name)) return;
      const rec = { type: name, t: ctx.state.match.elapsed, i: log.counts[name], p: clone(p) };
      log.last[name] = rec;
      if (!LAST_ONLY.has(name)) log.events.push(rec);
    });
  }

  const bot = {
    log,
    ownListeners: eventNames.length,
    count: (t) => log.counts[t] ?? 0,
    mark: () => log.events.length,
    events: (t, from = 0) => log.events.filter((e, i) => i >= from && (!t || e.type === t)),
    clearLog() {
      log.counts = {};
      log.events.length = 0;
      log.last = {};
    },
    /** Avanza en trozos de `chunk` s hasta que `predSrc` (expresión JS con q, ctx, s) sea verdadera. */
    stepUntil(maxS, predSrc, chunk) {
      const pred = new Function('q', 'ctx', 's', `return (${predSrc});`);
      let simulated = 0;
      while (simulated < maxS - 1e-9) {
        const d = Math.min(chunk, maxS - simulated);
        q.step(d);
        simulated += d;
        if (pred(q, ctx, ctx.state)) return { ok: true, simS: simulated };
      }
      return { ok: false, simS: simulated };
    },
    /** Rutas de números NO finitos (NaN/Infinity) dentro de `root`. */
    scan(root, maxReport = 10) {
      const bad = [];
      const seen = new Set();
      const walk = (v, path, depth) => {
        if (bad.length >= maxReport) return;
        if (typeof v === 'number') {
          if (!Number.isFinite(v)) bad.push(`${path}=${v}`);
          return;
        }
        if (v && typeof v === 'object') {
          if (seen.has(v) || depth > 8) return;
          seen.add(v);
          for (const k of Object.keys(v)) walk(v[k], path ? `${path}.${k}` : k, depth + 1);
        }
      };
      walk(root, '', 0);
      return bad;
    },
    /** NaN/Infinity en el estado y en los vectores del jugador/cámara. */
    scanAll() {
      return [
        ...bot.scan(ctx.state, 12).map((p) => `state.${p}`),
        ...bot.scan({ pos: ctx.player.position, eye: ctx.player.eye, fwd: ctx.player.forward, vel: ctx.player.velocity }, 6).map((p) => `player.${p}`),
        ...bot.scan({ pos: ctx.camera.position, rot: { x: ctx.camera.rotation.x, y: ctx.camera.rotation.y, z: ctx.camera.rotation.z } }, 6).map((p) => `camera.${p}`),
      ];
    },
    /** Nº de suscripciones vivas del bus (menos las de esta sonda). null si no se puede leer. */
    busListeners() {
      const h = ctx.bus.handlers;
      if (!(h instanceof Map)) return null;
      let n = 0;
      const byType = {};
      for (const [k, set] of h) {
        n += set.size;
        if (set.size) byType[k] = set.size;
      }
      const own = bot.ownListeners;
      for (const k of eventNames) if (byType[k]) byType[k] -= 1;
      return { total: n - own, byType };
    },
    /** Contadores de renderer.info y de la escena (llamar tras engine.render()). */
    sceneStats() {
      const info = ctx.engine.renderer.info;
      const tally = (root) => {
        const t = { objects: 0, meshes: 0, visibleMeshes: 0, instanced: 0, lights: 0 };
        root.traverse((o) => {
          t.objects++;
          if (o.isMesh) {
            t.meshes++;
            if (o.visible) t.visibleMeshes++;
          }
          if (o.isInstancedMesh) t.instanced++;
          if (o.isLight) t.lights++;
        });
        return t;
      };
      const mem = performance.memory;
      return {
        scene: tally(ctx.scene),
        view: tally(ctx.viewScene),
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: Array.isArray(info.programs) ? info.programs.length : null,
        calls: info.render.calls,
        triangles: info.render.triangles,
        statsCalls: ctx.engine.stats.drawCalls,
        statsTriangles: ctx.engine.stats.triangles,
        heapMB: mem ? mem.usedJSHeapSize / 1048576 : null,
      };
    },
    /** Dibuja y analiza los píxeles del lienzo WebGL (readPixels en la misma tarea que render()). */
    canvasStats() {
      q.game.render();
      const gl = ctx.engine.renderer.getContext();
      const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      if (prev) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      if (prev) gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
      const seen = new Set();
      let n = 0;
      let sum = 0;
      let sumSq = 0;
      let dark = 0;
      for (let y = 0; y < h; y += 4) {
        for (let x = 0; x < w; x += 4) {
          const i = (y * w + x) * 4;
          const r = buf[i];
          const g = buf[i + 1];
          const b = buf[i + 2];
          const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          seen.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
          sum += l;
          sumSq += l * l;
          if (l < 8) dark++;
          n++;
        }
      }
      const mean = sum / n;
      const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
      return { w, h, meanLuma: mean, stdLuma: std, distinctColors: seen.size, darkRatio: dark / n, blank: std < 2 || seen.size <= 4 };
    },
  };
  window.__qaBot = bot;
  return true;
}

/** Congela el bucle del juego y espera a que el último frame en vuelo termine. */
async function freezeLoop() {
  const gate = window.__raf;
  gate.open = false;
  await new Promise((resolve) => gate.orig(() => gate.orig(resolve)));
  return gate.queue.length;
}

/** Reanuda el bucle del juego (los rAF retenidos se reenvían al rAF real). */
function resumeLoop() {
  const gate = window.__raf;
  gate.open = true;
  const pending = gate.queue.splice(0);
  for (const cb of pending) {
    gate.orig((t) => {
      gate.calls++;
      cb(t);
    });
  }
  return pending.length;
}

// ── Lado Node ────────────────────────────────────────────────────────────────

/** Envoltorio con timeouts sobre window.__qa/__qaBot. */
export class Bot {
  constructor(page, { timeoutMs = 90_000 } = {}) {
    this.page = page;
    this.timeoutMs = timeoutMs;
  }

  /** page.evaluate con timeout y un único argumento serializable. */
  async ev(fn, arg, label) {
    return withTimeout(this.page.evaluate(fn, arg), this.timeoutMs, label ?? `evaluate ${fn.name || '(anon)'}`);
  }

  /**
   * Ejecuta `fn(ctx, q, arg)` en la página (fn debe ser autocontenida: no puede capturar variables de Node).
   * Sirve para acciones avanzadas sobre game.ctx (enemies.list, enemies.applyDamage, missions…).
   */
  async run(fn, arg) {
    return this.ev(
      ([src, a]) => {
        const q = window.__qa;
        return new Function(`return (${src});`)()(q.game.ctx, q, a);
      },
      [fn.toString(), arg],
      `run ${fn.name || fn.toString().slice(0, 40)}`,
    );
  }

  async step(seconds, dt = 1 / 30) {
    return this.ev(([s, d]) => window.__qa.step(s, d), [seconds, dt], `step(${seconds})`);
  }

  /** Avanza hasta que `pred` (expresión JS con q, ctx, s) sea verdadera o pasen `maxS` s simulados. */
  async stepUntil(maxS, pred, chunk = 0.25) {
    return this.ev(([m, p, c]) => window.__qaBot.stepUntil(m, p, c), [maxS, pred, chunk], `stepUntil(${maxS}, ${pred})`);
  }

  async snap() {
    return this.ev(() => window.__qa.snapshot(), undefined, 'snapshot');
  }

  async input(action, down) {
    return this.ev(([a, d]) => window.__qa.input(a, d), [action, down], `input(${action})`);
  }

  async digit(n) {
    return this.ev((k) => window.__qa.digit(k), n, `digit(${n})`);
  }

  /** Pulsación breve: baja, un paso, sube, un paso. */
  async tap(action) {
    await this.input(action, true);
    await this.step(1 / 30);
    await this.input(action, false);
    await this.step(1 / 30);
  }

  /** Mantiene `action` durante `seconds` s simulados y la suelta. */
  async hold(action, seconds, chunk = 0.5) {
    await this.input(action, true);
    let left = seconds;
    while (left > 1e-6) {
      const d = Math.min(chunk, left);
      await this.step(d);
      left -= d;
    }
    await this.input(action, false);
    await this.step(1 / 30);
  }

  /** Mantiene `action` hasta que `pred` sea cierta (máx. `maxS`); devuelve { ok, simS } y suelta la tecla. */
  async holdUntil(action, maxS, pred, chunk = 0.25) {
    await this.input(action, true);
    const r = await this.stepUntil(maxS, pred, chunk);
    await this.input(action, false);
    await this.step(1 / 30);
    return r;
  }

  /** Teletransporta al jugador y deja pasar `settleS` s para que los sistemas lo asimilen. */
  async teleport(x, z, yaw = 0, settleS = 0.1) {
    await this.ev(([a, b, c]) => window.__qa.teleport(a, b, c), [x, z, yaw], 'teleport');
    if (settleS > 0) await this.step(settleS);
  }

  async god(on) {
    return this.ev((v) => window.__qa.god(v), on, 'god');
  }

  async start() {
    await this.ev(() => window.__qa.start(), undefined, 'start');
    await this.step(1 / 30);
  }

  /** Reinicio como lo pide la UI: evento ui:restartRequested. */
  async restart() {
    await this.run((ctx) => ctx.bus.emit('ui:restartRequested', {}));
    await this.step(1 / 30);
  }

  async toTitle() {
    await this.run((ctx) => ctx.bus.emit('ui:titleRequested', {}));
    await this.step(1 / 30);
  }

  // ── Eventos ────────────────────────────────────────────────────────────────
  async count(type) {
    return this.ev((t) => window.__qaBot.count(t), type, `count(${type})`);
  }

  async mark() {
    return this.ev(() => window.__qaBot.mark(), undefined, 'mark');
  }

  async events(type, from = 0) {
    return this.ev(([t, f]) => window.__qaBot.events(t, f), [type, from], `events(${type})`);
  }

  async clearLog() {
    return this.ev(() => window.__qaBot.clearLog(), undefined, 'clearLog');
  }

  async scanAll() {
    return this.ev(() => window.__qaBot.scanAll(), undefined, 'scanAll');
  }

  async busListeners() {
    return this.ev(() => window.__qaBot.busListeners(), undefined, 'busListeners');
  }

  async sceneStats() {
    return this.ev(() => window.__qaBot.sceneStats(), undefined, 'sceneStats');
  }

  async canvasStats() {
    return this.ev(() => window.__qaBot.canvasStats(), undefined, 'canvasStats');
  }

  /** Renderiza el estado actual y espera a que el compositor lo presente (para capturas). */
  async present() {
    await this.ev(async () => {
      window.__qa.game.render();
      await new Promise((r) => window.__raf.orig(() => window.__raf.orig(r)));
    }, undefined, 'present');
  }

  async screenshot(path) {
    await this.present();
    return withTimeout(this.page.screenshot({ path }), 30_000, 'screenshot');
  }

  async freezeLoop() {
    return this.ev(freezeLoop, undefined, 'freezeLoop');
  }

  async resumeLoop() {
    return this.ev(resumeLoop, undefined, 'resumeLoop');
  }

  async rafFrames() {
    return this.ev(() => window.__raf.calls, undefined, 'rafFrames');
  }
}

/**
 * Abre el juego con ?qa=1 y devuelve { page, context, problems, bot }.
 *  - freeze (true): congela el bucle rAF al arrancar → el tiempo sólo avanza con bot.step().
 *  - seed: fija Math.random (repetibilidad del botín/IA).
 *  - probe (true): instala la sonda de eventos (window.__qaBot).
 */
export async function openGame(browser, baseUrl, { path = '/?qa=1', freeze = true, seed = null, probe = true, timeoutMs = 60_000, botTimeoutMs = 90_000 } = {}) {
  const initScripts = [{ fn: rafGateScript }];
  if (seed !== null) initScripts.push({ fn: seedScript, arg: seed });
  const { page, context, problems } = await openPage(browser, baseUrl + path, { initScripts });
  try {
    await withTimeout(page.waitForFunction(() => !!window.__qa, null, { timeout: timeoutMs, polling: 100 }), timeoutMs + 3000, 'esperar window.__qa');
  } catch (err) {
    const detail = [...problems.pageErrors, ...problems.errors].slice(0, 3).join(' | ');
    throw new Error(`window.__qa no apareció en ${timeoutMs} ms (${err instanceof Error ? err.message : err})${detail ? `; errores: ${detail}` : ''}`);
  }
  const bot = new Bot(page, { timeoutMs: botTimeoutMs });
  if (probe) await bot.ev(installBot, readEventNames(), 'installBot');
  if (freeze) await bot.freezeLoop();
  return { page, context, problems, bot };
}

export { freezeLoop, resumeLoop, rafGateScript, installBot };
