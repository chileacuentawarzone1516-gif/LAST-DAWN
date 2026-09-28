import { createDevGame, devPageStyles } from '../src/dev/harness';
import { CONTAMINATION, MAP } from '../src/config';
import type { EndReason, MissionId, ZoneId } from '../src/core/types';
import type { UiHandle } from '../src/ui';
import type { Game } from '../src/game/Game';

const style = document.createElement('style');
style.textContent = `${devPageStyles}
  .dev-panel { top: auto; bottom: 8px; left: 50%; transform: translateX(-50%); max-width: min(96vw, 900px); max-height: 38vh; overflow: auto; z-index: 40; }
  .dev-panel label { display: inline-flex; gap: 4px; align-items: center; margin: 2px 8px 2px 0; }
  .dev-panel input[type=range] { width: 90px; }
  .dev-panel h4 { margin: 6px 0 2px; font-size: 11px; color: #5fe0b7; }`;
document.head.append(style);

const params = new URLSearchParams(location.search);
const game: Game = createDevGame({ use: ['ui'], autoStart: true });
const { ctx } = game;
const ui = ctx.ui as UiHandle;

// Interactuable de prueba cerca del spawn (retención de 2 s).
ctx.interactions.register({
  id: 'dev', position: () => ({ x: ctx.state.player.pos.x + 1, y: 0, z: ctx.state.player.pos.z }), radius: 6,
  prompt: () => 'Activar transmisor', holdSeconds: 2, onComplete: () => ctx.ui.notify('Transmisor activado', 'reward'),
});

const s = ctx.state;
const hit = (zone: 'head' | 'body' | 'limb', killed: boolean, helmet: boolean) => ctx.bus.emit('player:hitConfirm', { zone, killed, helmet });
const money = (delta: number) => { s.player.money = Math.max(0, s.player.money + delta); ctx.bus.emit('money:changed', { balance: s.player.money, delta, reason: 'dev' }); };
const dmg = (deg: number, hpDamage = 12) => {
  const a = (deg * Math.PI) / 180 + s.player.yaw;
  const from = { x: s.player.pos.x - Math.sin(a) * 8, y: 1, z: s.player.pos.z - Math.cos(a) * 8 };
  ctx.bus.emit('player:damaged', { amount: hpDamage, hpDamage, armorDamage: 0, source: 'melee', from, hp: s.player.hp, armor: s.player.armor });
};
const zone = (z: ZoneId, threat: number) => { s.player.zone = z; ctx.bus.emit('zone:entered', { zone: z, threat }); };
const end = (result: 'won' | 'lost', reason: EndReason) => ctx.bus.emit('flow:ended', { result, reason });
const complete = (id: MissionId) => { s.missions[id].status = 'completed'; ctx.bus.emit('mission:completed', { id, reward: 1000 }); };

const actions: Array<[string, string, () => void]> = [
  ['Jugador', 'Vida 30', () => { s.player.hp = 30; }], ['Jugador', 'Vida 100', () => { s.player.hp = 100; }],
  ['Jugador', 'Blindaje 0/60', () => { s.player.armor = s.player.armor > 0 ? 0 : 60; }],
  ['Jugador', 'Munición baja', () => { const sl = s.player.slots[s.player.activeSlot]; if (sl) sl.mag = 3; }],
  ['Jugador', 'Recarga', () => ctx.bus.emit('player:reloadStarted', { weapon: 'carbine', durationS: 2 })],
  ['Jugador', 'Placa', () => ctx.bus.emit('player:plateStarted', { durationS: 1.4 })],
  ['Jugador', 'Apuntar', () => { s.player.aiming = !s.player.aiming; }],
  ['Jugador', 'Dispersión', () => { s.player.spread = s.player.spread > 0 ? 0 : 1; }],
  ['Dinero', '+$150', () => money(150)], ['Dinero', '-$200', () => money(-200)],
  ['Reloj', '7:00', () => { s.match.elapsed = 420; }], ['Reloj', '7:35', () => { s.match.elapsed = 455; s.match.contamination = { active: true, radius: 60 }; }],
  ['Reloj', '11:40', () => { s.match.elapsed = 700; }], ['Reloj', '0:00', () => { s.match.elapsed = 0; s.match.contamination = { active: false, radius: 0 }; }],
  ['Nube', 'Jugador dentro', () => { s.match.contamination = { active: true, radius: 90 }; ctx.player.teleport(CONTAMINATION.center.x + 30, CONTAMINATION.center.z + 30, 0); }],
  ['Contratos', 'Relé activado', () => { Object.assign(s.missions.relay, { status: 'active', activated: true, progress: 34, insideCircle: true }); }],
  ['Contratos', 'Warden engaged', () => { Object.assign(s.missions.warden, { status: 'active', engaged: true, hpFraction: 0.6, helmetFraction: 0.4 }); }],
  ['Contratos', 'Casco roto', () => { Object.assign(s.missions.warden, { helmetBroken: true, helmetFraction: 0, hpFraction: 0.5 }); }],
  ['Contratos', 'Relé completado', () => complete('relay')],
  ['Contratos', 'Extracción inbound', () => { complete('relay'); Object.assign(s.missions.extraction, { status: 'active', phase: 'inbound', etaRemaining: 32 }); }],
  ['Contratos', 'Abordaje', () => { Object.assign(s.missions.extraction, { status: 'active', phase: 'landed', boardRemaining: 38 }); }],
  ['Contratos', 'Reset', () => { Object.assign(s.missions.relay, { status: 'available', activated: false, progress: 0, paid: false }); Object.assign(s.missions.warden, { status: 'available', engaged: false, helmetBroken: false, killed: false }); Object.assign(s.missions.extraction, { status: 'locked', phase: 'idle' }); }],
  ['Zona', 'Perímetro', () => zone('perimeter', 1)], ['Zona', 'Almacenes', () => zone('warehouses', 2)],
  ['Zona', 'Refinería', () => zone('refinery', 3)], ['Zona', 'Complejo', () => zone('complex', 4)],
  ['Impacto', 'Cuerpo', () => hit('body', false, false)], ['Impacto', 'Cabeza', () => hit('head', false, false)],
  ['Impacto', 'Casco', () => hit('head', false, true)], ['Impacto', 'Muerte', () => hit('body', true, false)],
  ['Daño', 'Frente', () => dmg(0)], ['Daño', 'Derecha', () => dmg(90)], ['Daño', 'Espalda', () => dmg(180)], ['Daño', 'Izquierda', () => dmg(-90)],
  ['Aviso', 'Info', () => ui.notify('Objetivo actualizado', 'info')], ['Aviso', 'Aviso', () => ui.notify('Munición baja', 'warn')],
  ['Aviso', 'Peligro', () => ui.notify('Horda en camino', 'danger')], ['Aviso', 'Premio', () => ui.notify('Contrato completado +$3.000', 'reward')],
  ['Tienda', 'Jaula', () => { s.ui.vendor = 'cage'; s.ui.modal = 'shop'; }], ['Tienda', 'Banco', () => { s.ui.vendor = 'bench'; s.ui.modal = 'shop'; }],
  ['Tienda', 'Compra', () => ctx.bus.emit('shop:purchase', { vendor: s.ui.vendor ?? 'cage', itemId: s.ui.vendor === 'bench' ? 'w_smg' : 'ammo0', price: 150 })],
  ['Tienda', 'Denegada', () => ctx.bus.emit('shop:denied', { vendor: s.ui.vendor ?? 'cage', itemId: s.ui.vendor === 'bench' ? 'w_smg' : 'ammo0', reason: 'funds' })],
  ['Tienda', 'Cerrar', () => { s.ui.modal = null; }],
  ['Pantalla', 'Mapa', () => { s.ui.modal = s.ui.modal === 'map' ? null : 'map'; }],
  ['Pantalla', 'Pausa', () => game.pause()], ['Pantalla', 'Título', () => ctx.bus.emit('ui:titleRequested', {})],
  ['Fin', 'Victoria', () => end('won', 'extracted')], ['Fin', 'Muerto', () => end('lost', 'dead')],
  ['Fin', 'Sellado', () => end('lost', 'sealed')], ['Fin', 'Heli se fue', () => end('lost', 'heli_left')],
];

if (params.get('panel') !== '0') {
  const panel = document.createElement('div');
  panel.className = 'dev-panel';
  let last = '';
  for (const [group, label, fn] of actions) {
    if (group !== last) { const h = document.createElement('h4'); h.textContent = group; panel.append(h); last = group; }
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', fn);
    panel.append(b);
  }
  const sliders = document.createElement('div');
  const slider = (name: string, min: number, max: number, on: (v: number) => void) => {
    const l = document.createElement('label');
    const i = document.createElement('input');
    i.type = 'range'; i.min = String(min); i.max = String(max); i.addEventListener('input', () => on(Number(i.value)));
    l.append(name, i); sliders.append(l);
  };
  slider('vida', 0, 100, (v) => { s.player.hp = v; });
  slider('blind.', 0, 100, (v) => { s.player.armor = v; });
  slider('reloj s', 0, 780, (v) => { s.match.elapsed = v; });
  slider('radio nube', 0, 250, (v) => { s.match.contamination = { active: v > 0, radius: v }; });
  slider('yaw°', -180, 180, (v) => ctx.player.teleport(s.player.pos.x, s.player.pos.z, (v * Math.PI) / 180));
  panel.append(sliders);
  const perf = document.createElement('div');
  panel.append(perf);
  setInterval(() => { perf.textContent = `UI update: avg ${ui.perf.avgMs.toFixed(3)} ms · max ${ui.perf.maxMs.toFixed(2)} ms`; }, 500);
  document.body.append(panel);
}

// API para los scripts de QA.
(window as unknown as { __hud: unknown }).__hud = { game, ui, actions: Object.fromEntries(actions.map(([g, l, f]) => [`${g}:${l}`, f])), MAP };
