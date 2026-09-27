import { describe, expect, it } from 'vitest';
import { makeObservation } from '../test/fixtures';
import { ATMOSPHERIC_FIELDS, countAvailableFields, createAtmosphericState } from './AtmosphericState';

const source = { providerId: 'test', providerName: 'Test', fetchedAt: '2026-09-27T12:05:00Z' };

describe('AtmosphericState', () => {
  it('rappresenta tutte le grandezze richieste', () => {
    const state = makeObservation();
    expect(state.temperature).toBe(23.3);
    expect(state.windGust).toBe(8.6);
    expect(state.timestamp).toBe('2026-09-27T12:00:00.000Z');
    expect(countAvailableFields(state)).toBe(ATMOSPHERIC_FIELDS.length);
  });

  it('usa null per i dati mancanti senza inventare valori', () => {
    const state = createAtmosphericState({ timestamp: '2026-09-27T12:00:00Z', latitude: 44, longitude: 11, source });
    for (const field of ATMOSPHERIC_FIELDS) expect(state[field]).toBeNull();
    expect(countAvailableFields(state)).toBe(0);
  });

  it('scarta valori non numerici o fisicamente impossibili', () => {
    const state = makeObservation({ temperature: 'caldo', relativeHumidity: 140, pressure: Number.NaN, windSpeed: -3 });
    expect(state.temperature).toBeNull();
    expect(state.relativeHumidity).toBeNull();
    expect(state.pressure).toBeNull();
    expect(state.windSpeed).toBeNull();
    expect(state.dewPoint).toBe(12.6);
  });

  it('rifiuta coordinate e timestamp non validi', () => {
    expect(() => makeObservation({ latitude: 95 })).toThrow(RangeError);
    expect(() => makeObservation({ timestamp: 'ieri' })).toThrow(RangeError);
  });

  it('è immutabile', () => {
    const state = makeObservation();
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.source)).toBe(true);
  });
});
