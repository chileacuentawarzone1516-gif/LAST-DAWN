import { defineConfig } from 'vitest/config';

// Sólo index.html entra en el build de producción. Las páginas de dev/ son
// herramientas de desarrollo (vite dev / vite preview de cada módulo).
export default defineConfig({
  server: { host: true, port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    passWithNoTests: false,
  },
});
