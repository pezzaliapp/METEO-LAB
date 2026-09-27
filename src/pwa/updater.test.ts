import { describe, expect, it } from 'vitest';
import {
  MIN_CHECK_INTERVAL_MS,
  PwaUpdater,
  buildOfWorker,
  RELOAD_GUARD_KEY,
  serviceWorkerUrl,
  type MinimalContainer,
  type MinimalRegistration,
  type MinimalWorker,
} from './updater';

const BASE = '/METEO-LAB/';

/**
 * Browser simulato: una registrazione del service worker (con worker attivo, algoritmo di
 * Update quando si registra uno script diverso, clients.claim → controllerchange), la pagina
 * in esecuzione (build), version.json, sessionStorage.
 */
function fakeBrowser(options: {
  build: string;
  published: string | null;
  /** Build del service worker già attivo (null = nessuna registrazione). */
  workerBuild: string | null;
  online?: boolean;
  storage?: Map<string, string>;
}) {
  const listeners: Record<string, (() => void)[]> = {};
  const resume: (() => void)[] = [];
  const storage = options.storage ?? new Map<string, string>();
  const url = (build: string) => `https://x${serviceWorkerUrl(BASE, build)}`;
  const state = {
    published: options.published as string | null,
    online: options.online ?? true,
    now: 0,
    reloads: 0,
    registered: [] as string[],
    updates: 0,
    versionFetches: 0,
    messages: [] as unknown[],
    controller: options.workerBuild ? { scriptURL: url(options.workerBuild) } : (null as { scriptURL: string } | null),
  };

  const worker = (scriptURL: string): MinimalWorker & { listeners: (() => void)[]; state: string } => {
    const w = {
      state: 'activated',
      scriptURL,
      listeners: [] as (() => void)[],
      postMessage: (message: unknown) => void state.messages.push(message),
      addEventListener: (_: 'statechange', l: () => void) => void w.listeners.push(l),
    };
    return w;
  };

  let registration: (MinimalRegistration & { updatefound: (() => void)[]; installing: MinimalWorker | null; active: MinimalWorker | null }) | null =
    options.workerBuild ? makeRegistration(worker(url(options.workerBuild))) : null;

  function makeRegistration(active: MinimalWorker | null) {
    const reg = {
      installing: null as MinimalWorker | null,
      waiting: null,
      active,
      updatefound: [] as (() => void)[],
      update: async () => {
        state.updates++;
        if (!state.online) throw new Error('offline');
      },
      addEventListener: (_: 'updatefound', l: () => void) => void reg.updatefound.push(l),
    };
    return reg;
  }

  const container: MinimalContainer = {
    get controller() {
      return state.controller;
    },
    getRegistration: async () => registration ?? undefined,
    register: async (path) => {
      state.registered.push(path);
      const scriptURL = `https://x${path}`;
      registration ??= makeRegistration(null);
      const reg = registration;
      if (reg.active?.scriptURL !== scriptURL) {
        // Algoritmo di Update: nuovo worker → installed → (skipWaiting) → activated → clients.claim().
        const w = worker(scriptURL);
        w.state = 'installing';
        reg.installing = w;
        reg.updatefound.forEach((l) => l());
        queueMicrotask(() => {
          w.state = 'installed';
          w.listeners.forEach((l) => l());
          reg.installing = null;
          w.state = 'activated';
          reg.active = w;
          state.controller = { scriptURL };
          (listeners.controllerchange ?? []).forEach((l) => l());
        });
      }
      return reg;
    },
    addEventListener: (type, l) => {
      (listeners[type] ??= []).push(l);
    },
  };

  const updater = new PwaUpdater({
    buildId: options.build,
    base: BASE,
    container,
    fetchPublishedBuild: async () => {
      state.versionFetches++;
      if (!state.online) throw new TypeError('Failed to fetch');
      return state.published;
    },
    reload: () => {
      state.reloads++;
    },
    storage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => void storage.set(k, v),
      removeItem: (k) => void storage.delete(k),
    },
    isOnline: () => state.online,
    onResume: (cb) => resume.push(cb),
    now: () => state.now,
  });

  const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return {
    updater,
    state,
    storage,
    flush,
    /** La stessa scheda ricaricata: nuova pagina (build) con la stessa registrazione e sessione. */
    nextPage: (build: string) =>
      fakeBrowser({ build, published: state.published, workerBuild: buildOf(state.controller?.scriptURL), storage }),
    resume: async () => {
      resume.forEach((cb) => cb());
      await flush();
    },
    controllerChange: () => (listeners.controllerchange ?? []).forEach((l) => l()),
  };
}

function buildOf(scriptURL: string | undefined): string | null {
  return scriptURL ? new URL(scriptURL).searchParams.get('build') : null;
}

describe('aggiornamento automatico della PWA', () => {
  it('all’avvio: prima installazione con updateViaCache none, update() e version.json, nessun reload', async () => {
    const b = fakeBrowser({ build: 'aaa1111', published: 'aaa1111', workerBuild: null });
    await b.updater.start();
    await b.flush();
    expect(b.state.registered).toEqual(['/METEO-LAB/sw.js?build=aaa1111']);
    expect(b.state.updates).toBe(1);
    expect(b.state.versionFetches).toBe(1);
    expect(b.state.reloads).toBe(0); // clients.claim della prima installazione non ricarica
  });

  it('vecchia app → nuova app senza hard refresh: installa il worker nuovo e ricarica UNA volta', async () => {
    const a = fakeBrowser({ build: 'aaa1111', published: 'bbb2222', workerBuild: 'aaa1111' });
    await a.updater.start();
    await a.flush();
    expect(a.state.registered).toEqual(['/METEO-LAB/sw.js?build=bbb2222']);
    expect(a.state.messages).toContainEqual({ type: 'SKIP_WAITING' });
    expect(a.state.reloads).toBe(1);
    expect(a.storage.get(RELOAD_GUARD_KEY)).toBe('bbb2222');
    // Dopo il reload la pagina è la build nuova: nessun altro reload, protezione rimossa.
    const b = a.nextPage('bbb2222');
    await b.updater.start();
    await b.flush();
    expect(b.state.reloads).toBe(0);
    expect(b.state.registered).toEqual([]);
    expect(b.storage.has(RELOAD_GUARD_KEY)).toBe(false);
  });

  it('reload normale che porta già la pagina nuova: il service worker si aggiorna senza reload in più', async () => {
    // HTML nuovo arrivato dalla rete mentre il service worker attivo è ancora quello vecchio.
    const b = fakeBrowser({ build: 'bbb2222', published: 'bbb2222', workerBuild: 'aaa1111' });
    await b.updater.start();
    await b.flush();
    expect(b.state.registered).toEqual(['/METEO-LAB/sw.js?build=bbb2222']);
    expect(b.state.controller?.scriptURL).toContain('build=bbb2222');
    expect(b.state.reloads).toBe(0);
  });

  it('ritorno sulla scheda: controlla l’aggiornamento e ricarica una sola volta', async () => {
    const a = fakeBrowser({ build: 'aaa1111', published: 'aaa1111', workerBuild: 'aaa1111' });
    await a.updater.start();
    expect(a.state.reloads).toBe(0);
    a.state.published = 'bbb2222'; // deploy mentre la scheda è aperta
    a.state.now += MIN_CHECK_INTERVAL_MS + 1;
    await a.resume();
    expect(a.state.updates).toBe(2);
    expect(a.state.registered.at(-1)).toBe('/METEO-LAB/sw.js?build=bbb2222');
    expect(a.state.reloads).toBe(1);
  });

  it('nessun polling: controlli ravvicinati (visibilitychange + focus + online) sono accorpati', async () => {
    const a = fakeBrowser({ build: 'aaa1111', published: 'aaa1111', workerBuild: 'aaa1111' });
    await a.updater.start();
    await a.resume();
    await a.resume();
    expect(a.state.versionFetches).toBe(1);
    expect(await a.updater.check()).toBe('throttled');
  });

  it('controllerchange → un solo reload anche se l’evento si ripete', async () => {
    const a = fakeBrowser({ build: 'aaa1111', published: 'bbb2222', workerBuild: 'aaa1111' });
    await a.updater.start();
    await a.flush();
    a.controllerChange();
    a.controllerChange();
    expect(a.state.reloads).toBe(1);
  });

  it('nessun reload loop e nessun "ping-pong": se dopo il reload la pagina è ancora vecchia ci si ferma', async () => {
    // version.json dice B ma l'HTML servito è ancora A (CDN non allineata).
    const a = fakeBrowser({ build: 'aaa1111', published: 'bbb2222', workerBuild: 'aaa1111' });
    await a.updater.start();
    await a.flush();
    expect(a.state.reloads).toBe(1);
    const stillA = a.nextPage('aaa1111');
    await stillA.updater.start();
    await stillA.flush();
    expect(stillA.state.reloads).toBe(0);
    // la pagina vecchia non riporta indietro il service worker
    expect(stillA.state.registered).toEqual([]);
    expect(stillA.state.controller?.scriptURL).toContain('build=bbb2222');
    stillA.state.now += MIN_CHECK_INTERVAL_MS + 1;
    await stillA.resume();
    expect(await stillA.updater.check(true)).toBe('loop-guard');
    expect(stillA.state.reloads).toBe(0);
  });

  it('offline: nessun controllo, nessun errore, nessun reload; al ritorno online si aggiorna', async () => {
    const a = fakeBrowser({ build: 'aaa1111', published: 'bbb2222', workerBuild: 'aaa1111', online: false });
    await expect(a.updater.start()).resolves.toBeUndefined();
    await a.resume();
    expect(a.state.versionFetches).toBe(0);
    expect(a.state.reloads).toBe(0);
    expect(a.state.registered).toEqual([]);
    a.state.online = true;
    a.state.now += MIN_CHECK_INTERVAL_MS + 1;
    await a.resume();
    expect(a.state.reloads).toBe(1);
  });

  it('version.json non raggiungibile: nessun reload', async () => {
    const a = fakeBrowser({ build: 'aaa1111', published: null, workerBuild: 'aaa1111' });
    await a.updater.start();
    expect(await a.updater.check(true)).toBe('current');
    expect(a.state.reloads).toBe(0);
  });

  it('service worker delle versioni precedenti (sw.js?v=…): la pagina nuova lo sostituisce senza reload', async () => {
    const b = fakeBrowser({ build: 'bbb2222', published: 'bbb2222', workerBuild: null });
    // registrazione esistente con lo script della v0.4.0 (senza parametro build)
    await b.updater.start();
    await b.flush();
    expect(buildOfWorker({ scriptURL: 'https://x/METEO-LAB/sw.js?v=index-Bl0Dw0La.js' })).toBeNull();
    expect(b.state.reloads).toBe(0);
  });
});
