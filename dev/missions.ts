import { createDevGame, devPageStyles } from '../src/dev/harness';
import { MAP, SHOP } from '../src/config';
import type { GameEvents } from '../src/core/events';

const style = document.createElement('style');
style.textContent = `${devPageStyles} .dev-panel { max-height: 96vh; overflow: auto; } pre { margin: 4px 0 0; max-height: 180px; overflow: auto; font-size: 10px; }`;
document.head.append(style);

const game = createDevGame({ use: ['missions'] });
const { ctx } = game;
let timeScale = 1;

const panel = document.createElement('div');
panel.className = 'dev-panel';
document.body.append(panel);
const log = document.createElement('pre');
const json = document.createElement('pre');

function button(label: string, fn: () => void): void {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', fn);
  panel.append(b);
}
function row(title: string): void {
  const h = document.createElement('div');
  h.textContent = title;
  h.style.marginTop = '6px';
  panel.append(h);
}
const tp = (x: number, z: number, yaw = 0) => () => ctx.player.teleport(x, z, yaw);

row('Teletransporte');
button('relé', tp(MAP.relay.x - 4, MAP.relay.z + 4, -0.8));
button('LZ', tp(MAP.lz.center.x + 8, MAP.lz.center.z + 8, 0.8));
button('radio', tp(MAP.lz.radio.x - 1.5, MAP.lz.radio.z, 1.57));
button('armería', tp(MAP.armory.x + 1.5, MAP.armory.z, 1.57));
MAP.cages.forEach((c, i) => button(`jaula ${i + 1}`, tp(c.x + 1.5, c.z, 1.57)));
button('Warden', tp(MAP.complex.wardenSpawn.x, MAP.complex.wardenSpawn.z + 30, 0));
row('Reloj');
button('7:20', () => { ctx.state.match.elapsed = 440; });
button('11:50', () => { ctx.state.match.elapsed = 710; });
button('11:59', () => { ctx.state.match.elapsed = 719; });
row('Contratos');
button('casco Warden', () => ctx.bus.emit('warden:helmetBroken', { pos: { x: 0, y: 1, z: -170 } }));
button('muere Warden', () => ctx.bus.emit('enemy:died', { id: 99, type: 'warden', pos: { x: 0, y: 0, z: -170 }, zone: 'complex', threat: 4, headshot: true }));
button('muere walker', () => ctx.bus.emit('enemy:died', { id: 98, type: 'walker', pos: { x: ctx.state.player.pos.x + 2, y: 0, z: ctx.state.player.pos.z }, zone: 'perimeter', threat: 1, headshot: false }));
button('completar relé', () => ctx.missions.debugComplete('relay'));
button('completar extracción', () => ctx.missions.debugComplete('extraction'));
button('muerte jugador', () => { ctx.state.player.alive = false; ctx.bus.emit('player:died', { source: 'melee' }); });
row('Dinero y compras');
button('+$5000', () => { ctx.state.player.money += 5000; });
button('abrir jaula', () => ctx.missions.openShop('cage'));
button('abrir banco', () => ctx.missions.openShop('bench'));
button('cerrar', () => ctx.missions.closeShop());
for (let n = 1; n <= SHOP.cage.items.length; n++) button(`compra ${n}`, () => ctx.bus.emit('input:digit', { n }));
row('Tiempo');
for (const s of [1, 5, 20]) button(`x${s}`, () => { timeScale = s; });
button('+10 s', () => game.step(10));
button('+60 s', () => game.step(60));
panel.append(log, json);

const lines: string[] = [];
const names: (keyof GameEvents)[] = [
  'mission:updated', 'mission:completed', 'relay:activated', 'horde:started', 'horde:ended', 'extraction:called', 'extraction:landed',
  'extraction:departed', 'match:warning', 'match:contaminationStarted', 'match:sealed', 'flow:ended', 'shop:opened', 'shop:closed',
  'shop:purchase', 'shop:denied', 'money:changed', 'pickup:collected', 'ui:notify',
];
for (const n of names) {
  ctx.bus.on(n, (p) => {
    lines.unshift(`${ctx.state.match.elapsed.toFixed(1)} ${n} ${JSON.stringify(p)}`);
    lines.length = Math.min(lines.length, 14);
  });
}

let last = performance.now();
function loop(): void {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (timeScale > 1 && ctx.state.flow === 'playing') game.step(dt * (timeScale - 1));
  log.textContent = lines.join('\n');
  json.textContent = JSON.stringify({ match: ctx.state.match, missions: ctx.state.missions, money: ctx.state.player.money, ui: ctx.state.ui }, null, 1);
  requestAnimationFrame(loop);
}
loop();
