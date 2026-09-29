#!/usr/bin/env node
// QA · MÓVIL — perfil táctil automatizado (PLAN v0.1.5, sección 5).
//
// Uso:  node scripts/qa/mobile.mjs [--dev] [--port=5208] [--rebuild] [--profiles=id1,id2] [--quality=low]
//                                   [--skip-quality-variants] [--skip-safe-area]
//
// Emulación de Chromium (isMobile + hasTouch + DPR + viewport) sobre el build de producción con
// ?touch=1&qa=1&q=<calidad>. Comprueba el comportamiento FUNCIONAL de los controles táctiles, el HUD, la
// orientación, el desbloqueo de audio, la pantalla completa (intento) y el ciclo de vida básico.
//
// IMPORTANTE: esto NO mide el rendimiento de un teléfono. Con SwiftShader y ?qa=1 los FPS, el frame time y
// la memoria NO son válidos como datos de Android real (PLAN §20). Los solapes HUD/controles se informan como
// WARN (hallazgo a revisar): los criterios de aceptación de la BETA todavía no están aprobados.
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { DEFAULT_PORT, ensureOutDir, launchBrowser, loadConfig, numArg, openPage, parseArgs, Report, runMain, serveGame } from './lib.mjs';
import { openGame } from './game.mjs';

/**
 * Perfiles de emulación. El del Redmi Note 8 Pro es una APROXIMACIÓN por especificación (1080×2340, DPR supuesto
 * 2,75 → 851×393 CSS): hay que confirmarlo en el dispositivo con `adb shell wm size` y `adb shell wm density`.
 */
const PROFILES = [
  { id: 'phone-16x9', label: 'teléfono 16:9 · 640×360 @3', w: 640, h: 360, dpr: 3 },
  { id: 'phone-20x9-small', label: 'teléfono 20:9 pequeño · 800×360 @2', w: 800, h: 360, dpr: 2 },
  { id: 'phone-20x9', label: 'teléfono 20:9 · 915×412 @2.625', w: 915, h: 412, dpr: 2.625, safeArea: true, qualityVariants: true, portrait: true },
  { id: 'phone-19_5x9', label: 'teléfono 19.5:9 · 932×430 @3', w: 932, h: 430, dpr: 3 },
  { id: 'redmi-note-8-pro-approx', label: 'Redmi Note 8 Pro (APROXIMADO) · 851×393 @2.75', w: 851, h: 393, dpr: 2.75 },
  { id: 'tablet-16x10', label: 'tableta 16:10 · 1280×800 @2', w: 1280, h: 800, dpr: 2 },
  { id: 'tablet-4x3', label: 'tableta 4:3 · 1024×768 @2', w: 1024, h: 768, dpr: 2 },
];

const HUD_ZONES = ['.hud-tl', '.hud-tc', '.hud-tr', '.hud-bl', '.hud-br', '.hud-bc'];

// ── Código que se ejecuta EN LA PÁGINA ───────────────────────────────────────

/** Init-script: espía (sin bloquear) vibración, pantalla completa y bloqueo de orientación. */
function spiesScript() {
  const log = { vibrate: [], fullscreen: [], orientationLock: [] };
  window.__mobileSpies = log;
  const nav = navigator;
  const origVibrate = typeof nav.vibrate === 'function' ? nav.vibrate.bind(nav) : null;
  nav.vibrate = (pattern) => {
    log.vibrate.push(pattern);
    try {
      return origVibrate ? origVibrate(pattern) : true;
    } catch {
      return false;
    }
  };
  const origFs = Element.prototype.requestFullscreen;
  if (origFs) {
    Element.prototype.requestFullscreen = function (...a) {
      const rec = { result: 'pending' };
      log.fullscreen.push(rec);
      const p = origFs.apply(this, a);
      Promise.resolve(p).then(() => (rec.result = 'ok'), (e) => (rec.result = `rechazado: ${e?.name ?? e}`));
      return p;
    };
  }
  const so = screen.orientation;
  if (so && typeof so.lock === 'function') {
    const origLock = so.lock.bind(so);
    so.lock = (o) => {
      const rec = { orientation: o, result: 'pending' };
      log.orientationLock.push(rec);
      const p = origLock(o);
      Promise.resolve(p).then(() => (rec.result = 'ok'), (e) => (rec.result = `rechazado: ${e?.name ?? e}`));
      return p;
    };
  }
}

/** Rectángulos de botones táctiles visibles y de las zonas del HUD con contenido visible. */
function readLayout(hudZones) {
  const vis = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !el.closest('[hidden]');
  };
  const buttons = [...document.querySelectorAll('.tc-btn')].filter(vis).map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.getAttribute('data-tc'), x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2, d: Math.min(r.width, r.height) };
  });
  const hud = [];
  for (const sel of hudZones) {
    const zone = document.querySelector(sel);
    if (!zone || !vis(zone)) continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const c of zone.querySelectorAll('*')) {
      if (c.children.length > 0 || !vis(c)) continue; // hojas visibles: contenido real, no la caja del contenedor
      const r = c.getBoundingClientRect();
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.width);
      y1 = Math.max(y1, r.y + r.height);
    }
    if (x1 > x0 && y1 > y0) hud.push({ sel, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return { vw: window.innerWidth, vh: window.innerHeight, buttons, hud };
}

// ── Lado Node ────────────────────────────────────────────────────────────────

/** Toques multitáctiles con CDP (Input.dispatchTouchEvent envía SIEMPRE todos los puntos activos). */
class Touches {
  constructor(cdp) {
    this.cdp = cdp;
    this.points = new Map();
    this.next = 1;
  }
  list() {
    return [...this.points.values()].map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 6, radiusY: 6, force: 1 }));
  }
  async down(x, y) {
    const id = this.next++;
    this.points.set(id, { x, y, id });
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.list() });
    return id;
  }
  async move(id, x, y, steps = 1) {
    const p = this.points.get(id);
    const x0 = p.x;
    const y0 = p.y;
    for (let i = 1; i <= steps; i++) {
      p.x = x0 + ((x - x0) * i) / steps;
      p.y = y0 + ((y - y0) * i) / steps;
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.list() });
    }
  }
  /** Suelta un dedo: en Chromium, `touchEnd` con ese punto lo libera y conserva los demás (comprobado). */
  async up(id) {
    const p = this.points.get(id);
    this.points.delete(id);
    if (!p) return;
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id: p.id }] });
  }
  async upAll() {
    this.points.clear();
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async tap(x, y) {
    const id = await this.down(x, y);
    await this.up(id);
  }
}

const circleRectOverlap = (b, r) => {
  const rad = b.d / 2;
  const nx = Math.max(r.x, Math.min(b.cx, r.x + r.w));
  const ny = Math.max(r.y, Math.min(b.cy, r.y + r.h));
  return Math.hypot(b.cx - nx, b.cy - ny) < rad;
};

/** Clasifica los mensajes: aplicación (excepciones y console.* desde el origen del juego) / navegador / externo. */
function classifyProblems(problems, logEntries, origin) {
  const app = [...problems.pageErrors.map((t) => `[pageerror] ${t.split('\n')[0]}`)];
  const external = [];
  for (const e of problems.errorDetails ?? []) {
    if (e.url && e.url.startsWith(origin)) app.push(`[console.error] ${e.text}`);
    else if (e.url && /^(chrome|devtools|chrome-extension):/.test(e.url)) external.push(`[console.error] ${e.text} (${e.url})`);
    else app.push(`[console.error sin URL] ${e.text}`);
  }
  const browserErrors = logEntries.filter((e) => e.level === 'error').map((e) => `[${e.source}] ${e.text}`);
  const browserWarnings = logEntries.filter((e) => e.level === 'warning').map((e) => `[${e.source}] ${e.text}`);
  return { app, browserErrors, browserWarnings, external, failedRequests: problems.failedRequests };
}

async function openMobile(browser, url, profile, query, seed = 1234) {
  const { page, context, problems, bot } = await openGame(browser, url, {
    path: `/?${query}`,
    seed,
    contextOptions: { viewport: { width: profile.w, height: profile.h }, deviceScaleFactor: profile.dpr, isMobile: true, hasTouch: true },
    initScripts: [{ fn: spiesScript }],
  });
  const cdp = await context.newCDPSession(page);
  const logEntries = [];
  cdp.on('Log.entryAdded', ({ entry }) => logEntries.push({ source: entry.source, level: entry.level, text: entry.text, url: entry.url ?? '' }));
  await cdp.send('Log.enable'); // reenvía también las entradas anteriores
  return { page, context, problems, bot, cdp, touches: new Touches(cdp), logEntries };
}

/** Centro de un botón táctil visible (o null). */
async function buttonCenter(page, id) {
  return page.evaluate((bid) => {
    const el = document.querySelector(`.tc-btn[data-tc="${bid}"]`);
    if (!el || el.hidden || getComputedStyle(el).display === 'none') return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, id);
}

async function domButtonCenter(page, text) {
  return page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes(t) && x.getBoundingClientRect().width > 0 && getComputedStyle(x).visibility !== 'hidden');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, text);
}

async function probe(bot) {
  return bot.run((ctx) => {
    const t = ctx.touch;
    const s = ctx.state;
    return {
      flow: s.flow,
      mode: t.debug?.mode ?? null,
      pointers: t.debug?.pointers ?? null,
      moveX: ctx.input.moveX,
      moveY: ctx.input.moveY,
      fire: ctx.input.isDown('fire'),
      yaw: s.player.yaw,
      pos: { x: s.player.pos.x, z: s.player.pos.z },
      aiming: s.player.aiming,
      crouched: s.player.crouched,
      reloading: s.player.reloading,
      activeSlot: s.player.activeSlot,
      hasSlot2: s.player.slots[1] !== null,
      grenades: s.player.grenades,
      shots: s.match.shotsFired,
      modal: s.ui.modal,
      interact: ctx.interactions.current?.id ?? null,
      progress: ctx.interactions.progress,
      audio: ctx.audio.engine?.state ?? null,
      lefty: t.settings?.lefty ?? null,
      portrait: t.debug?.portrait ?? null,
      rotateVisible: !document.querySelector('.tc-rotate')?.hidden,
      panelVisible: !document.querySelector('.tc-panel-wrap')?.hidden,
    };
  });
}

async function runProfile(R, browser, url, profile, cfg, opts) {
  const { MAP } = cfg;
  const query = `touch=1&qa=1&q=${opts.quality}`;
  R.section(`${profile.label} · ?${query}`);
  const m = await openMobile(browser, url, profile, query);
  const { page, bot, touches, problems } = m;
  const findings = [];
  try {
    const t0 = await probe(bot);
    const env = await page.evaluate(() => ({ input: document.documentElement.dataset.input, uiInput: document.querySelector('.ds-ui')?.getAttribute('data-input'), touchRoot: !!document.querySelector('.tc-root'), maxTouch: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches, dpr: devicePixelRatio, vw: innerWidth, vh: innerHeight }));
    R.check('modo táctil activo (html y UI con data-input="touch", overlay .tc-root)', env.input === 'touch' && env.uiInput === 'touch' && env.touchRoot, JSON.stringify(env));
    R.check("flujo inicial 'title' y aviso de giro oculto en horizontal", t0.flow === 'title' && !t0.rotateVisible, `flow=${t0.flow} rotate=${t0.rotateVisible}`);
    R.check('sin AudioContext antes del primer gesto', t0.audio === 'none', `audio=${t0.audio}`);

    // ── Inicio con un toque real (gesto de usuario) ─────────────────────────
    const start = await domButtonCenter(page, 'Iniciar operación');
    R.check('botón «Iniciar operación» visible', start !== null);
    if (start) await touches.tap(start.x, start.y);
    await bot.step(0.3);
    const t1 = await probe(bot);
    R.check("toque en «Iniciar» → flujo 'playing' y modo táctil 'full'", t1.flow === 'playing' && t1.mode === 'full', `flow=${t1.flow} mode=${t1.mode}`);
    R.check('audio desbloqueado por el toque (política de autoplay real)', t1.audio === 'running', `estado=${t1.audio}`);
    R.info('pantalla completa / bloqueo de orientación: con ?qa=1 requestLock() no los intenta (atajo de QA); se prueban aparte SIN ?qa=1.');

    // ── Reparto: dentro de pantalla, sin solapes entre botones, solapes con HUD (hallazgo) ─
    const checkLayout = async (tag) => {
      const L = await page.evaluate(readLayout, HUD_ZONES);
      const outside = L.buttons.filter((b) => b.x < -0.5 || b.y < -0.5 || b.x + b.w > L.vw + 0.5 || b.y + b.h > L.vh + 0.5).map((b) => b.id);
      R.check(`[${tag}] botones visibles dentro de la pantalla`, outside.length === 0, outside.length ? `fuera: ${outside.join(', ')}` : `${L.buttons.length} botones`);
      const pairs = [];
      for (let i = 0; i < L.buttons.length; i++) {
        for (let j = i + 1; j < L.buttons.length; j++) {
          const a = L.buttons[i];
          const b = L.buttons[j];
          if (Math.hypot(a.cx - b.cx, a.cy - b.cy) < (a.d + b.d) / 2 - 0.5) pairs.push(`${a.id}/${b.id}`);
        }
      }
      R.check(`[${tag}] botones táctiles sin solaparse entre sí`, pairs.length === 0, pairs.join(', '));
      const hudHits = [];
      for (const b of L.buttons) for (const z of L.hud) if (circleRectOverlap(b, z)) hudHits.push(`${b.id}(Ø${Math.round(b.d)}px)↔${z.sel}`);
      if (hudHits.length) {
        R.warn(`[${tag}] solapes botón táctil ↔ HUD (hallazgo, criterio aún no aprobado)`, hudHits.join(', '));
        findings.push({ tag, overlaps: hudHits });
      } else R.check(`[${tag}] sin solapes botón táctil ↔ HUD`, true);
      const small = L.buttons.filter((b) => b.d < 48).map((b) => `${b.id}=${Math.round(b.d)}px`);
      if (small.length) {
        R.info(`[${tag}] botones < 48 px CSS: ${small.join(', ')} (referencia Android 48 dp; dato, no criterio aprobado)`);
        findings.push({ tag, smallButtons: small });
      }
      return L;
    };
    await checkLayout('spawn');

    // ── Joystick ─────────────────────────────────────────────────────────────
    const sx = profile.w * 0.18;
    const sy = profile.h * 0.78;
    const pos0 = t1.pos;
    const stickId = await touches.down(sx, sy);
    await touches.move(stickId, sx, sy - 60, 4);
    const t2 = await probe(bot);
    R.check('joystick: arrastrar hacia arriba → moveY > 0', t2.moveY > 0.3, `moveY=${t2.moveY.toFixed(2)} moveX=${t2.moveX.toFixed(2)}`);
    await bot.step(1);
    const t3 = await probe(bot);
    const moved = Math.hypot(t3.pos.x - pos0.x, t3.pos.z - pos0.z);
    R.check('joystick: el jugador se desplaza', moved > 0.5, `${moved.toFixed(2)} m en 1 s`);
    await touches.up(stickId);
    const t4 = await probe(bot);
    R.check('joystick: al soltar, el movimiento vuelve a 0', t4.moveX === 0 && t4.moveY === 0 && t4.pointers === 0, `move=(${t4.moveX},${t4.moveY}) punteros=${t4.pointers}`);

    // ── Mirada por arrastre ─────────────────────────────────────────────────
    const lx = profile.w * 0.55;
    const ly = profile.h * 0.35;
    const lookId = await touches.down(lx, ly);
    await touches.move(lookId, lx + 120, ly, 6);
    await bot.step(0.1);
    const t5 = await probe(bot);
    await touches.up(lookId);
    R.check('mirada: arrastrar en la zona libre gira la cámara', Math.abs(t5.yaw - t4.yaw) > 0.02, `Δyaw=${(t5.yaw - t4.yaw).toFixed(3)} rad`);

    // ── Botones ─────────────────────────────────────────────────────────────
    const press = async (id, holdS = 0.1) => {
      const c = await buttonCenter(page, id);
      if (!c) return false;
      const tid = await touches.down(c.x, c.y);
      await bot.step(holdS);
      await touches.up(tid);
      await bot.step(0.1);
      return true;
    };
    const fire = await buttonCenter(page, 'fire');
    const shots0 = (await probe(bot)).shots;
    const vib0 = (await page.evaluate(() => window.__mobileSpies.vibrate.length));
    if (fire) {
      const fid = await touches.down(fire.x, fire.y);
      const tf = await probe(bot);
      R.check('disparo: mantener el botón → acción fire pulsada', tf.fire === true);
      await bot.step(0.5);
      await touches.up(fid);
      await bot.step(0.1);
    }
    const t6 = await probe(bot);
    R.check('disparo: se registran disparos', t6.shots > shots0, `disparos ${shots0} → ${t6.shots}`);
    R.check('disparo: al soltar, fire vuelve a false', t6.fire === false);
    const vib1 = await page.evaluate(() => window.__mobileSpies.vibrate.length);
    R.soft('háptica: vibración solicitada al disparar (espía; la vibración física es de clase B)', vib1 > vib0, `llamadas ${vib0} → ${vib1}`);

    await press('aim');
    const aimOn = await page.evaluate(() => document.querySelector('.tc-btn[data-tc="aim"]')?.getAttribute('aria-pressed'));
    const t7 = await probe(bot);
    R.check('apuntar: un toque alterna (aria-pressed=true y el jugador apunta)', aimOn === 'true' && t7.aiming, `aria-pressed=${aimOn} aiming=${t7.aiming}`);
    await press('aim');
    const aimOff = await page.evaluate(() => document.querySelector('.tc-btn[data-tc="aim"]')?.getAttribute('aria-pressed'));
    R.check('apuntar: segundo toque desactiva', aimOff === 'false', `aria-pressed=${aimOff}`);

    await press('crouch');
    const t8 = await probe(bot);
    R.check('agacharse: toque activa', t8.crouched === true);
    await press('crouch');
    const t9 = await probe(bot);
    R.check('agacharse: segundo toque desactiva', t9.crouched === false);

    const jumps0 = await bot.count('player:jumped');
    await press('jump', 0.15);
    R.check('saltar: se emite player:jumped', (await bot.count('player:jumped')) > jumps0);

    const tr0 = await probe(bot);
    await press('reload', 0.05);
    const tr1 = await probe(bot);
    R.soft('recargar: el toque inicia la recarga (requiere cargador no lleno)', tr1.reloading || tr0.reloading, `reloading=${tr1.reloading}`);
    await bot.step(3);

    const ts0 = await probe(bot);
    if (ts0.hasSlot2) {
      await press('swap');
      const ts1 = await probe(bot);
      R.check('cambiar arma: alterna el arma activa', ts1.activeSlot !== ts0.activeSlot, `slot ${ts0.activeSlot} → ${ts1.activeSlot}`);
    } else R.skip('cambiar arma', 'sin segunda arma en el equipo inicial');

    if (ts0.grenades > 0) {
      await press('grenade');
      await bot.step(0.5);
      const tg = await probe(bot);
      R.check('granada: el toque lanza una granada', tg.grenades < ts0.grenades, `granadas ${ts0.grenades} → ${tg.grenades}`);
    } else R.skip('granada', 'sin granadas');

    // ── Multitáctil: joystick + mirada + disparo a la vez ───────────────────
    const f2 = await buttonCenter(page, 'fire');
    const a = await touches.down(sx, sy);
    const b = await touches.down(lx, ly);
    const c = f2 ? await touches.down(f2.x, f2.y) : null;
    await touches.move(a, sx, sy - 60, 3);
    const yawM0 = (await probe(bot)).yaw;
    await touches.move(b, lx - 100, ly, 4);
    await bot.step(0.2);
    const tm = await probe(bot);
    R.check('multitáctil: 3 dedos simultáneos (joystick + mirada + disparo)', tm.pointers === 3 && tm.moveY > 0.3 && tm.fire === true && Math.abs(tm.yaw - yawM0) > 0.01,
      `punteros=${tm.pointers} moveY=${tm.moveY.toFixed(2)} fire=${tm.fire} Δyaw=${(tm.yaw - yawM0).toFixed(3)}`);
    if (c !== null) await touches.up(c);
    const tm1 = await probe(bot);
    R.check('multitáctil: soltar un dedo no suelta los demás', tm1.pointers === 2 && tm1.fire === false && tm1.moveY > 0.3, `punteros=${tm1.pointers} fire=${tm1.fire} moveY=${tm1.moveY.toFixed(2)}`);
    await touches.upAll();
    await bot.step(0.1);
    const tm2 = await probe(bot);
    R.check('multitáctil: al soltar todo no queda nada pegado', tm2.pointers === 0 && tm2.moveY === 0 && tm2.fire === false, `punteros=${tm2.pointers} moveY=${tm2.moveY} fire=${tm2.fire}`);

    // ── Interactuar (botón contextual con retención) ────────────────────────
    await bot.teleport(MAP.relay.x + 1.2, MAP.relay.z, 0, 0.3);
    const ti = await probe(bot);
    const ic = await buttonCenter(page, 'interact');
    R.check('interactuar: el botón aparece junto al transmisor', ti.interact === 'relay:transmitter' && ic !== null, `actual=${ti.interact} visible=${ic !== null}`);
    await checkLayout('relé (con botón interactuar)');
    if (ic) {
      const iid = await touches.down(ic.x, ic.y);
      await bot.step(1);
      const tp = await probe(bot);
      await touches.up(iid);
      R.check('interactuar: mantener el botón hace avanzar el progreso', tp.progress > 0.1, `progreso=${tp.progress.toFixed(2)}`);
    }
    await bot.step(0.2);

    // ── Mapa, pausa y ajustes táctiles ──────────────────────────────────────
    await press('map');
    const tmap = await probe(bot);
    R.check("mapa: el botón abre el mapa táctico (modo táctil 'system')", tmap.modal === 'map' && tmap.mode === 'system', `modal=${tmap.modal} mode=${tmap.mode}`);
    await press('map');
    const tmap2 = await probe(bot);
    R.check('mapa: segundo toque lo cierra', tmap2.modal === null && tmap2.mode === 'full', `modal=${tmap2.modal} mode=${tmap2.mode}`);

    await press('pause');
    const tpz = await probe(bot);
    R.check("pausa: el botón pausa la partida (modo 'paused')", tpz.flow === 'paused' && tpz.mode === 'paused', `flow=${tpz.flow} mode=${tpz.mode}`);
    const gear = await buttonCenter(page, 'settings');
    if (gear) {
      await touches.tap(gear.x, gear.y);
      await bot.step(0.1);
      const tset = await probe(bot);
      R.check('ajustes táctiles: el panel se abre en pausa', tset.panelVisible === true);
      const fireBefore = await page.evaluate(() => window.__qa.game.ctx.touch.layout.buttons.find((x) => x.id === 'fire').cx);
      await page.evaluate(() => [...document.querySelectorAll('.tc-switch')].find((s) => s.getAttribute('aria-label') === 'Modo zurdo')?.click());
      await bot.step(0.1);
      const fireAfter = await page.evaluate(() => window.__qa.game.ctx.touch.layout.buttons.find((x) => x.id === 'fire').cx);
      R.check('modo zurdo: el reparto se refleja (disparo pasa a la izquierda)', fireBefore > profile.w / 2 && fireAfter < profile.w / 2, `x disparo ${Math.round(fireBefore)} → ${Math.round(fireAfter)}`);
      await page.evaluate(() => [...document.querySelectorAll('.tc-switch')].find((s) => s.getAttribute('aria-label') === 'Modo zurdo')?.click());
      await page.evaluate(() => document.querySelector('.tc-close')?.click());
      await bot.step(0.1);
    } else R.check('ajustes táctiles: botón visible en pausa', false);
    const cont = await domButtonCenter(page, 'Continuar');
    if (cont) await touches.tap(cont.x, cont.y);
    await bot.step(0.2);
    const tres = await probe(bot);
    R.check('pausa: «Continuar» con un toque reanuda', tres.flow === 'playing' && tres.mode === 'full', `flow=${tres.flow} mode=${tres.mode}`);

    // ── Ciclo de vida básico (SIMULADO: el comportamiento real en Android es de clase B) ──
    const sid = await touches.down(sx, sy);
    await touches.move(sid, sx, sy - 60, 2);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const tb = await probe(bot);
    R.check('ciclo de vida (simulado): blur suelta todos los controles', tb.moveY === 0 && tb.pointers === 0, `moveY=${tb.moveY} punteros=${tb.pointers}`);
    await touches.upAll();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await bot.step(0.1);
    await new Promise((r) => setTimeout(r, 300));
    const th = await probe(bot);
    R.check('ciclo de vida (simulado): pestaña oculta → partida en pausa', th.flow === 'paused', `flow=${th.flow}`);
    R.info(`ciclo de vida (simulado): audio con la pestaña oculta = ${th.audio} (suspensión real: clase B)`);
    await page.evaluate(() => {
      delete document.hidden;
      delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await new Promise((r) => setTimeout(r, 300));
    await bot.step(0.1);
    const tv = await probe(bot);
    R.check('ciclo de vida (simulado): al volver sigue en pausa hasta un toque', tv.flow === 'paused', `flow=${tv.flow} audio=${tv.audio}`);
    const cont2 = await domButtonCenter(page, 'Continuar');
    if (cont2) await touches.tap(cont2.x, cont2.y);
    await bot.step(0.2);

    // ── Vertical (prueba de comportamiento) ─────────────────────────────────
    if (profile.portrait) {
      await page.setViewportSize({ width: profile.h, height: profile.w });
      await bot.step(0.7);
      const tpo = await probe(bot);
      R.check('vertical en partida: aviso «Gira el dispositivo» visible y partida en pausa', tpo.rotateVisible && tpo.flow === 'paused' && tpo.mode === 'off', `rotate=${tpo.rotateVisible} flow=${tpo.flow} mode=${tpo.mode}`);
      await page.setViewportSize({ width: profile.w, height: profile.h });
      await bot.step(0.7);
      const tla = await probe(bot);
      R.check('vuelta a horizontal: aviso oculto, sigue en pausa', !tla.rotateVisible && tla.flow === 'paused', `rotate=${tla.rotateVisible} flow=${tla.flow}`);
      const cont3 = await domButtonCenter(page, 'Continuar');
      if (cont3) await touches.tap(cont3.x, cont3.y);
      await bot.step(0.3);
    }

    // ── Áreas seguras (si el Chromium permite emularlas) ─────────────────────
    if (profile.safeArea && !opts.skipSafeArea) {
      const insets = { top: 0, topMax: 0, left: 44, leftMax: 44, bottom: 20, bottomMax: 20, right: 44, rightMax: 44 };
      let supported = true;
      try {
        await m.cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
      } catch (e) {
        supported = false;
        R.skip('áreas seguras emuladas', `Emulation.setSafeAreaInsetsOverride no disponible en este Chromium (${String(e?.message ?? e).split('\n')[0]}): NO VERIFICABLE en automatización`);
      }
      if (supported) {
        await bot.step(0.7);
        const fireRight = () => page.evaluate(() => {
          const f = window.__qa.game.ctx.touch.layout.buttons.find((x) => x.id === 'fire');
          return f.cx + f.size / 2;
        });
        const before = await fireRight();
        R.info(`áreas seguras: sin evento resize el reparto táctil ${before <= profile.w - 44 ? 'SÍ' : 'NO'} se recalcula (borde derecho del disparo ${Math.round(before)} px); sólo relee los insets en resize/orientationchange/visualViewport o si cambia el tamaño`);
        if (before > profile.w - 44) findings.push({ tag: 'safe-area', note: 'los insets sólo se releen con resize/orientación (observado en emulación)' });
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        await bot.step(0.1);
        const sa = await page.evaluate(() => {
          const L = window.__qa.game.ctx.touch.layout;
          const fireB = L.buttons.find((x) => x.id === 'fire');
          const cs = getComputedStyle(document.querySelector('.tc-probe'));
          return { probe: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft], fireRight: fireB.cx + fireB.size / 2, fireBottom: fireB.cy + fireB.size / 2, homeX: L.stickHome.x, w: L.width, h: L.height };
        });
        const applied = parseFloat(sa.probe[1]) > 0;
        if (!applied) R.skip('áreas seguras emuladas', `el override no llegó a env(safe-area-inset-*) (sonda=${sa.probe.join(' ')}): NO VERIFICABLE en automatización`);
        else {
          R.check('áreas seguras: el disparo respeta el margen derecho', sa.fireRight <= sa.w - 44, `borde derecho ${Math.round(sa.fireRight)} ≤ ${sa.w - 44}`);
          R.check('áreas seguras: el disparo respeta el margen inferior', sa.fireBottom <= sa.h - 20, `borde inferior ${Math.round(sa.fireBottom)} ≤ ${sa.h - 20}`);
          R.check('áreas seguras: el aro del joystick fantasma respeta el margen izquierdo', sa.homeX - cfg.TOUCH.stickRadius >= 44, `centro x=${Math.round(sa.homeX)} radio=${cfg.TOUCH.stickRadius}`);
          await checkLayout('áreas seguras 44/20');
        }
        await m.cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: {} }).catch(() => {});
      }
    }

    // Captura ligera del estado en partida (artefacto pequeño).
    await bot.screenshot(join(opts.outDir, `${profile.id}.png`));

    // ── Errores clasificados ────────────────────────────────────────────────
    const cls = classifyProblems(problems, m.logEntries, url);
    R.check('sin errores de la APLICACIÓN (excepciones y console.error del juego)', cls.app.length === 0, cls.app.slice(0, 3).join(' | '));
    if (cls.failedRequests.length) R.check('sin peticiones fallidas', false, cls.failedRequests.slice(0, 3).join(' | '));
    if (cls.browserErrors.length) R.warn('errores internos del NAVEGADOR (no originados por el juego)', cls.browserErrors.slice(0, 3).join(' | '));
    R.info(`mensajes: app=${cls.app.length} · navegador(error)=${cls.browserErrors.length} · navegador(aviso)=${cls.browserWarnings.length} · externos=${cls.external.length} · console.warning=${problems.warnings.length}`);
    return { profile: profile.id, findings, messages: { app: cls.app, browserErrors: cls.browserErrors, browserWarnings: cls.browserWarnings.slice(0, 20), external: cls.external } };
  } finally {
    await m.context.close().catch(() => {});
  }
}

/**
 * Pantalla completa y orientación SIN ?qa=1 (con qa, requestLock() no las intenta). No hay window.__qa: se
 * observa el DOM y los espías. El resultado real en Android (Chrome/WebView/PWA) es de clase B/C.
 */
async function runFullscreenCheck(R, browser, url, profile) {
  const { page, context, problems } = await openPage(browser, `${url}/?touch=1&q=low`, {
    initScripts: [{ fn: spiesScript }],
    contextOptions: { viewport: { width: profile.w, height: profile.h }, deviceScaleFactor: profile.dpr, isMobile: true, hasTouch: true },
  });
  try {
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000 && (await page.evaluate(() => document.getElementById('boot') !== null))) await new Promise((r) => setTimeout(r, 200));
    const cdp = await context.newCDPSession(page);
    const touches = new Touches(cdp);
    const start = await domButtonCenter(page, 'Iniciar operación');
    if (start) await touches.tap(start.x, start.y);
    await new Promise((r) => setTimeout(r, 1500));
    const r = await page.evaluate(() => ({
      spies: JSON.parse(JSON.stringify(window.__mobileSpies)),
      fullscreen: document.fullscreenElement !== null,
      orientation: screen.orientation ? screen.orientation.type : null,
      qa: typeof window.__qa,
      touchMode: document.querySelector('.tc-root')?.getAttribute('data-mode') ?? null,
    }));
    R.check('sin ?qa=1: el toque en «Iniciar» intenta la pantalla completa dentro del gesto', r.spies.fullscreen.length > 0, JSON.stringify(r.spies.fullscreen));
    R.info(`sin ?qa=1: pantalla completa activa=${r.fullscreen} · bloqueo de orientación=${JSON.stringify(r.spies.orientationLock)} · orientación=${r.orientation} (headless: el resultado real en Android es de clase B/C)`);
    R.check("sin ?qa=1: controles táctiles en modo 'full' tras el toque", r.touchMode === 'full', `data-mode=${r.touchMode} __qa=${r.qa}`);
    R.check('sin ?qa=1: sin errores de página', problems.pageErrors.length === 0, problems.pageErrors.slice(0, 2).join(' | '));
    return { fullscreen: r.fullscreen, spies: r.spies };
  } finally {
    await context.close().catch(() => {});
  }
}

/** Variante de calidad: arranque + partida breve sin errores (sin repetir toda la batería). */
async function runQualityVariant(R, browser, url, profile, quality) {
  const query = `touch=1&qa=1&q=${quality}`;
  const m = await openMobile(browser, url, profile, query);
  try {
    const start = await domButtonCenter(m.page, 'Iniciar operación');
    if (start) await m.touches.tap(start.x, start.y);
    await m.bot.step(3);
    const p = await probe(m.bot);
    const q = await m.bot.run((ctx) => ({ quality: ctx.engine.stats.quality, pr: ctx.engine.stats.pixelRatio, preset: { ...ctx.engine.preset } }));
    const cls = classifyProblems(m.problems, m.logEntries, url);
    R.check(`[${profile.id} · q=${quality}] arranca, entra en partida y sin errores de la app`, p.flow === 'playing' && p.mode === 'full' && q.quality === quality && cls.app.length === 0,
      `flow=${p.flow} mode=${p.mode} calidad=${q.quality} pixelRatio=${q.pr} msaa=${q.preset.msaa} sombras=${q.preset.shadows} app=${cls.app.length}`);
    return { profile: profile.id, quality, preset: q.preset, pixelRatio: q.pr };
  } finally {
    await m.context.close().catch(() => {});
  }
}

async function main() {
  const args = parseArgs();
  const port = numArg(args, 'port', DEFAULT_PORT);
  const quality = typeof args.quality === 'string' ? args.quality : 'low';
  const only = typeof args.profiles === 'string' ? new Set(args.profiles.split(',')) : null;
  const cfg = await loadConfig();
  const outDir = ensureOutDir('mobile');
  const R = new Report(`QA MÓVIL (emulación Chromium; NO es rendimiento de Android real) · calidad ${quality}`);
  R.info('Clase A: comportamiento funcional reproducible. FPS/frame time/memoria de esta emulación NO son válidos (SwiftShader + ?qa=1).');
  const srv = await serveGame({ dev: !!args.dev, port, force: !!args.rebuild, log: (x) => R.info(x) });
  R.info(`servidor ${srv.kind} en ${srv.url}`);
  const browser = await launchBrowser({ audioNeedsGesture: true });
  R.info(`Chromium ${browser.version()} · política de autoplay real (el audio exige gesto)`);
  const results = { chromium: browser.version(), quality, profiles: [], qualityVariants: [] };
  for (const p of PROFILES) {
    if (only && !only.has(p.id)) continue;
    try {
      results.profiles.push(await runProfile(R, browser, srv.url, p, cfg, { quality, outDir, skipSafeArea: !!args['skip-safe-area'] }));
    } catch (err) {
      R.check(`${p.id}: ejecución completa del perfil`, false, err instanceof Error ? err.message.split('\n')[0] : String(err));
    }
  }
  const fsProfile = PROFILES.find((x) => x.id === 'phone-20x9');
  if (!only || only.has(fsProfile.id)) {
    R.section(`Pantalla completa y orientación sin ?qa=1 · ${fsProfile.label}`);
    try {
      results.fullscreen = await runFullscreenCheck(R, browser, srv.url, fsProfile);
    } catch (err) {
      R.check('pantalla completa sin ?qa=1', false, err instanceof Error ? err.message.split('\n')[0] : String(err));
    }
  }
  if (!args['skip-quality-variants']) {
    R.section('Variantes de calidad (arranque + partida breve)');
    for (const p of PROFILES.filter((x) => x.qualityVariants && (!only || only.has(x.id)))) {
      for (const q of ['medium', 'high']) {
        try {
          results.qualityVariants.push(await runQualityVariant(R, browser, srv.url, p, q));
        } catch (err) {
          R.check(`${p.id} · q=${q}`, false, err instanceof Error ? err.message.split('\n')[0] : String(err));
        }
      }
    }
  }
  writeFileSync(join(outDir, 'mobile-results.json'), JSON.stringify(results, null, 2));
  R.info(`resultados detallados: qa-output/mobile/mobile-results.json`);
  await browser.close();
  await srv.stop();
  return R.summary();
}

runMain(main, { name: 'mobile', maxMs: 20 * 60_000 });
