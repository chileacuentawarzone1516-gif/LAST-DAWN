/**
 * Preview del personaje: galería con todos los presets de ambos géneros (rejilla que gira) y modo «una sola
 * figura» (el módulo real `createCharacter` con showPreview a la derecha), con un panel para cambiar género,
 * piel, pelo, ropa y accesorio en vivo (updateProfile) y botones de pose.
 *
 * Parámetros de URL (útiles para capturas headless): ?qa=1 · mode=gallery|single · g=male|female|both · preset=N ·
 * sk/hs/hc/of/ac=índice · pose=idle|salute|ready · yaw=rad · spin=0 · zoom=face|torso|full · panel=0 · labels=0 ·
 * src=glb|high|low|proc (origen del modelo: glb = variante automática, high/low fuerzan la variante; proc = procedural) · x=0..1 · h=0..3 (altura del maniquí como fracción de pantalla) · range=a-b (presets de la galería) ·
 * vary=hairStyle|accessory|outfit|skin|hairColor (galería con una sola propiedad variando sobre el perfil actual)
 */
import * as THREE from 'three';
import { anchorToPlacement } from '../src/character';
import type { CharacterDevApi, CharacterSource } from '../src/character';
import { GLB_REF_HEIGHT, buildCharacterModel, instantiateGlb } from '../src/character';
import { CHARACTER } from '../src/config';
import type { CharacterApi, CharacterPose } from '../src/core/context';
import { updateProfile } from '../src/core/profile';
import type { Appearance, Gender } from '../src/core/types';
import { createDevGame, devPageStyles } from '../src/dev/harness';
import { applyPreset, defaultProfile, resolveLook } from '../src/rules/character';
import type { ResolvedLook } from '../src/rules/character';

const style = document.createElement('style');
style.textContent = `${devPageStyles}
  .dev-panel { max-height: 96vh; overflow: auto; width: 300px; }
  .dev-panel h4 { margin: 8px 0 3px; color: #5fe0b7; font-size: 11px; letter-spacing: .1em; }
  .dev-panel button.on { background: #2f6a58; border-color: #5fe0b7; }
  .dev-panel button.sw { width: 22px; height: 22px; padding: 0; margin: 2px; border: 2px solid #35507a; }
  .dev-panel button.sw.on { border-color: #fff; }
  .lbl { position: fixed; z-index: 5; color: #ffd866; font-size: 10px; text-align: center; pointer-events: none; text-shadow: 0 0 3px #000; transform: translate(-50%, 0); white-space: nowrap; }
  .lbl small { display: block; color: #9fb4d8; }
  #stats { position: fixed; right: 8px; bottom: 8px; z-index: 10; background: rgba(0,0,0,.6); padding: 4px 8px; font-size: 11px; white-space: pre; }
`;
document.head.append(style);

const params = new URLSearchParams(window.location.search);
const num = (k: string, d: number): number => {
  const v = params.get(k);
  return v === null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v);
};

const game = createDevGame({ use: ['character'], autoStart: false });
const ctx = game.ctx;
const character = ctx.character as CharacterApi & CharacterDevApi;

// ── Perfil inicial desde la URL ─────────────────────────────────────────────
{
  const g = params.get('g');
  const gender: Gender = g === 'female' ? 'female' : 'male';
  updateProfile(ctx, { gender });
  const preset = params.get('preset');
  if (preset !== null) updateProfile(ctx, { appearance: { ...applyPreset(ctx.state.profile, num('preset', 0)).appearance } });
  const ap: Partial<Appearance> = {};
  for (const [k, key] of [['sk', 'skin'], ['hs', 'hairStyle'], ['hc', 'hairColor'], ['of', 'outfit'], ['ac', 'accessory']] as const) {
    if (params.has(k)) ap[key] = num(k, 0);
  }
  if (Object.keys(ap).length) updateProfile(ctx, { appearance: ap });
}

let mode: 'gallery' | 'single' = params.get('mode') === 'single' ? 'single' : 'gallery';
let galleryGender: Gender | 'both' = params.get('g') === 'male' ? 'male' : params.get('g') === 'female' ? 'female' : 'both';
let pose: CharacterPose = params.get('pose') === 'salute' ? 'salute' : params.get('pose') === 'ready' ? 'ready' : 'idle';
let useGlb = params.get('src') !== 'proc';
const initialLod = params.get('src') === 'low' ? 'low' : params.get('src') === 'high' ? 'high' : null;
const fixedYaw = params.has('yaw') ? num('yaw', 0) : null;
const spin = params.get('spin') !== '0';

// ── Galería ─────────────────────────────────────────────────────────────────
/** Figura de la galería: GLB o procedural bajo la misma interfaz. */
interface FigModel {
  root: THREE.Object3D;
  refHeight: number;
  kind: 'glb' | 'procedural';
  info: string;
  triangles: number;
  update(dt: number): void;
  setPose(p: CharacterPose): void;
  dispose(): void;
}

async function makeModel(look: ResolvedLook): Promise<FigModel> {
  if (useGlb) {
    const asset = await character.library.load(look.gender);
    if (asset) {
      const inst = instantiateGlb(asset);
      inst.applyLook(look);
      inst.setPose(pose, true);
      return {
        root: inst.root, refHeight: Math.max(GLB_REF_HEIGHT, inst.height), kind: 'glb', triangles: inst.stats.triangles,
        info: `GLB · ${inst.stats.visibleMeshes} mallas · ${inst.stats.triangles} tris`,
        update: (dt) => inst.update(dt), setPose: (p) => inst.setPose(p), dispose: () => inst.dispose(),
      };
    }
  }
  const m = buildCharacterModel(look);
  m.setPose(pose, true);
  return {
    root: m.root, refHeight: 1.78, kind: 'procedural', triangles: m.stats.triangles,
    info: `proc · ${m.stats.meshes} mallas · ${m.stats.triangles} tris · ${m.stats.buildMs.toFixed(0)} ms`,
    update: (dt) => m.update(dt), setPose: (p) => m.setPose(p, false), dispose: () => m.dispose(),
  };
}

interface Figure {
  model: FigModel;
  group: THREE.Group;
  pivot: THREE.Group;
  cx: number;
  cy: number;
  h: number;
  label: HTMLElement;
  phase: number;
}
const figures: Figure[] = [];
const galleryRoot = new THREE.Group();
ctx.viewScene.add(galleryRoot);
const labels = document.createElement('div');
document.body.append(labels);
const stats = document.createElement('div');
stats.id = 'stats';
document.body.append(stats);
let lastAspect = -1;
let galleryReady = false;

function clearGallery(): void {
  for (const f of figures) {
    f.model.dispose();
    galleryRoot.remove(f.group);
    f.label.remove();
  }
  figures.length = 0;
}

/** Con ?focus=head las figuras de la galería se encuadran a la cabeza (h = altura del maniquí en pantallas). */
const focusHead = params.get('focus') === 'head';
const focusH = num('h', 2.9);
const cellY = (fallback: number): number => (focusHead ? 0.5 + 0.42 * focusH : fallback);
const cellH = (fallback: number): number => (focusHead ? focusH : fallback);

async function buildVaryGallery(prop: keyof Appearance, token: number): Promise<void> {
  const g = ctx.state.profile.gender;
  const names: readonly { name: string }[] = prop === 'hairStyle' ? CHARACTER.hairStyles[g] : prop === 'accessory' ? CHARACTER.accessories
    : prop === 'outfit' ? CHARACTER.outfits : prop === 'skin' ? CHARACTER.skinTones : CHARACTER.hairColors;
  const [r0, r1] = (params.get('range') ?? `0-${names.length - 1}`).split('-').map(Number) as [number, number];
  const cols = r1 - r0 + 1;
  for (let i = r0; i <= r1; i++) {
    const p = { ...ctx.state.profile, appearance: { ...ctx.state.profile.appearance, [prop]: i } };
    const model = await makeModel(resolveLook(p));
    if (token !== buildToken) {
      model.dispose();
      return;
    }
    const group = new THREE.Group();
    const pivot = new THREE.Group();
    group.add(pivot);
    pivot.add(model.root);
    galleryRoot.add(group);
    const label = document.createElement('div');
    label.className = 'lbl';
    label.innerHTML = `${names[i]?.name ?? i}<small>${model.info}</small>`;
    labels.append(label);
    figures.push({ model, group, pivot, label, phase: i * 0.9, cx: (i - r0 + 0.5) / cols, cy: cellY(0.5), h: cellH(Math.min(0.86, 0.86 * Math.min(1, 2.4 / cols))) });
  }
  lastAspect = -1;
}

let buildToken = 0;
async function buildGallery(): Promise<void> {
  clearGallery();
  const token = ++buildToken;
  const vary = params.get('vary') as keyof Appearance | null;
  if (vary) {
    await buildVaryGallery(vary, token);
    galleryReady = true;
    return;
  }
  const genders: Gender[] = galleryGender === 'both' ? ['male', 'female'] : [galleryGender];
  const rows = genders.length;
  const [r0, r1] = (params.get('range') ?? '0-5').split('-').map(Number) as [number, number];
  for (const [r, g] of genders.entries()) {
    for (const [i, preset] of CHARACTER.presets[g].entries()) {
      if (i < r0 || i > r1) continue;
      const model = await makeModel(resolveLook(applyPreset({ ...defaultProfile(g) }, i)));
      if (token !== buildToken) {
        model.dispose();
        return;
      }
      const group = new THREE.Group();
      const pivot = new THREE.Group();
      group.add(pivot);
      pivot.add(model.root);
      galleryRoot.add(group);
      const label = document.createElement('div');
      label.className = 'lbl';
      label.innerHTML = `${preset.name}<small>${model.info}</small>`;
      labels.append(label);
      const cols = r1 - r0 + 1;
      figures.push({
        model, group, pivot, label, phase: i * 0.9 + r,
        cx: (i - r0 + 0.5) / cols, cy: cellY(rows === 1 ? 0.5 : 0.27 + r * 0.47), h: cellH(rows === 1 ? Math.min(0.86, 0.86 * Math.min(1, 2.4 / cols)) : Math.min(0.42, 0.42 * Math.min(1, 3 / cols))),
      });
    }
  }
  lastAspect = -1;
  galleryReady = true;
}

function layoutGallery(): void {
  const cam = ctx.viewCamera;
  for (const f of figures) {
    const p = anchorToPlacement(cam.fov, cam.aspect, { x: f.cx, y: f.cy, height: f.h }, f.model.refHeight);
    f.group.position.set(p.x, p.y, p.z);
    f.group.scale.setScalar(p.scale);
    f.label.style.left = `${f.cx * 100}%`;
    f.label.style.top = focusHead ? '92%' : `${(f.cy + f.h / 2 + 0.005) * 100}%`;
  }
  lastAspect = cam.aspect;
}

// ── Modo ────────────────────────────────────────────────────────────────────
function singleAnchor(): { x: number; y: number; height: number } {
  const zoom = params.get('zoom');
  const height = num('h', zoom === 'face' ? 4.2 : zoom === 'torso' ? 2.2 : 0.86);
  const focus = zoom === 'face' ? 0.93 : zoom === 'torso' ? 0.74 : 0.5;
  return { x: num('x', 0.72), y: 0.5 + (focus - 0.5) * height, height };
}

function applyMode(): void {
  galleryRoot.visible = mode === 'gallery';
  labels.style.display = mode === 'gallery' && params.get('labels') !== '0' ? '' : 'none';
  if (mode === 'single') {
    character.showPreview(singleAnchor());
    character.setPose(pose);
    character.autoSpin = spin;
    if (fixedYaw !== null) character.setYaw(fixedYaw);
  } else {
    character.hidePreview();
    if (figures.length === 0) void buildGallery().then(refreshPanel);
  }
  refreshPanel();
}

function setSource(src: CharacterSource): void {
  character.source = src;
  if (mode === 'gallery') void buildGallery().then(refreshPanel);
  refreshPanel();
}

function setPose(p: CharacterPose): void {
  pose = p;
  character.setPose(p);
  for (const f of figures) f.model.setPose(p);
  refreshPanel();
}

// ── Panel ───────────────────────────────────────────────────────────────────
const panel = document.createElement('div');
panel.className = 'dev-panel';
if (params.get('panel') === '0') panel.style.display = 'none';
document.body.append(panel);

const refreshers: Array<() => void> = [];
function refreshPanel(): void {
  for (const r of refreshers) r();
  const m = character.model;
  const g = character.glb;
  const lines: string[] = [];
  if (mode === 'single' && g) {
    const a = character.library.get(g.gender);
    lines.push(`GLB ${a?.low ? 'baja' : 'alta'} ${g.gender} · ${g.stats.visibleMeshes}/${g.stats.totalMeshes} mallas visibles`, `${g.stats.triangles} tris · alto ${g.height.toFixed(2)} m`,
      `descarga ${a ? (a.downloadBytes / 1048576).toFixed(2) : '?'} MB · carga ${a ? a.loadMs.toFixed(0) : '?'} ms · tex ${a ? (a.textureBytes / 1048576).toFixed(1) : '?'} MB`);
  } else if (mode === 'single' && m) {
    lines.push(`${m.stats.meshes} mallas · ${m.stats.triangles} tris · ${m.stats.vertices} vért.`, `${m.stats.materials} materiales · ${m.stats.bones} huesos`, `build ${m.stats.buildMs.toFixed(1)} ms · alto ${m.bounds.max.y.toFixed(2)} m`);
  } else {
    const tris = figures.reduce((a, f) => a + f.model.triangles, 0);
    lines.push(`${figures.length} figuras · ${tris} tris`);
  }
  lines.push(`rebuilds ${character.rebuilds}`);
  stats.textContent = lines.join('\n');
}

function heading(t: string): void {
  const h = document.createElement('h4');
  h.textContent = t;
  panel.append(h);
}

function chips(items: { label: string; on: () => boolean; click: () => void; color?: number }[]): void {
  const row = document.createElement('div');
  panel.append(row);
  for (const it of items) {
    const b = document.createElement('button');
    if (it.color !== undefined) {
      b.className = 'sw';
      b.style.background = `#${it.color.toString(16).padStart(6, '0')}`;
      b.title = it.label;
    } else b.textContent = it.label;
    b.onclick = () => {
      it.click();
      refreshPanel();
    };
    refreshers.push(() => b.classList.toggle('on', it.on()));
    row.append(b);
  }
}

const profile = () => ctx.state.profile;
const setApp = (patch: Partial<Appearance>): void => {
  updateProfile(ctx, { appearance: patch });
};

heading('MODO');
chips([
  { label: 'Galería', on: () => mode === 'gallery', click: () => { mode = 'gallery'; applyMode(); } },
  { label: 'Una figura', on: () => mode === 'single', click: () => { mode = 'single'; applyMode(); } },
]);
heading('ORIGEN');
chips([
  { label: 'GLB auto', on: () => useGlb && character.lod === null, click: () => { useGlb = true; character.lod = null; setSource('glb'); } },
  { label: 'GLB alta', on: () => useGlb && character.lod === 'high', click: () => { useGlb = true; character.lod = 'high'; setSource('glb'); } },
  { label: 'GLB baja', on: () => useGlb && character.lod === 'low', click: () => { useGlb = true; character.lod = 'low'; setSource('glb'); } },
  { label: 'Procedural', on: () => !useGlb, click: () => { useGlb = false; setSource('procedural'); } },
]);
heading('GALERÍA');
chips((['both', 'male', 'female'] as const).map((g) => ({
  label: g === 'both' ? 'Ambos' : g === 'male' ? 'Masculino' : 'Femenino',
  on: () => galleryGender === g,
  click: () => { galleryGender = g; void buildGallery().then(refreshPanel); },
})));
heading('GÉNERO');
chips(CHARACTER.genders.map((g) => ({ label: g.name, on: () => profile().gender === g.id, click: () => { updateProfile(ctx, { gender: g.id }); } })));
heading('PRESETS');
chips(CHARACTER.presets.male.map((p, i) => ({
  label: `${p.name}`, on: () => false, click: () => { updateProfile(ctx, { gender: 'male' }); updateProfile(ctx, { appearance: { ...applyPreset(profile(), i).appearance } }); },
})));
chips(CHARACTER.presets.female.map((p, i) => ({
  label: `${p.name}`, on: () => false, click: () => { updateProfile(ctx, { gender: 'female' }); updateProfile(ctx, { appearance: { ...applyPreset(profile(), i).appearance } }); },
})));
heading('PIEL');
chips(CHARACTER.skinTones.map((s, i) => ({ label: s.name, color: s.color, on: () => profile().appearance.skin === i, click: () => setApp({ skin: i }) })));
heading('PELO (estilo)');
const hairHeading = panel.lastElementChild as HTMLElement;
chips([0, 1, 2, 3, 4, 5].map((i) => ({
  label: CHARACTER.hairStyles[profile().gender][i]?.name ?? '', on: () => profile().appearance.hairStyle === i, click: () => setApp({ hairStyle: i }),
})));
refreshers.push(() => {
  // Los nombres de estilo dependen del género.
  const row = hairHeading.nextElementSibling;
  row?.querySelectorAll('button').forEach((b, i) => { b.textContent = CHARACTER.hairStyles[profile().gender][i]?.name ?? ''; });
});
heading('PELO (color)');
chips(CHARACTER.hairColors.map((s, i) => ({ label: s.name, color: s.color, on: () => profile().appearance.hairColor === i, click: () => setApp({ hairColor: i }) })));
heading('ROPA');
chips(CHARACTER.outfits.map((o, i) => ({ label: o.name, on: () => profile().appearance.outfit === i, click: () => setApp({ outfit: i }) })));
heading('ACCESORIO');
chips(CHARACTER.accessories.map((a, i) => ({ label: a.name, on: () => profile().appearance.accessory === i, click: () => setApp({ accessory: i }) })));
heading('POSE');
chips((['idle', 'salute', 'ready'] as const).map((p) => ({ label: p, on: () => pose === p, click: () => setPose(p) })));
heading('GIRO');
chips([
  { label: 'auto ±', on: () => character.autoSpin, click: () => { character.autoSpin = !character.autoSpin; } },
  { label: '← 0,5 rad', on: () => false, click: () => character.rotate(-0.5) },
  { label: '0,5 rad →', on: () => false, click: () => character.rotate(0.5) },
]);

// ── Bucle propio de la galería ───────────────────────────────────────────────
let last = performance.now();
let t = 0;
const loop = (now: number): void => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  if (mode === 'gallery') {
    if (ctx.viewCamera.aspect !== lastAspect) layoutGallery();
    for (const f of figures) {
      f.pivot.rotation.y = fixedYaw ?? (spin ? t * 0.5 + f.phase : f.phase * 0.3);
      f.model.update(dt);
    }
  }
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
setInterval(refreshPanel, 400);

// Reconstruye la vista en cuanto cambie el perfil (single lo hace el módulo; la galería no depende del perfil).
ctx.bus.on('profile:changed', () => refreshPanel());

if (initialLod) character.lod = initialLod;
character.source = useGlb ? 'glb' : 'procedural';
applyMode();
setPose(pose);

interface CharMetrics {
  drawCalls: number;
  triangles: number;
  fps: number;
  textureBytes: number;
  loadMs: Record<string, number>;
  downloadMB: Record<string, number>;
  variant: Record<string, string>;
  actor: string | null;
  visibleMeshes: number;
  glbTriangles: number;
}

/** Espera n fotogramas (rAF). */
const frames = (n: number): Promise<void> => new Promise((res) => {
  const step = (k: number): void => (k <= 0 ? res() : void requestAnimationFrame(() => step(k - 1)));
  step(n);
});

/** Espera a que las descargas terminen y el módulo haya aplicado el GLB. */
async function ready(): Promise<void> {
  await character.settled();
  await frames(8);
  while (mode === 'gallery' && !galleryReady) await frames(4);
  await frames(6);
}

/** Coste del maniquí = estadísticas del frame con él visible menos con él oculto (mismo fondo). */
async function measure(): Promise<{ base: CharMetrics; withChar: CharMetrics }> {
  const snap = (): CharMetrics => {
    const st = ctx.engine.stats;
    const lib = character.library;
    const loadMs: Record<string, number> = {};
    const downloadMB: Record<string, number> = {};
    const variant: Record<string, string> = {};
    let tex = 0;
    for (const gd of ['male', 'female'] as const) {
      const a = lib.get(gd);
      if (a) {
        loadMs[gd] = Math.round(a.loadMs);
        downloadMB[gd] = +(a.downloadBytes / 1048576).toFixed(2);
        variant[gd] = a.low ? 'low' : 'high';
        tex += a.textureBytes;
      }
    }
    return {
      drawCalls: st.drawCalls, triangles: st.triangles, fps: st.fps, textureBytes: tex, loadMs, downloadMB, variant, actor: character.actorKind,
      visibleMeshes: character.glb?.stats.visibleMeshes ?? character.model?.stats.meshes ?? 0, glbTriangles: character.glb?.stats.triangles ?? 0,
    };
  };
  const wasVisible = character.previewVisible;
  character.hidePreview();
  await frames(20);
  const base = snap();
  character.showPreview(singleAnchor());
  await frames(20);
  const withChar = snap();
  if (!wasVisible) character.hidePreview();
  return { base, withChar };
}

declare global {
  interface Window {
    __char?: {
      api: CharacterApi & CharacterDevApi; ctx: typeof ctx; figures: Figure[]; setMode: (m: 'gallery' | 'single') => void;
      ready: () => Promise<void>; measure: typeof measure;
    };
  }
}
window.__char = {
  api: character, ctx, figures,
  setMode: (m) => { mode = m; applyMode(); },
  ready, measure,
};
