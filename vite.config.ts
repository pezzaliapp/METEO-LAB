/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { renderServiceWorker, resolveBuildId, versionManifest } from './pwa-build';

/** File di /public che fanno parte dell'application shell. */
const PUBLIC_SHELL_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

const ROOT = fileURLToPath(new URL('.', import.meta.url));

function git(command: string): string | null {
  try {
    return execSync(`git ${command}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

/** Impronta deterministica dei sorgenti (per build locali non committate). */
function sourceFingerprint(): string {
  const hash = createHash('sha256');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(ROOT, dir)).sort()) {
      const rel = join(dir, name);
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else files.push(rel);
    }
  };
  walk('src');
  walk('public');
  files.push('index.html', 'package.json', 'vite.config.ts', 'pwa-build.ts');
  for (const file of files) hash.update(file).update(readFileSync(join(ROOT, file)));
  return hash.digest('hex');
}

/** BUILD_ID generato a build-time (SHA del commit), mai a runtime. */
const BUILD_ID = resolveBuildId({
  override: process.env.BUILD_ID,
  githubSha: process.env.GITHUB_SHA,
  gitSha: git('rev-parse HEAD'),
  dirty: (git('status --porcelain') ?? '') !== '',
  contentHash: sourceFingerprint(),
});

/**
 * Genera dist/sw.js a partire da src/pwa/sw.js, inserendo l'elenco
 * dei file prodotti dalla build (solo application shell, stessa origine) e il BUILD_ID,
 * e dist/version.json con la build pubblicata (letta dall'app per scoprire gli aggiornamenti).
 * Nessuna richiesta meteorologica viene mai messa in cache.
 */
function serviceWorkerPlugin(version: string): Plugin {
  const templatePath = fileURLToPath(new URL('./src/pwa/sw.js', import.meta.url));
  return {
    name: 'meteo-lab-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((fileName) => !fileName.endsWith('.map'))
        .filter((fileName) => fileName !== 'index.html');
      const precache = [...PUBLIC_SHELL_FILES, ...assets].sort();
      // La cache dipende dal contenuto della shell e dalla build: ogni deploy ha la sua.
      const cacheVersion = `${BUILD_ID}-${createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 8)}`;
      try {
        const source = renderServiceWorker(readFileSync(templatePath, 'utf8'), precache, cacheVersion, BUILD_ID);
        this.emitFile({ type: 'asset', fileName: 'sw.js', source });
      } catch (error) {
        this.error(error instanceof Error ? error.message : String(error));
      }
      this.emitFile({ type: 'asset', fileName: 'version.json', source: versionManifest(version, BUILD_ID) });
    },
  };
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Base path di pubblicazione. GitHub Pages serve il progetto sotto /METEO-LAB/;
 * build e anteprima (npm run preview) lo usano; in sviluppo (npm run dev) l'app resta
 * alla radice. Sovrascrivibile con BASE_PATH.
 */
const PRODUCTION_BASE = process.env.BASE_PATH ?? '/METEO-LAB/';

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? PRODUCTION_BASE : '/',
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), serviceWorkerPlugin(pkg.version)],
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
}));
