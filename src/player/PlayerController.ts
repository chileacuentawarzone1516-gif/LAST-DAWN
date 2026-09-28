/**
 * Controlador FPS: mirar, moverse, saltar, agacharse, gravedad, escalones, caída, cabeceo de
 * cámara, retroceso, sacudidas y cámara de muerte. Sin asignaciones en el bucle caliente.
 */
import * as THREE from 'three';
import { PLAYER } from '../config';
import type { GameContext, MoveResult } from '../core/context';
import type { DamageSource } from '../core/types';
import { clamp, damp, degToRad } from '../core/util';
import { fallDamage } from '../rules/combat';

export interface MoveMods {
  speedMult: number;
  sprintBlocked: boolean;
  sensMult: number;
  fov: number;
}

const PITCH_MAX = degToRad(88);

export class PlayerController {
  readonly position = new THREE.Vector3();
  readonly eye = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, -1);
  readonly right = new THREE.Vector3(1, 0, 0);
  readonly up = new THREE.Vector3(0, 1, 0);
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  alive = true;
  controlEnabled = true;
  grounded = true;
  crouched = false;
  sprinting = false;
  speed01 = 0;
  bobPhase = 0;
  bobAmp = 0;
  sprint01 = 0;
  yawVel = 0;
  pitchVel = 0;
  /** Retroceso de cámara (rad) actual y objetivo. */
  private rp = 0;
  private ry = 0;
  private rpT = 0;
  private ryT = 0;
  private sinceKick = 9;
  private eyeH: number = PLAYER.eyeHeight;
  private stepOff = 0;
  private landDip = 0;
  private landV = 0;
  private flinchRoll = 0;
  private flinchRollV = 0;
  private flinchPitch = 0;
  private trauma = 0;
  private vy = 0;
  private coyote = 0;
  private jumpBuf = 0;
  private strideAcc = 0;
  private stepCount = 0;
  private time = 0;
  private deathT = 0;
  private deathRoll = 0;
  private strafeRoll = 0;
  private fovCur = 0;
  private readonly res: MoveResult = { x: 0, z: 0, blockedX: false, blockedZ: false };
  private readonly stepPos = { x: 0, y: 0, z: 0 };
  private readonly footPayload = { surface: 'asphalt' as const, speed: 0, crouched: false, sprinting: false, pos: this.stepPos };
  private readonly payload: { surface: import('../core/types').SurfaceKind; speed: number; crouched: boolean; sprinting: boolean; pos: { x: number; y: number; z: number } } = this.footPayload;

  constructor(private readonly ctx: GameContext, private readonly damageFn: (a: number, s: DamageSource) => void) {
    this.syncFromState();
    this.fovCur = PLAYER.fov;
  }

  /** Recoge posición/yaw del estado (arranque o reinicio de partida). */
  syncFromState(): void {
    const p = this.ctx.state.player;
    this.yaw = p.yaw;
    this.pitch = 0;
    this.position.set(p.pos.x, p.pos.y, p.pos.z);
    this.velocity.set(0, 0, 0);
    this.vy = 0;
    this.alive = p.alive;
    this.crouched = false;
    this.eyeH = PLAYER.eyeHeight;
    this.deathT = 0;
    this.rp = this.ry = this.rpT = this.ryT = 0;
    this.stepOff = 0;
  }

  teleport(x: number, z: number, yaw?: number): void {
    const w = this.ctx.world;
    this.position.set(x, w.groundHeight(x, z, PLAYER.radius, 0), z);
    this.velocity.set(0, 0, 0);
    this.vy = 0;
    this.grounded = true;
    this.stepOff = 0;
    if (yaw !== undefined) this.yaw = yaw;
  }

  /** Patada de cámara (grados). */
  kick(pitchDeg: number, yawDeg: number, maxP: number, maxY: number): void {
    this.rpT = Math.min(degToRad(maxP), this.rpT + degToRad(pitchDeg));
    this.ryT = clamp(this.ryT + degToRad(yawDeg), -degToRad(maxY), degToRad(maxY));
    this.sinceKick = 0;
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  flinch(side: number): void {
    this.flinchRollV += side * 0.35;
    this.flinchPitch = -0.03;
  }

  die(side: number): void {
    this.alive = false;
    this.deathT = 0.0001;
    this.deathRoll = (side >= 0 ? 1 : -1) * 1.15;
    this.sprinting = false;
  }

  private canStand(): boolean {
    const p = this.position;
    const r = this.ctx.world.moveCircle(p.x, p.z, 0, 0, PLAYER.radius, p.y, p.y + PLAYER.height, this.res);
    return Math.abs(r.x - p.x) < 1e-3 && Math.abs(r.z - p.z) < 1e-3;
  }

  simulate(dt: number, m: MoveMods, recoilRecover: number, recoilDelay: number): void {
    const { ctx } = this;
    const input = ctx.input;
    const w = ctx.world;
    const active = this.alive && this.controlEnabled && ctx.state.flow === 'playing' && dt > 0;
    this.time += dt;
    if (dt <= 0) return;

    // Mirada
    const prevYaw = this.yaw;
    const prevPitch = this.pitch;
    if (active) {
      const sens = PLAYER.mouseSensitivity * m.sensMult;
      this.yaw -= input.lookDX * sens;
      this.pitch = clamp(this.pitch - input.lookDY * sens, -PITCH_MAX, PITCH_MAX);
    }
    this.yawVel = clamp((this.yaw - prevYaw) / dt, -12, 12);
    this.pitchVel = clamp((this.pitch - prevPitch) / dt, -12, 12);

    // Postura
    if (active && input.wasPressed('crouch')) {
      if (!this.crouched) this.crouched = true;
      else if (this.canStand()) this.crouched = false;
    }
    const f = active ? (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0) : 0;
    const s = active ? (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0) : 0;
    let sprint = active && input.isDown('sprint') && f > 0 && !m.sprintBlocked;
    if (sprint && this.crouched) {
      if (this.canStand()) this.crouched = false;
      else sprint = false;
    }
    this.sprinting = sprint;

    // Salto
    this.jumpBuf = active && input.wasPressed('jump') ? PLAYER.jumpBufferS : Math.max(0, this.jumpBuf - dt);
    this.coyote = this.grounded ? PLAYER.coyoteS : Math.max(0, this.coyote - dt);
    if (active && this.jumpBuf > 0 && this.coyote > 0) {
      if (this.crouched && this.canStand()) this.crouched = false;
      if (!this.crouched) {
        this.vy = PLAYER.jumpSpeed;
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuf = 0;
        ctx.bus.emit('player:jumped', {});
      }
    }

    // Velocidad horizontal
    const base = this.crouched ? PLAYER.crouchSpeed : sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    const speed = base * m.speedMult;
    let len = Math.hypot(f, s);
    if (len > 1) len = 1;
    const inv = len > 0 ? len / Math.hypot(f, s) : 0;
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const tx = (-sy * f + cy * s) * inv * speed;
    const tz = (-cy * f - sy * s) * inv * speed;
    const v = this.velocity;
    if (this.grounded || len > 0) {
      const acc = PLAYER.accel * (this.grounded ? 1 : PLAYER.airControl) * dt;
      const dx = tx - v.x;
      const dz = tz - v.z;
      const dl = Math.hypot(dx, dz);
      if (dl <= acc) {
        v.x = tx;
        v.z = tz;
      } else {
        v.x += (dx / dl) * acc;
        v.z += (dz / dl) * acc;
      }
    }
    const px = this.position.x;
    const pz = this.position.z;
    const h = this.crouched ? PLAYER.crouchHeight : PLAYER.height;
    w.moveCircle(px, pz, v.x * dt, v.z * dt, PLAYER.radius, this.position.y, this.position.y + h, this.res);
    if (this.res.blockedX) v.x = 0;
    if (this.res.blockedZ) v.z = 0;
    this.position.x = this.res.x;
    this.position.z = this.res.z;
    const moved = Math.hypot(this.res.x - px, this.res.z - pz);
    const hs = moved / dt;
    this.speed01 = clamp(hs / PLAYER.walkSpeed, 0, 1.6);

    // Vertical
    const y0 = this.position.y;
    const gh = w.groundHeight(this.position.x, this.position.z, PLAYER.radius, y0);
    if (this.grounded) {
      if (gh >= y0 - PLAYER.stepHeight) {
        if (Math.abs(gh - y0) > 1e-4) this.stepOff += y0 - gh;
        this.position.y = gh;
      } else {
        this.grounded = false;
        this.vy = 0;
      }
    }
    if (!this.grounded) {
      this.vy -= PLAYER.gravity * dt;
      let ny = y0 + this.vy * dt;
      if (this.vy > 0) {
        const hit = w.raycast({ x: this.position.x, y: y0 + h, z: this.position.z }, { x: 0, y: 1, z: 0 }, this.vy * dt + 0.05);
        if (hit) this.vy = 0;
      }
      if (this.vy <= 0 && ny <= gh) {
        ny = gh;
        this.land(-this.vy);
        this.vy = 0;
        this.grounded = true;
      }
      this.position.y = ny;
    }
    v.y = this.vy;

    // Pasos
    if (this.grounded && moved > 0) {
      const stride = this.crouched ? PLAYER.strideCrouch : sprint ? PLAYER.strideSprint : PLAYER.strideWalk;
      this.strideAcc += moved;
      if (this.strideAcc >= stride) {
        this.strideAcc -= stride;
        this.stepCount++;
        const p = this.payload;
        this.stepPos.x = this.position.x;
        this.stepPos.y = this.position.y;
        this.stepPos.z = this.position.z;
        p.surface = w.surfaceAt(this.position.x, this.position.z) as 'asphalt';
        p.speed = hs;
        p.crouched = this.crouched;
        p.sprinting = sprint;
        ctx.bus.emit('player:footstep', p);
      }
    }
    this.bobPhase = (this.stepCount + this.strideAcc / (this.crouched ? PLAYER.strideCrouch : PLAYER.strideWalk)) * Math.PI;
    this.bobAmp = damp(this.bobAmp, this.grounded ? clamp(hs / PLAYER.walkSpeed, 0, 1.4) : 0, 10, dt);
    this.sprint01 = damp(this.sprint01, sprint ? 1 : 0, 8, dt);
    this.strafeRoll = damp(this.strafeRoll, -(s * inv) * 0.018 * (hs > 0.5 ? 1 : 0), 8, dt);

    // Altura de ojos, escalón, aterrizaje
    this.eyeH = damp(this.eyeH, this.crouched ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight, 14, dt);
    this.stepOff = damp(this.stepOff, 0, 14, dt);
    this.landV += (-220 * this.landDip - 24 * this.landV) * dt;
    this.landDip += this.landV * dt;

    // Retroceso: sube rápido y se recupera tras un breve retardo
    this.sinceKick += dt;
    this.rp = damp(this.rp, this.rpT, 40, dt);
    this.ry = damp(this.ry, this.ryT, 40, dt);
    if (this.sinceKick > recoilDelay) {
      this.rpT = damp(this.rpT, 0, recoilRecover, dt);
      this.ryT = damp(this.ryT, 0, recoilRecover, dt);
    }
    this.flinchRollV += (-120 * this.flinchRoll - 16 * this.flinchRollV) * dt;
    this.flinchRoll += this.flinchRollV * dt;
    this.flinchPitch = damp(this.flinchPitch, 0, 10, dt);
    this.trauma = Math.max(0, this.trauma - 1.5 * dt);
    if (this.deathT > 0) this.deathT = Math.min(1, this.deathT + dt / PLAYER.deathFallS);
    this.fovCur = m.fov;
  }

  private land(impact: number): void {
    if (impact > 2) {
      this.ctx.bus.emit('player:landed', { impact });
      this.landV -= Math.min(2.4, impact * 0.16);
    }
    const dmg = fallDamage(impact);
    if (dmg > 0) this.damageFn(dmg, 'fall');
  }

  /** Calcula y aplica la cámara final; actualiza eye/forward/right/up. */
  applyCamera(): void {
    const cam = this.ctx.camera;
    const ads = 1 - Math.min(1, this.fovCur / PLAYER.fov);
    const t = this.time;
    const bobK = (1 - 0.7 * Math.min(1, ads * 3)) * (this.crouched ? 0.6 : 1) * (1 + this.sprint01 * 0.6);
    const ph = this.bobPhase;
    const bobY = -Math.cos(2 * ph) * 0.02 * this.bobAmp * bobK + Math.sin(t * 1.3) * 0.0022;
    const bobX = Math.sin(ph) * 0.016 * this.bobAmp * bobK;
    const tr = this.trauma * this.trauma;
    const shP = Math.sin(t * 43) * 0.03 * tr;
    const shY = Math.sin(t * 37 + 1) * 0.03 * tr;
    const shR = Math.sin(t * 29 + 2) * 0.04 * tr;
    let dEye = 0;
    let dPitch = 0;
    let dRoll = 0;
    if (this.deathT > 0) {
      const e = 1 - Math.pow(1 - this.deathT, 3);
      dEye = -(this.eyeH - 0.28) * e;
      dRoll = this.deathRoll * e;
      dPitch = -0.3 * e;
    }
    const pitch = clamp(this.pitch + this.rp + this.flinchPitch + shP + dPitch, -1.55, 1.55);
    const yaw = this.yaw + this.ry + shY;
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    const sinP = Math.sin(pitch);
    const cosP = Math.cos(pitch);
    this.forward.set(-sinY * cosP, sinP, -cosY * cosP);
    this.right.set(cosY, 0, -sinY);
    this.up.set(sinY * sinP, cosP, cosY * sinP);
    this.eye.set(
      this.position.x + this.right.x * bobX,
      this.position.y + this.eyeH + bobY + this.landDip + this.stepOff + dEye,
      this.position.z + this.right.z * bobX,
    );
    cam.rotation.order = 'YXZ';
    cam.position.copy(this.eye);
    cam.rotation.set(pitch, yaw, this.strafeRoll + Math.sin(ph) * 0.006 * this.bobAmp + this.flinchRoll + shR + dRoll);
    if (Math.abs(cam.fov - this.fovCur) > 0.005) {
      cam.fov = this.fovCur;
      cam.updateProjectionMatrix();
    }
  }
}
