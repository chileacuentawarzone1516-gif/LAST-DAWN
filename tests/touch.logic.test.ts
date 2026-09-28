/**
 * Lógica pura del módulo táctil: curva y zona muerta del joystick, correr automático, seguimiento de la base,
 * mirada (escala, holgura), decisión de zona, layout por tamaño de pantalla / zurdo, ajustes y háptica.
 */
import { describe, expect, it } from 'vitest';
import { TOUCH } from '../src/config';
import { damagePulseMs, gateOpen, HAPTIC_GAP_MS } from '../src/touch/haptics';
import {
  beginLook, clampBase, createLookTrack, createStickOut, followBase, isSprinting, LOOK_MAX_STEP, lookScale,
  SPRINT_HYSTERESIS, STICK_EXPONENT, stepLook, stickCurve, stickVector,
} from '../src/touch/joystick';
import type { Point } from '../src/touch/joystick';
import {
  buttonsOverlap, computeLayout, decideZone, findButton, GAMEPLAY_BUTTONS, isPortrait, SYSTEM_BUTTONS, TOUCH_UI,
} from '../src/touch/layout';
import type { ButtonRect, Insets, TouchLayout } from '../src/touch/layout';
import { DEFAULT_SETTINGS, parseSettings } from '../src/touch/settings';

const R = TOUCH.stickRadius;
const DZ = TOUCH.stickDeadZone;

describe('joystick · curva y zona muerta', () => {
  it('cero dentro de la zona muerta y 1 en el borde', () => {
    expect(stickCurve(0, DZ)).toBe(0);
    expect(stickCurve(DZ, DZ)).toBe(0);
    expect(stickCurve(DZ * 0.99, DZ)).toBe(0);
    expect(stickCurve(1, DZ)).toBeCloseTo(1, 12);
    expect(stickCurve(5, DZ)).toBeCloseTo(1, 12);
  });

  it('arranca continua desde 0 al salir de la zona muerta (sin salto)', () => {
    expect(stickCurve(DZ + 0.001, DZ)).toBeLessThan(0.001);
    expect(stickCurve(DZ + 0.001, DZ)).toBeGreaterThan(0);
  });

  it('es monótona creciente y no lineal (más fina con poco empuje)', () => {
    let prev = -1;
    for (let n = 0; n <= 1.0001; n += 0.01) {
      const v = stickCurve(n, DZ);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    const mid = (0.5 - DZ) / (1 - DZ);
    expect(stickCurve(0.5, DZ)).toBeCloseTo(Math.pow(mid, STICK_EXPONENT), 12);
    expect(stickCurve(0.5, DZ)).toBeLessThan(mid);
  });

  it('entradas inválidas no producen NaN', () => {
    expect(stickCurve(NaN, DZ)).toBe(0);
    expect(stickCurve(-1, DZ)).toBe(0);
    expect(stickCurve(0.5, NaN)).toBeGreaterThan(0);
    expect(stickCurve(0.5, 5)).toBe(0);
    expect(Number.isFinite(stickCurve(0.7, DZ, 0))).toBe(true);
  });
});

describe('joystick · vector de movimiento', () => {
  const out = createStickOut();

  it('y positivo = adelante (dedo hacia arriba en pantalla)', () => {
    stickVector(0, -R, R, DZ, STICK_EXPONENT, out);
    expect(out.y).toBeCloseTo(1, 10);
    expect(out.x).toBe(0);
    stickVector(0, R, R, DZ, STICK_EXPONENT, out);
    expect(out.y).toBeCloseTo(-1, 10);
    stickVector(R, 0, R, DZ, STICK_EXPONENT, out);
    expect(out.x).toBeCloseTo(1, 10);
    expect(out.y).toBe(0);
    stickVector(-R, 0, R, DZ, STICK_EXPONENT, out);
    expect(out.x).toBeCloseTo(-1, 10);
  });

  it('sin desplazamiento o dentro de la zona muerta: (0,0) sin ceros negativos', () => {
    stickVector(0, 0, R, DZ, STICK_EXPONENT, out);
    expect(Object.is(out.x, 0) && Object.is(out.y, 0)).toBe(true);
    stickVector(2, -1, R, DZ, STICK_EXPONENT, out);
    expect(out.magnitude).toBe(0);
    expect(Object.is(out.x, 0) && Object.is(out.y, 0)).toBe(true);
    stickVector(1, 0, R, DZ, STICK_EXPONENT, out);
    expect(Object.is(out.y, 0)).toBe(true);
  });

  it('la magnitud nunca supera 1 y el pulgar se limita al radio', () => {
    stickVector(900, -900, R, DZ, STICK_EXPONENT, out);
    expect(out.magnitude).toBeLessThanOrEqual(1);
    expect(Math.hypot(out.thumbX, out.thumbY)).toBeCloseTo(R, 8);
    expect(Math.hypot(out.x, out.y)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('la dirección se conserva en diagonal', () => {
    stickVector(R * 0.6, -R * 0.6, R, DZ, STICK_EXPONENT, out);
    expect(out.x).toBeCloseTo(out.y, 10);
    expect(out.x).toBeGreaterThan(0);
  });

  it('radio o entrada inválidos devuelven (0,0)', () => {
    stickVector(10, 10, 0, DZ, STICK_EXPONENT, out);
    expect(out.magnitude).toBe(0);
    stickVector(NaN, 10, R, DZ, STICK_EXPONENT, out);
    expect(out.magnitude).toBe(0);
    stickVector(Infinity, 0, R, DZ, STICK_EXPONENT, out);
    expect(out.magnitude).toBe(0);
  });
});

describe('joystick · base flotante con correa', () => {
  const p: Point = { x: 0, y: 0 };

  it('no se mueve mientras el dedo esté dentro del radio', () => {
    followBase(100, 200, 100 + R * 0.9, 200, R, p);
    expect(p).toEqual({ x: 100, y: 200 });
  });

  it('arrastra la base para dejar el dedo exactamente a un radio', () => {
    followBase(100, 200, 100 + 3 * R, 200, R, p);
    expect(p.x).toBeCloseTo(100 + 2 * R, 10);
    expect(p.y).toBeCloseTo(200, 10);
    expect(Math.hypot(100 + 3 * R - p.x, 0)).toBeCloseTo(R, 10);
    followBase(0, 0, 3 * R, 4 * R, R, p);
    expect(Math.hypot(3 * R - p.x, 4 * R - p.y)).toBeCloseTo(R, 10);
  });

  it('clampBase mantiene el aro dentro de la pantalla', () => {
    clampBase(2, 5, R, 844, 390, 4, p);
    expect(p.x).toBe(R + 4);
    expect(p.y).toBe(R + 4);
    clampBase(900, 900, R, 844, 390, 4, p);
    expect(p.x).toBe(844 - R - 4);
    expect(p.y).toBe(390 - R - 4);
    clampBase(300, 200, R, 844, 390, 4, p);
    expect(p).toEqual({ x: 300, y: 200 });
  });

  it('clampBase con pantalla diminuta no invierte los límites', () => {
    clampBase(10, 10, R, 50, 50, 4, p);
    expect(p.x).toBe(R + 4);
    expect(p.y).toBe(R + 4);
  });
});

describe('correr automático', () => {
  const th = TOUCH.autoSprintThreshold;
  it('activa al superar el umbral y suelta con histéresis', () => {
    expect(isSprinting(th - 0.001, th, false)).toBe(false);
    expect(isSprinting(th, th, false)).toBe(true);
    expect(isSprinting(th - SPRINT_HYSTERESIS * 0.5, th, true)).toBe(true);
    expect(isSprinting(th - SPRINT_HYSTERESIS - 0.001, th, true)).toBe(false);
    expect(isSprinting(0, th, true)).toBe(false);
    expect(isSprinting(-1, th, false)).toBe(false);
  });

  it('se alcanza empujando el joystick a fondo hacia delante, no en diagonal ni a medias', () => {
    const o = createStickOut();
    stickVector(0, -R, R, DZ, STICK_EXPONENT, o);
    expect(isSprinting(o.y, th, false)).toBe(true);
    stickVector(0, -R * 0.6, R, DZ, STICK_EXPONENT, o);
    expect(isSprinting(o.y, th, false)).toBe(false);
    stickVector(R * 0.9, -R * 0.9, R, DZ, STICK_EXPONENT, o);
    expect(isSprinting(o.y, th, false)).toBe(false);
    stickVector(0, R, R, DZ, STICK_EXPONENT, o);
    expect(isSprinting(o.y, th, false)).toBe(false);
  });
});

describe('mirada por arrastre', () => {
  const d: Point = { x: 0, y: 0 };

  it('escala con lookMult y con el multiplicador ADS al apuntar', () => {
    expect(lookScale(false, TOUCH.lookMult, TOUCH.lookAdsMult)).toBeCloseTo(TOUCH.lookMult, 12);
    expect(lookScale(true, TOUCH.lookMult, TOUCH.lookAdsMult)).toBeCloseTo(TOUCH.lookMult * TOUCH.lookAdsMult, 12);
    expect(lookScale(true, TOUCH.lookMult, TOUCH.lookAdsMult)).toBeLessThan(lookScale(false, TOUCH.lookMult, TOUCH.lookAdsMult));
  });

  it('sin holgura: los deltas son inmediatos y acumulan la posición final', () => {
    const t = createLookTrack();
    beginLook(t, 100, 100, 0);
    let sx = 0;
    let sy = 0;
    for (const [x, y] of [[103, 99], [110, 90], [108, 95], [150, 60]] as const) {
      stepLook(t, x, y, d);
      sx += d.x;
      sy += d.y;
    }
    expect(sx).toBe(50);
    expect(sy).toBe(-40);
  });

  it('con holgura (dedo sobre el botón de disparo): no gira hasta salir y luego arranca sin salto', () => {
    const t = createLookTrack();
    beginLook(t, 500, 300, TOUCH_UI.fireLookSlop);
    stepLook(t, 502, 301, d);
    expect(d).toEqual({ x: 0, y: 0 });
    stepLook(t, 498, 297, d);
    expect(d).toEqual({ x: 0, y: 0 });
    stepLook(t, 500 + TOUCH_UI.fireLookSlop + 3, 300, d); // sale de la holgura: se descarta ese tramo
    expect(d).toEqual({ x: 0, y: 0 });
    stepLook(t, 500 + TOUCH_UI.fireLookSlop + 8, 302, d);
    expect(d).toEqual({ x: 5, y: 2 });
  });

  it('limita los saltos espurios de un solo evento', () => {
    const t = createLookTrack();
    beginLook(t, 0, 0, 0);
    stepLook(t, 5000, -5000, d);
    expect(d.x).toBe(LOOK_MAX_STEP);
    expect(d.y).toBe(-LOOK_MAX_STEP);
  });

  it('beginLook reinicia un seguimiento reutilizado', () => {
    const t = createLookTrack();
    beginLook(t, 0, 0, 10);
    stepLook(t, 100, 0, d);
    expect(t.engaged).toBe(true);
    beginLook(t, 50, 50, 0);
    expect(t.engaged).toBe(true);
    stepLook(t, 55, 50, d);
    expect(d.x).toBe(5);
    beginLook(t, 50, 50, 10);
    expect(t.engaged).toBe(false);
  });
});

describe('decisión de zona de un toque', () => {
  const W = 844;
  const H = 390;
  it('abajo-izquierda (~38 % del ancho, desde el 40 % de la altura) es el joystick', () => {
    expect(decideZone(20, H - 20, W, H, false)).toBe('stick');
    expect(decideZone(W * 0.38, H * 0.6, W, H, false)).toBe('stick');
    expect(decideZone(W * 0.2, H * 0.55, W, H, false)).toBe('stick');
  });
  it('el resto (derecha y mitad superior) es mirada', () => {
    expect(decideZone(W * 0.39, H * 0.9, W, H, false)).toBe('look');
    expect(decideZone(W * 0.2, H * 0.2, W, H, false)).toBe('look');
    expect(decideZone(W * 0.9, H * 0.9, W, H, false)).toBe('look');
    expect(decideZone(W * 0.5, H * 0.5, W, H, false)).toBe('look');
  });
  it('en zurdo el joystick está abajo-derecha', () => {
    expect(decideZone(W - 20, H - 20, W, H, true)).toBe('stick');
    expect(decideZone(20, H - 20, W, H, true)).toBe('look');
    expect(decideZone(W * 0.62, H * 0.6, W, H, true)).toBe('stick');
    expect(decideZone(W * 0.61, H * 0.6, W, H, true)).toBe('look');
  });
});

describe('orientación', () => {
  it('vertical sólo si el alto supera al ancho', () => {
    expect(isPortrait(390, 844)).toBe(true);
    expect(isPortrait(844, 390)).toBe(false);
    expect(isPortrait(500, 500)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Layout
// ─────────────────────────────────────────────────────────────────────────────
const SIZES: Array<[number, number]> = [
  [568, 320], [640, 360], [667, 375], [740, 360], [780, 360], [844, 390], [896, 414], [932, 430], [1024, 768], [1180, 820],
];
const NOTCH: Insets = { top: 0, right: 47, bottom: 21, left: 47 };
const NONE: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

function all(l: TouchLayout, ids: readonly string[]): ButtonRect[] {
  return ids.map((id) => {
    const b = findButton(l, id as ButtonRect['id']);
    if (!b) throw new Error(`falta el botón ${id}`);
    return b;
  });
}

describe('layout · invariantes en todos los tamaños', () => {
  for (const [w, h] of SIZES) {
    for (const lefty of [false, true]) {
      for (const [name, ins] of [['sin muesca', NONE], ['con muesca', NOTCH]] as const) {
        const l = computeLayout(w, h, lefty, ins);
        const tag = `${w}x${h} ${lefty ? 'zurdo' : 'diestro'} ${name}`;

        it(`${tag}: están todos los botones y ninguno se solapa`, () => {
          const ids = [...GAMEPLAY_BUTTONS, ...SYSTEM_BUTTONS];
          expect(l.buttons.map((b) => b.id).sort()).toEqual([...ids].sort());
          for (let i = 0; i < l.buttons.length; i++) {
            for (let j = i + 1; j < l.buttons.length; j++) {
              const a = l.buttons[i] as ButtonRect;
              const b = l.buttons[j] as ButtonRect;
              expect(buttonsOverlap(a, b, 2), `${a.id} solapa con ${b.id}`).toBe(false);
            }
          }
        });

        it(`${tag}: todo cabe en pantalla respetando las áreas seguras`, () => {
          for (const b of l.buttons) {
            expect(b.cx - b.size / 2, `${b.id} izquierda`).toBeGreaterThanOrEqual(ins.left - 1e-6);
            expect(b.cx + b.size / 2, `${b.id} derecha`).toBeLessThanOrEqual(w - ins.right + 1e-6);
            expect(b.cy - b.size / 2, `${b.id} arriba`).toBeGreaterThanOrEqual(ins.top - 1e-6);
            expect(b.cy + b.size / 2, `${b.id} abajo`).toBeLessThanOrEqual(h - ins.bottom + 1e-6);
          }
        });

        it(`${tag}: no tapa la mirilla central ni invade la zona del joystick`, () => {
          const clear = h * TOUCH_UI.crosshairClear;
          for (const b of l.buttons) {
            expect(Math.hypot(b.cx - w / 2, b.cy - h / 2) - b.size / 2, `${b.id} sobre la mirilla`).toBeGreaterThan(clear);
            // el cluster está del lado de la mano y el joystick del contrario
            const sz = l.stickZone;
            const inside = b.cx + b.size / 2 > sz.x && b.cx - b.size / 2 < sz.x + sz.w && b.cy + b.size / 2 > sz.y;
            expect(inside, `${b.id} dentro de la zona del joystick`).toBe(false);
          }
        });

        it(`${tag}: tamaños táctiles (disparo el mayor, resto ≥ 40 px)`, () => {
          const fire = findButton(l, 'fire') as ButtonRect;
          for (const b of l.buttons) {
            expect(b.size).toBeGreaterThanOrEqual(40);
            if (b.id !== 'fire') expect(fire.size).toBeGreaterThan(b.size);
          }
          for (const b of all(l, ['aim', 'jump', 'crouch', 'reload', 'grenade', 'plate', 'swap'])) expect(b.size).toBeGreaterThanOrEqual(48);
          expect(fire.size).toBeGreaterThanOrEqual(78);
        });
      }
    }
  }
});

describe('layout · geometría', () => {
  it('diestro: cluster abajo-derecha, sistema arriba-derecha, pausa en la esquina', () => {
    const l = computeLayout(844, 390, false, NONE);
    const fire = findButton(l, 'fire') as ButtonRect;
    const pause = findButton(l, 'pause') as ButtonRect;
    const map = findButton(l, 'map') as ButtonRect;
    expect(fire.cx).toBeGreaterThan(844 * 0.8);
    expect(fire.cy).toBeGreaterThan(390 * 0.6);
    expect(pause.cx).toBeGreaterThan(map.cx);
    expect(pause.cy).toBeLessThan(80);
    expect(l.cluster.x + l.cluster.w).toBeLessThanOrEqual(844);
    expect(l.cluster.y + l.cluster.h).toBeLessThanOrEqual(390);
    expect(l.stickZone.x).toBe(0);
  });

  it('zurdo es el espejo exacto del diestro (sin muesca)', () => {
    const a = computeLayout(844, 390, false, NONE);
    const b = computeLayout(844, 390, true, NONE);
    for (const ba of a.buttons) {
      const bb = findButton(b, ba.id) as ButtonRect;
      expect(bb.cx).toBeCloseTo(844 - ba.cx, 9);
      expect(bb.cy).toBeCloseTo(ba.cy, 9);
      expect(bb.size).toBe(ba.size);
    }
    expect(b.stickZone.x).toBeCloseTo(844 * (1 - TOUCH_UI.stickZoneWidth), 9);
    expect(b.stickHome.x).toBeCloseTo(844 - a.stickHome.x, 9);
    expect(b.cluster.x).toBeCloseTo(844 - a.cluster.x - a.cluster.w, 9);
  });

  it('en zurdo el margen seguro del lado de la mano es el derecho del dispositivo (intercambio)', () => {
    const ins: Insets = { top: 0, right: 10, bottom: 0, left: 60 };
    const l = computeLayout(844, 390, true, ins);
    const fire = findButton(l, 'fire') as ButtonRect;
    expect(fire.cx - fire.size / 2).toBeGreaterThanOrEqual(ins.left - 1e-6);
    const r = computeLayout(844, 390, false, ins);
    const fireR = findButton(r, 'fire') as ButtonRect;
    expect(fireR.cx + fireR.size / 2).toBeLessThanOrEqual(844 - ins.right + 1e-6);
  });

  it('los tamaños escalan con la altura y respetan los límites del clamp (320..430 px de alto)', () => {
    const small = computeLayout(568, 320);
    const big = computeLayout(932, 430);
    const fs = (findButton(small, 'fire') as ButtonRect).size;
    const fb = (findButton(big, 'fire') as ButtonRect).size;
    expect(fb).toBeGreaterThan(fs);
    expect(fs).toBeGreaterThanOrEqual(TOUCH_UI.fire.min);
    const huge = computeLayout(2000, 2000);
    expect((findButton(huge, 'fire') as ButtonRect).size).toBe(TOUCH_UI.fire.max);
    const tiny = computeLayout(300, 200);
    expect((findButton(tiny, 'fire') as ButtonRect).size).toBe(TOUCH_UI.fire.min);
  });

  it('el cluster deja libre la zona central: ≤ 46 % del ancho y ≤ 62 % del alto en móviles apaisados', () => {
    for (const [w, h] of SIZES.filter(([, hh]) => hh <= 430)) {
      const l = computeLayout(w, h, false, NONE);
      expect(l.cluster.w / w, `${w}x${h}`).toBeLessThan(0.46);
      expect(l.cluster.h / h, `${w}x${h}`).toBeLessThan(0.62);
    }
  });

  it('sin pantalla válida no falla ni produce NaN', () => {
    const l = computeLayout(0, 0);
    for (const b of l.buttons) {
      expect(Number.isFinite(b.cx) && Number.isFinite(b.cy) && Number.isFinite(b.size)).toBe(true);
    }
  });
});

describe('ajustes guardados', () => {
  it('valores por defecto ante datos vacíos, corruptos o ajenos', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{no json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('42')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1,2]')).toEqual(DEFAULT_SETTINGS);
  });
  it('lee sólo campos booleanos válidos', () => {
    expect(parseSettings('{"lefty":true,"aimHold":true,"haptics":false,"fps":true}')).toEqual({ lefty: true, aimHold: true, haptics: false, fps: true });
    expect(parseSettings('{"lefty":"sí","aimHold":1,"haptics":false,"extra":9}')).toEqual({ ...DEFAULT_SETTINGS, haptics: false });
  });
  it('no comparte el objeto por defecto (mutar el resultado no lo contamina)', () => {
    const a = parseSettings(null);
    a.lefty = true;
    expect(parseSettings(null).lefty).toBe(false);
    expect(DEFAULT_SETTINGS.lefty).toBe(false);
  });
});

describe('háptica', () => {
  it('la duración crece con el daño y está acotada', () => {
    const base = TOUCH.haptics.damage;
    expect(damagePulseMs(0, base)).toBe(0);
    expect(damagePulseMs(-5, base)).toBe(0);
    expect(damagePulseMs(NaN, base)).toBe(0);
    expect(damagePulseMs(1, base)).toBe(Math.round(base * 0.35));
    expect(damagePulseMs(15, base)).toBeLessThan(damagePulseMs(30, base));
    expect(damagePulseMs(30, base)).toBe(base);
    expect(damagePulseMs(500, base)).toBe(Math.round(base * 1.5));
    expect(damagePulseMs(10, 0)).toBe(0);
  });
  it('limita la frecuencia por tipo', () => {
    expect(gateOpen(0, 50, HAPTIC_GAP_MS.shot)).toBe(false);
    expect(gateOpen(0, HAPTIC_GAP_MS.shot, HAPTIC_GAP_MS.shot)).toBe(true);
    expect(gateOpen(-Infinity, 0, HAPTIC_GAP_MS.landed)).toBe(true);
  });
});
