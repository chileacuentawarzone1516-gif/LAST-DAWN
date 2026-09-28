/** Proyectiles de ácido del escupidor: pool de esferas brillantes con arco balístico visible. */
import * as THREE from 'three';
import { ENEMY_AI } from '../config';
import type { GameContext } from '../core/context';
import type { Vec3 } from '../core/types';

interface Proj {
  mesh: THREE.Mesh;
  alive: boolean;
  vx: number; vy: number; vz: number;
  ox: number; oy: number; oz: number;
  damage: number;
  life: number;
}

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };
const DIR: Vec3 = { x: 0, y: 0, z: 0 };
const POINT: Vec3 = { x: 0, y: 0, z: 0 };
const NORMAL: Vec3 = { x: 0, y: 1, z: 0 };
const FROM: Vec3 = { x: 0, y: 0, z: 0 };

export class SpitPool {
  private readonly pool: Proj[] = [];
  private readonly geo = new THREE.IcosahedronGeometry(0.17, 1);
  private readonly group = new THREE.Group();

  constructor(private readonly ctx: GameContext) {
    const mat = ctx.materials.get('toxic');
    for (let i = 0; i < ENEMY_AI.spitter.maxProjectiles; i++) {
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.pool.push({ mesh, alive: false, vx: 0, vy: 0, vz: 0, ox: 0, oy: 0, oz: 0, damage: 0, life: 0 });
    }
    ctx.scene.add(this.group);
  }

  /** Lanza hacia (tx,ty,tz) con tiempo de vuelo d / velocidad y arco por gravedad. */
  launch(sx: number, sy: number, sz: number, tx: number, ty: number, tz: number, damage: number): void {
    const p = this.pool.find((q) => !q.alive);
    if (!p) return;
    const g = ENEMY_AI.spitter.gravity;
    const d = Math.hypot(tx - sx, tz - sz);
    const t = Math.max(0.35, d / ENEMY_AI.spitter.projectileSpeed);
    p.vx = (tx - sx) / t;
    p.vz = (tz - sz) / t;
    p.vy = (ty - sy + 0.5 * g * t * t) / t;
    p.ox = sx; p.oy = sy; p.oz = sz;
    p.damage = damage;
    p.life = t + 1.5;
    p.alive = true;
    p.mesh.position.set(sx, sy, sz);
    p.mesh.visible = true;
  }

  private impact(p: Proj, x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
    const { ctx } = this;
    p.alive = false;
    p.mesh.visible = false;
    POINT.x = x; POINT.y = y; POINT.z = z;
    NORMAL.x = nx; NORMAL.y = ny; NORMAL.z = nz;
    ctx.fx.burst('acid', POINT, NORMAL, 1);
    ctx.fx.decal('acid', POINT, NORMAL, 1.4);
    const pl = ctx.player.position;
    const dxz = Math.hypot(pl.x - x, pl.z - z);
    if (dxz <= ENEMY_AI.spitter.splashRadius && y >= pl.y - 0.6 && y <= pl.y + 2.2 && ctx.state.player.alive) {
      FROM.x = p.ox; FROM.y = p.oy; FROM.z = p.oz;
      ctx.player.damage(p.damage, 'spit', FROM);
    }
  }

  update(dt: number): void {
    const { ctx } = this;
    const g = ENEMY_AI.spitter.gravity;
    const pl = ctx.player.position;
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      const m = p.mesh.position;
      const px = m.x, py = m.y, pz = m.z;
      p.vy -= g * dt;
      const nx = px + p.vx * dt, ny = py + p.vy * dt, nz = pz + p.vz * dt;
      const len = Math.hypot(nx - px, ny - py, nz - pz);
      if (len > 1e-6) {
        ORIGIN.x = px; ORIGIN.y = py; ORIGIN.z = pz;
        DIR.x = (nx - px) / len; DIR.y = (ny - py) / len; DIR.z = (nz - pz) / len;
        const hit = ctx.world.raycast(ORIGIN, DIR, len);
        if (hit) {
          this.impact(p, hit.point.x, hit.point.y, hit.point.z, hit.normal.x, hit.normal.y, hit.normal.z);
          continue;
        }
      }
      // Impacto directo con el cuerpo del jugador.
      if (ctx.state.player.alive && Math.hypot(nx - pl.x, nz - pl.z) < 0.6 && ny > pl.y && ny < pl.y + 1.9) {
        this.impact(p, nx, ny, nz, -DIR.x, 0.3, -DIR.z);
        continue;
      }
      m.set(nx, ny, nz);
      const s = 1 + 0.15 * Math.sin(p.life * 30);
      p.mesh.scale.set(s, 1 / s, s);
      if (p.life <= 0 || ny < -2) {
        p.alive = false;
        p.mesh.visible = false;
      }
    }
  }

  dispose(): void {
    this.ctx.scene.remove(this.group);
    this.geo.dispose();
  }
}
