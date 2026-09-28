/**
 * Marcadores 3D de los contratos: anillo animado del relé y del pad del LZ, y columnas de luz
 * (balizas) visibles de lejos para el relé, el Warden y el LZ. Todo barato: geometría propia,
 * materiales aditivos sin luces reales y sin asignaciones por frame.
 */
import * as THREE from 'three';
import { MAP, MISSIONS } from '../config';
import type { GameContext } from '../core/context';
import { clamp01, smoothstep } from '../core/util';
import type { GlowTextures } from './common';
import { disposeOwned } from './common';

const NONE: ReadonlySet<THREE.Material> = new Set();

function additive(map: THREE.Texture | null, color: number, opacity: number, fog: boolean): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map, color, opacity, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    fog, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

// ── Anillo de suelo ──────────────────────────────────────────────────────────

const RING_SEGMENTS = 96;
const DASH_COUNT = 40;

/** Anillo de zona: borde, disco tenue, guiones que giran, arco de progreso y pulso que se expande. */
class GroundRing {
  readonly group = new THREE.Group();
  private readonly outer: THREE.Mesh;
  private readonly disc: THREE.Mesh;
  private readonly dashes: THREE.Mesh;
  private readonly arc: THREE.Mesh;
  private readonly pulse: THREE.Mesh;
  private readonly mats: THREE.MeshBasicMaterial[];
  private colorHex = -1;
  private arcSegments = 0;

  constructor(private readonly radius: number, x: number, y: number, z: number, withArc: boolean, tex: GlowTextures) {
    const r = radius;
    this.outer = new THREE.Mesh(new THREE.RingGeometry(r - 0.16, r, RING_SEGMENTS, 1), additive(null, 0xffffff, 0.9, true));
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(r, 48), additive(tex.disc, 0xffffff, 0.32, true));

    // Guiones: pequeños arcos fusionados en una sola malla que gira.
    const dashGeos: THREE.BufferGeometry[] = [];
    const span = (Math.PI * 2) / DASH_COUNT;
    for (let i = 0; i < DASH_COUNT; i++) {
      dashGeos.push(new THREE.RingGeometry(r - 0.62, r - 0.36, 3, 1, i * span, span * 0.5));
    }
    this.dashes = new THREE.Mesh(mergeRings(dashGeos), additive(null, 0xffffff, 0.55, true));

    this.arc = new THREE.Mesh(new THREE.RingGeometry(r - 1.25, r - 0.85, RING_SEGMENTS, 1), additive(null, 0xffffff, 0.95, true));
    this.arc.visible = withArc;
    this.arc.geometry.setDrawRange(0, 0);

    this.pulse = new THREE.Mesh(new THREE.RingGeometry(r * 0.94, r, RING_SEGMENTS, 1), additive(null, 0xffffff, 0.5, true));

    this.mats = [this.outer, this.disc, this.dashes, this.arc, this.pulse].map((m) => m.material as THREE.MeshBasicMaterial);
    for (const m of [this.disc, this.outer, this.dashes, this.arc, this.pulse]) {
      m.renderOrder = 2;
      m.frustumCulled = false;
      this.group.add(m);
    }
    // Se tumba sobre el suelo (normal hacia +Y).
    this.group.rotation.x = -Math.PI / 2;
    this.group.position.set(x, y, z);
  }

  setColor(hex: number): void {
    if (hex === this.colorHex) return;
    this.colorHex = hex;
    for (const m of this.mats) m.color.setHex(hex);
  }

  /** Progreso 0..1 del arco interior (sentido antihorario visto desde arriba). */
  setProgress(p: number): void {
    const segs = Math.round(clamp01(p) * RING_SEGMENTS);
    if (segs === this.arcSegments) return;
    this.arcSegments = segs;
    this.arc.geometry.setDrawRange(0, segs * 6);
  }

  /** `intensity` escala la opacidad global (1 = normal). */
  update(t: number, intensity: number): void {
    this.dashes.rotation.z = -t * 0.28;
    const k = (t * 0.42) % 1;
    this.pulse.scale.setScalar(0.12 + 0.88 * k);
    (this.pulse.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k) * intensity;
    const breathe = 0.85 + 0.15 * Math.sin(t * 2.4);
    (this.outer.material as THREE.MeshBasicMaterial).opacity = 0.9 * breathe * intensity;
    (this.disc.material as THREE.MeshBasicMaterial).opacity = 0.32 * intensity;
    (this.dashes.material as THREE.MeshBasicMaterial).opacity = 0.55 * intensity;
    (this.arc.material as THREE.MeshBasicMaterial).opacity = 0.95 * breathe * intensity;
  }

  get visible(): boolean {
    return this.group.visible;
  }
  set visible(v: boolean) {
    this.group.visible = v;
  }

  dispose(): void {
    disposeOwned(this.group, NONE);
  }
}

/** Fusiona anillos parciales sin depender de BufferGeometryUtils (posiciones e índices). */
function mergeRings(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vCount = 0;
  let iCount = 0;
  for (const g of geos) {
    vCount += g.getAttribute('position').count;
    iCount += g.getIndex()?.count ?? 0;
  }
  const pos = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    const u = g.getAttribute('uv');
    const ix = g.getIndex();
    pos.set(p.array as Float32Array, vo * 3);
    uv.set(u.array as Float32Array, vo * 2);
    if (ix) for (let i = 0; i < ix.count; i++) idx[io + i] = (ix.array[i] as number) + vo;
    vo += p.count;
    io += ix?.count ?? 0;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// ── Columna de luz ───────────────────────────────────────────────────────────

/** Baliza: cilindro abierto aditivo con degradado vertical + halo en la base. Sin niebla: se ve de lejos. */
class LightColumn {
  readonly group = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private readonly bodyMat: THREE.MeshBasicMaterial;
  private readonly haloMat: THREE.MeshBasicMaterial;
  private colorHex = -1;

  constructor(x: number, y: number, z: number, height: number, radius: number, tex: GlowTextures) {
    const geo = new THREE.CylinderGeometry(radius * 0.55, radius, height, 20, 1, true);
    geo.translate(0, height / 2, 0);
    this.bodyMat = new THREE.MeshBasicMaterial({
      map: tex.vertical, color: 0xffffff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false, side: THREE.FrontSide,
    });
    this.body = new THREE.Mesh(geo, this.bodyMat);
    this.haloMat = new THREE.MeshBasicMaterial({
      map: tex.radial, color: 0xffffff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    this.halo = new THREE.Mesh(new THREE.CircleGeometry(radius * 4.2, 24), this.haloMat);
    this.halo.rotation.x = -Math.PI / 2;
    this.halo.position.y = 0.12;
    this.body.frustumCulled = false;
    this.group.add(this.body, this.halo);
    this.group.position.set(x, y, z);
  }

  setColor(hex: number): void {
    if (hex === this.colorHex) return;
    this.colorHex = hex;
    this.bodyMat.color.setHex(hex);
    this.haloMat.color.setHex(hex);
  }

  setOpacity(o: number): void {
    this.bodyMat.opacity = o;
    this.haloMat.opacity = o * 0.85;
  }

  get visible(): boolean {
    return this.group.visible;
  }
  set visible(v: boolean) {
    this.group.visible = v;
  }

  dispose(): void {
    disposeOwned(this.group, NONE);
  }
}

// ── Conjunto de marcadores ───────────────────────────────────────────────────

const COLOR = {
  amber: 0xffb020,
  green: 0x3dff9c,
  cyan: 0x40e0ff,
  red: 0xff2a2a,
  blue: 0x3f8cff,
  white: 0xdfeaff,
} as const;

export interface MissionMarkers {
  update(dt: number): void;
  dispose(): void;
}

export function createMarkers(ctx: GameContext, tex: GlowTextures): MissionMarkers {
  const { state } = ctx;
  const root = new THREE.Group();
  root.name = 'mission-markers';
  ctx.scene.add(root);

  const groundY = (x: number, z: number): number => Math.min(Math.max(ctx.world.groundHeight(x, z, 4, 0), 0), 0.6);
  const relayY = groundY(MAP.relay.x, MAP.relay.z) + 0.07;
  const lzY = groundY(MAP.lz.center.x, MAP.lz.center.z) + 0.07;

  const relayRing = new GroundRing(MAP.relay.circleRadius, MAP.relay.x, relayY, MAP.relay.z, true, tex);
  const relayColumn = new LightColumn(MAP.relay.x, relayY, MAP.relay.z, 150, 1.15, tex);
  const lzRing = new GroundRing(MAP.lz.padRadius, MAP.lz.center.x, lzY, MAP.lz.center.z, false, tex);
  const lzColumn = new LightColumn(MAP.lz.center.x, lzY, MAP.lz.center.z, 110, 1.5, tex);
  const wardenColumn = new LightColumn(MAP.complex.wardenSpawn.x, 0, MAP.complex.wardenSpawn.z, 130, 1.3, tex);
  root.add(relayRing.group, relayColumn.group, lzRing.group, lzColumn.group, wardenColumn.group);

  let t = 0;

  return {
    update(dt) {
      t += dt;
      const m = state.missions;

      // Relé: ámbar (pendiente) → verde (activo) → cian (completo).
      const relay = m.relay;
      const pulse = 0.85 + 0.15 * Math.sin(t * 3.1);
      if (relay.status === 'completed') {
        relayRing.setColor(COLOR.cyan);
        relayColumn.setColor(COLOR.cyan);
        relayRing.setProgress(1);
        relayRing.update(t, 0.75);
        relayColumn.setOpacity(0.38);
      } else if (relay.activated) {
        relayRing.setColor(COLOR.green);
        relayColumn.setColor(COLOR.green);
        relayRing.setProgress(relay.progress / MISSIONS.relay.requiredS);
        relayRing.update(t, relay.insideCircle ? 1.25 : 0.85);
        relayColumn.setOpacity(0.75 * pulse);
      } else {
        relayRing.setColor(COLOR.amber);
        relayColumn.setColor(COLOR.amber);
        relayRing.setProgress(0);
        relayRing.update(t, 0.9);
        relayColumn.setOpacity(0.6 * pulse);
      }

      // Warden: baliza roja mientras siga vivo.
      const showWarden = !m.warden.killed && m.warden.status !== 'completed';
      wardenColumn.visible = showWarden;
      if (showWarden) {
        wardenColumn.setColor(COLOR.red);
        wardenColumn.setOpacity((m.warden.engaged ? 0.85 : 0.62) * (0.8 + 0.2 * Math.sin(t * 2.2)));
      }

      // LZ: azul con la extracción disponible/en curso; blanca con el helicóptero posado.
      const ex = m.extraction;
      const lzOn = (ex.status === 'available' || ex.status === 'active')
        && (ex.phase === 'idle' || ex.phase === 'inbound' || ex.phase === 'landed' || ex.phase === 'boarding');
      lzColumn.visible = lzOn;
      lzRing.visible = lzOn;
      if (lzOn) {
        const landed = ex.phase === 'landed' || ex.phase === 'boarding';
        const hex = landed ? COLOR.white : COLOR.blue;
        lzColumn.setColor(hex);
        lzRing.setColor(hex);
        lzColumn.setOpacity((landed ? 0.8 : 0.62) * pulse);
        lzRing.update(t, landed ? 1.2 : 0.9);
        // Mientras aterriza, el disco late más rápido (el helicóptero llega).
        if (ex.phase === 'inbound') lzRing.update(t * (1 + smoothstep(0, 1, 1 - ex.etaRemaining / MISSIONS.extraction.etaS)), 1);
      }
    },
    dispose() {
      ctx.scene.remove(root);
      relayRing.dispose();
      relayColumn.dispose();
      lzRing.dispose();
      lzColumn.dispose();
      wardenColumn.dispose();
    },
  };
}
