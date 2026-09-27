/**
 * Registra il service worker solo nella build di produzione.
 * URL e scope derivano dal base path di Vite (es. /METEO-LAB/ su GitHub Pages).
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL;
    // URL del service worker diverso a ogni build (il nome del bundle contiene l'hash del contenuto):
    // una copia vecchia di sw.js in una cache CDN o HTTP non può impedire l'aggiornamento.
    const build = new URL(import.meta.url).pathname.split('/').pop() ?? '';
    const script = `${base}sw.js?v=${encodeURIComponent(build)}`;
    navigator.serviceWorker.register(script, { scope: base, updateViaCache: 'none' }).catch((error: unknown) => {
      console.warn('Registrazione del service worker non riuscita', error);
    });
  });
}
