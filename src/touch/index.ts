/**
 * createTouch(ctx): controles táctiles del juego (overlay DOM sobre el canvas).
 *
 *  · Joystick flotante (zona inferior izquierda) → ctx.input.setStick; correr lo decide el jugador con moveY.
 *  · Arrastre de mirada en cualquier zona libre (y desde el botón de disparo) → ctx.input.addLook ya escalado.
 *  · Botones (disparo, apuntar, salto, agacharse, recarga, granada, placa, cambio de arma, interactuar, pausa,
 *    mapa, ajustes) → ctx.input.inject / bus.
 *  · Háptica, aviso de orientación vertical, gestos del navegador bloqueados, ajustes guardados (zurdo, apuntar).
 *
 * Todos los toques se siguen por pointerId (multitáctil). La lógica sin DOM vive en joystick.ts, layout.ts,
 * haptics.ts y settings.ts (con tests). Este fichero sólo une los eventos del navegador con esa lógica.
 */
import './touch.css';
import { TOUCH } from '../config';
import type { Action, GameContext, Interactable } from '../core/context';
import type { System } from '../core/types';
import { damagePulseMs, gateOpen, HAPTIC_GAP_MS } from './haptics';
import type { HapticKind } from './haptics';
import { ICONS } from './icons';
import type { IconName } from './icons';
import {
  beginLook, clampBase, createLookTrack, createStickOut, followBase, isSprinting, lookScale, STICK_EXPONENT, stepLook, stickVector,
} from './joystick';
import type { LookTrack, Point } from './joystick';
import { computeLayout, decideZone, isPortrait, TOUCH_UI } from './layout';
import type { ButtonId, Insets, TouchLayout } from './layout';
import { loadSettings, saveSettings } from './settings';
import type { TouchSettings } from './settings';

export type { TouchSettings } from './settings';
export type TouchMode = 'off' | 'paused' | 'system' | 'full';

/** Valores en vivo para depuración (dev/touch.ts); se escriben sin asignar memoria. */
export interface TouchDebug {
  stickX: number;
  stickY: number;
  stickMag: number;
  sprint: boolean;
  /** Último y acumulado de la mirada enviada a input.addLook (px equivalentes de ratón). */
  lookDX: number;
  lookDY: number;
  lookTotalX: number;
  lookTotalY: number;
  /** Punteros activos. */
  pointers: number;
  portrait: boolean;
  mode: TouchMode;
  fps: number;
}

export interface TouchSystem extends System {
  readonly settings: Readonly<TouchSettings>;
  /** Cambia (y guarda) ajustes: zurdo, apuntar manteniendo, vibración, FPS. */
  setSettings(patch: Partial<TouchSettings>): void;
  /** Último reparto calculado (null hasta el primer layout). */
  readonly layout: TouchLayout | null;
  readonly debug: Readonly<TouchDebug>;
  readonly root: HTMLElement;
  /** Libera todas las acciones y toques (botones «pegados»). */
  releaseAll(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────
/** Duración (s) de la pulsación breve de las acciones de un solo golpe: cubre varios frames. */
const PULSE_S = 0.07;
const MAX_POINTERS = 12;
const PULSE_SLOTS = 8;
/** Pasos del anillo de progreso de interactuar. */
const RING_STEPS = 60;
const RING_CIRC = 2 * Math.PI * 19;
/** Periodo (s) de sondeo del tamaño de pantalla y de refresco del texto de interactuar. */
const POLL_S = 0.5;
const LABEL_S = 0.15;
const FPS_S = 0.5;
const LANDED_PATTERN: number[] = [40, 60, 40, 60, 80];
const STICK_EDGE_MARGIN = 4;

const NS_ROLE_NONE = 0;
const NS_ROLE_STICK = 1;
const NS_ROLE_LOOK = 2;
const NS_ROLE_BUTTON = 3;

interface ButtonDef {
  id: ButtonId;
  icon: IconName;
  label: string;
  cls: string;
  system: boolean;
  badge: boolean;
}

const BUTTONS: readonly ButtonDef[] = [
  { id: 'fire', icon: 'fire', label: 'Disparar', cls: 'tc-fire', system: false, badge: false },
  { id: 'aim', icon: 'aim', label: 'Apuntar', cls: 'tc-aim', system: false, badge: false },
  { id: 'jump', icon: 'jump', label: 'Saltar', cls: 'tc-jump', system: false, badge: false },
  { id: 'crouch', icon: 'crouch', label: 'Agacharse', cls: 'tc-crouch', system: false, badge: false },
  { id: 'reload', icon: 'reload', label: 'Recargar', cls: 'tc-reload', system: false, badge: false },
  { id: 'grenade', icon: 'grenade', label: 'Lanzar granada', cls: 'tc-grenade', system: false, badge: true },
  { id: 'plate', icon: 'plate', label: 'Colocar placa de armadura', cls: 'tc-plate', system: false, badge: true },
  { id: 'swap', icon: 'swap', label: 'Cambiar de arma', cls: 'tc-swap', system: false, badge: true },
  { id: 'interact', icon: 'interact', label: 'Interactuar', cls: 'tc-interact', system: false, badge: false },
  { id: 'pause', icon: 'pause', label: 'Pausa', cls: 'tc-sys tc-pause', system: true, badge: false },
  { id: 'map', icon: 'map', label: 'Mapa táctico', cls: 'tc-sys tc-map', system: true, badge: false },
  { id: 'settings', icon: 'settings', label: 'Ajustes de controles táctiles', cls: 'tc-sys tc-gear', system: true, badge: false },
];

/** Estado en ejecución de un botón. */
interface Btn {
  id: ButtonId;
  el: HTMLElement;
  badge: HTMLElement | null;
  down: boolean;
  /** Valor mostrado en la insignia (-1 = sin valor todavía). */
  badgeVal: number;
  active: boolean;
  busy: boolean;
}

/** Estado de un puntero (dedo) activo; los huecos se reutilizan (sin asignar en los manejadores). */
interface Slot {
  id: number;
  role: number;
  btn: Btn | null;
  look: LookTrack;
}

interface Pulse {
  action: Action | null;
  t: number;
}

const SETTING_ROWS: ReadonlyArray<{ key: keyof TouchSettings; title: string; hint: string }> = [
  { key: 'lefty', title: 'Modo zurdo', hint: 'Espeja los controles' },
  { key: 'aimHold', title: 'Apuntar manteniendo', hint: 'Apuntas mientras pulsas (si no, alterna)' },
  { key: 'haptics', title: 'Vibración', hint: 'Disparos, impactos y daño' },
  { key: 'fps', title: 'Mostrar FPS', hint: 'Indicador discreto' },
];

export function createTouch(ctx: GameContext): TouchSystem {
  const { input, bus } = ctx;
  const scope = bus.scope();
  const cleanups: Array<() => void> = [];
  const settings: TouchSettings = loadSettings();

  const html = document.documentElement;
  const setInputDataset = !html.dataset.input;
  if (setInputDataset) html.dataset.input = 'touch';

  // ── Estado ────────────────────────────────────────────────────────────────
  const debug: TouchDebug = {
    stickX: 0, stickY: 0, stickMag: 0, sprint: false, lookDX: 0, lookDY: 0, lookTotalX: 0, lookTotalY: 0,
    pointers: 0, portrait: false, mode: 'off', fps: 0,
  };
  let mode: TouchMode = 'off';
  let layout: TouchLayout | null = null;
  let width = window.innerWidth;
  let height = window.innerHeight;
  let portrait = false;
  let layoutDirty = true;
  let portraitPauseSent = false;
  let aimOn = false;
  let panelOpen = false;
  let pollT = 0;
  let labelT = 0;
  let fpsT = 0;
  let fpsFrames = 0;
  let disposed = false;

  const insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const slots: Slot[] = [];
  for (let i = 0; i < MAX_POINTERS; i++) slots.push({ id: -1, role: NS_ROLE_NONE, btn: null, look: createLookTrack() });
  const pulses: Pulse[] = [];
  for (let i = 0; i < PULSE_SLOTS; i++) pulses.push({ action: null, t: 0 });

  // Joystick: base flotante, salida y espacio de trabajo.
  let stickSlot: Slot | null = null;
  const base: Point = { x: 0, y: 0 };
  const tmp: Point = { x: 0, y: 0 };
  const stickOut = createStickOut();
  let sprint = false;
  let stickDirty = false;
  let sprintDirty = false;

  // ── DOM ───────────────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.className = 'tc-root';
  root.dataset.mode = 'off';

  const probe = document.createElement('div');
  probe.className = 'tc-probe';
  const surface = document.createElement('div');
  surface.className = 'tc-surface tc-game';
  surface.setAttribute('data-tc', 'surface');
  const ghost = document.createElement('div');
  ghost.className = 'tc-ghost tc-game';
  ghost.innerHTML = '<i></i>';
  const stick = document.createElement('div');
  stick.className = 'tc-stick tc-game';
  stick.hidden = true;
  stick.innerHTML = `<div class="tc-stick-base"></div><div class="tc-stick-thumb">${ICONS.run}</div>`;
  const thumb = stick.querySelector('.tc-stick-thumb') as HTMLElement;
  root.append(probe, surface, ghost, stick);

  const btnById = new Map<string, Btn>();
  const buttons: Btn[] = [];
  for (const def of BUTTONS) {
    const el = document.createElement('div');
    el.className = `tc-btn ${def.cls}${def.system ? '' : ' tc-game'}`;
    el.setAttribute('data-tc', def.id);
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', def.label);
    el.innerHTML = ICONS[def.icon];
    let badge: HTMLElement | null = null;
    if (def.badge) {
      badge = document.createElement('span');
      badge.className = 'tc-badge';
      el.appendChild(badge);
    }
    const b: Btn = { id: def.id, el, badge, down: false, badgeVal: -1, active: false, busy: false };
    btnById.set(def.id, b);
    buttons.push(b);
    root.appendChild(el);
  }
  const aimBtn = btnById.get('aim') as Btn;
  aimBtn.el.setAttribute('aria-pressed', 'false');
  const interactBtn = btnById.get('interact') as Btn;
  interactBtn.el.hidden = true;
  interactBtn.el.insertAdjacentHTML(
    'afterbegin',
    `<svg class="tc-ring" viewBox="0 0 40 40" aria-hidden="true"><circle class="bg" cx="20" cy="20" r="19"/>` +
      `<circle class="fg" cx="20" cy="20" r="19" stroke-dasharray="${RING_CIRC.toFixed(2)}" stroke-dashoffset="${RING_CIRC.toFixed(2)}"/></svg>`,
  );
  interactBtn.el.insertAdjacentHTML('beforeend', '<span class="tc-il" aria-hidden="true"><i hidden>MANTÉN</i><b></b></span>');
  const ringFg = interactBtn.el.querySelector('.tc-ring .fg') as SVGElement;
  const labelHold = interactBtn.el.querySelector('.tc-il i') as HTMLElement;
  const labelText = interactBtn.el.querySelector('.tc-il b') as HTMLElement;

  const fpsEl = document.createElement('div');
  fpsEl.className = 'tc-fps';
  fpsEl.hidden = !settings.fps;
  fpsEl.textContent = '-- FPS';

  const rotate = document.createElement('div');
  rotate.className = 'tc-rotate';
  rotate.hidden = true;
  rotate.setAttribute('role', 'alert');
  rotate.innerHTML = `${ICONS.rotate}<h2>Gira el dispositivo</h2><p>DEAD SIGNAL se juega en horizontal</p>`;

  // Panel de ajustes (sólo con el juego en pausa).
  const canVibrate = typeof navigator.vibrate === 'function';
  const panelWrap = document.createElement('div');
  panelWrap.className = 'tc-panel-wrap';
  panelWrap.hidden = true;
  const panel = document.createElement('div');
  panel.className = 'tc-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Ajustes de controles táctiles');
  panel.innerHTML = '<h2>Controles táctiles</h2>';
  const switches = new Map<keyof TouchSettings, HTMLElement>();
  for (const row of SETTING_ROWS) {
    if (row.key === 'haptics' && !canVibrate) continue;
    const r = document.createElement('div');
    r.className = 'tc-row';
    const txt = document.createElement('div');
    txt.innerHTML = `<div>${row.title}</div><small>${row.hint}</small>`;
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'tc-switch';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-label', row.title);
    sw.setAttribute('aria-checked', String(settings[row.key]));
    sw.addEventListener('click', () => toggleSetting(row.key));
    switches.set(row.key, sw);
    r.append(txt, sw);
    panel.appendChild(r);
  }
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'tc-close';
  closeBtn.textContent = 'Cerrar';
  closeBtn.addEventListener('click', () => closePanel());
  panel.appendChild(closeBtn);
  panelWrap.appendChild(panel);
  panelWrap.addEventListener('click', (e) => {
    if (e.target === panelWrap) closePanel();
  });
  root.append(fpsEl, rotate, panelWrap);
  document.body.appendChild(root);

  function toggleSetting(key: keyof TouchSettings): void {
    const patch: Partial<TouchSettings> = {};
    patch[key] = !settings[key];
    api.setSettings(patch);
  }

  // ── Layout ────────────────────────────────────────────────────────────────
  const px = (v: number): string => `${Math.round(v * 10) / 10}px`;

  function readInsets(): void {
    const cs = getComputedStyle(probe);
    insets.top = parseFloat(cs.paddingTop) || 0;
    insets.right = parseFloat(cs.paddingRight) || 0;
    insets.bottom = parseFloat(cs.paddingBottom) || 0;
    insets.left = parseFloat(cs.paddingLeft) || 0;
  }

  function applyLayout(): void {
    layoutDirty = false;
    const rect = root.getBoundingClientRect();
    width = rect.width > 0 ? rect.width : window.innerWidth;
    height = rect.height > 0 ? rect.height : window.innerHeight;
    readInsets();
    const l = computeLayout(width, height, settings.lefty, insets, TOUCH.stickRadius);
    layout = l;
    for (const bl of l.buttons) {
      const b = btnById.get(bl.id);
      if (!b) continue;
      const s = b.el.style;
      s.left = px(bl.cx - bl.size / 2);
      s.top = px(bl.cy - bl.size / 2);
      s.width = px(bl.size);
      s.height = px(bl.size);
      s.setProperty('--s', String(bl.size));
    }
    root.style.setProperty('--r', String(TOUCH.stickRadius));
    ghost.style.transform = `translate3d(${px(l.stickHome.x)},${px(l.stickHome.y)},0)`;
    root.classList.toggle('tc-lefty', settings.lefty);
    // Zonas reservadas: el HUD puede usar estas variables para no solapar los controles.
    const rs = html.style;
    html.dataset.touchHand = settings.lefty ? 'left' : 'right';
    rs.setProperty('--tc-stick-w', px(l.stickZone.w));
    rs.setProperty('--tc-stick-h', px(l.stickZone.h));
    rs.setProperty('--tc-cluster-w', px(settings.lefty ? l.cluster.x + l.cluster.w : width - l.cluster.x));
    rs.setProperty('--tc-cluster-h', px(height - l.cluster.y));
    rs.setProperty('--tc-top-w', px(settings.lefty ? l.topBar.x + l.topBar.w : width - l.topBar.x));
    rs.setProperty('--tc-top-h', px(l.topBar.y + l.topBar.h));
    const p = isPortrait(width, height);
    if (p !== portrait) {
      portrait = p;
      debug.portrait = p;
      rotate.hidden = !p;
    }
  }

  // ── Acciones ──────────────────────────────────────────────────────────────
  function pulse(action: Action): void {
    let free: Pulse | null = null;
    for (let i = 0; i < pulses.length; i++) {
      const p = pulses[i] as Pulse;
      if (p.action === action) {
        p.t = PULSE_S;
        return;
      }
      if (p.action === null && free === null) free = p;
    }
    if (free) {
      free.action = action;
      free.t = PULSE_S;
      input.inject(action, true);
    }
  }

  function stepPulses(dt: number): void {
    for (let i = 0; i < pulses.length; i++) {
      const p = pulses[i] as Pulse;
      if (p.action === null) continue;
      p.t -= dt;
      if (p.t <= 0) {
        input.inject(p.action, false);
        p.action = null;
      }
    }
  }

  function setAim(on: boolean): void {
    aimOn = on;
    input.inject('aim', on);
    aimBtn.active = on;
    aimBtn.el.classList.toggle('active', on);
    aimBtn.el.setAttribute('aria-pressed', String(on));
  }

  function openPanel(): void {
    panelOpen = true;
    // Ajustar los controles con zombis encima es mala idea: se pausa la partida.
    if (ctx.state.flow === 'playing') bus.emit('ui:pauseRequested', {});
  }

  function closePanel(): void {
    panelOpen = false;
    panelWrap.hidden = true;
  }

  function press(b: Btn, slot: Slot, x: number, y: number): void {
    slot.role = NS_ROLE_BUTTON;
    slot.btn = b;
    b.down = true;
    b.el.classList.add('down');
    switch (b.id) {
      case 'fire':
        input.inject('fire', true);
        // Un dedo que dispara también puede arrastrar la mirada (con holgura para no mover la cámara por temblor).
        beginLook(slot.look, x, y, TOUCH_UI.fireLookSlop);
        break;
      case 'aim':
        setAim(settings.aimHold ? true : !aimOn);
        break;
      case 'jump':
        input.inject('jump', true);
        break;
      case 'interact':
        input.inject('interact', true);
        break;
      case 'crouch':
      case 'reload':
      case 'grenade':
      case 'plate':
      case 'map':
        pulse(b.id);
        break;
      case 'swap': {
        const st = ctx.state.player;
        const target = st.activeSlot === 0 ? 1 : 0;
        if (st.slots[target] !== null) pulse(target === 0 ? 'slot1' : 'slot2');
        break;
      }
      case 'pause':
        if (ctx.state.flow === 'playing') bus.emit('ui:pauseRequested', {});
        break;
      case 'settings':
        openPanel();
        break;
    }
  }

  function release(b: Btn): void {
    if (!b.down) return;
    b.down = false;
    b.el.classList.remove('down');
    switch (b.id) {
      case 'fire':
        input.inject('fire', false);
        break;
      case 'aim':
        if (settings.aimHold) setAim(false);
        break;
      case 'jump':
        input.inject('jump', false);
        break;
      case 'interact':
        input.inject('interact', false);
        break;
      default:
        break;
    }
  }

  // ── Joystick ──────────────────────────────────────────────────────────────
  function applyStick(x: number, y: number): void {
    stickVector(x - base.x, y - base.y, TOUCH.stickRadius, TOUCH.stickDeadZone, STICK_EXPONENT, stickOut);
    input.setStick(stickOut.x, stickOut.y);
    debug.stickX = stickOut.x;
    debug.stickY = stickOut.y;
    debug.stickMag = stickOut.magnitude;
    const sp = isSprinting(stickOut.y, TOUCH.autoSprintThreshold, sprint);
    if (sp !== sprint) {
      sprint = sp;
      debug.sprint = sp;
      sprintDirty = true;
    }
    stickDirty = true;
  }

  function startStick(slot: Slot, x: number, y: number): void {
    slot.role = NS_ROLE_STICK;
    stickSlot = slot;
    clampBase(x, y, TOUCH.stickRadius, width, height, STICK_EDGE_MARGIN, base);
    stick.hidden = false;
    ghost.style.opacity = '0';
    applyStick(x, y);
  }

  function moveStick(x: number, y: number): void {
    followBase(base.x, base.y, x, y, TOUCH.stickRadius, tmp);
    base.x = tmp.x;
    base.y = tmp.y;
    applyStick(x, y);
  }

  function endStick(): void {
    stickSlot = null;
    input.setStick(0, 0);
    stick.hidden = true;
    ghost.style.opacity = '';
    debug.stickX = 0;
    debug.stickY = 0;
    debug.stickMag = 0;
    if (sprint) {
      sprint = false;
      debug.sprint = false;
      sprintDirty = true;
    }
    stickDirty = true;
  }

  // ── Mirada ────────────────────────────────────────────────────────────────
  function look(slot: Slot, x: number, y: number): void {
    stepLook(slot.look, x, y, tmp);
    if (tmp.x === 0 && tmp.y === 0) return;
    const k = lookScale(ctx.state.player.aiming, TOUCH.lookMult, TOUCH.lookAdsMult);
    const dx = tmp.x * k;
    const dy = tmp.y * k;
    input.addLook(dx, dy);
    debug.lookDX = dx;
    debug.lookDY = dy;
    debug.lookTotalX += dx;
    debug.lookTotalY += dy;
  }

  // ── Punteros ──────────────────────────────────────────────────────────────
  function findSlot(id: number): Slot | null {
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i] as Slot;
      if (s.id === id) return s;
    }
    return null;
  }

  function allocSlot(id: number): Slot | null {
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i] as Slot;
      if (s.id === -1) {
        s.id = id;
        s.role = NS_ROLE_NONE;
        s.btn = null;
        debug.pointers++;
        return s;
      }
    }
    return null;
  }

  function freeSlot(s: Slot): void {
    s.id = -1;
    s.role = NS_ROLE_NONE;
    s.btn = null;
    if (debug.pointers > 0) debug.pointers--;
  }

  function endSlot(s: Slot): void {
    if (s.role === NS_ROLE_STICK) endStick();
    else if (s.role === NS_ROLE_BUTTON && s.btn) release(s.btn);
    freeSlot(s);
  }

  function releaseAll(): void {
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i] as Slot;
      if (s.id !== -1) endSlot(s);
    }
    for (let i = 0; i < buttons.length; i++) release(buttons[i] as Btn);
    if (aimOn) setAim(false);
    for (let i = 0; i < pulses.length; i++) {
      const p = pulses[i] as Pulse;
      if (p.action !== null) {
        input.inject(p.action, false);
        p.action = null;
      }
    }
    if (stickSlot !== null) endStick();
    input.setStick(0, 0);
    debug.pointers = 0;
  }

  function onDown(e: PointerEvent): void {
    if (mode === 'off') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const t = e.target as Element | null;
    if (!t || typeof t.closest !== 'function') return;
    const hit = t.closest('[data-tc]') as HTMLElement | null;
    if (!hit || findSlot(e.pointerId)) return;
    const slot = allocSlot(e.pointerId);
    if (!slot) return;
    e.preventDefault();
    if (hit === surface) {
      const zone = decideZone(e.clientX, e.clientY, width, height, settings.lefty);
      if (zone === 'stick' && stickSlot === null) {
        startStick(slot, e.clientX, e.clientY);
      } else {
        slot.role = NS_ROLE_LOOK;
        beginLook(slot.look, e.clientX, e.clientY, 0);
      }
    } else {
      const b = btnById.get(hit.getAttribute('data-tc') ?? '');
      if (!b || b.down) {
        freeSlot(slot);
        return;
      }
      press(b, slot, e.clientX, e.clientY);
    }
    try {
      hit.setPointerCapture(e.pointerId);
    } catch {
      /* el puntero ya terminó: se libera en pointerup */
    }
  }

  function onMove(e: PointerEvent): void {
    if (debug.pointers === 0) return;
    const s = findSlot(e.pointerId);
    if (!s) return;
    if (s.role === NS_ROLE_STICK) moveStick(e.clientX, e.clientY);
    else if (s.role === NS_ROLE_LOOK) look(s, e.clientX, e.clientY);
    else if (s.role === NS_ROLE_BUTTON && s.btn !== null && s.btn.id === 'fire') look(s, e.clientX, e.clientY);
  }

  function onUp(e: PointerEvent): void {
    const s = findSlot(e.pointerId);
    if (s) endSlot(s);
  }

  // ── Gestos del navegador ──────────────────────────────────────────────────
  const blockDefault = (e: Event): void => {
    if (e.cancelable) e.preventDefault();
  };
  function onTouchStart(e: TouchEvent): void {
    const t = e.target as Element | null;
    // Sólo sobre los controles de juego: el panel y los menús necesitan sus clics sintéticos.
    if (t && typeof t.closest === 'function' && t.closest('[data-tc]') && e.cancelable) e.preventDefault();
  }
  function onTouchMove(e: TouchEvent): void {
    const t = e.target as Element | null;
    if (t && typeof t.closest === 'function' && t.closest('.tc-panel')) return;
    if (e.cancelable) e.preventDefault();
  }

  const listen = <T extends EventTarget>(target: T, type: string, fn: (e: never) => void, opts?: AddEventListenerOptions | boolean): void => {
    target.addEventListener(type, fn as EventListener, opts);
    cleanups.push(() => target.removeEventListener(type, fn as EventListener, opts));
  };
  listen(root, 'pointerdown', onDown, { passive: false });
  listen(window, 'pointermove', onMove);
  listen(window, 'pointerup', onUp, true);
  listen(window, 'pointercancel', onUp, true);
  listen(window, 'lostpointercapture', onUp, true);
  listen(root, 'touchstart', onTouchStart, { passive: false });
  listen(root, 'touchmove', onTouchMove, { passive: false });
  listen(root, 'contextmenu', blockDefault);
  listen(root, 'selectstart', blockDefault);
  listen(root, 'dragstart', blockDefault);
  // Safari iOS: pellizco (gesture*) y zoom por doble toque.
  for (const g of ['gesturestart', 'gesturechange', 'gestureend']) listen(document, g, blockDefault, { passive: false });
  listen(window, 'blur', () => releaseAll());
  listen(document, 'visibilitychange', () => {
    if (document.hidden) releaseAll();
  });
  const markDirty = (): void => {
    layoutDirty = true;
  };
  listen(window, 'resize', markDirty);
  listen(window, 'orientationchange', markDirty);
  const vv = window.visualViewport;
  if (vv) listen(vv, 'resize', markDirty);

  // ── Háptica ───────────────────────────────────────────────────────────────
  const nav = navigator as Navigator & { userActivation?: { hasBeenActive: boolean } };
  const lastBuzz: Record<HapticKind, number> = { shot: -Infinity, hit: -Infinity, damage: -Infinity, pickup: -Infinity, landed: -Infinity };
  function buzz(kind: HapticKind, pattern: number | number[]): void {
    if (!canVibrate || !settings.haptics || ctx.state.flow !== 'playing') return;
    // Chrome bloquea (y avisa por consola) vibrate antes del primer toque del usuario.
    if (nav.userActivation && !nav.userActivation.hasBeenActive) return;
    const now = performance.now();
    if (!gateOpen(lastBuzz[kind], now, HAPTIC_GAP_MS[kind])) return;
    lastBuzz[kind] = now;
    try {
      nav.vibrate(pattern);
    } catch {
      /* sin permiso: se ignora */
    }
  }
  scope
    .on('player:shot', () => buzz('shot', TOUCH.haptics.fire))
    .on('player:hitConfirm', (e) => buzz('hit', e.killed ? Math.round(TOUCH.haptics.hit * 1.6) : TOUCH.haptics.hit))
    .on('player:damaged', (e) => {
      const ms = damagePulseMs(e.amount, TOUCH.haptics.damage);
      if (ms > 0) buzz('damage', ms);
    })
    .on('pickup:collected', () => buzz('pickup', TOUCH.haptics.pickup))
    .on('extraction:landed', () => buzz('landed', LANDED_PATTERN));

  // ── Sincronización con el estado del juego (por frame, sólo escribe si cambia) ─
  function setMode(next: TouchMode): void {
    if (next === mode) return;
    mode = next;
    debug.mode = next;
    root.dataset.mode = next;
    // Cualquier cambio de modo (pausa, modal, muerte, vertical) suelta todo: nada queda «pegado».
    releaseAll();
    if (next === 'off') interactBtn.el.hidden = true;
  }

  function setBadge(b: Btn, value: number, warnZero: boolean): void {
    if (!b.badge || b.badgeVal === value) return;
    b.badgeVal = value;
    b.badge.textContent = String(value);
    b.badge.dataset.zero = warnZero && value === 0 ? '1' : '0';
  }

  function setFlag(b: Btn, key: 'active' | 'busy', value: boolean): void {
    if (b[key] === value) return;
    b[key] = value;
    b.el.classList.toggle(key, value);
  }

  let lastCurrent: Interactable | null = null;
  let ringStep = -1;

  function syncInteract(dt: number): void {
    const cur = ctx.interactions.current;
    const shown = cur !== null;
    if (shown !== !interactBtn.el.hidden) {
      interactBtn.el.hidden = !shown;
      if (!shown) {
        release(interactBtn);
        lastCurrent = null;
        ringStep = -1;
        ringFg.style.strokeDashoffset = RING_CIRC.toFixed(2);
      }
    }
    if (!cur) return;
    labelT += dt;
    if (cur !== lastCurrent || labelT >= LABEL_S) {
      labelT = 0;
      const text = cur.prompt();
      if (text !== null && labelText.textContent !== text) labelText.textContent = text;
      const hold = cur.holdSeconds > 0;
      if (labelHold.hidden === hold) labelHold.hidden = !hold;
      lastCurrent = cur;
    }
    const step = cur.holdSeconds > 0 ? Math.round(Math.min(1, Math.max(0, ctx.interactions.progress)) * RING_STEPS) : 0;
    if (step !== ringStep) {
      ringStep = step;
      ringFg.style.strokeDashoffset = (RING_CIRC * (1 - step / RING_STEPS)).toFixed(2);
    }
  }

  function syncButtons(): void {
    const p = ctx.state.player;
    setFlag(btnById.get('crouch') as Btn, 'active', p.crouched);
    setFlag(btnById.get('reload') as Btn, 'busy', p.reloading);
    setBadge(btnById.get('grenade') as Btn, p.grenades, true);
    setBadge(btnById.get('plate') as Btn, p.plates, true);
    setBadge(btnById.get('swap') as Btn, p.activeSlot + 1, false);
  }

  function syncStickVisual(): void {
    if (sprintDirty) {
      sprintDirty = false;
      stick.classList.toggle('run', sprint);
    }
    if (!stickDirty) return;
    stickDirty = false;
    if (stickSlot === null) return;
    stick.style.transform = `translate3d(${px(base.x)},${px(base.y)},0)`;
    thumb.style.transform = `translate3d(${px(stickOut.thumbX)},${px(stickOut.thumbY)},0)`;
  }

  function computeMode(): TouchMode {
    if (portrait) return 'off';
    const s = ctx.state;
    if (s.flow === 'playing') return !s.player.alive ? 'off' : s.ui.modal !== null ? 'system' : 'full';
    if (s.flow === 'paused') return 'paused';
    return 'off';
  }

  // ── API ───────────────────────────────────────────────────────────────────
  const api: TouchSystem = {
    get settings() {
      return settings;
    },
    get layout() {
      return layout;
    },
    get debug() {
      return debug;
    },
    root,
    releaseAll,
    setSettings(patch) {
      const prevLefty = settings.lefty;
      const prevAimHold = settings.aimHold;
      for (const key of Object.keys(patch) as Array<keyof TouchSettings>) {
        const v = patch[key];
        if (typeof v === 'boolean') settings[key] = v;
      }
      saveSettings(settings);
      for (const [key, sw] of switches) sw.setAttribute('aria-checked', String(settings[key]));
      fpsEl.hidden = !settings.fps;
      if (settings.aimHold !== prevAimHold && aimOn) setAim(false);
      if (settings.lefty !== prevLefty) {
        releaseAll();
        applyLayout();
      }
    },
    update(dt) {
      if (disposed) return;
      // Tamaño de pantalla: por eventos y con un sondeo lento (iOS a veces no avisa bien al girar).
      pollT += dt;
      if (pollT >= POLL_S) {
        pollT = 0;
        if (Math.abs(window.innerWidth - width) > 1 || Math.abs(window.innerHeight - height) > 1) layoutDirty = true;
      }
      if (layoutDirty) applyLayout();

      fpsFrames++;
      fpsT += dt;
      if (fpsT >= FPS_S) {
        debug.fps = Math.round(fpsFrames / fpsT);
        fpsFrames = 0;
        fpsT = 0;
        if (settings.fps) fpsEl.textContent = `${debug.fps} FPS`;
      }

      // Girar a vertical durante la partida pausa (una sola petición por episodio).
      if (portrait && ctx.state.flow === 'playing') {
        if (!portraitPauseSent) {
          portraitPauseSent = true;
          bus.emit('ui:pauseRequested', {});
        }
      } else portraitPauseSent = false;

      setMode(computeMode());
      if (panelOpen && mode !== 'paused') closePanel();
      else if (panelOpen && panelWrap.hidden) panelWrap.hidden = false;
      stepPulses(dt);

      if (mode === 'full') {
        syncInteract(dt);
        syncButtons();
        syncStickVisual();
      }
    },
    dispose() {
      if (disposed) return;
      releaseAll();
      disposed = true;
      scope.dispose();
      for (const off of cleanups) off();
      cleanups.length = 0;
      root.remove();
      for (const v of ['--tc-stick-w', '--tc-stick-h', '--tc-cluster-w', '--tc-cluster-h', '--tc-top-w', '--tc-top-h']) html.style.removeProperty(v);
      delete html.dataset.touchHand;
      if (setInputDataset) delete html.dataset.input;
    },
  };

  applyLayout();
  return api;
}
