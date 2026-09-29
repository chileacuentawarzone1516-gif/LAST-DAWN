import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CHARACTER } from '../src/config';
import { resolveLook, applyPreset, defaultProfile } from '../src/rules/character';
import type { PlayerProfile } from '../src/core/types';

const HATS = new Set(['cap', 'beanie']);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setScissorTest(true);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1220);
scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x202838, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(-2, 3, 3); scene.add(key);
const rim = new THREE.DirectionalLight(0x88aaff, 1.4); rim.position.set(2, 2, -3); scene.add(rim);

const loader = new GLTFLoader();
const load = (u: string) => loader.loadAsync(u);
const info: Record<string, unknown> = {};

function role(m: THREE.Material): string { const p = m.name.split('_'); return p[0] === 'LD' && p.length >= 3 ? (p[2] as string) : ''; }

interface Rig { root: THREE.Object3D; parts: THREE.Mesh[]; tint: Map<string, THREE.MeshStandardMaterial> }
function prepare(root: THREE.Object3D): Rig {
  const parts: THREE.Mesh[] = []; const tint = new Map<string, THREE.MeshStandardMaterial>();
  root.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh) return; parts.push(m);
    const mat = m.material as THREE.MeshStandardMaterial; const r = role(mat);
    if (['Skin','Hair','Jacket','JacketShade','Pants','Accent','Glove','Boots'].includes(r)) {
      if (!tint.has(r)) tint.set(r, mat.clone());
      m.material = tint.get(r) as THREE.MeshStandardMaterial;
    }
  });
  return { root, parts, tint };
}
const shade = (hex: number, k: number) => { let out = 0; for (const s of [16, 8, 0]) { const v = (hex >> s) & 255; out |= Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k)))) << s; } return out; };

function apply(rig: Rig, p: PlayerProfile): number {
  const look = resolveLook(p);
  const hat = HATS.has(look.accessory);
  let tris = 0;
  for (const m of rig.parts) {
    const u = m.userData as { ld_slot?: string; ld_item?: string; ld_part?: string };
    const parts = m.name.split('_'); // LD_M_Hair_corto_Top
    const slot = parts[2]; const item = parts[3]; const part = (parts[4] ?? 'main').toLowerCase();
    let vis = true;
    if (slot === 'Outfit' && item !== 'Base') vis = item === look.outfit;
    else if (slot === 'Acc') vis = item === look.accessory;
    else if (slot === 'Hair') vis = item === look.hairStyle && !(part === 'top' && hat);
    m.visible = vis;
    if (vis) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position!.count) / 3;
    void u;
  }
  const boots = ({ desierto: 7033396, artico: 3818576, sanitario: 2832970, obrero: 3878434 } as Record<string, number>)[look.outfit] ?? 2762274;
  const col: Record<string, number> = { Skin: look.skin, Hair: look.hair, Jacket: look.jacket, JacketShade: shade(look.jacket, -0.3), Pants: look.pants, Accent: look.accent, Glove: look.glove, Boots: boots };
  for (const [r, m] of rig.tint) m.color.setHex(col[r] as number);
  return Math.round(tris);
}

const models: Record<string, Rig> = {};
for (const g of ['male', 'female'] as const) {
  const t0 = performance.now();
  const gltf = await load(`/models/characters/LD_Character_${g === 'male' ? 'Male' : 'Female'}.glb`);
  const rig = prepare(gltf.scene); models[g] = rig;
  const box = new THREE.Box3().setFromObject(gltf.scene); const sz = box.getSize(new THREE.Vector3());
  const skinned = rig.parts.filter((m) => (m as THREE.SkinnedMesh).isSkinnedMesh).length;
  info[g] = { loadMs: Math.round(performance.now() - t0), heightM: +sz.y.toFixed(2), parts: rig.parts.length, skinned, roles: [...rig.tint.keys()].join(',') };
}

// 8 looks: [género, perfil]
const jobs: [PlayerProfile, string][] = [];
for (const g of ['male', 'female'] as const) {
  for (let i = 0; i < 6; i++) jobs.push([applyPreset(defaultProfile(g), i), `${g[0]}:${CHARACTER.presets[g][i]!.name}`]);
}
// personalizaciones extra (todas las opciones distintas de los presets)
jobs.push([{ name: 'X', gender: 'male', appearance: { skin: 5, hairStyle: 4, hairColor: 7, outfit: 7, accessory: 2 } }, 'm:custom-verde-carmesi-gorro']);
jobs.push([{ name: 'X', gender: 'female', appearance: { skin: 0, hairStyle: 2, hairColor: 4, outfit: 4, accessory: 3 } }, 'f:custom-clara-pelirroja-sigilo']);
jobs.push([{ name: 'X', gender: 'male', appearance: { skin: 2, hairStyle: 3, hairColor: 3, outfit: 3, accessory: 1 } }, 'm:custom-rizado-rubio-obrero-gorra']);
jobs.push([{ name: 'X', gender: 'female', appearance: { skin: 3, hairStyle: 4, hairColor: 6, outfit: 6, accessory: 5 } }, 'f:custom-trenzas-blancas-artico-headset']);

const cols = 6; const rows = Math.ceil(jobs.length / cols);
const W = canvas.width / cols, H = canvas.height / rows;
const cam = new THREE.PerspectiveCamera(28, W / H, 0.1, 50);
const results: string[] = [];
jobs.forEach(([p, label], i) => {
  const rig = models[p.gender] as Rig;
  const tris = apply(rig, p);
  scene.add(rig.root);
  const h = p.gender === 'male' ? 1.8 : 1.7;
  cam.position.set(0, h * 0.52, 5.2); cam.lookAt(0, h * 0.5, 0);
  const cx = (i % cols) * W, cy = canvas.height - (Math.floor(i / cols) + 1) * H;
  renderer.setViewport(cx, cy, W, H); renderer.setScissor(cx, cy, W, H);
  renderer.render(scene, cam);
  scene.remove(rig.root);
  results.push(`${label}:${tris}tris`);
});
info.looks = results;
(window as unknown as { __info: unknown }).__info = info;
document.getElementById('out')!.textContent = 'ok';
