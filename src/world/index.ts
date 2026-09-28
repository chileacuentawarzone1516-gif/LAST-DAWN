/**
 * Módulo MUNDO: distrito industrial procedural (layout puro) + colisión + navegación + render
 * estático fusionado, props instanciados, luces/halos y contaminación visual.
 */
import * as THREE from 'three';
import { MAP, WORLD } from '../config';
import type { GameContext, MoveResult, RayHit, WorldApi } from '../core/context';
import type { SurfaceKind, Vec2, Vec3, ZoneId } from '../core/types';
import { createRng } from '../core/util';
import { zoneAt } from '../rules/zones';
import { buildGround, buildStaticMeshes } from './builders';
import { CollisionWorld } from './collision';
import { createContamination } from './contamination';
import { buildGlows } from './glow';
import { generateLayout } from './layout';
import { buildCovered, buildNav, floodReachable, pickPoints } from './nav';
import { buildProps } from './props';
import type { WindowSpec, WorldLayout } from './types';

export interface WorldStats {
  buildMs: number;
  /** Mallas/draw calls que aporta el mundo (sin sombras). */
  drawCalls: number;
  triangles: number;
  colliders: number;
  /** Desglose (ms): layout, colisión+nav, geometría. */
  phases: { layout: number; nav: number; render: number };
}

/** WorldApi + extras opcionales para herramientas de desarrollo y QA. */
export interface World extends WorldApi {
  readonly layout: WorldLayout;
  readonly collision: CollisionWorld;
  readonly stats: WorldStats;
  /** Puntos clave (id → posición). */
  readonly pois: Record<string, Vec2>;
  surfaceAt(x: number, z: number, footY?: number): SurfaceKind;
}

const WINDOW_MATS = ['emissiveAmber', 'emissiveWhite', 'emissiveBlue', 'emissiveRed'] as const;

function buildWindows(windows: readonly WindowSpec[], ctx: GameContext, group: THREE.Group): { meshes: THREE.InstancedMesh[]; geo: THREE.PlaneGeometry } {
  const geo = new THREE.PlaneGeometry(1, 1);
  const meshes: THREE.InstancedMesh[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let tone = 0; tone < 4; tone++) {
    const list = windows.filter((w) => w.tone === tone);
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(geo, ctx.materials.get(WINDOW_MATS[tone]!), list.length);
    list.forEach((w, i) => {
      q.setFromAxisAngle(up, w.rot);
      p.set(w.x, w.y + w.h / 2, w.z);
      s.set(w.w, w.h, 1);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.name = `windows:${tone}`;
    group.add(mesh);
    meshes.push(mesh);
  }
  return { meshes, geo };
}

export function createWorld(ctx: GameContext): World {
  const t0 = performance.now();
  const layout = generateLayout(WORLD.seed);
  const tLayout = performance.now();
  const collision = new CollisionWorld(layout.colliders, layout.bounds, layout.ground, WORLD.hashCell);
  const nav = buildNav(layout.colliders, layout.bounds);
  const reach = floodReachable(nav, MAP.spawn.x, MAP.spawn.z);
  const covered = buildCovered(layout.colliders, nav, WORLD.nav.blockMaxY);
  const points = pickPoints(nav, reach, covered, layout.lootAnchors, layout.pois, layout.seed);

  const tNav = performance.now();
  const group = new THREE.Group();
  group.name = 'world';
  const st = { meshes: 0, triangles: 0 };
  buildGround(layout.ground, layout.bounds, WORLD.chunkSize, ctx.materials, group, st);
  buildStaticMeshes(layout.pieces, layout.bounds, WORLD.chunkSize, ctx.materials, group, st);
  const props = buildProps(layout.props, ctx.materials, group);
  const win = buildWindows(layout.windows, ctx, group);
  const glows = buildGlows(layout.glows, group);
  const contamination = createContamination(group, ctx.state);
  ctx.scene.add(group);

  const lights: Array<{ light: THREE.PointLight; base: number; flicker: number; phase: number }> = [];
  if (WORLD.pointLights) {
    const rng = createRng(99);
    for (const l of layout.pointLights) {
      const light = new THREE.PointLight(l.color, l.intensity, l.distance, 2);
      light.position.set(l.x, l.y, l.z);
      light.castShadow = false;
      light.name = `light:${l.id}`;
      group.add(light);
      lights.push({ light, base: l.intensity, flicker: l.flicker, phase: rng() * 10 });
    }
  }

  let time = 0;
  const poiMap: Record<string, Vec2> = {};
  for (const p of layout.pois) poiMap[p.id] = { x: p.x, z: p.z };
  const stats: WorldStats = {
    buildMs: performance.now() - t0,
    drawCalls: st.meshes + props.meshes.length + win.meshes.length + (glows.mesh ? 1 : 0) + 2,
    triangles: st.triangles + props.triangles + layout.windows.length * 2,
    colliders: layout.colliders.length,
    phases: { layout: tLayout - t0, nav: tNav - tLayout, render: performance.now() - tNav },
  };

  const world: World = {
    group,
    nav,
    spawnPoints: points.spawnPoints as Record<ZoneId, Vec2[]>,
    lootSpots: points.lootSpots as Record<ZoneId, Vec2[]>,
    layout,
    collision,
    stats,
    pois: poiMap,
    zoneAt,
    moveCircle: (x: number, z: number, dx: number, dz: number, r: number, footY: number, headY: number, out?: MoveResult) =>
      collision.moveCircle(x, z, dx, dz, r, footY, headY, out),
    groundHeight: (x, z, r, footY) => collision.groundHeight(x, z, r, footY),
    raycast: (o: Vec3, d: Vec3, maxDist: number): RayHit | null => collision.raycast(o, d, maxDist),
    hasLineOfSight: (a, b) => collision.hasLineOfSight(a, b),
    surfaceAt: (x, z, footY) => collision.surfaceAt(x, z, footY ?? 0),
    update(dt) {
      time += dt;
      glows.update(dt);
      contamination.update(dt);
      for (const l of lights) {
        if (l.flicker > 0) l.light.intensity = l.base * (1 - l.flicker * (0.5 + 0.5 * Math.sin(time * 23 + l.phase) * Math.sin(time * 7.3 + l.phase)));
      }
    },
    dispose() {
      ctx.scene.remove(group);
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) m.geometry.dispose();
      });
      props.dispose();
      for (const m of win.meshes) m.dispose();
      win.geo.dispose();
      glows.dispose();
      contamination.dispose();
      for (const l of lights) l.light.dispose();
    },
  };
  return world;
}
