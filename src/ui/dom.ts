/**
 * Ayudas mínimas de DOM para la interfaz: creación de nodos, celdas con caché para
 * escribir SÓLO cuando cambia el valor, animaciones WAAPI y observación de tamaño.
 */

export type Child = Node | string | null | undefined | false;

export interface ElProps {
  class?: string;
  id?: string;
  text?: string;
  attrs?: Record<string, string>;
}

/** Crea un elemento HTML con clase, atributos y hijos (los `string` se insertan como texto). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: ElProps | string,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const p: ElProps = typeof props === 'string' ? { class: props } : (props ?? {});
  if (p.class) node.className = p.class;
  if (p.id) node.id = p.id;
  if (p.text !== undefined) node.textContent = p.text;
  if (p.attrs) for (const k of Object.keys(p.attrs)) node.setAttribute(k, p.attrs[k] as string);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c);
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Crea un elemento SVG con atributos. */
export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  ...children: Node[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs)) node.setAttribute(k, String(attrs[k]));
  for (const c of children) node.append(c);
  return node;
}

/** Texto con caché: sólo toca el DOM si el valor cambió. */
export class TextCell {
  private last: string | null = null;
  constructor(readonly node: Node) {}
  set(value: string): void {
    if (value !== this.last) {
      this.last = value;
      this.node.textContent = value;
    }
  }
}

/** Clase booleana con caché. */
export class ClassCell {
  private last: boolean | null = null;
  constructor(readonly node: Element, readonly name: string) {}
  set(on: boolean): void {
    if (on !== this.last) {
      this.last = on;
      this.node.classList.toggle(this.name, on);
    }
  }
}

/** Atributo con caché (aria-valuenow, data-*, etc.). */
export class AttrCell {
  private last: string | null = null;
  constructor(readonly node: Element, readonly name: string) {}
  set(value: string): void {
    if (value !== this.last) {
      this.last = value;
      this.node.setAttribute(this.name, value);
    }
  }
}

/** Propiedad CSS (o variable --x) con caché y cuantización opcional del número. */
export class StyleCell {
  private last: string | null = null;
  constructor(readonly node: HTMLElement | SVGElement, readonly prop: string) {}
  set(value: string): void {
    if (value !== this.last) {
      this.last = value;
      this.node.style.setProperty(this.prop, value);
    }
  }
}

/** Redondea a múltiplos de `step` (evita escribir estilos por variaciones invisibles). */
export const quant = (v: number, step: number): number => Math.round(v / step) * step;

/** Número → cadena estable sin ruido de coma flotante. */
export const num = (v: number, digits = 3): string => String(Number(v.toFixed(digits)));

// ─────────────────────────────────────────────────────────────────────────────
// Movimiento reducido y animaciones
// ─────────────────────────────────────────────────────────────────────────────
let reducedQuery: MediaQueryList | null = null;

export function prefersReducedMotion(): boolean {
  try {
    reducedQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)');
    return reducedQuery.matches;
  } catch {
    return false;
  }
}

/**
 * Lanza una animación WAAPI reiniciable (sin forzar reflow). Con movimiento reducido
 * conserva sólo los fotogramas de opacidad y acorta la duración.
 */
export function play(
  node: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  if (typeof node.animate !== 'function') return null;
  if (prefersReducedMotion()) {
    const calm = keyframes.map((k) => {
      const c: Keyframe = { ...k };
      delete c.transform;
      delete c.filter;
      return c;
    });
    return node.animate(calm, { ...options, duration: Math.min(Number(options.duration ?? 300), 400) });
  }
  return node.animate(keyframes, options);
}

/**
 * Observa el tamaño CSS de un elemento. Devuelve la función que desconecta.
 * Llama al callback de inmediato si el elemento ya tiene tamaño.
 */
export function observeSize(target: Element, cb: (width: number, height: number) => void): () => void {
  if (typeof ResizeObserver === 'undefined') {
    const on = (): void => {
      const r = target.getBoundingClientRect();
      cb(r.width, r.height);
    };
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }
  const ro = new ResizeObserver((entries) => {
    const last = entries[entries.length - 1];
    if (last) cb(last.contentRect.width, last.contentRect.height);
  });
  ro.observe(target);
  return () => ro.disconnect();
}

/** Registro de limpiezas: todo listener/observador se añade aquí y dispose() lo cancela. */
export class Disposer {
  private readonly fns: Array<() => void> = [];
  add(fn: () => void): void {
    this.fns.push(fn);
  }
  listen<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    handler: (e: DocumentEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void;
  listen<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    handler: (e: WindowEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void;
  listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void;
  listen(target: EventTarget, type: string, handler: (e: never) => void, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, handler as unknown as EventListener, opts);
    this.fns.push(() => target.removeEventListener(type, handler as unknown as EventListener, opts));
  }
  dispose(): void {
    for (const fn of this.fns.splice(0)) fn();
  }
}
