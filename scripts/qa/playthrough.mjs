#!/usr/bin/env node
// QA · PLAYTHROUGH — bot determinista sobre window.__qa que juega las reglas del contrato.
//
// Uso:  node scripts/qa/playthrough.mjs [--dev] [--port=5208] [--rebuild] [--only=A,B2,E]
//                                        [--strict] [--seeds=3] [--loot-n=40] [--seed=1234]
//   --force    ejecuta también los escenarios que requieren módulos stub (esperar FAIL; sirve para depurar el bot)
//   --strict   los SKIP («módulo real no presente (stub)») cuentan como fallo (usar con el juego integrado)
//
// Escenarios (cada uno en página nueva, con su cuenta de aserciones):
//   A  victoria completa por reglas (relé + decaimiento, Warden, extracción)   A2 relé exacto 55 s
//   B  derrotas (muerte, sellado, helicóptero se va, llamar antes del sellado y sobrevivir a las 12:00)
//   C  reglas de tiempo (avisos, contaminación: radio y daño)
//   D  economía (teclas 1-6, fondos/tope/poseída, abrir/cerrar tienda)
//   E  reinicio (estado reseteado, sin residuos ni fugas de listeners)
//   F  botín por zona (estadístico con semillas)
// Los escenarios que dependen de módulos aún stub degradan a SKIP con un mensaje claro.
import { loadConfig, moduleStatus, launchBrowser, serveGame, ensureOutDir, formatProblems, hasProblems, parseArgs, numArg, Report, runMain, DEFAULT_PORT } from './lib.mjs';
import { openGame } from './game.mjs';

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const fx = (v, d = 2) => (typeof v === 'number' ? v.toFixed(d) : String(v));

// ── Acciones en la página (autocontenidas) ───────────────────────────────────
const pageFns = {
  wardenId: (ctx) => ctx.enemies.list.find((e) => e.type === 'warden' && e.alive)?.id ?? null,
  hit: (ctx, _q, a) => {
    const h = ctx.enemies.list.find((e) => e.id === a.id);
    if (!h) return null;
    const before = h.hp;
    ctx.enemies.applyDamage(h, { amount: a.amount, zone: a.zone, point: { x: h.position.x, y: 1.6, z: h.position.z }, normal: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: -1 } });
    return { before, hp: h.hp, maxHp: h.maxHp, alive: h.alive };
  },
  heliPos: (ctx) => (ctx.missions.helicopter ? { ...ctx.missions.helicopter.position } : null),
  setElapsed: (_c, q, v) => q.setElapsed(v),
  setState: (ctx, _q, patch) => {
    for (const [path, v] of Object.entries(patch)) {
      const keys = path.split('.');
      let o = ctx.state;
      for (const k of keys.slice(0, -1)) o = o[k];
      o[keys[keys.length - 1]] = v;
    }
  },
  interactionId: (ctx) => ctx.interactions.current?.id ?? null,
  aliveCount: (ctx) => ctx.enemies.aliveCount,
  killAndPay: (ctx, q, a) => {
    // Genera `n` infectados de `type` alrededor de (x,z) y los mata; devuelve sus muertes.
    let spawned = 0;
    const ids = [];
    for (let i = 0; i < a.n; i++) {
      const ang = (i / a.n) * Math.PI * 2;
      const id = q.spawnEnemy(a.type, a.x + Math.cos(ang) * a.r, a.z + Math.sin(ang) * a.r);
      if (id !== null) {
        spawned++;
        ids.push(id);
      }
    }
    for (const id of ids) {
      const h = ctx.enemies.list.find((e) => e.id === id);
      if (h) ctx.enemies.applyDamage(h, { amount: 99999, zone: 'head', point: { x: h.position.x, y: 1.6, z: h.position.z }, normal: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: -1 } });
    }
    return spawned;
  },
};

function cnt(evts, type) {
  return evts.filter((e) => e.type === type).length;
}

async function main() {
  const args = parseArgs();
  const port = numArg(args, 'port', DEFAULT_PORT);
  const cfg = await loadConfig();
  const { MAP, TIMERS, MISSIONS, CONTAMINATION, PLAYER, SHOP, ECONOMY, THREAT_SCALE, ENEMIES, WARDEN, WEAPONS } = cfg;
  const mods = moduleStatus();
  const outDir = ensureOutDir('playthrough');
  const strict = !!args.strict;
  const only = args.only ? new Set(String(args.only).toUpperCase().split(',')) : null;
  const R = new Report(`PLAYTHROUGH (${args.dev ? 'dev' : 'producción'})`);
  R.info(`módulos reales: ${mods.reals.join(', ') || '(ninguno)'} · stubs: ${mods.stubs.join(', ') || '(ninguno)'}`);

  const srv = await serveGame({ dev: !!args.dev, port, force: !!args.rebuild, pnpmBuild: !!args['pnpm-build'], log: (m) => R.info(m) });
  const browser = await launchBrowser();
  const summary = [];

  /** ¿Están los módulos reales? Si no, SKIP claro (o FAIL con --strict). */
  const needs = (id, list) => {
    const missing = args.force ? [] : list.filter((m) => mods[m] === 'stub');
    if (!missing.length) return true;
    R.skip(`${id}: escenario`, `módulo real no presente (stub): ${missing.join(', ')}`);
    return false;
  };

  async function scenario(id, title, requires, fn, opts = {}) {
    if (only && !only.has(id.toUpperCase())) return;
    R.section(`${id} · ${title}`);
    const before = { ...R.counts };
    let g = null;
    if (needs(id, requires)) {
      try {
        g = await openGame(browser, srv.url, { seed: opts.seed ?? numArg(args, 'seed', 1234) });
        await fn(g.bot, g);
        R.check(`${id}: sin pageerror / console.error / requestfailed`, !hasProblems(g.problems), hasProblems(g.problems) ? `\n${formatProblems(g.problems)}` : 'limpio');
        const bad = await g.bot.scanAll();
        R.check(`${id}: estado final sin NaN/Infinity`, bad.length === 0, bad.join(', ') || 'ok');
      } catch (err) {
        R.check(`${id}: el bot completa el escenario`, false, err instanceof Error ? err.message : String(err));
        if (g) await g.bot.screenshot(`${outDir}/${id}-error.png`).catch(() => {});
      } finally {
        await g?.context.close().catch(() => {});
      }
    }
    const d = (k) => R.counts[k] - before[k];
    summary.push({ id, title, pass: d('pass'), fail: d('fail'), warn: d('warn'), skip: d('skip') });
  }

  /** Empieza partida y deja al jugador en modo dios (los escenarios de reglas no quieren morir). */
  const begin = async (bot, god = true) => {
    await bot.start();
    if (god) await bot.god(true);
  };
  /** Pulsación de E con retención; devuelve cuando `pred` es cierta o vence. */
  const holdE = (bot, maxS, pred) => bot.holdUntil('interact', maxS, pred, 0.1);
  const money = async (bot) => (await bot.snap()).player.money;

  // ══ A · victoria completa ═══════════════════════════════════════════════
  await scenario('A', 'victoria completa por las reglas', ['player', 'missions', 'enemies'], async (bot) => {
    await begin(bot);
    const m0 = await money(bot);
    R.check('dinero inicial = PLAYER.start.money', m0 === PLAYER.start.money, `${m0}`);

    // Extracción bloqueada sin relé.
    await bot.teleport(MAP.lz.radio.x, MAP.lz.radio.z);
    await holdE(bot, MISSIONS.extraction.callHoldS + 1.5, 's.missions.extraction.phase !== "idle"');
    let s = await bot.snap();
    R.check('sin relé restaurado NO se puede llamar a la extracción', s.missions.extraction.phase === 'idle', `phase=${s.missions.extraction.phase} status=${s.missions.extraction.status}`);

    // Relé: activar (mantener E ≥ activateHoldS).
    await bot.teleport(MAP.relay.x, MAP.relay.z, 0, 0.3);
    R.check('hay un interactuable en el transmisor', (await bot.run(pageFns.interactionId)) !== null, `id=${await bot.run(pageFns.interactionId)}`);
    await bot.input('interact', true);
    await bot.step(MISSIONS.relay.activateHoldS - 1);
    s = await bot.snap();
    R.check(`relé NO activo antes de ${MISSIONS.relay.activateHoldS} s de retención`, !s.missions.relay.activated);
    await bot.step(1.6);
    s = await bot.snap();
    R.check(`relé activado tras mantener E ≥ ${MISSIONS.relay.activateHoldS} s`, s.missions.relay.activated, `status=${s.missions.relay.status}`);
    await bot.input('interact', false);
    await bot.step(0.1);
    R.check("evento 'relay:activated' una vez", (await bot.count('relay:activated')) === 1);
    R.check("evento 'horde:started' (relay) una vez", cnt(await bot.events('horde:started'), 'horde:started') === 1);

    // Progreso dentro, decaimiento fuera.
    await bot.step(10);
    s = await bot.snap();
    const p10 = s.missions.relay.progress;
    R.check('progreso ≈ 10 s tras 10 s dentro del círculo', near(p10, 10, 2), `progress=${fx(p10)} inside=${s.missions.relay.insideCircle}`);
    await bot.teleport(MAP.relay.x + MAP.relay.circleRadius + 25, MAP.relay.z, 0, 0.1);
    await bot.step(6);
    s = await bot.snap();
    const expected = p10 - MISSIONS.relay.decayPerS * 6;
    R.check('fuera del círculo el progreso decae', s.missions.relay.progress < p10 && !s.missions.relay.insideCircle, `${fx(p10)} → ${fx(s.missions.relay.progress)}`);
    R.soft(`decaimiento ≈ decayPerS (${MISSIONS.relay.decayPerS}/s)`, near(s.missions.relay.progress, expected, 1.5), `esperado ≈ ${fx(expected)}`);
    // Vuelve y completa.
    await bot.teleport(MAP.relay.x, MAP.relay.z, 0, 0.1);
    const mBefore = await money(bot);
    const r = await bot.stepUntil(MISSIONS.relay.requiredS + 15, 's.missions.relay.status === "completed"', 0.5);
    R.check('relé completado tras acumular requiredS dentro del círculo', r.ok, `${fx(r.simS, 1)} s simulados`);
    s = await bot.snap();
    R.check('relé pagado una vez (+MISSIONS.relay.reward)', s.missions.relay.paid && s.player.money - mBefore >= MISSIONS.relay.reward, `Δdinero=${s.player.money - mBefore}`);
    const done = (await bot.events('mission:completed')).filter((e) => e.p.id === 'relay');
    R.check("'mission:completed' relay una vez con la recompensa exacta", done.length === 1 && done[0].p.reward === MISSIONS.relay.reward, JSON.stringify(done.map((e) => e.p)));
    R.check('la extracción queda disponible', s.missions.extraction.status !== 'locked', `status=${s.missions.extraction.status}`);

    // Warden.
    let id = await bot.run(pageFns.wardenId);
    if (id === null) {
      for (const [x, z] of [[MAP.complex.gate.x, MAP.complex.gate.z + 5], [MAP.complex.wardenSpawn.x, MAP.complex.wardenSpawn.z + 25]]) {
        await bot.teleport(x, z, 0, 0.1);
        await bot.step(2);
        id = await bot.run(pageFns.wardenId);
        if (id !== null) break;
      }
    }
    R.check('el Warden existe en ctx.enemies.list', id !== null, `id=${id}`);
    if (id !== null) {
      const first = await bot.run(pageFns.hit, { id, zone: 'head', amount: 60 });
      let last = first;
      let broke = false;
      let hpConst = first.hp === first.before;
      for (let i = 0; i < 30 && !broke; i++) {
        broke = (await bot.count('warden:helmetBroken')) > 0;
        if (broke) break;
        last = await bot.run(pageFns.hit, { id, zone: 'head', amount: 60 });
        if (!(await bot.count('warden:helmetBroken'))) hpConst &&= last.hp === last.before;
      }
      broke = (await bot.count('warden:helmetBroken')) > 0;
      R.check("impactos en la cabeza rompen el casco ('warden:helmetBroken' una vez)", broke && (await bot.count('warden:helmetBroken')) === 1);
      R.check('con casco, la cabeza no daña la vida del cuerpo', hpConst, 'hp constante mientras el casco resiste');
      s = await bot.snap();
      R.check('state.missions.warden.helmetBroken = true', s.missions.warden.helmetBroken);
      const body = await bot.run(pageFns.hit, { id, zone: 'body', amount: 100 });
      const limb = await bot.run(pageFns.hit, { id, zone: 'limb', amount: 100 });
      const head = await bot.run(pageFns.hit, { id, zone: 'head', amount: 100 });
      R.soft(`cuerpo ×${WARDEN.bodyMult}`, near(body.before - body.hp, 100 * WARDEN.bodyMult, 1.5), `Δ=${fx(body.before - body.hp)}`);
      R.soft(`extremidades ×${WARDEN.limbMult}`, near(limb.before - limb.hp, 100 * WARDEN.limbMult, 1.5), `Δ=${fx(limb.before - limb.hp)}`);
      R.soft(`cabeza sin casco ×${WARDEN.headMultAfterHelmet}`, near(head.before - head.hp, 100 * WARDEN.headMultAfterHelmet, 3), `Δ=${fx(head.before - head.hp)}`);
      const mW = await money(bot);
      let dead = false;
      for (let i = 0; i < 40 && !dead; i++) dead = !(await bot.run(pageFns.hit, { id, zone: 'head', amount: 400 }))?.alive;
      await bot.step(0.5);
      s = await bot.snap();
      R.check('Warden muerto → misión completada y pagada', dead && s.missions.warden.killed && s.missions.warden.status === 'completed' && s.missions.warden.paid, `killed=${s.missions.warden.killed} status=${s.missions.warden.status}`);
      await bot.step(5);
      const wDone = (await bot.events('mission:completed')).filter((e) => e.p.id === 'warden');
      R.check("contrato del Warden pagado UNA vez con MISSIONS.warden.reward", wDone.length === 1 && wDone[0].p.reward === MISSIONS.warden.reward && (await money(bot)) - mW >= MISSIONS.warden.reward, `eventos=${wDone.length} Δdinero=${(await money(bot)) - mW}`);
    }

    // Extracción.
    await bot.teleport(MAP.lz.radio.x, MAP.lz.radio.z, 0, 0.3);
    await bot.input('interact', true);
    await bot.step(MISSIONS.extraction.callHoldS - 1);
    R.check('la llamada no se completa antes de callHoldS', (await bot.snap()).missions.extraction.phase === 'idle');
    await bot.step(1.6);
    s = await bot.snap();
    await bot.input('interact', false);
    await bot.step(0.1);
    R.check("extracción llamada (phase 'inbound')", s.missions.extraction.phase === 'inbound', `phase=${s.missions.extraction.phase}`);
    R.check('ETA ≈ MISSIONS.extraction.etaS', near(s.missions.extraction.etaRemaining, MISSIONS.extraction.etaS, 3), `eta=${fx(s.missions.extraction.etaRemaining)}`);
    R.check("'extraction:called' y 'horde:started' (extraction)", (await bot.count('extraction:called')) === 1 && (await bot.events('horde:started')).some((e) => e.p.id === 'extraction'));
    const rl = await bot.stepUntil(MISSIONS.extraction.etaS + 8, 's.missions.extraction.phase === "landed"', 0.5);
    R.check("tras etaS el helicóptero aterriza (phase 'landed')", rl.ok, `${fx(rl.simS, 1)} s`);
    R.check("'extraction:landed' una vez", (await bot.count('extraction:landed')) === 1);
    const hp = (await bot.run(pageFns.heliPos)) ?? { x: MAP.lz.center.x, z: MAP.lz.center.z };
    await bot.teleport(hp.x + 5, hp.z, 0, 0.3);
    const rb = await holdE(bot, MISSIONS.extraction.boardHoldS + MISSIONS.extraction.departDurationS + 4, 's.match.phase === "won"');
    s = await bot.snap();
    R.check("abordar con hold → victoria 'extracted'", rb.ok && s.match.phase === 'won' && s.match.endReason === 'extracted', `phase=${s.match.phase} reason=${s.match.endReason} (${fx(rb.simS, 1)} s)`);
    await bot.step(TIMERS.endScreenDelayS + 1);
    s = await bot.snap();
    const ended = await bot.events('flow:ended');
    R.check("flow 'ended' con 'flow:ended' won/extracted una vez", s.flow === 'ended' && ended.length === 1 && ended[0].p.result === 'won' && ended[0].p.reason === 'extracted', JSON.stringify(ended.map((e) => e.p)));
    const rewards = MISSIONS.relay.reward + MISSIONS.warden.reward + MISSIONS.extraction.reward;
    R.check('recompensas totales pagadas (relé + Warden + extracción)', s.match.moneyEarned >= rewards, `moneyEarned=${s.match.moneyEarned} ≥ ${rewards}`);
    R.soft(`dinero final = ${PLAYER.start.money + rewards} (sin botín extra)`, s.player.money === PLAYER.start.money + rewards, `dinero=${s.player.money}`);
    R.check('dinero = inicial + ganado − gastado', s.player.money === PLAYER.start.money + s.match.moneyEarned - s.match.moneySpent, `${s.player.money} vs ${PLAYER.start.money + s.match.moneyEarned - s.match.moneySpent}`);
    await bot.screenshot(`${outDir}/A-victoria.png`);
  });

  await scenario('A2', 'relé: 55 s exactos dentro del círculo', ['player', 'missions'], async (bot) => {
    await begin(bot);
    await bot.teleport(MAP.relay.x, MAP.relay.z, 0, 0.3);
    await holdE(bot, MISSIONS.relay.activateHoldS + 2, 's.missions.relay.activated');
    const t = await bot.stepUntil(MISSIONS.relay.requiredS + 10, 's.missions.relay.status === "completed"', 0.25);
    R.check(`completa a los ≈${MISSIONS.relay.requiredS} s de permanencia (±3)`, t.ok && near(t.simS, MISSIONS.relay.requiredS, 3), `${fx(t.simS, 1)} s`);
  });

  // ══ B · derrotas ═════════════════════════════════════════════════════════
  await scenario('B1', 'derrota: morir', ['player', 'missions'], async (bot) => {
    await begin(bot, false);
    await bot.run((ctx) => ctx.player.damage(999, 'melee', null));
    let s = await bot.snap();
    R.check('player.damage(999) → alive=false, hp=0', !s.player.alive && s.player.hp === 0, `alive=${s.player.alive} hp=${s.player.hp}`);
    await bot.run((ctx) => ctx.player.damage(50, 'melee', null));
    R.check("'player:died' se emite una sola vez", (await bot.count('player:died')) === 1);
    await bot.step(TIMERS.endScreenDelayS + 1);
    s = await bot.snap();
    const ev = await bot.events('flow:ended');
    R.check("derrota 'dead': phase lost, flow ended", s.match.phase === 'lost' && s.match.endReason === 'dead' && s.flow === 'ended', `phase=${s.match.phase} reason=${s.match.endReason} flow=${s.flow}`);
    R.check("'flow:ended' lost/dead una vez", ev.length === 1 && ev[0].p.result === 'lost' && ev[0].p.reason === 'dead');
  });

  await scenario('B2', 'derrota: distrito sellado (sin llamar la extracción)', ['player', 'missions'], async (bot) => {
    await begin(bot);
    await bot.run(pageFns.setElapsed, TIMERS.sealS - 62);
    await bot.step(59);
    R.check('aún no sellado 3 s antes de los avisos finales', !(await bot.snap()).match.sealed);
    await bot.step(8);
    const s = await bot.snap();
    const warns = (await bot.events('match:warning')).filter((e) => e.p.kind === 'seal').map((e) => e.p.secondsLeft);
    R.check("avisos de sellado 60/30/10 una sola vez cada uno", TIMERS.warnings.every((w) => warns.filter((x) => x === w).length === 1), `avisos=${JSON.stringify(warns)}`);
    R.check("derrota 'sealed' en TIMERS.sealS", s.match.phase === 'lost' && s.match.endReason === 'sealed' && (await bot.count('match:sealed')) === 1, `phase=${s.match.phase} reason=${s.match.endReason} t=${fx(s.match.elapsed, 1)}`);
    const ev = await bot.events('flow:ended');
    R.check("'flow:ended' lost/sealed una vez", ev.length === 1 && ev[0].p.reason === 'sealed');
  });

  await scenario('B3', 'derrota: el helicóptero se va sin ti', ['player', 'missions'], async (bot) => {
    await begin(bot);
    await bot.run((ctx) => ctx.missions.debugComplete('relay'));
    await bot.teleport(MAP.lz.radio.x, MAP.lz.radio.z, 0, 0.3);
    const c = await holdE(bot, MISSIONS.extraction.callHoldS + 3, 's.missions.extraction.phase === "inbound"');
    R.check('extracción llamada (debugComplete del relé la habilita)', c.ok);
    const l = await bot.stepUntil(MISSIONS.extraction.etaS + 8, 's.missions.extraction.phase === "landed"', 0.5);
    R.check('helicóptero aterriza', l.ok);
    await bot.teleport(MAP.spawn.x, MAP.spawn.z, 0, 0.1);
    const e = await bot.stepUntil(MISSIONS.extraction.boardWindowS + MISSIONS.extraction.departDurationS + 5, 's.match.phase === "lost"', 0.5);
    const s = await bot.snap();
    R.check("derrota 'heli_left' al vencer la ventana", e.ok && s.match.endReason === 'heli_left', `phase=${s.match.phase} reason=${s.match.endReason} (${fx(e.simS, 1)} s)`);
    R.check("'extraction:departed' boarded=false", (await bot.events('extraction:departed')).some((x) => x.p.boarded === false));
  });

  await scenario('B4', 'llamar a la extracción ANTES del sellado y sobrevivir a las 12:00', ['player', 'missions'], async (bot) => {
    await begin(bot);
    await bot.run((ctx) => ctx.missions.debugComplete('relay'));
    await bot.run(pageFns.setElapsed, TIMERS.sealS - 30);
    await bot.teleport(MAP.lz.radio.x, MAP.lz.radio.z, 0, 0.3);
    await holdE(bot, MISSIONS.extraction.callHoldS + 3, 's.missions.extraction.phase === "inbound"');
    let s = await bot.snap();
    R.check('llamada hecha antes de las 12:00', s.missions.extraction.phase === 'inbound' && s.match.elapsed < TIMERS.sealS, `t=${fx(s.match.elapsed, 1)}`);
    await bot.stepUntil(TIMERS.sealS - s.match.elapsed + 5, 's.match.elapsed > ' + (TIMERS.sealS + 4), 0.5);
    s = await bot.snap();
    R.check('tras las 12:00 la partida NO se pierde por sellado', s.match.phase === 'playing', `phase=${s.match.phase} reason=${s.match.endReason} t=${fx(s.match.elapsed, 1)}`);
    const l = await bot.stepUntil(MISSIONS.extraction.etaS, 's.missions.extraction.phase === "landed"', 0.5);
    R.check('el helicóptero aterriza pasadas las 12:00', l.ok);
    const hp = (await bot.run(pageFns.heliPos)) ?? { x: MAP.lz.center.x, z: MAP.lz.center.z };
    await bot.teleport(hp.x + 5, hp.z, 0, 0.3);
    const b = await holdE(bot, MISSIONS.extraction.boardHoldS + MISSIONS.extraction.departDurationS + 4, 's.match.phase === "won"');
    R.check('se puede abordar y ganar tras el sellado', b.ok && (await bot.snap()).match.endReason === 'extracted');
  });

  // ══ C · reglas de tiempo ═════════════════════════════════════════════════
  await scenario('C', 'contaminación: avisos, radio y daño', ['player', 'missions'], async (bot) => {
    await begin(bot, false);
    await bot.run(pageFns.setState, { 'player.hp': PLAYER.maxHp, 'player.armor': PLAYER.maxArmor });
    // Se protege de otros daños: sin enemigos ni dios (dios anularía el daño de contaminación).
    await bot.run((ctx) => ctx.enemies.killAll());
    const t0 = TIMERS.contaminationStartS;
    await bot.teleport(MAP.spawn.x, MAP.spawn.z, 0, 0.1);
    await bot.run(pageFns.setElapsed, t0 - 62);
    await bot.step(50);
    let s = await bot.snap();
    R.check('contaminación inactiva antes de las 7:30', !s.match.contamination.active, `t=${fx(s.match.elapsed, 1)}`);
    await bot.step(15);
    s = await bot.snap();
    const warns = (await bot.events('match:warning')).filter((e) => e.p.kind === 'contamination');
    R.check('avisos 60/30/10 de contaminación, una sola vez cada uno', TIMERS.warnings.every((w) => warns.filter((x) => x.p.secondsLeft === w).length === 1) && warns.length === TIMERS.warnings.length, JSON.stringify(warns.map((e) => `${e.p.secondsLeft}@${fx(e.t, 1)}`)));
    R.soft('cada aviso llega en su momento (±1.5 s)', warns.every((e) => near(t0 - e.t, e.p.secondsLeft, 1.5)));
    R.check("'match:contaminationStarted' una vez y contamination.active", (await bot.count('match:contaminationStarted')) === 1 && s.match.contamination.active, `radius=${fx(s.match.contamination.radius)}`);
    R.check('radio inicial ≈ CONTAMINATION.startRadius', near(s.match.contamination.radius, CONTAMINATION.startRadius, 15), `${fx(s.match.contamination.radius)} m`);
    // Radio creciente.
    const radii = [s.match.contamination.radius];
    for (let i = 0; i < 4; i++) {
      await bot.step(30);
      radii.push((await bot.snap()).match.contamination.radius);
    }
    R.check('el radio crece de forma monótona', radii.every((r, i) => i === 0 || r >= radii[i - 1]) && radii[4] > radii[0], radii.map((r) => fx(r, 1)).join(' → '));
    // Daño dentro / fuera.
    const c = CONTAMINATION.center;
    const radius = (await bot.snap()).match.contamination.radius;
    await bot.clearLog();
    await bot.teleport(c.x, c.z + 2, 0, 0.1);
    await bot.run((ctx) => ctx.enemies.killAll());
    await bot.step(3);
    let dmg = (await bot.events('player:damaged')).filter((e) => e.p.source === 'contamination');
    R.check('dentro del radio hay daño de contaminación', dmg.length > 0, `${dmg.length} impactos, total=${fx(dmg.reduce((a, e) => a + e.p.amount, 0))}`);
    R.check('el blindaje NO protege (armorDamage = 0)', dmg.length > 0 && dmg.every((e) => e.p.armorDamage === 0 && near(e.p.hpDamage, e.p.amount, 0.01)));
    const perS = dmg.reduce((a, e) => a + e.p.amount, 0) / 3;
    const depth = radius - 2;
    const expectedDps = Math.min(CONTAMINATION.dpsMax, CONTAMINATION.dpsEdge + CONTAMINATION.dpsPerMeterDeep * depth);
    R.soft(`dps ≈ ${fx(expectedDps, 1)} (borde + profundidad, tope dpsMax)`, perS > expectedDps * 0.5 && perS < expectedDps * 1.6, `medido ≈ ${fx(perS, 1)}`);
    await bot.clearLog();
    await bot.teleport(c.x, c.z + radius + 40, 0, 0.1);
    await bot.step(3);
    dmg = (await bot.events('player:damaged')).filter((e) => e.p.source === 'contamination');
    R.check('fuera del radio NO hay daño de contaminación', dmg.length === 0, `${dmg.length} impactos`);
  });

  // ══ D · economía ═════════════════════════════════════════════════════════
  await scenario('D', 'economía y tiendas', ['player', 'missions', 'ui'], async (bot) => {
    await begin(bot);
    const cage = MAP.cages[0];
    const open = async () => {
      await bot.tap('interact');
      let s = await bot.snap();
      if (s.ui.modal !== 'shop') {
        await bot.input('interact', true);
        await bot.step(1.2);
        await bot.input('interact', false);
        await bot.step(0.1);
        s = await bot.snap();
      }
      return s;
    };
    await bot.teleport(cage.x, cage.z, 0, 0.3);
    let s = await open();
    R.check("E abre la tienda de la jaula (ui.modal='shop', vendor='cage')", s.ui.modal === 'shop' && s.ui.vendor === 'cage', `modal=${s.ui.modal} vendor=${s.ui.vendor}`);
    R.check("'shop:opened' cage", (await bot.events('shop:opened')).some((e) => e.p.vendor === 'cage'));
    await bot.tap('interact');
    s = await bot.snap();
    R.check('E vuelve a cerrar la tienda', s.ui.modal === null && (await bot.count('shop:closed')) >= 1, `modal=${s.ui.modal}`);
    // Cierre por distancia.
    await open();
    await bot.teleport(cage.x + ECONOMY.shopRange - 1, cage.z, 0, 0.5);
    R.check('a distancia < shopRange sigue abierta', (await bot.snap()).ui.modal === 'shop');
    await bot.teleport(cage.x + ECONOMY.shopRange + 3, cage.z, 0, 0.5);
    R.check('a distancia > shopRange se cierra sola', (await bot.snap()).ui.modal === null);
    // Sin tienda abierta, los dígitos 3-6 no compran.
    await bot.teleport(cage.x, cage.z, 0, 0.2);
    await bot.run(pageFns.setState, { 'player.money': 5000 });
    await bot.digit(4);
    await bot.step(0.1);
    R.check('con la tienda cerrada la tecla 4 no compra', (await money(bot)) === 5000);
    await open();
    const buy = async (n) => {
      const before = await bot.snap();
      const mark = await bot.mark();
      await bot.digit(n);
      await bot.step(0.1);
      const after = await bot.snap();
      const evs = await bot.events(undefined, mark);
      return { before, after, purchase: evs.find((e) => e.type === 'shop:purchase')?.p, denied: evs.find((e) => e.type === 'shop:denied')?.p };
    };
    const it = SHOP.cage.items;
    // Fondos insuficientes.
    await bot.run(pageFns.setState, { 'player.money': 100 });
    let r = await buy(4);
    R.check("plaza sin fondos → 'shop:denied' funds, dinero intacto", r.denied?.reason === 'funds' && r.after.player.money === 100, JSON.stringify(r.denied));
    // Compra correcta (granada).
    await bot.run(pageFns.setState, { 'player.money': 1000 });
    r = await buy(3);
    R.check('comprar granada: −precio, +1 granada, evento y moneySpent', r.purchase?.itemId === it[2].id && r.after.player.money === 1000 - it[2].price && r.after.player.grenades === r.before.player.grenades + 1 && r.after.match.moneySpent === r.before.match.moneySpent + it[2].price, JSON.stringify(r.purchase));
    // Tope de capacidad.
    await bot.run(pageFns.setState, { 'player.grenades': PLAYER.cap.grenades });
    r = await buy(3);
    R.check("granadas al tope → 'full' sin cobrar", r.denied?.reason === 'full' && r.after.player.money === r.before.player.money, JSON.stringify(r.denied));
    await bot.run(pageFns.setState, { 'player.plates': PLAYER.cap.plates });
    r = await buy(4);
    R.check("placas al tope → 'full' sin cobrar", r.denied?.reason === 'full' && r.after.player.money === r.before.player.money, JSON.stringify(r.denied));
    // Munición.
    await bot.run(pageFns.setState, { 'player.money': 1000 });
    r = await buy(1);
    const w0 = WEAPONS[r.after.player.slots[0].id];
    R.check('munición principal: reserva al máximo, −precio', r.after.player.slots[0].reserve === w0.reserveMax && r.after.player.money === 1000 - it[0].price, `reserva=${r.after.player.slots[0].reserve}/${w0.reserveMax}`);
    r = await buy(1);
    R.soft("munición con reserva llena → 'full'", r.denied?.reason === 'full', JSON.stringify(r.denied));
    await bot.run(pageFns.setState, { 'player.hp': 30, 'player.money': 1000 });
    r = await buy(5);
    R.check('botiquín cura 60 de vida', r.after.player.hp === 90 && r.after.player.money === 1000 - it[4].price, `hp=${r.after.player.hp}`);
    await bot.run(pageFns.setState, { 'player.armor': 0, 'player.money': 1000 });
    r = await buy(6);
    R.check('kit de blindaje: armor al máximo', r.after.player.armor === PLAYER.maxArmor && r.after.player.money === 1000 - it[5].price, `armor=${r.after.player.armor}`);
    R.soft("kit de blindaje con armor lleno → 'full'", (await buy(6)).denied?.reason === 'full');
    // Armería.
    await bot.tap('interact');
    await bot.teleport(MAP.armory.x, MAP.armory.z, 0, 0.3);
    s = await open();
    R.check("E abre el banco de armería (vendor='bench')", s.ui.modal === 'shop' && s.ui.vendor === 'bench', `modal=${s.ui.modal} vendor=${s.ui.vendor}`);
    const bench = SHOP.bench.items;
    await bot.run(pageFns.setState, { 'player.money': 100 });
    r = await buy(1);
    R.check("arma sin fondos → 'funds'", r.denied?.reason === 'funds' && r.after.player.money === 100, JSON.stringify(r.denied));
    await bot.run(pageFns.setState, { 'player.money': 20000 });
    const mark = await bot.mark();
    r = await buy(1);
    R.check('comprar AR-12: ranura 0 = assault con cargador lleno, −precio', r.after.player.slots[0].id === bench[0].weapon && r.after.player.slots[0].mag === WEAPONS[bench[0].weapon].magSize && r.after.player.money === 20000 - bench[0].price, `slot0=${r.after.player.slots[0].id} mag=${r.after.player.slots[0].mag}`);
    R.check("'loadout:changed' emitido", (await bot.events('loadout:changed', mark)).length >= 1);
    R.soft(`reserva inicial = ${ECONOMY.newWeaponReserveMags} cargadores`, r.after.player.slots[0].reserve === Math.min(WEAPONS[bench[0].weapon].reserveMax, WEAPONS[bench[0].weapon].magSize * ECONOMY.newWeaponReserveMags), `reserva=${r.after.player.slots[0].reserve}`);
    r = await buy(1);
    R.check("arma ya poseída → 'owned' sin cobrar", r.denied?.reason === 'owned' && r.after.player.money === r.before.player.money, JSON.stringify(r.denied));
    r = await buy(5);
    R.check('comprar revólver: ranura 1 = revolver', r.after.player.slots[1].id === bench[4].weapon, `slot1=${r.after.player.slots[1].id}`);
    r = await buy(6);
    R.check('mochila táctica: hasPack = true', r.after.player.hasPack && r.after.player.money === r.before.player.money - bench[5].price);
    r = await buy(6);
    R.check("segunda mochila → 'owned'", r.denied?.reason === 'owned', JSON.stringify(r.denied));
  });

  // ══ E · reinicio ═════════════════════════════════════════════════════════
  await scenario('E', 'reinicio de partida', [], async (bot) => {
    const identity = await bot.run((ctx) => {
      window.__stateRef = ctx.state;
      return true;
    });
    R.check('preparado', identity);
    await bot.start();
    const first = await bot.snap();
    const l1 = await bot.busListeners();
    // Sincronía tras la PRIMERA partida (sub-objetos de state reemplazados por resetRunState).
    await bot.teleport(10, 20, 0, 0.1);
    const st = await bot.snap();
    R.check('el jugador escribe en el state.player vigente tras la 1.ª partida', near(st.player.pos.x, 10, 0.5) && near(st.player.pos.z, 20, 0.5), `pos=(${fx(st.player.pos.x)}, ${fx(st.player.pos.z)}) — si no, un módulo por partida cachea un sub-objeto de ctx.state anterior a resetRunState`);
    // Ensucia la partida.
    await bot.run(pageFns.setState, { 'player.money': 9999, 'player.hp': 5, 'match.kills': 7 });
    await bot.run((ctx, q) => {
      q.giveMoney(500);
      q.setElapsed(400);
      q.complete('relay');
      for (let i = 0; i < 5; i++) q.spawnEnemy('walker', ctx.state.player.pos.x + 20 + i, ctx.state.player.pos.z);
    });
    await bot.step(5);
    await bot.restart();
    const second = await bot.snap();
    const same = await bot.run((ctx) => ctx.state === window.__stateRef);
    R.check('ctx.state conserva su identidad tras reiniciar', same);
    R.check('estado tras reiniciar == estado de la primera partida (t=0)', JSON.stringify(second) === JSON.stringify({ ...first, player: { ...first.player, pos: second.player.pos, yaw: second.player.yaw, zone: second.player.zone } }) || second.match.elapsed < 0.2, `elapsed=${fx(second.match.elapsed)} money=${second.player.money} hp=${second.player.hp}`);
    R.check('dinero, vida y contadores reseteados', second.player.money === PLAYER.start.money && second.player.hp === PLAYER.maxHp && second.match.kills === 0 && second.match.moneyEarned === 0);
    R.check('misiones y contaminación reseteadas', second.missions.relay.status === 'available' && !second.missions.relay.activated && !second.missions.relay.paid && !second.match.contamination.active && Object.keys(second.match.warned).length === 0);
    R.check('reloj reiniciado (< 1 s)', second.match.elapsed < 1, `elapsed=${fx(second.match.elapsed)}`);
    R.check('jugador de nuevo en el spawn', Math.hypot(second.player.pos.x - MAP.spawn.x, second.player.pos.z - MAP.spawn.z) < 1.5);
    if (mods.enemies === 'real') {
      const alive = await bot.run(pageFns.aliveCount);
      R.check('sin enemigos residuales tras reiniciar (≤ población inicial de la 1.ª partida)', alive <= Math.max(first.enemiesAtStart ?? 0, 12), `vivos=${alive}`);
    }
    const l2 = await bot.busListeners();
    if (l1 && l2) R.check('listeners del bus estables tras reiniciar', l1.total === l2.total, `${l1.total} → ${l2.total}`);
    // Reinicio tras el final (muerte) y vía título.
    if (mods.missions === 'real') {
      await bot.run((ctx) => ctx.player.damage(999, 'melee', null));
      await bot.step(TIMERS.endScreenDelayS + 1);
      R.check('partida terminada por muerte antes de reiniciar', (await bot.snap()).flow === 'ended');
      await bot.restart();
      const third = await bot.snap();
      R.check('reinicio desde la pantalla final: jugando y vivo', third.flow === 'playing' && third.player.alive && third.match.phase === 'playing' && third.match.endReason === null, `flow=${third.flow}`);
    } else R.skip('reinicio tras muerte', 'módulo real no presente (stub): missions');
    await bot.toTitle();
    R.check("ui:titleRequested → flow 'title'", (await bot.snap()).flow === 'title');
    await bot.start();
    const fourth = await bot.snap();
    R.check('start tras el título: partida limpia', fourth.flow === 'playing' && fourth.player.money === PLAYER.start.money && fourth.match.elapsed < 1);
    const l3 = await bot.busListeners();
    if (l1 && l3) R.check('listeners del bus estables tras varias partidas', l1.total === l3.total, `${l1.total} → ${l3.total}`);
  });

  // ══ F · botín por zona ═══════════════════════════════════════════════════
  await scenario('F', 'botín: más amenaza, más dinero (estadístico)', ['player', 'enemies', 'missions'], async (bot) => {
    const n = numArg(args, 'loot-n', 40);
    const spots = [[0, 120], [0, 30], [0, -60], [0, -140]];
    const seeds = numArg(args, 'seeds', 3);
    for (let sd = 0; sd < seeds; sd++) {
      const totals = [];
      for (let z = 0; z < 4; z++) {
        await bot.restart();
        await bot.god(true);
        await bot.teleport(spots[z][0], spots[z][1], 0, 0.2);
        await bot.clearLog();
        const m0 = await money(bot);
        const spawned = await bot.run(pageFns.killAndPay, { type: 'walker', n, x: spots[z][0], z: spots[z][1], r: 12 });
        await bot.step(0.5);
        const deaths = await bot.events('enemy:died');
        const gained = (await money(bot)) - m0;
        totals.push({ z: z + 1, spawned, kills: deaths.length, perKill: deaths.length ? gained / deaths.length : 0, threats: [...new Set(deaths.map((d) => d.p.threat))] });
      }
      R.info(`semilla ${sd}: ${totals.map((t) => `z${t.z}=${fx(t.perKill, 1)}€/baja (${t.kills} bajas)`).join(' · ')}`);
      R.check(`semilla ${sd}: se generaron y mataron infectados en las 4 zonas`, totals.every((t) => t.kills >= n / 2), totals.map((t) => `${t.kills}/${n}`).join(' '));
      R.check(`semilla ${sd}: 'enemy:died' informa la amenaza de su zona`, totals.every((t) => t.threats.length === 1 && t.threats[0] === t.z), JSON.stringify(totals.map((t) => t.threats)));
      R.check(`semilla ${sd}: dinero por baja creciente z1<z2<z3<z4`, totals.every((t, i) => i === 0 || t.perKill > totals[i - 1].perKill), totals.map((t) => fx(t.perKill, 1)).join(' < '));
      R.check(`semilla ${sd}: zona 4 paga ≥ ${fx(THREAT_SCALE.loot[4] / 1.5, 1)}× la zona 1`, totals[3].perKill >= totals[0].perKill * (THREAT_SCALE.loot[4] / 1.5), `${fx(totals[3].perKill / Math.max(0.01, totals[0].perKill), 2)}×`);
      R.soft(`semilla ${sd}: pago por baja ≈ bounty × loot[amenaza] (redondeo ${ECONOMY.bountyRounding})`, totals.every((t) => near(t.perKill, ENEMIES.walker.bounty * THREAT_SCALE.loot[t.z], ECONOMY.bountyRounding + ENEMIES.walker.bounty * 0.5)), totals.map((t) => `${fx(t.perKill, 0)}/${ENEMIES.walker.bounty * THREAT_SCALE.loot[t.z]}`).join(' '));
    }
  });

  await browser.close().catch(() => {});
  await srv.stop();
  R.section('Resumen por escenario');
  R.table(summary, [
    { key: 'id', title: 'esc.' },
    { key: 'title', title: 'escenario' },
    { key: 'pass', title: 'PASS', align: 'right' },
    { key: 'fail', title: 'FAIL', align: 'right' },
    { key: 'warn', title: 'WARN', align: 'right' },
    { key: 'skip', title: 'SKIP', align: 'right' },
  ]);
  return R.summary({ strictSkips: strict });
}

runMain(main, { name: 'playthrough', maxMs: 25 * 60_000 });
