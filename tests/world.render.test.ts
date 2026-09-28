import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/config';
import type { MaterialsApi } from '../src/core/context';
import type { MaterialKey } from '../src/core/types';
import { buildGround, buildStaticMeshes } from '../src/world/builders';
import { generateLayout } from '../src/world/layout';
import { buildProps } from '../src/world/props';

const cache = new Map<MaterialKey, THREE.Material>();
const materials: MaterialsApi = {
  get: (k) => {
    let m = cache.get(k);
    if (!m) {
      m = new THREE.MeshBasicMaterial();
      cache.set(k, m);
    }
    return m;
  },
  tile: () => 4,
};

describe('geometría del mundo', () => {
  const layout = generateLayout();
  it('cabe en el presupuesto de draw calls y triángulos', () => {
    const t0 = performance.now();
    const group = new THREE.Group();
    const st = { meshes: 0, triangles: 0 };
    buildGround(layout.ground, layout.bounds, WORLD.chunkSize, materials, group, st);
    buildStaticMeshes(layout.pieces, layout.bounds, WORLD.chunkSize, materials, group, st);
    const props = buildProps(layout.props, materials, group);
    const ms = performance.now() - t0;
    const calls = st.meshes + props.meshes.length + 8;
    expect(calls).toBeLessThanOrEqual(WORLD.budget.drawCalls);
    expect(st.triangles + props.triangles).toBeLessThanOrEqual(WORLD.budget.triangles);
    expect(ms).toBeLessThan(WORLD.budget.buildMs);
  });
  it('los vértices son finitos y las UVs no son NaN', () => {
    const group = new THREE.Group();
    buildStaticMeshes(layout.pieces, layout.bounds, WORLD.chunkSize, materials, group, { meshes: 0, triangles: 0 });
    for (const o of group.children) {
      const g = (o as THREE.Mesh).geometry;
      for (const name of ['position', 'normal', 'uv']) {
        const arr = g.getAttribute(name).array as Float32Array;
        for (let i = 0; i < arr.length; i += 97) expect(Number.isFinite(arr[i])).toBe(true);
      }
    }
  });
});
