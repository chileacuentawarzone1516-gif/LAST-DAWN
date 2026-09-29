/**
 * Sistema de armas: disparo hitscan, dispersión, retroceso, recarga, cambio, apuntado, placas de
 * armadura y lanzamiento de granadas. La munición vive en ctx.state.player.slots (fuente única).
 */
import { GRENADE, PLAYER, WEAPON_HANDLING, WEAPONS } from '../config';
import type { WeaponDef } from '../config';
import type { EnemyDamageInfo, GameContext } from '../core/context';
import type { EventScope } from '../core/events';
import type { SurfaceKind, WeaponId } from '../core/types';
import type { WeaponSlotState } from '../core/state';
import { clamp, createRng, damp, lerp } from '../core/util';
import type { Rng } from '../core/util';
import { applyPlate, canUsePlate } from '../rules/combat';
import {
  adsFov, approachLinear, currentSpreadDeg, damageAfterFalloff, fireIntervalS, generatePellets, isAutomatic,
  planReload, recoverSpread, spread01, spreadAfterShot, transferAmmo, transferShell,
} from '../rules/weapons';
import type { ReloadPlan, SpreadContext } from '../rules/weapons';
import type { WeaponHost } from './host';
import { GrenadeSystem } from './Grenades';
import { ViewModel, createViewFrame } from './ViewModel';

export class WeaponSystem {
  readonly viewmodel: ViewModel;
  readonly grenades: GrenadeSystem;
  sprintBlocked = false;
  speedMult = 1;
  sensMult = 1;
  fov: number = PLAYER.fov;

  private readonly scope: EventScope;
  private readonly frame = createViewFrame();
  private readonly rng: Rng = createRng((Math.random() * 4294967296) >>> 0);
  private readonly pellets = new Float64Array(64);
  private readonly spreadCtx: SpreadContext = { adsT: 0, crouched: false, speed01: 0, airborne: false, sprinting: false, shotSpread: 0 };
  private readonly dir = { x: 0, y: 0, z: 0 };
  private readonly origin = { x: 0, y: 0, z: 0 };
  private readonly hitPoint = { x: 0, y: 0, z: 0 };
  private readonly hitNormal = { x: 0, y: 0, z: 0 };
  private readonly endPt = { x: 0, y: 0, z: 0 };
  private readonly muzzle = { x: 0, y: 0, z: 0 };
  private readonly info: EnemyDamageInfo = { amount: 0, zone: 'body', point: this.hitPoint, normal: this.hitNormal, dir: this.dir };
  private readonly shotPayload = {
    weapon: 'pistol' as WeaponId, origin: this.origin, dir: this.dir, end: this.endPt,
    hit: 'none' as 'none' | 'world' | 'enemy', noise: 0, suppressed: false,
  };
  private readonly impactPayload = { point: this.hitPoint, normal: this.hitNormal, surface: 'concrete' as SurfaceKind };
  private readonly confirmPayload = { zone: 'body' as 'head' | 'body' | 'limb', killed: false, helmet: false };
  private readonly throwOrigin = { x: 0, y: 0, z: 0 };
  private readonly throwVel = { x: 0, y: 0, z: 0 };

  private time = 0;
  private adsT = 0;
  private aimHeld = false;
  private currentId: WeaponId | null = null;
  private readonly readyAt: [number, number] = [0, 0];
  private fireBuffer = 0;
  private lastShotT = -9;
  private shotSpread = 0;
  private emptyT = 0;
  private dryLatched = false;
  private yawBias = 0;
  private smoothSpread = 0;
  // Recarga
  private reloading = false;
  private plan: ReloadPlan | null = null;
  private reloadT = 0;
  private shellsLoaded = 0;
  // Acción exclusiva: placa o granada
  private action: 0 | 1 | 2 = 0;
  private actionT = 0;
  private actionDur = 0;
  private grenadeReleased = false;
  private grenadeReadyT = 0;
  private stateRef: object | null = null;
  private readonly ammo = { mag: 0, reserve: 0 };

  constructor(private readonly ctx: GameContext, private readonly ctl: WeaponHost) {
    this.viewmodel = new ViewModel(ctx);
    this.grenades = new GrenadeSystem(ctx);
    this.grenades.onShake = (a) => ctl.shake(a * 0.9);
    this.scope = ctx.bus.scope();
    this.scope.on('enemy:hit', (e) => {
      const c = this.confirmPayload;
      c.zone = e.zone;
      c.killed = e.killed;
      c.helmet = e.helmetHit;
      ctx.bus.emit('player:hitConfirm', c);
    });
    this.scope.on('loadout:changed', () => this.syncLoadout(false));
    this.scope.on('profile:changed', () => this.viewmodel.applyProfile(ctx.state.profile));
    this.syncLoadout(true);
  }

  private get st() {
    return this.ctx.state.player;
  }

  private slot(): WeaponSlotState | null {
    return this.st.slots[this.st.activeSlot];
  }

  /** Reconcilia el arma activa con el estado (compras, reinicios). */
  private syncLoadout(instant: boolean): void {
    const st = this.st;
    let s = st.slots[st.activeSlot];
    if (!s) {
      const other = (1 - st.activeSlot) as 0 | 1;
      if (st.slots[other]) {
        st.activeSlot = other;
        s = st.slots[other];
      }
    }
    const id = s ? s.id : null;
    if (id !== this.currentId) {
      this.cancelReload();
      this.shotSpread = 0;
      this.currentId = id;
      this.viewmodel.setWeapon(id, id ? WEAPONS[id] : null, instant);
    }
  }

  /** Reinicio de partida: el estado fue reemplazado. */
  resync(): void {
    this.cancelReload();
    this.action = 0;
    this.adsT = 0;
    this.shotSpread = 0;
    this.grenades.clear();
    this.viewmodel.reset();
    this.currentId = null;
    this.syncLoadout(false);
  }

  onDeath(): void {
    this.cancelReload();
    this.action = 0;
    this.st.usingPlate = false;
    this.st.aiming = false;
    this.st.sprinting = false;
  }

  private cancelReload(): void {
    this.reloading = false;
    this.plan = null;
    this.reloadT = 0;
    this.shellsLoaded = 0;
  }

  private startReload(): boolean {
    const s = this.slot();
    if (!s || this.reloading || this.action !== 0) return false;
    const plan = planReload(WEAPONS[s.id], s.mag, s.reserve);
    if (plan.kind === 'none') return false;
    this.plan = plan;
    this.reloading = true;
    this.reloadT = 0;
    this.shellsLoaded = 0;
    this.ctx.bus.emit('player:reloadStarted', { weapon: s.id, durationS: plan.durationS });
    return true;
  }

  private switchTo(slot: 0 | 1): void {
    const st = this.st;
    if (slot === st.activeSlot || !st.slots[slot] || this.action !== 0) return;
    this.cancelReload();
    st.activeSlot = slot;
    this.shotSpread = 0;
    const s = st.slots[slot] as WeaponSlotState;
    this.currentId = s.id;
    this.viewmodel.setWeapon(s.id, WEAPONS[s.id]);
    this.ctx.bus.emit('player:weaponSwitched', { slot, weapon: s.id });
  }

  private startPlate(): void {
    const st = this.st;
    if (this.action !== 0 || !canUsePlate(st.plates, st.armor, st.maxArmor)) return;
    this.cancelReload();
    this.action = 1;
    this.actionT = 0;
    this.actionDur = PLAYER.plateUseS;
    st.usingPlate = true;
    this.ctx.bus.emit('player:plateStarted', { durationS: PLAYER.plateUseS });
  }

  private startGrenade(): void {
    if (this.action !== 0 || this.st.grenades <= 0 || this.time < this.grenadeReadyT) return;
    this.cancelReload();
    this.action = 2;
    this.actionT = 0;
    this.actionDur = GRENADE.throwWindupS + GRENADE.throwRecoverS;
    this.grenadeReleased = false;
    this.grenadeReadyT = this.time + GRENADE.cooldownS;
  }

  private releaseGrenade(): void {
    const ctl = this.ctl;
    const st = this.st;
    st.grenades = Math.max(0, st.grenades - 1);
    const o = this.throwOrigin;
    o.x = ctl.eye.x + ctl.forward.x * 0.45 + ctl.right.x * 0.12;
    o.y = ctl.eye.y + ctl.forward.y * 0.45 - 0.12;
    o.z = ctl.eye.z + ctl.forward.z * 0.45 + ctl.right.z * 0.12;
    const v = this.throwVel;
    let dx = ctl.forward.x;
    let dy = ctl.forward.y + GRENADE.upBias;
    let dz = ctl.forward.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    v.x = dx * GRENADE.throwSpeed + ctl.velocity.x * GRENADE.inheritVelocity;
    v.y = dy * GRENADE.throwSpeed + ctl.velocity.y * GRENADE.inheritVelocity * 0.3;
    v.z = dz * GRENADE.throwSpeed + ctl.velocity.z * GRENADE.inheritVelocity;
    this.grenades.throwFrom(o, v);
    this.ctx.bus.emit('player:grenadeThrown', { origin: o, velocity: v });
  }

  /** Muestra/oculta el viewmodel según el flujo (oculto en el título, donde se ve el maniquí). */
  refreshVisibility(): void {
    this.viewmodel.setVisible(this.ctx.state.flow !== 'title');
  }

  /**
   * Se llama ANTES de mover al jugador: decide con la entrada de ESTE frame qué bloquea correr.
   * Así, si se dispara (o se apunta/recarga…) corriendo, el sprint termina en el mismo frame y el
   * disparo sale con la dispersión de andar, sin esperar a que el estado llegue del frame anterior.
   */
  beginFrame(): void {
    const { ctx, ctl } = this;
    const input = ctx.input;
    const slot = this.slot();
    const active = ctl.alive && ctl.controlEnabled && ctx.state.flow === 'playing' && ctx.state.ui.modal === null;
    const fireIntent = active && (input.isDown('fire') || input.wasPressed('fire') || this.fireBuffer > 0) && !!slot && slot.mag > 0;
    const pending = active && (input.wasPressed('reload') || input.wasPressed('grenade') || input.wasPressed('plate'));
    this.sprintBlocked = (active && input.isDown('aim')) || this.reloading || this.action !== 0 || fireIntent || pending;
  }

  update(dt: number): void {
    const { ctx, ctl } = this;
    const st = this.st;
    if (this.stateRef !== st) {
      if (this.stateRef !== null) this.resync();
      this.stateRef = st;
    }
    this.time += dt;
    const input = ctx.input;
    // Tienda o mapa abiertos: sin combate (las teclas 1-6 son de la tienda; el mapa cubre la vista).
    const shopOpen = ctx.state.ui.modal !== null;
    const active = ctl.alive && ctl.controlEnabled && ctx.state.flow === 'playing' && dt > 0;
    this.syncLoadout(false);
    const slot = this.slot();
    const def: WeaponDef | null = slot ? WEAPONS[slot.id] : null;
    const H = WEAPON_HANDLING;

    // Entrada de cambio, recarga, placa y granada
    if (active && !shopOpen) {
      let want = -1;
      if (input.wasPressed('slot1')) want = 0;
      else if (input.wasPressed('slot2')) want = 1;
      else if (input.wheelDelta !== 0) want = 1 - st.activeSlot;
      if (want >= 0) this.switchTo(want as 0 | 1);
      if (input.wasPressed('plate')) this.startPlate();
      if (input.wasPressed('grenade')) this.startGrenade();
      if (input.wasPressed('reload')) this.startReload();
    }

    // Acciones exclusivas
    if (this.action !== 0) {
      this.actionT += dt;
      if (this.action === 2 && !this.grenadeReleased && this.actionT >= GRENADE.throwWindupS) {
        this.grenadeReleased = true;
        this.releaseGrenade();
      }
      if (this.action === 1 && this.actionT >= this.actionDur) {
        if (canUsePlate(st.plates, st.armor, st.maxArmor)) {
          st.plates--;
          st.armor = applyPlate(st.armor, st.maxArmor);
          ctx.bus.emit('player:plateUsed', { armor: st.armor });
        }
        this.action = 0;
        st.usingPlate = false;
      } else if (this.action === 2 && this.actionT >= this.actionDur) {
        this.action = 0;
      }
    }

    const ready = this.viewmodel.ready && this.action === 0;

    // Apuntado
    this.aimHeld = active && !shopOpen && input.isDown('aim');
    const canAim = this.aimHeld && !this.reloading && ready && !ctl.sprinting;
    this.adsT = approachLinear(this.adsT, canAim ? 1 : 0, dt, def ? def.adsTimeS : 0.15);
    st.aiming = canAim;

    // Recarga
    if (this.reloading && slot && this.plan) {
      this.reloadT += dt;
      const plan = this.plan;
      if (plan.kind === 'magazine') {
        if (this.reloadT >= plan.durationS) {
          transferAmmo(slot.mag, slot.reserve, WEAPONS[slot.id].magSize, this.ammo);
          slot.mag = this.ammo.mag;
          slot.reserve = this.ammo.reserve;
          this.finishReload(slot.id);
        }
      } else {
        const stepT = this.shellsLoaded === 0 ? plan.firstStepS : plan.stepS;
        if (this.reloadT >= stepT) {
          this.reloadT -= stepT;
          transferShell(slot.mag, slot.reserve, WEAPONS[slot.id].magSize, this.ammo);
          slot.mag = this.ammo.mag;
          slot.reserve = this.ammo.reserve;
          this.shellsLoaded++;
          if (slot.mag >= WEAPONS[slot.id].magSize || slot.reserve <= 0) this.finishReload(slot.id);
        }
      }
    }

    // Disparo
    let dryClick = false;
    if (active && !shopOpen && def && slot) {
      // Un clic más corto que un frame (pulsar y soltar) deja flanco pero no 'isDown': se usa el flanco.
      const fireEdge = input.wasPressed('fire');
      const fireDown = input.isDown('fire') || fireEdge;
      if (fireEdge) {
        this.fireBuffer = H.fireBufferS;
        // Microimpulso instantáneo al apretar el gatillo (se nota aunque el disparo espere al enfriamiento).
        this.viewmodel.onTrigger();
        ctl.punch(H.triggerPunchDeg);
      } else this.fireBuffer = Math.max(0, this.fireBuffer - dt);
      const auto = isAutomatic(def);
      const want = auto ? fireDown || this.fireBuffer > 0 : this.fireBuffer > 0;
      if (!fireDown) this.dryLatched = false;
      const shellInterrupt = this.reloading && this.plan?.kind === 'shells' && slot.mag > 0;
      const canFire = ready && (!this.reloading || shellInterrupt);
      if (want && canFire) {
        if (slot.mag <= 0) {
          if (!this.dryLatched) {
            this.dryLatched = true;
            dryClick = true;
            ctx.bus.emit('player:dryFire', { weapon: slot.id });
            this.viewmodel.onDryFire();
            this.startReload();
          }
          this.fireBuffer = 0;
        } else {
          const idx = this.st.activeSlot;
          let n = 0;
          while (n < 2 && this.time >= this.readyAt[idx] && slot.mag > 0 && (n === 0 || auto)) {
            if (shellInterrupt) this.cancelReload();
            const base = this.time - this.readyAt[idx] > 0.05 ? this.time : this.readyAt[idx];
            this.readyAt[idx] = base + fireIntervalS(def);
            this.shoot(def, slot);
            this.fireBuffer = 0;
            n++;
          }
        }
      }
    } else {
      this.fireBuffer = 0;
    }
    void dryClick;

    // Recarga automática al vaciar
    if (active && slot && slot.mag <= 0 && slot.reserve > 0 && !this.reloading && ready) {
      this.emptyT += dt;
      if (this.emptyT >= H.autoReloadDelayS) {
        this.emptyT = 0;
        this.startReload();
      }
    } else if (!(slot && slot.mag <= 0)) this.emptyT = 0;

    // Dispersión
    if (def) {
      this.shotSpread = recoverSpread(this.shotSpread, def, this.time - this.lastShotT, dt);
      const c = this.spreadCtx;
      c.adsT = this.adsT;
      c.crouched = ctl.crouched;
      c.speed01 = ctl.speed01;
      c.airborne = !ctl.grounded;
      c.sprinting = ctl.sprinting;
      c.shotSpread = this.shotSpread;
      this.smoothSpread = damp(this.smoothSpread, spread01(def, currentSpreadDeg(def, c)), 18, dt);
    }
    st.spread = this.smoothSpread;
    st.reloading = this.reloading;
    st.usingPlate = this.action === 1;

    // Salidas hacia el controlador
    const fireHeld = active && (input.isDown('fire') || this.fireBuffer > 0) && !!slot && slot.mag > 0 && !shopOpen;
    this.sprintBlocked = this.aimHeld || this.reloading || this.action !== 0 || fireHeld;
    let sm = def ? def.moveSpeedMult : 1;
    if (canAim) sm *= PLAYER.aimSpeedMult;
    if (this.action === 1) sm *= PLAYER.plateMoveMult;
    this.speedMult = sm;
    const fovAds = def ? adsFov(PLAYER.fov, def, this.adsT) : PLAYER.fov;
    this.fov = fovAds + PLAYER.sprintFovBoost * ctl.sprint01;
    this.sensMult = lerp(1, PLAYER.adsSensitivityMult, this.adsT) * Math.sqrt(fovAds / PLAYER.fov);

    // Viewmodel
    const f = this.frame;
    f.ads = this.adsT;
    f.sprint01 = ctl.sprint01;
    f.airborne = !ctl.grounded;
    f.vy = ctl.velocity.y;
    f.bobPhase = ctl.bobPhase;
    f.bobAmp = ctl.bobAmp;
    f.yawVel = ctl.yawVel;
    f.pitchVel = ctl.pitchVel;
    f.mag = slot ? slot.mag : 0;
    f.reloadActive = this.reloading;
    const plan = this.plan;
    f.reloadKind = this.reloading && plan ? (plan.kind === 'shells' ? 2 : 1) : 0;
    if (this.reloading && plan) {
      const stepT = plan.kind === 'shells' ? (this.shellsLoaded === 0 ? plan.firstStepS : plan.stepS) : plan.durationS;
      f.reloadU = clamp(this.reloadT / Math.max(0.01, stepT), 0, 1);
    } else f.reloadU = 0;
    f.reloadFirst = this.shellsLoaded === 0;
    f.action = this.action;
    f.actionT = this.actionT;
    f.actionDur = this.actionDur || 1;
    f.actionWindup = GRENADE.throwWindupS;
    f.dead = !ctl.alive;
    this.viewmodel.update(dt, f);
    this.grenades.update(dt);
  }

  private finishReload(id: WeaponId): void {
    this.cancelReload();
    this.ctx.bus.emit('player:reloadFinished', { weapon: id });
  }

  /** Un disparo (una pulsación): resuelve todos los perdigones y emite los eventos. */
  private shoot(def: WeaponDef, slot: WeaponSlotState): void {
    const { ctx, ctl } = this;
    const H = WEAPON_HANDLING;
    slot.mag--;
    this.lastShotT = this.time;
    this.emptyT = 0;
    const c = this.spreadCtx;
    c.adsT = this.adsT;
    c.crouched = ctl.crouched;
    c.speed01 = ctl.speed01;
    c.airborne = !ctl.grounded;
    c.sprinting = ctl.sprinting;
    c.shotSpread = this.shotSpread;
    const deg = currentSpreadDeg(def, c);
    const n = generatePellets(def.pellets, deg, this.rng, this.pellets);
    const o = this.origin;
    o.x = ctl.eye.x;
    o.y = ctl.eye.y;
    o.z = ctl.eye.z;
    this.viewmodel.getMuzzleWorld(this.muzzle);
    let best = 0;
    let anyEnemy = false;
    const f = ctl.forward;
    const r = ctl.right;
    const u = ctl.up;
    const mp = this.shotPayload;
    for (let i = 0; i < n; i++) {
      const ox = this.pellets[i * 2] as number;
      const oy = this.pellets[i * 2 + 1] as number;
      let dx = f.x + r.x * ox + u.x * oy;
      let dy = f.y + r.y * ox + u.y * oy;
      let dz = f.z + r.z * ox + u.z * oy;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
      this.dir.x = dx;
      this.dir.y = dy;
      this.dir.z = dz;
      const kind = this.tracePellet(def);
      if (kind === 2) anyEnemy = true;
      if (kind > best || i === 0) {
        if (kind >= best) {
          best = kind;
          mp.end.x = this.endPt.x;
          mp.end.y = this.endPt.y;
          mp.end.z = this.endPt.z;
        }
      }
      // El trazador lo dibuja el motor al recibir 'player:shot'.
    }
    // dirección central para el evento
    this.dir.x = f.x;
    this.dir.y = f.y;
    this.dir.z = f.z;
    mp.weapon = def.id;
    mp.hit = best === 2 ? 'enemy' : best === 1 ? 'world' : 'none';
    mp.noise = def.noise;
    ctx.state.match.shotsFired++;
    if (anyEnemy) ctx.state.match.shotsHit++;
    ctx.bus.emit('player:shot', mp);
    ctx.fx.burst('muzzle', this.muzzle, f, def.pellets > 1 ? 1.4 : 1);
    ctx.fx.flash(this.muzzle, 0xffb060, 3.5, 0.06, 14);

    // Retroceso de cámara y dispersión
    let k = 0.85 + this.rng() * 0.3;
    if (this.adsT > 0.5) k *= H.recoilAdsMult;
    if (ctl.crouched) k *= H.recoilCrouchMult;
    this.yawBias = clamp(this.yawBias + (this.rng() - 0.5) * 0.5, -0.6, 0.6);
    const yawK = def.recoilYaw * (this.yawBias + (this.rng() * 2 - 1) * 0.6) * k;
    ctl.kick(def.recoilPitch * k, yawK, H.recoilMaxPitch, H.recoilMaxYaw);
    this.shotSpread = spreadAfterShot(this.shotSpread, def, this.adsT);
    this.viewmodel.onShot(def, def.recoilPitch, this.adsT);
    ctl.punch(0.05 + def.recoilPitch * 0.03);
  }

  /** Traza un perdigón (this.dir desde this.origin). Devuelve 0 nada, 1 mundo, 2 enemigo. */
  private tracePellet(def: WeaponDef): number {
    const { ctx } = this;
    const maxR = WEAPON_HANDLING.maxRange;
    const o = this.origin;
    const d = this.dir;
    const wall = ctx.world.raycast(o, d, maxR);
    const wallDist = wall ? wall.distance : maxR;
    const eh = ctx.enemies.raycast(o, d, wallDist);
    if (eh && eh.distance <= wallDist) {
      const p = eh.point;
      this.endPt.x = p.x;
      this.endPt.y = p.y;
      this.endPt.z = p.z;
      this.hitPoint.x = p.x;
      this.hitPoint.y = p.y;
      this.hitPoint.z = p.z;
      this.hitNormal.x = eh.normal.x;
      this.hitNormal.y = eh.normal.y;
      this.hitNormal.z = eh.normal.z;
      this.info.amount = damageAfterFalloff(def, eh.distance);
      this.info.zone = eh.zone;
      ctx.enemies.applyDamage(eh.enemy, this.info);
      return 2;
    }
    if (wall) {
      const p = wall.point;
      this.endPt.x = p.x;
      this.endPt.y = p.y;
      this.endPt.z = p.z;
      this.hitPoint.x = p.x;
      this.hitPoint.y = p.y;
      this.hitPoint.z = p.z;
      this.hitNormal.x = wall.normal.x;
      this.hitNormal.y = wall.normal.y;
      this.hitNormal.z = wall.normal.z;
      this.impactPayload.surface = wall.surface;
      ctx.bus.emit('bullet:impact', this.impactPayload);
      // Chispas, polvo y decal los dibuja el motor al recibir 'bullet:impact'.
      return 1;
    }
    this.endPt.x = o.x + d.x * maxR;
    this.endPt.y = o.y + d.y * maxR;
    this.endPt.z = o.z + d.z * maxR;
    return 0;
  }

  onJump(): void {
    this.viewmodel.onJump();
  }

  onLand(impact: number): void {
    this.viewmodel.onLand(impact);
  }

  dispose(): void {
    this.scope.dispose();
    this.viewmodel.dispose();
    this.grenades.dispose();
  }
}
