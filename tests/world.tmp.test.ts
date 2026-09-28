import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { MAP } from '../src/config';
import { CollisionWorld } from '../src/world/collision';
import { generateLayout } from '../src/world/layout';
import { buildCovered, buildNav, floodReachable, pickPoints } from '../src/world/nav';

it('t', () => {
  const T = <R>(n: string, f: () => R): R => {
    const t = performance.now();
    const r = f();
    appendFileSync('/tmp/t.txt', `${n} ${(performance.now() - t).toFixed(0)}\n`);
    return r;
  };
  const l = T('layout', () => generateLayout());
  T('coll', () => new CollisionWorld(l.colliders, l.bounds, l.ground, 8));
  const nav = T('nav', () => buildNav(l.colliders, l.bounds));
  const r = T('flood', () => floodReachable(nav, MAP.spawn.x, MAP.spawn.z));
  const c = T('cov', () => buildCovered(l.colliders, nav, 1.8));
  T('pick', () => pickPoints(nav, r, c, l.lootAnchors, l.pois, 1));
});
