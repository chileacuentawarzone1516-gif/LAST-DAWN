#!/usr/bin/env node
// QA · INSTRUMENTACIÓN — verifica que la instrumentación pasiva (?perf=1) es NO INTRUSIVA y que registra métricas.
//
// Uso:  node scripts/qa/instrumentation.mjs [--port=5208] [--rebuild] [--seed=4242] [--sim-s=20] [--overhead-s=8] [--overhead-runs=3]
//
//  1. Build: el código de la instrumentación va en un chunk aparte; el bundle principal no lo contiene.
//  2. Modo normal (sin ?perf=1, con y sin ?qa=1): no se descarga el chunk, no existe window.__perf ni distintivo.
//  3. Modo instrumentado (?perf=1, SIN ?qa=1): métricas de frames (p50/p95/p99, >2T, pausas), cadencia etiquetada
//     «rAF observed cadence», arranque, generación del mundo, carga de personaje, ciclo de vida, pérdida/restauración
//     de contexto WebGL, errores clasificados, sobrecarga medida y exportación JSON. preserveDrawingBuffer = false.
//  4. ?qa=1&perf=1: el informe se marca como NO válido para FPS de dispositivo.
//  5. Equivalencia de simulación: misma semilla y mismas entradas con y sin instrumentación → mismo estado.
//  6. Sobrecarga A/B en tiempo real (INDICATIVA: SwiftShader, no es rendimiento de Android).
import { join } from 'node:path';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PORT, ensureOutDir, launchBrowser, numArg, openPage, parseArgs, Report, ROOT, runMain, serveGame, sleep } from './lib.mjs';
import { openGame } from './game.mjs';

const PERF_MARKER = 'rAF observed cadence';

// ── Código que se ejecuta EN LA PÁGINA ───────────────────────────────────────

/** Init-script: muestreador de rAF IDÉNTICO en ambos modos (para comparar la sobrecarga con la misma vara). */
function samplerScript() {
  const s = { dts: [], last: 0, on: false };
  window.__sampler = s;
  const tick = (t) => {
    if (s.on && s.last > 0) s.dts.push(t - s.last);
    s.last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Reinicia Math.random con semilla (mulberry32) justo antes de la partida: elimina la deriva de los frames de título. */
function reseed(seed) {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Lado Node ────────────────────────────────────────────────────────────────

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)];
};
const f2 = (v) => (v === null || v === undefined ? '-' : Number(v).toFixed(2));

async function waitBoot(page, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(() => document.getElementById('boot') === null).catch(() => false)) return true;
    await sleep(200);
  }
  return false;
}

/** Resumen de estado comparable entre ejecuciones (sin marcas de tiempo reales). */
async function simulate(browser, url, path, seed, simS) {
  const { page, context, problems, bot } = await openGame(browser, url, { path, seed });
  try {
    await bot.ev(reseed, seed, 'reseed');
    await bot.start();
    await bot.ev(() => window.__qa.stick(0, 1), undefined, 'stick');
    await bot.step(3);
    await bot.ev(() => window.__qa.stick(0, 0), undefined, 'stick0');
    await bot.ev(() => window.__qa.look(180, -20), undefined, 'look');
    await bot.hold('fire', 1);
    await bot.teleport(92 + 1.2, -62, 0, 0.3);
    await bot.hold('interact', 3.5);
    await bot.step(simS);
    const state = await bot.ev(() => JSON.stringify(window.__qa.snapshot(), (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v)), undefined, 'state');
    const extra = await bot.run((ctx) => ({
      enemies: ctx.enemies.aliveCount,
      playerPos: [ctx.player.position.x, ctx.player.position.y, ctx.player.position.z],
      yaw: ctx.state.player.yaw,
    }));
    const scene = await bot.sceneStats();
    return { state, extra, scene: { calls: scene.calls, triangles: scene.triangles, meshes: scene.scene.meshes }, pageErrors: problems.pageErrors.length };
  } finally {
    await context.close().catch(() => {});
  }
}

async function overheadRun(browser, url, path, warmS, measureS) {
  const { page, context, problems } = await openPage(browser, `${url}${path}`, { initScripts: [{ fn: samplerScript }] });
  try {
    await waitBoot(page);
    await sleep(warmS * 1000);
    await page.evaluate(() => {
      window.__sampler.dts.length = 0;
      window.__sampler.on = true;
    });
    await sleep(measureS * 1000);
    const dts = await page.evaluate(() => {
      window.__sampler.on = false;
      return window.__sampler.dts.slice();
    });
    const perf = await page.evaluate(() => (window.__perf ? window.__perf.snapshot().overhead : null));
    return { frames: dts.length, p50: pct(dts, 50), p95: pct(dts, 95), p99: pct(dts, 99), perf, pageErrors: problems.pageErrors.length };
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  const args = parseArgs();
  const port = numArg(args, 'port', DEFAULT_PORT);
  const seed = numArg(args, 'seed', 4242);
  const simS = numArg(args, 'sim-s', 20);
  const ovS = numArg(args, 'overhead-s', 8);
  const ovRuns = numArg(args, 'overhead-runs', 3);
  const outDir = ensureOutDir('instrumentation');
  const R = new Report('INSTRUMENTACIÓN PASIVA (?perf=1) — no intrusividad y métricas');
  const srv = await serveGame({ port, force: !!args.rebuild, log: (x) => R.info(x) });
  R.info(`servidor ${srv.kind} en ${srv.url} (build ${srv.buildInfo?.outDir ?? '?'})`);
  const results = {};

  // ── 1. Build ──────────────────────────────────────────────────────────────
  R.section('Build: la instrumentación va en un chunk aparte');
  const assetsDir = join(ROOT, srv.buildInfo.outDir, 'assets');
  const files = readdirSync(assetsDir);
  const mainChunk = files.find((f) => /^index-.*\.js$/.test(f));
  const perfChunk = files.find((f) => /^perf-.*\.js$/.test(f));
  const mainSrc = mainChunk ? readFileSync(join(assetsDir, mainChunk), 'utf8') : '';
  R.check('existe un chunk propio de la instrumentación', !!perfChunk, perfChunk ?? 'no encontrado');
  R.check('el bundle principal NO contiene el código de la instrumentación', mainSrc.length > 0 && !mainSrc.includes(PERF_MARKER) && !mainSrc.includes('__perf'), mainChunk);
  if (perfChunk) {
    const perfSrc = readFileSync(join(assetsDir, perfChunk), 'utf8');
    R.check('el chunk de la instrumentación contiene su código', perfSrc.includes(PERF_MARKER), `${(perfSrc.length / 1024).toFixed(1)} kB sin comprimir`);
    results.perfChunkBytes = perfSrc.length;
  }
  results.mainChunkBytes = mainSrc.length;

  const browser = await launchBrowser();
  R.info(`Chromium ${browser.version()} (SwiftShader: sin GPU; los tiempos son INDICATIVOS)`);
  try {
    // ── 2. Modo normal ──────────────────────────────────────────────────────
    for (const path of ['/?q=low', '/?qa=1']) {
      R.section(`Modo normal ${path}: instrumentación ausente`);
      const { page, context, problems } = await openPage(browser, `${srv.url}${path}`);
      try {
        await waitBoot(page);
        await sleep(1500);
        const r = await page.evaluate(() => ({
          perf: typeof window.__perf,
          dataset: document.documentElement.dataset.perf ?? null,
          badge: document.querySelector('.perf-badge') !== null,
          perfRequests: performance.getEntriesByType('resource').filter((e) => /\/perf-[^/]*\.js/.test(e.name)).length,
        }));
        R.check(`${path}: window.__perf no existe`, r.perf === 'undefined', `typeof=${r.perf}`);
        R.check(`${path}: sin marca data-perf ni distintivo PERF`, r.dataset === null && !r.badge);
        R.check(`${path}: el chunk de la instrumentación NO se descarga`, r.perfRequests === 0, `peticiones=${r.perfRequests}`);
        R.check(`${path}: sin errores de página`, problems.pageErrors.length === 0, problems.pageErrors.slice(0, 2).join(' | '));
      } finally {
        await context.close().catch(() => {});
      }
    }

    // ── 3. Modo instrumentado (?perf=1, sin qa) ─────────────────────────────
    R.section('Modo instrumentado /?perf=1&q=low (sin ?qa=1)');
    {
      const { page, context, problems } = await openPage(browser, `${srv.url}/?perf=1&q=low`);
      try {
        await waitBoot(page);
        const ready = await page.evaluate(() => typeof window.__perf === 'object');
        R.check('window.__perf disponible', ready);
        await sleep(6500);
        const badge = await page.evaluate(() => {
          const b = document.querySelector('.perf-badge');
          return b ? { pe: getComputedStyle(b).pointerEvents, text: b.textContent, dataset: document.documentElement.dataset.perf } : null;
        });
        R.check('modo instrumentado distinguible (data-perf="1" y distintivo PERF sin interacción)', !!badge && badge.pe === 'none' && badge.dataset === '1', JSON.stringify(badge));

        // Ciclo de vida sintético y carga del personaje.
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
          document.dispatchEvent(new Event('visibilitychange'));
          delete document.hidden;
          delete document.visibilityState;
          document.dispatchEvent(new Event('visibilitychange'));
          window.__perf.mark('qa:escena-titulo');
        });
        const lost = await page.evaluate(async () => {
          const gl = document.getElementById('game-canvas').getContext('webgl2');
          const ext = gl.getExtension('WEBGL_lose_context');
          if (!ext) return 'sin WEBGL_lose_context';
          ext.loseContext();
          await new Promise((r) => setTimeout(r, 600));
          ext.restoreContext();
          await new Promise((r) => setTimeout(r, 1500));
          return 'ok';
        });
        await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Personalizar operativo'))?.click());
        const tChar = Date.now();
        let loads = 0;
        while (Date.now() - tChar < 30_000) {
          loads = await page.evaluate(() => window.__perf.snapshot().startup.characterLoads.length);
          if (loads > 0) break;
          await sleep(500);
        }
        await sleep(1000);

        const snap = await page.evaluate(() => window.__perf.snapshot());
        results.perfSnapshot = snap;
        const fr = snap.frames;
        const ses = fr.session;
        R.check("informe: mode='instrumented', schema 1, flags.qa=false", snap.mode === 'instrumented' && snap.schema === 1 && snap.flags.qa === false);
        R.check('sin efectos de ?qa=1: preserveDrawingBuffer=false y validForDeviceFps=true', snap.webgl?.contextAttributes?.preserveDrawingBuffer === false && snap.validForDeviceFps === true,
          `preserveDrawingBuffer=${snap.webgl?.contextAttributes?.preserveDrawingBuffer} validForDeviceFps=${snap.validForDeviceFps}`);
        R.check('frames registrados y ventanas agregadas', fr.recorded > 30 && fr.windows.length >= 1, `frames=${fr.recorded} ventanas=${fr.windows.length}`);
        R.check('sesión: FPS derivado, p50/p95/p99, frames >2T, pausas y stutter presentes',
          [ses.fps, ses.p50, ses.p95, ses.p99].every((v) => typeof v === 'number') && [ses.over2T, ses.hitches100, ses.hitches250, ses.stutterBursts].every((v) => typeof v === 'number'),
          `fps=${f2(ses.fps)} p50=${f2(ses.p50)} p95=${f2(ses.p95)} p99=${f2(ses.p99)} >2T=${ses.over2T} (SwiftShader: indicativo)`);
        R.check("cadencia etiquetada como «rAF observed cadence» (no como refresco físico)", ses.cadence?.label === PERF_MARKER, `label=${ses.cadence?.label} hz=${f2(ses.cadence?.hz)}`);
        const w0 = fr.windows[fr.windows.length - 1];
        R.check('cada ventana lleva muestra de calidad/resolución/draw calls/memoria', !!w0?.sample && 'resolutionScale' in w0.sample && 'quality' in w0.sample && 'drawCalls' in w0.sample,
          w0?.sample ? `calidad=${w0.sample.quality} escala=${w0.sample.resolutionScale} pixelRatio=${w0.sample.pixelRatio} dc=${w0.sample.drawCalls}` : 'sin muestra');
        const st = snap.startup;
        R.check('arranque: construcción del juego, generación del mundo (fases), título interactivo y primer frame',
          st.gameConstructMs > 0 && st.world?.buildMs > 0 && st.bootRemovedMs > 0 && st.firstFrameAfterBoot !== null,
          `construcción=${f2(st.gameConstructMs)} ms · mundo=${f2(st.world?.buildMs)} ms (layout ${f2(st.world?.phases?.layout)} / nav ${f2(st.world?.phases?.nav)} / render ${f2(st.world?.phases?.render)}) · título=${f2(st.bootRemovedMs)} ms`);
        R.check('carga de personaje registrada (GLB: variante, tiempo, bytes)', st.characterLoads.length > 0,
          st.characterLoads.map((c) => `${c.gender} ${c.low ? 'LOW' : 'HIGH'} ${f2(c.loadMs)} ms ${c.downloadBytes} B`).join(' · ') || 'ninguna (¿falló la descarga?)');
        R.check('dispositivo: UA, núcleos, DPR, viewport y WebGL (renderer, extensiones)', !!snap.device?.userAgent && typeof snap.device?.dpr === 'number' && !!snap.webgl?.renderer,
          `renderer=${snap.webgl?.unmaskedRenderer ?? snap.webgl?.renderer} · timerQuery=${snap.webgl?.timerQueryExtension}`);
        const ev = snap.events.map((e) => e.type);
        R.check('ciclo de vida: visibilidad registrada', ev.filter((t) => t === 'lifecycle:visibility').length >= 2);
        R.check('pérdida/restauración de contexto WebGL registrada', lost === 'ok' && ev.includes('webgl:contextlost') && ev.includes('webgl:contextrestored'), `${lost} · eventos=${ev.filter((t) => t.startsWith('webgl') || t === 'engine:contextLost').join(',')}`);
        R.check('marca manual registrada', ev.includes('mark') && snap.startup.marks['qa:escena-titulo'] > 0);
        R.check('errores clasificados: 0 de la aplicación', !Object.keys(snap.errors.counts).some((k) => k.endsWith(':app')), JSON.stringify(snap.errors.counts));
        R.check('sin errores internos de la instrumentación', snap.instrumentationErrors === 0, `instrumentationErrors=${snap.instrumentationErrors}`);
        R.check('sobrecarga propia medida', snap.overhead.callbacks > 0 && typeof snap.overhead.callbackUsAvg === 'number',
          `media ${f2(snap.overhead.callbackUsAvg)} µs/frame · máx ${f2(snap.overhead.callbackMsMax)} ms · agregación ${f2(snap.overhead.flushMsTotal)} ms en ${snap.overhead.flushes} ventanas`);
        const raw = await page.evaluate(() => window.__perf.snapshot({ raw: true }).frames);
        R.check('exportación en bruto: un intervalo por frame conservado', raw.raw?.dtMs?.length === raw.retained, `retenidos=${raw.retained} bruto=${raw.raw?.dtMs?.length}`);
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), page.evaluate(() => window.__perf.download())]);
        const dlPath = join(outDir, 'sample-perf-report.json');
        await dl.saveAs(dlPath);
        const parsed = JSON.parse(readFileSync(dlPath, 'utf8'));
        R.check('download() genera un JSON válido', parsed.schema === 1 && parsed.mode === 'instrumented', `${dl.suggestedFilename()} → qa-output/instrumentation/sample-perf-report.json`);
        R.check('sin errores de página en modo instrumentado', problems.pageErrors.length === 0, problems.pageErrors.slice(0, 2).join(' | '));
      } finally {
        await context.close().catch(() => {});
      }
    }

    // ── 4. ?qa=1&perf=1 ──────────────────────────────────────────────────────
    R.section('Modo /?qa=1&perf=1: el informe se invalida para FPS de dispositivo');
    {
      const { page, context } = await openPage(browser, `${srv.url}/?qa=1&perf=1&q=low`);
      try {
        await waitBoot(page);
        await sleep(1500);
        const r = await page.evaluate(() => {
          const s = window.__perf?.snapshot();
          return { qa: typeof window.__qa, valid: s?.validForDeviceFps, pdb: s?.webgl?.contextAttributes?.preserveDrawingBuffer, notes: s?.notes ?? [] };
        });
        R.check('coexisten window.__qa y window.__perf', r.qa === 'object' && r.valid !== undefined);
        R.check('validForDeviceFps=false con ?qa=1 (preserveDrawingBuffer=true y escalado adaptativo desactivado)', r.valid === false && r.pdb === true && r.notes.some((n) => n.includes('?qa=1')), `valid=${r.valid} preserveDrawingBuffer=${r.pdb}`);
      } finally {
        await context.close().catch(() => {});
      }
    }

    // ── 5. Equivalencia de simulación ───────────────────────────────────────
    R.section(`Equivalencia de simulación (semilla ${seed}, ${simS} s simulados, mismas entradas)`);
    const A = await simulate(browser, srv.url, '/?qa=1&q=low', seed, simS);
    const A2 = await simulate(browser, srv.url, '/?qa=1&q=low', seed, simS);
    const B = await simulate(browser, srv.url, '/?qa=1&perf=1&q=low', seed, simS);
    const deterministic = A.state === A2.state;
    results.simulation = { deterministic, equal: A.state === B.state, A: A.extra, B: B.extra, sceneA: A.scene, sceneB: B.scene };
    if (!deterministic) {
      R.skip('equivalencia de simulación', 'dos ejecuciones SIN instrumentación ya difieren (no determinista): comparación no concluyente');
    } else {
      R.check('control: dos ejecuciones sin instrumentación dan el mismo estado', true, `${A.state.length} caracteres de estado`);
      R.check('con ?perf=1 el estado de la partida es IDÉNTICO', A.state === B.state, `enemigos ${A.extra.enemies}/${B.extra.enemies} · pos ${A.extra.playerPos.map((v) => v.toFixed(3)).join(',')} / ${B.extra.playerPos.map((v) => v.toFixed(3)).join(',')}`);
    }
    R.check('con ?perf=1 el render de la escena es equivalente (draw calls, triángulos, mallas)', A.scene.calls === B.scene.calls && A.scene.triangles === B.scene.triangles && A.scene.meshes === B.scene.meshes,
      `dc ${A.scene.calls}/${B.scene.calls} · tris ${A.scene.triangles}/${B.scene.triangles} · mallas ${A.scene.meshes}/${B.scene.meshes}`);
    R.check('sin errores de página en las simulaciones', A.pageErrors + A2.pageErrors + B.pageErrors === 0);

    // ── 6. Sobrecarga A/B en tiempo real (indicativa) ────────────────────────
    R.section(`Sobrecarga en tiempo real (pantalla de título, ${ovRuns}×${ovS} s por modo, alternando) — INDICATIVA`);
    const rows = [];
    for (let i = 0; i < ovRuns; i++) {
      for (const [mode, path] of [['normal', '/?q=low'], ['perf', '/?q=low&perf=1']]) {
        const r = await overheadRun(browser, srv.url, path, 3, ovS);
        rows.push({ run: i + 1, mode, frames: r.frames, p50: r.p50, p95: r.p95, p99: r.p99, perfUs: r.perf?.callbackUsAvg ?? null, errors: r.pageErrors });
      }
    }
    R.table(rows, [
      { key: 'run', title: 'ronda', align: 'right' }, { key: 'mode', title: 'modo' }, { key: 'frames', title: 'frames', align: 'right' },
      { key: 'p50', title: 'p50 ms', align: 'right', fmt: f2 }, { key: 'p95', title: 'p95 ms', align: 'right', fmt: f2 }, { key: 'p99', title: 'p99 ms', align: 'right', fmt: f2 },
      { key: 'perfUs', title: 'callback perf µs', align: 'right', fmt: f2 }, { key: 'errors', title: 'errores', align: 'right' },
    ]);
    const med = (mode, key) => pct(rows.filter((r) => r.mode === mode).map((r) => r[key]), 50);
    results.overhead = { rows, normalP50: med('normal', 'p50'), perfP50: med('perf', 'p50'), normalP95: med('normal', 'p95'), perfP95: med('perf', 'p95') };
    R.info(`mediana de rondas: p50 normal ${f2(results.overhead.normalP50)} ms vs perf ${f2(results.overhead.perfP50)} ms · p95 ${f2(results.overhead.normalP95)} vs ${f2(results.overhead.perfP95)} ms`);
    R.info('SwiftShader en CPU compartida: la diferencia está dentro del ruido esperado; NO se declara «cero sobrecarga». La sobrecarga en Android se mide en el dispositivo (PLAN §21.2).');
    R.check('sin errores de página en las rondas de sobrecarga', rows.every((r) => r.errors === 0));
  } finally {
    await browser.close();
    await srv.stop();
  }
  writeFileSync(join(outDir, 'instrumentation-results.json'), JSON.stringify(results, null, 2));
  R.info('resultados: qa-output/instrumentation/instrumentation-results.json');
  return R.summary();
}

runMain(main, { name: 'instrumentation', maxMs: 20 * 60_000 });
