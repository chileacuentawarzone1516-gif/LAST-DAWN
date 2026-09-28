import { describe, expect, it } from 'vitest';
import { MAP, WORLD } from '../src/config';
import { CollisionWorld } from '../src/world/collision';
import { generateLayout } from '../src/world/layout';
import { buildCovered, buildNav, floodReachable, pickPoints } from '../src/world/nav';

const layout = generateLayout();
const world = new CollisionWorld(layout.colliders, layout.bounds, layout.ground, WORLD.hashCell);
const nav = buildNav(layout.colliders, layout.bounds);
const reach = floodReachable(nav, MAP.spawn.x, MAP.spawn.z);

const keyPoints = () => [
  { id: 'spawn', ...MAP.spawn }, { id: 'lz', ...MAP.lz.center }, { id: 'radio', ...MAP.lz.radio }, { id: 'armory', ...MAP.armory },
  ...MAP.cages.map((c) => ({ id: c.id, x: c.x, z: c.z })), { id: 'relay', ...MAP.relay },
  { id: 'gate', x: MAP.complex.gate.x, z: MAP.complex.gate.z }, { id: 'warden', ...MAP.complex.wardenSpawn },
];

describe('layout', () => {
  it('es determinista', () => {
    const b = generateLayout();
    expect(b.colliders.length).toBe(layout.colliders.length);
    expect(b.pieces.length).toBe(layout.pieces.length);
    expect(JSON.stringify(b.props.slice(0, 50))).toBe(JSON.stringify(layout.props.slice(0, 50)));
  });
  it('todo colisionador queda dentro de los límites', () => {
    const b = layout.bounds;
    for (const c of layout.colliders) {
      expect(c.x).toBeGreaterThanOrEqual(b.minX - 1);
      expect(c.x).toBeLessThanOrEqual(b.maxX + 1);
      expect(c.z).toBeGreaterThanOrEqual(b.minZ - 1);
      expect(c.z).toBeLessThanOrEqual(b.maxZ + 1);
    }
  });
  it('los puntos clave están libres de colisionadores (radio 3 m)', () => {
    for (const p of keyPoints()) {
      for (const c of layout.colliders) {
        if (c.y1 <= 0.45 || c.y0 >= 1.8) continue;
        const dx = p.x - c.x, dz = p.z - c.z;
        const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
        const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
        const d = c.shape === 'cyl' ? Math.max(0, Math.hypot(dx, dz) - c.r) : Math.hypot(Math.max(0, Math.abs(lx) - c.hx), Math.max(0, Math.abs(lz) - c.hz));
        expect(d, `${p.id} cerca de colisionador en (${c.x.toFixed(1)},${c.z.toFixed(1)})`).toBeGreaterThanOrEqual(3);
      }
    }
  });
  it('todos los puntos clave son alcanzables desde el spawn', () => {
    for (const p of keyPoints()) {
      const i = nav.cellIndex(p.x, p.z);
      expect(nav.walkable[i], `${p.id} transitable`).toBe(1);
      expect(reach[i], `${p.id} alcanzable`).toBe(1);
    }
  });
  it('rutas principales admiten al Warden (radio 0.8, rejilla fina)', () => {
    const fine = buildNav(layout.colliders, layout.bounds, { cell: 1, agentRadius: 0.8, blockMinY: 0.45, blockMaxY: 1.8 });
    const r = floodReachable(fine, MAP.spawn.x, MAP.spawn.z);
    for (const p of keyPoints()) expect(r[fine.cellIndex(p.x, p.z)], p.id).toBe(1);
  });
  it('spawnPoints y lootSpots válidos', () => {
    const covered = buildCovered(layout.colliders, nav, 1.8);
    const pts = pickPoints(nav, reach, covered, layout.lootAnchors, layout.pois, layout.seed);
    for (const z of ['perimeter', 'warehouses', 'refinery', 'complex'] as const) {
      expect(pts.spawnPoints[z].length, `spawn ${z}`).toBeGreaterThanOrEqual(40);
      expect(pts.lootSpots[z].length, `loot ${z}`).toBeGreaterThanOrEqual(20);
      for (const p of [...pts.spawnPoints[z], ...pts.lootSpots[z]]) {
        expect(nav.isWalkable(p.x, p.z)).toBe(true);
        expect(reach[nav.cellIndex(p.x, p.z)]).toBe(1);
      }
      for (const p of pts.spawnPoints[z]) expect(Math.hypot(p.x - MAP.spawn.x, p.z - MAP.spawn.z)).toBeGreaterThanOrEqual(25);
    }
  });
});

describe('colisión', () => {
  const out = { x: 0, z: 0, blockedX: false, blockedZ: false };
  it('desliza contra un muro y no lo atraviesa', () => {
    // muro sur del complejo, fuera de la puerta
    let x = 30, z = -100;
    for (let i = 0; i < 60; i++) { world.moveCircle(x, z, 0.3, -0.4, 0.35, 0, 1.8, out); x = out.x; z = out.z; }
    expect(z).toBeGreaterThan(-105);
    expect(x).toBeGreaterThan(30.5);
  });
  it('no atraviesa el muro perimetral a alta velocidad', () => {
    let x = 0, z = 150;
    for (let i = 0; i < 200; i++) { world.moveCircle(x, z, 0, 8 * 0.05, 0.35, 0, 1.8, out); x = out.x; z = out.z; }
    expect(z).toBeLessThanOrEqual(197);
  });
  it('raycast y línea de visión', () => {
    const hit = world.raycast({ x: 30, y: 1.5, z: -100 }, { x: 0, y: 0, z: -1 }, 50);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeLessThan(6);
    expect(world.hasLineOfSight({ x: 30, y: 1.5, z: -100 }, { x: 30, y: 1.5, z: -140 })).toBe(false);
    expect(world.hasLineOfSight({ x: 0, y: 1.5, z: 100 }, { x: 0, y: 1.5, z: 60 })).toBe(true);
    const g = world.raycast({ x: 0, y: 2, z: 100 }, { x: 0, y: -1, z: 0 }, 10);
    expect(g!.distance).toBeCloseTo(2, 3);
  });
  it('groundHeight sobre cajas pisables y escaleras', () => {
    const step = layout.colliders.find((c) => c.shape === 'box' && c.y1 > 0.25 && c.y1 < 0.31 && c.hx < 0.3 && c.hz > 0.5);
    expect(step).toBeDefined();
    expect(world.groundHeight(step!.x, step!.z, 0.35, 0)).toBeCloseTo(step!.y1, 3);
  });
});
