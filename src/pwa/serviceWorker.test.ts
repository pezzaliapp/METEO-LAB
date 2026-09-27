/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { renderServiceWorker, resolveBuildId, versionManifest } from '../../pwa-build';

const TEMPLATE = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://example.test';
const SCOPE = `${ORIGIN}/METEO-LAB/`;

/** Esegue sw.js in un contesto isolato con self/caches/fetch simulati. */
function loadWorker(buildId: string, existingCaches: string[], online = true) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const store = new Map<string, Map<string, Response>>(existingCaches.map((name) => [name, new Map()]));
  const log = { skipWaiting: 0, claim: 0, deleted: [] as string[], added: [] as Request[], fetched: [] as { url: string; cache?: string }[] };
  const self = {
    location: { origin: ORIGIN, href: `${SCOPE}sw.js?build=${buildId}` },
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      handlers[type] = handler;
    },
    skipWaiting: () => {
      log.skipWaiting++;
      return Promise.resolve();
    },
    clients: { claim: () => ((log.claim++), Promise.resolve()) },
  };
  const caches = {
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      return {
        addAll: async (requests: Request[]) => {
          log.added.push(...requests);
          for (const r of requests) store.get(name)?.set(new URL(r.url, SCOPE).pathname, new Response(`cached ${r.url}`));
        },
      };
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => (log.deleted.push(name), store.delete(name)),
    match: async (request: Request | string) => {
      const path = new URL(typeof request === 'string' ? request : request.url, SCOPE).pathname;
      for (const cache of store.values()) if (cache.has(path)) return cache.get(path);
      return undefined;
    },
  };
  const fetch = async (request: Request, init?: RequestInit) => {
    log.fetched.push({ url: request.url, ...(init?.cache ? { cache: init.cache } : {}) });
    if (!online) throw new TypeError('offline');
    return new Response(`network ${request.url}`);
  };
  const source = renderServiceWorker(TEMPLATE, ['./', 'index.html', 'assets/index-new.js'], `${buildId}-abcd`, buildId);
  // Le Request relative del service worker si risolvono rispetto al suo URL.
  const ScopedRequest = class extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, SCOPE) : input, init);
    }
  };
  runInNewContext(source, { self, caches, fetch, Request: ScopedRequest, Response, URL, Promise, console });

  async function dispatch(type: string, extra: Record<string, unknown> = {}) {
    const pending: Promise<unknown>[] = [];
    let response: Promise<Response> | null = null;
    const handler = handlers[type];
    handler?.({
      ...extra,
      waitUntil: (p: Promise<unknown>) => pending.push(p),
      respondWith: (p: Promise<Response>) => {
        response = p;
      },
    });
    await Promise.all(pending);
    return response as Promise<Response> | null;
  }
  return { log, store, dispatch };
}

describe('service worker', () => {
  it('install: precarica la shell dalla rete (cache reload) e chiama skipWaiting', async () => {
    const sw = loadWorker('bbb2222', []);
    await sw.dispatch('install');
    expect(sw.log.added.map((r) => r.cache)).toEqual(['reload', 'reload', 'reload']);
    expect(sw.log.skipWaiting).toBe(1);
    expect([...sw.store.keys()]).toEqual(['meteo-lab-shell-bbb2222-abcd']);
  });

  it('activate: elimina le cache delle versioni precedenti e prende il controllo delle pagine', async () => {
    const sw = loadWorker('bbb2222', ['meteo-lab-shell-aaa1111-9999', 'meteo-lab-shell-c430d6aa7b5a', 'altra-cache']);
    await sw.dispatch('install');
    await sw.dispatch('activate');
    expect(sw.log.deleted.sort()).toEqual(['meteo-lab-shell-aaa1111-9999', 'meteo-lab-shell-c430d6aa7b5a']);
    expect([...sw.store.keys()].sort()).toEqual(['altra-cache', 'meteo-lab-shell-bbb2222-abcd']);
    expect(sw.log.claim).toBe(1);
  });

  it('navigazione: rete prima con rivalidazione (no-cache); offline la shell in cache', async () => {
    const online = loadWorker('bbb2222', []);
    const navigate = new Request(`${SCOPE}`, { mode: 'same-origin' });
    Object.defineProperty(navigate, 'mode', { value: 'navigate' });
    const response = await online.dispatch('fetch', { request: navigate });
    expect(await (await response)?.text()).toContain('network');
    expect(online.log.fetched.at(-1)).toMatchObject({ cache: 'no-cache' });

    const offline = loadWorker('bbb2222', [], false);
    await offline.dispatch('install').catch(() => undefined);
    const cached = await offline.dispatch('fetch', { request: navigate });
    expect(await (await cached)?.text()).toContain('cached');
  });

  it('version.json non viene mai servito dal service worker', async () => {
    const sw = loadWorker('bbb2222', []);
    const response = await sw.dispatch('fetch', { request: new Request(`${SCOPE}version.json`) });
    expect(response).toBeNull();
    expect(sw.log.fetched).toHaveLength(0);
  });

  it('messaggio SKIP_WAITING: attivazione immediata', async () => {
    const sw = loadWorker('bbb2222', []);
    await sw.dispatch('message', { data: { type: 'SKIP_WAITING' } });
    expect(sw.log.skipWaiting).toBe(1);
  });
});

describe('BUILD_ID', () => {
  it('generato a build-time dallo SHA del commit, mai casuale', () => {
    expect(resolveBuildId({ githubSha: 'd93eecf1234567890', contentHash: 'ffff' })).toBe('d93eecf');
    expect(resolveBuildId({ gitSha: 'd93eecf1234567890', dirty: false, contentHash: 'ffff' })).toBe('d93eecf');
    expect(resolveBuildId({ gitSha: 'd93eecf1234567890', dirty: true, contentHash: '0123456789' })).toBe('d93eecf-dev.012345');
    expect(resolveBuildId({ override: ' test B ', contentHash: 'x' })).toBe('testB');
    expect(resolveBuildId({ gitSha: null, contentHash: 'abcdef0123456' })).toBe('src-abcdef0123');
    expect(resolveBuildId({ githubSha: 'd93eecf1234567890', contentHash: 'ffff' })).toBe(
      resolveBuildId({ githubSha: 'd93eecf1234567890', contentHash: 'ffff' }),
    );
  });

  it('esposto nel service worker, nel nome della cache e in version.json', () => {
    const source = renderServiceWorker(TEMPLATE, ['index.html'], 'd93eecf-1234', 'd93eecf');
    expect(source).toContain("const BUILD_ID = 'd93eecf';");
    expect(source).toContain("const CACHE_VERSION = 'd93eecf-1234';");
    expect(JSON.parse(versionManifest('0.4.0', 'd93eecf'))).toEqual({ version: '0.4.0', buildId: 'd93eecf' });
    expect(() => renderServiceWorker('const x = "__BUILD_ID__"; __BUILD_ID__', [], 'v', 'b')).toThrow();
  });
});
