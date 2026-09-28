/**
 * Preview de enemigos e IA sobre el mundo stub: botones para generar cada tipo (cerca / lejos / oleada),
 * depuración de IA, godMode, registro de impactos y pruebas del Warden (casco y barra de vida).
 */
import type { EnemyHandle } from '../src/core/context';
import type { EnemyType, HitZone } from '../src/core/types';
import { createDevGame, devPageStyles } from '../src/dev/harness';
import type { EnemiesDevApi } from '../src/enemies';

const style = document.createElement('style');
style.textContent = `${devPageStyles}
  .dev-panel { max-height: 96vh; overflow: auto; }
  .dev-panel h4 { margin: 6px 0 2px; color: #5fe0b7; font-size: 11px; letter-spacing: .1em; }
  #log { position: fixed; right: 8px; top: 8px; z-index: 10; background: rgba(0,0,0,.6); padding: 6px 8px; border: 1px solid #2b3b55; width: 330px; font-size: 11px; white-space: pre; }
  #stats { position: fixed; left: 8px; bottom: 8px; z-index: 10; background: rgba(0,0,0,.6); padding: 4px 8px; font-size: 11px; white-space: pre; }
  .lbl { position: fixed; z-index: 5; color: #ffd866; font-size: 10px; pointer-events: none; text-shadow: 0 0 3px #000; transform: translate(-50%, -100%); }
  #wbar { width: 200px; height: 8px; background: #222; margin: 2px 0; } #wbar i { display:block; height:100%; background:#ff4d4d; }
  #hbar i { background:#6fb4ff; }
`;
document.head.append(style);

const game = createDevGame({ use: ['enemies'] });
const ctx = game.ctx;
const en = ctx.enemies as EnemiesDevApi;
en.director.ambientEnabled = false;
ctx.player.godMode = true;
ctx.player.teleport(0, 30, 0);
ctx.state.player.pos.x = 0;
ctx.state.player.pos.z = 30;

const panel = document.createElement('div');
panel.className = 'dev-panel';
document.body.append(panel);
const logEl = document.createElement('div');
logEl.id = 'log';
document.body.append(logEl);
const statsEl = document.createElement('div');
statsEl.id = 'stats';
document.body.append(statsEl);

const add = (label: string, fn: () => void, parent: HTMLElement = panel): HTMLButtonElement => {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = fn;
  parent.append(b);
  return b;
};
const heading = (t: string): void => {
  const h = document.createElement('h4');
  h.textContent = t;
  panel.append(h);
};

/** Punto delante del jugador a `dist` m (con desvío lateral). */
const ahead = (dist: number, side = 0): { x: number; z: number } => {
  const p = ctx.player.position;
  const yaw = ctx.state.player.yaw;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  return { x: p.x + fx * dist - fz * side, z: p.z + fz * dist + fx * side };
};

const TYPES: EnemyType[] = ['walker', 'runner', 'brute', 'spitter'];
heading('GENERAR');
for (const t of TYPES) {
  const row = document.createElement('div');
  panel.append(row);
  add(`${t} 8m`, () => { const q = ahead(8); en.spawn(t, q.x, q.z); }, row);
  add('40m', () => { const q = ahead(40); en.spawn(t, q.x, q.z); }, row);
  add('oleada x12', () => {
    for (let i = 0; i < 12; i++) { const q = ahead(30 + (i % 4) * 4, (i - 6) * 3); en.spawn(t, q.x, q.z); }
  }, row);
}
add('48 mixtos', () => {
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const p = ctx.player.position;
    en.spawn(TYPES[i % 4]!, p.x + Math.cos(a) * (14 + (i % 5) * 4), p.z + Math.sin(a) * (14 + (i % 5) * 4));
  }
});
add('matar todos', () => en.killAll());

heading('DEPURACIÓN');
const dbg = add('IA debug: off', () => {
  en.debug.enabled = !en.debug.enabled;
  dbg.textContent = `IA debug: ${en.debug.enabled ? 'on' : 'off'}`;
});
const god = add('god: on', () => {
  ctx.player.godMode = !ctx.player.godMode;
  god.textContent = `god: ${ctx.player.godMode ? 'on' : 'off'}`;
});
const amb = add('ambiente: off', () => {
  en.director.ambientEnabled = !en.director.ambientEnabled;
  amb.textContent = `ambiente: ${en.director.ambientEnabled ? 'on' : 'off'}`;
});
add('horda relé', () => ctx.bus.emit('horde:started', { id: 'relay', center: { x: ctx.player.position.x, z: ctx.player.position.z } }));
add('fin horda', () => { ctx.bus.emit('horde:ended', { id: 'relay' }); });

heading('WARDEN');
add('ir al Warden', () => ctx.player.teleport(0, -140, Math.PI));
const wardenHit = (zone: HitZone, amount: number): void => {
  const w = en.warden;
  if (!w) return;
  en.applyDamage(w, {
    amount, zone, point: { x: w.position.x, y: w.position.y + (zone === 'head' ? 2.3 : 1.4), z: w.position.z },
    normal: { x: 0, y: 0, z: 1 }, dir: { x: 0, y: 0, z: -1 },
  });
};
add('cabeza -100', () => wardenHit('head', 100));
add('cuerpo -100', () => wardenHit('body', 100));
add('pierna -100', () => wardenHit('limb', 100));
add('romper casco', () => wardenHit('head', 450));
add('cabeza -400', () => wardenHit('head', 400));
const wb = document.createElement('div');
wb.innerHTML = '<div id="wbar"><i></i></div><div id="wbar" class="h"><i style="background:#6fb4ff"></i></div><div id="wtxt"></div>';
panel.append(wb);

const log: string[] = [];
ctx.bus.on('enemy:hit', (h) => {
  log.unshift(`${h.type}#${h.id} ${h.zone} ${h.damage.toFixed(0)}${h.killed ? ' MUERTO' : ''}${h.helmetHit ? ' casco' : ''}${h.helmetBroken ? ' ROTO' : ''}`);
  log.length = Math.min(log.length, 12);
});
ctx.bus.on('warden:helmetBroken', () => { log.unshift('*** warden:helmetBroken'); });
ctx.bus.on('enemy:died', (d) => { log.unshift(`died ${d.type}#${d.id} zona ${d.zone} thr ${d.threat}${d.headshot ? ' HS' : ''}`); });

const labels = new Map<EnemyHandle, HTMLDivElement>();
const v = { x: 0, y: 0, z: 0 };
setInterval(() => {
  logEl.textContent = 'ÚLTIMOS EVENTOS\n' + log.join('\n');
  const s = en.stats;
  statsEl.textContent = `vivos ${en.aliveCount} sim ${s.simulated} dibujados ${s.drawn} clases ${s.drawClasses}\nupdate ${s.updateMs.toFixed(2)} ms (max ${s.updateMsMax.toFixed(2)})  flow ${s.flowMs.toFixed(2)} ms  celdas ${s.flowCells}\ndraw calls ${ctx.engine.stats.drawCalls}  fps ${ctx.engine.stats.fps.toFixed(0)}`;
  const w = ctx.state.missions.warden;
  const bars = wb.querySelectorAll('i');
  (bars[0] as HTMLElement).style.width = `${w.hpFraction * 100}%`;
  (bars[1] as HTMLElement).style.width = `${w.helmetFraction * 100}%`;
  (wb.querySelector('#wtxt') as HTMLElement).textContent = `vida ${(w.hpFraction * 100).toFixed(0)}%  casco ${(w.helmetFraction * 100).toFixed(0)}%  roto:${w.helmetBroken} activo:${w.engaged} muerto:${w.killed}`;
  // Etiquetas de estado (sólo con la depuración activa).
  const seen = new Set<EnemyHandle>();
  if (en.debug.enabled) {
    for (const e of en.list) {
      if (e.position.x === 0 && e.position.z === 0) continue;
      seen.add(e);
      let el = labels.get(e);
      if (!el) {
        el = document.createElement('div');
        el.className = 'lbl';
        document.body.append(el);
        labels.set(e, el);
      }
      v.x = e.position.x; v.y = e.position.y + 2.1; v.z = e.position.z;
      const c = ctx.camera;
      const cam = c.position;
      const dx = v.x - cam.x, dz = v.z - cam.z;
      const fwd = { x: -Math.sin(c.rotation.y), z: -Math.cos(c.rotation.y) };
      if (dx * fwd.x + dz * fwd.z < 0) { el.style.display = 'none'; continue; }
      const p = new (c.position.constructor as new (x: number, y: number, z: number) => typeof c.position)(v.x, v.y, v.z).project(c);
      el.style.display = 'block';
      el.style.left = `${(p.x * 0.5 + 0.5) * window.innerWidth}px`;
      el.style.top = `${(-p.y * 0.5 + 0.5) * window.innerHeight}px`;
      el.textContent = `${e.type} ${en.stateOf(e)} ${e.hp.toFixed(0)}`;
    }
  }
  for (const [k, el] of labels) if (!seen.has(k)) { el.remove(); labels.delete(k); }
}, 200);

// ?clean=1 oculta los paneles (capturas limpias).
if (new URLSearchParams(window.location.search).get('clean') === '1') {
  for (const el of [panel, logEl, statsEl]) el.style.display = 'none';
}
