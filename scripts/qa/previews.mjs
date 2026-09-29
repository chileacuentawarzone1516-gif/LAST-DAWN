#!/usr/bin/env node
// QA · PREVIEWS — recorre dev/*.html?qa=1 (una por módulo), las deja correr unos segundos y exige
// cero errores. Guarda una captura por página en qa-output/previews/.
//
// Uso:  node scripts/qa/previews.mjs [--port=5208] [--seconds=4] [--only=world,player]
//                                     [--allow-blank=audio] [--require-all] [--retries=1]
//   --seconds      segundos reales que corre cada preview antes de medir (más 3 s simulados)
//   --allow-blank  previews cuyo lienzo puede estar en blanco (por defecto: audio)
//   --require-all  falla si dev/index.html enlaza previews que aún no existen
//
// Usa el servidor DEV de vite (las páginas dev/ no entran en el build de producción).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { ROOT, launchBrowser, openPage, startServer, analyzePng, ensureOutDir, formatProblems, hasProblems, parseArgs, numArg, Report, runMain, sleep, withTimeout, readEventNames, DEFAULT_PORT } from './lib.mjs';
import { Bot, installBot, rafGateScript } from './game.mjs';

/** Carpeta de previews (--dev-dir para autopruebas del propio script; por defecto dev/). */
let DEV_DIR = 'dev';

/** Descubre dev/*.html (excepto el índice). */
function discoverPreviews() {
  const dir = join(ROOT, DEV_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.html') && f !== 'index.html').map((f) => f.replace(/\.html$/, '')).sort();
}

/** Previews enlazadas desde dev/index.html (href="/dev/x.html"). */
function linkedPreviews() {
  const idx = join(ROOT, DEV_DIR, 'index.html');
  if (!existsSync(idx)) return [];
  const html = readFileSync(idx, 'utf8');
  return [...html.matchAll(/href="\/?[\w/-]*?\/([\w-]+)\.html[^"]*"/g)].map((m) => m[1]);
}

/** Ficheros .ts/.js referenciados por <script src> en una página dev (deben existir). */
function missingScripts(name) {
  const file = join(ROOT, DEV_DIR, `${name}.html`);
  const html = readFileSync(file, 'utf8');
  const missing = [];
  for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
    const src = m[1];
    if (/^https?:/.test(src)) {
      missing.push(`${src} (script externo: el juego no descarga nada)`);
      continue;
    }
    const target = src.startsWith('/') ? join(ROOT, src) : resolve(dirname(file), src);
    if (!existsSync(target)) missing.push(src);
  }
  return missing;
}

/** Abre una preview, la deja correr y devuelve las medidas. Lanza si la página no carga. */
async function runPreview(browser, baseUrl, name, { seconds, outDir }) {
  const url = `${baseUrl}/${DEV_DIR}/${name}.html?qa=1`;
  const { page, context, problems } = await openPage(browser, url, { initScripts: [{ fn: rafGateScript }] });
  const res = { name, problems, hasQa: false, frames: 0, canvas: null, screenshot: join(outDir, `${name}.png`), nan: [], flow: null, stats: null, png: null, hasCanvas: false };
  try {
    res.hasQa = await page.waitForFunction(() => !!window.__qa, null, { timeout: 20_000, polling: 100 }).then(() => true, () => false);
    res.hasCanvas = (await page.$('canvas')) !== null;
    const f0 = await page.evaluate(() => window.__raf.calls);
    await sleep(seconds * 1000);
    res.frames = (await page.evaluate(() => window.__raf.calls)) - f0;
    if (res.hasQa) {
      const bot = new Bot(page, { timeoutMs: 60_000 });
      await bot.ev(installBot, readEventNames(), 'installBot');
      await bot.freezeLoop();
      await bot.step(3); // simulación determinista adicional
      res.nan = await bot.scanAll();
      res.flow = (await bot.snap()).flow;
      res.canvas = res.hasCanvas ? await bot.canvasStats() : null;
      res.stats = await bot.ev(() => window.__qa.stats(), undefined, 'stats');
      const png = await bot.screenshot(res.screenshot);
      res.png = safeAnalyze(png);
    } else {
      const png = await withTimeout(page.screenshot({ path: res.screenshot }), 30_000, 'screenshot');
      res.png = safeAnalyze(png);
    }
  } finally {
    await context.close().catch(() => {});
  }
  return res;
}

function safeAnalyze(png) {
  try {
    return analyzePng(png);
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs();
  if (typeof args['dev-dir'] === 'string') DEV_DIR = args['dev-dir'].replace(/^\/+|\/+$/g, '');
  const port = numArg(args, 'port', DEFAULT_PORT);
  const seconds = numArg(args, 'seconds', 4);
  const retries = numArg(args, 'retries', 1);
  const allowBlank = new Set(String(args['allow-blank'] ?? 'audio').split(',').filter(Boolean));
  const only = args.only ? new Set(String(args.only).split(',')) : null;
  const R = new Report('PREVIEWS dev/*.html');
  const outDir = ensureOutDir('previews');

  const found = discoverPreviews();
  const linked = linkedPreviews();
  R.info(`páginas ${DEV_DIR}/*.html: ${found.join(', ') || '(ninguna todavía)'}`);
  const notYet = linked.filter((l) => !found.includes(l));
  if (notYet.length) {
    const msg = `enlazadas en dev/index.html pero sin fichero: ${notYet.join(', ')}`;
    if (args['require-all']) R.check('todas las previews enlazadas existen', false, msg);
    else R.warn('previews pendientes', `${msg} (módulo aún sin preview; --require-all las exige)`);
  }
  const extra = found.filter((f) => linked.length && !linked.includes(f));
  if (extra.length) R.warn('previews no enlazadas en dev/index.html', extra.join(', '));

  let pages = found.filter((f) => !only || only.has(f));
  if (pages.length === 0) {
    R.skip('barrido de previews', 'no hay páginas dev/*.html que ejecutar todavía');
    return R.summary();
  }
  for (const p of pages) {
    const miss = missingScripts(p);
    if (miss.length) {
      R.check(`${DEV_DIR}/${p}.html: scripts referenciados existen`, false, miss.join(', '));
      pages = pages.filter((x) => x !== p);
    }
  }

  const srv = await startServer({ mode: 'dev', port, strictMode: true });
  R.info(`servidor dev en ${srv.url}`);
  const browser = await launchBrowser();
  const rows = [];
  try {
    // Calentamiento: la 1.ª carga de vite dev optimiza dependencias y puede recargar la página.
    const warm = await openPage(browser, `${srv.url}/${DEV_DIR}/${pages[0]}.html?qa=1`, { wait: 'domcontentloaded' });
    await sleep(2500);
    await warm.context.close();

    for (const name of pages) {
      R.section(`${DEV_DIR}/${name}.html`);
      let res;
      let attempt = 0;
      for (;;) {
        try {
          res = await runPreview(browser, srv.url, name, { seconds, outDir });
        } catch (err) {
          res = null;
          if (attempt >= retries) {
            R.check(`${name}: carga y ejecuta`, false, err instanceof Error ? err.message : String(err));
            break;
          }
        }
        if (res && (!hasProblems(res.problems) || attempt >= retries)) break;
        attempt++;
        R.warn(`${name}: reintento ${attempt}/${retries}`, 'la 1.ª carga tuvo errores (vite puede re-optimizar dependencias al descubrir módulos nuevos)');
      }
      if (!res) {
        rows.push({ name, result: 'FAIL', frames: '-', draw: '-', tris: '-' });
        continue;
      }
      R.check(`${name}: cero pageerror / console.error / requestfailed`, !hasProblems(res.problems), hasProblems(res.problems) ? `\n${formatProblems(res.problems)}` : 'limpio');
      if (res.problems.warnings.length) R.warn(`${name}: ${res.problems.warnings.length} console.warn`, [...new Set(res.problems.warnings)].slice(0, 3).map((w) => w.slice(0, 120)).join(' | '));
      if (res.hasQa) {
        R.check(`${name}: window.__qa disponible y estado sin NaN/Infinity`, res.nan.length === 0, res.nan.join(', ') || `flow=${res.flow}`);
        R.soft(`${name}: bucle de juego activo`, res.frames >= 2, `${res.frames} frames en ${seconds} s`);
        if (res.canvas) {
          const c = res.canvas;
          const okBlank = !c.blank || allowBlank.has(name);
          R.check(`${name}: lienzo NO en blanco`, okBlank, `colores=${c.distinctColors} σ=${c.stdLuma.toFixed(1)} luma=${c.meanLuma.toFixed(0)}${c.blank && allowBlank.has(name) ? ' (blanco permitido)' : ''}`);
        } else R.soft(`${name}: tiene canvas`, allowBlank.has(name), 'la página no crea <canvas>');
      } else {
        R.soft(`${name}: window.__qa disponible`, false, 'la página no expone __qa (¿usa createDevGame de src/dev/harness.ts?)');
        if (res.png) R.check(`${name}: captura NO en blanco`, !res.png.blank || allowBlank.has(name), `colores=${res.png.distinctColors}`);
      }
      if (res.png) R.info(`captura ${res.screenshot} (${res.png.width}x${res.png.height}, colores=${res.png.distinctColors})`);
      const ok = !hasProblems(res.problems) && res.nan.length === 0 && (!res.canvas || !res.canvas.blank || allowBlank.has(name));
      rows.push({ name, result: ok ? 'PASS' : 'FAIL', frames: res.frames, draw: res.stats?.drawCalls, tris: res.stats?.triangles });
    }
  } finally {
    await browser.close().catch(() => {});
    await srv.stop();
  }

  R.section('Resumen');
  R.table(rows, [
    { key: 'name', title: 'preview' },
    { key: 'result', title: 'resultado' },
    { key: 'frames', title: 'frames', align: 'right' },
    { key: 'draw', title: 'drawCalls', align: 'right' },
    { key: 'tris', title: 'triángulos', align: 'right' },
  ]);
  return R.summary();
}

runMain(main, { name: 'previews', maxMs: 8 * 60_000 });
