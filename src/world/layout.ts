/**
 * Layout PURO y determinista del distrito industrial (400×400 m, norte = −Z). Combina estructuras
 * autoradas alrededor de los puntos de MAP con relleno procedural (RNG con semilla fija).
 */
import { MAP, WORLD } from '../config';
import { barrelCluster, climbableContainer, containerStack, crateStack, fireBarrel, jerseyLine, palletLoad, parkCar, parkTruck, puddle, roadBarricade, roadCars, sandbagArc, sandbagLine, shelfRow, tentCamp } from './dressing';
import { LayoutKit, OCC } from './kit';
import type { Rect, WorldLayout } from './types';
import { GK } from './types';

const R = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({ minX, maxX, minZ, maxZ });
const HALF_PI = Math.PI / 2;

// ── Perímetro y carreteras ─────────────────────────────────────────────────
function boundary(k: LayoutKit): void {
  const t = WORLD.wallThickness;
  const h = WORLD.wallHeight;
  const b = k.bounds;
  const o = { cast: false };
  k.wall(b.minX, b.minZ + t / 2, b.maxX, b.minZ + t / 2, t, 0, h, 'concrete', [], 0, o);
  k.wall(b.minX, b.maxZ - t / 2, b.maxX, b.maxZ - t / 2, t, 0, h, 'concrete', [], 0, o);
  k.wall(b.minX + t / 2, b.minZ + t, b.minX + t / 2, b.maxZ - t, t, 0, h, 'concrete', [], 0, o);
  k.wall(b.maxX - t / 2, b.minZ + t, b.maxX - t / 2, b.maxZ - t, t, 0, h, 'concrete', [], 0, o);
  // remate: alambrada inclinada visual sobre el muro
  k.box(0, b.minZ + t / 2, b.maxX - b.minX, 0.2, h, h + 1.2, 'fence', { collide: false, ray: false });
  k.box(0, b.maxZ - t / 2, b.maxX - b.minX, 0.2, h, h + 1.2, 'fence', { collide: false, ray: false });
  k.box(b.minX + t / 2, 0, 0.2, b.maxZ - b.minZ, h, h + 1.2, 'fence', { collide: false, ray: false });
  k.box(b.maxX - t / 2, 0, 0.2, b.maxZ - b.minZ, h, h + 1.2, 'fence', { collide: false, ray: false });
  k.mark(R(b.minX, b.maxX, b.minZ, b.minZ + t), OCC.struct);
  k.mark(R(b.minX, b.maxX, b.maxZ - t, b.maxZ), OCC.struct);
  k.mark(R(b.minX, b.minX + t, b.minZ, b.maxZ), OCC.struct);
  k.mark(R(b.maxX - t, b.maxX, b.minZ, b.maxZ), OCC.struct);
}

function roads(k: LayoutKit): void {
  const vx = (x: number, w: number, z0: number, z1: number, worn = false): void => k.road(R(x - w / 2, x + w / 2, z0, z1), 'z', worn);
  const hz = (z: number, w: number, x0: number, x1: number, worn = false): void => k.road(R(x0, x1, z - w / 2, z + w / 2), 'x', worn);
  vx(0, 12, -134, 196);
  vx(-100, 8, -190, 194, true);
  vx(100, 8, -30, 194, true);
  vx(-154, 8, -190, 194, true);
  vx(154, 8, -190, 194, true);
  hz(140, 10, -196, 196);
  hz(92, 8, -196, 196);
  hz(24, 10, -196, 196);
  hz(-25, 8, -196, 196);
  hz(-98, 8, -196, 196);
  hz(190, 8, -196, 196);
  hz(-148, 8, -196, -80, true);
  hz(-148, 8, 80, 196, true);
  hz(-62, 8, 6, 66);
  hz(-62, 8, 118, 146);
}

// ── Puntos clave y estructuras del perímetro sur ───────────────────────────
function pois(k: LayoutKit): void {
  k.poi('spawn', MAP.spawn.x, MAP.spawn.z);
  k.poi('lz', MAP.lz.center.x, MAP.lz.center.z, MAP.lz.padRadius + 1);
  k.poi('radio', MAP.lz.radio.x, MAP.lz.radio.z);
  k.poi('armory', MAP.armory.x, MAP.armory.z);
  for (const c of MAP.cages) k.poi(c.id, c.x, c.z);
  k.poi('relay', MAP.relay.x, MAP.relay.z);
  k.poi('gate', MAP.complex.gate.x, MAP.complex.gate.z);
  k.poi('warden', MAP.complex.wardenSpawn.x, MAP.complex.wardenSpawn.z);
}

function helipad(k: LayoutKit): void {
  const { x, z } = MAP.lz.center;
  const pr = MAP.lz.padRadius;
  k.paintGround(R(x - 18, x + 18, z - 18, z + 18), GK.concreteDark);
  k.cyl(x, z, pr + 0.4, 0, 0.06, 'concrete', { collide: false, seg: 48, cast: false });
  k.flat(x, z, pr + 0.4, pr + 0.4, 0.08, 'hazard', 'ring', 0, pr - 0.6);
  k.flat(x, z, pr - 3, pr - 3, 0.09, 'roadLine', 'ring', 0, pr - 3.4);
  // H
  k.flat(x - 2.2, z, 0.7, 6, 0.09, 'roadLine');
  k.flat(x + 2.2, z, 0.7, 6, 0.09, 'roadLine');
  k.flat(x, z, 4.4, 0.7, 0.09, 'roadLine');
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const lx = x + Math.cos(a) * (pr - 0.9);
    const lz = z + Math.sin(a) * (pr - 0.9);
    k.box(lx, lz, 0.4, 0.4, 0.06, 0.2, 'emissiveAmber', { collide: false, cast: false });
    k.glow(lx, 0.35, lz, 1.6, 0xffb040, 'pulse', 0.5, 0.9, (i / 16) * 6.28);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = x + sx * 21;
      const pz = z + sz * 19;
      k.cyl(px, pz, 0.18, 0, 9, 'steelDark', { seg: 8 });
      k.box(px, pz, 0.9, 0.5, 9, 9.4, 'emissiveWhite', { collide: false, cast: false });
      k.glow(px, 9.2, pz, 9, 0xbcd4ff, 'steady', 1, 1.1);
    }
  }
  k.pointLight('lz', x, 8, z, 0xaac8ff, 90, 45);
  k.cyl(x - 18, z - 14, 0.08, 0, 6, 'steelDark', { seg: 6, collide: false });
  // barriles y cajas fuera de la plataforma
  crateStack(k, x + 24, z + 14);
  barrelCluster(k, x - 25, z + 16, 4);
}

function armory(k: LayoutKit): void {
  const { x, z } = MAP.armory;
  k.paintGround(R(x - 5, x + 5, z - 5, z + 5), GK.concrete);
  k.box(x, z - 4.6, 9.4, 0.7, 0, 3.2, 'corrugated'); // fondo (z-4.95..z-4.25)
  k.box(x - 4.7, z, 0.6, 8.6, 0, 3.2, 'corrugated'); // oeste
  k.box(x + 4.7, z - 1.6, 0.6, 5.2, 0, 3.2, 'corrugated'); // este parcial
  k.box(x, z, 9.6, 9.6, 3.2, 3.5, 'metalPanel', { cast: true }); // tejado
  k.box(x, z - 3.75, 5.2, 0.9, 0, 0.95, 'wood', { collide: true }); // banco (dist 3.3)
  for (let i = 0; i < 4; i++) k.box(x - 1.9 + i * 1.25, z - 4.2, 0.9, 0.08, 1.3, 2.2, 'steelDark', { collide: false });
  k.box(x - 3.6, z - 3.4, 0.5, 0.5, 0, 0.9, 'containerGreen'); // caja munición (dist ≥3.3)
  k.glow(x, 3.0, z - 1, 7, 0xffd28a, 'flicker', 2, 1.0);
  k.box(x, z - 1, 0.5, 0.2, 3.0, 3.2, 'emissiveAmber', { collide: false });
  k.pointLight('armory', x, 2.8, z - 1, 0xffc27a, 30, 20, 0.15);
  k.loot(x - 6.5, z + 2);
  barrelCluster(k, x + 8, z - 5, 3);
  sandbagLine(k, x - 8, z + 7, x - 2, z + 7);
}

function radioNest(k: LayoutKit): void {
  const { x, z } = MAP.lz.radio;
  sandbagArc(k, x, z, 4.2, Math.PI, 3);
  k.cyl(x, z, 0.12, 0, 9, 'steelDark', { collide: false, seg: 8 });
  k.box(x, z, 0.9, 0.7, 0, 1.1, 'metalPanel', { collide: false });
  k.box(x, z, 0.5, 0.05, 0.75, 0.95, 'emissiveGreen', { collide: false, cast: false });
  k.glow(x, 9, z, 2.5, 0xff3030, 'blink', 0.8, 1);
  k.glow(x, 1, z, 3, 0x40ff90, 'pulse', 0.6, 0.6);
}

/** Jaula de suministro caminable: cerca de 7.4 m con la entrada al sur, estante al fondo y lámpara. */
function cage(k: LayoutKit, x: number, z: number): void {
  const hw = 3.7;
  k.paintGround(R(x - hw, x + hw, z - hw, z + hw), GK.concreteStained);
  const ft = 'fence' as const;
  k.box(x - hw, z, 0.12, hw * 2, 0, 2.8, ft, { ray: false });
  k.box(x + hw, z, 0.12, hw * 2, 0, 2.8, ft, { ray: false });
  k.box(x - 3.1, z + hw, 1.2, 0.12, 0, 2.8, ft, { ray: false });
  k.box(x + 3.1, z + hw, 1.2, 0.12, 0, 2.8, ft, { ray: false });
  k.box(x, z - hw + 0.3, hw * 2, 0.6, 0, 2.6, 'metalPanel'); // estantería fondo
  k.box(x, z, hw * 2 + 0.3, hw * 2 + 0.3, 2.8, 2.95, 'steelDark', { cast: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(x + sx * hw, z + sz * hw, 0.25, 0.25, 0, 3, 'steelDark', { collide: false });
  for (let i = 0; i < 3; i++) k.box(x - 2.2 + i * 2.2, z - hw + 0.9, 0.9, 0.5, 0.9, 1.6, 'wood', { collide: false });
  k.box(x, z, 0.4, 0.4, 2.6, 2.8, 'emissiveAmber', { collide: false });
  k.glow(x, 2.5, z, 6, 0xffc070, 'steady', 1, 1.1);
  k.loot(x, z - 5.5);
}

function checkpoint(k: LayoutKit): void {
  const b = k.bounds;
  const zc = b.maxZ - WORLD.wallThickness / 2;
  k.box(0, zc, 15.6, 2.8, 0, 6, 'steelDark', { cast: false }); // portón cerrado
  k.box(0, zc - 1.5, 15.6, 0.1, 4.2, 5.6, 'hazard', { collide: false });
  k.glow(0, 5.2, zc - 2, 4, 0xff3030, 'blink', 1.2, 1);
  for (const s of [-1, 1]) {
    k.building({ id: `booth${s}`, x: s * 12, z: 190, w: 3.6, d: 3.6, h: 3, wall: 'plaster', windows: { rows: 1, lit: 1, tone: 0, every: 2, y: 1.4, w: 1.2, h: 0.9 }, doors: [{ side: 'n', off: 0, w: 1.2, h: 2.1 }] });
    k.cyl(s * 22, 191, 0.25, 0, 6, 'steelDark', { seg: 8 });
    k.box(s * 22, 191, 3, 3, 6, 8, 'metalPanel', { cast: false });
    k.box(s * 22, 191, 3.2, 3.2, 8, 8.3, 'concreteDark', { collide: false });
    k.glow(s * 22, 7, 189.3, 7, 0xd0e0ff, 'steady', 1, 1.1);
  }
  jerseyLine(k, -12, 181, -4, 181);
  jerseyLine(k, 4, 184, 12, 184);
  roadBarricade(k, 0, 176, false, 12);
}

// ── Perímetro (resto) ──────────────────────────────────────────────────────
function perimeter(k: LayoutKit): void {
  cageAt(k, 'cage_perimeter');
  // cordón de cuarentena z=86.5 con huecos en las carreteras
  const gaps: Array<[number, number]> = [[190, 202], [92, 100], [292, 300], [38, 46], [346, 354]];
  k.fence(-196, 86.5, 196, 86.5, 2.6, gaps, 4);
  // Bloques: campamento, barracones, puesto de mando, garaje
  const rows: Array<[number, number]> = [[98, 133], [147, 184]];
  const cols: Array<[number, number]> = [[-195, -160], [-148, -106], [-94, -6], [6, 94], [106, 148], [160, 195]];
  let n = 0;
  for (const [z0, z1] of rows) {
    for (const [x0, x1] of cols) {
      const rect = R(x0, x1, z0, z1);
      const style = n++ % 4;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      if (!k.isFree(R(cx - 8, cx + 8, cz - 6, cz + 6), OCC.keep | OCC.road | OCC.struct)) { dressLot(k, rect); continue; }
      if (style === 0) tentLot(k, rect);
      else if (style === 1) k.building({ id: `pf${n}`, x: cx, z: cz, w: Math.min(30, x1 - x0 - 8), d: 12, h: 4, wall: 'plaster', windows: { rows: 1, lit: 0.3, tone: 0, every: 4, y: 1.8 }, doors: [{ side: 'n', off: -6, w: 1.4, h: 2.2 }] });
      else if (style === 2) k.building({ id: `cmd${n}`, x: cx, z: cz, w: Math.min(34, x1 - x0 - 8), d: 14, h: 5, wall: 'brick', windows: { rows: 1, lit: 0.4, tone: 0, every: 4.5, y: 2.2 }, doors: [{ side: 's', off: 0, w: 1.6, h: 2.3 }] });
      else k.building({ id: `gar${n}`, x: cx, z: cz, w: Math.min(38, x1 - x0 - 8), d: 18, h: 6, wall: 'corrugated', enterable: true, roof: 'gable', doors: [{ side: 'e', off: 0, w: 5, h: 4.2 }, { side: 'w', off: 0, w: 5, h: 4.2 }], windows: false });
      dressLot(k, rect);
    }
  }
  // Coches y barricadas
  roadCars(k, R(-196, 196, 135, 145), 'x', 7);
  roadCars(k, R(-6, 6, 100, 196), 'z', 3);
  roadBarricade(k, 0, 88, false, 12);
  roadBarricade(k, 0, 120, false, 12);
  puddle(k, 30, 141, 2.4);
  puddle(k, -40, 138, 1.8);
  fireBarrel(k, -19, 166);
  fireBarrel(k, 20, 176);
}

function cageAt(k: LayoutKit, id: string): void {
  const c = MAP.cages.find((q) => q.id === id);
  if (c) cage(k, c.x, c.z);
}

function tentLot(k: LayoutKit, r: Rect): void {
  for (let i = 0; i < 5; i++) tentCamp(k, k.rand(r.minX + 6, r.maxX - 6), k.rand(r.minZ + 5, r.maxZ - 5), k.pick([0, HALF_PI]));
  fireBarrel(k, (r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2);
}

/** Relleno de un lote: cajas, barriles, coches, palés. */
function dressLot(k: LayoutKit, r: Rect): void {
  const area = (r.maxX - r.minX) * (r.maxZ - r.minZ);
  k.scatter(r, Math.round(area / 260), (x, z) => crateStack(k, x, z));
  k.scatter(r, Math.round(area / 300), (x, z) => barrelCluster(k, x, z, 3) > 0);
  k.scatter(r, Math.round(area / 500), (x, z) => parkCar(k, x, z, k.rand(0, 6.28)));
  k.scatter(r, Math.round(area / 500), (x, z) => palletLoad(k, x, z, k.rand(0, 3)));
  k.scatter(r, 2, (x, z) => k.prop('dumpster', x, z, k.pick([0, HALF_PI]), { variant: k.int(0, 2) }));
  k.scatter(r, 2, (x, z) => k.prop('tires', x, z, 0));
  k.scatter(r, 3, (x, z) => k.prop('cone', x, z, 0, { check: true }));
  k.paintBlobs(r, 3, [GK.dirt, GK.gravel, GK.concreteStained], 3, 7);
}

// ── Almacenes ──────────────────────────────────────────────────────────────
function warehouses(k: LayoutKit): void {
  const rows: Array<[number, number]> = [[38, 82], [-19, 18]];
  const cols: Array<[number, number]> = [[-195, -160], [-148, -106], [-94, -54], [-44, -8], [8, 44], [54, 94], [106, 148], [160, 195]];
  k.markDisc(60, 35, 13, OCC.keep);
  let n = 0;
  for (const [z0, z1] of rows) {
    for (const [x0, x1] of cols) {
      const rect = R(x0, x1, z0, z1);
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const w = x1 - x0;
      const kind = (n++ * 7 + 3) % 5;
      if (!k.isFree(R(cx - w / 2 + 4, cx + w / 2 - 4, cz - 8, cz + 8), OCC.keep | OCC.road | OCC.struct)) { dressLot(k, rect); continue; }
      if (kind <= 1 && w >= 38) {
        const bw = Math.min(w - 8, 40);
        const bd = k.pick([22, 24, 26]);
        const bz = cz + k.rand(-2, 2);
        k.building({ id: `nave${n}`, x: cx, z: bz, w: bw, d: bd, h: k.pick([7, 8, 9]), wall: k.pick(['corrugated', 'metalPanel', 'brick']), enterable: true, roof: k.chance(0.5) ? 'gable' : 'flat', pilasters: 8, windows: { rows: 1, lit: 0.3, tone: 0, every: 5, y: 5.2, w: 2, h: 0.8 }, doors: [{ side: 'w', off: 0, w: 6, h: 4.8 }, { side: 'e', off: 0, w: 6, h: 4.8 }] });
        const x0i = cx - bw / 2 + 2;
        const x1i = cx + bw / 2 - 2;
        shelfRow(k, x0i, x1i, bz - bd / 2 + 3);
        shelfRow(k, x0i, x1i, bz + bd / 2 - 3);
        for (let i = 0; i < 4; i++) { k.glow(cx - 12 + i * 8, 6, bz, 6, 0xffe2b0, 'steady', 1, 0.8); k.loot(cx - 12 + i * 8, bz - bd / 2 + 4.5); k.loot(cx - 12 + i * 8, bz + bd / 2 - 4.5); }
        parkTruck(k, cx + bw / 2 + 6, bz + bd / 2 - 3, 0);
      } else if (kind === 2) {
        k.building({ id: `off${n}`, x: cx, z: cz, w: Math.min(w - 10, 26), d: 14, h: 10, wall: 'brick', windows: { rows: 2, lit: 0.35, tone: 0, every: 4, y: 2.6 }, doors: [{ side: 's', off: 0, w: 2, h: 2.6 }] });
      } else if (kind === 3) {
        yard(k, rect);
      } else {
        k.building({ id: `wk${n}`, x: cx, z: cz, w: Math.min(w - 8, 30), d: 16, h: 6.5, wall: 'concreteStained', roof: 'gable', windows: { rows: 1, lit: 0.2, tone: 0, every: 5, y: 3.5 }, doors: [{ side: 's', off: -4, w: 4, h: 3.6 }] });
      }
      dressLot(k, rect);
    }
  }
  cage(k, 60, 35);
  roadCars(k, R(-6, 6, -25, 85), 'z', 3);
  roadCars(k, R(-196, 196, 20, 30), 'x', 6);
  // tuberías elevadas sobre la avenida
  for (const z of [10, 60]) {
    k.beam(-9, 7.5, z, 9, 7.5, z, 0.35, 'pipe', true);
    k.beam(-9, 6.9, z + 0.8, 9, 6.9, z + 0.8, 0.25, 'pipe', true);
    for (const s of [-1, 1]) k.cyl(s * 9, z, 0.3, 0, 7.5, 'steelDark', { seg: 8 });
  }
}

function yard(k: LayoutKit, r: Rect): void {
  const pitch = 17.6;
  for (let x = r.minX + 8; x < r.maxX - 6; x += pitch) {
    for (let z = r.minZ + 7; z < r.maxZ - 6; z += pitch) {
      if (k.chance(0.25)) continue;
      const along = k.chance(0.5) ? 'x' : 'z';
      const len = k.chance(0.5) ? 40 : 20;
      containerStack(k, x, z, along, len, k.int(1, 3));
      if (k.chance(0.4)) containerStack(k, x + (along === 'x' ? 0 : 4), z + (along === 'x' ? 4 : 0), along, 20, k.int(1, 2));
    }
  }
}

// ── Refinería ──────────────────────────────────────────────────────────────
function tank(k: LayoutKit, x: number, z: number, r: number, h: number): void {
  k.cyl(x, z, r + 0.6, 0, 0.3, 'concrete', { collide: false, cast: false });
  k.cyl(x, z, r, 0, h, k.pick(['metalPanel', 'rustMetal', 'containerGrey']), { seg: 40, cast: true });
  for (let y = 2.5; y < h; y += 3.2) k.cyl(x, z, r + 0.06, y, y + 0.25, 'steelDark', { collide: false, seg: 40, capTop: false });
  k.dome(x, z, r, h, r * 0.18, 'metalPanel');
  // escalera helicoidal
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a0 = i * 0.42;
    const a1 = (i + 1) * 0.42;
    k.beam(x + Math.cos(a0) * (r + 0.5), (i / n) * h, z + Math.sin(a0) * (r + 0.5), x + Math.cos(a1) * (r + 0.5), ((i + 1) / n) * h, z + Math.sin(a1) * (r + 0.5), 0.35, 'steelDark');
  }
  // tubería de salida
  k.beam(x + r, 1.2, z, x + r + 5, 1.2, z, 0.25, 'pipe', true);
  k.loot(x + r + 3, z + 3);
}

function refinery(k: LayoutKit): void {
  k.markDisc(-72, -68, 12, OCC.keep);
  // patio de contenedores (laberinto)
  yard(k, R(-96, -10, -92, -32));
  yard(k, R(-196, -108, -92, -32));
  k.paintGround(R(-196, -10, -92, -32), GK.gravel);
  let climbs = 0;
  for (let i = 0; i < 40 && climbs < 5; i++) {
    if (climbableContainer(k, k.rand(-190, -20), k.rand(-88, -36), k.chance(0.5) ? 'x' : 'z', 20, k.chance(0.5) ? 1 : -1)) climbs++;
  }
  // tanques
  for (const [x0, x1, z0, z1] of [[-192, -108, -195, -108], [108, 192, -195, -108], [16, 60, -92, -36]] as const) {
    k.paintGround(R(x0, x1, z0, z1), GK.gravel);
    for (let x = x0 + 14; x < x1 - 10; x += 32) {
      for (let z = z0 + 14; z < z1 - 10; z += 32) {
        const r = k.rand(7, 10.5);
        if (!k.isFreeDisc(x, z, r + 3, OCC.road | OCC.struct | OCC.keep)) continue;
        if (k.chance(0.25)) continue;
        tank(k, x, z, r, k.rand(9, 14));
        k.markDisc(x, z, r + 2, OCC.struct);
      }
    }
    k.scatter(R(x0, x1, z0, z1), 12, (x, z) => barrelCluster(k, x, z, 3, 1.5, k.chance(0.3)) > 0);
  }
  // racks de tuberías con pasarela
  for (const z of [-125, -170]) {
    for (let x = 84; x <= 186; x += 6) {
      if (k.occAt(x, z) & (OCC.road | OCC.struct)) continue;
      k.box(x, z, 0.5, 0.5, 0, 6, 'steelDark');
    }
    k.beam(84, 6, z, 186, 6, z, 0.5, 'steelDark');
    k.beam(84, 5.2, z + 0.4, 186, 5.2, z + 0.4, 0.4, 'pipe', true);
    k.beam(84, 4.6, z - 0.4, 186, 4.6, z - 0.4, 0.3, 'rustMetal', true);
  }
  // torre de proceso y antorcha
  k.cyl(140, -190, 3, 0, 32, 'metalPanel', { seg: 24 });
  k.cyl(175, -175, 0.7, 0, 60, 'steelDark', { rTop: 0.4, seg: 12 });
  k.cyl(175, -175, 0.35, 60, 63, 'emissiveAmber', { rTop: 0.05, collide: false, seg: 8, capTop: false });
  k.glow(175, 62, -175, 18, 0xff8830, 'flicker', 4, 1.3);
  k.pointLight('flare', 175, 58, -175, 0xff8a3a, 250, 90, 0.3);
  relayCompound(k);
  roadCars(k, R(-6, 6, -100, -25), 'z', 2);
  roadCars(k, R(-196, 196, -102, -94), 'x', 0);
  cage(k, -72, -68);
}

function relayCompound(k: LayoutKit): void {
  const { x, z, circleRadius } = MAP.relay;
  const r = R(x - 26, x + 26, z - 26, z + 26);
  k.paintGround(r, GK.concrete);
  k.mark(r, OCC.keep);
  // valla con cuatro accesos de 8 m
  const g: Array<[number, number]> = [[22, 30]];
  k.fence(r.minX, r.minZ, r.maxX, r.minZ, 2.6, g);
  k.fence(r.minX, r.maxZ, r.maxX, r.maxZ, 2.6, g);
  k.fence(r.minX, r.minZ, r.minX, r.maxZ, 2.6, g);
  k.fence(r.maxX, r.minZ, r.maxX, r.maxZ, 2.6, g);
  // anillo del círculo r=9 pintado
  k.flat(x, z, circleRadius + 0.2, circleRadius + 0.2, 0.06, 'hazard', 'ring', 0, circleRadius - 0.3);
  // torre reticulada: 4 patas a ±3.6 m
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      k.cyl(x + sx * 3.6, z + sz * 3.6, 0.28, 0, 22, 'steelDark', { rTop: 0.12, seg: 8, collide: true });
      k.cyl(x + sx * 0.6, z + sz * 0.6, 0.12, 22, 52, 'steelDark', { rTop: 0.06, seg: 6, collide: false });
      k.beam(x + sx * 3.6, 22, z + sz * 3.6, x + sx * 0.6, 22.5, z + sz * 0.6, 0.15, 'steelDark');
    }
  }
  for (let y = 3; y < 22; y += 4.5) {
    const s = 3.6 - (y / 22) * 3;
    k.beam(x - s, y, z - s, x + s, y, z - s, 0.12, 'steelDark');
    k.beam(x - s, y, z + s, x + s, y, z + s, 0.12, 'steelDark');
    k.beam(x - s, y, z - s, x - s, y, z + s, 0.12, 'steelDark');
    k.beam(x + s, y, z - s, x + s, y, z + s, 0.12, 'steelDark');
  }
  k.box(x, z, 1.1, 1.1, 0, 1.4, 'metalPanel', { collide: false });
  k.box(x, z, 0.7, 0.05, 0.8, 1.2, 'emissiveGreen', { collide: false, cast: false });
  k.glow(x, 52, z, 5, 0xff2020, 'blink', 0.9, 1.2);
  k.glow(x, 22, z, 4, 0xff2020, 'blink', 0.9, 1);
  k.pointLight('relay', x, 6, z, 0x9ad0ff, 60, 32);
  for (const [a, b] of [[-13, -13], [13, -13], [13, 13], [-13, 13]] as Array<[number, number]>) sandbagArc(k, x + a, z + b, 2.6, Math.atan2(-b, -a), 1.6);
  k.building({ id: 'relayShed', x: x + 20, z: z - 18, w: 7, d: 5, h: 3.2, wall: 'concrete', windows: false, doors: [{ side: 's', off: 0, w: 1.4, h: 2.2 }] });
  k.prop('generator', x - 20, z + 16, 0);
  k.loot(x - 18, z - 16);
  k.loot(x + 16, z + 17);
}

// ── Complejo de investigación ──────────────────────────────────────────────
function complex(k: LayoutKit): void {
  const g = MAP.complex.gate;
  k.paintGround(R(-75, 75, -200, -105), GK.concreteDark);
  k.paintGround(R(-40, 40, -185, -135), GK.tile);
  k.paintGround(R(-6, 6, -134, -105), GK.asphalt);
  const t = 1.2;
  const h = 5;
  const wz = g.z - 0.6;
  k.wall(-75, wz, 75, wz, t, 0, h, 'concrete', [[75 - g.width / 2, 75 + g.width / 2]], 0);
  k.wall(-74.4, -199, -74.4, wz, t, 0, h, 'concrete');
  k.wall(74.4, -199, 74.4, wz, t, 0, h, 'concrete');
  k.box(0, wz - 0.1, 26, 0.2, h, h + 1.3, 'fence', { collide: false, ray: false });
  for (const s of [-1, 1]) {
    k.box(s * 7.4, wz, 2, 2, 0, 7.5, 'concreteStained');
    k.box(s * 10.5, wz + 1.2, 4, 0.15, 0, 2.6, 'fence', { collide: false });
    k.glow(s * 7.4, 6.8, wz + 1.4, 5, 0xff2020, 'blink', 1.5, 1.1);
    k.box(s * 66, -112, 5, 5, 0, 8, 'concreteStained');
    k.box(s * 66, -112, 6, 6, 8, 8.4, 'steelDark', { collide: false });
    k.glow(s * 66, 9, -112, 9, 0xff2a2a, 'blink', 0.7, 1.2);
  }
  k.box(0, wz, 16, 1.6, 7, 8, 'hazard', { collide: false });
  // guardia
  k.building({ id: 'guard', x: 16, z: -114, w: 9, d: 7, h: 3.6, wall: 'labWall', windows: { rows: 1, lit: 0.8, tone: 3, every: 3, y: 1.6 }, doors: [{ side: 's', off: 0, w: 1.6, h: 2.3 }] });
  // edificios de laboratorio
  const lab = { rows: 2, lit: 0.45, tone: 3 as const, every: 4, y: 2.8 };
  k.building({ id: 'labMain', x: 0, z: -192, w: 60, d: 12, h: 10, wall: 'labWall', windows: { ...lab, tone: 1 }, doors: [{ side: 's', off: -14, w: 3, h: 2.8 }, { side: 's', off: 14, w: 3, h: 2.8 }], pilasters: 6 });
  k.building({ id: 'labW', x: -60, z: -175, w: 22, d: 34, h: 8, wall: 'labWall', windows: lab, doors: [{ side: 'e', off: 0, w: 3, h: 2.8 }] });
  k.building({ id: 'labE', x: 60, z: -175, w: 22, d: 34, h: 8, wall: 'labWall', windows: lab, doors: [{ side: 'w', off: 0, w: 3, h: 2.8 }] });
  k.building({ id: 'hallW', x: -60, z: -132, w: 26, d: 22, h: 7, wall: 'labWall', enterable: true, floor: GK.labFloor, windows: { ...lab, rows: 1, y: 4.5 }, doors: [{ side: 'e', off: 0, w: 5, h: 3.8 }, { side: 's', off: 0, w: 5, h: 3.8 }] });
  k.building({ id: 'hallE', x: 60, z: -132, w: 26, d: 22, h: 7, wall: 'labWall', enterable: true, floor: GK.labFloor, windows: { ...lab, rows: 1, y: 4.5 }, doors: [{ side: 'w', off: 0, w: 5, h: 3.8 }, { side: 's', off: 0, w: 5, h: 3.8 }] });
  for (const bx of [-60, 60]) {
    for (let i = 0; i < 3; i++) {
      k.prop('benchLab', bx - 6 + i * 6, -132 - 4, 0, { check: false });
      k.prop('benchLab', bx - 6 + i * 6, -132 + 5, 0, { check: false });
      k.loot(bx - 6 + i * 6, -132);
    }
    k.glow(bx, 6, -132, 8, 0xff5050, 'pulse', 0.5, 0.9);
  }
  // cúpula de contención (fuente de la contaminación)
  const c = MAP.complex.center;
  k.cyl(c.x, -152, 6.5, 0, 9, 'concreteStained', { seg: 32 });
  k.dome(c.x, -152, 6.5, 9, 4, 'labWall');
  k.flat(c.x, -152, 8.4, 8.4, 0.05, 'toxic', 'ring', 0, 7.2);
  k.cyl(c.x, -152, 6.7, 3, 3.6, 'emissiveGreen', { collide: false, seg: 32, capTop: false });
  k.glow(c.x, 5, -152, 22, 0x60ff70, 'pulse', 0.4, 0.9);
  k.pointLight('complex', c.x, 6, -160, 0xff3030, 120, 55, 0.1);
  // arena del Warden
  const w = MAP.complex.wardenSpawn;
  k.flat(w.x, w.z, 11, 11, 0.05, 'hazard', 'ring', 0, 10.4);
  cage(k, -24, -120);
  // barriles tóxicos, luces rojas, cajas
  for (let i = 0; i < 10; i++) {
    const a = k.rand(0, 6.28);
    const d = k.rand(14, 30);
    barrelCluster(k, c.x + Math.cos(a) * d, -160 + Math.sin(a) * d * 0.6, 3, 1.4, true);
  }
  for (let x = -70; x <= 70; x += 14) {
    k.box(x, -104.8, 0.4, 0.2, 3.6, 3.9, 'emissiveRed', { collide: false });
    k.glow(x, 3.7, -104, 3.5, 0xff2020, 'steady', 1, 0.9);
  }
  k.scatter(R(-70, 70, -190, -110), 14, (x, z) => crateStack(k, x, z, k.rand(0, 3), true));
  k.scatter(R(-70, 70, -190, -110), 4, (x, z) => puddle(k, x, z, 1.6, true) === undefined);
  for (let i = 0; i < 16; i++) k.loot(k.rand(-40, 40), k.rand(-185, -140));
}

// ── Skyline ────────────────────────────────────────────────────────────────
function skyline(k: LayoutKit): void {
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2 + k.rand(-0.05, 0.05);
    const d = k.rand(235, 300);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const kind = i % 4;
    if (kind === 0) {
      const h = k.rand(50, 90);
      k.cyl(x, z, 3.2, 0, h, 'concreteDark', { rTop: 2.2, collide: false, seg: 12 });
      k.glow(x, h + 1, z, 10, 0xff2020, 'blink', 0.6, 1.3);
    } else if (kind === 1) {
      const h = k.rand(25, 60);
      k.box(x, z, k.rand(14, 26), k.rand(14, 26), 0, h, 'concreteDark', { collide: false, cast: false });
      for (let j = 0; j < 4; j++) k.glow(x + k.rand(-5, 5), k.rand(5, h - 3), z, 3, 0xffc070, 'steady', 1, 0.6);
    } else if (kind === 2) {
      k.box(x, z, 2, 2, 0, 55, 'steelDark', { collide: false, cast: false });
      k.beam(x, 55, z, x + 30, 55, z + 6, 1.2, 'steelDark');
      k.beam(x, 62, z, x + 30, 55, z + 6, 0.5, 'steelDark');
      k.glow(x + 30, 54, z + 6, 8, 0xff2020, 'blink', 0.8, 1.1);
    } else {
      k.cyl(x, z, 11, 0, 40, 'concreteStained', { rTop: 7, collide: false, seg: 20 });
    }
  }
}

export function generateLayout(seed: number = WORLD.seed): WorldLayout {
  const k = new LayoutKit(seed);
  // suelo base por zona
  k.paintGround(R(-200, 200, -200, -25), GK.gravel);
  k.paintGround(R(-200, 200, -25, 85), GK.concrete);
  k.paintGround(R(-200, 200, 85, 200), GK.concrete);
  roads(k);
  pois(k);
  boundary(k);
  helipad(k);
  armory(k);
  radioNest(k);
  checkpoint(k);
  warehouses(k);
  refinery(k);
  complex(k);
  perimeter(k);
  k.paintRoadDetails();
  skyline(k);
  return k.finish();
}
