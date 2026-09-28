// QA de audio: renderiza CADA receta con OfflineAudioContext en Chrome headless y comprueba
// RMS mínimo, pico <= 1.0 tras la cadena, ausencia de NaN, duración y nº de nodos. Sale con código != 0 si falla.
// Además verifica que no hay AudioContext ni errores antes de unlock() y que la ráfaga de estrés no rompe nada.
import { launchBrowser, openPage, startServer, formatProblems, hasProblems, parseArgs } from './lib.mjs';

const args = parseArgs();
const port = Number(args.port ?? 5207);
const server = await startServer({ port });
const browser = await launchBrowser();
let failed = false;
try {
  const { page, context: ctx2, problems } = await openPage(browser, `${server.url}/dev/audio.html?qa=1`, { width: 640, height: 360 });

  // Otros agentes editan ficheros y Vite recarga la página: se reintenta al perder el contexto.
  const ev = async (fn, arg) => {
    for (let i = 0; i < 12; i++) {
      try {
        await page.waitForFunction(() => !!window.__audioQa, null, { timeout: 60000 });
        return await page.evaluate(fn, arg);
      } catch (e) {
        const m = String(e);
        if (!m.includes('context was destroyed') && !m.includes('navigation') && !m.includes('Target closed')) throw e;
        await page.waitForTimeout(800);
      }
    }
    throw new Error('la página se recargó demasiadas veces');
  };
  await ev(() => 1);

  // 1) Render offline de todas las recetas y bucles
  const ids = await ev(() => window.__audioQa.ids());
  const rows = [];
  for (const id of ids) rows.push(await ev((i) => window.__audioQa.render(i), id));
  const pad = (s, n) => String(s).padEnd(n);
  const db = (v) => (20 * Math.log10(Math.max(1e-9, v))).toFixed(1);
  console.log(pad('sonido', 26) + pad('rms dB', 8) + pad('pico raw', 9) + pad('pico out', 9) + pad('dur', 6) + pad('esp', 6) + pad('nodos', 6) + 'estado');
  for (const r of rows) {
    console.log(
      pad(r.id, 26) + pad(db(r.rms), 8) + pad(r.peakRaw.toFixed(2), 9) + pad(r.peakOut.toFixed(2), 9) +
      pad(r.audibleS.toFixed(2), 6) + pad(r.expectedS.toFixed(2), 6) + pad(r.nodes, 6) +
      (r.ok ? 'ok' : 'FALLA ' + r.problems.join(',') + (r.error ? ' ' + r.error : '')),
    );
    if (!r.ok) failed = true;
  }
  console.log(`${rows.length} sonidos, ${rows.filter((r) => !r.ok).length} fallos`);

  // 2) Antes de unlock(): sin AudioContext, sin errores
  await ev(() => window.__audioQa.emit(5));
  const pre = await ev(() => window.__audioQa.info());
  if (pre.ready || pre.errors || pre.contexts) { console.log('FALLA: sonó o falló antes de unlock()', pre); failed = true; }

  // 3) Tras unlock(): estrés de eventos, sin errores y con voces acotadas
  await ev(() => window.__audioQa.unlock());
  await page.waitForTimeout(400);
  await ev(() => window.__audioQa.emit(150));
  await page.waitForTimeout(2500);
  const peakVoices = await ev(() => window.__audioQa.peak());
  console.log('pico de voces simultáneas:', peakVoices);
  if (peakVoices > 40) { console.log('FALLA: voces por encima del límite'); failed = true; }
  const post = await ev(() => window.__audioQa.info());
  console.log('estado tras estrés:', JSON.stringify(post));
  if (!post.ready) { console.log('FALLA: contexto no está en marcha tras unlock()'); failed = true; }
  if (post.errors) { console.log('FALLA: errores de receta', post.lastError); failed = true; }
  if (post.voices > 40) { console.log('FALLA: demasiadas voces', post.voices); failed = true; }

  // requestfailed = peticiones abortadas por recargas de Vite (otros agentes editan a la vez): sólo aviso
  if (problems.errors.length + problems.pageErrors.length > 0) {
    console.log('Problemas de consola:\n' + formatProblems({ ...problems, failedRequests: [] }));
    failed = true;
  } else if (hasProblems(problems)) {
    console.log(`aviso: ${problems.failedRequests.length} peticiones abortadas (recargas de Vite)`);
  }
  await ctx2.close();
} finally {
  await browser.close();
  await server.stop();
}
process.exit(failed ? 1 : 0);
