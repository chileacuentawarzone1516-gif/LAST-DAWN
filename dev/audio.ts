import * as THREE from 'three';
import { CONTAMINATION, WEAPONS } from '../src/config';
import type { GameContext, HelicopterInfo, MissionsApi } from '../src/core/context';
import type { EnemyType, SurfaceKind, Vec3, WeaponId } from '../src/core/types';
import { createDevGame, devPageStyles } from '../src/dev/harness';
import { createStubMissions } from '../src/dev/stubs';
import { createAudio } from '../src/audio';
import type { AudioDevApi } from '../src/audio';
import { renderSound, soundIds } from '../src/audio/offline';
import type { RenderResult } from '../src/audio/offline';
import { ENEMY_TYPES, VOCAL_KINDS } from '../src/audio/recipes/enemies';
import { SURFACES } from '../src/audio/recipes/foley';

// Cuenta los AudioContext creados (QA: ninguno antes de unlock()).
window.__audioContexts = 0;
const OrigAudioContext = window.AudioContext;
window.AudioContext = class extends OrigAudioContext {
  constructor(opts?: AudioContextOptions) {
    super(opts);
    window.__audioContexts = (window.__audioContexts ?? 0) + 1;
  }
};

const style = document.createElement('style');
style.textContent = `${devPageStyles}
  .dev-panel { max-width: 460px; max-height: calc(100vh - 16px); overflow: auto; }
  .dev-panel h3 { margin: 8px 0 2px; font-size: 11px; color: #5fe0b7; letter-spacing: .1em; }
  .dev-panel label { display: block; }
  .dev-panel input[type=range] { width: 200px; vertical-align: middle; }
  #overlay { position: fixed; inset: 0; z-index: 20; background: rgba(0,0,0,.7); display: flex; align-items: center; justify-content: center; }
  #overlay button { font-size: 18px; padding: 14px 28px; }
  #scope { position: fixed; right: 8px; bottom: 8px; z-index: 10; background: rgba(0,0,0,.6); border: 1px solid #2b3b55; }
`;
document.head.appendChild(style);

// Helicóptero simulado que la página mueve (el módulo de misiones real no existe aquí).
const heliObj = new THREE.Object3D();
const heli: { position: Vec3; active: boolean; rotorSpeed: number; landed: boolean } = {
  position: { x: 0, y: 30, z: 60 }, active: false, rotorSpeed: 1, landed: false,
};
const heliInfo: HelicopterInfo = {
  object: heliObj,
  get position() { return heli.position; },
  get active() { return heli.active; },
  get rotorSpeed() { return heli.rotorSpeed; },
  get landed() { return heli.landed; },
};
const mockMissions = (ctx: GameContext): MissionsApi => ({ ...createStubMissions(ctx), get helicopter() { return heliInfo; } });

const qa = new URLSearchParams(location.search).get('qa') === '1';
const game = createDevGame({ use: ['audio'], overrides: { missions: mockMissions }, autoStart: false });
const ctx = game.ctx;
const audio = ctx.audio as AudioDevApi;
void createAudio;

// ── Exposición para el script de QA ────────────────────────────────────────
declare global {
  interface Window {
    __audioQa?: {
      ids(): string[];
      render(id: string): Promise<RenderResult>;
      info(): { ready: boolean; errors: number; lastError: string; voices: number; stats: unknown; contexts: number };
      emit(n: number): void;
      unlock(): void;
      wrote: () => boolean;
    };
    __audioContexts?: number;
  }
}
window.__audioQa = {
  ids: soundIds,
  render: renderSound,
  info: () => ({
    ready: audio.ready, errors: audio.engine.errorCount, lastError: audio.engine.lastError, voices: audio.engine.voiceCount,
    stats: audio.engine.stats, contexts: window.__audioContexts ?? 0,
  }),
  emit: (n) => {
    // ráfaga de estrés: n disparos e impactos
    for (let i = 0; i < n; i++) {
      ctx.bus.emit('player:shot', { weapon: 'smg', origin: { x: 0, y: 1.7, z: 0 }, dir: { x: 0, y: 0, z: -1 }, end: { x: 0, y: 1, z: -20 }, hit: 'world', noise: 55, suppressed: false });
      ctx.bus.emit('bullet:impact', { point: { x: i % 7, y: 1, z: -10 }, normal: { x: 0, y: 1, z: 0 }, surface: 'concrete' });
    }
  },
  unlock: () => game.beginRun(),
  wrote: () => true,
};

if (!qa) {
  // ── Panel «sound board» ──────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'dev-panel';
  document.body.appendChild(panel);
  const overlay = document.createElement('div');
  overlay.id = 'overlay';
  overlay.innerHTML = '<button>Clic para activar el audio</button>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', () => {
    game.beginRun(); // unlock() dentro del gesto
    overlay.remove();
  });

  const state = { az: 0, dist: 12, random: false };
  const bus = ctx.bus;
  const posAround = (): Vec3 => {
    const az = state.random ? Math.random() * Math.PI * 2 : (state.az * Math.PI) / 180;
    const fwd = new THREE.Vector3();
    ctx.camera.getWorldDirection(fwd);
    const base = Math.atan2(fwd.x, -fwd.z);
    const a = base + az;
    const p = ctx.camera.position;
    return { x: p.x + Math.sin(a) * state.dist, y: 1.2, z: p.z - Math.cos(a) * state.dist };
  };
  const h3 = (t: string): void => {
    const e = document.createElement('h3');
    e.textContent = t;
    panel.appendChild(e);
  };
  const btn = (label: string, fn: () => void): void => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => {
      audio.unlock();
      fn();
    });
    panel.appendChild(b);
  };
  const slider = (label: string, min: number, max: number, val: number, step: number, on: (v: number) => void): void => {
    const l = document.createElement('label');
    const s = document.createElement('input');
    s.type = 'range';
    s.min = String(min);
    s.max = String(max);
    s.step = String(step);
    s.value = String(val);
    const t = document.createElement('span');
    t.textContent = ` ${label} ${val}`;
    s.addEventListener('input', () => {
      t.textContent = ` ${label} ${s.value}`;
      on(Number(s.value));
    });
    l.append(s, t);
    panel.appendChild(l);
  };
  const toggle = (label: string, on: (v: boolean) => void): void => {
    const l = document.createElement('label');
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.addEventListener('change', () => on(c.checked));
    l.append(c, ` ${label}`);
    panel.appendChild(l);
  };

  h3('MEZCLA');
  slider('maestro', 0, 1, audio.masterVolume, 0.01, (v) => audio.setMasterVolume(v));
  for (const b of ['sfx', 'music', 'ambience', 'ui'] as const) slider(b, 0, 1, audio.engine.levels[b], 0.01, (v) => audio.setBusVolume(b, v));
  toggle('silenciar', (m) => audio.setMuted(m));
  slider('intensidad música (0 = auto)', 0, 1, 0, 0.01, (v) => { audio.music.override = v === 0 ? null : v; });
  h3('POSICIÓN DE EVENTOS');
  slider('azimut °', 0, 360, 0, 1, (v) => { state.az = v; });
  slider('distancia m', 1, 150, 12, 1, (v) => { state.dist = v; });
  toggle('azimut aleatorio', (v) => { state.random = v; });

  h3('ARMAS');
  for (const w of Object.keys(WEAPONS) as WeaponId[]) {
    btn(`${w}`, () => bus.emit('player:shot', { weapon: w, origin: { x: 0, y: 1.7, z: 0 }, dir: { x: 0, y: 0, z: -1 }, end: { x: 0, y: 1, z: -30 }, hit: 'none', noise: 50, suppressed: false }));
  }
  btn('pistol (supresor)', () => bus.emit('player:shot', { weapon: 'pistol', origin: { x: 0, y: 1.7, z: 0 }, dir: { x: 0, y: 0, z: -1 }, end: { x: 0, y: 1, z: -30 }, hit: 'none', noise: 10, suppressed: true }));
  h3('RECARGA / SECO / CAMBIO');
  for (const w of Object.keys(WEAPONS) as WeaponId[]) {
    btn(`recarga ${w}`, () => bus.emit('player:reloadStarted', { weapon: w, durationS: WEAPONS[w].reloadTacticalS ?? WEAPONS[w].reloadS }));
  }
  for (const w of ['pistol', 'carbine', 'shotgun'] as WeaponId[]) btn(`seco ${w}`, () => bus.emit('player:dryFire', { weapon: w }));
  btn('cambio', () => bus.emit('player:weaponSwitched', { slot: 0, weapon: 'carbine' }));
  btn('placa', () => { bus.emit('player:plateStarted', { durationS: 1.4 }); setTimeout(() => bus.emit('player:plateUsed', { armor: 50 }), 1400); });
  btn('granada lanzar', () => bus.emit('player:grenadeThrown', { origin: { x: 0, y: 1.5, z: 0 }, velocity: { x: 0, y: 3, z: -15 } }));
  btn('granada rebote', () => bus.emit('grenade:bounce', { pos: posAround() }));
  btn('explosión', () => bus.emit('grenade:exploded', { pos: posAround(), radius: 8 }));

  h3('IMPACTOS BALA / PASOS (superficie)');
  for (const s of SURFACES) btn(`impacto ${s}`, () => bus.emit('bullet:impact', { point: posAround(), normal: { x: 0, y: 1, z: 0 }, surface: s as SurfaceKind }));
  for (const s of SURFACES) {
    btn(`paso ${s}`, () => bus.emit('player:footstep', { surface: s, speed: 4.3, crouched: false, sprinting: false, pos: { x: 0, y: 0, z: 0 } }));
  }
  btn('paso agachado', () => bus.emit('player:footstep', { surface: 'concrete', speed: 2, crouched: true, sprinting: false, pos: { x: 0, y: 0, z: 0 } }));
  btn('paso corriendo', () => bus.emit('player:footstep', { surface: 'concrete', speed: 7, crouched: false, sprinting: true, pos: { x: 0, y: 0, z: 0 } }));
  btn('salto', () => bus.emit('player:jumped', {}));
  btn('aterrizaje', () => bus.emit('player:landed', { impact: 9 }));

  h3('JUGADOR');
  const dmg = (source: 'melee' | 'spit' | 'slam' | 'explosion' | 'contamination' | 'fall', armor = 0): void =>
    bus.emit('player:damaged', { amount: 25, hpDamage: 25 - armor, armorDamage: armor, source, from: posAround(), hp: 60, armor: 0 });
  btn('daño melee', () => dmg('melee'));
  btn('daño con armadura', () => dmg('melee', 15));
  btn('daño escupitajo', () => dmg('spit'));
  btn('daño slam', () => dmg('slam'));
  btn('daño tóxico', () => dmg('contamination'));
  btn('daño caída', () => dmg('fall'));
  btn('curar', () => bus.emit('player:healed', { amount: 30, hp: 90 }));
  btn('muerte', () => bus.emit('player:died', { source: 'melee' }));
  btn('hit cuerpo', () => bus.emit('player:hitConfirm', { zone: 'body', killed: false, helmet: false }));
  btn('hit cabeza', () => bus.emit('player:hitConfirm', { zone: 'head', killed: false, helmet: false }));
  btn('hit casco', () => bus.emit('player:hitConfirm', { zone: 'head', killed: false, helmet: true }));
  btn('baja', () => bus.emit('player:hitConfirm', { zone: 'body', killed: true, helmet: false }));

  h3('ENEMIGOS');
  const mk = (type: EnemyType): { id: number; type: EnemyType; pos: Vec3 } => ({ id: 1, type, pos: posAround() });
  for (const t of ENEMY_TYPES) for (const k of VOCAL_KINDS) btn(`${t} ${k}`, () => bus.emit('enemy:vocal', { ...mk(t), kind: k }));
  for (const t of ENEMY_TYPES) btn(`melee ${t}`, () => bus.emit('enemy:attack', { ...mk(t), kind: 'melee' }));
  btn('escupitajo', () => bus.emit('enemy:attack', { ...mk('spitter'), kind: 'spit' }));
  btn('slam', () => bus.emit('enemy:attack', { ...mk('warden'), kind: 'slam' }));
  const hit = (type: EnemyType, zone: 'head' | 'body' | 'limb', helmetHit = false): void => {
    const p = posAround();
    bus.emit('enemy:hit', { id: 1, type, pos: p, point: p, normal: { x: 0, y: 1, z: 0 }, zone, damage: 20, killed: false, helmetHit, helmetBroken: false });
  };
  btn('golpe carne', () => hit('walker', 'body'));
  btn('golpe cabeza', () => hit('walker', 'head'));
  btn('golpe casco Warden', () => hit('warden', 'head', true));
  btn('golpe armadura Warden', () => hit('warden', 'body'));
  btn('casco roto', () => bus.emit('warden:helmetBroken', { pos: posAround() }));
  btn('rugido Warden', () => bus.emit('warden:roar', { pos: posAround() }));
  for (const t of ['walker', 'brute', 'warden'] as const) btn(`muere ${t}`, () => bus.emit('enemy:died', { id: 1, type: t, pos: posAround(), zone: 'perimeter', threat: 1, headshot: false }));

  h3('BOTÍN / TIENDA / UI');
  for (const k of ['cash', 'ammo', 'plate', 'grenade', 'medkit'] as const) btn(k, () => bus.emit('pickup:collected', { kind: k, amount: 1, pos: { x: 0, y: 0, z: 0 } }));
  btn('tienda abrir', () => bus.emit('shop:opened', { vendor: 'cage' }));
  btn('tienda cerrar', () => bus.emit('shop:closed', { vendor: 'cage' }));
  btn('compra', () => bus.emit('shop:purchase', { vendor: 'cage', itemId: 'ammo0', price: 150 }));
  btn('denegado', () => bus.emit('shop:denied', { vendor: 'cage', itemId: 'ammo0', reason: 'funds' }));
  for (const k of ['info', 'warn', 'danger', 'reward'] as const) btn(`notif ${k}`, () => bus.emit('ui:notify', { text: k, kind: k }));
  btn('clic UI', () => audio.play('ui.click'));
  slider('tic de retención (progreso)', 0, 1, 0.3, 0.01, (v) => audio.play('ui.hold', { level: v, key: 'dev' }));

  h3('MISIONES / PARTIDA');
  btn('misión completa', () => bus.emit('mission:completed', { id: 'relay', reward: 3000 }));
  btn('relé activado', () => bus.emit('relay:activated', {}));
  btn('horda', () => bus.emit('horde:started', { id: 'relay', center: { x: 0, z: 0 } }));
  btn('radio extracción', () => bus.emit('extraction:called', { etaS: 40 }));
  btn('heli aterrizó', () => bus.emit('extraction:landed', {}));
  btn('abordando', () => bus.emit('extraction:boarding', { progress: 0 }));
  btn('heli se fue', () => bus.emit('extraction:departed', { boarded: true }));
  btn('sirena contaminación', () => bus.emit('match:contaminationStarted', {}));
  btn('aviso 30 s', () => bus.emit('match:warning', { kind: 'contamination', secondsLeft: 30 }));
  btn('aviso sellado 10 s', () => bus.emit('match:warning', { kind: 'seal', secondsLeft: 10 }));
  btn('sellado', () => bus.emit('match:sealed', {}));
  for (const t of [1, 2, 3, 4]) btn(`zona amenaza ${t}`, () => bus.emit('zone:entered', { zone: 'perimeter', threat: t }));
  btn('victoria', () => bus.emit('flow:ended', { result: 'won', reason: 'extracted' }));
  btn('derrota', () => bus.emit('flow:ended', { result: 'lost', reason: 'dead' }));
  btn('pausa', () => { ctx.state.flow = 'paused'; bus.emit('flow:paused', {}); });
  btn('reanudar', () => { ctx.state.flow = 'playing'; bus.emit('flow:resumed', {}); });

  h3('BUCLES');
  toggle('helicóptero', (v) => { heli.active = v; });
  toggle('helicóptero aterrizado en el LZ', (v) => { heli.landed = v; });
  slider('rotor', 0, 1, 1, 0.01, (v) => { heli.rotorSpeed = v; });
  toggle('órbita del helicóptero (Doppler)', (v) => { orbit = v; });
  toggle('zumbido del relé', (v) => { const r = ctx.state.missions.relay; r.activated = v; r.insideCircle = v; });
  slider('progreso relé (s)', 0, 55, 10, 1, (v) => { ctx.state.missions.relay.progress = v; });
  slider('vida (latido < 40)', 1, 100, 100, 1, (v) => { ctx.state.player.hp = v; });
  toggle('contaminación activa', (v) => { ctx.state.match.contamination.active = v; ctx.state.match.contamination.radius = 60; });
  btn('teletransportar dentro contaminación', () => ctx.player.teleport(CONTAMINATION.center.x, CONTAMINATION.center.z + 20));
  toggle('viento', (v) => { audio.ambience.enabled.wind = v; });

  // ── Analizador ────────────────────────────────────────────────────────────
  const cv = document.createElement('canvas');
  cv.id = 'scope';
  cv.width = 360;
  cv.height = 160;
  document.body.appendChild(cv);
  const g2 = cv.getContext('2d');
  const wave = new Uint8Array(1024);
  const freq = new Uint8Array(1024);
  let orbit = false;
  let ang = 0;
  const draw = (): void => {
    const an = audio.engine.chain?.analyser;
    if (g2) {
      g2.fillStyle = '#070b14';
      g2.fillRect(0, 0, cv.width, cv.height);
      if (an) {
        an.getByteTimeDomainData(wave);
        an.getByteFrequencyData(freq);
        g2.strokeStyle = '#5fe0b7';
        g2.beginPath();
        for (let i = 0; i < 360; i++) {
          const y = ((wave[i * 2] ?? 128) / 255) * 80;
          if (i === 0) g2.moveTo(i, y);
          else g2.lineTo(i, y);
        }
        g2.stroke();
        g2.fillStyle = '#6fb4ff';
        for (let i = 0; i < 180; i++) {
          const h = ((freq[i * 2] ?? 0) / 255) * 78;
          g2.fillRect(i * 2, 160 - h, 1.5, h);
        }
      }
    }
    if (orbit) {
      ang += 0.012;
      heli.position = { x: Math.cos(ang) * 60, y: 30, z: Math.sin(ang) * 60 };
    }
    requestAnimationFrame(draw);
  };
  draw();
}
