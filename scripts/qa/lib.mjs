// Utilidades compartidas para los scripts de QA con Chrome headless.
// Usa playwright-core con el Chromium preinstalado (no descarga nada).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const ROOT = resolve(new URL('../..', import.meta.url).pathname);
export const OUT_DIR = join(ROOT, 'qa-output');

/** Localiza el ejecutable de Chromium (env CHROME_PATH > playwright > sistema). */
export function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  const candidates = [join(base, 'chromium', 'chrome-linux', 'chrome')];
  if (existsSync(base)) {
    for (const d of readdirSync(base)) {
      if (d.startsWith('chromium')) {
        candidates.push(join(base, d, 'chrome-linux', 'chrome'));
        candidates.push(join(base, d, 'chrome-linux', 'headless_shell'));
      }
    }
  }
  candidates.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome');
  return candidates.find((p) => existsSync(p));
}

/** Lanza Chromium con WebGL2 por software (SwiftShader) para entornos sin GPU. */
export async function launchBrowser({ headless = true } = {}) {
  const executablePath = findChrome();
  if (!executablePath) throw new Error('No se encontró Chromium. Define CHROME_PATH.');
  return chromium.launch({
    executablePath,
    headless,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
    ],
  });
}

/** Abre una página capturando errores de consola, excepciones y fallos de red. */
export async function openPage(browser, url, { width = 1280, height = 720, wait = 'load' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems = { errors: [], warnings: [], pageErrors: [], failedRequests: [] };
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error') problems.errors.push(msg.text());
    else if (t === 'warning') problems.warnings.push(msg.text());
  });
  page.on('pageerror', (err) => problems.pageErrors.push(String(err?.stack ?? err)));
  page.on('requestfailed', (req) => problems.failedRequests.push(`${req.method()} ${req.url()}`));
  await page.goto(url, { waitUntil: wait });
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

/**
 * Arranca un servidor Vite (dev o preview) y espera a que responda.
 * Devuelve { url, stop }. Si ya hay uno en `port`, lo reutiliza.
 */
export async function startServer({ mode = 'dev', port = 5173 } = {}) {
  const url = `http://localhost:${port}`;
  const alive = async () => {
    try {
      const r = await fetch(url + '/');
      return r.ok;
    } catch {
      return false;
    }
  };
  if (await alive()) return { url, stop: async () => {} };
  const args = mode === 'preview'
    ? ['exec', 'vite', 'preview', '--port', String(port), '--strictPort', '--host', 'localhost']
    : ['exec', 'vite', '--port', String(port), '--strictPort', '--host', 'localhost'];
  const child = spawn('pnpm', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    if (await alive()) {
      return {
        url,
        stop: async () => {
          child.kill('SIGTERM');
          await sleep(200);
        },
      };
    }
    if (child.exitCode !== null) throw new Error(`vite terminó (${child.exitCode}):\n${log}`);
    await sleep(300);
  }
  child.kill('SIGTERM');
  throw new Error(`vite no arrancó en ${port}:\n${log}`);
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v === undefined ? true : v;
    } else out._.push(a);
  }
  return out;
}

export { sleep };
