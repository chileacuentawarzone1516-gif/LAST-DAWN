/**
 * Botín en el suelo: modelos procedurales pequeños y legibles (fajo de billetes, caja de munición,
 * placa, granada, botiquín) con halo, rotación y flotación. Un `InstancedMesh` por tipo + halos
 * instanciados: unas pocas draw calls para todo el botín. Sin asignaciones por frame.
 *
 * La recogida es por proximidad (LOOT.pickupRadius) y se aplica con `rules/loot.applyPickup`: si el
 * objeto no sirve ahora (munición llena, vida completa…) NO se consume y se avisa una vez.
 * Los objetos soltados caducan a los LOOT.lifetimeS s (parpadean al final); el botín estático no.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LOOT, ZONE_IDS } from '../config';
import type { PickupKind } from '../config';
import type { GameContext } from '../core/context';
import type { Vec3 } from '../core/types';
import type { Rng } from '../core/util';
import { applyPickup, staticLootPlan } from '../rules/loot';
import type { GlowTextures } from './common';
import { announceMoney, notify } from './common';

/** Capacidad máxima de objetos vivos a la vez (estáticos + soltados). */
const CAPACITY = 240;
const KINDS: readonly PickupKind[] = ['cash', 'ammo', 'plate', 'grenade', 'medkit'];
const HOVER_HEIGHT = 0.55;
const MODEL_SCALE = 1.5;
/** Últimos segundos de vida en los que el objeto parpadea. */
const BLINK_WINDOW_S = 10;

const HALO_COLOR: Record<PickupKind, number> = {
  cash: 0xffd866, ammo: 0xffb020, plate: 0x6fb4ff, grenade: 0x8dff6a, medkit: 0xff5a5a,
};

const HINT: Record<PickupKind, string> = {
  cash: '', ammo: 'Munición al máximo', plate: 'Placas al máximo', grenade: 'Granadas al máximo', medkit: 'Vida completa',
};

// ── Modelos ──────────────────────────────────────────────────────────────────

type V3 = readonly [number, number, number];
const HALF_PI = Math.PI / 2;
const LIGHT = new THREE.Vector3(0.4, 0.85, 0.35).normalize();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Pieza con color por vértice sombreado (luz fija «horneada»): el modelo se lee sin luces en la escena. */
function part(src: THREE.BufferGeometry, hex: number, p: V3, r: V3 = [0, 0, 0], s: V3 = [1, 1, 1]): THREE.BufferGeometry {
  const geo = src.index ? src.toNonIndexed() : src;
  if (geo !== src) src.dispose();
  _e.set(r[0], r[1], r[2]);
  _q.setFromEuler(_e);
  _m.compose(_p.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
  geo.applyMatrix4(_m);
  geo.deleteAttribute('uv');
  const n = geo.getAttribute('normal');
  const colors = new Float32Array(n.count * 3);
  _c.set(hex);
  for (let i = 0; i < n.count; i++) {
    const lit = Math.max(0, n.getX(i) * LIGHT.x + n.getY(i) * LIGHT.y + n.getZ(i) * LIGHT.z);
    const k = 0.6 + 0.55 * lit;
    colors[i * 3] = _c.r * k;
    colors[i * 3 + 1] = _c.g * k;
    colors[i * 3 + 2] = _c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function build(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const g of parts) g.deleteAttribute('normal');
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return merged ?? new THREE.BufferGeometry();
}

function cashGeometry(): THREE.BufferGeometry {
  const bill = (): THREE.BufferGeometry => new THREE.BoxGeometry(0.34, 0.05, 0.18);
  return build([
    part(bill(), 0x49c46f, [0, 0.03, 0], [0, 0.0, 0]),
    part(bill(), 0x55d27c, [0.01, 0.09, 0.005], [0, 0.14, 0]),
    part(bill(), 0x49c46f, [-0.01, 0.15, -0.005], [0, -0.1, 0]),
    part(new THREE.BoxGeometry(0.08, 0.17, 0.2), 0xe9d8a6, [0, 0.09, 0]),
    part(new THREE.CylinderGeometry(0.06, 0.06, 0.018, 12), 0xffd866, [0.05, 0.195, 0.02], [0, 0, 0]),
  ]);
}

function ammoGeometry(): THREE.BufferGeometry {
  const bullet = (x: number): THREE.BufferGeometry[] => [
    part(new THREE.CylinderGeometry(0.036, 0.036, 0.15, 8), 0xd9ad3f, [x, 0.33, 0]),
    part(new THREE.ConeGeometry(0.036, 0.07, 8), 0xb4703c, [x, 0.445, 0]),
  ];
  return build([
    part(new THREE.BoxGeometry(0.44, 0.22, 0.28), 0x66763f, [0, 0.11, 0]),
    part(new THREE.BoxGeometry(0.46, 0.04, 0.13), 0x3f4b28, [0, 0.235, 0]),
    part(new THREE.BoxGeometry(0.16, 0.1, 0.01), 0xffd35a, [0, 0.12, 0.142]),
    ...bullet(-0.11), ...bullet(0), ...bullet(0.11),
  ]);
}

function plateGeometry(): THREE.BufferGeometry {
  return build([
    part(new THREE.BoxGeometry(0.36, 0.46, 0.07), 0x5b7da3, [0, 0.28, 0], [-0.08, 0, 0]),
    part(new THREE.BoxGeometry(0.21, 0.29, 0.02), 0xa6cdf3, [0, 0.28, 0.045], [-0.08, 0, 0]),
    part(new THREE.BoxGeometry(0.36, 0.05, 0.075), 0x3e5877, [0, 0.07, 0.005], [-0.08, 0, 0]),
  ]);
}

function grenadeGeometry(): THREE.BufferGeometry {
  return build([
    part(new THREE.SphereGeometry(0.115, 12, 9), 0x627a34, [0, 0.15, 0], [0, 0, 0], [1, 1.12, 1]),
    part(new THREE.CylinderGeometry(0.045, 0.05, 0.07, 8), 0x9298a1, [0, 0.29, 0]),
    part(new THREE.BoxGeometry(0.03, 0.022, 0.16), 0x9298a1, [0, 0.335, 0.05]),
    part(new THREE.TorusGeometry(0.048, 0.009, 6, 12), 0xd0d5dd, [0.075, 0.3, 0], [HALF_PI, 0, 0]),
  ]);
}

function medkitGeometry(): THREE.BufferGeometry {
  return build([
    part(new THREE.BoxGeometry(0.38, 0.25, 0.15), 0xeef2f5, [0, 0.14, 0]),
    part(new THREE.BoxGeometry(0.17, 0.045, 0.012), 0xe53a3a, [0, 0.14, 0.078]),
    part(new THREE.BoxGeometry(0.045, 0.17, 0.012), 0xe53a3a, [0, 0.14, 0.078]),
    part(new THREE.BoxGeometry(0.16, 0.03, 0.035), 0x8a929c, [0, 0.275, 0]),
  ]);
}

// ── Campo de botín ───────────────────────────────────────────────────────────

interface Entry {
  kind: number;
  amount: number;
  x: number;
  y: number;
  z: number;
  age: number;
  /** Segundos de vida (Infinity = estático). */
  ttl: number;
  phase: number;
  /** Ya se avisó de que no sirve ahora (se rearma al alejarse). */
  hinted: boolean;
}

export interface PickupField {
  /** Suelta un objeto. Si no queda sitio, expulsa el soltado más antiguo. */
  spawn(kind: PickupKind, amount: number, x: number, z: number, y: number, ttlS: number): void;
  /** Número de objetos vivos. */
  readonly count: number;
  update(dt: number): void;
  dispose(): void;
}

export function createPickups(ctx: GameContext, tex: GlowTextures, rng: Rng): PickupField {
  const { state } = ctx;
  const root = new THREE.Group();
  root.name = 'pickups';
  ctx.scene.add(root);

  const modelMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  const geos = [cashGeometry(), ammoGeometry(), plateGeometry(), grenadeGeometry(), medkitGeometry()];
  const meshes = geos.map((g) => {
    const mesh = new THREE.InstancedMesh(g, modelMat, CAPACITY);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    root.add(mesh);
    return mesh;
  });

  // Halos: columna fina aditiva + disco de brillo en el suelo (instanciados, color por objeto).
  const haloGeo = new THREE.CylinderGeometry(0.2, 0.34, 3.2, 10, 1, true);
  haloGeo.translate(0, 1.6, 0);
  const haloMat = new THREE.MeshBasicMaterial({
    map: tex.vertical, color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.FrontSide,
  });
  const halo = new THREE.InstancedMesh(haloGeo, haloMat, CAPACITY);
  const glowGeo = new THREE.CircleGeometry(0.95, 20);
  glowGeo.rotateX(-HALF_PI);
  const glowMat = new THREE.MeshBasicMaterial({
    map: tex.radial, color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const glow = new THREE.InstancedMesh(glowGeo, glowMat, CAPACITY);
  for (const m of [halo, glow]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    m.renderOrder = 2;
    root.add(m);
  }
  const haloColors = KINDS.map((k) => new THREE.Color(HALO_COLOR[k]));

  const entries: Entry[] = [];
  for (let i = 0; i < CAPACITY; i++) {
    entries.push({ kind: 0, amount: 0, x: 0, y: 0, z: 0, age: 0, ttl: 0, phase: 0, hinted: false });
  }
  const free: Entry[] = entries.slice();
  const live: Entry[] = [];
  const counts = new Int32Array(KINDS.length);

  const dummy = new THREE.Object3D();
  const evPos: Vec3 = { x: 0, y: 0, z: 0 };
  const r2 = LOOT.pickupRadius * LOOT.pickupRadius;
  let clock = 0;
  let hintCooldown = 0;

  function despawnAt(i: number): void {
    const e = live[i] as Entry;
    const last = live.pop() as Entry;
    if (last !== e) live[i] = last;
    free.push(e);
  }

  function spawn(kind: PickupKind, amount: number, x: number, z: number, y: number, ttlS: number): void {
    let e = free.pop();
    if (!e) {
      // Sin sitio: se expulsa el soltado más antiguo (los estáticos no caducan ni se expulsan).
      let oldest = -1;
      let oldestAge = -1;
      for (let i = 0; i < live.length; i++) {
        const c = live[i] as Entry;
        if (c.ttl !== Infinity && c.age > oldestAge) {
          oldest = i;
          oldestAge = c.age;
        }
      }
      if (oldest < 0) return;
      e = live[oldest] as Entry;
      despawnAt(oldest);
      free.pop();
    }
    e.kind = Math.max(0, KINDS.indexOf(kind));
    e.amount = amount;
    e.x = x;
    e.y = y;
    e.z = z;
    e.age = 0;
    e.ttl = ttlS;
    e.phase = rng() * Math.PI * 2;
    e.hinted = false;
    live.push(e);
  }

  /** Recoge el objeto si sirve; emite los eventos de economía/inventario y avisa por HUD. */
  function collect(e: Entry): boolean {
    const kind = KINDS[e.kind] as PickupKind;
    const moneyBefore = state.player.money;
    const out = applyPickup(state, kind, e.amount);
    if (!out.collected) return false;
    evPos.x = e.x;
    evPos.y = e.y + HOVER_HEIGHT;
    evPos.z = e.z;
    ctx.bus.emit('pickup:collected', { kind, amount: out.amount, pos: evPos });
    if (kind === 'cash') {
      announceMoney(ctx, moneyBefore, 'pickup');
      notify(ctx, `+$${out.amount}`, 'reward');
      return true;
    }
    ctx.bus.emit('loadout:changed', {});
    switch (kind) {
      case 'ammo':
        notify(ctx, `+${out.amount} munición`, 'info');
        break;
      case 'plate':
        notify(ctx, '+1 placa de armadura', 'info');
        break;
      case 'grenade':
        notify(ctx, '+1 granada', 'info');
        break;
      case 'medkit':
        ctx.bus.emit('player:healed', { amount: out.amount, hp: state.player.hp });
        notify(ctx, `+${Math.round(out.amount)} de vida`, 'info');
        break;
    }
    return true;
  }

  return {
    spawn,
    get count() {
      return live.length;
    },
    update(dt) {
      clock += dt;
      hintCooldown = Math.max(0, hintCooldown - dt);
      const p = state.player.pos;
      const canPick = state.player.alive && state.match.phase === 'playing';
      counts.fill(0);
      let n = 0;
      for (let i = live.length - 1; i >= 0; i--) {
        const e = live[i] as Entry;
        e.age += dt;
        if (e.age >= e.ttl) {
          despawnAt(i);
          continue;
        }
        if (canPick) {
          const dx = p.x - e.x;
          const dz = p.z - e.z;
          if (dx * dx + dz * dz <= r2 && Math.abs(p.y - e.y) < 2.5) {
            if (collect(e)) {
              despawnAt(i);
              continue;
            }
            if (!e.hinted && hintCooldown <= 0) {
              e.hinted = true;
              hintCooldown = 1.5;
              notify(ctx, HINT[KINDS[e.kind] as PickupKind], 'info');
            }
          } else e.hinted = false;
        }
        // Parpadeo en los últimos segundos de un objeto soltado.
        const left = e.ttl - e.age;
        const blink = left < BLINK_WINDOW_S && (left < 3 ? clock % 0.24 < 0.12 : clock % 0.6 < 0.4) ? 0.001 : 1;
        const bob = Math.sin(clock * 2.3 + e.phase) * 0.08;
        dummy.position.set(e.x, e.y + HOVER_HEIGHT + bob, e.z);
        dummy.rotation.set(0, clock * 1.5 + e.phase, 0);
        dummy.scale.setScalar(MODEL_SCALE * blink);
        dummy.updateMatrix();
        (meshes[e.kind] as THREE.InstancedMesh).setMatrixAt(counts[e.kind] as number, dummy.matrix);
        counts[e.kind] = (counts[e.kind] as number) + 1;

        dummy.position.set(e.x, e.y, e.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(blink);
        dummy.updateMatrix();
        halo.setMatrixAt(n, dummy.matrix);
        glow.setMatrixAt(n, dummy.matrix);
        const col = haloColors[e.kind] as THREE.Color;
        halo.setColorAt(n, col);
        glow.setColorAt(n, col);
        n++;
      }
      for (let k = 0; k < meshes.length; k++) {
        const mesh = meshes[k] as THREE.InstancedMesh;
        mesh.count = counts[k] as number;
        mesh.instanceMatrix.needsUpdate = true;
      }
      halo.count = n;
      glow.count = n;
      halo.instanceMatrix.needsUpdate = true;
      glow.instanceMatrix.needsUpdate = true;
      if (halo.instanceColor) halo.instanceColor.needsUpdate = true;
      if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
    },
    dispose() {
      ctx.scene.remove(root);
      for (const m of meshes) m.dispose();
      halo.dispose();
      glow.dispose();
      for (const g of geos) g.dispose();
      haloGeo.dispose();
      glowGeo.dispose();
      modelMat.dispose();
      haloMat.dispose();
      glowMat.dispose();
      live.length = 0;
    },
  };
}

/** Reparto estático inicial por zonas (posiciones de `world.lootSpots` + reglas de botín). */
export function spawnStaticLoot(ctx: GameContext, field: PickupField, rng: Rng): number {
  let total = 0;
  for (const zone of ZONE_IDS) {
    const spots = ctx.world.lootSpots[zone] ?? [];
    for (const item of staticLootPlan(rng, zone, spots)) {
      const y = Math.max(0, ctx.world.groundHeight(item.x, item.z, 0.3, 0));
      field.spawn(item.kind, item.amount, item.x, item.z, y, Infinity);
      total++;
    }
  }
  return total;
}
