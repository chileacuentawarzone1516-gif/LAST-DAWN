/** Preview del módulo world: vuelo/paseo libre, overlay de depuración (F), teletransportes y estadísticas. */
import * as THREE from 'three';
import { MAP } from '../src/config';
import { createDevGame } from '../src/dev/harness';
import type { World } from '../src/world';

const game = createDevGame({ use: ['world'] });
const ctx = game.ctx;
const world = ctx.world as World;
const panel = document.getElementById('panel') as HTMLElement;

const tp = (name: string, x: number, z: number, yaw = 0): void => {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => ctx.player.teleport(x, z, yaw);
  panel.appendChild(b);
};
panel.insertAdjacentHTML('beforeend', '<b>WORLD</b> (F: overlay depuración)<br>');
tp('spawn', MAP.spawn.x, MAP.spawn.z, 0);
tp('LZ', MAP.lz.center.x, MAP.lz.center.z + 10, 0);
tp('armería', MAP.armory.x, MAP.armory.z + 3, 0);
tp('radio', MAP.lz.radio.x - 4, MAP.lz.radio.z, Math.PI / 2);
for (const c of MAP.cages) tp(c.id.replace('cage_', 'jaula '), c.x, c.z + 6, 0);
tp('relé', MAP.relay.x, MAP.relay.z + 8, 0);
tp('puerta', MAP.complex.gate.x, MAP.complex.gate.z + 8, 0);
tp('Warden', MAP.complex.wardenSpawn.x, MAP.complex.wardenSpawn.z + 8, 0);
for (const [n, x, z] of [['NO', -185, -185], ['NE', 185, -185], ['SO', -185, 185], ['SE', 185, 185]] as const) tp(n, x, z, 0);
panel.insertAdjacentHTML('beforeend', '<br>contaminación <input id="cont" type="range" min="0" max="250" value="0" style="width:180px"> <span id="contv">0</span>');
const slider = document.getElementById('cont') as HTMLInputElement;
slider.oninput = () => {
  const r = Number(slider.value);
  ctx.state.match.contamination.active = r > 0;
  ctx.state.match.contamination.radius = r;
  (document.getElementById('contv') as HTMLElement).textContent = String(r);
};
const statsEl = document.createElement('div');
statsEl.id = 'stats';
panel.appendChild(statsEl);

// ── Overlay de depuración ────────────────────────────────────────────────────
const overlay = new THREE.Group();
overlay.visible = false;
ctx.scene.add(overlay);
{
  const seg: number[] = [];
  for (const c of world.layout.colliders) {
    if (c.shape === 'cyl') {
      for (let i = 0; i < 12; i++) {
        const a0 = (i / 12) * 6.283;
        const a1 = ((i + 1) / 12) * 6.283;
        for (const y of [c.y0, c.y1]) seg.push(c.x + Math.cos(a0) * c.r, y, c.z + Math.sin(a0) * c.r, c.x + Math.cos(a1) * c.r, y, c.z + Math.sin(a1) * c.r);
      }
      continue;
    }
    const cs = Math.cos(c.rot);
    const sn = Math.sin(c.rot);
    const P = (lx: number, lz: number): [number, number] => [c.x + lx * cs + lz * sn, c.z - lx * sn + lz * cs];
    const pts = [P(-c.hx, -c.hz), P(c.hx, -c.hz), P(c.hx, c.hz), P(-c.hx, c.hz)];
    for (let i = 0; i < 4; i++) {
      const a = pts[i] as [number, number];
      const b = pts[(i + 1) % 4] as [number, number];
      const y1 = c.shape === 'ramp' ? c.y1 : c.y1;
      seg.push(a[0], c.y0, a[1], b[0], c.y0, b[1], a[0], y1, a[1], b[0], y1, b[1], a[0], c.y0, a[1], a[0], y1, a[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x00ffaa }));
  lines.frustumCulled = false;
  overlay.add(lines);

  const nav = world.nav;
  const data = new Uint8Array(nav.cols * nav.rows * 4);
  for (let i = 0; i < nav.cols * nav.rows; i++) {
    const w = nav.walkable[i] === 1;
    data.set(w ? [40, 200, 90, 70] : [230, 50, 50, 130], i * 4);
  }
  const tex = new THREE.DataTexture(data, nav.cols, nav.rows, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(nav.cols * nav.cell, nav.rows * nav.cell), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  plane.rotation.x = -Math.PI / 2;
  plane.scale.y = -1;
  plane.position.set(nav.originX + (nav.cols * nav.cell) / 2, 0.3, nav.originZ + (nav.rows * nav.cell) / 2);
  overlay.add(plane);

  const zc: Record<string, number> = { perimeter: 0x4fc38a, warehouses: 0xe0c04f, refinery: 0xff8a3d, complex: 0xff3d55 };
  for (const z of MAP.zones) {
    const r = z.rect;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r.maxX - r.minX, r.maxZ - r.minZ), new THREE.MeshBasicMaterial({ color: zc[z.id], transparent: true, opacity: 0.12, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set((r.minX + r.maxX) / 2, 0.25 + MAP.zones.indexOf(z) * 0.01, (r.minZ + r.maxZ) / 2);
    overlay.add(m);
  }
  const pm = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const p of world.layout.pois) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 30, 8), pm);
    m.position.set(p.x, 15, p.z);
    overlay.add(m);
  }
  const sp = new THREE.MeshBasicMaterial({ color: 0xff4040 });
  for (const list of Object.values(world.spawnPoints)) for (const p of list) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.2, 6), sp);
    m.position.set(p.x, 0.8, p.z);
    overlay.add(m);
  }
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyF') overlay.visible = !overlay.visible;
});

// ── Cámara libre para capturas ───────────────────────────────────────────────
const free = { on: false, x: 0, y: 60, z: 0, yaw: 0, pitch: -0.6 };
const origRender = game.render.bind(game);
game.render = () => {
  if (free.on) {
    ctx.camera.position.set(free.x, free.y, free.z);
    ctx.camera.rotation.set(free.pitch, free.yaw, 0);
  }
  origRender();
};
const w = window as unknown as Record<string, unknown>;
w.__world = {
  world, free,
  overlay: (v: boolean) => { overlay.visible = v; },
  contamination: (r: number) => { slider.value = String(r); slider.dispatchEvent(new Event('input')); },
};

setInterval(() => {
  const s = ctx.engine.stats;
  const info = ctx.engine.renderer.info;
  statsEl.textContent = `build ${world.stats.buildMs.toFixed(0)} ms · colliders ${world.stats.colliders}\n` +
    `draw ${info.render.calls} · tris ${(info.render.triangles / 1000).toFixed(0)}k · fps ${s.fps.toFixed(0)}\n` +
    `zona ${ctx.state.player.zone}`;
}, 500);
