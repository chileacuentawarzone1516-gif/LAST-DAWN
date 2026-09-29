#!/usr/bin/env node
/**
 * Optimiza los modelos de personaje (assets-src/characters/*.glb → public/models/characters/):
 *   · geometría: cuantizada + comprimida con meshopt (EXT_meshopt_compression);
 *   · texturas: recodificadas a WebP (EXT_texture_webp) y, en la variante «low», reducidas;
 *   · variante «low» (móviles / calidad baja): mallas simplificadas con meshopt, EXCEPTO las del rostro
 *     (Body —cara incluida—, Brows, Eye): simplificarlas deformaba boca, nariz y párpados.
 * Conserva nombres de nodos, materiales y esqueleto (el juego los usa por nombre).
 *
 * Uso: node tools/optimize-characters.mjs [--variants=high,low] [--high-tex=2048] [--low-tex=1024] [--low-ratio=0.5]
 * Requiere Chromium (se usa su codificador WebP; ver scripts/qa/lib.mjs, CHROME_PATH).
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { meshopt, quantize, simplifyPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { launchBrowser, parseArgs, ROOT } from '../scripts/qa/lib.mjs';

const args = parseArgs();
const HIGH_TEX = Number(args['high-tex'] ?? 2048);
const LOW_TEX = Number(args['low-tex'] ?? 1024);
const LOW_RATIO = Number(args['low-ratio'] ?? 0.5);
const WEBP_Q = Number(args['webp-q'] ?? 0.95);
const VARIANTS = String(args.variants ?? 'high,low').split(',').filter((v) => v === 'high' || v === 'low');
/** Piezas que definen el rostro: nunca se simplifican (ver cabecera). */
const PRESERVE = /^LD_[MF]_(Body|Brows|Eye)/;
const SRC = join(ROOT, 'assets-src', 'characters');
const OUT = join(ROOT, 'public', 'models', 'characters');

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const browser = await launchBrowser();
const page = await browser.newPage();
await page.goto('about:blank');

/** Recodifica una imagen (PNG/JPEG) a WebP con el tamaño máximo pedido, usando el navegador. */
async function toWebp(bytes, maxSize, mime) {
  const b64 = Buffer.from(bytes).toString('base64');
  const r = await page.evaluate(async ([b64, maxSize, mime, q]) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bin], { type: mime }));
    const k = Math.min(1, maxSize / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, w, h);
    const blob = await c.convertToBlob({ type: 'image/webp', quality: q });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { b64: btoa(s), w, h, from: [bmp.width, bmp.height] };
  }, [b64, maxSize, mime, WEBP_Q]);
  return { bytes: new Uint8Array(Buffer.from(r.b64, 'base64')), w: r.w, h: r.h, from: r.from };
}

function countTriangles(doc) {
  let t = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  return Math.round(t);
}

/** Simplifica todas las primitivas salvo las de las piezas del rostro (PRESERVE). */
async function simplifyExceptFace(doc) {
  await doc.transform(weld({ overwrite: false }));
  const opts = { simplifier: MeshoptSimplifier, ratio: LOW_RATIO, error: 0.005, lockBorder: true };
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || PRESERVE.test(node.getName())) continue;
    for (const prim of mesh.listPrimitives()) simplifyPrimitive(prim, opts);
  }
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const files = readdirSync(SRC).filter((f) => f.endsWith('.glb'));
for (const file of files) {
  for (const variant of VARIANTS) {
    const doc = await io.read(join(SRC, file));
    const before = statSync(join(SRC, file)).size;
    const trisBefore = countTriangles(doc);
    const maxTex = variant === 'high' ? HIGH_TEX : LOW_TEX;
    const log = [];
    // Texturas → WebP
    doc.createExtension(EXTTextureWebP).setRequired(true);
    for (const tex of doc.getRoot().listTextures()) {
      const img = tex.getImage();
      if (!img) continue;
      const r = await toWebp(img, maxTex, tex.getMimeType() || 'image/png');
      log.push(`${tex.getName() || tex.getURI() || 'tex'} ${r.from.join('×')}→${r.w}×${r.h} ${kb(img.byteLength)}→${kb(r.bytes.byteLength)}`);
      tex.setImage(r.bytes).setMimeType('image/webp');
    }
    // Geometría
    const steps = [];
    if (variant === 'low') steps.push(simplifyExceptFace);
    steps.push(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }));
    steps.push(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
    await doc.transform(...steps);
    const outName = variant === 'high' ? file : file.replace('.glb', '_low.glb');
    const glb = await io.writeBinary(doc);
    writeFileSync(join(OUT, outName), glb);
    console.log(`${outName}: ${kb(before)} → ${kb(glb.byteLength)} (${((glb.byteLength / before) * 100).toFixed(0)} %) · triángulos ${trisBefore} → ${countTriangles(doc)}`);
    for (const l of log) console.log(`   textura ${l}`);
  }
}
await browser.close();
