#!/usr/bin/env node
// QA · SMOKE — el juego arranca, dibuja y simula 10 s sin errores.
//
// Uso:  node scripts/qa/smoke.mjs [--dev] [--port=5208] [--rebuild] [--pnpm-build]
//                                  [--steps=10] [--skip-nowebgl] [--keep-server]
//   (sin flags)   build de producción aislado (qa-output/dist) + vite preview
//   --dev         vite dev server
//   --pnpm-build  fuerza `pnpm build` (tsc + vite → dist/)
//
// Comprueba: WebGL2, cero pageerror/console.error/requestfailed, lienzo NO en blanco (readPixels),
// window.__qa completo, arranque de partida, simulación de N s (NaN/Infinity, reloj, spawn),
// captura de pantalla, y el aviso amistoso cuando el navegador NO tiene WebGL2.
import { join } from 'node:path';
import { loadConfig, moduleStatus, launchBrowser, openPage, serveGame, analyzePng, ensureOutDir, formatProblems, hasProblems, parseArgs, numArg, Report, runMain, sleep, withTimeout, DEFAULT_PORT } from './lib.mjs';
import { openGame } from './game.mjs';

const QA_FUNCTIONS = ['snapshot', 'start', 'step', 'teleport', 'setElapsed', 'god', 'giveMoney', 'spawnEnemy', 'killAllEnemies', 'input', 'digit', 'complete', 'stats'];

/** Init-script: el 2.º getContext('webgl2') devuelve null (simula fallo al crear el renderer). */
function failSecondContext() {
  const orig = HTMLCanvasElement.prototype.getContext;
  let n = 0;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (type === 'webgl2' && ++n >= 2) return null;
    return orig.call(this, type, ...rest);
  };
}

/** Init-script: ningún contexto WebGL (respaldo si el flag --disable-gpu no basta en este entorno). */
function noWebglOverride() {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (typeof type === 'string' && /webgl/i.test(type)) return null;
    return orig.call(this, type, ...rest);
  };
}

async function main() {
  const args = parseArgs();
  const port = numArg(args, 'port', DEFAULT_PORT);
  const steps = numArg(args, 'steps', 10);
  const cfg = await loadConfig();
  const mods = moduleStatus();
  const outDir = ensureOutDir('smoke');
  const R = new Report(`SMOKE (${args.dev ? 'dev' : 'producción'})`);
  R.info(`módulos reales: ${mods.reals.join(', ') || '(ninguno)'} · stubs: ${mods.stubs.join(', ') || '(ninguno)'}`);

  const srv = await serveGame({ dev: !!args.dev, port, force: !!args.rebuild, pnpmBuild: !!args['pnpm-build'], log: (m) => R.info(m) });
  R.info(`servidor ${srv.kind} en ${srv.url}${srv.buildInfo?.built ? ` (build ${srv.buildInfo.ms} ms)` : ''}`);

  // ── 1. Arranque con WebGL2 ────────────────────────────────────────────────
  R.section('Arranque y WebGL2');
  let browser = await launchBrowser();
  try {
    const { page, problems, bot } = await openGame(browser, srv.url, { freeze: false });

    const gl = await bot.run((ctx) => {
      const g = ctx.engine.renderer.getContext();
      const dbg = g.getExtension('WEBGL_debug_renderer_info');
      return {
        isGL2: typeof WebGL2RenderingContext !== 'undefined' && g instanceof WebGL2RenderingContext,
        version: String(g.getParameter(g.VERSION)),
        renderer: dbg ? String(g.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'n/d',
      };
    });
    R.check('WebGL2 disponible en el renderer', gl.isGL2, `${gl.version} · ${gl.renderer}`);
    R.check('overlay de carga (#boot) retirado', (await page.$('#boot')) === null);
    R.check('sin tarjeta de error de arranque (.boot-error)', (await page.$('.boot-error')) === null);

    const surface = await bot.ev((fns) => ({ hasGame: !!window.__qa.game?.ctx, missing: fns.filter((f) => typeof window.__qa[f] !== 'function') }), QA_FUNCTIONS);
    R.check('window.__qa expone game.ctx y toda la API de QA', surface.hasGame && surface.missing.length === 0, surface.missing.length ? `faltan: ${surface.missing.join(', ')}` : `${QA_FUNCTIONS.length} funciones`);

    const flow0 = (await bot.snap()).flow;
    R.check("flujo inicial = 'title'", flow0 === 'title', `flow=${flow0}`);

    // Bucle real (rAF) en la pantalla de título.
    // En render por software el primer frame incluye compilar shaders: se espera hasta 10 s.
    const f0 = await bot.rafFrames();
    let advanced = 0;
    const tLoop = Date.now();
    while (Date.now() - tLoop < 10000 && advanced < 2) {
      await sleep(250);
      advanced = (await bot.rafFrames()) - f0;
    }
    const loopMs = Date.now() - tLoop;
    R.check('el bucle rAF del juego avanza en el título', advanced >= 1, `${advanced} frames en ${(loopMs / 1000).toFixed(1)} s (SwiftShader es lento)`);
    R.soft('fluidez mínima en título (≥2 frames en 10 s; sólo orientativo en render por software)', advanced >= 2, `${advanced} frames`);
    const titleCanvas = await bot.canvasStats();
    R.check('lienzo del título NO está en blanco (readPixels)', !titleCanvas.blank, `${titleCanvas.w}x${titleCanvas.h} · colores=${titleCanvas.distinctColors} · σ=${titleCanvas.stdLuma.toFixed(1)} · oscuros=${(titleCanvas.darkRatio * 100).toFixed(0)}%`);

    // ── 2. Partida ──────────────────────────────────────────────────────────
    R.section('Partida');
    await bot.ev(() => window.__qa.start(), undefined, 'start');
    const s0 = await bot.snap();
    R.check("start() → flow 'playing' y fase 'playing'", s0.flow === 'playing' && s0.match.phase === 'playing', `flow=${s0.flow} phase=${s0.match.phase}`);
    R.check("evento 'flow:started' emitido una vez", (await bot.count('flow:started')) === 1);

    await sleep(1500); // bucle real con partida en curso
    const sReal = await bot.snap();
    R.check('el reloj avanza con el bucle real (rAF)', sReal.match.elapsed > 0.02, `elapsed=${sReal.match.elapsed.toFixed(2)} s tras ~1.5 s reales`);
    await bot.freezeLoop();

    // Spawn del jugador (sin haber movido nada).
    const sp = cfg.MAP.spawn;
    const pos = sReal.player.pos;
    const dSpawn = Math.hypot(pos.x - sp.x, pos.z - sp.z);
    R.check('jugador en su spawn (MAP.spawn)', dSpawn < 1.5, `pos=(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}) · spawn=(${sp.x}, ${sp.z}) · Δ=${dSpawn.toFixed(2)} m`);
    R.check("zona del spawn = 'perimeter'", sReal.player.zone === 'perimeter', `zone=${sReal.player.zone}`);
    R.soft('jugador a ras de suelo (|y| < 1)', Math.abs(pos.y) < 1, `y=${pos.y.toFixed(3)}`);

    // Sincronía player ↔ state.player (detecta módulos que cachean sub-objetos antiguos de ctx.state).
    const sync = await bot.run((ctx) => ({ px: ctx.player.position.x, pz: ctx.player.position.z, sx: ctx.state.player.pos.x, sz: ctx.state.player.pos.z }));
    R.check('ctx.player y state.player.pos están sincronizados', Math.hypot(sync.px - sync.sx, sync.pz - sync.sz) < 0.05,
      `player=(${sync.px.toFixed(2)}, ${sync.pz.toFixed(2)}) state=(${sync.sx.toFixed(2)}, ${sync.sz.toFixed(2)}) — si difieren, el módulo player escribe en un sub-objeto obsoleto tras resetRunState()`);

    // ── 3. Simulación de N s ────────────────────────────────────────────────
    R.section(`Simulación de ${steps} s`);
    const t0 = sReal.match.elapsed;
    const wall0 = Date.now();
    await bot.step(steps);
    const wallMs = Date.now() - wall0;
    const s1 = await bot.snap();
    const dElapsed = s1.match.elapsed - t0;
    const stillPlaying = s1.match.phase === 'playing';
    R.check(`el reloj avanza ${steps} s de partida`, stillPlaying ? Math.abs(dElapsed - steps) < 0.06 : dElapsed > 0, `Δelapsed=${dElapsed.toFixed(3)} s (${wallMs} ms reales, ${(wallMs / (steps * 30)).toFixed(2)} ms/paso)`);
    const bad = await bot.scanAll();
    R.check('estado sin NaN/Infinity (state, jugador, cámara)', bad.length === 0, bad.length ? bad.join(', ') : 'todo finito');
    const p1 = s1.player.pos;
    const drift = Math.hypot(p1.x - sp.x, p1.z - sp.z);
    R.check('jugador inmóvil sigue en su spawn tras la simulación', drift < 3, `Δ=${drift.toFixed(2)} m`);
    R.soft('jugador vivo tras la simulación', s1.player.alive && s1.player.hp > 0, `alive=${s1.player.alive} hp=${s1.player.hp}`);
    R.soft('partida sigue en curso (sin fin prematuro)', stillPlaying, `phase=${s1.match.phase} reason=${s1.match.endReason}`);

    // ── 4. Render y captura ─────────────────────────────────────────────────
    R.section('Render y captura');
    const playCanvas = await bot.canvasStats();
    R.check('lienzo de juego NO está en blanco (readPixels)', !playCanvas.blank, `colores=${playCanvas.distinctColors} · σ=${playCanvas.stdLuma.toFixed(1)} · luma media=${playCanvas.meanLuma.toFixed(0)} · oscuros=${(playCanvas.darkRatio * 100).toFixed(0)}%`);
    const st = await bot.ev(() => window.__qa.stats(), undefined, 'stats');
    R.check('engine.stats con drawCalls y triángulos > 0', st.drawCalls > 0 && st.triangles > 0, `drawCalls=${st.drawCalls} triángulos=${st.triangles} enemigos=${st.enemies}`);
    const shot = join(outDir, 'smoke-play.png');
    const png = await bot.screenshot(shot);
    try {
      const a = analyzePng(png);
      R.soft('captura de pantalla NO está en blanco', !a.blank, `${a.width}x${a.height} · colores=${a.distinctColors} · σ=${a.stdLuma.toFixed(1)} → ${shot}`);
    } catch (err) {
      R.warn('captura: no se pudo analizar el PNG', String(err));
    }

    // ── 5. Errores de consola ───────────────────────────────────────────────
    R.section('Errores de consola/red');
    R.check('cero pageerror / console.error / requestfailed', !hasProblems(problems), hasProblems(problems) ? `\n${formatProblems(problems)}` : 'limpio');
    if (problems.warnings.length) {
      const uniq = [...new Set(problems.warnings)].slice(0, 5);
      R.warn(`${problems.warnings.length} console.warn (informativo)`, uniq.map((w) => w.slice(0, 140)).join(' | '));
    }

    // ── 6. Fallo del renderer con WebGL2 presente ───────────────────────────
    R.section('Fallo al crear el renderer (contexto denegado la 2.ª vez)');
    {
      const ctxFail = await openPage(browser, srv.url + '/?qa=1', { initScripts: [{ fn: failSecondContext }] });
      try {
        await withTimeout(ctxFail.page.waitForSelector('.boot-error', { timeout: 15_000 }), 17_000, 'esperar .boot-error');
        const text = await ctxFail.page.textContent('.boot-error');
        R.check('muestra la tarjeta «No se pudo iniciar» sin explotar', /No se pudo iniciar/.test(text ?? ''), `«${(text ?? '').slice(0, 90)}»`);
      } catch {
        R.check('muestra la tarjeta «No se pudo iniciar» sin explotar', false, 'no apareció .boot-error (¿el catch de main.ts ya no muestra el fallo?)');
      }
      R.check('sin pageerror no controlado en ese fallo', ctxFail.problems.pageErrors.length === 0, ctxFail.problems.pageErrors.join(' | ') || 'limpio');
      await ctxFail.context.close();
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // ── 7. Sin WebGL2 ─────────────────────────────────────────────────────────
  if (args['skip-nowebgl']) {
    R.section('Sin WebGL2');
    R.skip('aviso amistoso sin WebGL2', '--skip-nowebgl');
  } else {
    R.section('Sin WebGL2 (Chromium con --disable-gpu --disable-webgl)');
    browser = await launchBrowser({ noGL: true });
    try {
      let { page, context, problems } = await openPage(browser, srv.url + '/?qa=1');
      let hasGl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
      if (hasGl) {
        R.info('el navegador conserva WebGL2 con --disable-gpu; se fuerza la ausencia con un override de getContext');
        await context.close();
        ({ page, context, problems } = await openPage(browser, srv.url + '/?qa=1', { initScripts: [{ fn: noWebglOverride }] }));
        hasGl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
      }
      R.check('entorno sin WebGL2 (precondición)', !hasGl);
      await sleep(1200);
      const card = await page.$('.boot-error');
      const text = card ? ((await card.textContent()) ?? '') : '';
      R.check('muestra un aviso amistoso en lugar de la partida', !!card && /WebGL\s*2/.test(text), `«${text.replace(/\s+/g, ' ').trim().slice(0, 110)}»`);
      R.check('no hay lienzo de juego ni window.__qa', (await page.$('#game-canvas')) === null && (await page.evaluate(() => window.__qa === undefined)));
      R.check('sin pageerror ni requestfailed (la página no explota)', problems.pageErrors.length === 0 && problems.failedRequests.length === 0, [...problems.pageErrors, ...problems.failedRequests].join(' | ') || 'limpio');
      R.soft('sin console.error', problems.errors.length === 0, problems.errors.join(' | '));
      const shot = join(outDir, 'smoke-nowebgl.png');
      const png = await page.screenshot({ path: shot });
      try {
        const a = analyzePng(png);
        R.soft('el aviso es visible (captura no en blanco)', !a.blank, `colores=${a.distinctColors} → ${shot}`);
      } catch (err) {
        R.warn('captura sin WebGL: no se pudo analizar', String(err));
      }
      await context.close();
    } finally {
      await browser.close().catch(() => {});
    }
  }

  await srv.stop();
  return R.summary();
}

runMain(main, { name: 'smoke', maxMs: 5 * 60_000 });
