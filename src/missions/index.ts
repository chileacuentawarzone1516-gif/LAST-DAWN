/**
 * Módulo de misiones, economía y reglas de partida: createMissions(ctx).
 * Orquesta las reglas puras (src/rules) con el bus, el estado y los objetos 3D:
 * partida (contaminación, sellado, final), contratos (relé, Warden, extracción), tiendas,
 * botín, helicóptero y marcadores. Todo se cancela en dispose() (EventScope + interactuables).
 */
import * as THREE from 'three';
import { CONTAMINATION, LOOT, MAP, MISSIONS, PLAYER, TIMERS } from '../config';
import type { GameContext, MissionsApi } from '../core/context';
import type { MissionId } from '../core/types';
import { createRng } from '../core/util';
import { killReward, addMoney } from '../rules/economy';
import { rollDrop } from '../rules/loot';
import { contaminationDepth, contaminationDps, evaluateEnd, tickMatch } from '../rules/match';
import type { EndVerdict } from '../rules/match';
import {
  activateRelay, activateWardenContract, callExtraction, canCallExtraction, completeRelay,
  forceBoard, isInsideRelay, onWardenHelmetBroken, onWardenKilled, payContract, tickExtraction, tickRelay,
} from '../rules/missions';
import type { ExtractionEvent } from '../rules/missions';
import { announceMoney, createGlowTextures, makeVec3, notify } from './common';
import { createHelicopter } from './helicopter';
import { createMarkers } from './markers';
import { createPickups, spawnStaticLoot } from './pickups';
import { createShop } from './shop';

const TITLES: Record<MissionId, string> = {
  relay: MISSIONS.relay.title, warden: MISSIONS.warden.title, extraction: MISSIONS.extraction.title,
};

export function createMissions(ctx: GameContext): MissionsApi {
  const { state, bus } = ctx;
  const scope = bus.scope();
  const rng = createRng((Math.random() * 0x100000000) >>> 0);
  const tex = createGlowTextures();
  const heli = createHelicopter(ctx, tex);
  const markers = createMarkers(ctx, tex);
  const pickups = createPickups(ctx, tex, rng);
  const shop = createShop(ctx, scope);
  spawnStaticLoot(ctx, pickups, rng);
  const cleanups: Array<() => void> = [...shop.registerInteractables()];

  // Fundido a negro (viewScene) para el despegue con el jugador a bordo.
  const fadeMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
  const fade = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), fadeMat);
  fade.position.z = -1;
  fade.renderOrder = 1000;
  fade.visible = false;
  fade.frustumCulled = false;
  ctx.viewScene.add(fade);

  const relayCenter = makeVec3(MAP.relay.x, 0, MAP.relay.z);
  const radioPos = makeVec3(MAP.lz.radio.x, 0, MAP.lz.radio.z);

  // ── Contratos ────────────────────────────────────────────────────────────
  function updated(id: MissionId): void {
    bus.emit('mission:updated', { id });
  }

  /** Paga (una sola vez) y anuncia. Idempotente: si ya estaba pagado no emite nada. */
  function payAndAnnounce(id: MissionId): void {
    const before = state.player.money;
    const reward = payContract(state, id);
    if (reward <= 0) return;
    announceMoney(ctx, before, `contract:${id}`);
    bus.emit('mission:completed', { id, reward });
    notify(ctx, `Contrato completado: ${TITLES[id]} · +$${reward}`, 'reward');
  }

  function onRelayActivated(): void {
    bus.emit('relay:activated', {});
    bus.emit('horde:started', { id: 'relay', center: { x: MAP.relay.x, z: MAP.relay.z } });
    updated('relay');
    notify(ctx, 'Transmisor activo: permanece dentro del círculo', 'warn');
  }

  function onRelayCompleted(): void {
    payAndAnnounce('relay');
    bus.emit('horde:ended', { id: 'relay' });
    updated('relay');
    updated('extraction');
    notify(ctx, 'Señal restaurada: llama al helicóptero desde la radio del LZ', 'info');
  }

  function onWardenDone(): void {
    payAndAnnounce('warden');
    updated('warden');
  }

  function callHeli(): void {
    if (!callExtraction(state)) return;
    bus.emit('extraction:called', { etaS: MISSIONS.extraction.etaS });
    bus.emit('horde:started', { id: 'extraction', center: { x: MAP.lz.center.x, z: MAP.lz.center.z } });
    updated('extraction');
    notify(ctx, `Helicóptero en camino: llega en ${MISSIONS.extraction.etaS} s. Resiste`, 'warn');
  }

  function onExtractionEvent(ev: ExtractionEvent): void {
    switch (ev.type) {
      case 'landed':
        bus.emit('extraction:landed', {});
        updated('extraction');
        notify(ctx, `¡Helicóptero en tierra! Mantén E cerca para abordar (${MISSIONS.extraction.boardWindowS} s)`, 'warn');
        break;
      case 'boarded':
        payAndAnnounce('extraction');
        ctx.player.setControlEnabled(false);
        ctx.player.godMode = true; // a bordo: los infectados ya no pueden matarte
        state.missions.extraction.boarded = true;
        bus.emit('extraction:boarding', { progress: 1 });
        updated('extraction');
        break;
      case 'departing':
        bus.emit('horde:ended', { id: 'extraction' });
        updated('extraction');
        if (!ev.boarded) notify(ctx, 'El helicóptero se ha ido sin ti', 'danger');
        break;
      case 'departed':
        bus.emit('extraction:departed', { boarded: ev.boarded });
        break;
    }
  }

  cleanups.push(
    ctx.interactions.register({
      id: 'relay:transmitter', position: () => relayCenter, radius: PLAYER.interactReach + 0.4, priority: 1,
      prompt: () => (state.missions.relay.status === 'available' && !state.missions.relay.activated ? 'Activar transmisor' : null),
      holdSeconds: MISSIONS.relay.activateHoldS,
      onComplete: () => {
        if (activateRelay(state)) onRelayActivated();
      },
    }),
    ctx.interactions.register({
      id: 'lz:radio', position: () => radioPos, radius: PLAYER.interactReach, priority: 1,
      prompt: () => (canCallExtraction(state) ? 'Llamar al helicóptero' : null),
      holdSeconds: MISSIONS.extraction.callHoldS,
      onComplete: callHeli,
    }),
    ctx.interactions.register({
      id: 'lz:radio-nosignal', position: () => radioPos, radius: PLAYER.interactReach, priority: 1,
      prompt: () => (state.missions.extraction.phase === 'idle' && !state.match.sealed
        && state.missions.relay.status !== 'completed' && MISSIONS.extraction.requiresRelay
        ? 'Sin señal — restaura el relé' : null),
      holdSeconds: 0,
      onComplete: () => notify(ctx, 'Sin señal: restaura el relé para llamar al helicóptero', 'warn'),
    }),
    ctx.interactions.register({
      id: 'lz:board', position: () => heli.info.position, radius: MAP.lz.boardRadius, priority: 2,
      prompt: () => {
        const ph = state.missions.extraction.phase;
        return ph === 'landed' || ph === 'boarding' ? 'Abordar helicóptero' : null;
      },
      holdSeconds: MISSIONS.extraction.boardHoldS,
      onComplete: () => {
        if (forceBoard(state)) {
          onExtractionEvent({ type: 'boarded' });
          onExtractionEvent({ type: 'departing', boarded: true });
        }
      },
    }),
  );
  const boardItemId = 'lz:board';

  // ── Eventos ──────────────────────────────────────────────────────────────
  let helmetAnnounced = false;
  let diedFlag = false;
  scope
    .on('warden:helmetBroken', () => {
      if (!helmetAnnounced) {
        helmetAnnounced = true;
        notify(ctx, '¡Casco destruido! Apunta a la cabeza', 'warn');
      }
      if (onWardenHelmetBroken(state)) updated('warden');
    })
    .on('player:died', () => {
      diedFlag = true;
    })
    .on('enemy:died', (e) => {
      if (state.match.phase !== 'playing') return;
      state.match.kills++;
      if (e.headshot) state.match.headshots++;
      const before = state.player.money;
      const reward = killReward(e.type, e.threat);
      if (reward > 0) {
        addMoney(state, reward);
        announceMoney(ctx, before, 'kill');
      }
      const drop = rollDrop(rng, e.type, e.threat);
      if (drop) {
        const x = e.pos.x + (rng() - 0.5) * 1.2;
        const z = e.pos.z + (rng() - 0.5) * 1.2;
        pickups.spawn(drop.kind, drop.amount, x, z, Math.max(0, ctx.world.groundHeight(x, z, 0.3, e.pos.y)), LOOT.lifetimeS);
      }
      if (e.type === 'warden' && onWardenKilled(state)) onWardenDone();
      else if (e.type === 'warden') payAndAnnounce('warden');
    });

  // ── Partida ──────────────────────────────────────────────────────────────
  let damageAcc = 0;
  let committed = false;
  let endTimer = 0;
  let endVerdict: EndVerdict | null = null;
  let endEmitted = false;
  let progressAcc = 0;
  let boardEmitAcc = 0;
  let lastBoardProgress = 0;

  function tickMatchFlow(dt: number): void {
    for (const ev of tickMatch(state, dt)) {
      if (ev.type === 'warning') {
        bus.emit('match:warning', { kind: ev.kind, secondsLeft: ev.secondsLeft });
        if (ev.kind === 'contamination') notify(ctx, `La contaminación se extiende en ${ev.secondsLeft} s`, 'warn');
        else {
          const idle = state.missions.extraction.phase === 'idle';
          notify(ctx, `El distrito se sella en ${ev.secondsLeft} s${idle ? ': ¡llama a la extracción!' : ''}`, 'danger');
        }
      } else if (ev.type === 'contaminationStarted') {
        bus.emit('match:contaminationStarted', {});
        notify(ctx, '¡La contaminación avanza desde el complejo!', 'danger');
      } else {
        bus.emit('match:sealed', {});
        notify(ctx, '¡Distrito sellado!', 'danger');
      }
    }
    // Daño por contaminación agrupado en golpes de ≥ damageStepS.
    const m = state.match;
    const p = state.player;
    if (m.contamination.active && p.alive && !state.missions.extraction.boarded) {
      const depth = contaminationDepth(p.pos.x, p.pos.z, m.contamination.radius);
      if (depth >= 0) {
        damageAcc += contaminationDps(depth) * dt;
        if (damageAcc >= CONTAMINATION.damageStepS) {
          ctx.player.damage(damageAcc, 'contamination');
          damageAcc = 0;
        }
        return;
      }
    }
    damageAcc = 0;
  }

  function tickContracts(dt: number): void {
    const p = state.player.pos;
    const relay = state.missions.relay;
    const res = tickRelay(state, dt, isInsideRelay(p.x, p.z));
    if (res !== 'idle') {
      progressAcc += dt;
      if (res === 'completed' || progressAcc >= 0.25) {
        progressAcc = 0;
        bus.emit('relay:progress', { seconds: relay.progress, required: MISSIONS.relay.requiredS, inside: relay.insideCircle });
      }
      if (res === 'completed') onRelayCompleted();
    }
    if (state.missions.warden.engaged && activateWardenContract(state)) updated('warden');

    const ex = state.missions.extraction;
    const heliPos = heli.info.position;
    const near = heli.info.landed && Math.hypot(p.x - heliPos.x, p.z - heliPos.z) <= MAP.lz.boardRadius;
    const holding = ctx.interactions.current?.id === boardItemId && ctx.input.isDown('interact');
    for (const ev of tickExtraction(state, dt, { near, holding })) onExtractionEvent(ev);
    if (ex.phase === 'boarding' || (lastBoardProgress > 0 && ex.boardProgress === 0)) {
      boardEmitAcc += dt;
      if (boardEmitAcc >= 0.1 || ex.boardProgress === 0) {
        boardEmitAcc = 0;
        bus.emit('extraction:boarding', { progress: ex.boardProgress });
      }
    }
    lastBoardProgress = ex.boardProgress;
  }

  function checkEnd(dt: number): void {
    if (!committed) {
      const ex = state.missions.extraction;
      let v: EndVerdict | null = diedFlag ? { result: 'lost', reason: 'dead' } : evaluateEnd(state);
      // El final por extracción espera a que el helicóptero termine de despegar.
      if (v && (v.reason === 'extracted' || v.reason === 'heli_left') && ex.phase !== 'departed') v = null;
      if (!v) return;
      committed = true;
      endVerdict = v;
      endTimer = v.reason === 'dead' ? TIMERS.endScreenDelayS : TIMERS.endDelayS;
      state.match.phase = v.result;
      state.match.endReason = v.reason;
      shop.close();
      return;
    }
    endTimer -= dt;
    if (!endEmitted && endTimer <= 0 && endVerdict) {
      endEmitted = true;
      bus.emit('flow:ended', { result: endVerdict.result, reason: endVerdict.reason });
    }
  }

  function updateFade(): void {
    const ex = state.missions.extraction;
    let o = 0;
    if (ex.boarded) {
      const p = ex.phase === 'departed' ? 1 : 1 - ex.departRemaining / MISSIONS.extraction.departDurationS;
      const t = Math.min(1, Math.max(0, (p - 0.35) / 0.6));
      o = t * t * (3 - 2 * t);
    }
    fadeMat.opacity = o;
    fade.visible = o > 0.001;
  }

  const api: MissionsApi = {
    get helicopter() {
      return heli.info;
    },
    openShop: (vendor) => shop.openNearest(vendor),
    closeShop: () => shop.close(),
    debugComplete(id) {
      if (state.match.phase !== 'playing') return;
      const needRelay = id === 'extraction' && state.missions.relay.status !== 'completed';
      if ((id === 'relay' || needRelay) && state.missions.relay.status !== 'completed') {
        if (!state.missions.relay.activated) onRelayActivated();
        completeRelay(state);
        onRelayCompleted();
      }
      if (id === 'warden') {
        if (onWardenKilled(state)) onWardenDone();
        else payAndAnnounce('warden');
      } else if (id === 'extraction') {
        const ex = state.missions.extraction;
        if (ex.phase === 'idle') callHeli();
        if (ex.phase === 'inbound') {
          ex.etaRemaining = 0;
          for (const ev of tickExtraction(state, 0, { near: false, holding: false })) onExtractionEvent(ev);
        }
        if (forceBoard(state)) {
          onExtractionEvent({ type: 'boarded' });
          onExtractionEvent({ type: 'departing', boarded: true });
        }
      } else if (id === 'relay') payAndAnnounce('relay');
    },
    update(dt) {
      if (!committed) {
        tickMatchFlow(dt);
        tickContracts(dt);
      }
      checkEnd(dt);
      shop.update();
      pickups.update(dt);
      heli.update(dt);
      markers.update(dt);
      updateFade();
    },
    dispose() {
      for (const c of cleanups) c();
      cleanups.length = 0;
      scope.dispose();
      shop.close();
      ctx.viewScene.remove(fade);
      fade.geometry.dispose();
      fadeMat.dispose();
      pickups.dispose();
      markers.dispose();
      heli.dispose();
      tex.dispose();
    },
  };
  return api;
}
