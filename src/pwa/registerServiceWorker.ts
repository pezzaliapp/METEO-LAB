import { PwaUpdater } from './updater';

/**
 * Registra il service worker (solo nella build di produzione) e avvia l'aggiornamento automatico.
 * URL e scope derivano dal base path di Vite (es. /METEO-LAB/ su GitHub Pages).
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;

  const updater = new PwaUpdater({
    buildId: __BUILD_ID__,
    base,
    container: navigator.serviceWorker,
    fetchPublishedBuild: async () => {
      // Senza query: version.json non è in cache né in Cloudflare (JSON) né nel browser (no-store).
      const response = await fetch(`${base}version.json`, { cache: 'no-store', credentials: 'omit' });
      if (!response.ok) return null;
      const body: unknown = await response.json();
      return typeof body === 'object' && body !== null && typeof (body as { buildId?: unknown }).buildId === 'string'
        ? (body as { buildId: string }).buildId
        : null;
    },
    reload: () => window.location.reload(),
    storage: (() => {
      try {
        return window.sessionStorage;
      } catch {
        return null;
      }
    })(),
    isOnline: () => navigator.onLine !== false,
    onResume: (callback) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') callback();
      });
      window.addEventListener('focus', callback);
      window.addEventListener('online', callback);
      // Pagina ripristinata dalla back/forward cache (tasto Indietro, ripristino): nessuna navigazione.
      window.addEventListener('pageshow', (event) => {
        if (event.persisted) callback();
      });
    },
    now: () => performance.now(),
  });

  const start = () => {
    updater.start().catch((error: unknown) => {
      console.warn('Aggiornamento del service worker non riuscito', error);
    });
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
