/**
 * Preview del motor: galería de materiales, cielo, fx, calidad, estadísticas y efectos de pantalla.
 * ?qa=1 → sin pointer lock. window.__dev permite controlar la vista desde los scripts de QA.
 */
import * as THREE from 'three';
import { MAP, PLAYER } from '../src/config';
import type { GameContext, FxKind, PlayerApi } from '../src/core/context';
import type { MaterialKey } from '../src/core/types';
import { clamp } from '../src/core/util';
import type { Engine } from '../src/engine';
import { RECIPES } from '../src/engine/textures';
import { createDevGame, devPageStyles } from '../src/dev/harness';

const style = document.createElement('style');
style.textContent = devPageStyles + '.dev-panel{max-height:96vh;overflow:auto} .dev-panel select{font:inherit} #stats{white-space:pre;margin-top:4px}';
document.head.append(style);

const KEYS = Object.keys(RECIPES) as MaterialKey[];

let devYaw = 0;
let devPitch = 0;
const devPos = { x: -22, y: 0, z: 150 };

/** Jugador mínimo de la preview: vuelo libre en XZ con WASD + ratón (o control por window.__dev). */
function createDevPlayer(ctx: GameContext): PlayerApi {
  const position = new THREE.Vector3(devPos.x, 0, devPos.z);
  const eye = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  return {
    position, eye, forward, velocity, godMode: true,
    damage() {}, heal() {}, teleport(x, z, yaw = devYaw) { devPos.x = x; devPos.z = z; devYaw = yaw; },
    setControlEnabled() {},
    update(dt) {
      const i = ctx.input;
      devYaw -= i.lookDX * PLAYER.mouseSensitivity;
      devPitch = clamp(devPitch - i.lookDY * PLAYER.mouseSensitivity, -1.5, 1.5);
      const f = (i.isDown('forward') ? 1 : 0) - (i.isDown('back') ? 1 : 0);
      const s = (i.isDown('right') ? 1 : 0) - (i.isDown('left') ? 1 : 0);
      const sp = (i.isDown('sprint') ? 14 : 5) * dt;
      devPos.x += (-Math.sin(devYaw) * f + Math.cos(devYaw) * s) * sp;
      devPos.z += (-Math.cos(devYaw) * f - Math.sin(devYaw) * s) * sp;
      position.set(devPos.x, devPos.y, devPos.z);
      eye.set(devPos.x, devPos.y + PLAYER.eyeHeight, devPos.z);
      forward.set(-Math.sin(devYaw) * Math.cos(devPitch), Math.sin(devPitch), -Math.cos(devYaw) * Math.cos(devPitch));
      ctx.camera.position.copy(eye);
      ctx.camera.rotation.set(devPitch, devYaw, 0);
      const p = ctx.state.player;
      p.pos.x = devPos.x; p.pos.y = devPos.y; p.pos.z = devPos.z; p.yaw = devYaw;
    },
  };
}

if (new URLSearchParams(location.search).get('adaptive') === '1') queueMicrotask(() => engine.setAdaptive(true));
const game = createDevGame({ use: [], overrides: { player: createDevPlayer } });
const ctx = game.ctx;
const engine = ctx.engine as Engine;
const { scene, materials } = ctx;

// ── Galería de materiales ────────────────────────────────────────────────────
const gallery = new THREE.Group();
gallery.name = 'gallery';
scene.add(gallery);
const cols = 10;
const cell = 3.4;
const shared = { box: new THREE.BoxGeometry(1.6, 1.6, 1.6), sphere: new THREE.SphereGeometry(0.62, 32, 16) };
const t0 = performance.now();
KEYS.forEach((key, i) => {
  const mat = materials.get(key);
  const col = i % cols;
  const row = Math.floor(i / cols);
  const x = (col - (cols - 1) / 2) * cell;
  const z = 128 - row * cell * 1.4;
  const box = new THREE.Mesh(shared.box.clone(), mat);
  const uv = box.geometry.getAttribute('uv') as THREE.BufferAttribute;
  const k = 1.6 / materials.tile(key);
  for (let n = 0; n < uv.count; n++) uv.setXY(n, uv.getX(n) * k, uv.getY(n) * k);
  box.position.set(x, 0.8, z);
  box.castShadow = true;
  box.receiveShadow = true;
  const sph = new THREE.Mesh(shared.sphere, mat);
  sph.position.set(x, 2.35, z);
  sph.castShadow = true;
  gallery.add(box, sph);
});
const genMs = performance.now() - t0;
const ground = scene.getObjectByProperty('isMesh', true);
if (ground) ground.receiveShadow = true;

// Cubo de prueba del viewmodel.
const vcube = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), materials.get('gunMetal'));
vcube.position.set(0.22, -0.2, -0.55);
ctx.viewScene.add(vcube);
game.ctx.bus.on('flow:started', () => {});

// ── Panel ────────────────────────────────────────────────────────────────────
const panel = document.createElement('div');
panel.className = 'dev-panel';
document.body.append(panel);
const btn = (label: string, fn: () => void): void => {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = fn;
  panel.append(b);
};
const br = (): void => { panel.append(document.createElement('br')); };
const ahead = (d: number) => ({ x: devPos.x - Math.sin(devYaw) * d, y: 0, z: devPos.z - Math.cos(devYaw) * d });

const fxKinds: FxKind[] = ['sparks', 'dust', 'blood', 'acid', 'explosion', 'smoke', 'muzzle', 'heliDust', 'toxic'];
for (const k of fxKinds) btn(k, () => ctx.fx.burst(k, { ...ahead(6), y: k === 'muzzle' ? 1.5 : 0.5 }, { x: 0, y: 1, z: 0 }, 1));
br();
btn('tracer', () => {
  const e = ctx.camera.position;
  const t = ahead(60);
  ctx.bus.emit('player:shot', { weapon: 'carbine', origin: { x: e.x, y: e.y, z: e.z }, dir: { x: -Math.sin(devYaw), y: 0, z: -Math.cos(devYaw) }, end: { x: t.x, y: 1.4, z: t.z }, hit: 'world', noise: 60, suppressed: false });
});
for (const d of ['bullet', 'blood', 'scorch', 'acid'] as const) btn(`decal ${d}`, () => ctx.fx.decal(d, { ...ahead(5), y: 0.02 }, { x: 0, y: 1, z: 0 }, d === 'bullet' ? 0.3 : 1.2));
btn('flash', () => ctx.fx.flash({ ...ahead(4), y: 1.5 }, 0xffb060, 8, 0.4, 16));
btn('impact metal', () => ctx.bus.emit('bullet:impact', { point: { ...ahead(5), y: 1 }, normal: { x: 0, y: 1, z: 0 }, surface: 'metal' }));
btn('granada', () => ctx.bus.emit('grenade:exploded', { pos: { ...ahead(10), y: 0.5 }, radius: 8 }));
btn('cadáver', () => ctx.bus.emit('enemy:died', { id: 1, type: 'walker', pos: ahead(4), zone: 'perimeter', threat: 1, headshot: false }));
br();
btn('daño', () => ctx.bus.emit('player:damaged', { amount: 25, hpDamage: 25, armorDamage: 0, source: 'melee', from: null, hp: ctx.state.player.hp, armor: 0 }));
btn('vida baja', () => { ctx.state.player.hp = 18; });
btn('vida 100', () => { ctx.state.player.hp = 100; ctx.state.player.alive = true; ctx.bus.emit('flow:started', {}); });
btn('contaminación', () => { ctx.state.match.contamination = { active: true, radius: 400 }; });
btn('sin contam.', () => { ctx.state.match.contamination = { active: false, radius: 0 }; });
btn('morir', () => { ctx.state.player.alive = false; ctx.bus.emit('player:died', { source: 'melee' }); });
br();
const sel = document.createElement('select');
for (const q of ['low', 'medium', 'high']) sel.append(new Option(q, q));
sel.value = engine.stats.quality;
sel.onchange = () => engine.setQuality(sel.value as 'low' | 'medium' | 'high');
panel.append(sel);
btn('cielo', () => { devPos.x = -22; devPos.z = 172; devYaw = 0; devPitch = 0.5; });
btn('galería', () => { devPos.x = 0; devPos.z = 150; devYaw = 0; devPitch = -0.1; });
btn('suelo', () => { devPos.x = -22; devPos.z = 172; devYaw = 0; devPitch = -0.15; });
const statsEl = document.createElement('div');
statsEl.id = 'stats';
panel.append(statsEl);
setInterval(() => {
  const s = engine.stats;
  statsEl.textContent = `${s.fps.toFixed(0)} fps · ${s.frameMs.toFixed(1)} ms · ${s.drawCalls} dc (+${engine.postCalls} post) · ${(s.triangles / 1000).toFixed(0)}k tris · pr ${s.pixelRatio.toFixed(2)} · ${s.quality} · res ${engine.resolutionScale.toFixed(2)}`;
}, 500);

vcube.onBeforeRender = () => { vcube.rotation.y += 0.01; };

// Maniquí humanoide (~1.75 m) en viewScene: comprueba la iluminación fija y el post sobre el fondo del mundo.
const mannequin = new THREE.Group();
mannequin.visible = false;
{
  const part = (geo: THREE.BufferGeometry, mat: MaterialKey, x: number, y: number, z = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo, materials.get(mat));
    m.position.set(x, y, z);
    mannequin.add(m);
    return m;
  };
  part(new THREE.CapsuleGeometry(0.09, 0.72, 4, 12), 'clothDark', -0.11, 0.46);
  part(new THREE.CapsuleGeometry(0.09, 0.72, 4, 12), 'clothDark', 0.11, 0.46);
  part(new THREE.BoxGeometry(0.42, 0.56, 0.24), 'clothOlive', 0, 1.15);
  part(new THREE.CapsuleGeometry(0.06, 0.55, 4, 10), 'clothOlive', -0.28, 1.12);
  part(new THREE.CapsuleGeometry(0.06, 0.55, 4, 10), 'clothOlive', 0.28, 1.12);
  part(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), 'skinPale', 0, 1.47);
  part(new THREE.SphereGeometry(0.11, 20, 14), 'skinPale', 0, 1.62);
  part(new THREE.BoxGeometry(0.26, 0.08, 0.28), 'gunPolymer', 0, 0.02, 0.03);
  mannequin.position.set(0.3, -0.875, -2.1);
  ctx.viewScene.add(mannequin);
}
btn('maniquí', () => { mannequin.visible = !mannequin.visible; vcube.visible = !mannequin.visible; });

declare global {
  interface Window {
    __dev?: {
      mannequin(v: boolean): void;
      loseContext(): void;
      restoreContext(): void;
      view(x: number, z: number, yaw: number, pitch: number): void;
      panel(visible: boolean): void;
      genMs: number;
      game: typeof game;
    };
  }
}
// La extensión se pide una vez: con el contexto perdido getExtension() devuelve null.
const loseCtx = engine.renderer.getContext().getExtension('WEBGL_lose_context');
window.__dev = {
  mannequin(v) { mannequin.visible = v; vcube.visible = !v; },
  loseContext() { loseCtx?.loseContext(); },
  restoreContext() { loseCtx?.restoreContext(); },
  view(x, z, yaw, pitch) { devPos.x = x; devPos.z = z; devYaw = yaw; devPitch = pitch; },
  panel(v) { panel.style.display = v ? '' : 'none'; },
  genMs,
  game,
};
void MAP;
