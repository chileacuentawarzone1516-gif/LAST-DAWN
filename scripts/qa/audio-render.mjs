// QA de audio: renderiza CADA receta con OfflineAudioContext en Chrome headless y comprueba
// RMS mínimo, pico <= 1.0 tras la cadena, ausencia de NaN, duración y nº de nodos (incluye la voz
// femenina del jugador, sufijo @f). Después verifica, en escritorio y en modo táctil (?touch=1):
// nada antes de unlock(), estrés de eventos con voces acotadas (40 / 24 en móvil), sin errores, y
// suspensión/reanudación al ocultar/mostrar la pestaña. Sale con código != 0 si algo falla.
import { launchBrowser, openPage, startServer, formatProblems, hasProblems, parseArgs } from './lib.mjs';

const args = parseArgs();
const port = Number(args.port ?? 5207);
const server = await startServer({ port });
const browser = await launchBrowser();
let failed = false;

/** Abre la página de audio; reintenta si Vite la recarga (otros agentes editan a la vez). */
async function open(query) {
  const opened = await openPage(browser, `${server.url}/dev/audio.html?${query}`, { width: 640, height: 360 });
  const ev = async (fn, arg) => {
    for (let i = 0; i < 12; i++) {
      try {
        await opened.page.waitForFunction(() => !!window.__audioQa, null, { timeout: 60000 });
        return await opened.page.evaluate(fn, arg);
      } catch (e) {
        const m = String(e);
        if (!m.includes('context was destroyed') && !m.includes('navigation') && !m.includes('Target closed')) throw e;
        await opened.page.waitForTimeout(800);
      }
    }
    throw new Error('la página se recargó demasiadas veces');
  };
  await ev(() => 1);
  return { ...opened, ev };
}

function report(problems) {
  // requestfailed = peticiones abortadas por recargas de Vite: sólo aviso
  if (problems.errors.length + problems.pageErrors.length > 0) {
    console.log('Problemas de consola:\n' + formatProblems({ ...problems, failedRequests: [] }));
    failed = true;
  } else if (hasProblems(problems)) {
    console.log(`aviso: ${problems.failedRequests.length} peticiones abortadas (recargas de Vite)`);
  }
}

/** Sesión de comportamiento: antes/después de unlock(), estrés y ciclo de visibilidad. */
async function behaviour(label, query, voiceLimit, expectLite) {
  const { page, context, problems, ev } = await open(query);
  const fail = (msg, extra = '') => {
    console.log(`FALLA [${label}]: ${msg}`, extra);
    failed = true;
  };
  await ev(() => window.__audioQa.emit(5));
  const pre = await ev(() => window.__audioQa.info());
  if (pre.ready || pre.errors || pre.contexts) fail('sonó o falló antes de unlock()', JSON.stringify(pre));
  if (pre.lite !== expectLite) fail(`modo ligero esperado=${expectLite}`, JSON.stringify(pre));

  await ev(() => window.__audioQa.unlock());
  await page.waitForTimeout(400);
  await ev(() => window.__audioQa.emit(150));
  await page.waitForTimeout(2500);
  const peak = await ev(() => window.__audioQa.peak());
  const post = await ev(() => window.__audioQa.info());
  console.log(`[${label}] pico de voces: ${peak} (tope ${voiceLimit}); estado: ${JSON.stringify(post)}`);
  if (!post.ready) fail('contexto no está en marcha tras unlock()');
  if (post.errors) fail('errores de receta', post.lastError);
  if (peak > voiceLimit) fail('voces por encima del límite', String(peak));

  // ocultar → suspendido; mostrar → en marcha de nuevo
  await ev(() => window.__audioQa.visibility(true));
  await page.waitForTimeout(500);
  const hid = await ev(() => window.__audioQa.info());
  if (hid.state !== 'suspended') fail('no se suspendió al ocultar la pestaña', hid.state);
  await ev(() => window.__audioQa.visibility(false));
  await page.waitForTimeout(700);
  const vis = await ev(() => window.__audioQa.info());
  if (vis.state !== 'running') fail('no se reanudó al mostrar la pestaña', vis.state);
  report(problems);
  await context.close();
}

try {
  // 1) Render offline de todas las recetas y bucles
  {
    const { context, problems, ev } = await open('qa=1');
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
    report(problems);
    await context.close();
  }
  // 2) Escritorio y táctil
  await behaviour('escritorio', 'qa=1', 40, false);
  await behaviour('táctil', 'qa=1&touch=1', 24, true);
} finally {
  await browser.close();
  await server.stop();
}
process.exit(failed ? 1 : 0);
