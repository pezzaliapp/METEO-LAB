/** Registra il service worker solo nella build di produzione. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((error: unknown) => {
      console.warn('Registrazione del service worker non riuscita', error);
    });
  });
}
