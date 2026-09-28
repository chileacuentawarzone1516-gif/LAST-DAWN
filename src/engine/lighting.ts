/**
 * Iluminación de la hora azul: luna direccional con sombra que sigue al jugador (cuantizada al
 * texel), hemisférica ambiental y luz de relleno fría. Más la iluminación fija del viewmodel.
 */
import * as THREE from 'three';
import { RENDER } from '../config';
import type { QualityPreset } from '../config';
import { lightAxes, snapToTexel, texelSize } from './shadowSnap';
import type { V3 } from './shadowSnap';

/** Distancia (m) de la luna al centro del frustum de sombra. */
const SHADOW_LIGHT_DISTANCE = 120;
const MOON_INTENSITY = 5.2;
/** Sin reflejos de entorno la hemisférica hace de ambiente principal. */
const AMBIENT_NO_ENV = 3.2;
const AMBIENT_WITH_ENV = 1.7;
const ENV_INTENSITY = 1.0;

export interface LightRig {
  readonly moon: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fill: THREE.DirectionalLight;
  /** Ajusta sombras y ambiente al preset. `env` = hay mapa de entorno PMREM. */
  applyQuality(preset: QualityPreset, env: boolean): void;
  /**
   * Coloca el frustum de sombra alrededor del jugador (pies px,py,pz; yaw en radianes, 0 = norte)
   * adelantado hacia donde mira, cuantizado al texel para evitar el parpadeo.
   */
  follow(px: number, py: number, pz: number, yaw: number): void;
  dispose(): void;
}

export function createLightRig(scene: THREE.Scene, renderer: THREE.WebGLRenderer, moonDir: THREE.Vector3): LightRig {
  const moon = new THREE.DirectionalLight(RENDER.sky.moon, MOON_INTENSITY);
  moon.name = 'moon';
  const R = RENDER.shadowFrustum;
  const cam = moon.shadow.camera;
  cam.left = -R;
  cam.right = R;
  cam.top = R;
  cam.bottom = -R;
  cam.near = 5;
  cam.far = SHADOW_LIGHT_DISTANCE * 2.2;
  cam.updateProjectionMatrix();
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.045;
  moon.castShadow = false;
  moon.position.copy(moonDir).multiplyScalar(SHADOW_LIGHT_DISTANCE);
  scene.add(moon, moon.target);

  const hemi = new THREE.HemisphereLight(RENDER.sky.ambient, RENDER.sky.ground, AMBIENT_WITH_ENV);
  hemi.name = 'ambient';
  scene.add(hemi);

  // Relleno frío desde el lado opuesto a la luna: levanta las sombras sin aplanar el volumen.
  const fill = new THREE.DirectionalLight(0x5878b8, 0.55);
  fill.name = 'fill';
  fill.position.set(-moonDir.x * 60, 26, -moonDir.z * 60);
  scene.add(fill);

  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  lightAxes(moonDir as V3, right as V3, up as V3);
  const snapped: V3 = { x: 0, y: 0, z: 0 };
  let mapSize = 0;

  return {
    moon,
    hemi,
    fill,
    applyQuality(preset, env) {
      renderer.shadowMap.enabled = preset.shadows;
      moon.castShadow = preset.shadows;
      if (preset.shadows && preset.shadowMapSize !== mapSize) {
        mapSize = preset.shadowMapSize;
        // Cambiar el tamaño exige liberar el mapa actual: three lo recrea en el siguiente frame.
        moon.shadow.map?.dispose();
        moon.shadow.map = null;
        moon.shadow.mapSize.set(mapSize, mapSize);
      }
      hemi.intensity = env ? AMBIENT_WITH_ENV : AMBIENT_NO_ENV;
      scene.environmentIntensity = ENV_INTENSITY;
    },
    follow(px, py, pz, yaw) {
      const lead = RENDER.shadowLead;
      const size = mapSize > 0 ? mapSize : 1024;
      snapToTexel(px - Math.sin(yaw) * lead, py, pz - Math.cos(yaw) * lead, right as V3, up as V3, texelSize(R, size), snapped);
      moon.target.position.set(snapped.x, snapped.y, snapped.z);
      moon.position.set(
        snapped.x + moonDir.x * SHADOW_LIGHT_DISTANCE,
        snapped.y + moonDir.y * SHADOW_LIGHT_DISTANCE,
        snapped.z + moonDir.z * SHADOW_LIGHT_DISTANCE,
      );
    },
    dispose() {
      moon.shadow.map?.dispose();
      moon.dispose();
      scene.remove(moon, moon.target, hemi, fill);
    },
  };
}

/** Iluminación fija de la escena del viewmodel (arma en primera persona). */
export function createViewLights(viewScene: THREE.Scene): void {
  viewScene.add(new THREE.HemisphereLight(0x9fb4d8, 0x1a2030, 1.5));
  const key = new THREE.DirectionalLight(0xdfe8ff, 2.6);
  key.position.set(0.5, 1, 0.6);
  viewScene.add(key);
  // Contraluz frío: separa la silueta del arma del fondo.
  const rim = new THREE.DirectionalLight(0x6f92ff, 1.3);
  rim.position.set(-0.8, 0.3, -0.7);
  viewScene.add(rim);
}
