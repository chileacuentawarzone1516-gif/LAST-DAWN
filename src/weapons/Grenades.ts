/**
 * Granadas: pool de proyectiles con física (gravedad, rebotes por segmentos contra world.raycast,
 * fricción), mecha parpadeante y explosión con daño en área.
 */
import * as THREE from 'three';
import { GRENADE } from '../config';
import type { GameContext } from '../core/context';
import type { Vec3 } from '../core/types';
import { clamp } from '../core/util';
import { explosionDamage } from '../rules/combat';

interface Nade {
  active: boolean;
  mesh: THREE.Group;
  bulb: THREE.Mesh;
  bulbMat: THREE.MeshBasicMaterial;
  p: THREE.Vector3;
  v: THREE.Vector3;
  fuse: number;
  bounceCd: number;
  resting: boolean;
  spin: number;
}

const MAX = 6;
const DOWN: Vec3 = { x: 0, y: -1, z: 0 };

export class GrenadeSystem {
  private readonly items: Nade[] = [];
  private readonly bodyGeo = new THREE.SphereGeometry(0.038, 10, 8);
  private readonly bulbGeo = new THREE.SphereGeometry(0.014, 6, 4);
  private readonly capGeo = new THREE.CylinderGeometry(0.012, 0.016, 0.03, 6);
  private readonly dir = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly seg: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly boom: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly up: Vec3 = { x: 0, y: 1, z: 0 };
  private readonly probe: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly bouncePayload = { pos: { x: 0, y: 0, z: 0 } };
  private readonly exPayload = { pos: this.boom, radius: GRENADE.radius };
  private time = 0;

  constructor(private readonly ctx: GameContext) {
    const m = ctx.materials;
    for (let i = 0; i < MAX; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(this.bodyGeo, m.get('clothOlive')));
      const cap = new THREE.Mesh(this.capGeo, m.get('gunMetal'));
      cap.position.y = 0.04;
      g.add(cap);
      const bulbMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
      const bulb = new THREE.Mesh(this.bulbGeo, bulbMat);
      bulb.position.set(0.02, 0.05, 0);
      g.add(bulb);
      g.visible = false;
      ctx.scene.add(g);
      this.items.push({
        active: false, mesh: g, bulb, bulbMat, p: new THREE.Vector3(), v: new THREE.Vector3(),
        fuse: 0, bounceCd: 0, resting: false, spin: 0,
      });
    }
  }

  get activeCount(): number {
    let c = 0;
    for (const it of this.items) if (it.active) c++;
    return c;
  }

  /** Lanza una granada desde `origin` con velocidad `vel`. */
  throwFrom(origin: Vec3, vel: Vec3): void {
    let it = this.items.find((i) => !i.active);
    if (!it) it = this.items.reduce((a, b) => (a.fuse < b.fuse ? a : b));
    it.active = true;
    it.p.set(origin.x, origin.y, origin.z);
    it.v.set(vel.x, vel.y, vel.z);
    it.fuse = GRENADE.fuseS;
    it.bounceCd = 0;
    it.resting = false;
    it.mesh.visible = true;
    it.mesh.position.copy(it.p);
  }

  update(dt: number): void {
    this.time += dt;
    const w = this.ctx.world;
    for (const it of this.items) {
      if (!it.active) continue;
      it.fuse -= dt;
      it.bounceCd -= dt;
      // Parpadeo cada vez más rápido
      const rate = 4 + 14 * (1 - clamp(it.fuse / GRENADE.fuseS, 0, 1));
      it.bulb.visible = Math.sin(this.time * rate * Math.PI * 2) > -0.2;
      if (it.fuse <= 0) {
        this.explode(it);
        continue;
      }
      if (!it.resting) this.integrate(it, dt);
      else if (!w.raycast({ x: it.p.x, y: it.p.y, z: it.p.z }, DOWN, GRENADE.collisionRadius + 0.06)) it.resting = false;
      it.mesh.position.copy(it.p);
      it.spin += it.v.length() * dt * 6;
      it.mesh.rotation.set(it.spin * 0.7, it.spin * 0.3, 0);
      if (it.p.y < -30) it.fuse = 0;
    }
  }

  private integrate(it: Nade, dt: number): void {
    const w = this.ctx.world;
    const r = GRENADE.collisionRadius;
    let left = dt;
    it.v.y -= GRENADE.gravity * dt;
    for (let iter = 0; iter < 3 && left > 1e-5; iter++) {
      const speed = it.v.length();
      if (speed < 1e-4) break;
      this.dir.copy(it.v).divideScalar(speed);
      const dist = speed * left;
      this.seg.x = it.p.x;
      this.seg.y = it.p.y;
      this.seg.z = it.p.z;
      const hit = w.raycast(this.seg, this.dir, dist + r);
      if (!hit) {
        it.p.addScaledVector(it.v, left);
        return;
      }
      const travel = Math.max(0, hit.distance - r);
      it.p.addScaledVector(this.dir, travel);
      left -= travel / speed;
      this.n.set(hit.normal.x, hit.normal.y, hit.normal.z);
      const vn = it.v.dot(this.n);
      if (vn < 0) {
        // Reflexión: la componente normal rebota, la tangencial pierde por fricción
        const impact = -vn;
        it.v.addScaledVector(this.n, -vn);
        it.v.multiplyScalar(1 - GRENADE.friction * 0.5);
        it.v.addScaledVector(this.n, impact * GRENADE.bounce);
        if (impact > GRENADE.bounceEventMinSpeed && it.bounceCd <= 0) {
          it.bounceCd = 0.08;
          this.bouncePayload.pos.x = it.p.x;
          this.bouncePayload.pos.y = it.p.y;
          this.bouncePayload.pos.z = it.p.z;
          this.ctx.bus.emit('grenade:bounce', this.bouncePayload);
        }
        if (this.n.y > 0.7 && it.v.length() < 0.9) {
          it.v.set(0, 0, 0);
          it.resting = true;
          return;
        }
      }
      it.p.addScaledVector(this.n, 0.002);
      left -= 1e-4;
    }
  }

  private explode(it: Nade): void {
    const ctx = this.ctx;
    it.active = false;
    it.mesh.visible = false;
    const b = this.boom;
    b.x = it.p.x;
    b.y = it.p.y + 0.1;
    b.z = it.p.z;
    ctx.bus.emit('grenade:exploded', this.exPayload);
    ctx.enemies.explode(b, GRENADE.radius, GRENADE.damage, GRENADE.minMult);
    ctx.fx.burst('explosion', b, this.up, 1);
    ctx.fx.burst('smoke', b, this.up, 1);
    ctx.fx.burst('dust', b, this.up, 1);
    ctx.fx.flash(b, 0xffa040, 8, 0.3, 30);
    this.probe.x = b.x;
    this.probe.y = b.y;
    this.probe.z = b.z;
    const ground = ctx.world.raycast(this.probe, DOWN, 1.5);
    if (ground) ctx.fx.decal('scorch', ground.point, ground.normal, 3);
    // Daño al jugador: distancia al torso, con línea de visión
    const st = ctx.state.player;
    if (st.alive) {
      const px = st.pos.x;
      const py = st.pos.y + 1.0;
      const pz = st.pos.z;
      const d = Math.hypot(px - b.x, py - b.y, pz - b.z);
      if (d < GRENADE.radius) {
        this.probe.x = px;
        this.probe.y = py;
        this.probe.z = pz;
        if (!GRENADE.needsLineOfSight || ctx.world.hasLineOfSight(b, this.probe)) {
          const dmg = explosionDamage(d, GRENADE.radius, GRENADE.damage, GRENADE.minMult, GRENADE.selfMult);
          if (dmg > 0) ctx.player.damage(dmg, 'explosion', b);
        }
      }
      const near = 1 - d / GRENADE.shakeRadius;
      if (near > 0) this.onShake?.(near);
    }
  }

  /** Callback de sacudida de cámara (0..1). */
  onShake: ((amount: number) => void) | null = null;

  clear(): void {
    for (const it of this.items) {
      it.active = false;
      it.mesh.visible = false;
    }
  }

  dispose(): void {
    for (const it of this.items) {
      it.mesh.removeFromParent();
      it.bulbMat.dispose();
    }
    this.items.length = 0;
    this.bodyGeo.dispose();
    this.bulbGeo.dispose();
    this.capGeo.dispose();
  }
}
