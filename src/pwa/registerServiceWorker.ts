/**
 * Registra il service worker solo nella build di produzione.
 * URL e scope derivano dal base path di Vite (es. /METEO-LAB/ su GitHub Pages).
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL;
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch((error: unknown) => {
      console.warn('Registrazione del service worker non riuscita', error);
    });
  });
}
