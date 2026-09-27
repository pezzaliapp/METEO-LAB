import {
  createAtmosphericState,
  isValidCoordinate,
  type AtmosphericField,
  type AtmosphericState,
} from '../models/AtmosphericState';
import { PROFILE_LEVELS, createAtmosphericProfile, type AtmosphericProfile, type PressureLevelInput } from '../models/AtmosphericProfile';
import { WeatherProviderError, type RequestOptions, type WeatherProvider } from './WeatherProvider';

/**
 * Provider Open-Meteo — Forecast API, blocco "current".
 * Documentazione: https://open-meteo.com/en/docs
 *
 * Endpoint: https://api.open-meteo.com/v1/forecast
 * Uso gratuito non commerciale, senza chiave API.
 * Unità richieste esplicitamente: °C, km/h, mm; tempo in unixtime UTC.
 */
export const OPEN_METEO_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

/** Corrispondenza variabile Open-Meteo → campo AtmosphericState, con unità attesa. */
const VARIABLES: ReadonlyArray<readonly [string, AtmosphericField, string]> = [
  ['temperature_2m', 'temperature', '°C'],
  ['apparent_temperature', 'apparentTemperature', '°C'],
  ['relative_humidity_2m', 'relativeHumidity', '%'],
  ['dew_point_2m', 'dewPoint', '°C'],
  ['pressure_msl', 'pressure', 'hPa'],
  ['surface_pressure', 'surfacePressure', 'hPa'],
  ['precipitation', 'precipitation', 'mm'],
  ['rain', 'rain', 'mm'],
  ['showers', 'showers', 'mm'],
  ['cloud_cover', 'cloudCover', '%'],
  ['wind_speed_10m', 'windSpeed', 'km/h'],
  ['wind_direction_10m', 'windDirection', '°'],
  ['wind_gusts_10m', 'windGust', 'km/h'],
  ['weather_code', 'weatherCode', 'wmo code'],
];

/**
 * PROFILO ATMOSFERICO — variabili sui livelli di pressione (documentazione "Pressure Level Variables"):
 * <variabile>_<livello>hPa. Sono dati dei modelli numerici combinati da Open-Meteo, NON radiosondaggi.
 */
const LEVEL_VARIABLES: ReadonlyArray<readonly [string, keyof Omit<PressureLevelInput, 'pressure'>, string]> = [
  ['temperature', 'temperature', '°C'],
  ['relative_humidity', 'relativeHumidity', '%'],
  ['dew_point', 'dewPoint', '°C'],
  ['wind_speed', 'windSpeed', 'km/h'],
  ['wind_direction', 'windDirection', '°'],
  ['geopotential_height', 'height', 'm'],
];

/** Indici convettivi calcolati dal modello del provider (variabili orarie, disponibili anche come "current"). */
const PROFILE_SCALARS: ReadonlyArray<readonly [string, 'cape' | 'cin' | 'liftedIndex' | 'freezingLevelHeight' | 'surfacePressure', string]> = [
  ['cape', 'cape', 'J/kg'],
  ['convective_inhibition', 'cin', 'J/kg'],
  ['lifted_index', 'liftedIndex', ''],
  ['freezing_level_height', 'freezingLevelHeight', 'm'],
  ['surface_pressure', 'surfacePressure', 'hPa'],
];

/** Open-Meteo non indica nella risposta quale modello ha fornito i dati: parametro "models" predefinito. */
export const OPEN_METEO_PROFILE_MODEL = 'modelli numerici combinati da Open-Meteo (selezione automatica «best match»)';

const DEFAULT_TIMEOUT_MS = 10_000;

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface OpenMeteoProviderOptions {
  readonly fetch?: FetchFn;
  readonly endpoint?: string;
  readonly isOnline?: () => boolean;
  readonly now?: () => Date;
}

export class OpenMeteoProvider implements WeatherProvider {
  readonly id = 'open-meteo';
  readonly name = 'Open-Meteo';
  readonly attribution = { text: 'Dati meteo: Open-Meteo.com (CC BY 4.0)', url: 'https://open-meteo.com/' };

  private readonly fetchFn: FetchFn;
  private readonly endpoint: string;
  private readonly isOnline: () => boolean;
  private readonly now: () => Date;

  constructor(options: OpenMeteoProviderOptions = {}) {
    this.fetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.endpoint = options.endpoint ?? OPEN_METEO_ENDPOINT;
    this.isOnline = options.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
    this.now = options.now ?? (() => new Date());
  }

  buildUrl(latitude: number, longitude: number): string {
    const params = new URLSearchParams({
      latitude: latitude.toFixed(4),
      longitude: longitude.toFixed(4),
      current: VARIABLES.map(([name]) => name).join(','),
      temperature_unit: 'celsius',
      wind_speed_unit: 'kmh',
      precipitation_unit: 'mm',
      timeformat: 'unixtime',
      timezone: 'GMT',
    });
    return `${this.endpoint}?${params.toString()}`;
  }

  async getCurrentState(latitude: number, longitude: number, options: RequestOptions = {}): Promise<AtmosphericState> {
    this.checkRequest(latitude, longitude);
    const body = await this.request(this.buildUrl(latitude, longitude), options);
    return this.parse(body, latitude, longitude);
  }

  buildProfileUrl(latitude: number, longitude: number): string {
    const levelNames = PROFILE_LEVELS.flatMap((level) => LEVEL_VARIABLES.map(([name]) => `${name}_${level}hPa`));
    const params = new URLSearchParams({
      latitude: latitude.toFixed(4),
      longitude: longitude.toFixed(4),
      current: [...levelNames, ...PROFILE_SCALARS.map(([name]) => name)].join(','),
      temperature_unit: 'celsius',
      wind_speed_unit: 'kmh',
      timeformat: 'unixtime',
      timezone: 'GMT',
    });
    return `${this.endpoint}?${params.toString()}`;
  }

  /** PROFILO ATMOSFERICO (modellistico) nel punto: livelli 1000…300 hPa e indici convettivi del modello. */
  async getProfile(latitude: number, longitude: number, options: RequestOptions = {}): Promise<AtmosphericProfile> {
    this.checkRequest(latitude, longitude);
    const body = await this.request(this.buildProfileUrl(latitude, longitude), options);
    return this.parseProfile(body, latitude, longitude);
  }

  parseProfile(body: unknown, requestedLatitude: number, requestedLongitude: number): AtmosphericProfile {
    if (!isRecord(body) || !isRecord(body.current)) {
      throw new WeatherProviderError('invalid-response', 'Blocco "current" assente.');
    }
    const current = body.current;
    const units = isRecord(body.current_units) ? body.current_units : {};
    const timestamp = parseTime(current.time);
    if (timestamp === null) {
      throw new WeatherProviderError('invalid-response', 'Istante di validità assente o non valido.');
    }
    const read = (name: string, expectedUnit: string): unknown => {
      const unit = units[name];
      return unit === undefined || unit === expectedUnit ? current[name] : null;
    };

    const levels = PROFILE_LEVELS.map((pressure) => {
      const level: PressureLevelInput = { pressure };
      for (const [name, field, unit] of LEVEL_VARIABLES) level[field] = read(`${name}_${pressure}hPa`, unit);
      return level;
    });
    const scalars: Record<string, unknown> = {};
    for (const [name, field, unit] of PROFILE_SCALARS) scalars[field] = read(name, unit);

    return createAtmosphericProfile({
      timestamp,
      latitude: requestedLatitude,
      longitude: requestedLongitude,
      elevation: body.elevation,
      ...scalars,
      levels,
      source: {
        providerId: this.id,
        providerName: this.name,
        model: OPEN_METEO_PROFILE_MODEL,
        fetchedAt: this.now().toISOString(),
      },
    });
  }

  private checkRequest(latitude: number, longitude: number): void {
    if (!isValidCoordinate(latitude, longitude)) {
      throw new WeatherProviderError('invalid-request', 'Coordinate fuori intervallo.');
    }
    if (!this.isOnline()) {
      throw new WeatherProviderError('offline', 'Dispositivo offline.');
    }
  }

  /** Richiesta HTTP con timeout, annullamento e gestione uniforme degli errori. */
  private async request(url: string, options: RequestOptions): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });
    if (options.signal?.aborted) controller.abort();

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch (error) {
      if (timedOut) throw new WeatherProviderError('timeout', 'Tempo di risposta scaduto.');
      if (controller.signal.aborted) throw new WeatherProviderError('aborted', 'Richiesta annullata.');
      throw new WeatherProviderError('network', error instanceof Error ? error.message : 'Errore di rete.');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new WeatherProviderError(
        response.ok ? 'invalid-response' : 'http',
        response.ok ? 'JSON non valido.' : response.statusText || 'Errore HTTP',
        response.ok ? null : response.status,
      );
    }

    if (!response.ok || (isRecord(body) && body.error === true)) {
      const reason = isRecord(body) && typeof body.reason === 'string' ? body.reason : 'Errore del provider';
      throw new WeatherProviderError('http', reason, response.status);
    }
    return body;
  }

  /** Converte la risposta JSON di Open-Meteo in AtmosphericState. */
  parse(body: unknown, requestedLatitude: number, requestedLongitude: number): AtmosphericState {
    if (!isRecord(body) || !isRecord(body.current)) {
      throw new WeatherProviderError('invalid-response', 'Blocco "current" assente.');
    }
    const current = body.current;
    const units = isRecord(body.current_units) ? body.current_units : {};

    const timestamp = parseTime(current.time);
    if (timestamp === null) {
      throw new WeatherProviderError('invalid-response', 'Istante di validità assente o non valido.');
    }

    const values: Partial<Record<AtmosphericField, unknown>> = {};
    for (const [name, field, expectedUnit] of VARIABLES) {
      const unit = units[name];
      // Se il provider dichiara un'unità diversa da quella attesa il valore è scartato, non convertito a caso.
      values[field] = unit === undefined || unit === expectedUnit ? current[name] : null;
    }

    // Open-Meteo restituisce le coordinate della cella di griglia usata; si conserva il punto richiesto.
    return createAtmosphericState({
      timestamp,
      latitude: requestedLatitude,
      longitude: requestedLongitude,
      ...values,
      source: { providerId: this.id, providerName: this.name, fetchedAt: this.now().toISOString() },
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTime(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value * 1000).toISOString();
  if (typeof value === 'string') {
    // ISO senza fuso (timezone=GMT) → UTC
    const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
    const time = Date.parse(normalized);
    return Number.isNaN(time) ? null : new Date(time).toISOString();
  }
  return null;
}
