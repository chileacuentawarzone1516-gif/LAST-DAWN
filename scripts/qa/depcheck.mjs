#!/usr/bin/env node
// QA · DEPCHECK — dependencias declaradas en package.json vs imports reales.
//
// Uso:  node scripts/qa/depcheck.mjs [--strict] [--allow-new]
//   FAIL: import de un paquete NO declarado; subruta three/addons inexistente; dependencia nueva
//         fuera de la lista permitida (three, vite, vitest, typescript, playwright-core, @types/*);
//         dependencia de herramienta (TOOL_DEPS) que no sea devDependency, que no use su herramienta o
//         que se importe desde src/ (acabaría en el build).
//   WARN: dependencia declarada y sin uso (FAIL con --strict)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, Report, parseArgs, runMain, walk } from './lib.mjs';

const ALLOWED = new Set(['three', 'vite', 'vitest', 'typescript', 'playwright-core', '@types/node', '@types/three']);
/**
 * Dependencias de DESARROLLO permitidas sólo para una herramienta concreta (nunca en el juego):
 * el pipeline de optimización de los modelos de personaje (ver ASSETS.md).
 */
const TOOL_DEPS = {
  '@gltf-transform/core': 'tools/optimize-characters.mjs',
  '@gltf-transform/extensions': 'tools/optimize-characters.mjs',
  '@gltf-transform/functions': 'tools/optimize-characters.mjs',
  meshoptimizer: 'tools/optimize-characters.mjs',
};
const BUILTINS = new Set(['fs', 'path', 'os', 'child_process', 'url', 'zlib', 'http', 'https', 'net', 'util', 'stream', 'crypto', 'assert', 'events', 'timers', 'module', 'process', 'buffer', 'readline', 'worker_threads']);
/** Binarios de CLI (scripts de package.json) → paquete que los aporta. */
const BIN_TO_PKG = { tsc: 'typescript', vite: 'vite', vitest: 'vitest' };

/** Quita comentarios de línea y bloque (sin tocar el resto): suficiente para localizar imports. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

function importsOf(src) {
  const code = stripComments(src);
  const out = new Set();
  const res = [
    /\b(?:import|export)\s+(?:type\s+)?[^'";]*?\sfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of res) for (const m of code.matchAll(re)) out.add(m[1]);
  return out;
}

/** Especificador → nombre de paquete (o null si es relativo, absoluto, builtin o virtual). */
function packageOf(spec) {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || spec.startsWith('virtual:') || spec.startsWith('http')) return spec.startsWith('node:') ? 'node:' : null;
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return BUILTINS.has(name) ? 'node:' : name;
}

async function main() {
  const args = parseArgs();
  const R = new Report('DEPCHECK');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const files = [
    ...walk('src', ['.ts']), ...walk('dev', ['.ts', '.html']), ...walk('tests', ['.ts']), ...walk('scripts', ['.mjs', '.js', '.ts']),
    ...walk('tools', ['.mjs', '.js', '.ts']), 'vite.config.ts', 'index.html',
  ].filter((f) => f !== 'scripts/qa/depcheck.mjs' && existsSync(join(ROOT, f)));

  const used = new Map(); // paquete → primeros ficheros que lo usan
  const subpaths = [];
  for (const f of files) {
    let src = readFileSync(join(ROOT, f), 'utf8');
    if (f.endsWith('.html')) src = [...src.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
    for (const spec of importsOf(src)) {
      const name = packageOf(spec);
      if (!name) continue;
      if (name === 'node:') {
        (used.get('@types/node') ?? used.set('@types/node', []).get('@types/node')).push(f);
        continue;
      }
      (used.get(name) ?? used.set(name, []).get(name)).push(f);
      if (name === 'three' && spec.startsWith('three/addons/')) subpaths.push({ spec, file: f });
    }
  }
  // Uso implícito: CLIs en scripts, tsconfig.types y @types/<pkg> de paquetes usados.
  for (const cmd of Object.values(pkg.scripts ?? {})) {
    for (const tok of String(cmd).split(/[\s&|;]+/)) if (BIN_TO_PKG[tok]) used.set(BIN_TO_PKG[tok], [...(used.get(BIN_TO_PKG[tok]) ?? []), 'package.json#scripts']);
  }
  try {
    const ts = JSON.parse(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8').replace(/\/\/.*$/gm, ''));
    for (const t of ts.compilerOptions?.types ?? []) {
      const name = t.startsWith('@') ? t.split('/').slice(0, 2).join('/') : t.split('/')[0];
      if (name in declared) used.set(name, [...(used.get(name) ?? []), 'tsconfig#types']);
      used.set(`@types/${name}`, [...(used.get(`@types/${name}`) ?? []), 'tsconfig#types']);
    }
  } catch {
    R.warn('tsconfig.json no legible', 'se omite el uso implícito por compilerOptions.types');
  }
  for (const name of [...used.keys()]) if (!name.startsWith('@types/')) used.set(`@types/${name}`, [...(used.get(`@types/${name}`) ?? []), `tipos de ${name}`]);

  R.section('Imports sin declarar');
  const undeclared = [...used.keys()].filter((n) => !n.startsWith('@types/') && !(n in declared));
  R.check('todos los paquetes importados están declarados', undeclared.length === 0, undeclared.map((n) => `${n} (${used.get(n).slice(0, 2).join(', ')})`).join('; ') || `${used.size} paquetes en uso`);

  R.section('Declaradas sin uso');
  for (const name of Object.keys(declared)) {
    const isUsed = (used.get(name) ?? []).length > 0 && !(name.startsWith('@types/') && (used.get(name) ?? []).every((x) => x.startsWith('tipos de') && !(`${name.slice(7)}` in declared)));
    if (isUsed) R.check(`${name} se usa`, true, (used.get(name) ?? []).slice(0, 2).join(', '));
    else if (args.strict) R.check(`${name} se usa`, false, 'declarada y sin ningún import');
    else R.warn(`${name} declarada sin uso`, 'ningún import ni CLI la referencia (quítala o justifícala)');
  }

  R.section('Reglas del proyecto');
  if (!args['allow-new']) {
    const extra = Object.keys(declared).filter((n) => !ALLOWED.has(n) && !(n in TOOL_DEPS));
    R.check('sin dependencias nuevas (three, vite, vitest, typescript, playwright-core, @types/node|three)', extra.length === 0, extra.join(', ') || 'lista permitida');
  }
  for (const [name, tool] of Object.entries(TOOL_DEPS)) {
    if (!(name in declared)) continue;
    const users = used.get(name) ?? [];
    const inSrc = users.filter((f) => f.startsWith('src/'));
    const ok = name in (pkg.devDependencies ?? {}) && !(name in (pkg.dependencies ?? {})) && users.includes(tool) && inSrc.length === 0;
    R.check(`${name}: sólo devDependency de ${tool}`, ok,
      ok ? 'fuera del build' : `dev=${name in (pkg.devDependencies ?? {})} usada-por-herramienta=${users.includes(tool)} en-src=${inSrc.join(', ') || 'no'}`);
  }
  const bad = subpaths.filter(({ spec }) => {
    const rel = spec.replace('three/addons/', '');
    return !existsSync(join(ROOT, 'node_modules', 'three', 'examples', 'jsm', rel));
  });
  R.check('las subrutas three/addons/* existen', bad.length === 0, bad.map((b) => `${b.spec} (${b.file})`).join('; ') || `${subpaths.length} imports comprobados`);
  return R.summary();
}

runMain(main, { name: 'depcheck', maxMs: 60_000 });
