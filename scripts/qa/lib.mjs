// Utilidades compartidas para los scripts de QA con Chrome headless.
// Usa playwright-core con el Chromium preinstalado (no descarga nada).
//
// COMPATIBILIDAD: las funciones originales (findChrome, launchBrowser, openPage, hasProblems,
// formatProblems, ensureOutDir, startServer, parseArgs, sleep, ROOT, OUT_DIR) conservan su firma;
// todo lo nuevo es aditivo (buildProd, Report, runMain, analyzePng, loadConfig, moduleStatus…).
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { inflateSync } from 'node:zlib';

export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const IS_WIN = process.platform === 'win32';
export const OUT_DIR = join(ROOT, 'qa-output');
/** Puerto de desarrollo del agente de QA (los demás agentes usan el suyo). */
export const DEFAULT_PORT = 5208;

// ─────────────────────────────────────────────────────────────────────────────
// Limpieza garantizada (navegador, servidor) ante errores, señales y salida
// ─────────────────────────────────────────────────────────────────────────────
const asyncCleanups = new Set();
const syncCleanups = new Set();
let exitHooked = false;

function hookExit() {
  if (exitHooked) return;
  exitHooked = true;
  process.on('exit', () => {
    for (const fn of syncCleanups) {
      try {
        fn();
      } catch {
        /* ignorar */
      }
    }
  });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      console.error(`\n[qa] señal ${sig}: cerrando navegador/servidor…`);
      for (const fn of syncCleanups) {
        try {
          fn();
        } catch {
          /* ignorar */
        }
      }
      process.exit(130);
    });
  }
}

/** Registra una limpieza asíncrona (y opcionalmente una síncrona de último recurso). */
export function registerCleanup(asyncFn, syncFn) {
  hookExit();
  asyncCleanups.add(asyncFn);
  if (syncFn) syncCleanups.add(syncFn);
  return () => {
    asyncCleanups.delete(asyncFn);
    if (syncFn) syncCleanups.delete(syncFn);
  };
}

export async function runCleanups() {
  const fns = [...asyncCleanups].reverse();
  asyncCleanups.clear();
  syncCleanups.clear();
  for (const fn of fns) {
    try {
      await fn();
    } catch {
      /* ignorar */
    }
  }
}

/**
 * Ejecuta el `main` de un script de QA: vigila un tiempo máximo global, garantiza el cierre de
 * navegador/servidor y fija el código de salida (main devuelve 0/1; una excepción = 1).
 */
export async function runMain(main, { name = 'qa', maxMs = 10 * 60_000 } = {}) {
  hookExit();
  const watchdog = setTimeout(() => {
    console.error(`\n[${name}] TIMEOUT GLOBAL (${Math.round(maxMs / 1000)} s): abortando.`);
    for (const fn of syncCleanups) {
      try {
        fn();
      } catch {
        /* ignorar */
      }
    }
    process.exit(2);
  }, maxMs);
  let code = 1;
  try {
    code = (await main()) ?? 0;
  } catch (err) {
    console.error(`\n[${name}] ERROR FATAL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    code = 1;
  } finally {
    clearTimeout(watchdog);
    await runCleanups();
  }
  process.exit(code);
}

/** Rechaza si `promise` no termina en `ms` milisegundos. */
export function withTimeout(promise, ms, label = 'operación') {
  let timer;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout de ${ms} ms en: ${label}`)), ms);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

// ─────────────────────────────────────────────────────────────────────────────
// Chromium
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Localiza el ejecutable de Chromium/Chrome/Edge (env CHROME_PATH > playwright > rutas típicas de
 * Linux, macOS y Windows).
 */
export function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [];
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  candidates.push(join(base, 'chromium', 'chrome-linux', 'chrome'));
  if (existsSync(base)) {
    for (const d of readdirSync(base)) {
      if (d.startsWith('chromium')) {
        candidates.push(join(base, d, 'chrome-linux', 'chrome'));
        candidates.push(join(base, d, 'chrome-linux', 'headless_shell'));
      }
    }
  }
  candidates.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable');
  // macOS
  candidates.push(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  );
  // Windows
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  for (const r of roots) {
    candidates.push(
      join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(r, 'Chromium', 'Application', 'chrome.exe'),
      join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    );
  }
  return candidates.find((p) => existsSync(p));
}

const GL_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--enable-webgl',
];
const NO_GL_ARGS = ['--disable-gpu', '--disable-webgl', '--disable-3d-apis', '--disable-software-rasterizer'];

/**
 * Lanza Chromium con WebGL2 por software (SwiftShader) para entornos sin GPU.
 * Opciones aditivas: `noGL` (arranca SIN WebGL, para probar el aviso amistoso) y `args` (extras).
 * El navegador queda registrado para cerrarse aunque el script muera.
 */
export async function launchBrowser({ headless = true, noGL = false, args = [] } = {}) {
  const executablePath = findChrome();
  if (!executablePath) throw new Error('No se encontró Chromium. Define CHROME_PATH (Chrome/Chromium/Edge).');
  const browser = await chromium.launch({
    executablePath,
    headless,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      ...(noGL ? NO_GL_ARGS : GL_ARGS),
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      ...args,
    ],
  });
  const off = registerCleanup(async () => {
    await browser.close().catch(() => {});
  });
  browser.on('disconnected', off);
  return browser;
}

/** Ignora el 404 de /favicon.ico (páginas dev/ sin icono): no es un fallo del juego. */
const isFavicon = (url) => /\/favicon\.ico(\?|$)/.test(url ?? '');

/**
 * Abre una página capturando errores de consola, excepciones y fallos de red.
 * Opciones aditivas: `initScripts` (funciones/strings para addInitScript) y `timeout` de goto.
 */
export async function openPage(browser, url, { width = 1280, height = 720, wait = 'load', initScripts = [], timeout = 45_000 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems = { errors: [], warnings: [], pageErrors: [], failedRequests: [] };
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error') {
      if (isFavicon(msg.location()?.url)) return;
      problems.errors.push(msg.text());
    } else if (t === 'warning') problems.warnings.push(msg.text());
  });
  page.on('pageerror', (err) => problems.pageErrors.push(String(err?.stack ?? err)));
  page.on('requestfailed', (req) => {
    if (isFavicon(req.url())) return;
    problems.failedRequests.push(`${req.method()} ${req.url()}`);
  });
  for (const s of initScripts) await page.addInitScript(s.fn ?? s, s.arg);
  await page.goto(url, { waitUntil: wait, timeout });
  return { page, context, problems };
}

export function hasProblems(p) {
  return p.errors.length + p.pageErrors.length + p.failedRequests.length > 0;
}

export function formatProblems(p) {
  const lines = [];
  for (const e of p.pageErrors) lines.push(`  [pageerror] ${e}`);
  for (const e of p.errors) lines.push(`  [console.error] ${e}`);
  for (const e of p.failedRequests) lines.push(`  [requestfailed] ${e}`);
  return lines.join('\n');
}

export function ensureOutDir(sub = '') {
  const dir = sub ? join(OUT_DIR, sub) : OUT_DIR;
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─────────────────────────────────────────────────────────────────────────────
// Servidor Vite (dev / preview) y build de producción aislado
// ─────────────────────────────────────────────────────────────────────────────
/** Ejecutable de vite: se lanza con `node` directamente (sin capa pnpm) para poder matarlo limpio. */
function viteCommand(extra) {
  const bin = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (existsSync(bin)) return { cmd: process.execPath, args: [bin, ...extra] };
  return { cmd: IS_WIN ? 'pnpm.cmd' : 'pnpm', args: ['exec', 'vite', ...extra], shell: IS_WIN };
}

/** ¿Responde un servidor vite en modo dev? (sirve /@vite/client). */
async function probeKind(url) {
  try {
    const r = await fetch(`${url}/@vite/client`);
    // preview devuelve index.html (text/html) por el fallback SPA; dev sirve JavaScript.
    return r.ok && (r.headers.get('content-type') ?? '').includes('javascript') ? 'dev' : 'preview';
  } catch {
    return null;
  }
}

/**
 * Arranca un servidor Vite (dev o preview) y espera a que responda.
 * Devuelve { url, stop }. Si ya hay uno en `port`, lo reutiliza.
 * Opciones aditivas: `outDir` (carpeta servida en modo preview), `strictMode` (falla si el servidor
 * ya existente es de otro modo) y `timeoutMs`. El proceso se lanza en su propio grupo y se mata
 * entero (no quedan procesos huérfanos aunque el script muera).
 */
export async function startServer({ mode = 'dev', port = DEFAULT_PORT, outDir, strictMode = false, timeoutMs = 45_000 } = {}) {
  const url = `http://localhost:${port}`;
  const existing = await probeKind(url);
  if (existing) {
    if (existing !== mode) {
      const msg = `El puerto ${port} ya lo ocupa un servidor '${existing}' (se pidió '${mode}').`;
      if (strictMode) throw new Error(`${msg} Ciérralo o usa --port=<otro>.`);
      console.warn(`[qa] AVISO: ${msg} Se reutiliza igualmente.`);
    }
    return { url, stop: async () => {} };
  }
  const common = ['--port', String(port), '--strictPort', '--host', 'localhost'];
  const extra = mode === 'preview'
    ? ['preview', ...common, ...(outDir ? ['--outDir', outDir] : [])]
    : [...common];
  const { cmd, args, shell } = viteCommand(extra);
  const child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: !IS_WIN, shell: shell ?? false });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const killGroup = (sig) => {
    try {
      if (!child.pid) return;
      if (IS_WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      else process.kill(-child.pid, sig);
    } catch {
      /* ya terminó */
    }
  };
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    off();
    killGroup('SIGTERM');
    for (let i = 0; i < 20 && child.exitCode === null && child.signalCode === null; i++) await sleep(100);
    if (child.exitCode === null && child.signalCode === null) killGroup('SIGKILL');
  };
  const off = registerCleanup(stop, () => killGroup('SIGKILL'));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeKind(url)) return { url, stop };
    if (child.exitCode !== null) {
      off();
      throw new Error(`vite terminó (${child.exitCode}):\n${log}`);
    }
    await sleep(250);
  }
  await stop();
  throw new Error(`vite no arrancó en ${port} tras ${timeoutMs} ms:\n${log}`);
}

/** Fecha de modificación más reciente de los ficheros que influyen en el build. */
function newestSourceMtime() {
  let newest = 0;
  const visit = (p) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const e of readdirSync(p)) visit(join(p, e));
    } else newest = Math.max(newest, st.mtimeMs);
  };
  for (const p of ['src', 'index.html', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'vite.config.ts']) visit(join(ROOT, p));
  return newest;
}

/**
 * Garantiza un build de producción FRESCO y devuelve la carpeta a servir (relativa a ROOT).
 *  - Reutiliza `dist/` (pnpm build) o `qa-output/dist` si son más nuevos que el código fuente.
 *  - Si no, compila con vite SOLO al directorio aislado `qa-output/dist` (no pisa `dist/` de otros
 *    agentes y no falla por errores de tipos ajenos; el typecheck lo hace `pnpm qa`).
 *  - `pnpmBuild: true` fuerza `pnpm build` (tsc + vite → dist/).
 */
export function buildProd({ force = false, pnpmBuild = false, log = console.log } = {}) {
  const newest = newestSourceMtime();
  const fresh = (dir) => {
    try {
      return statSync(join(ROOT, dir, 'index.html')).mtimeMs >= newest;
    } catch {
      return false;
    }
  };
  if (!force && !pnpmBuild) {
    for (const dir of ['qa-output/dist', 'dist']) {
      if (fresh(dir)) {
        log(`[qa] build reutilizado: ${dir}/`);
        return { outDir: dir, built: false, ms: 0 };
      }
    }
  }
  const t0 = Date.now();
  let res;
  let outDir;
  if (pnpmBuild) {
    outDir = 'dist';
    log('[qa] pnpm build …');
    res = spawnSync(IS_WIN ? 'pnpm.cmd' : 'pnpm', ['build'], { cwd: ROOT, encoding: 'utf8', shell: IS_WIN });
  } else {
    outDir = 'qa-output/dist';
    log('[qa] vite build (aislado en qa-output/dist) …');
    const { cmd, args, shell } = viteCommand(['build', '--outDir', outDir, '--emptyOutDir']);
    res = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: shell ?? false });
  }
  if (res.status !== 0) {
    const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`.trim().split('\n').slice(-40).join('\n');
    throw new Error(`El build de producción falló (código ${res.status}):\n${out}`);
  }
  return { outDir, built: true, ms: Date.now() - t0 };
}

/**
 * Sirve el juego: `dev` = vite dev (?), `prod` = build de producción + vite preview.
 * Devuelve { url, stop, kind, buildInfo }.
 */
export async function serveGame({ dev = false, port = DEFAULT_PORT, force = false, pnpmBuild = false, log = console.log } = {}) {
  if (dev) {
    const srv = await startServer({ mode: 'dev', port, strictMode: true });
    return { ...srv, kind: 'dev', buildInfo: null };
  }
  const buildInfo = buildProd({ force, pnpmBuild, log });
  const srv = await startServer({ mode: 'preview', port, outDir: buildInfo.outDir, strictMode: true });
  return { ...srv, kind: 'preview', buildInfo };
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const idx = a.indexOf('=');
      const k = idx < 0 ? a.slice(2) : a.slice(2, idx);
      out[k] = idx < 0 ? true : a.slice(idx + 1);
    } else out._.push(a);
  }
  return out;
}

/** Lee un flag numérico (`--x=5`) con valor por defecto. */
export function numArg(args, name, def) {
  const v = args[name];
  if (v === undefined || v === true) return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} debe ser numérico (recibido '${v}')`);
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// Informe (PASS / FAIL / WARN / SKIP) y tablas
// ─────────────────────────────────────────────────────────────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);

export class Report {
  constructor(title) {
    this.title = title;
    this.counts = { pass: 0, fail: 0, warn: 0, skip: 0 };
    this.failures = [];
    console.log(`\n=== ${title} ===`);
  }

  section(name) {
    console.log(`\n── ${name}`);
  }

  info(text) {
    console.log(`  ${paint(36, 'INFO')}  ${text}`);
  }

  /** Aserción dura: cuenta como fallo si `ok` es falso. */
  check(name, ok, detail = '') {
    if (ok) {
      this.counts.pass++;
      console.log(`  ${paint(32, 'PASS')}  ${name}${detail ? ` — ${detail}` : ''}`);
    } else {
      this.counts.fail++;
      this.failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
      console.log(`  ${paint(31, 'FAIL')}  ${name}${detail ? ` — ${detail}` : ''}`);
    }
    return ok;
  }

  /** Aserción blanda: interpretación no explícita en el contrato; no rompe el resultado. */
  soft(name, ok, detail = '') {
    if (ok) {
      this.counts.pass++;
      console.log(`  ${paint(32, 'PASS')}  ${name}${detail ? ` — ${detail}` : ''}`);
    } else this.warn(name, detail);
    return ok;
  }

  warn(name, detail = '') {
    this.counts.warn++;
    console.log(`  ${paint(33, 'WARN')}  ${name}${detail ? ` — ${detail}` : ''}`);
  }

  skip(name, reason = '') {
    this.counts.skip++;
    console.log(`  ${paint(90, 'SKIP')}  ${name}${reason ? ` — ${reason}` : ''}`);
  }

  /** Tabla simple: columns = [{ key, title, align?, fmt? }]. */
  table(rows, columns) {
    const cell = (r, c) => {
      const v = r[c.key];
      return c.fmt ? c.fmt(v, r) : v === undefined || v === null ? '-' : String(v);
    };
    const widths = columns.map((c) => Math.max(c.title.length, ...rows.map((r) => cell(r, c).length)));
    const line = (cells) => cells.map((s, i) => (columns[i].align === 'right' ? s.padStart(widths[i]) : s.padEnd(widths[i]))).join('  ');
    console.log(`  ${line(columns.map((c) => c.title))}`);
    console.log(`  ${widths.map((w) => '-'.repeat(w)).join('  ')}`);
    for (const r of rows) console.log(`  ${line(columns.map((c) => cell(r, c)))}`);
  }

  /** Imprime el resultado final y devuelve el código de salida (0 = PASS). */
  summary({ strictSkips = false } = {}) {
    const { pass, fail, warn, skip } = this.counts;
    const failed = fail > 0 || (strictSkips && skip > 0);
    console.log(`\n${paint(failed ? 31 : 32, failed ? 'RESULTADO: FAIL' : 'RESULTADO: PASS')} · ${this.title} — ${pass} PASS, ${fail} FAIL, ${warn} WARN, ${skip} SKIP`);
    if (fail > 0) {
      console.log('Fallos:');
      for (const f of this.failures) console.log(`  - ${f}`);
    }
    if (strictSkips && skip > 0) console.log('(--strict: los SKIP cuentan como fallo)');
    return failed ? 1 : 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Análisis de capturas PNG (sin dependencias: zlib + desfiltrado manual)
// ─────────────────────────────────────────────────────────────────────────────
/** Decodifica un PNG de 8 bits sin entrelazado (lo que produce Chrome). */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('No es un PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (bitDepth !== 8 || interlace !== 0 || !channels) throw new Error(`PNG no soportado (bits=${bitDepth}, tipo=${colorType}, entrelazado=${interlace})`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[dst + x - channels] : 0;
      const b = y > 0 ? out[dst - stride + x] : 0;
      const c = x >= channels && y > 0 ? out[dst - stride + x - channels] : 0;
      let v = raw[src + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[dst + x] = v & 255;
    }
  }
  return { width, height, channels, data: out };
}

/**
 * Estadísticas de una captura PNG para detectar lienzos en blanco/negro/planos.
 * Devuelve { width, height, meanLuma, stdLuma, distinctColors, darkRatio, blank }.
 */
export function analyzePng(buf, { step = 6, blankStd = 2, blankColors = 4 } = {}) {
  const img = decodePng(buf);
  const { width, height, channels, data } = img;
  const seen = new Set();
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  let dark = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * channels;
      const r = data[i];
      const g = channels >= 3 ? data[i + 1] : r;
      const b = channels >= 3 ? data[i + 2] : r;
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
  return {
    width,
    height,
    meanLuma: mean,
    stdLuma: std,
    distinctColors: seen.size,
    darkRatio: dark / n,
    blank: std < blankStd || seen.size <= blankColors,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Config y estado de los módulos (lectura estática del repo)
// ─────────────────────────────────────────────────────────────────────────────
let cachedConfig;
/** Importa src/config.ts desde Node (type-stripping de Node ≥ 22.18; config.ts no tiene dependencias de valor). */
export async function loadConfig() {
  if (cachedConfig) return cachedConfig;
  const prev = process.listeners('warning');
  process.removeAllListeners('warning'); // silencia el ExperimentalWarning del type-stripping
  try {
    cachedConfig = await import(new URL('../../src/config.ts', import.meta.url).href);
  } catch (err) {
    throw new Error(`No se pudo importar src/config.ts desde Node (${process.version}; requiere ≥ 22.18 con type-stripping): ${err instanceof Error ? err.message : err}`);
  } finally {
    for (const l of prev) process.on('warning', l);
  }
  return cachedConfig;
}

const GAME_MODULES = ['engine', 'world', 'player', 'enemies', 'missions', 'ui', 'audio'];

/** Recorre un directorio devolviendo rutas de ficheros (relativas a ROOT). */
export function walk(dir, exts = null) {
  const out = [];
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(rel, exts));
    else if (!exts || exts.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out;
}

/**
 * ¿Cada módulo es el real o todavía el stub provisional? Un módulo es STUB si algún fichero de
 * src/<módulo>/ contiene el marcador PROVISIONAL o importa de dev/stubs.
 * Devuelve { engine: 'stub'|'real', … , stubs: [...] , reals: [...] }.
 */
export function moduleStatus() {
  const status = {};
  for (const m of GAME_MODULES) {
    const files = walk(`src/${m}`, ['.ts']);
    const stub = files.length === 0 || files.some((f) => {
      const src = readFileSync(join(ROOT, f), 'utf8');
      return /PROVISIONAL/.test(src) || /dev\/stubs/.test(src);
    });
    status[m] = stub ? 'stub' : 'real';
  }
  status.stubs = GAME_MODULES.filter((m) => status[m] === 'stub');
  status.reals = GAME_MODULES.filter((m) => status[m] === 'real');
  return status;
}

/** Nombres de evento declarados en `interface GameEvents` (src/core/events.ts). */
export function readEventNames() {
  const src = readFileSync(join(ROOT, 'src/core/events.ts'), 'utf8');
  const body = /export interface GameEvents \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
  return [...body.matchAll(/^\s*'([a-z]+:[A-Za-z]+)'\s*:/gm)].map((m) => m[1]);
}

export { sleep };
