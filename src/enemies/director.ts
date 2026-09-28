/**
 * Director: población ambiental por zona (packs fuera de radio y de vista), reciclado de lejanos y
 * hordas (relé / extracción) con oleadas en anillo. El Warden lo gestiona el sistema (index.ts).
 */
import { DIRECTOR, HORDES } from '../config';
import type { Vec2, ZoneId } from '../core/types';
import type { Rng } from '../core/util';
import {
  ambientDeficit, emptyZoneCounts, hordeProgress, hordeWave, inViewCone, packSize, pickFromMix, pickSpawnType, ringPoint, ZONES,
} from '../rules/director';
import { threatOf, zoneAt } from '../rules/zones';
import type { AiSys } from './enemy';

interface Horde {
  id: 'relay' | 'extraction';
  elapsed: number;
  nextWave: number;
  cx: number;
  cz: number;
}

const V2: Vec2 = { x: 0, z: 0 };
const LA = { x: 0, y: 0, z: 0 };
const LB = { x: 0, y: 0, z: 0 };

export class Director {
  ambientEnabled = true;
  private refillT = 0;
  private recycleT = 0;
  private hordes: Horde[] = [];
  private readonly counts = emptyZoneCounts();
  private readonly targets = { ...DIRECTOR.ambientTarget };
  private readonly deficit = emptyZoneCounts();

  constructor(private readonly sys: AiSys, private readonly rng: Rng) {}

  get activeHordes(): number {
    return this.hordes.length;
  }

  startHorde(id: 'relay' | 'extraction', center: Vec2): void {
    this.hordes = this.hordes.filter((h) => h.id !== id);
    this.hordes.push({ id, elapsed: 0, nextWave: HORDES[id].firstWaveDelayS, cx: center.x, cz: center.z });
  }

  endHorde(id: 'relay' | 'extraction'): void {
    this.hordes = this.hordes.filter((h) => h.id !== id);
    for (const e of this.sys.enemies) if (e.hordeId === id) e.forced = false;
  }

  /** Punto válido: transitable, dentro del radio de simulación y fuera de la vista del jugador. */
  private spotOk(x: number, z: number, minDist: number, checkView: boolean): boolean {
    const s = this.sys;
    if (!s.flow.isWalkable(x, z)) return false;
    const d = Math.hypot(x - s.px, z - s.pz);
    if (d < minDist || d > DIRECTOR.simRadius - 6) return false;
    if (!checkView || d > 85) return true;
    const yaw = s.ctx.state.player.yaw;
    if (!inViewCone(s.px, s.pz, yaw, x, z, 62)) return true;
    LA.x = x; LA.y = 1.5; LA.z = z;
    const eye = s.ctx.player.eye;
    LB.x = eye.x; LB.y = eye.y; LB.z = eye.z;
    return !s.ctx.world.hasLineOfSight(LA, LB);
  }

  private aliveInfected(): number {
    let n = 0;
    for (const e of this.sys.enemies) if (e.alive && e.type !== 'warden') n++;
    return n;
  }

  private spawnPack(zone: ZoneId, budget: number, minDist: number, checkView: boolean): number {
    const pts = this.sys.ctx.world.spawnPoints[zone];
    if (!pts || pts.length === 0) return 0;
    for (let attempt = 0; attempt < 14; attempt++) {
      const pt = pts[Math.floor(this.rng() * pts.length)]!;
      if (!this.spotOk(pt.x, pt.z, minDist, checkView)) continue;
      const n = packSize(this.rng, budget);
      let made = 0;
      const threat = threatOf(zone);
      for (let i = 0; i < n; i++) {
        const ox = pt.x + (this.rng() - 0.5) * 5;
        const oz = pt.z + (this.rng() - 0.5) * 5;
        const x = this.sys.flow.isWalkable(ox, oz) ? ox : pt.x;
        const z = this.sys.flow.isWalkable(ox, oz) ? oz : pt.z;
        const e = this.sys.spawn(pickSpawnType(this.rng, threat), x, z, { ambient: true, threat });
        if (e) made++;
      }
      return made;
    }
    return 0;
  }

  /** Población inicial: llena cada zona hasta su objetivo alrededor del jugador. */
  initialFill(): void {
    this.ambientFill(true, 12);
  }

  private ambientFill(initial: boolean, maxPacks: number): void {
    const s = this.sys;
    for (const z of ZONES) this.counts[z] = 0;
    for (const e of s.enemies) {
      if (!e.alive || !e.ambient) continue;
      if (Math.hypot(e.position.x - s.px, e.position.z - s.pz) <= DIRECTOR.simRadius) this.counts[zoneAt(e.position.x, e.position.z)]++;
    }
    ambientDeficit(this.counts, this.targets, DIRECTOR.maxAlive, this.aliveInfected(), this.deficit);
    let packs = 0;
    const order = [...ZONES].sort((a, b) => this.deficit[b] - this.deficit[a]);
    for (const z of order) {
      let need = this.deficit[z];
      while (need > 0 && packs < maxPacks) {
        const made = this.spawnPack(z, need, initial ? DIRECTOR.noSpawnRadius + 15 : DIRECTOR.noSpawnRadius, !initial);
        packs++;
        if (made === 0) break;
        need -= made;
      }
    }
  }

  private hordeTick(dt: number): void {
    const s = this.sys;
    for (const h of this.hordes) {
      h.elapsed += dt;
      if (h.elapsed < h.nextWave) continue;
      const def = HORDES[h.id];
      const wave = hordeWave(def, hordeProgress(def, h.elapsed));
      h.nextWave = h.elapsed + wave.intervalS;
      let alive = 0;
      for (const e of s.enemies) if (e.alive && e.hordeId === h.id) alive++;
      const want = Math.min(wave.size, def.maxAlive - alive);
      if (want <= 0) continue;
      const room = s.makeRoom(want);
      if (room <= 0) continue;
      // Ancla de la oleada en el anillo; el grupo se reparte alrededor.
      let ax = 0;
      let az = 0;
      let ok = false;
      for (let i = 0; i < 16 && !ok; i++) {
        ringPoint(this.rng, h.cx, h.cz, def.spawnRingMin, def.spawnRingMax, V2);
        ax = V2.x;
        az = V2.z;
        ok = s.flow.isWalkable(ax, az) && (i > 10 || this.spotOkHorde(ax, az));
      }
      if (!ok) continue;
      for (let i = 0; i < room; i++) {
        const ox = ax + (this.rng() - 0.5) * 8;
        const oz = az + (this.rng() - 0.5) * 8;
        const x = s.flow.isWalkable(ox, oz) ? ox : ax;
        const z = s.flow.isWalkable(ox, oz) ? oz : az;
        s.spawn(pickFromMix(this.rng, def.mix, def.threat), x, z, { forced: true, threat: def.threat, hordeId: h.id });
      }
    }
  }

  private spotOkHorde(x: number, z: number): boolean {
    const s = this.sys;
    const yaw = s.ctx.state.player.yaw;
    if (Math.hypot(x - s.px, z - s.pz) < 22) return false;
    if (!inViewCone(s.px, s.pz, yaw, x, z, 62)) return true;
    LA.x = x; LA.y = 1.5; LA.z = z;
    const eye = s.ctx.player.eye;
    LB.x = eye.x; LB.y = eye.y; LB.z = eye.z;
    return !s.ctx.world.hasLineOfSight(LA, LB);
  }

  update(dt: number): void {
    const s = this.sys;
    if (this.hordes.length > 0) this.hordeTick(dt);
    this.recycleT -= dt;
    if (this.recycleT <= 0) {
      this.recycleT = 1;
      for (const e of [...s.enemies]) {
        if (!e.alive || !e.ambient || e.pinned || e.type === 'warden') continue;
        if (Math.hypot(e.position.x - s.px, e.position.z - s.pz) > DIRECTOR.simRadius + 12) s.despawn(e);
      }
    }
    if (!this.ambientEnabled || s.grace) return;
    this.refillT -= dt;
    if (this.refillT <= 0) {
      this.refillT = DIRECTOR.refillIntervalS;
      this.ambientFill(false, 2);
    }
  }
}
