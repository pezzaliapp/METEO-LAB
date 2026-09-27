/**
 * Ciclo di aggiornamento automatico della PWA.
 *
 * Problema che risolve: una pagina già aperta (scheda lasciata aperta, PWA riaperta dal Dock o
 * dalla schermata Home, che "riprende" la pagina senza ricaricarla) non scopriva mai la nuova
 * versione: nessun controllo avveniva al ritorno sulla pagina, e ServiceWorkerRegistration.update()
 * ricontrolla solo lo script GIÀ registrato (sw.js della build vecchia), che non cambia mai.
 *
 * Strategia:
 *  1. version.json (una risorsa JSON, che Cloudflare non mette in cache per default) dice quale
 *     build è pubblicata; viene letto dalla rete con cache 'no-store' all'avvio e quando la
 *     pagina torna visibile / in primo piano / online / dalla back-forward cache (niente polling).
 *  2. Ogni build ha il suo service worker sw.js?build=<BUILD_ID>: un URL che non cambia mai
 *     contenuto, quindi nessuna cache (HTTP o CDN) può servirne una copia vecchia. Registrare
 *     l'URL della build nuova avvia l'algoritmo standard di Update: install → skipWaiting →
 *     activate (pulizia cache vecchie) → clients.claim().
 *  3. controllerchange verso un service worker di un'altra build → UN solo reload, protetto da
 *     sessionStorage contro i loop. Una pagina non sostituisce mai una registrazione esistente con
 *     lo script della propria build (niente "ping-pong" fra versioni).
 *  4. Offline: nessun controllo, nessun reload; la versione installata continua a funzionare.
 */

export const RELOAD_GUARD_KEY = 'meteo-lab:update-reload';
/** Intervallo minimo fra due controlli: accorpa visibilitychange, focus e online che arrivano insieme. */
export const MIN_CHECK_INTERVAL_MS = 10_000;

export type CheckResult = 'offline' | 'throttled' | 'current' | 'updating' | 'loop-guard' | 'unavailable';

export interface MinimalWorker {
  readonly state: string;
  readonly scriptURL: string;
  postMessage(message: unknown): void;
  addEventListener(type: 'statechange', listener: () => void): void;
}

export interface MinimalRegistration {
  readonly installing: MinimalWorker | null;
  readonly waiting: MinimalWorker | null;
  readonly active: MinimalWorker | null;
  update(): Promise<unknown>;
  addEventListener(type: 'updatefound', listener: () => void): void;
}

export interface MinimalContainer {
  readonly controller: { readonly scriptURL: string } | null;
  register(url: string, options: { scope: string; updateViaCache: 'none' }): Promise<MinimalRegistration>;
  getRegistration(scope: string): Promise<MinimalRegistration | undefined>;
  addEventListener(type: 'controllerchange', listener: () => void): void;
}

export interface UpdaterEnvironment {
  readonly buildId: string;
  readonly base: string;
  readonly container: MinimalContainer;
  /** BUILD_ID pubblicato (version.json dalla rete), null se non disponibile. */
  readonly fetchPublishedBuild: () => Promise<string | null>;
  readonly reload: () => void;
  readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  readonly isOnline: () => boolean;
  /** Registra il callback per "la pagina torna visibile / in primo piano / online". */
  readonly onResume: (callback: () => void) => void;
  readonly now: () => number;
}

export function serviceWorkerUrl(base: string, buildId: string): string {
  return `${base}sw.js?build=${encodeURIComponent(buildId)}`;
}

/** Build del service worker dal suo URL (null per service worker di versioni precedenti alla 0.4.1). */
export function buildOfWorker(worker: { readonly scriptURL: string } | null | undefined): string | null {
  if (!worker) return null;
  try {
    return new URL(worker.scriptURL, 'https://x.invalid/').searchParams.get('build');
  } catch {
    return null;
  }
}

export class PwaUpdater {
  private registration: MinimalRegistration | null = null;
  private target: string | null = null;
  private reloading = false;
  private lastCheck = Number.NEGATIVE_INFINITY;

  constructor(private readonly env: UpdaterEnvironment) {}

  async start(): Promise<void> {
    const { env } = this;
    // Arrivati sulla build per cui si era ricaricato: la protezione anti-loop non serve più.
    if (this.readGuard() === env.buildId) this.writeGuard(null);
    env.container.addEventListener('controllerchange', () => this.onControllerChange());
    env.onResume(() => {
      void this.check();
    });
    try {
      // Se esiste già una registrazione NON la si sostituisce con lo script della propria build:
      // una pagina vecchia non deve mai riportare indietro il service worker.
      const existing = await env.container.getRegistration(env.base);
      this.registration =
        existing ?? (await env.container.register(serviceWorkerUrl(env.base, env.buildId), { scope: env.base, updateViaCache: 'none' }));
      this.watch(this.registration);
    } catch {
      return; // service worker non disponibile (es. navigazione privata): l'app funziona comunque
    }
    await this.check(true);
  }

  /** Allinea service worker e pagina alla build pubblicata. */
  async check(force = false): Promise<CheckResult> {
    const { env } = this;
    if (!env.isOnline()) return 'offline';
    const now = env.now();
    if (!force && now - this.lastCheck < MIN_CHECK_INTERVAL_MS) return 'throttled';
    this.lastCheck = now;
    // Controllo standard dello script registrato (economico; rileva cambi di contenuto allo stesso URL).
    await this.registration?.update().catch(() => undefined);

    let published: string | null;
    try {
      published = await env.fetchPublishedBuild();
    } catch {
      return 'unavailable';
    }
    // Senza version.json leggibile la build desiderata è quella della pagina.
    const desired = published ?? env.buildId;
    const pageOutdated = desired !== env.buildId;
    if (pageOutdated && this.readGuard() === desired) return 'loop-guard';

    const registration = this.registration;
    const workerBuild = buildOfWorker(registration?.active ?? registration?.waiting ?? registration?.installing);
    if (registration && workerBuild !== desired) {
      try {
        // Registrare lo script della build desiderata avvia l'algoritmo standard di Update
        // (install → skipWaiting → activate con pulizia delle cache → clients.claim).
        const updated = await env.container.register(serviceWorkerUrl(env.base, desired), { scope: env.base, updateViaCache: 'none' });
        this.registration = updated;
        this.watch(updated);
        updated.waiting?.postMessage({ type: 'SKIP_WAITING' });
      } catch {
        return 'unavailable';
      }
    }
    if (!pageOutdated) return 'current';
    this.target = desired;
    // Il service worker della build nuova controlla già la pagina (es. attivato da un'altra scheda).
    if (buildOfWorker(env.container.controller) === desired) this.reloadOnce();
    return 'updating';
  }

  private watch(registration: MinimalRegistration): void {
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') worker.postMessage({ type: 'SKIP_WAITING' });
      });
    });
  }

  private onControllerChange(): void {
    const controllerBuild = buildOfWorker(this.env.container.controller);
    // Il nuovo service worker appartiene alla build di questa pagina (prima installazione o pagina
    // già aggiornata dalla navigazione): nessun reload.
    if (controllerBuild === null || controllerBuild === this.env.buildId) return;
    this.target ??= controllerBuild;
    this.reloadOnce();
  }

  private reloadOnce(): void {
    const target = this.target;
    if (this.reloading || target === null || target === this.env.buildId) return;
    if (this.readGuard() === target) return;
    this.writeGuard(target);
    this.reloading = true;
    this.env.reload();
  }

  private readGuard(): string | null {
    try {
      return this.env.storage?.getItem(RELOAD_GUARD_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private writeGuard(value: string | null): void {
    try {
      if (value === null) this.env.storage?.removeItem(RELOAD_GUARD_KEY);
      else this.env.storage?.setItem(RELOAD_GUARD_KEY, value);
    } catch {
      // storage non disponibile: resta la protezione in memoria (this.reloading)
    }
  }
}
