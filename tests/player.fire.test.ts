/**
 * Regresión de la respuesta al disparar: integración de createPlayer con un contexto simulado
 * (sin DOM ni WebGL). Falla si disparar frena/detiene el movimiento o si el primer disparo se retrasa.
 * Con PLAYER_BENCH=1 imprime las mediciones (latencia en frames, velocidad, dispersión).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHARACTER, PLAYER, WEAPON_HANDLING, WEAPONS } from '../src/config';
import type { Action, GameContext } from '../src/core/context';
import { EventBus } from '../src/core/events';
import { createRunState, createWeaponSlot } from '../src/core/state';
import type { WeaponId } from '../src/core/types';
import { createPlayer } from '../src/player';
import { defaultProfile, normalizeProfile, resolveLook } from '../src/rules/character';
import { currentSpreadDeg, fireIntervalS } from '../src/rules/weapons';
import { FEMALE_HAND_SCALE, resolveArmLook } from '../src/weapons/armLook';

/** Entrada simulada con la misma semántica de flancos que core/input.ts. */
class FakeInput {
  enabled = true;
  touch = false;
  locked = true;
  wheelDelta = 0;
  lookDX = 0;
  lookDY = 0;
  private stickX = 0;
  private stickY = 0;
  private readonly down = new Set<Action>();
  private readonly pressed = new Set<Action>();
  private readonly released = new Set<Action>();
  get moveX(): number {
    const k = (this.down.has('right') ? 1 : 0) - (this.down.has('left') ? 1 : 0);
    return Math.max(-1, Math.min(1, k + this.stickX));
  }
  get moveY(): number {
    const k = (this.down.has('forward') ? 1 : 0) - (this.down.has('back') ? 1 : 0);
    return Math.max(-1, Math.min(1, k + this.stickY));
  }
  setStick(x: number, y: number): void {
    this.stickX = x;
    this.stickY = y;
  }
  isDown = (a: Action): boolean => this.down.has(a);
  wasPressed = (a: Action): boolean => this.pressed.has(a);
  wasReleased = (a: Action): boolean => this.released.has(a);
  inject(a: Action, d: boolean): void {
    if (d) {
      if (!this.down.has(a)) {
        this.down.add(a);
        this.pressed.add(a);
      }
    } else if (this.down.delete(a)) this.released.add(a);
  }
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.wheelDelta = 0;
    this.lookDX = 0;
    this.lookDY = 0;
  }
}

function makeRig(id: WeaponId = 'carbine', dt = 1 / 60) {
  const bus = new EventBus();
  const state = createRunState();
  state.flow = 'playing';
  const def = WEAPONS[id];
  state.player.slots[def.slot] = { ...createWeaponSlot(id, 3), mag: 9999 };
  state.player.activeSlot = def.slot;
  const input = new FakeInput();
  const mats = new Map<string, THREE.Material>();
  const ctx = {
    bus, state, input, qa: true,
    scene: new THREE.Scene(), viewScene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(PLAYER.fov, 16 / 9, 0.05, 300),
    viewCamera: new THREE.PerspectiveCamera(58, 16 / 9, 0.01, 10),
    materials: {
      get: (k: string) => {
        let m = mats.get(k);
        if (!m) {
          m = new THREE.MeshBasicMaterial();
          mats.set(k, m);
        }
        return m;
      },
      tile: () => 4,
    },
    fx: { burst() {}, tracer() {}, decal() {}, flash() {}, update() {} },
    world: {
      moveCircle: (x: number, z: number, dx: number, dz: number, _r: number, _f: number, _h: number, out?: { x: number; z: number; blockedX: boolean; blockedZ: boolean }) => {
        const o = out ?? { x: 0, z: 0, blockedX: false, blockedZ: false };
        o.x = x + dx;
        o.z = z + dz;
        o.blockedX = o.blockedZ = false;
        return o;
      },
      groundHeight: () => 0,
      raycast: () => null,
      hasLineOfSight: () => true,
      surfaceAt: () => 'asphalt',
      zoneAt: () => 'perimeter',
    },
    enemies: { raycast: () => null, applyDamage() {}, explode() {} },
  } as unknown as GameContext;
  ctx.player = createPlayer(ctx);
  let shots = 0;
  bus.on('player:shot', () => shots++);
  const frame = (): void => {
    ctx.player.update(dt);
    input.endFrame();
  };
  const run = (frames: number): void => {
    for (let i = 0; i < frames; i++) frame();
  };
  return { ctx, input, state, bus, frame, run, dt, get shots() { return shots; }, def };
}

/** Velocidad horizontal media (m/s) durante `frames` frames. */
function avgSpeed(rig: ReturnType<typeof makeRig>, frames: number): number {
  const p = rig.ctx.player.position;
  const x0 = p.x;
  const z0 = p.z;
  let path = 0;
  let lx = x0;
  let lz = z0;
  for (let i = 0; i < frames; i++) {
    rig.frame();
    path += Math.hypot(p.x - lx, p.z - lz);
    lx = p.x;
    lz = p.z;
  }
  return path / (frames * rig.dt);
}

const bench = process.env.PLAYER_BENCH === '1';
const log = (...a: unknown[]): void => {
  if (bench) console.info('[bench]', ...a);
};

/** Frames que tarda el primer disparo tras pulsar (0 = el mismo frame). */
function firstShotLatency(setup: (r: ReturnType<typeof makeRig>) => void, id: WeaponId = 'carbine', dt = 1 / 60): number {
  const rig = makeRig(id, dt);
  rig.run(60); // deja subir el arma
  setup(rig);
  rig.run(45);
  const before = rig.shots;
  rig.input.inject('fire', true);
  for (let i = 0; i < 30; i++) {
    rig.frame();
    if (rig.shots > before) return i;
  }
  return -1;
}

const scenarios: Array<[string, (r: ReturnType<typeof makeRig>) => void]> = [
  ['quieto', () => {}],
  ['caminando', (r) => r.input.inject('forward', true)],
  ['de lado', (r) => r.input.inject('right', true)],
  ['diagonal', (r) => { r.input.inject('forward', true); r.input.inject('left', true); }],
  ['agachado y andando', (r) => { r.input.inject('crouch', true); r.frame(); r.input.inject('crouch', false); r.input.inject('forward', true); }],
  ['corriendo', (r) => { r.input.inject('forward', true); r.input.inject('sprint', true); }],
  ['apuntando', (r) => { r.input.inject('aim', true); r.input.inject('forward', true); }],
  ['apuntando y corriendo', (r) => { r.input.inject('forward', true); r.input.inject('sprint', true); r.input.inject('aim', true); }],
];

describe('primer disparo: sale en el mismo frame en que se pulsa', () => {
  for (const [name, setup] of scenarios) {
    it(`${name}`, () => {
      const lat = firstShotLatency(setup);
      log('latencia primer disparo', name, `${lat} frames`);
      expect(lat).toBe(0);
    });
  }
  it('en el aire (saltando)', () => {
    const rig = makeRig('carbine');
    rig.run(60);
    rig.input.inject('forward', true);
    rig.run(20);
    rig.input.inject('jump', true);
    rig.frame();
    rig.input.inject('jump', false);
    rig.run(3);
    expect(rig.ctx.player.velocity.y).not.toBe(0);
    const before = rig.shots;
    rig.input.inject('fire', true);
    rig.frame();
    expect(rig.shots).toBe(before + 1);
  });
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    it(`todas las armas andando: ${id}`, () => {
      expect(firstShotLatency((r) => r.input.inject('forward', true), id)).toBe(0);
    });
  }
  it('a 15 FPS también', () => {
    expect(firstShotLatency((r) => r.input.inject('forward', true), 'carbine', 1 / 15)).toBe(0);
  });
  it('un clic más corto que un frame (pulsar y soltar) dispara igualmente (automática)', () => {
    const rig = makeRig('carbine');
    rig.run(60);
    rig.input.inject('forward', true);
    rig.run(10);
    const before = rig.shots;
    rig.input.inject('fire', true);
    rig.input.inject('fire', false);
    rig.frame();
    expect(rig.shots).toBe(before + 1);
  });
  it('un clic más corto que un frame dispara (semiautomática)', () => {
    const rig = makeRig('pistol');
    rig.run(60);
    const before = rig.shots;
    rig.input.inject('fire', true);
    rig.input.inject('fire', false);
    rig.frame();
    expect(rig.shots).toBe(before + 1);
  });
});

describe('disparar no reduce ni detiene el movimiento', () => {
  const moves: Array<[string, (r: ReturnType<typeof makeRig>) => void]> = [
    ['caminar', (r) => r.input.inject('forward', true)],
    ['ir de lado', (r) => r.input.inject('right', true)],
    ['retroceder', (r) => r.input.inject('back', true)],
    ['diagonal', (r) => { r.input.inject('forward', true); r.input.inject('right', true); }],
    ['agachado', (r) => { r.input.inject('crouch', true); r.frame(); r.input.inject('crouch', false); r.input.inject('forward', true); }],
    ['analógico a medias', (r) => r.input.setStick(0.5, 0.6)],
  ];
  for (const id of ['carbine', 'pistol', 'shotgun', 'smg', 'dmr'] as WeaponId[]) {
    for (const [name, setup] of moves) {
      it(`${id} · ${name}`, () => {
        const a = makeRig(id);
        a.run(60);
        setup(a);
        a.run(30);
        const idle = avgSpeed(a, 60);
        const b = makeRig(id);
        b.run(60);
        setup(b);
        b.run(30);
        b.input.inject('fire', true);
        const firing = avgSpeed(b, 60);
        log('velocidad', id, name, `sin disparar ${idle.toFixed(2)} · disparando ${firing.toFixed(2)} m/s · disparos ${b.shots}`);
        expect(b.shots).toBeGreaterThan(0);
        expect(idle).toBeGreaterThan(0.5);
        expect(firing).toBeGreaterThanOrEqual(idle * 0.999);
      });
    }
  }
  it('en el aire: la trayectoria no cambia al disparar', () => {
    const run = (fire: boolean): number => {
      const r = makeRig('carbine');
      r.run(60);
      r.input.inject('forward', true);
      r.run(20);
      r.input.inject('jump', true);
      r.frame();
      r.input.inject('jump', false);
      if (fire) r.input.inject('fire', true);
      r.run(20);
      return r.ctx.player.position.z + r.ctx.player.position.y * 100;
    };
    expect(run(true)).toBeCloseTo(run(false), 6);
  });
  it('correr + disparar: el sprint termina, el disparo sale ya y nunca se para; al soltar se vuelve a correr', () => {
    const r = makeRig('carbine');
    r.run(60);
    r.input.inject('forward', true);
    r.input.inject('sprint', true);
    r.run(20);
    const run = avgSpeed(r, 40);
    expect(run).toBeGreaterThan(PLAYER.sprintSpeed * WEAPONS.carbine.moveSpeedMult * 0.97);
    r.input.inject('fire', true);
    const before = r.shots;
    r.frame();
    expect(r.shots).toBe(before + 1);
    // El sprint termina en ese mismo frame (el disparo sale con la dispersión de andar).
    expect(r.state.player.sprinting).toBe(false);
    r.run(20);
    const walk = avgSpeed(r, 40);
    log('correr→disparar', `${run.toFixed(2)} → ${walk.toFixed(2)} m/s`);
    expect(walk).toBeGreaterThan(PLAYER.walkSpeed * WEAPONS.carbine.moveSpeedMult * 0.97);
    r.input.inject('fire', false);
    r.run(20);
    expect(avgSpeed(r, 40)).toBeGreaterThan(PLAYER.sprintSpeed * WEAPONS.carbine.moveSpeedMult * 0.97);
  });
});

describe('cadencia', () => {
  for (const dt of [1 / 60, 1 / 30]) {
    it(`automática yendo de lado mantiene las rpm a ${Math.round(1 / dt)} FPS`, () => {
      const r = makeRig('smg', dt);
      r.run(Math.round(1 / dt));
      r.input.inject('right', true);
      r.input.inject('fire', true);
      const secs = 3;
      r.run(Math.round(secs / dt));
      const expected = secs / fireIntervalS(WEAPONS.smg);
      log('cadencia smg', `${Math.round(1 / dt)} FPS`, `${r.shots} disparos en ${secs}s (esperado ${expected.toFixed(1)})`);
      expect(Math.abs(r.shots - expected)).toBeLessThanOrEqual(2);
    });
  }
  it('semiautomática: un clic durante el enfriamiento se encola y sale al primer momento posible', () => {
    const r = makeRig('pistol');
    r.run(60);
    r.input.inject('fire', true);
    r.frame();
    r.input.inject('fire', false);
    expect(r.shots).toBe(1);
    const interval = fireIntervalS(WEAPONS.pistol);
    // Segundo clic a `buffer` s antes de que acabe el enfriamiento.
    const wait = Math.floor((interval - WEAPON_HANDLING.fireBufferS * 0.9) / r.dt);
    r.run(wait);
    expect(r.shots).toBe(1);
    r.input.inject('fire', true);
    r.frame();
    r.input.inject('fire', false);
    r.run(Math.ceil(interval / r.dt));
    expect(r.shots).toBe(2);
  });
  it('el buffer de semiautomáticas está entre 120 y 150 ms', () => {
    expect(WEAPON_HANDLING.fireBufferS).toBeGreaterThanOrEqual(0.12);
    expect(WEAPON_HANDLING.fireBufferS).toBeLessThanOrEqual(0.15);
  });
});

describe('dispersión al caminar', () => {
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    it(`${id}: caminar sube la dispersión de cadera menos de un 35 % sobre parado`, () => {
      const d = WEAPONS[id];
      const base = { adsT: 0, crouched: false, airborne: false, sprinting: false, shotSpread: 0 };
      const still = currentSpreadDeg(d, { ...base, speed01: 0 });
      const walk = currentSpreadDeg(d, { ...base, speed01: 1 });
      const run = currentSpreadDeg(d, { ...base, speed01: 1, sprinting: true });
      log('dispersión', id, `parado ${still.toFixed(2)}° · caminando ${walk.toFixed(2)}° · corriendo ${run.toFixed(2)}°`);
      expect(walk).toBeLessThanOrEqual(still * 1.35);
      expect(walk).toBeLessThanOrEqual(d.spreadHip * 1.25);
      expect(run).toBeGreaterThanOrEqual(walk);
    });
  }
});

describe('microimpulso al apretar el gatillo', () => {
  it('la cámara reacciona en el mismo frame del disparo', () => {
    const shotPitch = (fire: boolean): number => {
      const r = makeRig('carbine');
      r.run(90);
      if (fire) r.input.inject('fire', true);
      r.frame();
      return r.ctx.camera.rotation.x;
    };
    expect(shotPitch(true)).toBeGreaterThan(shotPitch(false) + 1e-4);
  });
});

describe('movimiento analógico y táctil', () => {
  it('la velocidad escala con la magnitud del joystick', () => {
    const full = makeRig('carbine');
    full.run(30);
    full.input.setStick(0, 1);
    full.run(20);
    const vFull = avgSpeed(full, 40);
    const half = makeRig('carbine');
    half.run(30);
    half.input.setStick(0, 0.5);
    half.run(20);
    const vHalf = avgSpeed(half, 40);
    log('analógico', `1.0 → ${vFull.toFixed(2)} m/s · 0.5 → ${vHalf.toFixed(2)} m/s`);
    expect(vHalf / vFull).toBeCloseTo(0.5, 1);
  });
  it('el teclado sigue siendo velocidad completa (diagonal normalizada)', () => {
    const a = makeRig('carbine');
    a.run(30);
    a.input.inject('forward', true);
    a.run(20);
    const straight = avgSpeed(a, 40);
    const b = makeRig('carbine');
    b.run(30);
    b.input.inject('forward', true);
    b.input.inject('right', true);
    b.run(20);
    expect(avgSpeed(b, 40)).toBeCloseTo(straight, 1);
  });
  it('táctil: correr automático sobre el umbral, andar por debajo y respeta el disparo', () => {
    const r = makeRig('carbine');
    r.input.touch = true;
    r.run(30);
    r.input.setStick(0, 1);
    r.run(20);
    expect(r.state.player.sprinting).toBe(true);
    r.input.setStick(0, 0.8);
    r.run(10);
    expect(r.state.player.sprinting).toBe(false);
    r.input.setStick(0, 1);
    r.run(10);
    expect(r.state.player.sprinting).toBe(true);
    r.input.inject('fire', true);
    const before = r.shots;
    r.frame();
    expect(r.shots).toBe(before + 1);
    expect(r.state.player.sprinting).toBe(false);
    expect(avgSpeed(r, 30)).toBeGreaterThan(PLAYER.walkSpeed * 0.9);
  });
  it('en teclado el joystick no corre solo', () => {
    const r = makeRig('carbine');
    r.run(30);
    r.input.setStick(0, 1);
    r.run(20);
    expect(r.state.player.sprinting).toBe(false);
  });
});

describe('apariencia del viewmodel', () => {
  const armMeshes = (r: ReturnType<typeof makeRig>, role: string): THREE.Mesh[] => {
    const out: THREE.Mesh[] = [];
    r.ctx.viewScene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.Material).name.startsWith(`arm_${role}:`)) out.push(m);
    });
    return out;
  };
  it('usa colores del perfil en mangas, guantes y piel, sin tocar los materiales compartidos', () => {
    const r = makeRig('carbine');
    r.frame();
    const look = resolveLook(r.state.profile);
    for (const [role, color] of [['sleeve', look.jacket], ['glove', look.glove], ['skin', look.skin]] as const) {
      const ms = armMeshes(r, role);
      expect(ms.length).toBeGreaterThan(0);
      for (const m of ms) expect((m.material as THREE.MeshStandardMaterial).color.getHex()).toBe(color);
    }
    // Ningún material compartido (BasicMaterial del mock) ha cambiado de color
    for (const mat of [r.ctx.materials.get('clothDark'), r.ctx.materials.get('clothOlive'), r.ctx.materials.get('skinPale')]) {
      expect((mat as THREE.MeshBasicMaterial).color.getHex()).toBe(0xffffff);
    }
  });
  it('se actualiza con profile:changed sin reconstruir (mismas mallas y geometrías)', () => {
    const r = makeRig('carbine');
    r.frame();
    const before = armMeshes(r, 'sleeve');
    const geos = before.map((m) => m.geometry);
    r.state.profile = normalizeProfile({ name: 'Ana', gender: 'female', appearance: { skin: 4, hairStyle: 1, hairColor: 2, outfit: 3, accessory: 0 } });
    r.bus.emit('profile:changed', { nameChanged: true, genderChanged: true, appearanceChanged: true });
    const look = resolveLook(r.state.profile);
    const after = armMeshes(r, 'sleeve');
    expect(after).toEqual(before);
    expect(after.map((m) => m.geometry)).toEqual(geos);
    expect((after[0]!.material as THREE.MeshStandardMaterial).color.getHex()).toBe(look.jacket);
    expect((armMeshes(r, 'skin')[0]!.material as THREE.MeshStandardMaterial).color.getHex()).toBe(look.skin);
    expect((armMeshes(r, 'glove')[0]!.material as THREE.MeshStandardMaterial).color.getHex()).toBe(look.glove);
  });
  it('se oculta en el título y reaparece al empezar', () => {
    const r = makeRig('carbine');
    const root = (): THREE.Object3D => r.ctx.viewScene.children.find((c) => c.type === 'Group') as THREE.Object3D;
    r.frame();
    expect(root().visible).toBe(true);
    r.state.flow = 'title';
    r.ctx.player.update(0);
    expect(root().visible).toBe(false);
    r.state.flow = 'playing';
    r.frame();
    expect(root().visible).toBe(true);
  });
});

describe('armLook (puro)', () => {
  it('resuelve colores del perfil y la finura por género', () => {
    for (const gender of ['male', 'female'] as const) {
      const p = defaultProfile(gender);
      const l = resolveLook(p);
      const a = resolveArmLook(p);
      expect(a.sleeve).toBe(l.jacket);
      expect(a.glove).toBe(l.glove);
      expect(a.skin).toBe(l.skin);
      expect(a.handScale).toBe(gender === 'female' ? FEMALE_HAND_SCALE : 1);
    }
    expect(FEMALE_HAND_SCALE).toBeLessThan(1);
    expect(FEMALE_HAND_SCALE).toBeGreaterThan(0.85);
  });
  it('cada conjunto y tono de piel produce colores distintos y válidos', () => {
    const seen = new Set<number>();
    for (let outfit = 0; outfit < CHARACTER.outfits.length; outfit++) {
      const p = normalizeProfile({ name: 'X', gender: 'male', appearance: { skin: 0, hairStyle: 0, hairColor: 0, outfit, accessory: 0 } });
      const a = resolveArmLook(p);
      expect(a.sleeve).toBeGreaterThanOrEqual(0);
      expect(a.sleeve).toBeLessThanOrEqual(0xffffff);
      seen.add(a.sleeve);
    }
    expect(seen.size).toBe(CHARACTER.outfits.length);
    for (let skin = 0; skin < CHARACTER.skinTones.length; skin++) {
      const p = normalizeProfile({ name: 'X', gender: 'female', appearance: { skin, hairStyle: 0, hairColor: 0, outfit: 0, accessory: 0 } });
      expect(resolveArmLook(p).skin).toBe(CHARACTER.skinTones[skin]!.color);
    }
  });
  it('perfiles corruptos se acotan (nunca lanzan)', () => {
    const p = normalizeProfile({ gender: 'x', appearance: { skin: 99, outfit: -4 } });
    const a = resolveArmLook(p);
    expect(Number.isFinite(a.skin)).toBe(true);
    expect(Number.isFinite(a.sleeve)).toBe(true);
  });
});
