#!/usr/bin/env node
// QA · PERF — presupuestos de render (drawCalls/triángulos/memoria), coste de update() y FUGAS.
//
// Uso:  node scripts/qa/perf.mjs [--dev] [--port=5208] [--rebuild] [--steps=300]
//         [--cycles=3] [--cycle-s=60] [--skip-points] [--skip-leaks] [--no-stress]
//         [--budget-calls=N] [--budget-tris=N] [--update-ms=5] [--strict-update]
//         [--leak-geom=10] [--leak-tex=2] [--leak-prog=2] [--leak-objects=80] [--leak-listeners=0]
//         [--inject-leak]   (autoprueba: inyecta una fuga y exige que el detector la vea → FAIL)
//
// Los presupuestos de render salen de RENDER.budget (src/config.ts) y son ESTRICTOS (FAIL).
// El tiempo de update() por frame es INFORMATIVO (WARN) salvo --strict-update: SwiftShader no
// mide FPS reales, así que el objetivo de 60 FPS se valida con drawCalls/triángulos/tiempo de update.
import { loadConfig, moduleStatus, launchBrowser, serveGame, ensureOutDir, formatProblems, hasProblems, parseArgs, numArg, Report, runMain, DEFAULT_PORT } from './lib.mjs';
import { openGame } from './game.mjs';

// ── Código en la página ──────────────────────────────────────────────────────
function timeUpdates(n) {
  const g = window.__qa.game;
  const ts = new Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    g.update(1 / 30);
    ts[i] = performance.now() - t;
    total += ts[i];
  }
  ts.sort((a, b) => a - b);
  const at = (p) => ts[Math.min(n - 1, Math.floor(n * p))];
  return { n, mean: total / n, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: ts[n - 1] };
}

/** Dibuja `n` frames esperando a la GPU (gl.finish) y devuelve ms medios; deja renderer.info del último. */
function timeRender(n) {
  const q = window.__qa;
  const gl = q.game.ctx.engine.renderer.getContext();
  q.game.render(); // calentamiento (compilación de shaders)
  gl.finish();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) q.game.render();
  gl.finish();
  return (performance.now() - t0) / n;
}

function spawnRing({ count, x, z }) {
  const q = window.__qa;
  const types = ['walker', 'runner', 'brute', 'spitter'];
  let ok = 0;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const r = 14 + (i % 3) * 8;
    if (q.spawnEnemy(types[i % types.length], x + Math.cos(a) * r, z + Math.sin(a) * r) !== null) ok++;
  }
  return ok;
}

// ── Lado Node ────────────────────────────────────────────────────────────────
const f1 = (v) => (typeof v === 'number' ? v.toFixed(1) : '-');
const fi = (v) => (typeof v === 'number' ? String(Math.round(v)) : '-');

async function main() {
  const args = parseArgs();
  const port = numArg(args, 'port', DEFAULT_PORT);
  const cfg = await loadConfig();
  const budgetCalls = numArg(args, 'budget-calls', cfg.RENDER.budget.drawCalls);
  const budgetTris = numArg(args, 'budget-tris', cfg.RENDER.budget.triangles);
  const updateMs = numArg(args, 'update-ms', 5);
  const steps = numArg(args, 'steps', 300);
  const cycles = Math.max(2, numArg(args, 'cycles', 3));
  const cycleS = numArg(args, 'cycle-s', 60);
  const tol = {
    geometries: numArg(args, 'leak-geom', 10),
    textures: numArg(args, 'leak-tex', 2),
    programs: numArg(args, 'leak-prog', 2),
    objects: numArg(args, 'leak-objects', 80),
    listeners: numArg(args, 'leak-listeners', 0),
  };
  const mods = moduleStatus();
  const outDir = ensureOutDir('perf');
  const R = new Report(`PERF (${args.dev ? 'dev — no representativo' : 'producción'})`);
  R.info(`presupuesto: ${budgetCalls} drawCalls · ${budgetTris.toLocaleString('es')} triángulos · update ≤ ${updateMs} ms (informativo)`);
  R.info(`módulos reales: ${mods.reals.join(', ') || '(ninguno)'} · stubs: ${mods.stubs.join(', ') || '(ninguno)'}`);
  if (mods.stubs.length) R.info('con módulos stub las cifras son triviales: el barrido significativo es sobre el juego integrado');

  const srv = await serveGame({ dev: !!args.dev, port, force: !!args.rebuild, pnpmBuild: !!args['pnpm-build'], log: (m) => R.info(m) });
  const browser = await launchBrowser();
  let problems;
  try {
    const game = await openGame(browser, srv.url, { seed: 20260928 });
    problems = game.problems;
    const { bot } = game;
    await bot.start();
    await bot.god(true);

    // ── Puntos de medida ────────────────────────────────────────────────────
    if (args['skip-points']) R.skip('puntos de medida', '--skip-points');
    else {
      R.section('Presupuesto de render por punto (peor de 4 orientaciones)');
      const M = cfg.MAP;
      const points = [
        { name: 'spawn', x: M.spawn.x, z: M.spawn.z },
        { name: 'armería', x: M.armory.x, z: M.armory.z },
        { name: 'relé', x: M.relay.x, z: M.relay.z },
        { name: 'puerta del complejo', x: M.complex.gate.x, z: M.complex.gate.z },
        { name: 'patio del Warden', x: M.complex.wardenSpawn.x, z: M.complex.wardenSpawn.z },
        { name: 'LZ', x: M.lz.center.x, z: M.lz.center.z },
      ];
      const rows = [];
      for (const p of points) {
        await bot.teleport(p.x, p.z, 0, 0.1);
        await bot.step(2); // deja actuar al director/mundo
        let worst = null;
        for (const yaw of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
          await bot.teleport(p.x, p.z, yaw, 0.1);
          const s = await bot.ev(() => {
            window.__qa.game.render();
            window.__qa.game.render();
            return window.__qaBot.sceneStats();
          }, undefined, 'medir render');
          const calls = Math.max(s.calls, s.statsCalls);
          const tris = Math.max(s.triangles, s.statsTriangles);
          if (!worst || calls > worst.calls) worst = { ...s, calls, tris, yaw };
        }
        const upd = await bot.ev(timeUpdates, steps, 'timeUpdates');
        const rms = await bot.ev(timeRender, 3, 'timeRender');
        const nan = await bot.scanAll();
        const ok = worst.calls <= budgetCalls && worst.tris <= budgetTris;
        rows.push({ name: p.name, calls: worst.calls, tris: worst.tris, geom: worst.geometries, tex: worst.textures, prog: worst.programs, objs: worst.scene.objects, lights: worst.scene.lights, meshes: worst.scene.visibleMeshes, upd, rms, ok });
        R.check(`${p.name}: drawCalls ≤ ${budgetCalls}`, worst.calls <= budgetCalls, `${worst.calls}`);
        R.check(`${p.name}: triángulos ≤ ${budgetTris.toLocaleString('es')}`, worst.tris <= budgetTris, worst.tris.toLocaleString('es'));
        R.check(`${p.name}: estado finito tras ${steps} pasos`, nan.length === 0, nan.join(', ') || 'ok');
        const slow = upd.mean > updateMs;
        if (args['strict-update']) R.check(`${p.name}: update() medio ≤ ${updateMs} ms`, !slow, `${upd.mean.toFixed(2)} ms`);
        else if (slow) R.warn(`${p.name}: update() medio ${upd.mean.toFixed(2)} ms > ${updateMs} ms (informativo)`, `p95=${upd.p95.toFixed(2)} máx=${upd.max.toFixed(2)}`);
      }
      R.table(rows, [
        { key: 'name', title: 'punto' },
        { key: 'calls', title: 'drawCalls', align: 'right', fmt: fi },
        { key: 'tris', title: 'triángulos', align: 'right', fmt: (v) => (typeof v === 'number' ? v.toLocaleString('es') : '-') },
        { key: 'geom', title: 'geom', align: 'right', fmt: fi },
        { key: 'tex', title: 'tex', align: 'right', fmt: fi },
        { key: 'prog', title: 'progs', align: 'right', fmt: fi },
        { key: 'objs', title: 'objetos', align: 'right', fmt: fi },
        { key: 'meshes', title: 'mallas vis.', align: 'right', fmt: fi },
        { key: 'lights', title: 'luces', align: 'right', fmt: fi },
        { key: 'upd', title: 'update ms (media/p95/máx)', align: 'right', fmt: (u) => `${u.mean.toFixed(2)}/${u.p95.toFixed(2)}/${u.max.toFixed(2)}` },
        { key: 'rms', title: 'render ms*', align: 'right', fmt: f1 },
        { key: 'ok', title: 'presupuesto', fmt: (v) => (v ? 'PASS' : 'FAIL') },
      ]);
      R.info('* render ms = SwiftShader (CPU): sólo orientativo, NO representa FPS reales.');

      // Estrés: población máxima alrededor del jugador (relé).
      if (args['no-stress']) R.skip('estrés de población', '--no-stress');
      else {
        await bot.teleport(M.relay.x, M.relay.z, 0, 0.1);
        const spawned = await bot.ev(spawnRing, { count: cfg.DIRECTOR.maxAlive, x: M.relay.x, z: M.relay.z }, 'spawnRing');
        if (spawned === 0) R.skip('estrés: DIRECTOR.maxAlive infectados', 'spawnEnemy no crea nada (módulo real no presente: enemies)');
        else {
          await bot.step(2);
          const alive = await bot.run((ctx) => ctx.enemies.aliveCount);
          const upd = await bot.ev(timeUpdates, steps, 'timeUpdates(estrés)');
          const s = await bot.ev(() => {
            window.__qa.game.render();
            window.__qa.game.render();
            return window.__qaBot.sceneStats();
          }, undefined, 'medir estrés');
          const calls = Math.max(s.calls, s.statsCalls);
          const tris = Math.max(s.triangles, s.statsTriangles);
          R.info(`estrés: ${spawned} generados, ${alive} vivos → drawCalls=${calls} triángulos=${tris.toLocaleString('es')} update medio=${upd.mean.toFixed(2)} ms (p95 ${upd.p95.toFixed(2)}, máx ${upd.max.toFixed(2)})`);
          R.check(`estrés (${alive} infectados): drawCalls ≤ ${budgetCalls}`, calls <= budgetCalls, `${calls}`);
          R.check(`estrés (${alive} infectados): triángulos ≤ ${budgetTris.toLocaleString('es')}`, tris <= budgetTris, tris.toLocaleString('es'));
          R.check(`estrés: vivos ≤ DIRECTOR.maxAlive (${cfg.DIRECTOR.maxAlive})`, alive <= cfg.DIRECTOR.maxAlive + 1, `${alive}`);
          if (upd.mean > updateMs) R.warn(`estrés: update() medio ${upd.mean.toFixed(2)} ms > ${updateMs} ms (informativo)`);
        }
        await bot.run((ctx) => ctx.enemies.killAll());
      }
    }

    // ── Fugas ───────────────────────────────────────────────────────────────
    if (args['skip-leaks']) R.skip('fugas', '--skip-leaks');
    else {
      R.section(`Fugas: ${cycles} ciclos de start → ${cycleS} s → restart`);
      const samples = [];
      const sample = async (label) => {
        await bot.run((ctx) => ctx.enemies.killAll());
        await bot.step(1);
        const s = await bot.ev(() => {
          window.__qa.game.render();
          window.__qa.game.render();
          return { ...window.__qaBot.sceneStats(), listeners: window.__qaBot.busListeners(), enemies: window.__qa.game.ctx.enemies.aliveCount };
        }, undefined, 'muestra de fugas');
        return { label, ...s };
      };
      // Autoprueba del detector: --inject-leak añade 15 mallas con geometría propia y 1 listener por cada
      // partida nueva; el barrido DEBE terminar en FAIL (si no, el detector de fugas está roto).
      if (args['inject-leak']) {
        R.info('--inject-leak: fuga artificial activa (se espera FAIL en geometrías, objetos y listeners)');
        await bot.run((ctx) => {
          let proto = null;
          ctx.scene.traverse((o) => {
            if (!proto && o.isMesh) proto = o;
          });
          ctx.bus.on('flow:started', () => {
            for (let i = 0; i < 15 && proto; i++) ctx.scene.add(new proto.constructor(new proto.geometry.constructor(1, 1), proto.material));
            ctx.bus.on('input:digit', () => {});
          });
        });
      }
      // Se parte de una partida NUEVA para que el ciclo 1 sea "start"; los siguientes son "restart".
      await bot.toTitle();
      for (let c = 1; c <= cycles; c++) {
        if (c === 1) await bot.start();
        else await bot.restart();
        await bot.god(true);
        await bot.step(0.5);
        samples.push({ cycle: c, phase: 'inicio', ...(await sample(`c${c} inicio`)) });
        // 60 s de partida con el jugador dando vueltas por zonas para forzar carga de contenido.
        const M = cfg.MAP;
        const route = [[M.spawn.x, M.spawn.z], [M.cages[0].x, M.cages[0].z], [M.cages[1].x, M.cages[1].z], [M.relay.x, M.relay.z], [M.cages[3].x, M.cages[3].z], [M.lz.center.x, M.lz.center.z]];
        const leg = cycleS / route.length;
        for (const [x, z] of route) {
          await bot.teleport(x, z, 0, 0.1);
          await bot.step(leg);
        }
        samples.push({ cycle: c, phase: `fin (${cycleS} s)`, ...(await sample(`c${c} fin`)) });
        R.info(`ciclo ${c}/${cycles} listo`);
      }
      R.table(samples, [
        { key: 'cycle', title: 'ciclo', align: 'right' },
        { key: 'phase', title: 'punto' },
        { key: 'geometries', title: 'geom', align: 'right', fmt: fi },
        { key: 'textures', title: 'tex', align: 'right', fmt: fi },
        { key: 'programs', title: 'progs', align: 'right', fmt: fi },
        { key: 'scene', title: 'obj.scene', align: 'right', fmt: (v) => fi(v?.objects) },
        { key: 'view', title: 'obj.view', align: 'right', fmt: (v) => fi(v?.objects) },
        { key: 'scene', title: 'luces', align: 'right', fmt: (v) => fi(v?.lights) },
        { key: 'listeners', title: 'listeners', align: 'right', fmt: (v) => (v ? String(v.total) : 'n/d') },
        { key: 'enemies', title: 'enemigos', align: 'right', fmt: fi },
        { key: 'heapMB', title: 'heap MB', align: 'right', fmt: f1 },
      ]);

      // Compara los dos ÚLTIMOS ciclos, por punto (inicio/fin): deben estabilizarse.
      for (const phaseKey of ['inicio', 'fin']) {
        const pick = (c) => samples.find((s) => s.cycle === c && s.phase.startsWith(phaseKey));
        const a = pick(cycles - 1);
        const b = pick(cycles);
        if (!a || !b) continue;
        const cmp = (name, va, vb, limit) => {
          if (va === null || vb === null || va === undefined || vb === undefined) {
            R.skip(`fuga ${name} (${phaseKey})`, 'no medible en este build');
            return;
          }
          const d = vb - va;
          R.check(`sin fuga de ${name} (${phaseKey}): ciclo ${cycles} − ${cycles - 1} ≤ ${limit}`, d <= limit, `${va} → ${vb} (Δ${d >= 0 ? '+' : ''}${d})`);
        };
        cmp('geometrías', a.geometries, b.geometries, tol.geometries);
        cmp('texturas', a.textures, b.textures, tol.textures);
        cmp('programas de shader', a.programs, b.programs, tol.programs);
        cmp('objetos en la escena', a.scene.objects, b.scene.objects, Math.max(tol.objects, Math.round(a.scene.objects * 0.08)));
        cmp('objetos del viewmodel', a.view.objects, b.view.objects, Math.max(4, Math.round(a.view.objects * 0.08)));
        if (a.listeners && b.listeners) {
          const grew = Object.entries(b.listeners.byType).filter(([k, n]) => n > (a.listeners.byType[k] ?? 0)).map(([k, n]) => `${k}: ${a.listeners.byType[k] ?? 0}→${n}`);
          cmp('listeners del bus', a.listeners.total, b.listeners.total, tol.listeners);
          if (grew.length) R.info(`eventos con más listeners (${phaseKey}): ${grew.slice(0, 8).join(', ')}`);
        } else R.skip(`fuga listeners del bus (${phaseKey})`, 'bus.handlers no legible');
      }
      // Tendencia entre ciclo 1 y 2 (informativo: cachés perezosas legítimas).
      const first = samples.find((s) => s.cycle === 1 && s.phase === 'inicio');
      const second = samples.find((s) => s.cycle === 2 && s.phase === 'inicio');
      if (first && second) R.info(`ciclo 1→2 (inicio): geom ${first.geometries}→${second.geometries}, tex ${first.textures}→${second.textures}, objetos ${first.scene.objects}→${second.scene.objects}`);
    }

    await bot.screenshot(`${outDir}/perf-last.png`);
    const bad = await bot.scanAll();
    R.check('estado final sin NaN/Infinity', bad.length === 0, bad.join(', ') || 'ok');
  } finally {
    await browser.close().catch(() => {});
    await srv.stop();
  }
  if (problems) R.check('cero pageerror / console.error / requestfailed', !hasProblems(problems), hasProblems(problems) ? `\n${formatProblems(problems)}` : 'limpio');
  return R.summary();
}

runMain(main, { name: 'perf', maxMs: 15 * 60_000 });
