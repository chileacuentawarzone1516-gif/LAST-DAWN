/**
 * Helicóptero de extracción, 100 % procedural. El modelo (fuselaje, cola, rotor principal y de cola,
 * patines, cabina, luces de navegación y foco) se fusiona por material para pocas draw calls.
 *
 * El movimiento se DERIVA del estado de reglas (`missions.extraction`): no tiene temporizadores
 * propios que puedan desincronizarse.
 *  - inbound: curva de Bézier desde el noroeste a ~60 m de altura hasta el centro del pad; el
 *    parámetro es 1 − etaRemaining/etaS, de modo que aterriza exactamente a la hora de la ETA.
 *  - landed/boarding: posado en el pad.
 *  - departing: despega y se aleja hacia el noreste durante departDurationS.
 *
 * Convención del modelo: morro hacia −Z, arriba +Y, origen en la base de los patines bajo el mástil.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP, MISSIONS } from '../config';
import type { GameContext, HelicopterInfo } from '../core/context';
import type { ExtractionPhase } from '../core/state';
import type { Vec3 } from '../core/types';
import { clamp, clamp01, damp, smoothstep, wrapAngle } from '../core/util';
import type { GlowTextures } from './common';
import { disposeOwned } from './common';

// ── Modelo ───────────────────────────────────────────────────────────────────

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

type V3 = readonly [number, number, number];

/** Coloca una geometría (traslación, rotación XYZ en radianes, escala) y la devuelve. */
function xf(geo: THREE.BufferGeometry, p: V3, r: V3 = [0, 0, 0], s: V3 = [1, 1, 1]): THREE.BufferGeometry {
  _e.set(r[0], r[1], r[2]);
  _q.setFromEuler(_e);
  _m.compose(_p.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
  geo.applyMatrix4(_m);
  return geo;
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return out ?? new THREE.BufferGeometry();
}

const HALF_PI = Math.PI / 2;
const ROTOR_RADIUS = 6.9;
const ROTOR_Y = 4.72;
const ROTOR_Z = 0.2;
const TAIL_ROTOR_POS: V3 = [0.22, 3.5, 7.15];

interface ModelGeos {
  body: THREE.BufferGeometry;
  dark: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  mainBlades: THREE.BufferGeometry;
  tailBlades: THREE.BufferGeometry;
}

function buildModel(): ModelGeos {
  const body = merge([
    // Cabina: cápsula tumbada a lo largo de Z, algo estrecha.
    xf(new THREE.CapsuleGeometry(1.15, 3.0, 6, 18), [0, 2.05, -0.3], [HALF_PI, 0, 0], [0.9, 1, 1]),
    // Carcasa del motor y toma de aire.
    xf(new THREE.BoxGeometry(1.5, 0.85, 2.2), [0, 3.45, 0.7]),
    xf(new THREE.CylinderGeometry(0.55, 0.62, 0.9, 14), [0, 3.55, -0.55], [HALF_PI, 0, 0]),
    // Botalón de cola cónico, deriva y estabilizador.
    xf(new THREE.CylinderGeometry(0.15, 0.4, 5.6, 10), [0, 2.75, 4.7], [HALF_PI, 0, 0]),
    xf(new THREE.BoxGeometry(0.14, 1.8, 1.3), [0, 3.5, 7.1], [0.35, 0, 0]),
    xf(new THREE.BoxGeometry(2.6, 0.08, 0.65), [0, 2.9, 6.8]),
  ]);

  const dark = merge([
    // Mástil y cubo del rotor.
    xf(new THREE.CylinderGeometry(0.13, 0.17, 0.85, 8), [0, 4.28, ROTOR_Z]),
    xf(new THREE.CylinderGeometry(0.34, 0.38, 0.16, 12), [0, ROTOR_Y - 0.06, ROTOR_Z]),
    // Patines, puntas curvadas hacia arriba y puntales.
    xf(new THREE.CylinderGeometry(0.065, 0.065, 4.8, 8), [1.2, 0.14, -0.1], [HALF_PI, 0, 0]),
    xf(new THREE.CylinderGeometry(0.065, 0.065, 4.8, 8), [-1.2, 0.14, -0.1], [HALF_PI, 0, 0]),
    xf(new THREE.CylinderGeometry(0.065, 0.065, 0.75, 8), [1.2, 0.36, -2.62], [HALF_PI + 0.65, 0, 0]),
    xf(new THREE.CylinderGeometry(0.065, 0.065, 0.75, 8), [-1.2, 0.36, -2.62], [HALF_PI + 0.65, 0, 0]),
    xf(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6), [1.02, 0.66, -1.15], [0, 0, 0.3]),
    xf(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6), [1.02, 0.66, 0.95], [0, 0, 0.3]),
    xf(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6), [-1.02, 0.66, -1.15], [0, 0, -0.3]),
    xf(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6), [-1.02, 0.66, 0.95], [0, 0, -0.3]),
    // Marcos de puerta, escape, caja de la cola y alojamiento del foco.
    xf(new THREE.BoxGeometry(0.07, 1.15, 1.55), [1.07, 1.95, 0.15]),
    xf(new THREE.BoxGeometry(0.07, 1.15, 1.55), [-1.07, 1.95, 0.15]),
    xf(new THREE.CylinderGeometry(0.22, 0.3, 0.75, 10), [0, 3.62, 2.05], [HALF_PI, 0, 0]),
    xf(new THREE.BoxGeometry(0.2, 0.3, 0.32), [0.12, 3.5, 7.2]),
    xf(new THREE.BoxGeometry(0.36, 0.28, 0.36), [0, 0.98, -2.5]),
  ]);

  const glass = merge([
    // Cúpula de la cabina y ventanillas laterales.
    xf(new THREE.SphereGeometry(1.0, 22, 14), [0, 2.55, -2.05], [0, 0, 0], [0.88, 0.7, 1.25]),
    xf(new THREE.BoxGeometry(0.05, 0.55, 0.95), [1.0, 2.55, -1.05]),
    xf(new THREE.BoxGeometry(0.05, 0.55, 0.95), [-1.0, 2.55, -1.05]),
    xf(new THREE.BoxGeometry(0.05, 0.5, 0.75), [1.0, 2.55, 0.95]),
    xf(new THREE.BoxGeometry(0.05, 0.5, 0.75), [-1.0, 2.55, 0.95]),
  ]);

  const mainBlades = merge([
    xf(new THREE.BoxGeometry(ROTOR_RADIUS * 2, 0.05, 0.34), [0, 0, 0]),
    xf(new THREE.BoxGeometry(0.34, 0.05, ROTOR_RADIUS * 2), [0, 0.01, 0]),
  ]);
  const tailBlades = merge([
    xf(new THREE.BoxGeometry(0.04, 1.7, 0.13), [0, 0, 0]),
    xf(new THREE.BoxGeometry(0.04, 0.13, 1.7), [0, 0, 0]),
  ]);
  return { body, dark, glass, mainBlades, tailBlades };
}

// ── Trayectoria ──────────────────────────────────────────────────────────────

interface Path {
  p0x: number; p0z: number; p1x: number; p1z: number; p2x: number; p2z: number; p3x: number; p3z: number;
}

/**
 * Bézier cúbica en planta: entra desde el noroeste (lejos, fuera de la niebla), se curva hacia el norte y
 * baja en arco hasta el centro del pad. Los puntos se dan como fracción de la distancia de salida.
 */
function makePath(cx: number, cz: number, dist: number): Path {
  const k = dist / 520;
  return {
    p0x: cx - 421 * k, p0z: cz - 302 * k,
    p1x: cx - 160 * k, p1z: cz - 420 * k,
    p2x: cx - 60 * k, p2z: cz - 110 * k,
    p3x: cx, p3z: cz,
  };
}

/** Exponente del frenado: velocidad alta al principio, casi nula sobre el pad. */
const BRAKE_POWER = 2.4;
/** Desde esta altura sobre el suelo el rotor levanta polvo. */
const DUST_ALTITUDE = 20;
const DUST_INTERVAL_S = 0.16;
/** Rumbo de despegue (unitario, hacia el noreste). */
const DEPART_DIR_X = 0.6;
const DEPART_DIR_Z = -0.8;
const DEPART_YAW = Math.atan2(-DEPART_DIR_X, -DEPART_DIR_Z);
const DEPART_DISTANCE = 150;
const DEPART_ALTITUDE = 62;

export interface Helicopter {
  readonly info: HelicopterInfo;
  update(dt: number): void;
  dispose(): void;
}

export function createHelicopter(ctx: GameContext, tex: GlowTextures): Helicopter {
  const { state } = ctx;
  const mats = ctx.materials;
  const shared = new Set<THREE.Material>();
  const shareMat = (key: Parameters<typeof mats.get>[0]): THREE.Material => {
    const m = mats.get(key);
    shared.add(m);
    return m;
  };

  const geos = buildModel();
  const root = new THREE.Group();
  root.name = 'helicopter';
  const tilt = new THREE.Group();
  root.add(tilt);

  const bodyMesh = new THREE.Mesh(geos.body, shareMat('helicopterBody'));
  const darkMesh = new THREE.Mesh(geos.dark, shareMat('steelDark'));
  const glassMesh = new THREE.Mesh(geos.glass, shareMat('glass'));
  tilt.add(bodyMesh, darkMesh, glassMesh);

  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, ROTOR_Y, ROTOR_Z);
  mainRotor.add(new THREE.Mesh(geos.mainBlades, shareMat('steelDark')));
  // Disco de desenfoque: se nota cuando el rotor gira a plena potencia.
  const discMat = new THREE.MeshBasicMaterial({
    color: 0xaebdcc, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide,
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(ROTOR_RADIUS, 40), discMat);
  disc.rotation.x = -HALF_PI;
  mainRotor.add(disc);
  tilt.add(mainRotor);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(TAIL_ROTOR_POS[0], TAIL_ROTOR_POS[1], TAIL_ROTOR_POS[2]);
  tailRotor.add(new THREE.Mesh(geos.tailBlades, shareMat('steelDark')));
  tilt.add(tailRotor);

  // Luces de navegación (lentes emisivas compartidas) y destellos con sprites aditivos propios.
  const lensGeo = new THREE.SphereGeometry(0.1, 8, 6);
  const lens = (key: 'emissiveRed' | 'emissiveGreen' | 'emissiveWhite', x: number, y: number, z: number, r = 1): THREE.Mesh => {
    const mesh = new THREE.Mesh(lensGeo, shareMat(key));
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(r);
    tilt.add(mesh);
    return mesh;
  };
  lens('emissiveRed', -1.03, 2.2, -1.8);
  lens('emissiveGreen', 1.03, 2.2, -1.8);
  lens('emissiveWhite', 0, 4.3, 7.45, 0.8);
  const beaconRed = lens('emissiveRed', 0, 3.98, 0.9, 1.2);
  const strobeWhite = lens('emissiveWhite', 0, 0.78, 1.8, 1.1);
  lens('emissiveWhite', 0, 0.86, -2.72, 1.5); // lente del foco

  const glowMats: THREE.SpriteMaterial[] = [];
  const glow = (color: number, x: number, y: number, z: number, size: number): THREE.Sprite => {
    const mat = new THREE.SpriteMaterial({
      map: tex.radial, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9,
    });
    glowMats.push(mat);
    const sp = new THREE.Sprite(mat);
    sp.position.set(x, y, z);
    sp.scale.setScalar(size);
    tilt.add(sp);
    return sp;
  };
  glow(0xff3030, -1.05, 2.2, -1.8, 0.9);
  glow(0x30ff80, 1.05, 2.2, -1.8, 0.9);
  const glowBeacon = glow(0xff3030, 0, 3.98, 0.9, 2.4);
  const glowStrobe = glow(0xffffff, 0, 0.78, 1.8, 2.6);
  glow(0xcfe4ff, 0, 0.86, -2.72, 2.2);

  // Haz del foco: cono aditivo con degradado que apunta hacia delante y abajo.
  const beamLen = 26;
  const beamGeo = new THREE.ConeGeometry(3.6, beamLen, 20, 1, true);
  beamGeo.translate(0, -beamLen / 2, 0);
  // El degradado vertical es «opaco abajo»; el haz debe ser intenso en el foco (ápice, uv.y = 1) y apagarse lejos.
  const beamUv = beamGeo.getAttribute('uv');
  for (let i = 0; i < beamUv.count; i++) beamUv.setY(i, 1 - beamUv.getY(i));
  const beamMat = new THREE.MeshBasicMaterial({
    map: tex.vertical, color: 0xcfe4ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending,
    depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(0, 0.86, -2.72);
  beam.rotation.x = 0.55;
  beam.frustumCulled = false;
  tilt.add(beam);

  root.visible = false;
  ctx.scene.add(root);

  // ── Estado de vuelo ───────────────────────────────────────────────────────
  const cx: number = MAP.lz.center.x;
  const cz: number = MAP.lz.center.z;
  const padY = clamp(ctx.world.groundHeight(cx, cz, 6, 0), 0, 0.6);
  const path = makePath(cx, cz, MISSIONS.extraction.heliStartDistance);
  const altitude = MISSIONS.extraction.heliAltitude;
  // Rumbo de aterrizaje = tangente final de la curva.
  const landYaw = Math.atan2(-(path.p3x - path.p2x), -(path.p3z - path.p2z));

  const pos: Vec3 = { x: cx, y: padY, z: cz };
  const dustPos: Vec3 = { x: cx, y: padY, z: cz };
  let active = false;
  let landed = false;
  let rotor = 0;
  let clock = 0;
  let dustTimer = 0;
  let havePose = false;
  let lastSpeed = 0;
  let lastYaw = 0;
  let yawRate = 0;
  let pitch = 0;
  let roll = 0;
  let lastPhase: ExtractionPhase = 'idle';
  let depX = cx;
  let depZ = cz;
  let depY = padY;
  let depYaw = landYaw;

  const info: HelicopterInfo = {
    object: root,
    position: pos,
    get active() { return active; },
    get rotorSpeed() { return rotor; },
    get landed() { return landed; },
  };

  function setPose(x: number, y: number, z: number, yaw: number, dt: number): void {
    if (havePose && dt > 1e-4) {
      const vx = (x - pos.x) / dt;
      const vz = (z - pos.z) / dt;
      const speed = Math.hypot(vx, vz);
      const accel = (speed - lastSpeed) / dt;
      yawRate = damp(yawRate, wrapAngle(yaw - lastYaw) / dt, 8, dt);
      // Morro abajo con la velocidad y arriba al frenar; alabeo hacia el interior de la curva.
      const targetPitch = -0.2 * clamp01(speed / 35) + clamp(-accel * 0.012, 0, 0.26);
      pitch = damp(pitch, targetPitch, 5, dt);
      roll = damp(roll, clamp(yawRate * 0.6, -0.45, 0.45), 4, dt);
      lastSpeed = speed;
    } else {
      pitch = 0;
      roll = 0;
      yawRate = 0;
      lastSpeed = 0;
    }
    havePose = true;
    lastYaw = yaw;
    pos.x = x;
    pos.y = y;
    pos.z = z;
    root.position.set(x, y, z);
    root.rotation.y = yaw;
    tilt.rotation.x = pitch;
    tilt.rotation.z = roll + Math.sin(clock * 1.7) * 0.01 * (y > padY + 1 ? 1 : 0);
  }

  function hide(): void {
    if (root.visible) root.visible = false;
    active = false;
    landed = false;
    rotor = 0;
    havePose = false;
  }

  function show(): void {
    if (!root.visible) root.visible = true;
    active = true;
    rotor = 1;
  }

  function maybeDust(dt: number, x: number, z: number, y: number): void {
    const alt = y - padY;
    if (alt >= DUST_ALTITUDE) return;
    dustTimer -= dt;
    if (dustTimer > 0) return;
    dustTimer = DUST_INTERVAL_S;
    dustPos.x = x;
    dustPos.y = padY + 0.2;
    dustPos.z = z;
    ctx.fx.burst('heliDust', dustPos, undefined, 1 + (1 - alt / DUST_ALTITUDE) * 1.6);
  }

  function fly(t: number, dt: number): void {
    const u = 1 - Math.pow(1 - clamp01(t), BRAKE_POWER);
    const iu = 1 - u;
    const a = iu * iu * iu;
    const b = 3 * iu * iu * u;
    const c = 3 * iu * u * u;
    const d = u * u * u;
    const x = a * path.p0x + b * path.p1x + c * path.p2x + d * path.p3x;
    const z = a * path.p0z + b * path.p1z + c * path.p2z + d * path.p3z;
    // Tangente (derivada de la Bézier): sólo importa la dirección.
    const tx = 3 * iu * iu * (path.p1x - path.p0x) + 6 * iu * u * (path.p2x - path.p1x) + 3 * u * u * (path.p3x - path.p2x);
    const tz = 3 * iu * iu * (path.p1z - path.p0z) + 6 * iu * u * (path.p2z - path.p1z) + 3 * u * u * (path.p3z - path.p2z);
    const yaw = Math.atan2(-tx, -tz);
    const y = padY + altitude * (1 - smoothstep(0.45, 1, t));
    setPose(x, y, z, yaw, dt);
    maybeDust(dt, x, z, y);
  }

  function land(dt: number): void {
    setPose(cx, padY, cz, landYaw, dt);
  }

  function depart(p: number, dt: number): void {
    const q = clamp01((p - 0.22) / 0.78);
    const dist = DEPART_DISTANCE * q * q;
    const x = depX + DEPART_DIR_X * dist;
    const z = depZ + DEPART_DIR_Z * dist;
    const y = depY + DEPART_ALTITUDE * Math.pow(clamp01(p), 1.5);
    const yaw = depYaw + wrapAngle(DEPART_YAW - depYaw) * smoothstep(0.1, 0.7, p);
    setPose(x, y, z, yaw, dt);
    maybeDust(dt, x, z, y);
  }

  return {
    info,
    update(dt) {
      clock += dt;
      const ex = state.missions.extraction;
      switch (ex.phase) {
        case 'inbound':
          show();
          landed = false;
          fly(1 - ex.etaRemaining / MISSIONS.extraction.etaS, dt);
          break;
        case 'landed':
        case 'boarding':
          show();
          landed = true;
          land(dt);
          break;
        case 'departing': {
          show();
          landed = false;
          if (lastPhase !== 'departing') {
            // El despegue arranca desde donde esté (posado, o en pleno vuelo si se fuerza por QA).
            depX = havePose ? pos.x : cx;
            depZ = havePose ? pos.z : cz;
            depY = havePose ? pos.y : padY;
            depYaw = havePose ? root.rotation.y : landYaw;
          }
          depart(1 - ex.departRemaining / MISSIONS.extraction.departDurationS, dt);
          break;
        }
        default:
          hide();
      }
      lastPhase = ex.phase;
      if (!root.visible) return;

      // Rotores, luces y foco.
      mainRotor.rotation.y += dt * rotor * 38;
      tailRotor.rotation.x += dt * rotor * 120;
      const blinkRed = clock % 1.15 < 0.14;
      const blinkWhite = clock % 0.72 < 0.06;
      beaconRed.visible = blinkRed;
      glowBeacon.visible = blinkRed;
      strobeWhite.visible = blinkWhite;
      glowStrobe.visible = blinkWhite;
      discMat.opacity = 0.1 * rotor;
    },
    dispose() {
      ctx.scene.remove(root);
      disposeOwned(root, shared);
      for (const m of glowMats) m.dispose();
    },
  };
}
