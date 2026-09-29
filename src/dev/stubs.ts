/**
 * Implementaciones NULAS/mínimas de cada módulo para probar uno solo aislado
 * (páginas dev/*). Los módulos reales viven en src/<módulo>/index.ts.
 */
import * as THREE from 'three';
import { MAP, PLAYER } from '../config';
import type {
  AudioApi, CharacterApi, EnemiesApi, GameContext, MissionsApi, MoveResult, NavGrid, PlayerApi, UiApi, WorldApi,
} from '../core/context';
import { clamp } from '../core/util';
import type { System, Vec2, Vec3, ZoneId } from '../core/types';
import { zoneAt } from '../rules/zones';

export function createStubNav(): NavGrid {
  const b = MAP.bounds;
  const cell = MAP.navCell;
  const cols = Math.ceil((b.maxX - b.minX) / cell);
  const rows = Math.ceil((b.maxZ - b.minZ) / cell);
  const walkable = new Uint8Array(cols * rows).fill(1);
  const nav: NavGrid = {
    cell, cols, rows, originX: b.minX, originZ: b.minZ, walkable,
    cellIndex(x, z) {
      const c = Math.floor((x - b.minX) / cell);
      const r = Math.floor((z - b.minZ) / cell);
      return c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c;
    },
    isWalkable(x, z) {
      const i = nav.cellIndex(x, z);
      return i >= 0 && walkable[i] === 1;
    },
    cellCenter(i, out) {
      out.x = b.minX + ((i % cols) + 0.5) * cell;
      out.z = b.minZ + (Math.floor(i / cols) + 0.5) * cell;
      return out;
    },
  };
  return nav;
}

export function createStubWorld(ctx: GameContext): WorldApi {
  const group = new THREE.Group();
  const b = MAP.bounds;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(b.maxX - b.minX, b.maxZ - b.minZ), ctx.materials.get('asphalt'));
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);
  ctx.scene.add(group);
  const spawn = (zone: ZoneId): Vec2[] => {
    const out: Vec2[] = [];
    const zr = MAP.zones.find((z) => z.id === zone)!.rect;
    for (let i = 0; i < 24; i++) {
      out.push({ x: zr.minX + 10 + ((i * 37) % (zr.maxX - zr.minX - 20)), z: zr.minZ + 10 + ((i * 53) % (zr.maxZ - zr.minZ - 20)) });
    }
    return out;
  };
  const points = { perimeter: spawn('perimeter'), warehouses: spawn('warehouses'), refinery: spawn('refinery'), complex: spawn('complex') };
  return {
    group,
    nav: createStubNav(),
    spawnPoints: points,
    lootSpots: points,
    zoneAt,
    moveCircle(x, z, dx, dz, _r, _f, _h, out): MoveResult {
      const r = out ?? { x: 0, z: 0, blockedX: false, blockedZ: false };
      r.x = clamp(x + dx, b.minX + 1, b.maxX - 1);
      r.z = clamp(z + dz, b.minZ + 1, b.maxZ - 1);
      r.blockedX = r.x !== x + dx;
      r.blockedZ = r.z !== z + dz;
      return r;
    },
    groundHeight: () => 0,
    raycast(o: Vec3, d: Vec3, maxDist) {
      if (d.y >= 0) return null;
      const t = -o.y / d.y;
      if (t < 0 || t > maxDist) return null;
      return { distance: t, point: { x: o.x + d.x * t, y: 0, z: o.z + d.z * t }, normal: { x: 0, y: 1, z: 0 }, surface: 'asphalt' };
    },
    hasLineOfSight: () => true,
    surfaceAt: () => 'asphalt',
    update() {},
    dispose() {
      ctx.scene.remove(group);
    },
  };
}

/** Jugador mínimo: caminar + mirar. Sirve para explorar previews de world/enemies/etc. */
export function createStubPlayer(ctx: GameContext): PlayerApi {
  const position = new THREE.Vector3(ctx.state.player.pos.x, 0, ctx.state.player.pos.z);
  const eye = new THREE.Vector3();
  const forward = new THREE.Vector3(0, 0, -1);
  const velocity = new THREE.Vector3();
  let yaw = ctx.state.player.yaw;
  let pitch = 0;
  let enabled = true;
  const res: MoveResult = { x: 0, z: 0, blockedX: false, blockedZ: false };
  const api: PlayerApi = {
    position, eye, forward, velocity, godMode: false,
    damage(amount) {
      if (!api.godMode) ctx.state.player.hp = Math.max(0, ctx.state.player.hp - amount);
    },
    heal(amount) {
      ctx.state.player.hp = Math.min(ctx.state.player.maxHp, ctx.state.player.hp + amount);
    },
    teleport(x, z, y = yaw) {
      position.set(x, 0, z);
      yaw = y;
    },
    setControlEnabled(e) {
      enabled = e;
    },
    update(dt) {
      const i = ctx.input;
      if (enabled) {
        yaw -= i.lookDX * PLAYER.mouseSensitivity;
        pitch = clamp(pitch - i.lookDY * PLAYER.mouseSensitivity, -1.5, 1.5);
        const f = i.moveY;
        const s = i.moveX;
        const speed = i.isDown('sprint') ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
        const dx = (-Math.sin(yaw) * f + Math.cos(yaw) * s) * speed * dt;
        const dz = (-Math.cos(yaw) * f - Math.sin(yaw) * s) * speed * dt;
        ctx.world.moveCircle(position.x, position.z, dx, dz, PLAYER.radius, 0, PLAYER.height, res);
        position.x = res.x;
        position.z = res.z;
      }
      eye.set(position.x, PLAYER.eyeHeight, position.z);
      forward.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      ctx.camera.position.copy(eye);
      ctx.camera.rotation.set(pitch, yaw, 0);
      const p = ctx.state.player;
      p.pos.x = position.x;
      p.pos.y = position.y;
      p.pos.z = position.z;
      p.yaw = yaw;
      p.zone = ctx.world.zoneAt(position.x, position.z);
    },
  };
  return api;
}

export function createStubEnemies(_ctx: GameContext): EnemiesApi {
  return {
    raycast: () => null,
    applyDamage() {},
    explode() {},
    aliveCount: 0,
    list: [],
    spawn: () => null,
    killAll() {},
    update() {},
  };
}

export function createStubMissions(_ctx: GameContext): MissionsApi {
  return {
    helicopter: null,
    openShop() {},
    closeShop() {},
    debugComplete() {},
    update() {},
  };
}

export function createStubUi(_ctx: GameContext): UiApi {
  return {
    notify(text, kind = 'info') {
      console.info(`[notify:${kind}] ${text}`);
    },
    setHudVisible() {},
    update() {},
  };
}

export function createStubAudio(_ctx: GameContext): AudioApi {
  return { unlock() {}, setMasterVolume() {}, setMuted() {}, ready: false, update() {} };
}

export type { Vec3 };

export function createStubCharacter(_ctx: GameContext): CharacterApi {
  let visible = false;
  return {
    showPreview() {
      visible = true;
    },
    hidePreview() {
      visible = false;
    },
    get previewVisible() {
      return visible;
    },
    setAnchor() {},
    rotate() {},
    setPose() {},
    update() {},
  };
}

export function createStubTouch(_ctx: GameContext): System {
  return { update() {} };
}
