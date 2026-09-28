/** Contenido textual de los menús: controles, briefing y reglas (números desde config). */
import { CONTAMINATION, MISSIONS, TIMERS } from '../config';
import { formatClock } from '../core/util';
import type { MissionId } from '../core/types';
import type { IconName } from './icons';

export interface ControlItem {
  /** Alternativas de tecla: cada grupo es una combinación que se muestra con «/» entre ellas. */
  keys: string[][];
  action: string;
}

export interface ControlGroup {
  title: string;
  items: ControlItem[];
}

export const CONTROLS: ControlGroup[] = [
  {
    title: 'Movimiento',
    items: [
      { keys: [['W', 'A', 'S', 'D']], action: 'Moverse' },
      { keys: [['Ratón']], action: 'Mirar' },
      { keys: [['Shift']], action: 'Correr' },
      { keys: [['Espacio']], action: 'Saltar' },
      { keys: [['C']], action: 'Agacharse (alternar)' },
    ],
  },
  {
    title: 'Combate',
    items: [
      { keys: [['Clic izq.']], action: 'Disparar' },
      { keys: [['Clic der.']], action: 'Apuntar' },
      { keys: [['R']], action: 'Recargar' },
      { keys: [['1'], ['2'], ['Rueda']], action: 'Cambiar de arma' },
      { keys: [['G']], action: 'Lanzar granada' },
      { keys: [['Q']], action: 'Colocar placa de armadura' },
    ],
  },
  {
    title: 'Operación',
    items: [
      { keys: [['E']], action: 'Interactuar (mantener donde se indique)' },
      { keys: [['1'], ['…'], ['6']], action: 'Comprar en la tienda abierta' },
      { keys: [['M']], action: 'Mapa táctico' },
      { keys: [['Esc']], action: 'Pausa' },
    ],
  },
];

export interface ContractBrief {
  id: MissionId;
  title: string;
  reward: number;
  desc: string;
}

/** Los tres contratos con su recompensa y una descripción derivada de la config. */
export function contractBriefs(): ContractBrief[] {
  const R = MISSIONS.relay;
  const E = MISSIONS.extraction;
  return [
    {
      id: 'relay', title: R.title, reward: R.reward,
      desc: `Mantén E ${R.activateHoldS} s en el transmisor y permanece ${R.requiredS} s dentro del círculo marcado mientras los infectados convergen. Salir del círculo hace decaer el progreso.`,
    },
    {
      id: 'warden', title: MISSIONS.warden.title, reward: MISSIONS.warden.reward,
      desc: 'Élite blindado en el Complejo de Investigación. Rompe primero el casco y luego dispara a la cabeza: el cuerpo apenas recibe daño.',
    },
    {
      id: 'extraction', title: E.title, reward: E.reward,
      desc: `Requiere el relé restaurado. Llama al helicóptero en la radio del LZ (mantén E ${E.callHoldS} s), resiste la horda final y sube a bordo en ${E.boardWindowS} s.`,
    },
  ];
}

export interface RuleItem {
  tag: string;
  tone: 'warn' | 'danger' | 'info';
  text: string;
}

/** Reglas de partida: hitos temporales y condiciones de derrota. */
export function matchRules(): RuleItem[] {
  return [
    {
      tag: formatClock(TIMERS.contaminationStartS), tone: 'warn',
      text: `Contaminación: una nube tóxica se extiende desde el complejo (radio ${CONTAMINATION.startRadius} m y creciendo). Hace daño por segundo y el blindaje no protege.`,
    },
    {
      tag: formatClock(TIMERS.sealS), tone: 'danger',
      text: 'Sellado: el distrito se cierra. Si no has llamado a la extracción, la operación fracasa.',
    },
    {
      tag: 'Derrota', tone: 'danger',
      text: 'Mueres, el distrito se sella antes de llamar a la extracción, o el helicóptero despega sin ti.',
    },
    {
      tag: 'Botín', tone: 'info',
      text: 'La amenaza y el botín crecen hacia el norte. Compra munición y equipo en las jaulas de suministro y en el banco de armería del LZ.',
    },
  ];
}

export const SLOGAN = 'Restaura la señal. Sal con vida.';
export const TAGLINE = 'Distrito industrial en cuarentena · hora azul · un solo superviviente';

export interface GestureItem {
  icon: IconName;
  title: string;
  text: string;
}

/** Guía de gestos táctiles (sustituye a la tabla de teclas en dispositivos táctiles). */
export const TOUCH_GUIDE: GestureItem[] = [
  { icon: 'touch', title: 'Mover', text: 'Arrastra con el pulgar izquierdo en la parte inferior izquierda: aparece el joystick. Empújalo al máximo para correr.' },
  { icon: 'target', title: 'Mirar', text: 'Arrastra con el pulgar derecho sobre la pantalla para girar la cámara.' },
  { icon: 'bullet', title: 'Disparar y apuntar', text: 'Botones grandes abajo a la derecha. Apuntar reduce la dispersión y ralentiza el giro.' },
  { icon: 'grenade', title: 'Acciones', text: 'Salto, agacharse, recarga, granada, placa de armadura y cambio de arma: cada una tiene su botón.' },
  { icon: 'crate', title: 'Interactuar y comprar', text: 'El botón de interacción aparece junto a lo que puedas usar; mantenlo pulsado donde se indique. En la tienda toca un artículo para comprarlo.' },
  { icon: 'lz', title: 'Pausa y mapa', text: 'Los dos botones pequeños de arriba a la derecha. Toca el rastreador de contratos para desplegarlo o plegarlo.' },
];
