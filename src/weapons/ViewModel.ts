/**
 * Viewmodel procedural en ctx.viewScene: arma + brazos, animaciones (reposo, balanceo, correr, ADS,
 * patada, recarga, bombeo, cambio, placa, granada), fogonazo y casquillos. Sin asignaciones por frame.
 */
import * as THREE from 'three';
import { WEAPON_HANDLING } from '../config';
import type { WeaponDef } from '../config';
import type { GameContext } from '../core/context';
import type { PlayerProfile, Vec3, WeaponId } from '../core/types';
import { clamp, clamp01, damp, lerp } from '../core/util';
import { easeAds } from '../rules/weapons';
import { resolveArmLook } from './armLook';
import { CasingPool, MuzzleFlash } from './effects';
import { ArmLook } from './look';
import { createArm, createGrenadeProp, createPlateProp, createWeaponModel } from './models';
import type { ArmRig, PropModel, WeaponModel } from './models';

export interface ViewFrame {
  ads: number;
  sprint01: number;
  airborne: boolean;
  vy: number;
  bobPhase: number;
  bobAmp: number;
  yawVel: number;
  pitchVel: number;
  mag: number;
  reloadActive: boolean;
  /** 0 = ninguna, 1 = cargador, 2 = cartuchos. */
  reloadKind: number;
  reloadU: number;
  reloadFirst: boolean;
  /** 0 = ninguna, 1 = placa, 2 = granada. */
  action: number;
  actionT: number;
  actionDur: number;
  actionWindup: number;
  dead: boolean;
}

export function createViewFrame(): ViewFrame {
  return {
    ads: 0, sprint01: 0, airborne: false, vy: 0, bobPhase: 0, bobAmp: 0, yawVel: 0, pitchVel: 0, mag: 0,
    reloadActive: false, reloadKind: 0, reloadU: 0, reloadFirst: true, action: 0, actionT: 0, actionDur: 1,
    actionWindup: 0.3, dead: false,
  };
}

class Spring {
  x = 0;
  v = 0;
  step(dt: number, k: number, c: number): void {
    this.v += (-k * this.x - c * this.v) * dt;
    this.x += this.v * dt;
  }
}

const seg = (u: number, a: number, b: number): number => {
  const t = clamp01((u - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const T1 = new THREE.Vector3();
const T2 = new THREE.Vector3();
const T3 = new THREE.Vector3();
const HIDDEN = 0.999;

export class ViewModel {
  private readonly root = new THREE.Group();
  private readonly gun = new THREE.Group();
  private readonly models = new Map<WeaponId, WeaponModel>();
  private shown: WeaponModel | null = null;
  private shownId: WeaponId | null = null;
  private wanted: WeaponId | null = null;
  private switchAmt = 1;
  private readonly armR: ArmRig;
  private readonly armL: ArmRig;
  private readonly freeR: ArmRig;
  private readonly freeL: ArmRig;
  private readonly grenade: PropModel;
  private readonly plate: PropModel;
  private readonly flash = new MuzzleFlash();
  private readonly flashLight = new THREE.PointLight(0xffb060, 0, 1.8, 2);
  private readonly casings: CasingPool;
  private readonly extraLights: THREE.Light[] = [];
  private readonly kz = new Spring();
  private readonly kp = new Spring();
  private readonly ky = new Spring();
  private readonly kr = new Spring();
  private readonly land = new Spring();
  private readonly leftPos = new THREE.Vector3();
  private time = 0;
  private boltPulse = 0;
  private boltPos = 0;
  private hammerPulse = 0;
  private pumpT = 9;
  private pumpEjected = true;
  private rEnv = 0;
  private spent = 0;
  private lastReloadU = 0;
  private readonly look = new ArmLook();
  private visibleFlag = true;
  private swayX = 0;
  private swayY = 0;

  constructor(private readonly ctx: GameContext) {
    const m = ctx.materials;
    ctx.viewScene.add(this.root);
    this.root.add(this.gun);
    this.armR = createArm(m, 1);
    this.armL = createArm(m, -1);
    this.freeR = createArm(m, 1);
    this.freeL = createArm(m, -1);
    this.grenade = createGrenadeProp(m);
    this.plate = createPlateProp(m);
    this.gun.add(this.armR.root, this.armL.root);
    this.root.add(this.freeR.root, this.freeL.root, this.grenade.root, this.plate.root, this.flashLight);
    this.freeR.root.visible = this.freeL.root.visible = this.grenade.root.visible = this.plate.root.visible = false;
    this.casings = new CasingPool(this.root, m);
    for (const a of [this.armR, this.armL, this.freeR, this.freeL]) this.look.register(a.root);
    this.look.apply(resolveArmLook(ctx.state.profile));
    this.setVisible(ctx.state.flow !== 'title');
    for (const a of [this.armR, this.armL, this.freeR, this.freeL]) this.noCull(a.root);
    this.noCull(this.grenade.root);
    this.noCull(this.plate.root);
    // Si el motor no aporta luces al viewScene, se añaden unas mínimas.
    let hasLight = false;
    ctx.viewScene.traverse((o) => {
      if ((o as THREE.Light).isLight && o !== this.flashLight) hasLight = true;
    });
    if (!hasLight) {
      const h = new THREE.HemisphereLight(0x9fb4d8, 0x1a2030, 2.2);
      const d = new THREE.DirectionalLight(0xffffff, 2.2);
      d.position.set(0.5, 1, 0.6);
      ctx.viewScene.add(h, d);
      this.extraLights.push(h, d);
    }
  }

  private noCull(o: THREE.Object3D): void {
    o.traverse((c) => {
      c.frustumCulled = false;
    });
  }

  /** ¿El arma está subida y lista para disparar? */
  get ready(): boolean {
    return this.wanted === this.shownId && this.switchAmt < 0.25;
  }

  /** Pide mostrar un arma (baja la actual y sube la nueva). `instant` la muestra ya. */
  setWeapon(id: WeaponId | null, def: WeaponDef | null, instant = false): void {
    void def;
    this.wanted = id;
    if (instant || this.shownId === null) {
      this.swap(id);
      this.switchAmt = instant ? 0 : 1;
    }
  }

  private swap(id: WeaponId | null): void {
    if (this.shown) {
      this.gun.remove(this.shown.root);
      this.shown.muzzle.remove(this.flash.group);
    }
    this.shownId = id;
    this.shown = null;
    if (!id) return;
    let m = this.models.get(id);
    if (!m) {
      m = createWeaponModel(id, this.ctx.materials);
      this.noCull(m.root);
      this.models.set(id, m);
    }
    this.shown = m;
    this.gun.add(m.root);
    m.muzzle.add(this.flash.group);
    this.armR.root.position.set(m.rig.rightHand[0], m.rig.rightHand[1], m.rig.rightHand[2]);
    this.leftPos.set(m.rig.leftHand[0], m.rig.leftHand[1], m.rig.leftHand[2]);
    this.spent = 0;
    this.boltPos = 0;
  }

  onShot(def: WeaponDef, recoilPitchDeg: number, ads: number): void {
    const m = this.shown;
    if (!m) return;
    const k = m.rig.kick * (1 - 0.4 * ads);
    this.kz.v += 1.5 * k;
    this.kp.v += (0.8 + recoilPitchDeg * 0.35) * (1 - 0.3 * ads);
    this.ky.v += (Math.random() - 0.5) * 0.9 * k;
    this.kr.v += (Math.random() - 0.5) * 1.6 * k;
    this.boltPulse = 0.035;
    this.hammerPulse = 0.06;
    this.spent++;
    this.flash.fire(m.rig.flashScale * (0.9 + Math.random() * 0.25), def.id === 'shotgun' ? 0.07 : 0.05);
    this.flashLight.intensity = 2.5;
    if (def.fireMode === 'pump') {
      this.pumpT = 0;
      this.pumpEjected = false;
    } else if (def.id !== 'revolver') {
      this.eject(false);
    }
  }

  /** Muestra/oculta todo el viewmodel (oculto en el título, donde se ve el maniquí de personalización). */
  setVisible(v: boolean): void {
    this.visibleFlag = v;
    this.root.visible = v;
  }

  /** Aplica la apariencia del perfil (mangas, guantes, piel, finura) sin reconstruir nada. */
  applyProfile(profile: PlayerProfile): void {
    this.look.apply(resolveArmLook(profile));
  }

  /** Microimpulso instantáneo al apretar el gatillo. */
  onTrigger(): void {
    this.kz.v += 0.45;
    this.kp.v += 0.7;
    this.hammerPulse = 0.03;
  }

  onDryFire(): void {
    this.kz.v += 0.3;
    this.hammerPulse = 0.05;
  }

  onJump(): void {
    this.land.v += 0.4;
  }

  onLand(impact: number): void {
    this.land.v -= Math.min(1.6, impact * 0.14);
  }

  private eject(shell: boolean): void {
    const m = this.shown;
    if (!m) return;
    T1.copy(m.eject.position).applyMatrix4(m.root.matrixWorld);
    this.casings.spawn(T1.x, T1.y, T1.z, 1.3, 1.5, 0.5, shell);
  }

  /** Posición de la boca del arma en el espacio del mundo. */
  getMuzzleWorld(out: Vec3): void {
    const cam = this.ctx.camera;
    if (!this.shown) {
      T1.set(0.1, -0.1, -0.6);
    } else {
      this.shown.muzzle.updateWorldMatrix(true, false);
      T1.setFromMatrixPosition(this.shown.muzzle.matrixWorld);
    }
    T1.applyQuaternion(cam.quaternion).add(cam.position);
    out.x = T1.x;
    out.y = T1.y;
    out.z = T1.z;
  }

  update(dt: number, f: ViewFrame): void {
    if (!this.visibleFlag || dt <= 0) return;
    this.time += dt;
    const lowerS = WEAPON_HANDLING.switchLowerS;
    const raiseS = WEAPON_HANDLING.switchRaiseS;
    if (this.wanted !== this.shownId) {
      this.switchAmt += dt / lowerS;
      if (this.switchAmt >= 1) {
        this.switchAmt = 1;
        this.swap(this.wanted);
      }
    } else if (this.switchAmt > 0) {
      this.switchAmt = Math.max(0, this.switchAmt - dt / raiseS);
    }
    const m = this.shown;
    if (!m) {
      this.gun.visible = false;
      return;
    }
    const rig = m.rig;
    const e = easeAds(f.ads);
    const kdt = Math.min(dt, 0.033);
    this.kz.step(kdt, 320, 22);
    this.kp.step(kdt, 320, 22);
    this.ky.step(kdt, 320, 22);
    this.kr.step(kdt, 320, 22);
    this.land.step(kdt, 200, 18);
    this.kz.x = clamp(this.kz.x, -0.01, 0.07);
    this.kp.x = clamp(this.kp.x, -0.05, 0.14);

    // Balanceo por giro de cámara
    this.swayX = damp(this.swayX, clamp(this.f2(f.yawVel) * 0.012, -0.05, 0.05), 10, dt);
    this.swayY = damp(this.swayY, clamp(-f.pitchVel * 0.012, -0.04, 0.04), 10, dt);

    // Ocultación por cambio de arma, acción o muerte
    let hide = seg(this.switchAmt, 0, 1);
    let actionHide = 0;
    if (f.action !== 0) {
      const u = f.actionT / Math.max(0.01, f.actionDur);
      actionHide = seg(u, 0, 0.15) * (1 - seg(u, f.action === 1 ? 0.85 : 0.72, 1));
    }
    hide = Math.max(hide, actionHide, f.dead ? 1 : 0);

    // Recarga
    this.rEnv = damp(this.rEnv, f.reloadActive ? 1 : 0, 12, dt);
    const kind = f.reloadKind;
    const u = f.reloadU;
    if (m.id === 'revolver' && f.reloadActive && this.lastReloadU < 0.3 && u >= 0.3) {
      const n = Math.min(6, this.spent);
      for (let i = 0; i < n; i++) {
        T1.copy(m.eject.position).applyMatrix4(m.root.matrixWorld);
        this.casings.spawn(T1.x, T1.y, T1.z, -0.3, -0.5, 0.1, false);
      }
      this.spent = 0;
    }
    this.lastReloadU = f.reloadActive ? u : 0;

    // Mano izquierda, cargador y piezas móviles
    const L = T2;
    L.set(rig.leftHand[0], rig.leftHand[1], rig.leftHand[2]);
    let magDelta = 0;
    let magHidden = false;
    let cylOpen = 0;
    let shellInHand = false;
    if (f.reloadActive && kind === 1 && m.id !== 'revolver') {
      const M = rig.magwell;
      const ax = M[0] - 0.05;
      const ay = M[1] - 0.22;
      const az = M[2] + 0.12;
      if (u < 0.16) L.lerp(T3.set(M[0], M[1], M[2]), seg(u, 0, 0.16));
      else if (u < 0.3) L.set(lerp(M[0], ax, seg(u, 0.16, 0.3)), lerp(M[1], ay, seg(u, 0.16, 0.3)), lerp(M[2], az, seg(u, 0.16, 0.3)));
      else if (u < 0.52) L.set(ax, ay, az);
      else if (u < 0.7) L.set(lerp(ax, M[0], seg(u, 0.52, 0.7)), lerp(ay, M[1], seg(u, 0.52, 0.7)), lerp(az, M[2], seg(u, 0.52, 0.7)));
      else if (u < 0.78) L.set(M[0], M[1], M[2]);
      else L.set(lerp(M[0], rig.leftHand[0], seg(u, 0.78, 0.95)), lerp(M[1], rig.leftHand[1], seg(u, 0.78, 0.95)), lerp(M[2], rig.leftHand[2], seg(u, 0.78, 0.95)));
      if (m.mag) {
        if (u >= 0.16 && u < 0.3) magDelta = seg(u, 0.16, 0.3);
        else if (u >= 0.3 && u < 0.52) magHidden = true;
        else if (u >= 0.52 && u < 0.7) magDelta = 1;
        else if (u >= 0.7 && u < 0.78) magDelta = 1 - seg(u, 0.7, 0.78);
      }
    } else if (f.reloadActive && kind === 1) {
      // Revólver: cilindro fuera, mano a por el cargador rápido
      const M = rig.magwell;
      cylOpen = seg(u, 0.1, 0.25) * (1 - seg(u, 0.8, 0.92));
      const away = seg(u, 0.3, 0.45) * (1 - seg(u, 0.5, 0.65));
      L.set(lerp(rig.leftHand[0], M[0], seg(u, 0, 0.15)) - away * 0.05, lerp(rig.leftHand[1], M[1], seg(u, 0, 0.15)) - away * 0.2, lerp(rig.leftHand[2], M[2], seg(u, 0, 0.15)));
      if (u > 0.9) L.set(lerp(M[0], rig.leftHand[0], seg(u, 0.9, 1)), lerp(M[1], rig.leftHand[1], seg(u, 0.9, 1)), lerp(M[2], rig.leftHand[2], seg(u, 0.9, 1)));
    } else if (f.reloadActive && kind === 2) {
      const M = rig.magwell;
      const cu = u;
      const away = f.reloadFirst ? seg(cu, 0, 0.3) : 1 - seg(cu, 0.85, 1) * 0;
      const toPort = seg(cu, 0.45, 0.75);
      L.set(
        lerp(rig.leftHand[0], M[0] - 0.06, away) + (M[0] - (M[0] - 0.06)) * toPort,
        lerp(rig.leftHand[1], M[1] - 0.2, away) + (0.2) * toPort,
        lerp(rig.leftHand[2], M[2] + 0.1, away) - 0.1 * toPort,
      );
      shellInHand = cu > 0.25 && cu < 0.82;
    } else if (rig.leftOnPump) {
      L.z += 0;
    }

    // Guardamanos deslizante (escopeta)
    let pumpPos = 0;
    if (m.pump) {
      this.pumpT += dt;
      const t = this.pumpT;
      pumpPos = t < 0.18 ? 0 : t < 0.4 ? seg(t, 0.18, 0.4) : t < 0.5 ? 1 : 1 - seg(t, 0.5, 0.78);
      if (!this.pumpEjected && t > 0.34) {
        this.pumpEjected = true;
        this.eject(true);
      }
      m.pump.position.set(m.seat.pump.x, m.seat.pump.y, m.seat.pump.z + pumpPos * rig.pumpTravel);
      if (rig.leftOnPump && !f.reloadActive) L.z += pumpPos * rig.pumpTravel;
    }
    this.leftPos.x = damp(this.leftPos.x, L.x, 28, dt);
    this.leftPos.y = damp(this.leftPos.y, L.y, 28, dt);
    this.leftPos.z = damp(this.leftPos.z, L.z, 28, dt);
    this.armL.root.position.copy(this.leftPos);

    if (m.mag) {
      m.mag.visible = !magHidden;
      const s = m.seat.mag;
      const out = rig.magOut;
      const carried = f.reloadActive && kind === 1 ? magDelta : 0;
      m.mag.position.set(s.x + out[0] * carried, s.y + out[1] * carried, s.z + out[2] * carried);
    }
    if (m.cylinder) {
      const s = m.seat.cylinder;
      m.cylinder.position.set(s.x - 0.05 * cylOpen, s.y - 0.01 * cylOpen, s.z);
      m.cylinder.rotation.z = 0.3 * cylOpen;
    }
    // Cerrojo / corredera
    this.boltPulse -= dt;
    const emptyLock = rig.boltLock && f.mag <= 0 && !(f.reloadActive && u > 0.82);
    const boltT = emptyLock ? 0.92 : this.boltPulse > 0 ? 1 : 0;
    this.boltPos = damp(this.boltPos, boltT, 55, dt);
    if (m.bolt) m.bolt.position.set(m.seat.bolt.x, m.seat.bolt.y, m.seat.bolt.z + this.boltPos * rig.boltTravel);
    this.hammerPulse -= dt;
    if (m.hammer) m.hammer.rotation.x = damp(m.hammer.rotation.x, this.hammerPulse > 0 ? -0.5 : 0, 40, dt);

    // Pose
    const sp = seg(f.sprint01, 0, 1);
    const bobK = 1 - 0.85 * e;
    const hx = rig.hip[0];
    let px = lerp(hx, 0, e);
    let py = lerp(rig.hip[1], -rig.sightY, e);
    let pz = lerp(rig.hip[2], -(rig.adsDepth + rig.sightZ), e);
    let rx = lerp(rig.hipRot[0], 0, e);
    let ry = lerp(rig.hipRot[1], 0, e);
    let rz = 0;
    px += Math.sin(f.bobPhase) * 0.012 * f.bobAmp * bobK + this.swayX * (1 - 0.7 * e) + 0.05 * sp;
    py += -Math.cos(2 * f.bobPhase) * 0.008 * f.bobAmp * bobK + Math.sin(this.time * 1.3) * 0.0012 * (1 - e) + this.swayY * (1 - 0.7 * e) + this.land.x * 0.04 - 0.07 * sp;
    if (f.airborne) py += clamp(-f.vy * 0.004, -0.03, 0.03);
    pz += this.kz.x + 0.03 * sp;
    rx += this.kp.x - 0.25 * sp;
    ry += this.ky.x + 0.6 * sp;
    rz += this.kr.x + 0.2 * sp;
    // Recarga: inclina el arma para ver el cargador / puerto de carga
    const tilt = m.id === 'shotgun' ? 1.5 : 1;
    rz += 0.3 * this.rEnv * tilt;
    rx += 0.1 * this.rEnv * tilt;
    px -= 0.02 * this.rEnv;
    py += 0.01 * this.rEnv * tilt;
    // Ocultación (bajar y cabecear)
    py -= 0.45 * hide;
    rx -= 0.9 * hide;
    px += 0.05 * hide;
    this.gun.position.set(px, py, pz);
    this.gun.rotation.set(rx, ry, rz, 'YXZ');
    this.gun.visible = hide < HIDDEN;

    // Óptica del DMR
    if (m.scope) {
      const o = seg(f.ads, 0.85, 1) * (1 - hide);
      m.scope.visible = o > 0.01;
      for (const mat of m.scopeMaterials) mat.opacity = o;
    }
    this.armR.root.visible = this.armL.root.visible = !(m.scope && f.ads > 0.9);

    this.updateActions(f);
    this.flash.update(dt);
    this.flashLight.intensity = this.flash.strength * 2.5;
    this.casings.update(dt);
    this.root.updateMatrixWorld(true);
    if (this.flash.strength > 0) {
      T1.setFromMatrixPosition(m.muzzle.matrixWorld);
      this.flashLight.position.copy(T1);
    }
    void shellInHand;
  }

  private f2(v: number): number {
    return v;
  }

  /** Animaciones de placa y granada con brazos libres. */
  private updateActions(f: ViewFrame): void {
    const on = f.action !== 0 && !f.dead;
    const fr = this.freeR.root;
    const fl = this.freeL.root;
    const gp = this.grenade.root;
    const pp = this.plate.root;
    if (!on) {
      fr.visible = fl.visible = gp.visible = pp.visible = false;
      return;
    }
    const t = f.actionT;
    const uu = t / Math.max(0.01, f.actionDur);
    if (f.action === 1) {
      const rise = seg(uu, 0.08, 0.3);
      const down = seg(uu, 0.5, 0.75);
      const y = lerp(-0.42, -0.14, rise) + (-0.2) * down;
      const z = -0.3 + 0.17 * down;
      const gone = uu > 0.76;
      pp.visible = !gone && uu > 0.06;
      pp.position.set(0, gone ? -0.5 : y, z);
      pp.rotation.set(-0.2 - 0.5 * down, Math.sin(uu * 9) * 0.04, 0);
      const out = seg(uu, 0.9, 1);
      const hy = gone ? -0.3 - out * 0.3 : y;
      const hz = gone ? -0.15 : z;
      fr.visible = fl.visible = uu > 0.06;
      fr.position.set(0.095, hy - 0.01, hz);
      fl.position.set(-0.095, hy - 0.01, hz);
      gp.visible = false;
    } else {
      const w = f.actionWindup;
      pp.visible = false;
      fr.visible = fl.visible = t > 0.03;
      const up = seg(t, 0.03, w * 0.55);
      const swing = seg(t, w - 0.06, w + 0.07);
      const back = seg(t, w + 0.1, f.actionDur);
      const rx = lerp(lerp(0.17, 0.12, up), 0.06, swing);
      const ry = lerp(lerp(-0.42, -0.15, up), -0.06, swing) - back * 0.4;
      const rz = lerp(lerp(-0.2, -0.16, up), -0.5, swing);
      fr.position.set(rx, ry, rz);
      const pull = seg(t, w * 0.5, w * 0.85);
      fl.position.set(lerp(-0.03, -0.13, pull), lerp(-0.42 + 0.28 * up, -0.2, pull) - back * 0.4, -0.22 + 0.04 * pull);
      gp.visible = t < w;
      gp.position.set(rx - 0.005, ry + 0.06, rz - 0.02);
      gp.rotation.set(0, 0, 0);
      if (this.grenade.lever) this.grenade.lever.rotation.z = -0.9 * pull;
    }
  }

  /** Vacía casquillos y estados transitorios (reinicio). */
  reset(): void {
    this.casings.clear();
    this.kz.x = this.kz.v = this.kp.x = this.kp.v = 0;
  }

  dispose(): void {
    this.flash.dispose();
    this.casings.dispose();
    this.look.dispose();
    this.flashLight.removeFromParent();
    for (const l of this.extraLights) l.removeFromParent();
    this.root.removeFromParent();
    const geos: THREE.BufferGeometry[] = [];
    for (const m of this.models.values()) {
      geos.push(...m.geometries);
      for (const mat of m.ownMaterials) mat.dispose();
    }
    for (const a of [this.armR, this.armL, this.freeR, this.freeL]) geos.push(...a.geometries);
    geos.push(...this.grenade.geometries, ...this.plate.geometries);
    for (const g of geos) g.dispose();
    this.models.clear();
    this.shown = null;
  }
}
