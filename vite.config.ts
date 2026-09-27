/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** File di /public che fanno parte dell'application shell. */
const PUBLIC_SHELL_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

/**
 * Genera dist/sw.js a partire da src/pwa/sw.js, inserendo l'elenco
 * dei file prodotti dalla build (solo application shell, stessa origine).
 * Nessuna richiesta meteorologica viene mai messa in cache.
 */
function serviceWorkerPlugin(): Plugin {
  const templatePath = fileURLToPath(new URL('./src/pwa/sw.js', import.meta.url));
  return {
    name: 'meteo-lab-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((fileName) => !fileName.endsWith('.map'))
        .filter((fileName) => fileName !== 'index.html');
      const precache = [...PUBLIC_SHELL_FILES, ...assets].sort();
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync(templatePath, 'utf8')
        .replace('[/* __PRECACHE_MANIFEST__ */]', JSON.stringify(precache))
        .replace('__CACHE_VERSION__', version);
      if (source.includes('__PRECACHE_MANIFEST__') || source.includes('__CACHE_VERSION__')) {
        this.error('Segnaposto del service worker non sostituiti.');
      }
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), serviceWorkerPlugin()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // MapLibre GL è una libreria di grandi dimensioni; viene caricata in un chunk separato.
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
