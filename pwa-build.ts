/**
 * Funzioni pure usate da vite.config.ts in fase di build per la PWA.
 * Nessun accesso a file, rete o processi: i dati arrivano dal chiamante (testabili).
 */

export interface BuildIdSources {
  /** Variabile BUILD_ID esplicita (ha la precedenza). */
  readonly override?: string | undefined;
  /** GITHUB_SHA nella GitHub Action di deploy. */
  readonly githubSha?: string | undefined;
  /** `git rev-parse HEAD` locale (null se git non è disponibile). */
  readonly gitSha?: string | null | undefined;
  /** true se l'albero di lavoro ha modifiche non committate. */
  readonly dirty?: boolean | undefined;
  /** Impronta del contenuto dei sorgenti, per distinguere build locali non committate. */
  readonly contentHash: string;
}

const SAFE = /[^A-Za-z0-9._-]/g;

/**
 * BUILD_ID univoco generato a build-time: SHA del commit (7 caratteri) in CI e per build
 * pulite; per build locali con modifiche non committate SHA + impronta dei sorgenti.
 * Mai Date.now().
 */
export function resolveBuildId(sources: BuildIdSources): string {
  const override = sources.override?.trim();
  if (override) return override.replace(SAFE, '').slice(0, 40);
  const sha = (sources.githubSha ?? sources.gitSha ?? '').trim().slice(0, 7);
  if (!sha) return `src-${sources.contentHash.slice(0, 10)}`;
  return sources.dirty ? `${sha}-dev.${sources.contentHash.slice(0, 6)}` : sha;
}

/** Sostituisce i segnaposto del template del service worker. */
export function renderServiceWorker(template: string, precache: readonly string[], cacheVersion: string, buildId: string): string {
  const source = template
    .replace('[/* __PRECACHE_MANIFEST__ */]', JSON.stringify(precache))
    .replace('__CACHE_VERSION__', cacheVersion)
    .replace('__BUILD_ID__', buildId);
  if (/__(PRECACHE_MANIFEST|CACHE_VERSION|BUILD_ID)__/.test(source)) {
    throw new Error('Segnaposto del service worker non sostituiti.');
  }
  return source;
}

/** version.json: l'unica risorsa che dice quale build è pubblicata in questo momento. */
export function versionManifest(version: string, buildId: string): string {
  return `${JSON.stringify({ version, buildId })}\n`;
}
