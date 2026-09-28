/**
 * Efectos del viewmodel: fogonazo (sprites aditivos con textura generada por código) y
 * casquillos con física simple en el espacio de la vista. Todo con pools: sin asignaciones por frame.
 */
import * as THREE from 'three';
import type { MaterialsApi } from '../core/context';

function makeFlashTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,240,1)');
  grad.addColorStop(0.25, 'rgba(255,214,120,0.95)');
  grad.addColorStop(0.6, 'rgba(255,140,40,0.35)');
  grad.addColorStop(1, 'rgba(255,90,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // Rayos de la estrella
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    g.save();
    g.translate(32, 32);
    g.rotate((i * Math.PI) / 4 + 0.2);
    const sg = g.createLinearGradient(-31, 0, 31, 0);
    sg.addColorStop(0, 'rgba(255,170,60,0)');
    sg.addColorStop(0.5, 'rgba(255,240,190,0.85)');
    sg.addColorStop(1, 'rgba(255,170,60,0)');
    g.fillStyle = sg;
    g.fillRect(-31, -1.6, 62, 3.2);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Fogonazo de boca: un sprite de cara a la cámara y dos planos alargados a lo largo del cañón. */
export class MuzzleFlash {
  readonly group = new THREE.Group();
  private readonly texture: THREE.CanvasTexture | null;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly geoStar = new THREE.PlaneGeometry(0.15, 0.15);
  private readonly geoStreak = new THREE.PlaneGeometry(0.34, 0.075);
  private readonly star: THREE.Mesh;
  private life = 0;
  private duration = 0.05;
  private size = 1;

  constructor() {
    this.texture = makeFlashTexture();
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture ?? undefined,
      color: 0xffcf8a,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    this.star = new THREE.Mesh(this.geoStar, this.material);
    const h = new THREE.Mesh(this.geoStreak, this.material);
    h.rotation.y = Math.PI / 2;
    h.position.z = -0.14;
    const v = new THREE.Mesh(this.geoStreak, this.material);
    v.rotation.y = Math.PI / 2;
    v.rotation.x = Math.PI / 2;
    v.position.z = -0.14;
    for (const m of [this.star, h, v]) {
      m.frustumCulled = false;
      m.renderOrder = 10;
      this.group.add(m);
    }
    this.group.visible = false;
  }

  /** Lanza el fogonazo. `size` ≈ 1 para un fusil; `duration` en segundos. */
  fire(size: number, duration = 0.05): void {
    this.size = size;
    this.duration = duration;
    this.life = duration;
    this.star.rotation.z = Math.random() * Math.PI * 2;
    this.group.visible = true;
  }

  /** 0..1: fuerza actual (para la luz local). */
  get strength(): number {
    return this.life > 0 ? this.life / this.duration : 0;
  }

  update(dt: number): void {
    if (this.life <= 0) return;
    this.life -= dt;
    if (this.life <= 0) {
      this.group.visible = false;
      return;
    }
    const k = this.life / this.duration;
    const s = this.size * (0.75 + 0.5 * k);
    this.group.scale.set(s, s, s);
    this.material.opacity = 0.35 + 0.65 * k;
  }

  dispose(): void {
    this.geoStar.dispose();
    this.geoStreak.dispose();
    this.material.dispose();
    this.texture?.dispose();
    this.group.removeFromParent();
  }
}

interface Casing {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  sx: number;
  sy: number;
  sz: number;
  life: number;
}

/** Pool de casquillos y cartuchos vacíos que salen despedidos en el espacio de la vista. */
export class CasingPool {
  private readonly items: Casing[] = [];
  private readonly brassGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.03, 8);
  private readonly shellGeo = new THREE.CylinderGeometry(0.0095, 0.0095, 0.052, 8);
  private readonly shellMat = new THREE.MeshStandardMaterial({ color: 0xa3261f, roughness: 0.55, metalness: 0.05 });
  private next = 0;
  private readonly brassMat: THREE.Material;

  constructor(parent: THREE.Object3D, materials: MaterialsApi, count = 12) {
    this.brassMat = materials.get('brass');
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.brassGeo, this.brassMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      parent.add(mesh);
      this.items.push({ mesh, vx: 0, vy: 0, vz: 0, sx: 0, sy: 0, sz: 0, life: 0 });
    }
  }

  /** Expulsa un casquillo desde (x, y, z) con velocidad base (vx, vy, vz) más algo de azar. */
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, shell = false): void {
    const c = this.items[this.next] as Casing;
    this.next = (this.next + 1) % this.items.length;
    c.mesh.geometry = shell ? this.shellGeo : this.brassGeo;
    c.mesh.material = shell ? this.shellMat : this.brassMat;
    c.mesh.position.set(x, y, z);
    c.mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    c.vx = vx * (0.85 + Math.random() * 0.3);
    c.vy = vy * (0.85 + Math.random() * 0.3);
    c.vz = vz * (0.8 + Math.random() * 0.4);
    c.sx = (Math.random() - 0.5) * 30;
    c.sy = (Math.random() - 0.5) * 30;
    c.sz = (Math.random() - 0.5) * 30;
    c.life = 0.85;
    c.mesh.visible = true;
  }

  update(dt: number): void {
    for (let i = 0; i < this.items.length; i++) {
      const c = this.items[i] as Casing;
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) {
        c.mesh.visible = false;
        continue;
      }
      c.vy -= 9.8 * dt;
      const p = c.mesh.position;
      p.x += c.vx * dt;
      p.y += c.vy * dt;
      p.z += c.vz * dt;
      c.mesh.rotation.x += c.sx * dt;
      c.mesh.rotation.y += c.sy * dt;
      c.mesh.rotation.z += c.sz * dt;
    }
  }

  clear(): void {
    for (const c of this.items) {
      c.life = 0;
      c.mesh.visible = false;
    }
  }

  dispose(): void {
    for (const c of this.items) c.mesh.removeFromParent();
    this.items.length = 0;
    this.brassGeo.dispose();
    this.shellGeo.dispose();
    this.shellMat.dispose();
  }
}
