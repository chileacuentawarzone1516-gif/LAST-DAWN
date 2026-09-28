/**
 * createAudio(ctx): audio 100 % reactivo. Se suscribe al bus y lee ctx.state / ctx.camera /
 * ctx.missions.helicopter / ctx.interactions / ctx.enemies.list cada frame. Antes de unlock() no
 * existe AudioContext y los eventos se ignoran (sin sonido ni errores).
 */
import { MAP } from '../config';
import type { AudioApi, GameContext } from '../core/context';
import type { GameEvents } from '../core/events';
import type { EnemyType, Vec3 } from '../core/types';
import { createRng, damp } from '../core/util';
import { Ambience } from './ambience';
import { AudioEngine } from './engine';
import type { PlayOptions } from './engine';
import { createHeliLoop, createRelayLoop } from './loops';
import type { HeliLoop, RelayLoop } from './loops';
import { Music } from './music';
import {
  ALERT_WEIGHT, CombatMeter, STRIDE, StrideTracker, dopplerRatio, heartbeatParams, holdTickFreq, holdTickInterval,
  musicIntensity, stepIntensity, tunnelAmount,
} from './pure';
import { RECIPE_IDS } from './sfx';
import { dryId, gunId, reloadId } from './recipes/weapons';
import type { BusName } from './types';

/** Extensión para herramientas de dev/QA (los miembros extra son opcionales para el resto del juego). */
export interface AudioDevApi extends AudioApi {
  readonly engine: AudioEngine;
  readonly music: Music;
  readonly ambience: Ambience;
  readonly recipeIds: readonly string[];
  play(id: string, o?: PlayOptions): number;
  setBusVolume(bus: BusName, v: number): void;
  readonly muted: boolean;
  readonly masterVolume: number;
}

const THREAT: Record<string, number> = { perimeter: 1, warehouses: 2, refinery: 3, complex: 4 };
const HEAVY: ReadonlySet<EnemyType> = new Set<EnemyType>(['brute', 'warden']);

export function createAudio(ctx: GameContext): AudioDevApi {
  const engine = new AudioEngine(ctx.camera);
  const rng = createRng((Date.now() ^ 0x51ed) >>> 0);
  const music = new Music(engine, rng);
  const ambience = new Ambience(engine, rng);
  const combat = new CombatMeter();
  const strides = new StrideTracker();
  const scope = ctx.bus.scope();

  let heli: HeliLoop | null = null;
  let heliPanner: PannerNode | null = null;
  let heliAir: BiquadFilterNode | null = null;
  const heliPrev = { x: 0, y: 0, z: 0, has: false };
  let heliDoppler = 1;
  let relay: RelayLoop | null = null;
  let relayPanner: PannerNode | null = null;
  let contamStartT: number | null = null;
  let hordes = 0;
  let lastEnemyHitT = -1;
  let nextBeat = 0;
  let holdT = 0;
  let deathFade = 0;

  const bind = <K extends keyof GameEvents>(type: K, fn: (p: GameEvents[K]) => void): void => {
    scope.on(type, (p) => {
      if (!engine.ready) return;
      try {
        fn(p);
      } catch (e) {
        engine.reportError(e);
      }
    });
  };
  const play = (id: string, o?: PlayOptions): number => engine.play(id, o);

  // ── Flujo ────────────────────────────────────────────────────────────────
  bind('flow:started', () => {
    engine.cancelAll();
    combat.reset();
    strides.clear();
    contamStartT = null;
    hordes = 0;
    deathFade = 0;
    engine.setMuffle(0);
    stopLoops();
  });
  bind('flow:paused', () => engine.setMuffle(0.85, 0.12));
  bind('flow:resumed', () => engine.setMuffle(0, 0.4));
  bind('flow:ended', ({ result }) => {
    engine.setMuffle(result === 'won' ? 0 : 0.35, 0.8);
    play(result === 'won' ? 'stinger.won' : 'stinger.lost', { force: true });
  });
  for (const t of ['ui:startRequested', 'ui:resumeRequested', 'ui:restartRequested', 'ui:titleRequested'] as const) {
    bind(t, () => play('ui.click'));
  }

  // ── Jugador ──────────────────────────────────────────────────────────────
  bind('player:shot', (e) => {
    const w = e.weapon;
    play(gunId(w), { alt: e.suppressed });
    if (w === 'shotgun') play('gun.shotgun.pump', { delay: 0.38, group: 'pump' });
    combat.add(0.03);
  });
  bind('player:reloadStarted', (e) => {
    play(reloadId(e.weapon), { duration: e.durationS, group: 'reload' });
  });
  bind('player:dryFire', (e) => play(dryId(e.weapon)));
  bind('player:weaponSwitched', () => {
    engine.cancelGroup('reload');
    engine.cancelGroup('pump');
    play('weapon.switch');
  });
  bind('player:damaged', (e) => {
    combat.add(0.15);
    let pos: Vec3 | undefined;
    if (e.from) {
      const l = engine.listenerPos;
      const dx = e.from.x - l.x;
      const dz = e.from.z - l.z;
      const d = Math.hypot(dx, dz) || 1;
      pos = { x: l.x + (dx / d) * 1.5, y: l.y, z: l.z + (dz / d) * 1.5 };
    }
    const I = Math.min(1, e.amount / 40);
    let id = 'hurt.melee';
    if (e.source === 'contamination') id = 'hurt.toxic';
    else if (e.source === 'fall') id = 'hurt.fall';
    else if (e.source === 'spit') id = 'hurt.spit';
    else if (e.source === 'slam' || e.source === 'explosion') id = 'hurt.heavy';
    else if (e.armorDamage > 0) id = 'hurt.armor';
    play(id, { intensity: I, pos });
  });
  bind('player:healed', () => play('player.heal'));
  bind('player:plateStarted', (e) => play('plate.apply', { duration: e.durationS, group: 'plate' }));
  bind('player:plateUsed', () => play('plate.done'));
  bind('player:died', () => {
    engine.cancelGroup('plate');
    engine.cancelGroup('reload');
    play('player.death', { force: true });
    deathFade = 1;
    engine.setMuffle(0.8, 0.9);
  });
  bind('player:jumped', () => play('player.jump'));
  bind('player:landed', (e) => play('player.land', { intensity: Math.min(1, e.impact / 12) }));
  bind('player:footstep', (e) => {
    play(`step.${e.surface}`, { intensity: stepIntensity(e.crouched, e.sprinting, e.speed), key: 'step.player' });
  });
  bind('player:grenadeThrown', () => play('grenade.throw'));
  bind('player:hitConfirm', (e) => {
    if (e.helmet) play('hit.helmet');
    else if (e.zone === 'head') play('hit.head');
    else play(e.zone === 'limb' ? 'hit.limb' : 'hit.body');
    if (e.killed) play('hit.kill');
  });

  // ── Mundo / balística ───────────────────────────────────────────────────
  bind('bullet:impact', (e) => {
    if (e.surface === 'flesh' && engine.now - lastEnemyHitT < 0.08) return;
    play(`impact.${e.surface}`, { pos: e.point });
    if ((e.surface === 'metal' || e.surface === 'concrete') && rng() < (e.surface === 'metal' ? 0.35 : 0.12)) {
      play('impact.ricochet', { pos: e.point, delay: 0.03 });
    }
  });
  bind('grenade:bounce', (e) => play('grenade.bounce', { pos: e.pos }));
  bind('grenade:exploded', (e) => {
    const d = engine.distanceTo(e.pos);
    play('grenade.explode', { pos: e.pos, soundDelay: true, force: true });
    if (d < 26) {
      const k = 1 - d / 26;
      engine.duck('ambience', 0.25, 1.2, 3);
      engine.duck('music', 0.3, 1.2, 3);
      engine.stun(0.35 + 0.6 * k, 0.3, 2.5);
      play('fx.tinnitus', { intensity: k, gain: 0.4 + 0.6 * k });
    }
    combat.add(0.1);
  });

  // ── Enemigos ─────────────────────────────────────────────────────────────
  bind('enemy:alerted', (e) => combat.add(ALERT_WEIGHT[e.type] ?? 0.06));
  bind('enemy:vocal', (e) => {
    if (e.kind === 'idle' && rng() < 0.4) return;
    play(`vocal.${e.type}.${e.kind}`, { pos: e.pos });
  });
  bind('enemy:attack', (e) => {
    const id = e.kind === 'spit' ? 'attack.spit' : e.kind === 'slam' ? 'attack.slam' : `attack.melee.${e.type}`;
    play(id, { pos: e.pos });
  });
  bind('enemy:hit', (e) => {
    lastEnemyHitT = engine.now;
    if (e.helmetBroken) return;
    if (e.helmetHit) play('impact.helmet', { pos: e.point });
    else if (e.type === 'warden' && e.zone !== 'head') play('impact.armor', { pos: e.point });
    else play(e.zone === 'head' ? 'impact.head' : 'impact.flesh', { pos: e.point });
  });
  bind('enemy:died', (e) => {
    const id = e.type === 'warden' ? 'body.fall.warden' : HEAVY.has(e.type) ? 'body.fall.heavy' : 'body.fall';
    play(id, { pos: e.pos, delay: e.type === 'warden' ? 0.9 : 0.35 });
  });
  bind('warden:helmetBroken', (e) => play('warden.helmetBroken', { pos: e.pos, force: true }));
  bind('warden:roar', (e) => {
    play('warden.roar', { pos: e.pos, force: true });
    engine.duck('music', 0.5, 1, 2);
    combat.add(0.4);
  });

  // ── Botín / economía ────────────────────────────────────────────────────
  bind('pickup:collected', (e) => play(e.kind === 'cash' ? 'pickup.cash' : `pickup.${e.kind}`));
  bind('shop:opened', () => play('shop.open'));
  bind('shop:closed', () => play('shop.close'));
  bind('shop:purchase', () => play('shop.purchase'));
  bind('shop:denied', () => play('shop.denied'));
  bind('ui:notify', (e) => play(`ui.notify.${e.kind}`, { key: 'ui.notify', gain: 0.8 }));

  // ── Misiones ─────────────────────────────────────────────────────────────
  bind('mission:completed', () => play('mission.complete'));
  bind('relay:activated', () => play('relay.activated'));
  bind('horde:started', () => {
    hordes++;
    play('horde.sting', { force: true });
    combat.add(0.4);
  });
  bind('horde:ended', () => {
    hordes = Math.max(0, hordes - 1);
  });
  bind('extraction:called', () => play('radio.call'));
  bind('extraction:landed', () => play('extraction.landed', heli && ctx.missions.helicopter ? { pos: ctx.missions.helicopter.position } : undefined));
  bind('extraction:boarding', (e) => {
    if (e.progress < 0.05) play('extraction.boarding');
  });
  bind('extraction:departed', () => play('extraction.departed'));

  // ── Partida ──────────────────────────────────────────────────────────────
  bind('match:contaminationStarted', () => {
    contamStartT = ctx.state.match.elapsed;
    play('match.siren', { force: true });
  });
  bind('match:sealed', () => play('match.sealed', { force: true }));
  bind('match:warning', (e) => {
    play(e.secondsLeft <= 10 ? 'match.warningUrgent' : e.kind === 'seal' ? 'match.warning3' : 'match.warning2', { force: e.secondsLeft <= 10 });
  });
  bind('zone:entered', (e) => play(`zone.enter.${Math.min(4, Math.max(1, e.threat))}`));

  // ── Bucles ───────────────────────────────────────────────────────────────
  function stopLoops(): void {
    const ac = engine.ac;
    const t = ac ? ac.currentTime : 0;
    heli?.stop(t, 0.3);
    heli = null;
    relay?.stop(t, 0.3);
    relay = null;
    heliPrev.has = false;
  }

  function updateHeli(dt: number): void {
    const ac = engine.ac;
    const chain = engine.chain;
    if (!ac || !chain) return;
    const h = ctx.missions.helicopter;
    const on = !!h && (h.active || h.rotorSpeed > 0.02);
    if (!on || !h) {
      if (heli) {
        heli.stop(ac.currentTime, 1.2);
        heli = null;
        heliPrev.has = false;
      }
      return;
    }
    if (!heli) {
      heliPanner = engine.createPanner(420, false, 0.75, 14);
      heliAir = ac.createBiquadFilter();
      heliAir.type = 'lowpass';
      heli = createHeliLoop(ac, heliAir, ac.currentTime);
      if (heliPanner) {
        heliAir.connect(heliPanner);
        heliPanner.connect(chain.buses.sfx.input);
      } else {
        heliAir.connect(chain.buses.sfx.input);
      }
    }
    const p = h.position;
    const l = engine.listenerPos;
    const dist = Math.hypot(p.x - l.x, p.y - l.y, p.z - l.z);
    let vToward = 0;
    if (heliPrev.has && dt > 1e-4) {
      const vx = (p.x - heliPrev.x) / dt - engine.listenerVel.x;
      const vy = (p.y - heliPrev.y) / dt - engine.listenerVel.y;
      const vz = (p.z - heliPrev.z) / dt - engine.listenerVel.z;
      const ux = (l.x - p.x) / (dist || 1);
      const uy = (l.y - p.y) / (dist || 1);
      const uz = (l.z - p.z) / (dist || 1);
      vToward = vx * ux + vy * uy + vz * uz;
    }
    heliPrev.x = p.x;
    heliPrev.y = p.y;
    heliPrev.z = p.z;
    heliPrev.has = true;
    heliDoppler = damp(heliDoppler, dopplerRatio(vToward), 6, dt);
    if (heliPanner) engine.setPannerPos(heliPanner, p.x, p.y, p.z);
    const now = ac.currentTime;
    heliAir?.frequency.setTargetAtTime(Math.max(1500, 16000 * Math.exp(-dist / 160)), now, 0.1);
    const wash = Math.max(0, 1 - dist / 55);
    heli.set(h.rotorSpeed * (ctx.state.flow === 'paused' ? 0.3 : 1), heliDoppler, wash, now);
  }

  function updateRelay(): void {
    const ac = engine.ac;
    const chain = engine.chain;
    if (!ac || !chain) return;
    const r = ctx.state.missions.relay;
    const on = r.activated && r.status !== 'completed' && ctx.state.flow === 'playing';
    if (!on) {
      if (relay) {
        relay.stop(ac.currentTime, 0.8);
        relay = null;
      }
      return;
    }
    if (!relay) {
      relayPanner = engine.createPanner(90, false, 1, 6);
      relay = createRelayLoop(ac, relayPanner ?? chain.buses.sfx.input, ac.currentTime);
      if (relayPanner) {
        engine.setPannerPos(relayPanner, MAP.relay.x, 2.5, MAP.relay.z);
        relayPanner.connect(chain.buses.sfx.input);
      }
    }
    relay.set(r.progress / 55, r.insideCircle, ac.currentTime);
  }

  function updateEnemySteps(): void {
    strides.beginFrame();
    const p = ctx.state.player.pos;
    for (const e of ctx.enemies.list) {
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - p.x, e.position.z - p.z);
      if (d > (HEAVY.has(e.type) ? 55 : 28)) continue;
      if (strides.step(e.id, e.position.x, e.position.z, STRIDE[e.type] ?? 1.2)) {
        play(`step.enemy.${e.type}`, { pos: { x: e.position.x, y: 0.1, z: e.position.z } });
      }
    }
    strides.endFrame();
  }

  const api: AudioDevApi = {
    engine, music, ambience,
    recipeIds: RECIPE_IDS,
    get ready(): boolean {
      return engine.ready;
    },
    get muted(): boolean {
      return engine.isMuted;
    },
    get masterVolume(): number {
      return engine.levels.master;
    },
    play,
    setBusVolume: (bus, v) => engine.setBusVolume(bus, v),
    unlock: () => engine.unlock(),
    setMasterVolume: (v) => engine.setMasterVolume(v),
    setMuted: (m) => engine.setMuted(m),
    update(dt) {
      if (!engine.ready) {
        engine.update(dt);
        return;
      }
      const s = ctx.state;
      engine.update(dt);
      combat.update(dt);
      const playing = s.flow === 'playing';

      // apagado por vida baja / muerte (la pausa y el fin lo fijan sus eventos)
      if (playing && s.player.alive) {
        engine.setMuffle(tunnelAmount(s.player.hp / s.player.maxHp, true), 0.5);
      }
      if (!s.player.alive && deathFade > 0) deathFade = Math.max(0, deathFade - dt / 3);

      // ambiente y música
      const flowGain = playing ? (s.player.alive ? 1 : 0.3) : s.flow === 'paused' ? 0.35 : s.flow === 'title' ? 0.25 : 0;
      ambience.update(dt, s, flowGain);
      const threat = THREAT[s.player.zone] ?? 1;
      const sealFraction = contamStartT === null ? 0 : Math.min(1, (s.match.elapsed - contamStartT) / 270);
      const inten = musicIntensity({
        threat, combat: combat.level, contaminationS: contamStartT === null ? null : s.match.elapsed - contamStartT, sealFraction,
        hordeActive: hordes > 0, wardenEngaged: s.missions.warden.engaged && !s.missions.warden.killed,
        extractionActive: s.missions.extraction.phase === 'inbound' || s.missions.extraction.phase === 'landed',
      });
      music.update(dt, inten, playing && s.player.alive);

      if (playing) {
        updateHeli(dt);
        updateRelay();
        updateEnemySteps();

        // latido dirigido por la vida
        const hb = heartbeatParams(s.player.hp / s.player.maxHp, s.player.alive);
        const now = engine.now;
        if (hb.active && now >= nextBeat) {
          play('heart.beat', { intensity: hb.gain });
          nextBeat = now + 60 / hb.bpm;
        }
        if (!hb.active) nextBeat = 0;

        // tic de retención de interacción (tono creciente)
        const prog = ctx.interactions.progress;
        if (ctx.interactions.current && prog > 0.01) {
          holdT -= dt;
          if (holdT <= 0) {
            holdT = holdTickInterval(prog);
            play('ui.hold', { level: (holdTickFreq(prog) / 420 > 0 ? Math.log2(holdTickFreq(prog) / 420) / 1.6 : 0), key: 'ui.hold' });
          }
        } else {
          holdT = 0;
        }
      } else {
        updateHeli(dt);
      }
    },
    dispose() {
      scope.dispose();
      stopLoops();
      music.dispose();
      ambience.dispose();
      engine.dispose();
    },
  };
  return api;
}
