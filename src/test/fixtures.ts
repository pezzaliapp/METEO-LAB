import { createAtmosphericState, type AtmosphericInput, type AtmosphericState } from '../models/AtmosphericState';

export function makeObservation(overrides: Partial<AtmosphericInput> = {}): AtmosphericState {
  return createAtmosphericState({
    timestamp: '2026-09-27T12:00:00Z',
    latitude: 45.46,
    longitude: 9.19,
    temperature: 23.3,
    apparentTemperature: 24.5,
    relativeHumidity: 51,
    dewPoint: 12.6,
    pressure: 1023.8,
    surfacePressure: 1007.7,
    precipitation: 0,
    rain: 0,
    showers: 0,
    cloudCover: 0,
    windSpeed: 2.1,
    windDirection: 239,
    windGust: 8.6,
    weatherCode: 0,
    source: { providerId: 'test', providerName: 'Test', fetchedAt: '2026-09-27T12:05:00Z' },
    ...overrides,
  });
}
