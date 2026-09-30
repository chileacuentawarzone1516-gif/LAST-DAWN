#!/usr/bin/env node
// QA · BASELINE — ejecuta cada suite POR SEPARADO y registra resultados y entorno (PLAN v0.1.5, §3.1 y §25–26).
//
// Uso:  pnpm qa:baseline [--label=windows-omen] [--suites=typecheck,test,…] [--with-new] [--out=qa-output/baseline-0.1.5]
//
//  · No corrige nada ni cambia criterios: si una suite falla, se registra (código de salida + log) y se sigue con
//    las demás para tener la foto completa. El proceso termina con código ≠ 0 si alguna falló.
//  · --with-new añade las suites nuevas de v0.1.5 (qa:mobile, qa:instrumentation).
//  · Salida (ignorada por git): <out>/<label>-<fecha>/{env.json, NN-<suite>.log, summary.json, summary.md}.
//  · Funciona en Windows (pnpm.cmd con shell) y en Linux/macOS.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { cpus, platform, release, arch, totalmem, type as osType } from 'node:os';
import { join } from 'node:path';
import { findChrome, launchBrowser, parseArgs, ROOT } from './lib.mjs';

const IS_WIN = process.platform === 'win32';
const DEFAULT_SUITES = ['typecheck', 'test', 'build', 'qa:deps', 'qa:smoke', 'qa:previews', 'qa:perf', 'qa:audio', 'qa:playthrough'];
const NEW_SUITES = ['qa:mobile', 'qa:instrumentation'];

const sh = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: IS_WIN });
  return r.status === 0 ? r.stdout.trim() : null;
};

/** Extrae el resultado de la salida de cada suite (formato de Report, vitest o código de salida). */
function parseOutcome(suite, out) {
  const clean = out.replace(/\u001b\[[0-9;]*m/g, '');
  const rep = [...clean.matchAll(/RESULTADO: (PASS|FAIL) · (.+?) — (\d+) PASS, (\d+) FAIL, (\d+) WARN, (\d+) SKIP/g)].pop();
  if (rep) return { verdict: rep[1], pass: +rep[3], fail: +rep[4], warn: +rep[5], skip: +rep[6] };
  const vt = /Tests\s+(?:(\d+) failed \| )?(\d+) passed(?: \| (\d+) skipped)? \((\d+)\)/.exec(clean);
  if (vt) return { verdict: vt[1] ? 'FAIL' : 'PASS', pass: +vt[2], fail: +(vt[1] ?? 0), warn: 0, skip: +(vt[3] ?? 0), total: +vt[4] };
  const au = /(\d+) sonidos, (\d+) fallos/.exec(clean);
  if (au) return { verdict: +au[2] === 0 ? 'PASS' : 'FAIL', sounds: +au[1], fail: +au[2] };
  return null;
}

function runSuite(suite, logPath) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const out = createWriteStream(logPath);
    let text = '';
    const child = spawn(IS_WIN ? 'pnpm.cmd' : 'pnpm', ['run', suite], { cwd: ROOT, shell: IS_WIN, env: { ...process.env, FORCE_COLOR: '0' } });
    const onData = (d) => {
      out.write(d);
      text += d;
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => {
      out.end();
      resolve({ suite, exitCode: code, durationS: Math.round((Date.now() - t0) / 100) / 10, outcome: parseOutcome(suite, text) });
    });
  });
}

async function main() {
  const args = parseArgs();
  const label = typeof args.label === 'string' ? args.label : `${platform()}-${arch()}`;
  const base = typeof args.out === 'string' ? args.out : join('qa-output', 'baseline-0.1.5');
  let suites = typeof args.suites === 'string' ? args.suites.split(',') : [...DEFAULT_SUITES];
  if (args['with-new']) suites = [...suites, ...NEW_SUITES.filter((s) => !suites.includes(s))];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(ROOT, base, `${label}-${stamp}`);
  mkdirSync(dir, { recursive: true });

  // ── Entorno ──────────────────────────────────────────────────────────────
  let chromium = { path: findChrome() ?? null, version: null };
  try {
    const b = await launchBrowser();
    chromium.version = b.version();
    await b.close();
  } catch (e) {
    chromium.error = e instanceof Error ? e.message.split('\n')[0] : String(e);
  }
  const [maj, min] = process.versions.node.split('.').map(Number);
  const env = {
    label,
    startedAt: new Date().toISOString(),
    node: process.version,
    nodeMeetsQaDoc: maj > 22 || (maj === 22 && min >= 18),
    pnpm: sh(IS_WIN ? 'pnpm.cmd' : 'pnpm', ['-v']),
    git: {
      commit: sh('git', ['rev-parse', 'HEAD']),
      branch: sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
      statusBefore: sh('git', ['status', '--porcelain']),
    },
    os: { platform: platform(), type: osType(), release: release(), arch: arch(), cpu: cpus()[0]?.model ?? null, cores: cpus().length, ramGb: Math.round(totalmem() / 1073741824) },
    chromium,
    suites,
  };
  writeFileSync(join(dir, 'env.json'), JSON.stringify(env, null, 2));
  console.log(`[baseline] ${label} · Node ${env.node} · pnpm ${env.pnpm} · ${env.os.type} ${env.os.release} · Chromium ${chromium.version ?? '?'}`);
  console.log(`[baseline] commit ${env.git.commit} (${env.git.branch}) · árbol ${env.git.statusBefore ? 'CON cambios' : 'limpio'}`);
  if (!env.nodeMeetsQaDoc) console.log('[baseline] AVISO: docs/QA.md exige Node ≥ 22.18 (type-stripping); algunas suites pueden fallar por la versión.');
  console.log(`[baseline] salida: ${dir}`);

  // ── Suites ───────────────────────────────────────────────────────────────
  const results = [];
  for (let i = 0; i < suites.length; i++) {
    const s = suites[i];
    const log = join(dir, `${String(i + 1).padStart(2, '0')}-${s.replace(':', '-')}.log`);
    process.stdout.write(`[baseline] ${s} … `);
    const r = await runSuite(s, log);
    results.push(r);
    const o = r.outcome;
    console.log(`${r.exitCode === 0 ? 'OK' : `FALLO (código ${r.exitCode})`} · ${r.durationS} s${o ? ` · ${JSON.stringify(o)}` : ''}`);
  }
  env.git.statusAfter = sh('git', ['status', '--porcelain']);
  env.finishedAt = new Date().toISOString();
  writeFileSync(join(dir, 'env.json'), JSON.stringify(env, null, 2));

  const failed = results.filter((r) => r.exitCode !== 0);
  const summary = { env, results, failed: failed.map((r) => r.suite) };
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  const md = [
    `# Baseline ${label}`,
    '',
    `- Commit: \`${env.git.commit}\` (${env.git.branch}) · árbol antes: ${env.git.statusBefore ? 'con cambios' : 'limpio'} · después: ${env.git.statusAfter ? 'con cambios' : 'limpio'}`,
    `- Node ${env.node} · pnpm ${env.pnpm} · ${env.os.type} ${env.os.release} (${env.os.arch}) · ${env.os.cpu} ×${env.os.cores} · ${env.os.ramGb} GB`,
    `- Chromium: ${chromium.version ?? chromium.error ?? '?'} (${chromium.path ?? 'no encontrado'})`,
    '',
    '| Suite | Código | Duración (s) | Resultado |',
    '| --- | --- | --- | --- |',
    ...results.map((r) => `| ${r.suite} | ${r.exitCode} | ${r.durationS} | ${r.outcome ? Object.entries(r.outcome).map(([k, v]) => `${k}=${v}`).join(' ') : '—'} |`),
    '',
    failed.length ? `**Fallos:** ${failed.map((r) => r.suite).join(', ')} — ver los .log de cada suite. No se ha corregido nada.` : 'Todas las suites terminaron con código 0.',
    '',
    'Nota: SwiftShader (sin GPU) no mide FPS reales; los tiempos son indicativos. El rendimiento Android se mide en el dispositivo físico.',
  ].join('\n');
  writeFileSync(join(dir, 'summary.md'), `${md}\n`);
  console.log(`\n[baseline] ${failed.length ? `FALLOS: ${failed.map((r) => r.suite).join(', ')}` : 'todas las suites OK'} · resumen: ${join(dir, 'summary.md')}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
