import type { AtmosphericProfile } from '../models/AtmosphericProfile';
import type { AtmosphericState } from '../models/AtmosphericState';
import type { SimulationParameters } from '../models/SimulationState';

/**
 * Persistenza locale su IndexedDB. Nessun dato lascia il dispositivo.
 *
 *  - "observations": ultima osservazione reale valida (chiave "last") e il suo
 *                    PROFILO ATMOSFERICO (chiave "last-profile")
 *  - "scenarios":    scenari di simulazione salvati dall'utente
 */
const DB_NAME = 'meteo-lab';
const DB_VERSION = 1;
const OBSERVATIONS = 'observations';
const SCENARIOS = 'scenarios';
const LAST_KEY = 'last';
const LAST_PROFILE_KEY = 'last-profile';

export interface SavedScenario {
  readonly id: string;
  readonly name: string;
  readonly savedAt: string;
  /** Osservazione reale usata come condizione iniziale. */
  readonly origin: AtmosphericState;
  /** Condizioni iniziali impostate dall'utente. */
  readonly parameters: SimulationParameters;
  /** PROFILO ATMOSFERICO del punto (assente negli scenari salvati con v0.1/v0.2). */
  readonly profile?: AtmosphericProfile | null;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function isAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  if (!isAvailable()) return Promise.reject(new Error('IndexedDB non disponibile'));
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OBSERVATIONS)) db.createObjectStore(OBSERVATIONS);
      if (!db.objectStoreNames.contains(SCENARIOS)) db.createObjectStore(SCENARIOS, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Apertura IndexedDB fallita'));
    };
  });
  return dbPromise;
}

async function run<T>(store: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = action(transaction.objectStore(store));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error ?? new Error('Transazione IndexedDB fallita'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Transazione IndexedDB annullata'));
  });
}

export async function saveLastObservation(observation: AtmosphericState): Promise<void> {
  await run(OBSERVATIONS, 'readwrite', (store) => store.put(observation, LAST_KEY));
}

export async function loadLastObservation(): Promise<AtmosphericState | null> {
  const value = await run<unknown>(OBSERVATIONS, 'readonly', (store) => store.get(LAST_KEY));
  return (value as AtmosphericState | undefined) ?? null;
}

/** Salva (o cancella, con null) il profilo associato all'ultima osservazione. */
export async function saveLastProfile(profile: AtmosphericProfile | null): Promise<void> {
  if (profile) await run(OBSERVATIONS, 'readwrite', (store) => store.put(profile, LAST_PROFILE_KEY));
  else await run(OBSERVATIONS, 'readwrite', (store) => store.delete(LAST_PROFILE_KEY));
}

export async function loadLastProfile(): Promise<AtmosphericProfile | null> {
  const value = await run<unknown>(OBSERVATIONS, 'readonly', (store) => store.get(LAST_PROFILE_KEY));
  return (value as AtmosphericProfile | undefined) ?? null;
}

export async function saveScenario(scenario: SavedScenario): Promise<void> {
  await run(SCENARIOS, 'readwrite', (store) => store.put(scenario));
}

export async function listScenarios(): Promise<SavedScenario[]> {
  const items = await run<unknown[]>(SCENARIOS, 'readonly', (store) => store.getAll());
  return (items as SavedScenario[]).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function deleteScenario(id: string): Promise<void> {
  await run(SCENARIOS, 'readwrite', (store) => store.delete(id));
}
