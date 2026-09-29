/**
 * Cabeceras HTTP de producción — ÚNICA fuente: vite.config.ts las emite como `dist/_headers`
 * (Netlify/Cloudflare Pages) y `vite preview` las aplica, de modo que el QA prueba lo mismo que se publica.
 *
 * CSP: sólo recursos propios. Excepciones justificadas:
 *  - script-src 'wasm-unsafe-eval': el decodificador meshopt de los modelos GLB es WebAssembly (sin `eval` de JS).
 *  - style-src 'unsafe-inline': la UI aplica estilos en línea desde código (nunca contenido de usuario).
 *  - img-src/connect-src blob: y data:: three.js decodifica texturas de los GLB mediante blobs.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/** Contenido de `_headers` (formato Netlify): seguridad en todo + estrategia de caché por ruta. */
export function renderHeadersFile(): string {
  const lines: string[] = ['/*'];
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) lines.push(`  ${k}: ${v}`);
  lines.push(
    '',
    '# Ficheros con hash en el nombre: caché de un año.',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
    '# Modelos (sin hash): una semana y revalidación.',
    '/models/*',
    '  Cache-Control: public, max-age=604800, stale-while-revalidate=86400',
    '',
    '# La página y el manifiesto siempre se revalidan.',
    '/index.html',
    '  Cache-Control: no-cache',
    '/manifest.webmanifest',
    '  Cache-Control: no-cache',
    '',
  );
  return lines.join('\n');
}
