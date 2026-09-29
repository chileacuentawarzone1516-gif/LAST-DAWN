/**
 * Lógica PURA del joystick flotante y del mapeo del arrastre de mirada (sin DOM ni three.js).
 * Todas las funciones escriben en objetos de salida preasignados: se llaman desde los manejadores
 * de puntero (calientes) sin crear objetos por evento.
 */

/** Exponente de la curva de respuesta: >1 da precisión con poco empuje y llega a 1 en el borde. */
export const STICK_EXPONENT = 1.35;
/** Histéresis (0..1) para dejar de correr, igual a la del controlador del jugador. */
export const SPRINT_HYSTERESIS = 0.08;
/** Salto máximo (px CSS) de un único evento de mirada: descarta saltos espurios del navegador. */
export const LOOK_MAX_STEP = 240;

export interface Point {
  x: number;
  y: number;
}

export interface StickOut {
  /** Posición del pulgar respecto al centro de la base (px, limitada al radio; y positivo = abajo). */
  thumbX: number;
  thumbY: number;
  /** Salida analógica en [-1,1] tras zona muerta y curva: x = derecha, y = adelante (positivo). */
  x: number;
  y: number;
  /** Magnitud de la salida (0..1). */
  magnitude: number;
}

export function createStickOut(): StickOut {
  return { thumbX: 0, thumbY: 0, x: 0, y: 0, magnitude: 0 };
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Curva del joystick sobre la magnitud normalizada `n` (0..1): zona muerta con reescalado (la salida
 * arranca en 0 justo al salir de la zona muerta) y potencia `exponent` para afinar el movimiento lento.
 */
export function stickCurve(n: number, deadZone: number, exponent: number = STICK_EXPONENT): number {
  if (!(n > 0)) return 0;
  const dz = clamp(Number.isFinite(deadZone) ? deadZone : 0, 0, 0.95);
  const v = n > 1 ? 1 : n;
  if (v <= dz) return 0;
  const m = (v - dz) / (1 - dz);
  return Math.pow(m, exponent > 0 ? exponent : 1);
}

/**
 * Convierte el desplazamiento del dedo (dx, dy en px de pantalla, y hacia abajo) respecto a la base en el
 * vector de movimiento (y positivo = adelante) y en la posición limitada del pulgar.
 */
export function stickVector(dx: number, dy: number, radius: number, deadZone: number, exponent: number, out: StickOut): StickOut {
  const dist = Math.hypot(dx, dy);
  if (!(dist > 0) || !Number.isFinite(dist) || !(radius > 0)) {
    out.thumbX = 0;
    out.thumbY = 0;
    out.x = 0;
    out.y = 0;
    out.magnitude = 0;
    return out;
  }
  const clamped = dist > radius ? radius : dist;
  const ux = dx / dist;
  const uy = dy / dist;
  const mag = stickCurve(clamped / radius, deadZone, exponent);
  out.thumbX = ux * clamped;
  out.thumbY = uy * clamped;
  out.magnitude = mag;
  // `0 +` y `0 -` evitan el cero negativo en las salidas nulas.
  out.x = 0 + ux * mag;
  out.y = 0 - uy * mag;
  return out;
}

/**
 * Joystick flotante «con correa»: si el dedo se aleja más de `radius` de la base, la base lo sigue para que
 * la distancia quede en `radius`. Así invertir la dirección no exige recorrer todo el camino de vuelta.
 */
export function followBase(baseX: number, baseY: number, fingerX: number, fingerY: number, radius: number, out: Point): Point {
  const dx = fingerX - baseX;
  const dy = fingerY - baseY;
  const d = Math.hypot(dx, dy);
  if (!(d > radius) || !(d > 0)) {
    out.x = baseX;
    out.y = baseY;
    return out;
  }
  const k = (d - radius) / d;
  out.x = baseX + dx * k;
  out.y = baseY + dy * k;
  return out;
}

/** Limita el centro de la base para que el aro completo quepa en la pantalla (con un margen). */
export function clampBase(x: number, y: number, radius: number, width: number, height: number, margin: number, out: Point): Point {
  const lo = radius + margin;
  out.x = clamp(x, lo, Math.max(lo, width - lo));
  out.y = clamp(y, lo, Math.max(lo, height - lo));
  return out;
}

/**
 * Correr automático: la componente hacia adelante de la salida supera el umbral (histéresis para soltar).
 * Es la misma regla que aplica el controlador del jugador, para que el indicador visual no discrepe.
 */
export function isSprinting(forward: number, threshold: number, wasSprinting: boolean, hysteresis: number = SPRINT_HYSTERESIS): boolean {
  return forward >= (wasSprinting ? threshold - hysteresis : threshold);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mirada por arrastre
// ─────────────────────────────────────────────────────────────────────────────

/** Multiplicador de la mirada táctil; al apuntar (ADS) se aplica además el multiplicador reducido. */
export function lookScale(aiming: boolean, lookMult: number, adsMult: number): number {
  return aiming ? lookMult * adsMult : lookMult;
}

export interface LookTrack {
  /** Última posición procesada. */
  x: number;
  y: number;
  /** Posición de inicio (para la holgura). */
  startX: number;
  startY: number;
  /** false mientras el dedo no haya salido de la holgura inicial (p. ej. un dedo sobre el botón de disparo). */
  engaged: boolean;
  slop: number;
}

export function createLookTrack(): LookTrack {
  return { x: 0, y: 0, startX: 0, startY: 0, engaged: false, slop: 0 };
}

/** Inicia el seguimiento. `slop` > 0 exige recorrer esa distancia (px) antes de mover la cámara. */
export function beginLook(t: LookTrack, x: number, y: number, slop: number): void {
  t.x = x;
  t.y = y;
  t.startX = x;
  t.startY = y;
  t.slop = slop > 0 ? slop : 0;
  t.engaged = !(slop > 0);
}

/** Delta de mirada (px de pantalla, sin escalar) desde la última posición; escribe en `out`. */
export function stepLook(t: LookTrack, x: number, y: number, out: Point): Point {
  if (!t.engaged) {
    if (Math.hypot(x - t.startX, y - t.startY) < t.slop) {
      out.x = 0;
      out.y = 0;
      return out;
    }
    // La distancia de la holgura se descarta: la cámara arranca suave desde aquí.
    t.engaged = true;
    t.x = x;
    t.y = y;
    out.x = 0;
    out.y = 0;
    return out;
  }
  out.x = clamp(x - t.x, -LOOK_MAX_STEP, LOOK_MAX_STEP);
  out.y = clamp(y - t.y, -LOOK_MAX_STEP, LOOK_MAX_STEP);
  t.x = x;
  t.y = y;
  return out;
}
