/**
 * Preview del jugador y las armas: campo de tiro con dianas simuladas (cabeza/cuerpo/piernas),
 * muros y cajas (colisión y escalones), panel de depuración y botones.
 */
import * as THREE from 'three';
import { ENEMIES, MAP, PLAYER, WEAPONS } from '../src/config';
import type { EnemiesApi, EnemyHandle, EnemyRayHit, GameContext, MoveResult, WorldApi } from '../src/core/context';
import type { EnemyType, HitZone, Vec3, WeaponId } from '../src/core/types';
import { createWeaponSlot } from '../src/core/state';
import { createDevGame, devPageStyles } from '../src/dev/harness';
import { createStubWorld } from '../src/dev/stubs';

interface Box {
  minX: number; maxX: number; minZ: number; maxZ: number; top: number;
}

/** Mundo de campo de tiro: el stub más cajas, muros y una plataforma escalonada. */
function createRangeWorld(ctx: GameContext): WorldApi {
  const base = createStubWorld(ctx);
  const boxes: Box[] = [
    { minX: -30, maxX: -14, minZ: 100, maxZ: 102, top: 4 }, // muro de fondo
    { minX: -27, maxX: -25, minZ: 158, maxZ: 160, top: 0.4 }, // escalón bajo
    { minX: -20, maxX: -18, minZ: 158, maxZ: 160, top: 0.9 }, // caja
    { minX: -15, maxX: -12, minZ: 150, maxZ: 153, top: 1.6 }, // caja alta
    { minX: -33, maxX: -31, minZ: 120, maxZ: 170, top: 3 }, // muro lateral
  ];
  const group = new THREE.Group();
  for (const b of boxes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX, b.top, b.maxZ - b.minZ), ctx.materials.get('concrete'));
    m.position.set((b.minX + b.maxX) / 2, b.top / 2, (b.minZ + b.maxZ) / 2);
    group.add(m);
  }
  ctx.scene.add(group);
  const inBox = (b: Box, x: number, z: number, r: number): boolean => x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r;
  const world: WorldApi = {
    ...base,
    moveCircle(x, z, dx, dz, r, footY, _h, out): MoveResult {
      const res = out ?? { x: 0, z: 0, blockedX: false, blockedZ: false };
      const blocks = (px: number, pz: number): boolean => boxes.some((b) => b.top > footY + PLAYER.stepHeight && inBox(b, px, pz, r));
      let nx = x + dx;
      let nz = z;
      res.blockedX = false;
      res.blockedZ = false;
      if (blocks(nx, nz)) { nx = x; res.blockedX = true; }
      nz = z + dz;
      if (blocks(nx, nz)) { nz = z; res.blockedZ = true; }
      res.x = nx;
      res.z = nz;
      return res;
    },
    groundHeight(x, z, r, footY) {
      let h = 0;
      for (const b of boxes) if (b.top <= footY + PLAYER.stepHeight && b.top > h && inBox(b, x, z, r * 0.5)) h = b.top;
      return h;
    },
    raycast(o, d, maxDist) {
      let best = base.raycast(o, d, maxDist);
      let bestT = best ? best.distance : maxDist;
      for (const b of boxes) {
        let t0 = 0, t1 = bestT, nAxis = -1, nSign = 0;
        const lo = [b.minX, 0, b.minZ], hi = [b.maxX, b.top, b.maxZ];
        const oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
        let ok = true;
        for (let a = 0; a < 3 && ok; a++) {
          const da = dd[a] as number, oa = oo[a] as number;
          if (Math.abs(da) < 1e-9) { if (oa < (lo[a] as number) || oa > (hi[a] as number)) ok = false; continue; }
          let ta = ((lo[a] as number) - oa) / da, tb = ((hi[a] as number) - oa) / da, s = -1;
          if (ta > tb) { const t = ta; ta = tb; tb = t; s = 1; }
          if (ta > t0) { t0 = ta; nAxis = a; nSign = s; }
          if (tb < t1) t1 = tb;
          if (t0 > t1) ok = false;
        }
        if (ok && nAxis >= 0 && t0 < bestT) {
          bestT = t0;
          const n = { x: 0, y: 0, z: 0 };
          if (nAxis === 0) n.x = nSign; else if (nAxis === 1) n.y = nSign; else n.z = nSign;
          best = { distance: t0, point: { x: o.x + d.x * t0, y: o.y + d.y * t0, z: o.z + d.z * t0 }, normal: n, surface: 'concrete' };
        }
      }
      return best;
    },
  };
  return world;
}

interface Target {
  id: number;
  type: EnemyType;
  hp: number;
  maxHp: number;
  position: Vec3;
  alive: boolean;
  mesh: THREE.Group;
  pos: Vec3;
  hpv: number;
  alive2: boolean;
  respawnT: number;
  home: Vec3;
  moveAmp: number;
  phase: number;
  helmet: number;
}

function createMockEnemies(ctx: GameContext): EnemiesApi {
  const targets: Target[] = [];
  let nextId = 1;
  const geos = new THREE.BoxGeometry(1, 1, 1);
  const addTarget = (type: EnemyType, x: number, z: number, moving: boolean): Target => {
    const def = ENEMIES.walker;
    const g = new THREE.Group();
    const mk = (mat: 'skinGrey' | 'clothRag' | 'skinGreen', sx: number, sy: number, sz: number, y: number): void => {
      const m = new THREE.Mesh(geos, ctx.materials.get(mat));
      m.scale.set(sx, sy, sz);
      m.position.y = y;
      g.add(m);
    };
    mk('clothRag', 0.28, 0.85, 0.18, 0.42);
    mk('clothRag', 0.5, 0.6, 0.24, 1.15);
    mk('skinGreen', 0.24, 0.26, 0.24, 1.6);
    g.position.set(x, 0, z);
    ctx.scene.add(g);
    const pos = { x, y: 0, z };
    const t: Target = {
      id: nextId++, type, hp: def.hp, maxHp: def.hp, mesh: g, pos, position: pos, alive: true, hpv: def.hp, alive2: true, respawnT: 0,
      home: { x, y: 0, z }, moveAmp: moving ? 6 : 0, phase: Math.random() * 6, helmet: type === 'warden' ? 200 : 0,
    };
    targets.push(t);
    return t;
  };
  for (let i = 0; i < 5; i++) addTarget('walker', -22 + (i - 2) * 4, 150 - i * 8, i % 2 === 1);
  addTarget('warden', -22, 108, false);
  const zoneOf = (dy: number): HitZone => (dy > 1.45 ? 'head' : dy > 0.85 ? 'body' : 'limb');
  const api: EnemiesApi = {
    get aliveCount() { return targets.filter((t) => t.alive2).length; },
    get list(): readonly EnemyHandle[] { return targets; },
    raycast(o, d, maxDist): EnemyRayHit | null {
      let best: EnemyRayHit | null = null;
      for (const t of targets) {
        if (!t.alive2) continue;
        // cilindro vertical de radio 0.3 y altura 1.75 (zona por altura del impacto)
        const ox = o.x - t.pos.x, oz = o.z - t.pos.z;
        const a = d.x * d.x + d.z * d.z;
        if (a < 1e-9) continue;
        const b = 2 * (ox * d.x + oz * d.z);
        const c = ox * ox + oz * oz - 0.3 * 0.3;
        const disc = b * b - 4 * a * c;
        if (disc < 0) continue;
        const s = (-b - Math.sqrt(disc)) / (2 * a);
        if (s < 0 || s > maxDist || (best && s >= best.distance)) continue;
        const y = o.y + d.y * s - t.pos.y;
        if (y < 0 || y > 1.75) continue;
        const px = o.x + d.x * s, pz = o.z + d.z * s;
        const nl = Math.hypot(px - t.pos.x, pz - t.pos.z) || 1;
        best = {
          enemy: t, zone: zoneOf(y), distance: s, point: { x: px, y: o.y + d.y * s, z: pz },
          normal: { x: (px - t.pos.x) / nl, y: 0, z: (pz - t.pos.z) / nl },
        };
      }
      return best;
    },
    applyDamage(enemy, info) {
      const t = targets.find((q) => q.id === enemy.id);
      if (!t || !t.alive2) return;
      const def = ENEMIES.walker;
      let helmetHit = false;
      let dmg = info.amount * (info.zone === 'head' ? def.headMult : info.zone === 'body' ? def.bodyMult : def.limbMult);
      if (t.helmet > 0 && info.zone === 'head') { helmetHit = true; dmg = info.amount; t.helmet -= dmg; dmg = 0; }
      t.hpv -= dmg;
      const killed = t.hpv <= 0;
      if (killed) { t.alive2 = false; t.alive = false; t.respawnT = 2.5; t.mesh.rotation.x = -Math.PI / 2; }
      t.hp = Math.max(0, t.hpv);
      ctx.bus.emit('enemy:hit', {
        id: t.id, type: t.type, pos: t.pos, point: info.point, normal: info.normal, zone: info.zone,
        damage: dmg, killed, helmetHit, helmetBroken: helmetHit && t.helmet <= 0,
      });
      t.mesh.scale.setScalar(1.06);
    },
    explode(center, radius, maxDamage, minMult) {
      for (const t of targets) {
        if (!t.alive2) continue;
        const d = Math.hypot(t.pos.x - center.x, t.pos.z - center.z);
        if (d > radius) continue;
        const amount = maxDamage * (1 - (1 - minMult) * (d / radius));
        api.applyDamage(t, { amount, zone: 'body', point: t.pos, normal: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 1, z: 0 } });
      }
    },
    spawn(type, x, z) { return addTarget(type, x, z, true); },
    killAll() { for (const t of targets) { t.alive2 = false; t.alive = false; t.mesh.rotation.x = -Math.PI / 2; t.respawnT = 3; } },
    update(dt) {
      const time = performance.now() / 1000;
      for (const t of targets) {
        t.mesh.scale.setScalar(1 + (t.mesh.scale.x - 1) * 0.85);
        if (!t.alive2) {
          t.respawnT -= dt;
          if (t.respawnT <= 0) { t.alive2 = true; t.alive = true; t.hpv = ENEMIES.walker.hp; t.helmet = t.type === 'warden' ? 200 : 0; t.mesh.rotation.x = 0; }
          continue;
        }
        if (t.moveAmp > 0) { t.pos.x = t.home.x + Math.sin(time * 0.6 + t.phase) * t.moveAmp; t.mesh.position.x = t.pos.x; }
      }
    },
    dispose() {
      for (const t of targets) ctx.scene.remove(t.mesh);
      geos.dispose();
    },
  } as EnemiesApi & { dispose(): void };
  return api;
}

const game = createDevGame({ use: ['player'], overrides: { enemies: createMockEnemies, world: createRangeWorld } });
const ctx = game.ctx;
ctx.player.teleport(MAP.spawn.x, MAP.spawn.z, 0);

const style = document.createElement('style');
style.textContent = devPageStyles;
document.head.appendChild(style);
const panel = document.createElement('div');
panel.className = 'dev-panel';
panel.innerHTML = '<div id="hud"></div>';
const hud = panel.firstElementChild as HTMLElement;
document.body.appendChild(panel);
const btn = (label: string, fn: () => void): void => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  panel.appendChild(b);
};
const give = (id: WeaponId): void => {
  const def = WEAPONS[id];
  ctx.state.player.slots[def.slot] = createWeaponSlot(id, 3);
  ctx.state.player.activeSlot = def.slot;
  ctx.bus.emit('loadout:changed', {});
};
for (const id of Object.keys(WEAPONS) as WeaponId[]) btn(id, () => give(id));
btn('munición', () => { for (const s of ctx.state.player.slots) if (s) { s.mag = WEAPONS[s.id].magSize; s.reserve = WEAPONS[s.id].reserveMax; } });
btn('daño 20', () => ctx.player.damage(20, 'melee', { x: -22, y: 1, z: 150 }));
btn('+placa', () => { ctx.state.player.plates++; });
btn('+granada', () => { ctx.state.player.grenades++; });
btn('curar', () => ctx.player.heal(100));
btn('diana móvil', () => { ctx.enemies.spawn('walker', -22 + (Math.random() - 0.5) * 10, 140 - Math.random() * 20); });
let last = '-';
ctx.bus.on('player:hitConfirm', (e) => { last = `${e.zone}${e.helmet ? ' casco' : ''}${e.killed ? ' MUERTE' : ''}`; });
setInterval(() => {
  const p = ctx.state.player;
  const s = p.slots[p.activeSlot];
  hud.textContent = `${s ? `${s.id} ${s.mag}/${s.reserve}` : '-'} | hp ${p.hp.toFixed(0)} arm ${p.armor.toFixed(0)} placas ${p.plates} gran ${p.grenades} | spread ${p.spread.toFixed(2)} | ` +
    `${p.aiming ? 'ADS ' : ''}${p.sprinting ? 'RUN ' : ''}${p.crouched ? 'CROUCH ' : ''}${p.reloading ? 'RELOAD ' : ''}${p.usingPlate ? 'PLATE ' : ''}| hit: ${last} | fps ${ctx.engine.stats.fps.toFixed(0)}`;
}, 100);

// ── Autocomprobación de la respuesta al disparar (window.__playerCheck) ───────────────────────
interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

declare global {
  interface Window {
    __playerCheck?: () => CheckResult[];
  }
}

/**
 * Falla si disparar frena/detiene el movimiento o retrasa el primer disparo (mismo criterio que
 * tests/player.fire.test.ts, pero con el juego real de esta página: mundo del campo de tiro y motor).
 */
function runChecks(): CheckResult[] {
  const out: CheckResult[] = [];
  const dt = 1 / 60;
  const frames = (n: number): void => { for (let i = 0; i < n; i++) game.update(dt); };
  const release = (): void => {
    for (const a of ['forward', 'back', 'left', 'right', 'sprint', 'fire', 'aim', 'jump'] as const) ctx.input.inject(a, false);
    ctx.input.setStick(0, 0);
  };
  const reset = (id: WeaponId): void => {
    release();
    const def = WEAPONS[id];
    ctx.state.player.slots[def.slot] = { ...createWeaponSlot(id, 3), mag: 9999 };
    ctx.state.player.activeSlot = def.slot;
    ctx.bus.emit('loadout:changed', {});
    ctx.player.teleport(20, 190, 0);
    frames(40);
  };
  const shots = (): number => ctx.state.match.shotsFired;
  const dist = (n: number): number => {
    const p = ctx.player.position;
    const z0 = p.z;
    const x0 = p.x;
    frames(n);
    return Math.hypot(p.x - x0, p.z - z0);
  };

  for (const [label, keys] of [['quieto', []], ['caminando', ['forward']], ['de lado', ['right']], ['corriendo', ['forward', 'sprint']]] as const) {
    reset('carbine');
    for (const k of keys) ctx.input.inject(k, true);
    frames(30);
    const s0 = shots();
    ctx.input.inject('fire', true);
    game.update(dt);
    out.push({ name: `primer disparo mismo frame · ${label}`, ok: shots() === s0 + 1, detail: `${shots() - s0} disparo(s) en el frame de la pulsación` });
  }

  reset('smg');
  ctx.input.inject('right', true);
  frames(30);
  const a = dist(45);
  reset('smg');
  ctx.input.inject('right', true);
  frames(30);
  ctx.input.inject('fire', true);
  const s1 = shots();
  const b = dist(45);
  out.push({ name: 'disparar no frena el movimiento (de lado)', ok: b >= a * 0.999 && shots() > s1, detail: `sin disparar ${a.toFixed(3)} m · disparando ${b.toFixed(3)} m` });

  reset('carbine');
  ctx.input.inject('forward', true);
  frames(20);
  const s2 = shots();
  ctx.input.inject('fire', true);
  ctx.input.inject('fire', false);
  game.update(dt);
  out.push({ name: 'clic más corto que un frame dispara', ok: shots() === s2 + 1, detail: `${shots() - s2} disparo(s)` });

  reset('carbine');
  ctx.input.inject('forward', true);
  ctx.input.inject('sprint', true);
  frames(40);
  const s3 = shots();
  ctx.input.inject('fire', true);
  game.update(dt);
  out.push({ name: 'correr + disparar: sprint termina y el disparo sale ya', ok: shots() === s3 + 1 && !ctx.state.player.sprinting, detail: `sprinting=${ctx.state.player.sprinting}` });
  release();
  return out;
}

if (new URLSearchParams(window.location.search).get('qa') === '1') window.__playerCheck = runChecks;
btn('autocomprobar', () => {
  const r = runChecks();
  last = r.every((c) => c.ok) ? 'CHECK OK' : `CHECK FALLA: ${r.filter((c) => !c.ok).map((c) => c.name).join(', ')}`;
});
