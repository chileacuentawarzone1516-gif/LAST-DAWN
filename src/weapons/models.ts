/**
 * Modelos procedurales de las 7 armas, brazos con guantes y accesorios (granada, placa, cartucho).
 * Convenciones: metros; origen en el agarre de la mano derecha sobre el eje del cañón (y = 0);
 * el cañón apunta a −Z; +X es la derecha. Todo está construido con cajas/cilindros fusionados
 * por material (ver geometry.ts) y materiales de ctx.materials (compartidos, no se liberan aquí).
 */
import * as THREE from 'three';
import type { MaterialsApi } from '../core/context';
import type { WeaponId } from '../core/types';
import { PartBuilder } from './geometry';
import type { V3 } from './geometry';

/** Datos de pose y animación de un modelo de arma (espacio local del arma). */
export interface WeaponRig {
  /** Altura del eje óptico sobre el origen, z de la mira trasera y distancia ojo→mira trasera al apuntar. */
  sightY: number;
  sightZ: number;
  adsDepth: number;
  /** Posición de cadera (espacio de vista) y cabeceo/guiñada de reposo (rad). */
  hip: V3;
  hipRot: V3;
  muzzle: V3;
  eject: V3;
  rightHand: V3;
  leftHand: V3;
  /** Dónde va la mano izquierda a por el cargador / al puerto de carga. */
  magwell: V3;
  /** Recorrido (m) del cerrojo/corredera y del guardamanos; dirección en que sale el cargador. */
  boltTravel: number;
  pumpTravel: number;
  magOut: V3;
  /** Tamaño del fogonazo, dispersión visual de la patada, retroceso visual (1 = pistola). */
  flashScale: number;
  kick: number;
  /** El cerrojo/corredera se queda atrás con el cargador vacío. */
  boltLock: boolean;
  /** Mano izquierda sobre el guardamanos deslizante (escopeta). */
  leftOnPump: boolean;
  /** Vuelve invisible el cuerpo del visor al apuntar (DMR) y muestra la máscara de mira. */
  scoped: boolean;
}

export interface WeaponModel {
  id: WeaponId;
  root: THREE.Group;
  rig: WeaponRig;
  mag: THREE.Group | null;
  bolt: THREE.Group | null;
  pump: THREE.Group | null;
  hammer: THREE.Group | null;
  cylinder: THREE.Group | null;
  muzzle: THREE.Object3D;
  eject: THREE.Object3D;
  /** Posición de reposo de cada grupo móvil (para animar desplazamientos relativos). */
  seat: { mag: THREE.Vector3; bolt: THREE.Vector3; pump: THREE.Vector3; hammer: THREE.Vector3; cylinder: THREE.Vector3 };
  /** Máscara + retícula del visor (sólo DMR). */
  scope: THREE.Group | null;
  scopeMaterials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
  ownMaterials: THREE.Material[];
}

type Groups = Record<string, THREE.Group>;

function anchor(name: string, p: V3, parent: THREE.Object3D): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(p[0], p[1], p[2]);
  parent.add(o);
  return o;
}

function pick(g: Groups, name: string): THREE.Group | null {
  return g[name] ?? null;
}

/** Guardamonte y gatillo (común a casi todos los modelos). */
function trigger(b: PartBuilder, y: number, z: number, len: number): void {
  b.box('body', 'gunMetal', [0.005, 0.006, len], [0, y - 0.024, z]);
  b.box('body', 'gunMetal', [0.005, 0.03, 0.006], [0, y - 0.01, z - len / 2 + 0.003]);
  b.box('body', 'gunMetal', [0.004, 0.02, 0.006], [0, y - 0.006, z - 0.012], [0.25, 0, 0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pistola P-9 "Vector"
// ─────────────────────────────────────────────────────────────────────────────
function buildPistol(b: PartBuilder): WeaponRig {
  b.setPivot('bolt', [0, 0.026, -0.055]);
  b.setPivot('mag', [0, -0.012, 0.036]);
  b.setPivot('hammer', [0, 0.03, 0.045]);
  // Corredera
  b.box('bolt', 'gunMetal', [0.030, 0.032, 0.19], [0, 0.026, -0.055]);
  b.box('bolt', 'gunPolymer', [0.008, 0.004, 0.17], [0, 0.0445, -0.055]);
  for (let i = 0; i < 5; i++) b.box('bolt', 'gunPolymer', [0.0315, 0.026, 0.0028], [0, 0.026, 0.02 + i * 0.0072]);
  b.box('bolt', 'gunPolymer', [0.0305, 0.008, 0.02], [0, 0.031, -0.0], [0, 0, 0]);
  // Armazón y empuñadura
  b.box('body', 'gunPolymer', [0.028, 0.022, 0.17], [0, 0.0, -0.05]);
  b.box('body', 'gunPolymer', [0.033, 0.118, 0.05], [0, -0.062, 0.037], [-0.14, 0, 0]);
  b.box('body', 'gunMetal', [0.036, 0.008, 0.052], [0, -0.128, 0.052], [-0.14, 0, 0]);
  trigger(b, 0.0, -0.028, 0.055);
  b.cylZ('body', 'gunMetal', 0.0065, 0.0065, 0.018, [0, 0.026, -0.158]);
  // Miras
  b.box('bolt', 'gunMetal', [0.006, 0.01, 0.008], [-0.0085, 0.0475, 0.032]);
  b.box('bolt', 'gunMetal', [0.006, 0.01, 0.008], [0.0085, 0.0475, 0.032]);
  b.box('bolt', 'gunMetal', [0.004, 0.01, 0.006], [0, 0.0475, -0.138]);
  // Cargador (oculto dentro de la empuñadura hasta que se extrae)
  b.box('mag', 'gunMetal', [0.021, 0.12, 0.034], [0, -0.07, 0.034], [-0.14, 0, 0]);
  b.box('mag', 'gunPolymer', [0.03, 0.008, 0.046], [0, -0.132, 0.05], [-0.14, 0, 0]);
  // Martillo
  b.box('hammer', 'gunMetal', [0.006, 0.014, 0.01], [0, 0.035, 0.05], [0.5, 0, 0]);
  return {
    sightY: 0.0525, sightZ: 0.032, adsDepth: 0.3,
    hip: [0.115, -0.125, -0.27], hipRot: [0.02, 0.05, 0],
    muzzle: [0, 0.026, -0.168], eject: [0.016, 0.034, -0.005],
    rightHand: [0, -0.04, 0.043], leftHand: [-0.026, -0.078, 0.048], magwell: [0, -0.15, 0.05],
    boltTravel: 0.032, pumpTravel: 0, magOut: [0, -0.2, 0.03],
    flashScale: 0.7, kick: 0.85, boltLock: true, leftOnPump: false, scoped: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Revólver Magnum .44 "Marshal"
// ─────────────────────────────────────────────────────────────────────────────
function buildRevolver(b: PartBuilder): WeaponRig {
  b.setPivot('cylinder', [0, 0.012, -0.05]);
  b.setPivot('hammer', [0, 0.024, 0.05]);
  b.box('body', 'gunMetal', [0.03, 0.052, 0.13], [0, -0.004, -0.015]);
  b.box('body', 'gunMetal', [0.024, 0.01, 0.16], [0, 0.031, -0.02]);
  // Cañón con costilla y cubierta inferior
  b.cylZ('body', 'gunMetal', 0.0115, 0.0125, 0.21, [0, 0.018, -0.2], 10);
  b.box('body', 'gunMetal', [0.009, 0.006, 0.21], [0, 0.0335, -0.2]);
  b.box('body', 'gunMetal', [0.018, 0.02, 0.15], [0, 0.0, -0.19]);
  b.box('body', 'gunMetal', [0.006, 0.014, 0.012], [0, 0.043, -0.296]);
  // Empuñadura de madera
  b.box('body', 'gunWood', [0.031, 0.105, 0.058], [0, -0.08, 0.05], [-0.36, 0, 0]);
  b.box('body', 'gunMetal', [0.033, 0.008, 0.06], [0, -0.128, 0.068], [-0.36, 0, 0]);
  trigger(b, 0.0, -0.005, 0.07);
  // Cilindro con seis alvéolos
  b.cylZ('cylinder', 'gunMetal', 0.0285, 0.0285, 0.062, [0, 0.012, -0.05], 12);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.cylZ('cylinder', 'gunPolymer', 0.0058, 0.0058, 0.004, [Math.cos(a) * 0.017, 0.012 + Math.sin(a) * 0.017, -0.082], 6);
    b.cylZ('cylinder', 'brass', 0.0042, 0.0042, 0.003, [Math.cos(a) * 0.017, 0.012 + Math.sin(a) * 0.017, -0.0805], 6);
  }
  b.box('cylinder', 'gunMetal', [0.008, 0.008, 0.07], [0, 0.012, -0.05]);
  // Martillo y miras
  b.box('hammer', 'gunMetal', [0.008, 0.03, 0.012], [0, 0.04, 0.054], [0.55, 0, 0]);
  b.box('body', 'gunMetal', [0.006, 0.014, 0.01], [-0.0075, 0.042, 0.04]);
  b.box('body', 'gunMetal', [0.006, 0.014, 0.01], [0.0075, 0.042, 0.04]);
  return {
    sightY: 0.05, sightZ: 0.04, adsDepth: 0.3,
    hip: [0.12, -0.13, -0.27], hipRot: [0.02, 0.05, 0],
    muzzle: [0, 0.018, -0.31], eject: [-0.03, 0.0, -0.05],
    rightHand: [0, -0.045, 0.055], leftHand: [-0.028, -0.085, 0.05], magwell: [-0.045, -0.02, -0.05],
    boltTravel: 0, pumpTravel: 0, magOut: [0, 0, 0],
    flashScale: 1.5, kick: 1.6, boltLock: false, leftOnPump: false, scoped: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Carabina CR-5
// ─────────────────────────────────────────────────────────────────────────────
function buildCarbine(b: PartBuilder): WeaponRig {
  b.setPivot('mag', [0, -0.045, -0.035]);
  b.setPivot('bolt', [0.021, 0.028, -0.03]);
  b.box('body', 'gunPolymer', [0.038, 0.055, 0.16], [0, -0.018, -0.02]);
  b.box('body', 'gunMetal', [0.04, 0.038, 0.25], [0, 0.026, -0.055]);
  b.box('body', 'gunPolymer', [0.037, 0.03, 0.05], [0, -0.05, -0.035]);
  b.box('body', 'gunPolymer', [0.03, 0.098, 0.034], [0, -0.085, 0.048], [-0.25, 0, 0]);
  trigger(b, -0.02, 0.0, 0.055);
  // Guardamanos con raíl
  b.box('body', 'gunPolymer', [0.048, 0.052, 0.19], [0, 0.008, -0.265]);
  b.box('body', 'gunMetal', [0.022, 0.007, 0.38], [0, 0.0485, -0.185]);
  for (let i = 0; i < 6; i++) b.box('body', 'gunPolymer', [0.05, 0.004, 0.006], [0, 0.016 + (i % 2) * 0.012, -0.2 - i * 0.03]);
  // Cañón y freno
  b.cylZ('body', 'gunMetal', 0.008, 0.008, 0.13, [0, 0.0, -0.42]);
  b.cylZ('body', 'gunPolymer', 0.012, 0.012, 0.045, [0, 0.0, -0.485], 8);
  // Miras: punto de mira con orejas y alza abatible
  b.box('body', 'gunMetal', [0.016, 0.012, 0.018], [0, 0.058, -0.35]);
  b.box('body', 'gunMetal', [0.0035, 0.026, 0.004], [0, 0.071, -0.35]);
  b.box('body', 'gunMetal', [0.003, 0.02, 0.006], [-0.008, 0.066, -0.35]);
  b.box('body', 'gunMetal', [0.003, 0.02, 0.006], [0.008, 0.066, -0.35]);
  b.box('body', 'gunMetal', [0.026, 0.01, 0.02], [0, 0.056, 0.03]);
  b.box('body', 'gunMetal', [0.005, 0.026, 0.008], [-0.0095, 0.066, 0.03]);
  b.box('body', 'gunMetal', [0.005, 0.026, 0.008], [0.0095, 0.066, 0.03]);
  // Culata telescópica
  b.cylZ('body', 'gunPolymer', 0.016, 0.016, 0.15, [0, 0.0, 0.145]);
  b.box('body', 'gunPolymer', [0.035, 0.072, 0.1], [0, -0.008, 0.215]);
  b.box('body', 'gunPolymer', [0.036, 0.076, 0.012], [0, -0.008, 0.268]);
  // Cargador
  b.box('mag', 'gunPolymer', [0.028, 0.125, 0.036], [0, -0.108, -0.043], [0.12, 0, 0]);
  b.box('mag', 'gunMetal', [0.031, 0.01, 0.04], [0, -0.17, -0.05], [0.12, 0, 0]);
  // Cerrojo visible por la ventana de expulsión y palanca de armado
  b.box('bolt', 'gunMetal', [0.008, 0.02, 0.07], [0.021, 0.028, -0.03]);
  b.box('bolt', 'brass', [0.003, 0.008, 0.016], [0.0255, 0.03, -0.045]);
  b.box('bolt', 'gunMetal', [0.024, 0.008, 0.02], [0, 0.0555, 0.085]);
  return {
    sightY: 0.076, sightZ: 0.03, adsDepth: 0.235,
    hip: [0.145, -0.17, -0.30], hipRot: [0.025, 0.05, 0],
    muzzle: [0, 0.0, -0.512], eject: [0.026, 0.03, -0.03],
    rightHand: [0, -0.062, 0.05], leftHand: [-0.026, -0.022, -0.27], magwell: [0, -0.12, -0.04],
    boltTravel: 0.045, pumpTravel: 0, magOut: [0, -0.24, -0.02],
    flashScale: 1.0, kick: 1.0, boltLock: true, leftOnPump: false, scoped: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Subfusil MP-9
// ─────────────────────────────────────────────────────────────────────────────
function buildSmg(b: PartBuilder): WeaponRig {
  b.setPivot('mag', [0, -0.045, -0.02]);
  b.setPivot('bolt', [0.024, 0.04, -0.06]);
  b.box('body', 'gunPolymer', [0.046, 0.076, 0.25], [0, -0.004, -0.04]);
  b.box('body', 'gunMetal', [0.044, 0.02, 0.25], [0, 0.044, -0.04]);
  b.box('body', 'gunMetal', [0.047, 0.006, 0.05], [0, 0.03, -0.075]);
  b.box('body', 'gunPolymer', [0.031, 0.1, 0.034], [0, -0.088, 0.055], [-0.2, 0, 0]);
  trigger(b, -0.03, 0.005, 0.06);
  // Cubierta del cañón con ventilación
  b.cylZ('body', 'gunMetal', 0.019, 0.019, 0.14, [0, 0.002, -0.235], 10);
  for (let i = 0; i < 5; i++) b.box('body', 'gunPolymer', [0.03, 0.012, 0.008], [0, 0.02, -0.19 - i * 0.02], [0, 0, 0]);
  b.cylZ('body', 'gunPolymer', 0.009, 0.009, 0.03, [0, 0.002, -0.32], 8);
  // Empuñadura vertical
  b.box('body', 'gunPolymer', [0.026, 0.07, 0.03], [0, -0.065, -0.19]);
  // Culata plegable de alambre
  b.box('body', 'gunMetal', [0.005, 0.008, 0.17], [-0.021, 0.004, 0.17]);
  b.box('body', 'gunMetal', [0.005, 0.008, 0.17], [0.021, 0.004, 0.17]);
  b.box('body', 'gunMetal', [0.006, 0.06, 0.008], [-0.021, -0.02, 0.255]);
  b.box('body', 'gunMetal', [0.006, 0.06, 0.008], [0.021, -0.02, 0.255]);
  b.box('body', 'gunPolymer', [0.05, 0.062, 0.012], [0, -0.02, 0.262]);
  // Mira réflex hueca (se ve el mundo a través)
  b.box('body', 'gunMetal', [0.028, 0.008, 0.045], [0, 0.058, 0.0]);
  b.box('body', 'gunPolymer', [0.032, 0.005, 0.048], [0, 0.098, 0.0]);
  b.box('body', 'gunPolymer', [0.004, 0.038, 0.048], [-0.0155, 0.078, 0.0]);
  b.box('body', 'gunPolymer', [0.004, 0.038, 0.048], [0.0155, 0.078, 0.0]);
  b.sphere('body', 'emissiveRed', 0.0019, [0, 0.0785, -0.02], 6);
  // Cargador largo
  b.box('mag', 'gunPolymer', [0.026, 0.17, 0.038], [0, -0.13, -0.025], [0.04, 0, 0]);
  b.box('mag', 'gunMetal', [0.029, 0.01, 0.042], [0, -0.218, -0.027], [0.04, 0, 0]);
  // Cerrojo
  b.box('bolt', 'gunMetal', [0.012, 0.016, 0.034], [0.026, 0.04, -0.06]);
  return {
    sightY: 0.0785, sightZ: 0.024, adsDepth: 0.235,
    hip: [0.14, -0.17, -0.285], hipRot: [0.02, 0.05, 0],
    muzzle: [0, 0.002, -0.34], eject: [0.025, 0.03, -0.03],
    rightHand: [0, -0.064, 0.055], leftHand: [0, -0.078, -0.19], magwell: [0, -0.15, -0.02],
    boltTravel: 0.04, pumpTravel: 0, magOut: [0, -0.28, 0],
    flashScale: 0.85, kick: 0.8, boltLock: false, leftOnPump: false, scoped: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fusil de asalto AR-12
// ─────────────────────────────────────────────────────────────────────────────
function buildAssault(b: PartBuilder): WeaponRig {
  b.setPivot('mag', [0, -0.05, -0.05]);
  b.setPivot('bolt', [0.022, 0.03, -0.02]);
  b.box('body', 'gunPolymer', [0.04, 0.058, 0.19], [0, -0.02, -0.02]);
  b.box('body', 'gunMetal', [0.042, 0.046, 0.31], [0, 0.028, -0.055]);
  b.box('body', 'gunPolymer', [0.038, 0.032, 0.056], [0, -0.052, -0.05]);
  b.box('body', 'gunPolymer', [0.03, 0.1, 0.034], [0, -0.09, 0.052], [-0.3, 0, 0]);
  trigger(b, -0.022, 0.0, 0.06);
  // Guardamanos largo con ventilación y raíl
  b.box('body', 'gunPolymer', [0.052, 0.056, 0.3], [0, 0.008, -0.36]);
  for (let i = 0; i < 6; i++) b.box('body', 'gunMetal', [0.054, 0.012, 0.012], [0, 0.012, -0.24 - i * 0.045]);
  b.box('body', 'gunMetal', [0.022, 0.007, 0.5], [0, 0.0505, -0.25]);
  // Cañón, torre de punto de mira y freno
  b.cylZ('body', 'gunMetal', 0.0075, 0.0075, 0.1, [0, 0.0, -0.56]);
  b.box('body', 'gunMetal', [0.022, 0.03, 0.022], [0, 0.066, -0.5]);
  b.box('body', 'gunMetal', [0.0035, 0.024, 0.004], [0, 0.093, -0.5]);
  b.box('body', 'gunMetal', [0.003, 0.02, 0.008], [-0.009, 0.088, -0.5]);
  b.box('body', 'gunMetal', [0.003, 0.02, 0.008], [0.009, 0.088, -0.5]);
  b.cylZ('body', 'gunPolymer', 0.013, 0.013, 0.06, [0, 0.0, -0.625], 8);
  b.box('body', 'gunMetal', [0.028, 0.012, 0.03], [0, 0.058, -0.5]);
  // Alza de tambor y asa de transporte baja
  b.box('body', 'gunMetal', [0.028, 0.01, 0.024], [0, 0.056, 0.035]);
  b.box('body', 'gunMetal', [0.005, 0.03, 0.01], [-0.0105, 0.07, 0.035]);
  b.box('body', 'gunMetal', [0.005, 0.03, 0.01], [0.0105, 0.07, 0.035]);
  b.box('body', 'gunMetal', [0.028, 0.006, 0.012], [0, 0.088, 0.035]);
  // Empuñadura delantera angulada
  b.box('body', 'gunPolymer', [0.026, 0.07, 0.03], [0, -0.05, -0.32], [0.3, 0, 0]);
  // Culata fija con carrillera
  b.box('body', 'gunPolymer', [0.04, 0.08, 0.17], [0, -0.022, 0.2]);
  b.box('body', 'gunPolymer', [0.035, 0.024, 0.11], [0, 0.03, 0.2]);
  b.box('body', 'gunPolymer', [0.042, 0.086, 0.012], [0, -0.022, 0.29]);
  // Cargador curvo (dos tramos)
  b.box('mag', 'gunPolymer', [0.03, 0.08, 0.038], [0, -0.09, -0.055], [0.06, 0, 0]);
  b.box('mag', 'gunPolymer', [0.03, 0.08, 0.038], [0, -0.165, -0.075], [0.25, 0, 0]);
  b.box('mag', 'gunMetal', [0.033, 0.01, 0.042], [0, -0.21, -0.087], [0.25, 0, 0]);
  // Cerrojo y palanca de armado
  b.box('bolt', 'gunMetal', [0.008, 0.022, 0.08], [0.022, 0.03, -0.02]);
  b.box('bolt', 'brass', [0.003, 0.008, 0.016], [0.0265, 0.032, -0.038]);
  b.box('bolt', 'gunMetal', [0.02, 0.01, 0.03], [0.03, 0.03, 0.06]);
  return {
    sightY: 0.09, sightZ: 0.035, adsDepth: 0.235,
    hip: [0.15, -0.185, -0.30], hipRot: [0.025, 0.05, 0],
    muzzle: [0, 0.0, -0.66], eject: [0.026, 0.032, -0.03],
    rightHand: [0, -0.066, 0.052], leftHand: [-0.028, -0.024, -0.35], magwell: [0, -0.13, -0.06],
    boltTravel: 0.05, pumpTravel: 0, magOut: [0, -0.28, -0.03],
    flashScale: 1.15, kick: 1.15, boltLock: true, leftOnPump: false, scoped: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Escopeta SG-8 Pump
// ─────────────────────────────────────────────────────────────────────────────
function buildShotgun(b: PartBuilder): WeaponRig {
  b.setPivot('pump', [0, -0.006, -0.28]);
  b.box('body', 'gunMetal', [0.04, 0.06, 0.2], [0, 0.0, -0.02]);
  b.box('body', 'gunMetal', [0.03, 0.008, 0.2], [0, 0.033, -0.02]);
  // Cañón, costilla y tubo de cartuchos
  b.cylZ('body', 'gunMetal', 0.0125, 0.0125, 0.5, [0, 0.02, -0.36], 10);
  b.box('body', 'gunMetal', [0.008, 0.004, 0.46], [0, 0.0385, -0.36]);
  b.cylZ('body', 'gunMetal', 0.011, 0.011, 0.36, [0, -0.007, -0.34], 8);
  b.cylZ('body', 'gunPolymer', 0.0145, 0.0145, 0.02, [0, -0.007, -0.525], 8);
  b.sphere('body', 'brass', 0.0038, [0, 0.043, -0.6], 6);
  b.box('body', 'gunMetal', [0.012, 0.007, 0.012], [0, 0.0395, 0.05]);
  // Puerto de expulsión y de carga
  b.box('body', 'gunPolymer', [0.003, 0.018, 0.05], [0.0205, 0.012, -0.03]);
  b.box('body', 'gunPolymer', [0.03, 0.004, 0.05], [0, -0.031, -0.05]);
  // Culata y empuñadura de madera
  b.box('body', 'gunWood', [0.037, 0.095, 0.25], [0, -0.03, 0.205], [0.08, 0, 0]);
  b.box('body', 'gunWood', [0.032, 0.1, 0.042], [0, -0.076, 0.06], [-0.25, 0, 0]);
  b.box('body', 'gunPolymer', [0.039, 0.1, 0.012], [0, -0.024, 0.335], [0.08, 0, 0]);
  trigger(b, -0.02, 0.005, 0.06);
  // Guardamanos deslizante
  b.box('pump', 'gunWood', [0.05, 0.052, 0.17], [0, -0.006, -0.28]);
  for (let i = 0; i < 5; i++) b.box('pump', 'gunPolymer', [0.052, 0.054, 0.005], [0, -0.006, -0.225 - i * 0.03]);
  b.box('pump', 'gunMetal', [0.046, 0.044, 0.016], [0, -0.006, -0.372]);
  return {
    sightY: 0.0455, sightZ: 0.05, adsDepth: 0.26,
    hip: [0.14, -0.15, -0.30], hipRot: [0.025, 0.05, 0],
    muzzle: [0, 0.02, -0.625], eject: [0.024, 0.014, -0.02],
    rightHand: [0, -0.06, 0.06], leftHand: [-0.03, -0.03, -0.285], magwell: [-0.02, -0.06, -0.05],
    boltTravel: 0, pumpTravel: 0.11, magOut: [0, 0, 0],
    flashScale: 1.7, kick: 1.7, boltLock: false, leftOnPump: true, scoped: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fusil de precisión SR-25 (con visor hueco)
// ─────────────────────────────────────────────────────────────────────────────
function buildDmr(b: PartBuilder): WeaponRig {
  b.setPivot('mag', [0, -0.045, -0.045]);
  b.setPivot('bolt', [0.023, 0.03, -0.03]);
  b.box('body', 'gunMetal', [0.042, 0.06, 0.18], [0, -0.018, -0.02]);
  b.box('body', 'gunMetal', [0.044, 0.048, 0.32], [0, 0.028, -0.06]);
  b.box('body', 'gunPolymer', [0.032, 0.1, 0.034], [0, -0.09, 0.052], [-0.28, 0, 0]);
  trigger(b, -0.02, 0.0, 0.06);
  // Guardamanos flotante y cañón pesado
  b.cylZ('body', 'gunPolymer', 0.026, 0.026, 0.34, [0, 0.004, -0.36], 10);
  for (let i = 0; i < 5; i++) b.box('body', 'gunMetal', [0.012, 0.056, 0.01], [0, 0.004, -0.25 - i * 0.055]);
  b.cylZ('body', 'gunMetal', 0.0095, 0.0095, 0.26, [0, 0.0, -0.63], 8);
  b.cylZ('body', 'gunPolymer', 0.0145, 0.0145, 0.055, [0, 0.0, -0.78], 8);
  b.box('body', 'gunMetal', [0.006, 0.02, 0.006], [-0.02, -0.03, -0.47], [0, 0, 0.3]);
  b.box('body', 'gunMetal', [0.006, 0.02, 0.006], [0.02, -0.03, -0.47], [0, 0, -0.3]);
  // Raíl y monturas del visor
  b.box('body', 'gunMetal', [0.024, 0.008, 0.46], [0, 0.056, -0.11]);
  b.box('body', 'gunMetal', [0.03, 0.022, 0.016], [0, 0.067, -0.09]);
  b.box('body', 'gunMetal', [0.03, 0.022, 0.016], [0, 0.067, 0.025]);
  // Culata con carrillera regulable
  b.box('body', 'gunPolymer', [0.04, 0.08, 0.15], [0, -0.024, 0.2]);
  b.box('body', 'gunPolymer', [0.036, 0.034, 0.12], [0, 0.03, 0.21]);
  b.box('body', 'gunPolymer', [0.042, 0.09, 0.012], [0, -0.024, 0.282]);
  // Cargador de 10 y cerrojo
  b.box('mag', 'gunMetal', [0.03, 0.1, 0.05], [0, -0.095, -0.05], [0.05, 0, 0]);
  b.box('mag', 'gunPolymer', [0.033, 0.008, 0.054], [0, -0.148, -0.053], [0.05, 0, 0]);
  b.box('bolt', 'gunMetal', [0.01, 0.022, 0.09], [0.023, 0.03, -0.03]);
  b.box('bolt', 'brass', [0.003, 0.008, 0.016], [0.0285, 0.032, -0.05]);
  b.box('bolt', 'gunMetal', [0.024, 0.012, 0.016], [0.034, 0.03, 0.03]);
  return {
    sightY: 0.083, sightZ: 0.105, adsDepth: 0.062,
    hip: [0.15, -0.19, -0.31], hipRot: [0.03, 0.05, 0],
    muzzle: [0, 0.0, -0.81], eject: [0.027, 0.03, -0.03],
    rightHand: [0, -0.066, 0.052], leftHand: [-0.032, -0.026, -0.36], magwell: [0, -0.13, -0.05],
    boltTravel: 0.045, pumpTravel: 0, magOut: [0, -0.26, -0.02],
    flashScale: 1.35, kick: 1.5, boltLock: true, leftOnPump: false, scoped: true,
  };
}

const BUILDERS: Record<WeaponId, (b: PartBuilder) => WeaponRig> = {
  pistol: buildPistol,
  revolver: buildRevolver,
  carbine: buildCarbine,
  smg: buildSmg,
  assault: buildAssault,
  shotgun: buildShotgun,
  dmr: buildDmr,
};

/** Visor hueco del DMR: tubos abiertos por dentro visibles, máscara negra y retícula fina. */
function buildScope(model: WeaponModel, rig: WeaponRig, materials: MaterialsApi): void {
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x14171b, metalness: 0.7, roughness: 0.45, side: THREE.DoubleSide });
  model.ownMaterials.push(shellMat);
  const y = 0.083;
  const tube = (rFront: number, rBack: number, len: number, z: number): void => {
    const g = new THREE.CylinderGeometry(rBack, rFront, len, 20, 1, true);
    g.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, shellMat);
    m.position.set(0, y, z);
    m.frustumCulled = false;
    model.root.add(m);
    model.geometries.push(g);
  };
  tube(0.0165, 0.0165, 0.2, -0.03); // tubo principal
  tube(0.026, 0.0165, 0.06, -0.16); // campana del objetivo
  tube(0.0165, 0.024, 0.045, 0.085); // ocular
  // Anillos de acabado y torretas (opacos, materiales compartidos)
  const b = new PartBuilder();
  b.cylZ('body', 'gunMetal', 0.0275, 0.0275, 0.008, [0, y, -0.19], 20);
  b.cylZ('body', 'gunMetal', 0.0255, 0.0255, 0.008, [0, y, 0.108], 20);
  b.cylY('body', 'gunMetal', 0.008, 0.008, 0.02, [0, y + 0.027, -0.03], 10);
  b.cylX('body', 'gunMetal', 0.008, 0.02, [0.027, y, -0.03], 10);
  b.build(materials, model.root, model.geometries);
  // Máscara del visor y retícula (sólo visibles apuntando)
  const scope = new THREE.Group();
  scope.name = 'scopeOverlay';
  const maskMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const reticleMat = new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.DoubleSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, side: THREE.DoubleSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  model.ownMaterials.push(maskMat, reticleMat, dotMat);
  model.scopeMaterials.push(maskMat, reticleMat, dotMat);
  const mask = new THREE.RingGeometry(0.0196, 0.6, 32, 1);
  const maskMesh = new THREE.Mesh(mask, maskMat);
  maskMesh.position.set(0, y, rig.sightZ + 0.004);
  maskMesh.renderOrder = 5;
  maskMesh.frustumCulled = false;
  scope.add(maskMesh);
  const bar = new THREE.PlaneGeometry(0.0007, 0.0155);
  const bar2 = new THREE.PlaneGeometry(0.0155, 0.0007);
  const post = new THREE.PlaneGeometry(0.0022, 0.0035);
  const post2 = new THREE.PlaneGeometry(0.0035, 0.0022);
  const dot = new THREE.CircleGeometry(0.0006, 8);
  model.geometries.push(mask, bar, bar2, post, post2, dot);
  const rz = rig.sightZ - 0.01;
  const addBar = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, yy: number): void => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y + yy, rz);
    m.renderOrder = 6;
    m.frustumCulled = false;
    scope.add(m);
  };
  addBar(bar, reticleMat, 0, 0.0106);
  addBar(bar, reticleMat, 0, -0.0106);
  addBar(bar2, reticleMat, 0.0106, 0);
  addBar(bar2, reticleMat, -0.0106, 0);
  addBar(post, reticleMat, 0, 0.0035);
  addBar(post, reticleMat, 0, -0.0035);
  addBar(post2, reticleMat, 0.0035, 0);
  addBar(post2, reticleMat, -0.0035, 0);
  addBar(dot, dotMat, 0, 0);
  scope.visible = false;
  model.root.add(scope);
  model.scope = scope;
}

export function createWeaponModel(id: WeaponId, materials: MaterialsApi): WeaponModel {
  const root = new THREE.Group();
  root.name = `weapon_${id}`;
  const b = new PartBuilder();
  const rig = BUILDERS[id](b);
  const geometries: THREE.BufferGeometry[] = [];
  const groups = b.build(materials, root, geometries);
  const model: WeaponModel = {
    id, root, rig,
    mag: pick(groups, 'mag'), bolt: pick(groups, 'bolt'), pump: pick(groups, 'pump'),
    hammer: pick(groups, 'hammer'), cylinder: pick(groups, 'cylinder'),
    muzzle: anchor('muzzle', rig.muzzle, root), eject: anchor('eject', rig.eject, root),
    seat: { mag: new THREE.Vector3(), bolt: new THREE.Vector3(), pump: new THREE.Vector3(), hammer: new THREE.Vector3(), cylinder: new THREE.Vector3() },
    scope: null, scopeMaterials: [], geometries, ownMaterials: [],
  };
  for (const k of ['mag', 'bolt', 'pump', 'hammer', 'cylinder'] as const) {
    const part = model[k];
    if (part) model.seat[k].copy(part.position);
  }
  if (id === 'dmr') buildScope(model, rig, materials);
  return model;
}

// ─────────────────────────────────────────────────────────────────────────────
// Brazos con guantes
// ─────────────────────────────────────────────────────────────────────────────

export interface ArmRig {
  root: THREE.Group;
  geometries: THREE.BufferGeometry[];
}

/** Brazo + guante. La mano está en el origen y los dedos apuntan a −Z; el antebrazo sale hacia +Z y abajo. */
export function createArm(materials: MaterialsApi, side: 1 | -1): ArmRig {
  const b = new PartBuilder();
  const s = side;
  // Guante
  b.box('arm', 'clothDark', [0.07, 0.04, 0.085], [0, 0, 0.0]);
  b.box('arm', 'clothDark', [0.068, 0.024, 0.05], [0, -0.024, -0.058], [-0.35, 0, 0]);
  b.box('arm', 'clothDark', [0.022, 0.022, 0.056], [-0.04 * s, 0.006, -0.028], [0, 0.35 * s, 0]);
  b.box('arm', 'gunPolymer', [0.06, 0.009, 0.034], [0, 0.0245, -0.02]);
  b.box('arm', 'gunPolymer', [0.066, 0.05, 0.012], [0, 0, 0.05]);
  // Antebrazo (manga)
  const rot = new THREE.Euler(0.4, 0.28 * s, 0, 'YXZ');
  const dir = new THREE.Vector3(0, 0, 1).applyEuler(rot);
  const len = 0.46;
  const c: V3 = [dir.x * (0.055 + len / 2), dir.y * (0.055 + len / 2) - 0.003, dir.z * (0.055 + len / 2)];
  b.cylZ('arm', 'clothDark', 0.03, 0.042, len, c, 10, [rot.x, rot.y, rot.z]);
  const geometries: THREE.BufferGeometry[] = [];
  const root = new THREE.Group();
  root.name = s > 0 ? 'armR' : 'armL';
  b.build(materials, root, geometries);
  return { root, geometries };
}

// ─────────────────────────────────────────────────────────────────────────────
// Accesorios
// ─────────────────────────────────────────────────────────────────────────────

export interface PropModel {
  root: THREE.Group;
  /** Anilla/palanca que se mueve al quitar la espoleta (granada). */
  lever: THREE.Group | null;
  geometries: THREE.BufferGeometry[];
}

/** Granada de fragmentación en la mano. Origen = centro del cuerpo. */
export function createGrenadeProp(materials: MaterialsApi): PropModel {
  const b = new PartBuilder();
  b.setPivot('lever', [0.012, 0.05, 0]);
  b.sphere('body', 'clothOlive', 0.032, [0, 0, 0], 12, [1, 1.28, 1]);
  for (let i = 0; i < 3; i++) b.box('body', 'gunPolymer', [0.072, 0.003, 0.072], [0, -0.03 + i * 0.03, 0]);
  b.cylY('body', 'gunMetal', 0.014, 0.018, 0.02, [0, 0.046, 0], 8);
  b.cylY('body', 'gunMetal', 0.006, 0.006, 0.016, [0, 0.062, 0], 6);
  b.box('lever', 'gunMetal', [0.008, 0.075, 0.014], [0.03, 0.02, 0], [0, 0, -0.12]);
  b.box('lever', 'gunMetal', [0.03, 0.006, 0.014], [0.012, 0.055, 0]);
  b.box('body', 'brass', [0.004, 0.01, 0.02], [-0.018, 0.058, 0], [0, 0, 0.3]);
  const root = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const groups = b.build(materials, root, geometries);
  return { root, lever: groups.lever ?? null, geometries };
}

/** Placa de armadura de cerámica con marco de polímero. Origen = centro. */
export function createPlateProp(materials: MaterialsApi): PropModel {
  const b = new PartBuilder();
  b.box('body', 'armorPlate', [0.17, 0.21, 0.018], [0, 0, 0]);
  b.box('body', 'gunPolymer', [0.18, 0.012, 0.022], [0, 0.105, 0]);
  b.box('body', 'gunPolymer', [0.18, 0.012, 0.022], [0, -0.105, 0]);
  b.box('body', 'gunPolymer', [0.012, 0.21, 0.022], [0.0875, 0, 0]);
  b.box('body', 'gunPolymer', [0.012, 0.21, 0.022], [-0.0875, 0, 0]);
  b.box('body', 'hazard', [0.05, 0.008, 0.02], [0, 0.07, 0.0]);
  b.box('body', 'gunMetal', [0.11, 0.09, 0.006], [0, -0.01, 0.012]);
  const root = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  b.build(materials, root, geometries);
  return { root, lever: null, geometries };
}
