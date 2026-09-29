/**
 * IA de los enemigos: máquina de estados (idle/wander → investigar ruido → perseguir → atacar →
 * aturdido → muerto), percepción (visión con cono + LOS, oído), navegación por campo de flujo con
 * separación y deslizamiento, ataques (cuerpo a cuerpo, escupitajo, embestida, pisotón del Warden).
 * Sin asignaciones en el bucle: temporales de módulo.
 */
import { DIRECTOR, ENEMY_AI, WARDEN } from '../config';
import type { Vec3 } from '../core/types';
import { damp, wrapAngle } from '../core/util';
import { pickFromMix, summonsDue } from '../rules/director';
import { ACT } from './animation';
import { type AiSys, type Enemy } from './enemy';

const A: Vec3 = { x: 0, y: 0, z: 0 };
const B: Vec3 = { x: 0, y: 0, z: 0 };
const FROM: Vec3 = { x: 0, y: 0, z: 0 };
const HALF_CONE = Math.cos((ENEMY_AI.sightConeDeg * Math.PI) / 360);

const yawTo = (dx: number, dz: number): number => Math.atan2(-dx, -dz);

function turnTo(e: Enemy, target: number, rate: number, dt: number): void {
  const diff = wrapAngle(target - e.yaw);
  const m = rate * dt;
  e.yaw += diff < -m ? -m : diff > m ? m : diff;
}

/** Coseno entre el frente del enemigo y la dirección al punto. */
function facingDot(e: Enemy, dx: number, dz: number): number {
  const l = Math.hypot(dx, dz) || 1;
  return (-Math.sin(e.yaw) * dx - Math.cos(e.yaw) * dz) / l;
}

/** Mueve al enemigo (dirección unitaria dx,dz a velocidad `speed`), con separación, empuje y deslizamiento. */
function move(sys: AiSys, e: Enemy, dx: number, dz: number, speed: number, dt: number, turn = true): void {
  const p = e.position;
  let vx = dx * speed;
  let vz = dz * speed;
  if (speed > 0.01) {
    const n = sys.hash.query(p.x, p.z, sys.neighbors);
    for (let k = 0; k < n; k++) {
      const o = sys.enemies[sys.neighbors[k]!];
      if (!o || o === e || !o.alive) continue;
      const ox = p.x - o.position.x;
      const oz = p.z - o.position.z;
      const d = Math.hypot(ox, oz);
      const min = (e.stats.radius + o.stats.radius) * 1.15;
      if (d < min && d > 1e-4) {
        const w = ((min - d) / min) * ENEMY_AI.separationStrength * Math.max(1, speed);
        vx += (ox / d) * w;
        vz += (oz / d) * w;
      }
    }
  }
  vx += e.kx;
  vz += e.kz;
  const decay = Math.exp(-7 * dt);
  e.kx *= decay;
  e.kz *= decay;
  const world = sys.ctx.world;
  const r = world.moveCircle(p.x, p.z, vx * dt, vz * dt, e.stats.radius, p.y, p.y + e.stats.height, sys.moveRes);
  const moved = Math.hypot(r.x - p.x, r.z - p.z);
  p.x = r.x;
  p.z = r.z;
  const gh = world.groundHeight(p.x, p.z, e.stats.radius, p.y);
  p.y = Math.abs(gh - p.y) > 0.6 ? gh : damp(p.y, gh, 16, dt);
  const real = dt > 0 ? moved / dt : 0;
  e.anim.speed = damp(e.anim.speed, Math.min(real, speed * 1.1 + 0.4), 9, dt);
  if (turn && speed > 0.05) turnTo(e, yawTo(dx, dz), ENEMY_AI.turnRate * (e.type === 'brute' || e.type === 'warden' ? 0.6 : 1), dt);
  // Detección de atasco: quiere avanzar pero apenas se desplaza.
  if (speed > 0.3 && moved < speed * dt * 0.25) e.stuckT += dt;
  else e.stuckT = Math.max(0, e.stuckT - dt * 2);
}

function stand(sys: AiSys, e: Enemy, dt: number): void {
  move(sys, e, 0, 0, 0, dt, false);
  e.anim.speed = damp(e.anim.speed, 0, 8, dt);
}

/** Dirección de persecución hacia (x,z): directa con LOS cercana; si no, campo de flujo; si no, directa. */
function chaseDir(sys: AiSys, e: Enemy, tx: number, tz: number, out: { x: number; z: number }): void {
  const p = e.position;
  const dx = tx - p.x;
  const dz = tz - p.z;
  const d = Math.hypot(dx, dz) || 1;
  const direct = e.seesPlayer && d < 22 && sys.time > e.flowUntil;
  if (!direct && sys.flow.sample(p.x, p.z, out)) {
    return;
  }
  out.x = dx / d;
  out.z = dz / d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Percepción
// ─────────────────────────────────────────────────────────────────────────────
function beChase(sys: AiSys, e: Enemy): void {
  const wasCalm = e.state === 'idle' || e.state === 'wander' || e.state === 'investigate' || e.state === 'guard';
  if (wasCalm) {
    e.state = 'chase';
    e.stateT = 0;
    sys.alerted(e);
    sys.vocal(e, 'alert');
    if (e.type !== 'warden') {
      // Avisa a los vecinos cercanos.
      const r2 = ENEMY_AI.alertShareRadius * ENEMY_AI.alertShareRadius;
      for (const o of sys.enemies) {
        if (o === e || !o.alive || o.type === 'warden' || (o.state !== 'idle' && o.state !== 'wander')) continue;
        const dx = o.position.x - e.position.x;
        const dz = o.position.z - e.position.z;
        if (dx * dx + dz * dz < r2 && sys.rng() < 0.7) {
          o.state = 'investigate';
          o.stateT = 0;
          o.tx = sys.px;
          o.tz = sys.pz;
        }
      }
    }
  }
}

function brain(sys: AiSys, e: Enemy, elapsed: number): void {
  const ctx = sys.ctx;
  const chasing = e.state === 'chase' || e.state === 'attack' || e.state === 'telegraph' || e.state === 'charge' || e.state === 'recover' || e.state === 'stagger';
  if (!sys.pAlive || sys.grace) {
    if (chasing && !sys.pAlive) {
      e.state = 'idle';
      e.stateT = 0;
    }
    return;
  }
  const dx = sys.px - e.position.x;
  const dz = sys.pz - e.position.z;
  const d = Math.hypot(dx, dz);
  let sees = false;
  if (e.forced || (e.type === 'warden' && e.engaged)) {
    sees = true;
    if (sys.losBudget > 0) {
      sys.losBudget--;
      A.x = e.position.x; A.y = e.position.y + e.stats.height * 0.9; A.z = e.position.z;
      const eye = ctx.player.eye;
      B.x = eye.x; B.y = eye.y; B.z = eye.z;
      e.seesPlayer = ctx.world.hasLineOfSight(A, B);
    }
  } else {
    const ps = ctx.state.player;
    const sight = e.stats.sight * (chasing ? 1.35 : 1) * (ps.crouched ? ENEMY_AI.sightCrouchMult : ps.sprinting ? ENEMY_AI.sightSprintMult : 1);
    if (d <= sight && (chasing || d <= ENEMY_AI.senseRadius || facingDot(e, dx, dz) >= HALF_CONE) && sys.losBudget > 0) {
      sys.losBudget--;
      A.x = e.position.x; A.y = e.position.y + e.stats.height * 0.9; A.z = e.position.z;
      const eye = ctx.player.eye;
      B.x = eye.x; B.y = eye.y; B.z = eye.z;
      sees = ctx.world.hasLineOfSight(A, B);
    }
    e.seesPlayer = sees;
  }
  if (sees || e.forced) {
    e.sinceSeen = 0;
    e.lastSeenX = sys.px;
    e.lastSeenZ = sys.pz;
    if (e.type !== 'warden') beChase(sys, e);
  } else {
    e.sinceSeen += elapsed;
    if (e.state === 'chase' && e.sinceSeen > DIRECTOR.loseTargetS) {
      e.state = 'investigate';
      e.stateT = 0;
      e.tx = e.lastSeenX;
      e.tz = e.lastSeenZ;
    }
  }
}

/** Oído: un ruido en (x,z) con alcance `range` (ya × hearingMult se aplica aquí). */
export function hearNoise(sys: AiSys, e: Enemy, x: number, z: number, range: number, exactPlayer: boolean): void {
  if (!e.alive || e.type === 'warden' || sys.grace || !sys.pAlive) return;
  const d = Math.hypot(x - e.position.x, z - e.position.z);
  const r = range * e.stats.hearingMult;
  if (d > r) return;
  if (e.state === 'chase' || e.state === 'attack' || e.state === 'stagger' || e.state === 'telegraph' || e.state === 'charge') {
    e.sinceSeen = Math.min(e.sinceSeen, DIRECTOR.loseTargetS * 0.5);
    return;
  }
  if (exactPlayer && d < r * ENEMY_AI.hearingExactFrac) {
    e.lastSeenX = sys.px;
    e.lastSeenZ = sys.pz;
    e.sinceSeen = 0;
    e.state = 'idle';
    beChase(sys, e);
    e.state = 'chase';
    return;
  }
  const first = e.state === 'idle' || e.state === 'wander';
  e.state = 'investigate';
  e.stateT = 0;
  e.tx = x;
  e.tz = z;
  if (first) sys.alerted(e);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ataques
// ─────────────────────────────────────────────────────────────────────────────
function hurtPlayer(sys: AiSys, e: Enemy, dmg: number, src: 'melee' | 'spit' | 'slam'): void {
  FROM.x = e.position.x; FROM.y = e.position.y + 1; FROM.z = e.position.z;
  sys.ctx.player.damage(dmg, src, FROM);
}

function pushPlayer(sys: AiSys, e: Enemy, speed: number): void {
  const v = sys.ctx.player.velocity;
  const dx = sys.px - e.position.x;
  const dz = sys.pz - e.position.z;
  const l = Math.hypot(dx, dz) || 1;
  v.x += (dx / l) * speed;
  v.z += (dz / l) * speed;
}

function startMelee(sys: AiSys, e: Enemy, alt: number): void {
  e.state = 'attack';
  e.stateT = 0;
  e.atkPhase = 1;
  e.atkT = 0;
  e.atkKind = alt;
  const dur = e.type === 'warden' ? WARDEN.comboWindupS : e.stats.attackWindupS;
  e.anim.start(ACT.windup, dur, alt);
  sys.vocal(e, 'attack');
}

function startSpit(sys: AiSys, e: Enemy): void {
  e.state = 'attack';
  e.stateT = 0;
  e.atkPhase = 1;
  e.atkT = 0;
  e.atkKind = 9;
  e.anim.start(ACT.spitWind, e.stats.attackWindupS);
  sys.vocal(e, 'attack');
}

function updateAttack(sys: AiSys, e: Enemy, dt: number): void {
  const st = e.stats;
  const dx = sys.px - e.position.x;
  const dz = sys.pz - e.position.z;
  const d = Math.hypot(dx, dz);
  e.atkT += dt;
  stand(sys, e, dt);
  if (e.atkPhase === 1) {
    turnTo(e, yawTo(dx, dz), 4, dt);
    const windup = e.atkKind === 9 ? st.attackWindupS : e.type === 'warden' ? WARDEN.comboWindupS : st.attackWindupS;
    if (e.atkT < windup) return;
    e.atkPhase = 2;
    e.atkT = 0;
    if (e.atkKind === 9) {
      // Escupitajo con predicción parcial del movimiento del jugador.
      const vel = sys.ctx.player.velocity;
      const t = Math.max(0.35, d / ENEMY_AI.spitter.projectileSpeed) * ENEMY_AI.spitter.leadFactor;
      const yaw = e.yaw;
      sys.spit.launch(
        e.position.x - Math.sin(yaw) * 0.35, e.position.y + st.height * 0.88, e.position.z - Math.cos(yaw) * 0.35,
        sys.px + vel.x * t, sys.py + 1.15, sys.pz + vel.z * t, st.damage,
      );
      sys.attackEvent(e, 'spit');
      e.anim.start(ACT.spitThrow, 0.5);
      e.cooldown = st.attackCooldownS;
    } else {
      const reach = st.attackRange + 0.35;
      if (sys.pAlive && d <= reach && facingDot(e, dx, dz) > 0.3 && Math.abs(sys.py - e.position.y) < 1.7) {
        hurtPlayer(sys, e, st.damage, 'melee');
      }
      sys.attackEvent(e, 'melee');
      e.anim.start(ACT.strike, 0.5, e.atkKind);
      e.cooldown = e.type === 'warden' && e.combo < WARDEN.comboHits - 1 ? WARDEN.comboGapS : st.attackCooldownS;
    }
    return;
  }
  // Recuperación tras el golpe.
  const rec = e.type === 'warden' && e.combo < WARDEN.comboHits - 1 ? WARDEN.comboGapS : 0.42;
  if (e.atkT >= rec) {
    e.atkPhase = 0;
    e.anim.clearAct();
    if (e.type === 'warden' && e.combo < WARDEN.comboHits - 1 && sys.pAlive && d <= st.attackRange + 0.8) {
      e.combo++;
      e.cooldown = 0;
      startMelee(sys, e, e.combo % 2);
      return;
    }
    e.combo = 0;
    e.state = 'chase';
    e.stateT = 0;
  }
}

/** Telegrafía + embestida (bruto y Warden). */
function startCharge(sys: AiSys, e: Enemy): void {
  e.state = 'telegraph';
  e.telegraphKind = 1;
  e.stateT = 0;
  const dur = e.type === 'warden' ? WARDEN.chargeTelegraphS : ENEMY_AI.brute.telegraphS;
  e.anim.start(ACT.chargeTele, dur);
  sys.vocal(e, 'alert');
}

function startSlam(sys: AiSys, e: Enemy): void {
  e.state = 'telegraph';
  e.telegraphKind = 2;
  e.stateT = 0;
  e.anim.start(ACT.slamWind, WARDEN.slamTelegraphS);
  sys.vocal(e, 'attack');
}

function updateTelegraph(sys: AiSys, e: Enemy, dt: number): void {
  const dx = sys.px - e.position.x;
  const dz = sys.pz - e.position.z;
  stand(sys, e, dt);
  const w = e.type === 'warden';
  if (e.telegraphKind === 1) {
    turnTo(e, yawTo(dx, dz), 3, dt);
    const dur = w ? WARDEN.chargeTelegraphS : ENEMY_AI.brute.telegraphS;
    if (e.stateT >= dur) {
      const l = Math.hypot(dx, dz) || 1;
      e.chargeX = dx / l;
      e.chargeZ = dz / l;
      e.state = 'charge';
      e.stateT = 0;
      e.anim.start(ACT.charge, 1);
    }
  } else if (e.stateT >= WARDEN.slamTelegraphS) {
    // Pisotón en área con caída lineal.
    e.state = 'recover';
    e.stateT = 0;
    e.telegraphKind = 0;
    e.slamCd = WARDEN.slamCooldownS;
    e.anim.start(ACT.slamHit, 0.9);
    sys.attackEvent(e, 'slam');
    const d = Math.hypot(dx, dz);
    if (sys.pAlive && d < WARDEN.slamRadius && sys.py - e.position.y < 0.9) {
      hurtPlayer(sys, e, WARDEN.slamDamage * (1 - 0.65 * (d / WARDEN.slamRadius)) , 'slam');
    }
    sys.ctx.fx.burst('dust', e.position, undefined, 3);
  }
}

function updateCharge(sys: AiSys, e: Enemy, dt: number): void {
  const w = e.type === 'warden';
  const spd = w ? WARDEN.chargeSpeed : e.speed * ENEMY_AI.brute.speedMult;
  const dur = w ? WARDEN.chargeDurationS : ENEMY_AI.brute.durationS;
  const px0 = e.position.x;
  const pz0 = e.position.z;
  move(sys, e, e.chargeX, e.chargeZ, spd, dt, false);
  turnTo(e, yawTo(e.chargeX, e.chargeZ), 9, dt);
  e.anim.speed = spd;
  const dxp = sys.px - e.position.x;
  const dzp = sys.pz - e.position.z;
  const d = Math.hypot(dxp, dzp);
  const moved = Math.hypot(e.position.x - px0, e.position.z - pz0);
  let end = e.stateT >= dur;
  if (sys.pAlive && d < e.stats.radius + 0.75 && Math.abs(sys.py - e.position.y) < 1.7) {
    hurtPlayer(sys, e, w ? WARDEN.chargeDamage : e.stats.damage * ENEMY_AI.brute.damageMult, 'melee');
    pushPlayer(sys, e, ENEMY_AI.brute.knockback);
    sys.attackEvent(e, 'melee');
    end = true;
  } else if (e.stateT > 0.25 && moved < spd * dt * 0.35) {
    end = true; // se estrella contra un obstáculo
  }
  if (end) {
    e.state = 'recover';
    e.stateT = 0;
    e.chargeCd = w ? WARDEN.chargeCooldownS : ENEMY_AI.brute.cooldownS;
    e.anim.start(ACT.recover, w ? WARDEN.chargeRecoverS : ENEMY_AI.brute.recoverS);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Warden: refuerzos
// ─────────────────────────────────────────────────────────────────────────────
function wardenSummon(sys: AiSys, e: Enemy): void {
  e.state = 'roar';
  e.stateT = 0;
  e.anim.start(ACT.roar, WARDEN.summonRoarS);
  sys.ctx.bus.emit('warden:roar', { pos: { x: e.position.x, y: e.position.y + 2, z: e.position.z } });
  sys.vocal(e, 'alert');
  const n = sys.makeRoom(WARDEN.summonCount);
  for (let i = 0; i < n; i++) {
    const a = sys.rng() * Math.PI * 2;
    const r = 5 + sys.rng() * 4;
    let x = e.position.x + Math.cos(a) * r;
    let z = e.position.z + Math.sin(a) * r;
    if (!sys.flow.isWalkable(x, z)) {
      x = e.position.x + Math.cos(a) * 3;
      z = e.position.z + Math.sin(a) * 3;
    }
    sys.spawn(pickFromMix(sys.rng, WARDEN.summonMix, 4), x, z, { forced: true, threat: 4 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bucle principal por enemigo
// ─────────────────────────────────────────────────────────────────────────────
export function updateEnemy(sys: AiSys, e: Enemy, dt: number): void {
  e.stateT += dt;
  if (e.cooldown > 0) e.cooldown -= dt;
  if (e.chargeCd > 0) e.chargeCd -= dt;
  if (e.slamCd > 0) e.slamCd -= dt;
  if (e.hitFlash > 0) e.hitFlash -= dt;
  e.brainT -= dt;
  if (e.brainT <= 0) {
    brain(sys, e, ENEMY_AI.brainTickS);
    e.brainT = ENEMY_AI.brainTickS * (0.8 + sys.rng() * 0.4);
  }
  const st = e.stats;
  const p = e.position;
  const dx = sys.px - p.x;
  const dz = sys.pz - p.z;
  const d = Math.hypot(dx, dz);
  const dir = sys.dir;
  const warden = e.type === 'warden';
  e.anim.aggroTarget = e.state === 'chase' || e.state === 'attack' ? 1 : e.state === 'investigate' ? 0.45 : 0;

  // Warden: despertar, correa y refuerzos.
  if (warden && e.state !== 'dead') {
    if (!e.engaged && sys.pAlive && d < WARDEN.aggroRange) e.engaged = true;
    if (e.engaged && e.state === 'guard') {
      e.state = 'chase';
      e.stateT = 0;
      sys.alerted(e);
      e.anim.start(ACT.roar, 1.1);
      sys.ctx.bus.emit('warden:roar', { pos: { x: p.x, y: p.y + 2, z: p.z } });
      e.state = 'roar';
    }
    if (e.engaged && e.state !== 'roar' && e.state !== 'stagger' && e.state !== 'guard') {
      const due = summonsDue(e.life.hp / e.life.maxHp, e.summonsDone);
      if (due > 0) {
        e.summonsDone += due;
        wardenSummon(sys, e);
      }
    }
    if (e.engaged && d > WARDEN.leashRange) {
      e.leashT += dt;
      if (e.leashT > 8) {
        e.engaged = false;
        e.state = 'guard';
        e.leashT = 0;
      }
    } else e.leashT = 0;
  }

  switch (e.state) {
    case 'guard': {
      stand(sys, e, dt);
      e.yaw = Math.PI + 0.45 * Math.sin(sys.time * 0.35);
      break;
    }
    case 'idle': {
      stand(sys, e, dt);
      e.vocalT -= dt;
      if (e.vocalT <= 0) {
        e.vocalT = ENEMY_AI.vocal.idleGapS[0] + sys.rng() * (ENEMY_AI.vocal.idleGapS[1] - ENEMY_AI.vocal.idleGapS[0]);
        if (d < ENEMY_AI.vocal.hearRangeM) sys.vocal(e, 'idle');
      }
      if (e.stateT > 3 + (e.anim.seed * 6)) {
        // Elige un punto de deambulación cercano al origen.
        const a = sys.rng() * Math.PI * 2;
        const r = 3 + sys.rng() * 7;
        const wx = e.homeX + Math.cos(a) * r;
        const wz = e.homeZ + Math.sin(a) * r;
        if (sys.flow.isWalkable(wx, wz)) {
          e.tx = wx;
          e.tz = wz;
          e.state = 'wander';
          e.stateT = 0;
        } else e.stateT = 0;
      }
      break;
    }
    case 'wander': {
      const tdx = e.tx - p.x;
      const tdz = e.tz - p.z;
      const td = Math.hypot(tdx, tdz);
      if (td < 1 || e.stateT > 14 || e.stuckT > 1) {
        e.state = 'idle';
        e.stateT = 0;
        e.stuckT = 0;
        stand(sys, e, dt);
      } else move(sys, e, tdx / td, tdz / td, st.wanderSpeed, dt);
      break;
    }
    case 'investigate': {
      const tdx = e.tx - p.x;
      const tdz = e.tz - p.z;
      const td = Math.hypot(tdx, tdz);
      if (td < 1.6 || e.stateT > ENEMY_AI.investigateS || e.stuckT > 1.2) {
        e.state = 'idle';
        e.homeX = p.x;
        e.homeZ = p.z;
        e.stateT = 0;
        e.stuckT = 0;
        stand(sys, e, dt);
      } else move(sys, e, tdx / td, tdz / td, Math.max(st.wanderSpeed * 1.8, e.speed * 0.5), dt);
      break;
    }
    case 'chase': {
      if (!sys.pAlive) {
        e.state = 'idle';
        break;
      }
      if (e.stuckT > 0.8) {
        e.flowUntil = sys.time + 1.8;
        e.stuckT = 0;
      }
      let speed = e.speed;
      if (e.type === 'spitter') {
        const inBand = d >= ENEMY_AI.spitter.minRange && d <= ENEMY_AI.spitter.maxRange;
        if (d < ENEMY_AI.spitter.minRange) {
          // Retrocede manteniendo la distancia (de cara al jugador).
          move(sys, e, -dx / d, -dz / d, speed * 0.85, dt, false);
          turnTo(e, yawTo(dx, dz), ENEMY_AI.turnRate, dt);
        } else if (inBand) {
          const sx = -dz / d * e.strafe;
          const sz = dx / d * e.strafe;
          move(sys, e, sx, sz, speed * 0.3, dt, false);
          turnTo(e, yawTo(dx, dz), ENEMY_AI.turnRate, dt);
          if (e.stateT % 4 < dt) e.strafe = -e.strafe;
        } else {
          chaseDir(sys, e, sys.px, sys.pz, dir);
          move(sys, e, dir.x, dir.z, speed, dt);
        }
        if (e.cooldown <= 0 && d <= ENEMY_AI.spitter.maxRange + 2 && (e.seesPlayer || d < 8) && facingDot(e, dx, dz) > 0.85) startSpit(sys, e);
        break;
      }
      if (warden) speed *= e.enraged ? WARDEN.enrageSpeedMult : 1;
      // Decisiones especiales de bruto / Warden.
      if (e.type === 'brute' && e.chargeCd <= 0 && e.seesPlayer && d > ENEMY_AI.brute.chargeMinRange && d < ENEMY_AI.brute.chargeMaxRange && facingDot(e, dx, dz) > 0.7) {
        startCharge(sys, e);
        break;
      }
      if (warden) {
        if (e.slamCd <= 0 && d < WARDEN.slamTriggerRange) {
          startSlam(sys, e);
          break;
        }
        if (e.chargeCd <= 0 && d > WARDEN.chargeMinRange && d < WARDEN.chargeMaxRange && e.seesPlayer) {
          startCharge(sys, e);
          break;
        }
      }
      if (d <= st.attackRange * 0.92 && e.cooldown <= 0 && Math.abs(sys.py - p.y) < 1.7 && facingDot(e, dx, dz) > 0.55) {
        e.combo = 0;
        startMelee(sys, e, 0);
        break;
      }
      if (d > st.attackRange * 0.7) {
        chaseDir(sys, e, sys.px, sys.pz, dir);
        move(sys, e, dir.x, dir.z, speed, dt);
      } else {
        turnTo(e, yawTo(dx, dz), ENEMY_AI.turnRate, dt);
        stand(sys, e, dt);
      }
      break;
    }
    case 'attack':
      updateAttack(sys, e, dt);
      break;
    case 'telegraph':
      updateTelegraph(sys, e, dt);
      break;
    case 'charge':
      updateCharge(sys, e, dt);
      break;
    case 'recover': {
      stand(sys, e, dt);
      const dur = e.anim.actDur;
      if (e.stateT >= dur) {
        e.state = 'chase';
        e.stateT = 0;
        e.anim.clearAct();
      }
      break;
    }
    case 'roar': {
      stand(sys, e, dt);
      turnTo(e, yawTo(dx, dz), 2, dt);
      if (e.stateT >= e.anim.actDur) {
        e.state = 'chase';
        e.stateT = 0;
        e.anim.clearAct();
      }
      break;
    }
    case 'stagger': {
      move(sys, e, 0, 0, 0, dt, false);
      if (e.stateT >= e.atkT) {
        if (warden) e.enraged = true;
        e.state = sys.pAlive ? 'chase' : 'idle';
        e.stateT = 0;
        e.atkPhase = 0;
        e.anim.clearAct();
        if (sys.pAlive) {
          e.lastSeenX = sys.px;
          e.lastSeenZ = sys.pz;
          e.sinceSeen = 0;
        }
      }
      break;
    }
    default:
      break;
  }
  // Hacia el jugador con daño reciente o horda: nunca pierde el objetivo mientras haya `forced`.
  if (e.forced && e.state === 'idle' && sys.pAlive) {
    e.state = 'chase';
    e.stateT = 0;
  }
}
