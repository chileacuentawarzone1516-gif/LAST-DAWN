/** Tipos compartidos del módulo de audio (sin dependencias de WebAudio en runtime). */
import type { Rng } from '../core/util';

export type BusName = 'sfx' | 'music' | 'ambience' | 'ui';

/** Parámetros con los que se invoca una receta (todos con valor por defecto en `makeParams`). */
export interface RecipeParams {
  rng: Rng;
  /** 0..1: energía genérica (pasos, impactos, daño, cantidad). */
  intensity: number;
  /** Multiplicador de tono. */
  pitch: number;
  /** Duración solicitada (s) para recetas sincronizadas (recargas, placa). */
  duration: number;
  /** Variante alternativa (armadura absorbió el golpe, arma con supresor…). */
  alt: boolean;
  /** Distancia al oyente (m); 0 = sonido no espacial. */
  distance: number;
  /** Valor 0..1 genérico (progreso, altura tonal…). */
  level: number;
}

/**
 * Una receta programa nodos WebAudio en `dest` a partir de `t0`. Funciona igual con
 * AudioContext y OfflineAudioContext (QA). No debe guardar estado entre llamadas.
 */
export type Recipe = (ac: BaseAudioContext, dest: AudioNode, t0: number, p: RecipeParams) => void;

export type SfxCategory =
  | 'gun' | 'impact' | 'step' | 'foley' | 'vocal' | 'enemy' | 'explosion' | 'ui' | 'pickup'
  | 'alarm' | 'stinger' | 'ambient' | 'body';

export interface RecipeDef {
  id: string;
  play: Recipe;
  category: SfxCategory;
  /** 0..100 (mayor gana al robar voz). */
  priority: number;
  /** Duración esperada (s) con los parámetros por defecto: limitador y QA. */
  dur: number;
  bus: BusName;
  /** Ajuste de nivel de la receta (lineal). */
  trim: number;
  /** Envío base a la reverb (0..1). */
  send: number;
  /** Alcance máximo (m) si es posicional; por defecto AUDIO.maxDistance. */
  range?: number;
  /** Duración audible mínima esperada (s) para QA. */
  minDur?: number;
}

export interface VoiceHandle {
  id: number;
  /** Nodos a desconectar al terminar. */
  gain: GainNode;
  extra: AudioNode[];
  end: number;
  category: string;
  /** Para cancelar rápido (robo de voz / cambio de arma). */
  group: string;
}

/** Bucle continuo con parámetros controlables (helicóptero, zumbido del relé…). */
export interface LoopHandle {
  /** Salida del bucle (para conectar a su destino). */
  readonly out: GainNode;
  /** Detiene con fundido y libera nodos. */
  stop(when: number, fade?: number): void;
  /** Nodos vivos aproximados (diagnóstico). */
  readonly nodeCount: number;
}
