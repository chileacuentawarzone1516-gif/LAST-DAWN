/**
 * Módulo de enemigos: infectados (walker, runner, brute, spitter) y el Warden.
 * createEnemies(ctx) implementa EnemiesApi (raycast, applyDamage, explode, spawn, killAll) y añade
 * miembros opcionales de depuración (`stats`, `director`, `debug`).
 */
import * as THREE from 'three';
import { DIRECTOR, ENEMY_AI, GRENADE, MAP, WARDEN } from '../config';
import type { EnemiesApi, EnemyDamageInfo, EnemyHandle, EnemyRayHit, GameContext, MoveResult } from '../core/context';
import type { EnemyType, HitZone, Vec3 } from '../core/types';
import { clamp, createRng } from '../core/util';
import {
  createHitResult, explosionDamage, knockbackSpeed, resetLife, resolveHit, rollSpeed, rollStagger, scaleEnemyStats,
} from '../rules/enemies';
import { threatAt, threatOf } from '../rules/zones';
import { ACT, poseRig } from './animation';
import { hearNoise, updateEnemy } from './ai';
import { DebugDraw } from './debug';
import { Director } from './director';
import { Enemy, type AiSys } from './enemy';
import { FlowField, SpatialHash } from './flowfield';
import { hitOut, raySphere, rayRig } from './hitboxes';
import { ModelKit, N } from './models';
import { SpitPool } from './spit';

export interface EnemiesStats {
  updateMs: number;
  updateMsMax: number;
  simulated: number;
  drawn: number;
  drawClasses: number;
  corpses: number;
  flowMs: number;
  flowBuilds: number;
  flowCells: number;
}

/** Extras de desarrollo/QA (opcionales; el contrato EnemiesApi no cambia). */
export interface EnemiesDevApi extends EnemiesApi {
  readonly stats: EnemiesStats;
  readonly director: { ambientEnabled: boolean; activeHordes: number };
  readonly debug: { enabled: boolean };
  readonly warden: EnemyHandle | null;
  /** Estado de IA legible de un enemigo (etiquetas de depuración). */
  stateOf(enemy: EnemyHandle): string;
}

const CHEST: Vec3 = { x: 0, y: 0, z: 0 };
const LOS_B: Vec3 = { x: 0, y: 0, z: 0 };

export function createEnemies(ctx: GameContext): EnemiesDevApi {
  const rng = createRng(0x51a7e5);
  const kit = new ModelKit(ctx.scene, ctx.materials, false);
  const flow = new FlowField(ctx.world.nav);
  const hash = new SpatialHash(2.5, 512, DIRECTOR.maxAlive + 64);
  const spit = new SpitPool(ctx);
  const scope = ctx.bus.scope();
  const enemies: Enemy[] = [];
  const corpses: Enemy[] = [];
  const neighbors = new Int32Array(64);
  const hit = createHitResult();
  const frustum = new THREE.Frustum();
  const mtx = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  let nextId = 1;
  let frame = 0;
  let lastFlowT = -10;
  let flowPx = 1e9;
  let flowPz = 1e9;
  let lastIdleVocal = -10;
  let warden: Enemy | null = null;
  const stats: EnemiesStats = {
    updateMs: 0, updateMsMax: 0, simulated: 0, drawn: 0, drawClasses: 0, corpses: 0, flowMs: 0, flowBuilds: 0, flowCells: 0,
  };

  const sys: AiSys = {
    ctx, rng, flow, hash, spit, enemies, neighbors,
    dir: { x: 0, z: 0 },
    moveRes: { x: 0, z: 0, blockedX: false, blockedZ: false } as MoveResult,
    time: 0, px: 0, py: 0, pz: 0, pAlive: true, grace: false, losBudget: 0,
    vocal(e, kind) {
      if (kind === 'idle') {
        if (sys.time - lastIdleVocal < ENEMY_AI.vocal.globalGapS) return;
        lastIdleVocal = sys.time;
      } else if (kind === 'hurt') {
        if (e.hurtT > sys.time) return;
        e.hurtT = sys.time + 0.35;
      }
      ctx.bus.emit('enemy:vocal', { id: e.id, type: e.type, pos: { x: e.position.x, y: e.position.y, z: e.position.z }, kind });
    },
    attackEvent(e, kind) {
      ctx.bus.emit('enemy:attack', { id: e.id, type: e.type, pos: { x: e.position.x, y: e.position.y, z: e.position.z }, kind });
    },
    alerted(e) {
      ctx.bus.emit('enemy:alerted', { id: e.id, type: e.type, pos: { x: e.position.x, y: e.position.y, z: e.position.z } });
    },
    spawn: (type, x, z, opts) => spawnEnemy(type, x, z, opts),
    makeRoom,
    despawn,
  };
  const director = new Director(sys, rng);
  const debug = new DebugDraw(ctx, flow, enemies);

  function infectedAlive(): number {
    let n = 0;
    for (const e of enemies) if (e.type !== 'warden') n++;
    return n;
  }

  function spawnEnemy(
    type: EnemyType, x: number, z: number,
    opts: { forced?: boolean; pinned?: boolean; ambient?: boolean; threat?: number; hordeId?: string } = {},
  ): Enemy | null {
    if (type !== 'warden' && infectedAlive() >= DIRECTOR.maxAlive) return null;
    const e = new Enemy(type);
    e.id = nextId++;
    e.alive = true;
    e.threat = type === 'warden' ? 4 : opts.threat ?? threatAt(x, z);
    e.stats = scaleEnemyStats(type, e.threat);
    resetLife(e.life, type, e.threat);
    e.speed = rollSpeed(e.stats, rng);
    e.position.x = x;
    e.position.z = z;
    e.position.y = ctx.world.groundHeight(x, z, e.stats.radius, 0);
    e.yaw = rng() * Math.PI * 2;
    e.homeX = x;
    e.homeZ = z;
    e.lastX = x;
    e.lastZ = z;
    e.forced = !!opts.forced;
    e.pinned = !!opts.pinned;
    e.ambient = !!opts.ambient;
    e.hordeId = opts.hordeId ?? '';
    e.brainT = rng() * ENEMY_AI.brainTickS;
    e.vocalT = ENEMY_AI.vocal.idleGapS[0] + rng() * 6;
    e.strafe = rng() < 0.5 ? -1 : 1;
    e.rig = kit.acquire(type, rng);
    e.anim.reset(rng());
    if (type === 'warden') {
      e.state = 'guard';
      e.yaw = Math.PI;
    } else e.state = e.forced ? 'chase' : 'idle';
    if (e.forced) e.stateT = 0;
    enemies.push(e);
    ctx.bus.emit('enemy:spawned', {
      id: e.id, type, pos: { x, y: e.position.y, z }, zone: ctx.world.zoneAt(x, z),
    });
    return e;
  }

  function releaseRig(e: Enemy): void {
    kit.release(e.rig);
  }

  function despawn(e: Enemy): void {
    const i = enemies.indexOf(e);
    if (i >= 0) enemies.splice(i, 1);
    const c = corpses.indexOf(e);
    if (c >= 0) corpses.splice(c, 1);
    e.alive = false;
    e.state = 'dead';
    releaseRig(e);
  }

  function makeRoom(n: number): number {
    let free = DIRECTOR.maxAlive - infectedAlive();
    if (free >= n) return n;
    // Recicla ambientales tranquilos, empezando por los más lejanos.
    const cand = enemies.filter((e) => e.ambient && !e.pinned && (e.state === 'idle' || e.state === 'wander'));
    cand.sort((a, b) => Math.hypot(b.position.x - sys.px, b.position.z - sys.pz) - Math.hypot(a.position.x - sys.px, a.position.z - sys.pz));
    for (const e of cand) {
      if (free >= n) break;
      despawn(e);
      free++;
    }
    return Math.max(0, Math.min(n, free));
  }

  function toCorpse(e: Enemy): void {
    const i = enemies.indexOf(e);
    if (i >= 0) enemies.splice(i, 1);
    e.alive = false;
    e.state = 'dead';
    e.anim.dead = true;
    e.anim.deathT = 0;
    e.anim.deathDir = rng() < 0.6 ? 1 : -1;
    e.anim.deathRoll = (rng() - 0.5) * 0.5;
    e.anim.deathYaw = (rng() - 0.5) * 0.8;
    e.corpseT = 0;
    corpses.push(e);
    while (corpses.length > ENEMY_AI.corpse.max) {
      const old = corpses.shift()!;
      releaseRig(old);
    }
  }

  function damageEnemy(e: Enemy, amount: number, zone: HitZone, point: Vec3, normal: Vec3, dx: number, dz: number): void {
    if (!e.alive) return;
    const res = resolveHit(e.life, zone, amount, hit);
    if (res.applied <= 0 && !res.helmetHit) return;
    e.hitFlash = 0.12;
    e.anim.hitKick = 1;
    e.anim.hitSide = clamp(-Math.sin(e.yaw) * dz + Math.cos(e.yaw) * dx, -1, 1) > 0 ? 1 : -1;
    const dl = Math.hypot(dx, dz) || 1;
    const kb = knockbackSpeed(e.type, res.applied, e.life.maxHp);
    e.kx += (dx / dl) * kb;
    e.kz += (dz / dl) * kb;
    // Un impacto delata al jugador.
    if (e.type === 'warden') {
      e.engaged = true;
    } else if (e.state === 'idle' || e.state === 'wander' || e.state === 'investigate') {
      e.lastSeenX = sys.px;
      e.lastSeenZ = sys.pz;
      e.sinceSeen = 0;
      e.state = 'chase';
      e.stateT = 0;
      sys.alerted(e);
    }
    // El estado de la misión debe reflejar el impacto en el mismo instante que los eventos.
    if (e.type === 'warden') syncWardenState();
    const helmBroke = res.helmetBroken;
    const killed = res.killed;
    const headshot = res.headshotKill;
    const helmetHit = res.helmetHit;
    const applied = res.applied;
    const dur = rollStagger(e.type, res, rng);
    if (dur > 0 && !killed) {
      e.state = 'stagger';
      e.stateT = 0;
      e.atkT = dur;
      e.atkPhase = 0;
      e.anim.start(ACT.stagger, dur);
    }
    if (helmBroke) {
      const helm = kit.detachHelmet(e.rig);
      e.helmDetached = true;
      e.helmRest = false;
      e.helmVx = -Math.sin(e.yaw) * 2.5 + (rng() - 0.5) * 2;
      e.helmVz = -Math.cos(e.yaw) * 2.5 + (rng() - 0.5) * 2;
      e.helmVy = 5.5;
      e.helmSpin = 9;
      helm.updateMatrixWorld();
      ctx.bus.emit('warden:helmetBroken', { pos: { x: helm.position.x, y: helm.position.y, z: helm.position.z } });
      ctx.bus.emit('warden:roar', { pos: { x: e.position.x, y: e.position.y + 2, z: e.position.z } });
      sys.vocal(e, 'hurt');
    }
    ctx.bus.emit('enemy:hit', {
      id: e.id, type: e.type, pos: { x: e.position.x, y: e.position.y, z: e.position.z },
      point: { x: point.x, y: point.y, z: point.z }, normal: { x: normal.x, y: normal.y, z: normal.z },
      zone, damage: applied, killed, helmetHit, helmetBroken: helmBroke,
    });
    if (!killed) {
      sys.vocal(e, 'hurt');
      return;
    }
    sys.vocal(e, 'death');
    const dz2 = ctx.world.zoneAt(e.position.x, e.position.z);
    toCorpse(e);
    ctx.bus.emit('enemy:died', {
      id: e.id, type: e.type, pos: { x: e.position.x, y: e.position.y, z: e.position.z },
      zone: dz2, threat: threatOf(dz2), headshot,
    });
  }

  // — Eventos —
  scope
    .on('player:shot', (s) => {
      for (const e of enemies) {
        if (e.type === 'warden') {
          if (Math.hypot(e.position.x - s.origin.x, e.position.z - s.origin.z) < WARDEN.shotAlertRange) e.engaged = true;
        } else hearNoise(sys, e, s.origin.x, s.origin.z, s.noise, true);
      }
    })
    .on('grenade:exploded', (g) => {
      for (const e of enemies) hearNoise(sys, e, g.pos.x, g.pos.z, GRENADE.noise, false);
    })
    .on('horde:started', (h) => director.startHorde(h.id, h.center))
    .on('horde:ended', (h) => director.endHorde(h.id));

  // — Inicio: Warden y población inicial —
  {
    const p = ctx.player.position;
    sys.px = p.x; sys.py = p.y; sys.pz = p.z;
    warden = spawnEnemy('warden', MAP.complex.wardenSpawn.x, MAP.complex.wardenSpawn.z, { pinned: true });
    director.initialFill();
  }

  function poseEnemy(e: Enemy, dt: number): void {
    const a = e.anim;
    e.rig.flash = clamp(e.hitFlash / 0.12, 0, 1);
    if (a.dead) {
      e.rig.dim = clamp(e.corpseT / 3, 0, 1);
      const sinkStart = ENEMY_AI.corpse.lifetimeS - ENEMY_AI.corpse.sinkS;
      a.sink = e.corpseT > sinkStart ? ((e.corpseT - sinkStart) / ENEMY_AI.corpse.sinkS) * 0.6 : 0;
    }
    poseRig(e.rig, a, e.position.x, e.position.y, e.position.z, e.yaw, dt);
    e.poseFrame = frame;
  }

  function updateHelmet(e: Enemy, dt: number): void {
    if (!e.helmDetached || e.helmRest) return;
    const helm = e.rig.node(N.helm);
    e.helmVy -= 16 * dt;
    helm.position.x += e.helmVx * dt;
    helm.position.y += e.helmVy * dt;
    helm.position.z += e.helmVz * dt;
    helm.rotateX(e.helmSpin * dt);
    helm.rotateZ(e.helmSpin * 0.6 * dt);
    const gy = ctx.world.groundHeight(helm.position.x, helm.position.z, 0.2, e.position.y + 3) + 0.2;
    if (helm.position.y <= gy && e.helmVy < 0) {
      helm.position.y = gy;
      if (Math.abs(e.helmVy) > 2) {
        e.helmVy *= -0.32;
        e.helmVx *= 0.5;
        e.helmVz *= 0.5;
        e.helmSpin *= 0.5;
      } else {
        e.helmRest = true;
      }
    }
    helm.updateMatrixWorld();
  }

  function drawAll(dt: number): void {
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    mtx.copy(cam.matrixWorld).invert().premultiply(cam.projectionMatrix);
    frustum.setFromProjectionMatrix(mtx);
    const cx = cam.matrixWorld.elements[12]!;
    const cz = cam.matrixWorld.elements[14]!;
    kit.beginFrame();
    let drawn = 0;
    const one = (e: Enemy): void => {
      const p = e.position;
      const h = e.stats.height;
      const d = Math.hypot(p.x - cx, p.z - cz);
      if (d > ENEMY_AI.lod.drawM) return;
      sphere.center.set(p.x, p.y + h * 0.5, p.z);
      sphere.radius = h * 0.85 + 0.6;
      if (!frustum.intersectsSphere(sphere) && d > 3) return;
      const interval = d < ENEMY_AI.lod.fullM ? 1 : d < ENEMY_AI.lod.midM ? 2 : 3;
      e.lodT++;
      if (!e.anim.posed || e.lodT >= interval || e.anim.dead) {
        e.lodT = 0;
        const acc = Math.min(0.25, e.anim.acc);
        e.anim.acc = 0;
        poseEnemy(e, e.anim.dead ? dt : acc);
      }
      if (e.helmDetached) updateHelmet(e, dt);
      kit.draw(e.rig);
      kit.drawShadow(p.x, p.y, p.z, e.stats.radius * (e.anim.dead ? 1.5 : 1));
      drawn++;
    };
    for (const e of enemies) if (e.awake) one(e);
    for (const c of corpses) one(c);
    kit.endFrame();
    stats.drawn = drawn;
    stats.drawClasses = kit.visibleClasses;
  }

  function syncWardenState(): void {
    const w = ctx.state.missions.warden;
    w.spawned = true;
    if (warden) {
      w.engaged = warden.engaged;
      w.helmetBroken = warden.life.helmetBroken;
      w.hpFraction = warden.life.hp / warden.life.maxHp;
      w.helmetFraction = warden.life.helmetMaxHp > 0 ? warden.life.helmetHp / warden.life.helmetMaxHp : 0;
      if (warden.life.hp <= 0) w.killed = true;
    }
  }

  const api: EnemiesDevApi = {
    stats,
    director,
    debug,
    get warden() {
      return warden;
    },
    stateOf: (h) => (h as Enemy).state,
    get aliveCount() {
      return enemies.length;
    },
    get list() {
      return enemies as readonly EnemyHandle[];
    },

    raycast(origin, dir, maxDist): EnemyRayHit | null {
      let best: Enemy | null = null;
      let bestT = maxDist;
      let bz: HitZone = 'body';
      let bnx = 0, bny = 1, bnz = 0;
      for (const e of enemies) {
        const p = e.position;
        const h = e.stats.height;
        if (raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, p.x, p.y + h * 0.5, p.z, h * 0.75 + 0.5) < 0 && Math.hypot(origin.x - p.x, origin.z - p.z) > 1.5) continue;
        if (!e.anim.posed || frame - e.poseFrame > 3) {
          const acc = Math.min(0.25, e.anim.acc);
          e.anim.acc = 0;
          poseEnemy(e, acc);
        }
        const t = rayRig(e.rig, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, bestT);
        if (t >= 0 && t <= bestT) {
          bestT = t;
          best = e;
          bz = hitOut.zone;
          bnx = hitOut.nx; bny = hitOut.ny; bnz = hitOut.nz;
        }
      }
      if (!best) return null;
      return {
        enemy: best, zone: bz, distance: bestT,
        point: { x: origin.x + dir.x * bestT, y: origin.y + dir.y * bestT, z: origin.z + dir.z * bestT },
        normal: { x: bnx, y: bny, z: bnz },
      };
    },

    applyDamage(handle, info: EnemyDamageInfo): void {
      if (!(handle instanceof Enemy) || !handle.alive) return;
      damageEnemy(handle, info.amount, info.zone, info.point, info.normal, info.dir.x, info.dir.z);
    },

    explode(center, radius, maxDamage, minMult): void {
      for (const e of [...enemies]) {
        const p = e.position;
        CHEST.x = p.x; CHEST.y = p.y + e.stats.height * 0.55; CHEST.z = p.z;
        const dx = CHEST.x - center.x;
        const dy = CHEST.y - center.y;
        const dz = CHEST.z - center.z;
        const d = Math.max(0, Math.hypot(dx, dy, dz) - e.stats.radius);
        if (d > radius) continue;
        LOS_B.x = center.x; LOS_B.y = center.y + 0.3; LOS_B.z = center.z;
        if (!ctx.world.hasLineOfSight(LOS_B, CHEST)) continue;
        const dmg = explosionDamage(maxDamage, minMult, d, radius);
        if (dmg <= 0) continue;
        const l = Math.hypot(dx, dz) || 1;
        if (e.type !== 'warden') {
          const k = 7 * (1 - d / radius);
          e.kx += (dx / l) * k;
          e.kz += (dz / l) * k;
        }
        damageEnemy(e, dmg, 'body', CHEST, { x: dx / l, y: 0.3, z: dz / l }, dx, dz);
      }
    },

    spawn(type, x, z): EnemyHandle | null {
      if (type !== 'warden' && infectedAlive() >= DIRECTOR.maxAlive && makeRoom(1) < 1) return null;
      return spawnEnemy(type, x, z, { pinned: true });
    },

    killAll(): void {
      for (const e of [...enemies]) if (e.type !== 'warden') despawn(e);
      for (const c of [...corpses]) despawn(c);
    },

    update(dt): void {
      const t0 = performance.now();
      frame++;
      sys.time += dt;
      sys.grace = sys.time < DIRECTOR.spawnGraceS;
      const p = ctx.player.position;
      sys.px = p.x; sys.py = p.y; sys.pz = p.z;
      sys.pAlive = ctx.state.player.alive;
      sys.losBudget = ENEMY_AI.losPerFrame;

      // Campo de flujo hacia el jugador (sólo si alguien persigue).
      let need = false;
      for (const e of enemies) {
        if (e.state === 'chase' || e.state === 'attack') {
          need = true;
          break;
        }
      }
      if (need && sys.pAlive) {
        const moved = Math.hypot(p.x - flowPx, p.z - flowPz);
        const since = sys.time - lastFlowT;
        if (!flow.valid || (since >= ENEMY_AI.flow.rebuildS && moved > 0.5) || (moved > ENEMY_AI.flow.moveThresholdM && since > 0.12)) {
          flow.build(p.x, p.z, ENEMY_AI.flow.radiusM);
          lastFlowT = sys.time;
          flowPx = p.x;
          flowPz = p.z;
          stats.flowMs = flow.lastBuildMs;
          stats.flowBuilds = flow.builds;
          stats.flowCells = flow.cellsReached;
        }
      }

      director.update(dt);

      hash.clear();
      const n = enemies.length;
      for (let i = 0; i < n; i++) {
        const e = enemies[i]!;
        const d = Math.hypot(e.position.x - p.x, e.position.z - p.z);
        e.awake = e.type === 'warden' ? d < 150 || e.engaged : d <= DIRECTOR.simRadius;
        if (e.awake) hash.insert(i, e.position.x, e.position.z);
      }
      let sim = 0;
      for (let i = 0; i < n; i++) {
        const e = enemies[i]!;
        if (!e.awake || !e.alive) continue;
        sim++;
        updateEnemy(sys, e, dt);
        e.anim.acc += dt;
      }
      stats.simulated = sim;
      spit.update(dt);

      for (let i = corpses.length - 1; i >= 0; i--) {
        const c = corpses[i]!;
        c.corpseT += dt;
        if (c.type === 'warden' ? false : c.corpseT > ENEMY_AI.corpse.lifetimeS) {
          corpses.splice(i, 1);
          releaseRig(c);
        }
      }
      stats.corpses = corpses.length;
      drawAll(dt);
      syncWardenState();
      debug.update();
      const ms = performance.now() - t0;
      stats.updateMs += (ms - stats.updateMs) * 0.1;
      stats.updateMsMax = Math.max(ms, stats.updateMsMax * 0.995);
    },

    dispose(): void {
      scope.dispose();
      debug.dispose();
      spit.dispose();
      kit.dispose();
      enemies.length = 0;
      corpses.length = 0;
    },
  };
  return api;
}
