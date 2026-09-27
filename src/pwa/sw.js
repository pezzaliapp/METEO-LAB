/*
 * METEO LAB — Service Worker
 * Autore: Alessandro Pezzali — Licenza MIT
 *
 * Mette in cache SOLO l'application shell (file della stessa origine prodotti dalla build).
 * Le richieste ai provider meteorologici e alle tile della mappa (altre origini)
 * non vengono intercettate né salvate: un dato meteo non deve mai apparire "LIVE" se non lo è.
 */
// Build a cui appartiene questo service worker (SHA del commit, inserito in fase di build).
const BUILD_ID = '__BUILD_ID__';
const CACHE_VERSION = '__CACHE_VERSION__';
const CACHE_NAME = `meteo-lab-shell-${CACHE_VERSION}`;
// Elenco dei file dell'application shell, inserito in fase di build (vite.config.ts).
const PRECACHE = [/* __PRECACHE_MANIFEST__ */];

// I file della shell hanno nomi con hash del contenuto: l'header Vary (es. "Vary: Origin")
// non deve impedire la corrispondenza fra richieste con e senza header Origin.
const MATCH_OPTIONS = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // cache: 'reload' — la shell va letta dal server, non dalla cache HTTP del browser
      // (index.html ha max-age=600: senza reload si rischia di salvare la versione precedente).
      .then((cache) => cache.addAll(PRECACHE.map((path) => new Request(path, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

// Richiesta esplicita della pagina: attivarsi subito (in aggiunta a skipWaiting durante install).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_BUILD' && event.source) event.source.postMessage({ type: 'BUILD', buildId: BUILD_ID });
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('meteo-lab-shell-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Solo stessa origine: API meteo e tile della mappa passano direttamente alla rete.
  if (url.origin !== self.location.origin) return;
  // version.json dice quale build è pubblicata: mai dalla cache, sempre dalla rete.
  if (url.pathname.endsWith('/version.json')) return;

  if (request.mode === 'navigate') {
    // Rete prima, poi shell in cache (funzionamento offline dell'interfaccia).
    // cache: 'no-cache' — index.html viene sempre rivalidato: dopo un deploy arriva subito la nuova versione.
    event.respondWith(
      fetch(request, { cache: 'no-cache' }).catch(() =>
        caches.match('index.html', MATCH_OPTIONS).then((cached) => cached || Response.error()),
      ),
    );
    return;
  }

  event.respondWith(caches.match(request, MATCH_OPTIONS).then((cached) => cached || fetch(request)));
});
