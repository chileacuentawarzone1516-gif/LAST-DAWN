/**
 * QA · pruebas de CONTRATO (análisis estático del repositorio con node:fs + invariantes de config).
 *
 *  (a) fronteras de módulo   (b) core/rules puros (sin three ni DOM)   (c) sin console.log
 *  (d) invariantes de src/config.ts   (e) cobertura de eventos   (f) ficheros huérfanos
 *  (g) sin assets ni red (todo se genera por código)
 *
 * Modo de (e) y (f): INFORMATIVO (console.warn) mientras algún módulo siga siendo stub; se endurece solo
 * cuando ningún módulo contiene el marcador PROVISIONAL, o a mano con  QA_STRICT=1 pnpm test  (QA_STRICT=0 lo relaja).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONTAMINATION, DIRECTOR, ECONOMY, ENEMIES, HORDES, LOOT, MAP, MISSIONS, PLAYER, RENDER, SHOP, SPAWN_MIX, STARTING_LOADOUT,
  THEME, THREAT_SCALE, TIMERS, WARDEN, WEAPONS, ZONE_IDS,
} from '../src/config';
import type { Rect } from '../src/config';
import { zoneAt } from '../src/rules/zones';

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades de análisis estático
// ─────────────────────────────────────────────────────────────────────────────
const ROOT = resolve(__dirname, '..');
const SRC = join(ROOT, 'src');

function listFiles(dir: string, exts: string[]): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

/** Ruta relativa a la raíz con separadores '/'. */
const rel = (p: string): string => relative(ROOT, p).split(sep).join('/');

/** Quita comentarios y (opcionalmente) el contenido de los literales de cadena. Conserva la longitud de línea. */
function strip(src: string, blankStrings: boolean): string {
  let out = '';
  let i = 0;
  let prevSig = '';
  const n = src.length;
  while (i < n) {
    const c = src[i] as string;
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += q;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') {
          if (!blankStrings) out += src[i] as string;
          i++;
        }
        const ch = src[i] as string;
        if (q === '`' && ch === '$' && src[i + 1] === '{') {
          // expresión de plantilla: se conserva tal cual hasta la llave de cierre
          let depth = 0;
          while (i < n) {
            const e = src[i] as string;
            out += e;
            if (e === '{') depth++;
            if (e === '}' && --depth === 0) break;
            i++;
          }
          i++;
          continue;
        }
        if (ch === '\n') out += '\n';
        else out += blankStrings ? ' ' : ch;
        i++;
      }
      out += q;
      i++;
      prevSig = q;
    } else if (c === '/' && /[(,=:[!&|?{};]/.test(prevSig || ';')) {
      // literal de expresión regular
      out += c;
      i++;
      let inClass = false;
      while (i < n && (src[i] !== '/' || inClass) && src[i] !== '\n') {
        if (src[i] === '\\') {
          out += blankStrings ? ' ' : (src[i] as string);
          i++;
        } else if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        out += blankStrings ? ' ' : (src[i] as string);
        i++;
      }
      out += '/';
      i++;
      prevSig = '/';
    } else {
      out += c;
      if (!/\s/.test(c)) prevSig = c;
      i++;
    }
  }
  return out;
}

interface ImportRef {
  spec: string;
  typeOnly: boolean;
  line: number;
}

/** Imports/re-exports/dinámicos de un fichero (sobre código sin comentarios). */
function importsOf(src: string): ImportRef[] {
  const code = strip(src, false);
  const out: ImportRef[] = [];
  const lineOf = (idx: number): number => code.slice(0, idx).split('\n').length;
  const patterns: Array<[RegExp, (m: RegExpExecArray) => boolean]> = [
    [/\b(import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s*)['"]([^'"]+)['"]/g, (m) => Boolean(m[2])],
    [/\bimport\s*['"]([^'"]+)['"]/g, () => false],
    [/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, () => false],
  ];
  for (const [re, typeOnly] of patterns) {
    for (let m = re.exec(code); m; m = re.exec(code)) {
      const spec = (m[3] ?? m[1]) as string;
      out.push({ spec, typeOnly: typeOnly(m), line: lineOf(m.index) });
    }
  }
  return out;
}

const read = (p: string): string => readFileSync(p, 'utf8');

/** Resuelve un import relativo a un fichero real del repo (o null). */
function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, join(base, 'index.ts'), join(base, 'index.js')]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const GAME_MODULES = ['world', 'player', 'weapons', 'enemies', 'missions', 'ui', 'audio', 'engine'] as const;
const PROVISIONAL_DIRS = ['engine', 'world', 'player', 'enemies', 'missions', 'ui', 'audio'] as const;

/** Módulos que siguen siendo el stub provisional (marcador PROVISIONAL o import de dev/stubs). */
function stubModules(): string[] {
  return PROVISIONAL_DIRS.filter((m) => {
    const files = listFiles(join(SRC, m), ['.ts']);
    return files.length === 0 || files.some((f) => /PROVISIONAL|dev\/stubs/.test(read(f)));
  });
}
const STUBS = stubModules();
const STRICT = process.env.QA_STRICT === '1' || (process.env.QA_STRICT !== '0' && STUBS.length === 0);

/** Primer segmento (módulo) de una ruta dentro de src/, o '' si cae fuera / es un fichero suelto. */
function moduleOf(abs: string): string {
  const r = relative(SRC, abs).split(sep);
  if (r[0] === '..' || r.length < 2) return '';
  return r[0] as string;
}

const SRC_FILES = listFiles(SRC, ['.ts']).filter((f) => !f.endsWith('.test.ts'));

// ─────────────────────────────────────────────────────────────────────────────
// (a) Fronteras de módulo
// ─────────────────────────────────────────────────────────────────────────────
/** Excepciones documentadas (mínimas). `while` = condición para que la excepción siga vigente. */
const BOUNDARY_ALLOW: Array<{ from: string; to: string; why: string }> = [
  { from: 'player', to: 'weapons', why: 'mismo dueño (jugador y armas): src/player y src/weapons forman un único módulo lógico' },
  { from: '*', to: 'engine/geometry', why: 'ARCHITECTURE.md permite «engine/geometry helpers» si existen (prefijo src/engine/geometry*)' },
];

describe('(a) fronteras de módulo', () => {
  it('ningún módulo de juego importa de otro módulo (sólo core/, config, rules/, three)', () => {
    const violations: string[] = [];
    for (const file of SRC_FILES) {
      const mod = moduleOf(file);
      if (!(GAME_MODULES as readonly string[]).includes(mod)) continue;
      const isStubReexport = /PROVISIONAL/.test(read(file)) && file.endsWith(`${sep}index.ts`);
      for (const imp of importsOf(read(file))) {
        if (!imp.spec.startsWith('.')) continue; // paquetes: three, three/addons…
        const target = resolveImport(file, imp.spec);
        const targetAbs = target ?? resolve(dirname(file), imp.spec);
        const tRel = relative(SRC, targetAbs).split(sep).join('/');
        const tMod = tRel.split('/')[0] as string;
        if (tMod === mod || tMod === 'core' || tRel === 'config' || tRel === 'config.ts' || tMod === 'rules') continue;
        if (tMod === 'dev' && isStubReexport) continue; // stub provisional: caduca al reemplazar el módulo
        if (BOUNDARY_ALLOW.some((a) => (a.from === '*' || a.from === mod) && (tRel === a.to || tRel.startsWith(a.to) || tMod === a.to))) continue;
        violations.push(`${rel(file)}:${imp.line} importa '${imp.spec}' (${tMod || tRel}) — ${mod} sólo puede usar core/, config, rules/ y three`);
      }
    }
    expect(violations, `\n${violations.join('\n')}\nExcepciones documentadas: ${BOUNDARY_ALLOW.map((a) => `${a.from}→${a.to}`).join(', ')}`).toEqual([]);
  });

  it('src/dev sólo se importa desde src/dev, dev/ y los stubs provisionales', () => {
    const bad: string[] = [];
    for (const file of SRC_FILES) {
      if (moduleOf(file) === 'dev' || moduleOf(file) === 'game' || file.endsWith('main.ts')) continue;
      const provisional = /PROVISIONAL/.test(read(file));
      for (const imp of importsOf(read(file))) {
        if (imp.spec.startsWith('.') && /(^|\/)dev(\/|$)/.test(imp.spec) && !provisional) bad.push(`${rel(file)}:${imp.line} → ${imp.spec}`);
      }
    }
    expect(bad, `\n${bad.join('\n')}`).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) core/ y rules/ puros
// ─────────────────────────────────────────────────────────────────────────────
const DOM_RE = /(?<![.\w$])(document|window|navigator|localStorage|sessionStorage|requestAnimationFrame|cancelAnimationFrame|HTMLElement|HTMLCanvasElement|AudioContext|OffscreenCanvas|getElementById|querySelector)\b/g;
/** core/input.ts ES el adaptador de DOM (teclado, ratón, pointer lock): excepción por diseño. */
const DOM_ALLOW = new Set(['src/core/input.ts']);

describe('(b) core/ y rules/ puros', () => {
  const pure = SRC_FILES.filter((f) => ['core', 'rules'].includes(moduleOf(f)));

  it('no importan three (salvo `import type` en core/context.ts)', () => {
    const bad: string[] = [];
    for (const f of pure) {
      for (const imp of importsOf(read(f))) {
        if (imp.spec !== 'three' && !imp.spec.startsWith('three/')) continue;
        if (rel(f) === 'src/core/context.ts' && imp.typeOnly) continue;
        bad.push(`${rel(f)}:${imp.line} importa '${imp.spec}'${imp.typeOnly ? ' (type)' : ''}`);
      }
    }
    expect(bad, `\n${bad.join('\n')}`).toEqual([]);
  });

  it('no tocan el DOM (salvo core/input.ts, el adaptador de entrada)', () => {
    const bad: string[] = [];
    for (const f of pure) {
      if (DOM_ALLOW.has(rel(f))) continue;
      const code = strip(read(f), true);
      for (const m of code.matchAll(DOM_RE)) bad.push(`${rel(f)}:${code.slice(0, m.index).split('\n').length} usa '${m[1]}'`);
    }
    expect(bad, `\n${bad.join('\n')}`).toEqual([]);
  });

  it('rules/ y core/ sólo importan config, core/ y rules/ (core no importa rules)', () => {
    const bad: string[] = [];
    for (const f of pure) {
      const mod = moduleOf(f);
      for (const imp of importsOf(read(f))) {
        if (!imp.spec.startsWith('.')) continue;
        const t = relative(SRC, resolve(dirname(f), imp.spec)).split(sep).join('/');
        const tMod = t.split('/')[0] as string;
        const ok = tMod === 'core' || t === 'config' || (mod === 'rules' && tMod === 'rules');
        if (!ok) bad.push(`${rel(f)}:${imp.line} → ${imp.spec}`);
      }
    }
    expect(bad, `\n${bad.join('\n')}`).toEqual([]);
  });

  it('INFO: rules/ evita Math.random / Date.now (pureza y repetibilidad)', () => {
    const hits: string[] = [];
    for (const f of pure.filter((x) => moduleOf(x) === 'rules')) {
      const code = strip(read(f), true);
      for (const m of code.matchAll(/Math\.random|Date\.now|performance\.now/g)) hits.push(`${rel(f)}:${code.slice(0, m.index).split('\n').length} ${m[0]}`);
    }
    if (hits.length) console.warn(`[qa.contract] rules/ no es determinista (usa un Rng inyectado, core/util createRng):\n  ${hits.join('\n  ')}`);
    expect(true).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) consola
// ─────────────────────────────────────────────────────────────────────────────
describe('(c) consola', () => {
  it('no hay console.log/debug/trace/dir/table ni debugger en src/', () => {
    const bad: string[] = [];
    for (const f of SRC_FILES) {
      const code = strip(read(f), true);
      for (const m of code.matchAll(/\bconsole\s*\.\s*(log|debug|trace|dir|table|group|groupEnd|time|timeEnd)\b|\bdebugger\b/g)) {
        bad.push(`${rel(f)}:${code.slice(0, m.index).split('\n').length} ${m[0].replace(/\s+/g, '')}`);
      }
    }
    expect(bad, `\n${bad.join('\n')}`).toEqual([]);
  });

  it('INFO: console.error/warn/info fuera de main.ts y src/dev deben estar justificados', () => {
    const hits: string[] = [];
    for (const f of SRC_FILES) {
      if (rel(f) === 'src/main.ts' || moduleOf(f) === 'dev') continue;
      const code = strip(read(f), true);
      for (const m of code.matchAll(/\bconsole\s*\.\s*(error|warn|info)\b/g)) hits.push(`${rel(f)}:${code.slice(0, m.index).split('\n').length} console.${m[1]}`);
    }
    if (hits.length) console.warn(`[qa.contract] ${hits.length} uso(s) de console.error/warn/info (revisar que sean justificados):\n  ${hits.join('\n  ')}`);
    expect(true).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) invariantes de config
// ─────────────────────────────────────────────────────────────────────────────
const sum = (o: Record<string, number | undefined>): number => Object.values(o).reduce<number>((a, v) => a + (v ?? 0), 0);
const inRect = (r: Rect, x: number, z: number): boolean => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
const positive = (v: number): boolean => Number.isFinite(v) && v > 0;
const VALID_TYPES = ['walker', 'runner', 'brute', 'spitter'] as const;

describe('(d) invariantes de config', () => {
  it('pesos ≥ 0 con suma > 0 (SPAWN_MIX, HORDES, LOOT.weights)', () => {
    for (const [k, mix] of Object.entries(SPAWN_MIX)) {
      expect(Object.values(mix).every((w) => (w ?? 0) >= 0), `SPAWN_MIX[${k}]`).toBe(true);
      expect(sum(mix), `SPAWN_MIX[${k}] suma`).toBeGreaterThan(0);
    }
    for (const [k, h] of Object.entries(HORDES)) {
      expect(Object.values(h.mix).every((w) => (w ?? 0) >= 0), `HORDES.${k}`).toBe(true);
      expect(sum(h.mix), `HORDES.${k} suma`).toBeGreaterThan(0);
    }
    for (const t of [1, 2, 3, 4]) {
      const w = LOOT.weights[t];
      expect(w, `LOOT.weights[${t}]`).toBeDefined();
      if (w) {
        expect(Object.values(w).every((v) => v >= 0)).toBe(true);
        expect(sum(w)).toBeGreaterThan(0);
        expect(Object.keys(w).sort()).toEqual(['ammo', 'cash', 'grenade', 'medkit', 'plate']);
      }
    }
  });

  it('precios y recompensas > 0', () => {
    for (const v of Object.values(SHOP)) for (const it of v.items) expect(positive(it.price), `precio de ${it.id}`).toBe(true);
    for (const m of Object.values(MISSIONS)) expect(positive(m.reward), `recompensa ${m.id}`).toBe(true);
    for (const e of Object.values(ENEMIES)) expect(positive(e.bounty), `bounty ${e.type}`).toBe(true);
    expect(PLAYER.start.money).toBeGreaterThanOrEqual(0);
    expect(positive(ECONOMY.bountyRounding)).toBe(true);
    expect(LOOT.cash[0]).toBeLessThan(LOOT.cash[1]);
  });

  it('WEAPONS coherentes', () => {
    for (const [id, w] of Object.entries(WEAPONS)) {
      const at = `WEAPONS.${id}`;
      expect(w.id, at).toBe(id);
      expect(w.rpm, `${at}.rpm`).toBeGreaterThan(0);
      expect(w.magSize, `${at}.magSize`).toBeGreaterThan(0);
      expect(w.damage, `${at}.damage`).toBeGreaterThan(0);
      expect(w.pellets, `${at}.pellets`).toBeGreaterThanOrEqual(1);
      expect(w.reserveMax, `${at}.reserveMax`).toBeGreaterThanOrEqual(w.magSize);
      expect(w.falloffStart, `${at}.falloff`).toBeLessThan(w.falloffEnd);
      expect(w.minDamageMult > 0 && w.minDamageMult <= 1, `${at}.minDamageMult ∈ (0,1]`).toBe(true);
      expect(w.adsFovMult > 0 && w.adsFovMult <= 1, `${at}.adsFovMult ∈ (0,1]`).toBe(true);
      expect(w.reloadS, `${at}.reloadS`).toBeGreaterThan(0);
      if (w.reloadTacticalS !== undefined) expect(w.reloadTacticalS, `${at}.reloadTacticalS ≤ reloadS`).toBeLessThanOrEqual(w.reloadS);
      if (w.fireMode === 'pump') expect(w.reloadPerShellS, `${at} pump necesita reloadPerShellS`).toBeGreaterThan(0);
      expect(w.spreadAds, `${at}.spreadAds ≤ spreadHip`).toBeLessThanOrEqual(w.spreadHip);
      expect(w.spreadMax, `${at}.spreadMax ≥ spreadHip`).toBeGreaterThanOrEqual(w.spreadHip);
      expect(w.noise).toBeGreaterThan(0);
      expect(w.moveSpeedMult > 0 && w.moveSpeedMult <= 1.5).toBe(true);
      expect([0, 1]).toContain(w.slot);
    }
    expect(WEAPONS[STARTING_LOADOUT.slot0].slot).toBe(0);
    expect(WEAPONS[STARTING_LOADOUT.slot1].slot).toBe(1);
  });

  it('SHOP: 6 artículos por vendedor, ids únicos, campos coherentes', () => {
    for (const [vendor, v] of Object.entries(SHOP)) {
      expect(v.items, vendor).toHaveLength(6);
      expect(new Set(v.items.map((i) => i.id)).size, `${vendor} ids únicos`).toBe(6);
      for (const it of v.items) {
        expect(Boolean(it.weapon), `${it.id}: weapon sólo si kind='weapon'`).toBe(it.kind === 'weapon');
        if (it.weapon) {
          expect(WEAPONS[it.weapon]).toBeDefined();
          const principal = /Principal/.test(it.desc);
          expect(WEAPONS[it.weapon].slot === 0, `${it.id}: la descripción (${it.desc}) contradice la ranura`).toBe(principal);
        }
        if (['grenade', 'plate', 'medkit'].includes(it.kind)) expect(it.amount ?? 0, `${it.id}.amount`).toBeGreaterThan(0);
      }
    }
  });

  it('THREAT_SCALE monótono no decreciente y positivo', () => {
    for (const [k, arr] of Object.entries(THREAT_SCALE)) {
      expect(arr, k).toHaveLength(5);
      for (let i = 1; i < arr.length; i++) {
        expect(arr[i] as number, `${k}[${i}]`).toBeGreaterThan(0);
        if (i > 1) expect(arr[i] as number, `${k}[${i}] ≥ ${k}[${i - 1}]`).toBeGreaterThanOrEqual(arr[i - 1] as number);
      }
    }
  });

  it('SPAWN_MIX y HORDES: sólo tipos válidos y respetando minThreat', () => {
    expect(Object.keys(SPAWN_MIX).map(Number).sort()).toEqual([1, 2, 3, 4]);
    for (const [threat, mix] of Object.entries(SPAWN_MIX)) {
      for (const [type, w] of Object.entries(mix)) {
        expect((VALID_TYPES as readonly string[]).includes(type), `SPAWN_MIX[${threat}] tipo inválido ${type}`).toBe(true);
        if ((w ?? 0) > 0) expect(ENEMIES[type as (typeof VALID_TYPES)[number]].minThreat, `${type} en amenaza ${threat}`).toBeLessThanOrEqual(Number(threat));
      }
    }
    for (const [id, h] of Object.entries(HORDES)) {
      for (const [type, w] of Object.entries(h.mix)) {
        expect((VALID_TYPES as readonly string[]).includes(type), `HORDES.${id} tipo inválido ${type}`).toBe(true);
        if ((w ?? 0) > 0) expect(ENEMIES[type as (typeof VALID_TYPES)[number]].minThreat, `${type} en horda ${id}`).toBeLessThanOrEqual(h.threat);
      }
    }
  });

  it('HORDES / DIRECTOR / TIMERS con valores positivos y coherentes', () => {
    for (const [id, h] of Object.entries(HORDES)) {
      for (const v of [h.firstWaveDelayS, h.spawnRingMin, h.spawnRingMax, h.maxAlive, ...h.waveIntervalS, ...h.waveSize]) expect(positive(v), `HORDES.${id}`).toBe(true);
      expect(h.spawnRingMin, `${id}.ring`).toBeLessThan(h.spawnRingMax);
      expect(h.waveSize[0], `${id}.waveSize`).toBeLessThanOrEqual(h.waveSize[1]);
      expect(h.maxAlive, `${id}.maxAlive ≤ DIRECTOR.maxAlive`).toBeLessThanOrEqual(DIRECTOR.maxAlive);
      expect(h.spawnRingMax, `${id}: el anillo debe caer dentro de simRadius`).toBeLessThan(DIRECTOR.simRadius);
      expect(h.threat >= 1 && h.threat <= 4).toBe(true);
    }
    for (const v of [DIRECTOR.maxAlive, DIRECTOR.simRadius, DIRECTOR.noSpawnRadius, DIRECTOR.refillIntervalS, DIRECTOR.loseTargetS, DIRECTOR.spawnGraceS, ...DIRECTOR.packSize, ...Object.values(DIRECTOR.ambientTarget)]) {
      expect(positive(v), 'DIRECTOR').toBe(true);
    }
    expect(DIRECTOR.noSpawnRadius).toBeLessThan(DIRECTOR.simRadius);
    expect(DIRECTOR.packSize[0]).toBeLessThanOrEqual(DIRECTOR.packSize[1]);
    expect(Object.keys(DIRECTOR.ambientTarget).sort()).toEqual([...ZONE_IDS].sort());
    for (const v of [TIMERS.contaminationStartS, TIMERS.sealS, TIMERS.endScreenDelayS, ...TIMERS.warnings]) expect(positive(v), 'TIMERS').toBe(true);
    expect(TIMERS.sealS).toBeGreaterThan(TIMERS.contaminationStartS);
    expect([...TIMERS.warnings]).toEqual([...TIMERS.warnings].sort((a, b) => b - a));
    expect(Math.max(...TIMERS.warnings)).toBeLessThan(TIMERS.contaminationStartS);
    expect(CONTAMINATION.endRadius).toBeGreaterThan(CONTAMINATION.startRadius);
    expect(CONTAMINATION.dpsMax).toBeGreaterThanOrEqual(CONTAMINATION.dpsEdge);
    for (const m of [MISSIONS.relay, MISSIONS.extraction]) expect(m.reward).toBeGreaterThan(0);
    expect(MISSIONS.extraction.boardHoldS).toBeLessThan(MISSIONS.extraction.boardWindowS);
    expect(MISSIONS.relay.decayPerS).toBeGreaterThanOrEqual(0);
    expect(ECONOMY.shopRange, 'la tienda no debe cerrarse nada más abrirla').toBeGreaterThanOrEqual(PLAYER.interactReach);
  });

  it('la contaminación no alcanza el LZ, la armería ni el spawn', () => {
    const c = CONTAMINATION.center;
    for (const [name, p] of [['LZ', MAP.lz.center], ['radio del LZ', MAP.lz.radio], ['armería', MAP.armory], ['spawn', MAP.spawn]] as const) {
      expect(Math.hypot(p.x - c.x, p.z - c.z), `${name} vs endRadius`).toBeGreaterThan(CONTAMINATION.endRadius);
    }
  });

  it('ENEMIES / WARDEN / PLAYER / RENDER coherentes', () => {
    for (const [k, e] of Object.entries(ENEMIES)) {
      expect(e.type).toBe(k);
      for (const v of [e.hp, e.speed, e.radius, e.height, e.damage, e.attackRange, e.attackCooldownS, e.sightRange]) expect(positive(v), `ENEMIES.${k}`).toBe(true);
      expect(e.headMult).toBeGreaterThanOrEqual(e.bodyMult);
      expect(e.minThreat >= 1 && e.minThreat <= 4).toBe(true);
      expect(e.staggerChance >= 0 && e.staggerChance <= 1).toBe(true);
    }
    expect(ENEMIES.runner.speed).toBeGreaterThan(ENEMIES.walker.speed);
    expect(WARDEN.hp).toBeGreaterThan(0);
    expect(WARDEN.helmetHp).toBeGreaterThan(0);
    expect(WARDEN.headMultAfterHelmet).toBeGreaterThan(1);
    expect(WARDEN.bodyMult).toBeLessThan(1);
    expect(WARDEN.summonAtHpFractions.every((f) => f > 0 && f < 1)).toBe(true);
    expect(PLAYER.cap.platesPack).toBeGreaterThan(PLAYER.cap.plates);
    expect(PLAYER.start.plates).toBeLessThanOrEqual(PLAYER.cap.plates);
    expect(PLAYER.start.grenades).toBeLessThanOrEqual(PLAYER.cap.grenades);
    expect(PLAYER.crouchEyeHeight).toBeLessThan(PLAYER.eyeHeight);
    expect(PLAYER.sprintSpeed).toBeGreaterThan(PLAYER.walkSpeed);
    expect(PLAYER.walkSpeed).toBeGreaterThan(PLAYER.crouchSpeed);
    expect(PLAYER.armorAbsorb > 0 && PLAYER.armorAbsorb <= 1).toBe(true);
    const q = RENDER.presets;
    expect(q.low.viewDistance).toBeLessThan(q.medium.viewDistance);
    expect(q.medium.viewDistance).toBeLessThan(q.high.viewDistance);
    expect(q.low.particles).toBeLessThanOrEqual(q.high.particles);
    expect(q[RENDER.defaultQuality]).toBeDefined();
    expect(RENDER.budget.drawCalls).toBeGreaterThan(0);
    expect(RENDER.budget.triangles).toBeGreaterThan(0);
  });

  it('INFO: probabilidad de botín base × dropChance por amenaza no supera 1', () => {
    const over: string[] = [];
    for (const [type, p] of Object.entries(LOOT.dropChance)) {
      expect(p >= 0 && p <= 1, `dropChance.${type}`).toBe(true);
      for (let t = 1; t <= 4; t++) {
        const eff = p * (THREAT_SCALE.dropChance[t] as number);
        if (eff > 1) over.push(`${type}@amenaza${t}=${eff.toFixed(3)}`);
      }
    }
    if (over.length) console.warn(`[qa.contract] probabilidad efectiva de botín > 1 (se satura, la escala de amenaza no aporta): ${over.join(', ')}`);
    expect(true).toBe(true);
  });

  it('mapa: jaulas y POIs dentro de MAP.bounds y en la zona declarada', () => {
    const pois: Array<[string, { x: number; z: number }]> = [
      ['spawn', MAP.spawn], ['lz.center', MAP.lz.center], ['lz.radio', MAP.lz.radio], ['armería', MAP.armory], ['relé', MAP.relay],
      ['complejo', MAP.complex.center], ['puerta', MAP.complex.gate], ['wardenSpawn', MAP.complex.wardenSpawn],
      ...MAP.cages.map((c): [string, { x: number; z: number }] => [c.id, c]),
    ];
    for (const [name, p] of pois) expect(inRect(MAP.bounds, p.x, p.z), `${name} dentro de bounds`).toBe(true);
    expect(new Set(MAP.cages.map((c) => c.id)).size).toBe(MAP.cages.length);
    expect(MAP.cages.map((c) => c.zone).sort()).toEqual([...ZONE_IDS].sort());
    for (const c of MAP.cages) expect(zoneAt(c.x, c.z), `zona de ${c.id}`).toBe(c.zone);
    expect(zoneAt(MAP.spawn.x, MAP.spawn.z)).toBe('perimeter');
    expect(zoneAt(MAP.armory.x, MAP.armory.z)).toBe('perimeter');
    expect(zoneAt(MAP.lz.center.x, MAP.lz.center.z)).toBe('perimeter');
    expect(zoneAt(MAP.lz.radio.x, MAP.lz.radio.z)).toBe('perimeter');
    expect(zoneAt(MAP.relay.x, MAP.relay.z)).toBe('refinery');
    expect(zoneAt(MAP.complex.center.x, MAP.complex.center.z)).toBe('complex');
    expect(zoneAt(MAP.complex.wardenSpawn.x, MAP.complex.wardenSpawn.z)).toBe('complex');
    const r = MAP.relay.circleRadius;
    for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) expect(zoneAt(MAP.relay.x + dx, MAP.relay.z + dz), 'círculo del relé en una sola zona').toBe('refinery');
    expect(MAP.complex.gate.width).toBeGreaterThan(0);
    // el LZ no debe solaparse con el spawn ni con la armería
    expect(Math.hypot(MAP.spawn.x - MAP.lz.center.x, MAP.spawn.z - MAP.lz.center.z)).toBeGreaterThan(MAP.lz.padRadius);
    expect(Math.hypot(MAP.lz.radio.x - MAP.lz.center.x, MAP.lz.radio.z - MAP.lz.center.z), 'la radio está junto al LZ').toBeLessThan(MAP.lz.padRadius * 3);
  });

  it('zonas: cubren todo MAP.bounds, ids únicos y amenaza creciente hacia el norte', () => {
    const ids = MAP.zones.map((z) => z.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...ZONE_IDS].sort());
    for (let x = MAP.bounds.minX; x <= MAP.bounds.maxX; x += 5) {
      for (let z = MAP.bounds.minZ; z <= MAP.bounds.maxZ; z += 5) {
        expect(MAP.zones.some((zn) => inRect(zn.rect, x, z)), `(${x}, ${z}) sin zona`).toBe(true);
      }
    }
    const bySouth = [...MAP.zones].sort((a, b) => b.rect.maxZ - a.rect.maxZ);
    for (let i = 1; i < bySouth.length; i++) expect((bySouth[i] as (typeof bySouth)[number]).threat).toBeGreaterThan((bySouth[i - 1] as (typeof bySouth)[number]).threat);
    for (const id of ZONE_IDS) expect(THEME.zoneColors[id]).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (e) cobertura de eventos
// ─────────────────────────────────────────────────────────────────────────────
/** Eventos que pueden no emitirse/escucharse en src/ (justificar SIEMPRE). */
const EVENT_ALLOW: Array<{ event: string; why: string }> = [];

describe('(e) cobertura de eventos de GameEvents', () => {
  const eventsSrc = read(join(SRC, 'core', 'events.ts'));
  const body = /export interface GameEvents \{([\s\S]*?)\n\}/.exec(eventsSrc)?.[1] ?? '';
  const declared = [...body.matchAll(/^\s*'([a-z]+:[A-Za-z]+)'\s*:/gm)].map((m) => m[1] as string);

  it('se parsea el catálogo de eventos', () => {
    expect(declared.length).toBeGreaterThan(50);
    expect(new Set(declared).size).toBe(declared.length);
  });

  const emitted = new Map<string, string[]>();
  const listened = new Map<string, string[]>();
  for (const f of SRC_FILES) {
    if (rel(f) === 'src/core/events.ts') continue;
    const code = strip(read(f), false);
    for (const m of code.matchAll(/\.\s*(emit|on|once|off)\s*(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]/g)) {
      const map = m[1] === 'emit' ? emitted : listened;
      const list = map.get(m[2] as string) ?? [];
      list.push(rel(f));
      map.set(m[2] as string, list);
    }
  }

  it('todo evento usado en el código existe en GameEvents (sin typos)', () => {
    const unknown = [...emitted.keys(), ...listened.keys()].filter((e) => e.includes(':') && !declared.includes(e));
    expect(unknown, `eventos no declarados: ${unknown.join(', ')}`).toEqual([]);
  });

  it(`cada evento se emite o se escucha en src/ (${STRICT ? 'ESTRICTO' : 'informativo'})`, () => {
    const allowed = new Set(EVENT_ALLOW.map((a) => a.event));
    const neither = declared.filter((e) => !emitted.has(e) && !listened.has(e) && !allowed.has(e));
    const deadListener = declared.filter((e) => listened.has(e) && !emitted.has(e) && !allowed.has(e));
    const noListener = declared.filter((e) => emitted.has(e) && !listened.has(e));
    if (noListener.length) console.info(`[qa.contract] emitidos sin oyente (info): ${noListener.join(', ')}`);
    if (deadListener.length) console.warn(`[qa.contract] eventos ESCUCHADOS pero nunca emitidos (¿oyente muerto o typo de emisor?): ${deadListener.join(', ')}`);
    if (neither.length) console.warn(`[qa.contract] eventos sin emisor ni oyente: ${neither.join(', ')}`);
    if (!STRICT) {
      console.warn(`[qa.contract] (e) en modo INFORMATIVO: módulos stub = ${STUBS.join(', ') || 'ninguno'}. Para endurecer: QA_STRICT=1 pnpm test (se endurece solo cuando no queda ningún PROVISIONAL en src/).`);
      expect(true).toBe(true);
      return;
    }
    expect({ neither, deadListener }).toEqual({ neither: [], deadListener: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (f) ficheros huérfanos
// ─────────────────────────────────────────────────────────────────────────────
const ORPHAN_ALLOW: Array<{ file: string; why: string }> = [];

describe('(f) ficheros huérfanos en src/', () => {
  it(`todo fichero de src/ es alcanzable desde main.ts, dev/*.ts o tests (${STRICT ? 'ESTRICTO' : 'informativo'})`, () => {
    const entries = [
      join(SRC, 'main.ts'),
      ...listFiles(join(ROOT, 'dev'), ['.ts']),
      ...listFiles(join(ROOT, 'tests'), ['.ts']),
      ...listFiles(SRC, ['.test.ts']),
      join(ROOT, 'vite.config.ts'),
    ].filter(existsSync);
    // scripts de <script src> en index.html y dev/*.html
    for (const html of [join(ROOT, 'index.html'), ...listFiles(join(ROOT, 'dev'), ['.html'])]) {
      for (const m of read(html).matchAll(/<script[^>]*\ssrc="([^"]+\.(?:ts|js))"/g)) {
        const target = (m[1] as string).startsWith('/') ? join(ROOT, m[1] as string) : resolve(dirname(html), m[1] as string);
        if (existsSync(target)) entries.push(target);
      }
    }
    const seen = new Set<string>();
    const queue = [...entries];
    while (queue.length) {
      const f = queue.pop() as string;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const imp of importsOf(read(f))) {
        const t = resolveImport(f, imp.spec);
        if (t && t.endsWith('.ts')) queue.push(t);
      }
    }
    const allowed = new Set(ORPHAN_ALLOW.map((a) => a.file));
    const orphans = SRC_FILES.filter((f) => !seen.has(f) && !allowed.has(rel(f))).map(rel);
    if (orphans.length) console.warn(`[qa.contract] ficheros huérfanos en src/ (${orphans.length}): ${orphans.join(', ')}`);
    if (!STRICT) {
      if (orphans.length) console.warn('[qa.contract] (f) en modo INFORMATIVO hasta integrar los módulos (QA_STRICT=1 lo endurece).');
      expect(true).toBe(true);
      return;
    }
    expect(orphans).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (g) todo se genera por código: sin assets ni red
// ─────────────────────────────────────────────────────────────────────────────
describe('(g) sin assets descargados ni red', () => {
  const ASSET = /\.(png|jpe?g|gif|webp|mp3|ogg|wav|flac|glb|gltf|hdr|exr|ktx2|woff2?|ttf|otf)(?=['"`?#])/i;
  const LOADERS = /\b(fetch|XMLHttpRequest|TextureLoader|GLTFLoader|AudioLoader|FileLoader|ImageLoader|RGBELoader|EXRLoader|FontLoader|WebSocket)\b/;
  it('src/ no referencia ficheros de assets, URLs externas ni loaders de red', () => {
    const bad: string[] = [];
    for (const f of SRC_FILES) {
      const withStrings = strip(read(f), false);
      const noStrings = strip(read(f), true);
      const lines = withStrings.split('\n');
      lines.forEach((ln, i) => {
        if (ASSET.test(ln)) bad.push(`${rel(f)}:${i + 1} asset: ${ln.trim().slice(0, 90)}`);
        const url = /['"`]https?:\/\/(?!www\.w3\.org)[^'"`]+/.exec(ln);
        if (url) bad.push(`${rel(f)}:${i + 1} URL externa: ${url[0].slice(0, 80)}`);
      });
      noStrings.split('\n').forEach((ln, i) => {
        const m = LOADERS.exec(ln);
        if (m) bad.push(`${rel(f)}:${i + 1} usa ${m[1]}`);
      });
    }
    expect(bad, `\n${bad.join('\n')}`).toEqual([]);
  });
  it('index.html no carga recursos externos', () => {
    const html = read(join(ROOT, 'index.html'));
    const ext = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    expect(ext).toEqual([]);
  });
});
