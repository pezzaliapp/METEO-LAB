import { describe, expect, it } from 'vitest';
import { OpenMeteoProvider } from './OpenMeteoProvider';
import { WeatherProviderError } from './WeatherProvider';

/** Risposta reale di Open-Meteo (Milano, 27/09/2026), usata come fixture. */
const SAMPLE = {
  latitude: 45.46,
  longitude: 9.199999,
  current_units: {
    time: 'unixtime', interval: 'seconds', temperature_2m: '°C', apparent_temperature: '°C',
    relative_humidity_2m: '%', dew_point_2m: '°C', pressure_msl: 'hPa', surface_pressure: 'hPa',
    precipitation: 'mm', rain: 'mm', showers: 'mm', cloud_cover: '%', wind_speed_10m: 'km/h',
    wind_direction_10m: '°', wind_gusts_10m: 'km/h', weather_code: 'wmo code',
  },
  current: {
    time: 1790508600, interval: 900, temperature_2m: 23.3, apparent_temperature: 24.5,
    relative_humidity_2m: 51, dew_point_2m: 12.6, pressure_msl: 1023.8, surface_pressure: 1007.7,
    precipitation: 0, rain: 0, showers: 0, cloud_cover: 0, wind_speed_10m: 2.1,
    wind_direction_10m: 239, wind_gusts_10m: 8.6, weather_code: 0,
  },
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const provider = (fetch: (url: string, init?: RequestInit) => Promise<Response>, online = true) =>
  new OpenMeteoProvider({ fetch, isOnline: () => online, now: () => new Date('2026-09-27T12:05:00Z') });

describe('OpenMeteoProvider', () => {
  it('richiede solo le coordinate e le variabili documentate', () => {
    const url = new URL(provider(async () => jsonResponse(SAMPLE)).buildUrl(45.46, 9.19));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('current')).toContain('wind_gusts_10m');
    expect(url.searchParams.get('timeformat')).toBe('unixtime');
    expect(url.searchParams.get('wind_speed_unit')).toBe('kmh');
  });

  it('converte la risposta in AtmosphericState', async () => {
    const state = await provider(async () => jsonResponse(SAMPLE)).getCurrentState(45.46, 9.19);
    expect(state).toMatchObject({
      timestamp: '2026-09-27T11:30:00.000Z',
      latitude: 45.46,
      longitude: 9.19,
      temperature: 23.3,
      relativeHumidity: 51,
      pressure: 1023.8,
      windGust: 8.6,
      weatherCode: 0,
      source: { providerId: 'open-meteo', fetchedAt: '2026-09-27T12:05:00.000Z' },
    });
  });

  it('lascia null le variabili assenti o con unità inattese', async () => {
    const current: Record<string, unknown> = { ...SAMPLE.current };
    delete current.wind_gusts_10m;
    const body = { ...SAMPLE, current, current_units: { ...SAMPLE.current_units, pressure_msl: 'inHg' } };
    const state = await provider(async () => jsonResponse(body)).getCurrentState(45.46, 9.19);
    expect(state.windGust).toBeNull();
    expect(state.pressure).toBeNull();
    expect(state.temperature).toBe(23.3);
  });

  it('gestisce errori del provider, di rete, offline e timeout', async () => {
    const httpError = provider(async () => jsonResponse({ error: true, reason: 'Latitude must be in range' }, 400));
    await expect(httpError.getCurrentState(45, 9)).rejects.toMatchObject({ kind: 'http', status: 400 });

    const network = provider(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(network.getCurrentState(45, 9)).rejects.toMatchObject({ kind: 'network' });

    const offline = provider(async () => jsonResponse(SAMPLE), false);
    await expect(offline.getCurrentState(45, 9)).rejects.toMatchObject({ kind: 'offline' });

    const slow = provider(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    await expect(slow.getCurrentState(45, 9, { timeoutMs: 20 })).rejects.toMatchObject({ kind: 'timeout' });

    await expect(provider(async () => jsonResponse({})).getCurrentState(45, 9)).rejects.toBeInstanceOf(
      WeatherProviderError,
    );
    await expect(provider(async () => jsonResponse(SAMPLE)).getCurrentState(120, 9)).rejects.toMatchObject({
      kind: 'invalid-request',
    });
  });
});
