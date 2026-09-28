/**
 * Materiales propios de los brazos del viewmodel, cacheados por (rol, color). No se mutan los
 * materiales compartidos de ctx.materials; al cambiar el perfil sólo se reasignan `mesh.material`.
 */
import * as THREE from 'three';
import type { ArmLookColors } from './armLook';

export type ArmRole = 'sleeve' | 'glove' | 'skin';

const ROLE_OF_KEY: Record<string, ArmRole | undefined> = { clothOlive: 'sleeve', clothDark: 'glove', skinPale: 'skin' };

interface Tagged {
  mesh: THREE.Mesh;
  role: ArmRole;
}

export class ArmLook {
  private readonly cache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly tagged: Tagged[] = [];
  private readonly roots: THREE.Object3D[] = [];
  private colors: ArmLookColors | null = null;

  /** Registra un brazo: las mallas con clave de material de rol pasan a usar materiales propios. */
  register(root: THREE.Object3D): void {
    this.roots.push(root);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const role = ROLE_OF_KEY[String(mesh.userData.matKey)];
      if (role) this.tagged.push({ mesh, role });
    });
    if (this.colors) this.apply(this.colors);
  }

  private material(role: ArmRole, color: number): THREE.MeshStandardMaterial {
    const key = `${role}:${color}`;
    let m = this.cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: role === 'skin' ? 0.62 : 0.93, metalness: 0 });
      m.name = `arm_${key}`;
      this.cache.set(key, m);
    }
    return m;
  }

  /** Aplica colores y finura; los materiales que dejan de usarse se liberan. */
  apply(c: ArmLookColors): void {
    this.colors = c;
    for (const t of this.tagged) t.mesh.material = this.material(t.role, c[t.role]);
    for (const r of this.roots) r.scale.set(c.handScale, c.handScale, 1);
    const used = new Set(this.tagged.map((t) => (t.mesh.material as THREE.Material).name));
    for (const [k, m] of this.cache) {
      if (!used.has(m.name)) {
        m.dispose();
        this.cache.delete(k);
      }
    }
  }

  get materialCount(): number {
    return this.cache.size;
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
    this.tagged.length = 0;
    this.roots.length = 0;
  }
}
