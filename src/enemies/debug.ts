/** Depuración visual de la IA: flechas del campo de flujo, radios de visión y línea a su objetivo. */
import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Enemy } from './enemy';
import type { FlowField } from './flowfield';

const ARROWS = 700;
const RINGS = 40;
const SEG = 20;

export class DebugDraw {
  enabled = false;
  private readonly arrows: THREE.LineSegments;
  private readonly rings: THREE.LineSegments;
  private readonly aPos = new Float32Array(ARROWS * 6);
  private readonly rPos = new Float32Array(RINGS * SEG * 6);
  private readonly d = { x: 0, z: 0 };
  private readonly group = new THREE.Group();

  constructor(private readonly ctx: GameContext, private readonly flow: FlowField, private readonly enemies: Enemy[]) {
    const mk = (buf: Float32Array, color: number): THREE.LineSegments => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(buf, 3).setUsage(THREE.DynamicDrawUsage));
      const m = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, fog: false });
      const l = new THREE.LineSegments(g, m);
      l.frustumCulled = false;
      l.renderOrder = 999;
      return l;
    };
    this.arrows = mk(this.aPos, 0x39ffb0);
    this.rings = mk(this.rPos, 0xffc040);
    this.group.add(this.arrows, this.rings);
    this.group.visible = false;
    ctx.scene.add(this.group);
  }

  update(): void {
    this.group.visible = this.enabled;
    if (!this.enabled) return;
    const p = this.ctx.player.position;
    const cell = this.flow.cellSize;
    let n = 0;
    const R = 12;
    const bx = Math.floor((p.x - this.flow.originX) / cell);
    const bz = Math.floor((p.z - this.flow.originZ) / cell);
    for (let dz = -R; dz <= R && n < ARROWS; dz++) {
      for (let dx = -R; dx <= R && n < ARROWS; dx++) {
        const x = this.flow.originX + (bx + dx + 0.5) * cell;
        const z = this.flow.originZ + (bz + dz + 0.5) * cell;
        if (!this.flow.sample(x, z, this.d)) continue;
        const o = n * 6;
        this.aPos[o] = x - this.d.x * 0.6; this.aPos[o + 1] = 0.3; this.aPos[o + 2] = z - this.d.z * 0.6;
        this.aPos[o + 3] = x + this.d.x * 0.6; this.aPos[o + 4] = 0.3; this.aPos[o + 5] = z + this.d.z * 0.6;
        n++;
      }
    }
    (this.arrows.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.arrows.geometry.setDrawRange(0, n * 2);
    let r = 0;
    for (const e of this.enemies) {
      if (!e.awake || r >= RINGS) continue;
      for (let s = 0; s < SEG; s++) {
        const a0 = (s / SEG) * Math.PI * 2;
        const a1 = ((s + 1) / SEG) * Math.PI * 2;
        const o = (r * SEG + s) * 6;
        this.rPos[o] = e.position.x + Math.cos(a0) * e.stats.sight; this.rPos[o + 1] = e.position.y + 0.2; this.rPos[o + 2] = e.position.z + Math.sin(a0) * e.stats.sight;
        this.rPos[o + 3] = e.position.x + Math.cos(a1) * e.stats.sight; this.rPos[o + 4] = e.position.y + 0.2; this.rPos[o + 5] = e.position.z + Math.sin(a1) * e.stats.sight;
      }
      r++;
    }
    (this.rings.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.rings.geometry.setDrawRange(0, r * SEG * 2);
  }

  dispose(): void {
    this.ctx.scene.remove(this.group);
    this.arrows.geometry.dispose();
    this.rings.geometry.dispose();
    (this.arrows.material as THREE.Material).dispose();
    (this.rings.material as THREE.Material).dispose();
  }
}
